import React, { useState } from 'react';
import { UploadCloud, FileCheck2, Beaker, AlertCircle } from 'lucide-react';
import { apiRequest } from '../api';
import { Scanning3DOverlay } from '../components/Scanning3DOverlay';
import type { NavPage } from '../types';

interface UploadPageProps {
  token: string;
  onNavigate: (page: NavPage, docId?: number) => void;
}

export const UploadPage: React.FC<UploadPageProps> = ({ token, onNavigate }) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [autoAnalyze, setAutoAnalyze] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [creatingSample, setCreatingSample] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    documentId: number;
    analysisId: number | null;
    duplicateWarning: string | null;
  } | null>(null);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) {
      setError('Please choose a file first.');
      return;
    }
    if (selectedFile.size > 20 * 1024 * 1024) {
      setError('File exceeds the 20 MB maximum upload limit.');
      return;
    }

    setUploading(true);
    setError(null);
    setResult(null);

    const fd = new FormData();
    fd.append('file', selectedFile);
    fd.append('autoAnalyze', String(autoAnalyze));

    try {
      const res = await apiRequest<{
        documentId: number;
        analysisId: number | null;
        duplicateWarning: string | null;
      }>('/api/documents/upload', token, {
        method: 'POST',
        body: fd,
      });
      setResult(res);
      setSelectedFile(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const handleGenerateSample = async (variant: 'clean' | 'modified_invoice_pdf' | 'tampered_scan_jpg') => {
    setCreatingSample(variant);
    setError(null);
    setResult(null);
    try {
      const res = await apiRequest<{ documentId: number; analysisId: number; originalFilename: string }>(
        '/api/documents/create-test-sample',
        token,
        {
          method: 'POST',
          body: JSON.stringify({ refCode: 'DG-INV-0001', variant }),
        }
      );
      setResult({
        documentId: res.documentId,
        analysisId: res.analysisId,
        duplicateWarning: null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to generate test sample.');
    } finally {
      setCreatingSample(null);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <Scanning3DOverlay
        active={uploading || creatingSample !== null}
        title={uploading ? 'Scanning & Analyzing Document' : 'Generating & Scanning Test Sample'}
        subtitle="Running cryptographic hashing, metadata inspection, visual ELA analysis, text extraction, and consistency verification..."
      />
      <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-6">
        <h2 className="text-lg font-bold text-slate-900">Upload Document for Inspection</h2>
        <p className="mt-1 text-sm text-slate-600">
          Supported formats: PDF, JPG, JPEG, PNG, DOCX (maximum 20 MB per file). Files are validated by extension, MIME type, and binary signature, then stored outside the database.
        </p>

        {error && (
          <div className="mt-4 p-3.5 rounded-lg bg-red-50 border border-red-200 text-xs font-medium text-red-800 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {result && (
          <div className="mt-4 p-4 rounded-lg bg-emerald-50 border border-emerald-200 space-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-emerald-800">
              <FileCheck2 className="w-4 h-4" />
              Document #{result.documentId} uploaded{result.analysisId ? ' and analyzed' : ''}.
            </div>
            {result.duplicateWarning && (
              <p className="text-xs text-amber-800 font-medium">{result.duplicateWarning}</p>
            )}
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                onClick={() => onNavigate('analysis', result.documentId)}
                className="px-3.5 py-1.5 bg-slate-900 text-white text-xs font-semibold rounded-lg"
              >
                Open Analysis Results
              </button>
              <button
                type="button"
                onClick={() => onNavigate('tamper', result.documentId)}
                className="px-3.5 py-1.5 bg-white border border-slate-300 text-slate-800 text-xs font-semibold rounded-lg"
              >
                Inspect Visual &amp; Diff View
              </button>
            </div>
          </div>
        )}

        <form onSubmit={handleUpload} className="mt-6 space-y-5">
          <label className="block border-2 border-dashed border-slate-300 hover:border-blue-500 rounded-xl p-10 text-center cursor-pointer transition-colors bg-slate-50">
            <UploadCloud className="w-10 h-10 text-slate-400 mx-auto mb-3" />
            <span className="block text-sm font-semibold text-slate-800">
              {selectedFile ? selectedFile.name : 'Select a PDF, JPG, JPEG, PNG, or DOCX file'}
            </span>
            <span className="block text-xs text-slate-500 mt-1">
              {selectedFile
                ? `${(selectedFile.size / 1024).toFixed(1)} KB · Ready for signature validation`
                : 'Up to 20 MB · Validated before storage'}
            </span>
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.docx"
              onChange={(e) => {
                setSelectedFile(e.target.files?.[0] || null);
                setError(null);
              }}
              className="hidden"
            />
          </label>

          <label className="flex items-center gap-2.5 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={autoAnalyze}
              onChange={(e) => setAutoAnalyze(e.target.checked)}
              className="rounded border-slate-300 text-blue-600 focus:ring-blue-600"
            />
            Run full 8-step analysis pipeline immediately after upload
          </label>

          <button
            type="submit"
            disabled={uploading || !selectedFile}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white text-sm font-semibold rounded-lg transition-colors"
          >
            {uploading ? 'Validating & Running Pipeline...' : 'Upload & Inspect Document'}
          </button>
        </form>
      </div>

      {/* QA & Demonstration Helper Panel */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Beaker className="w-5 h-5 text-blue-600" />
          <h3 className="text-base font-bold text-slate-900">QA Test Copies</h3>
        </div>
        <p className="text-xs text-slate-600 leading-relaxed">
          Generate isolated test uploads derived from fictional reference <span className="font-mono-tabular font-semibold">DG-INV-0001</span> without modifying the 100 original reference documents.
        </p>

        <div className="space-y-2.5 pt-2">
          <button
            type="button"
            disabled={creatingSample !== null}
            onClick={() => handleGenerateSample('clean')}
            className="w-full text-left p-3 border border-slate-200 hover:border-blue-400 rounded-lg transition-colors"
          >
            <div className="text-xs font-bold text-slate-900">
              {creatingSample === 'clean' ? 'Creating Clean Sample...' : '1. Clean Baseline Invoice Copy (PDF)'}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              Identical copy of DG-INV-0001 to verify baseline arithmetic and SHA-256 reference match.
            </div>
          </button>

          <button
            type="button"
            disabled={creatingSample !== null}
            onClick={() => handleGenerateSample('modified_invoice_pdf')}
            className="w-full text-left p-3 border border-slate-200 hover:border-amber-400 rounded-lg transition-colors"
          >
            <div className="text-xs font-bold text-slate-900">
              {creatingSample === 'modified_invoice_pdf'
                ? 'Creating Modified PDF...'
                : '2. Altered Amounts Invoice Copy (PDF)'}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              Separate test copy with altered subtotal/total to verify arithmetic mismatch and line diff detection.
            </div>
          </button>

          <button
            type="button"
            disabled={creatingSample !== null}
            onClick={() => handleGenerateSample('tampered_scan_jpg')}
            className="w-full text-left p-3 border border-slate-200 hover:border-red-400 rounded-lg transition-colors"
          >
            <div className="text-xs font-bold text-slate-900">
              {creatingSample === 'tampered_scan_jpg'
                ? 'Creating Spliced JPEG...'
                : '3. Spliced Patch Scan Copy (JPG)'}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              Synthetic JPEG with a re-compressed spliced block to demonstrate ELA heatmap &amp; region overlay.
            </div>
          </button>
        </div>
      </div>
    </div>
  );
};
