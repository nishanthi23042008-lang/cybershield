import React, { useEffect, useState } from 'react';
import { CopyCheck } from 'lucide-react';
import { apiRequest } from '../api';
import type { NavPage } from '../types';

interface DuplicatesPageProps {
  token: string;
  onNavigate: (page: NavPage, docId?: number) => void;
}

interface DuplicateRow {
  id: number;
  document_id: number;
  matched_document_id: number | null;
  matched_reference_id: number | null;
  match_type: string;
  similarity_score: number;
  text_similarity: number;
  tfidf_similarity: number;
  image_similarity: number | null;
  differences_json: string;
  reason: string;
  source_filename: string;
  source_sha256: string;
  matched_filename: string | null;
  matched_sha256: string | null;
  matched_ref_code: string | null;
  matched_ref_category: string | null;
  created_at: string;
}

export const DuplicatesPage: React.FC<DuplicatesPageProps> = ({ token, onNavigate }) => {
  const [matches, setMatches] = useState<DuplicateRow[]>([]);
  const [filterType, setFilterType] = useState('ALL');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiRequest<{ matches: DuplicateRow[] }>('/api/duplicates', token)
      .then((res) => setMatches(res.matches))
      .finally(() => setLoading(false));
  }, [token]);

  const filtered =
    filterType === 'ALL' ? matches : matches.filter((m) => m.match_type === filterType);

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <CopyCheck className="w-5 h-5 text-blue-600" />
            <h2 className="text-base font-bold text-slate-900">Duplicate &amp; Near-Duplicate Detection</h2>
          </div>
          <p className="mt-1 text-xs text-slate-600">
            Combines exact SHA-256 hash matching, perceptual image hashing (dHash), and TF-IDF cosine similarity. Thresholds can be tuned in Settings.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
          {['ALL', 'EXACT_HASH', 'NEAR_DUPLICATE', 'CONTENT_SIMILAR', 'REFERENCE_MATCH'].map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setFilterType(t)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap ${
                filterType === t ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {t === 'ALL' ? 'All Matches' : t.replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-slate-500">Loading duplicate matches...</div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">
            No duplicate or near-duplicate matches recorded for this filter.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                <tr>
                  <th className="py-3 px-4">Uploaded Document</th>
                  <th className="py-3 px-4">Matched Target</th>
                  <th className="py-3 px-4">Classification</th>
                  <th className="py-3 px-4 text-right">Similarity</th>
                  <th className="py-3 px-4">Reason &amp; Detected Differences</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((m) => {
                  const diffs = m.differences_json ? (JSON.parse(m.differences_json) as string[]) : [];
                  return (
                    <tr key={m.id} className="hover:bg-slate-50">
                      <td className="py-3 px-4">
                        <button
                          type="button"
                          onClick={() => onNavigate('analysis', m.document_id)}
                          className="font-semibold text-blue-700 hover:underline text-left"
                        >
                          #{m.document_id} · {m.source_filename}
                        </button>
                      </td>
                      <td className="py-3 px-4 font-medium text-slate-900">
                        {m.matched_ref_code
                          ? `${m.matched_ref_code} (${m.matched_ref_category})`
                          : `#${m.matched_document_id} · ${m.matched_filename}`}
                      </td>
                      <td className="py-3 px-4 font-semibold text-slate-800 whitespace-nowrap">
                        {m.match_type}
                      </td>
                      <td className="py-3 px-4 text-right font-mono-tabular whitespace-nowrap">
                        <div className="font-bold text-slate-900">{(m.similarity_score * 100).toFixed(1)}%</div>
                        <div className="text-[11px] text-slate-500">
                          TF-IDF {(m.tfidf_similarity * 100).toFixed(0)}%
                        </div>
                      </td>
                      <td className="py-3 px-4 max-w-md">
                        <p className="text-slate-700">{m.reason}</p>
                        {diffs.length > 0 && (
                          <ul className="mt-1 text-[11px] text-amber-800 list-disc pl-4">
                            {diffs.slice(0, 3).map((d, idx) => (
                              <li key={idx}>{d}</li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
