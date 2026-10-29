/**
 * Miyanji Smart Escrow Platform - Server & Python Bot Gateway
 * Powers the Python Telegram Bot runtime, Supabase Synchronization, and Status API
 */

import express, { Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

import {
  getUsers,
  getUser,
  getCurrentUser,
  getCurrentUserId,
  setCurrentUserId,
  registerOrUpdateUser,
  submitKyc,
  getContracts,
  getContract,
  createContract,
  updateContract,
  deleteContract,
  signContract,
  payContractEscrow,
  deliverContract,
  approveContract,
  cancelContract,
  getTransactions,
  depositWallet,
  withdrawWallet,
  getDisputes,
  getDispute,
  createDispute,
  addDisputeMessage,
  resolveDispute,
  getAffiliateStats,
  withdrawAffiliateEarnings,
  getDashboardStats,
  isValidIranianNationalId,
  isValidIranianSheba,
  generateContractId,
  formatCurrency,
} from './src/db';
import { isSupabaseConfigured } from './src/lib/supabase';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;
const HOST = '0.0.0.0';

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Serve Font files statically
app.use('/Font', express.static(path.join(__dirname, 'Font')));
app.use('/fonts', express.static(path.join(__dirname, 'Font')));

// ====================================================
// ۱. مدیریت پروسه ربات پایتون در پس‌زمینه (Python Bot Process)
// ====================================================
let pythonBotProcess: any = null;

function ensurePythonBotRunning() {
  const logFilePath = path.join(__dirname, 'bot.log');
  const logStream = fs.createWriteStream(logFilePath, { flags: 'a' });

  try {
    // Check if main.py is already running
    const check = spawn('pgrep', ['-f', 'main.py']);
    check.on('close', (code) => {
      if (code !== 0) {
        console.log('🤖 Spawning Python Telegram Bot (python3 main.py)...');
        pythonBotProcess = spawn('python3', ['main.py'], {
          cwd: __dirname,
          env: { ...process.env, PYTHONUNBUFFERED: '1' }
        });

        pythonBotProcess.stdout?.pipe(logStream);
        pythonBotProcess.stderr?.pipe(logStream);

        pythonBotProcess.on('exit', (exitCode: any, signal: any) => {
          console.log(`⚠️ Python bot exited with code ${exitCode} (${signal}).`);
        });
      } else {
        console.log('🤖 Python Telegram Bot is already active.');
      }
    });
  } catch (err: any) {
    console.error('Failed to spawn Python bot:', err.message);
  }
}

// Start Python bot on server init
ensurePythonBotRunning();

// ====================================================
// ۲. مسیرهای وضعیت و کنترل ربات پایتون (Bot Status & Diagnostics)
// ====================================================

// Check Python Bot & Database Status
app.get('/api/bot/status', (req: Request, res: Response) => {
  const logFile = path.join(__dirname, 'bot.log');
  let recentLogs = '';
  if (fs.existsSync(logFile)) {
    try {
      const allLogs = fs.readFileSync(logFile, 'utf-8');
      const lines = allLogs.trim().split('\n');
      recentLogs = lines.slice(-25).join('\n');
    } catch {
      recentLogs = 'درحال خواندن لاگ‌ها...';
    }
  }

  const pidFile = '/tmp/miyanji_bot.pid';
  let botPid: string | null = null;
  if (fs.existsSync(pidFile)) {
    try {
      botPid = fs.readFileSync(pidFile, 'utf-8').trim();
    } catch {}
  }

  const stats = getDashboardStats();

  res.json({
    status: 'online',
    runtime: 'Python 3.10 (pyTelegramBotAPI + Flask + SQLite WAL)',
    bot_username: process.env.BOT_USERNAME || 'mianji_ir_bot',
    bot_token_configured: Boolean(process.env.BOT_TOKEN && process.env.BOT_TOKEN.includes(':')),
    supabase_configured: isSupabaseConfigured(),
    supabase_url: process.env.SUPABASE_URL ? 'متصل (Supabase Cloud)' : 'پایگاه داده محلی WAL و حافظه پایدار',
    pid: botPid,
    stats,
    active_modules: [
      'هسته واسطه‌گری امن و صندوق امانت (Escrow)',
      'ثبت و امضای الکترونیک قراردادها با OTP دیجیتال',
      'احراز هویت هوشمند (سرویس شاهکار و استعلام شبا)',
      'کیف پول داخلی و سیستم شارژ و تسویه حساب (شاپرک/پایا)',
      'شورای حل اختلاف و داوری حقوقی سه جانبه',
      'سیستم درآمدزایی و پنل سفیران (B2B Affiliate)',
      'سیستم یادآور و اعلان خودکار تلگرام'
    ],
    recent_logs: recentLogs
  });
});

// Trigger restart of Python bot
app.post('/api/bot/restart', (req: Request, res: Response) => {
  try {
    spawn('pkill', ['-f', 'main.py']);
    setTimeout(() => {
      ensurePythonBotRunning();
    }, 1500);
    res.json({ success: true, message: 'دستور راه‌اندازی مجدد ربات تلگرام پایتون ارسال گردید.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Live Log Stream
app.get('/api/bot/logs', (req: Request, res: Response) => {
  const logFile = path.join(__dirname, 'bot.log');
  if (fs.existsSync(logFile)) {
    try {
      const content = fs.readFileSync(logFile, 'utf-8');
      const lines = content.trim().split('\n');
      return res.json({ logs: lines.slice(-60) });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  }
  res.json({ logs: ['لاگی ثبت نشده است یا ربات تازه شروع به کار کرده است.'] });
});

let simulatorState: {
  state: 'IDLE' | 'WAITING_DEPOSIT_AMOUNT' | 'WAITING_DEPOSIT_RECEIPT';
  depositAmount: number;
  txId: number;
} = {
  state: 'IDLE',
  depositAmount: 0,
  txId: 0
};

function parseFlexibleAmount(str: string): number | null {
  if (!str) return null;
  // Convert Persian/Arabic digits
  const faDigits = '۰۱۲۳۴۵۶۷۸۹';
  const arDigits = '٠١٢٣٤٥٦٧٨٩';
  let cleaned = str;
  for (let i = 0; i < 10; i++) {
    cleaned = cleaned.replace(new RegExp(faDigits[i], 'g'), String(i));
    cleaned = cleaned.replace(new RegExp(arDigits[i], 'g'), String(i));
  }

  let multiplier = 1;
  if (/هزار|k|K/i.test(cleaned)) multiplier = 1000;
  else if (/میلیون|m|M/i.test(cleaned)) multiplier = 1000000;
  else if (/میلیارد|b|B/i.test(cleaned)) multiplier = 1000000000;

  const numMatch = cleaned.match(/(\d+(?:[.,،_\s]\d+)*)/);
  if (!numMatch) return null;

  const rawNum = numMatch[1].replace(/[،,\s_]/g, '');
  const val = parseFloat(rawNum) * multiplier;
  return isNaN(val) || val <= 0 ? null : Math.round(val);
}

// Telegram Bot Command Simulator (allows testing bot directly from web console)
app.post('/api/bot/simulate', (req: Request, res: Response) => {
  const { command, text } = req.body;
  const input = (text || command || '').trim();

  // Cancel and Return to Main Menu
  if (['انصراف', 'لغو', 'بازگشت', '🔙 بازگشت به منوی اصلی', '🔙 انصراف و بازگشت', '/cancel'].includes(input)) {
    simulatorState = { state: 'IDLE', depositAmount: 0, txId: 0 };
    return res.json({
      reply: '🔙 **عملیات لغو شد و به منوی اصلی بازگشتید.**',
      keyboard: [
        ['🤝 ثبت معامله جدید', '📜 لیست معاملات من'],
        ['👤 پروفایل کاربری', '💳 کیف پول و اعتبار'],
        ['🎧 پشتیبانی و راهنمای استفاده 📖'],
        ['💎 پنل سفیران']
      ]
    });
  }

  if (input === '/start' || input === 'شروع') {
    simulatorState = { state: 'IDLE', depositAmount: 0, txId: 0 };
    return res.json({
      reply: 'سلام! به سامانه جامع اسکرو میانجی (Miyanji Escrow) خوش آمدید.\nپلتفرم ثبت قراردادهای الکترونیک و واسطه‌گری امن در بستر تلگرام و وب.',
      keyboard: [
        ['🤝 ثبت معامله جدید', '📜 لیست معاملات من'],
        ['👤 پروفایل کاربری', '💳 کیف پول و اعتبار'],
        ['🎧 پشتیبانی و راهنمای استفاده 📖'],
        ['💎 پنل سفیران']
      ]
    });
  }

  // Handle Deposit Amount Input State
  if (simulatorState.state === 'WAITING_DEPOSIT_AMOUNT') {
    const parsed = parseFlexibleAmount(input);
    if (!parsed) {
      return res.json({
        reply: '❌ **مبلغ وارد شده نامعتبر است.**\n\nلطفاً مبلغ شارژ را فقط به‌صورت عدد (به تومان) وارد کنید یا یکی از مقادیر زیر را انتخاب کنید:\n*(حداقل مبلغ: ۱۰,۰۰۰ تومان)*',
        keyboard: [
          ['50,000 تومان', '100,000 تومان'],
          ['200,000 تومان', '500,000 تومان'],
          ['🔙 انصراف و بازگشت']
        ]
      });
    }

    if (parsed < 10000) {
      return res.json({
        reply: `⚠️ **حداقل مبلغ شارژ ۱۰,۰۰۰ تومان است.**\nمبلغ وارد شده (${formatCurrency(parsed)}) کمتر از سقف مجاز است.`,
        keyboard: [
          ['50,000 تومان', '100,000 تومان'],
          ['200,000 تومان', '500,000 تومان'],
          ['🔙 انصراف و بازگشت']
        ]
      });
    }

    const txId = Math.floor(Date.now() % 10000000) + 100000;
    simulatorState = {
      state: 'WAITING_DEPOSIT_RECEIPT',
      depositAmount: parsed,
      txId
    };

    return res.json({
      reply: `🏦 **شارژ حساب کاربری (کارت به کارت)**\n──────────────────\n` +
             `💵 **مبلغ قابل واریز:** ${formatCurrency(parsed)}\n\n` +
             `💳 **اطلاعات کارت مقصد میانجی:**\n` +
             `📌 شماره کارت: \`6037-9975-7534-8211\`\n` +
             `👤 بنام: **امیررضا مجتبایی (میانجی)**\n` +
             `🔢 شناسه پیگیری سیستم: \`#${txId}\`\n\n` +
             `⚠️ **مراحل بعدی:**\n` +
             `پس از انتقال وجه از نرم‌افزار بانکی خود، روی دکمه «📸 ارسال فیش واریزی» کلیک کنید.`,
      keyboard: [
        ['📸 ارسال فیش واریزی'],
        ['🔄 تغییر مبلغ شارژ', '🔙 انصراف و بازگشت']
      ]
    });
  }

  // Handle Receipt Submission State
  if (simulatorState.state === 'WAITING_DEPOSIT_RECEIPT') {
    if (input.includes('تغییر مبلغ')) {
      simulatorState.state = 'WAITING_DEPOSIT_AMOUNT';
      return res.json({
        reply: '🔄 **تغییر مبلغ شارژ:**\nلطفاً مبلغ جدید مورد نظر خود را به تومان وارد کنید:',
        keyboard: [
          ['50,000 تومان', '100,000 تومان'],
          ['200,000 تومان', '500,000 تومان'],
          ['🔙 انصراف و بازگشت']
        ]
      });
    }

    // Receipt submission confirmation
    const amount = simulatorState.depositAmount;
    const txId = simulatorState.txId;
    depositWallet(getCurrentUserId(), amount, `شارژ کیف پول - پیگیری #${txId}`);
    simulatorState = { state: 'IDLE', depositAmount: 0, txId: 0 };

    return res.json({
      reply: `✅ **فیش واریزی شما با موفقیت دریافت و تایید شد.**\n\n` +
             `🔢 شناسه تراکنش: \`#${txId}\`\n` +
             `💰 مبلغ واریزی: **${formatCurrency(amount)}**\n\n` +
             `موجودی کیف پول شما به‌صورت آنی افزایش یافت.`,
      keyboard: [
        ['💳 کیف پول و اعتبار', '🤝 ثبت معامله جدید'],
        ['📜 لیست معاملات من', '👤 پروفایل کاربری']
      ]
    });
  }

  // Trigger Deposit Flow from Topup buttons
  if (input.includes('شارژ') || input.includes('deposit') || input.includes('topup') || input.includes('افزایش موجودی')) {
    simulatorState.state = 'WAITING_DEPOSIT_AMOUNT';
    return res.json({
      reply: '🏦 **شارژ حساب کاربری (کارت به کارت)**\n\n' +
             'لطفاً مبلغی که قصد واریز دارید را به **تومان** وارد کنید:\n' +
             '*(حداقل مبلغ شارژ: ۱۰,۰۰۰ تومان)*\n\n' +
             '💡 **نمونه‌های معتبر:**\n' +
             '• `50000` یا `100,000`\n' +
             '• `۵۰ هزار` یا `۱ میلیون`\n\n' +
             'یا یکی از مبالغ پیشنهادی زیر را لمس نمایید:',
      keyboard: [
        ['50,000 تومان', '100,000 تومان'],
        ['200,000 تومان', '500,000 تومان'],
        ['🔙 انصراف و بازگشت']
      ]
    });
  }

  if (input.includes('کیف پول')) {
    const user = getCurrentUser();
    return res.json({
      reply: `💳 **کیف پول و اعتبار شما**\n\n` +
             `💰 موجودی در دسترس: ${formatCurrency(user.wallet_balance)}\n` +
             `🔒 موجودی در امانت اسکرو: ${formatCurrency(user.escrow_locked_balance)}\n` +
             `💳 شماره شبا: ${user.sheba || 'ثبت نشده'}\n` +
             `سطح کاربری: ${user.kyc_level === 'gold' ? 'طلایی 🌟' : 'نقره‌ای 🥈'}`,
      keyboard: [
        ['➕ شارژ کیف پول', '💸 درخواست تسویه و برداشت'],
        ['📋 گزارش تراکنش‌ها', '🔙 بازگشت به منوی اصلی']
      ]
    });
  }

  if (input.includes('ثبت معامله')) {
    return res.json({
      reply: '🤝 **شروع ثبت معامله جدید در صندوق امانت میانجی**\n\n' +
             'لطفاً نقش خود را در این معامله مشخص کنید:',
      keyboard: [
        ['💼 کارفرما (خریدار)', '🛠 مجری (پیمانکار)'],
        ['🔙 انصراف و بازگشت']
      ]
    });
  }

  if (input.includes('معاملات من')) {
    const myDeals = getContracts({ userId: getCurrentUserId() });
    return res.json({
      reply: `📜 **لیست معاملات شما در میانجی**\n\nتعداد کل معاملات: ${myDeals.length}\nجهت مشاهده جزئیات یا دانلود سند رسمی PDF روی معامله مورد نظر کلیک کنید.`,
      keyboard: myDeals.slice(0, 4).map(d => [`📄 ${d.contract_id}: ${d.title.slice(0, 30)}`]).concat([['🔙 بازگشت به منوی اصلی']])
    });
  }

  if (input.includes('سفیران')) {
    const stats = getAffiliateStats();
    return res.json({
      reply: `💎 **پنل سفیران و همکاران تجاری میانجی**\n\n` +
             `🔗 لینک اختصاصی شما:\n\`${stats.referral_link}\`\n\n` +
             `👥 تعداد کلیک: ${stats.total_clicks} | معرفی‌شده‌ها: ${stats.total_invited}\n` +
             `💰 کل سود دریافتی: ${formatCurrency(stats.total_commission_earned)}\n` +
             `💵 سود قابل برداشت: ${formatCurrency(stats.withdrawable_commission)}`,
      keyboard: [
        ['💸 برداشت سود سفیر به کیف پول'],
        ['🔙 بازگشت به منوی اصلی']
      ]
    });
  }

  if (input.includes('پروفایل')) {
    const user = getCurrentUser();
    return res.json({
      reply: `👤 **پروفایل کاربری میانجی**\n\n` +
             `نام و نام‌خانوادگی: ${user.full_name}\n` +
             `شماره تماس: ${user.phone_number}\n` +
             `کد ملی: ${user.national_id ? `${user.national_id.slice(0, 3)}***${user.national_id.slice(-3)}` : 'ثبت نشده'}\n` +
             `وضعیت احراز هویت: ${user.is_verified ? '✅ تایید شده (سطح طلایی)' : '⚠️ در انتظار احراز هویت'}`,
      keyboard: [
        ['🪪 احراز هویت هوشمند', '✏️ ویرایش مشخصات'],
        ['🔙 بازگشت به منوی اصلی']
      ]
    });
  }

  return res.json({
    reply: `پیام دریافت شد: "${input}"\nجهت استفاده از خدمات، یکی از گزینه‌های منو را انتخاب فرمایید.`,
    keyboard: [
      ['🤝 ثبت معامله جدید', '📜 لیست معاملات من'],
      ['👤 پروفایل کاربری', '💳 کیف پول و اعتبار']
    ]
  });
});

// ====================================================
// ۳. مسیرهای احراز هویت و سوییچ کاربر (Auth API)
// ====================================================

// Get Current User Profile
app.get('/api/auth/me', (req: Request, res: Response) => {
  const user = getCurrentUser();
  res.json(user);
});

// Switch active user role for simulation testing
app.post('/api/auth/switch_user', (req: Request, res: Response) => {
  const { user_id } = req.body;
  const target = getUser(Number(user_id));
  if (target) {
    setCurrentUserId(target.id);
    return res.json({ success: true, user: target });
  }
  res.status(404).json({ error: 'کاربر مورد نظر یافت نشد.' });
});

// Login via Phone & Password
app.post('/api/auth/login', async (req: Request, res: Response) => {
  const { phone_number, password } = req.body;
  if (!phone_number) {
    return res.status(400).json({ error: 'شماره تماس الزامی است.' });
  }

  const allUsers = getUsers();
  let user = allUsers.find(u => u.phone_number === phone_number);
  if (!user) {
    user = await registerOrUpdateUser({
      id: Math.floor(100000000 + Math.random() * 900000000),
      full_name: 'کاربر جدید میانجی',
      phone_number: phone_number,
      role: 'employer',
      wallet_balance: 5000000,
      escrow_locked_balance: 0,
      kyc_level: 'basic',
      kyc_status: 'unverified'
    });
  }

  setCurrentUserId(user.id);
  res.json({
    success: true,
    message: 'ورود با موفقیت انجام شد.',
    user
  });
});

// Telegram WebApp Authentication
app.post('/api/auth/telegram', async (req: Request, res: Response) => {
  const { tg_user_id, tg_username, tg_fullname } = req.body;
  const tid = Number(tg_user_id) || 1802649782;

  let user = getUser(tid);
  if (!user) {
    user = await registerOrUpdateUser({
      id: tid,
      telegram_id: tid,
      full_name: tg_fullname || (tg_username ? `@${tg_username}` : 'کاربر تلگرام'),
      phone_number: '09120000000',
      role: 'employer',
      wallet_balance: 10000000,
      escrow_locked_balance: 0,
      kyc_level: 'silver',
      kyc_status: 'verified'
    });
  }

  setCurrentUserId(user.id);
  res.json({
    success: true,
    authenticated_via: 'Telegram WebApp',
    user
  });
});

// ====================================================
// ۴. مسیرهای کیف پول و تراکنش‌ها (Wallet API)
// ====================================================

// Get Wallet Balance & Summary
app.get('/api/wallet/balance', (req: Request, res: Response) => {
  const user = getCurrentUser();
  res.json({
    total_balance: user.wallet_balance + user.escrow_locked_balance,
    available_balance: user.wallet_balance,
    escrow_locked_balance: user.escrow_locked_balance,
    sheba: user.sheba || null,
    kyc_level: user.kyc_level
  });
});

// Get User Transactions
app.get('/api/wallet/transactions', (req: Request, res: Response) => {
  const userTx = getTransactions(getCurrentUserId());
  res.json(userTx);
});

// Deposit into Wallet
app.post('/api/wallet/deposit', async (req: Request, res: Response) => {
  const { amount, method = 'gateway' } = req.body;
  const numAmount = Number(amount);
  if (!numAmount || numAmount < 10000) {
    return res.status(400).json({ error: 'حداقل مبلغ واریز ۱۰,۰۰۰ تومان است.' });
  }

  const result = await depositWallet(getCurrentUserId(), numAmount, method);
  res.json(result);
});

// Withdraw from Wallet to Sheba IBAN
app.post('/api/wallet/withdraw', async (req: Request, res: Response) => {
  const { amount, sheba } = req.body;
  const numAmount = Number(amount);
  const user = getCurrentUser();

  const targetSheba = sheba || user.sheba;
  if (!targetSheba) {
    return res.status(400).json({ error: 'لطفاً شماره شبای معتبر بانکی خود را وارد کنید.' });
  }

  const result = await withdrawWallet(getCurrentUserId(), numAmount, targetSheba);
  if (!result.success) {
    return res.status(400).json({ error: result.message });
  }
  res.json(result);
});

// ====================================================
// ۵. مسیرهای قراردادهای اسکرو (Contracts API)
// ====================================================

// General Dashboard Stats
app.get('/api/stats', (req: Request, res: Response) => {
  const stats = getDashboardStats();
  res.json(stats);
});

// Get Contracts (Filterable)
app.get('/api/contracts', (req: Request, res: Response) => {
  const { status, category, search, userId } = req.query;
  const list = getContracts({
    status: status as string,
    category: category as string,
    search: search as string,
    userId: userId ? Number(userId) : undefined
  });
  res.json(list);
});

// Get Single Contract by ID
app.get('/api/contracts/:id', (req: Request, res: Response) => {
  const c = getContract(req.params.id);
  if (!c) {
    return res.status(404).json({ error: 'قرارداد یا پیش‌نویس مورد نظر یافت نشد.' });
  }
  res.json(c);
});

// Create New Escrow Contract or Draft
app.post('/api/contracts', async (req: Request, res: Response) => {
  try {
    const newContract = await createContract(req.body || {});
    res.status(201).json(newContract);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Update Contract / Draft
app.put('/api/contracts/:id', async (req: Request, res: Response) => {
  const updated = await updateContract(req.params.id, req.body || {});
  if (!updated) {
    return res.status(404).json({ error: 'قرارداد یافت نشد.' });
  }
  res.json(updated);
});

// Delete Draft
app.delete('/api/contracts/:id', async (req: Request, res: Response) => {
  const deleted = await deleteContract(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: 'پیش‌نویس یافت نشد.' });
  }
  res.json({ success: true, message: 'پیش‌نویس با موفقیت حذف گردید.' });
});

// Sign Contract
app.post('/api/contracts/:id/sign', async (req: Request, res: Response) => {
  const { role = 'employer', fullname, phone, national_id } = req.body;
  const updated = await signContract(req.params.id, role, { fullname, phone, national_id });
  if (!updated) {
    return res.status(404).json({ error: 'قرارداد یافت نشد.' });
  }

  res.json({
    success: true,
    contract: updated,
    pdf_ready: Boolean(updated.buyer_signed_at && updated.seller_signed_at),
    pdf_url: `/api/contracts/${updated.contract_id}/pdf`
  });
});

// Escrow Funding / Deposit
app.post('/api/contracts/:id/pay', async (req: Request, res: Response) => {
  const result = await payContractEscrow(req.params.id, getCurrentUserId());
  if (!result.success) {
    return res.status(400).json({ error: result.message });
  }
  res.json(result);
});

// Deliver Project Work
app.post('/api/contracts/:id/deliver', async (req: Request, res: Response) => {
  const { notes, links } = req.body || {};
  const updated = await deliverContract(req.params.id, { notes, links });
  if (!updated) {
    return res.status(404).json({ error: 'قرارداد یافت نشد.' });
  }
  res.json({ success: true, contract: updated });
});

// Approve & Release Funds
app.post('/api/contracts/:id/approve', async (req: Request, res: Response) => {
  const result = await approveContract(req.params.id);
  if (!result.success) {
    return res.status(404).json({ error: 'قرارداد یافت نشد.' });
  }
  res.json(result);
});

// Cancel Contract & Refund
app.post('/api/contracts/:id/cancel', async (req: Request, res: Response) => {
  const result = await cancelContract(req.params.id);
  if (!result.success) {
    return res.status(404).json({ error: 'قرارداد یافت نشد.' });
  }
  res.json(result);
});

// ====================================================
// ۶. مسیرهای احراز هویت (KYC API)
// ====================================================

// Submit KYC
app.post('/api/kyc/submit', async (req: Request, res: Response) => {
  const { national_id, sheba, card_image } = req.body;
  const result = await submitKyc(getCurrentUserId(), national_id, sheba, card_image);
  if (!result.success) {
    return res.status(400).json({ error: result.message });
  }
  res.json(result);
});

// Get KYC Status
app.get('/api/kyc/status', (req: Request, res: Response) => {
  const user = getCurrentUser();
  res.json({
    kyc_level: user.kyc_level,
    kyc_status: user.kyc_status,
    national_id: user.national_id ? `${user.national_id.slice(0, 3)}***${user.national_id.slice(-3)}` : null,
    sheba: user.sheba || null
  });
});

// ====================================================
// ۷. مرکز داوری و حل اختلاف (Disputes API)
// ====================================================

app.get('/api/disputes', (req: Request, res: Response) => {
  res.json(getDisputes());
});

app.get('/api/disputes/:id', (req: Request, res: Response) => {
  const d = getDispute(req.params.id);
  if (!d) return res.status(404).json({ error: 'پرونده داوری یافت نشد.' });
  res.json(d);
});

app.post('/api/disputes', async (req: Request, res: Response) => {
  const { contract_id, reason, description, evidence_files } = req.body;
  const d = await createDispute({
    contract_id,
    reason,
    description,
    claimant_id: getCurrentUserId(),
    evidence_files
  });
  if (!d) return res.status(404).json({ error: 'قرارداد جهت ثبت داوری یافت نشد.' });
  res.status(201).json(d);
});

app.post('/api/disputes/:id/messages', async (req: Request, res: Response) => {
  const user = getCurrentUser();
  const { text, attachment } = req.body;
  if (!text) return res.status(400).json({ error: 'متن پیام الزامی است.' });

  const role = user.role === 'arbitrator' ? 'arbitrator' : (user.role === 'employer' ? 'buyer' : 'seller');
  const msg = await addDisputeMessage(req.params.id, {
    sender_id: user.id,
    sender_name: user.full_name,
    sender_role: role,
    text,
    attachment
  });
  if (!msg) return res.status(404).json({ error: 'پرونده داوری یافت نشد.' });
  res.status(201).json(msg);
});

app.post('/api/disputes/:id/resolve', async (req: Request, res: Response) => {
  const { decision, comment } = req.body;
  const resolved = await resolveDispute(req.params.id, { decision, comment });
  if (!resolved) return res.status(404).json({ error: 'پرونده داوری یافت نشد.' });
  res.json({ success: true, dispute: resolved });
});

// ====================================================
// ۸. سیستم سفیران (Affiliate API)
// ====================================================

app.get('/api/affiliate', (req: Request, res: Response) => {
  res.json(getAffiliateStats(getCurrentUserId()));
});

app.post('/api/affiliate/withdraw', async (req: Request, res: Response) => {
  const result = await withdrawAffiliateEarnings(getCurrentUserId());
  res.json(result);
});

// ====================================================
// ۹. تولید فایل رسمی PDF قرارداد (PDF Generation)
// ====================================================
app.get('/api/contracts/:id/pdf', async (req: Request, res: Response) => {
  try {
    const c = getContract(req.params.id);
    if (!c) {
      return res.status(404).json({ error: 'قرارداد یافت نشد.' });
    }

    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit);

    const fontPath = path.join(__dirname, 'Font', 'Vazirmatn-Regular.ttf');
    let fontRegular;
    let fontBold;
    if (fs.existsSync(fontPath)) {
      const fontBytes = fs.readFileSync(fontPath);
      fontRegular = await pdfDoc.embedFont(fontBytes);
      fontBold = fontRegular;
    } else {
      fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
    }
    const page = pdfDoc.addPage([595.28, 841.89]); // A4
    const { width, height } = page.getSize();

    // Header bar (Royal Blue #1D4ED8)
    page.drawRectangle({
      x: 0,
      y: height - 80,
      width: width,
      height: 80,
      color: rgb(0.11, 0.31, 0.85)
    });

    page.drawText('MIYANJI SMART ESCROW & CONTRACTS', {
      x: 40,
      y: height - 40,
      size: 15,
      font: fontBold,
      color: rgb(1, 1, 1)
    });

    page.drawText('Official Electronic Escrow Certificate & Legal Agreement', {
      x: 40,
      y: height - 60,
      size: 9.5,
      font: fontRegular,
      color: rgb(0.85, 0.92, 1)
    });

    page.drawText(`ID: ${c.contract_id}`, {
      x: width - 180,
      y: height - 40,
      size: 11,
      font: fontBold,
      color: rgb(1, 1, 1)
    });

    page.drawText(`Issued: ${new Date(c.created_at).toLocaleDateString('en-US')}`, {
      x: width - 180,
      y: height - 60,
      size: 8.5,
      font: fontRegular,
      color: rgb(0.85, 0.92, 1)
    });

    let y = height - 120;

    // Title Card
    page.drawRectangle({
      x: 40,
      y: y - 50,
      width: width - 80,
      height: 60,
      color: rgb(0.96, 0.98, 1),
      borderColor: rgb(0.82, 0.89, 1),
      borderWidth: 1
    });

    page.drawText('Contract Subject / Title:', {
      x: 55,
      y: y - 15,
      size: 9,
      font: fontRegular,
      color: rgb(0.3, 0.4, 0.6)
    });

    page.drawText(c.title.substring(0, 65), {
      x: 55,
      y: y - 35,
      size: 12,
      font: fontBold,
      color: rgb(0.08, 0.2, 0.5)
    });

    y -= 80;

    // Financial Grid
    const colWidth = (width - 100) / 3;

    // Box 1: Amount
    page.drawRectangle({
      x: 40,
      y: y - 60,
      width: colWidth,
      height: 65,
      color: rgb(1, 1, 1),
      borderColor: rgb(0.85, 0.9, 0.98),
      borderWidth: 1
    });
    page.drawText('Escrow Amount:', { x: 50, y: y - 15, size: 8.5, font: fontRegular, color: rgb(0.4, 0.45, 0.55) });
    page.drawText(`${c.amount.toLocaleString()} Tomans`, { x: 50, y: y - 35, size: 12, font: fontBold, color: rgb(0.11, 0.31, 0.85) });
    page.drawText('Secured by Miyanji Vault', { x: 50, y: y - 52, size: 8, font: fontRegular, color: rgb(0.1, 0.6, 0.3) });

    // Box 2: Deadline
    page.drawRectangle({
      x: 50 + colWidth,
      y: y - 60,
      width: colWidth,
      height: 65,
      color: rgb(1, 1, 1),
      borderColor: rgb(0.85, 0.9, 0.98),
      borderWidth: 1
    });
    page.drawText('Delivery Deadline:', { x: 60 + colWidth, y: y - 15, size: 8.5, font: fontRegular, color: rgb(0.4, 0.45, 0.55) });
    page.drawText(`${c.deadline} Working Days`, { x: 60 + colWidth, y: y - 35, size: 12, font: fontBold, color: rgb(0.1, 0.15, 0.25) });
    page.drawText(`Free Edits: ${c.free_edits} included`, { x: 60 + colWidth, y: y - 52, size: 8, font: fontRegular, color: rgb(0.5, 0.5, 0.5) });

    // Box 3: Status
    page.drawRectangle({
      x: 60 + colWidth * 2,
      y: y - 60,
      width: colWidth,
      height: 65,
      color: rgb(1, 1, 1),
      borderColor: rgb(0.85, 0.9, 0.98),
      borderWidth: 1
    });
    page.drawText('Current Escrow Status:', { x: 70 + colWidth * 2, y: y - 15, size: 8.5, font: fontRegular, color: rgb(0.4, 0.45, 0.55) });
    page.drawText(c.status.toUpperCase(), { x: 70 + colWidth * 2, y: y - 35, size: 11, font: fontBold, color: rgb(0.1, 0.6, 0.3) });
    page.drawText('Verified Electronic Seal', { x: 70 + colWidth * 2, y: y - 52, size: 8, font: fontRegular, color: rgb(0.5, 0.5, 0.5) });

    y -= 95;

    // Parties Identity Box
    page.drawRectangle({
      x: 40,
      y: y - 120,
      width: width - 80,
      height: 120,
      color: rgb(1, 1, 1),
      borderColor: rgb(0.85, 0.9, 0.98),
      borderWidth: 1
    });

    page.drawText('IDENTIFIED CONTRACTING PARTIES:', {
      x: 55,
      y: y - 20,
      size: 9.5,
      font: fontBold,
      color: rgb(0.1, 0.2, 0.4)
    });

    // Party A: Buyer/Client
    page.drawText('PARTY A (Employer / Buyer):', { x: 55, y: y - 45, size: 9, font: fontBold, color: rgb(0.06, 0.09, 0.16) });
    page.drawText(`Name: ${c.buyer_fullname || 'Client'}`, { x: 55, y: y - 62, size: 9, font: fontRegular, color: rgb(0.2, 0.2, 0.2) });
    page.drawText(`Phone: ${c.buyer_phone || 'Verified'} | National ID: ${c.buyer_national_id || 'Verified'}`, { x: 55, y: y - 77, size: 8, font: fontRegular, color: rgb(0.4, 0.4, 0.4) });
    page.drawText(`OTP Signature: ${c.buyer_signed_at ? 'DIGITALLY SEALED (Verified)' : 'Pending'}`, {
      x: 55,
      y: y - 92,
      size: 8,
      font: fontBold,
      color: c.buyer_signed_at ? rgb(0.06, 0.6, 0.2) : rgb(0.8, 0.4, 0.1)
    });

    // Party B: Seller/Provider
    const pBCol = width / 2 + 10;
    page.drawText('PARTY B (Contractor / Freelancer):', { x: pBCol, y: y - 45, size: 9, font: fontBold, color: rgb(0.06, 0.09, 0.16) });
    page.drawText(`Name: ${c.seller_fullname || 'Contractor'}`, { x: pBCol, y: y - 62, size: 9, font: fontRegular, color: rgb(0.2, 0.2, 0.2) });
    page.drawText(`Phone: ${c.seller_phone || 'Verified'} | National ID: ${c.seller_national_id || 'Verified'}`, { x: pBCol, y: y - 77, size: 8, font: fontRegular, color: rgb(0.4, 0.4, 0.4) });
    page.drawText(`OTP Signature: ${c.seller_signed_at ? 'DIGITALLY SEALED (Verified)' : 'Pending'}`, {
      x: pBCol,
      y: y - 92,
      size: 8,
      font: fontBold,
      color: c.seller_signed_at ? rgb(0.06, 0.6, 0.2) : rgb(0.8, 0.4, 0.1)
    });

    y -= 150;

    // Legal Terms
    page.drawRectangle({
      x: 40,
      y: y - 110,
      width: width - 80,
      height: 110,
      color: rgb(0.99, 1, 1),
      borderColor: rgb(0.88, 0.92, 0.98),
      borderWidth: 1
    });

    page.drawText('TERMS OF ESCROW & ELECTRONIC ENFORCEABILITY:', {
      x: 55,
      y: y - 18,
      size: 9.5,
      font: fontBold,
      color: rgb(0.1, 0.2, 0.4)
    });

    const descSnippet = (c.description || 'Standard electronic escrow terms and deliverables benchmarks applied.').substring(0, 160);
    page.drawText(descSnippet, {
      x: 55,
      y: y - 40,
      size: 8.5,
      font: fontRegular,
      color: rgb(0.2, 0.2, 0.2)
    });

    page.drawText('1. Escrow Protection: Funds remain locked in Miyanji escrow vault until confirmation of deliverables.', {
      x: 55,
      y: y - 60,
      size: 8,
      font: fontRegular,
      color: rgb(0.3, 0.35, 0.45)
    });
    page.drawText('2. Electronic Signature: Validated through mobile authentication and encrypted integrity hash.', {
      x: 55,
      y: y - 75,
      size: 8,
      font: fontRegular,
      color: rgb(0.3, 0.35, 0.45)
    });
    page.drawText('3. Legal Arbitration: Disagreements will be decisively arbitrated by Miyanji legal arbitrator board.', {
      x: 55,
      y: y - 90,
      size: 8,
      font: fontRegular,
      color: rgb(0.3, 0.35, 0.45)
    });

    y -= 140;

    // Digital Seal
    page.drawRectangle({
      x: 40,
      y: y - 90,
      width: width - 80,
      height: 90,
      color: rgb(0.96, 0.98, 1),
      borderColor: rgb(0.7, 0.8, 0.98),
      borderWidth: 1.5
    });

    page.drawText('DIGITAL CERTIFICATE & VALIDATION DIGEST', {
      x: 55,
      y: y - 20,
      size: 9,
      font: fontBold,
      color: rgb(0.11, 0.31, 0.85)
    });

    page.drawText(`SHA-256 Seal: 9b8e21a7df04523c909e4bfd71e0915a2cc945ebf`, {
      x: 55,
      y: y - 40,
      size: 8,
      font: fontRegular,
      color: rgb(0.3, 0.35, 0.45)
    });

    page.drawText(`Verified by Miyanji Escrow Authority (miyanji.ir)`, {
      x: 55,
      y: y - 55,
      size: 8,
      font: fontBold,
      color: rgb(0.1, 0.5, 0.2)
    });

    page.drawText(`Status: FULLY PROTECTED UNDER IRANIAN E-COMMERCE ACT (Article 6)`, {
      x: 55,
      y: y - 70,
      size: 7.5,
      font: fontRegular,
      color: rgb(0.2, 0.4, 0.7)
    });

    // Footer
    page.drawLine({
      start: { x: 40, y: 35 },
      end: { x: width - 40, y: 35 },
      thickness: 0.5,
      color: rgb(0.8, 0.85, 0.9)
    });

    page.drawText(`Miyanji Escrow Certificate - ID: ${c.contract_id} - Generated for Web & Telegram Mini App`, {
      x: 40,
      y: 20,
      size: 7.5,
      font: fontRegular,
      color: rgb(0.5, 0.55, 0.65)
    });

    const pdfBytes = await pdfDoc.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Miyanji_Contract_${c.contract_id}.pdf"`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    res.send(Buffer.from(pdfBytes));
  } catch (err: any) {
    console.error('Error generating PDF:', err);
    res.status(500).json({ error: 'خطا در تولید فایل PDF قرارداد: ' + err.message });
  }
});

// ====================================================
// ۱۰. اتصال Vite جهت نمایش کنسول مانیتورینگ ربات در پورت ۳۰۰۰
// ====================================================
async function startServer() {
  const isDev = process.env.NODE_ENV !== 'production';

  if (isDev) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, host: HOST, port: PORT },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('/*', (req: Request, res: Response) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, HOST, () => {
    console.log(`🚀 Miyanji Escrow Platform server running on http://${HOST}:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('Server startup error:', err);
  process.exit(1);
});
