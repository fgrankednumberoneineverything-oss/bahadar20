'use strict';
/* حسابدار بهای تمام‌شده - فاز ۱ (نسخه اندروید، ذخیره محلی) */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2));
const toast = m => { const t = $('#toast'); t.textContent = m; t.className = 'show'; setTimeout(() => t.className = '', 2600); };

/* ---------- پایگاه داده محلی (IndexedDB) ---------- */
const STORES = ['companies', 'factories', 'units', 'items', 'nodes', 'users', 'audit', 'meta', 'docs', 'stockMoves', 'boms', 'prodOrders', 'ohRates', 'ohActuals', 'accounts', 'journals', 'fiscalYears', 'activities', 'abcUsage', 'scenarios', 'currencies', 'fxRates', 'conflicts', 'files', 'fileChunks', 'checks', 'parties'];
let _db;
const openDB = () => new Promise((res, rej) => {
  const r = indexedDB.open('hesabdar-baha', 7);
  r.onupgradeneeded = () => STORES.forEach(s => { if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s, { keyPath: 'id' }); });
  r.onsuccess = () => { _db = r.result; res(); };
  r.onerror = () => rej(r.error);
});
const rq = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const os = (s, m = 'readonly') => _db.transaction(s, m).objectStore(s);
const all = s => rq(os(s).getAll());
const get = (s, id) => rq(os(s).get(id));
const put = (s, v) => rq(os(s, 'readwrite').put(v));
const del = (s, id) => rq(os(s, 'readwrite').delete(id));
const clear = s => rq(os(s, 'readwrite').clear());
const setMeta = (id, value) => put('meta', { id, value });
const getMeta = async id => (await get('meta', id))?.value;

/* ---------- وضعیت برنامه ---------- */
let me = null, company = null, cal = 'fa', recalc = 'auto';
const ui = { tab: 'home', ent: null, formId: undefined, userForm: undefined, page: null, op: null, draft: null };

/* ---------- دسترسی‌ها (در فاز ۱ فقط روی همین دستگاه اجرا می‌شوند) ---------- */
const PERMS = { view: 'مشاهده اطلاعات', create: 'ایجاد اطلاعات', edit: 'ویرایش اطلاعات', void: 'حذف یا ابطال', post: 'ثبت و تأیید اسناد', reports: 'مشاهده گزارش‌ها', export: 'خروجی گرفتن', users: 'مدیریت کاربران', orgs: 'مدیریت شرکت‌ها و کارخانه‌ها', backup: 'پشتیبان‌گیری و بازیابی', settings: 'مدیریت تنظیمات' };
const can = p => !!me && (me.isAdmin || (me.perms || []).includes(p));

/* ---------- رمزنگاری گذرواژه ---------- */
const b64e = b => btoa(String.fromCharCode(...new Uint8Array(b)));
const b64d = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function hashPw(pw, salt) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
  return b64e(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: b64d(salt), iterations: 150000, hash: 'SHA-256' }, k, 256));
}
const newSalt = () => b64e(crypto.getRandomValues(new Uint8Array(16)));
async function sha(text) { return b64e(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))); }

/* ---------- ثبت رکورد و سابقه رویدادها ---------- */
async function log(action, entity, entityId, detail) {
  await put('audit', { id: uid(), at: new Date().toISOString(), companyId: company?.id || '', syncStatus: company ? 'pending' : 'local', userId: me?.id || null, userName: me?.name || '—', action, entity: entity || '', entityId: entityId || '', detail: detail || '' });
}
async function save(store, data, old) {
  const now = new Date().toISOString();
  const rec = old
    ? { ...old, ...data, updatedAt: now, updatedBy: me?.id || null, syncStatus: 'pending' }
    : { ...data, id: uid(), createdAt: now, updatedAt: now, createdBy: me?.id || null, updatedBy: me?.id || null, syncStatus: 'pending', voided: false };
  await put(store, rec);
  await log(old ? 'ویرایش' : 'ایجاد', store, rec.id, data.name || data.username || '');
  syncSoon();
  return rec;
}
const rows = async store => {
  let a = (await all(store)).filter(r => !r.voided);
  if (store === 'companies') { if (me && !me.isAdmin) a = a.filter(c => (me.companyIds || []).includes(c.id)); }
  else if (store !== 'users') a = a.filter(r => r.companyId === company?.id);
  return a.sort((x, y) => (x.createdAt || '').localeCompare(y.createdAt || ''));
};

/* ---------- تاریخ ---------- */
const fmtDate = iso => { try { return new Date(iso).toLocaleString(cal === 'fa' ? 'fa-IR-u-ca-persian' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }); } catch (e) { return iso; } };

/* ---------- تعریف جدول‌های اطلاعات پایه ---------- */
const NODE_KINDS = ['انبار', 'دپارتمان', 'مرکز هزینه', 'خط تولید'];
const LEVELS = ['کل', 'معین'];
const POOL_BASES = ['ساعت کار مستقیم', 'مقدار تولید', 'هزینه مواد مستقیم'];
const ITEM_KINDS = ['ماده اولیه', 'کالای نیمه‌ساخته', 'محصول نهایی', 'خدمات'];
const ENT = {
  companies: { title: 'شرکت‌ها', perm: 'orgs', fields: [['name', 'نام شرکت', 'text', 1], ['nationalId', 'شناسه ملی', 'text']] },
  factories: { title: 'کارخانه‌ها', perm: 'orgs', fields: [['name', 'نام کارخانه', 'text', 1], ['address', 'نشانی', 'text']] },
  nodes: { title: 'انبار، دپارتمان، مرکز هزینه و خط تولید', perm: null, fields: [['kind', 'نوع', NODE_KINDS, 1], ['name', 'نام', 'text', 1], ['code', 'کد', 'text'], ['factoryId', 'کارخانه', 'ref:factories', 1]], uniq: 'code' },
  units: { title: 'واحدهای اندازه‌گیری', perm: null, fields: [['name', 'نام واحد (مثلاً کیلوگرم)', 'text', 1], ['symbol', 'نماد', 'text']] },
  items: { title: 'کالاها', perm: null, fields: [['code', 'کد کالا', 'text', 1], ['name', 'نام کالا', 'text', 1], ['kind', 'نوع کالا', ITEM_KINDS, 1], ['unitId', 'واحد', 'ref:units', 1], ['stdPrice', 'قیمت استاندارد هر واحد (ریال، اختیاری)', 'text']], uniq: 'code', check: d => (d.stdPrice !== '' && !(num(d.stdPrice) >= 0)) ? 'قیمت استاندارد باید عدد صفر یا بیشتر باشد.' : '' },
  ohRates: { title: 'مجموعه‌های سربار (نرخ تسهیم)', perm: null, fields: [['name', 'نام مجموعه (مثلاً سربار خط ۱)', 'text', 1], ['base', 'مبنای تسهیم', POOL_BASES, 1], ['fixedBudget', 'سربار ثابتِ بودجه‌شده برای دوره (ریال)', 'text', 1], ['varRate', 'سربار متغیر هر واحد مبنا (ریال)', 'text'], ['normalCap', 'ظرفیت عادی دوره (به واحد مبنا)', 'text', 1], ['practicalCap', 'ظرفیت عملی دوره (اختیاری)', 'text']], check: d => !(num(d.fixedBudget) >= 0) ? 'سربار ثابت باید عدد صفر یا بیشتر باشد.' : !(num(d.normalCap) > 0) ? 'ظرفیت عادی باید عددی بزرگ‌تر از صفر باشد.' : (d.varRate !== '' && !(num(d.varRate) >= 0)) ? 'سربار متغیر باید عدد صفر یا بیشتر باشد.' : (d.practicalCap !== '' && !(num(d.practicalCap) >= num(d.normalCap))) ? 'ظرفیت عملی نمی‌تواند از ظرفیت عادی کمتر باشد.' : '' },
  ohActuals: { title: 'سربار واقعی (هزینه‌های ثبت‌شده)', perm: null, fields: [['poolId', 'مجموعه سربار', 'ref:ohRates', 1], ['date', 'تاریخ', 'date', 1], ['amount', 'مبلغ واقعی (ریال)', 'text', 1], ['name', 'شرح', 'text', 1]], check: d => !(num(d.amount) > 0) ? 'مبلغ باید عددی بزرگ‌تر از صفر باشد.' : '',
    acheck: async (d, old) => { if (old && old.journalId) return 'این مورد سند حسابداری دارد؛ برای اصلاح، آن را ابطال و دوباره ثبت کنید.'; const S = await acctState(); if (!S.on) return ''; if (S.missing.length) return 'اتصال به حسابداری ناقص است؛ از «تنظیمات حسابداری» حساب‌های اتصال را کامل کنید.'; try { await yearFor(d.date); } catch (e) { return e.message; } return ''; },
    afterSave: async rec => { const S = await acctState(); if (!S.on) return; const a = rial(num(rec.amount)), M = S.cfg.map; const J = await makeJournal({ date: rec.date, desc: 'سربار واقعی: ' + rec.name, lines: [{ accountId: M.oh, debit: a }, { accountId: M.otherPay, credit: a }], source: { type: 'ohActuals', id: rec.id, no: '' }, auto: true }); await putMany([['ohActuals', touch({ ...rec, journalId: J.rec.id })], ...J.entries]); } },
  accounts: { title: 'کدینگ حساب‌ها', perm: 'settings', fields: [['level', 'سطح حساب', LEVELS, 1], ['code', 'کد حساب (فقط عدد)', 'text', 1], ['name', 'نام حساب', 'text', 1], ['parentId', 'حساب کل (برای حساب معین)', 'ref:accounts']], uniq: 'code',
    pre: d => { d.code = norm(d.code); },
    check: d => !/^[1-5][0-9]+$/.test(norm(d.code)) ? 'کد حساب باید عدد باشد و با ۱ تا ۵ شروع شود (۱ دارایی، ۲ بدهی، ۳ سرمایه، ۴ درآمد، ۵ هزینه).' : (d.level === 'معین' && !d.parentId) ? 'برای حساب معین، حساب کل را انتخاب کنید.' : '',
    acheck: async (d, old) => { if (d.level === 'کل') { d.parentId = ''; return ''; } const p = await get('accounts', d.parentId); if (!p || p.level !== 'کل') return 'حساب والد باید یک حساب «کل» باشد.'; if (!norm(d.code).startsWith(p.code)) return `کد حساب معین باید با کد حساب کل (${p.code}) شروع شود.`; if (old && old.level === 'کل' && (await rows('accounts')).some(a => a.parentId === old.id)) return 'این حساب کل زیرمجموعه دارد و سطحش قابل تغییر نیست.'; return ''; } },
  activities: { title: 'فعالیت‌ها (هزینه‌یابی ABC)', perm: null, fields: [['name', 'نام فعالیت (مثلاً راه‌اندازی دستگاه)', 'text', 1], ['driver', 'محرک هزینه (مثلاً تعداد راه‌اندازی)', 'text', 1], ['poolCost', 'هزینه این فعالیت در دوره (ریال)', 'text', 1], ['driverVolume', 'حجم محرک در همان دوره', 'text', 1]],
    check: d => !(num(d.poolCost) >= 0) ? 'هزینه فعالیت باید عدد صفر یا بیشتر باشد.' : !(num(d.driverVolume) > 0) ? 'حجم محرک باید عددی بزرگ‌تر از صفر باشد.' : '' },
  abcUsage: { title: 'مصرف فعالیت‌ها برای هر محصول (ABC)', perm: null, fields: [['productId', 'محصول', 'ref:items', 1], ['activityId', 'فعالیت', 'ref:activities', 1], ['perUnit', 'مصرف محرک به ازای هر واحد محصول', 'text', 1]],
    check: d => !(num(d.perUnit) > 0) ? 'مقدار مصرف باید عددی بزرگ‌تر از صفر باشد.' : '',
    acheck: async (d, old) => { const p = await get('items', d.productId), a = await get('activities', d.activityId); if (!p || !a) return 'محصول یا فعالیت پیدا نشد.'; if ((await rows('abcUsage')).some(u => u.id !== old?.id && u.productId === d.productId && u.activityId === d.activityId)) return 'برای این محصول و فعالیت قبلاً مصرف ثبت شده است.'; d.name = p.name + ' ← ' + a.name; return ''; } },
  currencies: { title: 'ارزها', perm: 'settings', fields: [['code', 'کد ارز (مثلاً USD)', 'text', 1], ['name', 'نام ارز', 'text', 1]], uniq: 'code', pre: d => { d.code = d.code.toUpperCase(); }, check: d => !/^[A-Za-z]{2,5}$/.test(d.code) ? 'کد ارز را با حروف انگلیسی (۲ تا ۵ حرف) بنویسید.' : '' },
  fxRates: { title: 'نرخ ارز (هر واحد ارز چند ریال)', perm: 'settings', fields: [['currencyId', 'ارز', 'ref:currencies', 1], ['date', 'تاریخ نرخ', 'date', 1], ['rate', 'نرخ (ریال)', 'text', 1]],
    check: d => !(num(d.rate) > 0) ? 'نرخ باید عددی بزرگ‌تر از صفر باشد.' : '',
    acheck: async (d, old) => { const c = await get('currencies', d.currencyId); if (!c) return 'ارز پیدا نشد.'; if ((await rows('fxRates')).some(r => r.id !== old?.id && r.currencyId === d.currencyId && r.date === d.date)) return 'برای این ارز در این تاریخ نرخ ثبت شده است.'; d.rate = String(num(d.rate)); d.name = c.code + ' = ' + fmt(num(d.rate), 2) + ' ریال'; return ''; } },
  fiscalYears: { title: 'سال‌های مالی', perm: 'settings', fields: [['name', 'نام سال مالی (مثلاً ۱۴۰۵)', 'text', 1], ['start', 'شروع', 'date', 1], ['end', 'پایان', 'date', 1]],
    check: d => d.start >= d.end ? 'تاریخ شروع باید قبل از پایان باشد.' : '',
    acheck: async (d, old) => { if (old && old.status === 'closed') return 'این سال مالی بسته شده و قابل ویرایش نیست.'; if ((await rows('fiscalYears')).some(y => y.id !== old?.id && y.start <= d.end && d.start <= y.end)) return 'این بازه با یک سال مالی دیگر هم‌پوشانی دارد.'; return ''; } }
};

/* ---------- ورود و راه‌اندازی ---------- */
function authShell(inner) {
  return `<div class="auth"><img src="icon.png" alt=""><h1>بهادار</h1><p class="slogan">محاسبه دقیق، سود بیشتر</p>${inner}</div>`;
}
function setupScreen(err) {
  $('#app').innerHTML = authShell(`<p>برای شروع، مدیر برنامه و اولین شرکت را بسازید.</p>${err ? `<div class="err">${esc(err)}</div>` : ''}
  <label>نام شما</label><input type="text" id="s_name">
  <label>نام کاربری</label><input type="text" id="s_user" autocapitalize="none" autocomplete="off">
  <label>گذرواژه (حداقل ۶ نویسه)</label><input type="password" id="s_pw">
  <label>تکرار گذرواژه</label><input type="password" id="s_pw2">
  <label>نام اولین شرکت</label><input type="text" id="s_co">
  <button class="btn" data-act="setup">ساخت و ورود</button>`);
}
async function doSetup() {
  const v = id => $('#' + id).value.trim();
  if (!v('s_name') || !v('s_user') || !v('s_co')) return setupScreen('نام، نام کاربری و نام شرکت را وارد کنید.');
  if (v('s_pw').length < 6) return setupScreen('گذرواژه باید حداقل ۶ نویسه باشد.');
  if (v('s_pw') !== v('s_pw2')) return setupScreen('گذرواژه و تکرار آن یکسان نیست.');
  const salt = newSalt();
  me = await save('users', { name: v('s_name'), username: v('s_user').toLowerCase(), salt, pwHash: await hashPw(v('s_pw'), salt), isAdmin: true, active: true, perms: Object.keys(PERMS), companyIds: [] });
  company = await save('companies', { name: v('s_co'), nationalId: '' });
  await setMeta('currentCompany', company.id);
  await log('ورود', 'users', me.id, 'راه‌اندازی اولیه');
  render();
}
function loginScreen(err) {
  $('#app').innerHTML = authShell(`<p>برای ورود، مشخصات خود را وارد کنید.</p>${err ? `<div class="err">${esc(err)}</div>` : ''}
  <label>نام کاربری</label><input type="text" id="l_user" autocapitalize="none" autocomplete="username">
  <label>گذرواژه</label><input type="password" id="l_pw" autocomplete="current-password">
  <button class="btn" data-act="login">ورود</button>`);
}
async function doLogin() {
  const u = $('#l_user').value.trim().toLowerCase(), pw = $('#l_pw').value;
  const user = (await all('users')).find(x => x.username === u && x.active && !x.voided);
  if (!user || (await hashPw(pw, user.salt)) !== user.pwHash) {
    me = null; await log('ورود ناموفق', 'users', user?.id || '', u);
    return loginScreen('نام کاربری یا گذرواژه درست نیست.');
  }
  me = user; await log('ورود', 'users', me.id);
  await pickCompany();
  render(); syncSoon();
}
async function pickCompany() {
  const list = await rows('companies'); const saved = await getMeta('currentCompany');
  company = list.find(c => c.id === saved) || list[0] || null;
  if (company) await setMeta('currentCompany', company.id);
}

/* ---------- قالب کلی ---------- */
const NAV = [['home', '🏠', 'خانه'], ['ops', '📦', 'عملیات'], ['base', '🗂️', 'اطلاعات پایه'], ['backup', '💾', 'پشتیبان'], ['more', '⋯', 'بیشتر']];
async function render() {
  if (!_db) return;
  if (!(await all('users')).length) return setupScreen();
  if (!me) return loginScreen();
  const cos = await rows('companies');
  const nav = NAV.filter(n => n[0] !== 'users' || can('users')).filter(n => n[0] !== 'backup' || can('backup'));
  let body = '';
  try { body = await viewFor(); } catch (e) { body = `<div class="err">خطای غیرمنتظره: ${esc(e.message)}</div>`; }
  $('#app').innerHTML = `<header class="top"><h1>${esc(me.name)}</h1>${cloudChip()}
    ${cos.length ? `<select data-change="company">${cos.map(c => `<option value="${c.id}" ${c.id === company?.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>` : ''}</header>
    <main>${body}</main>
    <nav class="bar">${nav.map(n => `<button class="${ui.tab === n[0] ? 'on' : ''}" data-act="tab" data-tab="${n[0]}"><b>${n[1]}</b>${n[2]}</button>`).join('')}</nav>`;
}
async function viewFor() {
  if (!company && ui.tab !== 'more' && ui.tab !== 'users' && ui.tab !== 'backup') return `<div class="empty">هنوز شرکتی ثبت نشده یا به شما دسترسی داده نشده است.</div>`;
  if (ui.page) return pageView(ui.page);
  switch (ui.tab) {
    case 'home': return homeView();
    case 'base': return ui.formId !== undefined ? formView() : ui.ent ? listView() : baseMenu();
    case 'users': return can('users') ? (ui.userForm !== undefined ? userForm() : usersView()) : denied();
    case 'ops': return opsView();
    case 'backup': return can('backup') ? backupView() : denied();
    default: return moreView();
  }
}
const denied = () => `<div class="err">شما اجازه دیدن این بخش را ندارید.</div>`;

/* ---------- صفحه خانه ---------- */
async function homeView() {
  const counts = {};
  for (const s of ['factories', 'nodes', 'units', 'items']) counts[s] = (await rows(s)).length;
  const lb = await getMeta('lastBackup');
  const days = lb ? Math.floor((Date.now() - new Date(lb.at)) / 864e5) : null;
  const warn = !lb ? `<div class="warn">هنوز از اطلاعات پشتیبان نگرفته‌اید. از بخش «پشتیبان» یک نسخه بگیرید.</div>`
    : days >= 7 ? `<div class="warn">آخرین پشتیبان‌گیری ${days} روز پیش بوده است.</div>` : '';
  const hasSample = (await all('items')).some(i => i.sample);
  return `${warn}<h2>${esc(company.name)}</h2><dl class="facts">
  <div><dt>کارخانه‌ها</dt><dd>${counts.factories}</dd></div>
  <div><dt>انبار، دپارتمان، مرکز هزینه و خط تولید</dt><dd>${counts.nodes}</dd></div>
  <div><dt>واحدها</dt><dd>${counts.units}</dd></div>
  <div><dt>کالاها</dt><dd>${counts.items}</dd></div>
  <div><dt>آخرین پشتیبان‌گیری</dt><dd>${lb ? esc(fmtDate(lb.at)) : 'انجام نشده'}</dd></div></dl>
  ${counts.items === 0 && can('create') ? `<p>برای آشنایی با برنامه می‌توانید داده نمونه اضافه کنید؛ همه موارد با برچسب «نمونه» مشخص می‌شوند.</p><button class="btn alt" data-act="addSample">افزودن داده نمونه</button>` : ''}
  ${hasSample && can('void') ? `<button class="btn bad" data-act="removeSample">حذف همه داده‌های نمونه</button>` : ''}`;
}
async function addSample() {
  const co = await save('companies', { name: 'شرکت نمونه', nationalId: '', sample: true });
  if (me && !me.isAdmin) { me.companyIds = [...(me.companyIds || []), co.id]; await put('users', me); }
  const keep = company; company = co;
  const f = await save('factories', { companyId: co.id, name: 'کارخانه نمونه', address: '', sample: true });
  const kg = await save('units', { companyId: co.id, name: 'کیلوگرم', symbol: 'kg', sample: true });
  await save('units', { companyId: co.id, name: 'عدد', symbol: 'عدد', sample: true });
  await save('nodes', { companyId: co.id, factoryId: f.id, kind: 'انبار', name: 'انبار مواد اولیه نمونه', code: 'W1', sample: true });
  await save('nodes', { companyId: co.id, factoryId: f.id, kind: 'خط تولید', name: 'خط یک نمونه', code: 'L1', sample: true });
  await save('items', { companyId: co.id, name: 'ماده اولیه نمونه', code: 'RM-001', kind: 'ماده اولیه', unitId: kg.id, sample: true });
  await save('items', { companyId: co.id, name: 'محصول نمونه', code: 'FG-001', kind: 'محصول نهایی', unitId: kg.id, sample: true });
  company = keep; await setMeta('currentCompany', co.id); company = co;
  toast('داده نمونه اضافه شد'); render();
}
async function removeSample() {
  if (!confirm('همه داده‌های نمونه حذف شوند؟ داده‌های واقعی شما حذف نمی‌شوند.')) return;
  let n = 0;
  const sc0 = (await all('companies')).filter(c => c.sample).map(c => c.id);
  for (const s of ['docs', 'stockMoves', 'boms', 'prodOrders']) for (const r of await all(s)) if (sc0.includes(r.companyId)) { await del(s, r.id); n++; }
  for (const s of ['companies', 'factories', 'units', 'items', 'nodes'])
    for (const r of await all(s)) if (r.sample) { await del(s, r.id); n++; }
  const sc = (await all('companies')).filter(c => c.sample).map(c => c.id);
  for (const s of ['docs', 'stockMoves', 'boms', 'prodOrders']) for (const r of await all(s)) if (sc.includes(r.companyId)) { await del(s, r.id); n++; }
  await log('حذف داده نمونه', '', '', n + ' رکورد');
  await pickCompany(); toast('داده‌های نمونه حذف شدند'); render();
}

/* ---------- اطلاعات پایه ---------- */
async function baseMenu() {
  const list = [];
  for (const k of Object.keys(ENT)) list.push(`<button class="row" data-act="open" data-ent="${k}"><span class="t">${ENT[k].title}<span class="s">${(await rows(k)).length} مورد</span></span><span class="c">‹</span></button>`);
  return `<h2>اطلاعات پایه</h2>${list.join('')}`;
}
async function refName(store, id) { const r = await get(store, id); return r ? r.name : '—'; }
async function listView() {
  const E = ENT[ui.ent], list = await rows(ui.ent);
  if (ui.ent === 'accounts') list.sort((a, b) => a.code.localeCompare(b.code)); if (ui.ent === 'fiscalYears') list.sort((a, b) => a.start.localeCompare(b.start));
  const items = [];
  for (const r of list) {
    let sub = [];
    if (r.code) sub.push(r.code);
    if (r.kind) sub.push(r.kind);
    if (r.unitId) sub.push(await refName('units', r.unitId));
    if (r.factoryId) sub.push(await refName('factories', r.factoryId));
    if (r.base) sub.push(r.base);
    if (r.driver) sub.push(r.driver + ' – ' + fmt(num(r.poolCost), 0) + ' ریال / ' + fmt(num(r.driverVolume)));
    if (r.perUnit) sub.push('مصرف هر واحد: ' + fmt(num(r.perUnit)));
    if (r.rate && r.currencyId) sub.push(fmtDay(r.date));
    if (r.date) sub.push(fmtDay(r.date));
    if (r.start) sub.push(fmtDay(r.start) + ' تا ' + fmtDay(r.end) + (r.status === 'closed' ? ' – بسته' : ''));
    if (r.level) sub.push(r.level);
    if (r.amount) sub.push(fmt(num(r.amount), 0) + ' ریال');
    items.push(`<button class="row" data-act="edit" data-id="${r.id}"><span class="t">${esc(r.name)}${r.sample ? '<span class="badge">نمونه</span>' : ''}<span class="s">${esc(sub.join(' – '))}</span></span><span class="c">‹</span></button>`);
  }
  return `<button class="back" data-act="backBase">‹ بازگشت</button><h2>${E.title}</h2>
    ${items.join('') || `<div class="empty">هنوز موردی ثبت نشده است.</div>`}
    ${can('create') && (!E.perm || can(E.perm)) ? `<button class="fab" data-act="add">+ افزودن</button>` : ''}`;
}
async function formView(err, vals) {
  const E = ENT[ui.ent], id = ui.formId, rec = vals || (id ? await get(ui.ent, id) : {});
  const editing = !!id;
  const ok = editing ? can('edit') : can('create');
  let f = '';
  for (const [name, label, type, req] of E.fields) {
    const v = rec[name] ?? '';
    if (type === 'date') f += `<label>${label}${req ? ' *' : ''}</label>${dateField(name, rec[name])}`;
    else if (Array.isArray(type)) f += `<label>${label}${req ? ' *' : ''}</label><select name="${name}"><option value="">انتخاب کنید</option>${type.map(o => `<option ${o === v ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
    else if (type.startsWith('ref:')) { const opts = await rows(type.slice(4)); f += `<label>${label}${req ? ' *' : ''}</label><select name="${name}"><option value="">انتخاب کنید</option>${opts.map(o => `<option value="${o.id}" ${o.id === v ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select>`; }
    else f += `<label>${label}${req ? ' *' : ''}</label><input type="text" name="${name}" value="${esc(v)}">`;
  }
  return `<button class="back" data-act="backList">‹ بازگشت</button><h2>${editing ? 'ویرایش' : 'افزودن'} – ${E.title}</h2>
    ${err ? `<div class="err">${esc(err)}</div>` : ''}${ok ? '' : `<div class="err">شما اجازه ${editing ? 'ویرایش' : 'ایجاد'} این مورد را ندارید.</div>`}
    <form id="f" onsubmit="return false">${f}</form>
    ${ok ? `<button class="btn" data-act="saveForm">ذخیره</button>` : ''}
    ${editing && can('void') ? `<button class="btn bad" data-act="voidRec">ابطال این مورد</button>` : ''}`;
}
async function saveForm() {
  const E = ENT[ui.ent], data = {}; const el = $('#f');
  const old = ui.formId ? await get(ui.ent, ui.formId) : null;
  for (const [name, label, type, req] of E.fields) {
    if (type === 'date') { const d = readDate(el, name); if (!d) return rerenderForm('تاریخ معتبر نیست؛ روز، ماه و سال را بررسی کنید.', data); if (!dateWarn(d)) return; data[name] = d; continue; }
    data[name] = el.elements[name].value.trim(); if (req && !data[name]) return rerenderForm(`فیلد «${label}» الزامی است.`, data);
  }
  if (E.check) { const m = E.check(data); if (m) return rerenderForm(m, data); }
  if (!(old ? can('edit') : can('create')) || (E.perm && !can(E.perm))) return toast('اجازه این کار را ندارید');
  if (E.pre) E.pre(data);
  if (E.uniq && data[E.uniq] && (await rows(ui.ent)).some(r => r[E.uniq] === data[E.uniq] && r.id !== old?.id)) return rerenderForm(E.uniq === 'code' ? 'این کد قبلاً استفاده شده است.' : 'مقدار تکراری است.', data);
  if (E.acheck) { const m = await E.acheck(data, old); if (m) return rerenderForm(m, data); }
  if (ui.ent !== 'companies') data.companyId = old?.companyId || company.id;
  const rec = await save(ui.ent, data, old);
  if (ui.ent === 'companies' && !old && me && !me.isAdmin) { me.companyIds = [...(me.companyIds || []), rec.id]; await put('users', me); }
  if (E.afterSave) { try { await E.afterSave(rec); } catch (e) { ui.formId = undefined; render(); return toast('ذخیره شد ولی ثبت سند حسابداری انجام نشد: ' + e.message); } }
  ui.formId = undefined; toast('ذخیره شد'); render();
}
async function rerenderForm(err, vals) { $('main').innerHTML = await formView(err, vals); }
async function voidRec() {
  if (!can('void') || !confirm('این مورد باطل شود؟ سابقه آن در گزارش رویدادها می‌ماند.')) return;
  const old = await get(ui.ent, ui.formId);
  try {
    if (ui.ent === 'accounts' && await accountUsed(old.id)) return err('این حساب در اسناد یا تنظیمات اتصال استفاده شده و قابل ابطال نیست.');
    if (ui.ent === 'fiscalYears' && (old.status === 'closed' || (await rows('journals')).some(j => j.yearId === old.id))) return err('این سال مالی سند دارد یا بسته شده و قابل ابطال نیست.');
    const rev = old.journalId ? await reverseJ(old.journalId, old.name) : [];
    await putMany([[ui.ent, { ...old, voided: true, updatedAt: new Date().toISOString(), updatedBy: me.id, syncStatus: 'pending' }], ...rev, ['audit', auditRec('ابطال', ui.ent, old.id, old.name || '')]]);
  } catch (e) { return err(e.message); }
  if (ui.ent === 'companies') await pickCompany();
  ui.formId = undefined; toast('باطل شد'); render();
}

/* ---------- کاربران ---------- */
async function usersView() {
  const list = (await all('users')).filter(u => !u.voided);
  return `<h2>کاربران</h2>${list.map(u => `<button class="row" data-act="editUser" data-id="${u.id}"><span class="t">${esc(u.name)}${u.isAdmin ? '<span class="badge">مدیر</span>' : ''}${u.active ? '' : '<span class="badge off">غیرفعال</span>'}<span class="s">${esc(u.username)}</span></span><span class="c">‹</span></button>`).join('')}
  <button class="fab" data-act="addUser">+ کاربر جدید</button>`;
}
async function userForm(err, vals) {
  const id = ui.userForm, u = vals || (id ? await get('users', id) : { active: true, perms: ['view'], companyIds: [] });
  const cos = (await all('companies')).filter(c => !c.voided);
  return `<button class="back" data-act="backUsers">‹ بازگشت</button><h2>${id ? 'ویرایش کاربر' : 'کاربر جدید'}</h2>${err ? `<div class="err">${esc(err)}</div>` : ''}
  <form id="uf" onsubmit="return false">
  <label>نام</label><input type="text" name="name" value="${esc(u.name || '')}">
  <label>نام کاربری</label><input type="text" name="username" value="${esc(u.username || '')}" autocapitalize="none">
  <label>${id ? 'گذرواژه جدید (اگر نمی‌خواهید تغییر کند خالی بگذارید)' : 'گذرواژه (حداقل ۶ نویسه)'}</label><input type="password" name="pw">
  <label class="chk"><input type="checkbox" name="active" ${u.active ? 'checked' : ''}> کاربر فعال است</label>
  <label class="chk"><input type="checkbox" name="isAdmin" ${u.isAdmin ? 'checked' : ''}> مدیر کل (همه دسترسی‌ها و همه شرکت‌ها)</label>
  <h3>دسترسی‌ها</h3>${Object.entries(PERMS).map(([k, t]) => `<label class="chk"><input type="checkbox" name="p_${k}" ${(u.perms || []).includes(k) ? 'checked' : ''}> ${t}</label>`).join('')}
  <h3>شرکت‌های مجاز</h3>${cos.map(c => `<label class="chk"><input type="checkbox" name="c_${c.id}" ${(u.companyIds || []).includes(c.id) ? 'checked' : ''}> ${esc(c.name)}</label>`).join('')}
  </form><button class="btn" data-act="saveUser">ذخیره</button>`;
}
async function saveUser() {
  const el = $('#uf').elements, id = ui.userForm, old = id ? await get('users', id) : null;
  const redo = async m => { $('main').innerHTML = await userForm(m); };
  const name = el.name.value.trim(), username = el.username.value.trim().toLowerCase(), pw = el.pw.value;
  if (!name || !username) return redo('نام و نام کاربری الزامی است.');
  if ((await all('users')).some(u => u.username === username && u.id !== old?.id)) return redo('این نام کاربری قبلاً ثبت شده است.');
  if (!old && pw.length < 6) return redo('گذرواژه باید حداقل ۶ نویسه باشد.');
  if (old && pw && pw.length < 6) return redo('گذرواژه باید حداقل ۶ نویسه باشد.');
  const data = { name, username, active: el.active.checked, isAdmin: el.isAdmin.checked, perms: Object.keys(PERMS).filter(k => el['p_' + k].checked), companyIds: [...document.querySelectorAll('[name^="c_"]')].filter(x => x.checked).map(x => x.name.slice(2)) };
  if (old && old.id === me.id && (!data.active || !data.isAdmin)) return redo('نمی‌توانید خودتان را غیرفعال کنید یا مدیری را از خودتان بگیرید.');
  if (pw) { data.salt = newSalt(); data.pwHash = await hashPw(pw, data.salt); }
  else if (!old) return redo('گذرواژه الزامی است.');
  const rec = await save('users', data, old);
  if (rec.id === me.id) me = rec;
  ui.userForm = undefined; toast('ذخیره شد'); render();
}

/* ---------- پشتیبان‌گیری ---------- */
async function backupView() {
  const lb = await getMeta('lastBackup');
  return `<h2>پشتیبان‌گیری و بازیابی</h2>
  <dl class="facts"><div><dt>آخرین پشتیبان</dt><dd>${lb ? esc(fmtDate(lb.at)) : 'انجام نشده'}</dd></div></dl>
  <p>فایل پشتیبان شامل همه اطلاعات و کاربران است؛ آن را جای امن نگه دارید.</p>
  <button class="btn" data-act="doBackup">گرفتن نسخه پشتیبان</button>
  <h3>بازیابی</h3><input type="file" id="rf" accept=".json,application/json" style="display:none" data-change="restoreFile">
  <button class="btn alt" data-act="pickRestore">بررسی فایل پشتیبان (بدون تغییر اطلاعات)</button>
  ${cloud.enabled ? `<h3>پشتیبان ابری</h3><button class="btn" data-act="cloudBackupNow">گرفتن پشتیبان ابری</button><button class="btn alt" data-act="cloudBackupList">نمایش پشتیبان‌های ابری</button>${(ui.cloudBackups || []).map(b => `<div class="row"><span class="t">${esc(fmtDate(b.created_at))}<span class="s">${esc(b.note || '')} – ${fmt(Math.round((b.size || 0) / 1024), 0)} کیلوبایت</span></span><button class="btn alt sm" data-act="cloudRestore" data-id="${b.id}">بازیابی</button></div>`).join('')}` : ''}
  <div id="rmsg"></div>`;
}
async function buildBackup() {
  const data = {}, counts = {};
  for (const s of STORES) { data[s] = await all(s); if (s === 'meta') data[s] = data[s].filter(r => r.id !== 'cloud'); counts[s] = data[s].length; }
  const body = JSON.stringify(data);
  return JSON.stringify({ app: 'hesabdar-baha', format: 1, createdAt: new Date().toISOString(), counts, checksum: await sha(body), data: body });
}
async function saveFile(name, text) {
  const C = window.Capacitor, P = C?.Plugins;
  if (C?.isNativePlatform?.() && P?.Filesystem && P?.Share) {
    const r = await P.Filesystem.writeFile({ path: name, data: text, directory: 'CACHE', encoding: 'utf8' });
    await P.Share.share({ title: name, url: r.uri, dialogTitle: 'ذخیره یا ارسال نسخه پشتیبان' });
  } else {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = name; a.click();
  }
}
async function doBackup() {
  try {
    const text = await buildBackup();
    await saveFile('hesabdar-backup-' + new Date().toISOString().slice(0, 10) + '.json', text);
    await setMeta('lastBackup', { at: new Date().toISOString(), ok: true });
    await log('پشتیبان‌گیری', '', '', 'موفق'); toast('پشتیبان آماده شد'); render();
  } catch (e) { await log('پشتیبان‌گیری', '', '', 'ناموفق: ' + e.message); $('main').insertAdjacentHTML('afterbegin', `<div class="err">پشتیبان‌گیری انجام نشد: ${esc(e.message)}</div>`); }
}
async function checkBackup(text) {
  let b; try { b = JSON.parse(text); } catch (e) { return { err: 'فایل خراب است یا فایل پشتیبان نیست.' }; }
  if (b.app !== 'hesabdar-baha' || !b.data) return { err: 'این فایل، پشتیبان این برنامه نیست.' };
  if ((await sha(b.data)) !== b.checksum) return { err: 'فایل ناقص یا دست‌خورده است و قابل اعتماد نیست.' };
  return { b, data: JSON.parse(b.data) };
}
async function restoreFile(input) {
  const file = input.files[0]; if (!file) return;
  const res = await checkBackup(await file.text()); const box = $('#rmsg');
  if (res.err) { box.innerHTML = `<div class="err">${esc(res.err)}</div>`; return; }
  const c = res.b.counts;
  window._pending = res.data;
  box.innerHTML = `<div class="ok">فایل سالم است. تاریخ پشتیبان: ${esc(fmtDate(res.b.createdAt))}<br>کالا: ${c.items} – کاربران: ${c.users} – شرکت‌ها: ${c.companies}</div>
    <div class="warn">با بازیابی، همه اطلاعات فعلی این دستگاه با محتوای فایل جایگزین می‌شود.</div>
    <button class="btn bad" data-act="applyRestore">جایگزینی اطلاعات با این فایل</button>`;
}
async function applyRestore() {
  if (!window._pending || !can('backup')) return;
  if (!confirm('اطلاعات فعلی کاملاً جایگزین می‌شود. ادامه می‌دهید؟')) return;
  await log('بازیابی', '', '', 'شروع');
  const keepCloud = await get('meta', 'cloud');
  for (const s of STORES) { await clear(s); for (const r of window._pending[s] || []) await put(s, r); }
  if (keepCloud) await put('meta', keepCloud);
  window._pending = null; me = null; company = null; ui.tab = 'home'; toast('بازیابی انجام شد؛ دوباره وارد شوید'); render();
}

/* ---------- بیشتر ---------- */
const DONE = ['چند شرکت و چند کارخانه، کاربران و ۱۱ سطح دسترسی روی دستگاه', 'کالا، انبار، خرید، فروش، فرمول ساخت، تولید و موجودی', 'هزینه‌یابی: دستمزد، سربار، ضایعات، انحرافات، ABC و سناریوها', 'حسابداری مالی و گزارش‌ها، چندارزی و تسعیر', 'کار آفلاین و همگام‌سازی خودکار با سرور مرکزی (Supabase) پس از اتصال اینترنت', 'ارسال مجدد بدون ثبت تکراری سند (شناسه یکتا برای هر تغییر)', 'شناسایی تغییر هم‌زمان، نمایش اختلاف و تصمیم کاربر (هیچ تغییری بی‌صدا حذف نمی‌شود)', 'کنترل دسترسی سمت سرور (عضویت و مجوزها در دیتابیس سرور اعمال می‌شود)', 'مدیریت اعضای ابری هر شرکت و مجوزهای آن‌ها', 'پشتیبان ابری دستی و خودکار روزانه، و بازیابی از آن', 'پیشوند دستگاه برای شماره اسناد تا شماره تکراری ساخته نشود'];
const TODO = ['آزمون روی سرور واقعی: اسکریپت SQL سرور اینجا اجرا و آزموده نشده (فقط منطق برنامه با سرور شبیه‌سازی‌شده آزموده شده)', 'همگام‌سازی کاربران و گذرواژه‌های محلی بین دستگاه‌ها (هر دستگاه کاربران خودش را دارد)', 'جلوگیری از موجودی منفی هنگام فروش هم‌زمان روی دو دستگاه (فقط با گزارش مغایرت)', 'ثبت سند تسعیر تحقق‌نیافته پایان دوره', 'خروجی PDF', 'ترازنامه و جریان وجوه نقد', 'هزینه‌یابی مرحله‌ای، FIFO، مواد جایگزین', 'مالیات بر ارزش افزوده و انطباق مالیاتی ایران (باید توسط متخصص بررسی شود)', 'آزمون امنیت، انتشار نهایی اندروید و نسخه ویندوز (فاز ۷)', 'رابط انگلیسی'];
async function moreView() {
  return `<h2>بیشتر</h2>
  ${can('users') ? `<button class="row" data-act="tab" data-tab="users"><span class="t">کاربران و دسترسی‌ها</span><span class="c">‹</span></button>` : ''}
  <button class="row" data-act="page" data-p="cloud"><span class="t">همگام‌سازی و سرور مرکزی<span class="s">${cloud.enabled ? 'متصل: ' + esc(cloud.email) : 'غیرفعال'}</span></span><span class="c">‹</span></button>
  <button class="row" data-act="page" data-p="status"><span class="t">وضعیت پیاده‌سازی</span><span class="c">‹</span></button>
  <button class="row" data-act="page" data-p="audit"><span class="t">سابقه رویدادها</span><span class="c">‹</span></button>
  <label>تقویم نمایش تاریخ</label><select data-change="cal"><option value="fa" ${cal === 'fa' ? 'selected' : ''}>شمسی</option><option value="en" ${cal === 'en' ? 'selected' : ''}>میلادی</option></select>
  <label>محاسبه مجدد سناریوها پس از تغییر فرض‌ها</label><select data-change="recalc"><option value="auto" ${recalc === 'auto' ? 'selected' : ''}>خودکار (هنگام تغییر)</option><option value="manual" ${recalc === 'manual' ? 'selected' : ''}>پس از زدن «محاسبه»</option></select>
  <button class="btn alt" data-act="logout">خروج از حساب</button>
  <p class="empty">بهادار – نسخه ۱٫۰</p>`;
}
async function pageView(p) {
  const back = `<button class="back" data-act="backPage">‹ بازگشت</button>`;
  if (p === 'cloud') return cloudView();
  if (p === 'conflicts') return conflictsView();
  if (p === 'status') return `${back}<h2>وضعیت پیاده‌سازی</h2><h3>ساخته و آزموده‌شده در این فاز</h3><ul class="list">${DONE.map(x => `<li>${x}</li>`).join('')}</ul><h3>پیاده‌سازی نشده</h3><ul class="list">${TODO.map(x => `<li>${x}</li>`).join('')}</ul>`;
  const a = (await all('audit')).sort((x, y) => y.at.localeCompare(x.at)).slice(0, 100);
  return `${back}<h2>سابقه رویدادها</h2>${a.map(r => `<div class="row"><span class="t">${esc(r.action)} ${esc(r.detail)}<span class="s">${esc(r.userName)} – ${esc(fmtDate(r.at))}</span></span></div>`).join('')}`;
}

/* ---------- رویدادها ---------- */
const ACT = {
  setup: doSetup, login: doLogin, addSample, removeSample, doBackup, applyRestore, voidRec, saveForm, saveUser,
  tab: d => { ui.tab = d.tab; ui.ent = null; ui.formId = undefined; ui.userForm = undefined; ui.page = null; ui.op = null; ui.draft = null; render(); },
  open: d => { ui.ent = d.ent; render(); },
  add: () => { ui.formId = null; render(); },
  edit: d => { ui.formId = d.id; render(); },
  backBase: () => { ui.ent = null; render(); },
  backList: () => { ui.formId = undefined; render(); },
  addUser: () => { ui.userForm = null; render(); },
  editUser: d => { ui.userForm = d.id; render(); },
  backUsers: () => { ui.userForm = undefined; render(); },
  page: d => { ui.page = d.p; render(); },
  backPage: () => { ui.page = null; render(); },
  pickRestore: () => $('#rf').click(),
  logout: async () => { await log('خروج', 'users', me.id); me = null; company = null; render(); }
};
document.addEventListener('click', e => { const t = e.target.closest('[data-act]'); if (t && ACT[t.dataset.act]) ACT[t.dataset.act](t.dataset); });
document.addEventListener('change', async e => {
  const t = e.target.closest('[data-change]'); if (!t) return;
  if (t.dataset.change === 'company') { company = await get('companies', t.value); await setMeta('currentCompany', company.id); ui.ent = null; ui.formId = undefined; render(); }
  if (t.dataset.change === 'cal') { cal = t.value; await setMeta('cal', cal); render(); }
  if (t.dataset.change === 'restoreFile') restoreFile(t);
});

function start() { openDB().then(async () => { cal = (await getMeta('cal')) || 'fa'; recalc = (await getMeta('recalc')) || 'auto'; await loadCloud(); startSyncTimers(); render(); }).catch(e => { document.body.innerHTML = '<p style="padding:20px">پایگاه داده روی این دستگاه باز نشد: ' + esc(e.message) + '</p>'; }); }
/* فاز ۲: انبار، خرید، فروش، فرمول ساخت و سفارش تولید */

/* ---------- اعداد، گرد کردن، تاریخ ---------- */
const FA = '۰۱۲۳۴۵۶۷۸۹';
const norm = s => String(s ?? '').replace(/[۰-۹]/g, d => FA.indexOf(d)).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[٬،,]/g, '').replace(/٫/g, '.').trim();
const num = s => { const t = norm(s); if (t === '' || !/^-?\d*\.?\d+$/.test(t)) return NaN; return parseFloat(t); };
const q3 = x => Math.round((x + Number.EPSILON) * 1000) / 1000;   // مقدار: ۳ رقم اعشار
const rial = x => Math.round(x);                                    // مبلغ: ریال کامل، گرد کردن معمولی
const fmt = (n, d = 3) => Number(n).toLocaleString(cal === 'fa' ? 'fa-IR' : 'en-US', { maximumFractionDigits: d });
const MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
const GMONTHS = ['ژانویه', 'فوریه', 'مارس', 'آوریل', 'مه', 'ژوئن', 'ژوئیه', 'اوت', 'سپتامبر', 'اکتبر', 'نوامبر', 'دسامبر'];
function g2j(gy, gm, gd) {
  const gdm = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]; let jy;
  if (gy > 1600) { jy = 979; gy -= 1600; } else { jy = 0; gy -= 621; }
  const gy2 = gm > 2 ? gy + 1 : gy;
  let days = 365 * gy + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100) + Math.floor((gy2 + 399) / 400) - 80 + gd + gdm[gm - 1];
  jy += 33 * Math.floor(days / 12053); days %= 12053; jy += 4 * Math.floor(days / 1461); days %= 1461;
  if (days > 365) { jy += Math.floor((days - 1) / 365); days = (days - 1) % 365; }
  let jm, jd; if (days < 186) { jm = 1 + Math.floor(days / 31); jd = 1 + days % 31; } else { jm = 7 + Math.floor((days - 186) / 30); jd = 1 + (days - 186) % 30; }
  return [jy, jm, jd];
}
function j2g(jy, jm, jd) {
  let gy; if (jy > 979) { gy = 1600; jy -= 979; } else gy = 621;
  let days = 365 * jy + Math.floor(jy / 33) * 8 + Math.floor(((jy % 33) + 3) / 4) + 78 + jd + (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186);
  gy += 400 * Math.floor(days / 146097); days %= 146097;
  if (days > 36524) { days--; gy += 100 * Math.floor(days / 36524); days %= 36524; if (days >= 365) days++; }
  gy += 4 * Math.floor(days / 1461); days %= 1461;
  if (days > 365) { gy += Math.floor((days - 1) / 365); days = (days - 1) % 365; }
  let gd = days + 1; const sa = [0, 31, ((gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let gm; for (gm = 0; gm < 13 && gd > sa[gm]; gm++) gd -= sa[gm];
  return [gy, gm, gd];
}
const pad2 = n => String(n).padStart(2, '0');
const todayISO = () => { const d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); };
const faNum = s => String(s).replace(/\d/g, c => FA[c]);
function fmtDay(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  if (cal === 'fa') { const [jy, jm, jd] = g2j(y, m, d); return `${faNum(jd)} ${MONTHS[jm - 1]} ${faNum(jy)}`; }
  return `${d} ${GMONTHS[m - 1]} ${y}`;
}
function dateField(name, iso) {
  const [y, m, d] = (iso || todayISO()).split('-').map(Number);
  const [a, b, c] = cal === 'fa' ? g2j(y, m, d) : [y, m, d];
  return `<div class="dt"><input type="text" inputmode="numeric" name="${name}_y" value="${a}"><select name="${name}_m">${(cal === 'fa' ? MONTHS : GMONTHS).map((n, i) => `<option value="${i + 1}" ${i + 1 === b ? 'selected' : ''}>${n}</option>`).join('')}</select><select name="${name}_d">${Array.from({ length: 31 }, (_, i) => `<option ${i + 1 === c ? 'selected' : ''}>${i + 1}</option>`).join('')}</select></div>`;
}
function readDate(form, name) {
  const y = parseInt(norm(form.elements[name + '_y'].value), 10), m = +form.elements[name + '_m'].value, d = +form.elements[name + '_d'].value;
  if (!y) return null;
  const [gy, gm, gd] = cal === 'fa' ? j2g(y, m, d) : [y, m, d];
  const t = new Date(gy, gm - 1, gd);
  if (t.getFullYear() !== gy || t.getMonth() + 1 !== gm || t.getDate() !== gd) return null;
  if (cal === 'fa') { const b = g2j(gy, gm, gd); if (b[0] !== y || b[1] !== m || b[2] !== d) return null; }
  return `${gy}-${pad2(gm)}-${pad2(gd)}`;
}
const dateWarn = iso => iso > todayISO() ? confirm('این تاریخ در آینده است (مثلاً برای برنامه‌ریزی). با همین تاریخ ثبت شود؟') : true;

/* ---------- کمک‌ها ---------- */
const err = m => { document.querySelectorAll('main .err').forEach(e => e.remove()); $('main').insertAdjacentHTML('afterbegin', `<div class="err">${esc(m)}</div>`); $('main').scrollTop = 0; };
const newRec = data => { const now = new Date().toISOString(); return { ...data, id: uid(), companyId: company.id, createdAt: now, updatedAt: now, createdBy: me.id, updatedBy: me.id, syncStatus: 'pending', voided: false }; };
const touch = r => ({ ...r, updatedAt: new Date().toISOString(), updatedBy: me.id, syncStatus: 'pending' });
const auditRec = (action, entity, id, detail) => ({ id: uid(), at: new Date().toISOString(), companyId: company?.id || '', syncStatus: company ? 'pending' : 'local', userId: me.id, userName: me.name, action, entity, entityId: id, detail: detail || '' });
function putMany(list) {
  return new Promise((res, rej) => {
    const tx = _db.transaction([...new Set(list.map(x => x[0]))], 'readwrite');
    list.forEach(([s, r]) => tx.objectStore(s).put(r));
    tx.oncomplete = () => { res(); syncSoon(); }; tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error || new Error('ذخیره لغو شد'));
  });
}
async function nextNo(type) {
  const id = 'seq:' + company.id + ':' + type, n = ((await getMeta(id)) || 0) + 1;
  return [n, ['meta', { id, value: n }]];
}
const move = (ref, date, itemId, whId, qty, unitCost, value) => newRec({ date, itemId, warehouseId: whId, qty: q3(qty), unitCost, value, refType: ref.type, refId: ref.id, refNo: ref.no || '' });
async function stockMap() {
  const m = {};
  for (const x of await rows('stockMoves')) { const k = x.itemId + '|' + x.warehouseId; const e = m[k] || (m[k] = { qty: 0, value: 0 }); e.qty = q3(e.qty + x.qty); e.value += x.value; }
  return m;
}
const unitName = async () => { const u = {}; for (const x of await rows('units')) u[x.id] = x.name; return u; };
const stockItems = async () => (await rows('items')).filter(i => i.kind !== 'خدمات');
const warehouses = async () => (await rows('nodes')).filter(n => n.kind === 'انبار');
const itemOpts = (items, units, sel) => `<option value="">انتخاب کالا</option>` + items.map(i => `<option value="${i.id}" ${i.id === sel ? 'selected' : ''}>${esc(i.name)} (${esc(units[i.unitId] || '')})</option>`).join('');
const whOpts = (ws, sel) => `<option value="">انتخاب انبار</option>` + ws.map(w => `<option value="${w.id}" ${w.id === sel ? 'selected' : ''}>${esc(w.name)}</option>`).join('');
const stLabel = s => ({ draft: 'پیش‌نویس', posted: 'ثبت‌شده', voided: 'باطل', planned: 'برنامه‌ریزی‌شده', done: 'انجام‌شده' }[s] || s);
const back = (act, t = 'بازگشت') => `<button class="back" data-act="${act}">‹ ${t}</button>`;

/* خروج کالا با میانگین موزون؛ در صورت کمبود موجودی خطا می‌دهد */
function issue(st, itemId, whId, qty, itemName) {
  const k = itemId + '|' + whId, e = st[k] || { qty: 0, value: 0 };
  if (qty > e.qty + 1e-9) throw new Error(`موجودی «${itemName}» در این انبار کافی نیست (موجودی: ${fmt(e.qty)}، درخواست: ${fmt(qty)}).`);
  const avg = e.qty > 0 ? e.value / e.qty : 0;
  const value = Math.abs(qty - e.qty) < 1e-9 ? e.value : rial(qty * avg);
  e.qty = q3(e.qty - qty); e.value -= value; st[k] = e;
  return { avg, value };
}
function receive(st, itemId, whId, qty, value) { const k = itemId + '|' + whId, e = st[k] || (st[k] = { qty: 0, value: 0 }); e.qty = q3(e.qty + qty); e.value += value; }

/* برگرداندن حرکت‌های یک سند (ابطال با سند معکوس، نه حذف) */
async function reversal(refId, ref) {
  const orig = (await rows('stockMoves')).filter(m => m.refId === refId && !m.reversal), st = await stockMap(), names = {};
  for (const i of await rows('items')) names[i.id] = i.name;
  const out = [];
  for (const m of orig) {
    const k = m.itemId + '|' + m.warehouseId, e = st[k] || (st[k] = { qty: 0, value: 0 });
    e.qty = q3(e.qty - m.qty); e.value -= m.value;
    if (e.qty < -1e-9) throw new Error(`ابطال ممکن نیست؛ از «${names[m.itemId] || ''}» پس از این سند مصرف یا فروش شده است.`);
    out.push({ ...newRec({ date: todayISO(), itemId: m.itemId, warehouseId: m.warehouseId, qty: -m.qty, unitCost: m.unitCost, value: -m.value, refType: ref.type, refId, refNo: ref.no || '' }), reversal: true });
  }
  return out;
}

/* ---------- منوی عملیات ---------- */
const KINDS = { purchase: 'خرید', sale: 'فروش', bom: 'فرمول ساخت', prod: 'سفارش تولید', stock: 'موجودی انبار', repVar: 'گزارش انحرافات', repOH: 'گزارش سربار و ظرفیت', repLine: 'گزارش خطوط تولید', repProf: 'سودآوری محصولات', pay: 'دریافت و پرداخت', jr: 'اسناد حسابداری', acc: 'تنظیمات حسابداری', recon: 'مغایرت‌گیری و دفاتر اکسل', fy: 'سال‌های مالی و بستن', rjr: 'دفتر روزنامه', rled: 'دفتر کل و گردش حساب', rtb: 'تراز آزمایشی', rpl: 'سود و زیان', rar: 'دریافتنی‌ها و پرداختنی‌ها', scn: 'سناریوها و مقایسه', rabc: 'مقایسه ABC با سربار سنتی', rfx: 'تسعیر ارز (مانده‌های ارزی)' };
const EXPORT_BTN = '<button class="btn alt" data-act="exportCsv">خروجی Excel (CSV)</button>';
const OPS_MAIN = ['purchase', 'sale', 'pay', 'bom', 'prod', 'stock'], OPS_REP = ['repVar', 'repOH', 'repLine', 'repProf'], OPS_ACC = ['jr', 'fy', 'acc'], FIN_REP = ['rjr', 'rled', 'rtb', 'rpl', 'rar'];
async function opsView() {
  const o = ui.op;
  if (!o) {
    const cnt = { purchase: (await rows('docs')).filter(d => d.type === 'purchase').length, sale: (await rows('docs')).filter(d => d.type === 'sale').length, pay: (await rows('docs')).filter(d => d.type === 'receipt' || d.type === 'payment').length, bom: (await rows('boms')).length, prod: (await rows('prodOrders')).length, jr: (await rows('journals')).length };
    const row = k => `<button class="row" data-act="opsOpen" data-k="${k}"><span class="t">${KINDS[k]}<span class="s">${cnt[k] !== undefined ? cnt[k] + ' مورد' : k === 'stock' ? 'مانده و ارزش کالا' : ''}</span></span><span class="c">‹</span></button>`;
    return `<h2>عملیات</h2>${OPS_MAIN.map(row).join('')}
    <h3>حسابداری مالی</h3>${row('recon')}${row('jr')}
    <button class="row" data-act="goEnt" data-ent="accounts"><span class="t">کدینگ حساب‌ها<span class="s">گروه، کل و معین</span></span><span class="c">‹</span></button>${row('fy')}${row('acc')}
    <h3>گزارش‌های مالی</h3>${FIN_REP.map(row).join('')}
    <h3>تنظیمات و ثبت هزینه‌یابی</h3>
    <button class="row" data-act="goEnt" data-ent="ohRates"><span class="t">مجموعه‌های سربار (نرخ تسهیم)<span class="s">مبنا، ظرفیت عادی و عملی</span></span><span class="c">‹</span></button>
    <button class="row" data-act="goEnt" data-ent="ohActuals"><span class="t">ثبت سربار واقعی<span class="s">برق، اجاره، استهلاک و…</span></span><span class="c">‹</span></button>
    <h3>گزارش‌های هزینه‌یابی</h3>${OPS_REP.map(row).join('')}
    <h3>هزینه‌یابی پیشرفته و سناریو</h3>
    <button class="row" data-act="goEnt" data-ent="activities"><span class="t">فعالیت‌ها و محرک‌های هزینه (ABC)<span class="s">هزینه و حجم محرک هر فعالیت</span></span><span class="c">‹</span></button>
    <button class="row" data-act="goEnt" data-ent="abcUsage"><span class="t">مصرف فعالیت‌ها برای هر محصول<span class="s">چند واحد محرک به ازای هر محصول</span></span><span class="c">‹</span></button>${row('rabc')}${row('scn')}
    <h3>ارز</h3>
    <button class="row" data-act="goEnt" data-ent="currencies"><span class="t">ارزها<span class="s">مثلاً USD، EUR</span></span><span class="c">‹</span></button>
    <button class="row" data-act="goEnt" data-ent="fxRates"><span class="t">نرخ ارز<span class="s">هر واحد ارز چند ریال، به تفکیک تاریخ</span></span><span class="c">‹</span></button>${row('rfx')}`;
  }
  if (o.kind === 'stock') return stockView();
  if (OPS_REP.includes(o.kind)) return (await reportView(o.kind)) + EXPORT_BTN;
  if (FIN_REP.includes(o.kind)) return (await finReport(o.kind)) + EXPORT_BTN;
  if (o.kind === 'rabc') return (await abcReport()) + EXPORT_BTN;
  if (o.kind === 'rfx') return (await fxReport()) + EXPORT_BTN;
  if (o.kind === 'scn') return o.cmp ? scnCompare() : o.id !== undefined ? scnForm() : scnList();
  if (o.kind === 'recon') return reconView();
  if (o.kind === 'acc') return accView();
  if (o.kind === 'fy') return fyView();
  if (o.kind === 'jr') return o.id !== undefined ? jrView() : jrList();
  if (o.kind === 'pay') return o.id !== undefined ? payView() : payList();
  if (o.kind === 'purchase' || o.kind === 'sale') return o.id !== undefined ? docForm() : docList();
  if (o.kind === 'bom') return o.id !== undefined ? bomView() : bomList();
  return o.id !== undefined ? prodView() : prodList();
}

/* ---------- موجودی ---------- */
async function stockView() {
  const st = await stockMap(), items = await stockItems(), ws = await warehouses(), u = await unitName();
  let total = 0, html = '';
  for (const w of ws) for (const i of items) {
    const e = st[i.id + '|' + w.id]; if (!e || (e.qty === 0 && e.value === 0)) continue;
    total += e.value;
    html += `<div class="row"><span class="t">${esc(i.name)}<span class="s">${esc(w.name)} – میانگین هر واحد: ${fmt(e.qty > 0 ? e.value / e.qty : 0, 0)} ریال</span></span><span><b>${fmt(e.qty)}</b> ${esc(u[i.unitId] || '')}<span class="s">${fmt(e.value, 0)} ریال</span></span></div>`;
  }
  return `${back('opBack')}<h2>موجودی انبار</h2>${html || `<div class="empty">هنوز کالایی وارد انبار نشده است. ابتدا یک خرید ثبت کنید.</div>`}
    ${html ? `<dl class="facts"><div><dt>ارزش کل موجودی (میانگین موزون)</dt><dd>${fmt(total, 0)} ریال</dd></div></dl>` : ''}`;
}

/* ---------- خرید و فروش ---------- */
async function docList() {
  const k = ui.op.kind, list = (await rows('docs')).filter(d => d.type === k).sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));
  return `${back('opBack')}<h2>${KINDS[k]}</h2>${list.map(d => `<button class="row" data-act="docOpen" data-id="${d.id}"><span class="t">${d.number ? esc(d.number) : 'پیش‌نویس'} – ${esc(d.partner || (k === 'sale' ? 'مشتری' : 'تأمین‌کننده'))}<span class="badge ${d.status === 'voided' ? 'off' : ''}">${stLabel(d.status)}</span><span class="s">${esc(fmtDay(d.date))} – ${fmt(d.total || 0, 0)} ریال</span></span><span class="c">‹</span></button>`).join('') || `<div class="empty">هنوز ${KINDS[k]}ی ثبت نشده است.</div>`}
    ${can('create') ? `<button class="fab" data-act="docNew">+ ${KINDS[k]} جدید</button>` : ''}`;
}
function syncLines() {
  const it = [...document.querySelectorAll('.li-item')], q = [...document.querySelectorAll('.li-qty')], p = [...document.querySelectorAll('.li-price')];
  return it.map((x, i) => ({ itemId: x.value, qty: q[i].value, price: p[i] ? p[i].value : '' }));
}
function syncDraft() {
  const f = $('#df'), D = ui.draft; if (!f || !D) return;
  const d = readDate(f, 'date'); if (d) D.date = d;
  D.partner = f.elements.partner.value; D.warehouseId = f.elements.wh.value; D.note = f.elements.note.value; D.lines = syncLines();
  D.currencyId = f.elements.cur ? f.elements.cur.value : ''; D.rate = f.elements.rate ? f.elements.rate.value : '';
}
function lineRows(items, units, lines, withPrice, ph) {
  return lines.map((L, i) => `<div class="ln ${withPrice ? '' : 'two'}"><select class="li-item">${itemOpts(items, units, L.itemId)}</select><input class="li-qty" type="text" inputmode="decimal" placeholder="مقدار" value="${esc(L.qty ?? '')}">${withPrice ? `<input class="li-price" type="text" inputmode="decimal" placeholder="${ph}" value="${esc(L.price ?? '')}">` : ''}<button class="x" data-act="rmLine" data-i="${i}" aria-label="حذف ردیف">×</button></div>`).join('');
}
async function docForm() {
  const o = ui.op, k = o.kind;
  let doc = o.id ? await get('docs', o.id) : null;
  if (doc && doc.status !== 'draft') return docDetail(doc);
  if (!ui.draft) ui.draft = doc ? { date: doc.date, partner: doc.partner, warehouseId: doc.warehouseId, note: doc.note || '', currencyId: doc.fx ? doc.fx.currencyId : '', rate: doc.fx ? String(doc.fx.rate) : '', lines: doc.lines.map(l => ({ itemId: l.itemId, qty: String(l.qty), price: String(l.priceFx ?? l.price) })) } : { date: todayISO(), partner: '', warehouseId: '', note: '', currencyId: '', rate: '', lines: [{}] };
  const D = ui.draft, items = await stockItems(), u = await unitName(), ws = await warehouses(), curs = await rows('currencies');
  const ok = can('create');
  return `${back('opBack')}<h2>${doc ? 'ویرایش پیش‌نویس' : KINDS[k] + ' جدید'}</h2>
  ${ws.length ? '' : `<div class="warn">ابتدا در «اطلاعات پایه ← انبار، دپارتمان…» یک انبار تعریف کنید.</div>`}
  ${items.length ? '' : `<div class="warn">ابتدا در «اطلاعات پایه ← کالاها» کالا تعریف کنید.</div>`}
  <form id="df" onsubmit="return false"><label>تاریخ</label>${dateField('date', D.date)}
  <label>${k === 'sale' ? 'مشتری' : 'تأمین‌کننده'}</label><input type="text" name="partner" value="${esc(D.partner)}">
  <label>انبار *</label><select name="wh">${whOpts(ws, D.warehouseId)}</select>
  ${curs.length ? `<label>ارز سند</label><select name="cur" data-change="docCur"><option value="">ریال ایران</option>${curs.map(c => `<option value="${c.id}" ${c.id === D.currencyId ? 'selected' : ''}>${esc(c.code)} – ${esc(c.name)}</option>`).join('')}</select>${D.currencyId ? `<label>نرخ تبدیل (هر واحد ارز چند ریال) *</label><input type="text" inputmode="decimal" name="rate" value="${esc(D.rate)}">` : ''}` : ''}
  <h3>اقلام (قیمت‌ها به ${D.currencyId ? 'ارز انتخاب‌شده' : 'ریال'})</h3><div id="lines">${lineRows(items, u, D.lines, true, k === 'sale' ? 'قیمت فروش هر واحد' : 'قیمت خرید هر واحد')}</div>
  <button class="btn alt sm" data-act="addLine" type="button">+ ردیف</button>
  <label>توضیحات</label><input type="text" name="note" value="${esc(D.note)}"></form>
  ${ok ? `<button class="btn" data-act="docPost">ثبت نهایی</button><button class="btn alt" data-act="docDraft">ذخیره پیش‌نویس</button>` : ''}
  ${doc && can('void') ? `<button class="btn bad" data-act="docDelDraft">حذف پیش‌نویس</button>` : ''}`;
}
async function docSubmit(post) {
  syncDraft(); const D = ui.draft, k = ui.op.kind, f = $('#df');
  const iso = readDate(f, 'date'); if (!iso) return err('تاریخ معتبر نیست؛ روز، ماه و سال را بررسی کنید.');
  if (!D.warehouseId) return err('انبار را انتخاب کنید.');
  const items = {}; for (const i of await stockItems()) items[i.id] = i;
  const lines = [];
  for (const L of D.lines) {
    if (!L.itemId && !L.qty && !L.price) continue;
    const qty = num(L.qty), price = num(L.price);
    if (!L.itemId) return err('برای هر ردیف یک کالا انتخاب کنید.');
    if (!(qty > 0)) return err('مقدار هر ردیف باید عددی بزرگ‌تر از صفر باشد.');
    if (!(price >= 0)) return err('قیمت هر ردیف را به‌صورت عدد (صفر یا بیشتر) وارد کنید.');
    lines.push({ itemId: L.itemId, qty: q3(qty), price });
  }
  if (!lines.length) return err('حداقل یک ردیف کالا وارد کنید.');
  let fx = null;
  if (D.currencyId) {
    const rate = num(D.rate); if (!(rate > 0)) return err('نرخ تبدیل ارز را وارد کنید.');
    const cur = await get('currencies', D.currencyId);
    lines.forEach(l => { l.priceFx = l.price; l.price = l.price * rate; });
    fx = { currencyId: cur.id, code: cur.code, rate, total: q2(lines.reduce((x, l) => x + l.qty * l.priceFx, 0)), settled: 0 };
  }
  const old = ui.op.id ? await get('docs', ui.op.id) : null;
  const base = { type: k, date: iso, partner: D.partner.trim(), warehouseId: D.warehouseId, note: D.note.trim(), fx };
  if (!post) {
    const rec = old ? touch({ ...old, ...base, lines, total: lines.reduce((s, l) => s + rial(l.qty * l.price), 0) }) : newRec({ ...base, lines, status: 'draft', number: '', total: lines.reduce((s, l) => s + rial(l.qty * l.price), 0) });
    await putMany([['docs', rec], ['audit', auditRec('ذخیره پیش‌نویس', 'docs', rec.id, KINDS[k])]]);
    ui.op.id = undefined; ui.draft = null; toast('پیش‌نویس ذخیره شد'); return render();
  }
  if (!can('post')) return err('اجازه «ثبت و تأیید اسناد» را ندارید.');
  if (!dateWarn(iso)) return;
  try {
    const [n, seq] = await nextNo(k), no = (k === 'sale' ? 'ف-' : 'خ-') + devCode + n, st = await stockMap();
    const id = old ? old.id : uid(), moves = []; let total = 0, cogs = 0;
    for (const l of lines) {
      const amount = rial(l.qty * l.price); total += amount;
      if (k === 'purchase') { receive(st, l.itemId, D.warehouseId, l.qty, amount); moves.push(move({ type: k, id, no }, iso, l.itemId, D.warehouseId, l.qty, l.price, amount)); l.cost = l.price; l.value = amount; }
      else { const r = issue(st, l.itemId, D.warehouseId, l.qty, items[l.itemId].name); cogs += r.value; l.cost = r.avg; l.value = r.value; l.amount = amount; moves.push(move({ type: k, id, no }, iso, l.itemId, D.warehouseId, -l.qty, r.avg, -r.value)); }
    }
    const rec = old ? touch({ ...old, ...base, lines, status: 'posted', number: no, total, cogs }) : { ...newRec({ ...base, lines, status: 'posted', number: no, total, cogs }), id };
    const J = await docJournal(rec, items); if (J) rec.journalId = J.rec.id;
    await putMany([['docs', rec], ...moves.map(m => ['stockMoves', m]), seq, ...(J ? J.entries : []), ['audit', auditRec('ثبت نهایی', 'docs', id, no)]]);
    ui.op.id = id; ui.draft = null; toast('سند ثبت شد'); render();
  } catch (e) { err(e.message); }
}
async function docDetail(doc) {
  const items = {}; for (const i of await rows('items')) items[i.id] = i;
  const k = doc.type, sale = k === 'sale';
  return `${back('opBack')}<h2>${KINDS[k]} ${esc(doc.number)}<span class="badge ${doc.status === 'voided' ? 'off' : ''}">${stLabel(doc.status)}</span></h2>
  <dl class="facts"><div><dt>تاریخ</dt><dd>${esc(fmtDay(doc.date))}</dd></div><div><dt>${sale ? 'مشتری' : 'تأمین‌کننده'}</dt><dd>${esc(doc.partner || '—')}</dd></div><div><dt>انبار</dt><dd>${esc(await refName('nodes', doc.warehouseId))}</dd></div></dl>
  ${doc.fx ? `<dl class="facts"><div><dt>ارز و نرخ</dt><dd>${esc(doc.fx.code)} – ${fmt(doc.fx.rate, 2)} ریال</dd></div><div><dt>مبلغ ارزی</dt><dd>${fmt(doc.fx.total, 2)} ${esc(doc.fx.code)}</dd></div><div><dt>تسویه‌شده / مانده</dt><dd>${fmt(doc.fx.settled, 2)} / ${fmt(doc.fx.total - doc.fx.settled, 2)}</dd></div></dl>` : ''}
  <div class="tr h"><span>کالا</span><span>مقدار</span><span>${sale ? 'قیمت فروش' : 'قیمت'} (ریال)</span><span>مبلغ</span></div>
  ${doc.lines.map(l => `<div class="tr"><span>${esc(items[l.itemId]?.name || '—')}</span><span>${fmt(l.qty)}</span><span>${fmt(l.price, 0)}</span><span>${fmt(rial(l.qty * l.price), 0)}</span></div>`).join('')}
  <dl class="facts"><div><dt>جمع کل</dt><dd>${fmt(doc.total, 0)} ریال</dd></div>
  ${sale ? `<div><dt>بهای کالای فروش‌رفته</dt><dd>${fmt(doc.cogs, 0)} ریال</dd></div><div><dt>سود ناخالص</dt><dd>${fmt(doc.total - doc.cogs, 0)} ریال</dd></div>` : ''}</dl>
  ${doc.note ? `<p>${esc(doc.note)}</p>` : ''}
  ${doc.status === 'posted' && can('void') ? `<button class="btn bad" data-act="docVoid">ابطال این سند</button>` : ''}`;
}
async function docVoid() {
  const doc = await get('docs', ui.op.id);
  if (!can('void') || doc.status !== 'posted' || !confirm('این سند باطل شود؟ یک سند معکوس ثبت می‌شود و سابقه سند اصلی می‌ماند.')) return;
  try {
    const rev = await reversal(doc.id, { type: doc.type, no: doc.number + ' (ابطال)' });
    const jr = doc.journalId ? await reverseJ(doc.journalId, doc.number) : [], ex = [];
    if (doc.fx && doc.fx.settleDocId) { const sd = await get('docs', doc.fx.settleDocId); ex.push(['docs', touch({ ...sd, fx: { ...sd.fx, settled: q2(sd.fx.settled - doc.fx.amount) } })]); }
    await putMany([['docs', touch({ ...doc, status: 'voided' })], ...rev.map(m => ['stockMoves', m]), ...jr, ...ex, ['audit', auditRec('ابطال سند', 'docs', doc.id, doc.number)]]);
    toast('سند باطل شد'); render();
  } catch (e) { err(e.message); }
}
async function docDelDraft() {
  if (!can('void') || !confirm('این پیش‌نویس حذف شود؟')) return;
  const d = await get('docs', ui.op.id);
  await putMany([['docs', touch({ ...d, voided: true })], ['audit', auditRec('حذف پیش‌نویس', 'docs', d.id, '')]]);
  ui.op.id = undefined; ui.draft = null; render();
}

/* ---------- فرمول ساخت (BOM) ---------- */
async function bomList() {
  const list = (await rows('boms')).sort((a, b) => a.productName.localeCompare(b.productName, 'fa') || b.version - a.version);
  return `${back('opBack')}<h2>فرمول‌های ساخت</h2>${list.map(b => `<button class="row" data-act="bomOpen" data-id="${b.id}"><span class="t">${esc(b.productName)} – نسخه ${fmt(b.version, 0)}<span class="badge ${b.active ? '' : 'off'}">${b.active ? 'فعال' : 'قدیمی'}</span><span class="s">برای تولید ${fmt(b.outputQty)} واحد – ${b.lines.length} ماده</span></span><span class="c">‹</span></button>`).join('') || `<div class="empty">هنوز فرمولی ثبت نشده است.</div>`}
  ${can('create') ? `<button class="fab" data-act="bomNew">+ فرمول جدید</button>` : ''}`;
}
async function bomView() {
  const o = ui.op;
  if (o.id) {
    const b = await get('boms', o.id), items = {}, u = await unitName(); for (const i of await rows('items')) items[i.id] = i;
    return `${back('opBack')}<h2>${esc(b.productName)} – نسخه ${fmt(b.version, 0)}</h2>
    <p>مواد لازم برای تولید <b>${fmt(b.outputQty)}</b> واحد محصول:</p>${b.lines.map(l => `<div class="row"><span class="t">${esc(items[l.itemId]?.name || '—')}</span><b>${fmt(l.qty)} ${esc(u[items[l.itemId]?.unitId] || '')}</b></div>`).join('')}
    <dl class="facts"><div><dt>ساعت کار مستقیم استاندارد</dt><dd>${fmt(b.stdHours || 0)}</dd></div><div><dt>نرخ استاندارد دستمزد هر ساعت</dt><dd>${fmt(b.laborRate || 0, 0)} ریال</dd></div><div><dt>ضایعات عادی</dt><dd>${fmt(b.scrapPct || 0)}٪</dd></div></dl>
    ${can('create') ? `<button class="btn" data-act="bomNewVer">ساخت نسخه جدید از این فرمول</button>` : ''}
    ${can('void') && b.active ? `<button class="btn bad" data-act="bomVoid">ابطال این نسخه</button>` : ''}`;
  }
  if (!ui.draft) ui.draft = { productId: '', outputQty: '1', hrs: '', rate: '', scr: '', lines: [{}] };
  const D = ui.draft, items = await stockItems(), u = await unitName(), prods = items.filter(i => i.kind === 'محصول نهایی' || i.kind === 'کالای نیمه‌ساخته');
  return `${back('opBack')}<h2>فرمول ساخت جدید</h2>${prods.length ? '' : `<div class="warn">ابتدا کالایی از نوع «محصول نهایی» یا «کالای نیمه‌ساخته» تعریف کنید.</div>`}
  <form id="bf" onsubmit="return false"><label>محصول *</label><select name="prod">${itemOpts(prods, u, D.productId)}</select>
  <label>مقدار تولیدِ این فرمول (مثلاً ۱۰۰ کیلوگرم) *</label><input type="text" inputmode="decimal" name="out" value="${esc(D.outputQty)}">
  <h3>مواد مصرفی برای همین مقدار</h3><div id="lines">${lineRows(items, u, D.lines, false)}</div>
  <h3>استانداردهای دستمزد و ضایعات (اختیاری)</h3>
  <label>ساعت کار مستقیم استاندارد برای همین مقدار</label><input type="text" inputmode="decimal" name="hrs" value="${esc(D.hrs)}">
  <label>نرخ استاندارد دستمزد هر ساعت (ریال)</label><input type="text" inputmode="decimal" name="rate" value="${esc(D.rate)}">
  <label>درصد ضایعات عادی (مثلاً ۲)</label><input type="text" inputmode="decimal" name="scr" value="${esc(D.scr)}"></form>
  <button class="btn alt sm" data-act="addLine" type="button">+ ماده</button><button class="btn" data-act="bomSave">ذخیره فرمول</button>`;
}
function syncBom() { const f = $('#bf'); if (!f) return; const D = ui.draft; D.productId = f.elements.prod.value; D.outputQty = f.elements.out.value; D.hrs = f.elements.hrs.value; D.rate = f.elements.rate.value; D.scr = f.elements.scr.value; D.lines = syncLines(); }
const n0 = s => { const v = num(s); return isNaN(v) ? 0 : v; };
async function bomSave() {
  syncBom(); const D = ui.draft, out = num(D.outputQty);
  if (!D.productId) return err('محصول را انتخاب کنید.');
  if (!(out > 0)) return err('مقدار تولید باید عددی بزرگ‌تر از صفر باشد.');
  for (const [v, t] of [[D.hrs, 'ساعت کار استاندارد'], [D.rate, 'نرخ دستمزد استاندارد'], [D.scr, 'درصد ضایعات']]) if (String(v).trim() !== '' && !(num(v) >= 0)) return err(`«${t}» باید عدد صفر یا بیشتر باشد.`);
  if (n0(D.scr) >= 100) return err('درصد ضایعات باید کمتر از ۱۰۰ باشد.');
  const lines = [], seen = new Set();
  for (const L of D.lines) {
    if (!L.itemId && !L.qty) continue; const q = num(L.qty);
    if (!L.itemId || !(q > 0)) return err('هر ماده باید کالا و مقدار بزرگ‌تر از صفر داشته باشد.');
    if (L.itemId === D.productId) return err('محصول نمی‌تواند ماده‌ی مصرفی خودش باشد.');
    if (seen.has(L.itemId)) return err('یک ماده بیش از یک بار آمده است؛ مقدارها را در یک ردیف جمع کنید.');
    seen.add(L.itemId); lines.push({ itemId: L.itemId, qty: q3(q) });
  }
  if (!lines.length) return err('حداقل یک ماده‌ی مصرفی وارد کنید.');
  const all = (await rows('boms')).filter(b => b.productId === D.productId), ver = all.reduce((m, b) => Math.max(m, b.version), 0) + 1;
  const p = await get('items', D.productId);
  const rec = newRec({ productId: D.productId, productName: p.name, version: ver, outputQty: q3(out), lines, active: true, stdHours: q3(n0(D.hrs)), laborRate: n0(D.rate), scrapPct: n0(D.scr) });
  await putMany([['boms', rec], ...all.filter(b => b.active).map(b => ['boms', touch({ ...b, active: false })]), ['audit', auditRec('ایجاد فرمول', 'boms', rec.id, p.name + ' نسخه ' + ver)]]);
  ui.op.id = undefined; ui.draft = null; toast('فرمول ذخیره شد'); render();
}
async function bomVoid() {
  if (!confirm('این نسخه باطل شود؟ سفارش‌های تولیدِ قبلی تغییری نمی‌کنند.')) return;
  const b = await get('boms', ui.op.id);
  await putMany([['boms', touch({ ...b, voided: true, active: false })], ['audit', auditRec('ابطال فرمول', 'boms', b.id, b.productName)]]);
  ui.op.id = undefined; render();
}

/* ---------- سفارش تولید ---------- */
async function prodList() {
  const list = (await rows('prodOrders')).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return `${back('opBack')}<h2>سفارش‌های تولید</h2>${list.map(p => `<button class="row" data-act="prodOpen" data-id="${p.id}"><span class="t">${esc(p.number)} – ${esc(p.productName)}<span class="badge ${p.status === 'voided' ? 'off' : ''}">${stLabel(p.status)}</span><span class="s">${esc(fmtDay(p.date))} – برنامه: ${fmt(p.plannedQty)}${p.status === 'done' ? ' – واقعی: ' + fmt(p.actualQty) : ''}</span></span><span class="c">‹</span></button>`).join('') || `<div class="empty">هنوز سفارش تولیدی ثبت نشده است.</div>`}
  ${can('create') ? `<button class="fab" data-act="prodNew">+ سفارش جدید</button>` : ''}`;
}
const ohRate = pool => pool ? n0(pool.fixedBudget) / n0(pool.normalCap) + n0(pool.varRate) : 0;
async function lineNodes() { return (await rows('nodes')).filter(n => n.kind === 'خط تولید'); }
const sgn = v => v === 0 ? '۰' : (v > 0 ? '+' : '−') + fmt(Math.abs(v), 0);
const fav = v => v > 0 ? ' (نامطلوب)' : v < 0 ? ' (مطلوب)' : '';
async function prodView() {
  const o = ui.op, ws = await warehouses(), items = {}, u = await unitName(); for (const i of await rows('items')) items[i.id] = i;
  if (!o.id) {
    const boms = (await rows('boms')).filter(b => b.active), lines = await lineNodes(), pools = await rows('ohRates');
    return `${back('opBack')}<h2>سفارش تولید جدید</h2>${boms.length ? '' : `<div class="warn">ابتدا برای محصول یک فرمول ساخت ثبت کنید.</div>`}
    <form id="pn" onsubmit="return false"><label>تاریخ</label>${dateField('date', todayISO())}
    <label>محصول (بر اساس فرمول فعال) *</label><select name="bom"><option value="">انتخاب کنید</option>${boms.map(b => `<option value="${b.id}">${esc(b.productName)} – نسخه ${fmt(b.version, 0)}</option>`).join('')}</select>
    <label>مقدار برنامه‌ریزی‌شده *</label><input type="text" inputmode="decimal" name="qty">
    <label>انبار مواد اولیه *</label><select name="raw">${whOpts(ws)}</select>
    <label>انبار محصول ساخته‌شده *</label><select name="fin">${whOpts(ws)}</select>
    <label>خط تولید (اختیاری)</label><select name="line"><option value="">بدون خط</option>${lines.map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}</select>
    <label>مجموعه سربار برای تسهیم (اختیاری)</label><select name="oh"><option value="">بدون سربار</option>${pools.map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}</select></form>
    <button class="btn" data-act="prodSave">ثبت سفارش</button>`;
  }
  const p = await get('prodOrders', o.id), st = await stockMap(), rawName = await refName('nodes', p.rawWh), finName = await refName('nodes', p.finWh);
  const head = `${back('opBack')}<h2>${esc(p.number)} – ${esc(p.productName)}<span class="badge ${p.status === 'voided' ? 'off' : ''}">${stLabel(p.status)}</span></h2>
  <dl class="facts"><div><dt>تاریخ</dt><dd>${esc(fmtDay(p.date))}</dd></div><div><dt>انبار مواد / محصول</dt><dd>${esc(rawName)} / ${esc(finName)}</dd></div><div><dt>مقدار برنامه</dt><dd>${fmt(p.plannedQty)}</dd></div><div><dt>فرمول</dt><dd>نسخه ${fmt(p.bomVersion, 0)}</dd></div>${p.lineName ? `<div><dt>خط تولید</dt><dd>${esc(p.lineName)}</dd></div>` : ''}${p.ohName ? `<div><dt>مجموعه سربار</dt><dd>${esc(p.ohName)}</dd></div>` : ''}</dl>`;
  if (p.status === 'planned') {
    return `${head}<form id="pf" onsubmit="return false"><h3>ثبت تولید واقعی</h3><label>تاریخ پایان تولید</label>${dateField('date', p.date)}
    <label>مقدار محصول سالم تولیدشده *</label><input type="text" inputmode="decimal" name="out" value="${p.plannedQty}">
    <label>مقدار ضایعات (اگر نبود خالی)</label><input type="text" inputmode="decimal" name="scrap">
    <label>ساعت کار مستقیم واقعی</label><input type="text" inputmode="decimal" name="hrs">
    <label>هزینه دستمزد مستقیم واقعی (ریال)</label><input type="text" inputmode="decimal" name="labor">
    <h3>مصرف واقعی مواد</h3>${p.lines.map((l, i) => { const e = st[l.itemId + '|' + p.rawWh]; return `<label>${esc(items[l.itemId]?.name || '')} – استاندارد برنامه: ${fmt(l.standardQty)} ${esc(u[items[l.itemId]?.unitId] || '')} (موجودی: ${fmt(e ? e.qty : 0)})</label><input type="text" inputmode="decimal" name="c${i}" value="${l.standardQty}">`; }).join('')}</form>
    ${can('post') ? `<button class="btn" data-act="prodDone">ثبت تولید و محاسبه بها</button>` : ''}
    ${can('void') ? `<button class="btn bad" data-act="prodVoid">ابطال سفارش</button>` : ''}`;
  }
  if (p.status === 'voided') return head;
  const V = p.var || {}, M = p.materialCost ?? p.totalCost, row = (a, b) => `<div class="row"><span class="t">${a}</span><b>${b}</b></div>`;
  return `${head}<h3>مقدار</h3><dl class="facts"><div><dt>محصول سالم</dt><dd>${fmt(p.actualQty)}</dd></div>${p.scrapQty ? `<div><dt>ضایعات</dt><dd>${fmt(p.scrapQty)}</dd></div>` : ''}</dl>
  <h3>مواد مصرفی (استاندارد مجاز برای تولید واقعی در برابر واقعی)</h3>
  <div class="tr h"><span>ماده</span><span>استاندارد</span><span>واقعی</span><span>ارزش (ریال)</span></div>
  ${p.lines.map(l => `<div class="tr"><span>${esc(items[l.itemId]?.name || '')}</span><span>${fmt(l.stdQty ?? l.standardQty)}</span><span>${fmt(l.actualQty)}</span><span>${fmt(l.value, 0)}</span></div>`).join('')}
  <h3>محاسبه بهای تمام‌شده (قابل ردیابی)</h3>
  ${row('مواد مستقیم', fmt(M, 0))}${row(`دستمزد مستقیم (${fmt(p.actualHours || 0)} ساعت)`, fmt(p.laborCost || 0, 0))}${row(`سربار تسهیم‌شده${p.ohRate ? ' (نرخ ' + fmt(p.ohRate, 2) + ' به ازای هر ' + esc(p.ohBase) + ')' : ''}`, fmt(p.ohApplied || 0, 0))}
  ${row('<b>جمع هزینه‌های تولید</b>', '<b>' + fmt(p.totalCost, 0) + '</b>')}
  ${p.lossValue ? row('کسر: زیان ضایعات غیرعادی', fmt(p.lossValue, 0)) : ''}
  ${row('<b>ارزش محصول سالم (وارد انبار)</b>', '<b>' + fmt(p.inventoryValue ?? p.totalCost, 0) + '</b>')}
  <dl class="facts"><div><dt>بهای تمام‌شده هر واحد</dt><dd>${fmt(p.unitCost, 2)} ریال</dd></div>${p.stdTotal !== undefined ? `<div><dt>بهای استاندارد برای تولید واقعی</dt><dd>${fmt(p.stdTotal, 0)} ریال</dd></div>` : ''}</dl>
  ${p.var ? `<h3>تحلیل انحرافات (مثبت = نامطلوب)</h3>${row('قیمت مواد', sgn(V.matPrice) + fav(V.matPrice))}${row('مصرف مواد', sgn(V.matUsage) + fav(V.matUsage))}${row('نرخ دستمزد', sgn(V.laborRate) + fav(V.laborRate))}${row('کارایی دستمزد', sgn(V.laborEff) + fav(V.laborEff))}${row('کارایی سربار', sgn(V.ohEff) + fav(V.ohEff))}${row('<b>جمع انحرافات</b>', '<b>' + sgn(p.totalCost - p.stdTotal) + '</b>')}` : ''}
  ${p.var ? '' : `<p class="warn">این سفارش با نسخه فاز ۲ ثبت شده و فقط مواد مستقیم دارد.</p>`}
  ${can('void') ? `<button class="btn bad" data-act="prodVoid">ابطال تولید</button>` : ''}`;
}
async function prodSave() {
  const f = $('#pn'), iso = readDate(f, 'date'), bomId = f.elements.bom.value, qty = num(f.elements.qty.value);
  if (!iso) return err('تاریخ معتبر نیست.'); if (!bomId) return err('محصول را انتخاب کنید.');
  if (!(qty > 0)) return err('مقدار برنامه‌ریزی‌شده باید عددی بزرگ‌تر از صفر باشد.');
  if (!f.elements.raw.value || !f.elements.fin.value) return err('انبار مواد و انبار محصول را انتخاب کنید.');
  if (!dateWarn(iso)) return;
  const b = await get('boms', bomId), [n, seq] = await nextNo('prod');
  const line = f.elements.line.value ? await get('nodes', f.elements.line.value) : null, pool = f.elements.oh.value ? await get('ohRates', f.elements.oh.value) : null;
  const rec = newRec({ number: 'ت-' + devCode + n, date: iso, productId: b.productId, productName: b.productName, bomId, bomVersion: b.version, plannedQty: q3(qty), rawWh: f.elements.raw.value, finWh: f.elements.fin.value, status: 'planned',
    bomOut: b.outputQty, stdHours: b.stdHours || 0, laborRate: b.laborRate || 0, scrapPct: b.scrapPct || 0,
    lineId: line ? line.id : '', lineName: line ? line.name : '', ohId: pool ? pool.id : '', ohName: pool ? pool.name : '',
    lines: b.lines.map(l => ({ itemId: l.itemId, bomQty: l.qty, standardQty: q3(l.qty * qty / b.outputQty) })) });
  await putMany([['prodOrders', rec], seq, ['audit', auditRec('ایجاد سفارش تولید', 'prodOrders', rec.id, rec.number)]]);
  ui.op.id = rec.id; toast('سفارش ثبت شد'); render();
}
async function prodDone() {
  if (!can('post')) return err('اجازه «ثبت و تأیید اسناد» را ندارید.');
  const f = $('#pf'), p = await get('prodOrders', ui.op.id), iso = readDate(f, 'date');
  const opt = name => { const v = f.elements[name].value.trim(); return v === '' ? 0 : num(v); };
  const out = num(f.elements.out.value), scrap = opt('scrap'), hrs = opt('hrs'), lab = opt('labor');
  if (!iso) return err('تاریخ معتبر نیست.'); if (!(out > 0)) return err('مقدار محصول سالم باید بزرگ‌تر از صفر باشد.');
  if (!(scrap >= 0) || !(hrs >= 0) || !(lab >= 0)) return err('ضایعات، ساعت کار و دستمزد باید عدد صفر یا بیشتر باشند.');
  if (lab > 0 && hrs === 0) return err('برای ثبت دستمزد، ساعت کار مستقیم را هم وارد کنید.');
  if (!dateWarn(iso)) return;
  const items = {}; for (const i of await rows('items')) items[i.id] = i;
  const pool = p.ohId ? await get('ohRates', p.ohId) : null;
  try {
    const st = await stockMap(), moves = [], lines = [], ref = { type: 'prod', id: p.id, no: p.number }, units = q3(out + scrap);
    let M = 0, stdMat = 0, matPrice = 0, matUsage = 0;
    for (let i = 0; i < p.lines.length; i++) {
      const a = num(f.elements['c' + i].value); if (!(a >= 0)) throw new Error('مصرف واقعی هر ماده باید عدد صفر یا بیشتر باشد.');
      const l = p.lines[i], qty = q3(a), perUnit = l.bomQty !== undefined ? l.bomQty / p.bomOut : l.standardQty / p.plannedQty;
      const k = l.itemId + '|' + p.rawWh, e = st[k], avgNow = e && e.qty > 0 ? e.value / e.qty : 0;
      let value = 0, avg = avgNow; if (qty > 0) { const r = issue(st, l.itemId, p.rawWh, qty, items[l.itemId].name); value = r.value; avg = r.avg; moves.push(move(ref, iso, l.itemId, p.rawWh, -qty, r.avg, -r.value)); }
      const sp = num(items[l.itemId].stdPrice), stdPrice = sp > 0 ? sp : avg, stdQty = q3(perUnit * units);
      const stdCost = rial(stdQty * stdPrice), useAct = rial(qty * stdPrice);
      M += value; stdMat += stdCost; matPrice += value - useAct; matUsage += useAct - stdCost;
      lines.push({ ...l, stdQty, actualQty: qty, unitCost: avg, stdPrice, value });
    }
    const stdHrs = q3((p.stdHours || 0) / (p.bomOut || 1) * units), stdRate = p.laborRate || 0, stdLabor = rial(stdHrs * stdRate), useH = rial(hrs * stdRate);
    const laborRate = lab - useH, laborEff = useH - stdLabor;
    let applied = 0, stdOH = 0, rate = 0, base = '';
    if (pool) {
      rate = ohRate(pool); base = pool.base;
      const aBase = base === 'ساعت کار مستقیم' ? hrs : base === 'مقدار تولید' ? out : M, sBase = base === 'ساعت کار مستقیم' ? stdHrs : base === 'مقدار تولید' ? out : stdMat;
      applied = rial(rate * aBase); stdOH = rial(rate * sBase);
    }
    const C = M + lab + applied, stdTotal = stdMat + stdLabor + stdOH;
    const normalAllowed = q3((p.scrapPct || 0) / 100 * units), abnormal = Math.max(0, q3(scrap - normalAllowed));
    const loss = scrap > 0 ? rial(abnormal * C / units) : 0, invValue = C - loss, unitCost = Math.round(invValue / out * 100) / 100;
    moves.push(move(ref, iso, p.productId, p.finWh, out, unitCost, invValue));
    const rec = touch({ ...p, status: 'done', date: iso, actualQty: q3(out), scrapQty: q3(scrap), actualHours: hrs, laborCost: lab, lines, materialCost: M, ohApplied: applied, ohRate: rate, ohBase: base,
      ohBaseQty: pool ? (base === 'ساعت کار مستقیم' ? hrs : base === 'مقدار تولید' ? out : M) : 0, totalCost: C, lossValue: loss, inventoryValue: invValue, unitCost, stdTotal, units,
      var: { matPrice, matUsage, laborRate, laborEff, ohEff: applied - stdOH } });
    const J = await prodJournal(rec, items); if (J) rec.journalId = J.rec.id;
    await putMany([['prodOrders', rec], ...moves.map(m => ['stockMoves', m]), ...(J ? J.entries : []), ['audit', auditRec('ثبت تولید', 'prodOrders', p.id, p.number)]]);
    toast('تولید ثبت شد'); render();
  } catch (e) { err(e.message); }
}
async function prodVoid() {
  if (!can('void')) return;
  const p = await get('prodOrders', ui.op.id);
  if (!confirm(p.status === 'done' ? 'این تولید باطل شود؟ مواد به انبار برمی‌گردد و محصول از انبار کم می‌شود.' : 'این سفارش باطل شود؟')) return;
  try {
    const rev = p.status === 'done' ? await reversal(p.id, { type: 'prod', no: p.number + ' (ابطال)' }) : [];
    const jr = p.journalId && p.status === 'done' ? await reverseJ(p.journalId, p.number) : [];
    await putMany([['prodOrders', touch({ ...p, status: 'voided' })], ...rev.map(m => ['stockMoves', m]), ...jr, ['audit', auditRec('ابطال سفارش تولید', 'prodOrders', p.id, p.number)]]);
    toast('باطل شد'); render();
  } catch (e) { err(e.message); }
}

/* ---------- ثبت رویدادها ---------- */
Object.assign(ACT, {
  opsOpen: d => { ui.op = { kind: d.k, id: undefined }; ui.draft = null; render(); },
  opBack: () => { if (ui.op && ui.op.id !== undefined) { ui.op.id = undefined; ui.draft = null; } else ui.op = null; render(); },
  docNew: () => { ui.op.id = null; ui.draft = null; render(); },
  docOpen: d => { ui.op.id = d.id; ui.draft = null; render(); },
  addLine: () => { if (ui.op.kind === 'bom') syncBom(); else syncDraft(); ui.draft.lines.push({}); render(); },
  rmLine: d => { if (ui.op.kind === 'bom') syncBom(); else syncDraft(); ui.draft.lines.splice(+d.i, 1); if (!ui.draft.lines.length) ui.draft.lines.push({}); render(); },
  docPost: () => docSubmit(true), docDraft: () => docSubmit(false), docVoid, docDelDraft,
  bomNew: () => { ui.op.id = null; ui.draft = null; render(); },
  bomOpen: d => { ui.op.id = d.id; ui.draft = null; render(); },
  bomNewVer: async () => { const b = await get('boms', ui.op.id); ui.draft = { productId: b.productId, outputQty: String(b.outputQty), hrs: b.stdHours ? String(b.stdHours) : '', rate: b.laborRate ? String(b.laborRate) : '', scr: b.scrapPct ? String(b.scrapPct) : '', lines: b.lines.map(l => ({ itemId: l.itemId, qty: String(l.qty) })) }; ui.op.id = null; render(); },
  bomSave, bomVoid,
  prodNew: () => { ui.op.id = null; render(); },
  prodOpen: d => { ui.op.id = d.id; render(); },
  prodSave, prodDone, prodVoid
});

/* ---------- گزارش‌ها ---------- */
const inR = d => d >= ui.rep.from && d <= ui.rep.to;
async function reportView(kind) {
  if (!ui.rep) { const t = new Date(); t.setFullYear(t.getFullYear() - 1); ui.rep = { from: isoOf(t), to: todayISO() }; }
  const orders = (await rows('prodOrders')).filter(p => p.status === 'done' && inR(p.date) && (!ui.rep.productId || p.productId === ui.rep.productId));
  let body = '';
  if (kind === 'repVar') {
    const T = { matPrice: 0, matUsage: 0, laborRate: 0, laborEff: 0, ohEff: 0 }; let tot = 0;
    const list = orders.filter(p => p.var).sort((a, b) => b.date.localeCompare(a.date));
    for (const p of list) { for (const k in T) T[k] += p.var[k]; tot += p.totalCost - p.stdTotal; }
    const lab = { matPrice: 'قیمت مواد', matUsage: 'مصرف مواد', laborRate: 'نرخ دستمزد', laborEff: 'کارایی دستمزد', ohEff: 'کارایی سربار' };
    body = list.length ? `<dl class="facts">${Object.keys(T).map(k => `<div><dt>${lab[k]}</dt><dd>${sgn(T[k])}${fav(T[k])}</dd></div>`).join('')}<div><dt><b>جمع انحرافات</b></dt><dd>${sgn(tot)}${fav(tot)}</dd></div></dl>
      <p class="warn">مثبت یعنی هزینه واقعی بیشتر از استاندارد (نامطلوب).</p><h3>به تفکیک سفارش</h3>
      ${list.map(p => `<button class="row" data-act="prodFromRep" data-id="${p.id}"><span class="t">${esc(p.number)} – ${esc(p.productName)}<span class="s">${esc(fmtDay(p.date))}</span></span><b>${sgn(p.totalCost - p.stdTotal)}</b></button>`).join('')}` : `<div class="empty">در این بازه سفارش تولیدِ تکمیل‌شده‌ای نیست.</div>`;
  } else if (kind === 'repOH') {
    const pools = await rows('ohRates'), acts = (await rows('ohActuals')).filter(a => inR(a.date));
    body = (await Promise.all(pools.map(async pl => {
      const act = acts.filter(a => a.poolId === pl.id).reduce((x, a) => x + num(a.amount), 0), os = orders.filter(p => p.ohId === pl.id);
      const applied = os.reduce((x, p) => x + (p.ohApplied || 0), 0), baseQty = os.reduce((x, p) => x + (p.ohBaseQty || 0), 0);
      const fixedBudget = n0(pl.fixedBudget), vr = n0(pl.varRate), nc = n0(pl.normalCap), pc = n0(pl.practicalCap);
      const spending = rial(act - (fixedBudget + vr * baseQty)), diff = act - applied, volume = diff - spending;
      return `<h3>${esc(pl.name)} (مبنا: ${esc(pl.base)})</h3><dl class="facts">
      <div><dt>نرخ تسهیم</dt><dd>${fmt(ohRate(pl), 2)}</dd></div><div><dt>سربار واقعی ثبت‌شده</dt><dd>${fmt(act, 0)}</dd></div><div><dt>سربار جذب‌شده در تولید</dt><dd>${fmt(applied, 0)}</dd></div>
      <div><dt>${diff > 0 ? 'سربار جذب‌نشده (کم‌جذب)' : diff < 0 ? 'سربار اضافه‌جذب‌شده' : 'تفاوت'}</dt><dd>${fmt(Math.abs(diff), 0)}</dd></div>
      <div><dt>انحراف هزینه (واقعی − بودجه انعطاف‌پذیر)</dt><dd>${sgn(spending)}</dd></div><div><dt>انحراف ظرفیت (ثابت جذب‌نشده)</dt><dd>${sgn(volume)}</dd></div>
      <div><dt>مبنای واقعی به‌کاررفته / ظرفیت عادی</dt><dd>${fmt(baseQty)} / ${fmt(nc)}</dd></div><div><dt>استفاده از ظرفیت عادی</dt><dd>${nc ? fmt(baseQty / nc * 100, 1) : 0}٪</dd></div>
      ${pc ? `<div><dt>استفاده از ظرفیت عملی</dt><dd>${fmt(baseQty / pc * 100, 1)}٪</dd></div>` : ''}</dl>`;
    }))).join('') || `<div class="empty">هنوز مجموعه سربار تعریف نشده است.</div>`;
    if (pools.length) body += `<p class="warn">بودجه و ظرفیت هر مجموعه برای کل بازه‌ی انتخابی فرض شده است؛ بازه را هم‌اندازه دوره بودجه بگیرید.</p>`;
  } else if (kind === 'repLine') {
    const g = {}; for (const p of orders) { const k = p.lineName || 'بدون خط'; const e = g[k] || (g[k] = { n: 0, out: 0, scrap: 0, cost: 0, loss: 0 }); e.n++; e.out += p.actualQty; e.scrap += p.scrapQty || 0; e.cost += p.totalCost; e.loss += p.lossValue || 0; }
    body = Object.keys(g).map(k => { const e = g[k]; return `<h3>${esc(k)}</h3><dl class="facts"><div><dt>تعداد سفارش</dt><dd>${fmt(e.n, 0)}</dd></div><div><dt>محصول سالم / ضایعات</dt><dd>${fmt(e.out)} / ${fmt(e.scrap)}</dd></div><div><dt>جمع هزینه تولید</dt><dd>${fmt(e.cost, 0)}</dd></div><div><dt>زیان ضایعات غیرعادی</dt><dd>${fmt(e.loss, 0)}</dd></div><div><dt>میانگین بهای هر واحد</dt><dd>${fmt(e.out ? (e.cost - e.loss) / e.out : 0, 2)}</dd></div></dl>`; }).join('') || `<div class="empty">در این بازه تولیدی ثبت نشده است.</div>`;
    if (Object.keys(g).length) { const T = Object.values(g).reduce((a, e) => ({ out: a.out + e.out, cost: a.cost + e.cost }), { out: 0, cost: 0 }); body += `<h3>جمع همه خطوط</h3><dl class="facts"><div><dt>محصول سالم</dt><dd>${fmt(T.out)}</dd></div><div><dt>جمع هزینه تولید</dt><dd>${fmt(T.cost, 0)}</dd></div></dl>`; }
  } else {
    const items = {}; for (const i of await rows('items')) items[i.id] = i;
    const g = {}; for (const d of (await rows('docs')).filter(d => d.type === 'sale' && d.status === 'posted' && inR(d.date))) for (const l of d.lines.filter(l => !ui.rep.productId || l.itemId === ui.rep.productId)) { const e = g[l.itemId] || (g[l.itemId] = { q: 0, sales: 0, cogs: 0 }); e.q += l.qty; e.sales += rial(l.qty * l.price); e.cogs += l.value || 0; }
    const ks = Object.keys(g); let ts = 0, tc = 0;
    body = ks.map(k => { const e = g[k]; ts += e.sales; tc += e.cogs; return `<h3>${esc(items[k]?.name || '—')}</h3><dl class="facts"><div><dt>مقدار فروش</dt><dd>${fmt(e.q)}</dd></div><div><dt>فروش</dt><dd>${fmt(e.sales, 0)}</dd></div><div><dt>بهای کالای فروش‌رفته</dt><dd>${fmt(e.cogs, 0)}</dd></div><div><dt>سود ناخالص</dt><dd>${fmt(e.sales - e.cogs, 0)} (${e.sales ? fmt((e.sales - e.cogs) / e.sales * 100, 1) : 0}٪)</dd></div></dl>`; }).join('') || `<div class="empty">در این بازه فروش ثبت‌شده‌ای نیست.</div>`;
    if (ks.length) body += `<h3>جمع</h3><dl class="facts"><div><dt>فروش</dt><dd>${fmt(ts, 0)}</dd></div><div><dt>سود ناخالص</dt><dd>${fmt(ts - tc, 0)}</dd></div></dl>`;
  }
  return `${await repHeader(kind, true)}${body}`;
}
Object.assign(ACT, {
  goEnt: d => { ui.tab = 'base'; ui.ent = d.ent; ui.formId = undefined; ui.op = null; render(); },
  repRun: () => { const f = $('#rf2'), a = readDate(f, 'from'), b = readDate(f, 'to'); if (!a || !b) return err('تاریخ معتبر نیست.'); if (a > b) return err('تاریخ شروع باید قبل از پایان باشد.'); ui.rep = { from: a, to: b }; render(); },
  prodFromRep: d => { ui.op = { kind: 'prod', id: d.id }; render(); }
});

/* ========== فاز ۴: حسابداری مالی ========== */
document.head.insertAdjacentHTML('beforeend', '<style>.jl{border-bottom:1px dashed var(--line);padding:8px 0}.jl .r2{display:grid;grid-template-columns:1fr 1fr 1.2fr;gap:6px;margin-top:6px}.jl input,.jl select{padding:9px 6px;font-size:14px;min-width:0}.jb{padding:10px 0;border-bottom:2px solid var(--line)}.jb .s{color:var(--muted);font-size:13px}.jb .tr{grid-template-columns:2fr 1fr 1fr}</style>');
const ACC_ROLES = { cash: 'صندوق', bank: 'بانک', recv: 'حساب‌های دریافتنی', pay: 'حساب‌های پرداختنی', invRaw: 'موجودی مواد اولیه', invFG: 'موجودی کالای ساخته‌شده و نیمه‌ساخته', sales: 'فروش', cogs: 'بهای تمام‌شده کالای فروش‌رفته', wages: 'دستمزد پرداختنی', oh: 'سربار ساخت (کنترل)', loss: 'زیان ضایعات غیرعادی', otherPay: 'سایر پرداختنی‌ها', retained: 'سود (زیان) انباشته' };
const ACC_OPT = { fx: 'سود (زیان) تسعیر ارز (برای معاملات ارزی)' }, ALL_ROLES = { ...ACC_ROLES, ...ACC_OPT };
const DEFAULT_CHART = [['کل', '11', 'وجوه نقد و بانک'], ['معین', '1101', 'صندوق', '11'], ['معین', '1102', 'بانک', '11'], ['کل', '12', 'حساب‌ها و اسناد دریافتنی'], ['معین', '1201', 'حساب‌های دریافتنی تجاری', '12'], ['کل', '13', 'موجودی مواد و کالا'], ['معین', '1301', 'موجودی مواد اولیه', '13'], ['معین', '1302', 'موجودی کالای ساخته‌شده', '13'],
  ['کل', '21', 'حساب‌ها و اسناد پرداختنی'], ['معین', '2101', 'حساب‌های پرداختنی تجاری', '21'], ['معین', '2102', 'دستمزد پرداختنی', '21'], ['معین', '2103', 'سایر پرداختنی‌ها', '21'], ['کل', '31', 'سرمایه و سود انباشته'], ['معین', '3101', 'سرمایه', '31'], ['معین', '3102', 'سود (زیان) انباشته', '31'],
  ['کل', '41', 'درآمد فروش'], ['معین', '4101', 'فروش محصولات', '41'], ['کل', '51', 'بهای تمام‌شده'], ['معین', '5101', 'بهای تمام‌شده کالای فروش‌رفته', '51'], ['معین', '5102', 'سربار ساخت (کنترل)', '51'], ['معین', '5103', 'زیان ضایعات غیرعادی', '51'], ['کل', '52', 'هزینه‌های عمومی'], ['معین', '5201', 'هزینه‌های عمومی و اداری', '52'], ['معین', '5202', 'سود (زیان) تسعیر ارز', '52']];
const DEFAULT_MAP = { cash: '1101', bank: '1102', recv: '1201', invRaw: '1301', invFG: '1302', pay: '2101', wages: '2102', otherPay: '2103', retained: '3102', sales: '4101', cogs: '5101', oh: '5102', loss: '5103', fx: '5202' };
const byCode = (a, b) => a.code.localeCompare(b.code, 'en', { numeric: true });
const isoOf = d => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
const addDays = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return isoOf(new Date(y, m - 1, d + n)); };
const gIso = a => `${a[0]}-${pad2(a[1])}-${pad2(a[2])}`;
const invAcc = (M, it) => it.kind === 'ماده اولیه' ? M.invRaw : M.invFG;

async function acctState() {
  const cfg = (await getMeta('acct:' + company.id)) || { map: {}, auto: false };
  const accs = {}; for (const a of await rows('accounts')) accs[a.id] = a;
  return { cfg, accs, on: !!cfg.auto, missing: Object.keys(ACC_ROLES).filter(r => !cfg.map[r] || !accs[cfg.map[r]]) };
}
async function autoOn() {
  const S = await acctState(); if (!S.on) return null;
  if (S.missing.length) throw new Error('اتصال به حسابداری ناقص است؛ از «عملیات ← تنظیمات حسابداری» حساب‌های اتصال را کامل کنید.');
  return S;
}
async function yearFor(date) {
  const y = (await rows('fiscalYears')).find(y => y.start <= date && date <= y.end);
  if (!y) throw new Error('برای تاریخ ' + fmtDay(date) + ' سال مالی تعریف نشده است. از «تنظیمات حسابداری» یا «سال‌های مالی» یکی بسازید.');
  if (y.status === 'closed') throw new Error('سال مالی «' + y.name + '» بسته شده و سند جدید نمی‌پذیرد.');
  return y;
}
async function makeJournal(o) {
  const yr = o.yr || await yearFor(o.date), accs = {}; for (const a of await rows('accounts')) accs[a.id] = a;
  const lines = o.lines.map(l => ({ accountId: l.accountId, debit: rial(l.debit || 0), credit: rial(l.credit || 0), party: (l.party || '').trim() })).filter(l => l.debit || l.credit);
  if (lines.length < 2) throw new Error('سند حسابداری باید حداقل دو ردیف داشته باشد.');
  let d = 0, c = 0;
  for (const l of lines) {
    const a = accs[l.accountId];
    if (!a) throw new Error('حساب یکی از ردیف‌ها پیدا نشد.');
    if (!o.reversal && a.level !== 'معین') throw new Error(`«${a.name}» حساب کل است؛ ثبت فقط روی حساب معین ممکن است.`);
    if ((l.debit && l.credit) || l.debit < 0 || l.credit < 0) throw new Error('هر ردیف فقط یکی از بدهکار یا بستانکار را با مبلغ مثبت دارد.');
    d += l.debit; c += l.credit;
  }
  if (d !== c && !o.reversal) throw new Error(`جمع بدهکار (${fmt(d, 0)}) با جمع بستانکار (${fmt(c, 0)}) برابر نیست.`);
  const [n, seq] = await nextNo('jr:' + yr.id);
  const rec = newRec({ number: 'س-' + devCode + n, no: n, date: o.date, yearId: yr.id, description: o.desc || '', status: 'posted', lines, total: d, kind: o.kind || 'normal', sourceType: o.source?.type || 'manual', sourceId: o.source?.id || '', sourceNo: o.source?.no || '', auto: !!o.auto, reversalOf: o.reversalOf || '' });
  return { rec, entries: [['journals', rec], seq] };
}
async function reverseJ(id, why) {
  const j = await get('journals', id); if (!j || j.status !== 'posted') return [];
  const yr = (await rows('fiscalYears')).find(y => y.id === j.yearId);
  if (!yr || yr.status === 'closed') throw new Error('سال مالی این سند بسته شده است؛ ابطال ممکن نیست.');
  const R = await makeJournal({ date: j.date, yr, desc: 'ابطال سند ' + j.number + (why ? ' (' + why + ')' : ''), lines: j.lines.map(l => ({ accountId: l.accountId, debit: l.credit, credit: l.debit, party: l.party })), kind: 'reversal', reversalOf: j.id, source: { type: j.sourceType, id: j.sourceId, no: j.sourceNo }, auto: true, reversal: true });
  return [['journals', touch({ ...j, status: 'voided', reversedBy: R.rec.id })], ...R.entries];
}
async function accountUsed(id) {
  if ((await rows('journals')).some(j => j.lines.some(l => l.accountId === id))) return true;
  const cfg = (await getMeta('acct:' + company.id)) || { map: {} };
  return Object.values(cfg.map).includes(id) || (await rows('accounts')).some(a => a.parentId === id);
}
async function docJournal(doc, items) {
  const S = await autoOn(); if (!S) return null;
  const M = S.cfg.map, L = [], g = {}, party = (doc.partner || '').trim() || 'نامشخص';
  if (doc.type === 'purchase') {
    for (const l of doc.lines) { const a = invAcc(M, items[l.itemId]); g[a] = (g[a] || 0) + rial(l.qty * l.price); }
    Object.keys(g).forEach(a => L.push({ accountId: a, debit: g[a] })); L.push({ accountId: M.pay, credit: doc.total, party });
  } else {
    L.push({ accountId: M.recv, debit: doc.total, party }, { accountId: M.sales, credit: doc.total }, { accountId: M.cogs, debit: doc.cogs });
    for (const l of doc.lines) { const a = invAcc(M, items[l.itemId]); g[a] = (g[a] || 0) + l.value; }
    Object.keys(g).forEach(a => L.push({ accountId: a, credit: g[a] }));
  }
  return makeJournal({ date: doc.date, desc: (doc.type === 'sale' ? 'فروش ' : 'خرید ') + doc.number + ' – ' + party, lines: L, source: { type: doc.type, id: doc.id, no: doc.number }, auto: true });
}
async function prodJournal(p, items) {
  const S = await autoOn(); if (!S) return null;
  const M = S.cfg.map, L = [{ accountId: invAcc(M, items[p.productId]), debit: p.inventoryValue }, { accountId: M.loss, debit: p.lossValue || 0 }], g = {};
  for (const l of p.lines) { const a = invAcc(M, items[l.itemId]); g[a] = (g[a] || 0) + l.value; }
  Object.keys(g).forEach(a => L.push({ accountId: a, credit: g[a] }));
  L.push({ accountId: M.wages, credit: p.laborCost || 0 }, { accountId: M.oh, credit: p.ohApplied || 0 });
  return makeJournal({ date: p.date, desc: 'تولید ' + p.number + ' – ' + p.productName, lines: L, source: { type: 'prod', id: p.id, no: p.number }, auto: true });
}

/* ---------- تنظیمات حسابداری ---------- */
async function accView() {
  const S = await acctState(), all = await rows('accounts'), ma = all.filter(a => a.level === 'معین').sort(byCode), yrs = await rows('fiscalYears');
  let stock = 0; for (const e of Object.values(await stockMap())) stock += e.value;
  let gl = 0; const inv = [S.cfg.map.invRaw, S.cfg.map.invFG];
  for (const j of await rows('journals')) if (j.status !== 'draft' && j.kind !== 'opening' && j.kind !== 'closing') for (const l of j.lines) if (inv.includes(l.accountId)) gl += l.debit - l.credit;
  const ok = can('settings');
  return `${back('opBack')}<h2>تنظیمات حسابداری</h2><dl class="facts"><div><dt>تعداد حساب‌ها</dt><dd>${fmt(all.length, 0)}</dd></div><div><dt>سال‌های مالی</dt><dd>${fmt(yrs.length, 0)}</dd></div><div><dt>اتصال خودکار عملیات به سند</dt><dd>${S.on ? 'روشن' : 'خاموش'}</dd></div></dl>
  ${all.length ? '' : `<p>برای شروع، کدینگ استاندارد ساده و سال مالی جاری ساخته می‌شود و اتصال خودکار روشن می‌شود. بعداً می‌توانید حساب‌ها را تغییر دهید.</p>${ok ? `<button class="btn" data-act="accSeed">ساخت کدینگ و سال مالی پیش‌فرض</button>` : ''}`}
  ${all.length ? `<h3>حساب‌های اتصال (برای ثبت خودکار سند)</h3><form id="af" onsubmit="return false">${Object.keys(ALL_ROLES).map(r => `<label>${ALL_ROLES[r]}</label><select name="${r}"><option value="">انتخاب کنید</option>${ma.map(a => `<option value="${a.id}" ${S.cfg.map[r] === a.id ? 'selected' : ''}>${esc(a.code)} – ${esc(a.name)}</option>`).join('')}</select>`).join('')}
  <label class="chk"><input type="checkbox" name="auto" ${S.on ? 'checked' : ''}> ثبت خودکار سند حسابداری برای خرید، فروش، تولید و سربار</label></form>${ok ? `<button class="btn" data-act="accSave">ذخیره تنظیمات</button>${!S.cfg.map.fx || !S.accs[S.cfg.map.fx] ? '<button class="btn alt" data-act="accAddFx">افزودن و اتصال حساب تسعیر ارز</button>' : ''}` : ''}
  <h3>مغایرت‌گیری موجودی</h3><dl class="facts"><div><dt>ارزش موجودی انبار (کاردکس)</dt><dd>${fmt(stock, 0)}</dd></div><div><dt>مانده حساب‌های موجودی در دفتر کل</dt><dd>${fmt(gl, 0)}</dd></div><div><dt>اختلاف</dt><dd>${fmt(stock - gl, 0)}</dd></div></dl>
  <p class="${stock === gl ? 'ok' : 'warn'}">${stock === gl ? 'موجودی انبار با دفتر کل مطابق است ✓' : 'اختلاف وجود دارد. اگر پیش از روشن کردن اتصال خودکار خرید یا تولید ثبت کرده‌اید، طبیعی است.'}</p>` : ''}`;
}
async function accSeed() {
  if (!can('settings')) return err('اجازه «مدیریت تنظیمات» را ندارید.');
  if ((await rows('accounts')).length) return;
  const byC = {}, list = [];
  for (const [level, code, name, parent] of DEFAULT_CHART) { const r = newRec({ level, code, name, parentId: parent ? byC[parent].id : '' }); byC[code] = r; list.push(['accounts', r]); }
  const map = {}; for (const k in DEFAULT_MAP) map[k] = byC[DEFAULT_MAP[k]].id;
  const ent = [...list, ['meta', { id: 'acct:' + company.id, value: { map, auto: true } }], ['audit', auditRec('ساخت کدینگ پیش‌فرض', 'accounts', '', '')]];
  if (!(await rows('fiscalYears')).length) {
    const t = todayISO().split('-').map(Number), [jy] = g2j(t[0], t[1], t[2]);
    ent.push(['fiscalYears', newRec({ name: String(jy), start: gIso(j2g(jy, 1, 1)), end: addDays(gIso(j2g(jy + 1, 1, 1)), -1), status: 'open' })]);
  }
  await putMany(ent); toast('کدینگ و سال مالی ساخته شد'); render();
}
async function accSave() {
  if (!can('settings')) return err('اجازه «مدیریت تنظیمات» را ندارید.');
  const f = $('#af'), map = {}; for (const r in ALL_ROLES) map[r] = f.elements[r].value;
  const auto = f.elements.auto.checked;
  if (auto && Object.keys(ACC_ROLES).some(r => !map[r])) return err('برای روشن کردن اتصال خودکار، همه حساب‌های اتصال را انتخاب کنید.');
  if (new Set(Object.values(map).filter(Boolean)).size !== Object.values(map).filter(Boolean).length) return err('یک حساب را برای دو نقش مختلف انتخاب نکرده باشید.');
  await putMany([['meta', { id: 'acct:' + company.id, value: { map, auto } }], ['audit', auditRec('تغییر تنظیمات حسابداری', 'meta', '', auto ? 'خودکار روشن' : 'خودکار خاموش')]]);
  toast('ذخیره شد'); render();
}

/* ---------- سال مالی و بستن ---------- */
async function fyView() {
  const ys = (await rows('fiscalYears')).sort((a, b) => a.start.localeCompare(b.start));
  return `${back('opBack')}<h2>سال‌های مالی</h2>${ys.map(y => `<div class="row"><span class="t">${esc(y.name)}<span class="badge ${y.status === 'closed' ? 'off' : ''}">${y.status === 'closed' ? 'بسته' : 'باز'}</span><span class="s">${esc(fmtDay(y.start))} تا ${esc(fmtDay(y.end))}</span></span>${y.status !== 'closed' && can('settings') ? `<button class="btn alt sm" data-act="fyClose" data-id="${y.id}">بستن سال</button>` : ''}</div>`).join('') || `<div class="empty">سال مالی تعریف نشده است.</div>`}
  ${can('settings') ? `<button class="btn alt" data-act="goEnt" data-ent="fiscalYears">مدیریت سال‌های مالی (افزودن/ویرایش)</button>` : ''}
  <p class="warn">بستن سال: سود و زیان به حساب «سود (زیان) انباشته» منتقل می‌شود (سند اختتامیه)، سال بسته می‌شود و برای سال بعد سند افتتاحیه ساخته می‌شود. سال بسته سند جدید نمی‌پذیرد.</p>`;
}
async function fyClose(d) {
  if (!can('settings')) return err('اجازه «مدیریت تنظیمات» را ندارید.');
  const y = await get('fiscalYears', d.id); if (!y || y.status === 'closed') return;
  const S = await acctState(), ret = S.cfg.map.retained;
  if (!ret || !S.accs[ret]) return err('حساب «سود (زیان) انباشته» را در تنظیمات حسابداری مشخص کنید.');
  const years = await rows('fiscalYears'), js = (await rows('journals')).filter(j => j.yearId === y.id);
  if (js.some(j => j.status === 'draft')) return err('در این سال سند پیش‌نویس وجود دارد؛ آن را ثبت یا حذف کنید.');
  if (!confirm(`سال مالی «${y.name}» بسته شود؟ این کار برگشت‌پذیر نیست.`)) return;
  try {
    const bal = {}; for (const j of js) if (j.kind !== 'closing') for (const l of j.lines) bal[l.accountId] = (bal[l.accountId] || 0) + l.debit - l.credit;
    const CL = []; for (const id in bal) { const a = S.accs[id]; if (a && (a.code[0] === '4' || a.code[0] === '5') && bal[id] !== 0) CL.push(bal[id] > 0 ? { accountId: id, credit: bal[id] } : { accountId: id, debit: -bal[id] }); }
    const sd = CL.reduce((x, l) => x + (l.debit || 0), 0), sc = CL.reduce((x, l) => x + (l.credit || 0), 0);
    if (sd !== sc) CL.push(sd > sc ? { accountId: ret, credit: sd - sc } : { accountId: ret, debit: sc - sd });
    const closing = CL.length >= 2 ? await makeJournal({ date: y.end, yr: y, desc: 'سند اختتامیه ' + y.name, lines: CL, kind: 'closing', auto: true }) : null;
    const bs = {}; const add = l => { const a = S.accs[l.accountId]; if (!a || '123'.indexOf(a.code[0]) < 0) return; const k = l.accountId + '|' + (l.party || ''); const e = bs[k] || (bs[k] = { accountId: l.accountId, party: l.party || '', net: 0 }); e.net += l.debit - l.credit; };
    for (const j of js) for (const l of j.lines) add(l);
    if (closing) for (const l of closing.rec.lines) if (l.accountId === ret) add(l);
    const ns = addDays(y.end, 1); let ny = years.find(x => x.start === ns), made = false;
    if (ny && ny.status === 'closed') throw new Error('سال مالی بعدی بسته شده است.');
    if (!ny) {
      const [jy, jm, jd] = g2j(...ns.split('-').map(Number)), end = addDays(gIso(j2g(jy + 1, jm, jd)), -1);
      if (years.some(x => x.id !== y.id && x.start <= end && ns <= x.end)) throw new Error('سال بعد با یک سال مالی دیگر هم‌پوشانی دارد.');
      ny = newRec({ name: jm === 1 && jd === 1 ? String(jy) : 'از ' + fmtDay(ns), start: ns, end, status: 'open' }); made = true;
    }
    const OL = Object.values(bs).filter(e => e.net !== 0).map(e => e.net > 0 ? { accountId: e.accountId, debit: e.net, party: e.party } : { accountId: e.accountId, credit: -e.net, party: e.party });
    const opening = OL.length >= 2 ? await makeJournal({ date: ns, yr: ny, desc: 'سند افتتاحیه ' + ny.name, lines: OL, kind: 'opening', auto: true }) : null;
    await putMany([['fiscalYears', touch({ ...y, status: 'closed' })], ...(closing ? closing.entries : []), ...(made ? [['fiscalYears', ny]] : []), ...(opening ? opening.entries : []), ['audit', auditRec('بستن سال مالی', 'fiscalYears', y.id, y.name)]]);
    toast('سال مالی بسته شد'); render();
  } catch (e) { err(e.message); }
}

/* ---------- دریافت و پرداخت ---------- */
async function payList() {
  const list = (await rows('docs')).filter(d => d.type === 'receipt' || d.type === 'payment').sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));
  return `${back('opBack')}<h2>دریافت و پرداخت</h2>${can('create') ? `<button class="btn alt sm" data-act="payNew" data-t="receipt">+ دریافت وجه</button> <button class="btn alt sm" data-act="payNew" data-t="payment">+ پرداخت وجه</button>` : ''}
  ${list.map(d => `<button class="row" data-act="payOpen" data-id="${d.id}"><span class="t">${esc(d.number)} – ${esc(d.partner)}<span class="badge ${d.status === 'voided' ? 'off' : ''}">${stLabel(d.status)}</span><span class="s">${d.type === 'receipt' ? 'دریافت' : 'پرداخت'} – ${esc(fmtDay(d.date))} – ${fmt(d.total, 0)} ریال – ${esc(d.method)}</span></span><span class="c">‹</span></button>`).join('') || `<div class="empty">هنوز دریافت یا پرداختی ثبت نشده است.</div>`}`;
}
async function payView() {
  const o = ui.op;
  if (o.id) {
    const d = await get('docs', o.id);
    return `${back('opBack')}<h2>${d.type === 'receipt' ? 'دریافت' : 'پرداخت'} ${esc(d.number)}<span class="badge ${d.status === 'voided' ? 'off' : ''}">${stLabel(d.status)}</span></h2><dl class="facts"><div><dt>تاریخ</dt><dd>${esc(fmtDay(d.date))}</dd></div><div><dt>${d.type === 'receipt' ? 'پرداخت‌کننده' : 'دریافت‌کننده'}</dt><dd>${esc(d.partner)}</dd></div><div><dt>مبلغ ریالی</dt><dd>${fmt(d.total, 0)} ریال</dd></div><div><dt>${d.type === 'receipt' ? 'واریز به' : 'برداشت از'}</dt><dd>${esc(d.method)}</dd></div>
    ${d.fx ? `<div><dt>مبلغ ارزی و نرخ</dt><dd>${fmt(d.fx.amount, 2)} ${esc(d.fx.code)} × ${fmt(d.fx.rate, 2)}</dd></div>${d.fx.settleDocId ? `<div><dt>نرخ سند تسویه‌شده</dt><dd>${fmt(d.fx.docRate, 2)}</dd></div><div><dt>${d.fx.diff === 0 ? 'تفاوت تسعیر' : (d.type === 'receipt' ? d.fx.diff > 0 : d.fx.diff < 0) ? 'سود تسعیر' : 'زیان تسعیر'}</dt><dd>${fmt(Math.abs(d.fx.diff), 0)} ریال</dd></div>` : ''}` : ''}</dl>${d.note ? `<p>${esc(d.note)}</p>` : ''}
    ${d.status === 'posted' && can('void') ? `<button class="btn bad" data-act="docVoid">ابطال این سند</button>` : ''}`;
  }
  const rc = o.t === 'receipt', curs = await rows('currencies');
  const open = (await rows('docs')).filter(d => d.status === 'posted' && d.fx && d.type === (rc ? 'sale' : 'purchase') && d.fx.total - d.fx.settled > 0.0001);
  return `${back('opBack')}<h2>${rc ? 'دریافت وجه' : 'پرداخت وجه'}</h2><form id="pyf" onsubmit="return false"><label>تاریخ</label>${dateField('date', todayISO())}
  <label>${rc ? 'از چه کسی (مشتری)' : 'به چه کسی (تأمین‌کننده)'} *</label><input type="text" name="party">
  ${open.length ? `<label>تسویه سند ارزی (اختیاری)</label><select name="settle"><option value="">بدون تسویه سند</option>${open.map(d => `<option value="${d.id}">${esc(d.number)} – ${esc(d.partner || '')} – مانده ${fmt(d.fx.total - d.fx.settled, 2)} ${esc(d.fx.code)} (نرخ ${fmt(d.fx.rate, 2)})</option>`).join('')}</select>` : ''}
  ${curs.length ? `<label>ارز (با انتخاب سند تسویه، ارز همان سند اعمال می‌شود)</label><select name="cur"><option value="">ریال ایران</option>${curs.map(c => `<option value="${c.id}">${esc(c.code)} – ${esc(c.name)}</option>`).join('')}</select><label>نرخ تبدیل امروز (هر واحد ارز چند ریال)</label><input type="text" inputmode="decimal" name="rate">` : ''}
  <label>مبلغ (به ارز انتخابی؛ بدون ارز = ریال) *</label><input type="text" inputmode="decimal" name="amount">
  <label>${rc ? 'واریز به' : 'برداشت از'}</label><select name="method"><option>صندوق</option><option>بانک</option></select><label>توضیحات</label><input type="text" name="note"></form>
  <p class="warn">نام شخص را دقیقاً مثل نام ثبت‌شده در خرید یا فروش بنویسید تا مانده او درست محاسبه شود.</p><button class="btn" data-act="paySave">ثبت نهایی</button>`;
}
async function paySave() {
  const f = $('#pyf'), t = ui.op.t, iso = readDate(f, 'date'), amt = num(f.elements.amount.value);
  if (!can('post')) return err('اجازه «ثبت و تأیید اسناد» را ندارید.');
  if (!iso) return err('تاریخ معتبر نیست.');
  const sd = f.elements.settle && f.elements.settle.value ? await get('docs', f.elements.settle.value) : null;
  const party = f.elements.party.value.trim() || (sd ? (sd.partner || '').trim() : '');
  if (!party) return err('نام شخص را وارد کنید.'); if (!(amt > 0)) return err('مبلغ باید عددی بزرگ‌تر از صفر باشد.');
  if (!dateWarn(iso)) return;
  try {
    const S = await autoOn(); if (!S) return err('برای ثبت دریافت و پرداخت، اتصال خودکار حسابداری باید روشن باشد (عملیات ← تنظیمات حسابداری).');
    const M = S.cfg.map, cashAcc = f.elements.method.value === 'بانک' ? M.bank : M.cash, [n, seq] = await nextNo(t);
    const curId = sd ? sd.fx.currencyId : (f.elements.cur ? f.elements.cur.value : '');
    let payRial, docRial, fx = null; const extra = [];
    if (curId) {
      const rate = num(f.elements.rate ? f.elements.rate.value : ''); if (!(rate > 0)) throw new Error('نرخ تبدیل ارز را وارد کنید.');
      const cur = await get('currencies', curId);
      payRial = rial(amt * rate); docRial = sd ? rial(amt * sd.fx.rate) : payRial;
      if (sd) { if (amt > sd.fx.total - sd.fx.settled + 1e-9) throw new Error('مبلغ از مانده سند ارزی بیشتر است.'); extra.push(['docs', touch({ ...sd, fx: { ...sd.fx, settled: q2(sd.fx.settled + amt) } })]); }
      fx = { currencyId: curId, code: cur.code, rate, amount: q2(amt), settleDocId: sd ? sd.id : '', docRate: sd ? sd.fx.rate : rate, diff: payRial - docRial };
    } else payRial = docRial = rial(amt);
    const diff = payRial - docRial;
    if (diff !== 0 && !M.fx) throw new Error('حساب «سود (زیان) تسعیر ارز» را در تنظیمات حسابداری مشخص کنید.');
    const L = t === 'receipt' ? [{ accountId: cashAcc, debit: payRial }, { accountId: M.recv, credit: docRial, party }, diff > 0 ? { accountId: M.fx, credit: diff } : { accountId: M.fx, debit: -diff }]
      : [{ accountId: M.pay, debit: docRial, party }, { accountId: cashAcc, credit: payRial }, diff > 0 ? { accountId: M.fx, debit: diff } : { accountId: M.fx, credit: -diff }];
    const doc = newRec({ type: t, date: iso, partner: party, total: payRial, method: f.elements.method.value, note: f.elements.note.value.trim(), status: 'posted', number: (t === 'receipt' ? 'د-' : 'پ-') + devCode + n, lines: [], fx });
    const J = await makeJournal({ date: iso, desc: (t === 'receipt' ? 'دریافت از ' : 'پرداخت به ') + party, lines: L.filter(l => l.accountId), source: { type: t, id: doc.id, no: doc.number }, auto: true });
    doc.journalId = J.rec.id;
    await putMany([['docs', doc], seq, ...extra, ...J.entries, ['audit', auditRec('ثبت ' + (t === 'receipt' ? 'دریافت' : 'پرداخت'), 'docs', doc.id, doc.number)]]);
    ui.op.id = doc.id; toast('ثبت شد'); render();
  } catch (e) { err(e.message); }
}

/* ---------- اسناد حسابداری ---------- */
async function jrList() {
  const list = (await rows('journals')).sort((a, b) => (b.date + String(b.no || 999999).padStart(8, '0')).localeCompare(a.date + String(a.no || 999999).padStart(8, '0')));
  return `${back('opBack')}<h2>اسناد حسابداری</h2>${list.map(j => `<button class="row" data-act="jrOpen" data-id="${j.id}"><span class="t">${j.number ? esc(j.number) : 'پیش‌نویس'} – ${esc(j.description || '')}<span class="badge ${j.status === 'voided' ? 'off' : ''}">${stLabel(j.status)}</span>${j.auto ? '<span class="badge off">خودکار</span>' : ''}<span class="s">${esc(fmtDay(j.date))} – ${fmt(j.total, 0)} ریال</span></span><span class="c">‹</span></button>`).join('') || `<div class="empty">هنوز سندی ثبت نشده است.</div>`}
  ${can('create') ? `<button class="fab" data-act="jrNew">+ سند جدید</button>` : ''}`;
}
function syncJ() {
  const f = $('#jf'); if (!f || !ui.draft) return; const D = ui.draft, d = readDate(f, 'date'); if (d) D.date = d;
  D.desc = f.elements.desc.value;
  const A = [...document.querySelectorAll('.j-acc')], Dd = [...document.querySelectorAll('.j-d')], C = [...document.querySelectorAll('.j-c')], P = [...document.querySelectorAll('.j-p')];
  D.lines = A.map((x, i) => ({ accountId: x.value, debit: Dd[i].value, credit: C[i].value, party: P[i].value }));
}
async function jrView() {
  const o = ui.op, accsAll = await rows('accounts'), A = {}; accsAll.forEach(a => A[a.id] = a);
  const j = o.id ? await get('journals', o.id) : null;
  if (j && j.status !== 'draft') {
    return `${back('opBack')}<h2>سند ${esc(j.number)}<span class="badge ${j.status === 'voided' ? 'off' : ''}">${stLabel(j.status)}</span></h2><dl class="facts"><div><dt>تاریخ</dt><dd>${esc(fmtDay(j.date))}</dd></div><div><dt>شرح</dt><dd>${esc(j.description)}</dd></div>${j.sourceNo ? `<div><dt>منشأ</dt><dd>${esc(j.sourceNo)}</dd></div>` : ''}</dl>
    <div class="tr h" style="grid-template-columns:2fr 1fr 1fr"><span>حساب</span><span>بدهکار</span><span>بستانکار</span></div>${j.lines.map(l => `<div class="tr" style="grid-template-columns:2fr 1fr 1fr"><span>${esc(A[l.accountId]?.code || '')} ${esc(A[l.accountId]?.name || '—')}${l.party ? `<br><small>${esc(l.party)}</small>` : ''}</span><span>${l.debit ? fmt(l.debit, 0) : ''}</span><span>${l.credit ? fmt(l.credit, 0) : ''}</span></div>`).join('')}
    <dl class="facts"><div><dt>جمع</dt><dd>${fmt(j.total, 0)}</dd></div></dl>
    ${j.status === 'posted' && j.kind === 'normal' && !j.auto && can('void') ? `<button class="btn bad" data-act="jrVoid">ابطال این سند (ثبت سند معکوس)</button>` : ''}
    ${j.auto && j.status === 'posted' ? `<p class="warn">این سند خودکار است؛ برای ابطال، سند منشأ (${esc(j.sourceNo)}) را باطل کنید.</p>` : ''}`;
  }
  if (!ui.draft) ui.draft = j ? { date: j.date, desc: j.description, lines: j.lines.map(l => ({ accountId: l.accountId, debit: l.debit || '', credit: l.credit || '', party: l.party || '' })) } : { date: todayISO(), desc: '', lines: [{}, {}] };
  const D = ui.draft, ma = accsAll.filter(a => a.level === 'معین').sort(byCode);
  let td = 0, tc = 0; D.lines.forEach(l => { td += n0(l.debit); tc += n0(l.credit); });
  return `${back('opBack')}<h2>${j ? 'ویرایش پیش‌نویس' : 'سند حسابداری جدید'}</h2>${ma.length ? '' : `<div class="warn">ابتدا کدینگ حساب‌ها را بسازید (عملیات ← تنظیمات حسابداری).</div>`}
  <form id="jf" onsubmit="return false"><label>تاریخ</label>${dateField('date', D.date)}<label>شرح</label><input type="text" name="desc" value="${esc(D.desc)}">
  <h3>ردیف‌ها (مبلغ به ریال)</h3>${D.lines.map((L, i) => `<div class="jl"><div style="display:grid;grid-template-columns:1fr 26px;gap:6px;align-items:center"><select class="j-acc"><option value="">حساب معین</option>${ma.map(a => `<option value="${a.id}" ${a.id === L.accountId ? 'selected' : ''}>${esc(a.code)} – ${esc(a.name)}</option>`).join('')}</select><button class="x" data-act="rmJ" data-i="${i}" aria-label="حذف">×</button></div><div class="r2"><input class="j-d" type="text" inputmode="decimal" placeholder="بدهکار" value="${esc(L.debit ?? '')}"><input class="j-c" type="text" inputmode="decimal" placeholder="بستانکار" value="${esc(L.credit ?? '')}"><input class="j-p" type="text" placeholder="تفصیلی (نام شخص)" value="${esc(L.party ?? '')}"></div></div>`).join('')}</form>
  <button class="btn alt sm" data-act="addJ" type="button">+ ردیف</button>
  <dl class="facts"><div><dt>جمع بدهکار / بستانکار</dt><dd>${fmt(td, 0)} / ${fmt(tc, 0)}</dd></div></dl>
  ${can('create') ? `<button class="btn" data-act="jrPost">ثبت نهایی</button><button class="btn alt" data-act="jrDraft">ذخیره پیش‌نویس</button>` : ''}${j && can('void') ? `<button class="btn bad" data-act="jrDel">حذف پیش‌نویس</button>` : ''}`;
}
async function jrSubmit(post) {
  syncJ(); const D = ui.draft, f = $('#jf'), iso = readDate(f, 'date');
  if (!iso) return err('تاریخ معتبر نیست.');
  const lines = []; let d = 0, c = 0;
  for (const L of D.lines) {
    if (!L.accountId && !String(L.debit).trim() && !String(L.credit).trim()) continue;
    const dv = String(L.debit).trim() === '' ? 0 : num(L.debit), cv = String(L.credit).trim() === '' ? 0 : num(L.credit);
    if (!L.accountId) return err('برای هر ردیف یک حساب انتخاب کنید.');
    if (!(dv >= 0) || !(cv >= 0)) return err('مبلغ‌ها باید عدد صفر یا بیشتر باشند.');
    if ((dv > 0) === (cv > 0)) return err('هر ردیف باید دقیقاً یکی از بدهکار یا بستانکار را داشته باشد.');
    lines.push({ accountId: L.accountId, debit: rial(dv), credit: rial(cv), party: (L.party || '').trim() }); d += rial(dv); c += rial(cv);
  }
  if (lines.length < 2) return err('حداقل دو ردیف لازم است.');
  if (d !== c) return err(`جمع بدهکار (${fmt(d, 0)}) با جمع بستانکار (${fmt(c, 0)}) برابر نیست؛ اختلاف ${fmt(Math.abs(d - c), 0)} ریال.`);
  const old = ui.op.id ? await get('journals', ui.op.id) : null;
  if (!post) {
    const rec = old ? touch({ ...old, date: iso, description: D.desc.trim(), lines, total: d }) : newRec({ date: iso, description: D.desc.trim(), status: 'draft', lines, total: d, number: '', kind: 'normal', sourceType: 'manual', auto: false });
    await putMany([['journals', rec], ['audit', auditRec('ذخیره پیش‌نویس سند', 'journals', rec.id, '')]]);
    ui.op.id = undefined; ui.draft = null; toast('پیش‌نویس ذخیره شد'); return render();
  }
  if (!can('post')) return err('اجازه «ثبت و تأیید اسناد» را ندارید.');
  if (!dateWarn(iso)) return;
  try {
    const J = await makeJournal({ date: iso, desc: D.desc.trim() || 'سند دستی', lines });
    if (old) { J.rec.id = old.id; J.rec.createdAt = old.createdAt; }
    await putMany([...J.entries, ['audit', auditRec('ثبت سند حسابداری', 'journals', J.rec.id, J.rec.number)]]);
    ui.op.id = J.rec.id; ui.draft = null; toast('سند ثبت شد'); render();
  } catch (e) { err(e.message); }
}
async function jrVoid() {
  if (!can('void') || !confirm('این سند باطل شود؟ یک سند معکوس ثبت می‌شود و سند اصلی می‌ماند.')) return;
  try { const rev = await reverseJ(ui.op.id, ''); if (!rev.length) return; await putMany([...rev, ['audit', auditRec('ابطال سند حسابداری', 'journals', ui.op.id, '')]]); toast('سند باطل شد'); render(); } catch (e) { err(e.message); }
}
async function jrDel() {
  if (!can('void') || !confirm('این پیش‌نویس حذف شود؟')) return;
  const j = await get('journals', ui.op.id); await putMany([['journals', touch({ ...j, voided: true })], ['audit', auditRec('حذف پیش‌نویس سند', 'journals', j.id, '')]]);
  ui.op.id = undefined; ui.draft = null; render();
}

/* ---------- گزارش‌های مالی ---------- */
async function finReport(kind) {
  const hdr = `${back('opBack')}<h2>${KINDS[kind]}</h2>`, years = (await rows('fiscalYears')).sort((a, b) => a.start.localeCompare(b.start));
  if (!years.length) return hdr + `<div class="warn">هنوز سال مالی تعریف نشده است. از «تنظیمات حسابداری» کدینگ پیش‌فرض را بسازید.</div>`;
  const td = todayISO(), y = years.find(x => x.id === ui.fyId) || years.find(x => x.start <= td && td <= x.end) || years[years.length - 1]; ui.fyId = y.id;
  const accs = (await rows('accounts')).sort(byCode), A = {}; accs.forEach(a => A[a.id] = a);
  const js = (await rows('journals')).filter(j => j.yearId === y.id && j.status !== 'draft').sort((a, b) => a.date.localeCompare(b.date) || (a.no - b.no)), live = js.filter(j => j.kind !== 'closing');
  const sum = {}; for (const j of live) for (const l of j.lines) { const e = sum[l.accountId] || (sum[l.accountId] = { d: 0, c: 0 }); e.d += l.debit; e.c += l.credit; }
  const sel = `<label>سال مالی</label><select data-change="fy">${years.map(x => `<option value="${x.id}" ${x.id === y.id ? 'selected' : ''}>${esc(x.name)}${x.status === 'closed' ? ' (بسته)' : ''}</option>`).join('')}</select>`;
  const line = (a, b, c) => `<div class="tr" style="grid-template-columns:2fr 1fr 1fr"><span>${a}</span><span>${b}</span><span>${c}</span></div>`;
  let body = '';
  if (kind === 'rtb') {
    let TD = 0, TC = 0, h = '';
    for (const a of accs) {
      let d = 0, c = 0;
      if (a.level === 'کل') for (const k of accs.filter(x => x.parentId === a.id)) { const e = sum[k.id] || { d: 0, c: 0 }; d += e.d; c += e.c; } else { const e = sum[a.id] || { d: 0, c: 0 }; d = e.d; c = e.c; TD += d; TC += c; }
      if (!d && !c) continue; const bal = d - c;
      h += `<div class="tr ${a.level === 'کل' ? 'h' : ''}"><span>${esc(a.code)} ${esc(a.name)}</span><span>${fmt(d, 0)}</span><span>${fmt(c, 0)}</span><span>${fmt(Math.abs(bal), 0)} ${bal > 0 ? 'بد' : bal < 0 ? 'بس' : ''}</span></div>`;
    }
    body = h ? `<div class="tr h"><span>حساب</span><span>بدهکار</span><span>بستانکار</span><span>مانده</span></div>${h}<dl class="facts"><div><dt>جمع گردش بدهکار</dt><dd>${fmt(TD, 0)}</dd></div><div><dt>جمع گردش بستانکار</dt><dd>${fmt(TC, 0)}</dd></div></dl>${TD === TC ? '<div class="ok">تراز است ✓</div>' : '<div class="err">تراز نیست!</div>'}<p class="warn">شامل سند افتتاحیه و بدون سند اختتامیه.</p>` : `<div class="empty">در این سال سندی نیست.</div>`;
  } else if (kind === 'rpl') {
    let rev = 0, exp = 0, hr = '', he = '';
    for (const a of accs.filter(x => x.level === 'معین')) { const e = sum[a.id]; if (!e) continue; if (a.code[0] === '4' && e.c - e.d) { rev += e.c - e.d; hr += line(esc(a.name), fmt(e.c - e.d, 0), ''); } if (a.code[0] === '5' && e.d - e.c) { exp += e.d - e.c; he += line(esc(a.name), fmt(e.d - e.c, 0), ''); } }
    body = `<h3>درآمدها</h3>${hr || '<div class="empty">—</div>'}<dl class="facts"><div><dt>جمع درآمد</dt><dd>${fmt(rev, 0)}</dd></div></dl><h3>هزینه‌ها</h3>${he || '<div class="empty">—</div>'}<dl class="facts"><div><dt>جمع هزینه</dt><dd>${fmt(exp, 0)}</dd></div><div><dt><b>${rev - exp >= 0 ? 'سود خالص' : 'زیان خالص'}</b></dt><dd><b>${fmt(Math.abs(rev - exp), 0)} ریال</b></dd></div></dl><p class="warn">پیش از سند اختتامیه محاسبه شده است.</p>`;
  } else if (kind === 'rled') {
    const ma = accs.filter(a => a.level === 'معین'); const id = ui.ledAcc && A[ui.ledAcc] ? ui.ledAcc : (ma.find(a => sum[a.id]) || ma[0])?.id; ui.ledAcc = id; const a = A[id], party = (ui.ledParty || '').trim();
    if (!a) body = `<div class="empty">حسابی تعریف نشده است.</div>`; else {
      const dn = a.code[0] === '1' || a.code[0] === '5'; let bal = 0, h = '';
      for (const j of live) for (const l of j.lines) if (l.accountId === id && (!party || l.party === party)) { bal += dn ? l.debit - l.credit : l.credit - l.debit; h += `<div class="tr"><span>${esc(fmtDay(j.date))}<br><small>${esc(j.number)} ${esc(j.description)}</small></span><span>${l.debit ? fmt(l.debit, 0) : ''}</span><span>${l.credit ? fmt(l.credit, 0) : ''}</span><span>${fmt(bal, 0)}</span></div>`; }
      body = `<label>حساب</label><select data-change="led">${ma.map(x => `<option value="${x.id}" ${x.id === id ? 'selected' : ''}>${esc(x.code)} – ${esc(x.name)}</option>`).join('')}</select><label>تفصیلی (نام شخص، اختیاری)</label><input type="text" data-change="ledp" value="${esc(party)}">
      ${h ? `<div class="tr h"><span>تاریخ و شرح</span><span>بدهکار</span><span>بستانکار</span><span>مانده</span></div>${h}<dl class="facts"><div><dt>مانده پایانی (${dn ? 'بدهکار' : 'بستانکار'} عادی)</dt><dd>${fmt(bal, 0)}</dd></div></dl>` : `<div class="empty">گردشی نیست.</div>`}`;
    }
  } else if (kind === 'rar') {
    const S = await acctState(), part = (roleId, title, dn) => { const g = {}; for (const j of live) for (const l of j.lines) if (l.accountId === roleId) { const k = l.party || 'بدون تفصیلی'; g[k] = (g[k] || 0) + (dn ? l.debit - l.credit : l.credit - l.debit); } const ks = Object.keys(g).filter(k => g[k] !== 0); return `<h3>${title}</h3>${ks.map(k => line(esc(k), fmt(g[k], 0), '')).join('') || '<div class="empty">مانده‌ای نیست.</div>'}<dl class="facts"><div><dt>جمع</dt><dd>${fmt(ks.reduce((x, k) => x + g[k], 0), 0)}</dd></div></dl>`; };
    body = S.cfg.map.recv && S.cfg.map.pay ? part(S.cfg.map.recv, 'دریافتنی‌ها (طلب از مشتریان)', true) + part(S.cfg.map.pay, 'پرداختنی‌ها (بدهی به تأمین‌کنندگان)', false) : `<div class="warn">حساب‌های اتصال تنظیم نشده است.</div>`;
  } else {
    const KL = { normal: '', closing: 'اختتامیه', opening: 'افتتاحیه', reversal: 'معکوس' };
    body = js.map(j => `<div class="jb"><b>${esc(j.number)}</b> – ${esc(fmtDay(j.date))}<span class="badge ${j.status === 'voided' ? 'off' : ''}">${stLabel(j.status)}</span>${KL[j.kind] ? `<span class="badge off">${KL[j.kind]}</span>` : ''}<div class="s">${esc(j.description)}</div>${j.lines.map(l => line(esc(A[l.accountId]?.name || '—') + (l.party ? ' (' + esc(l.party) + ')' : ''), l.debit ? fmt(l.debit, 0) : '', l.credit ? fmt(l.credit, 0) : '')).join('')}</div>`).join('') || `<div class="empty">در این سال سندی نیست.</div>`;
  }
  return hdr + sel + body;
}
document.addEventListener('change', e => {
  const t = e.target.closest('[data-change]'); if (!t) return;
  if (t.dataset.change === 'fy') { ui.fyId = t.value; render(); }
  if (t.dataset.change === 'led') { ui.ledAcc = t.value; render(); }
  if (t.dataset.change === 'ledp') { ui.ledParty = t.value; render(); }
});
Object.assign(ACT, {
  accSeed, accSave, fyClose, paySave, jrVoid, jrDel,
  payNew: d => { ui.op.id = null; ui.op.t = d.t; ui.draft = null; render(); },
  payOpen: d => { ui.op.id = d.id; render(); },
  jrNew: () => { ui.op.id = null; ui.draft = null; render(); },
  jrOpen: d => { ui.op.id = d.id; ui.draft = null; render(); },
  addJ: () => { syncJ(); ui.draft.lines.push({}); render(); },
  rmJ: d => { syncJ(); ui.draft.lines.splice(+d.i, 1); if (ui.draft.lines.length < 2) ui.draft.lines.push({}); render(); },
  jrPost: () => jrSubmit(true), jrDraft: () => jrSubmit(false)
});

/* ========== فاز ۵: ABC، سناریو، چندارزی، گزارش‌های پیشرفته ========== */
const q2 = x => Math.round((x + Number.EPSILON) * 100) / 100;
const abcRate = a => n0(a.poolCost) / n0(a.driverVolume);
async function fxRateOn(currencyId, date) {
  const r = (await rows('fxRates')).filter(x => x.currencyId === currencyId && x.date <= date).sort((a, b) => b.date.localeCompare(a.date))[0];
  return r ? num(r.rate) : 0;
}
async function repHeader(kind, withProd) {
  if (!ui.rep) { const t = new Date(); t.setFullYear(t.getFullYear() - 1); ui.rep = { from: isoOf(t), to: todayISO() }; }
  const prods = withProd ? (await rows('items')).filter(i => i.kind === 'محصول نهایی' || i.kind === 'کالای نیمه‌ساخته') : [];
  return `${back('opBack')}<h2>${KINDS[kind]}</h2><form id="rf2" onsubmit="return false"><label>از تاریخ</label>${dateField('from', ui.rep.from)}<label>تا تاریخ</label>${dateField('to', ui.rep.to)}
  ${withProd ? `<label>محصول</label><select name="prod"><option value="">همه محصولات</option>${prods.map(p => `<option value="${p.id}" ${p.id === ui.rep.productId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>` : ''}</form>
  <button class="btn alt sm" data-act="repRun">نمایش گزارش</button>`;
}

/* ---------- گزارش ABC ---------- */
async function abcReport() {
  const hdr = await repHeader('rabc', true), acts = {}; for (const a of await rows('activities')) acts[a.id] = a;
  const usage = await rows('abcUsage'), orders = (await rows('prodOrders')).filter(p => p.status === 'done' && inR(p.date));
  const items = {}; for (const i of await rows('items')) items[i.id] = i;
  const pids = [...new Set(usage.map(u => u.productId))].filter(id => items[id] && (!ui.rep.productId || id === ui.rep.productId));
  if (!pids.length) return hdr + `<div class="empty">ابتدا فعالیت‌ها و «مصرف فعالیت‌ها برای هر محصول» را ثبت کنید.</div>`;
  let body = '';
  for (const pid of pids) {
    let abcOH = 0, det = '';
    for (const u of usage.filter(x => x.productId === pid)) { const a = acts[u.activityId]; if (!a) continue; const c = abcRate(a) * n0(u.perUnit); abcOH += c; det += `<div class="tr" style="grid-template-columns:1.5fr 1fr 1fr 1fr"><span>${esc(a.name)}</span><span>${fmt(abcRate(a), 2)}</span><span>${fmt(n0(u.perUnit))}</span><span>${fmt(c, 2)}</span></div>`; }
    const os = orders.filter(p => p.productId === pid), out = os.reduce((x, p) => x + p.actualQty, 0), M = os.reduce((x, p) => x + (p.materialCost ?? p.totalCost), 0), L = os.reduce((x, p) => x + (p.laborCost || 0), 0), OH = os.reduce((x, p) => x + (p.ohApplied || 0), 0);
    body += `<h3>${esc(items[pid].name)}</h3><div class="tr h" style="grid-template-columns:1.5fr 1fr 1fr 1fr"><span>فعالیت</span><span>نرخ هر محرک</span><span>مصرف</span><span>سهم هر واحد</span></div>${det}
    <dl class="facts"><div><dt>سربار هر واحد به روش ABC</dt><dd>${fmt(abcOH, 2)}</dd></div>`;
    if (out > 0) { const direct = (M + L) / out, trad = OH / out; body += `<div><dt>سربار هر واحد به روش سنتی (نرخ مجموعه سربار)</dt><dd>${fmt(trad, 2)}</dd></div><div><dt>مواد و دستمزد مستقیم هر واحد</dt><dd>${fmt(direct, 2)}</dd></div><div><dt>بهای کامل هر واحد – ABC</dt><dd>${fmt(direct + abcOH, 2)}</dd></div><div><dt>بهای کامل هر واحد – سنتی</dt><dd>${fmt(direct + trad, 2)}</dd></div><div><dt><b>اختلاف (ABC منهای سنتی)</b></dt><dd><b>${fmt(abcOH - trad, 2)}</b></dd></div><div><dt>تعداد تولید در بازه</dt><dd>${fmt(out)}</dd></div>`; }
    else body += `<div><dt>تولید در بازه</dt><dd>سفارشی نیست</dd></div>`;
    body += `</dl>`;
  }
  return hdr + body + `<p class="warn">هزینه و حجم محرک هر فعالیت برای همان دوره‌ای فرض می‌شود که در «فعالیت‌ها» ثبت کرده‌اید.</p>`;
}

/* ---------- سناریوها ---------- */
const SCN_NEW = () => ({ name: '', bomId: '', volume: '100', matPct: '', labPct: '', effPct: '', scrap: '', ohMode: 'none', ohId: '', price: '', shown: false });
async function scnCompute(D) {
  const bom = D.bomId ? await get('boms', D.bomId) : null; if (!bom) return { err: 'فرمول ساخت را انتخاب کنید.' };
  const Q = num(D.volume); if (!(Q > 0)) return { err: 'حجم تولید باید عددی بزرگ‌تر از صفر باشد.' };
  const pct = v => String(v).trim() === '' ? 0 : num(v), mp = pct(D.matPct), lp = pct(D.labPct), ep = pct(D.effPct);
  if ([mp, lp, ep].some(isNaN)) return { err: 'درصدهای تغییر باید عدد باشند (مثلاً ۱۰ یا -۵).' };
  const sc = String(D.scrap).trim() === '' ? (bom.scrapPct || 0) : num(D.scrap); if (!(sc >= 0 && sc < 100)) return { err: 'درصد ضایعات باید بین ۰ و ۱۰۰ باشد.' };
  const price = String(D.price).trim() === '' ? 0 : num(D.price); if (isNaN(price) || price < 0) return { err: 'قیمت فروش باید عدد صفر یا بیشتر باشد.' };
  const items = {}; for (const i of await rows('items')) items[i.id] = i;
  const st = await stockMap(), avg = {}; for (const k in st) { const id = k.split('|')[0], e = avg[id] || (avg[id] = { q: 0, v: 0 }); e.q += st[k].qty; e.v += st[k].value; }
  const warn = []; let matPer = 0;
  for (const l of bom.lines) {
    const it = items[l.itemId]; let pr = num(it?.stdPrice);
    if (!(pr > 0)) { const e = avg[l.itemId]; pr = e && e.q > 0 ? e.v / e.q : 0; if (!(pr > 0)) warn.push(`برای «${it?.name || ''}» قیمت استاندارد یا موجودی نیست (قیمت صفر فرض شد).`); }
    matPer += l.qty / bom.outputQty * pr * (1 + mp / 100);
  }
  const started = Q / (1 - sc / 100), hrsPer = (bom.stdHours || 0) / bom.outputQty * (1 + ep / 100), labPer = hrsPer * (bom.laborRate || 0) * (1 + lp / 100);
  const M = matPer * started, L = labPer * started; let OH = 0;
  if (D.ohMode === 'pool') {
    const pool = D.ohId ? await get('ohRates', D.ohId) : null; if (!pool) return { err: 'مجموعه سربار را انتخاب کنید.' };
    OH = ohRate(pool) * (pool.base === 'ساعت کار مستقیم' ? hrsPer * started : pool.base === 'مقدار تولید' ? Q : M);
  } else if (D.ohMode === 'abc') {
    const us = (await rows('abcUsage')).filter(u => u.productId === bom.productId), acts = {}; for (const a of await rows('activities')) acts[a.id] = a;
    if (!us.length) warn.push('برای این محصول مصرف فعالیتی ثبت نشده است.');
    OH = us.reduce((x, u) => x + (acts[u.activityId] ? abcRate(acts[u.activityId]) * n0(u.perUnit) : 0), 0) * Q;
  }
  const total = M + L + OH, unit = total / Q;
  return { matUnit: M / Q, labUnit: L / Q, ohUnit: OH / Q, unitCost: unit, total: rial(total), started: q3(started), price, revenue: rial(price * Q), profitUnit: price > 0 ? price - unit : 0, margin: price > 0 ? (price - unit) / price * 100 : 0, warn, scrap: sc };
}
const scnFacts = r => `<dl class="facts"><div><dt>بهای مواد هر واحد</dt><dd>${fmt(r.matUnit, 2)}</dd></div><div><dt>دستمزد هر واحد</dt><dd>${fmt(r.labUnit, 2)}</dd></div><div><dt>سربار هر واحد</dt><dd>${fmt(r.ohUnit, 2)}</dd></div><div><dt><b>بهای تمام‌شده هر واحد</b></dt><dd><b>${fmt(r.unitCost, 2)}</b></dd></div><div><dt>جمع هزینه</dt><dd>${fmt(r.total, 0)}</dd></div>${r.price > 0 ? `<div><dt>سود هر واحد</dt><dd>${fmt(r.profitUnit, 2)}</dd></div><div><dt>حاشیه سود</dt><dd>${fmt(r.margin, 1)}٪</dd></div>` : ''}</dl>${(r.warn || []).map(w => `<div class="warn">${esc(w)}</div>`).join('')}`;
function scnSync() {
  const f = $('#sf'); if (!f || !ui.draft) return; const D = ui.draft;
  for (const k of ['name', 'bomId', 'volume', 'matPct', 'labPct', 'effPct', 'scrap', 'ohMode', 'ohId', 'price']) if (f.elements[k]) D[k] = f.elements[k].value;
}
async function scnList() {
  const list = (await rows('scenarios')).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return `${back('opBack')}<h2>سناریوها</h2><p>برای مقایسه، چند سناریو را تیک بزنید.</p>
  ${list.map(r => `<label class="row"><input type="checkbox" class="sc-pick" value="${r.id}" style="width:20px;height:20px;accent-color:var(--orange)"><span class="t">${esc(r.name)} – نسخه ${fmt(r.version, 0)}<span class="s">${esc(r.productName)} – بهای هر واحد: ${fmt(r.result.unitCost, 2)}</span></span></label>`).join('') || `<div class="empty">هنوز سناریویی ذخیره نشده است.</div>`}
  ${list.length ? `<button class="btn alt" data-act="scnCmp">مقایسه (یا مشاهده) موارد تیک‌خورده</button>` : ''}
  ${can('create') ? `<button class="fab" data-act="scnNew">+ سناریوی جدید</button>` : ''}`;
}
async function scnForm() {
  if (!ui.draft) ui.draft = SCN_NEW();
  const D = ui.draft, boms = (await rows('boms')).sort((a, b) => a.productName.localeCompare(b.productName, 'fa') || b.version - a.version), pools = await rows('ohRates');
  const r = (recalc === 'auto' || D.shown) ? await scnCompute(D) : null;
  const inp = (k, label, ph) => `<label>${label}</label><input type="text" inputmode="decimal" name="${k}" data-change="scnAuto" value="${esc(D[k])}" ${ph ? `placeholder="${ph}"` : ''}>`;
  return `${back('opBack')}<h2>سناریوی جدید</h2>${boms.length ? '' : `<div class="warn">ابتدا یک فرمول ساخت ثبت کنید.</div>`}
  <form id="sf" onsubmit="return false"><label>نام سناریو (مثلاً «افزایش ۱۰٪ قیمت مواد»)</label><input type="text" name="name" value="${esc(D.name)}">
  <label>فرمول ساخت (محصول و نسخه) *</label><select name="bomId" data-change="scnAuto"><option value="">انتخاب کنید</option>${boms.map(b => `<option value="${b.id}" ${b.id === D.bomId ? 'selected' : ''}>${esc(b.productName)} – نسخه ${fmt(b.version, 0)}</option>`).join('')}</select>
  ${inp('volume', 'حجم تولید سالم *')}
  <h3>فرض‌ها (درصد تغییر نسبت به استاندارد؛ خالی = بدون تغییر)</h3>
  ${inp('matPct', 'تغییر قیمت مواد ٪', 'مثلاً 10 یا -5')}${inp('labPct', 'تغییر نرخ دستمزد ٪')}${inp('effPct', 'تغییر ساعت کار (کارایی) ٪')}${inp('scrap', 'درصد ضایعات (خالی = مطابق فرمول)')}
  <label>روش سربار</label><select name="ohMode" data-change="scnAuto"><option value="none" ${D.ohMode === 'none' ? 'selected' : ''}>بدون سربار</option><option value="pool" ${D.ohMode === 'pool' ? 'selected' : ''}>نرخ مجموعه سربار</option><option value="abc" ${D.ohMode === 'abc' ? 'selected' : ''}>ABC</option></select>
  ${D.ohMode === 'pool' ? `<label>مجموعه سربار</label><select name="ohId" data-change="scnAuto"><option value="">انتخاب کنید</option>${pools.map(p => `<option value="${p.id}" ${p.id === D.ohId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>` : ''}
  ${inp('price', 'قیمت فروش هر واحد (اختیاری)')}</form>
  ${r ? (r.err ? `<div class="err">${esc(r.err)}</div>` : `<h3>نتیجه</h3>${scnFacts(r)}`) : `<p class="warn">برای دیدن نتیجه «محاسبه» را بزنید.</p>`}
  <button class="btn alt" data-act="scnCalc">محاسبه</button>${can('create') ? `<button class="btn" data-act="scnSave">ذخیره سناریو</button>` : ''}`;
}
async function scnSave() {
  scnSync(); const D = ui.draft; if (!D.name.trim()) return err('برای سناریو یک نام بنویسید.');
  const r = await scnCompute(D); if (r.err) return err(r.err);
  const bom = await get('boms', D.bomId), pool = D.ohMode === 'pool' ? await get('ohRates', D.ohId) : null;
  const ver = (await rows('scenarios')).filter(x => x.name === D.name.trim()).length + 1;
  const rec = newRec({ name: D.name.trim(), version: ver, productId: bom.productId, productName: bom.productName, bomId: bom.id, bomVersion: bom.version, calcAt: new Date().toISOString(), userName: me.name, recalcMode: recalc,
    assumptions: { volume: num(D.volume), matPct: n0(D.matPct), labPct: n0(D.labPct), effPct: n0(D.effPct), scrap: r.scrap, ohMode: D.ohMode, ohName: pool ? pool.name : '', price: r.price }, result: r });
  await putMany([['scenarios', rec], ['audit', auditRec('ذخیره سناریو', 'scenarios', rec.id, rec.name + ' نسخه ' + ver)]]);
  ui.op.id = undefined; ui.draft = null; toast('سناریو ذخیره شد'); render();
}
async function scnCompare() {
  const list = (await rows('scenarios')).filter(x => ui.op.cmp.includes(x.id)), n = list.length;
  if (!n) { ui.op.cmp = null; return scnList(); }
  const g = `style="grid-template-columns:1.3fr repeat(${n},1fr)"`, row = (lab, f) => `<div class="tr" ${g}><span>${lab}</span>${list.map(x => `<span>${f(x)}</span>`).join('')}</div>`, A = x => x.assumptions, R = x => x.result;
  const pc = v => (v > 0 ? '+' : '') + fmt(v) + '٪';
  return `${back('scnBack')}<h2>مقایسه سناریوها</h2>
  <div class="tr h" ${g}><span>مورد</span>${list.map(x => `<span>${esc(x.name)} (${fmt(x.version, 0)})</span>`).join('')}</div>
  ${row('محصول', x => esc(x.productName))}${row('نسخه فرمول', x => fmt(x.bomVersion, 0))}${row('حجم', x => fmt(A(x).volume))}${row('تغییر قیمت مواد', x => pc(A(x).matPct))}${row('تغییر نرخ دستمزد', x => pc(A(x).labPct))}${row('تغییر ساعت کار', x => pc(A(x).effPct))}${row('ضایعات ٪', x => fmt(A(x).scrap))}${row('روش سربار', x => A(x).ohMode === 'none' ? 'ندارد' : A(x).ohMode === 'abc' ? 'ABC' : esc(A(x).ohName))}
  ${row('مواد هر واحد', x => fmt(R(x).matUnit, 2))}${row('دستمزد هر واحد', x => fmt(R(x).labUnit, 2))}${row('سربار هر واحد', x => fmt(R(x).ohUnit, 2))}${row('<b>بهای هر واحد</b>', x => `<b>${fmt(R(x).unitCost, 2)}</b>`)}${row('جمع هزینه', x => fmt(R(x).total, 0))}${row('قیمت فروش', x => R(x).price ? fmt(R(x).price, 0) : '—')}${row('سود هر واحد', x => R(x).price ? fmt(R(x).profitUnit, 2) : '—')}${row('حاشیه سود', x => R(x).price ? fmt(R(x).margin, 1) + '٪' : '—')}
  ${row('تاریخ محاسبه', x => esc(fmtDay(x.calcAt.slice(0, 10))))}${row('محاسبه‌کننده', x => esc(x.userName))}
  ${n === 1 && can('void') ? `<button class="btn bad" data-act="scnVoid">ابطال این سناریو</button>` : ''}<p class="warn">سناریوهای ذخیره‌شده تغییر نمی‌کنند؛ برای فرض جدید، سناریوی تازه با همان نام بسازید تا نسخه بعدی ثبت شود.</p>`;
}

/* ---------- تسعیر ارز ---------- */
async function fxReport() {
  if (!ui.fxDate) ui.fxDate = todayISO();
  const docs = (await rows('docs')).filter(d => d.status === 'posted' && d.fx && (d.type === 'sale' || d.type === 'purchase') && d.fx.total - d.fx.settled > 0.0001);
  let net = 0, h = '';
  for (const d of docs) {
    const out = q2(d.fx.total - d.fx.settled), cur = await fxRateOn(d.fx.currencyId, ui.fxDate);
    if (!cur) { h += `<div class="warn">برای ${esc(d.fx.code)} تا این تاریخ نرخی ثبت نشده (${esc(d.number)}).</div>`; continue; }
    const diff = rial(out * (cur - d.fx.rate)), eff = d.type === 'sale' ? diff : -diff; net += eff;
    h += `<div class="tr"><span>${esc(d.number)}<br><small>${esc(d.partner || '')}</small></span><span>${fmt(out, 2)} ${esc(d.fx.code)}</span><span>${fmt(d.fx.rate, 0)} ← ${fmt(cur, 0)}</span><span>${eff >= 0 ? 'سود ' : 'زیان '}${fmt(Math.abs(eff), 0)}</span></div>`;
  }
  return `${back('opBack')}<h2>${KINDS.rfx}</h2><form id="xf" onsubmit="return false"><label>محاسبه با نرخ تا تاریخ</label>${dateField('asof', ui.fxDate)}</form><button class="btn alt sm" data-act="fxRun">نمایش</button>
  ${docs.length ? `<div class="tr h"><span>سند</span><span>مانده ارزی</span><span>نرخ سند ← نرخ روز</span><span>سود/زیان</span></div>${h}<dl class="facts"><div><dt><b>${net >= 0 ? 'جمع سود تسعیر تحقق‌نیافته' : 'جمع زیان تسعیر تحقق‌نیافته'}</b></dt><dd><b>${fmt(Math.abs(net), 0)} ریال</b></dd></div></dl><p class="warn">این رقم فقط گزارش است و سند حسابداری ثبت نمی‌شود. سود و زیان تحقق‌یافته هنگام «تسویه سند ارزی» در دریافت و پرداخت ثبت می‌شود.</p>` : `<div class="empty">سند ارزی باز (تسویه‌نشده) وجود ندارد.</div>`}`;
}
async function accAddFx() {
  if (!can('settings')) return err('اجازه «مدیریت تنظیمات» را ندارید.');
  const S = await acctState(), all = await rows('accounts'); let a = all.find(x => x.code === '5202');
  if (!a) {
    const par = all.find(x => x.code === '52' && x.level === 'کل'); if (!par) return err('حساب کل ۵۲ پیدا نشد؛ یک حساب معین دلخواه بسازید و در «سود (زیان) تسعیر ارز» انتخابش کنید.');
    a = newRec({ level: 'معین', code: '5202', name: 'سود (زیان) تسعیر ارز', parentId: par.id }); await putMany([['accounts', a]]);
  }
  const cfg = S.cfg; cfg.map.fx = a.id;
  await putMany([['meta', { id: 'acct:' + company.id, value: cfg }], ['audit', auditRec('اتصال حساب تسعیر ارز', 'accounts', a.id, '')]]); toast('حساب تسعیر ارز آماده شد'); render();
}

/* ---------- خروجی CSV برای Excel ---------- */
async function exportCsv() {
  const q = x => '"' + String(x).replace(/"/g, '""') + '"', out = [];
  document.querySelectorAll('main .tr, main dl.facts > div, main h3').forEach(el => {
    if (el.tagName === 'H3') out.push([el.innerText.trim()]);
    else out.push([...el.children].map(c => c.innerText.replace(/\s+/g, ' ').trim()));
  });
  if (!out.length) return err('داده‌ای برای خروجی نیست.');
  try { await saveFile('report-' + (ui.op?.kind || 'data') + '-' + todayISO() + '.csv', '\ufeff' + out.map(r => r.map(q).join(',')).join('\r\n')); } catch (e) { err('خروجی انجام نشد: ' + e.message); }
}
document.addEventListener('change', async e => {
  const t = e.target.closest('[data-change]'); if (!t) return; const c = t.dataset.change;
  if (c === 'recalc') { recalc = t.value; await setMeta('recalc', recalc); }
  if (c === 'scnAuto') { scnSync(); if (recalc === 'auto') render(); }
  if (c === 'docCur') { syncDraft(); const D = ui.draft; D.rate = D.currencyId ? String((await fxRateOn(D.currencyId, D.date)) || '') : ''; render(); }
});
Object.assign(ACT, {
  accAddFx, exportCsv, scnSave,
  repRun: () => { const f = $('#rf2'), a = readDate(f, 'from'), b = readDate(f, 'to'); if (!a || !b) return err('تاریخ معتبر نیست.'); if (a > b) return err('تاریخ شروع باید قبل از پایان باشد.'); ui.rep = { from: a, to: b, productId: f.elements.prod ? f.elements.prod.value : '' }; render(); },
  fxRun: () => { const d = readDate($('#xf'), 'asof'); if (!d) return err('تاریخ معتبر نیست.'); ui.fxDate = d; render(); },
  scnNew: () => { ui.op.id = null; ui.draft = null; render(); },
  scnCalc: () => { scnSync(); ui.draft.shown = true; render(); },
  scnCmp: () => { const ids = [...document.querySelectorAll('.sc-pick:checked')].map(x => x.value); if (!ids.length) return err('حداقل یک سناریو را تیک بزنید.'); ui.op.cmp = ids; render(); },
  scnBack: () => { ui.op.cmp = null; render(); },
  scnVoid: async () => { if (!can('void') || !confirm('این سناریو باطل شود؟ سابقه آن در گزارش رویدادها می‌ماند.')) return; const r = await get('scenarios', ui.op.cmp[0]); await putMany([['scenarios', touch({ ...r, voided: true })], ['audit', auditRec('ابطال سناریو', 'scenarios', r.id, r.name)]]); ui.op.cmp = null; render(); }
});

/* ========== فاز ۶: سرور مرکزی، همگام‌سازی، تعارض، پشتیبان ابری ========== */
document.head.insertAdjacentHTML('beforeend', '<style>.chip{background:#ffffff33;border-radius:12px;padding:2px 10px;font-size:12px;color:#fff;border:0;font-family:inherit}</style>');
const SYNC_STORES = ['companies', 'factories', 'units', 'items', 'nodes', 'docs', 'stockMoves', 'boms', 'prodOrders', 'ohRates', 'ohActuals', 'accounts', 'journals', 'fiscalYears', 'activities', 'abcUsage', 'scenarios', 'currencies', 'fxRates', 'audit'];
const ST_FA = { companies: 'شرکت', factories: 'کارخانه', units: 'واحد', items: 'کالا', nodes: 'انبار/مرکز', docs: 'سند خرید/فروش/دریافت/پرداخت', stockMoves: 'گردش انبار', boms: 'فرمول ساخت', prodOrders: 'سفارش تولید', ohRates: 'مجموعه سربار', ohActuals: 'سربار واقعی', accounts: 'حساب', journals: 'سند حسابداری', fiscalYears: 'سال مالی', activities: 'فعالیت', abcUsage: 'مصرف فعالیت', scenarios: 'سناریو', currencies: 'ارز', fxRates: 'نرخ ارز', audit: 'رویداد' };
let cloud = { url: '', key: '', email: '', session: null, enabled: false }, cloudInfo = { pending: 0, conflicts: 0, last: '', error: '', busy: false }, devCode = '', syncing = false, syncTimer = null;
const saveCloud = () => setMeta('cloud', { id: 'cloud', url: cloud.url, key: cloud.key, email: cloud.email, session: cloud.session, enabled: cloud.enabled });
async function loadCloud() {
  const c = await getMeta('cloud'); if (c) cloud = { ...cloud, ...c };
  devCode = (await getMeta('devCode')) || '';
  cloudAutoOn = (await getMeta('cloudAutoBackup')) !== false;
  try { [cloudInfo.pending, cloudInfo.conflicts] = await pendingCount(); cloudInfo.last = (await getMeta('cloudLast')) || ''; } catch (e) { /* ignore */ }
}
function cErr(e) {
  const m = String((e && e.message) || e), map = [['Invalid login credentials', 'ایمیل یا گذرواژه درست نیست.'], ['User already registered', 'این ایمیل قبلاً ثبت شده است؛ «ورود» را بزنید.'], ['not_authenticated', 'ابتدا وارد حساب ابری شوید.'], ['no_permission', 'اجازه این کار را ندارید.'], ['user_not_found', 'این ایمیل در سرور حساب ندارد؛ از او بخواهید اول در برنامه «ساخت حساب» بزند.'], ['company_exists_not_member', 'این شرکت قبلاً با حساب دیگری در سرور ساخته شده و شما عضو آن نیستید.'], ['cannot_remove_self', 'نمی‌توانید خودتان را حذف کنید.'], ['only_admin_can_grant_admin', 'فقط مدیر می‌تواند مدیر تعیین کند.'], ['Password should be at least', 'گذرواژه ابری باید حداقل ۶ نویسه باشد.'], ['Unable to validate email', 'ایمیل معتبر نیست.']];
  for (const [k, v] of map) if (m.includes(k)) return v;
  if (/PGRST202|Could not find the function|schema cache/.test(m)) return 'اسکریپت سرور (server_setup.sql) هنوز اجرا نشده یا ناقص اجرا شده است.';
  if (/JWT|expired/i.test(m)) return 'نشست ابری منقضی شده؛ دوباره وارد شوید.';
  if (/Invalid API key|apikey/i.test(m)) return 'کلید API درست نیست (باید anon یا publishable باشد).';
  return m;
}
async function cApi(path, o = {}) {
  const headers = { apikey: cloud.key, 'Content-Type': 'application/json' };
  if (o.auth !== false) headers.Authorization = 'Bearer ' + ((cloud.session && cloud.session.access) || cloud.key);
  const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 30000); let res;
  try { res = await fetch(cloud.url.replace(/\/+$/, '') + path, { method: o.method || 'GET', headers, body: o.body ? JSON.stringify(o.body) : undefined, signal: ctl.signal }); }
  catch (e) { const er = new Error('اتصال به سرور برقرار نشد (اینترنت یا آدرس سرور را بررسی کنید).'); er.net = true; throw er; } finally { clearTimeout(to); }
  const text = await res.text(); let j = null; try { j = text ? JSON.parse(text) : null; } catch (e) { /* not json */ }
  if (!res.ok) { const er = new Error((j && (j.message || j.msg || j.error_description || j.error)) || text || ('خطای ' + res.status)); er.status = res.status; throw er; }
  return j;
}
async function ensureSession() {
  const s = cloud.session; if (!s) throw new Error('ابتدا وارد حساب ابری شوید.');
  if (s.exp - Date.now() > 60000) return;
  const j = await cApi('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: s.refresh }, auth: false });
  cloud.session = { access: j.access_token, refresh: j.refresh_token || s.refresh, exp: Date.now() + (j.expires_in || 3600) * 1000 }; await saveCloud();
}
async function rpc(fn, params = {}) {
  await ensureSession();
  try { return await cApi('/rest/v1/rpc/' + fn, { method: 'POST', body: params }); }
  catch (e) { if (e.status !== 401) throw e; cloud.session.exp = 0; await ensureSession(); return cApi('/rest/v1/rpc/' + fn, { method: 'POST', body: params }); }
}
async function cloudAuth(mode, email, pw) {
  const j = await cApi(mode === 'signup' ? '/auth/v1/signup' : '/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password: pw }, auth: false });
  if (!j || !j.access_token) throw new Error('حساب ساخته شد ولی ورود خودکار ممکن نشد؛ در Supabase گزینه «Confirm email» را خاموش کنید.');
  cloud.session = { access: j.access_token, refresh: j.refresh_token, exp: Date.now() + (j.expires_in || 3600) * 1000 }; cloud.email = email; cloud.enabled = true; await saveCloud();
}
const recStamp = r => r.updatedAt || r.createdAt || r.at || '';
async function pendingCount() {
  let n = 0; for (const s of SYNC_STORES) for (const r of await all(s)) if (!r.sample && r.syncStatus === 'pending' && (s === 'companies' || r.companyId)) n++;
  return [n, (await all('conflicts')).length];
}
function syncSoon() { if (!cloud.enabled) return; clearTimeout(syncTimer); syncTimer = setTimeout(() => syncNow(true), 3000); }
function startSyncTimers() {
  setInterval(() => { if (cloud.enabled && me && navigator.onLine && !document.hidden) syncNow(true); }, 60000);
  window.addEventListener('online', () => syncSoon());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncSoon(); });
}
function safeRender() { const a = document.activeElement; if (a && /INPUT|SELECT|TEXTAREA/.test(a.tagName)) return; if (document.querySelector('main form')) return; render(); }
async function syncNow(quiet) {
  if (!cloud.enabled || syncing || !me) return; syncing = true; cloudInfo.busy = true;
  try {
    await ensureSession();
    const server = new Set((await rpc('my_companies')).map(c => c.id));
    for (const c of await all('companies')) if (!c.voided && !c.sample && !server.has(c.id) && can('orgs')) { await rpc('create_company', { p_id: c.id, p_name: c.name, p_email: cloud.email }); server.add(c.id); }
    await pushAll(server);
    const changed = await pullAll();
    if (changed && !company) await pickCompany();
    cloudInfo.error = ''; cloudInfo.last = new Date().toISOString(); await setMeta('cloudLast', cloudInfo.last);
    await maybeAutoBackup();
    [cloudInfo.pending, cloudInfo.conflicts] = await pendingCount();
    syncing = false; cloudInfo.busy = false; if (changed || cloudInfo.conflicts) safeRender(); else safeRender();
  } catch (e) {
    cloudInfo.error = cErr(e); if (!quiet) toast(cloudInfo.error);
    try { [cloudInfo.pending, cloudInfo.conflicts] = await pendingCount(); } catch (x) { /* ignore */ }
    syncing = false; cloudInfo.busy = false; safeRender();
  }
}
async function pushAll(server) {
  const ops = [], keep = {};
  for (const s of SYNC_STORES) for (const r of await all(s)) {
    if (r.sample || r.syncStatus !== 'pending') continue;
    const cid = s === 'companies' ? r.id : r.companyId; if (!cid || !server.has(cid)) continue;
    const data = { ...r }; delete data._ver; delete data.syncStatus;
    const op = { op_id: r.id + ':' + recStamp(r), company_id: cid, store: s, id: r.id, base_version: r._ver || 0, data };
    ops.push(op); keep[op.op_id] = { s, rec: r };
  }
  for (let i = 0; i < ops.length; i += 100) {
    const res = await rpc('sync_push', { p_ops: ops.slice(i, i + 100) });
    for (const x of res) { const k = keep[x.op_id]; if (k) await applyResult(k.s, k.rec, x); }
  }
}
async function applyResult(s, sent, x) {
  const cur = await get(s, sent.id); if (!cur) return;
  if (x.status === 'applied' || x.status === 'duplicate') await put(s, { ...cur, _ver: x.version, syncStatus: recStamp(cur) === recStamp(sent) ? 'synced' : 'pending' });
  else if (x.status === 'conflict' || x.status === 'denied') {
    await put('conflicts', { id: s + ':' + sent.id, store: s, recId: sent.id, kind: x.status, reason: x.reason || '', serverVer: x.server ? x.server.version : 0, server: x.server ? x.server.data : null, at: new Date().toISOString(), name: sent.name || sent.number || sent.description || '' });
    await put(s, { ...cur, syncStatus: 'conflict' });
  }
}
async function pullAll() {
  const last = (await getMeta('cloudSeq')) || 0; let since = Math.max(0, last - 100), maxSeq = last, changed = false;
  for (;;) {
    const list = await rpc('sync_pull', { p_since: since, p_limit: 500 });
    for (const r of list) {
      if (r.seq > maxSeq) maxSeq = r.seq;
      if (!SYNC_STORES.includes(r.store)) continue;
      const loc = await get(r.store, r.id);
      if (loc && (loc._ver || 0) >= r.version) continue;
      if (loc && (loc.syncStatus === 'pending' || loc.syncStatus === 'conflict')) continue;
      await put(r.store, { ...r.data, _ver: r.version, syncStatus: 'synced' }); changed = true;
    }
    if (list.length < 500) break; since = list[list.length - 1].seq;
  }
  await setMeta('cloudSeq', maxSeq); return changed;
}
async function cloudBackup(auto) {
  const text = await buildBackup();
  await rpc('save_backup', { p_company: company.id, p_payload: text, p_note: auto ? 'خودکار' : 'دستی' });
  await setMeta('cloudBackupAt', new Date().toISOString()); await log('پشتیبان ابری', '', '', auto ? 'خودکار' : 'دستی');
}
async function maybeAutoBackup() {
  if (!company || !can('backup') || (await getMeta('cloudAutoBackup')) === false) return;
  const t = await getMeta('cloudBackupAt'); if (t && Date.now() - new Date(t) < 864e5) return;
  try { await cloudBackup(true); } catch (e) { /* will retry next sync */ }
}

/* ---------- نمایش ---------- */
function cloudChip() {
  if (!cloud.enabled) return ''; const i = cloudInfo;
  return `<button class="chip" data-act="page" data-p="cloud">${i.conflicts > 0 ? '⚠ تعارض' : i.error ? '☁ آفلاین' : i.busy ? '☁ …' : i.pending > 0 ? '☁ در انتظار' : '☁ ✓'}</button>`;
}
async function cloudView() {
  const back = `<button class="back" data-act="backPage">‹ بازگشت</button>`;
  if (!cloud.session) return `${back}<h2>همگام‌سازی و سرور مرکزی</h2><p>برای اشتراک داده بین دستگاه‌ها، یک پروژه رایگان Supabase بسازید و مشخصات آن را اینجا بزنید. راهنمای مرحله‌به‌مرحله در فایل <b>README_FA.txt</b> است.</p>
  <form id="cf" onsubmit="return false"><label>آدرس پروژه (Project URL)</label><input type="text" name="url" value="${esc(cloud.url)}" autocapitalize="none" placeholder="https://xxxx.supabase.co">
  <label>کلید عمومی (anon / publishable key)</label><input type="text" name="key" value="${esc(cloud.key)}" autocapitalize="none">
  <label>ایمیل حساب ابری</label><input type="text" name="email" value="${esc(cloud.email)}" autocapitalize="none"><label>گذرواژه حساب ابری (حداقل ۶ نویسه)</label><input type="password" name="pw"></form>
  <button class="btn" data-act="cloudLogin" data-m="login">ورود</button><button class="btn alt" data-act="cloudLogin" data-m="signup">ساخت حساب جدید</button>
  <p class="warn">هرگز «service_role key» را اینجا نگذارید.</p>`;
  const i = cloudInfo, perm = ['users'];
  let members = '';
  if (can('users') && company) {
    members = `<h3>اعضای ابری شرکت «${esc(company.name)}»</h3><button class="btn alt sm" data-act="memList">نمایش اعضا</button>${(ui.members || []).map(m => `<div class="row"><span class="t">${esc(m.email || m.user_id)}${m.is_admin ? '<span class="badge">مدیر</span>' : ''}<span class="s">${esc((m.perms || []).map(p => PERMS[p] || p).join('، ') || '—')}</span></span><button class="x" data-act="memRm" data-u="${m.user_id}" aria-label="حذف">×</button></div>`).join('')}
    <form id="mf" onsubmit="return false"><label>افزودن عضو (ایمیلی که در برنامه حساب ابری ساخته)</label><input type="text" name="email" autocapitalize="none">
    <label class="chk"><input type="checkbox" name="adm"> مدیر شرکت</label>${Object.entries(PERMS).map(([k, t]) => `<label class="chk"><input type="checkbox" name="p_${k}" ${k === 'view' ? 'checked' : ''}> ${t}</label>`).join('')}</form><button class="btn" data-act="memAdd">افزودن عضو</button>`;
  }
  return `${back}<h2>همگام‌سازی و سرور مرکزی</h2><dl class="facts"><div><dt>حساب ابری</dt><dd>${esc(cloud.email)}</dd></div><div><dt>آخرین همگام‌سازی</dt><dd>${i.last ? esc(fmtDate(i.last)) : '—'}</dd></div><div><dt>در انتظار ارسال</dt><dd>${fmt(i.pending, 0)}</dd></div><div><dt>تعارض یا ردشده</dt><dd>${fmt(i.conflicts, 0)}</dd></div></dl>
  ${i.error ? `<div class="err">${esc(i.error)}</div>` : ''}${i.conflicts ? `<button class="btn" data-act="page" data-p="conflicts">بررسی تعارض‌ها (${fmt(i.conflicts, 0)})</button>` : ''}
  <button class="btn" data-act="syncNow">همگام‌سازی اکنون</button><button class="btn alt" data-act="cloudTest">تست اتصال به سرور</button>
  <h3>این دستگاه</h3><form id="df2" onsubmit="return false"><label>پیشوند شماره اسناد این دستگاه (برای دستگاه اول خالی؛ دستگاه دوم مثلاً «ب»)</label><input type="text" name="dev" maxlength="3" value="${esc(devCode)}"></form><button class="btn alt" data-act="devSave">ذخیره پیشوند</button>
  <label class="chk"><input type="checkbox" data-change="cloudAuto" ${cloudAutoOn ? 'checked' : ''}> پشتیبان ابری خودکار روزانه</label>
  ${members}<button class="btn bad" data-act="cloudLogout">خروج از حساب ابری</button>`;
}
let cloudAutoOn = true;
async function conflictsView() {
  const back = `<button class="back" data-act="backPage">‹ بازگشت</button>`, list = (await all('conflicts')).sort((a, b) => b.at.localeCompare(a.at));
  const IGN = ['updatedAt', 'updatedBy', 'syncStatus', '_ver', 'createdAt', 'createdBy'], shortV = v => { const t = typeof v === 'string' ? v : JSON.stringify(v); return t === undefined ? '—' : t.length > 60 ? t.slice(0, 57) + '…' : t; };
  const why = r => r.startsWith('no_permission:') ? 'دسترسی «' + (PERMS[r.split(':')[1]] || r.split(':')[1]) + '» در سرور ندارید.' : ({ not_member: 'در سرور عضو این شرکت نیستید.', company_mismatch: 'شرکت رکورد با شرکت ثبت‌شده نمی‌خواند.', bad_request: 'درخواست ناقص بود.' }[r] || r);
  let h = '';
  for (const c of list) {
    const loc = await get(c.store, c.recId) || {}, srv = c.server || {};
    const keys = [...new Set([...Object.keys(loc), ...Object.keys(srv)])].filter(k => !IGN.includes(k) && JSON.stringify(loc[k]) !== JSON.stringify(srv[k]));
    h += `<div class="jb"><b>${esc(ST_FA[c.store] || c.store)}</b> ${esc(c.name)}<span class="badge">${c.kind === 'denied' ? 'رد شد' : 'تعارض'}</span><div class="s">${c.kind === 'denied' ? esc(why(c.reason)) : 'این مورد روی یک دستگاه دیگر هم تغییر کرده است.'}</div>
    ${c.kind === 'conflict' ? `<div class="tr h" style="grid-template-columns:1fr 1.3fr 1.3fr"><span>فیلد</span><span>نسخه من</span><span>نسخه سرور</span></div>${keys.map(k => `<div class="tr" style="grid-template-columns:1fr 1.3fr 1.3fr"><span>${esc(k)}</span><span>${esc(shortV(loc[k]))}</span><span>${esc(shortV(srv[k]))}</span></div>`).join('') || '<div class="s">تفاوتی در فیلدهای اصلی دیده نشد.</div>'}
    <button class="btn alt sm" data-act="cfKeep" data-id="${esc(c.id)}">نگه داشتن نسخه من</button> <button class="btn alt sm" data-act="cfTake" data-id="${esc(c.id)}">قبول نسخه سرور</button>`
      : `<button class="btn alt sm" data-act="cfRetry" data-id="${esc(c.id)}">تلاش دوباره</button> <button class="btn alt sm" data-act="cfLocal" data-id="${esc(c.id)}">فقط روی این دستگاه بماند</button>`}</div>`;
  }
  return `${back}<h2>تعارض‌ها و موارد ردشده</h2>${h || '<div class="empty">موردی نیست.</div>'}<p class="warn">هیچ‌کدام از انتخاب‌ها داده‌ای را حذف نمی‌کند؛ «قبول نسخه سرور» فقط نسخه من را کنار می‌گذارد و در سابقه رویدادها می‌ماند.</p>`;
}
Object.assign(ACT, {
  cloudLogin: async d => {
    const f = $('#cf'), url = f.elements.url.value.trim().replace(/\/+$/, ''), key = f.elements.key.value.trim(), email = f.elements.email.value.trim().toLowerCase(), pw = f.elements.pw.value;
    if (!/^https:\/\/[^ ]+$/.test(url) && !/^http:\/\/localhost(:\d+)?$/.test(url)) return err('آدرس پروژه باید با https:// شروع شود.');
    if (!key || !email || pw.length < 6) return err('کلید، ایمیل و گذرواژه (حداقل ۶ نویسه) را وارد کنید.');
    cloud.url = url; cloud.key = key;
    try { await cloudAuth(d.m, email, pw); toast(d.m === 'signup' ? 'حساب ساخته شد' : 'وارد شدید'); syncNow(false); render(); } catch (e) { err(cErr(e)); }
  },
  syncNow: async () => { await syncNow(false); render(); },
  cloudTest: async () => { try { const c = await rpc('my_companies'); toast('اتصال برقرار است؛ شرکت‌های شما در سرور: ' + c.length); } catch (e) { err(cErr(e)); } },
  cloudLogout: async () => { if (!confirm('از حساب ابری خارج شوید؟ داده‌های روی این دستگاه می‌مانند.')) return; cloud.session = null; cloud.enabled = false; await saveCloud(); ui.members = null; render(); },
  devSave: async () => { devCode = $('#df2').elements.dev.value.trim().slice(0, 3); await setMeta('devCode', devCode); toast('ذخیره شد'); render(); },
  memList: async () => { try { ui.members = await rpc('list_members', { p_company: company.id }); render(); } catch (e) { err(cErr(e)); } },
  memAdd: async () => {
    const f = $('#mf'), email = f.elements.email.value.trim(); if (!email) return err('ایمیل را وارد کنید.');
    try { await rpc('add_member', { p_company: company.id, p_email: email, p_perms: Object.keys(PERMS).filter(k => f.elements['p_' + k].checked), p_admin: f.elements.adm.checked }); ui.members = await rpc('list_members', { p_company: company.id }); await log('افزودن عضو ابری', 'members', '', email); toast('عضو اضافه شد'); render(); } catch (e) { err(cErr(e)); }
  },
  memRm: async d => { if (!confirm('این عضو از شرکت حذف شود؟')) return; try { await rpc('remove_member', { p_company: company.id, p_user: d.u }); ui.members = await rpc('list_members', { p_company: company.id }); render(); } catch (e) { err(cErr(e)); } },
  cfKeep: async d => { const c = await get('conflicts', d.id), r = await get(c.store, c.recId); await put(c.store, { ...r, _ver: c.serverVer, syncStatus: 'pending', updatedAt: new Date().toISOString() }); await del('conflicts', d.id); await log('تعارض: نگه داشتن نسخه من', c.store, c.recId, c.name); [cloudInfo.pending, cloudInfo.conflicts] = await pendingCount(); render(); syncSoon(); },
  cfTake: async d => { const c = await get('conflicts', d.id); await put(c.store, { ...c.server, _ver: c.serverVer, syncStatus: 'synced' }); await del('conflicts', d.id); await log('تعارض: قبول نسخه سرور', c.store, c.recId, c.name); [cloudInfo.pending, cloudInfo.conflicts] = await pendingCount(); render(); },
  cfRetry: async d => { const c = await get('conflicts', d.id), r = await get(c.store, c.recId); await put(c.store, { ...r, syncStatus: 'pending' }); await del('conflicts', d.id); [cloudInfo.pending, cloudInfo.conflicts] = await pendingCount(); render(); syncSoon(); },
  cfLocal: async d => { const c = await get('conflicts', d.id), r = await get(c.store, c.recId); await put(c.store, { ...r, syncStatus: 'local' }); await del('conflicts', d.id); await log('ردشده: فقط محلی', c.store, c.recId, c.name); [cloudInfo.pending, cloudInfo.conflicts] = await pendingCount(); render(); },
  cloudBackupNow: async () => { if (!can('backup')) return err('اجازه «پشتیبان‌گیری و بازیابی» را ندارید.'); try { await cloudBackup(false); ui.cloudBackups = await rpc('list_backups', { p_company: company.id }); toast('پشتیبان ابری ذخیره شد'); render(); } catch (e) { err(cErr(e)); } },
  cloudBackupList: async () => { try { ui.cloudBackups = await rpc('list_backups', { p_company: company.id }); render(); } catch (e) { err(cErr(e)); } },
  cloudRestore: async d => {
    try {
      const text = await rpc('get_backup', { p_id: d.id }), res = await checkBackup(text), box = $('#rmsg');
      if (res.err) { box.innerHTML = `<div class="err">${esc(res.err)}</div>`; return; }
      window._pending = res.data; const c = res.b.counts;
      box.innerHTML = `<div class="ok">پشتیبان ابری سالم است. تاریخ: ${esc(fmtDate(res.b.createdAt))}<br>کالا: ${c.items} – کاربران: ${c.users} – شرکت‌ها: ${c.companies}</div><div class="warn">با بازیابی، همه اطلاعات این دستگاه با این پشتیبان جایگزین می‌شود.</div><button class="btn bad" data-act="applyRestore">جایگزینی اطلاعات با این پشتیبان</button>`;
    } catch (e) { err(cErr(e)); }
  }
});
document.addEventListener('change', async e => {
  const t = e.target.closest('[data-change]'); if (!t || t.dataset.change !== 'cloudAuto') return;
  cloudAutoOn = t.checked; await setMeta('cloudAutoBackup', cloudAutoOn);
});
