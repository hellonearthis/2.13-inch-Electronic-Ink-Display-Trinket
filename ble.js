/**
 * Web Bluetooth GATT Driver for Electronic Shelf Labels (ESL).
 * Encapsulates device pairing, service discovery, battery reads, and packet transmission pacing.
 */

import {
  BLUETOOTH_PRIMARY_SERVICE_UUID,
  BLUETOOTH_CHARACTERISTIC_NOTIFY_UUID,
  BLUETOOTH_CHARACTERISTIC_WRITE_UUID,
  BLUETOOTH_BATTERY_SERVICE_UUID,
  BLUETOOTH_BATTERY_LEVEL_CHARACTERISTIC_UUID,
  BLUETOOTH_DEVICE_INFO_SERVICE_UUID,
  BLUETOOTH_TELINK_VENDOR_SERVICE_UUID,
  COMMAND_EXECUTE_SCREEN_REFRESH_CYCLE,
  COMMAND_QUERY_BATTERY_PERCENTAGE_LEGACY
} from "./protocol.js";

export class BleDriver {
  constructor(options = {}) {
    this.onLog = options.onLog || (() => {});
    this.onStatusChange = options.onStatusChange || (() => {});
    this.onNotification = options.onNotification || (() => {});

    this.device = null;
    this.server = null;
    this.writeCharacteristic = null;
    this.notifyCharacteristic = null;
    this.isTransmitting = false;

    this.onGattDisconnectedBound = this.handleGattDisconnected.bind(this);
    this.onNotificationReceivedBound = this.handleNotificationReceived.bind(this);
  }

  get isConnected() {
    return !!(this.device && this.device.gatt && this.device.gatt.connected);
  }

  async connect(acceptAllDevices = false) {
    if (!navigator.bluetooth) {
      throw new Error("Web Bluetooth API is not supported in this browser.");
    }

    this.onLog("Requesting Bluetooth device pairing dialog...");

    const candidateServices = [
      BLUETOOTH_PRIMARY_SERVICE_UUID,
      BLUETOOTH_BATTERY_SERVICE_UUID,
      BLUETOOTH_DEVICE_INFO_SERVICE_UUID,
      BLUETOOTH_TELINK_VENDOR_SERVICE_UUID
    ];

    const requestOptions = acceptAllDevices ? {
      acceptAllDevices: true,
      optionalServices: candidateServices
    } : {
      filters: [
        { namePrefix: "EDP" },
        { namePrefix: "WP" }
      ],
      optionalServices: candidateServices
    };

    this.device = await navigator.bluetooth.requestDevice(requestOptions);
    this.onLog(`Device selected: ${this.device.name || "Unknown"} (${this.device.id})`);

    this.device.addEventListener("gattserverdisconnected", this.onGattDisconnectedBound);

    this.onLog("Connecting to GATT Server...");
    this.server = await this.device.gatt.connect();

    this.onLog("Resolving Primary Service 0xFFE0...");
    const gattService = await this.server.getPrimaryService(BLUETOOTH_PRIMARY_SERVICE_UUID);

    this.onLog("Resolving Characteristic 0xFFE2 (Write)...");
    this.writeCharacteristic = await gattService.getCharacteristic(BLUETOOTH_CHARACTERISTIC_WRITE_UUID);

    // Subscribe to Notifications on 0xFFE1
    try {
      this.onLog("Enabling Notifications on Characteristic 0xFFE1...");
      this.notifyCharacteristic = await gattService.getCharacteristic(BLUETOOTH_CHARACTERISTIC_NOTIFY_UUID);
      await this.notifyCharacteristic.startNotifications();
      this.notifyCharacteristic.addEventListener("characteristicvaluechanged", this.onNotificationReceivedBound);
      this.onLog("Telemetry notifications active on 0xFFE1.");
    } catch (notifErr) {
      this.onLog(`Notice: Could not subscribe to 0xFFE1: ${notifErr.message}`);
    }

    // Inspect Device Info (0x180A)
    try {
      const deviceInfoService = await this.server.getPrimaryService(BLUETOOTH_DEVICE_INFO_SERVICE_UUID);
      const textDecoder = new TextDecoder("utf-8");

      try {
        const modelChar = await deviceInfoService.getCharacteristic("00002a24-0000-1000-8000-00805f9b34fb");
        const buf = await modelChar.readValue();
        this.onLog(`Hardware Model: ${textDecoder.decode(buf)}`);
      } catch (e) {}

      try {
        const fwChar = await deviceInfoService.getCharacteristic("00002a26-0000-1000-8000-00805f9b34fb");
        const buf = await fwChar.readValue();
        this.onLog(`Firmware Revision: ${textDecoder.decode(buf)}`);
      } catch (e) {}

      try {
        const mfgChar = await deviceInfoService.getCharacteristic("00002a29-0000-1000-8000-00805f9b34fb");
        const buf = await mfgChar.readValue();
        this.onLog(`Manufacturer: ${textDecoder.decode(buf)}`);
      } catch (e) {}
    } catch (e) {}

    // Inspect standard Battery Service (0x180F -> 0x2A19)
    let batteryLevel = null;
    try {
      const batteryService = await this.server.getPrimaryService(BLUETOOTH_BATTERY_SERVICE_UUID);
      const batteryChar = await batteryService.getCharacteristic(BLUETOOTH_BATTERY_LEVEL_CHARACTERISTIC_UUID);
      const buf = await batteryChar.readValue();
      batteryLevel = buf.getUint8(0);
      this.onLog(`Battery Level: ${batteryLevel}%`);
    } catch (e) {}

    this.onStatusChange({
      connected: true,
      deviceName: this.device.name || "Tag",
      batteryLevel
    });

    this.onLog("Connection verified. Ready for transmission & diagnostics.");
  }

  handleGattDisconnected() {
    this.onLog("GATT Server disconnected.");
    this.writeCharacteristic = null;
    this.notifyCharacteristic = null;
    this.server = null;
    this.device = null;
    this.isTransmitting = false;

    this.onStatusChange({ connected: false });
  }

  disconnect() {
    if (this.device && this.device.gatt && this.device.gatt.connected) {
      this.device.gatt.disconnect();
    }
  }

  handleNotificationReceived(event) {
    const dataView = event.target.value;
    const byteArray = new Uint8Array(dataView.buffer);
    const hexValues = Array.from(byteArray).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
    this.onLog(`<< [NOTIFICATION 0xFFE1] ${hexValues}`);

    // Check for legacy battery query response: 60 00 01 [Level] [Sum]
    if (byteArray.length >= 4 && byteArray[0] === 0x60 && byteArray[1] === 0x00 && byteArray[2] === 0x01) {
      const batteryPercentage = byteArray[3];
      this.onLog(`[Battery Status] Tag reports battery level: ${batteryPercentage}%`);
    }

    this.onNotification(byteArray);
  }

  async writeSafe(payloadByteArray) {
    if (!this.writeCharacteristic) throw new Error("Not connected to tag write characteristic.");
    if (this.writeCharacteristic.properties.writeWithoutResponse) {
      await this.writeCharacteristic.writeValueWithoutResponse(payloadByteArray);
    } else if (this.writeCharacteristic.properties.write) {
      if (this.writeCharacteristic.writeValueWithResponse) {
        await this.writeCharacteristic.writeValueWithResponse(payloadByteArray);
      } else {
        await this.writeCharacteristic.writeValue(payloadByteArray);
      }
    } else {
      await this.writeCharacteristic.writeValueWithoutResponse(payloadByteArray);
    }
  }

  async transmitPackets(packetList, pacingDelayMs = 70, onProgress = () => {}) {
    if (this.isTransmitting) throw new Error("A transmission is already in progress.");
    this.isTransmitting = true;

    try {
      const totalPackets = packetList.length;
      for (let i = 0; i < totalPackets; i++) {
        await this.writeSafe(packetList[i]);
        onProgress(i + 1, totalPackets);
        await new Promise(resolve => setTimeout(resolve, pacingDelayMs));
      }
    } finally {
      this.isTransmitting = false;
    }
  }

  async triggerRefresh() {
    this.onLog("Sending Refresh Command (0x50)...");
    await this.writeSafe(COMMAND_EXECUTE_SCREEN_REFRESH_CYCLE);
    this.onLog("Refresh command acknowledged by tag.");
  }

  async queryBattery() {
    if (!this.server) return;

    // Standard battery service 0x180F
    try {
      this.onLog("Checking for standard Battery Service (0x180F)...");
      const batteryService = await this.server.getPrimaryService(BLUETOOTH_BATTERY_SERVICE_UUID);
      const batteryChar = await batteryService.getCharacteristic(BLUETOOTH_BATTERY_LEVEL_CHARACTERISTIC_UUID);
      const buf = await batteryChar.readValue();
      const level = buf.getUint8(0);
      this.onLog(`[Standard Battery] Tag Battery Level: ${level}%`);
      return level;
    } catch (err) {
      this.onLog(`Standard 0x180F not present (${err.message}). Trying legacy 0x60 query...`);
    }

    // Legacy query over 0xFFE2
    if (this.writeCharacteristic) {
      this.onLog("Dispatching Legacy Battery Query: [60 00 01 00 61] to 0xFFE2...");
      await this.writeSafe(COMMAND_QUERY_BATTERY_PERCENTAGE_LEGACY);
      this.onLog("Query sent. Awaiting notification on 0xFFE1...");
    }
  }

  async scanAllServices() {
    if (!this.server) return;
    this.onLog("=== INITIATING FULL GATT SERVICE DISCOVERY ===");
    const discoveredServices = await this.server.getPrimaryServices();
    this.onLog(`Discovered ${discoveredServices.length} Primary GATT Service(s):`);

    const knownServiceLabels = {
      "0000180f-0000-1000-8000-00805f9b34fb": "Battery Service",
      "0000180a-0000-1000-8000-00805f9b34fb": "Device Information Service",
      "0000ffe0-0000-1000-8000-00805f9b34fb": "E-Ink Display Primary Service",
      "be940000-7333-be46-b7ae-689e71722bd5": "Telink Vendor Service"
    };

    const knownCharacteristicLabels = {
      "00002a19-0000-1000-8000-00805f9b34fb": "Battery Level",
      "00002a24-0000-1000-8000-00805f9b34fb": "Model Number",
      "00002a26-0000-1000-8000-00805f9b34fb": "Firmware Revision",
      "00002a29-0000-1000-8000-00805f9b34fb": "Manufacturer Name",
      "00002a50-0000-1000-8000-00805f9b34fb": "PnP ID",
      "0000ffe1-0000-1000-8000-00805f9b34fb": "Secondary / Telemetry Buffer",
      "0000ffe2-0000-1000-8000-00805f9b34fb": "E-Ink Command & Bitstream Sink"
    };

    const textDecoder = new TextDecoder("utf-8");

    for (let sIdx = 0; sIdx < discoveredServices.length; sIdx++) {
      const curService = discoveredServices[sIdx];
      const label = knownServiceLabels[curService.uuid] ? ` (${knownServiceLabels[curService.uuid]})` : "";
      this.onLog(`\n[Service ${sIdx + 1}] UUID: ${curService.uuid}${label}`);

      try {
        const characteristics = await curService.getCharacteristics();
        for (let cIdx = 0; cIdx < characteristics.length; cIdx++) {
          const charItem = characteristics[cIdx];
          const props = charItem.properties;
          const propStrings = [];
          if (props.read) propStrings.push("READ");
          if (props.write) propStrings.push("WRITE");
          if (props.writeWithoutResponse) propStrings.push("WRITE_NO_RESP");
          if (props.notify) propStrings.push("NOTIFY");
          if (props.indicate) propStrings.push("INDICATE");

          const charLabel = knownCharacteristicLabels[charItem.uuid] ? ` <-- ${knownCharacteristicLabels[charItem.uuid]}` : "";
          let valSuffix = "";

          if (props.read) {
            try {
              const readBuf = await charItem.readValue();
              if (charItem.uuid === "00002a19-0000-1000-8000-00805f9b34fb") {
                valSuffix = ` (Value: ${readBuf.getUint8(0)}%)`;
              } else if (["00002a24-0000-1000-8000-00805f9b34fb", "00002a26-0000-1000-8000-00805f9b34fb", "00002a29-0000-1000-8000-00805f9b34fb"].includes(charItem.uuid)) {
                valSuffix = ` (Value: "${textDecoder.decode(readBuf).trim()}")`;
              } else {
                const hexArr = Array.from(new Uint8Array(readBuf.buffer)).map(b => b.toString(16).padStart(2, '0')).join(' ');
                valSuffix = ` (Hex: ${hexArr})`;
              }
            } catch (err) {
              valSuffix = ` (Read Error: ${err.message})`;
            }
          }

          this.onLog(`  - Char: ${charItem.uuid} [${propStrings.join(", ")}]${charLabel}${valSuffix}`);
        }
      } catch (err) {
        this.onLog(`  - Error reading characteristics: ${err.message}`);
      }
    }
    this.onLog("=== GATT DISCOVERY COMPLETE ===");
  }
}
