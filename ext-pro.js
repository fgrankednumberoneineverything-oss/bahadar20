'use strict';
/* حسابدار بهای تمام‌شده - افزونه‌ها (بخش ۱): مجوز و اشتراک، نقش‌ها، تبلیغ، اطلاعات تکمیلی، ابزار مالک */
const OWNER_PUB = {"kty": "EC", "crv": "P-256", "x": "SXeC8GORDcNmZouNrFy4wgktJac2Z9zTlQActOH0Q_Y", "y": "cdXMqJoQ3QCd8cQxrEQ00o3Ah6Je0G7qeEoZWuK6OEw", "ext": true};
const DEFAULT_CFG = { enforce: false, trialDays: 14, price: '', card: '', holder: '', payText: '', requestText: 'اگر امکان پرداخت ندارید، درخواست و دلیل خود را بنویسید تا بررسی شود.', infoText: 'این اطلاعات فقط برای شناسایی شما و ارتباط مالک برنامه خواسته شده و روی همین دستگاه می‌ماند؛ فقط اگر خودتان کد درخواست را بفرستید به مالک می‌رسد.' };
const FIELD_DEFS = { phone: 'شماره تلفن همراه', landline: 'شماره تلفن ثابت', email: 'نشانی ایمیل', address: 'نشانی محل سکونت یا کار', nid: 'کد ملی', orgname: 'نام شرکت یا کارگاه', post: 'سمت شغلی' };
PERMS.vault = 'دسترسی به گاوصندوق فایل‌ها';
const ROLE_T = {
  inspector: { name: 'بازرس', perms: ['view', 'reports', 'export'], note: 'فقط دیدن نتیجه، گرفتن گزارش و خروجی Excel و PDF' },
  store: { name: 'انباردار', perms: ['view', 'create', 'edit', 'post', 'reports'], note: 'ثبت خرید، فروش و موجودی انبار' },
  costacc: { name: 'حسابدار بهای تمام‌شده', perms: ['view', 'create', 'edit', 'post', 'reports', 'export'], note: 'فرمول ساخت، سفارش تولید و گزارش‌ها' },
  prodmgr: { name: 'مدیر تولید', perms: ['view', 'create', 'edit', 'post', 'reports'], note: 'سفارش تولید و گزارش خطوط تولید' },
  trade: { name: 'کارشناس خرید و فروش', perms: ['view', 'create', 'edit', 'post'], note: 'ثبت اسناد خرید و فروش' },
  finmgr: { name: 'مدیر مالی', perms: ['view', 'create', 'edit', 'void', 'post', 'reports', 'export', 'backup'], note: 'همه‌چیز به جز کاربران، شرکت‌ها و تنظیمات' }
};
const allRoles = async () => ({ ...ROLE_T, ...Object.fromEntries(((await getMeta('customRoles')) || []).map(r => ['c_' + r.id, { name: r.name, perms: r.perms, note: 'نقش اختصاصی', custom: true }])) });
const randId = n => { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', r = crypto.getRandomValues(new Uint8Array(n)); return [...r].map(x => a[x % a.length]).join(''); };
async function deviceId() { let d = await getMeta('deviceId'); if (!d) { const r = randId(12); d = r.slice(0, 4) + '-' + r.slice(4, 8) + '-' + r.slice(8); await setMeta('deviceId', d); } return d; }
const pubKey = () => crypto.subtle.importKey('jwk', OWNER_PUB, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
async function verifyPack(code) {
  const c = String(code || '').replace(/\s+/g, ''); if (!c.startsWith('HB1.')) throw new Error('کد مجوز درست نیست.');
  const [p, s] = c.slice(4).split('.'); if (!p || !s) throw new Error('کد مجوز ناقص است.');
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, await pubKey(), b64u.dec(s), b64u.dec(p));
  if (!ok) throw new Error('امضای کد معتبر نیست؛ کد را مالک برنامه نساخته یا دست‌خورده است.');
  return JSON.parse(dec.decode(b64u.dec(p)));
}
async function loadState() {
  X.owner = !!(await getMeta('ownerKey')); X.lastSeen = (await getMeta('lastSeen')) || 0; X.st = { grant: null, cfg: null };
  const did = await deviceId();
  for (const [slot, meta] of [['grant', 'grantCode'], ['cfg', 'configCode']]) { const code = await getMeta(meta); if (!code) continue; try { const p = await verifyPack(code); if (p.dev === did || p.dev === '*') X.st[slot] = p; } catch (e) { } }
}
function eff() {
  const g = X.st.grant, c = X.st.cfg;
  return { cfg: { ...DEFAULT_CFG, ...(c?.cfg || {}), ...(g?.cfg || {}) }, role: g?.role ?? c?.role ?? null, ads: [...(c?.ads || []), ...(g?.ads || [])], req: [...(c?.req || []), ...(g?.req || [])], g };
}
function status() {
  if (X.owner) return { k: 'owner' };
  const E = eff(), g = E.g, now = nowMs();
  if (g) {
    if (g.plan === 'blocked') return { k: 'blocked' };
    if (g.exp && now > Date.parse(g.exp)) return { k: 'expired', why: 'grant' };
    if (g.plan === 'trial') return { k: 'trial', left: g.exp ? Math.ceil((Date.parse(g.exp) - now) / 864e5) : null };
    return { k: 'active', left: g.exp ? Math.ceil((Date.parse(g.exp) - now) / 864e5) : null, plan: g.plan };
  }
  if (E.cfg.enforce) { const left = Math.ceil((X.firstRun + E.cfg.trialDays * 864e5 - now) / 864e5); return left > 0 ? { k: 'trial', left } : { k: 'expired', why: 'trial' }; }
  return { k: 'open' };
}
window.packAllows = p => { if (X.owner) return true; const r = eff().role; return r && r.perms ? r.perms.includes(p) : true; };
const stLabel2 = s => ({ owner: 'حالت مالک', open: 'بدون محدودیت', trial: 'دوره آزمایشی', active: 'اشتراک فعال', expired: 'مهلت تمام شده', blocked: 'مسدود' }[s.k]);

/* ---------- کد درخواست و اعمال کد مجوز ---------- */
async function makeRequest(kind, f) {
  const info = (me && me.info) || {};
  const o = { t: 'req', k: kind, dev: await deviceId(), name: f.name || me?.name || '', phone: f.phone || info.phone || '', ref: f.ref || '', text: f.text || '', info, at: new Date().toISOString() };
  return 'HBR.' + b64u.enc(enc.encode(JSON.stringify(o)));
}
async function applyCode(code) {
  const p = await verifyPack(code), did = await deviceId();
  if (p.dev !== did && p.dev !== '*') throw new Error('این کد برای دستگاه دیگری ساخته شده است.');
  const slot = p.dev === '*' ? 'cfg' : 'grant', ms = (await getMeta('maxSeq')) || {};
  if ((ms[slot] || 0) >= p.seq) throw new Error('این کد قبلاً اعمال شده یا قدیمی‌تر از کد فعلی است.');
  ms[slot] = p.seq; await setMeta('maxSeq', ms); await setMeta(slot === 'cfg' ? 'configCode' : 'grantCode', String(code).replace(/\s+/g, ''));
  await loadState(); await log('اعمال کد مجوز', '', '', slot);
  return p;
}

/* ---------- صفحه مجوز و اشتراک ---------- */
function payBlock(E) {
  const c = E.cfg; if (!c.price && !c.card && !c.payText) return '';
  return `<h3>پرداخت اشتراک</h3><dl class="facts">${c.price ? `<div><dt>مبلغ اشتراک</dt><dd>${esc(c.price)}</dd></div>` : ''}${c.card ? `<div><dt>شماره کارت</dt><dd dir="ltr">${esc(c.card)}</dd></div>` : ''}${c.holder ? `<div><dt>به نام</dt><dd>${esc(c.holder)}</dd></div>` : ''}</dl>${c.payText ? `<p>${esc(c.payText)}</p>` : ''}`;
}
async function licenseBody(lock) {
  const st = status(), E = eff(), did = await deviceId(), x = ui.x || (ui.x = {});
  let h = `<dl class="facts"><div><dt>وضعیت</dt><dd>${stLabel2(st)}${st.left != null ? ` (${faDigits(Math.max(st.left, 0))} روز مانده)` : ''}</dd></div>${E.role ? `<div><dt>نقش</dt><dd>${esc(E.role.name || '')}</dd></div>` : ''}<div><dt>شناسه این دستگاه</dt><dd dir="ltr">${esc(did)}</dd></div></dl>
  <button class="btn alt sm" data-act="xCopy" data-v="${esc(did)}">کپی شناسه دستگاه</button>`;
  if (x.reqOut) return h + `<div class="ok">درخواست شما آماده است. کد زیر را برای مالک برنامه بفرستید تا پس از بررسی، کد مجوز را برای شما بسازد.</div><textarea readonly rows="4" class="code" id="reqout">${esc(x.reqOut)}</textarea><button class="btn" data-act="xCopy" data-v="${esc(x.reqOut)}">کپی کد درخواست</button><button class="btn alt" data-act="xShare" data-v="${esc(x.reqOut)}" data-n="request.txt">ارسال به‌صورت فایل</button><button class="btn alt" data-act="xReqDone">بازگشت</button>${applyBox()}`;
  if (x.req) return h + `<h3>${x.req === 'pay' ? 'ارسال رسید پرداخت' : 'درخواست استفاده بدون پرداخت'}</h3>${x.req === 'free' ? `<p>${esc(E.cfg.requestText)}</p>` : payBlock(E)}<form id="xr" onsubmit="return false"><label>نام و نام خانوادگی</label><input type="text" name="name" value="${esc(me?.name || '')}"><label>شماره تماس</label><input type="text" name="phone" inputmode="tel" value="${esc(me?.info?.phone || '')}">${x.req === 'pay' ? '<label>شماره پیگیری یا ۴ رقم آخر کارت پرداخت‌کننده</label><input type="text" name="ref">' : ''}<label>${x.req === 'pay' ? 'توضیحات (اختیاری)' : 'درخواست و دلیل شما'}</label><input type="text" name="text"></form><button class="btn" data-act="xMakeReq">ساخت کد درخواست</button><button class="btn alt" data-act="xReqDone">انصراف</button>`;
  if (lock || st.k === 'trial' || st.k === 'open' || st.k === 'expired' || st.k === 'blocked') h += payBlock(E);
  if (st.k !== 'active' && st.k !== 'owner') h += `<button class="btn" data-act="xStartReq" data-k="pay">پرداخت انجام شد؛ ارسال رسید</button><button class="btn alt" data-act="xStartReq" data-k="free">درخواست استفاده بدون پرداخت</button>`;
  return h + applyBox();
}
const applyBox = () => `<h3>کد مجوز دارید؟</h3><textarea id="xcode" rows="3" class="code" placeholder="کد را اینجا بچسبانید"></textarea><button class="btn" data-act="xApply">اعمال کد</button><input type="file" id="xcf" accept=".txt,text/plain" style="display:none" data-change="xCodeFile"><button class="btn alt" data-act="xPickCode">انتخاب فایل کد</button><div id="xmsg"></div>`;
async function lockScreen(st) {
  const title = st.k === 'blocked' ? 'دسترسی شما به برنامه مسدود شده است' : (st.why === 'grant' ? 'مدت اشتراک شما تمام شده است' : 'دوره آزمایشی رایگان تمام شده است');
  $('#app').innerHTML = authShell(`<div class="err">${title}</div>${await licenseBody(true)}`);
}

/* ---------- تبلیغ درون‌برنامه‌ای ---------- */
async function adTick() {
  if (document.hidden || !me) return; X.used += 15; X.lastSeen = Math.max(X.lastSeen || 0, Date.now());
  if (X.used % 60 === 0) { await setMeta('usageSec', X.used); await setMeta('lastSeen', X.lastSeen); }
  if (X.adOpen || /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.nodeName || '')) return;
  const ads = eff().ads; if (!ads.length) return; const S = (await getMeta('adState')) || {};
  for (const ad of ads) { const s = S[ad.id]; if ((!s && X.used >= (ad.after || 0) * 60) || (s && ad.every > 0 && X.used - s.at >= ad.every * 60)) { S[ad.id] = { at: X.used, n: (s?.n || 0) + 1 }; await setMeta('adState', S); return showAd(ad); } }
}
function showAd(ad) {
  X.adOpen = true; const d = document.createElement('div'); d.className = 'sheet adsheet'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true');
  d.innerHTML = `<div class="card">${ad.img ? `<img src="${esc(ad.img)}" alt="">` : ''}<div class="adtag">تبلیغ</div><h2>${esc(ad.title || '')}</h2><p>${esc(ad.text || '')}</p><button class="btn sheetbtn" disabled>بستن (۵)</button></div>`;
  document.body.appendChild(d); const b = d.querySelector('button'); let n = 5; const iv = setInterval(() => { n--; if (n > 0) b.textContent = tr('بستن') + ' (' + n + ')'; else { clearInterval(iv); b.disabled = false; b.textContent = tr('بستن'); } }, 1000);
  b.onclick = () => { d.remove(); X.adOpen = false; }; translateDom(d);
}

/* ---------- اطلاعات تکمیلی هنگام ورود ---------- */
function pendingFields() {
  if (!me || X.owner) return []; const have = me.info || {}, seen = new Set(), out = [];
  for (const f of [...eff().req, ...(me.reqFields || [])]) { if (!f || seen.has(f.k)) continue; seen.add(f.k); if (!String(have[f.k] || '').trim()) out.push(f); }
  return out;
}
function infoScreen(err) {
  const fs = pendingFields();
  $('#app').innerHTML = authShell(`<p>برای ادامه، اطلاعات زیر را وارد کنید.</p><p class="s">${esc(eff().cfg.infoText || '')}</p>${err ? `<div class="err">${esc(err)}</div>` : ''}<form id="xinfo" onsubmit="return false">${fs.map(f => `<label>${esc(FIELD_DEFS[f.k] || f.l || f.k)}</label><input type="text" name="${esc(f.k)}" ${f.k === 'email' ? 'inputmode="email" dir="ltr"' : /phone|landline|nid/.test(f.k) ? 'inputmode="tel"' : ''}>`).join('')}</form><button class="btn" data-act="xSaveInfo">ذخیره و ادامه</button>`);
}

/* ---------- امضا (فقط مالک) ---------- */
async function wrapKey(pw, salt) { const k = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveKey']); return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 200000, hash: 'SHA-256' }, k, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']); }
async function ownerImport(text, pw) {
  const o = JSON.parse(text); if (o.app !== 'hesabdar-baha-owner' || !o.key) throw new Error('این فایل، کلید مالک نیست.');
  if (o.key.x !== OWNER_PUB.x || o.key.y !== OWNER_PUB.y) throw new Error('این کلید با این نسخه از برنامه جور نیست.');
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await wrapKey(pw, salt), enc.encode(JSON.stringify(o.key)));
  await setMeta('ownerKey', { salt: b64u.enc(salt), iv: b64u.enc(iv), ct: b64u.enc(ct) }); await loadState();
}
async function ownerSign(payload) {
  const pw = prompt('گذرواژه کلید مالک را وارد کنید:'); if (!pw) throw new Error('لغو شد.');
  const k = await getMeta('ownerKey'); let jwk;
  try { jwk = JSON.parse(dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64u.dec(k.iv) }, await wrapKey(pw, b64u.dec(k.salt)), b64u.dec(k.ct)))); } catch (e) { throw new Error('گذرواژه کلید درست نیست.'); }
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const body = b64u.enc(enc.encode(JSON.stringify(payload))), sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, b64u.dec(body));
  return 'HB1.' + body + '.' + b64u.enc(sig);
}

/* ---------- صفحه‌های ابزار مالک و نقش‌ها ---------- */
const XP = {};
const rowBtn = (act, t, s, extra = '') => `<button class="row" data-act="${act}" ${extra}><span class="t">${t}${s ? `<span class="s">${s}</span>` : ''}</span><span class="c">‹</span></button>`;
const xback = (p, t) => `<button class="back" data-act="${p ? 'xgo' : 'backPage'}" ${p ? `data-p="${p}"` : ''}>‹ ${t || 'بازگشت'}</button>`;
XP.license = async () => `${xback()}<h2>مجوز و اشتراک</h2>${await licenseBody(false)}
  ${X.owner ? '' : `<h3>مالک برنامه</h3>${rowBtn('xgo', 'ورود مالک با فایل کلید', '', 'data-p="ownerLogin"')}`}`;
XP.ownerLogin = async () => `${xback('license')}<h2>ورود مالک</h2><p>فایل کلید مالک (owner-key.json) را انتخاب کنید و یک گذرواژه برای نگهداری امن آن بگذارید. این گذرواژه را هر بار هنگام ساخت کد می‌پرسیم.</p><input type="file" id="okf" accept=".json,application/json"><label>گذرواژه کلید (حداقل ۶ نویسه)</label><input type="password" id="okpw"><button class="btn" data-act="xOwnerImport">ورود</button><div id="xmsg"></div>`;
XP.owner = async () => !X.owner ? denied() : `${xback()}<h2>ابزار مالک</h2><p class="warn">کدهای ساخته‌شده با کلید شما امضا می‌شوند و فقط روی دستگاه مقصد کار می‌کنند.</p>
  ${rowBtn('xgo', 'ساخت کد مجوز یا تنظیمات', 'برای یک کاربر مشخص یا همه کاربران', 'data-p="issue"')}
  ${rowBtn('xgo', 'درخواست‌های رسیده', 'بررسی کد درخواست کاربر', 'data-p="reqs"')}
  ${rowBtn('xgo', 'تبلیغات', 'ساخت و ویرایش تبلیغ‌ها', 'data-p="ads"')}
  ${rowBtn('xgo', 'نقش‌ها و قالب‌های آماده', 'بازرس، انباردار و نقش‌های اختصاصی', 'data-p="roles"')}
  ${rowBtn('xgo', 'پرداخت و متن درخواست (پیش‌فرض)', 'مبلغ، شماره کارت، متن صفحه درخواست', 'data-p="pay"')}
  <button class="btn bad" data-act="xOwnerOut">خروج از حالت مالک</button>`;
XP.pay = async () => { const c = { ...DEFAULT_CFG, ...((await getMeta('ownCfg')) || {}) }; return `${xback('owner')}<h2>پرداخت و متن درخواست</h2><p>این مقادیر در هر کدی که می‌سازید قرار می‌گیرند و هر زمان می‌توانید دوباره عوض کنید.</p><form id="xf" onsubmit="return false"><label>مبلغ اشتراک (با واحد)</label><input type="text" name="price" value="${esc(c.price)}"><label>شماره کارت</label><input type="text" name="card" inputmode="numeric" value="${esc(c.card)}"><label>نام صاحب کارت</label><input type="text" name="holder" value="${esc(c.holder)}"><label>توضیح پرداخت</label><input type="text" name="payText" value="${esc(c.payText)}"><label>متن صفحه «درخواست بدون پرداخت»</label><input type="text" name="requestText" value="${esc(c.requestText)}"><label>توضیح دلیل درخواست اطلاعات از کاربر</label><input type="text" name="infoText" value="${esc(c.infoText)}"><label>روزهای دوره آزمایشی رایگان</label><input type="text" name="trialDays" inputmode="numeric" value="${esc(c.trialDays)}"></form><button class="btn" data-act="xSavePay">ذخیره</button>`; };
XP.ads = async () => { const L = (await getMeta('ownAds')) || []; return `${xback('owner')}<h2>تبلیغات</h2>${L.map(a => rowBtn('xAdEdit', esc(a.title), `بعد از ${faDigits(a.after)} دقیقه${a.every ? ` – تکرار هر ${faDigits(a.every)} دقیقه` : ' – یک بار'}`, `data-id="${a.id}"`)).join('') || '<div class="empty">هنوز تبلیغی نساخته‌اید.</div>'}<button class="fab" data-act="xAdEdit" data-id="">+ تبلیغ جدید</button>`; };
XP.ad = async () => { const L = (await getMeta('ownAds')) || [], a = L.find(x => x.id === ui.x.adId) || { after: 10, every: 0 }; return `${xback('ads')}<h2>${a.id ? 'ویرایش تبلیغ' : 'تبلیغ جدید'}</h2><form id="xf" onsubmit="return false"><label>عنوان</label><input type="text" name="title" value="${esc(a.title || '')}"><label>متن تبلیغ</label><input type="text" name="text" value="${esc(a.text || '')}"><label>نمایش پس از چند دقیقه استفاده</label><input type="text" name="after" inputmode="numeric" value="${esc(a.after)}"><label>تکرار هر چند دقیقه (۰ یعنی فقط یک بار)</label><input type="text" name="every" inputmode="numeric" value="${esc(a.every)}"><label>تصویر (اختیاری)</label><input type="file" id="adimg" accept="image/*">${a.img ? `<img class="thumb" src="${esc(a.img)}" alt=""><label class="chk"><input type="checkbox" name="rmimg"> حذف تصویر</label>` : ''}</form><button class="btn" data-act="xAdSave">ذخیره</button>${a.id ? '<button class="btn bad" data-act="xAdDel">حذف تبلیغ</button>' : ''}`; };
XP.roles = async () => { if (!can('users')) return denied(); const R = await allRoles(); return `${xback(X.owner ? 'owner' : null)}<h2>نقش‌ها و قالب‌های آماده</h2><p>هر نقش مجموعه‌ای از دسترسی‌هاست. هنگام ساخت کاربر، نقش را انتخاب کنید؛ دسترسی‌های آن از پیش تیک می‌خورد و می‌توانید موارد بیشتری هم بدهید.</p>${Object.entries(R).map(([k, r]) => rowBtn(r.custom ? 'xRoleEdit' : 'xRoleView', esc(r.name) + (r.custom ? '' : '<span class="badge">آماده</span>'), esc(r.note || ''), `data-id="${k}"`)).join('')}<button class="fab" data-act="xRoleEdit" data-id="">+ نقش جدید</button>`; };
XP.role = async () => { const R = await allRoles(), r = ui.x.roleId ? R[ui.x.roleId] : { name: '', perms: ['view'] }, ro = r && !r.custom && ui.x.roleId; return `${xback('roles')}<h2>${ro ? esc(r.name) : ui.x.roleId ? 'ویرایش نقش' : 'نقش جدید'}</h2><form id="xf" onsubmit="return false"><label>نام نقش</label><input type="text" name="name" value="${esc(r.name)}" ${ro ? 'disabled' : ''}>${Object.entries(PERMS).map(([k, t]) => `<label class="chk"><input type="checkbox" name="p_${k}" ${r.perms.includes(k) ? 'checked' : ''} ${ro ? 'disabled' : ''}> ${t}</label>`).join('')}</form>${ro ? '' : `<button class="btn" data-act="xRoleSave">ذخیره</button>${ui.x.roleId ? '<button class="btn bad" data-act="xRoleDel">حذف نقش</button>' : ''}`}`; };
XP.reqs = async () => { const x = ui.x, r = x.reqView; return `${xback('owner')}<h2>درخواست‌های رسیده</h2><label>کد درخواست کاربر را بچسبانید</label><textarea id="xcode" rows="3" class="code"></textarea><button class="btn" data-act="xReqRead">نمایش درخواست</button><div id="xmsg"></div>${r ? `<h3>مشخصات درخواست</h3><dl class="facts"><div><dt>نام</dt><dd>${esc(r.name)}</dd></div><div><dt>تلفن</dt><dd dir="ltr">${esc(r.phone)}</dd></div><div><dt>نوع</dt><dd>${r.k === 'pay' ? 'ارسال رسید پرداخت' : 'درخواست بدون پرداخت'}</dd></div>${r.ref ? `<div><dt>شماره پیگیری</dt><dd>${esc(r.ref)}</dd></div>` : ''}<div><dt>توضیح</dt><dd>${esc(r.text)}</dd></div><div><dt>شناسه دستگاه</dt><dd dir="ltr">${esc(r.dev)}</dd></div>${Object.entries(r.info || {}).map(([k, v]) => `<div><dt>${esc(FIELD_DEFS[k] || k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl><button class="btn" data-act="xIssueFor">ساخت کد مجوز برای این کاربر</button>` : ''}`; };
XP.issue = async () => {
  const x = ui.x, I = x.issue || (x.issue = {}), own = { ...DEFAULT_CFG, ...((await getMeta('ownCfg')) || {}) }, ads = (await getMeta('ownAds')) || [], R = await allRoles();
  const all_ = I.dev === '*';
  return `${xback('owner')}<h2>ساخت کد مجوز</h2><form id="xf" onsubmit="return false">
  <label>برای چه کسی؟</label><select name="to"><option value="dev" ${all_ ? '' : 'selected'}>یک دستگاه مشخص</option><option value="*" ${all_ ? 'selected' : ''}>همه کاربران (تنظیمات عمومی)</option></select>
  <label>شناسه دستگاه کاربر</label><input type="text" name="dev" dir="ltr" value="${esc(all_ ? '' : I.dev || '')}"><label>نام کاربر (برای یادداشت)</label><input type="text" name="name" value="${esc(I.name || '')}">
  <h3>وضعیت دسترسی (فقط برای دستگاه مشخص)</h3><select name="plan"><option value="paid">اشتراک فعال</option><option value="trial">دوره آزمایشی</option><option value="unlimited">نامحدود</option><option value="blocked">مسدود</option></select>
  <label>اعتبار به روز (خالی یعنی بدون انقضا)</label><input type="text" name="days" inputmode="numeric" value="30">
  <label>نقش</label><select name="role"><option value="">بدون محدودیت نقش</option>${Object.entries(R).map(([k, r]) => `<option value="${k}">${esc(r.name)}</option>`).join('')}</select>
  <h3>محدودیت عمومی (فقط برای «همه کاربران»)</h3><label class="chk"><input type="checkbox" name="enforce"> کاربرانی که کد ندارند بعد از دوره آزمایشی قفل شوند</label><label>روز آزمایشی رایگان</label><input type="text" name="trialDays" inputmode="numeric" value="${esc(own.trialDays)}">
  <h3>تبلیغ‌ها</h3>${ads.map(a => `<label class="chk"><input type="checkbox" name="ad_${a.id}"> ${esc(a.title)}</label>`).join('') || '<p class="empty">تبلیغی نیست.</p>'}
  <h3>اطلاعات الزامی هنگام ورود</h3>${Object.entries(FIELD_DEFS).map(([k, t]) => `<label class="chk"><input type="checkbox" name="rf_${k}"> ${t}</label>`).join('')}<label>فیلد دلخواه (نام فیلد)</label><input type="text" name="custom">
  </form><button class="btn" data-act="xIssueMake">ساخت کد</button>${x.out ? `<div class="ok">کد ساخته شد. آن را برای کاربر بفرستید.</div><textarea readonly rows="5" class="code">${esc(x.out)}</textarea><button class="btn" data-act="xCopy" data-v="${esc(x.out)}">کپی کد</button><button class="btn alt" data-act="xShare" data-v="${esc(x.out)}" data-n="license.txt">ارسال به‌صورت فایل</button>` : ''}`;
};
async function xPage(p) {
  if (XP[p]) return XP[p]();
  return denied();
}
