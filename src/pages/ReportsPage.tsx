import React, { useEffect, useState } from 'react';
import { FileDown, FileSpreadsheet } from 'lucide-react';
import { apiRequest, downloadAuthorizedFile } from '../api';
import type { DocumentSummary } from '../types';

interface ReportsPageProps {
  token: string;
}

interface ReportRow {
  id: number;
  document_id: number;
  report_type: 'PDF' | 'JSON';
  report_hash: string;
  created_at: string;
  original_filename: string;
  generated_by_username: string;
}

export const ReportsPage: React.FC<ReportsPageProps> = ({ token }) => {
  const [docs, setDocs] = useState<DocumentSummary[]>([]);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [docId, setDocId] = useState<number | ''>('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    const [dRes, rRes] = await Promise.all([
      apiRequest<{ documents: DocumentSummary[] }>('/api/documents', token),
      apiRequest<{ reports: ReportRow[] }>('/api/reports', token),
    ]);
    const analyzed = dRes.documents.filter((d) => d.status === 'ANALYZED');
    setDocs(analyzed);
    setReports(rRes.reports);
    if (!docId && analyzed.length > 0) setDocId(analyzed[0].id);
  };

  useEffect(() => {
    loadData().catch((err) => setError(err instanceof Error ? err.message : 'Failed to load reports.'));
  }, [token]);

  const handleGenerate = async (reportType: 'PDF' | 'JSON') => {
    if (!docId) return;
    setGenerating(true);
    setError(null);
    try {
      await apiRequest('/api/reports/generate', token, {
        method: 'POST',
        body: JSON.stringify({ documentId: Number(docId), reportType }),
      });
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Report generation failed.');
    } finally {
      setGenerating(false);
    }
  };

  const handleDownload = async (report: ReportRow) => {
    setError(null);
    try {
      await downloadAuthorizedFile(
        `/api/reports/${report.id}/download`,
        token,
        `docuguard-report-${report.id}.${report.report_type.toLowerCase()}`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="w-5 h-5 text-blue-600" />
          <h2 className="text-base font-bold text-slate-900">Generate Forensic Assessment Reports</h2>
        </div>
        <p className="text-xs text-slate-600">
          Export branded PDF summaries (with embedded ELA heatmaps when applicable) or sanitized machine-readable JSON reports. Access is enforced by document ownership and role permissions.
        </p>

        {error && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">{error}</div>
        )}

        <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
          <select
            value={docId}
            onChange={(e) => setDocId(Number(e.target.value))}
            className="flex-1 max-w-lg px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
          >
            {docs.length === 0 && <option value="">No analyzed documents available</option>}
            {docs.map((d) => (
              <option key={d.id} value={d.id}>
                #{d.id} — {d.original_filename} ({d.risk_category} · {d.risk_score}/100)
              </option>
            ))}
          </select>

          <button
            type="button"
            disabled={generating || !docId}
            onClick={() => handleGenerate('PDF')}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white text-xs font-semibold rounded-lg whitespace-nowrap"
          >
            Generate PDF Report
          </button>
          <button
            type="button"
            disabled={generating || !docId}
            onClick={() => handleGenerate('JSON')}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white text-xs font-semibold rounded-lg whitespace-nowrap"
          >
            Generate JSON Report
          </button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200">
          <h3 className="text-sm font-bold text-slate-900">Generated Reports ({reports.length})</h3>
        </div>
        {reports.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">No reports generated yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                <tr>
                  <th className="py-3 px-4">Report</th>
                  <th className="py-3 px-4">Document</th>
                  <th className="py-3 px-4">Format</th>
                  <th className="py-3 px-4">SHA-256 Integrity Hash</th>
                  <th className="py-3 px-4 text-right">Generated</th>
                  <th className="py-3 px-4 text-right">Download</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {reports.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="py-3 px-4 font-mono-tabular font-semibold text-slate-900">#{r.id}</td>
                    <td className="py-3 px-4 font-medium text-slate-900">
                      #{r.document_id} · {r.original_filename}
                      <div className="text-[11px] text-slate-500">By {r.generated_by_username}</div>
                    </td>
                    <td className="py-3 px-4 font-semibold text-slate-800">{r.report_type}</td>
                    <td className="py-3 px-4 font-mono-tabular text-[11px] text-slate-600">
                      {r.report_hash.slice(0, 20)}...
                    </td>
                    <td className="py-3 px-4 text-right font-mono-tabular text-slate-500 whitespace-nowrap">
                      {r.created_at}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => handleDownload(r)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-md whitespace-nowrap"
                      >
                        <FileDown className="w-3.5 h-3.5" />
                        Download
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
