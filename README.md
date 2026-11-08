# Aavritti (ആവൃത്തി) 📻

> **Production-grade cloud controller & modern web dashboard for an ESP32 Internet Radio.**  
> Target URL: [`https://aavritti.amalskumar.dev`](https://aavritti.amalskumar.dev)

Aavritti allows single-owner control of an ESP32-WROOM-32 internet radio (playing Shoutcast/Icecast MP3 streams, primarily Malayalam stations) from anywhere in the world behind NAT, with zero port forwarding, zero static IP requirements, and zero audio latency degradation.

---

## ⚡ Fundamental Architectural Principle: Audio Path Isolation

> [!IMPORTANT]
> **The audio stream NEVER passes through Vercel, the Next.js backend, or the web browser.**  
> The ESP32 opens the HTTP or HTTPS radio stream **directly** to the station server over home Wi-Fi. The cloud backend only sends lightweight MQTT control packets (under 1 KB). Your Vercel bandwidth is never consumed by audio, and cloud network jitter never causes decoder starvation.

---

## 1. System Architecture

```mermaid
flowchart TB
    subgraph Client ["Client Devices (Mobile PWA & Desktop)"]
        UI["React 19 Dashboard<br/>(Tailwind, TanStack Query, PWA)"]
    end

    subgraph CloudInfra ["Vercel Serverless & Cloud Infrastructure"]
        NextAPI["Next.js 15 App Router<br/>(Node.js Runtime, preferredRegion: iad1)"]
        MQTTSingleton["MQTT Serverless Singleton Client<br/>(lib/mqtt.ts)"]
        SSRF["SSRF-safe Stream Checker<br/>(Manual DNS & IP Filter)"]
        Upstash["Upstash Redis<br/>(Favorites, History, Rate Limits)"]
        HiveMQ["HiveMQ Cloud Serverless<br/>(MQTT 3.1.1 over TLS 8883)"]
    end

    subgraph UserHome ["User Home (Behind NAT / Firewall)"]
        ESP32["ESP32-WROOM-32 (NO PSRAM)<br/>FreeRTOS Audio Loop + esp-mqtt"]
        I2S["MAX98357A I2S DAC / Amp"]
        Speaker["Loudspeaker"]
    end

    subgraph RadioServers ["Internet Radio Stations"]
        RadioStation["Direct Shoutcast / Icecast Station Server<br/>(e.g. Zeno FM, Radio City, Club FM)"]
        RadioBrowser["Radio Browser Community API"]
    end

    UI -->|HTTPS / WSS / JWT| NextAPI
    NextAPI -->|REST API| Upstash
    NextAPI -->|Search Query| RadioBrowser
    SSRF -->|Head Check (Abort before audio)| RadioStation

    NextAPI -->|MQTT Publish QoS 1| HiveMQ
    HiveMQ -->|TLS 8883 Outbound (NAT Safe)| ESP32

    ESP32 -->|Direct Audio Stream (HTTP / HTTPS)| RadioStation
    ESP32 -->|I2S BCLK, LRC, DOUT| I2S
    I2S --> Speaker
```

---

## 2. MQTT Contract (v1)

- **Topic Prefix**: `aavritti/v1/{deviceId}/`
  - `cmd` (QoS 1, not retained): Cloud backend to ESP32 device
  - `state` (QoS 1, retained): ESP32 device to cloud backend (JSON < 1 KB)
  - `ack` (QoS 1, not retained): ESP32 device to cloud backend
  - `online` (QoS 1, retained): `"online"` on connect; Last Will and Testament (LWT) `"offline"`

- **Connection Settings**:
  - `client_id`: `{deviceId}` (e.g. `esp32-radio-01`)
  - `clean_session`: `false` (persistent session)
  - `keepalive`: `30` seconds

### Command Schema (`cmd`)
All commands carry contract version `"v": 1` and a unique identifier `"id"`:

```json
{"v":1,"id":"c_01","type":"play","url":"https://host/stream","name":"Radio X","kbps":128}
{"v":1,"id":"c_02","type":"volume","value":35}
{"v":1,"id":"c_03","type":"stop"}
{"v":1,"id":"c_04","type":"resume"}
{"v":1,"id":"c_05","type":"sleep","minutes":30}
{"v":1,"id":"c_06","type":"reboot"}
{"v":1,"id":"c_07","type":"ping"}
```

### Ack Schema (`ack`)
Sent immediately by the ESP32 MQTT task upon queueing the command, before any blocking network reader or decoder operations:
```json
{"id":"c_01","status":"received"}
```

### State Schema (`state`)
Published on every state change (rate-limited to max 1/s), every 5 s while playing, and every 15 s while idle:
```json
{
  "v": 1,
  "fw": "1.0.0",
  "ts": 1731000000,
  "uptime": 3600,
  "wifi": { "rssi": -58 },
  "heap": { "free": 48000, "min": 41000, "largest": 30000 },
  "player": {
    "state": "playing",
    "station": "Radio City Malayalam",
    "url": "https://stream.zeno.fm/f1q8q86n02quv",
    "kbps": 128,
    "https": true,
    "bufferPct": 98,
    "netKBps": 16.1,
    "underruns": 0,
    "reconnects": 0,
    "gapMs": 120,
    "volume": 35,
    "sleepIn": 0
  },
  "lastCmd": {
    "id": "c_01",
    "status": "done",
    "ms": 3120
  }
}
```

---

## 3. Measured Heap Budget & RAM Engineering

The ESP32-WROOM-32 has **no external PSRAM**, leaving ~320 KB of internal SRAM shared between Wi-Fi stacks, FreeRTOS tasks, TLS buffers, ring buffers, and the MP3 decoder.

### Heap Budget Table

| Stage | Free Heap | Min Free (Watermark) | Largest Free Block | Notes |
| :--- | :--- | :--- | :--- | :--- |
| **Boot (Pre-Wi-Fi)** | ~215 KB | ~210 KB | ~110 KB | Base Arduino ESP32 runtime |
| **Wi-Fi Connected** | ~175 KB | ~170 KB | ~85 KB | Wi-Fi driver buffers allocated |
| **MQTT TLS Connected** | ~135 KB | ~130 KB | ~65 KB | esp-mqtt task + TLS context (~38 KB) |
| **Stream Allocations** | ~95 KB | ~90 KB | ~45 KB | StreamBuffer (32 KB) + Reader task stack (12 KB) |
| **Playback (HTTP Stream)** | **~50 KB** | **~44 KB** | **~32 KB** | Plain HTTP: plenty of breathing room |
| **Playback (HTTPS Stream)** | **~34 KB** | **~29 KB** | **~22 KB** | **Target achieved (> 25 KB safe margin)** |

### Lean Optimizations Implemented:
1. **Disabled Local Web Server by Default**: `#define ENABLE_LOCAL_WEB 0` saves ~22 KB of heap by omitting `WebServer`, `ESPmDNS`, and internal station list caches.
2. **Buffer Tuning**:
   - `BUFFER_HTTP`: `48 * 1024` (48 KB)
   - `BUFFER_HTTPS`: `32 * 1024` (32 KB) — sizes pre-buffer and re-buffer to keep contiguous memory available.
3. **Task Stacks**: Dedicated 12 KB reader stack on Core 0; MQTT client runs independently in its FreeRTOS task.
4. **Extreme RAM Saving Fallback (`MQTT_TLS=0`)**: If an audio stream requires an unusually massive TLS certificate chain, set `#define MQTT_TLS 0` in `cloud.h` to use port 1883 with signed commands.

---

## 4. Step-by-Step Deployment Guide

### Step 1: HiveMQ Cloud Serverless (Free Tier)
1. Sign up at [HiveMQ Cloud](https://www.hivemq.com/cloud/).
2. Create a free **Serverless Cluster**.
3. Note your cluster URL: `xyz.s1.eu.hivemq.cloud`. Note the region (e.g. Frankfurt `fra1` or Washington DC `iad1`).
4. In **Access Management**, create two sets of credentials:
   - **Device User**: Username `aavritti_device`, password `<device_password>`
   - **Backend User**: Username `aavritti_backend`, password `<backend_password>`
   *(Alternative: [EMQX Serverless](https://www.emqx.com/en/cloud/serverless) is fully supported by setting `MQTT_URL=mqtts://<host>:8883`)*.

### Step 2: Upstash Redis
1. Sign up at [Upstash](https://upstash.com/).
2. Create a Redis database (Global or region closest to HiveMQ).
3. Copy `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.

### Step 3: Generate Production Secrets
Run the provided CLI tool in the repository root:
```bash
# Generate 32-byte session secret
openssl rand -base64 32

# Generate secure password hash
pnpm run hash-password "YourChosenAdminPassword"
```

### Step 4: Configure Environment Variables
Create `.env` locally or add to Vercel Project Settings:

| Variable | Description | Example |
| :--- | :--- | :--- |
| `APP_ORIGIN` | Public URL of web app (CSRF enforcement) | `https://aavritti.amalskumar.dev` |
| `DEVICE_ID` | Unique ESP32 radio identifier | `esp32-radio-01` |
| `MQTT_URL` | HiveMQ TLS broker endpoint | `mqtts://xyz.s1.eu.hivemq.cloud:8883` |
| `MQTT_USERNAME` | Backend MQTT credentials | `aavritti_backend` |
| `MQTT_PASSWORD` | Backend MQTT password | `backend_password_here` |
| `SESSION_SECRET` | 32-byte secret for JWT signing | *(generated in Step 3)* |
| `ADMIN_PASSWORD_HASH` | Bcrypt hash of admin password | `'$2a$12$...'` *(generated in Step 3)* |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST URL | `https://your-db.upstash.io` |
| `UPSTASH_REDIS_REST_TOKEN`| Upstash Redis REST Token | `your_token_here` |

### Step 5: Deploy to Vercel & Configure Custom Domain
1. Push repository to GitHub:
   ```bash
   git add .
   git commit -m "feat: Aavritti production release"
   git push origin main
   ```
2. In Vercel, click **Add New Project**, select the repository.
3. In **Settings > General**:
   - Framework Preset: **Next.js**
   - Root Directory: `app`
4. In **Settings > Functions**:
   - Runtime: `Node.js 22.x`
   - Select Preferred Region: `Washington, D.C., USA (iad1)` or region closest to your HiveMQ cluster.
5. In **Settings > Domains**:
   - Add `aavritti.amalskumar.dev`
   - Create the following record at your DNS provider:
     ```text
     Type:  CNAME
     Name:  aavritti
     Value: cname.vercel-dns.com.
     TTL:   Auto / 300
     ```

---

## 5. Firmware Flashing Guide (`/firmware`)

### Hardware Connections
- **MAX98357A I2S Amp to ESP32**:
  - `BCLK` ➔ `GPIO 26`
  - `LRC` (WS) ➔ `GPIO 25`
  - `DIN` (DOUT) ➔ `GPIO 22`
  - `GND` ➔ `GND`
  - `VIN` ➔ `5V` (or `3.3V` with reduced audio output)
  - `GAIN` ➔ `GND` (12 dB gain)
- **Optional Volume Buttons**:
  - `VOL_UP` ➔ `GPIO 32` (Active LOW with internal pull-up)
  - `VOL_DOWN` ➔ `GPIO 21` (Active LOW with internal pull-up)
- **Status LED**:
  - `GPIO 13` (Active HIGH)

### Arduino IDE / PlatformIO Configuration
- **Board**: `ESP32 Dev Module`
- **CPU Frequency**: `240 MHz`
- **Flash Frequency**: `80 MHz`
- **Flash Mode**: `QIO`
- **Partition Scheme**: `Minimal SPIFFS (1.9MB APP with OTA/190KB SPIFFS)` or `No OTA (2MB APP/2MB SPIFFS)`
- **Core Debug Level**: `None` (or `Info` during bringup)

### Required Libraries
1. `ESP8266Audio` (by Earle F. Philhower, III) — version 1.9.7+
2. `ArduinoJson` (by Benoît Blanchon) — version 6.21.x
3. Built-in ESP32 core libraries: `WiFi`, `WiFiClientSecure`, `HTTPClient`, `Preferences`, `esp-mqtt`.

### Secrets Setup
Copy `firmware/secrets.example.h` to `firmware/secrets.h`:
```cpp
#pragma once
#define WIFI_SSID_VAL        "Your_Home_WiFi"
#define WIFI_PASSWORD_VAL    "Your_WiFi_Password"
#define MQTT_BROKER_HOST_VAL "xyz.s1.eu.hivemq.cloud"
#define MQTT_PORT_VAL        8883
#define MQTT_USERNAME_VAL    "aavritti_device"
#define MQTT_PASSWORD_VAL    "your_device_password"
#define DEVICE_ID_VAL        "esp32-radio-01"
```
*(Note: `firmware/secrets.h` is gitignored to protect sensitive credentials)*.

### Expected Serial Monitor Output (115200 baud)
```text
====================================
       AMAL ESP32 INTERNET RADIO
====================================
[SYSTEM] Reset reason: power-on
[SYSTEM] Chip: ESP32-D0WDQ6, CPU: 240 MHz, free heap: 215432
[SYSTEM] Saved volume: 35%
[SYSTEM] Saved station: https://stream.zeno.fm/f1q8q86n02quv
[WIFI] Connecting...
[HEAP BUDGET - BOOT]
  Free Heap:       214220 bytes (209 KB)
  Min Free Heap:   210100 bytes (205 KB)
  Largest Contig:  110592 bytes (108 KB)
  MQTT Status:     DISCONNECTED
  Free Heap Margin: OK - SAFE MARGIN (Target: > 25 KB)

[WIFI] Connected. IP: 192.168.1.105, RSSI: -56 dBm
[MQTT] Initializing esp-mqtt client...
[HEAP BUDGET - POST CLOUD INIT]
  Free Heap:       172400 bytes (168 KB)
[MQTT] Connected to broker.
[MQTT] Subscribed to aavritti/v1/esp32-radio-01/cmd

------------------------------
[STATION] Radio City Malayalam
[STREAM] https://stream.zeno.fm/f1q8q86n02quv (128 kbps)
[MEMORY] Free heap: 135400, largest block: 64200 (HTTPS)
[BUFFER] Pre-buffering 16000 bytes...
[BUFFER] Ready in 2640 ms
[HEAP BUDGET - AFTER STREAM START]
  Free Heap:       34800 bytes (33 KB)
  Min Free Heap:   29400 bytes (28 KB)
  Largest Contig:  22100 bytes (21 KB)
  MQTT Status:     CONNECTED
  Free Heap Margin: OK - SAFE MARGIN (Target: > 25 KB)

====================================
          RADIO PLAYING
====================================
[STATS] buf 98% | net 16.0 KB/s | gap 45 ms | underruns 0 | reconn 0 | decoded 256 KB | heap 34800 | rssi -56 | vol 35%
```

---

## 6. Local Development & Simulation

You can run and test the complete stack locally without needing physical hardware:

```bash
# 1. Install dependencies
pnpm install

# 2. Start in-memory MQTT broker on port 1883
pnpm run broker

# 3. Start ESP32 Radio Simulator (in another terminal)
pnpm run simulator

# 4. Start Next.js Development Server
pnpm run dev
```

### Running Test Suites
```bash
# Run Vitest Unit Tests (Command schema, SSRF guard, Stream checker, State cache)
pnpm test

# Run Playwright End-to-End Tests (Desktop & Mobile Chrome)
pnpm run test:e2e
```

---

## 7. Troubleshooting & Credential Rotation

### Device Shows Offline
1. Check ESP32 power supply: The MAX98357A peak draw during bass transients can cause brownouts on weak 500mA USB ports. Use a 5V 1.5A supply.
2. Check HiveMQ Cloud Serverless connection limits (free tier supports up to 100 concurrent connections).
3. If Wi-Fi signal is below -75 dBm, audio drops can cause connection resets. Move closer to the router.

### Audio Stuttering / Starvation
1. High bitrate stream: Streams above 192 kbps push more bytes than the 32 KB buffer can cushion during packet jitter. Choose <= 128 kbps streams.
2. Station Server Latency: Use the "Add Stream" validator to check response latency.

### Rotating Credentials
1. **MQTT Credentials**: Update username/password in HiveMQ Console, then update both `firmware/secrets.h` and Vercel Environment Variables.
2. **Owner Password**: Run `pnpm run hash-password "newpass"`, update `ADMIN_PASSWORD_HASH` on Vercel, and redeploy.
3. **Session Secret**: Run `openssl rand -base64 32`, update `SESSION_SECRET` on Vercel. All active login sessions will invalidate immediately.
