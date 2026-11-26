import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { CONFIG } from '../config.ts';

export interface ReportPayload {
  generatedAt: string;
  disclaimer: string;
  document: {
    id: number;
    originalFilename: string;
    extension: string;
    mimeType: string;
    fileSize: number;
    sha256: string;
    md5: string;
    uploadedAt: string;
    uploadedByUsername: string;
  };
  classification: {
    predictedCategory: string;
    confidence: number;
  };
  metadata: Record<string, unknown>;
  extractedFields: Record<string, unknown>;
  ocrRawTextPreview: string;
  visualAnalysis: Record<string, unknown>;
  consistencyChecks: Array<Record<string, unknown>>;
  duplicateAndReferenceMatches: Array<Record<string, unknown>>;
  riskAssessment: {
    riskScore: number;
    riskCategory: string;
    riskSummary: string;
    factors: Array<Record<string, unknown>>;
    humanReviewStatus: string;
    humanReviewNotes: string | null;
  };
}

function wrapText(text: string, maxChars = 88): string[] {
  const words = (text || '').replace(/\s+/g, ' ').trim().split(' ');
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    if (!line) {
      line = w;
    } else if (line.length + 1 + w.length <= maxChars) {
      line += ' ' + w;
    } else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export function buildSafeJsonReport(payload: ReportPayload): {
  filename: string;
  storagePath: string;
  reportHash: string;
  content: string;
} {
  const jsonContent = JSON.stringify(payload, null, 2);
  const stamp = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const filename = `docuguard-report-doc${payload.document.id}-${stamp}.json`;
  const absPath = path.join(CONFIG.REPORTS_DIR, filename);
  fs.writeFileSync(absPath, jsonContent, 'utf8');
  const reportHash = crypto.createHash('sha256').update(jsonContent, 'utf8').digest('hex');
  return {
    filename,
    storagePath: path.join('reports', filename),
    reportHash,
    content: jsonContent,
  };
}

export async function buildPdfReport(
  payload: ReportPayload,
  heatmapAbsPath?: string | null
): Promise<{
  filename: string;
  storagePath: string;
  reportHash: string;
}> {
  const pdfDoc = await PDFDocument.create();
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontMono = await pdfDoc.embedFont(StandardFonts.Courier);

  let page = pdfDoc.addPage([595.28, 841.89]);
  const { width, height } = page.getSize();
  let y = height - 48;

  const ensureSpace = (needed = 40) => {
    if (y - needed < 56) {
      page = pdfDoc.addPage([595.28, 841.89]);
      y = height - 48;
    }
  };

  const drawTextLine = (
    text: string,
    opts: { size?: number; bold?: boolean; mono?: boolean; color?: ReturnType<typeof rgb>; x?: number } = {}
  ) => {
    ensureSpace(18);
    const safe = (text || '').replace(/[^\x20-\x7E]/g, ' ');
    page.drawText(safe, {
      x: opts.x ?? 42,
      y,
      size: opts.size ?? 9.5,
      font: opts.mono ? fontMono : opts.bold ? fontBold : fontRegular,
      color: opts.color ?? rgb(0.1, 0.14, 0.22),
    });
    y -= (opts.size ?? 9.5) + 5;
  };

  const drawSectionHeader = (title: string) => {
    ensureSpace(34);
    y -= 6;
    page.drawRectangle({
      x: 42,
      y: y - 4,
      width: width - 84,
      height: 18,
      color: rgb(0.94, 0.96, 0.99),
    });
    page.drawText(title, {
      x: 48,
      y: y + 1,
      size: 10.5,
      font: fontBold,
      color: rgb(0.06, 0.12, 0.26),
    });
    y -= 20;
  };

  page.drawRectangle({
    x: 0,
    y: height - 74,
    width,
    height: 74,
    color: rgb(0.06, 0.09, 0.17),
  });
  page.drawText('DOCUGUARD AI', {
    x: 42,
    y: height - 34,
    size: 18,
    font: fontBold,
    color: rgb(1, 1, 1),
  });
  page.drawText('Digital Document & Invoice Forensic Inspection Report', {
    x: 42,
    y: height - 52,
    size: 10,
    font: fontRegular,
    color: rgb(0.75, 0.84, 0.96),
  });
  page.drawText(`Generated: ${payload.generatedAt}`, {
    x: width - 210,
    y: height - 34,
    size: 8.5,
    font: fontMono,
    color: rgb(0.75, 0.84, 0.96),
  });

  y = height - 96;

  const riskColor =
    payload.riskAssessment.riskCategory === 'RED'
      ? rgb(0.82, 0.15, 0.15)
      : payload.riskAssessment.riskCategory === 'YELLOW'
      ? rgb(0.82, 0.48, 0.04)
      : rgb(0.09, 0.56, 0.3);

  page.drawRectangle({
    x: 42,
    y: y - 34,
    width: width - 84,
    height: 44,
    borderColor: riskColor,
    borderWidth: 1.5,
    color: rgb(0.98, 0.99, 1),
  });
  page.drawText(
    `RISK ASSESSMENT: ${payload.riskAssessment.riskCategory} (Score ${payload.riskAssessment.riskScore}/100)  |  Review: ${payload.riskAssessment.humanReviewStatus}`,
    {
      x: 52,
      y: y - 8,
      size: 10.5,
      font: fontBold,
      color: riskColor,
    }
  );
  const summaryLines = wrapText(payload.riskAssessment.riskSummary, 84);
  page.drawText(summaryLines[0] || '', {
    x: 52,
    y: y - 24,
    size: 8.5,
    font: fontRegular,
    color: rgb(0.2, 0.25, 0.33),
  });
  y -= 52;

  drawSectionHeader('1. Document Identification & Integrity');
  drawTextLine(`Document ID: #${payload.document.id}   File: ${payload.document.originalFilename}`);
  drawTextLine(
    `Format: ${payload.document.extension.toUpperCase()} (${payload.document.mimeType})   Size: ${payload.document.fileSize} bytes   Uploaded By: ${payload.document.uploadedByUsername}`
  );
  drawTextLine(`SHA-256: ${payload.document.sha256}`, { mono: true, size: 8.5 });
  drawTextLine(`MD5:     ${payload.document.md5}`, { mono: true, size: 8.5 });
  drawTextLine(
    `Classification: ${payload.classification.predictedCategory} (Confidence ${(
      payload.classification.confidence * 100
    ).toFixed(1)}%)`
  );

  drawSectionHeader('2. Extracted Financial Fields & Metadata');
  const ef = payload.extractedFields;
  drawTextLine(`Supplier: ${ef.supplierName || 'Not detected'}   |   Customer: ${ef.customerName || 'Not detected'}`);
  drawTextLine(
    `Document #: ${ef.docNumber || 'Not detected'}   |   Date: ${ef.docDate || 'N/A'}   |   Due: ${ef.dueDate || 'N/A'}`
  );
  drawTextLine(
    `Subtotal: ${ef.subtotal ?? 'N/A'}   |   Tax: ${ef.taxAmount ?? 'N/A'}   |   Total: ${ef.totalAmount ?? 'N/A'} ${ef.currency || ''}`
  );
  drawTextLine(`Metadata Summary: ${JSON.stringify(payload.metadata).slice(0, 180)}`, { size: 8.5 });

  drawSectionHeader('3. Evidence & Risk Scoring Factors');
  if (payload.riskAssessment.factors.length === 0) {
    drawTextLine('No negative anomaly factors were triggered by the automated checks.');
  } else {
    for (const f of payload.riskAssessment.factors) {
      drawTextLine(`[${f.severity}] ${f.title} (+${f.scoreImpact} pts)`, { bold: true });
      for (const line of wrapText(String(f.evidence || ''), 88)) {
        drawTextLine(`   ${line}`, { size: 8.5 });
      }
    }
  }

  drawSectionHeader('4. Arithmetic & Cross-Document Consistency');
  for (const c of payload.consistencyChecks) {
    drawTextLine(`[${c.status}] ${c.checkName}: ${String(c.details || '').slice(0, 110)}`, { size: 8.5 });
  }

  drawSectionHeader('5. Reference Dataset & Prior Upload Matches');
  if (payload.duplicateAndReferenceMatches.length === 0) {
    drawTextLine('No close matches exceeded configured similarity thresholds.');
  } else {
    for (const m of payload.duplicateAndReferenceMatches.slice(0, 6)) {
      drawTextLine(
        `${m.matchType} | Score ${(Number(m.similarityScore || 0) * 100).toFixed(1)}% | ${m.reason}`,
        { size: 8.5 }
      );
    }
  }

  drawSectionHeader('6. Visual Inspection & Error Level Analysis');
  drawTextLine(String(payload.visualAnalysis.summary || 'Visual analysis summary unavailable.'), { size: 8.5 });
  if (heatmapAbsPath && fs.existsSync(heatmapAbsPath)) {
    try {
      const imgBytes = fs.readFileSync(heatmapAbsPath);
      const embeddedPng = await pdfDoc.embedPng(imgBytes);
      const imgDims = embeddedPng.scaleToFit(240, 180);
      ensureSpace(imgDims.height + 24);
      page.drawImage(embeddedPng, {
        x: 42,
        y: y - imgDims.height,
        width: imgDims.width,
        height: imgDims.height,
      });
      y -= imgDims.height + 14;
    } catch {
      drawTextLine('Heatmap image present on disk but could not be embedded.', { size: 8.5 });
    }
  }

  drawSectionHeader('7. Verification Disclaimer');
  for (const line of wrapText(payload.disclaimer, 88)) {
    drawTextLine(line, { bold: true, size: 9 });
  }
  if (payload.riskAssessment.humanReviewNotes) {
    drawTextLine(`Reviewer Notes: ${payload.riskAssessment.humanReviewNotes}`, { size: 8.5 });
  }

  const pdfBytes = Buffer.from(await pdfDoc.save());
  const stamp = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const filename = `docuguard-report-doc${payload.document.id}-${stamp}.pdf`;
  const absPath = path.join(CONFIG.REPORTS_DIR, filename);
  fs.writeFileSync(absPath, pdfBytes);
  const reportHash = crypto.createHash('sha256').update(pdfBytes).digest('hex');

  return {
    filename,
    storagePath: path.join('reports', filename),
    reportHash,
  };
}
