import React from 'react';
import { CheckCircle2, AlertTriangle, ShieldAlert, Clock } from 'lucide-react';

export const RiskBadge: React.FC<{ category: string | null | undefined; score?: number | null }> = ({
  category,
  score,
}) => {
  if (!category) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500">
        <Clock className="w-3.5 h-3.5" />
        Pending
      </span>
    );
  }
  if (category === 'RED') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border border-red-200 bg-red-50 text-xs font-semibold text-red-700 whitespace-nowrap tabular-nums">
        <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
        RED · HIGH RISK{score != null ? ` (${score}/100)` : ''}
      </span>
    );
  }
  if (category === 'YELLOW') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border border-amber-200 bg-amber-50 text-xs font-semibold text-amber-800 whitespace-nowrap tabular-nums">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
        YELLOW · MANUAL REVIEW{score != null ? ` (${score}/100)` : ''}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border border-emerald-200 bg-emerald-50 text-xs font-semibold text-emerald-700 whitespace-nowrap tabular-nums">
      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
      GREEN · LOW RISK{score != null ? ` (${score}/100)` : ''}
    </span>
  );
};
