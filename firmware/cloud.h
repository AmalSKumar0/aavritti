#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include "esp_system.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "mqtt_client.h"

// Set to 1 to use TLS (port 8883) with esp_crt_bundle_attach
// Set to 0 if fallback to plaintext port 1883 with signed commands is needed
#ifndef MQTT_TLS
#define MQTT_TLS 1
#endif

enum CloudCmdType : uint8_t {
  CLOUD_CMD_NONE = 0,
  CLOUD_CMD_PLAY,
  CLOUD_CMD_VOLUME,
  CLOUD_CMD_STOP,
  CLOUD_CMD_RESUME,
  CLOUD_CMD_SLEEP,
  CLOUD_CMD_REBOOT,
  CLOUD_CMD_PING
};

struct CloudCommand {
  char id[36];
  CloudCmdType type;
  char url[256];
  char name[80];
  uint16_t kbps;
  uint8_t volume;        // 0..100
  uint16_t sleepMinutes; // 0 cancels
  uint32_t receivedMs;
};

// Queue for commands parsed in the MQTT task and consumed by loop()
extern QueueHandle_t xCloudCmdQueue;

// Initialization and services
void initCloud();
void serviceCloud();
bool isCloudConnected();

// State & reporting
void triggerCloudStatePublish();
void reportCloudCommandResult(const char* id, bool success, const char* error, uint32_t durationMs);
void printHeapBudget(const char* stage);
