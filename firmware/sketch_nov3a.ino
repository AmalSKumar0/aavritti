#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <strings.h>

#include "secrets.h"
#include "cloud.h"

// Compile flag: set to 1 for fallback local LAN webserver; default 0 for lean cloud mode
#ifndef ENABLE_LOCAL_WEB
#define ENABLE_LOCAL_WEB 0
#endif

#if ENABLE_LOCAL_WEB
#include <WebServer.h>
#include <ESPmDNS.h>
#include "dashboard.h"
#endif

#include "esp_system.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/stream_buffer.h"

// ESP8266Audio library
#include "AudioFileSource.h"
#include "AudioGeneratorMP3.h"
#include "AudioOutputI2S.h"

// =====================================================
// 1. WIFI + DASHBOARD
// =====================================================

const char* WIFI_SSID = WIFI_SSID_VAL;
const char* WIFI_PASSWORD = WIFI_PASSWORD_VAL;

#define WIFI_RETRY_MS     15000   // re-run WiFi.begin() while disconnected
#define WIFI_FAIL_LED_MS  30000   // "failed" LED pattern after this long down

#if ENABLE_LOCAL_WEB
// Dashboard address: http://<ip>/  or  http://radio.local/
const char* MDNS_NAME = "radio";

// Leave DASH_PASS empty ("") for no login.
// Otherwise the browser asks for this username / password.
const char* DASH_USER = "admin";
const char* DASH_PASS = "";
#endif

// =====================================================
// 2. RADIO BROWSER API (Malayalam, India, MP3, <=128 kbps)
// =====================================================

const char* API_HOSTS[] = {
  "de1.api.radio-browser.info",
  "all.api.radio-browser.info"
};
#define API_HOST_COUNT 2

const char* API_QUERY =
  "/json/stations/search"
  "?country=India"
  "&language=malayalam"
  "&codec=MP3"
  "&bitrateMax=128"
  "&hidebroken=true"
  "&limit=40"
  "&order=clickcount"
  "&reverse=true";

// =====================================================
// 3. PINS
// =====================================================

#define I2S_BCLK 26
#define I2S_LRC  25
#define I2S_DOUT 22

#define VOL_UP_PIN   32
#define VOL_DOWN_PIN 21

#define WIFI_LED_PIN 13

// =====================================================
// 4. SETTINGS
// =====================================================

// Ring buffer sizes sized to guarantee > 25 KB free heap with MQTT TLS + HTTPS stream.
#define BUFFER_HTTP   (48 * 1024)
#define BUFFER_HTTPS  (32 * 1024)

// Pre-buffer / re-buffer are sized in seconds of audio (from the
// station's advertised bitrate, 128 kbps if unknown), then clamped.
#define PREBUFFER_SECONDS    3
#define REBUFFER_SECONDS     4
#define MIN_PREBUFFER_BYTES  (12 * 1024)
#define MIN_REBUFFER_BYTES   (16 * 1024)

#define MIN_DECODE_BYTES     4096   // below this = underrun
#define PREBUFFER_TIMEOUT_MS 12000
#define READ_CHUNK           4096
#define DMA_BUFFER_COUNT     16

#define MAX_CANDIDATES 16

#define VOLUME_STEP  0.05f
#define VOLUME_MIN   0.0f
#define VOLUME_MAX   1.0f

#define BUTTON_DEBOUNCE_MS 35
#define BUTTON_REPEAT_MS   180

// =====================================================
// 5. TYPES AND STATE
//    (all types are defined before the first function)
// =====================================================

enum WiFiLEDState : uint8_t {
  LED_CONNECTING,
  LED_CONNECTED,
  LED_FAILED
};

enum Command : uint8_t {
  CMD_NONE,
  CMD_NEXT,
  CMD_PREV,
  CMD_SELECT,
  CMD_REFRESH,
  CMD_PLAY_URL
};

enum RadioState : uint8_t {
  RS_IDLE,
  RS_FETCHING,
  RS_BUFFERING,
  RS_PLAYING,
  RS_ERROR
};

struct Candidate {
  char name[80];
  char url[256];
  uint16_t bitrate;
};

struct ParsedURL {
  char host[96];
  char path[640];
  uint16_t port;
  bool https;
};

struct ButtonState {
  uint8_t pin;
  bool lastReading;
  bool stableState;
  uint32_t lastDebounceTime;
  uint32_t lastRepeatTime;
};

Preferences prefs;
#if ENABLE_LOCAL_WEB
WebServer server(80);
bool webStarted = false;

// Commands queued by the web handlers, executed by loop().
Command pendingCmd = CMD_NONE;
int pendingIndex = -1;
char pendingURL[256] = {0};
#endif

RadioState radioState = RS_IDLE;

// LED
WiFiLEDState wifiLEDState = LED_CONNECTING;
uint32_t ledLastChange = 0;
bool ledOn = false;
bool wifiDown = false;
uint32_t wifiDownSince = 0;
uint32_t lastWifiBegin = 0;

// Volume
float currentVolume = 0.15f;
bool volumeDirty = false;
uint32_t volumeChangedMs = 0;

// Stations
Candidate candidates[MAX_CANDIDATES];
int candidateCount = 0;
bool listFetched = false;   // a usable list exists (cached or downloaded)

char stationName[80] = {0};
char activeURL[256] = {0};
char lastURL[256] = {0};
char lastName[80] = {0};

// Buffering
size_t activeBufferSize = BUFFER_HTTP;
size_t prebufferBytes = 0;
size_t rebufferBytes = 0;

StreamBufferHandle_t streamBuf = nullptr;
TaskHandle_t readerTaskHandle = nullptr;

volatile bool readerRun = false;
volatile bool readerDone = true;
volatile bool readerFailed = false;

volatile uint32_t totalBytes = 0;
volatile uint32_t readerReconnects = 0;
volatile uint32_t underruns = 0;
volatile uint32_t maxGapMs = 0;

// Audio objects
AudioGeneratorMP3* mp3 = nullptr;
AudioOutputI2S* output = nullptr;
class StreamBufferSource;
StreamBufferSource* source = nullptr;

// Playback state
bool streamRunning = false;
bool decoderStopped = false;
bool rebuffering = false;
uint32_t rebufferStartMs = 0;
uint32_t playStartMs = 0;
bool lastSaved = false;

bool needStart = true;
bool triedLast = false;
uint32_t lastRetryMs = 0;

// Diagnostics
uint32_t lastDiagMs = 0;
uint32_t prevBytes = 0;
uint32_t prevUnderruns = 0;
int badIntervals = 0;

ButtonState volumeUp   = { VOL_UP_PIN,   HIGH, HIGH, 0, 0 };
ButtonState volumeDown = { VOL_DOWN_PIN, HIGH, HIGH, 0, 0 };

// Bigger loop() stack: web handlers and TLS both run inside loop().
size_t getArduinoLoopTaskStackSize(void) {
  return 12 * 1024;
}

// =====================================================
// 6. SMALL HELPERS
// =====================================================

const char* resetReasonText(esp_reset_reason_t r) {
  switch (r) {
    case ESP_RST_POWERON:  return "power-on";
    case ESP_RST_SW:       return "software reset";
    case ESP_RST_PANIC:    return "PANIC (crash)";
    case ESP_RST_INT_WDT:  return "interrupt watchdog";
    case ESP_RST_TASK_WDT: return "task watchdog";
    case ESP_RST_WDT:      return "other watchdog";
    case ESP_RST_BROWNOUT: return "BROWNOUT (power dip)";
    case ESP_RST_EXT:      return "external reset pin";
    default:               return "other";
  }
}

bool containsIgnoreCase(const char* text, const char* word) {
  size_t wl = strlen(word);
  for (; *text; text++) {
    if (strncasecmp(text, word, wl) == 0) return true;
  }
  return false;
}

bool isHttpURL(const char* url) {
  return url != nullptr && strncmp(url, "http://", 7) == 0;
}

bool isHttpsURL(const char* url) {
  return url != nullptr && strncmp(url, "https://", 8) == 0;
}

size_t clampSize(size_t value, size_t low, size_t high) {
  if (value < low) return low;
  if (value > high) return high;
  return value;
}

const char* stateText() {
  if (streamRunning) return rebuffering ? "Rebuffering" : "Playing";

  switch (radioState) {
    case RS_FETCHING:  return "Loading stations";
    case RS_BUFFERING: return "Buffering";
    case RS_ERROR:     return "Error - retrying";
    default:           return "Idle";
  }
}

int findIndexByURL(const char* url) {
  if (url == nullptr || url[0] == 0) return -1;

  for (int i = 0; i < candidateCount; i++) {
    if (strcmp(candidates[i].url, url) == 0) return i;
  }
  return -1;
}

int findActiveIndex() {
  return findIndexByURL(activeURL);
}

// Called from places that wait, so the dashboard stays responsive.
void serviceWeb() {
  if (webStarted) server.handleClient();
}

// =====================================================
// 7. WIFI LED + WIFI SERVICE
//    The LED pattern is derived from the real Wi-Fi state,
//    so it is correct no matter where updateWiFiLED() is called.
//      connecting : fast blink
//      connected  : slow blink
//      failed     : long-on / short-off (down > 30 s)
// =====================================================

void updateWiFiLED() {

  uint32_t now = millis();
  WiFiLEDState wanted;

  if (WiFi.status() == WL_CONNECTED) {
    wifiDown = false;
    wanted = LED_CONNECTED;
  } else {
    if (!wifiDown) {
      wifiDown = true;
      wifiDownSince = now;
    }
    wanted = (now - wifiDownSince > WIFI_FAIL_LED_MS)
               ? LED_FAILED : LED_CONNECTING;
  }

  if (wanted != wifiLEDState) {
    wifiLEDState = wanted;
    ledOn = false;
    ledLastChange = now;
    digitalWrite(WIFI_LED_PIN, LOW);
  }

  uint32_t onMs;
  uint32_t offMs;

  switch (wifiLEDState) {
    case LED_CONNECTING: onMs = 150;  offMs = 150; break;
    case LED_FAILED:     onMs = 1200; offMs = 300; break;
    default:             onMs = 500;  offMs = 500; break;
  }

  if (now - ledLastChange >= (ledOn ? onMs : offMs)) {
    ledLastChange = now;
    ledOn = !ledOn;
    digitalWrite(WIFI_LED_PIN, ledOn ? HIGH : LOW);
  }
}

void startWiFi() {

  Serial.println("\n[WIFI] Connecting...");

  WiFi.persistent(false);        // don't rewrite flash on every begin()
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);          // no modem sleep: steadier streaming
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  lastWifiBegin = millis();
}

void startWebServer();   // defined in section 16

void serviceWiFi() {

  static bool wasConnected = false;

  bool connected = (WiFi.status() == WL_CONNECTED);

  if (connected && !wasConnected) {
    Serial.printf("[WIFI] Connected. IP: %s, RSSI: %d dBm\n",
                  WiFi.localIP().toString().c_str(), WiFi.RSSI());
#if ENABLE_LOCAL_WEB
    startWebServer();
#endif
    static bool cloudStarted = false;
    if (!cloudStarted) {
      cloudStarted = true;
      initCloud();
    }
  }
  else if (!connected && wasConnected) {
    Serial.println("[WIFI] Connection lost.");
    lastWifiBegin = millis();
  }

  wasConnected = connected;

  if (!connected && millis() - lastWifiBegin > WIFI_RETRY_MS) {
    Serial.println("[WIFI] Still disconnected, retrying...");
    WiFi.disconnect();
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    lastWifiBegin = millis();
  }
}

// =====================================================
// 8. VOLUME (buttons + dashboard; saved 3 s after last change)
// =====================================================

void setVolume(float v) {
  v = constrain(v, VOLUME_MIN, VOLUME_MAX);
  if (v == currentVolume) return;

  currentVolume = v;
  if (output != nullptr) output->SetGain(currentVolume);

  volumeDirty = true;
  volumeChangedMs = millis();

  Serial.printf("[VOLUME] %.0f%%\n", currentVolume * 100.0f);
  triggerCloudStatePublish();
}

void changeVolume(float amount) {
  setVolume(currentVolume + amount);
}

void saveVolumeIfNeeded() {
  if (volumeDirty && millis() - volumeChangedMs > 3000) {
    prefs.putFloat("vol", currentVolume);
    volumeDirty = false;
  }
}

void handleVolumeButton(ButtonState& button, float direction) {
  bool reading = digitalRead(button.pin);
  uint32_t now = millis();

  if (reading != button.lastReading) {
    button.lastReading = reading;
    button.lastDebounceTime = now;
  }

  if (now - button.lastDebounceTime >= BUTTON_DEBOUNCE_MS) {
    if (reading != button.stableState) {
      button.stableState = reading;
      if (button.stableState == LOW) {
        changeVolume(direction);
        button.lastRepeatTime = now;
      }
    }
  }

  if (button.stableState == LOW &&
      now - button.lastRepeatTime >= BUTTON_REPEAT_MS) {
    changeVolume(direction);
    button.lastRepeatTime = now;
  }
}

void handleVolumeButtons() {
  handleVolumeButton(volumeUp, VOLUME_STEP);
  handleVolumeButton(volumeDown, -VOLUME_STEP);
}

// =====================================================
// 9. HTTP / HTTPS STREAM HELPERS (used by the reader task only)
// =====================================================

bool parseHttpURL(const char* url, ParsedURL& out) {
  if (url == nullptr) return false;

  const char* p;

  if (strncmp(url, "http://", 7) == 0) {
    out.https = false;
    out.port = 80;
    p = url + 7;
  } else if (strncmp(url, "https://", 8) == 0) {
    out.https = true;
    out.port = 443;
    p = url + 8;
  } else {
    return false;
  }

  const char* slash = strchr(p, '/');
  size_t hostLen = slash ? (size_t)(slash - p) : strlen(p);

  if (hostLen == 0 || hostLen >= sizeof(out.host)) return false;
  if (slash && strlen(slash) >= sizeof(out.path)) return false;

  char hostport[96];
  memcpy(hostport, p, hostLen);
  hostport[hostLen] = 0;

  char* colon = strchr(hostport, ':');
  if (colon) {
    *colon = 0;
    int port = atoi(colon + 1);
    if (port <= 0 || port > 65535) return false;
    out.port = (uint16_t)port;
  }

  strlcpy(out.host, hostport, sizeof(out.host));
  strlcpy(out.path, slash ? slash : "/", sizeof(out.path));
  return true;
}

// Stops waiting as soon as the reader is asked to quit.
bool readLine(WiFiClient& c, char* buf, size_t size, uint32_t timeoutMs) {
  size_t n = 0;
  uint32_t start = millis();

  while (readerRun && millis() - start < timeoutMs) {

    if (!c.available()) {
      if (!c.connected()) return false;
      vTaskDelay(pdMS_TO_TICKS(5));
      continue;
    }

    int ch = c.read();
    if (ch < 0) continue;

    if (ch == '\n') {
      buf[n] = 0;
      return true;
    }
    if (ch != '\r' && n < size - 1) buf[n++] = (char)ch;
  }
  return false;
}

// Interruptible sleep for the reader task.
void sleepWhileRunning(uint32_t ms) {
  uint32_t t = millis();
  while (readerRun && millis() - t < ms) {
    vTaskDelay(pdMS_TO_TICKS(50));
  }
}

// Opens the stream (HTTP or HTTPS, follows redirects) and returns the
// client positioned at the audio data, or nullptr on failure.
// No Icy-MetaData header is sent, so the stream is pure MP3 data.
//
// The big buffers are static to keep them off the reader's stack
// (TLS needs a lot of stack). This is safe: only one reader task
// ever exists, and stopStream() waits for it to finish.
WiFiClient* openStream(WiFiClient& plain, WiFiClientSecure& secure,
                       char* url, size_t urlSize) {

  static ParsedURL u;
  static char line[768];
  static char location[640];

  for (int redirects = 0; redirects < 4 && readerRun; redirects++) {

    if (!parseHttpURL(url, u)) {
      Serial.println("[HTTP] Unsupported or too-long URL.");
      return nullptr;
    }

    plain.stop();
    secure.stop();

    WiFiClient* client;
    bool connected;

    if (u.https) {
      secure.setInsecure();           // fine for public radio streams
      secure.setHandshakeTimeout(8);  // seconds (default is far longer)
      connected = secure.connect(u.host, u.port, 8000);
      client = &secure;
    } else {
      connected = plain.connect(u.host, u.port, 8000);
      client = &plain;
    }

    if (!connected) {
      Serial.printf("[HTTP] Connect failed: %s:%u\n", u.host, u.port);
      return nullptr;
    }

    if (!u.https) plain.setNoDelay(true);

    client->printf(
      "GET %s HTTP/1.0\r\n"
      "Host: %s\r\n"
      "User-Agent: AmalESP32Radio/1.0\r\n"
      "Accept: */*\r\n"
      "Connection: close\r\n\r\n",
      u.path, u.host
    );

    if (!readLine(*client, line, sizeof(line), 8000)) {
      Serial.println("[HTTP] No response.");
      return nullptr;
    }

    int code = 0;
    const char* sp = strchr(line, ' ');
    if (sp) code = atoi(sp + 1);

    location[0] = 0;

    while (true) {
      if (!readLine(*client, line, sizeof(line), 8000)) return nullptr;
      if (line[0] == 0) break;

      if (strncasecmp(line, "location:", 9) == 0) {
        const char* v = line + 9;
        while (*v == ' ') v++;
        strlcpy(location, v, sizeof(location));
      }
    }

    if (code == 200) return client;

    if ((code == 301 || code == 302 || code == 303 ||
         code == 307 || code == 308) && location[0]) {
      strlcpy(url, location, urlSize);
      continue;
    }

    Serial.printf("[HTTP] Status %d\n", code);
    return nullptr;
  }

  return nullptr;
}

// =====================================================
// 10. NETWORK READER TASK (core 0)
//     Fills the ring buffer. Reconnects on its own with
//     backoff, so short drops are hidden by the buffer.
// =====================================================

void readerTask(void*) {
  WiFiClient plain;
  WiFiClientSecure secure;
  WiFiClient* client = nullptr;

  static char url[640];   // single reader instance, see openStream()

  uint8_t* tmp = (uint8_t*)malloc(READ_CHUNK);

  if (tmp == nullptr) {
    readerFailed = true;
    readerDone = true;
    vTaskDelete(NULL);
    return;
  }

  int failures = 0;

  while (readerRun) {

    if (WiFi.status() != WL_CONNECTED) {
      vTaskDelay(pdMS_TO_TICKS(500));
      continue;
    }

    strlcpy(url, activeURL, sizeof(url));

    client = openStream(plain, secure, url, sizeof(url));

    if (client == nullptr) {
      plain.stop();
      secure.stop();

      if (!readerRun) break;

      if (++failures >= 6) {
        readerFailed = true;
        break;
      }

      // Backoff: 1, 2, 4, 8, 16 s (interruptible)
      sleepWhileRunning(1000u << (failures - 1));
      continue;
    }

    failures = 0;
    uint32_t lastData = millis();
    uint32_t idleSince = 0;

    while (readerRun) {

      int avail = client->available();

      if (avail > 0) {

        int n = client->read(tmp, avail > READ_CHUNK ? READ_CHUNK : avail);
        if (n <= 0) continue;

        if (idleSince != 0) {
          uint32_t gap = millis() - idleSince;
          if (gap > maxGapMs) maxGapMs = gap;
          idleSince = 0;
        }

        totalBytes += n;

        size_t off = 0;
        while (off < (size_t)n && readerRun) {
          off += xStreamBufferSend(
            streamBuf, tmp + off, n - off, pdMS_TO_TICKS(200)
          );
        }

        lastData = millis();
      }
      else {
        if (!client->connected()) break;
        if (idleSince == 0) idleSince = millis();
        if (millis() - lastData > 10000) break;   // stalled
        vTaskDelay(pdMS_TO_TICKS(2));
      }
    }

    plain.stop();
    secure.stop();

    if (readerRun) {
      readerReconnects++;
      sleepWhileRunning(300);
    }
  }

  plain.stop();
  secure.stop();
  free(tmp);
  readerDone = true;
  vTaskDelete(NULL);
}

// =====================================================
// 11. AUDIO SOURCE BACKED BY THE RING BUFFER
//     Never blocks and never touches the network.
// =====================================================

class StreamBufferSource : public AudioFileSource {
public:
  bool open(const char*) override { return true; }
  bool seek(int32_t, int) override { return false; }
  bool close() override { return true; }
  bool isOpen() override { return true; }
  uint32_t getSize() override { return 0; }
  uint32_t getPos() override { return pos; }

  uint32_t read(void* data, uint32_t len) override {
    if (streamBuf == nullptr) return 0;

    size_t n = xStreamBufferReceive(streamBuf, data, len, 0);
    pos += n;
    return (uint32_t)n;
  }

private:
  uint32_t pos = 0;
};

// =====================================================
// 12. START / STOP STREAM
// =====================================================

void stopStream() {

  readerRun = false;
  streamRunning = false;

  if (mp3 != nullptr) {
    if (mp3->isRunning()) mp3->stop();
    delete mp3;
    mp3 = nullptr;
  }

  if (source != nullptr) {
    delete source;
    source = nullptr;
  }

  if (output != nullptr) {
    delete output;
    output = nullptr;
  }

  if (readerTaskHandle != nullptr) {

    uint32_t t = millis();

    while (!readerDone && millis() - t < 20000) {
      delay(10);
      updateWiFiLED();
    }

    // Never free the buffer while the reader could still use it.
    if (!readerDone) {
      Serial.println("[FATAL] Reader task stuck - restarting.");
      delay(100);
      ESP.restart();
    }

    readerTaskHandle = nullptr;
  }

  if (streamBuf != nullptr) {
    vStreamBufferDelete(streamBuf);
    streamBuf = nullptr;
  }

  rebuffering = false;
  decoderStopped = false;
}

bool startStream(const Candidate& c) {

  stopStream();

  radioState = RS_BUFFERING;

  Serial.println("\n------------------------------");
  Serial.printf("[STATION] %s\n", c.name);
  Serial.printf("[STREAM] %s (%u kbps)\n", c.url, c.bitrate);

  // Show the new name on the dashboard while it buffers.
  strlcpy(stationName, c.name, sizeof(stationName));
  strlcpy(activeURL, c.url, sizeof(activeURL));

  ParsedURL pu;
  bool https = parseHttpURL(c.url, pu) && pu.https;

  activeBufferSize = https ? BUFFER_HTTPS : BUFFER_HTTP;

  // Size pre-buffer / re-buffer by seconds of audio.
  uint32_t kbps = c.bitrate ? c.bitrate : 128;
  size_t bytesPerSec = (size_t)kbps * 125;

  prebufferBytes = clampSize(bytesPerSec * PREBUFFER_SECONDS,
                             MIN_PREBUFFER_BYTES, activeBufferSize * 5 / 8);
  rebufferBytes = clampSize(bytesPerSec * REBUFFER_SECONDS,
                            MIN_REBUFFER_BYTES, activeBufferSize / 2);

  Serial.printf("[MEMORY] Free heap: %u, largest block: %u (%s)\n",
                (unsigned)ESP.getFreeHeap(), (unsigned)ESP.getMaxAllocHeap(),
                https ? "HTTPS" : "HTTP");

  if (ESP.getMaxAllocHeap() < activeBufferSize + 20000) {
    Serial.println("[ERROR] Not enough contiguous heap for the buffer.");
    radioState = RS_ERROR;
    return false;
  }

  streamBuf = xStreamBufferCreate(activeBufferSize, 1);

  if (streamBuf == nullptr) {
    Serial.println("[ERROR] Could not create stream buffer.");
    radioState = RS_ERROR;
    return false;
  }

  totalBytes = 0;
  maxGapMs = 0;
  readerReconnects = 0;
  underruns = 0;
  readerFailed = false;
  readerDone = false;
  readerRun = true;

  xTaskCreatePinnedToCore(
    readerTask, "reader", 12288, nullptr, 2, &readerTaskHandle, 0
  );

  // Pre-buffer. A slow or dead station fails here and is skipped.
  Serial.printf("[BUFFER] Pre-buffering %u bytes...\n",
                (unsigned)prebufferBytes);

  uint32_t t0 = millis();
  uint32_t lastPrint = t0;

  while (xStreamBufferBytesAvailable(streamBuf) < prebufferBytes) {

    if (readerFailed || millis() - t0 > PREBUFFER_TIMEOUT_MS) {
      Serial.printf("[SKIP] Pre-buffer failed (%u bytes in %lu ms).\n",
                    (unsigned)xStreamBufferBytesAvailable(streamBuf),
                    (unsigned long)(millis() - t0));
      stopStream();
      radioState = RS_ERROR;
      return false;
    }

    if (millis() - lastPrint > 2000) {
      lastPrint = millis();
      Serial.printf("[BUFFER] %u / %u bytes\n",
                    (unsigned)xStreamBufferBytesAvailable(streamBuf),
                    (unsigned)prebufferBytes);
    }

    updateWiFiLED();
    serviceWeb();   // handlers only queue commands, so this is safe
    delay(50);
  }

  Serial.printf("[BUFFER] Ready in %lu ms\n",
                (unsigned long)(millis() - t0));

  output = new AudioOutputI2S(
    0, AudioOutputI2S::EXTERNAL_I2S, DMA_BUFFER_COUNT
  );

  output->SetPinout(I2S_BCLK, I2S_LRC, I2S_DOUT);
  output->SetGain(currentVolume);

  source = new StreamBufferSource();
  mp3 = new AudioGeneratorMP3();

  if (!mp3->begin(source, output)) {
    Serial.println("[ERROR] MP3 decoder failed.");
    stopStream();
    radioState = RS_ERROR;
    return false;
  }

  streamRunning = true;
  radioState = RS_PLAYING;
  playStartMs = millis();
  lastSaved = false;

  lastDiagMs = millis();
  prevBytes = 0;
  prevUnderruns = 0;
  badIntervals = 0;

  Serial.println("\n====================================");
  Serial.println("          RADIO PLAYING");
  Serial.println("====================================");
  Serial.printf("[STATION] %s\n", stationName);
  Serial.printf("[VOLUME] %.0f%%\n", currentVolume * 100.0f);

  return true;
}

// Try stations starting at `start`, moving in direction `dir` (+1 / -1),
// until one starts.
bool playFrom(int start, int dir) {

  if (candidateCount == 0) return false;

  for (int i = 0; i < candidateCount; i++) {

    int idx = ((start + dir * i) % candidateCount + candidateCount)
              % candidateCount;

    if (startStream(candidates[idx])) return true;
  }

  return false;
}

// =====================================================
// 13. DECODER SERVICE (runs in loop())
// =====================================================

void serviceAudio() {

  if (!streamRunning || mp3 == nullptr) return;

  size_t avail = xStreamBufferBytesAvailable(streamBuf);

  if (rebuffering) {

    if (avail >= rebufferBytes) {
      rebuffering = false;
      Serial.println("[BUFFER] Resumed.");
    } else {
      return;
    }
  }
  else if (avail < MIN_DECODE_BYTES) {

    underruns++;
    rebuffering = true;
    rebufferStartMs = millis();
    Serial.println("[BUFFER] Underrun - rebuffering...");
    return;
  }

  if (!mp3->loop()) {
    Serial.println("[AUDIO] Decoder stopped.");
    decoderStopped = true;
  }
}

// =====================================================
// 14. STATION LIST (download + flash cache)
// =====================================================

// The list is cached as compact text ("name<TAB>url<TAB>kbps<LF>"),
// which stays small enough for one NVS entry.
void saveListCache() {

  String s;

  for (int i = 0; i < candidateCount; i++) {

    char name[80];
    strlcpy(name, candidates[i].name, sizeof(name));

    for (char* p = name; *p; p++) {
      if (*p == '\t' || *p == '\n' || *p == '\r') *p = ' ';
    }

    String line = String(name) + "\t" + candidates[i].url + "\t" +
                  String(candidates[i].bitrate) + "\n";

    if (s.length() + line.length() > 3800) break;   // NVS string limit
    s += line;
  }

  prefs.putString("stlist", s);
}

void loadListCache() {

  String s = prefs.getString("stlist", "");
  if (s.length() == 0) return;

  candidateCount = 0;
  int start = 0;

  while (start < (int)s.length() && candidateCount < MAX_CANDIDATES) {

    int nl = s.indexOf('\n', start);
    if (nl < 0) nl = s.length();

    int t1 = s.indexOf('\t', start);
    int t2 = (t1 >= 0) ? s.indexOf('\t', t1 + 1) : -1;

    if (t1 > start && t2 > t1 && t2 < nl) {

      Candidate& c = candidates[candidateCount];

      strlcpy(c.name, s.substring(start, t1).c_str(), sizeof(c.name));
      strlcpy(c.url, s.substring(t1 + 1, t2).c_str(), sizeof(c.url));
      c.bitrate = (uint16_t)s.substring(t2 + 1, nl).toInt();

      if (c.url[0]) candidateCount++;
    }

    start = nl + 1;
  }

  listFetched = (candidateCount > 0);
}

bool fetchStations() {

  Serial.println("\n[API] Fetching Malayalam stations...");

  radioState = RS_FETCHING;

  String response;

  for (int h = 0; h < API_HOST_COUNT && response.length() == 0; h++) {

    char api[400];
    snprintf(api, sizeof(api), "https://%s%s", API_HOSTS[h], API_QUERY);

    Serial.printf("[API] Server: %s\n", API_HOSTS[h]);

    WiFiClientSecure secureClient;
    secureClient.setInsecure();   // public station list

    HTTPClient http;
    http.setTimeout(20000);
    http.setUserAgent("AmalESP32Radio/1.0");
    http.useHTTP10(true);

    if (!http.begin(secureClient, api)) continue;

    int status = http.GET();
    Serial.printf("[API] HTTP status: %d\n", status);

    if (status == HTTP_CODE_OK) response = http.getString();

    http.end();

    updateWiFiLED();
  }

  if (response.length() == 0) {
    Serial.println("[ERROR] Station list unavailable.");
    return false;
  }

  Serial.printf("[API] Response size: %u bytes\n",
                (unsigned)response.length());

  // Keep only the fields we need to save RAM.
  StaticJsonDocument<384> filter;
  JsonObject f = filter.createNestedObject();
  f["name"] = true;
  f["codec"] = true;
  f["url_resolved"] = true;
  f["url"] = true;
  f["bitrate"] = true;
  f["hls"] = true;
  f["language"] = true;

  DynamicJsonDocument doc(32768);

  DeserializationError error =
    deserializeJson(doc, response, DeserializationOption::Filter(filter));

  response = "";

  if (error) {
    Serial.printf("[JSON] Parsing failed: %s\n", error.c_str());
    return false;
  }

  JsonArray stations = doc.as<JsonArray>();

  if (stations.isNull() || stations.size() == 0) {
    Serial.println("[ERROR] No stations found.");
    return false;
  }

  Serial.printf("[JSON] Found %u stations.\n", (unsigned)stations.size());

  // Build into a scratch list, so the old list is kept if nothing matches.
  static Candidate fresh[MAX_CANDIDATES];
  int freshCount = 0;

  // strict 0: Malayalam must be the FIRST listed language.
  // strict 1 (only if nothing matched): Malayalam anywhere in the list.
  // pass 0 = plain HTTP stations first, pass 1 = HTTPS-only stations.
  for (int strict = 0; strict < 2 && freshCount == 0; strict++) {

    for (int pass = 0; pass < 2; pass++) {

      for (JsonObject st : stations) {

        if (freshCount >= MAX_CANDIDATES) break;

        const char* name = st["name"] | "Unknown station";
        const char* codec = st["codec"] | "";
        const char* language = st["language"] | "";
        const char* resolvedURL = st["url_resolved"] | "";
        const char* originalURL = st["url"] | "";
        int bitrate = st["bitrate"] | 0;
        int hls = st["hls"] | 0;

        if (strcasecmp(codec, "MP3") != 0) continue;
        if (hls) continue;
        if (bitrate > 128) continue;

        bool langOK = (strict == 0)
          ? (strncasecmp(language, "malayalam", 9) == 0)
          : containsIgnoreCase(language, "malayalam");

        if (!langOK) continue;

        bool hasHttp = isHttpURL(resolvedURL) || isHttpURL(originalURL);
        const char* selectedURL = nullptr;

        if (pass == 0) {
          if (isHttpURL(resolvedURL)) selectedURL = resolvedURL;
          else if (isHttpURL(originalURL)) selectedURL = originalURL;
        }
        else if (!hasHttp) {
          if (isHttpsURL(resolvedURL)) selectedURL = resolvedURL;
          else if (isHttpsURL(originalURL)) selectedURL = originalURL;
        }

        if (selectedURL == nullptr) continue;
        if (strlen(selectedURL) >= sizeof(fresh[0].url)) continue;

        Candidate& c = fresh[freshCount++];

        strlcpy(c.name, name, sizeof(c.name));
        strlcpy(c.url, selectedURL, sizeof(c.url));
        c.bitrate = (uint16_t)bitrate;

        Serial.printf("[CANDIDATE %d] %s (%d kbps)%s\n",
                      freshCount, c.name, bitrate,
                      pass == 1 ? " [https]" : "");
      }
    }
  }

  if (freshCount == 0) {
    Serial.println("[ERROR] No compatible Malayalam MP3 station found.");
    return false;
  }

  memcpy(candidates, fresh, sizeof(Candidate) * freshCount);
  candidateCount = freshCount;
  listFetched = true;

  saveListCache();

  return true;
}

// Stop the current station and start the next one in the list.
// Downloads the list only if there is no usable list yet.
bool switchStation() {

  char failed[256];
  strlcpy(failed, activeURL, sizeof(failed));

  stopStream();

  if (!listFetched) fetchStations();

  if (candidateCount == 0) {
    radioState = RS_ERROR;
    return false;
  }

  int idx = findIndexByURL(failed);
  int start = (idx < 0) ? 0 : (idx + 1) % candidateCount;

  bool ok = playFrom(start, 1);

  if (!ok) listFetched = false;   // all failed: re-download next time

  return ok;
}

// Download a fresh list, then go back to the station that was playing.
void refreshAndPlay() {

  char keepURL[256];
  char keepName[80];
  strlcpy(keepURL, activeURL, sizeof(keepURL));
  strlcpy(keepName, stationName, sizeof(keepName));

  stopStream();

  fetchStations();   // on failure the old list is kept

  if (keepURL[0]) {
    Candidate c;
    strlcpy(c.name, keepName, sizeof(c.name));
    strlcpy(c.url, keepURL, sizeof(c.url));
    c.bitrate = 0;

    int idx = findIndexByURL(keepURL);
    if (idx >= 0) c = candidates[idx];

    if (startStream(c)) return;
  }

  playFrom(0, 1);
}

// First start: try the last good station immediately, if any.
void tryStart() {

  lastRetryMs = millis();
  needStart = false;

  if (!triedLast && lastURL[0]) {

    triedLast = true;

    Candidate c;
    strlcpy(c.name, lastName[0] ? lastName : "Last station", sizeof(c.name));
    strlcpy(c.url, lastURL, sizeof(c.url));
    c.bitrate = 0;

    if (startStream(c)) return;
  }

  switchStation();
}

// =====================================================
// 15. DIAGNOSTICS + AUTO FAILOVER
//     One short line per 10 s: a long print can block the
//     UART and starve the decoder.
// =====================================================

void diagnosticsAndFailover() {

  uint32_t now = millis();
  if (now - lastDiagMs < 10000) return;

  float seconds = (now - lastDiagMs) / 1000.0f;
  lastDiagMs = now;

  uint32_t bytes = totalBytes;
  uint32_t ur = underruns;
  uint32_t gap = maxGapMs;
  maxGapMs = 0;

  size_t fill = streamBuf ? xStreamBufferBytesAvailable(streamBuf) : 0;
  size_t fillPct = fill * 100 / activeBufferSize;

  Serial.printf(
    "[STATS] buf %u%% | net %.1f KB/s | gap %lu ms | underruns %lu | "
    "reconn %lu | decoded %u KB | heap %u | rssi %d | vol %.0f%%\n",
    (unsigned)fillPct,
    ((bytes - prevBytes) / 1024.0f) / seconds,
    (unsigned long)gap,
    (unsigned long)ur,
    (unsigned long)readerReconnects,
    source ? (unsigned)(source->getPos() / 1024) : 0u,
    (unsigned)ESP.getFreeHeap(),
    WiFi.RSSI(),
    currentVolume * 100.0f
  );

  // Remember a station once it has played cleanly for 20 s.
  if (!lastSaved && ur == 0 && now - playStartMs > 20000) {
    lastSaved = true;

    if (strcmp(lastURL, activeURL) != 0) {   // avoid needless flash writes
      prefs.putString("last", activeURL);
      prefs.putString("lastn", stationName);
      strlcpy(lastURL, activeURL, sizeof(lastURL));
      strlcpy(lastName, stationName, sizeof(lastName));
      Serial.println("[SAVE] Station remembered for next boot.");
    }
  }

  // Three bad 10-second windows in a row -> try another station.
  bool lowBuffer = fillPct < 20;

  if (ur > prevUnderruns || gap > 4000 || lowBuffer) badIntervals++;
  else badIntervals = 0;

  prevBytes = bytes;
  prevUnderruns = ur;
  currentNetKBps = ((bytes - prevBytes) / 1024.0f) / seconds;

  if (badIntervals >= 3) {
    Serial.println("[STREAM] Unstable station, switching...");
    badIntervals = 0;
    switchStation();
  }
}

// Buffer & Net helpers for Cloud Reporting
size_t getStreamBufferFill() {
  return streamBuf ? xStreamBufferBytesAvailable(streamBuf) : 0;
}

static float currentNetKBps = 0.0f;
float getNetKBps() {
  return currentNetKBps;
}

// =====================================================
// 16. DASHBOARD (web server) - Optional fallback
//     Handlers only read state or queue a command.
//     loop() executes queued commands.
// =====================================================

#if ENABLE_LOCAL_WEB
bool authorized() {

  if (DASH_PASS[0] == 0) return true;
  if (server.authenticate(DASH_USER, DASH_PASS)) return true;

  server.requestAuthentication();
  return false;
}

void sendOK() {
  server.send(200, "application/json", "{\"ok\":true}");
}

void sendError(const char* msg) {
  String out = String("{\"ok\":false,\"error\":\"") + msg + "\"}";
  server.send(400, "application/json", out);
}

void handleRoot() {
  if (!authorized()) return;
  server.sendHeader("Cache-Control", "no-cache");
  server.send_P(200, "text/html", DASHBOARD_HTML);
}

void handleStatus() {
  if (!authorized()) return;

  size_t fill = streamBuf ? xStreamBufferBytesAvailable(streamBuf) : 0;

  StaticJsonDocument<640> doc;
  doc["state"] = stateText();
  doc["station"] = stationName;
  doc["index"] = findActiveIndex();
  doc["count"] = candidateCount;
  doc["volume"] = (int)(currentVolume * 100.0f + 0.5f);
  doc["buffer"] = streamBuf ? (int)(fill * 100 / activeBufferSize) : 0;
  doc["underruns"] = (uint32_t)underruns;
  doc["rssi"] = WiFi.RSSI();
  doc["heap"] = ESP.getFreeHeap();
  doc["uptime"] = millis() / 1000;

  String out;
  serializeJson(doc, out);
  server.send(200, "application/json", out);
}

void handleStations() {
  if (!authorized()) return;

  DynamicJsonDocument doc(6144);
  JsonArray arr = doc.to<JsonArray>();

  for (int i = 0; i < candidateCount; i++) {
    JsonObject o = arr.createNestedObject();
    o["i"] = i;
    o["name"] = candidates[i].name;
    o["kbps"] = candidates[i].bitrate;
    o["https"] = isHttpsURL(candidates[i].url);
  }

  String out;
  serializeJson(doc, out);
  server.send(200, "application/json", out);
}

void handleVolume() {
  if (!authorized()) return;

  if (!server.hasArg("v")) return sendError("missing v");

  int v = constrain(server.arg("v").toInt(), 0, 100);
  setVolume(v / 100.0f);
  sendOK();
}

void handleNext() {
  if (!authorized()) return;
  pendingCmd = CMD_NEXT;
  sendOK();
}

void handlePrev() {
  if (!authorized()) return;
  pendingCmd = CMD_PREV;
  sendOK();
}

void handleSelect() {
  if (!authorized()) return;

  int i = server.hasArg("i") ? server.arg("i").toInt() : -1;

  if (i < 0 || i >= candidateCount) return sendError("bad index");

  pendingIndex = i;
  pendingCmd = CMD_SELECT;
  sendOK();
}

void handleRefresh() {
  if (!authorized()) return;
  pendingCmd = CMD_REFRESH;
  sendOK();
}

void handlePlayURL() {
  if (!authorized()) return;

  String u = server.arg("url");
  u.trim();

  if (!(u.startsWith("http://") || u.startsWith("https://"))) {
    return sendError("URL must start with http:// or https://");
  }

  if (u.length() >= sizeof(pendingURL)) return sendError("URL too long");

  strlcpy(pendingURL, u.c_str(), sizeof(pendingURL));
  pendingCmd = CMD_PLAY_URL;
  sendOK();
}

void startWebServer() {

  if (webStarted) return;
  webStarted = true;

  if (MDNS.begin(MDNS_NAME)) {
    MDNS.addService("http", "tcp", 80);
  }

  server.on("/", HTTP_GET, handleRoot);
  server.on("/api/status", HTTP_GET, handleStatus);
  server.on("/api/stations", HTTP_GET, handleStations);
  server.on("/api/volume", HTTP_POST, handleVolume);
  server.on("/api/next", HTTP_POST, handleNext);
  server.on("/api/prev", HTTP_POST, handlePrev);
  server.on("/api/station", HTTP_POST, handleSelect);
  server.on("/api/refresh", HTTP_POST, handleRefresh);
  server.on("/api/play", HTTP_POST, handlePlayURL);

  server.onNotFound([]() {
    server.send(404, "text/plain", "Not found");
  });

  server.begin();

  Serial.printf("[WEB] Dashboard: http://%s/  or  http://%s.local/\n",
                WiFi.localIP().toString().c_str(), MDNS_NAME);
}

// Runs one queued dashboard command (called from loop()).
void processCommand() {

  if (pendingCmd == CMD_NONE) return;

  Command cmd = pendingCmd;
  pendingCmd = CMD_NONE;

  switch (cmd) {

    case CMD_NEXT:
    case CMD_PREV: {
      if (candidateCount == 0) {
        refreshAndPlay();
        break;
      }
      int dir = (cmd == CMD_NEXT) ? 1 : -1;
      int cur = findActiveIndex();
      int start = (cur < 0)
        ? 0
        : (cur + dir + candidateCount) % candidateCount;
      playFrom(start, dir);
      break;
    }

    case CMD_SELECT:
      if (pendingIndex >= 0 && pendingIndex < candidateCount) {
        playFrom(pendingIndex, 1);
      }
      break;

    case CMD_REFRESH:
      refreshAndPlay();
      break;

    case CMD_PLAY_URL: {
      Candidate c;
      strlcpy(c.name, "Custom stream", sizeof(c.name));
      strlcpy(c.url, pendingURL, sizeof(c.url));
      c.bitrate = 0;
      startStream(c);
      break;
    }

    default:
      break;
  }

  // If the requested station failed, give the error a moment to show
  // before the automatic retry picks another one.
  lastRetryMs = millis();
}
#endif

// =====================================================
// CLOUD COMMAND DISPATCH & COALESCING
// =====================================================

void executeCloudCommand(const CloudCommand& cmd) {
  switch (cmd.type) {
    case CLOUD_CMD_PLAY: {
      if (strncmp(cmd.url, "http://", 7) != 0 && strncmp(cmd.url, "https://", 8) != 0) {
        reportCloudCommandResult(cmd.id, false, "URL must start with http:// or https://", millis() - cmd.receivedMs);
        return;
      }
      Candidate c;
      strlcpy(c.name, cmd.name[0] ? cmd.name : "Station", sizeof(c.name));
      strlcpy(c.url, cmd.url, sizeof(c.url));
      c.bitrate = cmd.kbps ? cmd.kbps : 128;

      bool ok = startStream(c);
      printHeapBudget("AFTER STREAM START");
      reportCloudCommandResult(cmd.id, ok, ok ? nullptr : "Pre-buffer failed", millis() - cmd.receivedMs);
      break;
    }

    case CLOUD_CMD_VOLUME: {
      setVolume(cmd.volume / 100.0f);
      reportCloudCommandResult(cmd.id, true, nullptr, millis() - cmd.receivedMs);
      break;
    }

    case CLOUD_CMD_STOP: {
      stopStream();
      reportCloudCommandResult(cmd.id, true, nullptr, millis() - cmd.receivedMs);
      break;
    }

    case CLOUD_CMD_RESUME: {
      if (lastURL[0]) {
        Candidate c;
        strlcpy(c.name, lastName[0] ? lastName : "Station", sizeof(c.name));
        strlcpy(c.url, lastURL, sizeof(c.url));
        c.bitrate = 128;
        bool ok = startStream(c);
        reportCloudCommandResult(cmd.id, ok, ok ? nullptr : "Resume failed", millis() - cmd.receivedMs);
      } else {
        reportCloudCommandResult(cmd.id, false, "No station to resume", millis() - cmd.receivedMs);
      }
      break;
    }

    case CLOUD_CMD_SLEEP: {
      extern uint32_t sleepUntilMs;
      if (cmd.sleepMinutes == 0) {
        sleepUntilMs = 0;
        Serial.println("[SLEEP] Cancelled.");
      } else {
        sleepUntilMs = millis() + (cmd.sleepMinutes * 60000UL);
        Serial.printf("[SLEEP] Timer set for %u minutes.\n", cmd.sleepMinutes);
      }
      reportCloudCommandResult(cmd.id, true, nullptr, millis() - cmd.receivedMs);
      break;
    }

    case CLOUD_CMD_REBOOT: {
      reportCloudCommandResult(cmd.id, true, nullptr, millis() - cmd.receivedMs);
      triggerCloudStatePublish();
      delay(300);
      ESP.restart();
      break;
    }

    case CLOUD_CMD_PING: {
      reportCloudCommandResult(cmd.id, true, nullptr, millis() - cmd.receivedMs);
      break;
    }

    default:
      break;
  }
}

void processCloudCommand() {
  if (xCloudCmdQueue == nullptr) return;

  CloudCommand cmd;
  CloudCommand playCmd;
  bool hasPlay = false;

  // Drain the queue, coalescing rapid play commands
  while (xQueueReceive(xCloudCmdQueue, &cmd, 0) == pdTRUE) {
    if (cmd.type == CLOUD_CMD_PLAY) {
      playCmd = cmd;
      hasPlay = true;
    } else {
      executeCloudCommand(cmd);
    }
  }

  if (hasPlay) {
    executeCloudCommand(playCmd);
  }
}

// =====================================================
// 17. SETUP / LOOP
// =====================================================

void setup() {

  // Larger TX buffer so Serial.printf never stalls audio.
  Serial.setTxBufferSize(1024);
  Serial.begin(115200);
  delay(500);

  Serial.println("\n====================================");
  Serial.println("       AMAL ESP32 INTERNET RADIO");
  Serial.println("====================================");
  Serial.printf("[SYSTEM] Reset reason: %s\n",
                resetReasonText(esp_reset_reason()));

  setCpuFrequencyMhz(240);

  Serial.printf("[SYSTEM] Chip: %s, CPU: %d MHz, free heap: %u\n",
                ESP.getChipModel(), ESP.getCpuFreqMHz(),
                (unsigned)ESP.getFreeHeap());

  prefs.begin("radio", false);

  currentVolume = constrain(
    prefs.getFloat("vol", 0.15f), VOLUME_MIN, VOLUME_MAX
  );

  String savedURL = prefs.getString("last", "");
  strlcpy(lastURL, savedURL.c_str(), sizeof(lastURL));

  String savedName = prefs.getString("lastn", "");
  strlcpy(lastName, savedName.c_str(), sizeof(lastName));

  loadListCache();

  Serial.printf("[SYSTEM] Saved volume: %.0f%%\n", currentVolume * 100.0f);
  Serial.printf("[SYSTEM] Saved station: %s\n",
                lastURL[0] ? lastURL : "(none)");
  Serial.printf("[SYSTEM] Cached stations: %d\n", candidateCount);

  pinMode(VOL_UP_PIN, INPUT_PULLUP);
  pinMode(VOL_DOWN_PIN, INPUT_PULLUP);

  pinMode(WIFI_LED_PIN, OUTPUT);
  digitalWrite(WIFI_LED_PIN, LOW);

  Serial.println("[BUTTONS] Volume rocker initialized.");

  startWiFi();   // non-blocking: loop() starts the radio once Wi-Fi is up
  printHeapBudget("BOOT");
}

void loop() {

  updateWiFiLED();
  handleVolumeButtons();
  saveVolumeIfNeeded();
  serviceWiFi();
#if ENABLE_LOCAL_WEB
  serviceWeb();
  processCommand();
#endif
  serviceCloud();
  processCloudCommand();

  if (streamRunning) {

    serviceAudio();

    bool rebufferTimeout =
      rebuffering && (millis() - rebufferStartMs > 20000);

    if (decoderStopped || readerFailed || rebufferTimeout) {
      Serial.println("[STREAM] Stream failed, switching station...");
      switchStation();
      return;
    }

    diagnosticsAndFailover();

    delay(rebuffering ? 10 : 1);
    return;
  }

  // Nothing playing: start (or retry) when Wi-Fi is available.
  if (WiFi.status() == WL_CONNECTED &&
      (needStart || millis() - lastRetryMs > 10000)) {
    tryStart();
  }

  delay(5);
}