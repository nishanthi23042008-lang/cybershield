import React, { useEffect, useState } from 'react';
import { Sliders, KeyRound, Save, Database } from 'lucide-react';
import { apiRequest } from '../api';
import type { User } from '../types';

interface SettingsPageProps {
  token: string;
  user: User;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({ token, user }) => {
  const [settings, setSettings] = useState<Record<string, string>>({
    near_duplicate_tfidf_threshold: '0.82',
    near_duplicate_phash_threshold: '0.88',
    visual_ela_block_threshold: '3.8',
    tax_tolerance_amount: '1.0',
    enable_ocr_fallback: 'true',
  });
  const [loading, setLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPw, setSavingPw] = useState(false);
  const [pwMessage, setPwMessage] = useState<string | null>(null);
  const [pwError, setPwError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    apiRequest<{ settings: Record<string, string> }>('/api/settings', token)
      .then((res) => {
        if (res.settings && Object.keys(res.settings).length > 0) {
          setSettings((prev) => ({ ...prev, ...res.settings }));
        }
      })
      .catch((err) => setSettingsError(err instanceof Error ? err.message : 'Unable to load settings.'))
      .finally(() => setLoading(false));
  }, [token]);

  const handleSaveThresholds = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    setSettingsMessage(null);
    setSettingsError(null);
    try {
      await apiRequest('/api/settings', token, {
        method: 'PUT',
        body: JSON.stringify({ settings }),
      });
      setSettingsMessage('Detection thresholds saved to database.');
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : 'Unable to update settings.');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwMessage(null);
    setPwError(null);
    if (newPassword !== confirmPassword) {
      setPwError('New password and confirmation do not match.');
      return;
    }
    setSavingPw(true);
    try {
      await apiRequest('/api/auth/change-password', token, {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setPwMessage('Password updated successfully.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setPwError(err instanceof Error ? err.message : 'Password update failed.');
    } finally {
      setSavingPw(false);
    }
  };

  const isAdmin = user.role === 'ADMIN';

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Detection & Analysis Thresholds */}
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex items-center gap-2 mb-1">
          <Sliders className="w-4 h-4 text-blue-600" />
          <h2 className="text-base font-bold text-slate-900">Detection Engine Thresholds</h2>
        </div>
        <p className="text-xs text-slate-500">
          {isAdmin
            ? 'Configure statistical thresholds used during consistency, duplicate, and Error Level Analysis checks.'
            : 'Read-only view of active forensic detection thresholds (administrator role required to edit).'}
        </p>

        {settingsError && (
          <div className="mt-4 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
            {settingsError}
          </div>
        )}
        {settingsMessage && (
          <div className="mt-4 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-700">
            {settingsMessage}
          </div>
        )}

        <form onSubmit={handleSaveThresholds} className="mt-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Near-Duplicate TF-IDF Cosine Threshold (0.10 – 0.99)
            </label>
            <input
              type="number"
              step="0.01"
              min="0.1"
              max="0.99"
              disabled={!isAdmin || loading}
              value={settings.near_duplicate_tfidf_threshold}
              onChange={(e) =>
                setSettings((s) => ({ ...s, near_duplicate_tfidf_threshold: e.target.value }))
              }
              className="w-full px-3 py-2 text-sm font-mono-tabular border border-slate-300 rounded-lg disabled:bg-slate-50"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Visual Perceptual dHash Similarity Threshold (0.10 – 0.99)
            </label>
            <input
              type="number"
              step="0.01"
              min="0.1"
              max="0.99"
              disabled={!isAdmin || loading}
              value={settings.near_duplicate_phash_threshold}
              onChange={(e) =>
                setSettings((s) => ({ ...s, near_duplicate_phash_threshold: e.target.value }))
              }
              className="w-full px-3 py-2 text-sm font-mono-tabular border border-slate-300 rounded-lg disabled:bg-slate-50"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              ELA Block Anomaly Threshold (Mean Absolute Difference)
            </label>
            <input
              type="number"
              step="0.5"
              min="5"
              max="80"
              disabled={!isAdmin || loading}
              value={settings.visual_ela_block_threshold}
              onChange={(e) =>
                setSettings((s) => ({ ...s, visual_ela_block_threshold: e.target.value }))
              }
              className="w-full px-3 py-2 text-sm font-mono-tabular border border-slate-300 rounded-lg disabled:bg-slate-50"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Invoice Math & Tax Rounding Tolerance
            </label>
            <input
              type="number"
              step="0.1"
              min="0"
              max="100"
              disabled={!isAdmin || loading}
              value={settings.tax_tolerance_amount}
              onChange={(e) => setSettings((s) => ({ ...s, tax_tolerance_amount: e.target.value }))}
              className="w-full px-3 py-2 text-sm font-mono-tabular border border-slate-300 rounded-lg disabled:bg-slate-50"
            />
          </div>

          <div className="flex items-center justify-between pt-2">
            <label className="text-xs font-semibold text-slate-700">Enable Image OCR Extraction</label>
            <select
              disabled={!isAdmin || loading}
              value={settings.enable_ocr_fallback}
              onChange={(e) => setSettings((s) => ({ ...s, enable_ocr_fallback: e.target.value }))}
              className="px-3 py-1.5 text-xs font-medium border border-slate-300 rounded-lg bg-white disabled:bg-slate-50"
            >
              <option value="true">Enabled</option>
              <option value="false">Disabled</option>
            </select>
          </div>

          {isAdmin && (
            <button
              type="submit"
              disabled={savingSettings}
              className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {savingSettings ? 'Saving...' : 'Save Threshold Settings'}
            </button>
          )}
        </form>
      </div>

      {/* Password Security + Storage Architecture Summary */}
      <div className="space-y-6">
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-center gap-2 mb-1">
            <KeyRound className="w-4 h-4 text-slate-700" />
            <h2 className="text-base font-bold text-slate-900">Account Password Update</h2>
          </div>
          <p className="text-xs text-slate-500">
            Passwords require at least 10 characters with uppercase, lowercase, and numeric characters.
          </p>

          {pwError && (
            <div className="mt-4 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
              {pwError}
            </div>
          )}
          {pwMessage && (
            <div className="mt-4 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-700">
              {pwMessage}
            </div>
          )}

          <form onSubmit={handleChangePassword} className="mt-5 space-y-3.5">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Current Password</label>
              <input
                type="password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">New Password</label>
              <input
                type="password"
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Confirm New Password</label>
              <input
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <button
              type="submit"
              disabled={savingPw}
              className="w-full py-2.5 px-4 bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50"
            >
              {savingPw ? 'Updating...' : 'Update Password'}
            </button>
          </form>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-center gap-2 mb-2">
            <Database className="w-4 h-4 text-slate-700" />
            <h3 className="text-sm font-bold text-slate-900">Storage & Database Architecture</h3>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            Uploaded documents, 100 individual fictional reference pages, ELA heatmaps, and generated reports are persisted outside the relational database inside confined local storage directories, while structured metadata, SHA-256/MD5 hashes, consistency results, and audit logs are stored via parameterized queries. Full matching MySQL 8+ DDL is maintained in{' '}
            <span className="font-mono-tabular text-slate-800">database/mysql_schema.sql</span>.
          </p>
        </div>
      </div>
    </div>
  );
};
