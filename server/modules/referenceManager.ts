import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { CONFIG } from '../config.ts';
import { getDb, logAudit } from '../db.ts';
import { classifyDocumentText } from './classification.ts';
import { extractPdfPagesText, parseFinancialFields } from './extraction.ts';
import { computeTextDHashFallback } from './visualAnalysis.ts';

export interface ImportProgress {
  inProgress: boolean;
  totalPages: number;
  processedPages: number;
  importedCount: number;
  skippedCount: number;
  failedCount: number;
  currentLabel: string;
}

let currentProgress: ImportProgress = {
  inProgress: false,
  totalPages: 0,
  processedPages: 0,
  importedCount: 0,
  skippedCount: 0,
  failedCount: 0,
  currentLabel: '',
};

export function getReferenceImportProgress(): ImportProgress {
  return { ...currentProgress };
}

function extractRefCode(text: string, pageNum: number): string {
  const m = text.match(/\b(DG-(?:INV|REC|PUR|BIL|OTH)-\d{4})\b/i);
  if (m) return m[1].toUpperCase();
  return `DG-REF-${String(pageNum - 1).padStart(4, '0')}`;
}

export async function ingestReferencePdf(params: {
  pdfPath?: string;
  pdfBuffer?: Buffer;
  sourceFilename: string;
  userId: number | null;
  forceReimport?: boolean;
}): Promise<{
  totalPages: number;
  importedCount: number;
  skippedCount: number;
  failedCount: number;
  categoryBreakdown: Record<string, number>;
  errors: string[];
}> {
  if (currentProgress.inProgress) {
    throw new Error('Reference dataset import is already running.');
  }

  const db = getDb();
  const buffer = params.pdfBuffer || fs.readFileSync(params.pdfPath || CONFIG.DEFAULT_REFERENCE_PDF);

  if (buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new Error('Invalid PDF signature: file does not start with %PDF-.');
  }

  const srcPdf = await PDFDocument.load(buffer);
  const totalPages = srcPdf.getPageCount();
  if (totalPages < 2) {
    throw new Error('Reference PDF must include a cover page followed by at least one document page.');
  }

  const pageTexts = await extractPdfPagesText(buffer);
  const documentPageCount = totalPages - 1;

  currentProgress = {
    inProgress: true,
    totalPages: documentPageCount,
    processedPages: 0,
    importedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    currentLabel: 'Validating cover page...',
  };

  let importedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  const errors: string[] = [];
  const categoryBreakdown: Record<string, number> = {
    Invoice: 0,
    Receipt: 0,
    'Purchase Order': 0,
    Bill: 0,
    'Other Financial Document': 0,
  };

  try {
    if (params.forceReimport) {
      db.prepare('DELETE FROM reference_documents').run();
    }

    const existingHashes = new Set<string>(
      (db.prepare('SELECT sha256_hash FROM reference_documents').all() as Array<{ sha256_hash: string }>).map(
        (r) => r.sha256_hash
      )
    );
    const existingCodes = new Set<string>(
      (db.prepare('SELECT ref_code FROM reference_documents').all() as Array<{ ref_code: string }>).map(
        (r) => r.ref_code
      )
    );

    const insertStmt = db.prepare(`
      INSERT INTO reference_documents (
        ref_code, category, sub_class, page_number, source_pdf, storage_path,
        sha256_hash, phash, extracted_text, supplier_name, customer_name,
        doc_number, doc_date, total_amount, currency, metadata_json, is_fictional_test_data
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `);

    for (let pageIdx = 1; pageIdx < totalPages; pageIdx++) {
      const pageNumber = pageIdx + 1;
      const text = pageTexts[pageIdx] || '';
      const refCode = extractRefCode(text, pageNumber);

      currentProgress.currentLabel = `Processing page ${pageNumber} (${refCode})`;

      try {
        const singlePdf = await PDFDocument.create();
        const [copiedPage] = await singlePdf.copyPages(srcPdf, [pageIdx]);
        singlePdf.addPage(copiedPage);
        singlePdf.setTitle(`DocuGuard Fictional Reference ${refCode}`);
        singlePdf.setSubject('FICTIONAL TEST DATA — NOT VALID FOR PAYMENT');
        const singleBytes = Buffer.from(await singlePdf.save());

        const sha256 = crypto.createHash('sha256').update(singleBytes).digest('hex');

        if (existingHashes.has(sha256) || existingCodes.has(refCode)) {
          skippedCount++;
          const existingCat = db
            .prepare('SELECT category FROM reference_documents WHERE ref_code = ? OR sha256_hash = ?')
            .get(refCode, sha256) as { category: string } | undefined;
          if (existingCat) {
            categoryBreakdown[existingCat.category] = (categoryBreakdown[existingCat.category] || 0) + 1;
          }
          currentProgress.skippedCount = skippedCount;
          currentProgress.processedPages = pageIdx;
          continue;
        }

        const relFilename = `${refCode}.pdf`;
        const absOut = path.join(CONFIG.REFERENCES_DIR, relFilename);
        fs.writeFileSync(absOut, singleBytes);

        const cls = classifyDocumentText(text);
        const fields = parseFinancialFields(text);
        const phash = computeTextDHashFallback(text);

        insertStmt.run(
          refCode,
          cls.category,
          cls.subClass,
          pageNumber,
          params.sourceFilename,
          path.join('references', relFilename),
          sha256,
          phash,
          text,
          fields.supplierName,
          fields.customerName,
          fields.docNumber || refCode,
          fields.docDate,
          fields.totalAmount,
          fields.currency || 'INR',
          JSON.stringify({
            pageNumber,
            classificationConfidence: cls.confidence,
            lineItemsCount: fields.lineItems.length,
            subtotal: fields.subtotal,
            taxAmount: fields.taxAmount,
            fictionalDisclaimer: 'FICTIONAL TEST DATA — NOT VALID FOR PAYMENT',
          })
        );

        existingHashes.add(sha256);
        existingCodes.add(refCode);
        importedCount++;
        categoryBreakdown[cls.category] = (categoryBreakdown[cls.category] || 0) + 1;
        currentProgress.importedCount = importedCount;
      } catch (err) {
        failedCount++;
        currentProgress.failedCount = failedCount;
        errors.push(`Page ${pageNumber} (${refCode}): ${err instanceof Error ? err.message : 'Failed'}`);
      }

      currentProgress.processedPages = pageIdx;
    }

    db.prepare(
      `INSERT INTO reference_import_history (
        imported_by_user_id, source_filename, total_pages, imported_count,
        skipped_count, failed_count, category_breakdown_json, status, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      params.userId,
      params.sourceFilename,
      totalPages,
      importedCount,
      skippedCount,
      failedCount,
      JSON.stringify(categoryBreakdown),
      failedCount === 0 ? 'COMPLETED' : 'COMPLETED_WITH_WARNINGS',
      `Skipped cover page 1; processed ${documentPageCount} individual document pages.`
    );

    logAudit(db, {
      userId: params.userId,
      action: 'REFERENCE_DATASET_IMPORTED',
      targetType: 'reference_documents',
      targetId: params.sourceFilename,
      details: { totalPages, importedCount, skippedCount, failedCount, categoryBreakdown },
    });

    return {
      totalPages,
      importedCount,
      skippedCount,
      failedCount,
      categoryBreakdown,
      errors,
    };
  } finally {
    currentProgress.inProgress = false;
    currentProgress.currentLabel = '';
  }
}
