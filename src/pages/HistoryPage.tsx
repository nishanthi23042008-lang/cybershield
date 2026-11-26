import React, { useEffect, useState } from 'react';
import { History, Search, RefreshCw, ArrowUpRight } from 'lucide-react';
import { apiRequest } from '../api';
import { RiskBadge } from '../components/RiskBadge';
import type { NavPage } from '../types';

interface HistoryPageProps {
  token: string;
  onNavigate: (page: NavPage, docId?: number) => void;
}

interface ScanHistoryRow {
  id: number;
  document_id: number;
  user_id: number;
  action: string;
  risk_category: 'GREEN' | 'YELLOW' | 'RED' | null;
  risk_score: number | null;
  summary: string;
  created_at: string;
  original_filename: string;
  username: string;
}

export const HistoryPage: React.FC<HistoryPageProps> = ({ token, onNavigate }) => {
  const [rows, setRows] = useState<ScanHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('ALL');

  const loadHistory = () => {
    setLoading(true);
    setError(null);
    apiRequest<{ history: ScanHistoryRow[] }>('/api/history', token)
      .then((res) => setRows(res.history))
      .catch((err) => setError(err instanceof Error ? err.message : 'Unable to load scan history.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadHistory();
  }, [token]);

  const actions = Array.from(new Set(rows.map((r) => r.action)));
  const filtered = rows.filter((row) => {
    if (actionFilter !== 'ALL' && row.action !== actionFilter) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      return (
        row.original_filename.toLowerCase().includes(q) ||
        row.summary.toLowerCase().includes(q) ||
        row.username.toLowerCase().includes(q) ||
        String(row.document_id).includes(q)
      );
    }
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">Document Scan & Audit Timeline</h2>
            <p className="text-xs text-slate-500 mt-1">
              Chronological record of document uploads, automated analyses, and human review updates.
            </p>
          </div>
          <button
            type="button"
            onClick={loadHistory}
            disabled={loading}
            className="px-3.5 py-2 border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg flex items-center gap-1.5 whitespace-nowrap self-start md:self-auto"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        <div className="mt-5 flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search filename, summary, user, or doc ID..."
              className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
            />
          </div>
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            aria-label="Filter by event action"
            className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
          >
            <option value="ALL">All Event Types</option>
            {actions.map((act) => (
              <option key={act} value={act}>
                {act}
              </option>
            ))}
          </select>
        </div>

        {error && (
          <div className="mt-4 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
            {error}
          </div>
        )}

        <div className="mt-5 overflow-x-auto">
          {loading && rows.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-500">Loading scan history...</div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center border border-dashed border-slate-200 rounded-lg">
              <History className="w-8 h-8 text-slate-400 mx-auto mb-2" />
              <p className="text-sm font-medium text-slate-700">No matching scan events found</p>
              <p className="text-xs text-slate-500 mt-1">
                Upload a document or adjust your search filters to inspect prior activity.
              </p>
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                  <th className="py-2.5 pr-4">Document</th>
                  <th className="py-2.5 pr-4">Event</th>
                  <th className="py-2.5 pr-4">Risk Outcome</th>
                  <th className="py-2.5 pr-4">Summary</th>
                  <th className="py-2.5 pr-4">Actor</th>
                  <th className="py-2.5 text-right">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filtered.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50">
                    <td className="py-3 pr-4">
                      <button
                        type="button"
                        onClick={() => onNavigate('analysis', row.document_id)}
                        className="font-medium text-blue-700 hover:underline inline-flex items-center gap-1 text-left"
                      >
                        <span>{row.original_filename}</span>
                        <ArrowUpRight className="w-3.5 h-3.5 shrink-0" />
                      </button>
                      <div className="text-xs text-slate-500 font-mono-tabular">Doc #{row.document_id}</div>
                    </td>
                    <td className="py-3 pr-4 text-xs font-medium text-slate-700 whitespace-nowrap">
                      {row.action}
                    </td>
                    <td className="py-3 pr-4">
                      <RiskBadge category={row.risk_category} score={row.risk_score} />
                    </td>
                    <td className="py-3 pr-4 text-xs text-slate-600 max-w-md">{row.summary}</td>
                    <td className="py-3 pr-4 text-xs text-slate-700 whitespace-nowrap">{row.username}</td>
                    <td className="py-3 text-right text-xs text-slate-500 font-mono-tabular whitespace-nowrap">
                      {row.created_at}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};
