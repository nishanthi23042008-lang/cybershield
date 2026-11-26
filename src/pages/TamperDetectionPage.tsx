import React, { useEffect, useState } from 'react';
import { ScanEye, GitCompare, AlertTriangle, RefreshCw, SlidersHorizontal } from 'lucide-react';
import { apiRequest, fetchAuthorizedBlobUrl } from '../api';
import type { DocumentSummary, ReferenceDocumentRow } from '../types';

interface TamperDetectionPageProps {
  token: string;
  selectedDocId: number | null;
  onSelectDocId: (id: number) => void;
}

interface VisualRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  meanEla: number;
  maxEla: number;
  noiseVariance: number;
  reason: string;
}

interface VisualData {
  applicable: boolean;
  imageWidth: number | null;
  imageHeight: number | null;
  dhash: string | null;
  meanEla: number | null;
  maxEla: number | null;
  stdEla: number | null;
  noiseVarianceMean: number | null;
  suspiciousRegions: VisualRegion[];
  summary: string;
  disclaimer: string;
}

interface ComparisonResponse {
  sourceLabel: string;
  targetLabel: string;
  textSimilarity: number;
  tfidfSimilarity: number;
  imageSimilarity: number | null;
  changedLines: Array<{
    lineNumber: number;
    changeType: 'ADDED' | 'REMOVED' | 'MODIFIED';
    originalText: string;
    modifiedText: string;
    fieldHint: string | null;
  }>;
  diffSummary: string;
}

function jetColorMap(norm: number): [number, number, number] {
  const v = Math.max(0, Math.min(1, norm));
  const r = Math.round(255 * Math.max(0, Math.min(1, 1.5 - Math.abs(4 * v - 3))));
  const g = Math.round(255 * Math.max(0, Math.min(1, 1.5 - Math.abs(4 * v - 2))));
  const b = Math.round(255 * Math.max(0, Math.min(1, 1.5 - Math.abs(4 * v - 1))));
  return [r, g, b];
}

async function computeInteractiveElaFromBlobUrl(
  imageUrl: string,
  gain: number
): Promise<{
  heatmapDataUrl: string;
  overlayDataUrl: string;
  regions: VisualRegion[];
} | null> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Image decode failed'));
    el.src = imageUrl;
  });

  const maxDim = 880;
  const scale = Math.min(1, maxDim / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
  const w = Math.max(32, Math.round((img.naturalWidth || 1) * scale));
  const h = Math.max(32, Math.round((img.naturalHeight || 1) * scale));

  const origCanvas = document.createElement('canvas');
  origCanvas.width = w;
  origCanvas.height = h;
  const origCtx = origCanvas.getContext('2d');
  if (!origCtx) return null;
  origCtx.fillStyle = '#ffffff';
  origCtx.fillRect(0, 0, w, h);
  origCtx.drawImage(img, 0, 0, w, h);
  const origData = origCtx.getImageData(0, 0, w, h);

  // Re-encode at JPEG quality 0.90 to compute real Error Level Analysis residuals
  const q90DataUrl = origCanvas.toDataURL('image/jpeg', 0.9);
  const recompImg = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Recompression decode failed'));
    el.src = q90DataUrl;
  });

  const recompCanvas = document.createElement('canvas');
  recompCanvas.width = w;
  recompCanvas.height = h;
  const recompCtx = recompCanvas.getContext('2d');
  if (!recompCtx) return null;
  recompCtx.drawImage(recompImg, 0, 0, w, h);
  const recompData = recompCtx.getImageData(0, 0, w, h);

  const pixelDiff = new Float32Array(w * h);
  let sumDiff = 0;
  for (let i = 0; i < w * h; i++) {
    const k = i * 4;
    const d =
      (Math.abs(origData.data[k] - recompData.data[k]) +
        Math.abs(origData.data[k + 1] - recompData.data[k + 1]) +
        Math.abs(origData.data[k + 2] - recompData.data[k + 2])) /
      3;
    pixelDiff[i] = d;
    sumDiff += d;
  }

  const meanEla = sumDiff / Math.max(1, w * h);
  let sqSum = 0;
  for (let i = 0; i < pixelDiff.length; i++) {
    const delta = pixelDiff[i] - meanEla;
    sqSum += delta * delta;
  }
  const stdEla = Math.sqrt(sqSum / Math.max(1, w * h));

  const heatmapCanvas = document.createElement('canvas');
  heatmapCanvas.width = w;
  heatmapCanvas.height = h;
  const heatCtx = heatmapCanvas.getContext('2d');
  if (!heatCtx) return null;
  const heatImgData = heatCtx.createImageData(w, h);

  // Adaptive scale controlled by user gain slider (default ~10x)
  const effectiveMax = Math.max(2.5, (meanEla + 2.8 * stdEla) * (10 / Math.max(1, gain)));
  for (let i = 0; i < pixelDiff.length; i++) {
    const linear = Math.min(1, pixelDiff[i] / effectiveMax);
    const boosted = linear > 0 ? Math.pow(linear, 0.58) : 0;
    const [r, g, b] = jetColorMap(boosted);
    const k = i * 4;
    heatImgData.data[k] = r;
    heatImgData.data[k + 1] = g;
    heatImgData.data[k + 2] = b;
    heatImgData.data[k + 3] = 255;
  }
  heatCtx.putImageData(heatImgData, 0, 0);

  // Detect localized block hotspots (24x24)
  const blockSize = 24;
  const hotPixelCutoff = Math.max(2.8, meanEla + 1.8 * stdEla);
  const blockCutoff = Math.max(2.0, meanEla * 2.1, meanEla + 1.15 * stdEla);
  const regions: VisualRegion[] = [];

  for (let by = 0; by + blockSize <= h; by += blockSize) {
    for (let bx = 0; bx + blockSize <= w; bx += blockSize) {
      let bSum = 0;
      let bMax = 0;
      let hotPixels = 0;
      let lumSum = 0;
      let lumSqSum = 0;
      const count = blockSize * blockSize;

      for (let py = by; py < by + blockSize; py++) {
        for (let px = bx; px < bx + blockSize; px++) {
          const idx = py * w + px;
          const d = pixelDiff[idx];
          bSum += d;
          if (d > bMax) bMax = d;
          if (d > hotPixelCutoff) hotPixels++;
          const rk = idx * 4;
          const lum =
            0.299 * origData.data[rk] + 0.587 * origData.data[rk + 1] + 0.114 * origData.data[rk + 2];
          lumSum += lum;
          lumSqSum += lum * lum;
        }
      }

      const bMean = bSum / count;
      const lumMean = lumSum / count;
      const noiseVar = Math.max(0, lumSqSum / count - lumMean * lumMean);

      if (bMean > blockCutoff && bMax >= 5.5 && hotPixels >= 10) {
        regions.push({
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

  regions.sort((a, b) => b.meanEla - a.meanEla);
  const topRegions = regions.slice(0, 12);

  // Draw crisp overlay canvas with highlighted hotspot boxes
  const overlayCanvas = document.createElement('canvas');
  overlayCanvas.width = w;
  overlayCanvas.height = h;
  const overCtx = overlayCanvas.getContext('2d');
  if (!overCtx) return null;
  overCtx.drawImage(origCanvas, 0, 0);
  overCtx.lineWidth = 2;
  for (const reg of topRegions) {
    overCtx.fillStyle = 'rgba(220, 38, 38, 0.16)';
    overCtx.fillRect(reg.x, reg.y, reg.width, reg.height);
    overCtx.strokeStyle = '#dc2626';
    overCtx.strokeRect(reg.x, reg.y, reg.width, reg.height);
  }

  return {
    heatmapDataUrl: heatmapCanvas.toDataURL('image/png'),
    overlayDataUrl: overlayCanvas.toDataURL('image/png'),
    regions: topRegions,
  };
}

export const TamperDetectionPage: React.FC<TamperDetectionPageProps> = ({
  token,
  selectedDocId,
  onSelectDocId,
}) => {
  const [docs, setDocs] = useState<DocumentSummary[]>([]);
  const [refs, setRefs] = useState<ReferenceDocumentRow[]>([]);
  const [visual, setVisual] = useState<VisualData | null>(null);
  const [origUrl, setOrigUrl] = useState<string | null>(null);
  const [heatmapUrl, setHeatmapUrl] = useState<string | null>(null);
  const [overlayUrl, setOverlayUrl] = useState<string | null>(null);

  const [interactiveHeatmapUrl, setInteractiveHeatmapUrl] = useState<string | null>(null);
  const [interactiveOverlayUrl, setInteractiveOverlayUrl] = useState<string | null>(null);
  const [interactiveRegions, setInteractiveRegions] = useState<VisualRegion[]>([]);
  const [elaGain, setElaGain] = useState<number>(10);
  const [viewMode, setViewMode] = useState<'interactive' | 'server'>('interactive');
  const [rescanning, setRescanning] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);

  const [targetMode, setTargetMode] = useState<'ref' | 'doc'>('ref');
  const [targetRefId, setTargetRefId] = useState<number | ''>('');
  const [targetDocId, setTargetDocId] = useState<number | ''>('');
  const [comparison, setComparison] = useState<ComparisonResponse | null>(null);
  const [comparing, setComparing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      apiRequest<{ documents: DocumentSummary[] }>('/api/documents', token),
      apiRequest<{ references: ReferenceDocumentRow[] }>('/api/references', token),
    ])
      .then(([docRes, refRes]) => {
        setDocs(docRes.documents);
        setRefs(refRes.references);
        if (!selectedDocId && docRes.documents.length > 0) {
          onSelectDocId(docRes.documents[0].id);
        }
        if (refRes.references.length > 0) {
          setTargetRefId(refRes.references[0].id);
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load documents.'));
  }, [token]);

  useEffect(() => {
    if (!selectedDocId) return;
    let active = true;
    const urlsToRevoke: string[] = [];

    apiRequest<{
      document: DocumentSummary;
      analysis: { visual_findings_json: string; heatmap_path: string | null; overlay_path: string | null } | null;
    }>(`/api/documents/${selectedDocId}`, token)
      .then(async (res) => {
        if (!active) return;
        const v = res.analysis?.visual_findings_json
          ? (JSON.parse(res.analysis.visual_findings_json) as VisualData)
          : null;
        setVisual(v);
        setOrigUrl(null);
        setHeatmapUrl(null);
        setOverlayUrl(null);
        setInteractiveHeatmapUrl(null);
        setInteractiveOverlayUrl(null);
        setInteractiveRegions([]);

        const ext = (res.document.file_extension || '').toLowerCase();
        const isRaster = ext === '.jpg' || ext === '.jpeg' || ext === '.png';
        if (v?.applicable && isRaster) {
          const [uOrig, uHeat, uOver] = await Promise.all([
            fetchAuthorizedBlobUrl(`/api/documents/${selectedDocId}/file`, token).catch(() => null),
            res.analysis?.heatmap_path
              ? fetchAuthorizedBlobUrl(`/api/documents/${selectedDocId}/visual/heatmap`, token).catch(() => null)
              : Promise.resolve(null),
            res.analysis?.overlay_path
              ? fetchAuthorizedBlobUrl(`/api/documents/${selectedDocId}/visual/overlay`, token).catch(() => null)
              : Promise.resolve(null),
          ]);
          if (!active) {
            [uOrig, uHeat, uOver].forEach((u) => {
              if (u) URL.revokeObjectURL(u);
            });
            return;
          }
          if (uOrig) {
            urlsToRevoke.push(uOrig);
            setOrigUrl(uOrig);
          }
          if (uHeat) {
            urlsToRevoke.push(uHeat);
            setHeatmapUrl(uHeat);
          }
          if (uOver) {
            urlsToRevoke.push(uOver);
            setOverlayUrl(uOver);
          }
        }
      })
      .catch((err) => {
        if (active) {
          setError(err instanceof Error ? err.message : 'Unable to load visual inspection details.');
        }
      });

    return () => {
      active = false;
      urlsToRevoke.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [selectedDocId, token, reloadNonce]);

  useEffect(() => {
    if (!origUrl) return;
    let cancelled = false;
    computeInteractiveElaFromBlobUrl(origUrl, elaGain)
      .then((res) => {
        if (cancelled || !res) return;
        setInteractiveHeatmapUrl(res.heatmapDataUrl);
        setInteractiveOverlayUrl(res.overlayDataUrl);
        setInteractiveRegions(res.regions);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [origUrl, elaGain]);

  const handleRerunVisual = async () => {
    if (!selectedDocId) return;
    setRescanning(true);
    setError(null);
    try {
      await apiRequest(`/api/documents/${selectedDocId}/analyze`, token, { method: 'POST' });
      setReloadNonce((n) => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to recompute visual scan.');
    } finally {
      setRescanning(false);
    }
  };

  const handleCompare = async () => {
    if (!selectedDocId) return;
    setComparing(true);
    setError(null);
    try {
      const payload =
        targetMode === 'ref'
          ? { sourceDocId: selectedDocId, targetRefId: Number(targetRefId) }
          : { sourceDocId: selectedDocId, targetDocId: Number(targetDocId) };
      const res = await apiRequest<ComparisonResponse>('/api/compare', token, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setComparison(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Comparison failed.');
    } finally {
      setComparing(false);
    }
  };

  const displayHeatmapUrl =
    viewMode === 'interactive' ? interactiveHeatmapUrl || heatmapUrl : heatmapUrl || interactiveHeatmapUrl;
  const displayOverlayUrl =
    viewMode === 'interactive' ? interactiveOverlayUrl || overlayUrl : overlayUrl || interactiveOverlayUrl;
  const displayRegions =
    viewMode === 'interactive' && interactiveRegions.length > 0
      ? interactiveRegions
      : visual?.suspiciousRegions && visual.suspiciousRegions.length > 0
      ? visual.suspiciousRegions
      : interactiveRegions;

  return (
    <div className="space-y-6">
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-900 flex items-start gap-2.5">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
        <div>
          <span className="font-bold">Explainable Visual Inspection Caveat:</span> Error Level Analysis (ELA), noise variance, and compression inconsistencies highlight regions whose re-compression behavior differs from the surrounding page. Legitimate scanning, resizing, and PDF-to-image conversion can produce similar patterns and never independently prove forgery.
        </div>
      </div>

      {error && (
        <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800">{error}</div>
      )}

      {/* Visual Inspection & Heatmap Section */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <ScanEye className="w-5 h-5 text-blue-600" />
            <h2 className="text-base font-bold text-slate-900">Visual ELA &amp; Region Inspection</h2>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedDocId || ''}
              onChange={(e) => onSelectDocId(Number(e.target.value))}
              className="px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white max-w-md"
            >
              {docs.map((d) => (
                <option key={d.id} value={d.id}>
                  #{d.id} — {d.original_filename} ({d.file_extension.toUpperCase()})
                </option>
              ))}
            </select>

            {visual?.applicable && (
              <button
                type="button"
                disabled={rescanning}
                onClick={handleRerunVisual}
                className="px-3 py-2 text-xs font-semibold border border-slate-300 rounded-lg bg-white hover:bg-slate-50 text-slate-700 flex items-center gap-1.5 disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${rescanning ? 'animate-spin' : ''}`} />
                {rescanning ? 'Recomputing...' : 'Recompute ELA'}
              </button>
            )}
          </div>
        </div>

        {!visual ? (
          <p className="text-xs text-slate-500">Select an analyzed document to view visual inspection results.</p>
        ) : !visual.applicable ? (
          <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-700">
            {visual.summary}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <span className="text-slate-500 block">Dimensions</span>
                <span className="font-mono-tabular font-bold text-slate-900">
                  {visual.imageWidth} x {visual.imageHeight}
                </span>
              </div>
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <span className="text-slate-500 block">Mean / Max ELA</span>
                <span className="font-mono-tabular font-bold text-slate-900">
                  {visual.meanEla} / {visual.maxEla}
                </span>
              </div>
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <span className="text-slate-500 block">Noise Variance Mean</span>
                <span className="font-mono-tabular font-bold text-slate-900">{visual.noiseVarianceMean}</span>
              </div>
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <span className="text-slate-500 block">Perceptual dHash</span>
                <span className="font-mono-tabular font-bold text-slate-900">{visual.dhash}</span>
              </div>
            </div>

            {/* Interactive Heatmap Controls & Jet Scale Legend */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-3.5 bg-slate-50 border border-slate-200 rounded-lg text-xs">
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-2">
                  <SlidersHorizontal className="w-4 h-4 text-blue-600" />
                  <span className="font-semibold text-slate-700">ELA Gain:</span>
                  <input
                    type="range"
                    min={2}
                    max={25}
                    step={1}
                    value={elaGain}
                    onChange={(e) => {
                      setElaGain(Number(e.target.value));
                      setViewMode('interactive');
                    }}
                    aria-label="ELA Heatmap Amplification Gain"
                    className="w-28 accent-blue-600"
                  />
                  <span className="font-mono-tabular font-bold text-slate-900 w-8">{elaGain}x</span>
                </div>

                <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-md p-0.5">
                  <button
                    type="button"
                    onClick={() => setViewMode('interactive')}
                    className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-colors ${
                      viewMode === 'interactive'
                        ? 'bg-blue-600 text-white'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Enhanced ELA
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode('server')}
                    className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-colors ${
                      viewMode === 'server'
                        ? 'bg-blue-600 text-white'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Saved Artifact
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[11px] text-slate-500">Low Residual</span>
                <div
                  className="w-28 h-2.5 rounded-sm border border-slate-300"
                  style={{
                    background:
                      'linear-gradient(to right, #000080, #0040ff, #00ffff, #00ff00, #ffff00, #ff0000)',
                  }}
                />
                <span className="text-[11px] text-slate-500">High Residual</span>
              </div>
            </div>

            <p className="text-xs text-slate-700">{visual.summary}</p>

            {/* Side-by-Side Original / Overlay / Heatmap */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="border border-slate-200 rounded-lg p-3 bg-slate-50">
                <p className="text-xs font-semibold text-slate-700 mb-2">1. Original Uploaded Image</p>
                {origUrl ? (
                  <img
                    src={origUrl}
                    alt="Original uploaded document"
                    className="w-full rounded border border-slate-200 object-contain max-h-72 bg-white"
                  />
                ) : (
                  <div className="h-48 flex items-center justify-center text-xs text-slate-400">Preview unavailable</div>
                )}
              </div>

              <div className="border border-slate-200 rounded-lg p-3 bg-slate-50">
                <p className="text-xs font-semibold text-slate-700 mb-2">2. Suspicious Region Overlay</p>
                {displayOverlayUrl ? (
                  <img
                    src={displayOverlayUrl}
                    alt="Suspicious region bounding boxes"
                    className="w-full rounded border border-slate-200 object-contain max-h-72 bg-white"
                  />
                ) : (
                  <div className="h-48 flex items-center justify-center text-xs text-slate-400">Overlay unavailable</div>
                )}
              </div>

              <div className="border border-slate-200 rounded-lg p-3 bg-slate-50">
                <p className="text-xs font-semibold text-slate-700 mb-2">3. Error Level Analysis Heatmap</p>
                {displayHeatmapUrl ? (
                  <img
                    src={displayHeatmapUrl}
                    alt="ELA jet heatmap"
                    className="w-full rounded border border-slate-200 object-contain max-h-72 bg-white"
                  />
                ) : (
                  <div className="h-48 flex items-center justify-center text-xs text-slate-400">Heatmap unavailable</div>
                )}
              </div>
            </div>

            {displayRegions.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-t border-slate-200">
                  <thead>
                    <tr className="text-slate-500 border-b border-slate-200">
                      <th className="py-2 pr-3">Region Box (x, y, w, h)</th>
                      <th className="py-2 pr-3 text-right">Block Mean ELA</th>
                      <th className="py-2 pr-3 text-right">Noise Variance</th>
                      <th className="py-2">Explanation</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {displayRegions.map((r, i) => (
                      <tr key={i}>
                        <td className="py-2 pr-3 font-mono-tabular">
                          ({r.x}, {r.y}, {r.width}x{r.height})
                        </td>
                        <td className="py-2 pr-3 text-right font-mono-tabular font-semibold text-red-700">{r.meanEla}</td>
                        <td className="py-2 pr-3 text-right font-mono-tabular">{r.noiseVariance}</td>
                        <td className="py-2 text-slate-600">{r.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      {/* Side-by-Side Text & Diff Comparison */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-2">
          <GitCompare className="w-5 h-5 text-blue-600" />
          <h2 className="text-base font-bold text-slate-900">Side-by-Side Document &amp; Changed-Text Comparison</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Compare Against</label>
            <select
              value={targetMode}
              onChange={(e) => setTargetMode(e.target.value as 'ref' | 'doc')}
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
            >
              <option value="ref">Reference Dataset Record</option>
              <option value="doc">Previously Uploaded Document</option>
            </select>
          </div>

          <div className="md:col-span-2">
            <label className="block text-xs font-semibold text-slate-700 mb-1">Baseline Target</label>
            {targetMode === 'ref' ? (
              <select
                value={targetRefId}
                onChange={(e) => setTargetRefId(Number(e.target.value))}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
              >
                {refs.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.ref_code} — {r.category} ({r.supplier_name})
                  </option>
                ))}
              </select>
            ) : (
              <select
                value={targetDocId}
                onChange={(e) => setTargetDocId(Number(e.target.value))}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
              >
                <option value="">Select target upload...</option>
                {docs
                  .filter((d) => d.id !== selectedDocId)
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      #{d.id} — {d.original_filename}
                    </option>
                  ))}
              </select>
            )}
          </div>

          <button
            type="button"
            disabled={comparing || !selectedDocId || (targetMode === 'doc' && !targetDocId) || (targetMode === 'ref' && !targetRefId)}
            onClick={handleCompare}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white text-xs font-semibold rounded-lg"
          >
            {comparing ? 'Comparing...' : 'Run Line-Level Diff'}
          </button>
        </div>

        {comparison && (
          <div className="pt-4 border-t border-slate-200 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
              <span className="font-semibold text-slate-900">{comparison.diffSummary}</span>
              <span className="font-mono-tabular text-slate-600">
                TF-IDF: {(comparison.tfidfSimilarity * 100).toFixed(1)}% · Token:{' '}
                {(comparison.textSimilarity * 100).toFixed(1)}%
                {comparison.imageSimilarity != null
                  ? ` · ImageHash: ${(comparison.imageSimilarity * 100).toFixed(1)}%`
                  : ''}
              </span>
            </div>

            {comparison.changedLines.length === 0 ? (
              <div className="p-4 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800">
                Extracted text lines are identical between {comparison.sourceLabel} and {comparison.targetLabel}.
              </div>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {comparison.changedLines.map((c, idx) => (
                  <div
                    key={idx}
                    className={`p-3 rounded-lg border text-xs ${
                      c.changeType === 'MODIFIED'
                        ? 'bg-amber-50 border-amber-200'
                        : c.changeType === 'ADDED'
                        ? 'bg-blue-50 border-blue-200'
                        : 'bg-red-50 border-red-200'
                    }`}
                  >
                    <div className="flex items-center justify-between font-semibold mb-1">
                      <span>
                        Line {c.lineNumber} · {c.changeType}
                        {c.fieldHint ? ` · ${c.fieldHint}` : ''}
                      </span>
                    </div>
                    {c.originalText && (
                      <div className="font-mono-tabular text-red-800 line-through decoration-red-500">
                        - {c.originalText}
                      </div>
                    )}
                    {c.modifiedText && (
                      <div className="font-mono-tabular text-slate-900 underline decoration-blue-600 font-semibold">
                        + {c.modifiedText}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
