/* excel-reports.js — خروجی اکسل «دفتر روزنامه + دفتر کل + تراز آزمایشی» به شکل فرم‌های واقعی
   نیازمند ExcelJS (فایل exceljs.min.js را کنار app.js بگذار و پیش از آن در index.html بیاور).
   چیدمان دقیقاً معادل ledger_export_reference.py است. هر سلول محاسباتی فرمول زنده + مقدار کش‌شده (result) دارد
   تا پیش‌نمایش گوشی هم عددها را نشان دهد. ورودی: entries با همان شکل reconcile.js */
(function (root) {
  'use strict';
  const X = {};
  const PAGE_ROWS = 30, NUM = '#,##0;[Red]-#,##0;"-"';
  const thin = { style: 'thin', color: { argb: 'FF000000' } }, hair = { style: 'hair', color: { argb: 'FF808080' } };
  const BOX = { left: thin, right: thin, top: thin, bottom: thin }, LINE = { left: thin, right: thin, top: hair, bottom: hair };
  const fill = argb => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
  const HDR = fill('FFD9D9D9'), TOT = fill('FFEFEFEF');
  const font = (o = {}) => ({ name: 'Arial', size: 10, ...o });
  const CEN = { horizontal: 'center', vertical: 'middle', wrapText: true, readingOrder: 'rtl' };
  const SHR = { horizontal: 'right', vertical: 'middle', shrinkToFit: true, readingOrder: 'rtl' };
  const NUMAL = { horizontal: 'right', vertical: 'middle' };
  const col = n => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  const q = t => "'" + t.replace(/'/g, "''") + "'";
  const safeName = (s, used) => { let n = s.replace(/[\\/?*\[\]:]/g, '-').slice(0, 31), k = 1; while (used.has(n)) n = s.slice(0, 28) + '~' + (k++); used.add(n); return n; };

  function sheetBase(wb, name, { landscape = false, titles, tab } = {}) {
    return wb.addWorksheet(name, {
      views: [{ rightToLeft: true }],
      properties: tab ? { tabColor: { argb: tab } } : {},
      pageSetup: { paperSize: 9, orientation: landscape ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: titles, horizontalCentered: true,
        margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.6, header: 0.3, footer: 0.3 } },
      headerFooter: { oddFooter: '&C&9صفحه &P از &N' } });
  }
  function title(ws, text, sub, n) {
    ws.mergeCells(1, 1, 2, n); Object.assign(ws.getCell(1, 1), { value: text, font: font({ size: 18, bold: true }), alignment: CEN });
    ws.mergeCells(3, 1, 3, n); Object.assign(ws.getCell(3, 1), { value: sub, font: font(), alignment: CEN });
  }
  const style = (c, o) => { if (o.font) c.font = o.font; if (o.fill) c.fill = o.fill; if (o.border) c.border = o.border; if (o.align) c.alignment = o.align; if (o.fmt) c.numFmt = o.fmt; };

  /* ─────────── دفتر روزنامه ─────────── */
  function journalSheet(wb, entries, company, year) {
    const ws = sheetBase(wb, 'دفتر روزنامه', { titles: '1:5' }), n = 7;
    [9, 5, 5, 48, 9, 21, 21].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    title(ws, 'دفتر روزنامه', `${company} — سال مالی ${year}`, n);
    ['شماره سند', 'تاریخ', null, 'شرح', 'عطف', 'بدهکار (ریال)', 'بستانکار (ریال)'].forEach((h, i) => { if (h) ws.getCell(4, i + 1).value = h; });
    ws.getCell(5, 2).value = 'روز'; ws.getCell(5, 3).value = 'ماه';
    ws.mergeCells('B4:C4'); [1, 4, 5, 6, 7].forEach(c => ws.mergeCells(4, c, 5, c));
    for (let r = 4; r <= 5; r++) for (let c = 1; c <= n; c++) style(ws.getCell(r, c), { font: font({ bold: true }), fill: HDR, border: BOX, align: CEN });
    const flat = []; entries.forEach(e => e.lines.forEach((l, k) => flat.push([e, l, k === 0])));
    let row = 6, page = 0, i = 0, prev = null, cumD = 0, cumC = 0;
    while (i < flat.length || page === 0) {
      page++;
      const carry = row; ws.getCell(row, 4).value = page > 1 ? 'منقول از صفحه قبل' : 'ابتدای دفتر';
      ws.getCell(row, 6).value = prev ? { formula: `F${prev}`, result: cumD } : 0; ws.getCell(row, 7).value = prev ? { formula: `G${prev}`, result: cumC } : 0;
      row++; const start = row; let pd = 0, pc = 0;
      flat.slice(i, i + PAGE_ROWS).forEach(([e, l, first]) => {
        if (first) { ws.getCell(row, 1).value = e.no; ws.getCell(row, 2).value = e.day; ws.getCell(row, 3).value = e.mon; }
        ws.getCell(row, 4).value = (l.debit ? '' : '        ') + (l.desc || '');
        ws.getCell(row, 5).value = /^\d+$/.test(String(l.acc)) ? Number(l.acc) : l.acc;
        if (l.debit) { ws.getCell(row, 6).value = l.debit; pd += l.debit; }
        if (l.credit) { ws.getCell(row, 7).value = l.credit; pc += l.credit; }
        row++;
      });
      i += PAGE_ROWS; row = start + PAGE_ROWS; const end = row - 1;
      ws.getCell(row, 4).value = 'جمع صفحه'; ws.getCell(row, 6).value = { formula: `SUM(F${start}:F${end})`, result: pd }; ws.getCell(row, 7).value = { formula: `SUM(G${start}:G${end})`, result: pc };
      const ps = row++; cumD += pd; cumC += pc;
      ws.getCell(row, 4).value = 'جمع منقول به صفحه بعد';
      ws.getCell(row, 6).value = { formula: `F${carry}+F${ps}`, result: cumD }; ws.getCell(row, 7).value = { formula: `G${carry}+G${ps}`, result: cumC };
      prev = row;
      for (let r = carry; r <= row; r++) for (let c = 1; c <= n; c++) {
        const cell = ws.getCell(r, c), special = r === carry || r >= ps;
        style(cell, { border: r >= start && r <= end ? LINE : BOX, font: font({ bold: r >= ps, italic: r === carry }), fill: special ? TOT : undefined,
          align: [1, 2, 3, 5].includes(c) ? CEN : [6, 7].includes(c) ? NUMAL : SHR, fmt: [6, 7].includes(c) ? NUM : undefined });
      }
      ws.getRow(row).addPageBreak(); row++;
    }
    ws.getCell(row, 4).value = 'جمع کل دفتر روزنامه'; ws.getCell(row, 6).value = { formula: `F${prev}`, result: cumD }; ws.getCell(row, 7).value = { formula: `G${prev}`, result: cumC };
    ws.getCell(row + 1, 4).value = 'کنترل تساوی (باید صفر باشد)'; ws.getCell(row + 1, 6).value = { formula: `F${row}-G${row}`, result: cumD - cumC };
    for (let r = row; r <= row + 1; r++) for (let c = 1; c <= n; c++) style(ws.getCell(r, c), { border: BOX, fill: TOT, font: font({ bold: true }), fmt: [6, 7].includes(c) ? NUM : undefined });
    ws.views = [{ rightToLeft: true, state: 'frozen', ySplit: 5 }];
    return { ws, range: [6, row - 2] };
  }

  /* ─────────── دفتر کل (یک برگه برای هر حساب) ─────────── */
  function ledgerSheets(wb, entries, chart, company, year) {
    const by = new Map(), used = new Set(['دفتر روزنامه', 'تراز آزمایشی و کنترل']), out = new Map();
    entries.forEach(e => e.lines.forEach(l => { const k = String(l.acc); (by.get(k) || by.set(k, []).get(k)).push([e, l]); }));
    [...by.keys()].sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).forEach(code => {
      const name = chart[code] || '', ws = sheetBase(wb, safeName(code + ' ' + name, used), { titles: '1:5' }), n = 9;
      [5, 5, 11, 44, 21, 21, 7, 21, 18].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
      ws.getColumn(9).hidden = true;
      title(ws, 'دفتر کل', `${company} — سال مالی ${year}`, n);
      ws.mergeCells(4, 1, 4, n); Object.assign(ws.getCell(4, 1), { value: `حساب: ${code} — ${name}`, font: font({ size: 11, bold: true }), alignment: { horizontal: 'right', vertical: 'middle', readingOrder: 'rtl' }, border: BOX });
      ['روز', 'ماه', 'شماره دفتر روزنامه', 'شرح', 'بدهکار (ریال)', 'بستانکار (ریال)', 'تشخیص', 'باقیمانده (ریال)', 'مانده جبری (کمکی)'].forEach((h, i) => { const c = ws.getCell(5, i + 1); c.value = h; style(c, { font: font({ bold: true }), fill: HDR, border: BOX, align: CEN }); });
      ws.getRow(5).height = 30;
      let r = 6, run = 0, sd = 0, sc = 0; const first = r, dc = v => (v > 0 ? 'بد' : v < 0 ? 'بس' : '--');
      by.get(code).forEach(([e, l]) => {
        ws.getCell(r, 1).value = e.day; ws.getCell(r, 2).value = e.mon; ws.getCell(r, 3).value = e.no;
        ws.getCell(r, 4).value = (l.desc || '').trim() + (l.party ? ' — ' + l.party : '');
        if (l.debit) ws.getCell(r, 5).value = l.debit; if (l.credit) ws.getCell(r, 6).value = l.credit;
        run += (l.debit || 0) - (l.credit || 0); sd += l.debit || 0; sc += l.credit || 0;
        ws.getCell(r, 9).value = { formula: r > first ? `I${r - 1}+E${r}-F${r}` : `E${r}-F${r}`, result: run };
        ws.getCell(r, 7).value = { formula: `IF(I${r}>0,"بد",IF(I${r}<0,"بس","--"))`, result: dc(run) };
        ws.getCell(r, 8).value = { formula: `ABS(I${r})`, result: Math.abs(run) }; r++;
      });
      const last = r - 1;
      ws.getCell(r, 4).value = 'جمع گردش و مانده';
      ws.getCell(r, 5).value = { formula: `SUM(E${first}:E${last})`, result: sd }; ws.getCell(r, 6).value = { formula: `SUM(F${first}:F${last})`, result: sc };
      ws.getCell(r, 9).value = { formula: `E${r}-F${r}`, result: sd - sc };
      ws.getCell(r, 7).value = { formula: `IF(I${r}>0,"بد",IF(I${r}<0,"بس","--"))`, result: dc(sd - sc) }; ws.getCell(r, 8).value = { formula: `ABS(I${r})`, result: Math.abs(sd - sc) };
      for (let rr = first; rr <= r; rr++) for (let c = 1; c <= n; c++) style(ws.getCell(rr, c), { border: rr === r ? BOX : LINE, font: font({ bold: rr === r }), fill: rr === r ? TOT : undefined,
        align: [1, 2, 3, 7].includes(c) ? CEN : [5, 6, 8, 9].includes(c) ? NUMAL : SHR, fmt: [5, 6, 8, 9].includes(c) ? NUM : undefined });
      ws.views = [{ rightToLeft: true, state: 'frozen', ySplit: 5 }];
      out.set(code, { title: ws.name, totalRow: r, d: sd, c: sc });
    });
    return out;
  }

  /* ─────────── تراز آزمایشی و کنترل ─────────── */
  function trialSheet(wb, led, chart, range, company, year) {
    const ws = sheetBase(wb, 'تراز آزمایشی و کنترل', { landscape: true, titles: '5:5', tab: 'FF1F5C4A' }), n = 10, [a, b] = range;
    title(ws, 'تراز آزمایشی و کنترل تطبیق دفتر کل با روزنامه', `${company} — سال مالی ${year} — ریال`, n);
    ['کد', 'نام حساب', 'گردش بدهکار (دفتر کل)', 'گردش بستانکار (دفتر کل)', 'گردش بدهکار (روزنامه)', 'گردش بستانکار (روزنامه)', 'مانده بدهکار', 'مانده بستانکار', 'کنترل', 'وضعیت']
      .forEach((h, i) => { const c = ws.getCell(5, i + 1); c.value = h; style(c, { font: font({ bold: true }), fill: HDR, border: BOX, align: CEN }); });
    [8, 38, 22, 22, 22, 22, 22, 22, 10, 11].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    let r = 6; const first = r; let T = [0, 0, 0, 0, 0, 0];
    for (const [code, L] of led) {
      const nm = q(L.title), bal = L.d - L.c;
      ws.getCell(r, 1).value = /^\d+$/.test(code) ? Number(code) : code;
      ws.getCell(r, 2).value = { text: chart[code] || '', hyperlink: `#${nm}!A1` };
      ws.getCell(r, 3).value = { formula: `${nm}!E${L.totalRow}`, result: L.d }; ws.getCell(r, 4).value = { formula: `${nm}!F${L.totalRow}`, result: L.c };
      ws.getCell(r, 5).value = { formula: `SUMIFS('دفتر روزنامه'!$F$${a}:$F$${b},'دفتر روزنامه'!$E$${a}:$E$${b},$A${r})`, result: L.d };
      ws.getCell(r, 6).value = { formula: `SUMIFS('دفتر روزنامه'!$G$${a}:$G$${b},'دفتر روزنامه'!$E$${a}:$E$${b},$A${r})`, result: L.c };
      ws.getCell(r, 7).value = { formula: `MAX(0,C${r}-D${r})`, result: Math.max(0, bal) }; ws.getCell(r, 8).value = { formula: `MAX(0,D${r}-C${r})`, result: Math.max(0, -bal) };
      ws.getCell(r, 9).value = { formula: `(C${r}-E${r})+(D${r}-F${r})`, result: 0 };
      ws.getCell(r, 10).value = { formula: `IF(ROUND(I${r},0)=0,"✔ برقرار","✘ مغایرت")`, result: '✔ برقرار' };
      T = [T[0] + L.d, T[1] + L.c, T[2] + L.d, T[3] + L.c, T[4] + Math.max(0, bal), T[5] + Math.max(0, -bal)]; r++;
    }
    const last = r - 1;
    ws.getCell(r, 2).value = 'جمع';
    [3, 4, 5, 6, 7, 8, 9].forEach((c, k) => { ws.getCell(r, c).value = { formula: `SUM(${col(c)}${first}:${col(c)}${last})`, result: c === 9 ? 0 : [T[0], T[1], T[2], T[3], T[4], T[5]][k] }; });
    ws.getCell(r, 10).value = { formula: `IF(AND(ROUND(C${r}-D${r},0)=0,ROUND(G${r}-H${r},0)=0,ROUND(I${r},0)=0),"✔ برقرار","✘ مغایرت")`, result: '✔ برقرار' };
    ws.getCell(r + 1, 2).value = 'کنترل تساوی (بدهکار − بستانکار)'; ws.getCell(r + 1, 3).value = { formula: `C${r}-D${r}`, result: T[0] - T[1] }; ws.getCell(r + 1, 7).value = { formula: `G${r}-H${r}`, result: T[4] - T[5] };
    for (let rr = first; rr <= r + 1; rr++) for (let c = 1; c <= n; c++) {
      const cell = ws.getCell(rr, c), link = c === 2 && rr < r;
      style(cell, { border: BOX, fill: rr >= r ? TOT : undefined, font: link ? font({ color: { argb: 'FF0563C1' }, underline: true }) : font({ bold: rr >= r }), fmt: c >= 3 && c <= 9 ? NUM : undefined });
    }
    ws.views = [{ rightToLeft: true, state: 'frozen', xSplit: 0, ySplit: 5 }];
    return ws;
  }

  /* ─────────── برگه‌ی گزارش مغایرت (خروجی reconcile.js) ─────────── */
  function findingsSheet(wb, findings) {
    const ws = sheetBase(wb, 'گزارش مغایرت', { titles: '3:3', tab: 'FFC00000' });
    ws.mergeCells(1, 1, 1, 5); Object.assign(ws.getCell(1, 1), { value: 'گزارش مغایرت‌گیری', font: font({ size: 16, bold: true }), alignment: CEN });
    ['شدت', 'قاعده', 'شماره سند', 'شرح مغایرت', 'اصلاح پیشنهادی'].forEach((h, i) => { const c = ws.getCell(3, i + 1); c.value = h; style(c, { font: font({ bold: true }), fill: HDR, border: BOX, align: CEN }); });
    [9, 20, 11, 70, 24].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    const sev = { high: 'بالا', medium: 'متوسط', low: 'کم' };
    findings.forEach((f, i) => [sev[f.severity] || '', f.rule, f.no, f.message, f.fix ? f.fix.type : '— (دستی)'].forEach((v, c) => { const cell = ws.getCell(4 + i, c + 1); cell.value = v; style(cell, { border: LINE, font: font(), align: c === 3 ? SHR : CEN }); }));
    if (!findings.length) { ws.mergeCells(4, 1, 4, 5); Object.assign(ws.getCell(4, 1), { value: '✔ هیچ مغایرتی پیدا نشد', font: font({ bold: true, color: { argb: 'FF2E7D32' } }), alignment: CEN }); }
    ws.views = [{ rightToLeft: true, state: 'frozen', ySplit: 3 }];
  }

  /* ─────────── نقطه‌ی ورود ─────────── */
  X.buildWorkbook = function (ExcelJS, entries, { chart = {}, company = '', year = '', findings = null } = {}) {
    const wb = new ExcelJS.Workbook(); wb.creator = 'بهادار'; wb.created = new Date();
    const { range } = journalSheet(wb, entries, company, year);
    const led = ledgerSheets(wb, entries, chart, company, year);
    trialSheet(wb, led, chart, range, company, year);
    if (findings) findingsSheet(wb, findings);
    // تراز آزمایشی اول برگه‌ها باشد
    wb.views = [{ activeTab: 0 }];
    const order = ['تراز آزمایشی و کنترل', 'دفتر روزنامه'];
    wb._worksheets.sort((a, b) => { const ia = order.indexOf(a.name), ib = order.indexOf(b.name); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib); });
    return wb;
  };

  /* ذخیره و اشتراک‌گذاری فایل باینری (Base64) — مشابه saveFile ولی برای xlsx */
  X.saveXlsx = async function (wb, name) {
    const buf = await wb.xlsx.writeBuffer(), u8 = new Uint8Array(buf); let bin = '';
    for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    const b64 = btoa(bin), C = window.Capacitor, P = C && C.Plugins;
    if (C && C.isNativePlatform && C.isNativePlatform() && P && P.Filesystem && P.Share) {
      const r = await P.Filesystem.writeFile({ path: name, data: b64, directory: 'CACHE' });   // بدون encoding ⇒ Base64
      await P.Share.share({ title: name, url: r.uri, dialogTitle: 'ذخیره یا ارسال فایل اکسل' });
    } else {
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })); a.download = name; a.click();
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = X; else root.ExcelReports = X;
})(typeof window !== 'undefined' ? window : globalThis);
