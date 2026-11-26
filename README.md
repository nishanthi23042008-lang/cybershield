# DocuGuard AI — Digital Document & Invoice Fraud Detection System

DocuGuard AI is a full-stack document inspection and forensic anomaly analysis platform designed to analyze uploaded invoices, receipts, purchase orders, bills, and financial documents against a baseline corpus and deterministic consistency rules.

> **Important Notice**: Automated risk indicators, metadata checks, and visual Error Level Analysis (ELA) highlights are investigative signals only — **not proof of fraud or proof of authenticity**. Always apply human verification before making financial decisions. The bundled 100-document corpus (`DOCUGUARD_AI_100_Fictional_Reference_Documents_2adce2c4.pdf`) is strictly **FICTIONAL TEST DATA**.

---

## Runtime Architecture & Database Alignment

- **Live Preview Runtime (Port 3000)**:
  - **Backend**: TypeScript + Node.js (`v22.23.5`) + Express (`server.ts`)
  - **Frontend**: React 19 + Vite + Tailwind CSS + Lucide Icons
  - **Live Relational Store**: Node 22 built-in SQLite (`node:sqlite` with WAL mode & foreign keys)
  - **Document & Forensic Processing**: `pdf-lib`, `pdfjs-dist`, `mammoth`, `jszip`, `tesseract.js`, `jpeg-js`, `pngjs`, TF-IDF cosine & Jaccard similarity, 64-bit dHash, JPEG Q90 ELA, and block noise variance analysis.
- **Production MySQL 8+ DDL**:
  - Because the hosted preview container runs Node.js on port 3000 without a Python/Streamlit or MySQL daemon, the full matching 13-table MySQL 8+ schema (`roles`, `users`, `documents`, `reference_documents`, `reference_import_history`, `extracted_data`, `analysis_results`, `detected_anomalies`, `duplicate_matches`, `document_comparisons`, `reports`, `scan_history`, `audit_logs`, `system_settings`) is maintained in `database/mysql_schema.sql`.

---

## Environment Configuration

Copy `.env.example` to `.env` for local configuration:

- `PORT` (default `3000`)
- `STORAGE_DIR` (default `storage`)
- `DB_PATH` (default `storage/docuguard.db`)
- `SESSION_SECRET` (if omitted, generates an ephemeral CSPRNG secret at startup)
- `ADMIN_SETUP_PASSCODE` (optional extra passcode protecting `/api/auth/setup-admin`)

No default administrator password is ever hardcoded. On first boot with zero administrators, the login screen offers a one-time **Claim Initial Administrator** setup form.

---

## Running & Testing

```bash
# Install dependencies
npm install

# Run development server on port 3000
npm run dev

# Build production frontend bundle
npm run build

# Run TypeScript check
npm run lint

# Run automated Vitest QA & security verification suite
npm test
```

---

## Implemented Pipeline & Security Controls

1. **Authentication & RBAC (`server/auth.ts`)**: `bcryptjs` password hashing, HMAC-SHA256 Bearer session tokens stored exclusively in React memory (never `localStorage`), server-side token revocation on logout, and strict backend RBAC (`ADMIN`, `ANALYST`, `USER`).
2. **100-Document Reference PDF Ingestion (`server/modules/referenceManager.ts`)**: Parses the bundled 101-page PDF, skips Page 1 (cover page), splits Pages 2–101 into 100 individual 1-page PDFs stored outside the database under `storage/references/`, classifies and hashes each page (`35 Invoice`, `15 Receipt`, `15 Purchase Order`, `15 Bill`, `20 Other Financial Document`), and deduplicates re-imports.
3. **Upload Hardening (`server.ts`, `server/config.ts`)**: Extension allowlist (`.pdf`, `.jpg`, `.jpeg`, `.png`, `.docx`), MIME allowlist, magic-byte signature verification, structural parsing (`pdf-lib`, `pngjs`, `jpeg-js`, `jszip`), 20 MB ceiling, sanitized randomized filenames, and `path.sep` confinement blocking path traversal.
4. **8-Step Forensic Pipeline (`server/services/analysisPipeline.ts`)**: Hashing -> Metadata extraction -> Text/OCR extraction -> Weighted category classification -> Visual ELA & dHash -> Reference & prior-upload similarity -> Mathematical & chronological consistency checks -> Explainable 0–100 `GREEN` / `YELLOW` / `RED` scoring.
5. **Reporting (`server/modules/reportGenerator.ts`)**: Generates branded downloadable PDF reports (with embedded ELA heatmap PNGs when available) and sanitized JSON reports excluding internal credentials/secrets.
