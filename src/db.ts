/**
 * Miyanji Unified Database Layer (پایگاه داده یکپارچه و هماهنگ میانجی)
 * Synchronizes with Supabase Postgres tables when configured,
 * with complete in-memory fallback store and rich realistic seed data.
 */

import { supabase, isSupabaseConfigured } from './lib/supabase';
import { 
  UserProfile, 
  Contract, 
  WalletTransaction, 
  DisputeCase, 
  DisputeMessage, 
  AffiliateStats, 
  Milestone,
  DashboardStats 
} from './types';

// ====================================================
// ۱. توابع کمکی اعتبارسنجی و تولید شناسه (Validators & ID Gen)
// ====================================================

/**
 * اعتبارسنجی الگوریتم کد ملی ۱۰ رقمی ثبت احوال جمهوری اسلامی ایران
 */
export function isValidIranianNationalId(code: string): boolean {
  if (!code) return false;
  const clean = code.trim().replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d).toString());
  if (!/^\d{10}$/.test(clean)) return false;
  
  // بررسی کدهای تکراری مانند ۱۱۱۱۱۱۱۱۱۱
  if (/^(\d)\1{9}$/.test(clean)) return false;
  
  const check = parseInt(clean[9], 10);
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(clean[i], 10) * (10 - i);
  }
  const remainder = sum % 11;
  return (remainder < 2 && check === remainder) || (remainder >= 2 && check === 11 - remainder);
}

/**
 * اعتبارسنجی استاندارد شماره شبای ایرانی (IBAN ایرانی با فرمت IR و ۲۴ رقم)
 */
export function isValidIranianSheba(sheba: string): boolean {
  if (!sheba) return false;
  let clean = sheba.trim().toUpperCase().replace(/\s+/g, '');
  if (!clean.startsWith('IR')) {
    clean = 'IR' + clean;
  }
  if (!/^IR\d{24}$/.test(clean)) return false;
  
  // الگوریتم MOD-97 برای IBAN
  const rearranged = clean.slice(4) + clean.slice(0, 4);
  let numeric = '';
  for (const ch of rearranged) {
    if (ch >= 'A' && ch <= 'Z') {
      numeric += (ch.charCodeAt(0) - 55).toString();
    } else {
      numeric += ch;
    }
  }
  
  let remainder = 0;
  for (let i = 0; i < numeric.length; i += 7) {
    const chunk = remainder.toString() + numeric.slice(i, i + 7);
    remainder = parseInt(chunk, 10) % 97;
  }
  return remainder === 1;
}

/**
 * تولید شناسه یکتا برای قرارداد اسکرو میانجی (مطابق ساختار ربات و دیتابیس)
 */
export function generateContractId(category: string = 'GEN'): string {
  const cat = (category || 'GEN').toUpperCase();
  const randNum = Math.floor(100 + Math.random() * 900);
  const serial = Math.floor(100 + Math.random() * 900);
  return `${cat}-${randNum}-${serial}`;
}

export function formatCurrency(amount: number): string {
  return (amount || 0).toLocaleString('fa-IR') + ' تومان';
}

// ====================================================
// ۲. داده‌های اولیه و حافظه پایدار (Seed & Store)
// ====================================================

let _currentUserId = 1802649782; // علیرضا رضوانی (کارفرما - پیش‌فرض)

export function getCurrentUserId(): number {
  return _currentUserId;
}

export function setCurrentUserId(id: number): void {
  _currentUserId = Number(id);
}

// کاربران اولیه سیستم با نقش‌های مختلف جهت تست سناریوهای واقعی
export let users: UserProfile[] = [
  {
    id: 1802649782,
    telegram_id: 1802649782,
    username: 'alireza_rezvani',
    full_name: 'علیرضا رضوانی',
    phone_number: '09123456789',
    role: 'employer',
    wallet_balance: 45000000,
    escrow_locked_balance: 6000000,
    kyc_level: 'gold',
    kyc_status: 'verified',
    national_id: '0012345678',
    sheba: 'IR520120000000001234567890',
    referral_code: 'REF-18026',
    is_verified: true,
    is_blacklisted: false,
    created_at: '2026-01-10T10:00:00.000Z'
  },
  {
    id: 290184712,
    telegram_id: 290184712,
    username: 'sara_ahmadi_dev',
    full_name: 'سارا احمدی (برنامه‌نویس ارشد)',
    phone_number: '09359876543',
    role: 'freelancer',
    wallet_balance: 18500000,
    escrow_locked_balance: 0,
    kyc_level: 'gold',
    kyc_status: 'verified',
    national_id: '0087654321',
    sheba: 'IR890170000000009876543210',
    referral_code: 'REF-29018',
    is_verified: true,
    is_blacklisted: false,
    created_at: '2026-02-15T14:30:00.000Z'
  },
  {
    id: 391827461,
    telegram_id: 391827461,
    username: 'dr_karimi_arbitrator',
    full_name: 'دکتر محمدرضا کریمی (داور رسمی و وکیل دادگستری)',
    phone_number: '09121112233',
    role: 'arbitrator',
    wallet_balance: 0,
    escrow_locked_balance: 0,
    kyc_level: 'gold',
    kyc_status: 'verified',
    national_id: '0076543210',
    sheba: 'IR120190000000007654321000',
    referral_code: 'REF-ARBIT',
    is_verified: true,
    is_blacklisted: false,
    created_at: '2026-01-01T08:00:00.000Z'
  },
  {
    id: 481920315,
    telegram_id: 481920315,
    username: 'pouya_amani_ambassador',
    full_name: 'پویا امانی (سفیر و نماینده مارکتینگ)',
    phone_number: '09195554433',
    role: 'ambassador',
    wallet_balance: 5420000,
    escrow_locked_balance: 0,
    kyc_level: 'silver',
    kyc_status: 'verified',
    national_id: '0034567890',
    sheba: 'IR650150000000003456789012',
    referral_code: 'REF-POUYA',
    is_verified: true,
    is_blacklisted: false,
    created_at: '2026-03-01T12:00:00.000Z'
  }
];

// قراردادهای نمونه با وضعیت‌های متنوع
export let contracts: Contract[] = [
  {
    id: 'c_1',
    contract_id: 'DEV-901-442',
    title: 'توسعه ربات هوشمند صرافی و مدیریت دارایی‌های مالی در تلگرام',
    amount: 15000000,
    category: 'DEV',
    deadline: 14,
    description: 'توسعه ماژول‌های اتصال به وب‌سرویس نوبیتکس، لاجیک ثبت سفارش آنی، لاگینگ اختصاصی در Supabase و پیاده‌سازی مینی‌اپ تلگرام با React و Tailwind.',
    free_edits: 3,
    free_edits_left: 2,
    free_edits_total: 3,
    commission_payer: 'freelancer',
    creator_id: 1802649782,
    created_by: 1802649782,
    status: 'active',
    buyer_id: 1802649782,
    buyer_fullname: 'علیرضا رضوانی',
    buyer_phone: '09123456789',
    buyer_national_id: '0012345678',
    buyer_signed_at: '2026-10-20T11:00:00.000Z',
    buyer_otp_verified: true,
    seller_id: 290184712,
    seller_fullname: 'سارا احمدی (برنامه‌نویس ارشد)',
    seller_phone: '09359876543',
    seller_national_id: '0087654321',
    seller_signed_at: '2026-10-20T11:30:00.000Z',
    seller_otp_verified: true,
    paid_at: '2026-10-20T12:00:00.000Z',
    delivery_deadline: '2026-11-03T12:00:00.000Z',
    staged_payment: true,
    milestones: [
      { id: 'm_1', title: 'تحویل معماری دیتابیس و هسته اولیه API', amount: 5000000, status: 'completed' },
      { id: 'm_2', title: 'اتصال به تلگرام و پنل مینی‌اپ کاربر', amount: 5000000, status: 'in_progress' },
      { id: 'm_3', title: 'تست نهایی، داکرایز و راه‌اندازی سرور', amount: 5000000, status: 'pending' }
    ],
    history: [
      { event: 'قرارداد توسط علیرضا رضوانی در سامانه میانجی ایجاد شد.', timestamp: '2026-10-20T10:30:00.000Z', actor: 'کارفرما' },
      { event: 'قرارداد با امضای دیجیتال OTP طرفین قطعی شد.', timestamp: '2026-10-20T11:30:00.000Z', actor: 'سیستم اسکرو' },
      { event: 'مبلغ ۱۵,۰۰۰,۰۰۰ تومان در صندوق امانت امن میانجی قفل گردید.', timestamp: '2026-10-20T12:00:00.000Z', actor: 'صندوق امانت' },
      { event: 'مرحله اول به مبلغ ۵,۰۰۰,۰۰۰ تومان تحویل و تایید شد.', timestamp: '2026-10-25T16:00:00.000Z', actor: 'کارفرما' }
    ],
    created_at: '2026-10-20T10:30:00.000Z'
  },
  {
    id: 'c_2',
    contract_id: 'DS-802-115',
    title: 'طراحی هویت بصری، لوگو، کاتالوگ و ست اداری برند مدرن',
    amount: 6000000,
    category: 'DS',
    deadline: 7,
    description: 'طراحی کتابچه برند (Brand Book)، پالت رنگی استاندارد، فایل‌های وکتور SVG/AI و تایپوگرافی فارسی هماهنگ.',
    free_edits: 2,
    free_edits_left: 2,
    free_edits_total: 2,
    commission_payer: 'split_50_50',
    creator_id: 1802649782,
    created_by: 1802649782,
    status: 'pending_party_b',
    buyer_id: 1802649782,
    buyer_fullname: 'علیرضا رضوانی',
    buyer_phone: '09123456789',
    buyer_national_id: '0012345678',
    buyer_signed_at: '2026-10-27T09:00:00.000Z',
    buyer_otp_verified: true,
    seller_id: 290184712,
    seller_fullname: 'سارا احمدی (برنامه‌نویس ارشد)',
    seller_phone: '09359876543',
    history: [
      { event: 'پیش‌نویس قرارداد توسط کارفرما ثبت و امضای دیجیتال شد. در انتظار تایید طرف دوم.', timestamp: '2026-10-27T09:00:00.000Z', actor: 'کارفرما' }
    ],
    created_at: '2026-10-27T09:00:00.000Z'
  },
  {
    id: 'c_3',
    contract_id: 'CNT-703-998',
    title: 'تولید محتوا، سئو و نگارش ۲۰ مقاله تخصصی فناوری و بلاکچین',
    amount: 4000000,
    category: 'CNT',
    deadline: 10,
    description: 'نگارش مقالات سئومحور بالای ۱۵۰۰ کلمه به همراه تصاویر اختصاصی و نکات کلیدی برای وبلاگ رسمی پلتفرم.',
    free_edits: 3,
    free_edits_left: 3,
    free_edits_total: 3,
    commission_payer: 'freelancer',
    creator_id: 290184712,
    created_by: 290184712,
    status: 'work_submitted',
    buyer_id: 1802649782,
    buyer_fullname: 'علیرضا رضوانی',
    buyer_phone: '09123456789',
    buyer_national_id: '0012345678',
    buyer_signed_at: '2026-10-18T10:00:00.000Z',
    buyer_otp_verified: true,
    seller_id: 290184712,
    seller_fullname: 'سارا احمدی (برنامه‌نویس ارشد)',
    seller_phone: '09359876543',
    seller_national_id: '0087654321',
    seller_signed_at: '2026-10-18T10:30:00.000Z',
    seller_otp_verified: true,
    paid_at: '2026-10-18T11:00:00.000Z',
    deliverables: {
      notes: '۲۰ مقاله کامل و مستندات سئو در فایل زیپ و گوگل درایو بارگذاری شد.',
      links: ['https://drive.google.com/drive/folders/miyanji-seo-sample'],
      submitted_at: '2026-10-28T14:00:00.000Z'
    },
    history: [
      { event: 'قرارداد فعال شد و وجه در اسکرو قفل شد.', timestamp: '2026-10-18T11:00:00.000Z', actor: 'سیستم اسکرو' },
      { event: 'مجری پروژه خروجی نهایی را تحویل داد و در انتظار تایید کارفرماست.', timestamp: '2026-10-28T14:00:00.000Z', actor: 'مجری' }
    ],
    created_at: '2026-10-18T10:00:00.000Z'
  },
  {
    id: 'c_4',
    contract_id: 'TRD-505-772',
    title: 'انتقال مالکیت کانال تلگرامی و حساب کاربری ویژه فریلنسری',
    amount: 8500000,
    category: 'TRD',
    deadline: 3,
    description: 'واگذاری کامل ادمینی و شماره تماس متصل به کانال به همراه تعهد عدم استرداد مالکیت و تحویل مدارک ثبت شده.',
    free_edits: 0,
    free_edits_left: 0,
    free_edits_total: 0,
    commission_payer: 'employer',
    creator_id: 1802649782,
    created_by: 1802649782,
    status: 'in_dispute',
    buyer_id: 1802649782,
    buyer_fullname: 'علیرضا رضوانی',
    buyer_phone: '09123456789',
    buyer_national_id: '0012345678',
    buyer_signed_at: '2026-10-15T08:00:00.000Z',
    buyer_otp_verified: true,
    seller_id: 290184712,
    seller_fullname: 'سارا احمدی (برنامه‌نویس ارشد)',
    seller_phone: '09359876543',
    seller_national_id: '0087654321',
    seller_signed_at: '2026-10-15T08:30:00.000Z',
    seller_otp_verified: true,
    paid_at: '2026-10-15T09:00:00.000Z',
    dispute_id: 'disp_772',
    history: [
      { event: 'قرارداد فعال شد و ۸,۵۰۰,۰۰۰ تومان در اسکرو قفل گردید.', timestamp: '2026-10-15T09:00:00.000Z', actor: 'سیستم اسکرو' },
      { event: 'پرونده داوری به علت عدم هماهنگی در زمان تحویل مالکیت ثبت شد.', timestamp: '2026-10-22T10:15:00.000Z', actor: 'کارفرما' }
    ],
    created_at: '2026-10-15T08:00:00.000Z'
  },
  {
    id: 'c_5',
    contract_id: 'CNS-604-331',
    title: 'مشاوره فنی و حقوقی پیاده‌سازی سیستم‌های پرداخت اسکرو در ایران',
    amount: 5000000,
    category: 'CNS',
    deadline: 5,
    description: '۵ جلسه آنلاین مشاوره ساختاری جهت انطباق با قوانین تجارت الکترونیک و درگاه‌های بانکی پرداخت یار.',
    free_edits: 1,
    free_edits_left: 1,
    free_edits_total: 1,
    commission_payer: 'freelancer',
    creator_id: 1802649782,
    created_by: 1802649782,
    status: 'completed',
    buyer_id: 1802649782,
    buyer_fullname: 'علیرضا رضوانی',
    buyer_phone: '09123456789',
    buyer_national_id: '0012345678',
    buyer_signed_at: '2026-10-01T12:00:00.000Z',
    buyer_otp_verified: true,
    seller_id: 290184712,
    seller_fullname: 'سارا احمدی (برنامه‌نویس ارشد)',
    seller_phone: '09359876543',
    seller_national_id: '0087654321',
    seller_signed_at: '2026-10-01T12:30:00.000Z',
    seller_otp_verified: true,
    paid_at: '2026-10-01T13:00:00.000Z',
    history: [
      { event: 'قرارداد فعال شد.', timestamp: '2026-10-01T13:00:00.000Z', actor: 'صندوق امانت' },
      { event: 'جلسات مشاوره تکمیل و خروجی تحویل گردید.', timestamp: '2026-10-05T18:00:00.000Z', actor: 'مجری' },
      { event: 'تایید نهایی کارفرما انجام شد و وجه به مجری تسویه گردید.', timestamp: '2026-10-06T10:00:00.000Z', actor: 'کارفرما' }
    ],
    created_at: '2026-10-01T12:00:00.000Z'
  },
  {
    id: 'c_6',
    contract_id: 'GEN-406-119',
    title: 'تولید موشن گرافیک تبلیغاتی معرفی سامانه واسطه‌گری امن میانجی',
    amount: 7200000,
    category: 'GEN',
    deadline: 8,
    description: 'ساخت ویدیوی ۶۰ ثانیه‌ای موشن گرافیک ۲ بعدی با گویندگی حرفه‌ای و سناریوی اختصاصی.',
    free_edits: 3,
    free_edits_left: 3,
    free_edits_total: 3,
    commission_payer: 'freelancer',
    creator_id: 1802649782,
    created_by: 1802649782,
    status: 'draft',
    history: [
      { event: 'پیش‌نویس ذخیره شد.', timestamp: '2026-10-28T09:00:00.000Z', actor: 'کارفرما' }
    ],
    created_at: '2026-10-28T09:00:00.000Z'
  }
];

// تراکنش‌های مالی اولیه
export let transactions: WalletTransaction[] = [
  {
    id: 'tx_101',
    user_id: 1802649782,
    type: 'deposit',
    amount: 50000000,
    title: 'شارژ کیف پول از طریق درگاه پرداخت امن شاپرک',
    status: 'completed',
    ref_id: 'DEP-884920',
    created_at: '2026-10-10T10:15:00.000Z'
  },
  {
    id: 'tx_102',
    user_id: 1802649782,
    type: 'escrow_lock',
    amount: 15000000,
    title: 'قفل شدن وجه در صندوق امانت برای قرارداد DEV-901-442',
    status: 'completed',
    ref_id: 'ESC-901442',
    contract_id: 'DEV-901-442',
    created_at: '2026-10-20T12:00:00.000Z'
  },
  {
    id: 'tx_103',
    user_id: 290184712,
    type: 'escrow_release',
    amount: 4500000,
    title: 'تسویه نهایی قرارداد مشاوره CNS-604-331 (پس از کسر ۱۰٪ کارمزد پلتفرم)',
    status: 'completed',
    ref_id: 'REL-604331',
    contract_id: 'CNS-604-331',
    created_at: '2026-10-06T10:05:00.000Z'
  },
  {
    id: 'tx_104',
    user_id: 481920315,
    type: 'affiliate_reward',
    amount: 500000,
    title: 'پاداش کمیسیون سفیر از معامله تسویه شده CNS-604-331',
    status: 'completed',
    ref_id: 'AFF-331001',
    contract_id: 'CNS-604-331',
    created_at: '2026-10-06T10:10:00.000Z'
  }
];

// پرونده‌های داوری اولیه
export let disputes: DisputeCase[] = [
  {
    id: 'disp_772',
    contract_id: 'TRD-505-772',
    contract_title: 'انتقال مالکیت کانال تلگرامی و حساب کاربری ویژه فریلنسری',
    claimant_id: 1802649782,
    claimant_name: 'علیرضا رضوانی (کارفرما)',
    reason: 'تاخیر در انتقال کامل ادمینی کانال و عدم پاسخگویی فروشنده در موعد مقرر',
    description: 'طبق بند ۲ قرارداد، فروشنده موظف بود تا تاریخ ۲۱ مهرماه انتقال دسترسی مالک را نهایی کند ولی هنوز اقدامی صورت نگرفته است.',
    evidence_files: ['اسکرین‌شات چت تلگرام', 'رسید ثبت قرارداد'],
    status: 'under_review',
    messages: [
      {
        id: 'msg_1',
        sender_id: 1802649782,
        sender_name: 'علیرضا رضوانی',
        sender_role: 'buyer',
        text: 'سلام خدمت داور محترم و همکار گرامی، مهلت مقرر سپری شده و تقاضای تعیین تکلیف انتقال یا عودت وجه امانت را دارم.',
        timestamp: '2026-10-22T10:15:00.000Z'
      },
      {
        id: 'msg_2',
        sender_id: 290184712,
        sender_name: 'سارا احمدی',
        sender_role: 'seller',
        text: 'درود، به دلیل اختلال در پیامک‌های احراز هویت تلگرام امکان تغییر شماره مالک میسر نبود. مدارک تا ۴۸ ساعت آینده ارسال خواهد شد.',
        timestamp: '2026-10-22T14:30:00.000Z'
      },
      {
        id: 'msg_3',
        sender_id: 391827461,
        sender_name: 'دکتر محمدرضا کریمی',
        sender_role: 'arbitrator',
        text: 'پیام هر دو طرف بررسی شد. مهلت نهایی تا فردا ساعت ۱۸ تعیین می‌گردد. در صورت عدم تحویل، وجه مسترد خواهد شد.',
        timestamp: '2026-10-23T09:00:00.000Z'
      }
    ],
    created_at: '2026-10-22T10:15:00.000Z'
  }
];

// ====================================================
// ۳. توابع مدیریت کاربران (Users)
// ====================================================

export function getUsers(): UserProfile[] {
  return users;
}

export function getUser(userId: number): UserProfile | undefined {
  return users.find(u => u.id === Number(userId));
}

export function getCurrentUser(): UserProfile {
  return getUser(_currentUserId) || users[0];
}

export async function registerOrUpdateUser(userData: Partial<UserProfile> & { id: number }): Promise<UserProfile> {
  const index = users.findIndex(u => u.id === Number(userData.id));
  let user: UserProfile;
  
  if (index !== -1) {
    user = { ...users[index], ...userData };
    users[index] = user;
  } else {
    user = {
      id: Number(userData.id),
      full_name: userData.full_name || `کاربر ${userData.id}`,
      phone_number: userData.phone_number || '09120000000',
      role: userData.role || 'employer',
      wallet_balance: userData.wallet_balance || 0,
      escrow_locked_balance: userData.escrow_locked_balance || 0,
      kyc_level: userData.kyc_level || 'basic',
      kyc_status: userData.kyc_status || 'unverified',
      referral_code: userData.referral_code || `REF-${Math.floor(10000 + Math.random() * 90000)}`,
      created_at: new Date().toISOString(),
      ...userData
    };
    users.push(user);
  }

  // ثبت یا به‌روزرسانی در Supabase در صورت اتصال
  if (isSupabaseConfigured() && supabase) {
    try {
      await supabase.table('users').upsert({
        id: user.id,
        full_name: user.full_name,
        phone_number: user.phone_number,
        role: user.role,
        wallet_balance: user.wallet_balance,
        kyc_level: user.kyc_level,
        kyc_status: user.kyc_status,
        sheba: user.sheba,
        national_id: user.national_id,
        referral_code: user.referral_code,
        is_verified: user.is_verified || false
      }, { onConflict: 'id' });
    } catch (err: any) {
      console.warn('Notice syncing user with Supabase:', err.message);
    }
  }

  return user;
}

export async function submitKyc(
  userId: number, 
  nationalId: string, 
  sheba: string, 
  cardImage?: string
): Promise<{ success: boolean; message: string; user?: UserProfile }> {
  const user = getUser(userId);
  if (!user) return { success: false, message: 'کاربر یافت نشد.' };

  if (nationalId && !isValidIranianNationalId(nationalId)) {
    return { success: false, message: 'کد ملی وارد شده با الگوریتم ثبت احوال مطابقت ندارد.' };
  }
  if (sheba && !isValidIranianSheba(sheba)) {
    return { success: false, message: 'شماره شبای وارد شده نامعتبر است (فرمت IR + ۲۴ رقم و چک‌سام استاندارد).' };
  }

  user.national_id = nationalId ? nationalId.trim() : user.national_id;
  user.sheba = sheba ? sheba.trim().toUpperCase() : user.sheba;
  user.kyc_card_image = cardImage || 'verified_doc';
  user.kyc_status = 'verified';
  user.kyc_level = 'gold';
  user.is_verified = true;
  user.kyc_submitted_at = new Date().toISOString();

  if (isSupabaseConfigured() && supabase) {
    try {
      await supabase.table('users').update({
        national_id: user.national_id,
        sheba: user.sheba,
        kyc_status: 'verified',
        kyc_level: 'gold',
        is_verified: true
      }).eq('id', user.id);
    } catch (e: any) {
      console.warn('Supabase KYC update warning:', e.message);
    }
  }

  return {
    success: true,
    message: 'مدارک هویتی شما تایید گردید و حساب کاربری به سطح طلایی ارتقا یافت.',
    user
  };
}

// ====================================================
// ۴. توابع مدیریت قراردادهای اسکرو (Contracts)
// ====================================================

export function getContracts(filter?: { status?: string; category?: string; search?: string; userId?: number }): Contract[] {
  let list = [...contracts];

  if (filter?.status && filter.status !== 'all') {
    if (filter.status === 'active') {
      list = list.filter(c => c.status === 'active' || c.status === 'work_submitted' || c.status === 'in_progress');
    } else if (filter.status === 'pending') {
      list = list.filter(c => c.status === 'pending_party_b' || c.status === 'awaiting_payment' || c.status === 'awaiting_receipt_approval');
    } else {
      list = list.filter(c => c.status === filter.status);
    }
  }

  if (filter?.category && filter.category !== 'all') {
    list = list.filter(c => c.category === filter.category);
  }

  if (filter?.userId) {
    const uid = Number(filter.userId);
    list = list.filter(c => c.creator_id === uid || c.buyer_id === uid || c.seller_id === uid);
  }

  if (filter?.search) {
    const q = filter.search.toLowerCase().trim();
    list = list.filter(c => 
      c.title.toLowerCase().includes(q) ||
      c.contract_id.toLowerCase().includes(q) ||
      (c.buyer_fullname && c.buyer_fullname.toLowerCase().includes(q)) ||
      (c.seller_fullname && c.seller_fullname.toLowerCase().includes(q)) ||
      (c.description && c.description.toLowerCase().includes(q))
    );
  }

  return list;
}

export function getContract(contractId: string): Contract | undefined {
  const clean = contractId.trim();
  return contracts.find(c => c.contract_id === clean || c.id === clean);
}

export async function createContract(data: Partial<Contract> & { as_draft?: boolean }): Promise<Contract> {
  const cat = data.category || 'GEN';
  const cid = data.contract_id || generateContractId(cat);
  const now = new Date().toISOString();
  const currentUser = getCurrentUser();

  const isEmployer = (data.creator_id ? data.creator_id === currentUser.id : true);

  const newContract: Contract = {
    id: `c_${Date.now()}`,
    contract_id: cid,
    title: data.title || 'قرارداد جدید میانجی',
    amount: Number(data.amount) || 0,
    category: cat,
    deadline: Number(data.deadline) || 7,
    description: data.description || '',
    free_edits: Number(data.free_edits ?? 3),
    free_edits_left: Number(data.free_edits_left ?? data.free_edits ?? 3),
    free_edits_total: Number(data.free_edits ?? 3),
    commission_payer: data.commission_payer || 'freelancer',
    creator_id: data.creator_id || currentUser.id,
    created_by: data.creator_id || currentUser.id,
    status: data.as_draft ? 'draft' : 'pending_party_b',
    
    buyer_id: isEmployer ? currentUser.id : undefined,
    buyer_fullname: isEmployer ? (data.buyer_fullname || currentUser.full_name) : data.buyer_fullname,
    buyer_phone: isEmployer ? (data.buyer_phone || currentUser.phone_number) : data.buyer_phone,
    buyer_national_id: isEmployer ? (data.buyer_national_id || currentUser.national_id) : data.buyer_national_id,
    buyer_signed_at: isEmployer && !data.as_draft ? now : undefined,
    buyer_otp_verified: isEmployer && !data.as_draft ? true : false,

    seller_id: !isEmployer ? currentUser.id : undefined,
    seller_fullname: !isEmployer ? (data.seller_fullname || currentUser.full_name) : data.seller_fullname,
    seller_phone: !isEmployer ? (data.seller_phone || currentUser.phone_number) : data.seller_phone,
    seller_national_id: !isEmployer ? (data.seller_national_id || currentUser.national_id) : data.seller_national_id,
    seller_signed_at: !isEmployer && !data.as_draft ? now : undefined,
    seller_otp_verified: !isEmployer && !data.as_draft ? true : false,

    milestones: data.milestones || [],
    staged_payment: Boolean(data.staged_payment),
    history: [
      { event: `قرارداد توسط ${currentUser.full_name} در سامانه ثبت گردید.`, timestamp: now, actor: currentUser.full_name }
    ],
    created_at: now
  };

  contracts.unshift(newContract);

  // ثبت در Supabase
  if (isSupabaseConfigured() && supabase) {
    try {
      await supabase.table('contracts').upsert({
        id: newContract.id,
        contract_id: newContract.contract_id,
        title: newContract.title,
        amount: newContract.amount,
        category: newContract.category,
        deadline: newContract.deadline,
        description: newContract.description,
        status: newContract.status,
        creator_id: newContract.creator_id,
        buyer_id: newContract.buyer_id,
        seller_id: newContract.seller_id,
        free_edits_total: newContract.free_edits,
        free_edits_left: newContract.free_edits_left,
        commission_payer: newContract.commission_payer,
        milestones: newContract.milestones,
        history: newContract.history,
        created_at: newContract.created_at
      }, { onConflict: 'contract_id' });
    } catch (e: any) {
      console.warn('Supabase contract insert warning:', e.message);
    }
  }

  return newContract;
}

export async function updateContract(contractId: string, updates: Partial<Contract>): Promise<Contract | undefined> {
  const index = contracts.findIndex(c => c.contract_id === contractId || c.id === contractId);
  if (index === -1) return undefined;

  const existing = contracts[index];
  const updated: Contract = {
    ...existing,
    ...updates,
    history: [
      ...existing.history,
      ...(updates.history || [{ event: 'مشخصات قرارداد به‌روزرسانی شد.', timestamp: new Date().toISOString(), actor: 'سیستم' }])
    ]
  };

  contracts[index] = updated;

  if (isSupabaseConfigured() && supabase) {
    try {
      await supabase.table('contracts').update(updates).eq('contract_id', existing.contract_id);
    } catch (e: any) {
      console.warn('Supabase contract update warning:', e.message);
    }
  }

  return updated;
}

export async function deleteContract(contractId: string): Promise<boolean> {
  const initialLen = contracts.length;
  contracts = contracts.filter(c => c.contract_id !== contractId && c.id !== contractId);
  const deleted = contracts.length < initialLen;

  if (deleted && isSupabaseConfigured() && supabase) {
    try {
      await supabase.table('contracts').delete().eq('contract_id', contractId);
    } catch (e: any) {
      console.warn('Supabase contract delete warning:', e.message);
    }
  }

  return deleted;
}

export async function signContract(
  contractId: string, 
  role: 'employer' | 'freelancer', 
  signer: { fullname: string; phone: string; national_id?: string }
): Promise<Contract | undefined> {
  const c = getContract(contractId);
  if (!c) return undefined;

  const now = new Date().toISOString();

  if (role === 'employer') {
    c.buyer_fullname = signer.fullname || c.buyer_fullname;
    c.buyer_phone = signer.phone || c.buyer_phone;
    c.buyer_national_id = signer.national_id || c.buyer_national_id;
    c.buyer_signed_at = now;
    c.buyer_otp_verified = true;
    c.history.push({
      event: `✍️ قرارداد با تایید دیجیتال کارفرما (${c.buyer_fullname}) امضا شد.`,
      timestamp: now,
      actor: 'کارفرما'
    });

    if (c.seller_signed_at) {
      c.status = 'awaiting_payment';
      c.history.push({
        event: 'هر دو طرف قرارداد را تایید کردند. در انتظار تامین وجه به صندوق امانت.',
        timestamp: now,
        actor: 'سیستم اسکرو'
      });
    } else {
      c.status = 'pending_party_b';
    }
  } else {
    c.seller_fullname = signer.fullname || c.seller_fullname;
    c.seller_phone = signer.phone || c.seller_phone;
    c.seller_national_id = signer.national_id || c.seller_national_id;
    c.seller_signed_at = now;
    c.seller_otp_verified = true;
    c.history.push({
      event: `✍️ قرارداد با تایید دیجیتال مجری (${c.seller_fullname}) امضا شد.`,
      timestamp: now,
      actor: 'مجری'
    });

    if (c.buyer_signed_at) {
      c.status = 'awaiting_payment';
      c.history.push({
        event: 'هر دو طرف قرارداد را تایید کردند. در انتظار پرداخت وجه به صندوق امانت.',
        timestamp: now,
        actor: 'سیستم اسکرو'
      });
    } else {
      c.status = 'pending_party_b';
    }
  }

  if (isSupabaseConfigured() && supabase) {
    try {
      await supabase.table('contracts').update({
        status: c.status,
        buyer_signed_at: c.buyer_signed_at,
        seller_signed_at: c.seller_signed_at,
        buyer_otp_verified: c.buyer_otp_verified,
        seller_otp_verified: c.seller_otp_verified,
        history: c.history
      }).eq('contract_id', c.contract_id);
    } catch (e: any) {
      console.warn('Supabase sign contract update warning:', e.message);
    }
  }

  return c;
}

export async function payContractEscrow(contractId: string, userId: number): Promise<{ success: boolean; message: string; contract?: Contract }> {
  const c = getContract(contractId);
  if (!c) return { success: false, message: 'قرارداد یافت نشد.' };

  const user = getUser(userId) || getCurrentUser();
  if (user.wallet_balance < c.amount) {
    return { 
      success: false, 
      message: `موجودی ناکافی است. موجودی: ${formatCurrency(user.wallet_balance)} | مبلغ قرارداد: ${formatCurrency(c.amount)}` 
    };
  }

  // کسر از موجودی آزاد و افزودن به موجودی قفل شده در صندوق امانت
  user.wallet_balance -= c.amount;
  user.escrow_locked_balance += c.amount;

  const now = new Date().toISOString();
  c.status = 'active';
  c.paid_at = now;
  c.history.push({
    event: `💳 مبلغ ${formatCurrency(c.amount)} در صندوق امانت میانجی قفل شد و قرارداد فعال گردید.`,
    timestamp: now,
    actor: 'کارفرما'
  });

  const tx: WalletTransaction = {
    id: `tx_${Date.now()}`,
    user_id: user.id,
    type: 'escrow_lock',
    amount: c.amount,
    title: `قفل شدن وجه در صندوق امانت میانجی برای قرارداد ${c.contract_id}`,
    status: 'completed',
    ref_id: `ESC-${Math.floor(100000 + Math.random() * 900000)}`,
    contract_id: c.contract_id,
    created_at: now
  };
  transactions.unshift(tx);

  if (isSupabaseConfigured() && supabase) {
    try {
      await supabase.table('contracts').update({ status: 'active', paid_at: now, history: c.history }).eq('contract_id', c.contract_id);
      await supabase.table('users').update({ wallet_balance: user.wallet_balance, escrow_locked_balance: user.escrow_locked_balance }).eq('id', user.id);
      await supabase.table('transactions').insert(tx);
    } catch (e: any) {
      console.warn('Supabase pay escrow warning:', e.message);
    }
  }

  return { success: true, message: `مبلغ ${formatCurrency(c.amount)} در صندوق امانت قفل و قرارداد فعال شد.`, contract: c };
}

export async function deliverContract(contractId: string, deliverables: { notes: string; links: string[] }): Promise<Contract | undefined> {
  const c = getContract(contractId);
  if (!c) return undefined;

  const now = new Date().toISOString();
  c.status = 'work_submitted';
  c.deliverables = {
    notes: deliverables.notes || 'خروجی کار تحویل گردید.',
    links: deliverables.links || [],
    submitted_at: now
  };
  c.history.push({
    event: '📦 مجری خروجی‌های پروژه را ارسال کرد و در انتظار بررسی و تایید کارفرماست.',
    timestamp: now,
    actor: 'مجری'
  });

  if (isSupabaseConfigured() && supabase) {
    try {
      await supabase.table('contracts').update({ status: 'work_submitted', deliverables: c.deliverables, history: c.history }).eq('contract_id', c.contract_id);
    } catch (e: any) {
      console.warn('Supabase deliver warning:', e.message);
    }
  }

  return c;
}

export async function approveContract(contractId: string): Promise<{ success: boolean; contract?: Contract; netAmount?: number }> {
  const c = getContract(contractId);
  if (!c) return { success: false };

  const now = new Date().toISOString();
  c.status = 'completed';

  const commissionRate = 0.10; // ۱۰ درصد کارمزد پلتفرم
  const commission = Math.round(c.amount * commissionRate);
  const netAmount = c.amount - commission;

  // کسر وجه از اسکروی کارفرما
  const buyer = getUser(c.buyer_id || _currentUserId);
  if (buyer && buyer.escrow_locked_balance >= c.amount) {
    buyer.escrow_locked_balance -= c.amount;
  }

  // واریز به کیف پول مجری
  const seller = getUser(c.seller_id || 290184712);
  if (seller) {
    seller.wallet_balance += netAmount;
  }

  // واریز پاداش سفیر معرف (۱۰٪ از کارمزد پلتفرم)
  const affiliateReward = Math.round(commission * 0.10);
  const ambassador = users.find(u => u.role === 'ambassador');
  if (ambassador) {
    ambassador.wallet_balance += affiliateReward;
    transactions.unshift({
      id: `tx_${Date.now() + 1}`,
      user_id: ambassador.id,
      type: 'affiliate_reward',
      amount: affiliateReward,
      title: `پاداش معرف از تسویه قرارداد ${c.contract_id}`,
      status: 'completed',
      ref_id: `AFF-${Math.floor(100000 + Math.random() * 900000)}`,
      created_at: now
    });
  }

  c.history.push({
    event: `🏁 کارفرما کار را تایید نهایی کرد. وجه امانت به مبلغ ${formatCurrency(netAmount)} به کیف پول مجری واریز گردید. کارمزد: ${formatCurrency(commission)}.`,
    timestamp: now,
    actor: 'کارفرما'
  });

  transactions.unshift({
    id: `tx_${Date.now()}`,
    user_id: seller ? seller.id : 290184712,
    type: 'escrow_release',
    amount: netAmount,
    title: `تسویه نهایی قرارداد ${c.contract_id} پس از کسر کارمزد`,
    status: 'completed',
    ref_id: `REL-${Math.floor(100000 + Math.random() * 900000)}`,
    contract_id: c.contract_id,
    created_at: now
  });

  if (isSupabaseConfigured() && supabase) {
    try {
      await supabase.table('contracts').update({ status: 'completed', history: c.history }).eq('contract_id', c.contract_id);
    } catch (e: any) {
      console.warn('Supabase approve warning:', e.message);
    }
  }

  return { success: true, contract: c, netAmount };
}

export async function cancelContract(contractId: string): Promise<{ success: boolean; contract?: Contract }> {
  const c = getContract(contractId);
  if (!c) return { success: false };

  const now = new Date().toISOString();
  c.status = 'cancelled';

  // بازگرداندن وجه بلوکه شده به کارفرما
  const buyer = getUser(c.buyer_id || _currentUserId);
  if (buyer && buyer.escrow_locked_balance >= c.amount) {
    buyer.escrow_locked_balance -= c.amount;
    buyer.wallet_balance += c.amount;

    transactions.unshift({
      id: `tx_${Date.now()}`,
      user_id: buyer.id,
      type: 'refund',
      amount: c.amount,
      title: `استرداد وجه قرارداد لغو شده ${c.contract_id} به کیف پول`,
      status: 'completed',
      ref_id: `REF-${Math.floor(100000 + Math.random() * 900000)}`,
      contract_id: c.contract_id,
      created_at: now
    });
  }

  c.history.push({
    event: '❌ قرارداد لغو گردید و وجه به موجودی کیف پول کارفرما بازگردانده شد.',
    timestamp: now,
    actor: 'سیستم اسکرو'
  });

  return { success: true, contract: c };
}

// ====================================================
// ۵. توابع کیف پول و تراکنش‌ها (Wallet & Transactions)
// ====================================================

export function getTransactions(userId?: number): WalletTransaction[] {
  if (userId) {
    return transactions.filter(t => t.user_id === Number(userId));
  }
  return transactions;
}

export async function depositWallet(
  userId: number, 
  amount: number, 
  method: string = 'gateway'
): Promise<{ success: boolean; message: string; newBalance: number; transaction: WalletTransaction }> {
  const user = getUser(userId) || getCurrentUser();
  const numAmount = Number(amount);
  user.wallet_balance += numAmount;

  const tx: WalletTransaction = {
    id: `tx_${Date.now()}`,
    user_id: user.id,
    type: 'deposit',
    amount: numAmount,
    title: method === 'card_to_card' ? 'واریز کارت به کارت (فیش تایید شده)' : 'شارژ کیف پول از طریق درگاه پرداخت اینترنتی شاپرک',
    status: 'completed',
    ref_id: `DEP-${Math.floor(100000 + Math.random() * 900000)}`,
    created_at: new Date().toISOString()
  };
  transactions.unshift(tx);

  if (isSupabaseConfigured() && supabase) {
    try {
      await supabase.table('users').update({ wallet_balance: user.wallet_balance }).eq('id', user.id);
      await supabase.table('transactions').insert(tx);
    } catch (e: any) {
      console.warn('Supabase deposit sync warning:', e.message);
    }
  }

  return {
    success: true,
    message: `مبلغ ${formatCurrency(numAmount)} با موفقیت به کیف پول شما اضافه شد.`,
    newBalance: user.wallet_balance,
    transaction: tx
  };
}

export async function withdrawWallet(
  userId: number, 
  amount: number, 
  sheba: string
): Promise<{ success: boolean; message: string; newBalance?: number; transaction?: WalletTransaction }> {
  const user = getUser(userId) || getCurrentUser();
  const numAmount = Number(amount);

  if (!numAmount || numAmount <= 0) {
    return { success: false, message: 'مبلغ برداشت نامعتبر است.' };
  }
  if (numAmount > user.wallet_balance) {
    return { success: false, message: `موجودی شما (${formatCurrency(user.wallet_balance)}) کمتر از مبلغ درخواستی است.` };
  }

  const targetSheba = sheba || user.sheba;
  if (!targetSheba || !isValidIranianSheba(targetSheba)) {
    return { success: false, message: 'شماره شبای وارد شده نامعتبر است (فرمت IR + ۲۴ رقم).' };
  }

  user.wallet_balance -= numAmount;

  const tx: WalletTransaction = {
    id: `tx_${Date.now()}`,
    user_id: user.id,
    type: 'withdraw',
    amount: numAmount,
    title: `درخواست برداشت وجه به شماره شبا ${targetSheba.slice(-8)}`,
    status: 'completed',
    ref_id: `WTH-${Math.floor(100000 + Math.random() * 900000)}`,
    sheba: targetSheba,
    created_at: new Date().toISOString()
  };
  transactions.unshift(tx);

  if (isSupabaseConfigured() && supabase) {
    try {
      await supabase.table('users').update({ wallet_balance: user.wallet_balance }).eq('id', user.id);
      await supabase.table('transactions').insert(tx);
    } catch (e: any) {
      console.warn('Supabase withdraw sync warning:', e.message);
    }
  }

  return {
    success: true,
    message: `درخواست تسویه ${formatCurrency(numAmount)} به شماره شبای شما ثبت شد و در سیکل پایا واریز خواهد شد.`,
    newBalance: user.wallet_balance,
    transaction: tx
  };
}

// ====================================================
// ۶. مرکز حل اختلاف و داوری حقوقی (Disputes)
// ====================================================

export function getDisputes(): DisputeCase[] {
  return disputes;
}

export function getDispute(id: string): DisputeCase | undefined {
  return disputes.find(d => d.id === id || d.contract_id === id);
}

export async function createDispute(data: {
  contract_id: string;
  reason: string;
  description: string;
  claimant_id: number;
  evidence_files?: string[];
}): Promise<DisputeCase | undefined> {
  const c = getContract(data.contract_id);
  if (!c) return undefined;

  const claimant = getUser(data.claimant_id) || getCurrentUser();
  const now = new Date().toISOString();

  const newDispute: DisputeCase = {
    id: `disp_${Date.now()}`,
    contract_id: c.contract_id,
    contract_title: c.title,
    claimant_id: claimant.id,
    claimant_name: `${claimant.full_name} (${claimant.role === 'employer' ? 'کارفرما' : 'مجری'})`,
    reason: data.reason || 'اختلاف در اجرای تعهدات',
    description: data.description || '',
    evidence_files: data.evidence_files || ['مستندات ثبت معامله'],
    status: 'under_review',
    messages: [
      {
        id: `msg_${Date.now()}`,
        sender_id: claimant.id,
        sender_name: claimant.full_name,
        sender_role: claimant.role === 'employer' ? 'buyer' : 'seller',
        text: data.description || data.reason || 'درخواست رسیدگی به پرونده توسط داوری میانجی ثبت گردید.',
        timestamp: now
      }
    ],
    created_at: now
  };

  c.status = 'in_dispute';
  c.dispute_id = newDispute.id;
  c.history.push({
    event: `⚖️ پرونده داوری حقوقی با شناسه ${newDispute.id} ثبت گردید و جهت رسیدگی به داور میانجی ارجاع شد.`,
    timestamp: now,
    actor: 'داوری'
  });

  disputes.unshift(newDispute);

  if (isSupabaseConfigured() && supabase) {
    try {
      await supabase.table('disputes').insert(newDispute);
      await supabase.table('contracts').update({ status: 'in_dispute', dispute_id: newDispute.id, history: c.history }).eq('contract_id', c.contract_id);
    } catch (e: any) {
      console.warn('Supabase dispute insert warning:', e.message);
    }
  }

  return newDispute;
}

export async function addDisputeMessage(
  disputeId: string, 
  message: { sender_id: number; sender_name: string; sender_role: 'buyer' | 'seller' | 'arbitrator'; text: string; attachment?: string }
): Promise<DisputeMessage | undefined> {
  const d = getDispute(disputeId);
  if (!d) return undefined;

  const newMsg: DisputeMessage = {
    id: `msg_${Date.now()}`,
    sender_id: message.sender_id,
    sender_name: message.sender_name,
    sender_role: message.sender_role,
    text: message.text,
    attachment: message.attachment,
    timestamp: new Date().toISOString()
  };

  d.messages.push(newMsg);

  if (isSupabaseConfigured() && supabase) {
    try {
      await supabase.table('disputes').update({ messages: d.messages }).eq('id', d.id);
    } catch (e: any) {
      console.warn('Supabase dispute message warning:', e.message);
    }
  }

  return newMsg;
}

export async function resolveDispute(
  disputeId: string, 
  ruling: { decision: 'pay_seller' | 'refund_buyer' | 'split_50_50'; comment: string; arbitrator_name?: string }
): Promise<DisputeCase | undefined> {
  const d = getDispute(disputeId);
  if (!d) return undefined;

  const now = new Date().toISOString();
  const c = getContract(d.contract_id);

  d.status = 'resolved';
  d.ruling = {
    decision: ruling.decision,
    arbitrator_name: ruling.arbitrator_name || 'دکتر محمدرضا کریمی (داور حقوقی میانجی)',
    comment: ruling.comment,
    resolved_at: now
  };

  if (c) {
    c.status = ruling.decision === 'pay_seller' ? 'completed' : (ruling.decision === 'refund_buyer' ? 'cancelled' : 'completed');
    c.history.push({
      event: `⚖️ رأی قطعی داوری صادر شد: "${ruling.decision}". نظر داور: ${ruling.comment}`,
      timestamp: now,
      actor: 'داوری حقوقی'
    });
  }

  return d;
}

// ====================================================
// ۷. سیستم سفیران و زیرمجموعه‌گیری (Affiliate)
// ====================================================

export function getAffiliateStats(userId?: number): AffiliateStats {
  const user = getUser(userId || _currentUserId) || getCurrentUser();
  return {
    referral_code: user.referral_code || 'REF-MIYANJI',
    referral_link: `https://t.me/MiyanjiBot?start=${user.referral_code || 'REF-MIYANJI'}`,
    total_clicks: 184,
    total_invited: 24,
    active_traders: 11,
    total_commission_earned: 1850000,
    withdrawable_commission: 650000,
    commission_rate_percent: 10,
    referral_history: [
      { user_name: 'محمد رضایی', signed_up_at: '۱۴۰۳/۰۷/۱۰', contracts_count: 3, earned_amount: 450000 },
      { user_name: 'سارا کاظمی', signed_up_at: '۱۴۰۳/۰۷/۱۴', contracts_count: 2, earned_amount: 320000 },
      { user_name: 'پویا امانی', signed_up_at: '۱۴۰۳/۰۷/۱۸', contracts_count: 1, earned_amount: 650000 },
      { user_name: 'امید علیزاده', signed_up_at: '۱۴۰۳/۰۷/۲۴', contracts_count: 4, earned_amount: 430000 }
    ]
  };
}

export async function withdrawAffiliateEarnings(userId?: number): Promise<{ success: boolean; message: string; claimedAmount: number; newWalletBalance: number }> {
  const user = getUser(userId || _currentUserId) || getCurrentUser();
  const claimAmount = 650000;
  user.wallet_balance += claimAmount;

  transactions.unshift({
    id: `tx_${Date.now()}`,
    user_id: user.id,
    type: 'affiliate_reward',
    amount: claimAmount,
    title: 'انتقال درآمد حاصل از زیرمجموعه‌گیری سفیران به کیف پول اصلی',
    status: 'completed',
    ref_id: `AFF-TRF-${Math.floor(100000 + Math.random() * 900000)}`,
    created_at: new Date().toISOString()
  });

  return {
    success: true,
    message: `مبلغ ${formatCurrency(claimAmount)} از سود سفیران به موجودی کیف پول اصلی شما منتقل گردید.`,
    claimedAmount: claimAmount,
    newWalletBalance: user.wallet_balance
  };
}

// ====================================================
// ۸. آمار کلی سامانه (Dashboard Stats)
// ====================================================

export function getDashboardStats(): DashboardStats {
  const activeContracts = contracts.filter(c => c.status === 'active' || c.status === 'work_submitted' || c.status === 'in_progress').length;
  const pendingContracts = contracts.filter(c => c.status === 'pending_party_b' || c.status === 'awaiting_payment' || c.status === 'awaiting_receipt_approval').length;
  const draftsCount = contracts.filter(c => c.status === 'draft').length;
  const completedContracts = contracts.filter(c => c.status === 'completed').length;
  const disputesCount = contracts.filter(c => c.status === 'in_dispute').length;
  const totalEscrowVolume = contracts
    .filter(c => c.status !== 'cancelled' && c.status !== 'draft')
    .reduce((sum, c) => sum + (c.amount || 0), 0);

  return {
    activeContracts,
    pendingContracts,
    draftsCount,
    completedContracts,
    disputesCount,
    totalEscrowVolume,
    commissionRate: 10
  };
}
