#pragma once

// =====================================================
// Aavritti ESP32 Internet Radio - Secrets Template
// Rename this file to secrets.h and fill in your values.
// secrets.h is gitignored to protect sensitive credentials.
// =====================================================

// Wi-Fi Credentials
#define WIFI_SSID_VAL     "Your_WiFi_SSID"
#define WIFI_PASSWORD_VAL "Your_WiFi_Password"

// MQTT Broker Credentials (HiveMQ Cloud Serverless / EMQX)
// Note: Hostname without "mqtts://" or "mqtt://" prefix, just FQDN
#define MQTT_BROKER_HOST_VAL "your-cluster-id.s1.eu.hivemq.cloud"
#define MQTT_PORT_VAL        8883
#define MQTT_USERNAME_VAL    "aavritti_device"
#define MQTT_PASSWORD_VAL    "your_device_mqtt_password"

// Unique Device ID (must match DEVICE_ID in backend env)
#define DEVICE_ID_VAL        "esp32-radio-01"
