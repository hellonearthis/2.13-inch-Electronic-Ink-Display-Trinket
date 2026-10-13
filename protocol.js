/**
 * Bluetooth Low Energy & ESL Protocol Constants.
 * Extracted from reverse-engineered lanqianzhushou_1.2.8.apk (io.dcloud.uniplugin.photoUtil).
 */

export const BLUETOOTH_PRIMARY_SERVICE_UUID = "0000ffe0-0000-1000-8000-00805f9b34fb";
export const BLUETOOTH_CHARACTERISTIC_NOTIFY_UUID = "0000ffe1-0000-1000-8000-00805f9b34fb";
export const BLUETOOTH_CHARACTERISTIC_WRITE_UUID = "0000ffe2-0000-1000-8000-00805f9b34fb";

export const BLUETOOTH_BATTERY_SERVICE_UUID = "0000180f-0000-1000-8000-00805f9b34fb";
export const BLUETOOTH_BATTERY_LEVEL_CHARACTERISTIC_UUID = "00002a19-0000-1000-8000-00805f9b34fb";

export const BLUETOOTH_DEVICE_INFO_SERVICE_UUID = "0000180a-0000-1000-8000-00805f9b34fb";
export const BLUETOOTH_TELINK_VENDOR_SERVICE_UUID = "be940000-7333-be46-b7ae-689e71722bd5";

export const COMMAND_START_BLACK_LAYER_TRANSMISSION = new Uint8Array([0x13, 0x00, 0x00, 0x00, 0x00]);
export const COMMAND_FINISH_BLACK_LAYER_TRANSMISSION = new Uint8Array([0x13, 0xFF, 0xFF, 0xFF, 0xFF]);
export const COMMAND_START_RED_LAYER_TRANSMISSION = new Uint8Array([0x12, 0x00, 0x00, 0x00, 0x00]);
export const COMMAND_FINISH_RED_LAYER_TRANSMISSION = new Uint8Array([0x12, 0xFF, 0xFF, 0xFF, 0xFF]);
export const COMMAND_EXECUTE_SCREEN_REFRESH_CYCLE = new Uint8Array([0x50, 0x00, 0x01, 0x01]);
export const COMMAND_QUERY_BATTERY_PERCENTAGE_LEGACY = new Uint8Array([0x60, 0x00, 0x01, 0x00, 0x61]);

export const LAYER_IDENTIFIER_BLACK_WHITE_PLANE = 0x13;
export const LAYER_IDENTIFIER_RED_YELLOW_PLANE = 0x12;

/**
 * Computes single-byte modular sum checksum across an array of bytes:
 * checksum = sum(bytes) % 256
 */
export function calculatePacketChecksumByte(payloadByteArray) {
  let checksumAccumulatorInteger = 0;
  for (let byteIndex = 0; byteIndex < payloadByteArray.length; byteIndex++) {
    checksumAccumulatorInteger = (checksumAccumulatorInteger + payloadByteArray[byteIndex]) & 0xFF;
  }
  return checksumAccumulatorInteger;
}

/**
 * Converts 2D pixel luminance matrix into 1-bit packed byte arrays (8 pixels per byte).
 * Column-major order: scans x from 0..width, then y from 0..height.
 *
 * Black/White plane (0x13): Bit 0 = Black ink particles, Bit 1 = White background / Red pixel (inactive on B/W plane)
 * Red plane (0x12): Bit 1 = Red particle activation, Bit 0 = White / Black (inactive on Red plane)
 */
export function packMonochromePixelsIntoBytes(
  pixelMatrix2D,
  targetLayerIdentifier,
  displayPixelWidth,
  displayPixelHeight,
  isTriColorMode = true
) {
  const packedBytesArray = [];
  let currentBitAccumulatorInteger = 0;
  let accumulatedBitsCounter = 0;

  for (let horizontalIndex = 0; horizontalIndex < displayPixelWidth; horizontalIndex++) {
    for (let verticalIndex = 0; verticalIndex < displayPixelHeight; verticalIndex++) {
      const pixelColor = pixelMatrix2D[horizontalIndex][verticalIndex];
      let activePixelBit = 0;

      // Color detection matching EpdDevParamFactory.java line 282:
      // Red condition: (r >= 110 && g <= 106 && b <= 195)
      const isRedPixel = isTriColorMode && (pixelColor.rawRed >= 110) && (pixelColor.rawGreen <= 106) && (pixelColor.rawBlue <= 195);

      if (targetLayerIdentifier === LAYER_IDENTIFIER_BLACK_WHITE_PLANE) {
        if (isRedPixel) {
          activePixelBit = 1;
        } else {
          activePixelBit = (pixelColor.luminance >= 180) ? 1 : 0;
        }
      } else if (targetLayerIdentifier === LAYER_IDENTIFIER_RED_YELLOW_PLANE) {
        activePixelBit = isRedPixel ? 1 : 0;
      }

      currentBitAccumulatorInteger = (currentBitAccumulatorInteger << 1) | activePixelBit;
      accumulatedBitsCounter++;

      if (accumulatedBitsCounter === 8) {
        packedBytesArray.push(currentBitAccumulatorInteger);
        currentBitAccumulatorInteger = 0;
        accumulatedBitsCounter = 0;
      }
    }
  }

  // Align trailing unaligned bits to 8-bit boundary
  if (accumulatedBitsCounter > 0) {
    currentBitAccumulatorInteger = currentBitAccumulatorInteger << (8 - accumulatedBitsCounter);
    packedBytesArray.push(currentBitAccumulatorInteger);
  }

  return new Uint8Array(packedBytesArray);
}

/**
 * Slices packed image bytes into numbered BLE transmission packets with delimiters and checksums.
 */
export function framePackedBytesIntoBlePackets(
  packedBytesUint8Array,
  layerIdentifierByte,
  maximumPayloadChunkSize = 16,
  usesTwoByteSequenceCounter = false
) {
  const packetCollection = [];

  // Start delimiter
  if (layerIdentifierByte === LAYER_IDENTIFIER_BLACK_WHITE_PLANE) {
    packetCollection.push(COMMAND_START_BLACK_LAYER_TRANSMISSION);
  } else {
    packetCollection.push(COMMAND_START_RED_LAYER_TRANSMISSION);
  }

  const totalLength = packedBytesUint8Array.length;
  let currentOffset = 0;
  let packetSequenceCounter = 1;

  while (currentOffset < totalLength) {
    const chunkEndOffset = Math.min(currentOffset + maximumPayloadChunkSize, totalLength);
    const chunkBytes = packedBytesUint8Array.slice(currentOffset, chunkEndOffset);
    const chunkLength = chunkBytes.length;

    const packetHeader = usesTwoByteSequenceCounter ? [
      layerIdentifierByte,
      (packetSequenceCounter >> 8) & 0xFF,
      packetSequenceCounter & 0xFF,
      chunkLength
    ] : [
      layerIdentifierByte,
      packetSequenceCounter & 0xFF,
      chunkLength
    ];

    const checksumByte = calculatePacketChecksumByte(chunkBytes);
    const singlePacket = new Uint8Array(packetHeader.length + chunkBytes.length + 1);
    singlePacket.set(packetHeader, 0);
    singlePacket.set(chunkBytes, packetHeader.length);
    singlePacket[singlePacket.length - 1] = checksumByte;

    packetCollection.push(singlePacket);

    currentOffset = chunkEndOffset;
    packetSequenceCounter++;
  }

  // Finish delimiter
  if (layerIdentifierByte === LAYER_IDENTIFIER_BLACK_WHITE_PLANE) {
    packetCollection.push(COMMAND_FINISH_BLACK_LAYER_TRANSMISSION);
  } else {
    packetCollection.push(COMMAND_FINISH_RED_LAYER_TRANSMISSION);
  }

  return packetCollection;
}
