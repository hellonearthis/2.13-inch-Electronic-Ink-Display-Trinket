# E-Ink ESL Web Bluetooth Flasher

> **Open-source, zero-dependency, client-side Web Bluetooth flasher & graphic editor for Bluetooth Low Energy Electronic Paper Displays / Electronic Shelf Labels (ESL).**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![PWA Ready](https://img.shields.io/badge/PWA-Offline%20Ready-success.svg)](manifest.json)
[![Web Bluetooth](https://img.shields.io/badge/Web%20Bluetooth-API%20Supported-orange.svg)](https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API)

---

## 📸 Overview

This repository contains a browser-based application for flashing images to Bluetooth E-Paper electronic shelf tags (e.g. 2.13", 2.90", 3.70", 4.20", and 7.50" panels) using the **Web Bluetooth API** (`navigator.bluetooth`).

No native apps, compilers, node modules, or cloud servers are required. Everything executes 100% locally in your browser with hardware-accurate 3-color Floyd-Steinberg dithering and dual-plane Bluetooth packetization.

---

## ✨ Features

- **Tri-Color Dithering Engine:** Implements 3-palette weighted Euclidean Floyd-Steinberg error diffusion matching `lanqianzhushou_1.2.8.apk` (`EPaperPicture.java` palette 6: White, Black, Red).
- **Dual-Plane E-Paper Protocol:** Automatically separates graphics into the physical EPD SRAM bitplanes:
  - **Black/White Plane (`0x13`):** Bit 0 = Black particle energized, Bit 1 = White background.
  - **Red Chromatic Plane (`0x12`):** Bit 1 = Red particle energized, Bit 0 = Transparent / inactive.
- **Triple Display Surface Previews:**
  - `Composite Preview`: Simulated e-paper surface showing white, black, and red pixels together.
  - `Black Layer (0x13)`: Isolates black plane; transparent non-black pixels reveal the chassis checkerboard.
  - `Red Layer (0x12)`: Isolates red plane; transparent non-red pixels reveal the chassis checkerboard.
- **Live Pixel Telemetry:** Real-time white, black, and red pixel counts and percentages.
- **Non-Destructive Image Caching:** Seamlessly re-dither between Monochrome and Tri-Color without re-uploading your image.
- **Diagnostic Hex Console:** Direct interactive transmission console targeting Characteristic `0xFFE2` with quick-command tooltips for manual tag testing.
- **Telemetry & Battery Polling:** Supports both standard SIG Battery Service (`0x180F` / `0x2A19`) and legacy notification query frames (`0x60` on `0xFFE1`).
- **Offline PWA Support:** Runs completely offline via Service Worker (`sw.js`) and Web App Manifest (`manifest.json`).

---

## 🏷️ Target Hardware Identification

If you have acquired these electronic price tags from retail liquidations, surplus vendors, or AliExpress, they typically match the following hardware identity:

| Specification | Hardware Identity Details |
| :--- | :--- |
| **Product Category** | Bluetooth Low Energy (BLE) Electronic Paper Display (EPD) Shelf Tag / Electronic Shelf Label (ESL) |
| **OEM Ecosystem** | **Lanqian Zhushou (蓝签助手 / Blue Tag Assistant)** by **ZGHD (智感互动 / Pinntag)** (`com.zghd.pinntag`) |
| **BLE Advertising Prefix** | **`EDP_*`** (*Electronic Display Paper*) or **`WP_*`** |
| **Primary Display Driver** | **SSD1680** / **UC8151D** / **JD79653** tri-color gate/source driver |
| **Wireless Radio SoC** | **Telink TLSR8xxx** / **TI CC2541** / **PhyPlus PHY62xx** |
| **Primary GATT Service** | **`0xFFE0`** (Write Characteristic: **`0xFFE2`**, Telemetry / Notify: **`0xFFE1`**) |
| **Auxiliary SIG Services** | **`0x180F`** (Battery Service, Char `0x2A19`) & **`0x180A`** (Device Information) |
| **Primary Panel Spec** | **2.13-inch 3-Color (Black, White, Red)** electrophoretic panel ($250 \times 128$ resolution) |

---

## 🖥️ Supported Hardware Profiles

The primary default configuration is **2.13" ($250 \times 128$)**:

| Panel Diagonal | Pixel Resolution | Sequence Mode | Rotation | Typical Packets (16B chunks) | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **2.13" (Standard)** | $250 \times 128$ | 1-Byte Sequence | None | ~252 Packets | **Primary Default** |
| **2.13" (Alt)** | $250 \times 122$ | 1-Byte Sequence | None | ~240 Packets | Supported |
| **2.90"** | $296 \times 128$ | 1-Byte Sequence | None | ~298 Packets | Supported |
| **3.70"** | $416 \times 240$ | 2-Byte Sequence | None | ~782 Packets | Supported |
| **4.20"** | $400 \times 300$ | 2-Byte Sequence | 90° Clockwise | ~940 Packets | Supported |
| **7.50"** | $800 \times 480$ | 2-Byte Sequence | 90° Clockwise | ~3,002 Packets | Supported |

---

## 🚀 Getting Started

### 1. Requirements
- A modern browser with **Web Bluetooth API** support:
  - Google Chrome, Microsoft Edge, Opera, or Samsung Internet on Windows 10/11, macOS, Linux, ChromeOS, or Android.
  - *(Note: iOS Safari does not natively support Web Bluetooth; use Bluefy on iOS).*
- Hardware tag within Bluetooth range (advertising name starting with `EDP` or `WP`).

### 2. Running Locally
Because modern browsers require HTTPS or `localhost` to access Web Bluetooth, run a simple static web server:

```bash
# Python 3
python -m http.server 8080

# Or Node.js
npx serve .
```

Open `http://localhost:8080` in Chrome or Edge.

---

## 📁 Repository Structure

```
.
├── index.html               # Clean, semantic UI structure
├── style.css                # Dark mode design system & e-paper chassis styling
├── app.js                   # UI event wiring & main coordination
├── ble.js                   # Web Bluetooth GATT client (BleDriver class)
├── dither.js                # Floyd-Steinberg error diffusion & canvas renderers
├── protocol.js              # Protocol opcodes, bit packing, & BLE packet framing
├── sw.js                    # Service Worker for offline PWA caching
├── manifest.json            # PWA manifest
├── BLE_COMMANDS_REFERENCE.md # Exhaustive BLE opcode & framing specification
├── PROTOCOL_README.md       # Reverse engineering findings & hardware analysis
├── ARCHITECTURE.md          # Web application architectural plan & security analysis
└── SECURITY_AUDIT.md        # Comprehensive security audit & threat model
```

---

## 📚 Technical Documentation

- **[BLE Commands Reference](BLE_COMMANDS_REFERENCE.md)**: Exhaustive opcode catalog (`0x13`, `0x12`, `0x50`, `0x60`), wire packet formatting, checksum algorithms, and timing requirements.
- **[Protocol Specification & Reverse Engineering](PROTOCOL_README.md)**: Deep dive into the reverse engineering of `lanqianzhushou_1.2.8.apk`, GATT tables, and electrophoretic panel mechanics.
- **[Architecture & Web Migration](ARCHITECTURE.md)**: Pros/cons analysis, client-side threat boundary evaluation, and offline architecture.
- **[Security Audit](SECURITY_AUDIT.md)**: Vulnerability disclosure and mitigation audit of original mobile firmware vs web implementation.

---

## 📄 License

MIT License. See [LICENSE](LICENSE) for details.
