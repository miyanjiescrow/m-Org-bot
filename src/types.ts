/**
 * Miyanji Smart Escrow & Electronic Contracts (سامانه هوشمند واسطه‌گری امن میانجی)
 * Unified TypeScript Type Definitions for Web, Telegram Mini App & Database
 */

export type UserRole = 'employer' | 'freelancer' | 'arbitrator' | 'ambassador' | 'admin';

export type ContractStatus = 
  | 'draft'
  | 'pending_party_b'
  | 'awaiting_payment'
  | 'awaiting_receipt_approval'
  | 'active'
  | 'in_progress'
  | 'work_submitted'
  | 'in_dispute'
  | 'completed'
  | 'cancelled';

export type ContractCategory = 'DEV' | 'DS' | 'CNT' | 'CNS' | 'TRD' | 'GEN';

export type KycStatus = 'unverified' | 'pending' | 'verified';
export type KycLevel = 'basic' | 'silver' | 'gold';

export interface Milestone {
  id: string;
  title: string;
  amount: number;
  status: 'pending' | 'in_progress' | 'completed';
  deadline_days?: number;
}

export interface ContractHistoryEvent {
  event: string;
  timestamp: string;
  actor: string;
  actor_id?: number;
}

export interface Deliverables {
  notes: string;
  links: string[];
  submitted_at: string;
  file_names?: string[];
}

export interface UserProfile {
  id: number;
  telegram_id?: number;
  username?: string;
  full_name: string;
  phone_number: string;
  role: UserRole;
  wallet_balance: number;
  escrow_locked_balance: number;
  kyc_level: KycLevel;
  kyc_status: KycStatus;
  referral_code: string;
  created_at: string;
  sheba?: string;
  national_id?: string;
  is_verified?: boolean;
  is_blacklisted?: boolean;
  kyc_card_image?: string;
  kyc_submitted_at?: string;
  invited_by?: number;
}

export interface Contract {
  id: string;
  contract_id: string;
  title: string;
  amount: number;
  category: ContractCategory;
  deadline: number;
  description: string;
  free_edits: number;
  free_edits_left: number;
  free_edits_total?: number;
  commission_payer: 'freelancer' | 'employer' | 'split_50_50';
  creator_id: number;
  created_by?: number;
  status: ContractStatus;
  
  // Buyer / Employer (کارفرما)
  buyer_id?: number;
  buyer_fullname?: string;
  buyer_phone?: string;
  buyer_national_id?: string;
  buyer_signed_at?: string;
  buyer_otp_verified?: boolean;
  
  // Seller / Freelancer (مجری)
  seller_id?: number;
  seller_fullname?: string;
  seller_phone?: string;
  seller_national_id?: string;
  seller_signed_at?: string;
  seller_otp_verified?: boolean;
  
  // Staged Milestones & Deliverables
  milestones?: Milestone[];
  staged_payment?: boolean;
  recurring?: boolean;
  deliverables?: Deliverables;
  dispute_id?: string;
  history: ContractHistoryEvent[];
  
  created_at: string;
  paid_at?: string;
  delivery_deadline?: string;
}

export interface WalletTransaction {
  id: string;
  user_id: number;
  type: 'deposit' | 'withdraw' | 'escrow_lock' | 'escrow_release' | 'wallet_payment' | 'refund' | 'affiliate_reward';
  amount: number;
  title: string;
  description?: string;
  status: 'pending' | 'approved' | 'completed' | 'rejected';
  ref_id: string;
  contract_id?: string;
  sheba?: string;
  receipt_file_id?: string;
  created_at: string;
}

export interface DisputeMessage {
  id: string;
  sender_id: number;
  sender_name: string;
  sender_role: 'buyer' | 'seller' | 'arbitrator' | 'admin';
  text: string;
  attachment?: string;
  timestamp: string;
}

export interface DisputeRuling {
  decision: 'pay_seller' | 'refund_buyer' | 'split_50_50';
  arbitrator_name: string;
  comment: string;
  resolved_at: string;
}

export interface DisputeCase {
  id: string;
  contract_id: string;
  contract_title: string;
  claimant_id: number;
  claimant_name: string;
  reason: string;
  description: string;
  evidence_files: string[];
  status: 'under_review' | 'resolved';
  messages: DisputeMessage[];
  ruling?: DisputeRuling;
  created_at: string;
}

export interface ReferralItem {
  user_name: string;
  signed_up_at: string;
  contracts_count: number;
  earned_amount: number;
}

export interface AffiliateStats {
  referral_code: string;
  referral_link: string;
  total_clicks: number;
  total_invited: number;
  active_traders: number;
  total_commission_earned: number;
  withdrawable_commission: number;
  commission_rate_percent: number;
  referral_history: ReferralItem[];
}

export interface DashboardStats {
  activeContracts: number;
  pendingContracts: number;
  draftsCount: number;
  completedContracts: number;
  disputesCount: number;
  totalEscrowVolume: number;
  commissionRate: number;
}
