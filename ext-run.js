'use strict';
/* حسابدار بهای تمام‌شده - افزونه‌ها (بخش ۲): کنش‌ها، تصویر، گاوصندوق، راهنما، اتصال به برنامه */
const delMeta = id => rq(os('meta', 'readwrite').delete(id));
const msg = (t, bad) => { const m = $('#xmsg'); if (m) m.innerHTML = `<div class="${bad ? 'err' : 'ok'}">${esc(t)}</div>`; translateDom(); };
const formObj = f => Object.fromEntries([...f.elements].filter(e => e.name).map(e => [e.name, e.type === 'checkbox' ? e.checked : e.value]));
const readText = f => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = no; r.readAsText(f); });
async function toDataUrl(file, max, q) {
  const bmp = await createImageBitmap(file), s = Math.min(1, max / Math.max(bmp.width, bmp.height)), cv = document.createElement('canvas');
  cv.width = Math.round(bmp.width * s); cv.height = Math.round(bmp.height * s); const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(bmp, 0, 0, cv.width, cv.height);
  return cv.toDataURL('image/jpeg', q);
}
const copyText = async t => { try { await navigator.clipboard.writeText(t); } catch (e) { const a = document.createElement('textarea'); a.value = t; document.body.appendChild(a); a.select(); document.execCommand('copy'); a.remove(); } toast('کپی شد'); };
const pad6 = n => String(n).padStart(6, '0');
const humanSize = n => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';

/* ---------- قفل شدن پس از تلاش ناموفق ---------- */
async function failLeft(k) { const f = ((await getMeta('fails')) || {})[k]; return f && Date.now() < f.until ? Math.ceil((f.until - Date.now()) / 1000) : 0; }
async function failHit(k) { const F = (await getMeta('fails')) || {}, f = F[k] || { n: 0, until: 0 }; f.n++; if (f.n >= 5) f.until = Date.now() + Math.min(900, 30 * 2 ** (f.n - 5)) * 1000; F[k] = f; await setMeta('fails', F); }
async function failClear(k) { const F = (await getMeta('fails')) || {}; delete F[k]; await setMeta('fails', F); }

/* ---------- تصویر برای رکوردها ---------- */
const photoOf = async id => (await all('files')).find(f => f.kind === 'photo' && f.ownerId === id && !f.voided);
async function setPhoto(ownerId, data, store) {
  const old = await photoOf(ownerId), now = new Date().toISOString();
  if (!data) { if (old) await rq(os('files', 'readwrite').delete(old.id)); return; }
  await put('files', { ...(old || { id: uid(), createdAt: now }), kind: 'photo', ownerId, store, companyId: company?.id || null, data, updatedAt: now, syncStatus: 'pending', voided: false });
}
async function photoBox(ownerId) {
  const p = ownerId ? await photoOf(ownerId) : null, src = p?.data || ui.pendingPhoto || '';
  return `<h3>تصویر</h3><div class="photo" id="pbox">${src ? `<img class="thumb" src="${src}" alt="تصویر ثبت‌شده">` : '<div class="empty">تصویری ثبت نشده است.</div>'}</div><input type="file" id="pfile" accept="image/*" data-xch="xpfile" data-owner="${ownerId || ''}" data-store="${ui.tab === 'users' ? 'users' : ui.ent || ''}"><button class="btn alt sm" data-act="xRmPhoto" data-owner="${ownerId || ''}">حذف تصویر</button>`;
}

/* ---------- گاوصندوق ---------- */
const VKEY = () => 'vaultCfg:' + company.id;
async function kdf(pw, salt, it) { const k = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveKey']); return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: it, hash: 'SHA-256' }, k, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']); }
const aes = raw => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
async function vaultCreate(pw) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12)), master = crypto.getRandomValues(new Uint8Array(32)), it = 200000;
  const wrapped = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await kdf(pw, salt, it), master);
  await setMeta(VKEY(), { salt: b64u.enc(salt), iv: b64u.enc(iv), wrapped: b64u.enc(wrapped), it, at: new Date().toISOString() });
  X.vaultRaw = master; X.vaultKey = await aes(master); X.vaultCo = company.id;
}
async function vaultOpen(pw) {
  const c = await getMeta(VKEY());
  const master = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64u.dec(c.iv) }, await kdf(pw, b64u.dec(c.salt), c.it), b64u.dec(c.wrapped)));
  X.vaultRaw = master; X.vaultKey = await aes(master); X.vaultCo = company.id; X.vcache = null;
}
const vaultLock = () => { X.vaultKey = null; X.vaultRaw = null; X.vcache = null; X.vaultCo = null; if (X.vurl) { URL.revokeObjectURL(X.vurl); X.vurl = null; } };
const vOk = () => X.vaultKey && X.vaultCo === company?.id;
async function encBytes(u8) { const iv = crypto.getRandomValues(new Uint8Array(12)); return { iv, ct: await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, X.vaultKey, u8) }; }
const decBytes = (iv, ct) => crypto.subtle.decrypt({ name: 'AES-GCM', iv }, X.vaultKey, ct);
const encMeta = async m => { const e = await encBytes(enc.encode(JSON.stringify(m))); return { iv: b64u.enc(e.iv), ct: b64u.enc(e.ct) }; };
const decMeta = async r => JSON.parse(dec.decode(await decBytes(b64u.dec(r.meta.iv), b64u.dec(r.meta.ct))));
const catOf = (mime, name) => /^image\//.test(mime) ? 'photo' : /^video\//.test(mime) ? 'video' : /^audio\//.test(mime) ? 'audio' : /pdf|word|excel|sheet|powerpoint|presentation|text|opendocument|csv|rtf/.test(mime) || /\.(pdf|docx?|xlsx?|pptx?|txt|csv)$/i.test(name) ? 'doc' : 'other';
const CAT = { photo: ['🖼️', 'عکس'], video: ['🎬', 'فیلم'], audio: ['🎧', 'صدا'], doc: ['📄', 'سند'], other: ['📎', 'سایر'] };
async function gzip(blob) { return new Response(blob.stream().pipeThrough(new CompressionStream('gzip'))).blob(); }
async function gunzip(blob) { return new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).blob(); }
async function vaultAdd(file) {
  const P = X.prefs, fid = uid(); let blob = file, mime = file.type || 'application/octet-stream', name = file.name || 'file', gz = false, opt = false;
  if (P.optImg && /^image\/(jpeg|png|webp)$/.test(mime) && file.size > 300000) {
    try { const d = await toDataUrl(file, 4096, 0.92), b = await (await fetch(d)).blob(); if (b.size < file.size * 0.92) { blob = b; mime = 'image/jpeg'; name = name.replace(/\.\w+$/, '') + '.jpg'; opt = true; } } catch (e) { }
  }
  if (P.compress && typeof CompressionStream !== 'undefined' && blob.size < 120 * 1048576 && !/^(video|audio\/(mpeg|mp4|aac|ogg))/.test(mime) && !/^image\/(jpeg|png|webp|gif|heic)/.test(mime) && !/\.(zip|rar|7z|gz|docx|xlsx|pptx|mp4|mkv|apk)$/i.test(name)) {
    try { const g = await gzip(blob); if (g.size < blob.size * 0.95) { blob = g; gz = true; } } catch (e) { }
  }
  const CH = 2 * 1048576; let n = 0;
  for (let o = 0; o < blob.size || n === 0; o += CH, n++) { const buf = new Uint8Array(await blob.slice(o, o + CH).arrayBuffer()), e = await encBytes(buf); await put('fileChunks', { id: fid + ':' + pad6(n), fileId: fid, i: n, iv: e.iv, ct: e.ct }); if (blob.size === 0) { n++; break; } }
  const meta = { name, mime, size: file.size, stored: blob.size, gz, opt, cat: catOf(mime, name), at: new Date().toISOString() };
  await put('files', { id: fid, kind: 'vault', companyId: company.id, createdAt: meta.at, n, meta: await encMeta(meta) });
  await log('افزودن به گاوصندوق', 'files', fid, '');
  return meta;
}
async function vaultBlob(id) {
  const r = await get('files', id), m = await decMeta(r), chunks = await rq(os('fileChunks').getAll(IDBKeyRange.bound(id + ':', id + ':\uffff'))), parts = [];
  chunks.sort((a, b) => a.i - b.i); for (const c of chunks) parts.push(new Uint8Array(await decBytes(c.iv, c.ct)));
  let b = new Blob(parts, { type: m.mime }); if (m.gz) b = new Blob([await gunzip(b)], { type: m.mime });
  return { blob: b, meta: m };
}
async function vaultList() {
  if (X.vcache) return X.vcache; const L = [];
  for (const r of (await all('files')).filter(f => f.kind === 'vault' && f.companyId === company.id)) { try { L.push({ r, m: await decMeta(r) }); } catch (e) { } }
  L.sort((a, b) => b.r.createdAt.localeCompare(a.r.createdAt)); return X.vcache = L;
}
async function vaultView() {
  if (!company) return `<div class="empty">ابتدا یک شرکت بسازید.</div>`;
  const cfg = await getMeta(VKEY()), x = ui.x || (ui.x = {}); const left = await failLeft('v');
  if (!cfg) return `<h2>گاوصندوق فایل‌ها</h2><p>اسناد، عکس‌ها و فیلم‌های مهم این شرکت را با رمز در همین برنامه نگه دارید. فایل‌ها رمزنگاری می‌شوند، جای دیگری از گوشی دیده نمی‌شوند و بدون اینترنت قابل استخراج‌اند.</p><div class="warn">اگر گذرواژه را فراموش کنید، راهی برای بازیابی فایل‌ها نیست.</div><form id="vf" onsubmit="return false"><label>گذرواژه گاوصندوق (حداقل ۶ نویسه)</label><input type="password" name="pw" autocomplete="off"><label>تکرار گذرواژه</label><input type="password" name="pw2" autocomplete="off"></form><div id="xmsg"></div><button class="btn" data-act="xVSetup">ساخت گاوصندوق</button>`;
  if (!vOk()) return `<h2>گاوصندوق فایل‌ها</h2><p>برای ورود، گذرواژه گاوصندوق را وارد کنید.</p>${left ? `<div class="err">تلاش‌های ناموفق زیاد بود؛ ${faDigits(left)} ثانیه دیگر دوباره تلاش کنید.</div>` : ''}<form id="vf" onsubmit="return false"><input type="password" name="pw" autocomplete="off" aria-label="گذرواژه گاوصندوق"></form><div id="xmsg"></div><button class="btn" data-act="xVOpen">ورود</button>`;
  const L = await vaultList(), cat = x.vcat || 'all', q = (x.vq || '').trim().toLowerCase();
  if (x.vopen) { const it = L.find(i => i.r.id === x.vopen); if (it) return vaultDetail(it); x.vopen = null; }
  const shown = L.filter(i => (cat === 'all' || i.m.cat === cat) && (!q || i.m.name.toLowerCase().includes(q)));
  const tot = L.reduce((a, i) => a + i.m.stored, 0), orig = L.reduce((a, i) => a + i.m.size, 0);
  return `<h2>گاوصندوق فایل‌ها</h2><div class="secure">
  <dl class="facts"><div><dt>تعداد فایل</dt><dd>${faDigits(L.length)}</dd></div><div><dt>حجم اصلی ← حجم ذخیره‌شده</dt><dd>${faDigits(humanSize(orig))} ← ${faDigits(humanSize(tot))}</dd></div></dl>
  <input type="text" id="vq" placeholder="جستجوی نام فایل" value="${esc(x.vq || '')}" data-xch="xvq">
  <div class="chips">${['all', ...Object.keys(CAT)].map(k => `<button class="chip ${cat === k ? 'on' : ''}" data-act="xVCat" data-c="${k}">${k === 'all' ? 'همه' : CAT[k][1]}</button>`).join('')}</div>
  ${shown.map(i => `<button class="row" data-act="xVOpenFile" data-id="${i.r.id}"><span class="t">${CAT[i.m.cat][0]} ${esc(i.m.name)}<span class="s">${faDigits(humanSize(i.m.size))}${i.m.stored < i.m.size ? ` ← ${faDigits(humanSize(i.m.stored))}` : ''} – ${esc(fmtDate(i.m.at))}</span></span><span class="c">‹</span></button>`).join('') || '<div class="empty">فایلی نیست.</div>'}
  </div><input type="file" id="vfile" multiple style="display:none" data-xch="xvfile">
  <button class="fab" data-act="xVPick">+ افزودن فایل</button>
  <h3>تنظیمات گاوصندوق</h3>
  <label class="chk"><input type="checkbox" data-xch="xpref" data-k="compress" ${X.prefs.compress ? 'checked' : ''}> فشرده‌سازی بی‌افت (gzip) برای سندها و فایل‌های قابل فشرده‌سازی</label>
  <label class="chk"><input type="checkbox" data-xch="xpref" data-k="optImg" ${X.prefs.optImg ? 'checked' : ''}> بهینه‌سازی عکس‌های سنگین (کیفیت ۹۲٪، تقریباً بدون افت دیدنی)</label>
  <label class="chk"><input type="checkbox" data-xch="xpref" data-k="hideVault" ${X.prefs.hideVault ? 'checked' : ''}> پنهان کردن تب گاوصندوق (ورود: در «بیشتر» روی شماره نسخه ۵ بار بزنید)</label>
  <button class="btn alt" data-act="xVLock">قفل کردن گاوصندوق</button><button class="btn alt" data-act="xVPw">تغییر گذرواژه گاوصندوق</button><div id="xmsg"></div>`;
}
function vaultDetail(it) {
  const m = it.m; return `<button class="back" data-act="xVBack">‹ بازگشت</button><div class="secure"><h2>${CAT[m.cat][0]} ${esc(m.name)}</h2>
  <dl class="facts"><div><dt>حجم اصلی</dt><dd>${faDigits(humanSize(m.size))}</dd></div><div><dt>حجم ذخیره‌شده</dt><dd>${faDigits(humanSize(m.stored))}</dd></div><div><dt>روش</dt><dd>${m.gz ? 'فشرده‌سازی بی‌افت' : m.opt ? 'بهینه‌سازی تصویر' : 'بدون تغییر'}</dd></div><div><dt>تاریخ افزودن</dt><dd>${esc(fmtDate(m.at))}</dd></div></dl>
  <div id="vprev"></div>${m.cat === 'photo' ? '<button class="btn alt" data-act="xVShow">نمایش داخل برنامه</button>' : ''}
  <button class="btn" data-act="xVExtract">استخراج و ذخیره یا ارسال (بدون اینترنت)</button><button class="btn alt" data-act="xVRename">تغییر نام</button><button class="btn bad" data-act="xVDel">حذف از گاوصندوق</button></div>`;
}

/* ---------- راهنمای صفحه‌ها (مثل پیام‌رسان‌ها) ---------- */
const TIPS = {
  welcome: [['به برنامه خوش آمدید', 'این برنامه بهای تمام‌شده، انبار، خرید، فروش و تولید شما را ثبت و محاسبه می‌کند. همه‌چیز روی همین گوشی ذخیره می‌شود و بدون اینترنت کار می‌کند.'], ['منوی پایین', 'خانه، عملیات روزانه، اطلاعات پایه، پشتیبان و بیشتر را از نوار پایین باز کنید.'], ['راهنمای هر صفحه', 'در هر صفحه دکمه «؟» بالای صفحه راهنمای همان صفحه را دوباره نشان می‌دهد.'], ['شروع سریع', 'ابتدا در «اطلاعات پایه» واحدها، کالاها و انبارها را تعریف کنید، بعد در «عملیات» خرید و تولید ثبت کنید.']],
  home: [['صفحه خانه', 'خلاصه وضعیت شرکت و تاریخ آخرین بروزرسانی اطلاعات را اینجا می‌بینید.'], ['شرکت فعال', 'اگر چند شرکت دارید، از انتخابگر بالای صفحه شرکت را عوض کنید؛ اطلاعات هر شرکت جداست.']],
  ops: [['عملیات', 'خرید، فروش، فرمول ساخت، سفارش تولید و گزارش‌ها از اینجا باز می‌شوند.'], ['ترتیب پیشنهادی', 'اول کالا و انبار را تعریف کنید، بعد خرید، سپس فرمول ساخت و سفارش تولید.']],
  opsSub: [['ثبت و گزارش', 'فرم‌ها را کامل کنید و ذخیره بزنید. سند ثبت‌شده حذف نمی‌شود؛ با «ابطال» سند معکوس ساخته می‌شود و سابقه می‌ماند.'], ['خروجی', 'اگر دسترسی خروجی دارید، از دکمه‌های Excel و PDF بالای صفحه استفاده کنید.']],
  base: [['اطلاعات پایه', 'کالاها، واحدها، انبارها، مراکز هزینه و شرکت‌ها را اینجا تعریف می‌کنید.'], ['واحدهای آماده', 'واحدهای رایج از قبل ساخته شده‌اند؛ هر واحد دیگری لازم بود خودتان اضافه کنید.']],
  list: [['فهرست', 'روی هر مورد بزنید تا ویرایش شود. دکمه + مورد جدید می‌سازد.'], ['تصویر', 'برای هر مورد می‌توانید عکس بگذارید؛ در فهرست کنار نام نمایش داده می‌شود.']],
  form: [['فرم ثبت', 'فیلدهای ستاره‌دار الزامی‌اند. در پایین فرم می‌توانید تصویر اضافه کنید.']],
  backup: [['پشتیبان‌گیری', 'پیش از حذف برنامه یا عوض کردن گوشی حتماً پشتیبان بگیرید و فایل را جای امن نگه دارید.'], ['گاوصندوق', 'فایل‌های گاوصندوق داخل پشتیبان نیستند؛ مهم‌ترین‌ها را از خود گاوصندوق استخراج کنید.']],
  users: [['کاربران', 'برای هر کس یک کاربر بسازید و نقش مناسب (مثل بازرس یا انباردار) را انتخاب کنید؛ دسترسی‌ها از پیش تیک می‌خورند.'], ['اطلاعات تکمیلی', 'می‌توانید از کاربر بخواهید هنگام ورود شماره تماس یا نشانی خود را وارد کند.']],
  vault: [['گاوصندوق', 'فایل‌ها با گذرواژه‌ی شما رمزنگاری می‌شوند و فقط از داخل همین برنامه دیده می‌شوند.'], ['افزودن و استخراج', 'فایل را اضافه کنید؛ حتی اگر از گوشی پاک شود، هر زمان بدون اینترنت از برنامه استخراج می‌کنید.'], ['فشرده‌سازی', 'سندها بدون هیچ افت کیفیتی کوچک می‌شوند. فیلم‌ها و عکس‌ها به‌طور پیش‌فرض دست‌نخورده می‌مانند.']],
  more: [['بیشتر', 'زبان، دسترسی‌پذیری، مجوز و اشتراک و سابقه رویدادها اینجاست.']],
  'p:x:license': [['مجوز و اشتراک', 'شناسه دستگاه را برای مالک بفرستید و کد مجوز را همین‌جا وارد کنید.']],
  'p:x:owner': [['ابزار مالک', 'برای هر کاربر کد مجوز، نقش، تبلیغ و اطلاعات الزامی بسازید و از طریق پیام‌رسان بفرستید.']]
};
async function showTips(key, force) {
  let steps = TIPS[key] || (/^[a-z]+\+?$/.test(key) && ui.tab === 'ops' ? TIPS.opsSub : null); if (!steps) return;
  const seen = (await getMeta('tipsSeen')) || {}; if (!force && seen[key]) return; if (document.querySelector('.tipsheet') || X.adOpen) return;
  let i = 0; const d = document.createElement('div'); d.className = 'sheet tipsheet'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true');
  const draw = () => { d.innerHTML = `<div class="card"><div class="dots">${steps.map((_, k) => `<span class="${k === i ? 'on' : ''}"></span>`).join('')}</div><h2>${esc(steps[i][0])}</h2><p>${esc(steps[i][1])}</p><div class="tipbtns">${i > 0 ? '<button class="btn alt" data-t="prev">قبلی</button>' : ''}<button class="btn" data-t="next">${i < steps.length - 1 ? 'بعدی' : 'متوجه شدم'}</button></div><button class="skip" data-t="skip">رد کردن</button></div>`; translateDom(d); d.querySelector('[data-t=next]').focus(); };
  d.onclick = async e => { const t = e.target.dataset.t; if (!t) return; if (t === 'prev') { i--; draw(); } else if (t === 'next' && i < steps.length - 1) { i++; draw(); } else { d.remove(); seen[key] = 1; await setMeta('tipsSeen', seen); } };
  document.body.appendChild(d); draw();
}

/* ---------- کنش‌ها ---------- */
Object.assign(ACT, {
  xgo: d => { ui.page = 'x:' + d.p; ui.x = ui.x || {}; render(); },
  xCopy: d => copyText(d.v), xShare: d => shareText(d.n, d.v),
  xStartReq: d => { ui.x.req = d.k; ui.x.reqOut = null; render(); },
  xReqDone: () => { ui.x.req = null; ui.x.reqOut = null; render(); },
  xMakeReq: async () => { ui.x.reqOut = await makeRequest(ui.x.req, formObj($('#xr'))); render(); },
  xApply: async () => { try { await applyCode($('#xcode').value); toast('کد مجوز اعمال شد'); render(); } catch (e) { msg(e.message, 1); } },
  xPickCode: () => $('#xcf').click(),
  xOwnerImport: async () => {
    try { const f = $('#okf').files[0], pw = $('#okpw').value; if (!f) throw new Error('فایل کلید را انتخاب کنید.'); if (pw.length < 6) throw new Error('گذرواژه باید حداقل ۶ نویسه باشد.'); await ownerImport(await readText(f), pw); ui.page = 'x:owner'; render(); } catch (e) { msg(e.message, 1); }
  },
  xOwnerOut: async () => { if (!confirm('از حالت مالک خارج شوید؟ برای ورود دوباره، فایل کلید لازم است.')) return; await delMeta('ownerKey'); await loadState(); ui.page = null; render(); },
  xSavePay: async () => { const o = formObj($('#xf')); { const td = parseInt(norm(o.trialDays), 10); o.trialDays = isNaN(td) ? 14 : Math.max(td, 0); } o.card = norm(o.card); await setMeta('ownCfg', o); toast('ذخیره شد'); ui.page = 'x:owner'; render(); },
  xAdEdit: d => { ui.x.adId = d.id || ''; ui.page = 'x:ad'; render(); },
  xAdSave: async () => {
    const o = formObj($('#xf')), L = (await getMeta('ownAds')) || []; if (!o.title.trim()) return toast('عنوان تبلیغ الزامی است.');
    const old = L.find(a => a.id === ui.x.adId), a = { id: old?.id || uid().slice(0, 8), title: o.title.trim(), text: o.text.trim(), after: parseInt(norm(o.after), 10) || 0, every: parseInt(norm(o.every), 10) || 0, img: o.rmimg ? '' : old?.img || '' };
    const f = $('#adimg').files[0]; if (f) a.img = await toDataUrl(f, 480, 0.7);
    await setMeta('ownAds', old ? L.map(x => x.id === a.id ? a : x) : [...L, a]); ui.page = 'x:ads'; render();
  },
  xAdDel: async () => { if (!confirm('این تبلیغ حذف شود؟')) return; await setMeta('ownAds', ((await getMeta('ownAds')) || []).filter(a => a.id !== ui.x.adId)); ui.page = 'x:ads'; render(); },
  xRoleView: d => { ui.x.roleId = d.id; ui.page = 'x:role'; render(); }, xRoleEdit: d => { ui.x.roleId = d.id; ui.page = 'x:role'; render(); },
  xRoleSave: async () => {
    const o = formObj($('#xf')), L = (await getMeta('customRoles')) || []; if (!o.name.trim()) return toast('نام نقش الزامی است.');
    const id = ui.x.roleId ? ui.x.roleId.slice(2) : uid().slice(0, 8), r = { id, name: o.name.trim(), perms: Object.keys(PERMS).filter(k => o['p_' + k]) };
    await setMeta('customRoles', L.some(x => x.id === id) ? L.map(x => x.id === id ? r : x) : [...L, r]); ui.page = 'x:roles'; render();
  },
  xRoleDel: async () => { if (!confirm('این نقش حذف شود؟ کاربرانی که قبلاً ساخته‌اید تغییری نمی‌کنند.')) return; const id = ui.x.roleId.slice(2); await setMeta('customRoles', ((await getMeta('customRoles')) || []).filter(r => r.id !== id)); ui.page = 'x:roles'; render(); },
  xReqRead: async () => { try { const c = $('#xcode').value.replace(/\s+/g, ''); if (!c.startsWith('HBR.')) throw new Error('این کد درخواست نیست.'); ui.x.reqView = JSON.parse(dec.decode(b64u.dec(c.slice(4)))); render(); } catch (e) { msg(e.message || 'کد خراب است.', 1); } },
  xIssueFor: () => { ui.x.issue = { dev: ui.x.reqView.dev, name: ui.x.reqView.name }; ui.x.out = null; ui.page = 'x:issue'; render(); },
  xIssueMake: async () => {
    try {
      const o = formObj($('#xf')), dev = o.to === '*' ? '*' : o.dev.trim().toUpperCase(); if (dev !== '*' && !/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(dev)) return toast('شناسه دستگاه درست نیست.');
      const own = { ...DEFAULT_CFG, ...((await getMeta('ownCfg')) || {}) }, R = await allRoles(), ads = (await getMeta('ownAds')) || [];
      const p = { v: 1, id: uid().slice(0, 8), seq: Date.now(), dev, name: o.name.trim(), at: new Date().toISOString(), cfg: { price: own.price, card: own.card, holder: own.holder, payText: own.payText, requestText: own.requestText, infoText: own.infoText } };
      if (dev === '*') { p.cfg.enforce = !!o.enforce; { const td = parseInt(norm(o.trialDays), 10); p.cfg.trialDays = isNaN(td) ? 14 : Math.max(td, 0); } }
      else { p.plan = o.plan; const d = parseInt(norm(o.days), 10); if (d > 0 && o.plan !== 'unlimited') p.exp = new Date(Date.now() + d * 864e5).toISOString(); }
      if (o.role && R[o.role]) p.role = { name: R[o.role].name, perms: R[o.role].perms };
      p.ads = ads.filter(a => o['ad_' + a.id]).map(a => ({ id: a.id, title: a.title, text: a.text, img: a.img, after: a.after, every: a.every }));
      p.req = Object.keys(FIELD_DEFS).filter(k => o['rf_' + k]).map(k => ({ k })); if (o.custom.trim()) p.req.push({ k: 'c_' + [...enc.encode(o.custom.trim())].reduce((a, b) => (a * 31 + b) >>> 0, 7).toString(36), l: o.custom.trim() });
      ui.x.issue = { dev, name: p.name }; ui.x.out = await ownerSign(p); await log('ساخت کد مجوز', '', '', dev); render();
    } catch (e) { toast(e.message); }
  },
  xSaveInfo: async () => {
    const o = formObj($('#xinfo')), fs = pendingFields(); for (const f of fs) if (!String(o[f.k] || '').trim()) return infoScreen('همه فیلدها را پر کنید.');
    me.info = { ...(me.info || {}), ...Object.fromEntries(fs.map(f => [f.k, o[f.k].trim()])) }; await put('users', me); await log('ثبت اطلاعات تکمیلی', 'users', me.id); render();
  },
  xRmPhoto: async d => { if (d.owner) await setPhoto(d.owner); ui.pendingPhoto = null; const b = $('#pbox'); if (b) b.innerHTML = '<div class="empty">تصویری ثبت نشده است.</div>'; toast('تصویر حذف شد'); },
  xTips: () => showTips(stateKey(), true), xRead: readPage, xXls: exportExcel, xPdf: exportPdf,
  xTap: () => { X.taps = (X.taps || 0) + 1; clearTimeout(X.tapT); X.tapT = setTimeout(() => X.taps = 0, 2500); if (X.taps >= 5) { X.taps = 0; X.reveal = true; ui.tab = 'vault'; ui.page = null; render(); } },
  xVSetup: async () => { const o = formObj($('#vf')); if (o.pw.length < 6) return msg('گذرواژه باید حداقل ۶ نویسه باشد.', 1); if (o.pw !== o.pw2) return msg('گذرواژه و تکرار آن یکسان نیست.', 1); await vaultCreate(o.pw); await log('ساخت گاوصندوق', '', '', ''); render(); },
  xVOpen: async () => {
    if (await failLeft('v')) return render(); const pw = formObj($('#vf')).pw;
    try { await vaultOpen(pw); await failClear('v'); render(); } catch (e) { await failHit('v'); await log('ورود ناموفق به گاوصندوق', '', '', ''); await render(); msg('گذرواژه درست نیست.', 1); }
  },
  xVLock: () => { vaultLock(); render(); },
  xVPick: () => $('#vfile').click(),
  xVCat: d => { ui.x.vcat = d.c; render(); },
  xVOpenFile: d => { ui.x.vopen = d.id; render(); },
  xVBack: () => { ui.x.vopen = null; if (X.vurl) { URL.revokeObjectURL(X.vurl); X.vurl = null; } render(); },
  xVShow: async () => { try { const { blob } = await vaultBlob(ui.x.vopen); if (X.vurl) URL.revokeObjectURL(X.vurl); X.vurl = URL.createObjectURL(blob); $('#vprev').innerHTML = `<img class="thumb big" src="${X.vurl}" alt="">`; } catch (e) { toast('نمایش ممکن نشد'); } },
  xVExtract: async () => { try { toast('در حال استخراج…'); const { blob, meta } = await vaultBlob(ui.x.vopen); await saveBlob(meta.name, blob, meta.mime); await log('استخراج از گاوصندوق', 'files', ui.x.vopen, ''); } catch (e) { toast('استخراج ممکن نشد: ' + e.message); } },
  xVRename: async () => { const it = (await vaultList()).find(i => i.r.id === ui.x.vopen), n = prompt('نام جدید فایل:', it.m.name); if (!n || !n.trim()) return; it.m.name = n.trim(); it.r.meta = await encMeta(it.m); await put('files', it.r); render(); },
  xVDel: async () => { if (!confirm('این فایل برای همیشه از گاوصندوق حذف شود؟ بازگشتی ندارد.')) return; const id = ui.x.vopen; await rq(os('fileChunks', 'readwrite').delete(IDBKeyRange.bound(id + ':', id + ':\uffff'))); await rq(os('files', 'readwrite').delete(id)); await log('حذف از گاوصندوق', 'files', id, ''); ui.x.vopen = null; X.vcache = null; render(); },
  xVPw: async () => {
    const o = prompt('گذرواژه فعلی گاوصندوق:'); if (!o) return; const n = prompt('گذرواژه جدید (حداقل ۶ نویسه):'); if (!n || n.length < 6) return toast('گذرواژه جدید کوتاه است.');
    try { await vaultOpen(o); const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12)), it = 200000, w = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await kdf(n, salt, it), X.vaultRaw); await setMeta(VKEY(), { salt: b64u.enc(salt), iv: b64u.enc(iv), wrapped: b64u.enc(w), it, at: new Date().toISOString() }); toast('گذرواژه عوض شد'); } catch (e) { toast('گذرواژه فعلی درست نیست.'); }
  }
});
const _login = ACT.login;
ACT.login = async () => {
  const left = await failLeft('l'); if (left) return loginScreen(`تلاش‌های ناموفق زیاد بود؛ ${faDigits(left)} ثانیه دیگر دوباره تلاش کنید.`);
  await _login(); if (me) await failClear('l'); else await failHit('l');
};
const _logout = ACT.logout; ACT.logout = async () => { vaultLock(); ui.x = {}; await _logout(); };
const _addA = ACT.add, _editA = ACT.edit, _addU = ACT.addUser, _editU = ACT.editUser;
ACT.add = d => { ui.pendingPhoto = null; _addA(d); }; ACT.edit = d => { ui.pendingPhoto = null; _editA(d); }; ACT.addUser = d => { ui.pendingPhoto = null; _addU(d); }; ACT.editUser = d => { ui.pendingPhoto = null; _editU(d); };
const _save = save; save = async function (store, data, old) { const r = await _save(store, data, old); X.ls = { store, rec: r }; return r; };
const _saveForm = ACT.saveForm, _saveUser = ACT.saveUser;
async function afterSave(store) { if (X.ls && X.ls.store === store && ui.pendingPhoto) { await setPhoto(X.ls.rec.id, ui.pendingPhoto, store); ui.pendingPhoto = null; } }
ACT.saveForm = async () => { X.ls = null; await _saveForm(); await afterSave(ui.ent); };
ACT.saveUser = async () => {
  X.ls = null; const roleSel = $('#xrole'), rf = [...document.querySelectorAll('[name^="rf_"]')].filter(c => c.checked).map(c => ({ k: c.name.slice(3) }));
  const customRf = ($('#xrfc')?.value || '').trim(), uname = $('#uf')?.elements.username.value.trim().toLowerCase(); if (customRf) rf.push({ k: 'c_' + [...enc.encode(customRf)].reduce((a, b) => (a * 31 + b) >>> 0, 7).toString(36), l: customRf });
  await _saveUser(); if (ui.userForm !== undefined) return;
  const u = (await all('users')).find(x => x.username === uname); if (u) { u.roleId = roleSel?.value || ''; u.reqFields = rf; await put('users', u); if (me && u.id === me.id) me = u; await afterSave('users'); }
};
document.addEventListener('change', async e => {
  const t = e.target.closest && e.target.closest('[data-xch]'); if (!t) return; const k = t.dataset.xch;
  if (k === 'xCodeFile') { const f = t.files[0]; if (f) $('#xcode').value = (await readText(f)).trim(); }
  else if (k === 'xlang') setLang(t.value);
  else if (k === 'xpref') { let v = t.type === 'checkbox' ? t.checked : t.value; if (['autolock', 'font'].includes(t.dataset.k)) v = parseFloat(v); await setPref(t.dataset.k, v); applyPrefsToDom(); activity(); if (['hideVault'].includes(t.dataset.k)) render(); }
  else if (k === 'xvq') { ui.x.vq = t.value; render(); }
  else if (k === 'xvfile') { const fs = [...t.files]; let n = 0; for (const f of fs) { try { toast(`در حال ذخیره (${faDigits(++n)}/${faDigits(fs.length)})…`); await vaultAdd(f); } catch (er) { toast('ذخیره نشد: ' + er.message); } } X.vcache = null; toast('فایل‌ها ذخیره شد'); render(); }
  else if (k === 'xpfile') { const f = t.files[0]; if (!f) return; try { const d = await toDataUrl(f, 1280, 0.85); if (t.dataset.owner) await setPhoto(t.dataset.owner, d, t.dataset.store); else ui.pendingPhoto = d; $('#pbox').innerHTML = `<img class="thumb" src="${d}" alt="تصویر ثبت‌شده">`; } catch (er) { toast('این تصویر خوانده نشد'); } }
  else if (k === 'xrole') { const R = await allRoles(), r = R[t.value]; if (r) Object.keys(PERMS).forEach(p => { const c = document.querySelector(`[name="p_${p}"]`); if (c) c.checked = r.perms.includes(p); }); }
});
document.addEventListener('click', e => { const t = e.target.closest && e.target.closest('.thumb:not(.big)'); if (t && t.closest('#pbox')) { const d = document.createElement('div'); d.className = 'sheet'; d.innerHTML = `<div class="card"><img class="thumb big" src="${t.src}" alt=""><button class="btn">بستن</button></div>`; d.onclick = () => d.remove(); document.body.appendChild(d); } });

/* ---------- اتصال به برنامه ---------- */
async function userExtras(h, id, u) {
  const R = await allRoles(), cur = u?.roleId || '', has = new Set((u?.reqFields || []).map(f => f.k)), info = u?.info || {};
  const roleSel = `<h3>نقش (قالب آماده)</h3><select id="xrole" data-xch="xrole"><option value="">بدون نقش (دسترسی دستی)</option>${Object.entries(R).map(([k, r]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select><p class="s">با انتخاب نقش، دسترسی‌های آن تیک می‌خورد و می‌توانید موارد دیگر را هم اضافه یا کم کنید.</p>`;
  const extra = `<h3>اطلاعات الزامی هنگام ورود</h3>${Object.entries(FIELD_DEFS).map(([k, t]) => `<label class="chk"><input type="checkbox" name="rf_${k}" ${has.has(k) ? 'checked' : ''}> ${t}</label>`).join('')}<label>فیلد دلخواه</label><input type="text" id="xrfc">${Object.keys(info).length ? `<h3>اطلاعات ثبت‌شده کاربر</h3><dl class="facts">${Object.entries(info).map(([k, v]) => `<div><dt>${esc(FIELD_DEFS[k] || k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : ''}`;
  return h.replace('<h3>دسترسی‌ها</h3>', roleSel + '<h3>دسترسی‌ها</h3>').replace('</form><button class="btn" data-act="saveUser">', extra + '</form>' + (await photoBox(id)) + '<button class="btn" data-act="saveUser">');
}
const _userForm = userForm; userForm = async function (err, vals) { const id = ui.userForm, u = vals || (id ? await get('users', id) : null); return userExtras(await _userForm(err, vals), id, id ? await get('users', id) : null); };
const _formView = formView; formView = async function (err, vals) { const h = await _formView(err, vals); return h.replace(/<\/form>(?![\s\S]*<\/form>)/, '</form>' + (await photoBox(ui.formId || ''))); };
const _viewFor = viewFor;
viewFor = async function () {
  if (ui.page && ui.page.startsWith('x:')) return xPage(ui.page.slice(2));
  if (ui.tab === 'vault' && !ui.page) return can('vault') ? vaultView() : denied();
  let h = await _viewFor();
  if (!ui.page && company && (ui.tab === 'home' || (ui.tab === 'ops' && ui.op))) h = h.replace('</h2>', '</h2>' + await stampLine());
  if (ui.tab === 'more' && !ui.page) {
    h = h.replace(/<p class="empty">نسخه[^<]*<\/p>/, '');
    const P = X.prefs, st = status();
    h = h.replace('<button class="btn alt" data-act="logout">', `<h3>زبان و دسترسی‌پذیری</h3><label>زبان برنامه</label><select data-xch="xlang"><option value="fa" ${P.lang === 'fa' ? 'selected' : ''}>فارسی</option><option value="en" ${P.lang === 'en' ? 'selected' : ''}>English (accounting terminology)</option></select>
    <label>اندازه نوشته‌ها</label><select data-xch="xpref" data-k="font">${[[1, 'معمولی'], [1.15, 'بزرگ'], [1.3, 'خیلی بزرگ']].map(([v, t]) => `<option value="${v}" ${P.font === v ? 'selected' : ''}>${t}</option>`).join('')}</select>
    <label class="chk"><input type="checkbox" data-xch="xpref" data-k="contrast" ${P.contrast ? 'checked' : ''}> رنگ‌های پررنگ‌تر (کنتراست بالا)</label>
    <label class="chk"><input type="checkbox" data-xch="xpref" data-k="calm" ${P.calm ? 'checked' : ''}> کم کردن انیمیشن‌ها</label>
    <label class="chk"><input type="checkbox" data-xch="xpref" data-k="speak" ${P.speak ? 'checked' : ''}> خواندن عنوان هر صفحه با صدا (برای نابینایان؛ همراه TalkBack)</label>
    <h3>امنیت</h3><label>خروج خودکار پس از عدم فعالیت</label><select data-xch="xpref" data-k="autolock">${[[0, 'هرگز'], [1, '۱ دقیقه'], [5, '۵ دقیقه'], [15, '۱۵ دقیقه'], [60, '۶۰ دقیقه']].map(([v, t]) => `<option value="${v}" ${P.autolock === v ? 'selected' : ''}>${t}</option>`).join('')}</select>
    <h3>مجوز و اشتراک</h3><button class="row" data-act="xgo" data-p="license"><span class="t">${X.owner ? 'حالت مالک' : 'مجوز و اشتراک'}<span class="s">${stLabel2(st)}</span></span><span class="c">‹</span></button>
    ${X.owner ? '<button class="row" data-act="xgo" data-p="owner"><span class="t">ابزار مالک<span class="s">کد مجوز، نقش، تبلیغ، درخواست‌ها</span></span><span class="c">‹</span></button>' : ''}
    ${can('users') ? '<button class="row" data-act="xgo" data-p="roles"><span class="t">نقش‌ها و قالب‌های آماده<span class="s">بازرس، انباردار و …</span></span><span class="c">‹</span></button>' : ''}
    <button class="btn alt" data-act="logout">`) + '<p class="empty" data-act="xTap" role="note">نسخه ۰٫۵ – فاز ۳ + افزونه‌ها</p>';
  }
  return h;
};
const _render = render;
render = async function () {
  if (!_db) return; if (!X.prefs) { await getPrefs(); applyPrefsToDom(); }
  const st = status();
  if (st.k === 'expired' || st.k === 'blocked') { await lockScreen(st); return afterRender(true); }
  if (me && pendingFields().length) { infoScreen(); return afterRender(true); }
  if (me) { NAV.length = 0; NAV.push(['home', '🏠', 'خانه'], ['ops', '📦', 'عملیات'], ['base', '🗂️', 'اطلاعات پایه']); if (can('vault') && (!X.prefs.hideVault || X.reveal)) NAV.push(['vault', '🔐', 'گاوصندوق']); NAV.push(['backup', '💾', 'پشتیبان'], ['more', '⋯', 'بیشتر']); }
  if (ui.tab !== 'vault' && vOk()) { clearTimeout(X.vt); X.vt = setTimeout(() => { if (ui.tab !== 'vault') vaultLock(); }, 120000); }
  await _render(); await afterRender();
};
async function afterRender(bare) {
  translateDom(); activity();
  if (!bare && me) {
    const hd = $('header.top');
    if (hd && !hd.querySelector('.hbtns')) {
      const exportable = can('export') && !(ui.tab === 'base' && ui.formId !== undefined) && ui.tab !== 'vault' && ui.tab !== 'users' && ui.tab !== 'backup' && ui.tab !== 'more' && !(ui.page && ui.page.startsWith('x:')) && $('main .row, main dl.facts, main table');
      const b = document.createElement('span'); b.className = 'hbtns'; b.innerHTML = `${exportable ? '<button data-act="xXls" aria-label="خروجی Excel" title="Excel">XLS</button><button data-act="xPdf" aria-label="خروجی PDF" title="PDF">PDF</button>' : ''}<button data-act="xRead" aria-label="خواندن صفحه با صدا" title="🔊">🔊</button><button data-act="xTips" aria-label="راهنمای این صفحه" title="؟">؟</button>`;
      hd.appendChild(b);
    }
    if (ui.tab === 'base' && ui.ent && ui.formId === undefined) await decorateList();
    if (ui.tab === 'base' && ui.ent === 'units' && ui.formId === undefined && can('create') && !$('#xstd')) { const m = $('main'), bt = document.createElement('button'); bt.id = 'xstd'; bt.className = 'btn alt'; bt.dataset.act = 'xStdUnits'; bt.textContent = 'افزودن واحدهای استاندارد جاافتاده'; m.appendChild(bt); }
    if (await seedUnits()) { toast('واحدهای اندازه‌گیری رایج اضافه شد'); return render(); }
    const first = !(await getMeta('tipsSeen'))?.welcome; setTimeout(() => showTips(first ? 'welcome' : stateKey()), 500);
  }
  enhanceA11y(); translateDom();
}
ACT.xStdUnits = async () => { const n = await seedUnits(true); toast(n ? `${faDigits(n)} واحد اضافه شد` : 'همه واحدهای استاندارد از قبل هست'); render(); };
async function decorateList() {
  const ph = (await all('files')).filter(f => f.kind === 'photo' && !f.voided); if (!ph.length) return; const m = new Map(ph.map(p => [p.ownerId, p.data]));
  document.querySelectorAll('main button.row[data-id]').forEach(r => { const d = m.get(r.dataset.id); if (d && !r.querySelector('img.mini')) { const i = document.createElement('img'); i.className = 'mini'; i.src = d; i.alt = ''; r.prepend(i); } });
}

const SLOGANS = ['محاسبه دقیق، سود بیشتر', 'دفتر روزنامه و دفتر کل، یک‌جا', 'هر ریال، حساب‌شده', 'گزارش اکسل، فقط با یک لمس'];
{ let k = 0; const el = document.getElementById('slg'); if (el) { const t = setInterval(() => { if (!document.getElementById('slg')) return clearInterval(t); el.style.opacity = 0; setTimeout(() => { el.textContent = SLOGANS[k = (k + 1) % SLOGANS.length]; el.style.opacity = 1; }, 280); }, 1200); } }
async function boot() {
  try {
    await openDB(); await getPrefs(); X.firstRun = await getMeta('firstRun'); if (!X.firstRun) { X.firstRun = Date.now(); await setMeta('firstRun', X.firstRun); }
    cal = (await getMeta('cal')) || (X.prefs.lang === 'fa' ? 'fa' : 'en'); X.used = (await getMeta('usageSec')) || 0;
    applyPrefsToDom(); recalc = (await getMeta('recalc')) || 'auto'; await loadState(); await loadCloud(); startSyncTimers(); await render();
    setInterval(adTick, 15000);
  } catch (e) { document.body.innerHTML = '<p style="padding:20px">' + esc(e.message) + '</p>'; }
  const s = $('#splash'), left = Math.max(0, 2400 - performance.now()); setTimeout(() => { if (s) { s.classList.add('out'); setTimeout(() => s.remove(), 500); } }, left);
}
boot();
