export type UserRole = 'ADMIN' | 'ANALYST' | 'USER';

export interface User {
  id: number;
  username: string;
  email: string;
  fullName: string;
  role: UserRole;
  status: 'ACTIVE' | 'SUSPENDED';
}

export type NavPage =
  | 'overview'
  | 'references'
  | 'upload'
  | 'analysis'
  | 'tamper'
  | 'duplicates'
  | 'reports'
  | 'history'
  | 'users'
  | 'settings';

export interface DashboardStats {
  totalUploaded: number;
  totalReferences: number;
  totalAnalyzed: number;
  lowRiskCount: number;
  manualReviewCount: number;
  highRiskCount: number;
  duplicateDocumentsCount: number;
  recentScans: Array<{
    id: number;
    document_id: number;
    action: string;
    risk_category: 'GREEN' | 'YELLOW' | 'RED' | null;
    risk_score: number | null;
    summary: string;
    created_at: string;
    original_filename: string;
    username: string;
  }>;
  referenceBreakdown: Array<{
    category: string;
    count: number;
  }>;
}

export interface DocumentSummary {
  id: number;
  user_id: number;
  original_filename: string;
  stored_filename: string;
  mime_type: string;
  file_extension: string;
  file_size: number;
  sha256_hash: string;
  md5_hash: string;
  phash: string | null;
  status: string;
  uploaded_at: string;
  uploaded_by_username: string;
  predicted_category: string | null;
  classification_confidence: number | null;
  risk_score: number | null;
  risk_category: 'GREEN' | 'YELLOW' | 'RED' | null;
  human_review_status: 'PENDING' | 'APPROVED' | 'FLAGGED' | null;
  analyzed_at: string | null;
  supplier_name: string | null;
  customer_name: string | null;
  doc_number: string | null;
  total_amount: number | null;
  currency: string | null;
}

export interface ReferenceDocumentRow {
  id: number;
  ref_code: string;
  category: string;
  sub_class: string | null;
  page_number: number;
  source_pdf: string;
  sha256_hash: string;
  supplier_name: string | null;
  customer_name: string | null;
  doc_number: string | null;
  doc_date: string | null;
  total_amount: number | null;
  currency: string | null;
  is_fictional_test_data: number;
  created_at: string;
  extracted_text?: string;
}
