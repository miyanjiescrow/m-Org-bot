/**
 * Miyanji Smart Escrow Platform - Telegraf Bot Engine (Node.js & TypeScript)
 * Full implementation of Miyanji Telegram Bot handlers & simulator engine
 */

import { Telegraf, Markup } from 'telegraf';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  getUser,
  getCurrentUser,
  getCurrentUserId,
  getContracts,
  getTransactions,
  getAffiliateStats,
  formatCurrency,
} from './db';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logFile = path.resolve(__dirname, '../bot.log');

function appendBotLog(message: string) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}\n`;
  try {
    fs.appendFileSync(logFile, line, 'utf-8');
  } catch (err) {
    console.error('Failed to write to bot.log:', err);
  }
}

const botToken = process.env.BOT_TOKEN?.trim() || '';
const hasValidToken = Boolean(botToken && botToken.includes(':'));

export const bot = hasValidToken ? new Telegraf(botToken) : null;

// ====================================================
// ۱. کیبوردهای اصلی ربات (Keyboards)
// ====================================================

export const MAIN_KEYBOARD = [
  ['🤝 ثبت معامله جدید', '📜 لیست معاملات من'],
  ['👤 پروفایل کاربری', '💳 کیف پول و اعتبار'],
  ['🎧 پشتیبانی و راهنمای استفاده 📖'],
  ['💎 پنل سفیران']
];

// ====================================================
// ۲. منطق مشترک شبیه‌ساز و ربات (Simulator & Bot Message Handler)
// ====================================================

export interface BotResponse {
  reply: string;
  keyboard?: string[][];
}

export function handleSimulatorMessage(text: string, userId?: number): BotResponse {
  const clean = text.trim();
  const currentUid = userId || getCurrentUserId();
  const user = getUser(currentUid) || getCurrentUser();

  if (clean === '/start' || clean === 'شروع' || clean === 'منو') {
    return {
      reply: `🤖 **سلام ${user.full_name}!**\n\nبه سامانه جامع واسطه‌گری امن و ثبت قراردادهای رسمی میانجی (Miyanji Escrow) خوش آمدید.\n\nاین سامانه با پوشش صندوق امانت اسکرو، صدور سند رسمی PDF و امضای الکترونیک، امنیت کامل معاملات فریلنسری و تجاری شما را تضمین می‌کند.`,
      keyboard: MAIN_KEYBOARD
    };
  }

  if (clean.includes('کیف پول') || clean.includes('اعتبار')) {
    return {
      reply: `💳 **کیف پول و وضعیت حساب کاربری**\n\n` +
        `👤 دارنده حساب: ${user.full_name}\n` +
        `💰 موجودی در دسترس: ${formatCurrency(user.wallet_balance)}\n` +
        `🔒 موجودی در امانت اسکرو: ${formatCurrency(user.escrow_locked_balance)}\n` +
        `🏦 شماره شبا: ${user.sheba || 'ثبت نشده'}\n` +
        `🪪 سطح احراز هویت: ${user.kyc_level === 'gold' ? 'طلایی 🌟 (شاهکار تایید شده)' : 'نقره‌ای 🥈'}\n\n` +
        `جهت شارژ موجودی یا ثبت درخواست تسویه پایا از گزینه‌های زیر استفاده نمایید.`,
      keyboard: [
        ['➕ شارژ کیف پول', '💸 درخواست تسویه و برداشت'],
        ['📋 گزارش تراکنش‌ها', '🔙 بازگشت به منوی اصلی']
      ]
    };
  }

  if (clean.includes('شارژ کیف پول')) {
    return {
      reply: `➕ **شارژ کیف پول میانجی**\n\n` +
        `جهت شارژ سریع از طریق درگاه مستقیم بانکی یا ثبت فیش کارت‌به‌کارت:\n\n` +
        `• حداقل مبلغ شارژ: ۱۰,۰۰۰ تومان\n` +
        `• درگاه امن شاپرک با تایید آنی\n\n` +
        `لطفاً مبلغ مورد نظر را در کنسول وب وارد فرمایید یا روی دکمه ورود به درگاه بزنید.`,
      keyboard: [
        ['🔙 بازگشت به منوی اصلی']
      ]
    };
  }

  if (clean.includes('تسویه') || clean.includes('برداشت')) {
    return {
      reply: `💸 **درخواست تسویه و برداشت وجه**\n\n` +
        `موجودی قابل برداشت شما: ${formatCurrency(user.wallet_balance)}\n` +
        `شماره شبا مقصد: ${user.sheba || 'ثبت نشده'}\n\n` +
        `تسویه‌حساب‌ها در اولین سیکل پایا بانک مرکزی پردازش و واریز می‌شوند.`,
      keyboard: [
        ['🔙 بازگشت به منوی اصلی']
      ]
    };
  }

  if (clean.includes('تراکنش') || clean.includes('گزارش')) {
    const txs = getTransactions(currentUid);
    const summary = txs.slice(0, 3).map((t, idx) => 
      `${idx + 1}. ${t.title} - ${formatCurrency(t.amount)} (${t.status === 'completed' ? '✅ موفق' : '⏳ در حال بررسی'})`
    ).join('\n');

    return {
      reply: `📋 **آخرین تراکنش‌های شما**\n\n${summary || 'تراکنشی یافت نشد.'}`,
      keyboard: [
        ['🔙 بازگشت به منوی اصلی']
      ]
    };
  }

  if (clean.includes('ثبت معامله')) {
    return {
      reply: `🤝 **ثبت معامله جدید در صندوق امانت میانجی**\n\n` +
        `لطفاً نقش خود را در این معامله مشخص نمایید:\n\n` +
        `• **کارفرما (خریدار)**: وجه در امانت قفل می‌شود تا پروژه تحویل گردد.\n` +
        `• **مجری (پیمانکار)**: شروع کار با تضمین قطعی وصول وجه پس از تایید تحویلی.`,
      keyboard: [
        ['💼 کارفرما (خریدار)', '🛠 مجری (پیمانکار)'],
        ['🔙 بازگشت به منوی اصلی']
      ]
    };
  }

  if (clean.includes('کارفرما') || clean.includes('مجری')) {
    return {
      reply: `📝 **ایجاد قرارداد اسکرو**\n\n` +
        `نقش شما ثبت گردید. هم‌اکنون می‌توانید از طریق پنل وب یا فرم ویزارد، موضوع، مبلغ و مهلت پروژه را تعیین کنید و لینک دعوت را برای طرف دوم بفرستید.\n\n` +
        `امکانات فعال:\n` +
        `✅ صدور سند رسمی PDF با گواهی دیجیتال\n` +
        `✅ قفل وجه در صندوق امانت\n` +
        `✅ داوری و حل اختلاف سه جانبه حقوقی`,
      keyboard: [
        ['📜 لیست معاملات من', '🔙 بازگشت به منوی اصلی']
      ]
    };
  }

  if (clean.includes('معاملات من') || clean.includes('لیست معاملات')) {
    const userDeals = getContracts({ userId: currentUid });
    const listText = userDeals.slice(0, 4).map((d, i) => {
      const statusFa = d.status === 'active' ? '🟢 درحال انجام' :
        d.status === 'work_submitted' ? '📦 تحویل داده شده' :
        d.status === 'completed' ? '🏁 تکمیل شده' :
        d.status === 'draft' ? '📁 پیش‌نویس' : '⏳ در انتظار اقدام';
      return `${i + 1}. ${d.title.slice(0, 32)} (${d.contract_id})\n   💰 مبلغ: ${formatCurrency(d.amount)} | وضعیت: ${statusFa}`;
    }).join('\n\n');

    return {
      reply: `📜 **لیست معاملات شما در سامانه میانجی**\n\n` +
        `تعداد معاملات ثبت‌شده: ${userDeals.length} فقره\n\n` +
        (listText || 'شما هنوز معامله‌ای ثبت نکرده‌اید.') +
        `\n\nجهت دریافت فایل PDF رسمی قرارداد یا پرداخت اسکرو به برگه قراردادها مراجعه فرمایید.`,
      keyboard: [
        ['🤝 ثبت معامله جدید', '🔙 بازگشت به منوی اصلی']
      ]
    };
  }

  if (clean.includes('پروفایل')) {
    return {
      reply: `👤 **پروفایل و مشخصات هویتی**\n\n` +
        `• نام و نام‌خانوادگی: ${user.full_name}\n` +
        `• شماره تماس: ${user.phone_number}\n` +
        `• کد ملی: ${user.national_id ? `${user.national_id.slice(0, 3)}***${user.national_id.slice(-3)}` : 'ثبت نشده'}\n` +
        `• وضعیت استعلام شاهکار: ${user.is_verified ? '✅ تایید شده رسمی' : '⚠️ در انتظار احراز هویت'}\n` +
        `• شماره شبا: ${user.sheba || 'ثبت نشده'}\n` +
        `• سطح کاربری: ${user.kyc_level === 'gold' ? 'طلایی 🌟' : 'نقره‌ای 🥈'}`,
      keyboard: [
        ['🪪 احراز هویت هوشمند', '🔙 بازگشت به منوی اصلی']
      ]
    };
  }

  if (clean.includes('سفیران') || clean.includes('همکاران')) {
    const stats = getAffiliateStats(currentUid);
    return {
      reply: `💎 **سامانه کسب درآمد و پنل سفیران میانجی**\n\n` +
        `با معرفی میانجی به دوستان و شبکه‌های اجتماعی خود، از هر معامله موفق کمیسیون نقدی دریافت کنید.\n\n` +
        `🔗 لینک اختصاصی شما:\n\`${stats.referral_link}\`\n\n` +
        `👥 تعداد کلیک: ${stats.total_clicks} | معرفی‌شدگان فعال: ${stats.total_invited}\n` +
        `💰 کل درآمد حاصله: ${formatCurrency(stats.total_commission_earned)}\n` +
        `💵 سود قابل برداشت: ${formatCurrency(stats.withdrawable_commission)}`,
      keyboard: [
        ['💸 برداشت سود سفیر به کیف پول', '🔙 بازگشت به منوی اصلی']
      ]
    };
  }

  if (clean.includes('پشتیبانی') || clean.includes('راهنما')) {
    return {
      reply: `🎧 **مرکز پشتیبانی و قوانین سامانه میانجی**\n\n` +
        `سامانه میانجی بر اساس قانون تجارت الکترونیک جمهوری اسلامی ایران (ماده ۶ و ۱۰) واسطهگری امن و صدور قراردادهای الکترونیک معتبر را فراهم ساخته است.\n\n` +
        `📌 **مراحل انجام معامله:**\n` +
        `۱. ثبت مشخصات، شرح تعهدات و مبلغ معامله\n` +
        `۲. امضای الکترونیک دوطرفه طرفین\n` +
        `۳. واریز و قفل وجه توسط کارفرما در حساب امانت\n` +
        `۴. انجام پروژه و تحویل فایل‌ها توسط مجری\n` +
        `۵. تایید کارفرما و آزادسازی فوری وجه به حساب مجری\n\n` +
        `⚖️ در صورت بروز هرگونه اختلاف، هیئت داوری حقوقی مستندات را بررسی و رای نهایی را صادر می‌نماید.`,
      keyboard: [
        ['🔙 بازگشت به منوی اصلی']
      ]
    };
  }

  return {
    reply: `پیام دریافت شد: "${clean}"\nلطفاً یکی از گزینه‌های منوی زیر را جهت ادامه انتخاب کنید:`,
    keyboard: MAIN_KEYBOARD
  };
}

// ====================================================
// ۳. راه‌اندازی ربات تلگرام Telegraf (Telegram Bot Polling)
// ====================================================

export function startBot() {
  appendBotLog('🚀 Initializing Miyanji Escrow Telegraf runtime in Node.js 22...');

  if (!bot) {
    const msg = 'ℹ️ Telegram Bot Token (BOT_TOKEN) is not set or invalid. Running in simulated console mode.';
    console.log(`[Miyanji Bot] ${msg}`);
    appendBotLog(msg);
    return;
  }

  try {
    bot.start((ctx) => {
      const res = handleSimulatorMessage('/start', ctx.from?.id);
      const keyboard = Markup.keyboard(res.keyboard || MAIN_KEYBOARD).resize();
      ctx.reply(res.reply, keyboard);
    });

    bot.help((ctx) => {
      const res = handleSimulatorMessage('راهنما', ctx.from?.id);
      ctx.reply(res.reply);
    });

    bot.on('text', (ctx) => {
      const text = ctx.message.text;
      const res = handleSimulatorMessage(text, ctx.from?.id);
      const keyboard = res.keyboard ? Markup.keyboard(res.keyboard).resize() : undefined;
      ctx.reply(res.reply, keyboard);
    });

    bot.catch((err: any, ctx) => {
      const errMsg = `⚠️ Telegram Bot error: ${err.message || err}`;
      console.error(errMsg);
      appendBotLog(errMsg);
    });

    bot.launch()
      .then(() => {
        const msg = `✅ Miyanji Telegram Bot connected and polling active for @${process.env.BOT_USERNAME || 'mianji_ir_bot'}`;
        console.log(`[Miyanji Bot] ${msg}`);
        appendBotLog(msg);
      })
      .catch((err: any) => {
        const errMsg = `⚠️ Failed to launch Telegram Bot polling: ${err.message || err}`;
        console.warn(`[Miyanji Bot] ${errMsg}`);
        appendBotLog(errMsg);
      });

    // Graceful stop
    process.once('SIGINT', () => bot?.stop('SIGINT'));
    process.once('SIGTERM', () => bot?.stop('SIGTERM'));
  } catch (err: any) {
    const errMsg = `⚠️ Error configuring bot: ${err.message || err}`;
    console.error(errMsg);
    appendBotLog(errMsg);
  }
}
