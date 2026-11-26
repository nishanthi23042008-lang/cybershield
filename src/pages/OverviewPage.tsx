import React, { useEffect, useState } from 'react';
import { Upload, Database, ArrowRight, FileSearch } from 'lucide-react';
import { apiRequest } from '../api';
import { RiskBadge } from '../components/RiskBadge';
import type { DashboardStats, NavPage, User } from '../types';

interface OverviewPageProps {
  token: string;
  user: User;
  onNavigate: (page: NavPage, docId?: number) => void;
}

export const OverviewPage: React.FC<OverviewPageProps> = ({ token, user, onNavigate }) => {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadStats = () => {
    setLoading(true);
    setError(null);
    apiRequest<DashboardStats>('/api/dashboard/stats', token)
      .then(setStats)
      .catch((err) => setError(err instanceof Error ? err.message : 'Unable to load dashboard metrics.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadStats();
  }, [token]);

  if (loading && !stats) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 bg-white border border-slate-200 rounded-xl animate-pulse" />
          ))}
        </div>
        <div className="h-64 bg-white border border-slate-200 rounded-xl animate-pulse" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 bg-white border border-red-200 rounded-xl text-sm text-red-700">
        {error}
      </div>
    );
  }

  const s = stats!;

  return (
    <div className="space-y-8">
      {/* Primary Action Banner when Reference Dataset is not yet imported */}
      {s.totalReferences === 0 && (
        <div className="bg-white border border-blue-200 rounded-xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              100-Document Reference Dataset Ready for Ingestion
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              {user.role === 'ADMIN'
                ? 'Import the bundled 101-page fictional reference PDF to populate the 100 individual baseline records (35 Invoices, 15 Receipts, 15 Purchase Orders, 15 Bills, 20 Other Financial Documents).'
                : 'An administrator must import the 100-document fictional reference dataset before template comparison is active.'}
            </p>
          </div>
          {user.role === 'ADMIN' && (
            <button
              type="button"
              onClick={() => onNavigate('references')}
              className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 flex items-center gap-2"
            >
              <Database className="w-4 h-4" />
              Go to Reference Import
            </button>
          )}
        </div>
      )}

      {/* Top KPI Grid — Real Database Counts */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500">Uploaded Documents</p>
          <p className="mt-2 text-3xl font-bold text-slate-900 tabular-nums">{s.totalUploaded}</p>
          <p className="mt-2 text-xs text-slate-500 tabular-nums">
            {s.totalAnalyzed} analyzed · {s.duplicateDocumentsCount} duplicate match(es)
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500">Reference Dataset Records</p>
          <p className="mt-2 text-3xl font-bold text-slate-900 tabular-nums">{s.totalReferences}</p>
          <p className="mt-2 text-xs text-slate-500">Fictional test baseline only</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500">Low Risk / Manual Review</p>
          <p className="mt-2 text-3xl font-bold text-slate-900 tabular-nums">
            <span className="text-emerald-700">{s.lowRiskCount}</span>
            <span className="text-slate-300 mx-2">/</span>
            <span className="text-amber-600">{s.manualReviewCount}</span>
          </p>
          <p className="mt-2 text-xs text-slate-500">Green vs Yellow classifications</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500">High Risk Flagged</p>
          <p className="mt-2 text-3xl font-bold text-red-700 tabular-nums">{s.highRiskCount}</p>
          <p className="mt-2 text-xs text-slate-500">Corroborated anomaly findings</p>
        </div>
      </div>

      {/* Reference Breakdown + Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-bold text-slate-900">Recent Scan Activity</h3>
            <button
              type="button"
              onClick={() => onNavigate('history')}
              className="text-xs font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1 whitespace-nowrap"
            >
              View Full History <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {s.recentScans.length === 0 ? (
            <div className="py-10 text-center border border-dashed border-slate-200 rounded-lg">
              <FileSearch className="w-8 h-8 text-slate-400 mx-auto mb-2" />
              <p className="text-sm font-medium text-slate-700">No documents scanned yet</p>
              <p className="text-xs text-slate-500 mt-1 mb-4">
                Upload a financial document (PDF, JPG, PNG, DOCX) to run the 8-step inspection pipeline.
              </p>
              <button
                type="button"
                onClick={() => onNavigate('upload')}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg transition-colors"
              >
                Upload First Document
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                    <th className="py-2.5 pr-4">Document</th>
                    <th className="py-2.5 pr-4">Action</th>
                    <th className="py-2.5 pr-4">Risk Assessment</th>
                    <th className="py-2.5 text-right">Timestamp</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {s.recentScans.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50">
                      <td className="py-3 pr-4">
                        <button
                          type="button"
                          onClick={() => onNavigate('analysis', row.document_id)}
                          className="font-medium text-blue-700 hover:underline text-left"
                        >
                          {row.original_filename}
                        </button>
                        <div className="text-xs text-slate-500">
                          Doc #{row.document_id} · {row.username}
                        </div>
                      </td>
                      <td className="py-3 pr-4 text-xs text-slate-700">{row.action}</td>
                      <td className="py-3 pr-4">
                        <RiskBadge category={row.risk_category} score={row.risk_score} />
                      </td>
                      <td className="py-3 text-right text-xs text-slate-500 font-mono-tabular whitespace-nowrap">
                        {row.created_at}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-900">Reference Corpus Distribution</h3>
            <p className="text-xs text-slate-500 mt-1">
              Synthetic baseline documents (Fictional Test Data)
            </p>
            <div className="mt-5 space-y-3">
              {s.referenceBreakdown.length === 0 ? (
                <p className="text-xs text-slate-500 py-4">No reference records imported yet.</p>
              ) : (
                s.referenceBreakdown.map((item) => (
                  <div key={item.category} className="flex items-center justify-between text-sm">
                    <span className="text-slate-700">{item.category}</span>
                    <span className="font-mono-tabular font-semibold text-slate-900">{item.count}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="mt-6 pt-5 border-t border-slate-100 space-y-2.5">
            <button
              type="button"
              onClick={() => onNavigate('upload')}
              className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              <Upload className="w-4 h-4" />
              Analyze New Document
            </button>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              Automated assessment only. Human verification is recommended before financial decisions.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
