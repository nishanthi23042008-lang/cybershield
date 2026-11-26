import React, { useEffect, useState } from 'react';
import { ShieldCheck, Lock, UserPlus, LogIn, KeyRound } from 'lucide-react';
import { apiRequest } from '../api';
import { Background3D } from './Background3D';
import type { User } from '../types';

interface AuthScreenProps {
  onAuthenticated: (user: User, token: string) => void;
}

type AuthMode = 'login' | 'register' | 'setup-admin';

export const AuthScreen: React.FC<AuthScreenProps> = ({ onAuthenticated }) => {
  const [mode, setMode] = useState<AuthMode>('login');
  const [needsAdminSetup, setNeedsAdminSetup] = useState(false);
  const [hasEnvPasscode, setHasEnvPasscode] = useState(false);

  const [identifier, setIdentifier] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [passcode, setPasscode] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiRequest<{ needsAdminSetup: boolean; hasEnvPasscode: boolean }>('/api/auth/bootstrap-status', null)
      .then((res) => {
        setNeedsAdminSetup(res.needsAdminSetup);
        setHasEnvPasscode(res.hasEnvPasscode);
        if (res.needsAdminSetup) {
          setMode('setup-admin');
        }
      })
      .catch(() => {
        // Ignore bootstrap check error
      });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === 'login') {
        const res = await apiRequest<{ user: User; token: string }>('/api/auth/login', null, {
          method: 'POST',
          body: JSON.stringify({ identifier, password }),
        });
        onAuthenticated(res.user, res.token);
      } else if (mode === 'register') {
        const res = await apiRequest<{ user: User; token: string }>('/api/auth/register', null, {
          method: 'POST',
          body: JSON.stringify({ username, email, fullName, password }),
        });
        onAuthenticated(res.user, res.token);
      } else {
        const res = await apiRequest<{ user: User; token: string }>('/api/auth/setup-admin', null, {
          method: 'POST',
          body: JSON.stringify({ username, email, fullName, password, passcode }),
        });
        onAuthenticated(res.user, res.token);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col lg:flex-row relative">
      <Background3D variant="auth" />
      {/* Left Enterprise Overview Panel */}
      <div className="lg:w-1/2 bg-slate-900/80 text-slate-100 p-10 lg:p-16 flex flex-col justify-between border-b lg:border-b-0 lg:border-r border-slate-800 relative z-10">
        <div>
          <div className="flex items-center gap-3 mb-10">
            <div className="w-10 h-10 rounded-lg bg-blue-600 flex items-center justify-center text-white">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white">DocuGuard AI</h1>
              <p className="text-xs text-slate-400">Digital Document &amp; Invoice Forensic Inspection</p>
            </div>
          </div>

          <h2 className="text-3xl lg:text-4xl font-bold text-white tracking-tight leading-tight max-w-xl [text-wrap:balance]">
            Evidence-based document verification and invoice integrity analysis.
          </h2>
          <p className="mt-4 text-slate-300 text-base leading-relaxed max-w-xl">
            Inspect financial documents across metadata, cryptographic hashes, Error Level Analysis heatmaps, OCR field extraction, TF-IDF reference matching, and deterministic arithmetic verification.
          </p>

          <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 gap-6 max-w-xl pt-8 border-t border-slate-800">
            <div>
              <p className="text-sm font-semibold text-white">8-Step Forensic Pipeline</p>
              <p className="mt-1 text-xs text-slate-400 leading-relaxed">
                Metadata inspection, SHA-256 hashing, visual ELA heatmaps, OCR extraction, and line-item math checks.
              </p>
            </div>
            <div>
              <p className="text-sm font-semibold text-white">100-Document Reference Dataset</p>
              <p className="mt-1 text-xs text-slate-400 leading-relaxed">
                Page-by-page fictional reference corpus across invoices, receipts, purchase orders, bills, and notes.
              </p>
            </div>
            <div>
              <p className="text-sm font-semibold text-white">Explainable Risk Assessment</p>
              <p className="mt-1 text-xs text-slate-400 leading-relaxed">
                Transparent GREEN, YELLOW, and RED scoring backed by concrete evidence for human reviewers.
              </p>
            </div>
            <div>
              <p className="text-sm font-semibold text-white">Role-Based Access Control</p>
              <p className="mt-1 text-xs text-slate-400 leading-relaxed">
                Enforced backend permissions for Administrators, Forensic Analysts, and Standard Users.
              </p>
            </div>
          </div>
        </div>

        <p className="mt-10 text-xs text-slate-400">
          Automated assessment only. Human verification is recommended before financial decisions.
        </p>
      </div>

      {/* Right Authentication Card */}
      <div className="lg:w-1/2 bg-slate-50/85 flex items-center justify-center p-6 sm:p-12 relative z-10">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-8">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg mb-6">
            {needsAdminSetup && (
              <button
                type="button"
                onClick={() => {
                  setMode('setup-admin');
                  setError(null);
                }}
                className={`flex-1 py-2 px-3 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                  mode === 'setup-admin'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Admin Setup
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError(null);
              }}
              className={`flex-1 py-2 px-3 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                mode === 'login' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setError(null);
              }}
              className={`flex-1 py-2 px-3 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                mode === 'register' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Register
            </button>
          </div>

          <h2 className="text-xl font-bold text-slate-900">
            {mode === 'setup-admin'
              ? 'Claim Initial Administrator'
              : mode === 'register'
              ? 'Create Workspace Account'
              : 'Sign In to DocuGuard AI'}
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            {mode === 'setup-admin'
              ? 'No administrator exists yet. Create the first administrator account to manage users and import the reference dataset.'
              : mode === 'register'
              ? 'New self-registered accounts start with standard User permissions.'
              : 'Enter your workspace username or email and password.'}
          </p>

          {error && (
            <div className="mt-4 p-3 rounded-lg bg-red-50 border border-red-200 text-xs font-medium text-red-800">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            {mode === 'login' ? (
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Username or Email
                </label>
                <input
                  type="text"
                  required
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="admin or analyst@company.com"
                  className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
                />
              </div>
            ) : (
              <>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">Full Name</label>
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Alex Morgan"
                    className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">Username</label>
                    <input
                      type="text"
                      required
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="alex_morgan"
                      className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">Email</label>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="alex@example.com"
                      className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
                    />
                  </div>
                </div>
              </>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">Password</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimum 8 characters with letters & numbers"
                className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
              />
            </div>

            {mode === 'setup-admin' && hasEnvPasscode && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Administrator Setup Passcode
                </label>
                <div className="relative">
                  <KeyRound className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                  <input
                    type="password"
                    required
                    value={passcode}
                    onChange={(e) => setPasscode(e.target.value)}
                    placeholder="Enter configured ADMIN_SETUP_PASSCODE"
                    className="w-full pl-9 pr-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
                  />
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              {mode === 'login' ? (
                <>
                  <LogIn className="w-4 h-4" />
                  {loading ? 'Signing In...' : 'Sign In'}
                </>
              ) : mode === 'register' ? (
                <>
                  <UserPlus className="w-4 h-4" />
                  {loading ? 'Creating Account...' : 'Create Account'}
                </>
              ) : (
                <>
                  <Lock className="w-4 h-4" />
                  {loading ? 'Setting Up Administrator...' : 'Claim Administrator Account'}
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
