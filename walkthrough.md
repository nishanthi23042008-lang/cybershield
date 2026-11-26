# DocuGuard AI — Engineering & Security Walkthrough

# Security Summary

DocuGuard AI was built with defense-in-depth safeguards across authentication, file ingestion, storage isolation, database queries, and reporting:

- **Authentication, Password Security & Session Lifecycle**:
  - Passwords are hashed using `bcryptjs` (`12` salt rounds) with minimum complexity validation (length >= 10, uppercase, lowercase, digit).
  - First administrator provisioning requires claiming an unclaimed system via `/api/auth/setup-admin` (optionally gated by `ADMIN_SETUP_PASSCODE`); zero default credentials are hardcoded.
  - Public registration strictly assigns the least-privilege `USER` role.
  - Sessions use HMAC-SHA256 signed Bearer tokens verified with `crypto.timingSafeEqual`, held strictly in client React memory (never persisted to `localStorage`/`sessionStorage`), and explicitly revoked server-side on logout.
- **Role-Based Access Control (RBAC) & Ownership Isolation**:
  - All sensitive API routes enforce server-side authentication (`requireAuth`), role checks (`requireRole('ADMIN')`), and per-document ownership checks (`canAccessDocument`), preventing cross-user read, analysis, comparison, visual artifact access, and report downloads (`403 Forbidden`).
- **Upload Validation & Path Traversal Confinement**:
  - Uploads are bounded to 20 MB and validated across four layers: extension allowlist, MIME type allowlist, magic-byte file signature check (`validateMagicSignature`), and real structural parser validation (`PDFDocument.load`, `PNG.sync.read`, `jpeg.decode`, `JSZip` `word/document.xml` verification).
  - Filenames are sanitized via `sanitizeFilename`, prefixed with timestamps and CSPRNG hex bytes, stored outside the database, and accessed solely through `resolveConfinedPath()` enforcing `path.resolve` + `path.sep` prefix containment.
- **Injection & Secret Hygiene**:
  - All SQLite queries use parameterized bindings (`db.prepare(...).get/all/run(...)`).
  - Generated JSON/PDF reports explicitly strip internal file paths, password hashes, and signing secrets.

## PoC Verification

All functional and security controls are verified via the automated Vitest integration suite in `tests/docuguard.test.ts` running against the live Express application with an isolated temporary database and confined storage directory:

- Initial admin bootstrap claim & second-claim lockout (`403`).
- Least-privilege `USER` registration, duplicate rejection (`409`), SQL-injection login rejection (`401`), unauthenticated blocking (`401`), non-admin endpoint blocking (`403`), and password rotation.
- Upload validation blocking empty files, disallowed `.html` files, spoofed magic-byte PDFs, malformed PDFs, >20 MB buffers, and `resolveConfinedPath` traversal (`../../etc/passwd`).
- Cross-user document & report isolation (`403`) vs authorized owner/admin access (`200`).
- Ingestion of the bundled 101-page fictional reference PDF into `100` individual records (`35` Invoices, `15` Receipts, `15` Purchase Orders, `15` Bills, `20` Other Financial Documents) and idempotent duplicate skip on re-import.
- Clean vs modified invoice consistency mismatch & line-diff detection, synthetic tampered JPEG ELA suspicious-region detection & PNG heatmap/overlay delivery, and PDF/JSON report generation.
