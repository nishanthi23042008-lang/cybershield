import path from 'node:path';
import JSZip from 'jszip';
import * as jpeg from 'jpeg-js';
import { PDFDocument } from 'pdf-lib';
import { PNG } from 'pngjs';

export interface DocumentMetadataResult {
  fileName: string;
  extension: string;
  fileSizeBytes: number;
  mimeType: string;
  formatDetails: Record<string, unknown>;
  anomalies: Array<{ title: string; evidence: string; severity: 'LOW' | 'MEDIUM' }>;
  authenticityCaveat: string;
}

const SUSPICIOUS_EDITING_SOFTWARE = [
  'photoshop',
  'gimp',
  'illustrator',
  'canva',
  'foxit',
  'acrobat pro',
  'ilovepdf',
  'smallpdf',
  'sejda',
  'pdfescape',
  'libreoffice',
  'paint.net',
  'pixelmator',
];

function scanExifSoftwareHint(buffer: Buffer): string[] {
  const ascii = buffer.subarray(0, Math.min(buffer.length, 65536)).toString('latin1').toLowerCase();
  const found: string[] = [];
  for (const tool of SUSPICIOUS_EDITING_SOFTWARE) {
    if (ascii.includes(tool)) {
      found.push(tool);
    }
  }
  return found;
}

export async function extractDocumentMetadata(
  buffer: Buffer,
  originalFilename: string,
  mimeType: string
): Promise<DocumentMetadataResult> {
  const ext = path.extname(originalFilename).toLowerCase();
  const formatDetails: Record<string, unknown> = {};
  const anomalies: Array<{ title: string; evidence: string; severity: 'LOW' | 'MEDIUM' }> = [];

  try {
    if (ext === '.pdf') {
      const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
      const title = pdfDoc.getTitle() || null;
      const author = pdfDoc.getAuthor() || null;
      const subject = pdfDoc.getSubject() || null;
      const creator = pdfDoc.getCreator() || null;
      const producer = pdfDoc.getProducer() || null;
      const creationDate = pdfDoc.getCreationDate()?.toISOString() || null;
      const modificationDate = pdfDoc.getModificationDate()?.toISOString() || null;
      const pageCount = pdfDoc.getPageCount();

      Object.assign(formatDetails, {
        pageCount,
        title,
        author,
        subject,
        creator,
        producer,
        creationDate,
        modificationDate,
      });

      const combinedMeta = `${creator || ''} ${producer || ''}`.toLowerCase();
      const matchedTools = SUSPICIOUS_EDITING_SOFTWARE.filter((t) => combinedMeta.includes(t));
      if (matchedTools.length > 0) {
        anomalies.push({
          title: 'PDF metadata indicates post-processing or editor software',
          evidence: `Creator/Producer metadata references (${matchedTools.join(', ')}). Note: legitimate exports can also use these tools.`,
          severity: 'LOW',
        });
      }

      if (creationDate && modificationDate) {
        const cMs = Date.parse(creationDate);
        const mMs = Date.parse(modificationDate);
        if (!Number.isNaN(cMs) && !Number.isNaN(mMs) && mMs - cMs > 60 * 60 * 1000) {
          anomalies.push({
            title: 'PDF modification timestamp differs from creation timestamp',
            evidence: `Created ${creationDate}, modified ${modificationDate}. Re-saving or signing a PDF can cause this, so manual verification is needed.`,
            severity: 'LOW',
          });
        }
      }
    } else if (ext === '.png') {
      const png = PNG.sync.read(buffer);
      const softwareHints = scanExifSoftwareHint(buffer);
      Object.assign(formatDetails, {
        imageFormat: 'PNG',
        width: png.width,
        height: png.height,
        colorType: png.color ? 'Color' : 'Grayscale',
        alphaChannel: png.alpha,
        softwareHints,
      });
      if (softwareHints.length > 0) {
        anomalies.push({
          title: 'PNG header references image editing software',
          evidence: `Embedded text chunks reference: ${softwareHints.join(', ')}. Metadata is mutable and not proof of tampering.`,
          severity: 'LOW',
        });
      }
    } else if (ext === '.jpg' || ext === '.jpeg') {
      const decoded = jpeg.decode(buffer, { useTArray: true });
      const softwareHints = scanExifSoftwareHint(buffer);
      Object.assign(formatDetails, {
        imageFormat: 'JPEG',
        width: decoded.width,
        height: decoded.height,
        hasExifApp1: buffer.includes(Buffer.from('Exif\0\0')),
        softwareHints,
      });
      if (softwareHints.length > 0) {
        anomalies.push({
          title: 'JPEG EXIF/header references editing software',
          evidence: `Embedded JPEG segments reference: ${softwareHints.join(', ')}. Metadata alone does not prove forgery.`,
          severity: 'LOW',
        });
      }
    } else if (ext === '.docx') {
      const zip = await JSZip.loadAsync(buffer);
      const coreXml = (await zip.file('docProps/core.xml')?.async('string')) || '';
      const appXml = (await zip.file('docProps/app.xml')?.async('string')) || '';
      const extractXmlTag = (xml: string, tag: string) => {
        const m = xml.match(new RegExp(`<(?:[a-zA-Z0-9_]+:)?${tag}[^>]*>([^<]*)</`, 'i'));
        return m ? m[1].trim() : null;
      };
      const creator = extractXmlTag(coreXml, 'creator');
      const lastModifiedBy = extractXmlTag(coreXml, 'lastModifiedBy');
      const revision = extractXmlTag(coreXml, 'revision');
      const created = extractXmlTag(coreXml, 'created');
      const modified = extractXmlTag(coreXml, 'modified');
      const application = extractXmlTag(appXml, 'Application');

      Object.assign(formatDetails, {
        documentFormat: 'DOCX (OpenXML)',
        creator,
        lastModifiedBy,
        revision,
        created,
        modified,
        application,
      });

      if (creator && lastModifiedBy && creator !== lastModifiedBy) {
        anomalies.push({
          title: 'DOCX author differs from last modified user',
          evidence: `Created by "${creator}", last modified by "${lastModifiedBy}". Collaborative editing is common, so treat as context only.`,
          severity: 'LOW',
        });
      }
    }
  } catch (err) {
    formatDetails.metadataParseWarning = err instanceof Error ? err.message : 'Unable to parse embedded metadata';
  }

  return {
    fileName: originalFilename,
    extension: ext,
    fileSizeBytes: buffer.length,
    mimeType,
    formatDetails,
    anomalies,
    authenticityCaveat:
      'File metadata can be stripped, modified, or preserved across legitimate exports and is never reliable proof of authenticity or forgery on its own.',
  };
}
