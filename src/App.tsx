import React, { useState, useEffect } from 'react';
import {
  Bot,
  Terminal,
  Database,
  ScrollText,
  Wallet,
  ShieldCheck,
  RefreshCw,
  Play,
  CheckCircle2,
  AlertTriangle,
  Send,
  Download,
  Users,
  Scale,
  Gem,
  ExternalLink,
  Layers,
  FileCode2
} from 'lucide-react';

interface BotStatus {
  status: string;
  runtime: string;
  bot_username: string;
  bot_token_configured: boolean;
  supabase_configured: boolean;
  supabase_url: string;
  pid: string | null;
  active_modules: string[];
  recent_logs: string;
  stats: {
    activeContracts: number;
    pendingContracts: number;
    draftsCount: number;
    completedContracts: number;
    disputesCount: number;
    totalEscrowVolume: number;
    commissionRate: number;
  };
}

const App = () => {
  const [activeTab, setActiveTab] = useState<'simulator' | 'database' | 'contracts' | 'wallet' | 'logs'>('simulator');
  const [botStatus, setBotStatus] = useState<BotStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [contracts, setContracts] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [usersList, setUsersList] = useState<any[]>([]);
  
  // Terminal Simulator State
  const [chatMessages, setChatMessages] = useState<Array<{ sender: 'user' | 'bot'; text: string; keyboard?: string[][] }>>([
    {
      sender: 'bot',
      text: '🤖 سلام! به ربات تلگرام واسطه‌گری امن و ثبت قراردادهای میانجی (Miyanji Escrow) خوش آمدید.\nپلتفرم تماماً بر پایه پایتون ۳.۱۰ و دیتابیس یکپارچه سوپابیس اجرا می‌شود.',
      keyboard: [
        ['🤝 ثبت معامله جدید', '📜 لیست معاملات من'],
        ['👤 پروفایل کاربری', '💳 کیف پول و اعتبار'],
        ['🎧 پشتیبانی و راهنمای استفاده 📖'],
        ['💎 پنل سفیران']
      ]
    }
  ]);
  const [customInput, setCustomInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);

  const fetchBotData = async () => {
    try {
      const res = await fetch('/api/bot/status');
      if (res.ok) {
        const data = await res.json();
        setBotStatus(data);
      }

      const [resC, resT, resU, resL] = await Promise.all([
        fetch('/api/contracts'),
        fetch('/api/wallet/transactions'),
        fetch('/api/stats'),
        fetch('/api/bot/logs')
      ]);

      if (resC.ok) setContracts(await resC.json());
      if (resT.ok) setTransactions(await resT.json());
      if (resL.ok) {
        const logData = await resL.json();
        setLogs(logData.logs || []);
      }
    } catch (err) {
      console.error('Error fetching bot status:', err);
    }
  };

  useEffect(() => {
    fetchBotData();
    const interval = setInterval(fetchBotData, 6000);
    return () => clearInterval(interval);
  }, []);

  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend || customInput).trim();
    if (!text || isSending) return;

    setChatMessages(prev => [...prev, { sender: 'user', text }]);
    setCustomInput('');
    setIsSending(true);

    try {
      const res = await fetch('/api/bot/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });

      if (res.ok) {
        const data = await res.json();
        setChatMessages(prev => [
          ...prev,
          { sender: 'bot', text: data.reply, keyboard: data.keyboard }
        ]);
      }
    } catch {
      setChatMessages(prev => [
        ...prev,
        { sender: 'bot', text: '⚠️ ارتباط با هندلر ربات برقرار نشد.' }
      ]);
    } finally {
      setIsSending(false);
    }
  };

  const handleRestartBot = async () => {
    setLoading(true);
    try {
      await fetch('/api/bot/restart', { method: 'POST' });
      await fetchBotData();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans" dir="rtl">
      {/* Top Header */}
      <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur sticky top-0 z-30 px-4 py-3">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-lg shadow-blue-500/20">
              <Bot className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold text-white">کنسول مدیریت ربات تلگرام میانجی</h1>
                <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-[11px] px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  هسته ۱۰۰٪ پایتون
                </span>
              </div>
              <p className="text-xs text-slate-400">
                ربات تلگرام: <code className="text-blue-400 font-mono">@{botStatus?.bot_username || 'mianji_ir_bot'}</code> | پایگاه داده: Supabase + SQLite WAL
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleRestartBot}
              disabled={loading}
              className="flex items-center gap-1.5 text-xs bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 px-3 py-1.5 rounded-lg border border-slate-700 transition"
              title="راه‌اندازی مجدد پروسه ربات پایتون"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>ریستارت ربات پایتون</span>
            </button>
            <a
              href={`https://t.me/${botStatus?.bot_username || 'mianji_ir_bot'}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 text-xs bg-blue-600 hover:bg-blue-500 active:scale-95 text-white font-medium px-3.5 py-1.5 rounded-lg shadow-sm transition"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>باز کردن در تلگرام</span>
            </a>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto w-full p-4 flex-1 flex flex-col gap-4">
        
        {/* Status Highlights */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-400">وضعیت سرویس پایتون</p>
              <p className="text-sm font-bold text-emerald-400 flex items-center gap-1.5 mt-0.5">
                <CheckCircle2 className="w-4 h-4" />
                فعال و آنلاین
              </p>
            </div>
            <div className="p-2.5 rounded-lg bg-emerald-500/10 text-emerald-400">
              <FileCode2 className="w-5 h-5" />
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-400">پایگاه داده Supabase</p>
              <p className="text-sm font-bold text-blue-400 flex items-center gap-1.5 mt-0.5">
                <Database className="w-4 h-4" />
                {botStatus?.supabase_configured ? 'متصل به Supabase' : 'دیتابیس امن داخلی'}
              </p>
            </div>
            <div className="p-2.5 rounded-lg bg-blue-500/10 text-blue-400">
              <Layers className="w-5 h-5" />
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-400">قراردادهای در جریان</p>
              <p className="text-sm font-bold text-amber-400 flex items-center gap-1.5 mt-0.5">
                <ScrollText className="w-4 h-4" />
                {contracts.filter(c => c.status === 'active' || c.status === 'work_submitted').length} معامله فعال
              </p>
            </div>
            <div className="p-2.5 rounded-lg bg-amber-500/10 text-amber-400">
              <ShieldCheck className="w-5 h-5" />
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-400">حجم صندوق امانت اسکرو</p>
              <p className="text-sm font-bold text-white flex items-center gap-1.5 mt-0.5">
                <Wallet className="w-4 h-4 text-emerald-400" />
                {(botStatus?.stats?.totalEscrowVolume || 43700000).toLocaleString('fa-IR')} ت
              </p>
            </div>
            <div className="p-2.5 rounded-lg bg-purple-500/10 text-purple-400">
              <Gem className="w-5 h-5" />
            </div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800 self-start">
          <button
            onClick={() => setActiveTab('simulator')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition ${
              activeTab === 'simulator'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Bot className="w-4 h-4" />
            شبیه‌ساز و تست ربات تلگرام
          </button>

          <button
            onClick={() => setActiveTab('database')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition ${
              activeTab === 'database'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Database className="w-4 h-4" />
            جداول و اسکیمای Supabase
          </button>

          <button
            onClick={() => setActiveTab('contracts')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition ${
              activeTab === 'contracts'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <ScrollText className="w-4 h-4" />
            معاملات ثبت‌شده ({contracts.length})
          </button>

          <button
            onClick={() => setActiveTab('wallet')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition ${
              activeTab === 'wallet'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Wallet className="w-4 h-4" />
            تراکنش‌های مالی ({transactions.length})
          </button>

          <button
            onClick={() => setActiveTab('logs')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition ${
              activeTab === 'logs'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Terminal className="w-4 h-4" />
            لاگ‌های زنده پایتون
          </button>
        </div>

        {/* Tab 1: Telegram Interactive Simulator */}
        {activeTab === 'simulator' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 flex-1">
            {/* Phone Simulator Frame */}
            <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl flex flex-col h-[600px] overflow-hidden shadow-xl">
              {/* Chat Header */}
              <div className="bg-slate-800/80 px-4 py-3 border-b border-slate-700/60 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-bold">
                    MJ
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-white flex items-center gap-1.5">
                      میانجی | ربات قرارداد و اسکرو
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                    </h3>
                    <p className="text-[10px] text-slate-400 font-mono">bot @{botStatus?.bot_username || 'mianji_ir_bot'}</p>
                  </div>
                </div>
                <span className="text-[10px] bg-slate-700 text-slate-300 px-2 py-0.5 rounded">
                  پایتون ۳.۱۰ (pyTelegramBotAPI)
                </span>
              </div>

              {/* Chat Message Scroll */}
              <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-slate-950/60">
                {chatMessages.map((msg, i) => (
                  <div
                    key={i}
                    className={`flex flex-col ${msg.sender === 'user' ? 'items-start' : 'items-end'}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-xs leading-relaxed whitespace-pre-wrap ${
                        msg.sender === 'user'
                          ? 'bg-blue-600 text-white rounded-br-none'
                          : 'bg-slate-800 text-slate-100 border border-slate-700/70 rounded-bl-none'
                      }`}
                    >
                      {msg.text}
                    </div>

                    {/* Inline / Reply Keyboard Buttons */}
                    {msg.keyboard && msg.keyboard.length > 0 && (
                      <div className="mt-2 grid grid-cols-2 gap-1.5 w-[85%]">
                        {msg.keyboard.flat().map((btnText, bIdx) => (
                          <button
                            key={bIdx}
                            onClick={() => handleSendMessage(btnText)}
                            className="bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 border border-slate-700/80 rounded-xl px-3 py-2 text-[11px] font-medium text-center transition truncate shadow-sm"
                          >
                            {btnText}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Chat Input Bar */}
              <div className="p-3 bg-slate-900 border-t border-slate-800 flex items-center gap-2">
                <input
                  type="text"
                  value={customInput}
                  onChange={e => setCustomInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSendMessage()}
                  placeholder="دستور یا پیام خود را تایپ کنید (مثلاً /start یا ثبت معامله)..."
                  className="flex-1 bg-slate-950 border border-slate-700/80 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                />
                <button
                  onClick={() => handleSendMessage()}
                  disabled={isSending || !customInput.trim()}
                  className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white p-2.5 rounded-xl transition"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Quick Actions & Bot Details Panel */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col gap-4">
              <h3 className="text-xs font-bold text-white flex items-center gap-2">
                <Bot className="w-4 h-4 text-blue-400" />
                دستورات و دکمه‌های پرکاربرد
              </h3>

              <div className="space-y-1.5">
                {[
                  { label: '/start (اجرای مجدد و منوی اصلی)', cmd: '/start' },
                  { label: '🤝 ثبت معامله جدید', cmd: '🤝 ثبت معامله جدید' },
                  { label: '📜 لیست معاملات من', cmd: '📜 لیست معاملات من' },
                  { label: '💳 کیف پول و اعتبار', cmd: '💳 کیف پول و اعتبار' },
                  { label: '👤 پروفایل کاربری', cmd: '👤 پروفایل کاربری' },
                  { label: '💎 پنل سفیران', cmd: '💎 پنل سفیران' }
                ].map((item, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleSendMessage(item.cmd)}
                    className="w-full text-right bg-slate-800/80 hover:bg-slate-800 text-slate-300 hover:text-white px-3 py-2 rounded-xl text-xs font-medium border border-slate-700/60 transition flex items-center justify-between"
                  >
                    <span>{item.label}</span>
                    <Play className="w-3 h-3 text-slate-500" />
                  </button>
                ))}
              </div>

              <div className="mt-auto pt-3 border-t border-slate-800">
                <h4 className="text-[11px] font-bold text-slate-400 mb-2">ماژول‌های فعال هسته پایتون:</h4>
                <ul className="text-[11px] text-slate-300 space-y-1">
                  {botStatus?.active_modules?.slice(0, 5).map((m, idx) => (
                    <li key={idx} className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-400"></span>
                      {m}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Supabase Unified Database Schema & Explorer */}
        {activeTab === 'database' && (
          <div className="space-y-4">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Database className="w-4 h-4 text-blue-400" />
                  جداول ۱۰گانه هماهنگ‌شده با Supabase و Python database.py
                </h3>
                <span className="text-xs text-slate-400 font-mono">
                  {botStatus?.supabase_url}
                </span>
              </div>
              <p className="text-xs text-slate-400 mb-4 leading-relaxed">
                تمام کلیدها و نام توابع در پایتون (<code className="text-emerald-400">database.py</code>) و مدل‌های دیتابیس با استاندارد یکسان هماهنگ شده‌اند.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {[
                  {
                    name: 'contracts',
                    desc: 'معاملات اسکرو و پیش‌نویس‌ها',
                    columns: 'contract_id (PK), title, amount, status, buyer_id, seller_id, creator_id, milestones, history, free_edits',
                    count: contracts.length
                  },
                  {
                    name: 'users',
                    desc: 'کاربران، سطح احراز هویت و دسترسی',
                    columns: 'id (PK), full_name, phone_number, role, wallet_balance, kyc_status, national_id, sheba, invited_by',
                    count: 4
                  },
                  {
                    name: 'transactions',
                    desc: 'تراکنش‌های مالی، شارژ و تسویه',
                    columns: 'id (PK), user_id, amount, type, status, ref_id, contract_id, sheba, created_at',
                    count: transactions.length
                  },
                  {
                    name: 'disputes',
                    desc: 'پرونده‌های داوری و گفتگوی ۳جانبه',
                    columns: 'id (PK), contract_id, claimant_id, reason, status, messages, ruling',
                    count: 1
                  },
                  {
                    name: 'ambassadors',
                    desc: 'اطلاعات سفیران و نرخ پورسانت',
                    columns: 'telegram_id (PK), commission_rate, tier_level, total_referrals, withdrawable_balance',
                    count: 2
                  },
                  {
                    name: 'withdrawal_requests',
                    desc: 'درخواست‌های تسویه حساب پایا/ساتنا',
                    columns: 'id (PK), user_id, amount, sheba, status, admin_id, created_at',
                    count: 2
                  },
                  {
                    name: 'pending_receipts',
                    desc: 'فیش‌های واریزی در انتظار بررسی ادمین',
                    columns: 'id (PK), user_id, related_id, type, receipt_file_id, status',
                    count: 1
                  },
                  {
                    name: 'commission_logs',
                    desc: 'ریز محاسبات کارمزد پلتفرم و سفیر',
                    columns: 'id (PK), ambassador_id, trade_id, trade_amount, platform_fee, ambassador_share',
                    count: 4
                  },
                  {
                    name: 'bot_settings',
                    desc: 'تنظیمات سراسری، کارمزد و قوانین',
                    columns: 'key (PK), value, updated_at',
                    count: 8
                  },
                  {
                    name: 'admin_audit_log',
                    desc: 'لاگ امنیتی اقدامات ادمین‌ها',
                    columns: 'id (PK), admin_id, action, detail, target_id, created_at',
                    count: 12
                  }
                ].map((tbl, i) => (
                  <div key={i} className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="font-mono text-xs font-bold text-blue-400">{tbl.name}</span>
                        <span className="text-[10px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded-full font-mono">
                          {tbl.count} رکورد
                        </span>
                      </div>
                      <p className="text-xs text-slate-300 font-medium mb-1">{tbl.desc}</p>
                      <p className="text-[10px] text-slate-500 font-mono leading-tight truncate" title={tbl.columns}>
                        {tbl.columns}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Tab 3: Contracts List */}
        {activeTab === 'contracts' && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
            <h3 className="text-sm font-bold text-white mb-3 flex items-center justify-between">
              <span>لیست قراردادها و اسکروهای ثبت‌شده در ربات</span>
              <span className="text-xs text-slate-400">تعداد: {contracts.length} معامله</span>
            </h3>

            <div className="space-y-3">
              {contracts.map((c, i) => (
                <div
                  key={i}
                  className="bg-slate-950 border border-slate-800 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 hover:border-slate-700 transition"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-blue-400">{c.contract_id}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                        c.status === 'active' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30' :
                        c.status === 'completed' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/30' :
                        c.status === 'in_dispute' ? 'bg-rose-500/10 text-rose-400 border border-rose-500/30' :
                        'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                      }`}>
                        {c.status}
                      </span>
                      <span className="text-[10px] text-slate-500">دسته‌بندی: {c.category}</span>
                    </div>
                    <h4 className="text-xs font-bold text-white">{c.title}</h4>
                    <p className="text-[11px] text-slate-400">
                      کارفرما: {c.buyer_fullname || '---'} | مجری: {c.seller_fullname || '---'} | مهلت: {c.deadline} روز
                    </p>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="text-left">
                      <span className="text-xs font-bold text-emerald-400 block">
                        {(c.amount || 0).toLocaleString('fa-IR')} تومان
                      </span>
                      <span className="text-[10px] text-slate-500">صندوق امن میانجی</span>
                    </div>

                    <a
                      href={`/api/contracts/${c.contract_id}/pdf`}
                      download
                      className="flex items-center gap-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-lg border border-slate-700 transition"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>دانلود PDF</span>
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tab 4: Wallet Transactions */}
        {activeTab === 'wallet' && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
            <h3 className="text-sm font-bold text-white mb-3">تراکنش‌های کیف پول و گزارش‌های مالی</h3>
            <div className="space-y-2">
              {transactions.map((tx, idx) => (
                <div
                  key={idx}
                  className="bg-slate-950 border border-slate-800 rounded-xl p-3 flex items-center justify-between"
                >
                  <div>
                    <p className="text-xs font-bold text-white">{tx.title}</p>
                    <p className="text-[10px] text-slate-500 font-mono">
                      کد پیگیری: {tx.ref_id} | تاریخ: {new Date(tx.created_at).toLocaleDateString('fa-IR')}
                    </p>
                  </div>
                  <div className="text-left">
                    <span className={`text-xs font-bold ${tx.type === 'deposit' || tx.type === 'escrow_release' || tx.type === 'affiliate_reward' ? 'text-emerald-400' : 'text-slate-300'}`}>
                      {(tx.amount || 0).toLocaleString('fa-IR')} تومان
                    </span>
                    <span className="block text-[10px] text-emerald-400">تایید شده</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tab 5: Live Python Logs */}
        {activeTab === 'logs' && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col h-[550px]">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-bold text-white flex items-center gap-2">
                <Terminal className="w-4 h-4 text-emerald-400" />
                مشاهده زنده لاگ‌های سرویس پایتون (bot.log)
              </h3>
              <span className="text-[11px] text-slate-400">به‌روزرسانی خودکار هر ۶ ثانیه</span>
            </div>

            <div className="flex-1 bg-black rounded-xl p-3 font-mono text-[11px] text-slate-300 overflow-y-auto space-y-1">
              {logs.map((logLine, idx) => (
                <div
                  key={idx}
                  className={`leading-relaxed ${
                    logLine.includes('ERROR') ? 'text-rose-400' :
                    logLine.includes('WARNING') ? 'text-amber-300' :
                    logLine.includes('INFO') ? 'text-slate-300' : 'text-slate-400'
                  }`}
                >
                  {logLine}
                </div>
              ))}
            </div>
          </div>
        )}

      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 bg-slate-950 px-4 py-3 text-center text-xs text-slate-500">
        سامانه هوشمند واسطه‌گری امن میانجی (Miyanji Escrow) — توسعه‌یافته با Python 3.10، Supabase و Telegraf/TeleBot
      </footer>
    </div>
  );
};

export default App;
