#include "cloud.h"
#include "secrets.h"
#include <WiFi.h>
#include "esp_crt_bundle.h"

// External state variables from sketch_nov3a.ino
extern char stationName[80];
extern char activeURL[256];
extern bool streamRunning;
extern bool rebuffering;
extern float currentVolume;
extern size_t activeBufferSize;
extern volatile uint32_t underruns;
extern volatile uint32_t readerReconnects;
extern volatile uint32_t maxGapMs;
extern volatile uint32_t totalBytes;
extern size_t getStreamBufferFill();
extern float getNetKBps();

QueueHandle_t xCloudCmdQueue = nullptr;
static esp_mqtt_client_handle_t mqttClient = nullptr;
static bool mqttConnected = false;

// MQTT Topic buffers
static char topicCmd[64];
static char topicState[64];
static char topicAck[64];
static char topicOnline[64];

// Command deduplication (remember last 16 IDs)
#define DEDUPE_SIZE 16
static char recentIds[DEDUPE_SIZE][36];
static uint8_t dedupeHead = 0;

// State rate-limiting & timers
static uint32_t lastStatePublishMs = 0;
static bool statePublishRequested = false;

// Command result tracking
static char lastCmdId[36] = {0};
static char lastCmdStatus[10] = {0}; // "done" | "failed"
static char lastCmdError[64] = {0};
static uint32_t lastCmdDurationMs = 0;
static bool hasLastCmd = false;

// Sleep timer (runs on ESP32)
uint32_t sleepUntilMs = 0;

static bool isDuplicateId(const char* id) {
  for (int i = 0; i < DEDUPE_SIZE; i++) {
    if (strcmp(recentIds[i], id) == 0) return true;
  }
  return false;
}

static void recordId(const char* id) {
  strlcpy(recentIds[dedupeHead], id, sizeof(recentIds[dedupeHead]));
  dedupeHead = (dedupeHead + 1) % DEDUPE_SIZE;
}

void printHeapBudget(const char* stage) {
  uint32_t freeH = ESP.getFreeHeap();
  uint32_t minH = ESP.getMinFreeHeap();
  uint32_t maxAlloc = ESP.getMaxAllocHeap();

  Serial.println("\n------------------------------------------------");
  Serial.printf("[HEAP BUDGET - %s]\n", stage);
  Serial.printf("  Free Heap:       %u bytes (%u KB)\n", freeH, freeH / 1024);
  Serial.printf("  Min Free Heap:   %u bytes (%u KB)\n", minH, minH / 1024);
  Serial.printf("  Largest Contig:  %u bytes (%u KB)\n", maxAlloc, maxAlloc / 1024);
  Serial.printf("  MQTT Status:     %s\n", mqttConnected ? "CONNECTED" : "DISCONNECTED");
  Serial.printf("  Free Heap Margin: %s (Target: > 25 KB)\n",
                freeH >= 25600 ? "OK - SAFE MARGIN" : "WARNING - LOW MARGIN");
  Serial.println("------------------------------------------------\n");
}

static void publishStateInternal() {
  if (!mqttConnected || mqttClient == nullptr) return;

  uint32_t now = millis();
  lastStatePublishMs = now;
  statePublishRequested = false;

  StaticJsonDocument<768> doc;
  doc["v"] = 1;
  doc["fw"] = "1.0.0";
  doc["ts"] = (uint32_t)(now / 1000);
  doc["uptime"] = (uint32_t)(now / 1000);

  JsonObject wifi = doc.createNestedObject("wifi");
  wifi["rssi"] = WiFi.RSSI();

  JsonObject heap = doc.createNestedObject("heap");
  heap["free"] = ESP.getFreeHeap();
  heap["min"] = ESP.getMinFreeHeap();
  heap["largest"] = ESP.getMaxAllocHeap();

  JsonObject player = doc.createNestedObject("player");
  const char* pState = "idle";
  if (streamRunning) {
    pState = rebuffering ? "rebuffering" : "playing";
  }
  player["state"] = pState;
  player["station"] = stationName[0] ? stationName : "Idle";
  player["url"] = activeURL[0] ? activeURL : "";
  player["kbps"] = 128; // will be dynamically passed
  player["https"] = (strncmp(activeURL, "https://", 8) == 0);

  size_t fill = getStreamBufferFill();
  size_t fillPct = activeBufferSize > 0 ? (fill * 100 / activeBufferSize) : 0;
  if (fillPct > 100) fillPct = 100;
  player["bufferPct"] = (uint8_t)fillPct;

  player["netKBps"] = getNetKBps();
  player["underruns"] = underruns;
  player["reconnects"] = readerReconnects;
  player["gapMs"] = maxGapMs;
  player["volume"] = (uint8_t)(currentVolume * 100.0f);

  uint16_t sleepRemainingMin = 0;
  if (sleepUntilMs > now) {
    sleepRemainingMin = (uint16_t)((sleepUntilMs - now + 59999) / 60000);
  }
  player["sleepIn"] = sleepRemainingMin;

  if (hasLastCmd) {
    JsonObject lc = doc.createNestedObject("lastCmd");
    lc["id"] = lastCmdId;
    lc["status"] = lastCmdStatus;
    if (lastCmdError[0]) lc["error"] = lastCmdError;
    lc["ms"] = lastCmdDurationMs;
  }

  char payload[768];
  size_t len = serializeJson(doc, payload, sizeof(payload));

  esp_mqtt_client_publish(mqttClient, topicState, payload, len, 1, 1);
}

void triggerCloudStatePublish() {
  statePublishRequested = true;
}

void reportCloudCommandResult(const char* id, bool success, const char* error, uint32_t durationMs) {
  strlcpy(lastCmdId, id, sizeof(lastCmdId));
  strlcpy(lastCmdStatus, success ? "done" : "failed", sizeof(lastCmdStatus));
  if (error != nullptr) {
    strlcpy(lastCmdError, error, sizeof(lastCmdError));
  } else {
    lastCmdError[0] = 0;
  }
  lastCmdDurationMs = durationMs;
  hasLastCmd = true;

  triggerCloudStatePublish();
}

static void handleIncomingCommand(const char* data, int dataLen) {
  StaticJsonDocument<512> doc;
  DeserializationError err = deserializeJson(doc, data, dataLen);
  if (err) {
    Serial.printf("[MQTT] JSON parse error: %s\n", err.c_str());
    return;
  }

  const char* id = doc["id"] | "";
  const char* typeStr = doc["type"] | "";
  if (!id[0] || !typeStr[0]) return;

  // Deduplication
  if (isDuplicateId(id)) {
    Serial.printf("[MQTT] Dropping duplicate cmd: %s\n", id);
    return;
  }
  recordId(id);

  // Send immediate "received" ack from MQTT task before blocking
  char ackPayload[64];
  snprintf(ackPayload, sizeof(ackPayload), "{\"id\":\"%s\",\"status\":\"received\"}", id);
  esp_mqtt_client_publish(mqttClient, topicAck, ackPayload, 0, 1, 0);

  // Parse command into struct
  CloudCommand cmd;
  memset(&cmd, 0, sizeof(cmd));
  strlcpy(cmd.id, id, sizeof(cmd.id));
  cmd.receivedMs = millis();

  if (strcmp(typeStr, "play") == 0) {
    cmd.type = CLOUD_CMD_PLAY;
    const char* u = doc["url"] | "";
    const char* n = doc["name"] | "Station";
    cmd.kbps = doc["kbps"] | 128;
    strlcpy(cmd.url, u, sizeof(cmd.url));
    strlcpy(cmd.name, n, sizeof(cmd.name));
  } else if (strcmp(typeStr, "volume") == 0) {
    cmd.type = CLOUD_CMD_VOLUME;
    cmd.volume = doc["value"] | 15;
  } else if (strcmp(typeStr, "stop") == 0) {
    cmd.type = CLOUD_CMD_STOP;
  } else if (strcmp(typeStr, "resume") == 0) {
    cmd.type = CLOUD_CMD_RESUME;
  } else if (strcmp(typeStr, "sleep") == 0) {
    cmd.type = CLOUD_CMD_SLEEP;
    cmd.sleepMinutes = doc["minutes"] | 0;
  } else if (strcmp(typeStr, "reboot") == 0) {
    cmd.type = CLOUD_CMD_REBOOT;
  } else if (strcmp(typeStr, "ping") == 0) {
    cmd.type = CLOUD_CMD_PING;
  } else {
    // Unknown command
    reportCloudCommandResult(id, false, "Unknown command type", 0);
    return;
  }

  // Push to FreeRTOS queue for loop() processing
  if (xCloudCmdQueue != nullptr) {
    if (xQueueSend(xCloudCmdQueue, &cmd, 0) != pdPASS) {
      Serial.println("[MQTT] Command queue full, dropped!");
      reportCloudCommandResult(id, false, "Queue full", 0);
    }
  }
}

static void mqttEventHandler(void* handler_args, esp_event_base_t base, int32_t event_id, void* event_data) {
  esp_mqtt_event_handle_t event = (esp_mqtt_event_handle_t)event_data;

  switch ((esp_mqtt_event_id_t)event_id) {
    case MQTT_EVENT_CONNECTED:
      Serial.println("[MQTT] Connected to broker.");
      mqttConnected = true;

      // 1. Publish retained "online"
      esp_mqtt_client_publish(mqttClient, topicOnline, "online", 6, 1, 1);

      // 2. Subscribe to cmd topic
      esp_mqtt_client_subscribe(mqttClient, topicCmd, 1);
      Serial.printf("[MQTT] Subscribed to %s\n", topicCmd);

      // 3. Publish initial state
      publishStateInternal();
      break;

    case MQTT_EVENT_DISCONNECTED:
      Serial.println("[MQTT] Disconnected from broker.");
      mqttConnected = false;
      break;

    case MQTT_EVENT_DATA:
      if (event->topic_len > 0 && strncmp(event->topic, topicCmd, event->topic_len) == 0) {
        handleIncomingCommand(event->data, event->data_len);
      }
      break;

    case MQTT_EVENT_ERROR:
      Serial.printf("[MQTT] Error event: %d\n", event->error_handle->error_type);
      break;

    default:
      break;
  }
}

void initCloud() {
  snprintf(topicCmd, sizeof(topicCmd), "aavritti/v1/%s/cmd", DEVICE_ID_VAL);
  snprintf(topicState, sizeof(topicState), "aavritti/v1/%s/state", DEVICE_ID_VAL);
  snprintf(topicAck, sizeof(topicAck), "aavritti/v1/%s/ack", DEVICE_ID_VAL);
  snprintf(topicOnline, sizeof(topicOnline), "aavritti/v1/%s/online", DEVICE_ID_VAL);

  xCloudCmdQueue = xQueueCreate(8, sizeof(CloudCommand));
  if (xCloudCmdQueue == nullptr) {
    Serial.println("[ERROR] Failed to create Cloud Command Queue!");
    return;
  }

  Serial.println("[MQTT] Initializing esp-mqtt client...");

  esp_mqtt_client_config_t mqtt_cfg = {};

#if MQTT_TLS
  char brokerUri[128];
  snprintf(brokerUri, sizeof(brokerUri), "mqtts://%s:%d", MQTT_BROKER_HOST_VAL, MQTT_PORT_VAL);
  mqtt_cfg.broker.address.uri = brokerUri;
  mqtt_cfg.broker.verification.crt_bundle_attach = esp_crt_bundle_attach;
#else
  char brokerUri[128];
  snprintf(brokerUri, sizeof(brokerUri), "mqtt://%s:%d", MQTT_BROKER_HOST_VAL, MQTT_PORT_VAL);
  mqtt_cfg.broker.address.uri = brokerUri;
#endif

  mqtt_cfg.credentials.client_id = DEVICE_ID_VAL;
  mqtt_cfg.credentials.username = MQTT_USERNAME_VAL;
  mqtt_cfg.credentials.authentication.password = MQTT_PASSWORD_VAL;

  // Last Will and Testament: offline, QoS 1, retained
  mqtt_cfg.session.last_will.topic = topicOnline;
  mqtt_cfg.session.last_will.msg = "offline";
  mqtt_cfg.session.last_will.msg_len = 7;
  mqtt_cfg.session.last_will.qos = 1;
  mqtt_cfg.session.last_will.retain = 1;

  mqtt_cfg.session.keepalive = 30;
  mqtt_cfg.session.disable_clean_session = 1; // clean_session = false

  mqttClient = esp_mqtt_client_init(&mqtt_cfg);
  if (mqttClient == nullptr) {
    Serial.println("[ERROR] esp_mqtt_client_init failed!");
    return;
  }

  esp_mqtt_client_register_event(mqttClient, MQTT_EVENT_ANY, mqttEventHandler, nullptr);
  esp_mqtt_client_start(mqttClient);

  printHeapBudget("POST CLOUD INIT");
}

void serviceCloud() {
  uint32_t now = millis();

  // Handle sleep timer if active
  if (sleepUntilMs > 0 && now >= sleepUntilMs) {
    Serial.println("[SLEEP] Timer expired, stopping playback.");
    sleepUntilMs = 0;
    extern void stopStream();
    stopStream();
    triggerCloudStatePublish();
  }

  // Periodic state publishing
  // Rate-limited to max 1/s on change, 5s while playing, 15s while idle
  uint32_t interval = streamRunning ? 5000 : 15000;
  bool timeDue = (now - lastStatePublishMs >= interval);

  if ((statePublishRequested && now - lastStatePublishMs >= 1000) || timeDue) {
    publishStateInternal();
  }
}

bool isCloudConnected() {
  return mqttConnected;
}
