import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import express, { type NextFunction, type Request, type Response } from 'express';
import JSZip from 'jszip';
import * as jpeg from 'jpeg-js';
import multer from 'multer';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { PNG } from 'pngjs';
import { createServer as createViteServer } from 'vite';
import {
  type AuthenticatedRequest,
  canAccessDocument,
  checkPasscodeMatch,
  getUserById,
  hasAnyAdmin,
  hashPassword,
  issueSessionToken,
  requireAuth,
  requireRole,
  revokeSessionToken,
  type UserRole,
  validateEmail,
  validatePasswordStrength,
  validateUsername,
  verifyPassword,
} from './server/auth.ts';
import { CONFIG, ensureStorageDirectories, resolveConfinedPath, sanitizeFilename } from './server/config.ts';
import { getDb, logAudit } from './server/db.ts';
import { computeBufferHashes } from './server/modules/hashing.ts';
import { getReferenceImportProgress, ingestReferencePdf } from './server/modules/referenceManager.ts';
import { buildPdfReport, buildSafeJsonReport, type ReportPayload } from './server/modules/reportGenerator.ts';
import {
  computeJaccardTokenSimilarity,
  computeLineDiff,
  computeTfIdfSimilarityMatrix,
} from './server/modules/similarity.ts';
import { hammingSimilarity } from './server/modules/visualAnalysis.ts';
import { runDocumentAnalysisPipeline } from './server/services/analysisPipeline.ts';

dotenv.config();

export function validateMagicSignature(buffer: Buffer, ext: string): boolean {
  if (!buffer || buffer.length < 4) return false;
  if (ext === '.pdf') {
    return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  }
  if (ext === '.png') {
    return (
      buffer.length >= 8 &&
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a
    );
  }
  if (ext === '.jpg' || ext === '.jpeg') {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (ext === '.docx') {
    return buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
  }
  return false;
}

export async function validateDocumentIntegrity(buffer: Buffer, ext: string): Promise<string | null> {
  if (buffer.length === 0) return 'Uploaded file is empty.';
  if (buffer.length > CONFIG.MAX_UPLOAD_BYTES) return 'File exceeds maximum 20 MB limit.';
  if (!validateMagicSignature(buffer, ext)) {
    return `File signature does not match declared ${ext.toUpperCase()} format.`;
  }
  try {
    if (ext === '.pdf') {
      const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: false });
      const tail = buffer.subarray(Math.max(0, buffer.length - 2048)).toString('latin1');
      if (pdfDoc.getPageCount() < 1 || !tail.includes('%%EOF')) {
        return 'Malformed PDF: missing document pages or EOF trailer.';
      }
    } else if (ext === '.png') {
      PNG.sync.read(buffer);
    } else if (ext === '.jpg' || ext === '.jpeg') {
      jpeg.decode(buffer, { useTArray: true });
    } else if (ext === '.docx') {
      const zip = await JSZip.loadAsync(buffer);
      if (!zip.file('word/document.xml')) {
        return 'Invalid DOCX structure: missing word/document.xml.';
      }
    }
    return null;
  } catch {
    return `Malformed or corrupted ${ext.toUpperCase()} file.`;
  }
}

export function createApp() {
  ensureStorageDirectories();
  const db = getDb();

  const app = express();
  app.set('trust proxy', true);
  app.use(express.json({ limit: '2mb' }));

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: CONFIG.MAX_UPLOAD_BYTES },
  });

  // ==========================================
  // AUTHENTICATION & BOOTSTRAP ROUTES
  // ==========================================
  app.get('/api/auth/bootstrap-status', (_req, res) => {
    res.json({
      needsAdminSetup: !hasAnyAdmin(db),
      hasEnvPasscode: Boolean(CONFIG.ADMIN_SETUP_PASSCODE),
    });
  });

  app.post('/api/auth/setup-admin', (req, res) => {
    const { username, email, fullName, password, passcode } = req.body || {};
    const adminExists = hasAnyAdmin(db);
    const hasEnvPasscode = Boolean(CONFIG.ADMIN_SETUP_PASSCODE);

    if (adminExists && !hasEnvPasscode) {
      res.status(403).json({ error: 'Initial administrator account has already been claimed.' });
      return;
    }

    if (hasEnvPasscode && !checkPasscodeMatch(String(passcode || ''), CONFIG.ADMIN_SETUP_PASSCODE)) {
      res.status(403).json({ error: 'Invalid administrator setup passcode.' });
      return;
    }

    if (!validateUsername(username)) {
      res.status(400).json({ error: 'Username must be 3-40 alphanumeric, underscore, dot, or hyphen characters.' });
      return;
    }
    if (!validateEmail(email)) {
      res.status(400).json({ error: 'Please provide a valid email address.' });
      return;
    }
    const pwErr = validatePasswordStrength(password);
    if (pwErr) {
      res.status(400).json({ error: pwErr });
      return;
    }

    const adminRole = db.prepare("SELECT id FROM roles WHERE name = 'ADMIN'").get() as { id: number };
    const existing = db
      .prepare('SELECT id FROM users WHERE username = ? OR email = ?')
      .get(username.trim(), email.trim().toLowerCase());
    if (existing) {
      res.status(409).json({ error: 'Username or email is already registered.' });
      return;
    }

    const hash = hashPassword(password);
    const info = db
      .prepare(
        `INSERT INTO users (username, email, full_name, password_hash, role_id, status)
         VALUES (?, ?, ?, ?, ?, 'ACTIVE')`
      )
      .run(
        username.trim(),
        email.trim().toLowerCase(),
        String(fullName || username).trim().slice(0, 120),
        hash,
        adminRole.id
      );

    const user = getUserById(Number(info.lastInsertRowid), db)!;
    const token = issueSessionToken(user);
    logAudit(db, {
      userId: user.id,
      action: 'INITIAL_ADMIN_CREATED',
      targetType: 'user',
      targetId: user.id,
      ipAddress: req.ip || null,
    });
    res.status(201).json({ user, token });
  });

  app.post('/api/auth/register', (req, res) => {
    const { username, email, fullName, password } = req.body || {};
    if (!validateUsername(username)) {
      res.status(400).json({ error: 'Username must be 3-40 characters (letters, numbers, _, ., -).' });
      return;
    }
    if (!validateEmail(email)) {
      res.status(400).json({ error: 'Please provide a valid email address.' });
      return;
    }
    const pwErr = validatePasswordStrength(password);
    if (pwErr) {
      res.status(400).json({ error: pwErr });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    const normalizedUsername = username.trim();
    const existing = db
      .prepare('SELECT id FROM users WHERE username = ? OR email = ?')
      .get(normalizedUsername, normalizedEmail);
    if (existing) {
      res.status(409).json({ error: 'Username or email already exists.' });
      return;
    }

    // Public registration strictly assigns least-privilege USER role
    const userRole = db.prepare("SELECT id FROM roles WHERE name = 'USER'").get() as { id: number };
    const hash = hashPassword(password);
    const info = db
      .prepare(
        `INSERT INTO users (username, email, full_name, password_hash, role_id, status)
         VALUES (?, ?, ?, ?, ?, 'ACTIVE')`
      )
      .run(
        normalizedUsername,
        normalizedEmail,
        String(fullName || normalizedUsername).trim().slice(0, 120),
        hash,
        userRole.id
      );

    const user = getUserById(Number(info.lastInsertRowid), db)!;
    const token = issueSessionToken(user);
    logAudit(db, {
      userId: user.id,
      action: 'USER_REGISTERED',
      targetType: 'user',
      targetId: user.id,
      ipAddress: req.ip || null,
    });
    res.status(201).json({ user, token });
  });

  app.post('/api/auth/login', (req, res) => {
    const { identifier, password } = req.body || {};
    if (!identifier || !password) {
      res.status(400).json({ error: 'Username/email and password are required.' });
      return;
    }
    const cleanId = String(identifier).trim();
    const row = db
      .prepare(
        `SELECT u.id, u.password_hash, u.status
         FROM users u
         WHERE u.username = ? OR u.email = ?`
      )
      .get(cleanId, cleanId.toLowerCase()) as
      | { id: number; password_hash: string; status: string }
      | undefined;

    if (!row || !verifyPassword(String(password), row.password_hash)) {
      logAudit(db, {
        action: 'LOGIN_FAILED',
        targetType: 'auth',
        targetId: cleanId,
        ipAddress: req.ip || null,
      });
      res.status(401).json({ error: 'Invalid credentials.' });
      return;
    }
    if (row.status !== 'ACTIVE') {
      res.status(403).json({ error: 'Account is suspended. Contact an administrator.' });
      return;
    }

    db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(row.id);
    const user = getUserById(row.id, db)!;
    const token = issueSessionToken(user);
    logAudit(db, {
      userId: user.id,
      action: 'LOGIN_SUCCESS',
      targetType: 'user',
      targetId: user.id,
      ipAddress: req.ip || null,
    });
    res.json({ user, token });
  });

  app.post('/api/auth/logout', requireAuth, (req: AuthenticatedRequest, res) => {
    revokeSessionToken(req.tokenJti);
    logAudit(db, {
      userId: req.user!.id,
      action: 'LOGOUT',
      targetType: 'user',
      targetId: req.user!.id,
      ipAddress: req.ip || null,
    });
    res.json({ ok: true });
  });

  app.get('/api/auth/me', requireAuth, (req: AuthenticatedRequest, res) => {
    res.json({ user: req.user });
  });

  app.post('/api/auth/change-password', requireAuth, (req: AuthenticatedRequest, res) => {
    const { currentPassword, newPassword } = req.body || {};
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user!.id) as {
      password_hash: string;
    };
    if (!verifyPassword(String(currentPassword || ''), row.password_hash)) {
      res.status(400).json({ error: 'Current password is incorrect.' });
      return;
    }
    const pwErr = validatePasswordStrength(newPassword);
    if (pwErr) {
      res.status(400).json({ error: pwErr });
      return;
    }
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), req.user!.id);
    logAudit(db, {
      userId: req.user!.id,
      action: 'PASSWORD_CHANGED',
      targetType: 'user',
      targetId: req.user!.id,
      ipAddress: req.ip || null,
    });
    res.json({ ok: true });
  });

  // ==========================================
  // DASHBOARD STATS (REAL DB QUERIES)
  // ==========================================
  app.get('/api/dashboard/stats', requireAuth, (req: AuthenticatedRequest, res) => {
    const user = req.user!;
    const isPrivileged = user.role === 'ADMIN' || user.role === 'ANALYST';

    const totalUploaded = (
      isPrivileged
        ? db.prepare('SELECT COUNT(*) AS cnt FROM documents').get()
        : db.prepare('SELECT COUNT(*) AS cnt FROM documents WHERE user_id = ?').get(user.id)
    ) as { cnt: number };

    const totalRef = db.prepare('SELECT COUNT(*) AS cnt FROM reference_documents').get() as { cnt: number };

    const analyzedCounts = (
      isPrivileged
        ? db
            .prepare(
              `SELECT
                 COUNT(*) AS total,
                 SUM(CASE WHEN risk_category = 'GREEN' THEN 1 ELSE 0 END) AS green,
                 SUM(CASE WHEN risk_category = 'YELLOW' THEN 1 ELSE 0 END) AS yellow,
                 SUM(CASE WHEN risk_category = 'RED' THEN 1 ELSE 0 END) AS red
               FROM analysis_results`
            )
            .get()
        : db
            .prepare(
              `SELECT
                 COUNT(*) AS total,
                 SUM(CASE WHEN a.risk_category = 'GREEN' THEN 1 ELSE 0 END) AS green,
                 SUM(CASE WHEN a.risk_category = 'YELLOW' THEN 1 ELSE 0 END) AS yellow,
                 SUM(CASE WHEN a.risk_category = 'RED' THEN 1 ELSE 0 END) AS red
               FROM analysis_results a
               JOIN documents d ON d.id = a.document_id
               WHERE d.user_id = ?`
            )
            .get(user.id)
    ) as { total: number; green: number | null; yellow: number | null; red: number | null };

    const dupCount = (
      isPrivileged
        ? db
            .prepare(
              `SELECT COUNT(DISTINCT document_id) AS cnt
               FROM duplicate_matches
               WHERE match_type IN ('EXACT_HASH', 'NEAR_DUPLICATE')`
            )
            .get()
        : db
            .prepare(
              `SELECT COUNT(DISTINCT dm.document_id) AS cnt
               FROM duplicate_matches dm
               JOIN documents d ON d.id = dm.document_id
               WHERE d.user_id = ? AND dm.match_type IN ('EXACT_HASH', 'NEAR_DUPLICATE')`
            )
            .get(user.id)
    ) as { cnt: number };

    const recentScans = (
      isPrivileged
        ? db
            .prepare(
              `SELECT sh.id, sh.document_id, sh.action, sh.risk_category, sh.risk_score, sh.summary, sh.created_at,
                      d.original_filename, u.username
               FROM scan_history sh
               JOIN documents d ON d.id = sh.document_id
               JOIN users u ON u.id = sh.user_id
               ORDER BY sh.id DESC LIMIT 10`
            )
            .all()
        : db
            .prepare(
              `SELECT sh.id, sh.document_id, sh.action, sh.risk_category, sh.risk_score, sh.summary, sh.created_at,
                      d.original_filename, u.username
               FROM scan_history sh
               JOIN documents d ON d.id = sh.document_id
               JOIN users u ON u.id = sh.user_id
               WHERE d.user_id = ?
               ORDER BY sh.id DESC LIMIT 10`
            )
            .all(user.id)
    ) as Array<Record<string, unknown>>;

    const refCategories = db
      .prepare('SELECT category, COUNT(*) AS count FROM reference_documents GROUP BY category')
      .all() as Array<{ category: string; count: number }>;

    res.json({
      totalUploaded: totalUploaded.cnt,
      totalReferences: totalRef.cnt,
      totalAnalyzed: analyzedCounts.total || 0,
      lowRiskCount: analyzedCounts.green || 0,
      manualReviewCount: analyzedCounts.yellow || 0,
      highRiskCount: analyzedCounts.red || 0,
      duplicateDocumentsCount: dupCount.cnt || 0,
      recentScans,
      referenceBreakdown: refCategories,
    });
  });

  // ==========================================
  // REFERENCE DOCUMENT DATASET ROUTES
  // ==========================================
  app.get('/api/references/progress', requireAuth, (_req, res) => {
    res.json(getReferenceImportProgress());
  });

  app.get('/api/references', requireAuth, (req, res) => {
    const search = String(req.query.search || '').trim().toLowerCase();
    const category = String(req.query.category || '').trim();
    const conditions: string[] = [];
    const params: Array<string> = [];

    if (category && category !== 'ALL') {
      conditions.push('category = ?');
      params.push(category);
    }
    if (search) {
      conditions.push(
        '(LOWER(ref_code) LIKE ? OR LOWER(supplier_name) LIKE ? OR LOWER(customer_name) LIKE ? OR LOWER(doc_number) LIKE ?)'
      );
      const pattern = `%${search}%`;
      params.push(pattern, pattern, pattern, pattern);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = db
      .prepare(
        `SELECT id, ref_code, category, sub_class, page_number, source_pdf, sha256_hash,
                supplier_name, customer_name, doc_number, doc_date, total_amount, currency,
                is_fictional_test_data, created_at
         FROM reference_documents
         ${whereClause}
         ORDER BY page_number ASC`
      )
      .all(...params);

    const summary = db
      .prepare('SELECT category, COUNT(*) AS count FROM reference_documents GROUP BY category')
      .all() as Array<{ category: string; count: number }>;

    const history = db
      .prepare(
        `SELECT r.*, u.username AS imported_by_username
         FROM reference_import_history r
         LEFT JOIN users u ON u.id = r.imported_by_user_id
         ORDER BY r.id DESC LIMIT 20`
      )
      .all();

    res.json({
      datasetNotice: 'FICTIONAL TEST DATA — SYNTHETIC REFERENCE SAMPLES ONLY. NOT VALID FOR PAYMENT.',
      total: rows.length,
      summary,
      references: rows,
      importHistory: history,
    });
  });

  app.get('/api/references/:id', requireAuth, (req, res) => {
    const refId = Number(req.params.id);
    const row = db.prepare('SELECT * FROM reference_documents WHERE id = ?').get(refId) as
      | Record<string, unknown>
      | undefined;
    if (!row) {
      res.status(404).json({ error: 'Reference document not found.' });
      return;
    }
    res.json({ reference: row });
  });

  app.get('/api/references/:id/pdf', requireAuth, (req, res) => {
    const refId = Number(req.params.id);
    const row = db
      .prepare('SELECT ref_code, storage_path FROM reference_documents WHERE id = ?')
      .get(refId) as { ref_code: string; storage_path: string } | undefined;
    if (!row) {
      res.status(404).json({ error: 'Reference document not found.' });
      return;
    }
    const abs = resolveConfinedPath(CONFIG.STORAGE_DIR, row.storage_path);
    if (!fs.existsSync(abs)) {
      res.status(404).json({ error: 'Reference PDF file missing from storage.' });
      return;
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${sanitizeFilename(row.ref_code)}.pdf"`);
    res.sendFile(abs);
  });

  app.post(
    '/api/references/import-default',
    requireAuth,
    requireRole('ADMIN'),
    async (req: AuthenticatedRequest, res) => {
      try {
        const forceReimport = Boolean(req.body?.forceReimport);
        if (!fs.existsSync(CONFIG.DEFAULT_REFERENCE_PDF)) {
          res.status(404).json({ error: 'Bundled 100-document reference PDF not found.' });
          return;
        }
        const result = await ingestReferencePdf({
          pdfPath: CONFIG.DEFAULT_REFERENCE_PDF,
          sourceFilename: 'DOCUGUARD_AI_100_Fictional_Reference_Documents_2adce2c4.pdf',
          userId: req.user!.id,
          forceReimport,
        });
        res.json({ ok: true, ...result });
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'Reference import failed.' });
      }
    }
  );

  app.post(
    '/api/references/import-pdf',
    requireAuth,
    requireRole('ADMIN'),
    upload.single('file'),
    async (req: AuthenticatedRequest, res) => {
      try {
        if (!req.file) {
          res.status(400).json({ error: 'PDF file is required.' });
          return;
        }
        const ext = path.extname(req.file.originalname).toLowerCase();
        if (ext !== '.pdf') {
          res.status(400).json({ error: 'Reference dataset import accepts PDF files only.' });
          return;
        }
        const result = await ingestReferencePdf({
          pdfBuffer: req.file.buffer,
          sourceFilename: sanitizeFilename(req.file.originalname),
          userId: req.user!.id,
          forceReimport: req.body?.forceReimport === 'true',
        });
        res.json({ ok: true, ...result });
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'Reference PDF import failed.' });
      }
    }
  );

  app.post(
    '/api/references/add-single',
    requireAuth,
    requireRole('ADMIN'),
    upload.single('file'),
    async (req: AuthenticatedRequest, res) => {
      try {
        if (!req.file) {
          res.status(400).json({ error: 'Reference PDF file is required.' });
          return;
        }
        const ext = path.extname(req.file.originalname).toLowerCase();
        if (ext !== '.pdf' || !validateMagicSignature(req.file.buffer, '.pdf')) {
          res.status(400).json({ error: 'Valid PDF file is required.' });
          return;
        }
        const { refCode, category } = req.body || {};
        if (!refCode || !category) {
          res.status(400).json({ error: 'Reference code and category are required.' });
          return;
        }
        const cleanCode = sanitizeFilename(String(refCode).toUpperCase());
        const hashes = computeBufferHashes(req.file.buffer);
        const relPath = path.join('references', `${cleanCode}-${hashes.sha256.slice(0, 8)}.pdf`);
        const absPath = resolveConfinedPath(CONFIG.STORAGE_DIR, relPath);
        fs.writeFileSync(absPath, req.file.buffer);

        const { extractPdfPagesText, parseFinancialFields } = await import('./server/modules/extraction.ts');
        const pages = await extractPdfPagesText(req.file.buffer);
        const text = pages.join('\n');
        const fields = parseFinancialFields(text);

        db.prepare(
          `INSERT INTO reference_documents (
            ref_code, category, sub_class, page_number, source_pdf, storage_path,
            sha256_hash, extracted_text, supplier_name, customer_name, doc_number,
            doc_date, total_amount, currency, is_fictional_test_data
          ) VALUES (?, ?, NULL, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
        ).run(
          cleanCode,
          String(category),
          sanitizeFilename(req.file.originalname),
          relPath,
          hashes.sha256,
          text,
          fields.supplierName,
          fields.customerName,
          fields.docNumber || cleanCode,
          fields.docDate,
          fields.totalAmount,
          fields.currency || 'INR'
        );

        logAudit(db, {
          userId: req.user!.id,
          action: 'REFERENCE_ADDED',
          targetType: 'reference_documents',
          targetId: cleanCode,
        });
        res.status(201).json({ ok: true, refCode: cleanCode });
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to add reference document.' });
      }
    }
  );

  app.delete('/api/references/:id', requireAuth, requireRole('ADMIN'), (req: AuthenticatedRequest, res) => {
    const refId = Number(req.params.id);
    const existing = db
      .prepare('SELECT id, ref_code, storage_path FROM reference_documents WHERE id = ?')
      .get(refId) as { id: number; ref_code: string; storage_path: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Reference document not found.' });
      return;
    }
    db.prepare('DELETE FROM reference_documents WHERE id = ?').run(refId);
    try {
      const abs = resolveConfinedPath(CONFIG.STORAGE_DIR, existing.storage_path);
      if (fs.existsSync(abs)) fs.unlinkSync(abs);
    } catch {
      // Ignore file removal error if missing
    }
    logAudit(db, {
      userId: req.user!.id,
      action: 'REFERENCE_DELETED',
      targetType: 'reference_documents',
      targetId: existing.ref_code,
    });
    res.json({ ok: true });
  });

  // ==========================================
  // DOCUMENT UPLOAD & DEMO TEST-SAMPLE HELPER
  // ==========================================
  app.post(
    '/api/documents/upload',
    requireAuth,
    upload.single('file'),
    async (req: AuthenticatedRequest, res) => {
      try {
        if (!req.file) {
          res.status(400).json({ error: 'Please select a document file to upload.' });
          return;
        }
        const safeOriginal = sanitizeFilename(req.file.originalname);
        const ext = path.extname(safeOriginal).toLowerCase();
        if (!CONFIG.ALLOWED_EXTENSIONS.has(ext)) {
          res.status(400).json({ error: 'Unsupported extension. Allowed: PDF, JPG, JPEG, PNG, DOCX.' });
          return;
        }
        if (req.file.mimetype && !CONFIG.ALLOWED_MIME_TYPES.has(req.file.mimetype) && req.file.mimetype !== 'application/octet-stream') {
          res.status(400).json({ error: `Unsupported MIME type: ${req.file.mimetype}` });
          return;
        }

        const validationErr = await validateDocumentIntegrity(req.file.buffer, ext);
        if (validationErr) {
          res.status(400).json({ error: validationErr });
          return;
        }

        const hashes = computeBufferHashes(req.file.buffer);
        const existingDup = db
          .prepare('SELECT id, original_filename FROM documents WHERE sha256_hash = ? AND user_id = ?')
          .get(hashes.sha256, req.user!.id) as { id: number; original_filename: string } | undefined;

        const storedFilename = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}-${safeOriginal}`;
        const relStoragePath = path.join('uploads', storedFilename);
        const absStoragePath = resolveConfinedPath(CONFIG.STORAGE_DIR, relStoragePath);
        fs.writeFileSync(absStoragePath, req.file.buffer);

        const info = db
          .prepare(
            `INSERT INTO documents (
              user_id, original_filename, stored_filename, storage_path,
              mime_type, file_extension, file_size, sha256_hash, md5_hash, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'UPLOADED')`
          )
          .run(
            req.user!.id,
            safeOriginal,
            storedFilename,
            relStoragePath,
            req.file.mimetype || 'application/octet-stream',
            ext,
            req.file.buffer.length,
            hashes.sha256,
            hashes.md5
          );

        const docId = Number(info.lastInsertRowid);
        db.prepare(
          `INSERT INTO scan_history (document_id, user_id, action, summary)
           VALUES (?, ?, 'DOCUMENT_UPLOADED', ?)`
        ).run(docId, req.user!.id, `Uploaded ${safeOriginal} (${req.file.buffer.length} bytes)`);

        logAudit(db, {
          userId: req.user!.id,
          action: 'DOCUMENT_UPLOADED',
          targetType: 'document',
          targetId: docId,
          details: { filename: safeOriginal, size: req.file.buffer.length, sha256: hashes.sha256 },
          ipAddress: req.ip || null,
        });

        // Automatically run analysis pipeline if requested (default true)
        let analysisId: number | null = null;
        if (req.body?.autoAnalyze !== 'false') {
          analysisId = await runDocumentAnalysisPipeline(docId, req.user!.id);
        }

        res.status(201).json({
          documentId: docId,
          analysisId,
          duplicateWarning: existingDup
            ? `Exact SHA-256 match with your prior upload "${existingDup.original_filename}" (#${existingDup.id}).`
            : null,
        });
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Upload processing failed.' });
      }
    }
  );

  // Creates a separate test copy (clean or intentionally modified for demo/QA) without altering reference dataset
  app.post('/api/documents/create-test-sample', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const { refCode, variant } = req.body || {};
      const ref = db
        .prepare('SELECT * FROM reference_documents WHERE ref_code = ?')
        .get(String(refCode || 'DG-INV-0001').toUpperCase()) as
        | {
            ref_code: string;
            storage_path: string;
            extracted_text: string;
            supplier_name: string | null;
            customer_name: string | null;
            doc_date: string | null;
            total_amount: number | null;
          }
        | undefined;

      if (!ref) {
        res.status(404).json({ error: 'Reference code not found. Import the 100-document reference PDF first.' });
        return;
      }

      let buffer: Buffer;
      let originalFilename: string;
      let mimeType: string;
      let ext: string;

      if (variant === 'modified_invoice_pdf') {
        const pdfDoc = await PDFDocument.create();
        const page = pdfDoc.addPage([595, 842]);
        const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
        const fontReg = await pdfDoc.embedFont(StandardFonts.Helvetica);

        const modifiedLines = ref.extracted_text
          .replace(/Subtotal\s+INR\s+[\d,]+\.\d{2}/i, 'Subtotal INR 48,380.00')
          .replace(/TOTAL\s+INR\s+[\d,]+\.\d{2}/i, 'TOTAL INR 59,999.00')
          .split('\n');

        page.drawText('MODIFIED TEST COPY — FICTIONAL SAMPLE FOR QA ONLY', {
          x: 42,
          y: 800,
          size: 11,
          font: fontBold,
          color: rgb(0.75, 0.1, 0.1),
        });
        let y = 770;
        for (const line of modifiedLines.slice(0, 38)) {
          page.drawText(line.replace(/[^\x20-\x7E]/g, ' ').slice(0, 95), {
            x: 42,
            y,
            size: 9,
            font: fontReg,
            color: rgb(0.1, 0.1, 0.15),
          });
          y -= 16;
        }
        buffer = Buffer.from(await pdfDoc.save());
        originalFilename = `${ref.ref_code}-MODIFIED-TEST-COPY.pdf`;
        mimeType = 'application/pdf';
        ext = '.pdf';
      } else if (variant === 'tampered_scan_jpg') {
        // Build a synthetic JPEG receipt scan with a spliced high-frequency uncompressed patch for real ELA detection
        const width = 480;
        const height = 320;
        const raw = Buffer.alloc(width * height * 4);
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * 4;
            raw[idx] = 246;
            raw[idx + 1] = 247;
            raw[idx + 2] = 250;
            raw[idx + 3] = 255;
          }
        }
        const baseJpg = jpeg.encode({ width, height, data: raw }, 60);
        const decodedBase = jpeg.decode(baseJpg.data, { useTArray: true, formatAsRGBA: true });
        // Splice a high-frequency RGB texture block simulating pasted/altered amount text saved at higher quality
        for (let y = 112; y < 184; y++) {
          for (let x = 216; x < 384; x++) {
            const idx = (y * width + x) * 4;
            const checker = ((x * 7 + y * 13) % 5 === 0) || ((x ^ y) & 1) === 0;
            decodedBase.data[idx] = checker ? 24 : 245;
            decodedBase.data[idx + 1] = checker ? 18 : 250;
            decodedBase.data[idx + 2] = checker ? 190 : 255;
            decodedBase.data[idx + 3] = 255;
          }
        }
        const finalJpg = jpeg.encode({ width, height, data: Buffer.from(decodedBase.data) }, 99);
        buffer = finalJpg.data;
        originalFilename = `${ref.ref_code}-TAMPERED-PATCH-SCAN.jpg`;
        mimeType = 'image/jpeg';
        ext = '.jpg';
      } else {
        const absRef = resolveConfinedPath(CONFIG.STORAGE_DIR, ref.storage_path);
        buffer = fs.readFileSync(absRef);
        originalFilename = `${ref.ref_code}-CLEAN-TEST-COPY.pdf`;
        mimeType = 'application/pdf';
        ext = '.pdf';
      }

      const hashes = computeBufferHashes(buffer);
      const storedFilename = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}-${originalFilename}`;
      const relPath = path.join('uploads', storedFilename);
      fs.writeFileSync(resolveConfinedPath(CONFIG.STORAGE_DIR, relPath), buffer);

      const info = db
        .prepare(
          `INSERT INTO documents (
            user_id, original_filename, stored_filename, storage_path,
            mime_type, file_extension, file_size, sha256_hash, md5_hash, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'UPLOADED')`
        )
        .run(
          req.user!.id,
          originalFilename,
          storedFilename,
          relPath,
          mimeType,
          ext,
          buffer.length,
          hashes.sha256,
          hashes.md5
        );
      const docId = Number(info.lastInsertRowid);
      const analysisId = await runDocumentAnalysisPipeline(docId, req.user!.id);
      res.status(201).json({ documentId: docId, analysisId, originalFilename });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create test sample.' });
    }
  });

  // ==========================================
  // DOCUMENTS, ANALYSIS, TAMPERING, DUPLICATES
  // ==========================================
  app.get('/api/documents', requireAuth, (req: AuthenticatedRequest, res) => {
    const user = req.user!;
    const isPrivileged = user.role === 'ADMIN' || user.role === 'ANALYST';
    const rows = (
      isPrivileged
        ? db
            .prepare(
              `SELECT d.*, u.username AS uploaded_by_username,
                      a.predicted_category, a.classification_confidence, a.risk_score,
                      a.risk_category, a.human_review_status, a.analyzed_at,
                      e.supplier_name, e.customer_name, e.doc_number, e.total_amount, e.currency
               FROM documents d
               JOIN users u ON u.id = d.user_id
               LEFT JOIN analysis_results a ON a.document_id = d.id
               LEFT JOIN extracted_data e ON e.document_id = d.id
               ORDER BY d.id DESC`
            )
            .all()
        : db
            .prepare(
              `SELECT d.*, u.username AS uploaded_by_username,
                      a.predicted_category, a.classification_confidence, a.risk_score,
                      a.risk_category, a.human_review_status, a.analyzed_at,
                      e.supplier_name, e.customer_name, e.doc_number, e.total_amount, e.currency
               FROM documents d
               JOIN users u ON u.id = d.user_id
               LEFT JOIN analysis_results a ON a.document_id = d.id
               LEFT JOIN extracted_data e ON e.document_id = d.id
               WHERE d.user_id = ?
               ORDER BY d.id DESC`
            )
            .all(user.id)
    ) as Array<Record<string, unknown>>;
    res.json({ documents: rows });
  });

  app.get('/api/documents/:id', requireAuth, (req: AuthenticatedRequest, res) => {
    const docId = Number(req.params.id);
    const doc = db
      .prepare(
        `SELECT d.*, u.username AS uploaded_by_username
         FROM documents d
         JOIN users u ON u.id = d.user_id
         WHERE d.id = ?`
      )
      .get(docId) as (Record<string, unknown> & { user_id: number }) | undefined;

    if (!doc) {
      res.status(404).json({ error: 'Document not found.' });
      return;
    }
    if (!canAccessDocument(req.user!, doc.user_id)) {
      res.status(403).json({ error: 'Access denied to this document.' });
      return;
    }

    const extracted = db.prepare('SELECT * FROM extracted_data WHERE document_id = ?').get(docId);
    const analysis = db.prepare('SELECT * FROM analysis_results WHERE document_id = ?').get(docId) as
      | (Record<string, unknown> & { id: number })
      | undefined;

    const anomalies = analysis
      ? db.prepare('SELECT * FROM detected_anomalies WHERE analysis_id = ? ORDER BY score_impact DESC').all(analysis.id)
      : [];

    const matches = db
      .prepare(
        `SELECT dm.*,
                md.original_filename AS matched_doc_filename,
                rd.ref_code AS matched_ref_code, rd.category AS matched_ref_category
         FROM duplicate_matches dm
         LEFT JOIN documents md ON md.id = dm.matched_document_id
         LEFT JOIN reference_documents rd ON rd.id = dm.matched_reference_id
         WHERE dm.document_id = ?
         ORDER BY dm.similarity_score DESC`
      )
      .all(docId);

    res.json({ document: doc, extracted, analysis, anomalies, matches });
  });

  app.post('/api/documents/:id/analyze', requireAuth, async (req: AuthenticatedRequest, res) => {
    const docId = Number(req.params.id);
    const doc = db.prepare('SELECT id, user_id FROM documents WHERE id = ?').get(docId) as
      | { id: number; user_id: number }
      | undefined;
    if (!doc) {
      res.status(404).json({ error: 'Document not found.' });
      return;
    }
    if (!canAccessDocument(req.user!, doc.user_id)) {
      res.status(403).json({ error: 'Access denied.' });
      return;
    }
    try {
      const analysisId = await runDocumentAnalysisPipeline(docId, req.user!.id);
      res.json({ ok: true, analysisId });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Analysis failed.' });
    }
  });

  app.post('/api/documents/:id/review', requireAuth, (req: AuthenticatedRequest, res) => {
    const docId = Number(req.params.id);
    const { status, notes } = req.body || {};
    if (!['APPROVED', 'FLAGGED', 'PENDING'].includes(status)) {
      res.status(400).json({ error: 'Invalid review status.' });
      return;
    }
    const doc = db.prepare('SELECT id, user_id FROM documents WHERE id = ?').get(docId) as
      | { id: number; user_id: number }
      | undefined;
    if (!doc) {
      res.status(404).json({ error: 'Document not found.' });
      return;
    }
    if (!canAccessDocument(req.user!, doc.user_id)) {
      res.status(403).json({ error: 'Access denied.' });
      return;
    }

    db.prepare(
      `UPDATE analysis_results
       SET human_review_status = ?, human_reviewer_id = ?, human_review_notes = ?, reviewed_at = datetime('now')
       WHERE document_id = ?`
    ).run(status, req.user!.id, String(notes || '').slice(0, 1000), docId);

    db.prepare(
      `INSERT INTO scan_history (document_id, user_id, action, summary)
       VALUES (?, ?, 'HUMAN_REVIEW_UPDATED', ?)`
    ).run(docId, req.user!.id, `Human review marked as ${status}`);

    logAudit(db, {
      userId: req.user!.id,
      action: 'HUMAN_REVIEW_UPDATED',
      targetType: 'document',
      targetId: docId,
      details: { status },
    });
    res.json({ ok: true });
  });

  app.get('/api/documents/:id/file', requireAuth, (req: AuthenticatedRequest, res) => {
    const docId = Number(req.params.id);
    const doc = db
      .prepare('SELECT user_id, original_filename, mime_type, storage_path FROM documents WHERE id = ?')
      .get(docId) as { user_id: number; original_filename: string; mime_type: string; storage_path: string } | undefined;
    if (!doc) {
      res.status(404).json({ error: 'Document not found.' });
      return;
    }
    if (!canAccessDocument(req.user!, doc.user_id)) {
      res.status(403).json({ error: 'Access denied.' });
      return;
    }
    const abs = resolveConfinedPath(CONFIG.STORAGE_DIR, doc.storage_path);
    if (!fs.existsSync(abs)) {
      res.status(404).json({ error: 'File missing.' });
      return;
    }
    res.setHeader('Content-Type', doc.mime_type);
    res.setHeader('Content-Disposition', `inline; filename="${sanitizeFilename(doc.original_filename)}"`);
    res.sendFile(abs);
  });

  app.get('/api/documents/:id/visual/:kind', requireAuth, (req: AuthenticatedRequest, res) => {
    const docId = Number(req.params.id);
    const kind = req.params.kind === 'overlay' ? 'overlay_path' : 'heatmap_path';
    const row = db
      .prepare(
        `SELECT d.user_id, a.heatmap_path, a.overlay_path
         FROM documents d
         JOIN analysis_results a ON a.document_id = d.id
         WHERE d.id = ?`
      )
      .get(docId) as { user_id: number; heatmap_path: string | null; overlay_path: string | null } | undefined;

    if (!row) {
      res.status(404).json({ error: 'Visual inspection artifacts not found.' });
      return;
    }
    if (!canAccessDocument(req.user!, row.user_id)) {
      res.status(403).json({ error: 'Access denied.' });
      return;
    }
    const rel = row[kind];
    if (!rel) {
      res.status(404).json({ error: 'No raster heatmap available for this document.' });
      return;
    }
    const abs = resolveConfinedPath(CONFIG.STORAGE_DIR, rel);
    if (!fs.existsSync(abs)) {
      res.status(404).json({ error: 'Visual artifact missing from storage.' });
      return;
    }
    res.setHeader('Content-Type', 'image/png');
    res.sendFile(abs);
  });

  // Side-by-side comparison (Document vs Document or Document vs Reference)
  app.post('/api/compare', requireAuth, (req: AuthenticatedRequest, res) => {
    const { sourceDocId, targetDocId, targetRefId } = req.body || {};
    const src = db
      .prepare(
        `SELECT d.id, d.user_id, d.original_filename, d.phash, e.raw_text
         FROM documents d
         LEFT JOIN extracted_data e ON e.document_id = d.id
         WHERE d.id = ?`
      )
      .get(Number(sourceDocId)) as
      | { id: number; user_id: number; original_filename: string; phash: string | null; raw_text: string | null }
      | undefined;

    if (!src) {
      res.status(404).json({ error: 'Source document not found.' });
      return;
    }
    if (!canAccessDocument(req.user!, src.user_id)) {
      res.status(403).json({ error: 'Access denied to source document.' });
      return;
    }

    let targetLabel = '';
    let targetText = '';
    let targetPhash: string | null = null;
    let resolvedTargetDocId: number | null = null;
    let resolvedTargetRefId: number | null = null;

    if (targetDocId) {
      const tgt = db
        .prepare(
          `SELECT d.id, d.user_id, d.original_filename, d.phash, e.raw_text
           FROM documents d
           LEFT JOIN extracted_data e ON e.document_id = d.id
           WHERE d.id = ?`
        )
        .get(Number(targetDocId)) as
        | { id: number; user_id: number; original_filename: string; phash: string | null; raw_text: string | null }
        | undefined;
      if (!tgt) {
        res.status(404).json({ error: 'Target document not found.' });
        return;
      }
      if (!canAccessDocument(req.user!, tgt.user_id)) {
        res.status(403).json({ error: 'Access denied to target document.' });
        return;
      }
      targetLabel = `${tgt.original_filename} (#${tgt.id})`;
      targetText = tgt.raw_text || '';
      targetPhash = tgt.phash;
      resolvedTargetDocId = tgt.id;
    } else if (targetRefId) {
      const ref = db
        .prepare('SELECT id, ref_code, category, phash, extracted_text FROM reference_documents WHERE id = ?')
        .get(Number(targetRefId)) as
        | { id: number; ref_code: string; category: string; phash: string | null; extracted_text: string }
        | undefined;
      if (!ref) {
        res.status(404).json({ error: 'Target reference document not found.' });
        return;
      }
      targetLabel = `${ref.ref_code} (${ref.category} · Fictional Reference)`;
      targetText = ref.extracted_text || '';
      targetPhash = ref.phash;
      resolvedTargetRefId = ref.id;
    } else {
      res.status(400).json({ error: 'Specify targetDocId or targetRefId.' });
      return;
    }

    const srcText = src.raw_text || '';
    const jaccard = computeJaccardTokenSimilarity(targetText, srcText);
    const tfidf = computeTfIdfSimilarityMatrix(srcText, [targetText])[0] || 0;
    const imgSim = hammingSimilarity(src.phash, targetPhash);
    const changedLines = computeLineDiff(targetText, srcText);

    const diffSummary = `${changedLines.length} changed/added/removed line(s) detected. TF-IDF similarity ${(
      tfidf * 100
    ).toFixed(1)}%, Token similarity ${(jaccard * 100).toFixed(1)}%.`;

    db.prepare(
      `INSERT INTO document_comparisons (
        source_doc_id, target_doc_id, target_ref_id, user_id,
        text_similarity, tfidf_similarity, image_similarity, changed_lines_json, diff_summary
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      src.id,
      resolvedTargetDocId,
      resolvedTargetRefId,
      req.user!.id,
      jaccard,
      tfidf,
      imgSim,
      JSON.stringify(changedLines),
      diffSummary
    );

    res.json({
      sourceLabel: `${src.original_filename} (#${src.id})`,
      targetLabel,
      textSimilarity: jaccard,
      tfidfSimilarity: tfidf,
      imageSimilarity: imgSim,
      changedLines,
      diffSummary,
    });
  });

  app.get('/api/duplicates', requireAuth, (req: AuthenticatedRequest, res) => {
    const user = req.user!;
    const isPrivileged = user.role === 'ADMIN' || user.role === 'ANALYST';
    const rows = (
      isPrivileged
        ? db
            .prepare(
              `SELECT dm.*,
                      sd.original_filename AS source_filename, sd.sha256_hash AS source_sha256,
                      md.original_filename AS matched_filename, md.sha256_hash AS matched_sha256,
                      rd.ref_code AS matched_ref_code, rd.category AS matched_ref_category
               FROM duplicate_matches dm
               JOIN documents sd ON sd.id = dm.document_id
               LEFT JOIN documents md ON md.id = dm.matched_document_id
               LEFT JOIN reference_documents rd ON rd.id = dm.matched_reference_id
               ORDER BY dm.id DESC`
            )
            .all()
        : db
            .prepare(
              `SELECT dm.*,
                      sd.original_filename AS source_filename, sd.sha256_hash AS source_sha256,
                      md.original_filename AS matched_filename, md.sha256_hash AS matched_sha256,
                      rd.ref_code AS matched_ref_code, rd.category AS matched_ref_category
               FROM duplicate_matches dm
               JOIN documents sd ON sd.id = dm.document_id
               LEFT JOIN documents md ON md.id = dm.matched_document_id
               LEFT JOIN reference_documents rd ON rd.id = dm.matched_reference_id
               WHERE sd.user_id = ?
               ORDER BY dm.id DESC`
            )
            .all(user.id)
    ) as Array<Record<string, unknown>>;

    res.json({ matches: rows });
  });

  // ==========================================
  // REPORTS (PDF & JSON)
  // ==========================================
  app.get('/api/reports', requireAuth, (req: AuthenticatedRequest, res) => {
    const user = req.user!;
    const isPrivileged = user.role === 'ADMIN' || user.role === 'ANALYST';
    const rows = (
      isPrivileged
        ? db
            .prepare(
              `SELECT r.*, d.original_filename, u.username AS generated_by_username
               FROM reports r
               JOIN documents d ON d.id = r.document_id
               JOIN users u ON u.id = r.user_id
               ORDER BY r.id DESC`
            )
            .all()
        : db
            .prepare(
              `SELECT r.*, d.original_filename, u.username AS generated_by_username
               FROM reports r
               JOIN documents d ON d.id = r.document_id
               JOIN users u ON u.id = r.user_id
               WHERE d.user_id = ?
               ORDER BY r.id DESC`
            )
            .all(user.id)
    ) as Array<Record<string, unknown>>;
    res.json({ reports: rows });
  });

  app.post('/api/reports/generate', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const { documentId, reportType } = req.body || {};
      const type = String(reportType || 'PDF').toUpperCase();
      if (type !== 'PDF' && type !== 'JSON') {
        res.status(400).json({ error: 'Report type must be PDF or JSON.' });
        return;
      }
      const docId = Number(documentId);
      const doc = db
        .prepare(
          `SELECT d.*, u.username AS uploaded_by_username
           FROM documents d
           JOIN users u ON u.id = d.user_id
           WHERE d.id = ?`
        )
        .get(docId) as
        | {
            id: number;
            user_id: number;
            original_filename: string;
            file_extension: string;
            mime_type: string;
            file_size: number;
            sha256_hash: string;
            md5_hash: string;
            uploaded_at: string;
            uploaded_by_username: string;
          }
        | undefined;

      if (!doc) {
        res.status(404).json({ error: 'Document not found.' });
        return;
      }
      if (!canAccessDocument(req.user!, doc.user_id)) {
        res.status(403).json({ error: 'Access denied to generate report for this document.' });
        return;
      }

      const extracted = db.prepare('SELECT * FROM extracted_data WHERE document_id = ?').get(docId) as
        | Record<string, unknown>
        | undefined;
      const analysis = db.prepare('SELECT * FROM analysis_results WHERE document_id = ?').get(docId) as
        | (Record<string, unknown> & { id: number; heatmap_path: string | null })
        | undefined;

      if (!analysis || !extracted) {
        res.status(400).json({ error: 'Run document analysis before generating a report.' });
        return;
      }

      const scoreData = JSON.parse(String(analysis.score_factors_json || '{}'));
      const visualData = JSON.parse(String(analysis.visual_findings_json || '{}'));
      const consistencyData = JSON.parse(String(analysis.consistency_findings_json || '[]'));
      const metadataData = JSON.parse(String(extracted.metadata_json || '{}'));

      const matches = db
        .prepare(
          `SELECT dm.match_type AS matchType, dm.similarity_score AS similarityScore,
                  dm.reason, md.original_filename AS matchedDoc, rd.ref_code AS matchedRef
           FROM duplicate_matches dm
           LEFT JOIN documents md ON md.id = dm.matched_document_id
           LEFT JOIN reference_documents rd ON rd.id = dm.matched_reference_id
           WHERE dm.document_id = ?`
        )
        .all(docId) as Array<Record<string, unknown>>;

      const payload: ReportPayload = {
        generatedAt: new Date().toISOString(),
        disclaimer: 'Automated assessment only. Human verification is recommended before financial decisions.',
        document: {
          id: doc.id,
          originalFilename: doc.original_filename,
          extension: doc.file_extension,
          mimeType: doc.mime_type,
          fileSize: doc.file_size,
          sha256: doc.sha256_hash,
          md5: doc.md5_hash,
          uploadedAt: doc.uploaded_at,
          uploadedByUsername: doc.uploaded_by_username,
        },
        classification: {
          predictedCategory: String(analysis.predicted_category),
          confidence: Number(analysis.classification_confidence),
        },
        metadata: metadataData.formatDetails || {},
        extractedFields: {
          supplierName: extracted.supplier_name,
          customerName: extracted.customer_name,
          docNumber: extracted.doc_number,
          docDate: extracted.doc_date,
          dueDate: extracted.due_date,
          currency: extracted.currency,
          subtotal: extracted.subtotal,
          taxAmount: extracted.tax_amount,
          totalAmount: extracted.total_amount,
          lineItems: JSON.parse(String(extracted.line_items_json || '[]')),
        },
        ocrRawTextPreview: String(extracted.raw_text || '').slice(0, 2000),
        visualAnalysis: {
          applicable: visualData.applicable,
          meanEla: visualData.meanEla,
          maxEla: visualData.maxEla,
          suspiciousRegionCount: Array.isArray(visualData.suspiciousRegions)
            ? visualData.suspiciousRegions.length
            : 0,
          summary: visualData.summary,
          disclaimer: visualData.disclaimer,
        },
        consistencyChecks: consistencyData,
        duplicateAndReferenceMatches: matches,
        riskAssessment: {
          riskScore: Number(analysis.risk_score),
          riskCategory: String(analysis.risk_category),
          riskSummary: String(analysis.risk_summary),
          factors: scoreData.factors || [],
          humanReviewStatus: String(analysis.human_review_status),
          humanReviewNotes: (analysis.human_review_notes as string | null) || null,
        },
      };

      let storagePath: string;
      let reportHash: string;
      if (type === 'JSON') {
        const out = buildSafeJsonReport(payload);
        storagePath = out.storagePath;
        reportHash = out.reportHash;
      } else {
        const heatmapAbs = analysis.heatmap_path
          ? resolveConfinedPath(CONFIG.STORAGE_DIR, analysis.heatmap_path)
          : null;
        const out = await buildPdfReport(payload, heatmapAbs);
        storagePath = out.storagePath;
        reportHash = out.reportHash;
      }

      const info = db
        .prepare(
          `INSERT INTO reports (document_id, user_id, report_type, storage_path, report_hash)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(docId, req.user!.id, type, storagePath, reportHash);

      logAudit(db, {
        userId: req.user!.id,
        action: 'REPORT_GENERATED',
        targetType: 'report',
        targetId: Number(info.lastInsertRowid),
        details: { documentId: docId, reportType: type },
      });

      res.status(201).json({
        reportId: Number(info.lastInsertRowid),
        reportType: type,
        reportHash,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Report generation failed.' });
    }
  });

  app.get('/api/reports/:id/download', requireAuth, (req: AuthenticatedRequest, res) => {
    const reportId = Number(req.params.id);
    const report = db
      .prepare(
        `SELECT r.*, d.user_id AS doc_owner_id, d.original_filename
         FROM reports r
         JOIN documents d ON d.id = r.document_id
         WHERE r.id = ?`
      )
      .get(reportId) as
      | {
          id: number;
          report_type: 'PDF' | 'JSON';
          storage_path: string;
          doc_owner_id: number;
          original_filename: string;
        }
      | undefined;

    if (!report) {
      res.status(404).json({ error: 'Report not found.' });
      return;
    }
    if (!canAccessDocument(req.user!, report.doc_owner_id)) {
      res.status(403).json({ error: 'Access denied to download this report.' });
      return;
    }
    const abs = resolveConfinedPath(CONFIG.STORAGE_DIR, report.storage_path);
    if (!fs.existsSync(abs)) {
      res.status(404).json({ error: 'Report file missing from storage.' });
      return;
    }
    const baseName = sanitizeFilename(report.original_filename.replace(/\.[^.]+$/, ''));
    const dlName = `docuguard-${baseName}-report.${report.report_type.toLowerCase()}`;
    res.setHeader('Content-Type', report.report_type === 'PDF' ? 'application/pdf' : 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${dlName}"`);
    res.sendFile(abs);
  });

  // ==========================================
  // SCAN HISTORY
  // ==========================================
  app.get('/api/history', requireAuth, (req: AuthenticatedRequest, res) => {
    const user = req.user!;
    const isPrivileged = user.role === 'ADMIN' || user.role === 'ANALYST';
    const rows = (
      isPrivileged
        ? db
            .prepare(
              `SELECT sh.*, d.original_filename, u.username
               FROM scan_history sh
               JOIN documents d ON d.id = sh.document_id
               JOIN users u ON u.id = sh.user_id
               ORDER BY sh.id DESC LIMIT 200`
            )
            .all()
        : db
            .prepare(
              `SELECT sh.*, d.original_filename, u.username
               FROM scan_history sh
               JOIN documents d ON d.id = sh.document_id
               JOIN users u ON u.id = sh.user_id
               WHERE d.user_id = ?
               ORDER BY sh.id DESC LIMIT 200`
            )
            .all(user.id)
    ) as Array<Record<string, unknown>>;
    res.json({ history: rows });
  });

  // ==========================================
  // ADMIN: USER MANAGEMENT, AUDIT LOGS & SETTINGS
  // ==========================================
  app.get('/api/admin/users', requireAuth, requireRole('ADMIN'), (_req, res) => {
    const users = db
      .prepare(
        `SELECT u.id, u.username, u.email, u.full_name, u.status, u.created_at, u.last_login_at, r.name AS role
         FROM users u
         JOIN roles r ON u.role_id = r.id
         ORDER BY u.id ASC`
      )
      .all();
    res.json({ users });
  });

  app.patch('/api/admin/users/:id', requireAuth, requireRole('ADMIN'), (req: AuthenticatedRequest, res) => {
    const targetId = Number(req.params.id);
    const { role, status } = req.body || {};
    const target = getUserById(targetId, db);
    if (!target) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    if (role && ['ADMIN', 'ANALYST', 'USER'].includes(role)) {
      if (targetId === req.user!.id && role !== 'ADMIN') {
        res.status(400).json({ error: 'Cannot remove your own administrator role.' });
        return;
      }
      const roleRow = db.prepare('SELECT id FROM roles WHERE name = ?').get(role as UserRole) as { id: number };
      db.prepare('UPDATE users SET role_id = ? WHERE id = ?').run(roleRow.id, targetId);
    }

    if (status && ['ACTIVE', 'SUSPENDED'].includes(status)) {
      if (targetId === req.user!.id && status !== 'ACTIVE') {
        res.status(400).json({ error: 'Cannot suspend your own active session account.' });
        return;
      }
      db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, targetId);
    }

    logAudit(db, {
      userId: req.user!.id,
      action: 'ADMIN_USER_UPDATED',
      targetType: 'user',
      targetId,
      details: { role, status },
    });
    res.json({ user: getUserById(targetId, db) });
  });

  app.get('/api/admin/audit-logs', requireAuth, requireRole('ADMIN'), (_req, res) => {
    const logs = db
      .prepare(
        `SELECT a.*, u.username
         FROM audit_logs a
         LEFT JOIN users u ON u.id = a.user_id
         ORDER BY a.id DESC LIMIT 200`
      )
      .all();
    res.json({ logs });
  });

  app.get('/api/settings', requireAuth, (_req, res) => {
    const rows = db.prepare('SELECT key, value, updated_at FROM system_settings').all() as Array<{
      key: string;
      value: string;
      updated_at: string;
    }>;
    const settings: Record<string, string> = {};
    for (const r of rows) settings[r.key] = r.value;
    res.json({ settings });
  });

  app.put('/api/settings', requireAuth, requireRole('ADMIN'), (req: AuthenticatedRequest, res) => {
    const updates = req.body?.settings;
    if (!updates || typeof updates !== 'object') {
      res.status(400).json({ error: 'Settings payload is required.' });
      return;
    }
    const allowedKeys = new Set([
      'near_duplicate_tfidf_threshold',
      'near_duplicate_phash_threshold',
      'visual_ela_block_threshold',
      'tax_tolerance_amount',
      'enable_ocr_fallback',
    ]);
    const upsert = db.prepare(
      "INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')"
    );
    for (const [k, v] of Object.entries(updates)) {
      if (allowedKeys.has(k)) {
        upsert.run(k, String(v).slice(0, 32));
      }
    }
    logAudit(db, {
      userId: req.user!.id,
      action: 'SETTINGS_UPDATED',
      targetType: 'system_settings',
      details: updates as Record<string, unknown>,
    });
    res.json({ ok: true });
  });

  // Safe error handler for Multer / unexpected errors
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        res.status(400).json({ error: 'File size exceeds the 20 MB maximum limit.' });
        return;
      }
      res.status(400).json({ error: `Upload error: ${err.message}` });
      return;
    }
    res.status(500).json({ error: 'Internal server error.' });
  });

  return app;
}

async function startServer() {
  const app = createApp();
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(CONFIG.PORT, '0.0.0.0', () => {
    console.log(`DocuGuard AI server running on http://0.0.0.0:${CONFIG.PORT}`);
  });
}

// Start server only when executed directly (allows Vitest supertest/app imports without binding port)
const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith('server.ts') || process.argv[1].endsWith('server.js'));

if (isDirectRun) {
  startServer().catch((err) => {
    console.error('Failed to start DocuGuard AI server:', err);
    process.exit(1);
  });
}
