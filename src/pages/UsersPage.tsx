import React, { useEffect, useState } from 'react';
import { Users, Shield, RefreshCw, ScrollText } from 'lucide-react';
import { apiRequest } from '../api';
import type { User, UserRole } from '../types';

interface UsersPageProps {
  token: string;
  currentUser: User;
}

interface AdminUserRow {
  id: number;
  username: string;
  email: string;
  full_name: string;
  status: 'ACTIVE' | 'SUSPENDED';
  role: UserRole;
  created_at: string;
  last_login_at: string | null;
}

interface AuditLogRow {
  id: number;
  user_id: number | null;
  username: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  details_json: string | null;
  ip_address: string | null;
  created_at: string;
}

export const UsersPage: React.FC<UsersPageProps> = ({ token, currentUser }) => {
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingUserId, setSavingUserId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const loadAdminData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [usersRes, logsRes] = await Promise.all([
        apiRequest<{ users: AdminUserRow[] }>('/api/admin/users', token),
        apiRequest<{ logs: AuditLogRow[] }>('/api/admin/audit-logs', token),
      ]);
      setUsers(usersRes.users);
      setAuditLogs(logsRes.logs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load administration records.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAdminData();
  }, [token]);

  const handleUpdateUser = async (
    targetId: number,
    updates: { role?: UserRole; status?: 'ACTIVE' | 'SUSPENDED' }
  ) => {
    setSavingUserId(targetId);
    setError(null);
    setFeedback(null);
    try {
      await apiRequest(`/api/admin/users/${targetId}`, token, {
        method: 'PATCH',
        body: JSON.stringify(updates),
      });
      setFeedback(`Updated user #${targetId} access settings.`);
      await loadAdminData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update user.');
    } finally {
      setSavingUserId(null);
    }
  };

  if (currentUser.role !== 'ADMIN') {
    return (
      <div className="bg-white border border-red-200 rounded-xl p-6 text-sm text-red-700">
        Administrator privileges are required to view and manage user accounts.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Users className="w-4 h-4 text-blue-600" />
              User Accounts & Role-Based Access Control
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Assign ADMIN, ANALYST, or USER roles and manage account activation state. All permissions are enforced server-side.
            </p>
          </div>
          <button
            type="button"
            onClick={loadAdminData}
            disabled={loading}
            className="px-3.5 py-2 border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg flex items-center gap-1.5 self-start sm:self-auto"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {error && (
          <div className="mt-4 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
            {error}
          </div>
        )}
        {feedback && (
          <div className="mt-4 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-700">
            {feedback}
          </div>
        )}

        <div className="mt-5 overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                <th className="py-2.5 pr-4">User</th>
                <th className="py-2.5 pr-4">Role</th>
                <th className="py-2.5 pr-4">Status</th>
                <th className="py-2.5 pr-4">Created</th>
                <th className="py-2.5 text-right">Last Login</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {users.map((u) => {
                const isSelf = u.id === currentUser.id;
                const isSaving = savingUserId === u.id;
                return (
                  <tr key={u.id} className="hover:bg-slate-50">
                    <td className="py-3 pr-4">
                      <div className="font-medium text-slate-900">
                        {u.full_name} {isSelf ? <span className="text-xs text-blue-600">(You)</span> : null}
                      </div>
                      <div className="text-xs text-slate-500">
                        @{u.username} · {u.email}
                      </div>
                    </td>
                    <td className="py-3 pr-4">
                      <select
                        value={u.role}
                        disabled={isSelf || isSaving}
                        aria-label={`Role for ${u.username}`}
                        onChange={(e) => handleUpdateUser(u.id, { role: e.target.value as UserRole })}
                        className="px-2.5 py-1.5 text-xs font-medium border border-slate-300 rounded-md bg-white text-slate-800 disabled:opacity-50"
                      >
                        <option value="ADMIN">ADMIN</option>
                        <option value="ANALYST">ANALYST</option>
                        <option value="USER">USER</option>
                      </select>
                    </td>
                    <td className="py-3 pr-4">
                      <select
                        value={u.status}
                        disabled={isSelf || isSaving}
                        aria-label={`Status for ${u.username}`}
                        onChange={(e) =>
                          handleUpdateUser(u.id, { status: e.target.value as 'ACTIVE' | 'SUSPENDED' })
                        }
                        className={`px-2.5 py-1.5 text-xs font-semibold border rounded-md bg-white disabled:opacity-50 ${
                          u.status === 'ACTIVE'
                            ? 'border-emerald-300 text-emerald-700'
                            : 'border-red-300 text-red-700'
                        }`}
                      >
                        <option value="ACTIVE">ACTIVE</option>
                        <option value="SUSPENDED">SUSPENDED</option>
                      </select>
                    </td>
                    <td className="py-3 pr-4 text-xs text-slate-500 font-mono-tabular whitespace-nowrap">
                      {u.created_at}
                    </td>
                    <td className="py-3 text-right text-xs text-slate-500 font-mono-tabular whitespace-nowrap">
                      {u.last_login_at || 'Never'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Security Audit Log Table */}
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <ScrollText className="w-4 h-4 text-slate-700" />
              Security & Access Audit Log
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Recent authentication events, role updates, reference imports, and report downloads.
            </p>
          </div>
          <span className="text-xs text-slate-500 font-mono-tabular">{auditLogs.length} entries</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                <th className="py-2 pr-4">Action</th>
                <th className="py-2 pr-4">Actor</th>
                <th className="py-2 pr-4">Target</th>
                <th className="py-2 pr-4">Details</th>
                <th className="py-2 text-right">Timestamp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {auditLogs.map((log) => (
                <tr key={log.id} className="hover:bg-slate-50">
                  <td className="py-2.5 pr-4 font-semibold text-slate-800 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5">
                      <Shield className="w-3 h-3 text-slate-400" />
                      {log.action}
                    </span>
                  </td>
                  <td className="py-2.5 pr-4 text-slate-700 whitespace-nowrap">
                    {log.username || (log.user_id ? `User #${log.user_id}` : 'Anonymous')}
                  </td>
                  <td className="py-2.5 pr-4 text-slate-600 font-mono-tabular whitespace-nowrap">
                    {log.target_type ? `${log.target_type}${log.target_id ? `:${log.target_id}` : ''}` : '—'}
                  </td>
                  <td className="py-2.5 pr-4 text-slate-500 font-mono-tabular max-w-sm truncate">
                    {log.details_json || '—'}
                  </td>
                  <td className="py-2.5 text-right text-slate-500 font-mono-tabular whitespace-nowrap">
                    {log.created_at}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
