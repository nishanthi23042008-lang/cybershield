export interface ChangedLineItem {
  lineNumber: number;
  changeType: 'ADDED' | 'REMOVED' | 'MODIFIED';
  originalText: string;
  modifiedText: string;
  fieldHint: string | null;
}

function tokenize(text: string): string[] {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

export function computeTfIdfSimilarityMatrix(targetText: string, corpusTexts: string[]): number[] {
  if (corpusTexts.length === 0) return [];
  const docs = [targetText, ...corpusTexts].map(tokenize);
  const df = new Map<string, number>();

  for (const tokens of docs) {
    const unique = new Set(tokens);
    for (const tok of unique) {
      df.set(tok, (df.get(tok) || 0) + 1);
    }
  }

  const N = docs.length;
  const vectorize = (tokens: string[]): Map<string, number> => {
    const tf = new Map<string, number>();
    for (const tok of tokens) {
      tf.set(tok, (tf.get(tok) || 0) + 1);
    }
    const vec = new Map<string, number>();
    for (const [tok, count] of tf.entries()) {
      const idf = Math.log((N + 1) / ((df.get(tok) || 0) + 1)) + 1;
      vec.set(tok, (count / Math.max(1, tokens.length)) * idf);
    }
    return vec;
  };

  const targetVec = vectorize(docs[0]);
  const targetNorm = Math.sqrt(Array.from(targetVec.values()).reduce((s, v) => s + v * v, 0));

  return docs.slice(1).map((tokens) => {
    if (targetNorm === 0 || tokens.length === 0) return 0;
    const vec = vectorize(tokens);
    let dot = 0;
    let norm = 0;
    for (const [k, v] of vec.entries()) {
      norm += v * v;
      const tv = targetVec.get(k);
      if (tv) dot += v * tv;
    }
    const denom = targetNorm * Math.sqrt(norm);
    return denom > 0 ? Number((dot / denom).toFixed(4)) : 0;
  });
}

export function computeJaccardTokenSimilarity(textA: string, textB: string): number {
  const a = new Set(tokenize(textA));
  const b = new Set(tokenize(textB));
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const tok of a) {
    if (b.has(tok)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return Number((intersection / union).toFixed(4));
}

function detectFieldHint(line: string): string | null {
  if (/\b(total|subtotal|tax|inr|usd|eur)\b/i.test(line)) return 'Financial Amount';
  if (/\b(invoice|receipt|po|bill|document)\s*(number|no|#)|dg-/i.test(line)) return 'Document Identifier';
  if (/\b(date|due|delivery|period)\b/i.test(line)) return 'Date / Schedule';
  if (/\b(tax id|email|address|supplier|customer)\b/i.test(line)) return 'Party / Contact Info';
  return null;
}

export function computeLineDiff(originalText: string, modifiedText: string): ChangedLineItem[] {
  const origLines = (originalText || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const modLines = (modifiedText || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const changes: ChangedLineItem[] = [];
  const maxLen = Math.max(origLines.length, modLines.length);

  // Align via LCS for short/medium documents, fallback to positional diff
  const m = origLines.length;
  const n = modLines.length;
  if (m <= 200 && n <= 200) {
    const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
    for (let i = m - 1; i >= 0; i--) {
      for (let j = n - 1; j >= 0; j--) {
        if (origLines[i] === modLines[j]) {
          dp[i][j] = 1 + dp[i + 1][j + 1];
        } else {
          dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
      }
    }

    let i = 0;
    let j = 0;
    while (i < m || j < n) {
      if (i < m && j < n && origLines[i] === modLines[j]) {
        i++;
        j++;
      } else if (i < m && j < n && dp[i + 1][j] === dp[i][j + 1] && computeJaccardTokenSimilarity(origLines[i], modLines[j]) >= 0.3) {
        changes.push({
          lineNumber: j + 1,
          changeType: 'MODIFIED',
          originalText: origLines[i],
          modifiedText: modLines[j],
          fieldHint: detectFieldHint(`${origLines[i]} ${modLines[j]}`),
        });
        i++;
        j++;
      } else if (j < n && (i === m || dp[i][j + 1] >= dp[i + 1][j])) {
        changes.push({
          lineNumber: j + 1,
          changeType: 'ADDED',
          originalText: '',
          modifiedText: modLines[j],
          fieldHint: detectFieldHint(modLines[j]),
        });
        j++;
      } else if (i < m) {
        changes.push({
          lineNumber: i + 1,
          changeType: 'REMOVED',
          originalText: origLines[i],
          modifiedText: '',
          fieldHint: detectFieldHint(origLines[i]),
        });
        i++;
      }
    }
    return changes;
  }

  for (let idx = 0; idx < maxLen; idx++) {
    const o = origLines[idx] || '';
    const mod = modLines[idx] || '';
    if (o !== mod) {
      changes.push({
        lineNumber: idx + 1,
        changeType: o && mod ? 'MODIFIED' : mod ? 'ADDED' : 'REMOVED',
        originalText: o,
        modifiedText: mod,
        fieldHint: detectFieldHint(`${o} ${mod}`),
      });
    }
  }
  return changes;
}
