import React, { useEffect, useState } from 'react';
import { Database, Search, Trash2, Eye, RefreshCw, Plus, FileText } from 'lucide-react';
import { apiRequest, fetchAuthorizedBlobUrl } from '../api';
import { Scanning3DOverlay } from '../components/Scanning3DOverlay';
import type { ReferenceDocumentRow, User } from '../types';

interface ReferencesPageProps {
  token: string;
  user: User;
}

interface ReferenceListResponse {
  datasetNotice: string;
  total: number;
  summary: Array<{ category: string; count: number }>;
  references: ReferenceDocumentRow[];
  importHistory: Array<{
    id: number;
    source_filename: string;
    total_pages: number;
    imported_count: number;
    skipped_count: number;
    failed_count: number;
    category_breakdown_json: string;
    status: string;
    notes: string;
    imported_at: string;
    imported_by_username: string | null;
  }>;
}

interface ImportProgress {
  inProgress: boolean;
  totalPages: number;
  processedPages: number;
  importedCount: number;
  skippedCount: number;
  failedCount: number;
  currentLabel: string;
}

export const ReferencesPage: React.FC<ReferencesPageProps> = ({ token, user }) => {
  const [data, setData] = useState<ReferenceListResponse | null>(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [selectedRef, setSelectedRef] = useState<ReferenceDocumentRow | null>(null);
  const [refPdfUrl, setRefPdfUrl] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

  // Add single reference state
  const [showAddForm, setShowAddForm] = useState(false);
  const [newRefCode, setNewRefCode] = useState('');
  const [newCategory, setNewCategory] = useState('Invoice');
  const [newRefFile, setNewRefFile] = useState<File | null>(null);

  const loadReferences = () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search.trim()) params.set('search', search.trim());
    if (category !== 'ALL') params.set('category', category);
    apiRequest<ReferenceListResponse>(`/api/references?${params.toString()}`, token)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load references.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadReferences();
  }, [token, category]);

  useEffect(() => {
    if (!importing) return;
    const timer = setInterval(() => {
      apiRequest<ImportProgress>('/api/references/progress', token)
        .then(setProgress)
        .catch(() => {});
    }, 600);
    return () => clearInterval(timer);
  }, [importing, token]);

  useEffect(() => {
    return () => {
      if (refPdfUrl) URL.revokeObjectURL(refPdfUrl);
    };
  }, [refPdfUrl]);

  const handleImportBundled = async (forceReimport = false) => {
    setImporting(true);
    setError(null);
    setMessage(null);
    try {
      const res = await apiRequest<{
        totalPages: number;
        importedCount: number;
        skippedCount: number;
        failedCount: number;
        categoryBreakdown: Record<string, number>;
      }>('/api/references/import-default', token, {
        method: 'POST',
        body: JSON.stringify({ forceReimport }),
      });
      setMessage(
        `Processed ${res.totalPages - 1} document pages (cover page skipped): ${res.importedCount} imported, ${res.skippedCount} skipped as existing, ${res.failedCount} failed.`
      );
      loadReferences();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed.');
    } finally {
      setImporting(false);
      setProgress(null);
    }
  };

  const handleInspect = async (ref: ReferenceDocumentRow) => {
    setError(null);
    try {
      const res = await apiRequest<{ reference: ReferenceDocumentRow }>(`/api/references/${ref.id}`, token);
      setSelectedRef(res.reference);
      if (refPdfUrl) URL.revokeObjectURL(refPdfUrl);
      const url = await fetchAuthorizedBlobUrl(`/api/references/${ref.id}/pdf`, token);
      setRefPdfUrl(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to inspect reference document.');
    }
  };

  const handleDelete = async (id: number) => {
    setError(null);
    try {
      await apiRequest(`/api/references/${id}`, token, { method: 'DELETE' });
      setDeleteConfirmId(null);
      if (selectedRef?.id === id) setSelectedRef(null);
      loadReferences();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed.');
    }
  };

  const handleAddSingle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRefFile) return;
    setError(null);
    const fd = new FormData();
    fd.append('refCode', newRefCode);
    fd.append('category', newCategory);
    fd.append('file', newRefFile);
    try {
      await apiRequest('/api/references/add-single', token, { method: 'POST', body: fd });
      setShowAddForm(false);
      setNewRefCode('');
      setNewRefFile(null);
      loadReferences();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add reference document.');
    }
  };

  const isAdmin = user.role === 'ADMIN';

  return (
    <div className="space-y-6">
      <Scanning3DOverlay
        active={importing}
        title="Scanning & Splitting Reference Corpus"
        subtitle={
          progress
            ? `Processing page ${progress.processedPages} of ${progress.totalPages} (${progress.importedCount} imported)...`
            : 'Extracting individual pages, SHA-256 hashes, and categories from the reference PDF...'
        }
      />
      {/* Mandatory Fictional Test Data Warning */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-900">
        <span className="font-bold">FICTIONAL TEST DATA:</span>{' '}
        These reference documents are synthetic samples for OCR evaluation, template similarity testing, and pipeline verification. Never treat fictional reference records as proof of real financial transactions.
      </div>

      {message && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-sm text-emerald-800">
          {message}
        </div>
      )}
      {error && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-red-800">
          {error}
        </div>
      )}

      {/* Admin Import & Controls Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              Reference Document Repository ({data?.total ?? 0} Records)
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Expected 100-document distribution: 35 Invoices · 15 Receipts · 15 Purchase Orders · 15 Bills · 20 Other Financial Documents
            </p>
          </div>

          {isAdmin && (
            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                disabled={importing}
                onClick={() => handleImportBundled(false)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-xs font-semibold rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap"
              >
                <Database className="w-4 h-4" />
                {importing ? 'Importing 100 Pages...' : 'Import 100-Document Reference PDF'}
              </button>
              <button
                type="button"
                disabled={importing}
                onClick={() => handleImportBundled(true)}
                className="px-3.5 py-2 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Safe Re-Import
              </button>
              <button
                type="button"
                onClick={() => setShowAddForm((v) => !v)}
                className="px-3.5 py-2 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Reference
              </button>
            </div>
          )}
        </div>

        {/* Live Import Progress */}
        {importing && progress && (
          <div className="mt-5 p-4 bg-slate-50 border border-slate-200 rounded-lg">
            <div className="flex items-center justify-between text-xs font-medium text-slate-700 mb-2">
              <span>{progress.currentLabel || 'Processing pages...'}</span>
              <span className="font-mono-tabular">
                {progress.processedPages} / {progress.totalPages} pages ({progress.importedCount} imported)
              </span>
            </div>
            <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
              <div
                className="bg-blue-600 h-2 transition-all"
                style={{
                  width: `${progress.totalPages > 0 ? Math.round((progress.processedPages / progress.totalPages) * 100) : 0}%`,
                }}
              />
            </div>
          </div>
        )}

        {/* Category Counts Strip */}
        {data && data.summary.length > 0 && (
          <div className="mt-5 pt-4 border-t border-slate-100 flex flex-wrap gap-6 text-xs">
            {data.summary.map((item) => (
              <div key={item.category} className="flex items-center gap-2">
                <span className="text-slate-500">{item.category}:</span>
                <span className="font-mono-tabular font-bold text-slate-900">{item.count}</span>
              </div>
            ))}
          </div>
        )}

        {/* Add Single Reference Form */}
        {isAdmin && showAddForm && (
          <form onSubmit={handleAddSingle} className="mt-5 pt-5 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Reference Code</label>
              <input
                type="text"
                required
                value={newRefCode}
                onChange={(e) => setNewRefCode(e.target.value)}
                placeholder="DG-INV-9001"
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Category</label>
              <select
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
              >
                <option value="Invoice">Invoice</option>
                <option value="Receipt">Receipt</option>
                <option value="Purchase Order">Purchase Order</option>
                <option value="Bill">Bill</option>
                <option value="Other Financial Document">Other Financial Document</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Single-Page PDF</label>
              <input
                type="file"
                accept=".pdf"
                required
                onChange={(e) => setNewRefFile(e.target.files?.[0] || null)}
                className="w-full text-xs"
              />
            </div>
            <button
              type="submit"
              className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg"
            >
              Save Reference
            </button>
          </form>
        )}
      </div>

      {/* Filter & Search Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col md:flex-row gap-3 items-center justify-between">
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto max-w-full">
          {['ALL', 'Invoice', 'Receipt', 'Purchase Order', 'Bill', 'Other Financial Document'].map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategory(cat)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                category === cat ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {cat === 'ALL' ? 'All Categories' : cat}
            </button>
          ))}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            loadReferences();
          }}
          className="flex items-center gap-2 w-full md:w-80"
        >
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search ref code, supplier, customer..."
              className="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
          <button
            type="submit"
            className="px-3 py-2 bg-slate-900 text-white text-xs font-semibold rounded-lg whitespace-nowrap"
          >
            Filter
          </button>
        </form>
      </div>

      {/* References Table + Inspector Split */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className={`${selectedRef ? 'lg:col-span-2' : 'lg:col-span-3'} bg-white border border-slate-200 rounded-xl overflow-hidden`}>
          {loading ? (
            <div className="p-8 text-center text-sm text-slate-500">Loading reference catalog...</div>
          ) : !data || data.references.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">
              No reference documents match the current filter.
            </div>
          ) : (
            <div className="overflow-x-auto max-h-[540px]">
              <table className="w-full text-left border-collapse">
                <thead className="bg-slate-50 sticky top-0 border-b border-slate-200 text-xs font-semibold text-slate-600">
                  <tr>
                    <th className="py-3 px-4">Ref ID</th>
                    <th className="py-3 px-4">Category</th>
                    <th className="py-3 px-4">Supplier / Customer</th>
                    <th className="py-3 px-4 text-right">Total</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {data.references.map((ref) => (
                    <tr key={ref.id} className="hover:bg-slate-50">
                      <td className="py-2.5 px-4 font-mono-tabular font-semibold text-slate-900 whitespace-nowrap">
                        {ref.ref_code}
                        <div className="text-[11px] font-normal text-slate-500">Page {ref.page_number}</div>
                      </td>
                      <td className="py-2.5 px-4 text-slate-700 whitespace-nowrap">
                        {ref.category}
                        {ref.sub_class && <div className="text-[11px] text-slate-500">{ref.sub_class}</div>}
                      </td>
                      <td className="py-2.5 px-4">
                        <div className="font-medium text-slate-900">{ref.supplier_name || 'N/A'}</div>
                        <div className="text-slate-500">{ref.customer_name || 'N/A'} · {ref.doc_date || ''}</div>
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono-tabular text-slate-900 whitespace-nowrap">
                        {ref.total_amount != null ? `${ref.currency || 'INR'} ${ref.total_amount.toFixed(2)}` : '—'}
                      </td>
                      <td className="py-2.5 px-4 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => handleInspect(ref)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-blue-700 hover:bg-blue-50 rounded-md font-semibold"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          Inspect
                        </button>
                        {isAdmin && (
                          deleteConfirmId === ref.id ? (
                            <button
                              type="button"
                              onClick={() => handleDelete(ref.id)}
                              className="ml-2 px-2 py-1 bg-red-600 text-white rounded-md font-semibold"
                            >
                              Confirm
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setDeleteConfirmId(ref.id)}
                              className="ml-2 inline-flex items-center p-1 text-slate-400 hover:text-red-600"
                              title="Remove reference"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {selectedRef && (
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900 font-mono-tabular">{selectedRef.ref_code}</h3>
                <p className="text-xs text-slate-500">
                  {selectedRef.category} · Page {selectedRef.page_number} · Fictional Test Data
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedRef(null)}
                className="text-xs text-slate-500 hover:text-slate-900"
              >
                Close
              </button>
            </div>

            <div className="text-xs space-y-1.5 border-t border-b border-slate-100 py-3">
              <div>
                <span className="text-slate-500">SHA-256: </span>
                <span className="font-mono-tabular break-all text-slate-800">{selectedRef.sha256_hash}</span>
              </div>
              <div>
                <span className="text-slate-500">Supplier: </span>
                <span className="font-medium text-slate-900">{selectedRef.supplier_name || 'N/A'}</span>
              </div>
              <div>
                <span className="text-slate-500">Customer: </span>
                <span className="font-medium text-slate-900">{selectedRef.customer_name || 'N/A'}</span>
              </div>
            </div>

            {refPdfUrl && (
              <a
                href={refPdfUrl}
                target="_blank"
                rel="noreferrer"
                className="w-full py-2 px-3 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg flex items-center justify-center gap-2"
              >
                <FileText className="w-3.5 h-3.5" />
                Open Extracted Single-Page PDF
              </a>
            )}

            <div>
              <p className="text-xs font-semibold text-slate-700 mb-1.5">Extracted Page Text</p>
              <pre className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-[11px] font-mono-tabular text-slate-700 whitespace-pre-wrap max-h-64 overflow-y-auto">
                {selectedRef.extracted_text}
              </pre>
            </div>
          </div>
        )}
      </div>

      {/* Import History */}
      {data && data.importHistory.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h3 className="text-sm font-bold text-slate-900 mb-3">Reference Import History</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 pr-4">Source File</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4 text-right">Imported</th>
                  <th className="py-2 pr-4 text-right">Skipped</th>
                  <th className="py-2 pr-4 text-right">Failed</th>
                  <th className="py-2 text-right">Imported At</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.importHistory.map((h) => (
                  <tr key={h.id}>
                    <td className="py-2 pr-4 font-medium text-slate-900">{h.source_filename}</td>
                    <td className="py-2 pr-4 text-slate-700">{h.status}</td>
                    <td className="py-2 pr-4 text-right font-mono-tabular">{h.imported_count}</td>
                    <td className="py-2 pr-4 text-right font-mono-tabular">{h.skipped_count}</td>
                    <td className="py-2 pr-4 text-right font-mono-tabular">{h.failed_count}</td>
                    <td className="py-2 text-right font-mono-tabular text-slate-500">{h.imported_at}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
