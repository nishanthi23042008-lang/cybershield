export type DocumentCategory =
  | 'Invoice'
  | 'Receipt'
  | 'Purchase Order'
  | 'Bill'
  | 'Other Financial Document';

export interface ClassificationResult {
  category: DocumentCategory;
  subClass: string | null;
  confidence: number;
  scores: Record<DocumentCategory, number>;
  matchedSignals: string[];
}

export function classifyDocumentText(text: string): ClassificationResult {
  const lower = (text || '').toLowerCase();
  const scores: Record<DocumentCategory, number> = {
    Invoice: 0,
    Receipt: 0,
    'Purchase Order': 0,
    Bill: 0,
    'Other Financial Document': 0,
  };
  const signals: string[] = [];

  const check = (pattern: RegExp, category: DocumentCategory, weight: number, label: string) => {
    if (pattern.test(lower)) {
      scores[category] += weight;
      signals.push(`${label} (+${weight} ${category})`);
    }
  };

  // Invoice signals
  check(/\btax invoice\b|\binvoice\s*\|/i, 'Invoice', 4.0, 'Invoice header');
  check(/\binvoice\s*(number|no\.?|#)\b/i, 'Invoice', 3.0, 'Invoice number field');
  check(/\bdg-inv-\d+/i, 'Invoice', 3.5, 'DG-INV identifier');
  check(/\bpayment\s*terms\b/i, 'Invoice', 1.2, 'Payment terms');
  check(/\bdue\s*date\b/i, 'Invoice', 0.8, 'Due date');

  // Receipt signals
  check(/\bpayment\s*receipt\b|\breceipt\s*\|/i, 'Receipt', 4.5, 'Receipt header');
  check(/\breceipt\s*(number|no\.?|#)\b/i, 'Receipt', 3.0, 'Receipt number field');
  check(/\bdg-rec-\d+/i, 'Receipt', 3.5, 'DG-REC identifier');
  check(/\bpayment\s*method\b|\btransaction\s*reference\b|\breceived\s*with\s*thanks\b/i, 'Receipt', 2.2, 'Payment confirmation text');

  // Purchase Order signals
  check(/\bpurchase\s*order\b/i, 'Purchase Order', 4.5, 'Purchase Order header');
  check(/\bpo\s*(number|no\.?|#)\b/i, 'Purchase Order', 3.0, 'PO number field');
  check(/\bdg-pur-\d+/i, 'Purchase Order', 3.5, 'DG-PUR identifier');
  check(/\bexpected\s*delivery\b|\bdelivery\s*terms\b/i, 'Purchase Order', 2.0, 'Delivery terms');

  // Bill signals
  check(/\bservice\s*\/\s*utility\s*bill\b|\b(?:^|\s)bill\s*\|/i, 'Bill', 4.5, 'Bill header');
  check(/\bbill\s*(number|no\.?|#)\b/i, 'Bill', 3.0, 'Bill number field');
  check(/\bdg-bil-\d+/i, 'Bill', 3.5, 'DG-BIL identifier');
  check(/\bservice\s*period\b|\baccount\s*reference\b|\butility\s*bill\b/i, 'Bill', 2.2, 'Service/utility billing fields');

  // Other Financial Document signals
  check(/\bother\s*financial\s*document\b/i, 'Other Financial Document', 4.0, 'Other Financial Document header');
  check(/\bcredit\s*note\b/i, 'Other Financial Document', 3.8, 'Credit Note');
  check(/\bdebit\s*note\b/i, 'Other Financial Document', 3.8, 'Debit Note');
  check(/\baccount\s*statement\b/i, 'Other Financial Document', 3.8, 'Account Statement');
  check(/\bremittance\s*advice\b/i, 'Other Financial Document', 3.8, 'Remittance Advice');
  check(/\bexpense\s*claim\b/i, 'Other Financial Document', 3.8, 'Expense Claim');
  check(/\bdg-oth-\d+/i, 'Other Financial Document', 3.5, 'DG-OTH identifier');

  let subClass: string | null = null;
  if (/\bcredit\s*note\b/i.test(lower)) subClass = 'CREDIT NOTE';
  else if (/\bdebit\s*note\b/i.test(lower)) subClass = 'DEBIT NOTE';
  else if (/\baccount\s*statement\b/i.test(lower)) subClass = 'ACCOUNT STATEMENT';
  else if (/\bremittance\s*advice\b/i.test(lower)) subClass = 'REMITTANCE ADVICE';
  else if (/\bexpense\s*claim\b/i.test(lower)) subClass = 'EXPENSE CLAIM';

  const entries = Object.entries(scores) as Array<[DocumentCategory, number]>;
  entries.sort((a, b) => b[1] - a[1]);

  const [topCategory, topScore] = entries[0];
  const totalPositive = entries.reduce((acc, [, val]) => acc + Math.max(0, val), 0);

  if (topScore <= 0) {
    return {
      category: 'Other Financial Document',
      subClass,
      confidence: 0.35,
      scores,
      matchedSignals: ['No strong category header detected; defaulted to Other Financial Document'],
    };
  }

  const confidence = Number(Math.min(0.99, Math.max(0.45, topScore / (totalPositive + 1.5))).toFixed(4));

  return {
    category: topCategory,
    subClass,
    confidence,
    scores,
    matchedSignals: signals,
  };
}
