"""
سامانه واسطه‌گری امن میانجی (Miyanji Escrow)
ماژول توابع کمکی، اعتبارسنجی‌ها و ابزارهای عمومی (utils.py)
"""

import re
import random
import string
import logging
from datetime import datetime, timezone
from typing import Optional, Union, Tuple, Dict, Any, Callable
from functools import wraps

logger = logging.getLogger("Miyanji_Utils")

# ====================================================
# ۱. تبدیل و نرمال‌سازی ارقام فارسی، عربی و انگلیسی
# ====================================================

PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹"
ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩"
ENGLISH_DIGITS = "0123456789"

FA_TO_EN_MAP = str.maketrans(PERSIAN_DIGITS + ARABIC_DIGITS, ENGLISH_DIGITS * 2)
EN_TO_FA_MAP = str.maketrans(ENGLISH_DIGITS, PERSIAN_DIGITS)

def fa_to_en_digits(text: Optional[str]) -> str:
    """تبدیل تمام اعداد فارسی و عربی موجود در متن به ارقام انگلیسی استاندارد."""
    if not text:
        return ""
    return str(text).translate(FA_TO_EN_MAP)

def en_to_fa_digits(text: Optional[Union[str, int, float]]) -> str:
    """تبدیل اعداد انگلیسی به فارسی جهت نمایش رسمی و زیباتر در پیام‌های تلگرام."""
    if text is None:
        return ""
    return str(text).translate(EN_TO_FA_MAP)

# ====================================================
# ۲. فرمت‌دهی و پارس هوشمند مبالغ مالی (تومان)
# ====================================================

def format_toman(amount: Union[int, float, str, None], include_currency: bool = True) -> str:
    """
    فرمت‌دهی سه‌رقم‌سه‌رقم مبالغ مالی با پسوند تومان.
    نمونه: 1250000 -> 1,250,000 تومان
    """
    if amount is None or amount == "":
        return "۰ تومان" if include_currency else "۰"
    try:
        clean_num = int(float(fa_to_en_digits(str(amount)).replace(",", "").replace("،", "").strip()))
        formatted = f"{clean_num:,}"
        formatted_fa = en_to_fa_digits(formatted)
        return f"{formatted_fa} تومان" if include_currency else formatted_fa
    except (ValueError, TypeError):
        return f"{amount} تومان" if include_currency else str(amount)

def parse_flexible_amount(text: Optional[str]) -> Optional[int]:
    """
    پارس هوشمند مبالغ عامیانه، نوشتاری یا عددی وارد شده توسط کاربر.
    پشتیبانی از:
    - ۲.۵ میلیون یا ۲.۵ م -> 2500000
    - ۵۰۰ هزار یا 500k -> 500000
    - ۱ میلیارد -> 1000000000
    - ارقام با جداکننده کاما یا ویرگول فارسی (۲,۵۰۰,۰۰۰)
    """
    if not text:
        return None
    raw = fa_to_en_digits(str(text)).strip().lower()

    # حذف کاراکترهای زائد
    raw = raw.replace("تومان", "").replace("تومن", "").replace("ریال", "").strip()

    multiplier = 1
    if "میلیارد" in raw or " b" in raw:
        multiplier = 1_000_000_000
        raw = re.sub(r"میلیارد|b", "", raw)
    elif "میلیون" in raw or " m" in raw or raw.endswith("m"):
        multiplier = 1_000_000
        raw = re.sub(r"میلیون|m", "", raw)
    elif "هزار" in raw or " k" in raw or raw.endswith("k"):
        multiplier = 1_000
        raw = re.sub(r"هزار|k", "", raw)

    # استخراج بخش عددی (اعشاری یا صحیح)
    match = re.search(r"(\d+(?:[.,/]\d+)?)", raw.replace(",", "").replace("،", ""))
    if not match:
        return None

    try:
        val_str = match.group(1).replace("/", ".")
        val = float(val_str) * multiplier
        final_amount = int(round(val))
        return final_amount if final_amount > 0 else None
    except (ValueError, TypeError):
        return None

# ====================================================
# ۳. تولید شناسه‌ها و کدهای پیگیری یکتا
# ====================================================

def generate_tracking_code(prefix: str = "TRX") -> str:
    """تولید کد رهگیری یکتا و رسمی برای تراکنش‌ها (مثال: TRX-849201)"""
    rand_num = random.randint(100000, 999999)
    return f"{prefix}-{rand_num}"

def generate_contract_id(prefix: str = "MJ") -> str:
    """تولید شناسه قرارداد رسمی و کوتاه برای معاملات میانجی (مثال: MJ-49201)"""
    rand_num = random.randint(10000, 99999)
    return f"{prefix}-{rand_num}"

# ====================================================
# ۴. اعتبارسنجی کدملی، شماره شبا و شماره کارت بانکی
# ====================================================

def validate_national_id(code: Optional[str]) -> bool:
    """
    اعتبارسنجی دقیق الگوریتم ۱۰ رقمی کد ملی جمهوری اسلامی ایران.
    شامل بررسی چک‌رقم (Check Digit) و جلوگیری از کدهای فیک (مثل 1111111111).
    """
    if not code:
        return False
    clean = fa_to_en_digits(str(code)).strip()
    if not re.fullmatch(r"^\d{10}$", clean):
        return False
    # جلوگیری از کدهای ۱۰ رقمی تکراری نامعتبر
    if clean in [str(i) * 10 for i in range(10)]:
        return False

    check = int(clean[9])
    s = sum(int(clean[x]) * (10 - x) for x in range(9))
    r = s % 11
    return (r < 2 and check == r) or (r >= 2 and check == (11 - r))

def validate_sheba(sheba: Optional[str]) -> bool:
    """
    اعتبارسنجی استاندارد بین‌المللی IBAN برای شماره شبای بانکی ایران:
    - ساختار: IR + ۲۴ رقم (مجموع ۲۶ کاراکتر)
    - چک‌سام استاندارد MOD-97 (ISO 7064)
    """
    if not sheba:
        return False
    clean = fa_to_en_digits(str(sheba)).replace(" ", "").upper().strip()
    if not re.fullmatch(r"^IR\d{24}$", clean):
        return False

    # جابجایی ۴ کاراکتر اول به انتهای رشته و تبدیل کاراکترهای حرفی
    rearranged = clean[4:] + clean[:4]
    numeric_str = "".join(
        str(ord(ch) - ord("A") + 10) if ch.isalpha() else ch
        for ch in rearranged
    )
    try:
        return int(numeric_str) % 97 == 1
    except ValueError:
        return False

# پیشوندهای BIN بانک‌های معتبر کشور
IRAN_BANKS_BIN: Dict[str, Tuple[str, str]] = {
    "603799": ("بانک ملی ایران", "🏛"),
    "589210": ("بانک سپه", "⚓️"),
    "627353": ("بانک تجارت", "💎"),
    "628023": ("بانک مسکن", "🏠"),
    "603770": ("بانک کشاورزی", "🌾"),
    "627412": ("بانک اقتصاد نوین", "🪙"),
    "627488": ("بانک کارآفرین", "💼"),
    "621986": ("بانک سامان", "🟦"),
    "639346": ("بانک پاسارگاد", "🛡"),
    "502229": ("بانک پاسارگاد", "🛡"),
    "639607": ("بانک سرمایه", "💰"),
    "502908": ("بانک توسعه تعاون", "🤝"),
    "504172": ("بانک رسالت", "🌿"),
    "606373": ("بانک مهر ایران", "💚"),
    "589463": ("بانک رفاه کارگران", "🏥"),
    "627760": ("بانک پست بانک", "📮"),
    "627961": ("بانک صنعت و معدن", "🏭"),
    "636214": ("بانک آینده", "🔮"),
    "505785": ("بانک ایران زمین", "🇮🇷"),
    "505416": ("بانک گردشگری", "✈️"),
    "639599": ("بانک قوامین", "👮"),
    "610433": ("بانک ملت", "🔴")
}

def validate_card_number(card: Optional[str]) -> bool:
    """اعتبارسنجی ۱۶ رقم شماره کارت بانکی با الگوریتم Luhn (MOD-10)."""
    if not card:
        return False
    clean = fa_to_en_digits(str(card)).replace("-", "").replace(" ", "").strip()
    if not re.fullmatch(r"^\d{16}$", clean):
        return False

    total = 0
    for i, digit in enumerate(clean):
        n = int(digit)
        if i % 2 == 0:
            n *= 2
            if n > 9:
                n -= 9
        total += n
    return total % 10 == 0

def get_bank_info(card_number: Optional[str]) -> Tuple[str, str]:
    """دریافت نام و آیکون بانک صادرکننده کارت از روی ۶ رقم اول (BIN)."""
    if not card_number:
        return "بانک عضو شتاب", "💳"
    clean = fa_to_en_digits(str(card_number)).replace("-", "").replace(" ", "")[:6]
    return IRAN_BANKS_BIN.get(clean, ("بانک عضو شتاب", "💳"))

# ====================================================
# ۵. تاریخ شمسی و زمان‌بندی
# ====================================================

PERSIAN_MONTHS = [
    "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
    "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"
]

def to_persian_date(dt: Optional[datetime] = None) -> str:
    """
    تبدیل تاریخ میلادی به تاریخ شمسی به همراه ساعت و برچسب ماه.
    به صورت مستقل بدون نیاز به پکیج‌های خارجی سنگین کار می‌کند.
    """
    if dt is None:
        dt = datetime.now(timezone.utc)
    try:
        # اگر پکیج jdatetime نصب باشد استفاده می‌کند
        import jdatetime
        jdt = jdatetime.datetime.fromgregorian(datetime=dt)
        return jdt.strftime("%Y/%m/%d - %H:%M")
    except ImportError:
        # تقریب استاندارد بدون کرش کردن
        g_y = dt.year
        g_m = dt.month
        g_d = dt.day
        # تبدیل الگوریتمی تقویم میلادی به خورشیدی
        d_4 = g_y % 4
        g_a = [0, 0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]
        doy_g = g_a[g_m] + g_d
        if d_4 == 0 and g_m > 2:
            doy_g += 1
        d_33 = int(((g_y - 16) % 132) * 0.0305)
        a = 286 if (d_33 == 3 or d_33 == 4) else (287 if d_33 == 1 else 286)
        if doy_g > a:
            jy = g_y - 621
            jd = doy_g - a
        else:
            jy = g_y - 622
            jd = doy_g + (79 if (d_4 == 0) else 78)

        if jd <= 186:
            jm = 1 + int((jd - 1) / 31)
            jd = 1 + ((jd - 1) % 31)
        else:
            jm = 7 + int((jd - 187) / 30)
            jd = 1 + ((jd - 187) % 30)

        month_name = PERSIAN_MONTHS[jm - 1] if 1 <= jm <= 12 else ""
        return f"{jy}/{jm:02d}/{jd:02d} ({month_name}) {dt.strftime('%H:%M')}"

# ====================================================
# ۶. نگاشت و ترجمه وضعیت‌های قرارداد و تراکنش‌ها
# ====================================================

CONTRACT_STATUS_LABELS = {
    "draft": "📝 پیش‌نویس اولیه",
    "waiting_seller_signature": "⏳ در انتظار بررسی و امضای فروشنده",
    "waiting_buyer_signature": "⏳ در انتظار بررسی و امضای خریدار",
    "waiting_buyer_deposit": "💳 امضا شده - در انتظار واریز امن به اسکرو",
    "in_progress": "🟢 فعال - در حال انجام کار توسط مجری",
    "in_testing": "⏱️ تحویل شده - در مهلت تست و بررسی خریدار",
    "completed": "✅ تکمیل و تسویه نهایی شده",
    "in_dispute": "⚖️ دارای اختلاف - در حال بررسی داوری میانجی",
    "cancelled": "❌ لغو شده"
}

TRANSACTION_STATUS_LABELS = {
    "pending": "⏳ در انتظار تایید",
    "completed": "✅ موفق و تایید شده",
    "rejected": "❌ رد شده / ناموفق"
}

TRANSACTION_TYPE_LABELS = {
    "deposit": "➕ شارژ کیف پول",
    "withdraw": "➖ تسویه و برداشت وجه",
    "escrow_lock": "🔒 بلوکه در صندوق امن معامله",
    "escrow_release": "🔓 آزادسازی وجه معامله",
    "escrow_refund": "↩️ برگشت وجه به خریدار",
    "commission": "📊 کارمزد پلتفرم"
}

def get_contract_status_label(status: str) -> str:
    """دریافت عنوان فارسی و آیکون وضعیت قرارداد."""
    return CONTRACT_STATUS_LABELS.get(str(status), f"وضعیت: {status}")

def get_transaction_status_label(status: str) -> str:
    """دریافت عنوان فارسی وضعیت تراکنش مالی."""
    return TRANSACTION_STATUS_LABELS.get(str(status), f"وضعیت: {status}")

def get_transaction_type_label(tx_type: str) -> str:
    """دریافت عنوان فارسی نوع تراکنش."""
    return TRANSACTION_TYPE_LABELS.get(str(tx_type), str(tx_type))

# ====================================================
# ۷. دکوراتور مدیریت خطاهای امن (Safe Handler Decorator)
# ====================================================

def safe_handler(default_return: Any = None):
    """
    دکوراتور برای هندلرهای تلگرام یا توابع بیزینس؛
    در صورت بروز هرگونه خطای پیش‌بینی‌نشده، خطا را لاگ کرده و از کرش کردن جلوگیری می‌کند.
    """
    def decorator(func: Callable):
        @wraps(func)
        def wrapper(*args, **kwargs):
            try:
                return func(*args, **kwargs)
            except Exception as e:
                logger.error(f"🚨 خطای امن مهار شده در تابع {func.__name__}: {e}", exc_info=True)
                return default_return
        return wrapper
    return decorator

# سازگاری با کدهای قبلی پروژه
MS_STATUS_LABELS = {
    "locked": "🔒 در صف - هنوز شروع نشده",
    "awaiting_payment": "💳 در انتظار ارسال فیش واریزی",
    "paid": "🛠 پرداخت‌شده - در حال انجام کار",
    "delivered": "📦 تحویل داده‌شده - در مهلت بررسی",
    "completed": "✅ تکمیل و تسویه‌شده",
}
