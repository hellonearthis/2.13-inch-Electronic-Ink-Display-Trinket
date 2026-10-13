# E-Ink Electronic Shelf Label (ESL) Reverse Engineering & Protocol Specification

> **Target Package:** `lanqianzhushou_1.2.8.apk` (蓝签助手 / *Lanqian Zhushou* - Blue Tag Assistant)  
> **Android Package ID:** `com.zghd.pinntag`  
> **Target Version:** 1.2.8 (Build 28, Android SDK 32 / Target SDK 28)  
> **Hardware Category:** BLE-driven Electronic Paper Displays (EPD) / Electronic Shelf Labels (ESL)

---

## 1. System Architecture Overview

The application utilizes a hybrid dual-tier architecture:
1. **Frontend / Canvas UI (DCloud uni-app v3):**
   - Built on Vue.js and the Weex mobile runtime.
   - Handles the visual template library (`pages/index/index`), WYSIWYG tag canvas editing (`pages/index/edit`), QR/barcode tag scanning, and device pairing (`pages/index/blue`).
2. **Native Android Communication Layer (`io.dcloud.uniplugin.TestModule`):**
   - Registered as `TestModule` via `dcloud_uniplugins.json`.
   - Bridges JS canvas base64 exports to Android Bluetooth Low Energy (`BleManager` / FastBle).
   - Performs color quantization, Floyd-Steinberg dithering, packet serialization, and GATT writes.

```
┌────────────────────────────────────────────────────────┐
│             uni-app Webview / Weex Canvas              │
│       (Canvas Editor -> Base64 Image Generation)       │
└───────────────────────────┬────────────────────────────┘
                            │ uni.requireNativePlugin("TestModule")
                            ▼
┌────────────────────────────────────────────────────────┐
│           Android Native TestModule.java               │
│     (EPaperPicture Dithering -> EpdDevParamFactory)    │
└───────────────────────────┬────────────────────────────┘
                            │ FastBle (MTU Negotiation 512, 50-90ms Pacing)
                            ▼
┌────────────────────────────────────────────────────────┐
│             E-Ink Tag Controller (Over BLE)            │
│   (Black Layer 0x13 -> Red Layer 0x12 -> Refresh 0x50) │
└────────────────────────────────────────────────────────┘
```

---

## 2. Hardware Display Models & Dimensions

The tag driver supports 6 hardware configurations defined in `EpdDevParamFactory`. The primary default hardware profile is **`EPD_250_X_128`** ($250 \times 128$):

| Model Identifier | Pixel Resolution | Diagonal Size | Color Modes Supported | Driver Handling | Default / Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`EPD_250_X_128`** | $250 \times 128$ (124 active) | 2.13 inch | Black/White, Tri-Color (Red) | 1-byte sequence counter | **Primary Hardware Default** |
| **`EPD_250_X_122`** | $250 \times 122$ | 2.13 inch | Black/White, Tri-Color (Red) | 1-byte sequence counter | Legacy small 2.13" panel |
| **`EPD_296_X_128`** | $296 \times 128$ | 2.9 inch | Black/White, Tri-Color (Red) | 1-byte sequence counter | Supported |
| **`EPD_416_X_240`** | $416 \times 240$ | 3.7 inch | Black/White, Tri-Color (Red) | 2-byte sequence counter | Supported |
| **`EPD_400_X_300`** | $400 \times 300$ | 4.2 inch | Black/White, Tri-Color (Red) | Rotated 90° clockwise, 2-byte sequence | Supported |
| **`EPD_800_X_480`** | $800 \times 480$ | 7.5 inch | Black/White, Tri-Color (Red) | Rotated 90° clockwise, 2-byte sequence | Supported |

---

## 3. Bluetooth Low Energy (BLE) Specification

### Device Advertising & Discovery
* **Device Name Prefix:** Advertising packets start with **`EDP`** (*Electronic Display Paper*).
* **MAC Address Pairing:** Users can scan barcodes containing the tag's MAC address directly on the shelf tag.

### GATT Services & Characteristics

#### Primary EPD Control Service
* **Service UUID:** `0000ffe0-0000-1000-8000-00805f9b34fb` (`0xFFE0`)
* **Characteristic 1 (Read / Notify):** `0000ffe1-0000-1000-8000-00805f9b34fb` (`0xFFE1`)
  - Used for receiving battery notifications on legacy hardware tags.
* **Characteristic 2 (Write):** `0000ffe2-0000-1000-8000-00805f9b34fb` (`0xFFE2`)
  - Primary write endpoint for all command payloads and bitmap chunks.

#### Standard Battery Service
* **Service UUID:** `0000180f-0000-1000-8000-00805f9b34fb` (`0x180F`)
* **Battery Level Characteristic:** `00002a19-0000-1000-8000-00805f9b34fb` (`0x2A19`)

#### Device Generation Classification (`isNewDevice`)
* **New Hardware Generation:** If GATT service `0x180F` exists during service discovery:
  - MTU is negotiated to 512 bytes.
  - Inter-packet write pacing is reduced to **50 ms**.
  - Battery percentage is read directly from standard characteristic `0x2A19`.
* **Legacy Generation:** If `0x180F` is absent:
  - Inter-packet write pacing is set to **90 ms**.
  - Subscribes to notification on `0xFFE1`.
  - Sends legacy command `[0x60, 0x00, 0x01, 0x00, 0x61]` to query battery; tag replies with notification starting with `0x60 0x00 0x01` where byte 3 contains battery percentage.

---

## 4. Transmission Protocol & Wire Framing

### Control Command Set

| Command Name | Byte Sequence | Purpose |
| :--- | :--- | :--- |
| **Start Black Plane** | `13 00 00 00 00` | Tells EPD controller to allocate buffer for Black/White pixels |
| **Finish Black Plane** | `13 FF FF FF FF` | Closes Black/White transmission buffer |
| **Start Red Plane** | `12 00 00 00 00` | Tells EPD controller to allocate buffer for Red/Yellow pixels |
| **Finish Red Plane** | `12 FF FF FF FF` | Closes Red/Yellow transmission buffer |
| **Display Refresh** | `50 00 01 01` | Triggers physical electrophoretic ink refresh on the panel |
| **Get Battery (Legacy)**| `60 00 01 00 61` | Requests battery level over legacy characteristic |

### Image Data Packet Framing

Image data is packed at 1 bit per pixel (8 pixels per byte).

#### Format A: Small Displays (< 400px width: 250x122, 250x128, 296x128)
```
┌───────────┬──────────────┬──────────────┬────────────────────────────┬───────────┐
│ Layer ID  │ Seq (1 byte) │ Length (1 B) │ Data Payload (16-180 B)    │ Checksum  │
│ 0x13/0x12 │   1 .. 255   │    Length    │ 1-bit bitpacked pixels     │ 1 byte    │
└───────────┴──────────────┴──────────────┴────────────────────────────┴───────────┘
```

#### Format B: Large Displays ($\ge 400\text{px}$ width: 400x300, 416x240, 800x480)
```
┌───────────┬──────────────┬──────────────┬──────────────┬────────────────────────────┬───────────┐
│ Layer ID  │ Seq Hi (1 B) │ Seq Lo (1 B) │ Length (1 B) │ Data Payload (16-180 B)    │ Checksum  │
│ 0x13/0x12 │  Seq >> 8    │  Seq & 0xFF  │    Length    │ 1-bit bitpacked pixels     │ 1 byte    │
└───────────┴──────────────┴──────────────┴──────────────┴────────────────────────────┴───────────┘
```

#### Checksum Algorithm
$$\text{Checksum} = \left( \sum_{k=0}^{N-1} \text{Payload}[k] \right) \pmod{256}$$

### Complete Session Transmission Sequence
1. Connect to BLE device `EDP_*`.
2. Discover services; determine if `isNewDevice` (check `0x180F`).
3. Request MTU update to 512.
4. Read battery level (GATT `0x2A19` or legacy command `0x60 0x00 0x01 0x00 0x61`).
5. Transmit `startBlackSend`: `[0x13, 0x00, 0x00, 0x00, 0x00]`. Sleep 50-90 ms.
6. Transmit all Black/White data packets with incremental sequence counter. Sleep 50-90 ms per packet.
7. Transmit `finishBlackSend`: `[0x13, 0xFF, 0xFF, 0xFF, 0xFF]`. Sleep 50-90 ms.
8. If panel supports 3-color (Red/Yellow):
   - Transmit `startRedSend`: `[0x12, 0x00, 0x00, 0x00, 0x00]`. Sleep 50-90 ms.
   - Transmit all Red/Yellow data packets. Sleep 50-90 ms per packet.
   - Transmit `finishRedSend`: `[0x12, 0xFF, 0xFF, 0xFF, 0xFF]`. Sleep 50-90 ms.
9. Transmit `updateSend`: `[0x50, 0x00, 0x01, 0x01]`.
10. Wait 2,000 ms for panel physical latching, then disconnect GATT.

---

## 5. Image Quantization & Tri-Color Dithering Engine

The system implements 3-color Floyd-Steinberg error diffusion matching `lanqianzhushou_1.2.8.apk` (`EPaperPicture.java` palette 6: White, Black, Red):

### Palette Definition
* **White:** `RGB(255, 255, 255)`
* **Black:** `RGB(0, 0, 0)`
* **Red:** `RGB(255, 0, 0)` (or hardware accent color)

### Dithering Kernel
When quantizing pixel $(x, y)$ against the selected palette via Euclidean distance minimization, the color quantization error $(e_R, e_G, e_B)$ is diffused to neighboring pixels:
* $(x+1, y) \mathrel{+}= e \times \frac{7}{16}$
* $(x-1, y+1) \mathrel{+}= e \times \frac{3}{16}$
* $(x, y+1) \mathrel{+}= e \times \frac{5}{16}$
* $(x+1, y+1) \mathrel{+}= e \times \frac{1}{16}$

### Dual-Plane Bit Allocation
E-paper controllers (e.g. SSD1680, UC8151D) utilize two separate physical SRAM bitplanes:
1. **Black/White Plane (`0x13`):**
   - Active black ink particle: **Bit `0`**
   - Non-black (White or Red): **Bit `1`** (inactive on B/W plane)
2. **Red Chromatic Plane (`0x12`):**
   - Active red ink particle: **Bit `1`**
   - Non-red (White or Black): **Bit `0`** (inactive on Red plane)

When a pixel is quantized to **Red**:
- On plane `0x13` it is set to `1` (does not attract black particles).
- On plane `0x12` it is set to `1` (attracts red particles).

---

## 6. Progressive Web Application (PWA) Features

The web flasher ([webapp/index.html](file:///i:/rea/e-ink/webapp/index.html)) provides a zero-dependency, client-side flasher running over Web Bluetooth:

* **Triple Display Surface Previews:**
  - **Composite Preview:** Renders the combined simulated tri-color e-paper output (White, Black, Red).
  - **Black Layer (`0x13`):** Visualizes solely the black plane. Non-black pixels render as transparent over an e-paper chassis checkerboard.
  - **Red Layer (`0x12`):** Visualizes solely the red plane. Non-red pixels render as transparent over an e-paper chassis checkerboard.
* **Live Pixel Telemetry Stats:**
  - Displays instant pixel count and percentage distribution: White count, Black count, and Red count.
  - Alerts users immediately if an uploaded graphic contains 0 red pixels when red mode is enabled.
* **Non-Destructive Image Caching:**
  - Preserves master uncompressed image pixels in an offscreen buffer (`rawSourceCanvasElement`), allowing users to toggle between Black & White and Tri-Color dithering without re-uploading the source image.
* **Diagnostics & Raw Hex Console:**
  - Expandable direct GATT transmission interface targeting `0xFFE2` with quick-fill command tooltips (`Get Battery`, `Start Black`, `Finish Black`, `Start Red`, `Finish Red`, `Screen Refresh`).
  - Battery telemetry polling supporting both standard SIG Battery Service (`0x180F` / `0x2A19`) and legacy notifications (`0xFFE1`).
* **Offline-First PWA:**
  - Service Worker (`sw.js`) and Web App Manifest (`manifest.json`) support full offline field deployment.

---

## 7. Deliverables & Documentation Index

- **Security Audit & Threat Model:** [SECURITY_AUDIT.md](file:///i:/rea/e-ink/SECURITY_AUDIT.md) — Comprehensive assessment of BLE transport vulnerabilities, Android over-privilege, and architecture flow diagrams.
- **Web App Architectural Plan:** [WEB_APP_PLAN.md](file:///i:/rea/e-ink/WEB_APP_PLAN.md) — Design, pros/cons, and security remediation strategy.
- **Web Bluetooth Application (PWA):** [webapp/index.html](file:///i:/rea/e-ink/webapp/index.html) — Zero-dependency, offline-capable Web Bluetooth flasher with real-time Floyd-Steinberg dithering and hardware profile support.
- **BLE Command Catalog & Specification:** [BLE_COMMANDS_REFERENCE.md](file:///i:/rea/e-ink/BLE_COMMANDS_REFERENCE.md) — Exhaustive opcode reference, byte frames, notifications, and timing requirements.
