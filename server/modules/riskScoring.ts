import type { ConsistencyCheckItem } from './consistency.ts';
import type { DocumentMetadataResult } from './metadata.ts';
import type { VisualAnalysisResult } from './visualAnalysis.ts';

export type RiskCategory = 'GREEN' | 'YELLOW' | 'RED';

export interface ScoreFactor {
  anomalyType: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  title: string;
  evidence: string;
  scoreImpact: number;
  isVisual: boolean;
}

export interface DuplicateMatchInput {
  matchType: 'EXACT_HASH' | 'NEAR_DUPLICATE' | 'CONTENT_SIMILAR' | 'REFERENCE_MATCH';
  similarityScore: number;
  label: string;
  differences: string[];
  reason: string;
}

export interface RiskAssessmentResult {
  riskScore: number;
  riskCategory: RiskCategory;
  riskSummary: string;
  factors: ScoreFactor[];
  missingEvidenceNotes: string[];
  recommendation: string;
}

export function computeRiskAssessment(params: {
  metadata: DocumentMetadataResult;
  visual: VisualAnalysisResult;
  consistency: ConsistencyCheckItem[];
  duplicateMatches: DuplicateMatchInput[];
  hasExtractedText: boolean;
}): RiskAssessmentResult {
  const factors: ScoreFactor[] = [];
  const missingEvidenceNotes: string[] = [];

  if (!params.hasExtractedText) {
    missingEvidenceNotes.push(
      'Minimal or empty text extracted: text-based classification, arithmetic verification, and content comparison have limited coverage.'
    );
  }

  for (const c of params.consistency) {
    if (c.status === 'MISSING_EVIDENCE') {
      missingEvidenceNotes.push(`${c.checkName}: ${c.details}`);
    } else if (c.status === 'FAILED') {
      const impact = c.severity === 'HIGH' ? 35 : c.severity === 'MEDIUM' ? 20 : 10;
      factors.push({
        anomalyType: 'CONSISTENCY_MISMATCH',
        severity: c.severity,
        title: c.checkName,
        evidence: c.details,
        scoreImpact: impact,
        isVisual: false,
      });
    }
  }

  // Exact duplicate prior upload (excluding reference matches)
  const exactPriorDups = params.duplicateMatches.filter((d) => d.matchType === 'EXACT_HASH');
  if (exactPriorDups.length > 0) {
    factors.push({
      anomalyType: 'EXACT_DUPLICATE',
      severity: 'MEDIUM',
      title: 'Exact SHA-256 Duplicate of Previously Uploaded Document',
      evidence: `Identical file hash matched ${exactPriorDups.map((d) => d.label).join(', ')}. Verify whether this is a duplicate submission.`,
      scoreImpact: 30,
      isVisual: false,
    });
  }

  // Near duplicate with changed financial or party details
  const nearDups = params.duplicateMatches.filter((d) => d.matchType === 'NEAR_DUPLICATE');
  for (const nd of nearDups.slice(0, 2)) {
    const hasChangedValues = nd.differences.length > 0;
    factors.push({
      anomalyType: hasChangedValues ? 'MODIFIED_NEAR_DUPLICATE' : 'NEAR_DUPLICATE',
      severity: hasChangedValues ? 'HIGH' : 'MEDIUM',
      title: hasChangedValues
        ? 'Near-Duplicate Document With Modified Values'
        : 'Near-Duplicate Document Detected',
      evidence: `${nd.reason}${hasChangedValues ? ` Differences: ${nd.differences.slice(0, 3).join('; ')}` : ''}`,
      scoreImpact: hasChangedValues ? 32 : 20,
      isVisual: false,
    });
  }

  // Visual inspection indicators (never sole proof of forgery)
  if (params.visual.applicable && params.visual.suspiciousRegions.length > 0) {
    const regionCount = params.visual.suspiciousRegions.length;
    const impact = regionCount >= 4 ? 25 : 15;
    factors.push({
      anomalyType: 'VISUAL_ELA_REGION',
      severity: regionCount >= 4 ? 'MEDIUM' : 'LOW',
      title: 'Localized Image Compression / ELA Inconsistency',
      evidence: `${regionCount} image region(s) showed elevated Error Level Analysis residuals. Legitimate scanning or re-saving can cause similar patterns.`,
      scoreImpact: impact,
      isVisual: true,
    });
  }

  // Metadata indicators (capped low impact; never treated as proof of fraud)
  for (const ma of params.metadata.anomalies) {
    factors.push({
      anomalyType: 'METADATA_INDICATOR',
      severity: 'LOW',
      title: ma.title,
      evidence: ma.evidence,
      scoreImpact: 6,
      isVisual: false,
    });
  }

  const rawScore = factors.reduce((sum, f) => sum + f.scoreImpact, 0);
  const riskScore = Math.min(100, Math.max(0, rawScore));

  let riskCategory: RiskCategory = 'GREEN';
  let riskSummary =
    'LOW RISK — No significant anomalies were detected by the implemented automated checks. This does not guarantee authenticity.';

  if (riskScore >= 55) {
    riskCategory = 'RED';
    riskSummary =
      'HIGH RISK — Multiple significant, corroborated inconsistencies or indicators were detected and require thorough human investigation.';
  } else if (riskScore >= 25) {
    riskCategory = 'YELLOW';
    riskSummary =
      'MANUAL REVIEW REQUIRED — One or more inconsistencies or suspicious indicators were detected and require human review before approval.';
  }

  return {
    riskScore,
    riskCategory,
    riskSummary,
    factors,
    missingEvidenceNotes,
    recommendation: 'Automated assessment only. Human verification is recommended before financial decisions.',
  };
}
