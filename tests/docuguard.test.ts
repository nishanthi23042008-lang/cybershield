import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import * as jpeg from 'jpeg-js';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { PNG } from 'pngjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'docuguard-qa-'));
process.env.STORAGE_DIR = path.join(tempRoot, 'storage');
process.env.DB_PATH = path.join(tempRoot, 'storage', 'docuguard-test.db');
process.env.SESSION_SECRET = 'test-only-ephemeral-signing-key-32bytes';

let server: http.Server;
let baseUrl = '';
let resolveConfinedPathFn: (baseDir: string, targetPath: string) => string;
let validateDocumentIntegrityFn: (buffer: Buffer, ext: string) => Promise<string | null>;

async function apiJson<T = Record<string, unknown>>(
  route: string,
  options: { method?: string; token?: string; body?: unknown } = {}
): Promise<{ status: number; data: T }> {
  const headers: Record<string, string> = {};
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${baseUrl}${route}`, {
    method: options.method || 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  const data = (text ? JSON.parse(text) : {}) as T;
  return { status: res.status, data };
}

async function uploadMultipart(
  route: string,
  token: string,
  filename: string,
  mimeType: string,
  buffer: Buffer,
  extraFields: Record<string, string> = {}
): Promise<{ status: number; data: Record<string, unknown> }> {
  const form = new FormData();
  const blob = new Blob([new Uint8Array(buffer)], { type: mimeType });
  form.append('file', blob, filename);
  for (const [k, v] of Object.entries(extraFields)) {
    form.append(k, v);
  }
  const res = await fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const text = await res.text();
  return { status: res.status, data: (text ? JSON.parse(text) : {}) as Record<string, unknown> };
}

async function createMinimalPdf(text: string): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText(text, { x: 40, y: 760, size: 11, font });
  return Buffer.from(await doc.save());
}

function createMinimalPng(width = 64, height = 64): Buffer {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height * 4; i += 4) {
    png.data[i] = 240;
    png.data[i + 1] = 244;
    png.data[i + 2] = 250;
    png.data[i + 3] = 255;
  }
  return PNG.sync.write(png);
}

function createMinimalJpg(width = 64, height = 64): Buffer {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 235;
    data[i + 1] = 238;
    data[i + 2] = 242;
    data[i + 3] = 255;
  }
  return jpeg.encode({ width, height, data }, 85).data;
}

async function createMinimalDocx(text: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>'
  );
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('DocuGuard AI End-to-End Verification & Security Audit', () => {
  let adminToken = '';
  let user1Token = '';
  let user2Token = '';
  let user1DocId = 0;
  let cleanDocId = 0;
  let modifiedDocId = 0;
  let tamperedJpgDocId = 0;

  beforeAll(async () => {
    const serverMod = await import('../server.ts');
    const configMod = await import('../server/config.ts');
    resolveConfinedPathFn = configMod.resolveConfinedPath;
    validateDocumentIntegrityFn = serverMod.validateDocumentIntegrity;

    const app = serverMod.createApp();
    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          baseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      if (server) server.close(() => resolve());
      else resolve();
    });
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('requires initial admin claim once, then blocks second unclaimed setup', async () => {
    const statusRes = await apiJson<{ needsAdminSetup: boolean }>('/api/auth/bootstrap-status');
    expect(statusRes.status).toBe(200);
    expect(statusRes.data.needsAdminSetup).toBe(true);

    const setupRes = await apiJson<{ user: { role: string }; token: string }>('/api/auth/setup-admin', {
      method: 'POST',
      body: {
        username: 'qa_admin',
        email: 'admin@docuguard.test',
        fullName: 'QA Administrator',
        password: 'AdminPass123!',
      },
    });
    expect(setupRes.status).toBe(201);
    expect(setupRes.data.user.role).toBe('ADMIN');
    adminToken = setupRes.data.token;

    const secondSetup = await apiJson('/api/auth/setup-admin', {
      method: 'POST',
      body: {
        username: 'attacker_admin',
        email: 'evil@docuguard.test',
        password: 'AdminPass123!',
      },
    });
    expect(secondSetup.status).toBe(403);
  });

  it('registers USER role only, prevents duplicates, blocks SQLi login, and validates password changes', async () => {
    const reg1 = await apiJson<{ user: { role: string }; token: string }>('/api/auth/register', {
      method: 'POST',
      body: {
        username: 'analyst_user1',
        email: 'u1@docuguard.test',
        fullName: 'User One',
        password: 'UserPass123!',
      },
    });
    expect(reg1.status).toBe(201);
    expect(reg1.data.user.role).toBe('USER');
    user1Token = reg1.data.token;

    const dupReg = await apiJson('/api/auth/register', {
      method: 'POST',
      body: {
        username: 'analyst_user1',
        email: 'u1@docuguard.test',
        password: 'UserPass123!',
      },
    });
    expect(dupReg.status).toBe(409);

    const reg2 = await apiJson<{ token: string }>('/api/auth/register', {
      method: 'POST',
      body: {
        username: 'other_user2',
        email: 'u2@docuguard.test',
        password: 'UserPass123!',
      },
    });
    expect(reg2.status).toBe(201);
    user2Token = reg2.data.token;

    const sqliLogin = await apiJson('/api/auth/login', {
      method: 'POST',
      body: { identifier: "' OR '1'='1", password: "' OR '1'='1" },
    });
    expect(sqliLogin.status).toBe(401);

    const badLogin = await apiJson('/api/auth/login', {
      method: 'POST',
      body: { identifier: 'analyst_user1', password: 'WrongPassword1' },
    });
    expect(badLogin.status).toBe(401);

    const unauth = await apiJson('/api/documents');
    expect(unauth.status).toBe(401);

    const forbiddenAdmin = await apiJson('/api/admin/users', { token: user1Token });
    expect(forbiddenAdmin.status).toBe(403);

    const pwChange = await apiJson('/api/auth/change-password', {
      method: 'POST',
      token: user2Token,
      body: { currentPassword: 'UserPass123!', newPassword: 'NewUserPass456!' },
    });
    expect(pwChange.status).toBe(200);

    const relogin = await apiJson<{ token: string }>('/api/auth/login', {
      method: 'POST',
      body: { identifier: 'other_user2', password: 'NewUserPass456!' },
    });
    expect(relogin.status).toBe(200);
    user2Token = relogin.data.token;
  });

  it('blocks path traversal and enforces file type, magic signature, malformed, and size validation', async () => {
    expect(() => resolveConfinedPathFn(process.env.STORAGE_DIR!, '../../etc/passwd')).toThrow(
      /Path traversal/
    );

    const oversizedErr = await validateDocumentIntegrityFn(
      Buffer.alloc(20 * 1024 * 1024 + 1),
      '.pdf'
    );
    expect(oversizedErr).toMatch(/20 MB/);

    const emptyRes = await uploadMultipart(
      '/api/documents/upload',
      user1Token,
      'empty.pdf',
      'application/pdf',
      Buffer.alloc(0)
    );
    expect(emptyRes.status).toBe(400);

    const badExtRes = await uploadMultipart(
      '/api/documents/upload',
      user1Token,
      'payload.html',
      'text/html',
      Buffer.from('<script>alert(1)</script>')
    );
    expect(badExtRes.status).toBe(400);

    const spoofedRes = await uploadMultipart(
      '/api/documents/upload',
      user1Token,
      'spoofed.pdf',
      'application/pdf',
      Buffer.from('Not a PDF at all')
    );
    expect(spoofedRes.status).toBe(400);

    const malformedPdfRes = await uploadMultipart(
      '/api/documents/upload',
      user1Token,
      'broken.pdf',
      'application/pdf',
      Buffer.from('%PDF-1.7\ncorrupted-xref-table')
    );
    expect(malformedPdfRes.status).toBe(400);

    const validPdf = await createMinimalPdf('Tax Invoice INV-9001 Subtotal INR 1000.00 Total INR 1180.00');
    const okPdfRes = await uploadMultipart(
      '/api/documents/upload',
      user1Token,
      'sample-invoice.pdf',
      'application/pdf',
      validPdf
    );
    expect(okPdfRes.status).toBe(201);
    user1DocId = Number(okPdfRes.data.documentId);

    const okPngRes = await uploadMultipart(
      '/api/documents/upload',
      user1Token,
      'scan.png',
      'image/png',
      createMinimalPng(),
      { autoAnalyze: 'false' }
    );
    expect(okPngRes.status).toBe(201);

    const okJpgRes = await uploadMultipart(
      '/api/documents/upload',
      user1Token,
      'receipt.jpg',
      'image/jpeg',
      createMinimalJpg(),
      { autoAnalyze: 'false' }
    );
    expect(okJpgRes.status).toBe(201);

    const okDocxRes = await uploadMultipart(
      '/api/documents/upload',
      user1Token,
      'statement.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      await createMinimalDocx('Vendor Purchase Order PO-7721 Total USD 500.00'),
      { autoAnalyze: 'false' }
    );
    expect(okDocxRes.status).toBe(201);

    // RBAC cross-user isolation check
    const user2Access = await apiJson(`/api/documents/${user1DocId}`, { token: user2Token });
    expect(user2Access.status).toBe(403);

    const adminAccess = await apiJson(`/api/documents/${user1DocId}`, { token: adminToken });
    expect(adminAccess.status).toBe(200);
  });

  it('ingests the bundled 101-page PDF as 100 categorized fictional reference documents and deduplicates re-imports', async () => {
    const importRes = await apiJson<{
      ok: boolean;
      totalPages: number;
      importedCount: number;
      skippedCount: number;
      failedCount: number;
      categoryBreakdown: Record<string, number>;
    }>('/api/references/import-default', {
      method: 'POST',
      token: adminToken,
      body: { forceReimport: false },
    });

    expect(importRes.status).toBe(200);
    expect(importRes.data.ok).toBe(true);
    expect(importRes.data.totalPages).toBe(101);
    expect(importRes.data.importedCount).toBe(100);
    expect(importRes.data.failedCount).toBe(0);
    expect(importRes.data.categoryBreakdown['Invoice']).toBe(35);
    expect(importRes.data.categoryBreakdown['Receipt']).toBe(15);
    expect(importRes.data.categoryBreakdown['Purchase Order']).toBe(15);
    expect(importRes.data.categoryBreakdown['Bill']).toBe(15);
    expect(importRes.data.categoryBreakdown['Other Financial Document']).toBe(20);

    // Safe duplicate prevention on re-import
    const reimportRes = await apiJson<{ importedCount: number; skippedCount: number }>(
      '/api/references/import-default',
      {
        method: 'POST',
        token: adminToken,
        body: { forceReimport: false },
      }
    );
    expect(reimportRes.status).toBe(200);
    expect(reimportRes.data.importedCount).toBe(0);
    expect(reimportRes.data.skippedCount).toBe(100);

    const refsList = await apiJson<{ datasetNotice: string; total: number }>(
      '/api/references?category=Invoice',
      { token: user1Token }
    );
    expect(refsList.status).toBe(200);
    expect(refsList.data.datasetNotice).toContain('FICTIONAL TEST DATA');
    expect(refsList.data.total).toBe(35);
  });

  it('detects arithmetic inconsistencies, line diffs, visual ELA tamper patches, and generates sanitized PDF & JSON reports', async () => {
    const cleanSample = await apiJson<{ documentId: number }>('/api/documents/create-test-sample', {
      method: 'POST',
      token: user1Token,
      body: { refCode: 'DG-INV-0001', variant: 'clean' },
    });
    expect(cleanSample.status).toBe(201);
    cleanDocId = cleanSample.data.documentId;

    const cleanDetail = await apiJson<{
      analysis: {
        predicted_category: string;
        risk_category: string;
        risk_score: number;
        risk_summary: string;
        score_factors_json: string;
      };
    }>(`/api/documents/${cleanDocId}`, { token: user1Token });
    expect(cleanDetail.status).toBe(200);
    expect(cleanDetail.data.analysis.predicted_category).toBe('Invoice');
    expect(cleanDetail.data.analysis.risk_summary).toContain('does not guarantee authenticity');
    expect(cleanDetail.data.analysis.score_factors_json).toContain('Human verification is recommended');

    const modSample = await apiJson<{ documentId: number }>('/api/documents/create-test-sample', {
      method: 'POST',
      token: user1Token,
      body: { refCode: 'DG-INV-0001', variant: 'modified_invoice_pdf' },
    });
    expect(modSample.status).toBe(201);
    modifiedDocId = modSample.data.documentId;

    const modDetail = await apiJson<{
      analysis: { risk_score: number; consistency_findings_json: string };
    }>(`/api/documents/${modifiedDocId}`, { token: user1Token });
    expect(modDetail.status).toBe(200);
    const findings = JSON.parse(modDetail.data.analysis.consistency_findings_json) as Array<{
      status: string;
      checkName: string;
    }>;
    expect(findings.some((f) => f.status === 'FAILED')).toBe(true);
    expect(modDetail.data.analysis.risk_score).toBeGreaterThan(cleanDetail.data.analysis.risk_score);

    const compareRes = await apiJson<{ changedLines: unknown[]; tfidfSimilarity: number }>('/api/compare', {
      method: 'POST',
      token: user1Token,
      body: { sourceDocId: modifiedDocId, targetDocId: cleanDocId },
    });
    expect(compareRes.status).toBe(200);
    expect(compareRes.data.changedLines.length).toBeGreaterThan(0);

    // Visual ELA tamper scan test
    const tamperSample = await apiJson<{ documentId: number }>('/api/documents/create-test-sample', {
      method: 'POST',
      token: user1Token,
      body: { refCode: 'DG-INV-0001', variant: 'tampered_scan_jpg' },
    });
    expect(tamperSample.status).toBe(201);
    tamperedJpgDocId = tamperSample.data.documentId;

    const tamperDetail = await apiJson<{
      analysis: { visual_findings_json: string };
    }>(`/api/documents/${tamperedJpgDocId}`, { token: user1Token });
    const visual = JSON.parse(tamperDetail.data.analysis.visual_findings_json) as {
      applicable: boolean;
      suspiciousRegions: unknown[];
    };
    expect(visual.applicable).toBe(true);
    expect(visual.suspiciousRegions.length).toBeGreaterThan(0);

    const heatmapFetch = await fetch(`${baseUrl}/api/documents/${tamperedJpgDocId}/visual/heatmap`, {
      headers: { Authorization: `Bearer ${user1Token}` },
    });
    expect(heatmapFetch.status).toBe(200);
    expect(heatmapFetch.headers.get('content-type')).toContain('image/png');

    // Generate & download JSON + PDF reports and verify RBAC isolation
    const jsonRep = await apiJson<{ reportId: number }>('/api/reports/generate', {
      method: 'POST',
      token: user1Token,
      body: { documentId: modifiedDocId, reportType: 'JSON' },
    });
    expect(jsonRep.status).toBe(201);

    const pdfRep = await apiJson<{ reportId: number }>('/api/reports/generate', {
      method: 'POST',
      token: user1Token,
      body: { documentId: tamperedJpgDocId, reportType: 'PDF' },
    });
    expect(pdfRep.status).toBe(201);

    const user2RepDownload = await fetch(`${baseUrl}/api/reports/${jsonRep.data.reportId}/download`, {
      headers: { Authorization: `Bearer ${user2Token}` },
    });
    expect(user2RepDownload.status).toBe(403);

    const jsonDl = await fetch(`${baseUrl}/api/reports/${jsonRep.data.reportId}/download`, {
      headers: { Authorization: `Bearer ${user1Token}` },
    });
    expect(jsonDl.status).toBe(200);
    const jsonText = await jsonDl.text();
    expect(jsonText).toContain('Human verification is recommended');
    expect(jsonText).not.toContain('password_hash');
    expect(jsonText).not.toContain('test-only-ephemeral-signing-key');

    const pdfDl = await fetch(`${baseUrl}/api/reports/${pdfRep.data.reportId}/download`, {
      headers: { Authorization: `Bearer ${user1Token}` },
    });
    expect(pdfDl.status).toBe(200);
    const pdfBytes = Buffer.from(await pdfDl.arrayBuffer());
    expect(pdfBytes.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });
});
