import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { CONFIG } from '../config.ts';

export interface SuspiciousRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  meanEla: number;
  maxEla: number;
  noiseVariance: number;
  reason: string;
}

export interface VisualAnalysisResult {
  applicable: boolean;
  imageWidth: number | null;
  imageHeight: number | null;
  dhash: string | null;
  meanEla: number | null;
  maxEla: number | null;
  stdEla: number | null;
  noiseVarianceMean: number | null;
  suspiciousRegions: SuspiciousRegion[];
  heatmapFilename: string | null;
  overlayFilename: string | null;
  summary: string;
  disclaimer: string;
}

interface DecodedImage {
  width: number;
  height: number;
  data: Uint8Array; // RGBA
}

function decodeImageBuffer(buffer: Buffer, ext: string): DecodedImage | null {
  if (ext === '.png') {
    const png = PNG.sync.read(buffer);
    return { width: png.width, height: png.height, data: new Uint8Array(png.data) };
  }
  if (ext === '.jpg' || ext === '.jpeg') {
    const decoded = jpeg.decode(buffer, { useTArray: true, formatAsRGBA: true });
    return { width: decoded.width, height: decoded.height, data: new Uint8Array(decoded.data) };
  }
  return null;
}

function resizeBilinearGray(img: DecodedImage, targetW: number, targetH: number): Float32Array {
  const out = new Float32Array(targetW * targetH);
  const scaleX = img.width / targetW;
  const scaleY = img.height / targetH;

  for (let ty = 0; ty < targetH; ty++) {
    const sy = Math.min(img.height - 1, Math.floor(ty * scaleY));
    for (let tx = 0; tx < targetW; tx++) {
      const sx = Math.min(img.width - 1, Math.floor(tx * scaleX));
      const idx = (sy * img.width + sx) * 4;
      const lum = 0.299 * img.data[idx] + 0.587 * img.data[idx + 1] + 0.114 * img.data[idx + 2];
      out[ty * targetW + tx] = lum;
    }
  }
  return out;
}

export function computeDHashFromImage(buffer: Buffer, ext: string): string | null {
  try {
    const img = decodeImageBuffer(buffer, ext);
    if (!img) return null;
    const gray = resizeBilinearGray(img, 9, 8);
    let bits = '';
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const left = gray[y * 9 + x];
        const right = gray[y * 9 + x + 1];
        bits += left > right ? '1' : '0';
      }
    }
    let hex = '';
    for (let i = 0; i < 64; i += 4) {
      hex += Number.parseInt(bits.slice(i, i + 4), 2).toString(16);
    }
    return hex;
  } catch {
    return null;
  }
}

export function computeTextDHashFallback(text: string): string {
  // Deterministic 64-bit structural simhash for non-raster PDFs/DOCX
  const tokens = (text || '').toLowerCase().split(/\s+/).filter(Boolean);
  const v = new Array<number>(64).fill(0);
  for (const tok of tokens) {
    const h = crypto.createHash('md5').update(tok).digest();
    for (let bit = 0; bit < 64; bit++) {
      const byteVal = h[Math.floor(bit / 8)];
      const isSet = (byteVal >> (bit % 8)) & 1;
      v[bit] += isSet ? 1 : -1;
    }
  }
  let hex = '';
  for (let i = 0; i < 64; i += 4) {
    let nibble = 0;
    for (let j = 0; j < 4; j++) {
      if (v[i + j] > 0) nibble |= 1 << (3 - j);
    }
    hex += nibble.toString(16);
  }
  return hex;
}

export function hammingSimilarity(hashA: string | null, hashB: string | null): number | null {
  if (!hashA || !hashB || hashA.length !== hashB.length) return null;
  let diffBits = 0;
  for (let i = 0; i < hashA.length; i++) {
    const a = Number.parseInt(hashA[i], 16);
    const b = Number.parseInt(hashB[i], 16);
    let x = a ^ b;
    while (x) {
      diffBits += x & 1;
      x >>= 1;
    }
  }
  return Number((1 - diffBits / (hashA.length * 4)).toFixed(4));
}

function jetColorMap(norm: number): [number, number, number] {
  const v = Math.max(0, Math.min(1, norm));
  const r = Math.round(255 * Math.max(0, Math.min(1, 1.5 - Math.abs(4 * v - 3))));
  const g = Math.round(255 * Math.max(0, Math.min(1, 1.5 - Math.abs(4 * v - 2))));
  const b = Math.round(255 * Math.max(0, Math.min(1, 1.5 - Math.abs(4 * v - 1))));
  return [r, g, b];
}

function downscaleForAnalysis(img: DecodedImage, maxDim = 900): DecodedImage {
  if (img.width <= maxDim && img.height <= maxDim) return img;
  const scale = maxDim / Math.max(img.width, img.height);
  const w = Math.max(32, Math.round(img.width * scale));
  const h = Math.max(32, Math.round(img.height * scale));
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(img.height - 1, Math.floor(y / scale));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(img.width - 1, Math.floor(x / scale));
      const sIdx = (sy * img.width + sx) * 4;
      const dIdx = (y * w + x) * 4;
      data[dIdx] = img.data[sIdx];
      data[dIdx + 1] = img.data[sIdx + 1];
      data[dIdx + 2] = img.data[sIdx + 2];
      data[dIdx + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

function drawRectOutline(png: PNG, x: number, y: number, w: number, h: number, r: number, g: number, b: number): void {
  const xEnd = Math.min(png.width - 1, x + w);
  const yEnd = Math.min(png.height - 1, y + h);
  for (let t = 0; t < 2; t++) {
    for (let px = x; px <= xEnd; px++) {
      for (const py of [Math.min(png.height - 1, y + t), Math.max(0, yEnd - t)]) {
        const idx = (py * png.width + px) * 4;
        png.data[idx] = r;
        png.data[idx + 1] = g;
        png.data[idx + 2] = b;
        png.data[idx + 3] = 255;
      }
    }
    for (let py = y; py <= yEnd; py++) {
      for (const px of [Math.min(png.width - 1, x + t), Math.max(0, xEnd - t)]) {
        const idx = (py * png.width + px) * 4;
        png.data[idx] = r;
        png.data[idx + 1] = g;
        png.data[idx + 2] = b;
        png.data[idx + 3] = 255;
      }
    }
  }
}

export async function runVisualInspection(
  buffer: Buffer,
  originalFilename: string,
  elaBlockThreshold = 3.8
): Promise<VisualAnalysisResult> {
  const ext = path.extname(originalFilename).toLowerCase();
  const disclaimer =
    'Visual ELA, noise variance, and compression inconsistencies are assistive inspection signals only and do not independently prove document forgery.';

  if (ext !== '.jpg' && ext !== '.jpeg' && ext !== '.png') {
    return {
      applicable: false,
      imageWidth: null,
      imageHeight: null,
      dhash: null,
      meanEla: null,
      maxEla: null,
      stdEla: null,
      noiseVarianceMean: null,
      suspiciousRegions: [],
      heatmapFilename: null,
      overlayFilename: null,
      summary:
        ext === '.pdf'
          ? 'Document is a vector/native PDF container. Pixel-level JPEG Error Level Analysis applies to raster image uploads (JPG/PNG).'
          : 'Document is a DOCX container. Pixel-level raster visual analysis is not applicable.',
      disclaimer,
    };
  }

  const decodedRaw = decodeImageBuffer(buffer, ext);
  if (!decodedRaw) {
    return {
      applicable: false,
      imageWidth: null,
      imageHeight: null,
      dhash: null,
      meanEla: null,
      maxEla: null,
      stdEla: null,
      noiseVarianceMean: null,
      suspiciousRegions: [],
      heatmapFilename: null,
      overlayFilename: null,
      summary: 'Unable to decode raster image for visual inspection.',
      disclaimer,
    };
  }

  const img = downscaleForAnalysis(decodedRaw, 880);
  const dhash = computeDHashFromImage(buffer, ext);

  // Real Error Level Analysis: re-encode as JPEG quality 90 and decode
  const recompressed = jpeg.encode({ width: img.width, height: img.height, data: Buffer.from(img.data) }, 90);
  const recompImg = jpeg.decode(recompressed.data, { useTArray: true, formatAsRGBA: true });

  const pixelDiff = new Float32Array(img.width * img.height);
  let sumDiff = 0;
  let maxDiff = 0;
  for (let i = 0; i < img.width * img.height; i++) {
    const idx = i * 4;
    const dr = Math.abs(img.data[idx] - recompImg.data[idx]);
    const dg = Math.abs(img.data[idx + 1] - recompImg.data[idx + 1]);
    const db = Math.abs(img.data[idx + 2] - recompImg.data[idx + 2]);
    const d = (dr + dg + db) / 3;
    pixelDiff[i] = d;
    sumDiff += d;
    if (d > maxDiff) maxDiff = d;
  }

  const meanEla = sumDiff / pixelDiff.length;
  let sqSum = 0;
  for (let i = 0; i < pixelDiff.length; i++) {
    const delta = pixelDiff[i] - meanEla;
    sqSum += delta * delta;
  }
  const stdEla = Math.sqrt(sqSum / pixelDiff.length);

  // Build heatmap PNG
  const heatmapPng = new PNG({ width: img.width, height: img.height });
  const overlayPng = new PNG({ width: img.width, height: img.height });
  overlayPng.data.set(img.data);

  const scaleNorm = Math.max(4.5, meanEla + 2.6 * stdEla);
  for (let i = 0; i < pixelDiff.length; i++) {
    const linearNorm = Math.min(1, pixelDiff[i] / scaleNorm);
    const boostedNorm = linearNorm > 0 ? Math.pow(linearNorm, 0.58) : 0;
    const [r, g, b] = jetColorMap(boostedNorm);
    const idx = i * 4;
    heatmapPng.data[idx] = r;
    heatmapPng.data[idx + 1] = g;
    heatmapPng.data[idx + 2] = b;
    heatmapPng.data[idx + 3] = 255;
  }

  // Block-level ELA & local noise variance analysis (24x24 blocks)
  const blockSize = 24;
  const blockSuspicious: SuspiciousRegion[] = [];
  const blockVariances: number[] = [];
  const hotPixelCutoff = Math.max(3.2, meanEla + 2.0 * stdEla);

  for (let by = 0; by + blockSize <= img.height; by += blockSize) {
    for (let bx = 0; bx + blockSize <= img.width; bx += blockSize) {
      let bSum = 0;
      let bMax = 0;
      let hotPixels = 0;
      let lumSum = 0;
      let lumSqSum = 0;
      const count = blockSize * blockSize;

      for (let py = by; py < by + blockSize; py++) {
        for (let px = bx; px < bx + blockSize; px++) {
          const pIdx = py * img.width + px;
          const d = pixelDiff[pIdx];
          bSum += d;
          if (d > bMax) bMax = d;
          if (d > hotPixelCutoff) hotPixels++;
          const rgbaIdx = pIdx * 4;
          const lum = 0.299 * img.data[rgbaIdx] + 0.587 * img.data[rgbaIdx + 1] + 0.114 * img.data[rgbaIdx + 2];
          lumSum += lum;
          lumSqSum += lum * lum;
        }
      }

      const bMean = bSum / count;
      const lumMean = lumSum / count;
      const noiseVar = Math.max(0, lumSqSum / count - lumMean * lumMean);
      blockVariances.push(noiseVar);

      const relativeFloor = Math.max(2.1, meanEla * 2.15, Math.min(elaBlockThreshold, meanEla + 1.15 * stdEla));
      const isStrongBlock = bMean > Math.max(elaBlockThreshold, meanEla + 2.0 * stdEla);
      const isLocalizedHotspot = bMean > relativeFloor && bMax >= 6.0 && hotPixels >= 10;

      if (isStrongBlock || isLocalizedHotspot) {
        blockSuspicious.push({
          x: bx,
          y: by,
          width: blockSize,
          height: blockSize,
          meanEla: Number(bMean.toFixed(2)),
          maxEla: Number(bMax.toFixed(2)),
          noiseVariance: Number(noiseVar.toFixed(2)),
          reason: `Local compression residual (${bMean.toFixed(1)}, peak ${bMax.toFixed(1)}) exceeds baseline (${meanEla.toFixed(1)} +/- ${stdEla.toFixed(1)})`,
        });
      }
    }
  }

  // Sort top suspicious blocks and draw bounding boxes on overlay
  blockSuspicious.sort((a, b) => b.meanEla - a.meanEla);
  const topRegions = blockSuspicious.slice(0, 12);
  for (const reg of topRegions) {
    drawRectOutline(overlayPng, reg.x, reg.y, reg.width, reg.height, 220, 38, 38);
  }

  const noiseVarianceMean =
    blockVariances.length > 0
      ? Number((blockVariances.reduce((a, b) => a + b, 0) / blockVariances.length).toFixed(2))
      : 0;

  const stamp = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const heatmapFilename = `ela-heatmap-${stamp}.png`;
  const overlayFilename = `ela-overlay-${stamp}.png`;

  fs.writeFileSync(path.join(CONFIG.HEATMAPS_DIR, heatmapFilename), PNG.sync.write(heatmapPng));
  fs.writeFileSync(path.join(CONFIG.HEATMAPS_DIR, overlayFilename), PNG.sync.write(overlayPng));

  const summary =
    topRegions.length > 0
      ? `Detected ${blockSuspicious.length} local block(s) with elevated Error Level Analysis compression residuals (mean ELA ${meanEla.toFixed(2)}, threshold ${Math.max(elaBlockThreshold, meanEla + 2.4 * stdEla).toFixed(2)}). Review highlighted regions manually.`
      : `No significant local compression anomalies detected above threshold (mean ELA ${meanEla.toFixed(2)}, std ${stdEla.toFixed(2)}).`;

  return {
    applicable: true,
    imageWidth: decodedRaw.width,
    imageHeight: decodedRaw.height,
    dhash,
    meanEla: Number(meanEla.toFixed(3)),
    maxEla: Number(maxDiff.toFixed(3)),
    stdEla: Number(stdEla.toFixed(3)),
    noiseVarianceMean,
    suspiciousRegions: topRegions,
    heatmapFilename,
    overlayFilename,
    summary,
    disclaimer,
  };
}
