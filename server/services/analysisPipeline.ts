import fs from 'node:fs';
import path from 'node:path';
import { CONFIG, resolveConfinedPath } from '../config.ts';
import { getDb, logAudit } from '../db.ts';
import { classifyDocumentText } from '../modules/classification.ts';
import { runConsistencyChecks } from '../modules/consistency.ts';
import { extractDocumentText } from '../modules/extraction.ts';
import { computeBufferHashes } from '../modules/hashing.ts';
import { extractDocumentMetadata } from '../modules/metadata.ts';
import { computeRiskAssessment, type DuplicateMatchInput } from '../modules/riskScoring.ts';
import { computeJaccardTokenSimilarity, computeLineDiff, computeTfIdfSimilarityMatrix } from '../modules/similarity.ts';
import {
  computeDHashFromImage,
  computeTextDHashFallback,
  hammingSimilarity,
  runVisualInspection,
} from '../modules/visualAnalysis.ts';

function getSettingNumber(key: string, fallback: number): number {
  const db = getDb();
  const row = db.prepare('SELECT value FROM system_settings WHERE key = ?').get(key) as { value: string } | undefined;
  if (!row) return fallback;
  const n = Number.parseFloat(row.value);
  return Number.isFinite(n) ? n : fallback;
}

function getSettingBool(key: string, fallback: boolean): boolean {
  const db = getDb();
  const row = db.prepare('SELECT value FROM system_settings WHERE key = ?').get(key) as { value: string } | undefined;
  if (!row) return fallback;
  return row.value.toLowerCase() === 'true';
}

export async function runDocumentAnalysisPipeline(documentId: number, actingUserId: number): Promise<number> {
  const db = getDb();
  const doc = db
    .prepare('SELECT * FROM documents WHERE id = ?')
    .get(documentId) as
    | {
        id: number;
        user_id: number;
        original_filename: string;
        storage_path: string;
        mime_type: string;
        file_extension: string;
        file_size: number;
        sha256_hash: string;
        md5_hash: string;
      }
    | undefined;

  if (!doc) {
    throw new Error('Document record not found.');
  }

  db.prepare("UPDATE documents SET status = 'ANALYZING' WHERE id = ?").run(documentId);

  try {
    const absFilePath = resolveConfinedPath(CONFIG.STORAGE_DIR, doc.storage_path);
    const buffer = fs.readFileSync(absFilePath);

    // Step 1: Metadata examination
    const metadata = await extractDocumentMetadata(buffer, doc.original_filename, doc.mime_type);

    // Step 2: File hashing
    const hashes = computeBufferHashes(buffer);

    // Step 3: Visual analysis
    const elaThreshold = getSettingNumber('visual_ela_block_threshold', 18.0);
    const visual = await runVisualInspection(buffer, doc.original_filename, elaThreshold);

    // Step 4: OCR & Text extraction
    const enableOcr = getSettingBool('enable_ocr_fallback', true);
    const extraction = await extractDocumentText(buffer, doc.original_filename, enableOcr);

    const phash =
      visual.dhash ||
      computeDHashFromImage(buffer, doc.file_extension) ||
      computeTextDHashFallback(extraction.rawText);

    db.prepare('UPDATE documents SET phash = ? WHERE id = ?').run(phash, documentId);

    db.prepare(
      `INSERT INTO extracted_data (
        document_id, extraction_method, raw_text, supplier_name, customer_name,
        doc_number, doc_date, due_date, reference_number, currency,
        subtotal, tax_amount, total_amount, line_items_json, addresses_json,
        payment_terms, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(document_id) DO UPDATE SET
        extraction_method = excluded.extraction_method,
        raw_text = excluded.raw_text,
        supplier_name = excluded.supplier_name,
        customer_name = excluded.customer_name,
        doc_number = excluded.doc_number,
        doc_date = excluded.doc_date,
        due_date = excluded.due_date,
        reference_number = excluded.reference_number,
        currency = excluded.currency,
        subtotal = excluded.subtotal,
        tax_amount = excluded.tax_amount,
        total_amount = excluded.total_amount,
        line_items_json = excluded.line_items_json,
        addresses_json = excluded.addresses_json,
        payment_terms = excluded.payment_terms,
        metadata_json = excluded.metadata_json`
    ).run(
      documentId,
      extraction.method,
      extraction.rawText,
      extraction.fields.supplierName,
      extraction.fields.customerName,
      extraction.fields.docNumber,
      extraction.fields.docDate,
      extraction.fields.dueDate,
      extraction.fields.referenceNumber,
      extraction.fields.currency,
      extraction.fields.subtotal,
      extraction.fields.taxAmount,
      extraction.fields.totalAmount,
      JSON.stringify(extraction.fields.lineItems),
      JSON.stringify(extraction.fields.addresses),
      extraction.fields.paymentTerms,
      JSON.stringify(metadata)
    );

    // Step 5: Document classification
    const classification = classifyDocumentText(extraction.rawText);

    // Step 6: Reference document comparison
    const tfidfThreshold = getSettingNumber('near_duplicate_tfidf_threshold', 0.78);
    const phashThreshold = getSettingNumber('near_duplicate_phash_threshold', 0.82);

    const refRows = db
      .prepare(
        `SELECT id, ref_code, category, sha256_hash, phash, extracted_text,
                supplier_name, customer_name, doc_number, doc_date, total_amount
         FROM reference_documents`
      )
      .all() as Array<{
      id: number;
      ref_code: string;
      category: string;
      sha256_hash: string;
      phash: string | null;
      extracted_text: string;
      supplier_name: string | null;
      customer_name: string | null;
      doc_number: string | null;
      doc_date: string | null;
      total_amount: number | null;
    }>;

    const refTfidfScores = computeTfIdfSimilarityMatrix(
      extraction.rawText,
      refRows.map((r) => r.extracted_text)
    );

    db.prepare('DELETE FROM duplicate_matches WHERE document_id = ?').run(documentId);
    const insertDup = db.prepare(
      `INSERT INTO duplicate_matches (
        document_id, matched_document_id, matched_reference_id, match_type,
        similarity_score, text_similarity, tfidf_similarity, image_similarity,
        differences_json, reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const duplicateRiskInputs: DuplicateMatchInput[] = [];

    const rankedRefs = refRows
      .map((ref, idx) => {
        const tfidf = refTfidfScores[idx] || 0;
        const jaccard = computeJaccardTokenSimilarity(extraction.rawText, ref.extracted_text);
        const imgSim = hammingSimilarity(phash, ref.phash);
        const isShaMatch = ref.sha256_hash === hashes.sha256;
        const combined = isShaMatch ? 1 : Number((0.65 * tfidf + 0.35 * jaccard).toFixed(4));
        return { ref, tfidf, jaccard, imgSim, isShaMatch, combined };
      })
      .sort((a, b) => b.combined - a.combined);

    for (const item of rankedRefs.slice(0, 5)) {
      if (item.combined >= 0.35 || item.isShaMatch) {
        const diffs = computeLineDiff(item.ref.extracted_text, extraction.rawText)
          .slice(0, 8)
          .map((d) => `${d.changeType} (${d.fieldHint || 'Line'}): "${d.originalText}" -> "${d.modifiedText}"`);

        const reason = item.isShaMatch
          ? `Exact SHA-256 match with fictional reference ${item.ref.ref_code} (${item.ref.category}).`
          : `Template/content similarity ${(item.combined * 100).toFixed(1)}% with fictional reference ${item.ref.ref_code} (${item.ref.category}). Note: matching a template does not prove authenticity.`;

        insertDup.run(
          documentId,
          null,
          item.ref.id,
          'REFERENCE_MATCH',
          item.combined,
          item.jaccard,
          item.tfidf,
          item.imgSim,
          JSON.stringify(diffs),
          reason
        );
      }
    }

    // Step 7: Previous upload comparison (respecting user permissions)
    const actingUser = db
      .prepare(`SELECT u.id, r.name AS role FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = ?`)
      .get(actingUserId) as { id: number; role: string } | undefined;

    const priorQuery =
      actingUser && (actingUser.role === 'ADMIN' || actingUser.role === 'ANALYST')
        ? db.prepare(
            `SELECT d.id, d.original_filename, d.sha256_hash, d.phash, d.user_id,
                    e.raw_text, e.supplier_name, e.doc_number, e.doc_date, e.total_amount
             FROM documents d
             LEFT JOIN extracted_data e ON e.document_id = d.id
             WHERE d.id != ?`
          )
        : db.prepare(
            `SELECT d.id, d.original_filename, d.sha256_hash, d.phash, d.user_id,
                    e.raw_text, e.supplier_name, e.doc_number, e.doc_date, e.total_amount
             FROM documents d
             LEFT JOIN extracted_data e ON e.document_id = d.id
             WHERE d.id != ? AND d.user_id = ?`
          );

    const priorDocs = (
      actingUser && (actingUser.role === 'ADMIN' || actingUser.role === 'ANALYST')
        ? priorQuery.all(documentId)
        : priorQuery.all(documentId, actingUserId)
    ) as Array<{
      id: number;
      original_filename: string;
      sha256_hash: string;
      phash: string | null;
      user_id: number;
      raw_text: string | null;
      supplier_name: string | null;
      doc_number: string | null;
      doc_date: string | null;
      total_amount: number | null;
    }>;

    const priorTfidf = computeTfIdfSimilarityMatrix(
      extraction.rawText,
      priorDocs.map((p) => p.raw_text || '')
    );

    for (let i = 0; i < priorDocs.length; i++) {
      const prior = priorDocs[i];
      const tfidf = priorTfidf[i] || 0;
      const jaccard = computeJaccardTokenSimilarity(extraction.rawText, prior.raw_text || '');
      const imgSim = hammingSimilarity(phash, prior.phash);
      const isExact = prior.sha256_hash === hashes.sha256;

      const isNearDup =
        !isExact &&
        (tfidf >= tfidfThreshold || (imgSim !== null && imgSim >= phashThreshold && jaccard >= 0.45));

      const isSimilarContent = !isExact && !isNearDup && tfidf >= 0.5;

      if (isExact || isNearDup || isSimilarContent) {
        const diffs: string[] = [];
        if (
          prior.total_amount !== null &&
          extraction.fields.totalAmount !== null &&
          Math.abs(prior.total_amount - extraction.fields.totalAmount) > 0.01
        ) {
          diffs.push(`Total changed: ${prior.total_amount.toFixed(2)} -> ${extraction.fields.totalAmount.toFixed(2)}`);
        }
        if (prior.doc_date && extraction.fields.docDate && prior.doc_date !== extraction.fields.docDate) {
          diffs.push(`Date changed: ${prior.doc_date} -> ${extraction.fields.docDate}`);
        }
        if (prior.doc_number && extraction.fields.docNumber && prior.doc_number !== extraction.fields.docNumber) {
          diffs.push(`Document ID changed: ${prior.doc_number} -> ${extraction.fields.docNumber}`);
        }
        if (
          prior.supplier_name &&
          extraction.fields.supplierName &&
          prior.supplier_name !== extraction.fields.supplierName
        ) {
          diffs.push(`Supplier changed: ${prior.supplier_name} -> ${extraction.fields.supplierName}`);
        }

        const matchType = isExact ? 'EXACT_HASH' : isNearDup ? 'NEAR_DUPLICATE' : 'CONTENT_SIMILAR';
        const score = isExact ? 1 : Number((0.65 * tfidf + 0.35 * jaccard).toFixed(4));
        const reason = isExact
          ? `Exact SHA-256 duplicate of "${prior.original_filename}" (#${prior.id}).`
          : `TF-IDF ${(tfidf * 100).toFixed(1)}% / Image sim ${
              imgSim !== null ? (imgSim * 100).toFixed(1) + '%' : 'N/A'
            } vs "${prior.original_filename}" (#${prior.id}).`;

        insertDup.run(
          documentId,
          prior.id,
          null,
          matchType,
          score,
          jaccard,
          tfidf,
          imgSim,
          JSON.stringify(diffs),
          reason
        );

        if (isExact || isNearDup) {
          duplicateRiskInputs.push({
            matchType,
            similarityScore: score,
            label: `${prior.original_filename} (#${prior.id})`,
            differences: diffs,
            reason,
          });
        }
      }
    }

    // Step 8: Cross-document & arithmetic consistency
    const taxTolerance = getSettingNumber('tax_tolerance_amount', 0.5);
    const matchedRefForCrossCheck = rankedRefs.filter((r) => r.combined >= 0.35).map((r) => r.ref);
    const consistency = runConsistencyChecks(extraction.fields, taxTolerance, matchedRefForCrossCheck);

    // Risk scoring
    const risk = computeRiskAssessment({
      metadata,
      visual,
      consistency,
      duplicateMatches: duplicateRiskInputs,
      hasExtractedText: extraction.rawText.length >= 20,
    });

    const heatmapRelPath = visual.heatmapFilename ? path.join('heatmaps', visual.heatmapFilename) : null;
    const overlayRelPath = visual.overlayFilename ? path.join('heatmaps', visual.overlayFilename) : null;

    db.prepare(
      `INSERT INTO analysis_results (
        document_id, predicted_category, classification_confidence, risk_score,
        risk_category, risk_summary, score_factors_json, visual_findings_json,
        consistency_findings_json, heatmap_path, overlay_path, human_review_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')
      ON CONFLICT(document_id) DO UPDATE SET
        predicted_category = excluded.predicted_category,
        classification_confidence = excluded.classification_confidence,
        risk_score = excluded.risk_score,
        risk_category = excluded.risk_category,
        risk_summary = excluded.risk_summary,
        score_factors_json = excluded.score_factors_json,
        visual_findings_json = excluded.visual_findings_json,
        consistency_findings_json = excluded.consistency_findings_json,
        heatmap_path = excluded.heatmap_path,
        overlay_path = excluded.overlay_path,
        analyzed_at = datetime('now')`
    ).run(
      documentId,
      classification.category,
      classification.confidence,
      risk.riskScore,
      risk.riskCategory,
      risk.riskSummary,
      JSON.stringify({
        factors: risk.factors,
        missingEvidenceNotes: risk.missingEvidenceNotes,
        recommendation: risk.recommendation,
        classificationSignals: classification.matchedSignals,
      }),
      JSON.stringify(visual),
      JSON.stringify(consistency),
      heatmapRelPath,
      overlayRelPath
    );

    const analysisRow = db
      .prepare('SELECT id FROM analysis_results WHERE document_id = ?')
      .get(documentId) as { id: number };

    db.prepare('DELETE FROM detected_anomalies WHERE analysis_id = ?').run(analysisRow.id);
    const insertAnomaly = db.prepare(
      `INSERT INTO detected_anomalies (
        analysis_id, anomaly_type, severity, title, evidence, score_impact, is_visual
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const f of risk.factors) {
      insertAnomaly.run(
        analysisRow.id,
        f.anomalyType,
        f.severity,
        f.title,
        f.evidence,
        f.scoreImpact,
        f.isVisual ? 1 : 0
      );
    }

    db.prepare("UPDATE documents SET status = 'ANALYZED' WHERE id = ?").run(documentId);

    db.prepare(
      `INSERT INTO scan_history (document_id, user_id, action, risk_category, risk_score, summary)
       VALUES (?, ?, 'DOCUMENT_ANALYZED', ?, ?, ?)`
    ).run(
      documentId,
      actingUserId,
      risk.riskCategory,
      risk.riskScore,
      `${classification.category} (${(classification.confidence * 100).toFixed(0)}% conf.) · ${risk.riskCategory} (${risk.riskScore}/100)`
    );

    logAudit(db, {
      userId: actingUserId,
      action: 'DOCUMENT_ANALYZED',
      targetType: 'document',
      targetId: documentId,
      details: {
        category: classification.category,
        riskCategory: risk.riskCategory,
        riskScore: risk.riskScore,
        factorCount: risk.factors.length,
      },
    });

    return analysisRow.id;
  } catch (err) {
    db.prepare("UPDATE documents SET status = 'FAILED' WHERE id = ?").run(documentId);
    throw err;
  }
}
