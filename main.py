"""
سامانه واسطه‌گری امن و اسکرو میانجی (Miyanji Escrow)
نقطه ورودی اصلی اجرای سرویس پایتون، سرور سلامت و اتصال ربات (main.py)
"""

import sys
import os
import time
import signal
import logging
import threading
from logging.handlers import RotatingFileHandler
from http.server import HTTPServer, BaseHTTPRequestHandler

from config import config
import database as db
import wallet as wl
import ai_parser as ai
import utils

# ====================================================
# ۱. پیکربندی سیستم لاگینگ دوگانه (کنسول + فایل چرخشی)
# ====================================================

log_formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
log_file = 'bot.log'

stream_handler = logging.StreamHandler(sys.stdout)
stream_handler.setFormatter(log_formatter)

file_handler = RotatingFileHandler(log_file, maxBytes=5 * 1024 * 1024, backupCount=5, encoding='utf-8')
file_handler.setFormatter(log_formatter)

logging.basicConfig(level=logging.INFO, handlers=[stream_handler, file_handler])
logger = logging.getLogger("Miyanji_Main")

# ====================================================
# ۲. سرور سلامت مستقل (Health Check Server) برای Render / VPS
# ====================================================

class HealthCheckHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path in ['/', '/healthz', '/health']:
            self.send_response(200)
            self.send_header('Content-Type', 'text/plain; charset=utf-8')
            self.end_headers()
            self.wfile.write(b"Miyanji Escrow Bot Service is Healthy and Running!")
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        # جلوگیری از شلوغی لاگ‌ها توسط هلث‌چک‌های پیاپی
        return

def run_health_server():
    """راه‌اندازی سرور بررسی سلامت در یک پورت در دسترس."""
    ports = [int(os.environ.get("FLASK_PORT", 8888)), 8889, 8890, 8891]
    for p in ports:
        try:
            server = HTTPServer(('0.0.0.0', p), HealthCheckHandler)
            logger.info(f"🌐 سرور سلامت سرویس پایتون روی پورت {p} فعال شد.")
            server.serve_forever()
            break
        except Exception as e:
            logger.debug(f"Port {p} not available for health server: {e}")

# ====================================================
# ۳. مدیریت قفل تک‌پروسه‌ای (Single Instance Lock)
# ====================================================

PID_FILE = "/tmp/miyanji_bot.pid"

def acquire_single_instance_lock():
    """اطمینان از عدم اجرای چندگانه پروسه ربات روی یک سرور."""
    current_pid = os.getpid()
    if os.path.exists(PID_FILE):
        try:
            with open(PID_FILE, "r") as f:
                content = f.read().strip()
                old_pid = int(content) if content.isdigit() else None
            if old_pid and old_pid != current_pid:
                logger.warning(f"⚠️ شناسایی پروسه قبلی با PID {old_pid}. آزادسازی...")
                try:
                    os.kill(old_pid, signal.SIGTERM)
                    time.sleep(1.0)
                except OSError:
                    pass
        except Exception as e:
            logger.debug(f"PID check notice: {e}")

    try:
        with open(PID_FILE, "w") as f:
            f.write(str(current_pid))
    except Exception:
        pass

# ====================================================
# ۴. راه‌اندازی و اجرای اصلی
# ====================================================

def main():
    acquire_single_instance_lock()

    # اجرای سرور سلامت در ترد پس‌زمینه
    health_thread = threading.Thread(target=run_health_server, daemon=True)
    health_thread.start()

    logger.info("🚀 سامانه هوشمند واسطه‌گری امن و اسکرو میانجی (Miyanji Escrow) فعال گردید.")
    logger.info("📦 ماژول‌های فعال: database.py, wallet.py, ai_parser.py, bot.py, utils.py")

    token = getattr(config, "BOT_TOKEN", "").strip()
    has_real_token = bool(token and ":" in token)

    # تلاش برای اجرای ربات تلگرام در صورت نصب بودن کتابخانه‌ها
    try:
        import telegram
        from bot import run_telegram_bot
        logger.info("📡 کتابخانه python-telegram-bot شناسایی شد.")
        if has_real_token:
            run_telegram_bot()
            return
        else:
            logger.info("ℹ️ توکن ربات تنظیم نشده است. ماژول‌ها در حالت آماده‌باش قرار دارند.")
    except ImportError:
        logger.info("ℹ️ کتابخانه python-telegram-bot هنوز در این محیط نصب نشده است.")

    # حلقه نگهدارنده پروسه سرور بدون کرش
    logger.info("✅ هسته پایتون و سرور سلامت با موفقیت در حال اجرا هستند.")
    try:
        while True:
            time.sleep(60)
    except (KeyboardInterrupt, SystemExit):
        logger.info("🛑 سرویس متوقف گردید.")

if __name__ == "__main__":
    main()
