import React, { useEffect, useState } from 'react';
import { RefreshCw, FileCheck, AlertTriangle, CheckCircle2, FileDown } from 'lucide-react';
import { apiRequest } from '../api';
import { RiskBadge } from '../components/RiskBadge';
import { Scanning3DOverlay } from '../components/Scanning3DOverlay';
import type { DocumentSummary, NavPage } from '../types';

interface AnalysisPageProps {
  token: string;
  selectedDocId: number | null;
  onSelectDocId: (id: number) => void;
  onNavigate: (page: NavPage, docId?: number) => void;
}

interface DocumentDetailResponse {
  document: DocumentSummary;
  extracted: {
    extraction_method: string;
    raw_text: string;
    supplier_name: string | null;
    customer_name: string | null;
    doc_number: string | null;
    doc_date: string | null;
    due_date: string | null;
    reference_number: string | null;
    currency: string | null;
    subtotal: number | null;
    tax_amount: number | null;
    total_amount: number | null;
    line_items_json: string;
    payment_terms: string | null;
    metadata_json: string;
  } | null;
  analysis: {
    id: number;
    predicted_category: string;
    classification_confidence: number;
    risk_score: number;
    risk_category: 'GREEN' | 'YELLOW' | 'RED';
    risk_summary: string;
    score_factors_json: string;
    visual_findings_json: string;
    consistency_findings_json: string;
    human_review_status: 'PENDING' | 'APPROVED' | 'FLAGGED';
    human_review_notes: string | null;
    analyzed_at: string;
  } | null;
  anomalies: Array<{
    id: number;
    anomaly_type: string;
    severity: string;
    title: string;
    evidence: string;
    score_impact: number;
  }>;
  matches: Array<{
    id: number;
    match_type: string;
    similarity_score: number;
    tfidf_similarity: number;
    text_similarity: number;
    image_similarity: number | null;
    differences_json: string;
    reason: string;
    matched_doc_filename: string | null;
    matched_ref_code: string | null;
  }>;
}

export const AnalysisPage: React.FC<AnalysisPageProps> = ({
  token,
  selectedDocId,
  onSelectDocId,
  onNavigate,
}) => {
  const [docs, setDocs] = useState<DocumentSummary[]>([]);
  const [detail, setDetail] = useState<DocumentDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [reviewStatus, setReviewStatus] = useState<'PENDING' | 'APPROVED' | 'FLAGGED'>('PENDING');
  const [reviewNotes, setReviewNotes] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadList = async () => {
    const res = await apiRequest<{ documents: DocumentSummary[] }>('/api/documents', token);
    setDocs(res.documents);
    if (!selectedDocId && res.documents.length > 0) {
      onSelectDocId(res.documents[0].id);
    }
  };

  const loadDetail = async (id: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<DocumentDetailResponse>(`/api/documents/${id}`, token);
      setDetail(res);
      if (res.analysis) {
        setReviewStatus(res.analysis.human_review_status);
        setReviewNotes(res.analysis.human_review_notes || '');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load analysis details.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadList().catch((err) => setError(err instanceof Error ? err.message : 'Failed to load documents.'));
  }, [token]);

  useEffect(() => {
    if (selectedDocId) {
      loadDetail(selectedDocId);
    } else {
      setLoading(false);
    }
  }, [selectedDocId, token]);

  const handleRerunAnalysis = async () => {
    if (!selectedDocId) return;
    setRunning(true);
    setError(null);
    setMessage(null);
    try {
      await apiRequest(`/api/documents/${selectedDocId}/analyze`, token, { method: 'POST' });
      await loadDetail(selectedDocId);
      await loadList();
      setMessage('Document analysis pipeline completed.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed.');
    } finally {
      setRunning(false);
    }
  };

  const handleSaveReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDocId) return;
    setError(null);
    try {
      await apiRequest(`/api/documents/${selectedDocId}/review`, token, {
        method: 'POST',
        body: JSON.stringify({ status: reviewStatus, notes: reviewNotes }),
      });
      await loadDetail(selectedDocId);
      setMessage(`Human review status updated to ${reviewStatus}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update review.');
    }
  };

  const handleGenerateReport = async (reportType: 'PDF' | 'JSON') => {
    if (!selectedDocId) return;
    setError(null);
    try {
      await apiRequest('/api/reports/generate', token, {
        method: 'POST',
        body: JSON.stringify({ documentId: selectedDocId, reportType }),
      });
      setMessage(`${reportType} report generated. View and download it in the Reports tab.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Report generation failed.');
    }
  };

  if (docs.length === 0 && !loading) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
        <p className="text-sm font-semibold text-slate-900">No uploaded documents available for analysis</p>
        <p className="text-xs text-slate-500 mt-1 mb-4">
          Upload a PDF, image, or DOCX document first to inspect metadata, OCR extraction, and risk scoring.
        </p>
        <button
          type="button"
          onClick={() => onNavigate('upload')}
          className="px-4 py-2 bg-blue-600 text-white text-xs font-semibold rounded-lg"
        >
          Go to Document Upload
        </button>
      </div>
    );
  }

  const parsedMeta = detail?.extracted?.metadata_json ? JSON.parse(detail.extracted.metadata_json) : null;
  const lineItems = detail?.extracted?.line_items_json
    ? (JSON.parse(detail.extracted.line_items_json) as Array<{
        description: string;
        qty: number;
        unit: string;
        unitPrice: number;
        lineTotal: number;
      }>)
    : [];
  const scoreFactors = detail?.analysis?.score_factors_json
    ? JSON.parse(detail.analysis.score_factors_json)
    : null;
  const consistency = detail?.analysis?.consistency_findings_json
    ? (JSON.parse(detail.analysis.consistency_findings_json) as Array<{
        checkName: string;
        status: string;
        details: string;
      }>)
    : [];

  return (
    <div className="space-y-6">
      <Scanning3DOverlay
        active={running}
        title="Re-Running 8-Step Forensic Scan"
        subtitle="Recomputing visual ELA residuals, TF-IDF corpus similarity, and deterministic arithmetic checks..."
      />
      {/* Document Selector Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3 flex-1">
          <label className="text-xs font-semibold text-slate-600 whitespace-nowrap">Inspected Document:</label>
          <select
            value={selectedDocId || ''}
            onChange={(e) => onSelectDocId(Number(e.target.value))}
            className="flex-1 max-w-md px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
          >
            {docs.map((d) => (
              <option key={d.id} value={d.id}>
                #{d.id} — {d.original_filename} ({d.risk_category || d.status})
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={running}
            onClick={handleRerunAnalysis}
            className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 whitespace-nowrap"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${running ? 'animate-spin' : ''}`} />
            {running ? 'Analyzing...' : 'Re-Run Pipeline'}
          </button>
          <button
            type="button"
            onClick={() => handleGenerateReport('PDF')}
            className="px-3.5 py-2 bg-white hover:bg-slate-50 border border-slate-300 text-slate-800 text-xs font-semibold rounded-lg flex items-center gap-1.5 whitespace-nowrap"
          >
            <FileDown className="w-3.5 h-3.5" />
            Generate PDF Report
          </button>
          <button
            type="button"
            onClick={() => handleGenerateReport('JSON')}
            className="px-3.5 py-2 bg-white hover:bg-slate-50 border border-slate-300 text-slate-800 text-xs font-semibold rounded-lg flex items-center gap-1.5 whitespace-nowrap"
          >
            <FileDown className="w-3.5 h-3.5" />
            Generate JSON Report
          </button>
        </div>
      </div>

      {message && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-800">
          {message}
        </div>
      )}
      {error && (
        <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs font-medium text-red-800">
          {error}
        </div>
      )}

      {loading || !detail ? (
        <div className="p-10 bg-white border border-slate-200 rounded-xl text-center text-sm text-slate-500">
          Loading document inspection data...
        </div>
      ) : (
        <>
          {/* Risk Assessment Summary */}
          {detail.analysis && (
            <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-3">
                    <RiskBadge category={detail.analysis.risk_category} score={detail.analysis.risk_score} />
                    <span className="text-xs text-slate-500">
                      Classification: <strong className="text-slate-900">{detail.analysis.predicted_category}</strong>{' '}
                      ({(detail.analysis.classification_confidence * 100).toFixed(1)}% confidence)
                    </span>
                  </div>
                  <p className="mt-2.5 text-sm text-slate-700">{detail.analysis.risk_summary}</p>
                </div>
                <div className="text-xs text-slate-500 font-mono-tabular whitespace-nowrap">
                  Analyzed: {detail.analysis.analyzed_at}
                </div>
              </div>

              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs font-medium text-slate-700">
                Automated assessment only. Human verification is recommended before financial decisions.
              </div>
            </div>
          )}

          {/* Evidence Factors & Consistency Checks */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
              <h3 className="text-sm font-bold text-slate-900">Contributing Risk Evidence</h3>
              {detail.anomalies.length === 0 ? (
                <div className="p-4 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  No negative anomaly indicators were triggered. Note: absence of detected anomalies does not prove authenticity.
                </div>
              ) : (
                <div className="space-y-3">
                  {detail.anomalies.map((a) => (
                    <div key={a.id} className="p-3.5 rounded-lg border border-slate-200 bg-slate-50">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-slate-900">{a.title}</span>
                        <span className="text-xs font-mono-tabular font-semibold text-slate-700">
                          {a.severity} · +{a.score_impact} pts
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-600 leading-relaxed">{a.evidence}</p>
                    </div>
                  ))}
                </div>
              )}

              {scoreFactors?.missingEvidenceNotes?.length > 0 && (
                <div className="pt-2">
                  <p className="text-xs font-semibold text-slate-700 mb-1.5">Missing Evidence Notes (Not Negative Evidence)</p>
                  <ul className="space-y-1 text-xs text-slate-500 list-disc pl-4">
                    {scoreFactors.missingEvidenceNotes.map((n: string, idx: number) => (
                      <li key={idx}>{n}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
              <h3 className="text-sm font-bold text-slate-900">Arithmetic &amp; Cross-Document Consistency</h3>
              <div className="space-y-2.5">
                {consistency.map((c, idx) => (
                  <div key={idx} className="p-3 rounded-lg border border-slate-200">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-900">{c.checkName}</span>
                      <span
                        className={`font-semibold ${
                          c.status === 'FAILED'
                            ? 'text-red-700'
                            : c.status === 'PASSED'
                            ? 'text-emerald-700'
                            : 'text-slate-500'
                        }`}
                      >
                        {c.status}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-600">{c.details}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Hashing, Metadata, Extracted Fields */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
              <h3 className="text-sm font-bold text-slate-900">Step 1 &amp; 2: Metadata &amp; Integrity Hashes</h3>
              <div className="text-xs space-y-2">
                <div>
                  <span className="text-slate-500">SHA-256: </span>
                  <span className="font-mono-tabular break-all text-slate-900">{detail.document.sha256_hash}</span>
                </div>
                <div>
                  <span className="text-slate-500">MD5: </span>
                  <span className="font-mono-tabular break-all text-slate-700">{detail.document.md5_hash}</span>
                </div>
                <div>
                  <span className="text-slate-500">Format &amp; Size: </span>
                  <span className="text-slate-900">
                    {detail.document.file_extension.toUpperCase()} · {detail.document.mime_type} ·{' '}
                    <span className="font-mono-tabular">{detail.document.file_size}</span> bytes
                  </span>
                </div>
              </div>
              {parsedMeta && (
                <>
                  <pre className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-[11px] font-mono-tabular text-slate-700 overflow-x-auto">
                    {JSON.stringify(parsedMeta.formatDetails || {}, null, 2)}
                  </pre>
                  <p className="text-[11px] text-slate-500">{parsedMeta.authenticityCaveat}</p>
                </>
              )}
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
              <h3 className="text-sm font-bold text-slate-900">
                Step 4: Extracted Fields ({detail.extracted?.extraction_method || 'N/A'})
              </h3>
              {detail.extracted ? (
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <span className="text-slate-500 block">Supplier</span>
                    <span className="font-semibold text-slate-900">{detail.extracted.supplier_name || '—'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Customer</span>
                    <span className="font-semibold text-slate-900">{detail.extracted.customer_name || '—'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Document Number</span>
                    <span className="font-mono-tabular font-semibold text-slate-900">
                      {detail.extracted.doc_number || '—'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Document Date / Due</span>
                    <span className="font-mono-tabular text-slate-900">
                      {detail.extracted.doc_date || '—'} / {detail.extracted.due_date || '—'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Subtotal / Tax</span>
                    <span className="font-mono-tabular text-slate-900">
                      {detail.extracted.subtotal ?? '—'} / {detail.extracted.tax_amount ?? '—'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Total Amount</span>
                    <span className="font-mono-tabular font-bold text-slate-900">
                      {detail.extracted.total_amount != null
                        ? `${detail.extracted.currency || ''} ${detail.extracted.total_amount.toFixed(2)}`
                        : '—'}
                    </span>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-slate-500">No extracted text stored.</p>
              )}

              {lineItems.length > 0 && (
                <div className="pt-2 overflow-x-auto">
                  <table className="w-full text-left text-xs border-t border-slate-200">
                    <thead>
                      <tr className="text-slate-500 border-b border-slate-200">
                        <th className="py-1.5 pr-2">Description</th>
                        <th className="py-1.5 pr-2 text-right">Qty</th>
                        <th className="py-1.5 pr-2 text-right">Unit Price</th>
                        <th className="py-1.5 text-right">Line Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {lineItems.map((li, i) => (
                        <tr key={i}>
                          <td className="py-1.5 pr-2 text-slate-800">{li.description}</td>
                          <td className="py-1.5 pr-2 text-right font-mono-tabular">{li.qty}</td>
                          <td className="py-1.5 pr-2 text-right font-mono-tabular">{li.unitPrice.toFixed(2)}</td>
                          <td className="py-1.5 text-right font-mono-tabular font-semibold">{li.lineTotal.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* Reference & Prior Matches + Human Review */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-6 space-y-3">
              <h3 className="text-sm font-bold text-slate-900">
                Step 6 &amp; 7: Reference Dataset &amp; Prior Upload Comparisons
              </h3>
              {detail.matches.length === 0 ? (
                <p className="text-xs text-slate-500">No reference or prior upload matches above threshold.</p>
              ) : (
                <div className="space-y-2.5">
                  {detail.matches.map((m) => (
                    <div key={m.id} className="p-3 border border-slate-200 rounded-lg text-xs">
                      <div className="flex items-center justify-between font-semibold text-slate-900">
                        <span>
                          {m.match_type} · {m.matched_ref_code || m.matched_doc_filename}
                        </span>
                        <span className="font-mono-tabular text-blue-700">
                          {(m.similarity_score * 100).toFixed(1)}% match
                        </span>
                      </div>
                      <p className="mt-1 text-slate-600">{m.reason}</p>
                    </div>
                  ))}
                </div>
              )}

              {detail.extracted?.raw_text && (
                <div className="pt-2">
                  <p className="text-xs font-semibold text-slate-700 mb-1">Full Extracted / OCR Text</p>
                  <pre className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-[11px] font-mono-tabular text-slate-700 max-h-56 overflow-y-auto whitespace-pre-wrap">
                    {detail.extracted.raw_text}
                  </pre>
                </div>
              )}
            </div>

            <form onSubmit={handleSaveReview} className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
              <div className="flex items-center gap-2">
                <FileCheck className="w-4 h-4 text-blue-600" />
                <h3 className="text-sm font-bold text-slate-900">Human Verification Sign-Off</h3>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Review Decision</label>
                <select
                  value={reviewStatus}
                  onChange={(e) => setReviewStatus(e.target.value as 'PENDING' | 'APPROVED' | 'FLAGGED')}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                >
                  <option value="PENDING">Pending Review</option>
                  <option value="APPROVED">Approved After Manual Check</option>
                  <option value="FLAGGED">Flagged / Escalated</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Reviewer Notes</label>
                <textarea
                  rows={4}
                  value={reviewNotes}
                  onChange={(e) => setReviewNotes(e.target.value)}
                  placeholder="Record verification evidence, PO cross-checks, or escalation details..."
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                />
              </div>
              <button
                type="submit"
                className="w-full py-2 px-4 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg"
              >
                Save Human Review
              </button>
              <div className="flex items-start gap-2 text-[11px] text-slate-500">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-600" />
                <span>Automated risk scores support but never replace human financial sign-off.</span>
              </div>
            </form>
          </div>
        </>
      )}
    </div>
  );
};
