import { DatabaseSync } from 'node:sqlite';
import { CONFIG, ensureStorageDirectories } from './config.ts';

let dbInstance: DatabaseSync | null = null;

export function getDb(customPath?: string): DatabaseSync {
  if (dbInstance && !customPath) {
    return dbInstance;
  }
  if (!customPath) {
    ensureStorageDirectories();
  }
  const db = new DatabaseSync(customPath || CONFIG.DB_PATH);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');
  initSchema(db);
  if (!customPath) {
    dbInstance = db;
  }
  return db;
}

export function initSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      full_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'SUSPENDED')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_login_at TEXT,
      FOREIGN KEY (role_id) REFERENCES roles(id)
    );

    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      original_filename TEXT NOT NULL,
      stored_filename TEXT NOT NULL UNIQUE,
      storage_path TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_extension TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      sha256_hash TEXT NOT NULL,
      md5_hash TEXT NOT NULL,
      phash TEXT,
      status TEXT NOT NULL DEFAULT 'UPLOADED' CHECK(status IN ('UPLOADED', 'ANALYZING', 'ANALYZED', 'FAILED')),
      uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS reference_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ref_code TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL,
      sub_class TEXT,
      page_number INTEGER NOT NULL,
      source_pdf TEXT NOT NULL,
      storage_path TEXT NOT NULL,
      sha256_hash TEXT NOT NULL UNIQUE,
      phash TEXT,
      extracted_text TEXT NOT NULL,
      supplier_name TEXT,
      customer_name TEXT,
      doc_number TEXT,
      doc_date TEXT,
      total_amount REAL,
      currency TEXT,
      metadata_json TEXT,
      is_fictional_test_data INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS extracted_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id INTEGER NOT NULL UNIQUE,
      extraction_method TEXT NOT NULL,
      raw_text TEXT NOT NULL,
      supplier_name TEXT,
      customer_name TEXT,
      doc_number TEXT,
      doc_date TEXT,
      due_date TEXT,
      reference_number TEXT,
      currency TEXT,
      subtotal REAL,
      tax_amount REAL,
      total_amount REAL,
      line_items_json TEXT,
      addresses_json TEXT,
      payment_terms TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS analysis_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id INTEGER NOT NULL UNIQUE,
      predicted_category TEXT NOT NULL,
      classification_confidence REAL NOT NULL,
      risk_score INTEGER NOT NULL,
      risk_category TEXT NOT NULL CHECK(risk_category IN ('GREEN', 'YELLOW', 'RED')),
      risk_summary TEXT NOT NULL,
      score_factors_json TEXT NOT NULL,
      visual_findings_json TEXT NOT NULL,
      consistency_findings_json TEXT NOT NULL,
      heatmap_path TEXT,
      overlay_path TEXT,
      human_review_status TEXT NOT NULL DEFAULT 'PENDING' CHECK(human_review_status IN ('PENDING', 'APPROVED', 'FLAGGED')),
      human_reviewer_id INTEGER,
      human_review_notes TEXT,
      reviewed_at TEXT,
      analyzed_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
      FOREIGN KEY (human_reviewer_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS detected_anomalies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      analysis_id INTEGER NOT NULL,
      anomaly_type TEXT NOT NULL,
      severity TEXT NOT NULL CHECK(severity IN ('LOW', 'MEDIUM', 'HIGH')),
      title TEXT NOT NULL,
      evidence TEXT NOT NULL,
      score_impact INTEGER NOT NULL DEFAULT 0,
      is_visual INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (analysis_id) REFERENCES analysis_results(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS duplicate_matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id INTEGER NOT NULL,
      matched_document_id INTEGER,
      matched_reference_id INTEGER,
      match_type TEXT NOT NULL CHECK(match_type IN ('EXACT_HASH', 'NEAR_DUPLICATE', 'CONTENT_SIMILAR', 'REFERENCE_MATCH')),
      similarity_score REAL NOT NULL,
      text_similarity REAL NOT NULL,
      tfidf_similarity REAL NOT NULL,
      image_similarity REAL,
      differences_json TEXT,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
      FOREIGN KEY (matched_document_id) REFERENCES documents(id) ON DELETE CASCADE,
      FOREIGN KEY (matched_reference_id) REFERENCES reference_documents(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS document_comparisons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_doc_id INTEGER NOT NULL,
      target_doc_id INTEGER,
      target_ref_id INTEGER,
      user_id INTEGER NOT NULL,
      text_similarity REAL NOT NULL,
      tfidf_similarity REAL NOT NULL,
      image_similarity REAL,
      changed_lines_json TEXT NOT NULL,
      diff_summary TEXT NOT NULL,
      heatmap_path TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (source_doc_id) REFERENCES documents(id) ON DELETE CASCADE,
      FOREIGN KEY (target_doc_id) REFERENCES documents(id) ON DELETE CASCADE,
      FOREIGN KEY (target_ref_id) REFERENCES reference_documents(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS scan_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      risk_category TEXT,
      risk_score INTEGER,
      summary TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      report_type TEXT NOT NULL CHECK(report_type IN ('PDF', 'JSON')),
      storage_path TEXT NOT NULL,
      report_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      details_json TEXT,
      ip_address TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS reference_import_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      imported_by_user_id INTEGER,
      source_filename TEXT NOT NULL,
      total_pages INTEGER NOT NULL,
      imported_count INTEGER NOT NULL,
      skipped_count INTEGER NOT NULL,
      failed_count INTEGER NOT NULL,
      category_breakdown_json TEXT NOT NULL,
      status TEXT NOT NULL,
      notes TEXT,
      imported_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (imported_by_user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_documents_user ON documents(user_id);
    CREATE INDEX IF NOT EXISTS idx_documents_sha256 ON documents(sha256_hash);
    CREATE INDEX IF NOT EXISTS idx_ref_category ON reference_documents(category);
    CREATE INDEX IF NOT EXISTS idx_dup_doc ON duplicate_matches(document_id);
    CREATE INDEX IF NOT EXISTS idx_history_created ON scan_history(created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
  `);

  const seedRole = db.prepare('INSERT OR IGNORE INTO roles (name, description) VALUES (?, ?)');
  seedRole.run('ADMIN', 'Full system access: manage users, reference datasets, settings, and security logs.');
  seedRole.run('ANALYST', 'Forensic analyst access: upload, analyze, compare documents, and view permitted reports.');
  seedRole.run('USER', 'Standard user access: upload and analyze personal documents and view own history.');

  const seedSetting = db.prepare('INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?)');
  seedSetting.run('near_duplicate_tfidf_threshold', '0.78');
  seedSetting.run('near_duplicate_phash_threshold', '0.82');
  seedSetting.run('visual_ela_block_threshold', '3.8');
  seedSetting.run('tax_tolerance_amount', '0.50');
  seedSetting.run('enable_ocr_fallback', 'true');
}

export function logAudit(
  db: DatabaseSync,
  params: {
    userId?: number | null;
    action: string;
    targetType?: string | null;
    targetId?: string | number | null;
    details?: Record<string, unknown>;
    ipAddress?: string | null;
  }
): void {
  const stmt = db.prepare(
    'INSERT INTO audit_logs (user_id, action, target_type, target_id, details_json, ip_address) VALUES (?, ?, ?, ?, ?, ?)'
  );
  stmt.run(
    params.userId ?? null,
    params.action,
    params.targetType ?? null,
    params.targetId != null ? String(params.targetId) : null,
    params.details ? JSON.stringify(params.details) : null,
    params.ipAddress ?? null
  );
}
