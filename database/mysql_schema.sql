-- DOCUGUARD AI — MySQL 8.0+ Relational Database Schema
-- Compatible with SQLAlchemy / MySQL deployments.
-- Note: Uploaded documents, split reference PDFs, heatmaps, and reports are stored
-- externally on disk and referenced by relative storage paths and SHA-256 hashes.

CREATE DATABASE IF NOT EXISTS docuguard_ai CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE docuguard_ai;

CREATE TABLE IF NOT EXISTS roles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(32) NOT NULL UNIQUE,
  description VARCHAR(255) NOT NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(64) NOT NULL UNIQUE,
  email VARCHAR(160) NOT NULL UNIQUE,
  full_name VARCHAR(120) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role_id INT NOT NULL,
  status ENUM('ACTIVE', 'SUSPENDED') NOT NULL DEFAULT 'ACTIVE',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at DATETIME NULL,
  CONSTRAINT fk_users_role FOREIGN KEY (role_id) REFERENCES roles(id),
  INDEX idx_users_role (role_id),
  INDEX idx_users_status (status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS documents (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  original_filename VARCHAR(255) NOT NULL,
  stored_filename VARCHAR(255) NOT NULL UNIQUE,
  storage_path VARCHAR(512) NOT NULL,
  mime_type VARCHAR(128) NOT NULL,
  file_extension VARCHAR(16) NOT NULL,
  file_size BIGINT NOT NULL,
  sha256_hash CHAR(64) NOT NULL,
  md5_hash CHAR(32) NOT NULL,
  phash CHAR(16) NULL,
  status ENUM('UPLOADED', 'ANALYZING', 'ANALYZED', 'FAILED') NOT NULL DEFAULT 'UPLOADED',
  uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_documents_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_documents_user (user_id),
  INDEX idx_documents_sha256 (sha256_hash),
  INDEX idx_documents_uploaded_at (uploaded_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS reference_documents (
  id INT AUTO_INCREMENT PRIMARY KEY,
  ref_code VARCHAR(64) NOT NULL UNIQUE,
  category VARCHAR(64) NOT NULL,
  sub_class VARCHAR(64) NULL,
  page_number INT NOT NULL,
  source_pdf VARCHAR(255) NOT NULL,
  storage_path VARCHAR(512) NOT NULL,
  sha256_hash CHAR(64) NOT NULL UNIQUE,
  phash CHAR(16) NULL,
  extracted_text LONGTEXT NOT NULL,
  supplier_name VARCHAR(160) NULL,
  customer_name VARCHAR(160) NULL,
  doc_number VARCHAR(64) NULL,
  doc_date VARCHAR(64) NULL,
  total_amount DECIMAL(14, 2) NULL,
  currency VARCHAR(16) NULL,
  metadata_json JSON NULL,
  is_fictional_test_data TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ref_category (category),
  INDEX idx_ref_doc_number (doc_number)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS extracted_data (
  id INT AUTO_INCREMENT PRIMARY KEY,
  document_id INT NOT NULL UNIQUE,
  extraction_method VARCHAR(64) NOT NULL,
  raw_text LONGTEXT NOT NULL,
  supplier_name VARCHAR(160) NULL,
  customer_name VARCHAR(160) NULL,
  doc_number VARCHAR(64) NULL,
  doc_date VARCHAR(64) NULL,
  due_date VARCHAR(64) NULL,
  reference_number VARCHAR(64) NULL,
  currency VARCHAR(16) NULL,
  subtotal DECIMAL(14, 2) NULL,
  tax_amount DECIMAL(14, 2) NULL,
  total_amount DECIMAL(14, 2) NULL,
  line_items_json JSON NULL,
  addresses_json JSON NULL,
  payment_terms VARCHAR(128) NULL,
  metadata_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_extracted_document FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS analysis_results (
  id INT AUTO_INCREMENT PRIMARY KEY,
  document_id INT NOT NULL UNIQUE,
  predicted_category VARCHAR(64) NOT NULL,
  classification_confidence DECIMAL(5, 4) NOT NULL,
  risk_score INT NOT NULL,
  risk_category ENUM('GREEN', 'YELLOW', 'RED') NOT NULL,
  risk_summary TEXT NOT NULL,
  score_factors_json JSON NOT NULL,
  visual_findings_json JSON NOT NULL,
  consistency_findings_json JSON NOT NULL,
  heatmap_path VARCHAR(512) NULL,
  overlay_path VARCHAR(512) NULL,
  human_review_status ENUM('PENDING', 'APPROVED', 'FLAGGED') NOT NULL DEFAULT 'PENDING',
  human_reviewer_id INT NULL,
  human_review_notes TEXT NULL,
  reviewed_at DATETIME NULL,
  analyzed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_analysis_document FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  CONSTRAINT fk_analysis_reviewer FOREIGN KEY (human_reviewer_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_analysis_risk (risk_category, risk_score)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS detected_anomalies (
  id INT AUTO_INCREMENT PRIMARY KEY,
  analysis_id INT NOT NULL,
  anomaly_type VARCHAR(64) NOT NULL,
  severity ENUM('LOW', 'MEDIUM', 'HIGH') NOT NULL,
  title VARCHAR(255) NOT NULL,
  evidence TEXT NOT NULL,
  score_impact INT NOT NULL DEFAULT 0,
  is_visual TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_anomalies_analysis FOREIGN KEY (analysis_id) REFERENCES analysis_results(id) ON DELETE CASCADE,
  INDEX idx_anomalies_analysis (analysis_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS duplicate_matches (
  id INT AUTO_INCREMENT PRIMARY KEY,
  document_id INT NOT NULL,
  matched_document_id INT NULL,
  matched_reference_id INT NULL,
  match_type ENUM('EXACT_HASH', 'NEAR_DUPLICATE', 'CONTENT_SIMILAR', 'REFERENCE_MATCH') NOT NULL,
  similarity_score DECIMAL(5, 4) NOT NULL,
  text_similarity DECIMAL(5, 4) NOT NULL,
  tfidf_similarity DECIMAL(5, 4) NOT NULL,
  image_similarity DECIMAL(5, 4) NULL,
  differences_json JSON NULL,
  reason TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_dup_source FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  CONSTRAINT fk_dup_target_doc FOREIGN KEY (matched_document_id) REFERENCES documents(id) ON DELETE CASCADE,
  CONSTRAINT fk_dup_target_ref FOREIGN KEY (matched_reference_id) REFERENCES reference_documents(id) ON DELETE CASCADE,
  INDEX idx_dup_document (document_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS document_comparisons (
  id INT AUTO_INCREMENT PRIMARY KEY,
  source_doc_id INT NOT NULL,
  target_doc_id INT NULL,
  target_ref_id INT NULL,
  user_id INT NOT NULL,
  text_similarity DECIMAL(5, 4) NOT NULL,
  tfidf_similarity DECIMAL(5, 4) NOT NULL,
  image_similarity DECIMAL(5, 4) NULL,
  changed_lines_json JSON NOT NULL,
  diff_summary TEXT NOT NULL,
  heatmap_path VARCHAR(512) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_cmp_source FOREIGN KEY (source_doc_id) REFERENCES documents(id) ON DELETE CASCADE,
  CONSTRAINT fk_cmp_target_doc FOREIGN KEY (target_doc_id) REFERENCES documents(id) ON DELETE CASCADE,
  CONSTRAINT fk_cmp_target_ref FOREIGN KEY (target_ref_id) REFERENCES reference_documents(id) ON DELETE CASCADE,
  CONSTRAINT fk_cmp_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS scan_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  document_id INT NOT NULL,
  user_id INT NOT NULL,
  action VARCHAR(64) NOT NULL,
  risk_category ENUM('GREEN', 'YELLOW', 'RED') NULL,
  risk_score INT NULL,
  summary TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_history_doc FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  CONSTRAINT fk_history_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_history_created (created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS reports (
  id INT AUTO_INCREMENT PRIMARY KEY,
  document_id INT NOT NULL,
  user_id INT NOT NULL,
  report_type ENUM('PDF', 'JSON') NOT NULL,
  storage_path VARCHAR(512) NOT NULL,
  report_hash CHAR(64) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_reports_doc FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  CONSTRAINT fk_reports_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS audit_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NULL,
  action VARCHAR(96) NOT NULL,
  target_type VARCHAR(64) NULL,
  target_id VARCHAR(64) NULL,
  details_json JSON NULL,
  ip_address VARCHAR(64) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_audit_created (created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS reference_import_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  imported_by_user_id INT NULL,
  source_filename VARCHAR(255) NOT NULL,
  total_pages INT NOT NULL,
  imported_count INT NOT NULL,
  skipped_count INT NOT NULL,
  failed_count INT NOT NULL,
  category_breakdown_json JSON NOT NULL,
  status VARCHAR(32) NOT NULL,
  notes TEXT NULL,
  imported_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ref_import_user FOREIGN KEY (imported_by_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

INSERT IGNORE INTO roles (name, description) VALUES
  ('ADMIN', 'Full administrative access: manage users, reference datasets, system settings, and security audit logs.'),
  ('ANALYST', 'Document forensics access: upload, analyze, compare documents, and download permitted reports.'),
  ('USER', 'Standard workspace access: upload and analyze personal documents and view own scan history.');

-- Backup Guidance:
-- mysqldump --single-transaction --routines --triggers docuguard_ai > docuguard_backup.sql
-- Also back up the external storage/ directory (uploads/, references/, heatmaps/, reports/).
