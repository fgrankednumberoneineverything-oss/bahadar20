'use strict';
/* حسابدار بهای تمام‌شده - افزونه‌های کسب‌وکار (برگرفته از بررسی برنامه‌های هم‌حوزه) */
/* ---------- کالا: حداقل موجودی، قیمت فروش، بارکد ---------- */
ENT.items.fields.push(['minQty', 'حداقل موجودی برای هشدار خرید (اختیاری)', 'text'], ['salePrice', 'قیمت فروش پیش‌فرض (ریال، اختیاری)', 'text'], ['barcode', 'بارکد (اختیاری)', 'text']);
const _itemChk = ENT.items.check;
ENT.items.check = d => _itemChk(d) || ((d.minQty || '') !== '' && !(num(d.minQty) >= 0) ? 'حداقل موجودی باید عدد صفر یا بیشتر باشد.' : '') || ((d.salePrice || '') !== '' && !(num(d.salePrice) >= 0) ? 'قیمت فروش باید عدد صفر یا بیشتر باشد.' : '');
ENT.parties = { title: 'اشخاص (مشتری و تأمین‌کننده)', perm: null, fields: [['name', 'نام شخص یا شرکت', 'text', 1], ['kind', 'نوع', ['مشتری', 'تأمین‌کننده', 'هر دو'], 1], ['phone', 'تلفن', 'text'], ['address', 'نشانی', 'text']] };
ENT.checks = { title: 'چک‌ها', perm: null, fields: [['name', 'شماره چک یا عنوان', 'text', 1], ['kind', 'نوع', ['دریافتی', 'پرداختی'], 1], ['partner', 'طرف حساب', 'text', 1], ['bank', 'بانک', 'text'], ['amount', 'مبلغ (ریال)', 'text', 1], ['date', 'تاریخ سررسید', 'date', 1], ['status', 'وضعیت', ['در جریان', 'وصول یا پرداخت شد', 'برگشتی'], 1]], check: d => !(num(d.amount) > 0) ? 'مبلغ باید عددی بزرگ‌تر از صفر باشد.' : '' };
const _confirmBiz = window.confirm;
window.confirm = m => (ui.ent === 'checks' && /این تاریخ در آینده است/.test(m)) ? true : _confirmBiz(m);

/* ---------- محاسبات کمکی ---------- */
async function itemStock() {
  const st = await stockMap(), by = {};
  for (const [k, e] of Object.entries(st)) { const id = k.split('|')[0], x = by[id] || (by[id] = { qty: 0, value: 0 }); x.qty = q3(x.qty + e.qty); x.value += e.value; }
  return by;
}
const unitCostOf = (item, s) => s && s.qty > 0 ? s.value / s.qty : (num(item.stdPrice) || 0);
async function buyPlan() {
  const items = await stockItems(), by = await itemStock(), u = await unitName(), out = [];
  for (const i of items) {
    const min = num(i.minQty); if (!(min > 0)) continue;
    const s = by[i.id] || { qty: 0, value: 0 }; if (s.qty >= min) continue;
    const short = q3(min - s.qty); out.push({ i, s, min, short, unit: u[i.unitId] || '', cost: rial(short * unitCostOf(i, s)) });
  }
  return out.sort((a, b) => b.cost - a.cost);
}
async function checksDue() {
  const t = Date.parse(todayISO()), list = (await rows('checks')).filter(c => !c.voided && c.status === 'در جریان' && c.date);
  const over = list.filter(c => Date.parse(c.date) < t), soon = list.filter(c => { const d = (Date.parse(c.date) - t) / 864e5; return d >= 0 && d <= 7; });
  return { over, soon };
}
function lastMonths(n) {
  const d = new Date(); let y, m; if (cal === 'fa') { [y, m] = g2j(d.getFullYear(), d.getMonth() + 1, d.getDate()); } else { y = d.getFullYear(); m = d.getMonth() + 1; }
  const out = []; for (let i = 0; i < n; i++) { out.unshift({ key: y * 100 + m, label: cal === 'fa' ? MONTHS[m - 1] : GMONTHS[m - 1] }); m--; if (m < 1) { m = 12; y--; } } return out;
}
function monthKey(iso) { const [Y, M, D] = iso.split('-').map(Number); if (cal === 'fa') { const j = g2j(Y, M, D); return j[0] * 100 + j[1]; } return Y * 100 + M; }

/* ---------- داشبورد خانه ---------- */
async function dashHtml() {
  const docs = (await rows('docs')).filter(d => d.status === 'posted'), sales = docs.filter(d => d.type === 'sale'), purch = docs.filter(d => d.type === 'purchase');
  const sTot = sales.reduce((a, d) => a + (d.total || 0), 0), cogs = sales.reduce((a, d) => a + (d.cogs || 0), 0), pTot = purch.reduce((a, d) => a + (d.total || 0), 0);
  const by = await itemStock(), inv = Object.values(by).reduce((a, x) => a + x.value, 0), low = await buyPlan(), ck = await checksDue();
  if (!docs.length && !inv && !low.length && !ck.over.length && !ck.soon.length) return '';
  const margin = sTot > 0 ? Math.round((sTot - cogs) / sTot * 100) : 0;
  const ms = lastMonths(6), data = ms.map(m => ({ ...m, v: sales.filter(d => monthKey(d.date) === m.key).reduce((a, d) => a + d.total, 0) }));
  const mx = Math.max(1, ...data.map(d => d.v)), big = mx >= 1e8, un = big ? 1e6 : 1e3, ordered = cal === 'fa' ? data.slice().reverse() : data;
  const bars = ordered.map((d, i) => { const h = Math.round(d.v / mx * 78), x = 12 + i * 50; return `<rect x="${x}" y="${100 - h}" width="34" height="${h}" rx="5" fill="var(--orange)"/><text x="${x + 17}" y="${94 - h}" font-size="10" text-anchor="middle" fill="currentColor">${d.v ? fmt(d.v / un, big ? 1 : 0) : ''}</text><text x="${x + 17}" y="116" font-size="10" text-anchor="middle" fill="currentColor">${esc(d.label)}</text>`; }).join('');
  const alerts = `${low.length ? `<button class="row" data-act="xgo" data-p="buyplan"><span class="t">⚠️ ${faDigits(low.length)} کالا زیر حداقل موجودی است<span class="s">دیدن برنامه خرید</span></span><span class="c">‹</span></button>` : ''}${ck.over.length ? `<button class="row" data-act="goEnt" data-ent="checks"><span class="t">⏰ ${faDigits(ck.over.length)} چک سررسید گذشته<span class="s">پیگیری کنید</span></span><span class="c">‹</span></button>` : ''}${ck.soon.length ? `<button class="row" data-act="goEnt" data-ent="checks"><span class="t">📅 ${faDigits(ck.soon.length)} چک تا ۷ روز آینده سررسید دارد<span class="s">دیدن چک‌ها</span></span><span class="c">‹</span></button>` : ''}`;
  return `<div class="kpis"><div class="kpi"><span>فروش ثبت‌شده</span><b>${fmt(sTot, 0)}</b></div><div class="kpi"><span>سود ناخالص</span><b>${fmt(sTot - cogs, 0)}</b><small>${faDigits(margin)}٪</small></div><div class="kpi"><span>ارزش موجودی</span><b>${fmt(inv, 0)}</b></div><div class="kpi"><span>جمع خرید</span><b>${fmt(pTot, 0)}</b></div></div>
  <svg viewBox="0 0 320 124" class="chart" role="img" aria-label="${esc(tr('نمودار فروش ۶ ماه اخیر'))}">${bars}</svg><p class="s center">فروش ۶ ماه اخیر (${big ? 'میلیون' : 'هزار'} ریال)</p>${alerts}`;
}
const _homeView = homeView;
homeView = async function () { const h = await _homeView(); const d = await dashHtml(); return d ? h.replace('</h2>', '</h2>' + d) : h; };

/* ---------- منوی عملیات و بیشتر ---------- */
const _opsView = opsView;
opsView = async function () {
  let h = await _opsView();
  if (!ui.op) h = h.replace('<h3>تنظیمات و ثبت هزینه‌یابی</h3>', `<h3>ابزارهای برنامه‌ریزی</h3>${rowBtn('xgo', 'برنامه خرید (زیر حداقل موجودی)', 'کالاهای کم‌موجودی و برآورد هزینه', 'data-p="buyplan"')}${rowBtn('xgo', 'نیاز مواد برای تولید (MRP)', 'ماده لازم، موجودی و کمبود از روی فرمول‌ها', 'data-p="mrp"')}${rowBtn('xgo', 'لیست قیمت', 'قیمت فروش کالاها برای چاپ و ارسال', 'data-p="pricelist"')}<h3>تنظیمات و ثبت هزینه‌یابی</h3>`);
  return h;
};
const _moreView = moreView;
moreView = async function () {
  const h = await _moreView(), T = THEMES, cur = X.prefs.theme || 'bahadar';
  return h.replace('<button class="btn alt" data-act="logout">', `<h3>ظاهر و فاکتور</h3><label>رنگ برنامه</label><select data-xch="xpref" data-k="theme">${Object.entries(T).map(([k, v]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${v[2]}</option>`).join('')}</select>${rowBtn('xgo', 'سربرگ، مهر و امضای فاکتور', 'لوگو، مهر و امضا در خروجی PDF', 'data-p="brand"')}${can('export') ? rowBtn('xFullXls', 'خروجی کامل Excel', 'همه اطلاعات شرکت در یک فایل چندبرگی', '') : ''}<button class="btn alt" data-act="logout">`);
};
const THEMES = { bahadar: ['#12A5B8', '#7FE7F2', 'بهادار (فیروزه‌ای)'], gold: ['#E0A800', '#FFD866', 'طلایی'], blue: ['#3B8CE8', '#8DC0FF', 'آبی'], green: ['#2FAE5B', '#7FDDA0', 'سبز'], purple: ['#8B6CF0', '#BBA6FF', 'بنفش'], red: ['#E5484D', '#FF9A9D', 'قرمز'], orange: ['#F2711C', '#FFB380', 'نارنجی'] };

/* ---------- صفحه‌ها ---------- */
XP.buyplan = async () => {
  const L = await buyPlan(), tot = L.reduce((a, x) => a + x.cost, 0);
  return `${xback()}<h2>برنامه خرید</h2><p>کالاهایی که موجودی کل آن‌ها از «حداقل موجودی» کمتر است. حداقل را در «اطلاعات پایه ← کالاها» تعیین کنید.</p>
  ${L.map(x => `<div class="row"><span class="t">${esc(x.i.name)}<span class="s">موجودی: ${fmt(x.s.qty)} – حداقل: ${fmt(x.min)} ${esc(x.unit)}</span></span><span><b>${fmt(x.short)}</b> ${esc(x.unit)}<span class="s">${fmt(x.cost, 0)} ریال</span></span></div>`).join('') || '<div class="empty">همه کالاها بالاتر از حداقل موجودی هستند.</div>'}
  ${L.length ? `<dl class="facts"><div><dt>برآورد هزینه خرید کمبودها</dt><dd>${fmt(tot, 0)} ریال</dd></div></dl>` : ''}`;
};
XP.pricelist = async () => {
  const items = (await stockItems()).concat((await rows('items')).filter(i => i.kind === 'خدمات')), u = await unitName();
  const g = {}; for (const i of items) (g[i.kind || 'سایر'] = g[i.kind || 'سایر'] || []).push(i);
  return `${xback()}<h2>لیست قیمت</h2>${Object.entries(g).map(([k, L]) => `<h3>${esc(k)}</h3>${L.sort((a, b) => a.name.localeCompare(b.name, 'fa')).map(i => `<div class="row"><span class="t">${esc(i.name)}<span class="s">${esc([i.code, i.barcode, u[i.unitId]].filter(Boolean).join(' – '))}</span></span><span><b>${num(i.salePrice) >= 0 && i.salePrice !== '' && i.salePrice !== undefined ? fmt(num(i.salePrice), 0) : '—'}</b> ریال</span></div>`).join('')}`).join('') || '<div class="empty">کالایی ثبت نشده است.</div>'}<p class="s">قیمت فروش هر کالا را در فرم کالا وارد کنید. با دکمه‌های Excel و PDF بالای صفحه، لیست را بفرستید.</p>`;
};
const mrpSync = () => { const f = $('#xm'); if (!f) return; const M = ui.x.mrp; M.rows = [...f.querySelectorAll('.mr')].map(r => ({ pid: r.querySelector('select').value, qty: r.querySelector('input').value })); M.explode = f.elements.explode.checked; M.scrap = f.elements.scrap.checked; };
async function mrpCalc(M) {
  const boms = (await rows('boms')).filter(b => b.active && !b.voided), bomOf = {}; boms.forEach(b => bomOf[b.productId] = b);
  const items = {}; for (const i of await rows('items')) items[i.id] = i;
  const by = await itemStock(), need = {}, semi = {};
  const add = (id, q) => need[id] = q3((need[id] || 0) + q);
  const explode = (id, qty, depth, path) => {
    const b = bomOf[id]; if (!b) return; const f = qty / b.outputQty * (M.scrap && b.scrapPct > 0 && b.scrapPct < 100 ? 1 / (1 - b.scrapPct / 100) : 1);
    for (const l of b.lines) {
      const q = l.qty * f;
      if (M.explode && bomOf[l.itemId] && depth < 6 && !path.includes(l.itemId)) {
        const have = Math.max(0, ((by[l.itemId]?.qty) || 0) - (semi[l.itemId] || 0)), use = Math.min(have, q); semi[l.itemId] = (semi[l.itemId] || 0) + use;
        if (use > 1e-9) add(l.itemId, use); const rest = q - use; if (rest > 1e-9) explode(l.itemId, rest, depth + 1, [...path, id]);
      } else add(l.itemId, q);
    }
  };
  for (const r of M.rows) { const q = num(r.qty); if (r.pid && q > 0 && bomOf[r.pid]) explode(r.pid, q, 0, []); }
  const u = await unitName(), out = [];
  for (const [id, req] of Object.entries(need)) { const i = items[id]; if (!i) continue; const s = by[id] || { qty: 0, value: 0 }, short = Math.max(0, q3(req - s.qty)), isSemi = !!bomOf[id] && M.explode; out.push({ i, req, have: s.qty, short: isSemi ? 0 : short, unit: u[i.unitId] || '', cost: rial((isSemi ? 0 : short) * unitCostOf(i, s)) }); }
  return out.sort((a, b) => b.cost - a.cost || b.short - a.short);
}
XP.mrp = async () => {
  const M = (ui.x || (ui.x = {})).mrp || (ui.x.mrp = { rows: [{ pid: '', qty: '' }], explode: true, scrap: true, res: null });
  const prods = (await rows('boms')).filter(b => b.active && !b.voided);
  const res = M.res;
  return `${xback()}<h2>نیاز مواد برای تولید (MRP)</h2><p>محصول و مقدار برنامه‌ریزی‌شده را بدهید؛ برنامه از فرمول فعال هر محصول، مواد لازم را با موجودی مقایسه می‌کند.</p>
  ${prods.length ? '' : '<div class="warn">ابتدا در «عملیات ← فرمول ساخت» برای محصول فرمول بسازید.</div>'}
  <form id="xm" onsubmit="return false">${M.rows.map((r, i) => `<div class="mr"><select aria-label="${esc(tr('محصول'))}"><option value="">انتخاب محصول</option>${prods.map(b => `<option value="${b.productId}" ${b.productId === r.pid ? 'selected' : ''}>${esc(b.productName)}</option>`).join('')}</select><input type="text" inputmode="decimal" placeholder="مقدار تولید" value="${esc(r.qty)}" aria-label="${esc(tr('مقدار تولید'))}"></div>`).join('')}
  <button class="btn alt sm" type="button" data-act="xMrpAdd">+ ردیف</button>
  <label class="chk"><input type="checkbox" name="explode" ${M.explode ? 'checked' : ''}> گسترش فرمول‌های چندسطحی (نیمه‌ساخته‌ها از موجودی کسر و بقیه به مواد خام باز شوند)</label>
  <label class="chk"><input type="checkbox" name="scrap" ${M.scrap ? 'checked' : ''}> احتساب درصد ضایعات عادی فرمول</label></form>
  <button class="btn" data-act="xMrpCalc">محاسبه نیاز مواد</button>
  ${res ? `<h3>نتیجه</h3>${res.map(x => `<div class="row"><span class="t">${esc(x.i.name)}<span class="s">لازم: ${fmt(x.req)} – موجودی: ${fmt(x.have)} ${esc(x.unit)}</span></span><span>${x.short > 0 ? `<b class="bad">کمبود ${fmt(x.short)}</b> ${esc(x.unit)}` : '<b>کافی</b>'}<span class="s">${fmt(x.cost, 0)} ریال</span></span></div>`).join('') || '<div class="empty">برای ردیف‌های انتخاب‌شده نیازی محاسبه نشد.</div>'}<dl class="facts"><div><dt>برآورد هزینه خرید کمبودها</dt><dd>${fmt(res.reduce((a, x) => a + x.cost, 0), 0)} ریال</dd></div></dl>` : ''}`;
};
const BRAND_SLOTS = [['logo', 'لوگو'], ['stamp', 'مهر'], ['sign', 'امضا']];
const brandFile = async slot => (await all('files')).find(f => f.kind === 'brand' && f.ownerId === company.id + ':' + slot);
async function brandOf() {
  if (!company) return null; const o = { color: '', footer: '', ...((await getMeta('brand:' + company.id)) || {}) };
  for (const [s] of BRAND_SLOTS) o[s] = (await brandFile(s))?.data || ''; return o;
}
XP.brand = async () => {
  const b = await brandOf() || {};
  return `${xback()}<h2>سربرگ، مهر و امضای فاکتور</h2><p>این تصویرها در خروجی PDF فاکتور خرید و فروش و سربرگ گزارش‌ها می‌آیند. برای مهر و امضا، تصویر با زمینه شفاف (PNG) بهتر است.</p>
  ${BRAND_SLOTS.map(([s, t]) => `<h3>${t}</h3><div id="br_${s}">${b[s] ? `<img class="thumb" src="${b[s]}" alt="${t}">` : '<div class="empty">ثبت نشده است.</div>'}</div><input type="file" accept="image/*" data-xch="xbrand" data-slot="${s}"><button class="btn alt sm" data-act="xBrandDel" data-slot="${s}">حذف ${t}</button>`).join('')}
  <h3>متن پایین فاکتور</h3><form id="xf" onsubmit="return false"><input type="text" name="footer" value="${esc(b.footer || '')}" placeholder="مثلاً: نشانی، تلفن یا شرایط پرداخت"></form><button class="btn" data-act="xBrandSave">ذخیره متن</button>`;
};

/* ---------- خروجی کامل Excel (چندبرگی) ---------- */
function cellsXml(rows) {
  let sd = '';
  rows.forEach((r, ri) => {
    sd += `<row r="${ri + 1}">`;
    r.forEach((c, ci) => {
      if (c === null || c === undefined || c === '') return; const ref = colName(ci) + (ri + 1); let st = 0, v = c;
      if (typeof c === 'object') { st = c.st || 0; v = c.f !== undefined ? c : c.s; }
      if (v && typeof v === 'object' && v.f !== undefined) sd += `<c r="${ref}" s="${st || 2}"><f>${xesc(v.f)}</f><v>${v.v}</v></c>`;
      else if (typeof v === 'number' && isFinite(v)) sd += `<c r="${ref}" s="${st || 2}"><v>${v}</v></c>`;
      else sd += `<c r="${ref}" s="${st}" t="inlineStr"><is><t xml:space="preserve">${xesc(v)}</t></is></c>`;
    });
    sd += '</row>';
  });
  return sd;
}
function buildWorkbook(sheets, rtl) {
  const X1 = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n', files = [];
  const ov = sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('');
  files.push({ name: '[Content_Types].xml', data: X1 + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${ov}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` });
  files.push({ name: '_rels/.rels', data: X1 + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' });
  files.push({ name: 'xl/workbook.xml', data: X1 + `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${xesc(String(s.name).replace(/[\\/?*\[\]:]/g, ' ').slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets><calcPr fullCalcOnLoad="1"/></workbook>` });
  files.push({ name: 'xl/_rels/workbook.xml.rels', data: X1 + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` });
  files.push({ name: 'xl/styles.xml', data: X1 + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.###"/></numFmts><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFE5CC"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>' });
  sheets.forEach((s, i) => {
    const cols = (s.widths || []).map((w, k) => `<col min="${k + 1}" max="${k + 1}" width="${w}" customWidth="1"/>`).join('');
    files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: X1 + `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"${rtl ? ' rightToLeft="1"' : ''}/></sheetViews><cols>${cols}</cols><sheetData>${cellsXml(s.rows)}</sheetData></worksheet>` });
  });
  return zipStore(files);
}
async function fullExcel() {
  if (!can('export')) return toast('اجازه این کار را ندارید');
  toast('در حال ساخت فایل Excel…');
  const H = a => a.map(s => ({ s: tr(s), st: 1 })), items = await rows('items'), u = await unitName(), nodes = await rows('nodes'), nn = {}; nodes.forEach(n => nn[n.id] = n.name);
  const itn = {}; items.forEach(i => itn[i.id] = i.name);
  const sh = [];
  sh.push({ name: tr('کالاها'), widths: [14, 30, 16, 14, 16, 16, 14, 18], rows: [H(['کد', 'نام', 'نوع', 'واحد', 'قیمت استاندارد', 'قیمت فروش', 'حداقل موجودی', 'بارکد']), ...items.map(i => [i.code || '', i.name, tr(i.kind || ''), tr(u[i.unitId] || ''), num(i.stdPrice) || 0, num(i.salePrice) || 0, num(i.minQty) || 0, i.barcode || ''])] });
  const st = await stockMap(), srows = [];
  for (const [k, e] of Object.entries(st)) { if (!e.qty && !e.value) continue; const [iid, wid] = k.split('|'); srows.push([itn[iid] || '', nn[wid] || '', e.qty, rial(e.value)]); }
  const n0r = srows.length + 1;
  sh.push({ name: tr('موجودی'), widths: [30, 22, 14, 18, 18], rows: [H(['کالا', 'انبار', 'مقدار', 'ارزش (ریال)', 'میانگین هر واحد']), ...srows.map((r, i) => [...r, { f: `IF(C${i + 2}=0,0,D${i + 2}/C${i + 2})`, v: r[2] ? r[3] / r[2] : 0 }]), [{ s: tr('جمع کل'), st: 1 }, '', '', { f: `SUM(D2:D${n0r})`, v: srows.reduce((a, r) => a + r[3], 0), st: 2 }]] });
  const docs = (await rows('docs')).sort((a, b) => a.date.localeCompare(b.date)), drows = [];
  for (const d of docs) for (const l of d.lines) drows.push([tr(KINDS[d.type]), d.number || '', fmtDay(d.date), d.partner || '', nn[d.warehouseId] || '', itn[l.itemId] || '', l.qty, l.price, tr(stLabel(d.status))]);
  sh.push({ name: tr('خرید و فروش'), widths: [10, 12, 18, 22, 18, 28, 12, 14, 16, 16], rows: [H(['نوع', 'شماره', 'تاریخ', 'طرف حساب', 'انبار', 'کالا', 'مقدار', 'قیمت', 'مبلغ', 'وضعیت']).slice(0, 8).concat(H(['مبلغ', 'وضعیت'])), ...drows.map((r, i) => [r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], { f: `G${i + 2}*H${i + 2}`, v: r[6] * r[7] }, r[8]])] });
  const brows = []; for (const b of (await rows('boms')).sort((a, c) => a.productName.localeCompare(c.productName, 'fa') || c.version - a.version)) for (const l of b.lines) brows.push([b.productName, b.version, b.active ? tr('فعال') : tr('قدیمی'), b.outputQty, itn[l.itemId] || '', l.qty]);
  sh.push({ name: tr('فرمول‌ها'), widths: [28, 10, 12, 14, 28, 12], rows: [H(['محصول', 'نسخه', 'وضعیت', 'مقدار تولید', 'ماده', 'مقدار']), ...brows] });
  const cks = await rows('checks'), pts = await rows('parties');
  sh.push({ name: tr('چک‌ها'), widths: [20, 12, 22, 16, 16, 16, 20], rows: [H(['شماره یا عنوان', 'نوع', 'طرف حساب', 'بانک', 'مبلغ', 'سررسید', 'وضعیت']), ...cks.map(c => [c.name, tr(c.kind || ''), c.partner || '', c.bank || '', num(c.amount) || 0, c.date ? fmtDay(c.date) : '', tr(c.status || '')]), [{ s: tr('جمع کل'), st: 1 }, '', '', '', { f: `SUM(E2:E${cks.length + 1})`, v: cks.reduce((a, c) => a + (num(c.amount) || 0), 0), st: 2 }]] });
  sh.push({ name: tr('اشخاص'), widths: [28, 14, 18, 36], rows: [H(['نام', 'نوع', 'تلفن', 'نشانی']), ...pts.map(p => [p.name, tr(p.kind || ''), p.phone || '', p.address || ''])] });
  const po = await rows('prodOrders'); if (po.length) { const keys = Object.keys(po[0]).filter(k => !/^(id|companyId|createdBy|updatedBy|syncStatus|lines|moves|voided)$/.test(k) && typeof po[0][k] !== 'object'); sh.push({ name: tr('سفارش‌های تولید'), widths: keys.map(() => 18), rows: [keys.map(k => ({ s: k, st: 1 })), ...po.map(p => keys.map(k => typeof p[k] === 'number' ? p[k] : String(p[k] ?? '')))] }); }
  await saveBlob(`${(company?.name || 'company').replace(/[^\w\u0600-\u06FF]+/g, '_').slice(0, 30)}-full-${todayISO()}.xlsx`, buildWorkbook(sh, X.prefs.lang === 'fa'));
  await log('خروجی کامل Excel', '', '', ''); toast('فایل Excel آماده شد');
}

/* ---------- کنش‌ها و رویدادها ---------- */
Object.assign(ACT, {
  xFullXls: fullExcel,
  xMrpAdd: () => { mrpSync(); ui.x.mrp.rows.push({ pid: '', qty: '' }); render(); },
  xMrpCalc: async () => { mrpSync(); const M = ui.x.mrp; M.res = await mrpCalc(M); render(); },
  xBrandDel: async d => { const f = await brandFile(d.slot); if (f) await rq(os('files', 'readwrite').delete(f.id)); const b = $('#br_' + d.slot); if (b) b.innerHTML = '<div class="empty">ثبت نشده است.</div>'; toast('حذف شد'); },
  xBrandSave: async () => { const o = (await getMeta('brand:' + company.id)) || {}; o.footer = $('#xf').elements.footer.value.trim(); await setMeta('brand:' + company.id, o); toast('ذخیره شد'); }
});
async function toPng(file, max) {
  const bmp = await createImageBitmap(file), s = Math.min(1, max / Math.max(bmp.width, bmp.height)), cv = document.createElement('canvas');
  cv.width = Math.round(bmp.width * s); cv.height = Math.round(bmp.height * s); cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height); return cv.toDataURL('image/png');
}
document.addEventListener('change', async e => {
  const t = e.target.closest && e.target.closest('[data-xch="xbrand"]'); if (!t || !t.files[0]) return;
  try {
    const d = await toPng(t.files[0], t.dataset.slot === 'logo' ? 420 : 320), old = await brandFile(t.dataset.slot), now = new Date().toISOString();
    await put('files', { ...(old || { id: uid(), createdAt: now }), kind: 'brand', ownerId: company.id + ':' + t.dataset.slot, companyId: company.id, data: d, updatedAt: now, voided: false });
    $('#br_' + t.dataset.slot).innerHTML = `<img class="thumb" src="${d}" alt="">`;
  } catch (er) { toast('این تصویر خوانده نشد'); }
});
const _renderBiz = render;
render = async function () {
  await _renderBiz();
  const pf = $('#df [name=partner]'); if (pf && !pf.list) {
    const ps = (await rows('parties')).filter(p => !p.voided && (ui.op?.kind === 'sale' ? p.kind !== 'تأمین‌کننده' : p.kind !== 'مشتری'));
    if (ps.length) { pf.setAttribute('list', 'dlparties'); pf.insertAdjacentHTML('afterend', `<datalist id="dlparties">${ps.map(p => `<option value="${esc(p.name)}">`).join('')}</datalist>`); }
  }
};
