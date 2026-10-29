"""
سامانه واسطه‌گری امن میانجی (Miyanji Escrow)
ماژول محاسبات مالی و منطق کیف پول الکترونیک (wallet.py)
"""

import logging
from typing import Dict, Any, Optional, Tuple, List
from config import config
import database as db
import utils

logger = logging.getLogger("Miyanji_Wallet")

# حداقل مبالغ تراکنش طبق ضوابط شاپرک و پلتفرم
MIN_DEPOSIT_AMOUNT = 10_000       # حداقل شارژ ۱۰ هزار تومان
MIN_WITHDRAW_AMOUNT = 50_000      # حداقل برداشت ۵۰ هزار تومان

def get_wallet_summary(user_id: int) -> Dict[str, Any]:
    """
    محاسبه و دریافت خلاصه موجودی کیف پول کاربر:
    - موجودی قابل برداشت و در دسترس
    - موجودی بلوکه‌شده در صندوق امن معاملات (اسکرو)
    - مجموع کل دارایی کاربر
    """
    raw_wallet = db.get_wallet(user_id)
    user = db.get_user(user_id) or {}

    avail = raw_wallet["available_balance"]
    locked = raw_wallet["locked_balance"]
    total = raw_wallet["total_balance"]

    return {
        "user_id": user_id,
        "available_balance": avail,
        "locked_balance": locked,
        "total_balance": total,
        "available_formatted": utils.format_toman(avail),
        "locked_formatted": utils.format_toman(locked),
        "total_formatted": utils.format_toman(total),
        "sheba": user.get("sheba") or "ثبت نشده",
        "has_sheba": bool(user.get("sheba") and utils.validate_sheba(user.get("sheba"))),
        "is_verified": bool(user.get("is_verified"))
    }

def request_deposit(user_id: int, amount: int) -> Tuple[bool, str, Optional[Dict[str, Any]]]:
    """
    ثبت درخواست شارژ کیف پول (کارت به کارت / درگاه):
    تولید شناسه پیگیری یکتا، ثبت تراکنش در حالت انتظار، و صدور اطلاعات کارت واسط میانجی.
    """
    clean_amount = int(amount)
    if clean_amount < MIN_DEPOSIT_AMOUNT:
        return False, f"حداقل مبلغ شارژ حساب کاربری {utils.format_toman(MIN_DEPOSIT_AMOUNT)} می‌باشد.", None

    tracking_code = utils.generate_tracking_code("DEP")
    dest_card = getattr(config, "INTERMEDIARY_CARD", "6037-9975-7534-8211")
    bank_name, bank_icon = utils.get_bank_info(dest_card)

    tx = db.create_transaction(
        user_id=user_id,
        amount=clean_amount,
        tx_type="deposit",
        status="pending",
        tracking_code=tracking_code,
        description=f"درخواست شارژ حساب کاربری به شناسه {tracking_code}"
    )

    deposit_info = {
        "tracking_code": tracking_code,
        "amount": clean_amount,
        "amount_formatted": utils.format_toman(clean_amount),
        "destination_card": dest_card,
        "card_holder": "امیررضا مجتبایی (حساب واسط میانجی)",
        "bank_name": bank_name,
        "bank_icon": bank_icon,
        "transaction": tx
    }

    return True, "درخواست شارژ با موفقیت صادر گردید.", deposit_info

def submit_deposit_receipt(
    user_id: int,
    tracking_code: str,
    receipt_info: str,
    auto_approve: bool = True
) -> Tuple[bool, str]:
    """
    ثبت فیش واریزی یا شماره پیگیری بانکی توسط کاربر.
    در صورت فعال بودن تایید خودکار (یا تایید مدیر)، موجودی به کیف پول اضافه می‌شود.
    """
    txs = db.get_user_transactions(user_id, limit=10)
    target_tx = next((t for t in txs if t["tracking_code"] == tracking_code.strip()), None)

    if not target_tx:
        # اگر شناسه پیدا نشد، آخرین تراکنش در انتظار شارژ را بررسی می‌کنیم
        pending_deposits = [t for t in txs if t["type"] == "deposit" and t["status"] == "pending"]
        if pending_deposits:
            target_tx = pending_deposits[0]
            tracking_code = target_tx["tracking_code"]
        else:
            return False, "تراکنش شارژ در انتظار پرداختی با این مشخصات یافت نشد."

    amount = int(target_tx["amount"])

    if auto_approve:
        try:
            # افزایش اتمیک موجودی در دسترس کاربر
            db.update_wallet_balance(user_id, available_delta=amount)
            db.update_transaction_status(tracking_code, "completed")
            logger.info(f"✅ واریزی {amount:,} تومان برای کاربر {user_id} با شناسه {tracking_code} تایید شد.")
            return True, f"✅ فیش واریزی تایید گردید و مبلغ {utils.format_toman(amount)} آنی به موجودی در دسترس شما افزوده شد."
        except Exception as e:
            logger.error(f"خطا در افزایش موجودی کاربر: {e}")
            return False, "خطایی در پردازش واریز رخ داد. لطفاً با پشتیبانی تماس بگیرید."
    else:
        # ثبت جهت بررسی دستی توسط تیم مالی
        db.update_transaction_status(tracking_code, "pending")
        return True, "فیش واریزی با موفقیت دریافت شد و برای بررسی نهایی به واحد مالی ارجاع گردید."

def request_withdrawal(
    user_id: int,
    amount: int,
    sheba: str
) -> Tuple[bool, str, Optional[Dict[str, Any]]]:
    """
    درخواست تسویه و انتقال وجه از کیف پول به شماره شبای بانکی کاربر:
    - بررسی سقف موجودی در دسترس
    - اعتبارسنجی دقیق الگوریتم شماره شبا
    - کسر آنی از موجودی در دسترس و ثبت تراکنش پایا
    """
    clean_amount = int(amount)
    if clean_amount < MIN_WITHDRAW_AMOUNT:
        return False, f"حداقل مبلغ قابل برداشت {utils.format_toman(MIN_WITHDRAW_AMOUNT)} می‌باشد.", None

    clean_sheba = utils.fa_to_en_digits(sheba).replace(" ", "").upper().strip()
    if not clean_sheba.startswith("IR"):
        clean_sheba = f"IR{clean_sheba}"

    if not utils.validate_sheba(clean_sheba):
        return False, "شماره شبای وارد شده نامعتبر است. فرمت صحیح: IR به همراه ۲۴ رقم.", None

    # بررسی موجودی
    wallet = db.get_wallet(user_id)
    avail = wallet["available_balance"]

    if avail < clean_amount:
        return False, f"موجودی در دسترس شما ({utils.format_toman(avail)}) کمتر از مبلغ درخواستی است.", None

    tracking_code = utils.generate_tracking_code("WTH")

    try:
        # کسر از موجودی کیف پول به صورت اتمیک
        db.update_wallet_balance(user_id, available_delta=-clean_amount)
    except ValueError as ve:
        return False, str(ve), None

    # ذخیره شماره شبا در پروفایل کاربر جهت برداشت‌های آتی
    db.update_user_profile(user_id, sheba=clean_sheba)

    # ثبت تراکنش برداشت
    tx = db.create_transaction(
        user_id=user_id,
        amount=clean_amount,
        tx_type="withdraw",
        status="pending",
        tracking_code=tracking_code,
        sheba=clean_sheba,
        description=f"درخواست تسویه پایا به شماره شبا {clean_sheba}"
    )

    res_data = {
        "tracking_code": tracking_code,
        "amount": clean_amount,
        "amount_formatted": utils.format_toman(clean_amount),
        "sheba": clean_sheba,
        "transaction": tx
    }

    return True, f"درخواست تسویه {utils.format_toman(clean_amount)} با موفقیت ثبت شد. انتقال از طریق پایا در نزدیک‌ترین سیکل بانکی انجام می‌شود.", res_data

# ====================================================
# عملیات اختصاصی اسکرو (قفل، آزادسازی و استرداد)
# ====================================================

def lock_escrow_deposit(contract_id: str, buyer_id: int) -> Tuple[bool, str]:
    """
    انتقال مبلغ معامله از موجودی در دسترس خریدار به حساب امانت اسکرو (بلوکه):
    به همراه کسر کارمزد در صورت تعهد خریدار.
    """
    contract = db.get_contract(contract_id)
    if not contract:
        return False, "قرارداد معامله یافت نشد."

    if int(contract["buyer_id"]) != int(buyer_id):
        return False, "فقط خریدار معامله می‌تواند وجه را به صندوق امانت واریز کند."

    if contract["status"] not in ["waiting_buyer_deposit", "waiting_seller_signature"]:
        return False, f"این معامله در وضعیت واریز قرار ندارد (وضعیت: {contract['status']})."

    amount = int(contract["amount"])
    commission = int(contract.get("commission_amount", 0))
    comm_payer = contract.get("commission_payer", "buyer")

    total_required = amount + (commission if comm_payer in ["buyer", "equal"] else 0)

    wallet = db.get_wallet(buyer_id)
    if wallet["available_balance"] < total_required:
        deficit = total_required - wallet["available_balance"]
        return False, f"موجودی در دسترس شما کافی نیست. جهت پرداخت، کیف پول خود را به میزان {utils.format_toman(deficit)} شارژ نمایید."

    try:
        # کسر از موجودی در دسترس و انتقال به موجودی بلوکه‌شده
        db.update_wallet_balance(buyer_id, available_delta=-total_required, locked_delta=total_required)
    except ValueError as ve:
        return False, str(ve)

    # ثبت تراکنش قفل اسکرو
    db.create_transaction(
        user_id=buyer_id,
        amount=total_required,
        tx_type="escrow_lock",
        status="completed",
        description=f"واریز و قفل امن وجه معامله {contract['contract_id']} در صندوق میانجی"
    )

    # فعال‌سازی معامله
    db.update_contract_status(contract["contract_id"], "in_progress")
    logger.info(f"🔒 معامله {contract['contract_id']} با موفقیت تامین مالی و فعال شد.")
    return True, f"✅ مبلغ {utils.format_toman(total_required)} با موفقیت در صندوق امانت میانجی قفل شد و وضعیت معامله فعال گردید."

def release_escrow_funds(contract_id: str, caller_id: int) -> Tuple[bool, str]:
    """
    تایید نهایی کار و آزادسازی وجه از صندوق امانت خریدار به حساب در دسترس فروشنده:
    کسر موجودی بلوکه خریدار، افزودن وجه خالص به فروشنده و کسر کارمزد سیستم.
    """
    contract = db.get_contract(contract_id)
    if not contract:
        return False, "قرارداد معامله یافت نشد."

    buyer_id = int(contract["buyer_id"])
    seller_id = int(contract["seller_id"])
    cid = contract["contract_id"]

    # فقط خریدار می‌تواند آزادسازی را تایید کند (مگر داوری سیستم)
    if int(caller_id) != buyer_id:
        return False, "تنها خریدار مجاز به تایید تحویل و آزادسازی وجه می‌باشد."

    if contract["status"] not in ["in_testing", "in_progress"]:
        return False, f"معامله در وضعیت قابل آزادسازی قرار ندارد (وضعیت فعلی: {contract['status']})."

    amount = int(contract["amount"])
    commission = int(contract.get("commission_amount", 0))
    comm_payer = contract.get("commission_payer", "buyer")

    buyer_locked_deduct = amount + (commission if comm_payer in ["buyer", "equal"] else 0)
    seller_net_receive = amount - (commission if comm_payer == "seller" else 0)

    try:
        # ۱. آزادسازی وجه بلوکه از خریدار
        db.update_wallet_balance(buyer_id, available_delta=0, locked_delta=-buyer_locked_deduct)
        # ۲. اضافه شدن وجه خالص به کیف پول فروشنده
        db.update_wallet_balance(seller_id, available_delta=seller_net_receive, locked_delta=0)
    except Exception as e:
        logger.error(f"خطا در آزادسازی مالی قرارداد {cid}: {e}")
        return False, "خطای مالی در پردازش انتقال وجه اسکرو."

    # ثبت تراکنش‌ها
    db.create_transaction(
        user_id=seller_id,
        amount=seller_net_receive,
        tx_type="escrow_release",
        status="completed",
        description=f"تسویه و واریز درآمد معامله {cid} به کیف پول"
    )

    if commission > 0:
        db.create_transaction(
            user_id=buyer_id if comm_payer == "buyer" else seller_id,
            amount=commission,
            tx_type="commission",
            status="completed",
            description=f"کارمزد سامانه واسطه‌گری میانجی برای معامله {cid}"
        )

    from datetime import datetime, timezone
    now_iso = datetime.now(timezone.utc).isoformat()
    db.update_contract_status(cid, "completed", {"completed_at": now_iso})

    logger.info(f"🎉 معامله {cid} با موفقیت تسویه و تکمیل شد.")
    return True, f"✅ وجه معامله ({utils.format_toman(seller_net_receive)}) با موفقیت به کیف پول فروشنده آزاد و واریز گردید."

def refund_escrow_funds(contract_id: str, reason: str = "") -> Tuple[bool, str]:
    """
    استرداد وجه مسدودشده از صندوق امانت به کیف پول در دسترس خریدار در صورت لغو یا حکم داوری.
    """
    contract = db.get_contract(contract_id)
    if not contract:
        return False, "قرارداد یافت نشد."

    buyer_id = int(contract["buyer_id"])
    amount = int(contract["amount"])
    commission = int(contract.get("commission_amount", 0))
    comm_payer = contract.get("commission_payer", "buyer")

    total_locked = amount + (commission if comm_payer in ["buyer", "equal"] else 0)

    try:
        # برگشت از حالت بلوکه به در دسترس برای خریدار
        db.update_wallet_balance(buyer_id, available_delta=total_locked, locked_delta=-total_locked)
    except Exception as e:
        logger.error(f"خطا در استرداد وجه اسکرو: {e}")
        return False, "خطا در استرداد وجه به خریدار."

    db.create_transaction(
        user_id=buyer_id,
        amount=total_locked,
        tx_type="escrow_refund",
        status="completed",
        description=f"استرداد وجه معامله لغوشده {contract['contract_id']}. علت: {reason or 'توافق طرفین'}"
    )

    db.update_contract_status(contract["contract_id"], "cancelled")
    return True, f"✅ مبلغ {utils.format_toman(total_locked)} با موفقیت به موجودی در دسترس خریدار برگشت داده شد."
