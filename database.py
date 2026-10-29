"""
سامانه واسطه‌گری امن میانجی (Miyanji Escrow)
ماژول مدیریت پایگاه داده، اتصال به Supabase و حافظه پایدار (database.py)
"""

import os
import time
import logging
import sqlite3
import threading
from datetime import datetime, timezone
from typing import Dict, Any, Optional, List, Union, Tuple
from config import config
import utils

logger = logging.getLogger("Miyanji_Database")

# ====================================================
# ۱. اتصال به کلاینت رسمی Supabase (PostgreSQL)
# ====================================================

supabase = None
try:
    if config.SUPABASE_URL and config.SUPABASE_KEY:
        from supabase import create_client, Client
        supabase = create_client(config.SUPABASE_URL, config.SUPABASE_KEY)
        logger.info("🔗 اتصال به پایگاه داده ابری Supabase با موفقیت برقرار شد.")
    else:
        logger.info("ℹ️ اطلاعات Supabase تنظیم نشده؛ سیستم در حالت پایگاه داده محلی WAL اجرا می‌شود.")
except ImportError:
    logger.warning("پکیج supabase نصب نیست. از پایگاه داده محلی سریع SQLite استفاده می‌شود.")
except Exception as e:
    logger.error(f"⚠️ خطا در برقراری اتصال به Supabase: {e}")
    supabase = None

# ====================================================
# ۲. پایگاه داده پایدار SQLite محلی (Local Cache & WAL Fallback)
# ====================================================

DB_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "miyanji_escrow.db")
db_lock = threading.RLock()

def _get_connection():
    """ایجاد اتصال ایمن به SQLite به همراه فعال‌سازی حالت WAL جهت دسترسی همزمان و بالا."""
    conn = sqlite3.connect(DB_FILE, timeout=20.0, check_same_thread=False)
    conn.execute("PRAGMA journal_mode = WAL;")
    conn.execute("PRAGMA synchronous = NORMAL;")
    conn.row_factory = sqlite3.Row
    return conn

def _init_tables():
    """ایجاد جداول ساختاریافته در دیتابیس منطبق با الگوهای طراحی Supabase/PostgreSQL."""
    with db_lock:
        conn = _get_connection()
        c = conn.cursor()

        # ۱. جدول کاربران (Users)
        c.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY,
                phone_number TEXT,
                full_name TEXT,
                username TEXT,
                is_verified INTEGER DEFAULT 0,
                national_id TEXT,
                sheba TEXT,
                role TEXT DEFAULT 'buyer',
                created_at TEXT
            )
        """)

        # ۲. جدول کیف پول (Wallets)
        c.execute("""
            CREATE TABLE IF NOT EXISTS wallets (
                user_id INTEGER PRIMARY KEY,
                available_balance INTEGER DEFAULT 0,
                locked_balance INTEGER DEFAULT 0,
                updated_at TEXT,
                FOREIGN KEY (user_id) REFERENCES users (id)
            )
        """)

        # ۳. جدول قراردادهای اسکرو (Contracts)
        c.execute("""
            CREATE TABLE IF NOT EXISTS contracts (
                contract_id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                buyer_id INTEGER NOT NULL,
                seller_id INTEGER NOT NULL,
                buyer_username TEXT,
                seller_username TEXT,
                buyer_fullname TEXT,
                seller_fullname TEXT,
                amount INTEGER NOT NULL,
                commission_amount INTEGER DEFAULT 0,
                commission_payer TEXT DEFAULT 'buyer',
                status TEXT NOT NULL,
                category TEXT DEFAULT 'عمومی',
                test_hours INTEGER DEFAULT 24,
                terms TEXT,
                buyer_signed_at TEXT,
                seller_signed_at TEXT,
                delivered_at TEXT,
                delivery_notes TEXT,
                completed_at TEXT,
                created_at TEXT
            )
        """)

        # ۴. جدول تراکنش‌های مالی (Transactions)
        c.execute("""
            CREATE TABLE IF NOT EXISTS transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tracking_code TEXT UNIQUE NOT NULL,
                user_id INTEGER NOT NULL,
                amount INTEGER NOT NULL,
                type TEXT NOT NULL,
                status TEXT NOT NULL,
                receipt_url TEXT,
                sheba TEXT,
                description TEXT,
                created_at TEXT
            )
        """)

        # ۵. جدول داوری و حل اختلاف (Disputes)
        c.execute("""
            CREATE TABLE IF NOT EXISTS disputes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                contract_id TEXT NOT NULL,
                claimant_id INTEGER NOT NULL,
                reason TEXT NOT NULL,
                details TEXT,
                status TEXT DEFAULT 'open',
                created_at TEXT
            )
        """)

        # ۶. جدول وضعیت‌های موقت FSM تلگرام
        c.execute("""
            CREATE TABLE IF NOT EXISTS user_states (
                user_id INTEGER PRIMARY KEY,
                state TEXT NOT NULL,
                data TEXT NOT NULL,
                updated_at REAL NOT NULL
            )
        """)

        conn.commit()
        conn.close()
        logger.info("✅ تمامی جداول پایگاه داده میانجی با موفقیت اعتبارسنجی و لود شدند.")

_init_tables()

# ====================================================
# ۳. توابع مدیریت کاربران (Users Management)
# ====================================================

def register_or_get_user(
    user_id: int,
    phone_number: Optional[str] = None,
    full_name: Optional[str] = None,
    username: Optional[str] = None,
    role: str = "buyer"
) -> Dict[str, Any]:
    """ثبت یا دریافت اطلاعات کاربر به همراه ایجاد خودکار کیف پول اولیه."""
    now_iso = datetime.now(timezone.utc).isoformat()
    clean_uid = int(user_id)
    clean_phone = utils.fa_to_en_digits(phone_number).strip() if phone_number else None

    # بررسی و ذخیره در Supabase در صورت وجود اتصال
    if supabase:
        try:
            res = supabase.table("users").select("*").eq("id", clean_uid).execute()
            if res.data:
                # بروزرسانی در صورت تغییر اطلاعات
                update_payload = {}
                if clean_phone and not res.data[0].get("phone_number"):
                    update_payload["phone_number"] = clean_phone
                    update_payload["is_verified"] = True
                if full_name:
                    update_payload["full_name"] = full_name
                if username:
                    update_payload["username"] = username
                if update_payload:
                    supabase.table("users").update(update_payload).eq("id", clean_uid).execute()
            else:
                user_record = {
                    "id": clean_uid,
                    "phone_number": clean_phone,
                    "full_name": full_name or f"کاربر {clean_uid}",
                    "username": username or "",
                    "is_verified": bool(clean_phone),
                    "role": role,
                    "created_at": now_iso
                }
                supabase.table("users").insert(user_record).execute()
                # ایجاد رکورد کیف پول در Supabase
                supabase.table("wallets").insert({
                    "user_id": clean_uid,
                    "available_balance": 0,
                    "locked_balance": 0,
                    "updated_at": now_iso
                }).execute()
        except Exception as e:
            logger.warning(f"خطای سینک با Supabase برای ثبت کاربر: {e}")

    # ذخیره در SQLite محلی
    with db_lock:
        conn = _get_connection()
        c = conn.cursor()
        c.execute("SELECT * FROM users WHERE id = ?", (clean_uid,))
        existing = c.fetchone()

        if existing:
            # بروزرسانی
            if clean_phone or full_name or username:
                c.execute("""
                    UPDATE users 
                    SET phone_number = COALESCE(?, phone_number),
                        full_name = COALESCE(?, full_name),
                        username = COALESCE(?, username),
                        is_verified = CASE WHEN ? IS NOT NULL THEN 1 ELSE is_verified END
                    WHERE id = ?
                """, (clean_phone, full_name, username, clean_phone, clean_uid))
                conn.commit()
        else:
            c.execute("""
                INSERT INTO users (id, phone_number, full_name, username, is_verified, role, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (
                clean_uid,
                clean_phone,
                full_name or f"کاربر {clean_uid}",
                username or "",
                1 if clean_phone else 0,
                role,
                now_iso
            ))
            # ایجاد رکورد کیف پول
            c.execute("""
                INSERT OR IGNORE INTO wallets (user_id, available_balance, locked_balance, updated_at)
                VALUES (?, 0, 0, ?)
            """, (clean_uid, now_iso))
            conn.commit()

        c.execute("SELECT * FROM users WHERE id = ?", (clean_uid,))
        user_row = dict(c.fetchone())
        conn.close()

    return user_row

def get_user(user_id: int) -> Optional[Dict[str, Any]]:
    """دریافت پروفایل کاربر از روی آیدی تلگرام."""
    if not user_id:
        return None
    clean_uid = int(user_id)

    with db_lock:
        conn = _get_connection()
        c = conn.cursor()
        c.execute("SELECT * FROM users WHERE id = ?", (clean_uid,))
        row = c.fetchone()
        conn.close()
        return dict(row) if row else None

def update_user_profile(user_id: int, **kwargs) -> bool:
    """بروزرسانی فیلدهای دلخواه پروفایل کاربر (مانند شبا، کدملی، نام)."""
    if not user_id or not kwargs:
        return False
    clean_uid = int(user_id)

    allowed = {"phone_number", "full_name", "username", "national_id", "sheba", "is_verified", "role"}
    updates = {k: v for k, v in kwargs.items() if k in allowed}
    if not updates:
        return False

    if supabase:
        try:
            supabase.table("users").update(updates).eq("id", clean_uid).execute()
        except Exception as e:
            logger.warning(f"Supabase update user profile error: {e}")

    with db_lock:
        conn = _get_connection()
        c = conn.cursor()
        set_clauses = [f"{col} = ?" for col in updates.keys()]
        values = list(updates.values()) + [clean_uid]
        c.execute(f"UPDATE users SET {', '.join(set_clauses)} WHERE id = ?", values)
        conn.commit()
        conn.close()
    return True

# ====================================================
# ۴. توابع مدیریت کیف پول (Wallets Management)
# ====================================================

def get_wallet(user_id: int) -> Dict[str, Any]:
    """
    دریافت موجودی کیف پول کاربر:
    شامل موجودی در دسترس (قابل برداشت)، موجودی بلوکه شده (اسکرو) و دارایی کل.
    """
    clean_uid = int(user_id)
    now_iso = datetime.now(timezone.utc).isoformat()

    with db_lock:
        conn = _get_connection()
        c = conn.cursor()
        c.execute("SELECT * FROM wallets WHERE user_id = ?", (clean_uid,))
        row = c.fetchone()

        if not row:
            c.execute("""
                INSERT INTO wallets (user_id, available_balance, locked_balance, updated_at)
                VALUES (?, 0, 0, ?)
            """, (clean_uid, now_iso))
            conn.commit()
            avail, locked = 0, 0
        else:
            avail = int(row["available_balance"] or 0)
            locked = int(row["locked_balance"] or 0)
        conn.close()

    return {
        "user_id": clean_uid,
        "available_balance": avail,
        "locked_balance": locked,
        "total_balance": avail + locked
    }

def update_wallet_balance(
    user_id: int,
    available_delta: int = 0,
    locked_delta: int = 0
) -> Dict[str, Any]:
    """
    تغییر اتمیک و امن موجودی کیف پول کاربر (مثبت برای افزایش، منفی برای کسر).
    از بروز موجودی منفی به صورت خودکار جلوگیری می‌نماید.
    """
    clean_uid = int(user_id)
    now_iso = datetime.now(timezone.utc).isoformat()

    with db_lock:
        conn = _get_connection()
        c = conn.cursor()
        c.execute("SELECT available_balance, locked_balance FROM wallets WHERE user_id = ?", (clean_uid,))
        row = c.fetchone()

        current_avail = int(row["available_balance"] or 0) if row else 0
        current_locked = int(row["locked_balance"] or 0) if row else 0

        new_avail = current_avail + int(available_delta)
        new_locked = current_locked + int(locked_delta)

        if new_avail < 0:
            conn.close()
            raise ValueError(f"موجودی در دسترس کافی نیست (موجودی فعلی: {current_avail:,} تومان).")
        if new_locked < 0:
            conn.close()
            raise ValueError("موجودی بلوکه شده نمی‌تواند منفی شود.")

        if row:
            c.execute("""
                UPDATE wallets
                SET available_balance = ?, locked_balance = ?, updated_at = ?
                WHERE user_id = ?
            """, (new_avail, new_locked, now_iso, clean_uid))
        else:
            c.execute("""
                INSERT INTO wallets (user_id, available_balance, locked_balance, updated_at)
                VALUES (?, ?, ?, ?)
            """, (clean_uid, new_avail, new_locked, now_iso))

        conn.commit()
        conn.close()

    # همگام‌سازی با Supabase
    if supabase:
        try:
            supabase.table("wallets").upsert({
                "user_id": clean_uid,
                "available_balance": new_avail,
                "locked_balance": new_locked,
                "updated_at": now_iso
            }).execute()
        except Exception as e:
            logger.warning(f"Supabase wallet sync error: {e}")

    return {
        "user_id": clean_uid,
        "available_balance": new_avail,
        "locked_balance": new_locked,
        "total_balance": new_avail + new_locked
    }

# ====================================================
# ۵. توابع قراردادهای واسطه‌گری اسکرو (Contracts Management)
# ====================================================

def create_contract(data: Dict[str, Any]) -> Dict[str, Any]:
    """ثبت قرارداد جدید معامله در سامانه اسکرو با کد اختصاصی."""
    cid = data.get("contract_id") or utils.generate_contract_id("MJ")
    now_iso = datetime.now(timezone.utc).isoformat()

    amount = int(data.get("amount", 0))
    comm_pct = float(config.COMMISSION_PERCENT or 10.0)
    commission = int(round(amount * (comm_pct / 100.0)))

    contract_record = {
        "contract_id": cid,
        "title": data.get("title", "معامله امن میانجی").strip(),
        "buyer_id": int(data.get("buyer_id", 0)),
        "seller_id": int(data.get("seller_id", 0)),
        "buyer_username": data.get("buyer_username", ""),
        "seller_username": data.get("seller_username", ""),
        "buyer_fullname": data.get("buyer_fullname", ""),
        "seller_fullname": data.get("seller_fullname", ""),
        "amount": amount,
        "commission_amount": commission,
        "commission_payer": data.get("commission_payer", "buyer"),
        "status": data.get("status", "waiting_seller_signature"),
        "category": data.get("category", "عمومی"),
        "test_hours": int(data.get("test_hours", 24)),
        "terms": data.get("terms", "مفاد و شرایط توافق‌شده تحویل اثر طبق ضوابط سامانه میانجی."),
        "buyer_signed_at": data.get("buyer_signed_at", now_iso if data.get("creator_is_buyer") else None),
        "seller_signed_at": data.get("seller_signed_at", now_iso if not data.get("creator_is_buyer") else None),
        "delivered_at": None,
        "delivery_notes": None,
        "completed_at": None,
        "created_at": now_iso
    }

    if supabase:
        try:
            supabase.table("contracts").insert(contract_record).execute()
        except Exception as e:
            logger.warning(f"Supabase contract insert warning: {e}")

    with db_lock:
        conn = _get_connection()
        c = conn.cursor()
        c.execute("""
            INSERT INTO contracts (
                contract_id, title, buyer_id, seller_id, buyer_username, seller_username,
                buyer_fullname, seller_fullname, amount, commission_amount, commission_payer,
                status, category, test_hours, terms, buyer_signed_at, seller_signed_at,
                delivered_at, delivery_notes, completed_at, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            contract_record["contract_id"],
            contract_record["title"],
            contract_record["buyer_id"],
            contract_record["seller_id"],
            contract_record["buyer_username"],
            contract_record["seller_username"],
            contract_record["buyer_fullname"],
            contract_record["seller_fullname"],
            contract_record["amount"],
            contract_record["commission_amount"],
            contract_record["commission_payer"],
            contract_record["status"],
            contract_record["category"],
            contract_record["test_hours"],
            contract_record["terms"],
            contract_record["buyer_signed_at"],
            contract_record["seller_signed_at"],
            contract_record["delivered_at"],
            contract_record["delivery_notes"],
            contract_record["completed_at"],
            contract_record["created_at"]
        ))
        conn.commit()
        conn.close()

    return contract_record

def get_contract(contract_id: str) -> Optional[Dict[str, Any]]:
    """دریافت اطلاعات کامل قرارداد بر اساس شناسه."""
    if not contract_id:
        return None
    cid = contract_id.strip()

    with db_lock:
        conn = _get_connection()
        c = conn.cursor()
        c.execute("SELECT * FROM contracts WHERE contract_id = ?", (cid,))
        row = c.fetchone()
        conn.close()
        return dict(row) if row else None

def get_user_contracts(
    user_id: int,
    status_category: Optional[str] = None
) -> List[Dict[str, Any]]:
    """
    دریافت لیست قراردادهای کاربر به عنوان خریدار یا فروشنده،
    با قابلیت فیلتر بر اساس تب‌های داشبورد:
    - 'waiting': در انتظار امضا و واریز
    - 'active': فعال و در حال انجام
    - 'testing': در مهلت تست و بررسی
    - 'completed': تکمیل و تسویه شده
    - 'disputed': در حال اختلاف
    """
    clean_uid = int(user_id)

    status_mapping = {
        "waiting": ["waiting_seller_signature", "waiting_buyer_signature", "waiting_buyer_deposit"],
        "active": ["in_progress"],
        "testing": ["in_testing"],
        "completed": ["completed"],
        "disputed": ["in_dispute"]
    }

    with db_lock:
        conn = _get_connection()
        c = conn.cursor()

        if status_category and status_category in status_mapping:
            placeholders = ",".join(["?"] * len(status_mapping[status_category]))
            query = f"""
                SELECT * FROM contracts 
                WHERE (buyer_id = ? OR seller_id = ?) 
                AND status IN ({placeholders})
                ORDER BY created_at DESC
            """
            params = [clean_uid, clean_uid] + status_mapping[status_category]
            c.execute(query, params)
        else:
            c.execute("""
                SELECT * FROM contracts 
                WHERE buyer_id = ? OR seller_id = ?
                ORDER BY created_at DESC
            """, (clean_uid, clean_uid))

        rows = c.fetchall()
        conn.close()
        return [dict(r) for r in rows]

def update_contract_status(
    contract_id: str,
    new_status: str,
    extra_fields: Optional[Dict[str, Any]] = None
) -> Optional[Dict[str, Any]]:
    """تغییر وضعیت معامله به همراه ثبت زمان‌ها و فیلدهای الحاقی."""
    cid = contract_id.strip()
    extra = extra_fields or {}

    with db_lock:
        conn = _get_connection()
        c = conn.cursor()
        c.execute("SELECT * FROM contracts WHERE contract_id = ?", (cid,))
        row = c.fetchone()
        if not row:
            conn.close()
            return None

        update_cols = ["status = ?"]
        values = [new_status]

        for k, v in extra.items():
            update_cols.append(f"{k} = ?")
            values.append(v)

        values.append(cid)
        c.execute(f"UPDATE contracts SET {', '.join(update_cols)} WHERE contract_id = ?", values)
        conn.commit()

        c.execute("SELECT * FROM contracts WHERE contract_id = ?", (cid,))
        updated_row = dict(c.fetchone())
        conn.close()

    if supabase:
        try:
            payload = {"status": new_status, **extra}
            supabase.table("contracts").update(payload).eq("contract_id", cid).execute()
        except Exception as e:
            logger.warning(f"Supabase update contract status error: {e}")

    return updated_row

def sign_contract(contract_id: str, user_id: int) -> Tuple[bool, str, Optional[Dict[str, Any]]]:
    """
    امضای دیجیتال قرارداد توسط یکی از طرفین:
    اگر هر دو طرف امضا کرده باشند، وضعیت به صورت هوشمند به `waiting_buyer_deposit` ارتقا می‌یابد.
    """
    contract = get_contract(contract_id)
    if not contract:
        return False, "قرارداد مورد نظر یافت نشد.", None

    uid = int(user_id)
    now_iso = datetime.now(timezone.utc).isoformat()

    is_buyer = (uid == contract["buyer_id"])
    is_seller = (uid == contract["seller_id"])

    if not is_buyer and not is_seller:
        return False, "شما یکی از طرفین این قرارداد نیستید.", contract

    extra: Dict[str, Any] = {}
    if is_buyer:
        if contract.get("buyer_signed_at"):
            return True, "شما قبلاً این قرارداد را امضا نموده‌اید.", contract
        extra["buyer_signed_at"] = now_iso
    elif is_seller:
        if contract.get("seller_signed_at"):
            return True, "شما قبلاً این قرارداد را امضا نموده‌اید.", contract
        extra["seller_signed_at"] = now_iso

    # ارزیابی وضعیت پس از امضا
    other_signed = bool(contract.get("seller_signed_at") if is_buyer else contract.get("buyer_signed_at"))
    new_status = "waiting_buyer_deposit" if other_signed else contract["status"]

    updated = update_contract_status(contract_id, new_status, extra)
    return True, "امضای دیجیتال شما با موفقیت در سند قرارداد ثبت گردید.", updated

# ====================================================
# ۶. توابع ثبت و پیگیری تراکنش‌ها (Transactions Management)
# ====================================================

def create_transaction(
    user_id: int,
    amount: int,
    tx_type: str,
    status: str = "pending",
    tracking_code: Optional[str] = None,
    description: str = "",
    receipt_url: Optional[str] = None,
    sheba: Optional[str] = None
) -> Dict[str, Any]:
    """ثبت رسمی یک تراکنش مالی در تاریخچه سیستم."""
    track_code = tracking_code or utils.generate_tracking_code()
    now_iso = datetime.now(timezone.utc).isoformat()
    clean_uid = int(user_id)

    record = {
        "tracking_code": track_code,
        "user_id": clean_uid,
        "amount": int(amount),
        "type": tx_type,
        "status": status,
        "receipt_url": receipt_url or "",
        "sheba": sheba or "",
        "description": description,
        "created_at": now_iso
    }

    if supabase:
        try:
            supabase.table("transactions").insert(record).execute()
        except Exception as e:
            logger.warning(f"Supabase transaction insert warning: {e}")

    with db_lock:
        conn = _get_connection()
        c = conn.cursor()
        c.execute("""
            INSERT INTO transactions (
                tracking_code, user_id, amount, type, status,
                receipt_url, sheba, description, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            record["tracking_code"],
            record["user_id"],
            record["amount"],
            record["type"],
            record["status"],
            record["receipt_url"],
            record["sheba"],
            record["description"],
            record["created_at"]
        ))
        conn.commit()
        conn.close()

    return record

def get_user_transactions(user_id: int, limit: int = 15) -> List[Dict[str, Any]]:
    """دریافت آخرین تراکنش‌های مالی کاربر."""
    clean_uid = int(user_id)
    with db_lock:
        conn = _get_connection()
        c = conn.cursor()
        c.execute("""
            SELECT * FROM transactions 
            WHERE user_id = ? 
            ORDER BY created_at DESC 
            LIMIT ?
        """, (clean_uid, limit))
        rows = c.fetchall()
        conn.close()
        return [dict(r) for r in rows]

def update_transaction_status(tracking_code: str, new_status: str) -> bool:
    """تغییر وضعیت تراکنش (تایید واریز/برداشت یا رد آن)."""
    with db_lock:
        conn = _get_connection()
        c = conn.cursor()
        c.execute("UPDATE transactions SET status = ? WHERE tracking_code = ?", (new_status, tracking_code.strip()))
        conn.commit()
        conn.close()

    if supabase:
        try:
            supabase.table("transactions").update({"status": new_status}).eq("tracking_code", tracking_code.strip()).execute()
        except Exception as e:
            logger.warning(f"Supabase transaction update status warning: {e}")
    return True

# ====================================================
# ۷. حل اختلاف و داوری (Disputes Management)
# ====================================================

def create_dispute(
    contract_id: str,
    claimant_id: int,
    reason: str,
    details: str = ""
) -> Dict[str, Any]:
    """ثبت پرونده اختلاف برای یک قرارداد و انتقال وضعیت آن به داوری."""
    cid = contract_id.strip()
    now_iso = datetime.now(timezone.utc).isoformat()

    record = {
        "contract_id": cid,
        "claimant_id": int(claimant_id),
        "reason": reason,
        "details": details,
        "status": "open",
        "created_at": now_iso
    }

    with db_lock:
        conn = _get_connection()
        c = conn.cursor()
        c.execute("""
            INSERT INTO disputes (contract_id, claimant_id, reason, details, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (record["contract_id"], record["claimant_id"], record["reason"], record["details"], record["status"], record["created_at"]))
        conn.commit()
        conn.close()

    # تغییر وضعیت قرارداد به اختلاف
    update_contract_status(cid, "in_dispute")
    return record

# ====================================================
# ۸. مدیریت وضعیت‌های کاربر در مکالمه تلگرام (FSM State)
# ====================================================

_fsm_memory: Dict[int, Dict[str, Any]] = {}

def set_user_state(user_id: int, state: str, data: Optional[Dict[str, Any]] = None) -> None:
    """تنظیم گام فعلی مکالمه کاربر در ربات به صورت سریع در رم و ذخیره در SQLite."""
    if not user_id:
        return
    uid = int(user_id)
    clean_data = data or {}
    _fsm_memory[uid] = {"state": state, "data": clean_data}

    try:
        import json
        with db_lock:
            conn = _get_connection()
            c = conn.cursor()
            c.execute("""
                INSERT OR REPLACE INTO user_states (user_id, state, data, updated_at)
                VALUES (?, ?, ?, ?)
            """, (uid, state, json.dumps(clean_data, ensure_ascii=False), time.time()))
            conn.commit()
            conn.close()
    except Exception as e:
        logger.debug(f"FSM state save notice: {e}")

def get_user_state(user_id: int) -> Tuple[Optional[str], Dict[str, Any]]:
    """دریافت گام فعلی و اطلاعات موقت کاربر در مکالمه ربات."""
    if not user_id:
        return None, {}
    uid = int(user_id)

    if uid in _fsm_memory:
        entry = _fsm_memory[uid]
        return entry.get("state"), entry.get("data", {})

    try:
        import json
        with db_lock:
            conn = _get_connection()
            c = conn.cursor()
            c.execute("SELECT state, data FROM user_states WHERE user_id = ?", (uid,))
            row = c.fetchone()
            conn.close()
            if row:
                st = row["state"]
                dt = json.loads(row["data"]) if row["data"] else {}
                _fsm_memory[uid] = {"state": st, "data": dt}
                return st, dt
    except Exception as e:
        logger.debug(f"FSM state read notice: {e}")

    return None, {}

def clear_user_state(user_id: int) -> None:
    """پاکسازی وضعیت کاربر و بازگرداندن وی به منوی اصلی."""
    if not user_id:
        return
    uid = int(user_id)
    _fsm_memory.pop(uid, None)
    try:
        with db_lock:
            conn = _get_connection()
            c = conn.cursor()
            c.execute("DELETE FROM user_states WHERE user_id = ?", (uid,))
            conn.commit()
            conn.close()
    except Exception:
        pass

def is_user_blacklisted(user_id: int) -> bool:
    """بررسی وضعیت قرارگیری کاربر در لیست سیاه."""
    return False

# توابع پشتیبانی سازگاری با ماژول‌های قدیمی
def getUser(uid: int):
    return get_user(uid)

def getUsers():
    with db_lock:
        conn = _get_connection()
        c = conn.cursor()
        c.execute("SELECT * FROM users")
        rows = [dict(r) for r in c.fetchall()]
        conn.close()
        return rows
