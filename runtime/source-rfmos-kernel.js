// Original EXE SHA256 69a06b969d65ae2a52e9ca86da2044d441cb9b7e3d394fcf58ca60f21b76e1f1.
// Used rfmos 100 60 1 only: internal duration 98, blocks 60, mode 1, extra 0.
// 53d890 builds progressive bitmap records; 53e270 CPU expands into the full
// texture with 5c7ce0 -> 5c8520 before the GPU draws its white/alpha quad.
// This module returns texture bytes plus vertex alpha, not a composed GPU frame.
const sequences = new WeakMap();
const F = Math.fround;
const MAX_BYTES = 8 * 1024 * 1024;
function require(condition, message) { if (!condition) throw new Error(message); }
function exactKeys(value, allowed, message) {
  require(value !== null && typeof value === 'object' && !Array.isArray(value), message);
  require(Object.keys(value).every(key => allowed.includes(key)), message);
}
function pixelLength(width, height) {
  require(Number.isInteger(width) && width > 0 && width <= 4096 &&
    Number.isInteger(height) && height > 0 && height <= 4096, 'Invalid rfmos dimensions');
  const length = width * height * 4;
  require(length <= MAX_BYTES, 'Rfmos pixels exceed bounded byte budget');
  return length;
}
function ownPixels(pixels, length, message) {
  require(pixels instanceof Uint8Array && pixels.length === length, message);
  // Uint8Array constructor copies Buffer and offset views as well as ordinary arrays.
  return new Uint8Array(pixels);
}
function hasTransparency(pixels) {
  for (let at = 3; at < pixels.length; at += 4) if (pixels[at] !== 255) return true;
  return false;
}
function resize(source, width, height, targetWidth, targetHeight, destination) {
  // Format4->format4 equal-size path 5c77d0 is row memcpy, including alpha 0.
  if (width === targetWidth && height === targetHeight) return new Uint8Array(source);
  const target = destination ?? new Uint8Array(targetWidth * targetHeight * 4);
  const stepX = Math.trunc((width * 32768) / targetWidth);
  const stepY = Math.trunc((height * 32768) / targetHeight);
  for (let y = 0; y < targetHeight; y++) {
    const fixedY = y * stepY, sy = fixedY >> 15, fy = fixedY & 32767;
    for (let x = 0; x < targetWidth; x++) {
      const fixedX = x * stepX, sx = fixedX >> 15, fx = fixedX & 32767;
      const p0 = (sy * width + sx) * 4;
      // Keep 5c78f0's actual edge branches: an unavailable BR becomes TL.
      // This is intentionally different from conventional duplicated-edge bilinear.
      const p1 = sx < width - 1 ? p0 + 4 : p0;
      const p2 = sy < height - 1 ? p0 + width * 4 : p0;
      const p3 = sx < width - 1 && sy < height - 1 ? p2 + 4 : p0;
      const alphaSum = source[p0 + 3] + source[p1 + 3] + source[p2 + 3] + source[p3 + 3];
      // 5c8640: all transparent neighbor pixels leave destination bytes untouched.
      if (alphaSum === 0) continue;
      const w0 = ((32768 - fx) * (32768 - fy)) >> 15;
      const w1 = ((32768 - fx) * fy) >> 15; // BL
      const w2 = (fx * (32768 - fy)) >> 15; // TR
      const w3 = (fx * fy) >> 15;
      const out = (y * targetWidth + x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        target[out + channel] = (source[p0 + channel] * w0 + source[p2 + channel] * w1 +
          source[p1 + channel] * w2 + source[p3 + channel] * w3) >>> 15;
      }
      target[out + 3] = alphaSum === 1020 ? 255 :
        (source[p0 + 3] * w0 + source[p2 + 3] * w1 + source[p1 + 3] * w2 + source[p3 + 3] * w3) >>> 15;
    }
  }
  return target;
}
export function createRfmosSequence(options) {
  exactKeys(options, ['pixels', 'width', 'height', 'duration', 'blocks'], 'Invalid rfmos sequence options');
  const {pixels, width, height, duration, blocks} = options;
  // Additional original modes/defaults are deliberately outside this used-source kernel.
  require(duration === 98 && blocks === 60, 'Unsupported rfmos source parameter vector');
  const length = pixelLength(width, height), owned = ownPixels(pixels, length, 'Invalid rfmos RGBA pixels');
  const rows = [{tick: 0, blockSize: 1, width, height, alpha: 255, pixels: owned}];
  const blockSpan = F(F(blocks) - F(1)), divisor = F(duration);
  let previousSize = 1;
  for (let tick = 1; tick < duration; tick++) {
    const progress = F(F(tick) / divisor);
    const blockSize = Math.trunc(F(F(progress * blockSpan) + F(1)));
    if (blockSize === previousSize) continue;
    const rowWidth = Math.trunc((width - 1 + blockSize) / blockSize) + 1;
    const rowHeight = Math.trunc((height - 1 + blockSize) / blockSize) + 1;
    pixelLength(rowWidth, rowHeight);
    const previous = rows.at(-1);
    // 5ce460 clears every new bitmap; progressive sampling uses previous bitmap.
    const rowPixels = resize(previous.pixels, previous.width, previous.height, rowWidth, rowHeight);
    const alpha = 255 - Math.trunc(F(progress * F(255)));
    rows.push({tick, blockSize, width: rowWidth, height: rowHeight, alpha, pixels: rowPixels});
    previousSize = blockSize;
  }
  const transparent = hasTransparency(owned);
  const sequence = Object.freeze({kind: 'sourceRfmosMode1Sequence', width, height, duration, blocks,
    recordCount: rows.length, lastRecordTick: rows.at(-1).tick, hasTransparency: transparent});
  sequences.set(sequence, {rows, length, transparent});
  return sequence;
}
export function sampleRfmosSequence(sequence, elapsed, options = {}) {
  const privateState = sequences.get(sequence);
  require(privateState, 'Unbranded rfmos sequence');
  require(Number.isSafeInteger(elapsed) && elapsed >= 0 && elapsed <= 0xffffffff, 'Invalid rfmos elapsed tick');
  exactKeys(options, ['destinationPixels', 'firstUpdate', 'previousRecordTick'], 'Invalid rfmos sample options');
  const firstUpdate = options.firstUpdate === undefined ? false : options.firstUpdate;
  require(typeof firstUpdate === 'boolean', 'Invalid rfmos first-update phase');
  let destination;
  if (options.destinationPixels !== undefined) destination = ownPixels(options.destinationPixels, privateState.length,
    'Invalid rfmos destination RGBA pixels');
  const {rows} = privateState;
  if (options.previousRecordTick !== undefined) require(Number.isInteger(options.previousRecordTick) &&
    rows.some(row => row.tick === options.previousRecordTick), 'Invalid rfmos previous record tick');
  let index = 0;
  // Source lastRecord == -1 skips lookup and selects record 0 for the first update.
  // Otherwise scanning off the table returns alpha 0 before updating texture bytes.
  if (!firstUpdate) {
    if (elapsed >= rows.at(-1).tick) return Object.freeze({pixels: null, width: sequence.width,
      height: sequence.height, vertexAlpha: 0, alpha: 0, textureUpdated: false, recordIndex: null, recordTick: null,
      blockSize: null, finished: elapsed >= sequence.duration, firstUpdate});
    while (index + 1 < rows.length && rows[index + 1].tick <= elapsed) index++;
  }
  const row = rows[index];
  if (!firstUpdate && options.previousRecordTick === row.tick) return Object.freeze({pixels: null,
    width: sequence.width, height: sequence.height, vertexAlpha: row.alpha, alpha: row.alpha, textureUpdated: false,
    recordIndex: index, recordTick: row.tick, blockSize: row.blockSize,
    bitmapWidth: row.width, bitmapHeight: row.height, finished: elapsed >= sequence.duration, firstUpdate});
  const resizes = row.width !== sequence.width || row.height !== sequence.height;
  require(!resizes || !privateState.transparent || destination !== undefined,
    'Transparent rfmos expansion requires explicit previous destination pixels');
  const output = resize(row.pixels, row.width, row.height, sequence.width, sequence.height, destination);
  return Object.freeze({pixels: output, width: sequence.width, height: sequence.height,
    vertexAlpha: row.alpha, alpha: row.alpha, textureUpdated: true, recordIndex: index, recordTick: row.tick,
    blockSize: row.blockSize, bitmapWidth: row.width, bitmapHeight: row.height,
    finished: elapsed >= sequence.duration, firstUpdate});
}
