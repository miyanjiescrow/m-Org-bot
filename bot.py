"""
سامانه واسطه‌گری امن میانجی (Miyanji Escrow)
هسته اصلی ربات تلگرام بر پایه معماری modern و asynchronous (bot.py)
"""

import os
import sys
import logging
import asyncio
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List

from config import config
import database as db
import wallet as wl
import ai_parser as ai
import utils

logger = logging.getLogger("Miyanji_Bot")

# ====================================================
# کیبوردهای استاندارد سیستم (Keyboards & Layouts)
# ====================================================

def get_main_menu_keyboard(is_verified: bool = True):
    """منوی اصلی ربات مطابق درخواست کاربر."""
    from telegram import ReplyKeyboardMarkup, KeyboardButton
    
    if not is_verified:
        keyboard = [
            [KeyboardButton(text="📱 ارسال شماره موبایل و تایید هویت", request_contact=True)],
            [KeyboardButton(text="🛡 قوانین و مقررات واسطه‌گری میانجی")]
        ]
    else:
        keyboard = [
            [KeyboardButton(text="🤝 ایجاد معامله جدید"), KeyboardButton(text="📦 معاملات من")],
            [KeyboardButton(text="💰 کیف پول و موجودی"), KeyboardButton(text="🛡 قوانین")]
        ]
    return ReplyKeyboardMarkup(keyboard, resize_keyboard=True, is_persistent=True)

def get_deal_dashboard_keyboard():
    """کیبورد دسته‌بندی تب‌های داشبورد معاملات من."""
    from telegram import InlineKeyboardMarkup, InlineKeyboardButton
    return InlineKeyboardMarkup([
        [
            InlineKeyboardButton("🟡 در انتظار امضا و واریز", callback_data="tab_deals_waiting"),
            InlineKeyboardButton("🟢 فعال و در حال انجام", callback_data="tab_deals_active")
        ],
        [
            InlineKeyboardButton("⏱️ در مهلت تست", callback_data="tab_deals_testing"),
            InlineKeyboardButton("✅ تکمیل شده", callback_data="tab_deals_completed")
        ],
        [
            InlineKeyboardButton("🔙 بازگشت به منوی اصلی", callback_data="back_to_main")
        ]
    ])

def get_wallet_keyboard():
    """کیبورد بخش کیف پول و امور مالی."""
    from telegram import InlineKeyboardMarkup, InlineKeyboardButton
    return InlineKeyboardMarkup([
        [
            InlineKeyboardButton("➕ شارژ کیف پول (کارت به کارت)", callback_data="wallet_deposit"),
            InlineKeyboardButton("💸 درخواست تسویه و برداشت (شبا)", callback_data="wallet_withdraw")
        ],
        [
            InlineKeyboardButton("📋 تاریخچه تراکنش‌ها", callback_data="wallet_history"),
            InlineKeyboardButton("🔄 بروزرسانی موجودی", callback_data="wallet_refresh")
        ],
        [
            InlineKeyboardButton("🔙 بازگشت به منوی اصلی", callback_data="back_to_main")
        ]
    ])

# ====================================================
# ۱. دستور /start و احراز هویت با شماره تماس
# ====================================================

async def start_command(update, context):
    """پاسخ به دستور /start و بررسی دیپ‌لینک‌های قرارداد."""
    user = update.effective_user
    chat_id = update.effective_chat.id
    user_id = user.id

    # بررسی دیپ‌لینک (مثال: /start deal_MJ-10492)
    args = context.args if context and hasattr(context, "args") else []
    deep_link = args[0] if args else None

    # ثبت اولیه کاربر در دیتابیس
    db_user = db.register_or_get_user(
        user_id=user_id,
        username=user.username or "",
        full_name=user.full_name or f"کاربر {user_id}"
    )

    is_verified = bool(db_user.get("is_verified"))

    # اگر کاربر از طریق لینک معامله وارد شده باشد
    if deep_link and deep_link.startswith("deal_"):
        contract_id = deep_link.replace("deal_", "").strip()
        await show_contract_card(update, context, contract_id)
        return

    welcome_text = (
        f"🌟 **سلام {user.first_name} عزیز، به سامانه رسمی واسطه‌گری امن «میانجی (Miyanji Escrow)» خوش آمدید.**\n\n"
        "🛡 پلتفرم میانجی ضامن ۱۰۰٪ امنیت مالی معاملات، پرداخت امن فریلنسری و خرید و فروش آنلاین است.\n"
        "وجه معامله تا تایید نهایی خریدار در صندوق امانت قفل می‌ماند و حق هیچ‌یک از طرفین تضییع نخواهد شد.\n\n"
    )

    if not is_verified:
        welcome_text += (
            "⚠️ **مرحله تایید هویت سریع:**\n"
            "جهت دسترسی به ساخت معامله و صدور سند رسمی، لطفاً روی دکمه زیر کلیک کنید تا شماره تماس شما ثبت شود:"
        )
    else:
        welcome_text += "👇 جهت ادامه، یکی از گزینه‌های منوی زیر را انتخاب نمایید:"

    await update.message.reply_text(
        welcome_text,
        reply_markup=get_main_menu_keyboard(is_verified),
        parse_mode="Markdown"
    )

async def contact_handler(update, context):
    """هندلر دریافت اطلاعات تماس کاربر و تایید احراز هویت."""
    contact = update.message.contact
    user_id = update.effective_user.id

    if contact and contact.phone_number:
        clean_phone = utils.fa_to_en_digits(contact.phone_number).strip()
        if not clean_phone.startswith("0") and not clean_phone.startswith("+"):
            clean_phone = f"0{clean_phone}"

        db.register_or_get_user(
            user_id=user_id,
            phone_number=clean_phone,
            full_name=update.effective_user.full_name
        )

        success_text = (
            "✅ **احراز هویت شماره همراه شما با موفقیت انجام شد.**\n\n"
            f"📱 شماره ثبت شده: `{clean_phone}`\n"
            "کیف پول امن اختصاصی شما ایجاد گردید و هم‌اکنون می‌توانید معاملات رسمی خود را ثبت کنید."
        )

        await update.message.reply_text(
            success_text,
            reply_markup=get_main_menu_keyboard(is_verified=True),
            parse_mode="Markdown"
        )
    else:
        await update.message.reply_text(
            "❌ دریافت شماره همراه ناموفق بود. لطفاً مجدداً تلاش نمایید.",
            reply_markup=get_main_menu_keyboard(is_verified=False)
        )

# ====================================================
# ۲. جریان ساخت معامله با هوش مصنوعی Gemini یا دستی
# ====================================================

async def initiate_new_deal(update, context):
    """شروع فرایند ایجاد معامله جدید."""
    from telegram import InlineKeyboardMarkup, InlineKeyboardButton
    user_id = update.effective_user.id
    user = db.get_user(user_id)

    if not user or not user.get("is_verified"):
        await update.message.reply_text(
            "⚠️ برای ایجاد معامله جدید، ابتدا باید شماره موبایل خود را تایید نمایید.",
            reply_markup=get_main_menu_keyboard(is_verified=False)
        )
        return

    text = (
        "🤝 **ایجاد معامله امن جدید در صندوق میانجی**\n\n"
        "شما می‌توانید شرایط معامله خود را به دو روش ثبت نمایید:\n\n"
        "۱. 🤖 **استخراج هوشمند با هوش مصنوعی (Gemini API):**\n"
        "کافیست متن عامیانه توافق یا چت خود با طرف مقابل را بفرستید تا ربات به صورت خودکار مبالغ، تعهدات و مهلت تست را استخراج کند.\n\n"
        "۲. ✍️ **ثبت گام‌به‌گام (دستی):**\n"
        "مشخصات معامله را مرحله به مرحله وارد نمایید."
    )

    kb = InlineKeyboardMarkup([
        [InlineKeyboardButton("🤖 نوشتن متن عامیانه برای هوش مصنوعی", callback_data="deal_create_ai")],
        [InlineKeyboardButton("✍️ ثبت گام‌به‌گام معامله", callback_data="deal_create_manual")],
        [InlineKeyboardButton("🔙 انصراف و بازگشت", callback_data="back_to_main")]
    ])

    await update.message.reply_text(text, reply_markup=kb, parse_mode="Markdown")

async def deal_creation_text_handler(update, context, state: str, state_data: dict):
    """پردازش متون ارسالی کاربر در مراحل مختلف ساخت معامله."""
    user_id = update.effective_user.id
    text = update.message.text.strip()

    # ۱. دریافت ورودی برای هوش مصنوعی
    if state == "WAITING_AI_DEAL_TEXT":
        wait_msg = await update.message.reply_text("⏳ در حال تحلیل هوشمند متن معامله توسط Gemini API...")

        parsed = ai.parse_deal_prompt(text)
        db.set_user_state(user_id, "CONFIRM_AI_DEAL", parsed)

        comm_pct = float(config.COMMISSION_PERCENT or 10.0)
        amount = parsed.get("amount", 0)
        commission = int(round(amount * (comm_pct / 100.0)))

        summary_text = (
            "📋 **پیش‌نویس استخراج‌شده قرارداد میانجی:**\n"
            "──────────────────\n"
            f"📌 **موضوع:** {parsed.get('title')}\n"
            f"🏷 **دسته‌بندی:** {parsed.get('category')}\n"
            f"💵 **مبلغ معامله:** {utils.format_toman(amount)}\n"
            f"📊 **کارمزد سامانه ({comm_pct}%):** {utils.format_toman(commission)}\n"
            f"⏱️ **مهلت تست و بررسی:** {parsed.get('test_hours')} ساعت\n"
            f"👤 **خریدار:** {parsed.get('buyer')}\n"
            f"🛠 **فروشنده:** {parsed.get('seller')}\n\n"
            f"📜 **تعهدات و شروط:**\n{parsed.get('terms')}\n"
            "──────────────────\n"
            "آیا اطلاعات فوق مورد تایید شماست؟"
        )

        from telegram import InlineKeyboardMarkup, InlineKeyboardButton
        kb = InlineKeyboardMarkup([
            [InlineKeyboardButton("✅ تایید و صدور قرارداد رسمی", callback_data="confirm_ai_deal_yes")],
            [InlineKeyboardButton("🔄 ارسال مجدد متن", callback_data="deal_create_ai")],
            [InlineKeyboardButton("🔙 انصراف", callback_data="back_to_main")]
        ])

        try:
            await wait_msg.delete()
        except Exception:
            pass

        await update.message.reply_text(summary_text, reply_markup=kb, parse_mode="Markdown")
        return

    # ۲. مراحل ساخت دستی
    if state == "MANUAL_TITLE":
        state_data["title"] = text[:70]
        db.set_user_state(user_id, "MANUAL_AMOUNT", state_data)
        await update.message.reply_text(
            "💵 لطفاً **مبلغ معامله** را به تومان وارد کنید (مثال: `2500000` یا `۲.۵ میلیون`):",
            parse_mode="Markdown"
        )
        return

    if state == "MANUAL_AMOUNT":
        parsed_amount = utils.parse_flexible_amount(text)
        if not parsed_amount or parsed_amount < 10000:
            await update.message.reply_text("❌ مبلغ وارد شده نامعتبر است. حداقل مبلغ معامله ۱۰,۰۰۰ تومان می‌باشد.")
            return

        state_data["amount"] = parsed_amount
        db.set_user_state(user_id, "MANUAL_TEST_HOURS", state_data)
        await update.message.reply_text(
            f"مبلغ: {utils.format_toman(parsed_amount)}\n\n"
            "⏱️ لطفاً **مهلت تست و بررسی** پس از تحویل را به ساعت وارد کنید (مثال: `24` یا `48`):",
            parse_mode="Markdown"
        )
        return

    if state == "MANUAL_TEST_HOURS":
        hours = 24
        try:
            h = int(utils.fa_to_en_digits(text))
            if 1 <= h <= 360:
                hours = h
        except ValueError:
            pass

        state_data["test_hours"] = hours
        db.set_user_state(user_id, "MANUAL_COUNTERPART", state_data)
        await update.message.reply_text(
            "👤 لطفاً **آیدی تلگرام یا شماره طرف مقابل** را وارد نمایید (مثال: `@username`):",
            parse_mode="Markdown"
        )
        return

    if state == "MANUAL_COUNTERPART":
        state_data["counterpart"] = text.strip()
        state_data["terms"] = "انجام موضوع معامله طبق توافقات مکتوب طرفین و پوشش کامل داوری میانجی."
        
        # ذخیره و ساخت قرارداد
        cid = utils.generate_contract_id("MJ")
        c_record = db.create_contract({
            "contract_id": cid,
            "title": state_data.get("title", "معامله امن میانجی"),
            "buyer_id": user_id,
            "seller_id": 0,
            "seller_username": state_data.get("counterpart", ""),
            "amount": state_data.get("amount", 0),
            "test_hours": state_data.get("test_hours", 24),
            "terms": state_data.get("terms", ""),
            "creator_is_buyer": True,
            "status": "waiting_seller_signature"
        })

        db.clear_user_state(user_id)
        await show_contract_created_success(update, context, c_record)
        return

async def show_contract_created_success(update, context, contract: dict):
    """نمایش پیام موفقیت ثبت قرارداد و تولید لینک دعوت اختصاصی."""
    from telegram import InlineKeyboardMarkup, InlineKeyboardButton
    cid = contract["contract_id"]
    bot_user = getattr(config, "BOT_USERNAME", "mianji_ir_bot")
    invite_link = f"https://t.me/{bot_user}?start=deal_{cid}"

    text = (
        "🎉 **قرارداد با موفقیت در سامانه میانجی صادر گردید.**\n\n"
        f"🆔 **شناسه رسمی معامله:** `{cid}`\n"
        f"📌 **موضوع:** {contract.get('title')}\n"
        f"💰 **مبلغ معامله:** {utils.format_toman(contract.get('amount'))}\n"
        f"⏱️ **مهلت تست:** {contract.get('test_hours')} ساعت\n"
        f"📊 **وضعیت:** {utils.get_contract_status_label(contract.get('status'))}\n\n"
        "🔗 **لینک دعوت جهت بررسی و امضای طرف مقابل:**\n"
        f"`{invite_link}`\n\n"
        "💡 *لینک فوق را برای طرف مقابل ارسال کنید تا با ورود به ربات، معامله را بررسی و تایید نماید.*"
    )

    kb = InlineKeyboardMarkup([
        [InlineKeyboardButton("📜 مشاهده جزئیات قرارداد", callback_data=f"view_deal_{cid}")],
        [InlineKeyboardButton("📦 بازگشت به داشبورد معاملات", callback_data="tab_deals_waiting")]
    ])

    if update.callback_query:
        await update.callback_query.edit_message_text(text, reply_markup=kb, parse_mode="Markdown")
    else:
        await update.message.reply_text(text, reply_markup=kb, parse_mode="Markdown")

# ====================================================
# ۳. نمایش کارت کامل قرارداد و دکمه‌های تعاملی
# ====================================================

async def show_contract_card(update, context, contract_id: str):
    """نمایش کارت کامل قرارداد با دکمه‌های متناسب با نقش کاربر و وضعیت فعلی."""
    from telegram import InlineKeyboardMarkup, InlineKeyboardButton

    contract = db.get_contract(contract_id)
    if not contract:
        msg = "❌ قرارداد مورد نظر یافت نشد یا منقضی گردیده است."
        if update.callback_query:
            await update.callback_query.message.reply_text(msg)
        else:
            await update.message.reply_text(msg)
        return

    user_id = update.effective_user.id
    cid = contract["contract_id"]
    status = contract["status"]
    amount = int(contract["amount"])
    commission = int(contract.get("commission_amount", 0))

    is_buyer = (user_id == int(contract["buyer_id"]))
    is_seller = (user_id == int(contract["seller_id"]))

    # اگر کاربر فروشنده نامشخص است و شخص دیگری وارد شده، به عنوان فروشنده اختصاص داده می‌شود
    if not is_buyer and not is_seller and int(contract["seller_id"]) == 0:
        db.update_contract_status(cid, status, {
            "seller_id": user_id,
            "seller_username": update.effective_user.username or "",
            "seller_fullname": update.effective_user.full_name
        })
        contract = db.get_contract(cid)
        is_seller = True

    buyer_signed = bool(contract.get("buyer_signed_at"))
    seller_signed = bool(contract.get("seller_signed_at"))

    text = (
        f"📜 **شناسه سند قرارداد: `{cid}`**\n"
        "──────────────────\n"
        f"📌 **موضوع:** {contract.get('title')}\n"
        f"💵 **مبلغ پایه:** {utils.format_toman(amount)}\n"
        f"📊 **کارمزد اسکرو:** {utils.format_toman(commission)}\n"
        f"⏱️ **مهلت تست:** {contract.get('test_hours')} ساعت\n"
        f"⚖️ **وضعیت:** {utils.get_contract_status_label(status)}\n\n"
        "👥 **طرفین قرارداد:**\n"
        f"• کارفرما (خریدار): {contract.get('buyer_fullname') or contract.get('buyer_id')} "
        f"({'✅ امضا شده' if buyer_signed else '⏳ در انتظار امضا'})\n"
        f"• مجری (فروشنده): {contract.get('seller_fullname') or contract.get('seller_id') or 'در انتظار اتصال'} "
        f"({'✅ امضا شده' if seller_signed else '⏳ در انتظار امضا'})\n\n"
        f"📝 **تعهدات حقوقی:**\n{contract.get('terms')}\n"
        "──────────────────\n"
    )

    buttons = []

    # دکمه‌های متناسب با وضعیت و نقش
    if status in ["waiting_seller_signature", "waiting_buyer_signature"]:
        if (is_buyer and not buyer_signed) or (is_seller and not seller_signed):
            buttons.append([InlineKeyboardButton("✍️ امضای الکترونیک قرارداد", callback_data=f"sign_deal_{cid}")])
            buttons.append([InlineKeyboardButton("❌ رد و انصراف از معامله", callback_data=f"reject_deal_{cid}")])

    elif status == "waiting_buyer_deposit":
        if is_buyer:
            buttons.append([InlineKeyboardButton("💳 پرداخت و واریز به صندوق امن اسکرو", callback_data=f"pay_escrow_{cid}")])
        else:
            text += "\n⏳ *در انتظار واریز امن وجه توسط خریدار به صندوق میانجی...*"

    elif status == "in_progress":
        if is_seller:
            buttons.append([InlineKeyboardButton("📦 اعلام تحویل و شروع مهلت تست", callback_data=f"deliver_deal_{cid}")])
        buttons.append([InlineKeyboardButton("⚖️ اعلام اختلاف و ورود داور", callback_data=f"dispute_deal_{cid}")])

    elif status == "in_testing":
        if is_buyer:
            buttons.append([InlineKeyboardButton("✅ آزادسازی وجه و پایان معامله", callback_data=f"release_deal_{cid}")])
        buttons.append([InlineKeyboardButton("⚖️ اعلام اختلاف و ورود داور", callback_data=f"dispute_deal_{cid}")])

    buttons.append([InlineKeyboardButton("🔙 بازگشت به لیست معاملات", callback_data="tab_deals_waiting")])

    kb = InlineKeyboardMarkup(buttons)

    if update.callback_query:
        await update.callback_query.edit_message_text(text, reply_markup=kb, parse_mode="Markdown")
    else:
        await update.message.reply_text(text, reply_markup=kb, parse_mode="Markdown")

# ====================================================
# ۴. داشبورد معاملات من (My Deals Dashboard)
# ====================================================

async def show_my_deals_dashboard(update, context, tab: str = "waiting"):
    """نمایش لیست معاملات تفکیک‌شده بر اساس تب‌های درخواستی."""
    from telegram import InlineKeyboardMarkup, InlineKeyboardButton
    user_id = update.effective_user.id
    deals = db.get_user_contracts(user_id, status_category=tab)

    tab_titles = {
        "waiting": "🟡 معاملات در انتظار امضا و واریز",
        "active": "🟢 معاملات فعال و در حال انجام",
        "testing": "⏱️ معاملات در مهلت تست خریدار",
        "completed": "✅ معاملات تکمیل و تسویه شده"
    }

    current_title = tab_titles.get(tab, "معاملات من")
    text = f"📦 **{current_title}**\n\nتعداد کل: {len(deals)} معامله\n──────────────────\n"

    buttons = []
    if deals:
        for d in deals[:6]:
            cid = d["contract_id"]
            title = d["title"][:28]
            amt = utils.format_toman(d["amount"])
            buttons.append([InlineKeyboardButton(f"📄 {cid} | {title} ({amt})", callback_data=f"view_deal_{cid}")])
    else:
        text += "موردی در این دسته‌بندی یافت نشد.\n"

    # دکمه‌های جابجایی بین تب‌ها
    nav_row = []
    if tab != "waiting":
        nav_row.append(InlineKeyboardButton("🟡 انتظار", callback_data="tab_deals_waiting"))
    if tab != "active":
        nav_row.append(InlineKeyboardButton("🟢 فعال", callback_data="tab_deals_active"))
    if tab != "testing":
        nav_row.append(InlineKeyboardButton("⏱️ تست", callback_data="tab_deals_testing"))
    if tab != "completed":
        nav_row.append(InlineKeyboardButton("✅ تکمیل", callback_data="tab_deals_completed"))

    if nav_row:
        buttons.append(nav_row)
    buttons.append([InlineKeyboardButton("🔙 بازگشت به منوی اصلی", callback_data="back_to_main")])

    kb = InlineKeyboardMarkup(buttons)

    if update.callback_query:
        await update.callback_query.edit_message_text(text, reply_markup=kb, parse_mode="Markdown")
    else:
        await update.message.reply_text(text, reply_markup=kb, parse_mode="Markdown")

# ====================================================
# ۵. بخش کیف پول و گردش مالی (Wallet Flow)
# ====================================================

async def show_wallet_view(update, context):
    """نمایش مشخصات کیف پول، موجودی‌ها و وضعیت شبا."""
    user_id = update.effective_user.id
    summary = wl.get_wallet_summary(user_id)

    text = (
        "💰 **کیف پول و دارایی‌های شما در میانجی**\n"
        "──────────────────\n"
        f"💵 **موجودی قابل برداشت:** {summary['available_formatted']}\n"
        f"🔒 **موجودی بلوکه در اسکرو:** {summary['locked_formatted']}\n"
        f"💳 **کل دارایی:** {summary['total_formatted']}\n\n"
        f"🏦 **شماره شبای ثبت‌شده:** `{summary['sheba']}`\n"
        f"🪪 **وضعیت احراز هویت:** {'✅ تایید شده' if summary['is_verified'] else '⚠️ تایید نشده'}\n"
        "──────────────────\n"
        "💡 کلیه برداشت‌ها از طریق پایا و در سیکل‌های قانونی بانک مرکزی تسویه می‌شوند."
    )

    kb = get_wallet_keyboard()

    if update.callback_query:
        await update.callback_query.edit_message_text(text, reply_markup=kb, parse_mode="Markdown")
    else:
        await update.message.reply_text(text, reply_markup=kb, parse_mode="Markdown")

async def wallet_text_handler(update, context, state: str, state_data: dict):
    """پردازش ارقام ورودی برای شارژ یا برداشت کیف پول."""
    user_id = update.effective_user.id
    text = update.message.text.strip()

    # ۱. دریافت مبلغ شارژ حساب
    if state == "WALLET_DEPOSIT_AMOUNT":
        amount = utils.parse_flexible_amount(text)
        if not amount or amount < wl.MIN_DEPOSIT_AMOUNT:
            await update.message.reply_text(
                f"❌ مبلغ نامعتبر است. حداقل مبلغ شارژ {utils.format_toman(wl.MIN_DEPOSIT_AMOUNT)} است."
            )
            return

        ok, msg, dep_info = wl.request_deposit(user_id, amount)
        if not ok:
            await update.message.reply_text(f"❌ {msg}")
            return

        db.set_user_state(user_id, "WALLET_DEPOSIT_RECEIPT", {
            "tracking_code": dep_info["tracking_code"],
            "amount": amount
        })

        dep_text = (
            f"🏦 **شارژ کیف پول (کارت به کارت)**\n"
            "──────────────────\n"
            f"💵 **مبلغ قابل واریز:** {dep_info['amount_formatted']}\n\n"
            f"💳 **شماره کارت واسط میانجی:**\n`{dep_info['destination_card']}`\n"
            f"👤 **بنام:** {dep_info['card_holder']}\n"
            f"{dep_info['bank_icon']} **بانک:** {dep_info['bank_name']}\n"
            f"🔢 **شناسه پیگیری:** `{dep_info['tracking_code']}`\n\n"
            "⚠️ **مرحله بعد:**\n"
            "پس از انتقال وجه در همراه بانک خود، شماره پیگیری بانکی یا متن فیش واریزی را ارسال فرمایید:"
        )

        from telegram import InlineKeyboardMarkup, InlineKeyboardButton
        kb = InlineKeyboardMarkup([
            [InlineKeyboardButton("🔙 انصراف و بازگشت", callback_data="back_to_main")]
        ])

        await update.message.reply_text(dep_text, reply_markup=kb, parse_mode="Markdown")
        return

    # ۲. دریافت شماره پیگیری فیش واریزی
    if state == "WALLET_DEPOSIT_RECEIPT":
        tracking_code = state_data.get("tracking_code")
        ok, res_msg = wl.submit_deposit_receipt(user_id, tracking_code, receipt_info=text, auto_approve=True)
        db.clear_user_state(user_id)
        await update.message.reply_text(res_msg, reply_markup=get_main_menu_keyboard(is_verified=True))
        return

    # ۳. دریافت مبلغ برداشت از کیف پول
    if state == "WALLET_WITHDRAW_AMOUNT":
        amount = utils.parse_flexible_amount(text)
        if not amount or amount < wl.MIN_WITHDRAW_AMOUNT:
            await update.message.reply_text(
                f"❌ حداقل مبلغ برداشت {utils.format_toman(wl.MIN_WITHDRAW_AMOUNT)} می‌باشد."
            )
            return

        wallet_info = db.get_wallet(user_id)
        if wallet_info["available_balance"] < amount:
            await update.message.reply_text(
                f"❌ موجودی در دسترس شما ({utils.format_toman(wallet_info['available_balance'])}) کمتر از این مبلغ است."
            )
            return

        user = db.get_user(user_id) or {}
        saved_sheba = user.get("sheba")

        if saved_sheba and utils.validate_sheba(saved_sheba):
            # اگر شبا از قبل ثبت شده است، مستقیماً تسویه را ثبت می‌کنیم
            ok, msg, wth_info = wl.request_withdrawal(user_id, amount, saved_sheba)
            db.clear_user_state(user_id)
            if ok:
                await update.message.reply_text(
                    f"✅ {msg}\nشناسه پیگیری: `{wth_info['tracking_code']}`",
                    parse_mode="Markdown",
                    reply_markup=get_main_menu_keyboard(is_verified=True)
                )
            else:
                await update.message.reply_text(f"❌ {msg}")
            return

        db.set_user_state(user_id, "WALLET_WITHDRAW_SHEBA", {"amount": amount})
        await update.message.reply_text(
            f"مبلغ برداشتی: {utils.format_toman(amount)}\n\n"
            "💳 لطفاً **شماره شبای بانکی** خود را وارد کنید (نمونه: `IR120170000000123456789012`):",
            parse_mode="Markdown"
        )
        return

    # ۴. دریافت و اعتبارسنجی شبا
    if state == "WALLET_WITHDRAW_SHEBA":
        amount = state_data.get("amount", 0)
        ok, msg, wth_info = wl.request_withdrawal(user_id, amount, sheba=text)
        if not ok:
            await update.message.reply_text(f"❌ {msg}\nلطفاً شماره شبای معتبر را مجدداً وارد فرمایید:")
            return

        db.clear_user_state(user_id)
        await update.message.reply_text(
            f"✅ {msg}\nشناسه پیگیری: `{wth_info['tracking_code']}`",
            parse_mode="Markdown",
            reply_markup=get_main_menu_keyboard(is_verified=True)
        )
        return

# ====================================================
# ۶. بخش قوانین و مقررات پلتفرم واسطه‌گری
# ====================================================

async def show_rules(update, context):
    """ارائه قوانین رسمی سامانه اسکرو و داوری میانجی."""
    text = (
        "🛡 **قوانین و ضوابط رسمی واسطه‌گری امن میانجی (Miyanji Escrow)**\n\n"
        "۱. **اعتبار قانونی امضای دیجیتال:**\n"
        "طبق ماده ۶ و ۷ قانون تجارت الکترونیک، امضای الکترونیک ثبت‌شده در سامانه میانجی دارای سندیت قانونی و قابل استناد در مراجع قضایی کشور است.\n\n"
        "۲. **صندوق امانت اسکرو (Escrow Vault):**\n"
        "وجه معامله تا زمان تایید قطعی کارفرما یا سپری شدن مهلت تست نزد میانجی امانت می‌ماند و هیچ طرفی حق لغو یک‌طرفه را ندارد.\n\n"
        "۳. **مهلت تست و بررسی:**\n"
        "خریدار موظف است در مهلت تست تعیین‌شده (پیش‌فرض ۲۴ ساعت)، کیفیت و تطابق تحویلی را بررسی نماید. در صورت عدم اعلام مغایرت پس از مهلت، وجه خودکار تسویه می‌گردد.\n\n"
        "۴. **شورای حل اختلاف و داوری حقوقی:**\n"
        "در صورت بروز هرگونه اختلاف، طرفین می‌توانند با لمس دکمه داوری، بررسی اسناد و مدارک را به کارشناسان حقوقی میانجی واگذار کنند. رای داور قطعی و لازم‌الاجراست."
    )

    from telegram import InlineKeyboardMarkup, InlineKeyboardButton
    kb = InlineKeyboardMarkup([
        [InlineKeyboardButton("🤝 ایجاد معامله جدید", callback_data="deal_create_ai")],
        [InlineKeyboardButton("🔙 بازگشت به منوی اصلی", callback_data="back_to_main")]
    ])

    if update.callback_query:
        await update.callback_query.edit_message_text(text, reply_markup=kb, parse_mode="Markdown")
    else:
        await update.message.reply_text(text, reply_markup=kb, parse_mode="Markdown")

# ====================================================
# ۷. توزیع‌کننده کلیک روی دکمه‌های شیشه‌ای (Callback Query Dispatcher)
# ====================================================

async def callback_query_dispatcher(update, context):
    """مدیریت کلیه رویدادهای کلیک روی دکمه‌های اینلاین."""
    query = update.callback_query
    user_id = update.effective_user.id
    data = query.data
    await query.answer()

    # منوی اصلی
    if data == "back_to_main":
        db.clear_user_state(user_id)
        user = db.get_user(user_id) or {}
        await query.edit_message_text(
            "🏠 به منوی اصلی میانجی بازگشتید. لطفاً گزینه مورد نظر خود را انتخاب فرمایید:",
            reply_markup=None
        )
        return

    # تب‌های داشبورد معاملات
    if data.startswith("tab_deals_"):
        tab_name = data.replace("tab_deals_", "")
        await show_my_deals_dashboard(update, context, tab=tab_name)
        return

    # مشاهده یک معامله
    if data.startswith("view_deal_"):
        cid = data.replace("view_deal_", "")
        await show_contract_card(update, context, cid)
        return

    # امضای معامله
    if data.startswith("sign_deal_"):
        cid = data.replace("sign_deal_", "")
        ok, msg, updated = db.sign_contract(cid, user_id)
        if ok:
            await query.message.reply_text(f"✅ {msg}")
            await show_contract_card(update, context, cid)
        else:
            await query.message.reply_text(f"❌ {msg}")
        return

    # پرداخت امن اسکرو
    if data.startswith("pay_escrow_"):
        cid = data.replace("pay_escrow_", "")
        ok, msg = wl.lock_escrow_deposit(cid, user_id)
        if ok:
            await query.message.reply_text(msg)
            await show_contract_card(update, context, cid)
        else:
            await query.message.reply_text(f"⚠️ {msg}")
            # هدایت به شارژ کیف پول
            await show_wallet_view(update, context)
        return

    # اعلام تحویل توسط فروشنده
    if data.startswith("deliver_deal_"):
        cid = data.replace("deliver_deal_", "")
        now_iso = datetime.now(timezone.utc).isoformat()
        db.update_contract_status(cid, "in_testing", {"delivered_at": now_iso})
        await query.message.reply_text("📦 اعلام تحویل شما با موفقیت ثبت شد و مهلت تست خریدار آغاز گردید.")
        await show_contract_card(update, context, cid)
        return

    # آزادسازی وجه توسط خریدار
    if data.startswith("release_deal_"):
        cid = data.replace("release_deal_", "")
        ok, msg = wl.release_escrow_funds(cid, user_id)
        await query.message.reply_text(msg)
        await show_contract_card(update, context, cid)
        return

    # اعلام اختلاف و داوری
    if data.startswith("dispute_deal_"):
        cid = data.replace("dispute_deal_", "")
        db.create_dispute(cid, user_id, reason="درخواست ورود داور میانجی جهت بررسی تخلف یا مغایرت کار")
        await query.message.reply_text("⚖️ پرونده اختلاف ثبت گردید و معامله جهت رسیدگی به هیئت داوری میانجی ارجاع شد.")
        await show_contract_card(update, context, cid)
        return

    # کیف پول
    if data == "wallet_deposit":
        db.set_user_state(user_id, "WALLET_DEPOSIT_AMOUNT")
        await query.message.reply_text(
            "➕ لطفاً مبلغی که قصد شارژ دارید را به تومان وارد نمایید (مثال: `50000` یا `۲۰۰ هزار`):",
            parse_mode="Markdown"
        )
        return

    if data == "wallet_withdraw":
        db.set_user_state(user_id, "WALLET_WITHDRAW_AMOUNT")
        await query.message.reply_text(
            "💸 لطفاً مبلغ مورد نظر برای تسویه و واریز به شبای بانکی را به تومان وارد نمایید:",
            parse_mode="Markdown"
        )
        return

    if data == "wallet_history":
        txs = db.get_user_transactions(user_id, limit=8)
        if not txs:
            await query.message.reply_text("📋 تاکنون هیچ تراکنش مالی در حساب شما ثبت نشده است.")
            return

        tx_text = "📋 **تاریخچه آخرین تراکنش‌های مالی:**\n──────────────────\n"
        for t in txs:
            t_type = utils.get_transaction_type_label(t["type"])
            t_status = utils.get_transaction_status_label(t["status"])
            t_amt = utils.format_toman(t["amount"])
            tx_text += f"• `{t['tracking_code']}` | {t_type}\n  مبلغ: {t_amt} | {t_status}\n\n"

        await query.message.reply_text(tx_text, parse_mode="Markdown")
        return

    if data == "wallet_refresh":
        await show_wallet_view(update, context)
        return

    # ساخت معامله
    if data == "deal_create_ai":
        db.set_user_state(user_id, "WAITING_AI_DEAL_TEXT")
        await query.message.reply_text(
            "🤖 **لطفاً متن توافق خود را بنویسید:**\n\n"
            "💡 *نمونه:*\n"
            "«میخوام برای آیدی @farhad یه لوگوی مینیمال طراحی کنم به مبلغ ۱ میلیون و ۲۰۰ هزار تومان با ۴۸ ساعت مهلت تست و تحویل فایل وکتور»",
            parse_mode="Markdown"
        )
        return

    if data == "deal_create_manual":
        db.set_user_state(user_id, "MANUAL_TITLE", {})
        await query.message.reply_text("✍️ لطفاً **موضوع یا عنوان خلاصه معامله** را وارد کنید:")
        return

    if data == "confirm_ai_deal_yes":
        state, parsed_data = db.get_user_state(user_id)
        cid = utils.generate_contract_id("MJ")
        c_record = db.create_contract({
            "contract_id": cid,
            "title": parsed_data.get("title", "معامله امن میانجی"),
            "buyer_id": user_id,
            "seller_id": 0,
            "seller_username": parsed_data.get("seller", ""),
            "amount": parsed_data.get("amount", 500000),
            "test_hours": parsed_data.get("test_hours", 24),
            "terms": parsed_data.get("terms", ""),
            "category": parsed_data.get("category", "عمومی"),
            "creator_is_buyer": True,
            "status": "waiting_seller_signature"
        })
        db.clear_user_state(user_id)
        await show_contract_created_success(update, context, c_record)
        return

# ====================================================
# ۸. پردازشگر عمومی پیام‌های متنی (Text Messages Dispatcher)
# ====================================================

async def text_message_dispatcher(update, context):
    """مدیریت دکمه‌های متنی کیبورد یا وضعیت‌های ورودی کاربر."""
    text = (update.message.text or "").strip()
    user_id = update.effective_user.id

    # بررسی دستورات انصراف
    if text in ["انصراف", "لغو", "بازگشت", "/cancel"]:
        db.clear_user_state(user_id)
        await update.message.reply_text(
            "🔙 عملیات لغو شد و به منوی اصلی بازگشتید.",
            reply_markup=get_main_menu_keyboard(is_verified=True)
        )
        return

    # بررسی کلیک روی دکمه‌های منوی اصلی
    if "ایجاد معامله" in text:
        await initiate_new_deal(update, context)
        return

    if "معاملات من" in text:
        await show_my_deals_dashboard(update, context, tab="waiting")
        return

    if "کیف پول" in text or "موجودی" in text:
        await show_wallet_view(update, context)
        return

    if "قوانین" in text:
        await show_rules(update, context)
        return

    # بررسی وضعیت FSM کاربر
    state, state_data = db.get_user_state(user_id)
    if state:
        if state.startswith("WALLET_"):
            await wallet_text_handler(update, context, state, state_data)
            return
        elif state.startswith("WAITING_AI_") or state.startswith("MANUAL_"):
            await deal_creation_text_handler(update, context, state, state_data)
            return

    # پاسخ پیش‌فرض به سایر پیام‌ها
    await update.message.reply_text(
        "پیام شما دریافت شد. لطفاً یکی از گزینه‌های منوی زیر را لمس فرمایید:",
        reply_markup=get_main_menu_keyboard(is_verified=True)
    )

# ====================================================
# ۹. راه‌انداز اصلی ربات تلگرام (Bot Entrypoint)
# ====================================================

def run_telegram_bot():
    """راه‌اندازی سرویس تلگرام با مدیریت خطاهای اتصال و توکن."""
    token = getattr(config, "BOT_TOKEN", "").strip()
    has_real_token = bool(token and ":" in token)

    if not has_real_token:
        logger.warning("⚠️ BOT_TOKEN در متغیرهای محیطی (.env) تنظیم نشده است.")
        logger.info("ℹ️ تمامی سرویس‌های دیتابیس، کیف پول و هوش مصنوعی در حالت آماده‌باش فعال هستند.")
        return

    try:
        from telegram.ext import (
            ApplicationBuilder,
            CommandHandler,
            MessageHandler,
            CallbackQueryHandler,
            filters
        )
    except ImportError:
        logger.error("پکیج python-telegram-bot نصب نیست. لطفاً آن را نصب کنید: pip install python-telegram-bot")
        return

    logger.info("🚀 در حال ساخت و راه‌اندازی Application ربات تلگرام میانجی...")
    application = ApplicationBuilder().token(token).build()

    # ثبت هندلرها
    application.add_handler(CommandHandler("start", start_command))
    application.add_handler(CommandHandler("rules", show_rules))
    application.add_handler(MessageHandler(filters.CONTACT, contact_handler))
    application.add_handler(CallbackQueryHandler(callback_query_dispatcher))
    application.add_handler(MessageHandler(filters.TEXT & (~filters.COMMAND), text_message_dispatcher))

    logger.info("📡 ربات تلگرام میانجی با موفقیت آماده پولینگ شد.")
    application.run_polling(drop_pending_updates=True)

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
    run_telegram_bot()
