"""
سامانه واسطه‌گری امن میانجی (Miyanji Escrow)
ماژول هوش مصنوعی Gemini API جهت استخراج خودکار مفاد قرارداد (ai_parser.py)
"""

import os
import re
import json
import logging
import urllib.request
import urllib.error
from typing import Dict, Any, Optional
import utils

logger = logging.getLogger("Miyanji_AI_Parser")

# مدل رسمی پیشنهادی طبق مشخصات Gemini API
GEMINI_MODEL = "gemini-3.8-flash"

SYSTEM_PROMPT = """
شما هوش مصنوعی حقوقی و دستیار هوشمند سامانه واسطه‌گری امن «میانجی (Miyanji Escrow)» هستید.
وظیفه شما تبدیل توضیحات متنی یا صوتی عامیانه، غیررسمی یا چت میان خریدار و فروشنده، به یک ساختار استاندارد قرارداد تجاری است.

شما باید خروجی را دقیقاً و الزاماً در قالب یک شیء JSON خالص (بدون هیچ توضیح، متن اضافی یا تگ‌های مارک‌داون بیرون از جیسون) برگردانید:
{
  "title": "عنوان کوتاه، رسمی و گویای معامله (به فارسی)",
  "buyer": "آیدی تلگرام یا نام خریدار/کارفرما (مثال: @username یا نام شخص)",
  "seller": "آیدی تلگرام یا نام فروشنده/مجری (مثال: @username یا نام شخص)",
  "amount": 1000000,
  "test_hours": 24,
  "category": "یکی از دسته‌های: برنامه‌نویسی و IT | طراحی و گرافیک | خرید و فروش اکانت و گیم | تولید محتوا و سئو | عمومی",
  "terms": "شرح دقیق و خلاصه تعهدات، اقلام تحویلی، شروط تست و کیفیت نهایی معامله به فارسی روان"
}

قوانین حیاتی استخراج اطلاعات:
۱. مبلغ (amount): باید فقط به صورت یک عدد صحیح به واحد «تومان» محاسبه شود (مثال: "دو و نیم میلیون" -> 2500000، "پانصد هزار تومن" -> 500000). اگر واحد ذکر نشده بود، پیش‌فرض تومان است.
۲. مهلت تست (test_hours): مدت زمان فرصت خریدار برای بازبینی پس از تحویل به ساعت (اگر در متن نبود، پیش‌فرض 24 ساعت قرار دهید).
۳. طرفین: شناسه‌های تلگرام با @ یا عباراتی مثل "من به عنوان خریدار" و "مجری: فلانی" را شناسایی کنید.
۴. مفاد (terms): موارد فنی، نحوه تحویل و کیفیت مورد انتظار را در ۲ تا ۳ بند منسجم بنویسید.
"""

def extract_contract_with_gemini(user_prompt: str) -> Optional[Dict[str, Any]]:
    """
    ارسال درخواست به Gemini API جهت استخراج ساختاریافته شرایط قرارداد از متن کاربر.
    """
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        logger.info("ℹ️ کلید GEMINI_API_KEY تنظیم نشده؛ از پارسر هوشمند قواعدی داخلی استفاده می‌شود.")
        return None

    endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent?key={api_key}"

    payload = {
        "contents": [
            {
                "role": "user",
                "parts": [
                    {"text": f"متن توافق طرفین برای استخراج قرارداد اسکرو میانجی:\n\n{user_prompt}"}
                ]
            }
        ],
        "systemInstruction": {
            "parts": [{"text": SYSTEM_PROMPT}]
        },
        "generationConfig": {
            "temperature": 0.2,
            "responseMimeType": "application/json"
        }
    }

    try:
        data_bytes = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            endpoint,
            data=data_bytes,
            headers={
                "Content-Type": "application/json",
                "User-Agent": "aistudio-build"
            },
            method="POST"
        )

        with urllib.request.urlopen(req, timeout=8) as resp:
            resp_body = resp.read().decode("utf-8")
            result = json.loads(resp_body)

            candidates = result.get("candidates", [])
            if candidates:
                parts = candidates[0].get("content", {}).get("parts", [])
                if parts and "text" in parts[0]:
                    raw_text = parts[0]["text"].strip()
                    # تمیزسازی احتمالی کدبلاک
                    if raw_text.startswith("```"):
                        raw_text = re.sub(r"^```(?:json)?\s*", "", raw_text)
                        raw_text = re.sub(r"\s*```$", "", raw_text)
                    parsed_json = json.loads(raw_text)
                    logger.info("✨ استخراج قرارداد توسط Gemini با موفقیت انجام شد.")
                    return parsed_json

    except urllib.error.HTTPError as he:
        logger.warning(f"Gemini API HTTP Error {he.code}: {he.read().decode('utf-8', errors='ignore')}")
    except Exception as e:
        logger.warning(f"Gemini API invocation error: {e}")

    return None

def fallback_rule_parser(text: str) -> Dict[str, Any]:
    """
    پارسر هوشمند داخلی بر پایه پردازش زبان طبیعی فارسی و عبارات باقاعده (Regex).
    تضمین می‌کند حتی در صورت نبود اینترنت یا کلید API، ربات بدون وقفه اطلاعات معامله را درک کند.
    """
    clean_text = utils.fa_to_en_digits(text or "")

    # ۱. استخراج مبلغ به تومان
    amount = utils.parse_flexible_amount(clean_text) or 500_000

    # ۲. استخراج مهلت تست (ساعت)
    test_hours = 24
    hours_match = re.search(r"(\d+)\s*(?:ساعت|ساعته|h)\s*(?:مهلت\s*تست|تست|فرصت)?", clean_text, re.IGNORECASE)
    if hours_match:
        try:
            h = int(hours_match.group(1))
            if 1 <= h <= 168:
                test_hours = h
        except ValueError:
            pass

    # ۳. استخراج آیدی‌های تلگرام
    usernames = re.findall(r"@([a-zA-Z0-9_]{4,32})", text or "")
    buyer = f"@{usernames[0]}" if len(usernames) > 0 else "کارفرما"
    seller = f"@{usernames[1]}" if len(usernames) > 1 else "مجری"

    # ۴. تشخیص دسته‌بندی موضوعی معامله
    category = "عمومی"
    lower_text = text.lower()
    if any(k in lower_text for k in ["سایت", "بات", "ربات", "وب", "کد", "برنامه", "اسکریپت", "پایتون", "فرانت"]):
        category = "برنامه‌نویسی و IT"
    elif any(k in lower_text for k in ["طراحی", "لوگو", "بنر", "پوستر", "فتوشاپ", "گرافیک", "یوایکس", "ui"]):
        category = "طراحی و گرافیک"
    elif any(k in lower_text for k in ["اکانت", "کلش", "پابجی", "استیم", "کانال", "پیج", "فالوور", "چنل"]):
        category = "خرید و فروش اکانت و گیم"
    elif any(k in lower_text for k in ["سئو", "مقاله", "محتوا", "تولید محتوا", "ترجمه"]):
        category = "تولید محتوا و سئو"

    # ۵. انتخاب عنوان مناسب
    first_line = text.strip().split("\n")[0][:45]
    title = f"معامله {category}" if len(first_line) < 5 else first_line

    # ۶. تنظیم مفاد و تعهدات
    terms = (
        f"طرفین توافق نمودند موضوع قرارداد با مشخصات اعلامی انجام گردد. "
        f"مبلغ در صندوق امن میانجی قفل شده و پس از مهلت تست {test_hours} ساعته "
        f"و تایید نهایی خریدار آزاد خواهد شد."
    )

    return {
        "title": title,
        "buyer": buyer,
        "seller": seller,
        "amount": amount,
        "test_hours": test_hours,
        "category": category,
        "terms": terms,
        "source": "fallback_rules"
    }

def parse_deal_prompt(prompt_text: str) -> Dict[str, Any]:
    """
    تابع اصلی تحلیل ورودی عامیانه کاربر:
    ابتدا با مدل Gemini API تلاش می‌کند، در صورت عدم دسترسی از الگوریتم داخلی استفاده می‌نماید.
    """
    if not prompt_text or len(prompt_text.strip()) < 4:
        return {
            "title": "معامله جدید میانجی",
            "buyer": "کارفرما",
            "seller": "مجری",
            "amount": 500000,
            "test_hours": 24,
            "category": "عمومی",
            "terms": "انجام موضوع معامله طبق توافق طرفین تحت نظارت و داوری میانجی."
        }

    # ۱. تلاش با Gemini
    gemini_result = extract_contract_with_gemini(prompt_text)
    if gemini_result and isinstance(gemini_result, dict):
        # اعتبارسنجی فیلدهای حداقلی
        gemini_result["amount"] = int(gemini_result.get("amount") or 500000)
        gemini_result["test_hours"] = int(gemini_result.get("test_hours") or 24)
        gemini_result["title"] = str(gemini_result.get("title") or "معامله امن میانجی")[:60]
        gemini_result["category"] = str(gemini_result.get("category") or "عمومی")
        gemini_result["terms"] = str(gemini_result.get("terms") or "توافق‌نامه اسکرو میانجی")
        gemini_result["source"] = "gemini_ai"
        return gemini_result

    # ۲. فال‌بک به الگوریتم قدرتمند محلی
    return fallback_rule_parser(prompt_text)
