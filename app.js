/**
 * E-Ink ESL Web Application Main Entrypoint.
 * Coordinates UI events, graphic loading, dithering, and Web Bluetooth transmission.
 */

import {
  LAYER_IDENTIFIER_BLACK_WHITE_PLANE,
  LAYER_IDENTIFIER_RED_YELLOW_PLANE,
  packMonochromePixelsIntoBytes,
  framePackedBytesIntoBlePackets,
  COMMAND_EXECUTE_SCREEN_REFRESH_CYCLE
} from "./protocol.js";

import {
  quantizeAndDitherImage,
  renderPixelMatrixToCanvas
} from "./dither.js";

import { BleDriver } from "./ble.js";

// DOM Element references
const displayProfileSelectElement = document.getElementById("displayProfileSelect");
const colorModeSelectElement = document.getElementById("colorModeSelect");
const acceptAllDevicesCheckboxElement = document.getElementById("acceptAllDevicesCheckbox");
const connectDeviceButtonElement = document.getElementById("connectDeviceButton");
const disconnectDeviceButtonElement = document.getElementById("disconnectDeviceButton");
const imageFileInputElement = document.getElementById("imageFileInput");
const loadTriColorDemoButtonElement = document.getElementById("loadTriColorDemoButton");
const loadRetailDemoButtonElement = document.getElementById("loadRetailDemoButton");
const loadQrDemoButtonElement = document.getElementById("loadQrDemoButton");
const luminanceThresholdSliderElement = document.getElementById("luminanceThresholdSlider");
const luminanceThresholdValueLabelElement = document.getElementById("luminanceThresholdValueLabel");
const floydSteinbergDitherCheckboxElement = document.getElementById("floydSteinbergDitherCheckbox");
const invertLuminanceCheckboxElement = document.getElementById("invertLuminanceCheckbox");
const flashScreenButtonElement = document.getElementById("flashScreenButton");
const triggerRefreshButtonElement = document.getElementById("triggerRefreshButton");
const queryBatteryButtonElement = document.getElementById("queryBatteryButton");
const scanServicesButtonElement = document.getElementById("scanServicesButton");
const rawHexCommandInputElement = document.getElementById("rawHexCommandInput");
const sendRawHexButtonElement = document.getElementById("sendRawHexButton");
const interPacketDelaySliderElement = document.getElementById("interPacketDelaySlider");
const interPacketDelayValueLabelElement = document.getElementById("interPacketDelayValueLabel");
const progressBarFillElement = document.getElementById("progressBarFill");
const packetProgressLabelElement = document.getElementById("packetProgressLabel");
const percentageProgressLabelElement = document.getElementById("percentageProgressLabel");
const epaperPreviewCanvasElement = document.getElementById("epaperPreviewCanvas");
const previewTabCompositeElement = document.getElementById("previewTabComposite");
const previewTabBlackElement = document.getElementById("previewTabBlack");
const previewTabRedElement = document.getElementById("previewTabRed");
const whitePixelCountLabelElement = document.getElementById("whitePixelCountLabel");
const blackPixelCountLabelElement = document.getElementById("blackPixelCountLabel");
const redPixelCountLabelElement = document.getElementById("redPixelCountLabel");
const protocolTelemetryConsoleElement = document.getElementById("protocolTelemetryConsole");
const connectionStatusBadgeElement = document.getElementById("connectionStatusBadge");
const unsupportedBrowserWarningElement = document.getElementById("unsupportedBrowserWarning");

// Offscreen canvas holding raw RGB source image before dithering
const rawSourceCanvasElement = document.createElement("canvas");
let hasActiveSourceGraphicFlag = false;

// Active preview layer mode: 'composite', 'black', or 'red'
let activePreviewLayerMode = "composite";
let lastProcessedPixelMatrixCache = null;

// Telemetry log helper
function appendTelemetryLog(message) {
  const timestamp = new Date().toTimeString().split(" ")[0];
  protocolTelemetryConsoleElement.textContent += `\n[${timestamp}] ${message}`;
  protocolTelemetryConsoleElement.scrollTop = protocolTelemetryConsoleElement.scrollHeight;
}

// Instantiate Bluetooth driver
const bleDriver = new BleDriver({
  onLog: appendTelemetryLog,
  onStatusChange: (status) => {
    if (status.connected) {
      connectionStatusBadgeElement.className = "bluetooth-status-badge connected";
      connectionStatusBadgeElement.textContent = `Connected: ${status.deviceName}`;
      if (status.batteryLevel !== null && status.batteryLevel !== undefined) {
        connectionStatusBadgeElement.textContent += ` (${status.batteryLevel}%)`;
      }
      connectDeviceButtonElement.disabled = true;
      disconnectDeviceButtonElement.disabled = false;
      flashScreenButtonElement.disabled = false;
      triggerRefreshButtonElement.disabled = false;
      queryBatteryButtonElement.disabled = false;
      scanServicesButtonElement.disabled = false;
      sendRawHexButtonElement.disabled = false;
    } else {
      connectionStatusBadgeElement.className = "bluetooth-status-badge disconnected";
      connectionStatusBadgeElement.textContent = "Bluetooth: Disconnected";
      connectDeviceButtonElement.disabled = false;
      disconnectDeviceButtonElement.disabled = true;
      flashScreenButtonElement.disabled = true;
      triggerRefreshButtonElement.disabled = true;
      queryBatteryButtonElement.disabled = true;
      scanServicesButtonElement.disabled = true;
      sendRawHexButtonElement.disabled = true;
    }
  }
});

// Check Web Bluetooth support
if (!navigator.bluetooth) {
  unsupportedBrowserWarningElement.style.display = "block";
  connectDeviceButtonElement.disabled = true;
}

function getSelectedHardwareProfile() {
  const selectedOptionElement = displayProfileSelectElement.options[displayProfileSelectElement.selectedIndex];
  return {
    profileKey: selectedOptionElement.value,
    pixelWidth: parseInt(selectedOptionElement.dataset.width, 10),
    pixelHeight: parseInt(selectedOptionElement.dataset.height, 10),
    usesTwoByteSequenceCounter: selectedOptionElement.dataset.twoByte === "true",
    requiresClockwiseRotation: selectedOptionElement.dataset.rotate === "true"
  };
}

function refreshPreviewCanvasDisplay() {
  renderPixelMatrixToCanvas(epaperPreviewCanvasElement, lastProcessedPixelMatrixCache, activePreviewLayerMode);
}

function processCanvasToPixelMatrix() {
  const canvasWidth = epaperPreviewCanvasElement.width;
  const canvasHeight = epaperPreviewCanvasElement.height;
  const canvasContext = epaperPreviewCanvasElement.getContext("2d");

  // Re-draw clean source image if loaded
  if (hasActiveSourceGraphicFlag && rawSourceCanvasElement.width > 0) {
    canvasContext.fillStyle = "#ffffff";
    canvasContext.fillRect(0, 0, canvasWidth, canvasHeight);
    canvasContext.drawImage(rawSourceCanvasElement, 0, 0);
  }

  const imageData = canvasContext.getImageData(0, 0, canvasWidth, canvasHeight);
  const options = {
    isTriColorMode: colorModeSelectElement.value === "tri_color",
    useDithering: floydSteinbergDitherCheckboxElement.checked,
    thresholdValue: parseInt(luminanceThresholdSliderElement.value, 10),
    invertLuminance: invertLuminanceCheckboxElement.checked
  };

  const { pixelMatrix, stats } = quantizeAndDitherImage(imageData.data, canvasWidth, canvasHeight, options);

  if (whitePixelCountLabelElement) whitePixelCountLabelElement.textContent = stats.whiteCount.toLocaleString();
  if (blackPixelCountLabelElement) blackPixelCountLabelElement.textContent = stats.blackCount.toLocaleString();
  if (redPixelCountLabelElement) redPixelCountLabelElement.textContent = stats.redCount.toLocaleString();

  lastProcessedPixelMatrixCache = pixelMatrix;
  refreshPreviewCanvasDisplay();
  return pixelMatrix;
}

async function flashScreenWorkflow() {
  if (bleDriver.isTransmitting || !bleDriver.isConnected) return;

  try {
    flashScreenButtonElement.disabled = true;
    appendTelemetryLog("=== INITIATING DUAL-PLANE FLASH WORKFLOW ===");

    const profile = getSelectedHardwareProfile();
    const pixelMatrix = processCanvasToPixelMatrix();
    const pacingDelayMilliseconds = parseInt(interPacketDelaySliderElement.value, 10) || 70;
    const isTriColorMode = colorModeSelectElement.value === "tri_color";

    // Black/White plane bitstream
    appendTelemetryLog(`Generating Black/White plane bitstream for ${profile.pixelWidth}x${profile.pixelHeight}...`);
    const blackPackedBytes = packMonochromePixelsIntoBytes(
      pixelMatrix,
      LAYER_IDENTIFIER_BLACK_WHITE_PLANE,
      profile.pixelWidth,
      profile.pixelHeight,
      isTriColorMode
    );
    appendTelemetryLog(`Black plane packed: ${blackPackedBytes.length} bytes.`);

    // Red plane bitstream
    appendTelemetryLog(`Generating Red/Yellow plane bitstream for ${profile.pixelWidth}x${profile.pixelHeight}...`);
    const redPackedBytes = packMonochromePixelsIntoBytes(
      pixelMatrix,
      LAYER_IDENTIFIER_RED_YELLOW_PLANE,
      profile.pixelWidth,
      profile.pixelHeight,
      isTriColorMode
    );
    appendTelemetryLog(`Red plane packed: ${redPackedBytes.length} bytes.`);

    // Frame into 16-byte chunks
    const blackPackets = framePackedBytesIntoBlePackets(
      blackPackedBytes,
      LAYER_IDENTIFIER_BLACK_WHITE_PLANE,
      16,
      profile.usesTwoByteSequenceCounter
    );

    const redPackets = framePackedBytesIntoBlePackets(
      redPackedBytes,
      LAYER_IDENTIFIER_RED_YELLOW_PLANE,
      16,
      profile.usesTwoByteSequenceCounter
    );

    const allTransmissionPackets = [...blackPackets, ...redPackets];
    const totalPackets = allTransmissionPackets.length;
    appendTelemetryLog(`Total transmission packets queued: ${totalPackets} (${blackPackets.length} Black + ${redPackets.length} Red).`);

    // Transmit packets with progress updates
    for (let packetIndex = 0; packetIndex < totalPackets; packetIndex++) {
      const packetData = allTransmissionPackets[packetIndex];

      if (packetIndex === 0) {
        appendTelemetryLog(">> [SEND] Black Plane Start Delimiter: [13 00 00 00 00]");
      } else if (packetIndex === blackPackets.length - 1) {
        appendTelemetryLog(">> [SEND] Black Plane Finish Delimiter: [13 FF FF FF FF]");
      } else if (packetIndex === blackPackets.length) {
        appendTelemetryLog(">> [SEND] Red Plane Start Delimiter: [12 00 00 00 00]");
      } else if (packetIndex === totalPackets - 1) {
        appendTelemetryLog(">> [SEND] Red Plane Finish Delimiter: [12 FF FF FF FF]");
      }

      await bleDriver.writeSafe(packetData);

      const current = packetIndex + 1;
      const percent = Math.round((current / totalPackets) * 100);
      progressBarFillElement.style.width = `${percent}%`;
      packetProgressLabelElement.textContent = `${current} / ${totalPackets} Packets`;
      percentageProgressLabelElement.textContent = `${percent}%`;

      await new Promise(resolve => setTimeout(resolve, pacingDelayMilliseconds));
    }

    // Settling pause then screen refresh
    appendTelemetryLog("Both Planes Loaded & Closed. Extra 150ms settling pause...");
    await new Promise(resolve => setTimeout(resolve, 150));

    appendTelemetryLog(">> [SEND] Refresh Command: [50 00 01 01] (Ble.updateSend)...");
    await bleDriver.writeSafe(COMMAND_EXECUTE_SCREEN_REFRESH_CYCLE);
    appendTelemetryLog("SUCCESS! High-voltage charge pump active. Particle latching takes ~2-3 seconds.");
  } catch (err) {
    appendTelemetryLog(`Flash error: ${err.message}`);
  } finally {
    flashScreenButtonElement.disabled = false;
  }
}

// Quick Hex command dispatcher
async function handleSendRawHexCommand() {
  const hexInputString = rawHexCommandInputElement.value.trim().replace(/\s+/g, "");
  if (!hexInputString || hexInputString.length % 2 !== 0) {
    appendTelemetryLog("Error: Invalid hex input. Must contain an even number of hex characters.");
    return;
  }

  try {
    const rawByteList = [];
    for (let charIndex = 0; charIndex < hexInputString.length; charIndex += 2) {
      rawByteList.push(parseInt(hexInputString.substr(charIndex, 2), 16));
    }
    const commandPayload = new Uint8Array(rawByteList);
    const hexFormatted = Array.from(commandPayload).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
    appendTelemetryLog(`>> [SEND RAW 0xFFE2] ${hexFormatted}`);

    await bleDriver.writeSafe(commandPayload);
    appendTelemetryLog("Raw command write acknowledged.");
  } catch (err) {
    appendTelemetryLog(`Raw command failed: ${err.message}`);
  }
}

// Graphic Templates
function renderTriColorDemo() {
  const profile = getSelectedHardwareProfile();
  rawSourceCanvasElement.width = profile.pixelWidth;
  rawSourceCanvasElement.height = profile.pixelHeight;
  const ctx = rawSourceCanvasElement.getContext("2d");

  // White background
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, profile.pixelWidth, profile.pixelHeight);

  // Red top header
  ctx.fillStyle = "#FF0000";
  ctx.fillRect(0, 0, profile.pixelWidth, 28);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 13px sans-serif";
  ctx.fillText("★ SPECIAL CLEARANCE ★", 12, 19);

  // Black title
  ctx.fillStyle = "#000000";
  ctx.font = "bold 16px sans-serif";
  ctx.fillText("Premium Red Blend", 12, 54);

  // Large Red Price
  ctx.fillStyle = "#FF0000";
  ctx.font = "bold 34px sans-serif";
  ctx.fillText("$9.99", 12, 94);

  // Strikethrough Black Price
  ctx.fillStyle = "#000000";
  ctx.font = "bold 14px sans-serif";
  ctx.fillText("WAS $19.99", profile.pixelWidth - 105, 74);
  ctx.fillRect(profile.pixelWidth - 108, 69, 95, 2);

  // Red Discount Pill
  ctx.fillStyle = "#FF0000";
  ctx.fillRect(profile.pixelWidth - 92, 86, 80, 24);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 11px sans-serif";
  ctx.fillText("SAVE 50%", profile.pixelWidth - 82, 102);

  // Black footer
  ctx.fillStyle = "#000000";
  ctx.font = "10px monospace";
  ctx.fillText("BARCODE: 4920192840", 12, 118);

  hasActiveSourceGraphicFlag = true;
  epaperPreviewCanvasElement.width = profile.pixelWidth;
  epaperPreviewCanvasElement.height = profile.pixelHeight;
  processCanvasToPixelMatrix();
  appendTelemetryLog("Tri-Color Test pattern rendered (Black, White, Red).");
}

function renderRetailPriceDemo() {
  const profile = getSelectedHardwareProfile();
  rawSourceCanvasElement.width = profile.pixelWidth;
  rawSourceCanvasElement.height = profile.pixelHeight;
  const ctx = rawSourceCanvasElement.getContext("2d");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, profile.pixelWidth, profile.pixelHeight);

  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, profile.pixelWidth, 26);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 13px sans-serif";
  ctx.fillText("ORGANIC PRODUCE", 10, 18);

  ctx.fillStyle = "#000000";
  ctx.font = "bold 18px sans-serif";
  ctx.fillText("Avocado Hass", 10, 54);

  ctx.font = "bold 36px sans-serif";
  ctx.fillText("$1.99", 10, 96);

  ctx.font = "11px monospace";
  ctx.fillText("SKU: 884920-A", 10, 116);
  ctx.fillText("PER EACH", profile.pixelWidth - 75, 96);

  hasActiveSourceGraphicFlag = true;
  epaperPreviewCanvasElement.width = profile.pixelWidth;
  epaperPreviewCanvasElement.height = profile.pixelHeight;
  processCanvasToPixelMatrix();
  appendTelemetryLog("Retail Demo template rendered.");
}

function renderQrDemo() {
  const profile = getSelectedHardwareProfile();
  rawSourceCanvasElement.width = profile.pixelWidth;
  rawSourceCanvasElement.height = profile.pixelHeight;
  const ctx = rawSourceCanvasElement.getContext("2d");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, profile.pixelWidth, profile.pixelHeight);

  ctx.fillStyle = "#000000";
  ctx.font = "bold 14px sans-serif";
  ctx.fillText("ASSET TAG #7742", 14, 30);

  const qrSize = Math.min(profile.pixelHeight - 40, 80);
  const startX = profile.pixelWidth - qrSize - 16;
  const startY = 16;

  ctx.strokeRect(startX, startY, qrSize, qrSize);
  for (let row = 0; row < 7; row++) {
    for (let col = 0; col < 7; col++) {
      if ((row + col) % 2 === 0 || (row % 3 === 0 && col % 3 === 0)) {
        ctx.fillRect(startX + col * (qrSize / 7), startY + row * (qrSize / 7), qrSize / 7, qrSize / 7);
      }
    }
  }

  ctx.font = "11px monospace";
  ctx.fillText("DEPT: LOGISTICS", 14, 55);
  ctx.fillText("LOC: AISLE-04-B", 14, 75);
  ctx.fillText("EXP: 2027-12-31", 14, 95);

  hasActiveSourceGraphicFlag = true;
  epaperPreviewCanvasElement.width = profile.pixelWidth;
  epaperPreviewCanvasElement.height = profile.pixelHeight;
  processCanvasToPixelMatrix();
  appendTelemetryLog("QR Asset Tag demo rendered.");
}

function handleImageUpload(changeEvent) {
  const selectedFile = changeEvent.target.files[0];
  if (!selectedFile) return;

  const fileReader = new FileReader();
  fileReader.onload = (loadEvent) => {
    const loadedImage = new Image();
    loadedImage.onload = () => {
      const profile = getSelectedHardwareProfile();
      rawSourceCanvasElement.width = profile.pixelWidth;
      rawSourceCanvasElement.height = profile.pixelHeight;
      const rawContext = rawSourceCanvasElement.getContext("2d");

      rawContext.fillStyle = "#ffffff";
      rawContext.fillRect(0, 0, profile.pixelWidth, profile.pixelHeight);

      const scaleFactor = Math.min(profile.pixelWidth / loadedImage.width, profile.pixelHeight / loadedImage.height);
      const scaledWidth = loadedImage.width * scaleFactor;
      const scaledHeight = loadedImage.height * scaleFactor;
      const offsetX = (profile.pixelWidth - scaledWidth) / 2;
      const offsetY = (profile.pixelHeight - scaledHeight) / 2;

      rawContext.drawImage(loadedImage, offsetX, offsetY, scaledWidth, scaledHeight);
      hasActiveSourceGraphicFlag = true;

      epaperPreviewCanvasElement.width = profile.pixelWidth;
      epaperPreviewCanvasElement.height = profile.pixelHeight;
      processCanvasToPixelMatrix();

      const testData = rawContext.getImageData(0, 0, profile.pixelWidth, profile.pixelHeight).data;
      let rawRedCount = 0;
      for (let i = 0; i < testData.length; i += 4) {
        const r = testData[i], g = testData[i + 1], b = testData[i + 2];
        if (r >= 110 && g <= 106 && b <= 195) rawRedCount++;
      }
      appendTelemetryLog(`Loaded image: ${selectedFile.name} (${loadedImage.width}x${loadedImage.height}). Found ~${rawRedCount} raw red-tone pixels.`);
    };
    loadedImage.src = loadEvent.target.result;
  };
  fileReader.readAsDataURL(selectedFile);
}

function setPreviewTabMode(mode) {
  activePreviewLayerMode = mode;
  previewTabCompositeElement.classList.toggle("active", mode === "composite");
  previewTabBlackElement.classList.toggle("active", mode === "black");
  previewTabRedElement.classList.toggle("active", mode === "red");
  refreshPreviewCanvasDisplay();
  appendTelemetryLog(`Switched display preview mode: ${mode.toUpperCase()} layer.`);
}

// UI Event Listeners
previewTabCompositeElement.addEventListener("click", () => setPreviewTabMode("composite"));
previewTabBlackElement.addEventListener("click", () => setPreviewTabMode("black"));
previewTabRedElement.addEventListener("click", () => setPreviewTabMode("red"));

connectDeviceButtonElement.addEventListener("click", () => bleDriver.connect(acceptAllDevicesCheckboxElement.checked));
disconnectDeviceButtonElement.addEventListener("click", () => bleDriver.disconnect());
flashScreenButtonElement.addEventListener("click", flashScreenWorkflow);
triggerRefreshButtonElement.addEventListener("click", () => bleDriver.triggerRefresh());
queryBatteryButtonElement.addEventListener("click", () => bleDriver.queryBattery());
scanServicesButtonElement.addEventListener("click", () => bleDriver.scanAllServices());
sendRawHexButtonElement.addEventListener("click", handleSendRawHexCommand);

document.querySelectorAll(".hex-chip").forEach((chipElement) => {
  chipElement.addEventListener("click", () => {
    rawHexCommandInputElement.value = chipElement.dataset.hex;
    rawHexCommandInputElement.focus();
    appendTelemetryLog(`Selected quick command: ${chipElement.dataset.hex} (${chipElement.title})`);
  });
});

interPacketDelaySliderElement.addEventListener("input", (e) => {
  interPacketDelayValueLabelElement.textContent = `${e.target.value}ms`;
});

if (loadTriColorDemoButtonElement) {
  loadTriColorDemoButtonElement.addEventListener("click", renderTriColorDemo);
}
loadRetailDemoButtonElement.addEventListener("click", renderRetailPriceDemo);
loadQrDemoButtonElement.addEventListener("click", renderQrDemo);
imageFileInputElement.addEventListener("change", handleImageUpload);
colorModeSelectElement.addEventListener("change", processCanvasToPixelMatrix);

displayProfileSelectElement.addEventListener("change", () => {
  const profile = getSelectedHardwareProfile();
  epaperPreviewCanvasElement.width = profile.pixelWidth;
  epaperPreviewCanvasElement.height = profile.pixelHeight;
  renderTriColorDemo();
});

luminanceThresholdSliderElement.addEventListener("input", (e) => {
  luminanceThresholdValueLabelElement.textContent = e.target.value;
  processCanvasToPixelMatrix();
});

floydSteinbergDitherCheckboxElement.addEventListener("change", processCanvasToPixelMatrix);
invertLuminanceCheckboxElement.addEventListener("change", processCanvasToPixelMatrix);

// Initialize initial canvas
renderTriColorDemo();

// Service Worker for offline PWA operation
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").then(() => {
      appendTelemetryLog("Offline PWA Service Worker registered.");
    }).catch((registrationError) => {
      appendTelemetryLog(`Service Worker registration error: ${registrationError.message}`);
    });
  });
}
