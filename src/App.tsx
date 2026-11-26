import React, { useState } from 'react';
import {
  ShieldCheck,
  LayoutDashboard,
  Database,
  Upload,
  FileSearch,
  ScanEye,
  CopyCheck,
  FileText,
  History,
  Users,
  Settings,
  LogOut,
  Menu,
  X,
} from 'lucide-react';
import { apiRequest } from './api';
import { AuthScreen } from './components/AuthScreen';
import { Background3D } from './components/Background3D';
import { OverviewPage } from './pages/OverviewPage';
import { ReferencesPage } from './pages/ReferencesPage';
import { UploadPage } from './pages/UploadPage';
import { AnalysisPage } from './pages/AnalysisPage';
import { TamperDetectionPage } from './pages/TamperDetectionPage';
import { DuplicatesPage } from './pages/DuplicatesPage';
import { ReportsPage } from './pages/ReportsPage';
import { HistoryPage } from './pages/HistoryPage';
import { UsersPage } from './pages/UsersPage';
import { SettingsPage } from './pages/SettingsPage';
import type { NavPage, User } from './types';

interface NavItem {
  id: NavPage;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  adminOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'references', label: 'Reference Dataset', icon: Database },
  { id: 'upload', label: 'Upload Document', icon: Upload },
  { id: 'analysis', label: 'Document Analysis', icon: FileSearch },
  { id: 'tamper', label: 'Tamper Detection', icon: ScanEye },
  { id: 'duplicates', label: 'Duplicates & Similarity', icon: CopyCheck },
  { id: 'reports', label: 'Reports', icon: FileText },
  { id: 'history', label: 'Scan History', icon: History },
  { id: 'users', label: 'Users & Access', icon: Users, adminOnly: true },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export default function App() {
  // Session token is held strictly in React memory (never persisted to localStorage)
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [activePage, setActivePage] = useState<NavPage>('overview');
  const [selectedDocId, setSelectedDocId] = useState<number | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleAuthenticated = (authedUser: User, sessionToken: string) => {
    setUser(authedUser);
    setToken(sessionToken);
    setActivePage('overview');
  };

  const handleNavigate = (page: NavPage, docId?: number) => {
    if (typeof docId === 'number') {
      setSelectedDocId(docId);
    }
    setActivePage(page);
    setMobileMenuOpen(false);
  };

  const handleLogout = async () => {
    if (token) {
      await apiRequest('/api/auth/logout', token, { method: 'POST' }).catch(() => undefined);
    }
    setUser(null);
    setToken(null);
    setSelectedDocId(null);
    setActivePage('overview');
  };

  if (!user || !token) {
    return <AuthScreen onAuthenticated={handleAuthenticated} />;
  }

  const visibleNavItems = NAV_ITEMS.filter((item) => !item.adminOnly || user.role === 'ADMIN');
  const currentTitle = visibleNavItems.find((i) => i.id === activePage)?.label || 'Overview';

  return (
    <div className="min-h-screen flex bg-slate-50/75 text-slate-900 relative">
      <Background3D variant="workspace" />
      {/* Mobile Sidebar Backdrop */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 bg-slate-900/50 z-30 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Left Dark Navy Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 bg-slate-900 text-slate-200 flex flex-col transition-transform duration-200 lg:static lg:translate-x-0 lg:z-10 ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="px-5 py-5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-4 h-4 text-white" />
            </div>
            <div>
              <div className="text-sm font-bold tracking-wide text-white leading-tight">
                DOCUGUARD AI
              </div>
              <div className="text-[11px] text-slate-400">Document Forensics</div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setMobileMenuOpen(false)}
            className="lg:hidden text-slate-400 hover:text-white"
            aria-label="Close navigation menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto" aria-label="Primary Navigation">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const active = activePage === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNavigate(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left ${
                  active
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-800 space-y-3">
          <div className="px-2">
            <div className="text-xs font-semibold text-white truncate">{user.fullName}</div>
            <div className="text-[11px] text-slate-400 truncate">
              @{user.username} · {user.role}
            </div>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 relative z-10">
        <header className="bg-white/95 border-b border-slate-200 px-4 sm:px-8 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
              aria-label="Open navigation menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <div className="text-xs text-slate-500">DocuGuard AI / {currentTitle}</div>
              <h1 className="text-lg font-bold text-slate-900 truncate">{currentTitle}</h1>
            </div>
          </div>

          <div className="hidden sm:flex items-center gap-3 text-xs text-slate-500 shrink-0">
            <span>Automated assessment only — human review recommended</span>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-8 max-w-7xl w-full mx-auto">
          {activePage === 'overview' && (
            <OverviewPage token={token} user={user} onNavigate={handleNavigate} />
          )}
          {activePage === 'references' && <ReferencesPage token={token} user={user} />}
          {activePage === 'upload' && <UploadPage token={token} onNavigate={handleNavigate} />}
          {activePage === 'analysis' && (
            <AnalysisPage
              token={token}
              selectedDocId={selectedDocId}
              onSelectDocId={setSelectedDocId}
              onNavigate={handleNavigate}
            />
          )}
          {activePage === 'tamper' && (
            <TamperDetectionPage
              token={token}
              selectedDocId={selectedDocId}
              onSelectDocId={setSelectedDocId}
            />
          )}
          {activePage === 'duplicates' && <DuplicatesPage token={token} onNavigate={handleNavigate} />}
          {activePage === 'reports' && <ReportsPage token={token} />}
          {activePage === 'history' && <HistoryPage token={token} onNavigate={handleNavigate} />}
          {activePage === 'users' && <UsersPage token={token} currentUser={user} />}
          {activePage === 'settings' && <SettingsPage token={token} user={user} />}
        </main>
      </div>
    </div>
  );
}
