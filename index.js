const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error('❌ BOT_TOKEN غير موجود في Secrets / Environment Variables');
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });
const OWNER_ID = Number(process.env.OWNER_ID || 7923337516);
const CHANNEL_USERNAME = String(process.env.CHANNEL_USERNAME || 'Pubg_Libya_Store').replace(/^@/, '').toLowerCase();
const DATA_FILE = path.resolve(process.env.DATA_FILE || path.join(__dirname, 'brand-data.json'));
const OWNER_BUTTON = '⚙️ لوحة تحكم المالك';
const PAGE_SIZE = 8;

const DEFAULT_SETTINGS = {
  welcome: `🔥 مرحبًا بك في بوت BRAND Libya 🇱🇾

🎮 كل خدمات PUBG في مكان واحد

💎 شحن UC
🛒 بيع وشراء الحسابات
🎁 المسابقات والسحوبات
📞 تواصل معنا في أي وقت

👇 اختر الخدمة التي تريدها من الأزرار بالأسفل`,
  buttons: {
    latest: '🔥 آخر الحسابات',
    search: '🔍 البحث عن حساب',
    publish: '📋 طلب نشر حساب',
    charge: '💎 شحن UC والألعاب',
    rating: '⭐ تقييم الخدمة',
    contact: '📞 التواصل مع الإدارة',
    contests: '🎁 المسابقات والسحوبات'
  },
  publishMsg: `📋 طلب نشر حساب

لإضافة حساب للبيع، أرسل بيانات الحساب وصوره هنا.

📞 للتواصل:
{contact}`,
  pricesMsg: `🎮 شحن شدات PUBG

🟢📱 المدار الجديد
الشحن عن طريق رصيد المدار:

• 60 شدة — 14 رصيد
• 325 شدة — 69 رصيد
• 660 شدة — 135 رصيد
• 1800 شدة — 335 رصيد
• 3050 شدة — 670 رصيد

🟣📱 ليبيانا
الشحن عن طريق رصيد ليبيانا:

• 60 شدة — 12 رصيد
• 325 شدة — 60 رصيد
• 660 شدة — 120 رصيد
• 1800 شدة — 300 رصيد
• 3850 شدة — 600 رصيد

🏦 المصرف
الشحن عن طريق المصرف:

• 60 شدة — 11 د.ل
• 325 شدة — 52 د.ل
• 660 شدة — 100 د.ل
• 1800 شدة — 255 د.ل
• 3850 شدة — 500 د.ل

🔥 توجد باقات أعلى وتوفير حسب الطلب.

📞 للتفاصيل والتواصل:
{contact}`,
  contestsMsg: '🎁 المسابقات والسحوبات\n\nتابع القناة لمعرفة آخر المسابقات والسحوبات.',
  contacts: { publish: '@dy_x2', charge: '@violletry', admin: '@dy_x2 @violletry' }
};

function clone(v) { return JSON.parse(JSON.stringify(v)); }
function defaultDb() {
  return { settings: clone(DEFAULT_SETTINGS), accounts: [], nextAccountNumber: 1,
    ratings: [], ratedUsers: {}, reviews: [] };
}
function mergeSettings(saved) {
  const s = clone(DEFAULT_SETTINGS);
  if (!saved || typeof saved !== 'object') return s;
  for (const key of ['welcome', 'publishMsg', 'pricesMsg', 'contestsMsg']) {
    if (typeof saved[key] === 'string' && saved[key].trim()) s[key] = saved[key];
  }
  if (saved.buttons && typeof saved.buttons === 'object') {
    for (const key of Object.keys(s.buttons)) {
      if (typeof saved.buttons[key] === 'string' && saved.buttons[key].trim()) s.buttons[key] = saved.buttons[key];
    }
  }
  if (saved.contacts && typeof saved.contacts === 'object') {
    for (const key of Object.keys(s.contacts)) {
      if (typeof saved.contacts[key] === 'string' && saved.contacts[key].trim()) s.contacts[key] = saved.contacts[key];
    }
  }
  return s;
}
function loadData() {
  if (!fs.existsSync(DATA_FILE)) return defaultDb();
  try {
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    const db = defaultDb();
    db.settings = mergeSettings(raw.settings);
    db.accounts = Array.isArray(raw.accounts) ? raw.accounts.filter(a => a && typeof a.number === 'string') : [];
    db.ratings = Array.isArray(raw.ratings) ? raw.ratings.filter(n => Number.isInteger(n) && n >= 1 && n <= 5) : [];
    db.ratedUsers = raw.ratedUsers && typeof raw.ratedUsers === 'object' && !Array.isArray(raw.ratedUsers) ? raw.ratedUsers : {};
    db.reviews = Array.isArray(raw.reviews) ? raw.reviews : [];
    const max = db.accounts.reduce((m, a) => Math.max(m, parseInt(String(a.number).replace('#', ''), 10) || 0), 0);
    db.nextAccountNumber = Math.max(parseInt(raw.nextAccountNumber, 10) || 1, max + 1);
    return db;
  } catch (e) {
    console.error('❌ ملف البيانات تالف:', e.message);
    try { fs.copyFileSync(DATA_FILE, `${DATA_FILE}.corrupt-${Date.now()}`); } catch (_) {}
    return defaultDb();
  }
}
const db = loadData();
function saveData() {
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    const tmp = `${DATA_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
    fs.renameSync(tmp, DATA_FILE);
    return true;
  } catch (e) {
    console.error('❌ تعذر حفظ البيانات:', e.message);
    return false;
  }
}
const ownerState = new Map();
const waitingForReview = new Map();
const mediaGroups = new Map();
const isOwner = id => Number(id) === OWNER_ID;

function keyboardFor(userId) {
  const b = db.settings.buttons;
  const rows = [[b.latest, b.search], [b.publish, b.charge], [b.rating, b.contact], [b.contests]];
  if (isOwner(userId)) rows.push([OWNER_BUTTON]);
  return { reply_markup: { keyboard: rows, resize_keyboard: true, persistent: true } };
}
function buttonKey(text) {
  return Object.keys(db.settings.buttons).find(k => db.settings.buttons[k] === text) || null;
}
function normalizeHandles(str) {
  return String(str || '').split(/[\s,،]+/).map(s => s.trim()).filter(Boolean)
    .map(s => /^[A-Za-z0-9_]{3,32}$/.test(s) ? `@${s}` : s);
}
function validHandle(s) { return /^(@[A-Za-z0-9_]{3,32}|https?:\/\/\S+)$/.test(s); }
function contactLines(which) { return normalizeHandles(db.settings.contacts[which]).join('\n'); }
function fillContact(text, which) { return String(text).replace(/\{contact\}/g, contactLines(which)); }
function nextNumber() { return `#${String(db.nextAccountNumber).padStart(3, '0')}`; }
function findAccount(input) {
  const n = parseInt(String(input || '').trim().replace('#', ''), 10);
  if (!Number.isFinite(n)) return null;
  return db.accounts.find(a => parseInt(String(a.number).replace('#', ''), 10) === n) || null;
}
function accountSnippet(a) {
  return String(a.text || '').replace(/🧾 رقم الحساب:\s*#\d+/, '').trim().split('\n')[0].slice(0, 40) || '—';
}
async function sendAccount(chatId, account, userId) {
  const kb = keyboardFor(userId === undefined ? chatId : userId);
  if (!account) return bot.sendMessage(chatId, '❌ هذا الحساب غير موجود.', kb);
  const photos = Array.isArray(account.photos) ? account.photos.slice(0, 10) : [];
  const caption = `🧾 رقم الحساب: ${account.number}\n\n${account.text || ''}`;
  if (photos.length) {
    try {
      const media = photos.map((p, i) => ({ type: 'photo', media: p, ...(i === 0 ? { caption: caption.slice(0, 1024) } : {}) }));
      await bot.sendMediaGroup(chatId, media);
      if (caption.length > 1024) await bot.sendMessage(chatId, caption.slice(1024), kb);
      return;
    } catch (e) { console.error('تعذر إرسال الألبوم:', e.message); }
  }
  return bot.sendMessage(chatId, caption, kb);
}
function ratingInfo() {
  const count = db.ratings.length;
  const avg = count ? db.ratings.reduce((s, n) => s + n, 0) / count : 0;
  return { count, average: avg.toFixed(1) };
}
function stars(avg) {
  const n = Math.round(Number(avg));
  return '⭐'.repeat(n) + '☆'.repeat(5 - n);
}
function panelMarkup() {
  return { inline_keyboard: [
    [{ text: '👋 رسالة الترحيب', callback_data: 'own_edit_welcome' }, { text: '🔘 أسماء الأزرار', callback_data: 'own_buttons' }],
    [{ text: '📋 رسالة طلب نشر الحسابات', callback_data: 'own_edit_publishMsg' }],
    [{ text: '💎 أسعار الشحن', callback_data: 'own_edit_pricesMsg' }, { text: '🎁 رسالة المسابقات', callback_data: 'own_edit_contestsMsg' }],
    [{ text: '📞 جهات التواصل', callback_data: 'own_contacts' }],
    [{ text: '🧾 إدارة الحسابات', callback_data: 'own_accounts_0' }, { text: '⭐ التقييمات', callback_data: 'own_ratings' }],
    [{ text: '❌ إغلاق', callback_data: 'own_close' }]
  ]};
}
const PANEL_TEXT = '⚙️ لوحة تحكم المالك\n\nاختر ما تريد تعديله 👇';
function backPanel() { return { inline_keyboard: [[{ text: '⚙️ لوحة التحكم', callback_data: 'own_menu' }]] }; }
function cancelMarkup(extra) {
  const rows = [];
  if (extra) rows.push(extra);
  rows.push([{ text: '✖️ إلغاء', callback_data: 'own_cancel' }]);
  return { inline_keyboard: rows };
}
async function show(query, text, markup) {
  try {
    await bot.editMessageText(text, { chat_id: query.message.chat.id, message_id: query.message.message_id,
      reply_markup: markup || { inline_keyboard: [] } });
  } catch (e) {
    if (/not modified/i.test(e.message)) return;
    await bot.sendMessage(query.message.chat.id, text, { reply_markup: markup || { inline_keyboard: [] } });
  }
}
const TEXT_FIELDS = {
  welcome: '👋 رسالة الترحيب',
  publishMsg: '📋 رسالة طلب نشر الحسابات',
  pricesMsg: '💎 أسعار الشحن',
  contestsMsg: '🎁 رسالة المسابقات'
};
const BUTTON_LABELS = {
  latest: 'آخر الحسابات', search: 'البحث عن حساب', publish: 'طلب نشر حساب',
  charge: 'شحن UC والألعاب', rating: 'تقييم الخدمة', contact: 'التواصل مع الإدارة', contests: 'المسابقات والسحوبات'
};
const CONTACT_LABELS = { publish: '📋 طلب نشر الحساب', charge: '💎 شحن UC والألعاب', admin: '📞 التواصل مع الإدارة' };

function accountsPage(page) {
  const list = db.accounts.slice().reverse();
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  page = Math.max(0, Math.min(Number(page) || 0, pages - 1));
  const items = list.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  if (!list.length) return { text: '🧾 إدارة الحسابات\n\nلا توجد حسابات محفوظة حاليًا.', markup: backPanel() };
  const rows = items.map(a => [
    { text: `👁 ${a.number}`, callback_data: `own_view_${a.number.replace('#', '')}` },
    { text: `🗑 حذف ${a.number}`, callback_data: `own_del_${a.number.replace('#', '')}` }
  ]);
  const nav = [];
  if (page > 0) nav.push({ text: '⬅️ الأحدث', callback_data: `own_accounts_${page - 1}` });
  if (page < pages - 1) nav.push({ text: 'الأقدم ➡️', callback_data: `own_accounts_${page + 1}` });
  if (nav.length) rows.push(nav);
  rows.push([{ text: '⚙️ لوحة التحكم', callback_data: 'own_menu' }]);
  return { text: `🧾 إدارة الحسابات (${list.length})\nصفحة ${page + 1} / ${pages}\n\n${items.map(a => `${a.number} — ${accountSnippet(a)}`).join('\n')}\n\n⚠️ الحذف من بيانات البوت فقط ولا يحذف منشور القناة.`, markup: { inline_keyboard: rows } };
}
function ratingsReport() {
  const info = ratingInfo();
  const counts = [5,4,3,2,1].map(n => `${'⭐'.repeat(n)}: ${db.ratings.filter(x => x === n).length}`);
  const notes = db.reviews.slice(-10).reverse().map(r => `${'⭐'.repeat(r.rating || 0)} ${r.note}`).join('\n\n');
  return (`⭐ التقييمات\n\n${stars(info.average)}\nالمتوسط: ${info.average} / 5\nعدد التقييمات: ${info.count}\n\n${counts.join('\n')}\n\n📝 آخر الملاحظات:\n\n${notes || 'لا توجد ملاحظات بعد.'}`).slice(0, 4000);
}
async function saveAccount(messages) {
  if (!messages || !messages.length) return;
  messages.sort((a,b) => a.message_id - b.message_id);
  const first = messages.find(m => m.caption || m.text) || messages[0];
  let text = first.caption || first.text || messages.map(m => m.caption || m.text || '').find(Boolean) || '';
  if (!/ببجي|بـبـجي|pubg/i.test(text)) return;
  const signature = messages.map(m => m.message_id).join(',');
  if (db.accounts.some(a => a.signature === signature || a.messageId === first.message_id)) return;
  const photos = [];
  for (const m of messages) {
    if (m.photo && m.photo.length) photos.push(m.photo[m.photo.length - 1].file_id);
  }
  const number = nextNumber();
  const account = { number, messageId: first.message_id, signature, text, photos: photos.slice(0,10), date: Date.now() };
  db.accounts.push(account);
  db.nextAccountNumber++;
  if (!saveData()) console.error('⚠️ الحساب محفوظ مؤقتًا في الذاكرة فقط بسبب مشكلة في التخزين.');
  if (!text.includes(`🧾 رقم الحساب: ${number}`)) {
    const newText = `🧾 رقم الحساب: ${number}\n\n${text}`;
    try {
      if (first.caption !== undefined) await bot.editMessageCaption(newText.slice(0,1024), { chat_id: first.chat.id, message_id: first.message_id });
      else if (first.text) await bot.editMessageText(newText, { chat_id: first.chat.id, message_id: first.message_id });
      account.text = newText;
      saveData();
    } catch (e) { console.error('تعذر إضافة رقم الحساب للمنشور:', e.message); }
  }
  console.log(`✅ تم حفظ الحساب ${number} | الصور: ${photos.length}`);
}

bot.onText(/^\/start(?:@\w+)?(?:\s|$)/, msg => {
  const id = msg.from?.id ?? msg.chat.id;
  ownerState.delete(id);
  return bot.sendMessage(msg.chat.id, db.settings.welcome, keyboardFor(id));
});
bot.onText(/^\/admin(?:@\w+)?$/, msg => {
  const id = msg.from?.id;
  if (!isOwner(id) || msg.chat.type !== 'private') return bot.sendMessage(msg.chat.id, '⛔ هذه الخدمة للمالك فقط.', keyboardFor(id));
  ownerState.delete(id);
  return bot.sendMessage(msg.chat.id, PANEL_TEXT, { reply_markup: panelMarkup() });
});
bot.onText(/^\/cancel(?:@\w+)?$/, msg => {
  const id = msg.from?.id;
  if (isOwner(id) && ownerState.has(id)) {
    ownerState.delete(id);
    return bot.sendMessage(msg.chat.id, '✖️ تم الإلغاء.', { reply_markup: backPanel() });
  }
});

bot.on('channel_post', async msg => {
  try {
    if (!msg.chat.username || msg.chat.username.toLowerCase() !== CHANNEL_USERNAME) return;
    if (msg.media_group_id) {
      let entry = mediaGroups.get(msg.media_group_id);
      if (!entry) { entry = { messages: [], timer: null }; mediaGroups.set(msg.media_group_id, entry); }
      entry.messages.push(msg);
      if (entry.timer) clearTimeout(entry.timer);
      entry.timer = setTimeout(async () => {
        const current = mediaGroups.get(msg.media_group_id);
        mediaGroups.delete(msg.media_group_id);
        if (current) await saveAccount(current.messages);
      }, 1800);
      return;
    }
    await saveAccount([msg]);
  } catch (e) { console.error('خطأ في منشور القناة:', e.message); }
});

bot.on('message', async msg => {
  try {
    const chatId = msg.chat.id, text = msg.text, userId = msg.from?.id ?? chatId;
    if (!text || /^\/(start|admin|cancel)(@\w+)?(?:\s|$)/.test(text)) return;
    const kb = keyboardFor(userId);
    const ownerPrivate = isOwner(userId) && msg.chat.type === 'private';
    const menuKey = buttonKey(text);

    if (text === OWNER_BUTTON) {
      if (!ownerPrivate) return bot.sendMessage(chatId, '⛔ هذه الخدمة للمالك فقط.', kb);
      ownerState.delete(userId);
      return bot.sendMessage(chatId, PANEL_TEXT, { reply_markup: panelMarkup() });
    }
    if (ownerPrivate && ownerState.has(userId)) {
      if (menuKey) ownerState.delete(userId);
      else {
        const state = ownerState.get(userId), value = text.trim();
        if (!value || value.length > 4000) return bot.sendMessage(chatId, '❌ النص لازم يكون بين 1 و4000 حرف.', { reply_markup: cancelMarkup() });
        if (state.type === 'field') {
          db.settings[state.field] = value; ownerState.delete(userId);
          const ok = saveData();
          return bot.sendMessage(chatId, ok ? `✅ تم حفظ: ${TEXT_FIELDS[state.field]}` : '⚠️ تعذر حفظ الملف؛ راجع التخزين.', { reply_markup: backPanel() });
        }
        if (state.type === 'button') {
          if (value.length > 40 || value.includes('\n') || value === OWNER_BUTTON ||
            Object.keys(db.settings.buttons).some(k => k !== state.key && db.settings.buttons[k] === value)) {
            return bot.sendMessage(chatId, '❌ الاسم غير صالح أو مستخدم. جرّب اسمًا مختلفًا.', { reply_markup: cancelMarkup() });
          }
          db.settings.buttons[state.key] = value; ownerState.delete(userId); saveData();
          return bot.sendMessage(chatId, `✅ تم تغيير اسم الزر إلى: ${value}`, keyboardFor(userId));
        }
        if (state.type === 'contact') {
          const handles = normalizeHandles(value);
          if (!handles.length || !handles.every(validHandle)) return bot.sendMessage(chatId, '❌ أرسل @username صحيحًا أو رابطًا، وافصل بين أكثر من جهة بمسافة.', { reply_markup: cancelMarkup() });
          db.settings.contacts[state.which] = handles.join(' '); ownerState.delete(userId); saveData();
          return bot.sendMessage(chatId, `✅ تم حفظ جهات التواصل:\n${handles.join('\n')}`, { reply_markup: backPanel() });
        }
      }
    }
    if (waitingForReview.has(userId)) {
      const rating = waitingForReview.get(userId);
      waitingForReview.delete(userId);
      db.reviews.push({ userId, rating, note: text.slice(0,500), date: Date.now() });
      if (db.reviews.length > 1000) db.reviews.splice(0, db.reviews.length - 1000);
      saveData();
      return bot.sendMessage(chatId, '❤️ شكراً لك! تم استلام ملاحظتك.', kb);
    }
    if (menuKey === 'latest') {
      if (!db.accounts.length) return bot.sendMessage(chatId, '🔥 آخر الحسابات:\n\nلا توجد حسابات منشورة بعد.', kb);
      const rows = db.accounts.slice(-10).reverse().map(a => [{ text: `🧾 ${a.number}`, callback_data: `account_${a.number.replace('#','')}` }]);
      rows.push([{ text: '🏠 القائمة الرئيسية', callback_data: 'main_menu' }]);
      return bot.sendMessage(chatId, '🔥 آخر الحسابات\n\nاختر رقم الحساب الذي تريد رؤيته 👇', { reply_markup: { inline_keyboard: rows } });
    }
    if (menuKey === 'search') return bot.sendMessage(chatId, '🔍 أرسل رقم الحساب أو كلمة للبحث. مثال: #001', kb);
    if (menuKey === 'publish') return bot.sendMessage(chatId, fillContact(db.settings.publishMsg, 'publish'), kb);
    if (menuKey === 'charge') return bot.sendMessage(chatId, fillContact(db.settings.pricesMsg, 'charge'), kb);
    if (menuKey === 'rating') {
      const info = ratingInfo();
      return bot.sendMessage(chatId, `⭐ تقييم خدمة BRAND | PUBG\n\n${stars(info.average)}\n⭐ المتوسط: ${info.average} / 5\n👥 عدد التقييمات: ${info.count}\n\n👇 اختر تقييمك:`, { reply_markup: { inline_keyboard: [
        [{text:'⭐',callback_data:'rate_1'},{text:'⭐⭐',callback_data:'rate_2'},{text:'⭐⭐⭐',callback_data:'rate_3'}],
        [{text:'⭐⭐⭐⭐',callback_data:'rate_4'},{text:'⭐⭐⭐⭐⭐',callback_data:'rate_5'}],
        [{text:'📊 مشاهدة التقييمات',callback_data:'show_ratings'}]
      ] } });
    }
    if (menuKey === 'contact') return bot.sendMessage(chatId, `📞 للتواصل مع الإدارة:\n\n${normalizeHandles(db.settings.contacts.admin).map(h => `👤 ${h}`).join('\n')}`, kb);
    if (menuKey === 'contests') return bot.sendMessage(chatId, db.settings.contestsMsg, kb);

    const byNumber = findAccount(text);
    if (byNumber) return sendAccount(chatId, byNumber, userId);
    const term = text.trim().toLowerCase();
    const results = db.accounts.filter(a => `${a.number} ${a.text}`.toLowerCase().includes(term));
    if (!results.length) return bot.sendMessage(chatId, '❌ لم يتم العثور على حساب مطابق. جرّب رقمًا مثل #001 أو كلمة من الوصف.', kb);
    if (results.length === 1) return sendAccount(chatId, results[0], userId);
    const rows = results.slice(0,10).map(a => [{ text: `🧾 ${a.number}`, callback_data: `account_${a.number.replace('#','')}` }]);
    return bot.sendMessage(chatId, `🔎 تم العثور على ${results.length} حساب. اختر الحساب:`, { reply_markup: { inline_keyboard: rows } });
  } catch (e) { console.error('خطأ في رسالة المستخدم:', e.message); }
});

async function handleOwnerCallback(q) {
  const chatId = q.message.chat.id, userId = q.from.id, d = q.data;
  if (d === 'own_menu') { ownerState.delete(userId); return show(q, PANEL_TEXT, panelMarkup()); }
  if (d === 'own_close') { ownerState.delete(userId); try { await bot.deleteMessage(chatId, q.message.message_id); } catch (_) {} return; }
  if (d === 'own_cancel') { ownerState.delete(userId); return show(q, '✖️ تم الإلغاء.', backPanel()); }
  if (d.startsWith('own_edit_')) {
    const field = d.replace('own_edit_', '');
    if (!TEXT_FIELDS[field]) return;
    ownerState.set(userId, { type: 'field', field });
    return bot.sendMessage(chatId, `📝 ${TEXT_FIELDS[field]}\n\nالنص الحالي:\n\n${db.settings[field]}\n\n✏️ أرسل النص الجديد الآن.`, { reply_markup: cancelMarkup([{text:'↩️ استرجاع الافتراضي',callback_data:`own_def_${field}`}]) });
  }
  if (d.startsWith('own_def_')) {
    const field = d.replace('own_def_', '');
    if (!TEXT_FIELDS[field]) return;
    db.settings[field] = DEFAULT_SETTINGS[field]; ownerState.delete(userId); saveData();
    return show(q, `✅ تم استرجاع النص الافتراضي: ${TEXT_FIELDS[field]}`, backPanel());
  }
  if (d === 'own_buttons') {
    const rows = Object.keys(BUTTON_LABELS).map(k => [{text:`🔘 ${db.settings.buttons[k]}`,callback_data:`own_btn_${k}`}]);
    rows.push([{text:'⚙️ لوحة التحكم',callback_data:'own_menu'}]);
    return show(q, '🔘 أسماء الأزرار\n\nاختر الزر الذي تريد تغيير اسمه:', {inline_keyboard:rows});
  }
  if (d.startsWith('own_btn_')) {
    const key = d.replace('own_btn_','');
    if (!BUTTON_LABELS[key]) return;
    ownerState.set(userId,{type:'button',key});
    return bot.sendMessage(chatId, `🔘 الاسم الحالي: ${db.settings.buttons[key]}\n\n✏️ أرسل الاسم الجديد:`, {reply_markup:cancelMarkup()});
  }
  if (d === 'own_contacts') {
    const c = db.settings.contacts;
    const rows = Object.keys(CONTACT_LABELS).map(k => [{text:CONTACT_LABELS[k],callback_data:`own_contact_${k}`}]);
    rows.push([{text:'⚙️ لوحة التحكم',callback_data:'own_menu'}]);
    return show(q, `📞 جهات التواصل\n\nنشر الحساب: ${c.publish}\nالشحن: ${c.charge}\nالإدارة: ${c.admin}\n\nاختر ما تريد تعديله:`,{inline_keyboard:rows});
  }
  if (d.startsWith('own_contact_')) {
    const which = d.replace('own_contact_','');
    if (!CONTACT_LABELS[which]) return;
    ownerState.set(userId,{type:'contact',which});
    return bot.sendMessage(chatId, `${CONTACT_LABELS[which]}\n\nالحالي: ${db.settings.contacts[which]}\n\n✏️ أرسل اليوزر الجديد مثل @username:`,{reply_markup:cancelMarkup()});
  }
  if (d.startsWith('own_accounts_')) {
    const p = accountsPage(parseInt(d.replace('own_accounts_',''),10) || 0);
    return show(q,p.text,p.markup);
  }
  if (d.startsWith('own_view_')) {
    const a = findAccount(d.replace('own_view_',''));
    return sendAccount(chatId,a,userId);
  }
  if (d.startsWith('own_del_') && !d.startsWith('own_delok_')) {
    const a = findAccount(d.replace('own_del_',''));
    if (!a) return show(q,'❌ الحساب غير موجود.',backPanel());
    const n = a.number.replace('#','');
    return show(q,`🗑 هل تريد حذف ${a.number} من بيانات البوت؟\n\n${accountSnippet(a)}\n\n⚠️ لن يُحذف منشور القناة.`,{inline_keyboard:[
      [{text:'✅ نعم، احذف',callback_data:`own_delok_${n}`},{text:'✖️ لا',callback_data:'own_accounts_0'}]
    ]});
  }
  if (d.startsWith('own_delok_')) {
    const a = findAccount(d.replace('own_delok_',''));
    if (!a) return show(q,'❌ الحساب غير موجود.',backPanel());
    db.accounts.splice(db.accounts.indexOf(a),1); saveData();
    const p = accountsPage(0);
    return show(q,`✅ تم حذف ${a.number}\n\n${p.text}`,p.markup);
  }
  if (d === 'own_ratings') return show(q,ratingsReport(),backPanel());
}

bot.on('callback_query', async q => {
  try {
    if (!q.message) return bot.answerCallbackQuery(q.id);
    const chatId = q.message.chat.id, userId = q.from.id, data = q.data || '';
    if (data.startsWith('own_')) {
      if (!isOwner(userId) || q.message.chat.type !== 'private') {
        return bot.answerCallbackQuery(q.id,{text:'⛔ هذه الخدمة للمالك فقط.',show_alert:true});
      }
      await bot.answerCallbackQuery(q.id);
      return handleOwnerCallback(q);
    }
    await bot.answerCallbackQuery(q.id);
    const kb = keyboardFor(userId);
    if (data === 'main_menu') return bot.sendMessage(chatId,db.settings.welcome,kb);
    if (data === 'show_ratings') {
      const info = ratingInfo();
      return bot.sendMessage(chatId,`📊 تقييم BRAND | PUBG\n\n${stars(info.average)}\n⭐ المتوسط: ${info.average} / 5\n👥 عدد التقييمات: ${info.count}`,kb);
    }
    if (data.startsWith('rate_')) {
      const rating = parseInt(data.slice(5),10);
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) return bot.sendMessage(chatId,'❌ اختر تقييمًا من 1 إلى 5.',kb);
      const userKey = String(userId);
      if (Object.prototype.hasOwnProperty.call(db.ratedUsers,userKey)) {
        const info = ratingInfo();
        return bot.sendMessage(chatId,`⚠️ قيّمت الخدمة مسبقًا.\n⭐ المتوسط: ${info.average} / 5`,kb);
      }
      db.ratings.push(rating); db.ratedUsers[userKey] = rating; saveData();
      return bot.sendMessage(chatId,`❤️ شكراً لك!\n${'⭐'.repeat(rating)}\n⭐ المتوسط: ${ratingInfo().average} / 5\n\nهل تريد إضافة ملاحظة؟`,{reply_markup:{inline_keyboard:[
        [{text:'📝 إضافة ملاحظة',callback_data:'add_review'}],
        [{text:'🏠 القائمة الرئيسية',callback_data:'main_menu'}]
      ]}});
    }
    if (data === 'add_review') {
      if (!Object.prototype.hasOwnProperty.call(db.ratedUsers,String(userId))) return bot.sendMessage(chatId,'قيّم الخدمة أولًا حتى تضيف ملاحظة.',kb);
      waitingForReview.set(userId,db.ratedUsers[String(userId)]);
      return bot.sendMessage(chatId,'📝 اكتب ملاحظتك الآن (حد أقصى 500 حرف):');
    }
    if (data.startsWith('account_')) {
      const a = findAccount(data.slice(8));
      return sendAccount(chatId,a,userId);
    }
  } catch (e) { console.error('خطأ في الزر:',e.message); }
});

bot.on('polling_error', e => console.error('❌ Polling Error:',e.message));
bot.on('error', e => console.error('❌ Bot Error:',e.message));
process.on('SIGINT', () => { saveData(); bot.stopPolling().finally(() => process.exit(0)); });
process.on('SIGTERM', () => { saveData(); bot.stopPolling().finally(() => process.exit(0)); });

console.log('================================');
console.log('🔥 BRAND Libya Bot يعمل الآن');
console.log('📡 القناة:', CHANNEL_USERNAME);
console.log('💾 ملف البيانات:', DATA_FILE);
console.log(`📦 حسابات: ${db.accounts.length} | تقييمات: ${db.ratings.length}`);
console.log('================================');
