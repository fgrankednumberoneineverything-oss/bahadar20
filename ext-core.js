'use strict';
/* حسابدار بهای تمام‌شده - افزونه‌ها (هسته): زبان، خروجی Excel/PDF، دسترسی‌پذیری، امنیت، واحدها */
const X = { owner: false, st: { grant: null, cfg: null }, vaultKey: null, lastKey: '', hiddenAt: 0, prefs: null, used: 0 };
const LOCAL_META = /^(deviceId|firstRun|grantCode|configCode|maxSeq|ownerKey|usageSec|adState|vaultCfg:|tipsSeen|prefs|fails|ownAds|ownCfg|ownSeq|customRoles|unitsSeeded:|lastSeen)/;
const isLocalMeta = id => LOCAL_META.test(String(id));
const enc = new TextEncoder(), dec = new TextDecoder();
const b64u = {
  enc: buf => { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); },
  dec: s => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }
};
const PREF0 = { theme: 'bahadar', lang: 'fa', autolock: 15, font: 1, contrast: false, calm: false, speak: false, hideVault: false, compress: true, optImg: false };
const getPrefs = async () => X.prefs = { ...PREF0, ...((await getMeta('prefs')) || {}) };
const setPref = async (k, v) => { X.prefs = { ...(X.prefs || PREF0), [k]: v }; await setMeta('prefs', X.prefs); };
const nowMs = () => Math.max(Date.now(), X.lastSeen || 0);

/* ---------- زبان ---------- */
const PERSIAN = /[\u0600-\u06FF]/;
let TR = null;
const reEsc = x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PL = /[\u0600-\u06FF\u200c]/;
function buildTR() {
  const pairs = (window.I18N_EN || []).slice().sort((a, b) => b[0].length - a[0].length);
  const phrases = pairs.filter(([fa]) => /[\s:،؛(«»–—]/.test(fa.trim()) || fa.length > 14);
  TR = {
    map: new Map(pairs),
    list: phrases.map(([fa, en]) => [fa, en, new RegExp((PL.test(fa[0]) ? '(?<![\\u0600-\\u06FF\\u200c])' : '') + reEsc(fa) + (PL.test(fa[fa.length - 1]) ? '(?![\\u0600-\\u06FF\\u200c])' : ''), 'g')])
  };
}
const SEG = /(\s[–—\-\/|]\s|[:：،؛()«»“”"])/, CORE = /^([^\u0600-\u06FF]*)([\u0600-\u06FF](?:[\u0600-\u06FF\u200c\s]*[\u0600-\u06FF\u200c])?)([^\u0600-\u06FF]*)$/;
function segTr(s) {
  return s.split(SEG).map(seg => { const m = seg.match(CORE); if (!m) return seg; const en = TR.map.get(m[2]); return en !== undefined ? m[1] + en + m[3] : seg; }).join('');
}
function tr(s) {
  if (!X.prefs || X.prefs.lang === 'fa' || typeof s !== 'string' || !s) return s;
  if (!TR) buildTR();
  let out = s; const t = s.trim(); const ex = TR.map.get(t);
  if (ex !== undefined) out = s.replace(t, () => ex);
  else if (PERSIAN.test(s)) { for (const [fa, en, re] of TR.list) if (out.includes(fa)) out = out.replace(re, () => en); if (PERSIAN.test(out)) out = segTr(out); }
  return out.replace(/[۰-۹]/g, c => '۰۱۲۳۴۵۶۷۸۹'.indexOf(c)).replace(/٫/g, '.').replace(/٬/g, ',').replace(/٪/g, '%').replace(/«/g, '“').replace(/»/g, '”');
}
let applying = false;
function translateDom(root = document.body) {
  if (!X.prefs || X.prefs.lang === 'fa') return;
  applying = true;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n; while ((n = w.nextNode())) { const p = n.parentNode; if (p && /^(SCRIPT|STYLE|TEXTAREA)$/.test(p.nodeName)) continue; const v = tr(n.nodeValue); if (v !== n.nodeValue) n.nodeValue = v; }
  root.querySelectorAll('[placeholder],[title],[aria-label],[alt]').forEach(el => ['placeholder', 'title', 'aria-label', 'alt'].forEach(a => { const v = el.getAttribute(a); if (v) { const t = tr(v); if (t !== v) el.setAttribute(a, t); } }));
  document.title = tr(document.title);
  applying = false;
}
let trTimer = 0;
new MutationObserver(() => { if (applying) return; cancelAnimationFrame(trTimer); trTimer = requestAnimationFrame(() => translateDom()); }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
const _confirm = window.confirm.bind(window), _alert = window.alert.bind(window), _prompt = window.prompt.bind(window);
window.confirm = m => _confirm(tr(m)); window.alert = m => _alert(tr(m)); window.prompt = (m, d) => _prompt(tr(m), d);
function applyPrefsToDom() {
  const P = X.prefs, h = document.documentElement;
  h.lang = P.lang; h.dir = P.lang === 'fa' ? 'rtl' : 'ltr';
  h.style.zoom = P.font; if (typeof THEMES !== 'undefined') { const T = THEMES[P.theme] || THEMES.bahadar; h.style.setProperty('--orange', T[0]); h.style.setProperty('--orange-d', T[1]); } h.classList.toggle('hc', !!P.contrast); h.classList.toggle('calm', !!P.calm);
}
async function setLang(l) {
  await setPref('lang', l); applyPrefsToDom();
  cal = l === 'fa' ? 'fa' : 'en'; await setMeta('cal', cal);
  render();
}

/* ---------- ZIP / XLSX / PDF (بدون کتابخانه بیرونی) ---------- */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = u => { let c = ~0; for (let i = 0; i < u.length; i++) c = CRC[(c ^ u[i]) & 255] ^ (c >>> 8); return ~c >>> 0; };
function zipStore(files) {
  const parts = [], cen = []; let off = 0; const d = new Date();
  const dt = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(), tm = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  for (const f of files) {
    const name = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data, crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30)); h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true); h.setUint16(10, tm, true); h.setUint16(12, dt, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true);
    parts.push(new Uint8Array(h.buffer), name, data);
    const c = new DataView(new ArrayBuffer(46)); c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true); c.setUint16(12, tm, true); c.setUint16(14, dt, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
    cen.push(new Uint8Array(c.buffer), name); off += 30 + name.length + data.length;
  }
  const cs = cen.reduce((a, b) => a + b.length, 0), e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cs, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...cen, new Uint8Array(e.buffer)]);
}
const xesc = s => String(s).replace(/[&<>"\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, c => c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '');
const colName = i => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
/* cell: عدد | متن | {f:'SUM(..)', v:عدد} | {s:'متن', st:1} */
function buildXlsx(sheetName, rows, opts = {}) {
  const rtl = opts.rtl ? ' rightToLeft="1"' : '';
  let maxC = 0, sd = '';
  rows.forEach((r, ri) => {
    sd += `<row r="${ri + 1}">`;
    r.forEach((c, ci) => {
      if (c === null || c === undefined || c === '') return; maxC = Math.max(maxC, ci + 1);
      const ref = colName(ci) + (ri + 1); let st = 0, v = c;
      if (typeof c === 'object') { st = c.st || 0; v = c.f !== undefined ? c : c.s; }
      if (v && typeof v === 'object' && v.f !== undefined) sd += `<c r="${ref}" s="${st || 2}"><f>${xesc(v.f)}</f><v>${v.v}</v></c>`;
      else if (typeof v === 'number' && isFinite(v)) sd += `<c r="${ref}" s="${st || 2}"><v>${v}</v></c>`;
      else sd += `<c r="${ref}" s="${st}" t="inlineStr"><is><t xml:space="preserve">${xesc(v)}</t></is></c>`;
    });
    sd += '</row>';
  });
  const widths = opts.widths || [34, 24, 18, 18, 18];
  const cols = widths.slice(0, Math.max(maxC, 1)).map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
  const X1 = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const nm = xesc(String(sheetName).replace(/[\\/?*\[\]:]/g, ' ').slice(0, 31) || 'Sheet1');
  return zipStore([
    { name: '[Content_Types].xml', data: X1 + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
    { name: '_rels/.rels', data: X1 + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', data: X1 + `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${nm}" sheetId="1" r:id="rId1"/></sheets><calcPr fullCalcOnLoad="1"/></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: X1 + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
    { name: 'xl/styles.xml', data: X1 + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.###"/></numFmts><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFE5CC"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>' },
    { name: 'xl/worksheets/sheet1.xml', data: X1 + `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"${rtl}/></sheetViews><cols>${cols}</cols><sheetData>${sd}</sheetData></worksheet>` }
  ]);
}
function buildPdf(pages) { /* pages: [{jpeg:Uint8Array, w, h}] بر حسب پیکسل؛ صفحه A4 */
  const chunks = [], offs = []; let len = 0; const push = x => { const u = typeof x === 'string' ? enc.encode(x) : x; chunks.push(u); len += u.length; };
  const n = pages.length; push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const obj = (id, body) => { offs[id] = len; push(`${id} 0 obj\n`); body(); push('\nendobj\n'); };
  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => push(`<< /Type /Pages /Count ${n} /Kids [${pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ')}] >>`));
  pages.forEach((p, i) => {
    const pid = 3 + i * 3, cid = pid + 1, iid = pid + 2, W = 595, H = Math.round(W * p.h / p.w);
    obj(pid, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 ${iid} 0 R >> >> /Contents ${cid} 0 R >>`));
    const cs = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`;
    obj(cid, () => push(`<< /Length ${cs.length} >>\nstream\n${cs}\nendstream`));
    obj(iid, () => { push(`<< /Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`); push(p.jpeg); push('\nendstream'); });
  });
  const total = 3 + n * 3, xr = len; push(`xref\n0 ${total}\n0000000000 65535 f \n`);
  for (let i = 1; i < total; i++) push(String(offs[i]).padStart(10, '0') + ' 00000 n \n');
  push(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xr}\n%%EOF`);
  return new Blob(chunks, { type: 'application/pdf' });
}
async function saveBlob(name, blob, mime) {
  const C = window.Capacitor, P = C?.Plugins;
  if (C?.isNativePlatform?.() && P?.Filesystem && P?.Share) {
    const CH = 3 * 1024 * 1024; let r;
    for (let o = 0, first = true; o < blob.size || first; o += CH, first = false) {
      const b64 = await new Promise((ok, no) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(',')[1] || ''); fr.onerror = no; fr.readAsDataURL(blob.slice(o, o + CH)); });
      if (first) r = await P.Filesystem.writeFile({ path: name, data: b64, directory: 'CACHE' }); else await P.Filesystem.appendFile({ path: name, data: b64, directory: 'CACHE' });
    }
    await P.Share.share({ title: name, url: r.uri, dialogTitle: tr('ذخیره یا ارسال فایل') });
  } else { const a = document.createElement('a'); a.href = URL.createObjectURL(blob.type ? blob : new Blob([blob], { type: mime || 'application/octet-stream' })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 20000); }
}
async function shareText(name, text) { await saveBlob(name, new Blob([text], { type: 'text/plain' }), 'text/plain'); }

/* ---------- مهر آخرین بروزرسانی اطلاعات شرکت ---------- */
const CO_STORES = ['factories', 'units', 'items', 'nodes', 'docs', 'stockMoves', 'boms', 'prodOrders', 'ohRates', 'ohActuals'];
async function lastUpdate() {
  if (!company) return null; let best = company;
  for (const s of CO_STORES) for (const r of await all(s)) if (r.companyId === company.id && (r.updatedAt || '') > (best.updatedAt || '')) best = r;
  if (!best.updatedAt) return null;
  const d = new Date(best.updatedAt), iso = isoOf(d), by = best.updatedBy ? (await get('users', best.updatedBy))?.name : '';
  let ds; if (cal === 'fa') { const [jy, jm, jd] = g2j(d.getFullYear(), d.getMonth() + 1, d.getDate()); ds = `${jy}/${pad2(jm)}/${pad2(jd)}`; } else ds = iso;
  return { text: `${ds} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`, by: by || '' };
}
async function stampLine() {
  const u = await lastUpdate(); if (!u) return '';
  return `<p class="stamp">آخرین بروزرسانی اطلاعات شرکت «${esc(company.name)}»: ${faDigits(u.text)}${u.by ? ' – ' + esc(u.by) : ''}</p>`;
}
const faDigits = s => cal === 'fa' ? String(s).replace(/\d/g, c => '۰۱۲۳۴۵۶۷۸۹'[c]) : String(s);

/* ---------- خروجی Excel و PDF از صفحه جاری ---------- */
const numOf = s => { let t = String(s).replace(/[۰-۹]/g, c => '۰۱۲۳۴۵۶۷۸۹'.indexOf(c)).replace(/[٠-٩]/g, c => '٠١٢٣٤٥٦٧٨٩'.indexOf(c)).replace(/[٬,\s]/g, '').replace(/٫/g, '.').replace(/[−–]/g, '-').replace(/٪|%/g, '').trim(); return /^[-+]?\d*\.?\d+$/.test(t) ? parseFloat(t) : null; };
function scrapeScreen() {
  const main = $('main'); if (!main) return null;
  const sections = [{ head: '', rows: [] }]; let title = tr($('main h2')?.textContent || 'report'), cur = sections[0];
  const stamp = tr($('main .stamp')?.textContent || '');
  main.querySelectorAll('h3, dl.facts > div, button.row, div.row, .warn, .ok, table tr').forEach(el => {
    if (el.matches('h3')) { cur = { head: el.textContent.trim(), rows: [] }; sections.push(cur); }
    else if (el.matches('dl.facts > div')) cur.rows.push([el.querySelector('dt')?.textContent.trim(), el.querySelector('dd')?.textContent.trim()]);
    else if (el.matches('.row')) { const t = el.querySelector('.t'), s = el.querySelector('.s'); const tt = t ? [...t.childNodes].filter(n => n !== s && !(n.classList && n.classList.contains('badge'))).map(n => n.textContent).join('').trim() : el.textContent.trim(); cur.rows.push([tt, s?.textContent.trim() || '', el.querySelector('b')?.textContent.trim() || '']); }
    else if (el.matches('tr')) cur.rows.push([...el.children].map(c => c.textContent.trim()));
    else cur.rows.push([el.textContent.trim()]);
  });
  return { title, stamp, sections: sections.filter(s => s.head || s.rows.length) };
}
async function exportExcel() {
  if (!can('export')) return toast('اجازه این کار را ندارید');
  const S = scrapeScreen(); if (!S || !S.sections.length) return toast('چیزی برای خروجی نیست');
  const rows = [[{ s: S.title, st: 3 }]]; if (S.stamp) rows.push([S.stamp]); rows.push([tr('شرکت') + ': ' + (company?.name || '')], [tr('تاریخ خروجی') + ': ' + tr(fmtDay(todayISO()))], []);
  for (const sec of S.sections) {
    if (sec.head) rows.push([{ s: sec.head, st: 1 }]);
    const start = rows.length; let numRows = 0;
    for (const r of sec.rows) { rows.push(r.map((c, i) => { if (c === undefined || c === '') return ''; const n = i > 0 ? numOf(c) : null; return n !== null && !/[آ-ی]/.test(c.replace(/[٬٫]/g, '')) ? n : c; })); if (typeof rows[rows.length - 1][2] === 'number') numRows++; }
    if (numRows >= 2) { const col = 'C', end = rows.length; let sum = 0; for (let i = start; i < end; i++) if (typeof rows[i][2] === 'number') sum += rows[i][2]; rows.push([{ s: tr('جمع کل'), st: 1 }, '', { f: `SUM(${col}${start + 1}:${col}${end})`, v: sum, st: 2 }]); }
    rows.push([]);
  }
  const rt = X.prefs.lang === 'fa';
  const tl = rows.map(r => r.map(c => typeof c === 'object' && c && c.s !== undefined ? { ...c, s: tr(c.s) } : typeof c === 'string' ? tr(c) : c));
  await saveBlob(`${S.title.replace(/[^\w\u0600-\u06FF]+/g, '_').slice(0, 40)}-${todayISO()}.xlsx`, buildXlsx(tr(S.title), tl, { rtl: rt, widths: [38, 26, 20] }));
  await log('خروجی Excel', '', '', S.title); toast('فایل Excel آماده شد');
}
async function exportPdf() {
  if (!can('export')) return toast('اجازه این کار را ندارید');
  const main = $('main'); if (!main) return;
  toast('در حال ساخت PDF…');
  const W = 720, css = await (await fetch('style.css')).text();
  const box = document.createElement('div'); box.style.cssText = `width:${W}px;background:#fff;color:#2B2F36;padding:20px;box-sizing:border-box;font-family:Vazirmatn,'Noto Sans Arabic',Tahoma,sans-serif;line-height:1.7`; box.setAttribute('dir', document.documentElement.dir);
  const st = document.createElement('style'); st.textContent = css + '.fab,.btn,.back,form,button.alt,.sheetbtn{display:none!important}.row{border-bottom:1px solid #ddd}main{overflow:visible}'; box.appendChild(st);
  const br = typeof brandOf === 'function' ? await brandOf() : null, accent = (typeof THEMES !== 'undefined' && THEMES[X.prefs.theme]?.[0]) || '#E8590C';
  const head = document.createElement('div'); head.innerHTML = `${br?.logo ? `<img src="${br.logo}" alt="" style="max-height:56px;max-width:180px;display:block;margin-bottom:6px">` : ''}<h1 style="font-size:20px;margin:0 0 4px;color:${accent}">${esc(company?.name || '')}</h1><div style="color:#666;font-size:13px">${esc(tr('تاریخ خروجی'))}: ${esc(tr(fmtDay(todayISO())))}</div>`; box.appendChild(head);
  const body = main.cloneNode(true); body.querySelectorAll('input,select,textarea,.fab,.btn,.back').forEach(e => e.remove()); body.style.cssText = 'padding:8px 0;overflow:visible;height:auto'; box.appendChild(body);
  if (br && (br.footer || br.stamp || br.sign)) { const isDoc = ui.tab === 'ops' && ui.op && (ui.op.kind === 'sale' || ui.op.kind === 'purchase') && ui.op.id; const ft = document.createElement('div'); ft.style.cssText = 'margin-top:18px;border-top:1px solid #ddd;padding-top:10px;font-size:12px;color:#555'; ft.innerHTML = (isDoc && (br.stamp || br.sign) ? `<div style="display:flex;gap:24px;justify-content:flex-end;align-items:center;margin-bottom:8px">${br.sign ? `<img src="${br.sign}" alt="" style="max-height:70px">` : ''}${br.stamp ? `<img src="${br.stamp}" alt="" style="max-height:90px">` : ''}</div>` : '') + esc(br.footer || ''); box.appendChild(ft); }
  box.style.cssText += ';position:fixed;left:-9999px;top:0'; document.body.appendChild(box); const H = box.scrollHeight; document.body.removeChild(box); box.style.cssText = `width:${W}px;background:#fff;color:#2B2F36;padding:20px;box-sizing:border-box;font-family:Vazirmatn,'Noto Sans Arabic',Tahoma,sans-serif;line-height:1.7`;
  box.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  const xml = new XMLSerializer().serializeToString(box), svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><foreignObject x="0" y="0" width="100%" height="100%">${xml}</foreignObject></svg>`;
  const img = new Image(); await new Promise((ok, no) => { img.onload = ok; img.onerror = () => no(new Error('render')); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); });
  const SC = 2, ph = Math.round(W * 1.414), pages = [];
  for (let y = 0; y < H; y += ph) {
    const hh = Math.min(ph, H - y), cv = document.createElement('canvas'); cv.width = W * SC; cv.height = ph * SC;
    const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(img, 0, y, W, hh, 0, 0, W * SC, hh * SC);
    const d = cv.toDataURL('image/jpeg', 0.92).split(',')[1]; pages.push({ jpeg: b64u.dec(d.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')), w: cv.width, h: cv.height });
  }
  const t = ($('main h2')?.textContent || 'report').replace(/[^\w\u0600-\u06FF]+/g, '_').slice(0, 40);
  await saveBlob(`${t}-${todayISO()}.pdf`, buildPdf(pages)); await log('خروجی PDF', '', '', t); toast('فایل PDF آماده شد');
}

/* ---------- خواندن صفحه با صدا ---------- */
function speak(text) {
  try { if (!window.speechSynthesis) return toast('گوینده در این دستگاه نیست'); speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(String(text).slice(0, 3500)); u.lang = X.prefs.lang === 'fa' ? 'fa-IR' : 'en-US'; speechSynthesis.speak(u); } catch (e) { }
}
const readPage = () => speak(($('main h2')?.textContent || '') + '. ' + ($('main')?.innerText || ''));

/* ---------- واحدهای اندازه‌گیری آماده ---------- */
const STD_UNITS = [['کیلوگرم', 'kg'], ['گرم', 'g'], ['میلی‌گرم', 'mg'], ['تن', 't'], ['پوند', 'lb'], ['اونس', 'oz'], ['لیتر', 'L'], ['میلی‌لیتر', 'mL'], ['متر مکعب', 'm³'], ['گالن', 'gal'], ['بشکه (حجم)', 'bbl'], ['متر', 'm'], ['سانتی‌متر', 'cm'], ['میلی‌متر', 'mm'], ['کیلومتر', 'km'], ['اینچ', 'in'], ['فوت', 'ft'], ['یارد', 'yd'], ['متر مربع', 'm²'], ['سانتی‌متر مربع', 'cm²'], ['هکتار', 'ha'], ['عدد', 'عدد'], ['جفت', 'جفت'], ['دوجین', 'دوجین'], ['دست', 'دست'], ['ست', 'ست'], ['سری', 'سری'], ['قطعه', 'قطعه'], ['دستگاه', 'دستگاه'], ['بسته', 'بسته'], ['کارتن', 'کارتن'], ['جعبه', 'جعبه'], ['پالت', 'پالت'], ['کیسه', 'کیسه'], ['گونی', 'گونی'], ['بشکه', 'بشکه'], ['بطری', 'بطری'], ['قوطی', 'قوطی'], ['رول', 'رول'], ['کلاف', 'کلاف'], ['شاخه', 'شاخه'], ['ورق', 'ورق'], ['تخته', 'تخته'], ['طاقه', 'طاقه'], ['ساعت', 'h'], ['دقیقه', 'min'], ['روز', 'روز'], ['ماه', 'ماه'], ['نفر-ساعت', 'نفر-ساعت'], ['ساعت ماشین', 'ساعت ماشین'], ['کیلووات‌ساعت', 'kWh'], ['کیلووات', 'kW'], ['مگاوات‌ساعت', 'MWh'], ['مگاجول', 'MJ'], ['درجه سانتی‌گراد', '°C'], ['درصد', '%']];
async function seedUnits(force) {
  if (!me || !company || !can('create')) return 0;
  const key = 'unitsSeeded:' + company.id; if (!force && await getMeta(key)) return 0;
  const have = new Set((await all('units')).filter(u => u.companyId === company.id && !u.voided).map(u => u.name)); let n = 0; const now = new Date().toISOString();
  for (const [name, symbol] of STD_UNITS) if (!have.has(name)) { await put('units', { id: uid(), companyId: company.id, name, symbol, std: true, createdAt: now, updatedAt: now, createdBy: me.id, updatedBy: me.id, syncStatus: 'pending', voided: false }); n++; }
  await setMeta(key, { at: now, n }); return n;
}

/* ---------- دسترسی‌پذیری ---------- */
let a11yN = 0;
function enhanceA11y() {
  const hd = $('header.top'), mn = $('main'), nv = $('nav.bar'); if (!mn) return;
  hd?.setAttribute('role', 'banner'); mn.setAttribute('role', 'main'); mn.setAttribute('aria-label', tr($('main h2')?.textContent || 'main'));
  nv?.setAttribute('role', 'navigation'); nv?.setAttribute('aria-label', tr('ناوبری اصلی'));
  nv?.querySelectorAll('button').forEach(b => { const ic = b.querySelector('b'); ic?.setAttribute('aria-hidden', 'true'); b.setAttribute('aria-label', tr([...b.childNodes].filter(n => n !== ic).map(n => n.textContent).join('').trim())); if (b.classList.contains('on')) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  document.querySelectorAll('main label:not(.chk)').forEach(l => {
    const nx = l.nextElementSibling; if (!nx) return; if (!l.id) l.id = 'lb' + (++a11yN);
    if (nx.matches('input,select,textarea')) { if (!nx.id) nx.id = 'in' + (++a11yN); l.htmlFor = nx.id; }
    else if (nx.classList.contains('dt')) { nx.setAttribute('role', 'group'); nx.setAttribute('aria-labelledby', l.id); const c = nx.querySelectorAll('input,select'); ['سال', 'ماه', 'روز'].forEach((n, i) => c[i] && c[i].setAttribute('aria-label', tr(n))); }
  });
  document.querySelectorAll('.err').forEach(e => e.setAttribute('role', 'alert'));
  document.querySelectorAll('.warn,.ok').forEach(e => e.setAttribute('role', 'status'));
  document.querySelectorAll('.back').forEach(b => b.setAttribute('aria-label', tr('بازگشت')));
  document.querySelectorAll('.fab').forEach(b => b.setAttribute('role', 'button'));
  const t = $('#toast'); t?.setAttribute('aria-live', 'polite');
  const key = stateKey(); if (key !== X.lastKey) { X.lastKey = key; const h = $('main h2'); if (h) { h.setAttribute('tabindex', '-1'); try { h.focus({ preventScroll: true }); } catch (e) { } } if (X.prefs.speak) speak(h?.textContent || ''); }
}
function stateKey() {
  if (!me) return company ? 'auth' : 'setup';
  if (ui.page) return 'p:' + ui.page;
  if (ui.tab === 'base') return ui.formId !== undefined ? 'form' : ui.ent ? 'list' : 'base';
  if (ui.tab === 'ops') return ui.op ? ui.op.kind + (ui.op.id !== undefined ? '+' : '') : 'ops';
  return ui.tab;
}

/* ---------- امنیت ---------- */
window.addEventListener('submit', e => e.preventDefault(), true);
document.addEventListener('contextmenu', e => { if (e.target.closest('.secure')) e.preventDefault(); });
document.addEventListener('copy', e => { if (e.target.closest && e.target.closest('.secure')) e.preventDefault(); });
let lockTimer = 0;
function activity() { clearTimeout(lockTimer); if (me && X.prefs && X.prefs.autolock > 0) lockTimer = setTimeout(autoLogout, X.prefs.autolock * 60000); }
async function autoLogout() { if (!me) return; X.vaultKey = null; await log('خروج خودکار', 'users', me.id, 'عدم فعالیت'); me = null; company = null; ui.page = null; ui.op = null; render(); }
['click', 'keydown', 'touchstart'].forEach(ev => document.addEventListener(ev, activity, { passive: true }));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) X.hiddenAt = Date.now();
  else if (X.hiddenAt) { const away = Date.now() - X.hiddenAt; X.hiddenAt = 0; if (away > 30000) X.vaultKey = null; if (me && X.prefs.autolock > 0 && away > X.prefs.autolock * 60000) autoLogout(); }
});
