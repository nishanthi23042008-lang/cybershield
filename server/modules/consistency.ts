import type { ExtractedFields } from './extraction.ts';

export interface ConsistencyCheckItem {
  checkName: string;
  status: 'PASSED' | 'FAILED' | 'MISSING_EVIDENCE';
  details: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
}

export function runConsistencyChecks(
  fields: ExtractedFields,
  tolerance = 0.5,
  matchedReferences: Array<{
    ref_code: string;
    supplier_name: string | null;
    customer_name: string | null;
    doc_number: string | null;
    total_amount: number | null;
    category: string;
  }> = []
): ConsistencyCheckItem[] {
  const checks: ConsistencyCheckItem[] = [];

  // 1. Line-item multiplication check
  if (fields.lineItems.length > 0) {
    const badLines: string[] = [];
    let sumLineTotals = 0;
    for (const item of fields.lineItems) {
      const expected = Number((item.qty * item.unitPrice).toFixed(2));
      sumLineTotals += item.lineTotal;
      if (Math.abs(expected - item.lineTotal) > tolerance) {
        badLines.push(
          `"${item.description}": ${item.qty} x ${item.unitPrice.toFixed(2)} = ${expected.toFixed(2)}, stated ${item.lineTotal.toFixed(2)}`
        );
      }
    }
    if (badLines.length > 0) {
      checks.push({
        checkName: 'Line-Item Arithmetic Verification',
        status: 'FAILED',
        details: `Line calculation mismatch detected: ${badLines.join('; ')}`,
        severity: 'HIGH',
      });
    } else {
      checks.push({
        checkName: 'Line-Item Arithmetic Verification',
        status: 'PASSED',
        details: `All ${fields.lineItems.length} parsed line items satisfy qty x unit price = line total.`,
        severity: 'LOW',
      });
    }

    if (fields.subtotal !== null) {
      if (Math.abs(sumLineTotals - fields.subtotal) > tolerance) {
        checks.push({
          checkName: 'Subtotal Summation Check',
          status: 'FAILED',
          details: `Sum of line totals (${sumLineTotals.toFixed(2)}) differs from stated Subtotal (${fields.subtotal.toFixed(2)}).`,
          severity: 'HIGH',
        });
      } else {
        checks.push({
          checkName: 'Subtotal Summation Check',
          status: 'PASSED',
          details: `Line totals sum (${sumLineTotals.toFixed(2)}) matches stated Subtotal (${fields.subtotal.toFixed(2)}).`,
          severity: 'LOW',
        });
      }
    } else {
      checks.push({
        checkName: 'Subtotal Summation Check',
        status: 'MISSING_EVIDENCE',
        details: 'Subtotal field was not extracted from text; cannot verify line-item sum against subtotal.',
        severity: 'LOW',
      });
    }
  } else {
    checks.push({
      checkName: 'Line-Item Arithmetic Verification',
      status: 'MISSING_EVIDENCE',
      details: 'No structured line-item rows were extracted from the document text.',
      severity: 'LOW',
    });
  }

  // 2. Subtotal + Tax == Total check
  if (fields.subtotal !== null && fields.taxAmount !== null && fields.totalAmount !== null) {
    const expectedTotal = Number((fields.subtotal + fields.taxAmount).toFixed(2));
    if (Math.abs(expectedTotal - fields.totalAmount) > tolerance) {
      checks.push({
        checkName: 'Subtotal + Tax = Total Consistency',
        status: 'FAILED',
        details: `Subtotal (${fields.subtotal.toFixed(2)}) + Tax (${fields.taxAmount.toFixed(2)}) = ${expectedTotal.toFixed(2)}, which disagrees with stated TOTAL (${fields.totalAmount.toFixed(2)}).`,
        severity: 'HIGH',
      });
    } else {
      checks.push({
        checkName: 'Subtotal + Tax = Total Consistency',
        status: 'PASSED',
        details: `Subtotal + Tax (${expectedTotal.toFixed(2)}) matches stated TOTAL (${fields.totalAmount.toFixed(2)}).`,
        severity: 'LOW',
      });
    }
  } else {
    checks.push({
      checkName: 'Subtotal + Tax = Total Consistency',
      status: 'MISSING_EVIDENCE',
      details: 'One or more financial summary fields (Subtotal, Tax, Total) could not be extracted.',
      severity: 'LOW',
    });
  }

  // 3. Date ordering check
  if (fields.docDate && fields.dueDate) {
    const d1 = Date.parse(fields.docDate);
    const d2 = Date.parse(fields.dueDate);
    if (!Number.isNaN(d1) && !Number.isNaN(d2)) {
      if (d2 < d1) {
        checks.push({
          checkName: 'Document & Due Date Chronology',
          status: 'FAILED',
          details: `Due/delivery date (${fields.dueDate}) precedes document issue date (${fields.docDate}).`,
          severity: 'MEDIUM',
        });
      } else {
        checks.push({
          checkName: 'Document & Due Date Chronology',
          status: 'PASSED',
          details: `Document date (${fields.docDate}) precedes or equals due/delivery date (${fields.dueDate}).`,
          severity: 'LOW',
        });
      }
    }
  }

  // 4. Cross-document check against reference with same doc number if applicable
  if (fields.docNumber && matchedReferences.length > 0) {
    const exactIdRef = matchedReferences.find(
      (r) => r.doc_number && r.doc_number.toLowerCase() === fields.docNumber!.toLowerCase()
    );
    if (exactIdRef) {
      const mismatches: string[] = [];
      if (
        exactIdRef.supplier_name &&
        fields.supplierName &&
        exactIdRef.supplier_name.toLowerCase() !== fields.supplierName.toLowerCase()
      ) {
        mismatches.push(`Supplier "${fields.supplierName}" vs reference "${exactIdRef.supplier_name}"`);
      }
      if (
        exactIdRef.total_amount !== null &&
        fields.totalAmount !== null &&
        Math.abs(exactIdRef.total_amount - fields.totalAmount) > tolerance
      ) {
        mismatches.push(
          `Total ${fields.totalAmount.toFixed(2)} vs reference ${exactIdRef.total_amount.toFixed(2)}`
        );
      }
      if (mismatches.length > 0) {
        checks.push({
          checkName: 'Reference Identifier Cross-Check',
          status: 'FAILED',
          details: `Document shares identifier ${fields.docNumber} with ${exactIdRef.ref_code} (fictional reference dataset) but diverges on: ${mismatches.join('; ')}.`,
          severity: 'HIGH',
        });
      } else {
        checks.push({
          checkName: 'Reference Identifier Cross-Check',
          status: 'PASSED',
          details: `Document matches identifier ${fields.docNumber} in reference ${exactIdRef.ref_code} with consistent supplier and total.`,
          severity: 'LOW',
        });
      }
    }
  }

  return checks;
}
