import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOT_DIR = process.cwd();

export const CONFIG = {
  PORT: Number(process.env.PORT || 3000),
  ROOT_DIR,
  STORAGE_DIR: path.resolve(ROOT_DIR, process.env.STORAGE_DIR || 'storage'),
  UPLOADS_DIR: path.resolve(ROOT_DIR, process.env.STORAGE_DIR || 'storage', 'uploads'),
  REFERENCES_DIR: path.resolve(ROOT_DIR, process.env.STORAGE_DIR || 'storage', 'references'),
  HEATMAPS_DIR: path.resolve(ROOT_DIR, process.env.STORAGE_DIR || 'storage', 'heatmaps'),
  REPORTS_DIR: path.resolve(ROOT_DIR, process.env.STORAGE_DIR || 'storage', 'reports'),
  DB_PATH: path.resolve(ROOT_DIR, process.env.DB_PATH || 'storage/docuguard.db'),
  DEFAULT_REFERENCE_PDF: path.resolve(
    ROOT_DIR,
    'public/assets/aistudio/DOCUGUARD_AI_100_Fictional_Reference_Documents_2adce2c4.pdf'
  ),
  MAX_UPLOAD_BYTES: 20 * 1024 * 1024, // 20 MB
  ALLOWED_EXTENSIONS: new Set(['.pdf', '.jpg', '.jpeg', '.png', '.docx']),
  ALLOWED_MIME_TYPES: new Set([
    'application/pdf',
    'image/jpeg',
    'image/png',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ]),
  SESSION_SECRET: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  SESSION_TTL_MS: 12 * 60 * 60 * 1000, // 12 hours
  ADMIN_SETUP_PASSCODE: process.env.ADMIN_SETUP_PASSCODE || '',
};

export function ensureStorageDirectories(): void {
  for (const dir of [
    CONFIG.STORAGE_DIR,
    CONFIG.UPLOADS_DIR,
    CONFIG.REFERENCES_DIR,
    CONFIG.HEATMAPS_DIR,
    CONFIG.REPORTS_DIR,
    path.dirname(CONFIG.DB_PATH),
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function resolveConfinedPath(baseDir: string, targetPath: string): string {
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(resolvedBase, targetPath);
  if (resolvedTarget !== resolvedBase && !resolvedTarget.startsWith(resolvedBase + path.sep)) {
    throw new Error('Path traversal attempt blocked');
  }
  return resolvedTarget;
}

export function sanitizeFilename(filename: string): string {
  const base = path.basename(filename || 'document').replace(/[^a-zA-Z0-9._-]/g, '_');
  return base.slice(0, 120) || 'document';
}
