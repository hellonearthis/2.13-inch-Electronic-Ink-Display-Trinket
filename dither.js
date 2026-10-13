/**
 * Image processing, color quantization, and Floyd-Steinberg error diffusion for E-Paper displays.
 * Implements 3-palette quantization matching lanqianzhushou_1.2.8.apk (EPaperPicture palette 6: White, Black, Red).
 */

/**
 * 3-color palette definition:
 * Black [0, 0, 0]
 * White [255, 255, 255]
 * Red   [255, 0, 0]
 */
export const TRI_COLOR_PALETTE = [
  { r: 0, g: 0, b: 0, isRed: false, isWhite: false },
  { r: 255, g: 255, b: 255, isRed: false, isWhite: true },
  { r: 255, g: 0, b: 0, isRed: true, isWhite: false }
];

/**
 * Quantizes image data into a 2D matrix of E-Paper pixels with Floyd-Steinberg error diffusion.
 *
 * @param {Uint8ClampedArray} rawPixelData - Source image RGBA data
 * @param {number} canvasWidth - Pixel width
 * @param {number} canvasHeight - Pixel height
 * @param {Object} options - Configuration options:
 *   - isTriColorMode: boolean
 *   - useDithering: boolean
 *   - thresholdValue: number (0-255)
 *   - invertLuminance: boolean
 * @returns {Object} { pixelMatrix, stats: { whiteCount, blackCount, redCount } }
 */
export function quantizeAndDitherImage(rawPixelData, canvasWidth, canvasHeight, options = {}) {
  const {
    isTriColorMode = true,
    useDithering = true,
    thresholdValue = 180,
    invertLuminance = false
  } = options;

  const processedPixelMatrix = [];
  for (let x = 0; x < canvasWidth; x++) {
    processedPixelMatrix[x] = [];
  }

  let totalWhitePixelCount = 0;
  let totalBlackPixelCount = 0;
  let totalRedPixelCount = 0;

  if (isTriColorMode) {
    // RGB float grids for 3-channel error diffusion
    const rGrid = [];
    const gGrid = [];
    const bGrid = [];
    for (let x = 0; x < canvasWidth; x++) {
      rGrid[x] = new Float32Array(canvasHeight);
      gGrid[x] = new Float32Array(canvasHeight);
      bGrid[x] = new Float32Array(canvasHeight);
      for (let y = 0; y < canvasHeight; y++) {
        const offset = (y * canvasWidth + x) * 4;
        rGrid[x][y] = rawPixelData[offset];
        gGrid[x][y] = rawPixelData[offset + 1];
        bGrid[x][y] = rawPixelData[offset + 2];
      }
    }

    // Scan across rows (standard Floyd-Steinberg order)
    for (let y = 0; y < canvasHeight; y++) {
      for (let x = 0; x < canvasWidth; x++) {
        const curR = Math.min(255, Math.max(0, rGrid[x][y]));
        const curG = Math.min(255, Math.max(0, gGrid[x][y]));
        const curB = Math.min(255, Math.max(0, bGrid[x][y]));

        let chosenColor = TRI_COLOR_PALETTE[0];
        let minDistance = Infinity;

        for (let pIdx = 0; pIdx < TRI_COLOR_PALETTE.length; pIdx++) {
          const pal = TRI_COLOR_PALETTE[pIdx];
          const dR = curR - pal.r;
          const dG = curG - pal.g;
          const dB = curB - pal.b;
          // Weighted Euclidean distance for accurate red chroma perception
          const dist = 2 * dR * dR + 4 * dG * dG + 3 * dB * dB;
          if (dist < minDistance) {
            minDistance = dist;
            chosenColor = pal;
          }
        }

        if (chosenColor.isRed) totalRedPixelCount++;
        else if (chosenColor.isWhite) totalWhitePixelCount++;
        else totalBlackPixelCount++;

        processedPixelMatrix[x][y] = {
          luminance: chosenColor.isWhite ? 255 : 0,
          rawRed: chosenColor.isRed ? 255 : 0,
          rawGreen: chosenColor.isWhite ? 255 : 0,
          rawBlue: chosenColor.isWhite ? 255 : 0,
          isTriRed: chosenColor.isRed,
          isTriWhite: chosenColor.isWhite
        };

        const errR = curR - chosenColor.r;
        const errG = curG - chosenColor.g;
        const errB = curB - chosenColor.b;

        if (useDithering) {
          if (x + 1 < canvasWidth) {
            rGrid[x + 1][y] += errR * (7 / 16);
            gGrid[x + 1][y] += errG * (7 / 16);
            bGrid[x + 1][y] += errB * (7 / 16);
          }
          if (x - 1 >= 0 && y + 1 < canvasHeight) {
            rGrid[x - 1][y + 1] += errR * (3 / 16);
            gGrid[x - 1][y + 1] += errG * (3 / 16);
            bGrid[x - 1][y + 1] += errB * (3 / 16);
          }
          if (y + 1 < canvasHeight) {
            rGrid[x][y + 1] += errR * (5 / 16);
            gGrid[x][y + 1] += errG * (5 / 16);
            bGrid[x][y + 1] += errB * (5 / 16);
          }
          if (x + 1 < canvasWidth && y + 1 < canvasHeight) {
            rGrid[x + 1][y + 1] += errR * (1 / 16);
            gGrid[x + 1][y + 1] += errG * (1 / 16);
            bGrid[x + 1][y + 1] += errB * (1 / 16);
          }
        }
      }
    }
  } else {
    // 1-Bit Monochrome Dithering
    const luminanceGrid = [];
    for (let x = 0; x < canvasWidth; x++) {
      luminanceGrid[x] = new Float32Array(canvasHeight);
      for (let y = 0; y < canvasHeight; y++) {
        const pixelOffset = (y * canvasWidth + x) * 4;
        let luma = 0.299 * rawPixelData[pixelOffset] + 0.587 * rawPixelData[pixelOffset + 1] + 0.114 * rawPixelData[pixelOffset + 2];
        if (invertLuminance) luma = 255 - luma;
        luminanceGrid[x][y] = luma;
      }
    }

    for (let y = 0; y < canvasHeight; y++) {
      for (let x = 0; x < canvasWidth; x++) {
        const oldLuma = luminanceGrid[x][y];
        const newLuma = oldLuma >= thresholdValue ? 255 : 0;
        const quantizationError = oldLuma - newLuma;

        if (newLuma === 255) totalWhitePixelCount++;
        else totalBlackPixelCount++;

        processedPixelMatrix[x][y] = {
          luminance: newLuma,
          rawRed: 0,
          rawGreen: 0,
          rawBlue: 0,
          isTriRed: false,
          isTriWhite: newLuma === 255
        };

        if (useDithering) {
          if (x + 1 < canvasWidth) luminanceGrid[x + 1][y] += quantizationError * (7 / 16);
          if (x - 1 >= 0 && y + 1 < canvasHeight) luminanceGrid[x - 1][y + 1] += quantizationError * (3 / 16);
          if (y + 1 < canvasHeight) luminanceGrid[x][y + 1] += quantizationError * (5 / 16);
          if (x + 1 < canvasWidth && y + 1 < canvasHeight) luminanceGrid[x + 1][y + 1] += quantizationError * (1 / 16);
        }
      }
    }
  }

  return {
    pixelMatrix: processedPixelMatrix,
    stats: {
      whiteCount: totalWhitePixelCount,
      blackCount: totalBlackPixelCount,
      redCount: totalRedPixelCount
    }
  };
}

/**
 * Renders the quantized pixel matrix onto a canvas according to active preview mode.
 *
 * @param {HTMLCanvasElement} canvas - Target preview canvas
 * @param {Array} pixelMatrix - 2D matrix of processed pixels
 * @param {string} mode - 'composite', 'black', or 'red'
 */
export function renderPixelMatrixToCanvas(canvas, pixelMatrix, mode = "composite") {
  if (!pixelMatrix || !canvas) return;
  const canvasWidth = canvas.width;
  const canvasHeight = canvas.height;
  const canvasContext = canvas.getContext("2d");
  const imageData = canvasContext.createImageData(canvasWidth, canvasHeight);
  const rawPixelData = imageData.data;

  for (let y = 0; y < canvasHeight; y++) {
    for (let x = 0; x < canvasWidth; x++) {
      const offset = (y * canvasWidth + x) * 4;
      const cell = pixelMatrix[x][y];

      if (mode === "black") {
        // Black plane: black pixels opaque, everything else transparent
        if (!cell.isTriRed && !cell.isTriWhite) {
          rawPixelData[offset] = 0;       // Black
          rawPixelData[offset + 1] = 0;
          rawPixelData[offset + 2] = 0;
          rawPixelData[offset + 3] = 255; // Opaque
        } else {
          // Transparent (reveals chassis checkerboard)
          rawPixelData[offset] = 0;
          rawPixelData[offset + 1] = 0;
          rawPixelData[offset + 2] = 0;
          rawPixelData[offset + 3] = 0;
        }
      } else if (mode === "red") {
        // Red plane: red pixels opaque, non-red transparent
        if (cell.isTriRed) {
          rawPixelData[offset] = 211;     // Red
          rawPixelData[offset + 1] = 47;
          rawPixelData[offset + 2] = 47;
          rawPixelData[offset + 3] = 255; // Opaque
        } else {
          // Transparent (reveals chassis checkerboard)
          rawPixelData[offset] = 0;
          rawPixelData[offset + 1] = 0;
          rawPixelData[offset + 2] = 0;
          rawPixelData[offset + 3] = 0;
        }
      } else {
        // Composite simulated screen appearance
        if (cell.isTriRed) {
          rawPixelData[offset] = 211;     // Red (E-Paper aesthetic)
          rawPixelData[offset + 1] = 47;
          rawPixelData[offset + 2] = 47;
        } else if (cell.isTriWhite) {
          rawPixelData[offset] = 255;     // White
          rawPixelData[offset + 1] = 255;
          rawPixelData[offset + 2] = 255;
        } else {
          rawPixelData[offset] = 0;       // Black
          rawPixelData[offset + 1] = 0;
          rawPixelData[offset + 2] = 0;
        }
        rawPixelData[offset + 3] = 255;
      }
    }
  }

  canvasContext.putImageData(imageData, 0, 0);
}
