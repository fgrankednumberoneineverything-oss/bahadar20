/* reconcile.js — موتور مغایرت‌گیری و اصلاح (توابع خالص؛ بدون DOM و بدون IndexedDB)
   شکل ورودی: entries = [{ no, day, mon, kind, lines:[{acc, desc, party, debit, credit}] }]
   همه‌ی مبلغ‌ها ریال صحیح. هیچ تابعی ورودی را تغییر نمی‌دهد. */
(function (root) {
  'use strict';
  const R = {};
  const num = x => { const n = Number(x); return Number.isFinite(n) ? n : 0; };
  const monthDays = (m, leap) => (m <= 6 ? 31 : m <= 11 ? 30 : (leap ? 30 : 29));
  const clone = o => JSON.parse(JSON.stringify(o));

  /* ───── بررسی سندها ───── */
  R.checkEntries = function (entries, opts = {}) {
    const tol = opts.tolerance ?? 10;              // اختلاف گرد‌کردن قابل اصلاح خودکار (ریال)
    const chart = opts.chart || null;              // { '101': 'نام حساب', ... }
    const F = []; let seq = 0;
    const add = (rule, severity, no, message, fix) => F.push({ id: 'F' + (++seq), rule, severity, no, message, fix: fix || null });
    const seen = new Map(), sig = new Map();

    for (const e of entries) {
      const L = e.lines || [];
      if (L.length < 2) add('FEW_LINES', 'high', e.no, 'سند کمتر از دو ردیف دارد.');
      let d = 0, c = 0;
      L.forEach((l, i) => {
        const de = num(l.debit), cr = num(l.credit);
        if (de < 0 || cr < 0) add('NEGATIVE', 'high', e.no, `ردیف ${i + 1}: مبلغ منفی است.`, { type: 'flipSign', line: i });
        else if (de && cr) add('BOTH_SIDES', 'high', e.no, `ردیف ${i + 1}: هم بدهکار هم بستانکار دارد.`, { type: 'netLine', line: i });
        else if (!de && !cr) add('ZERO_LINE', 'low', e.no, `ردیف ${i + 1}: مبلغ صفر است.`, { type: 'dropLine', line: i });
        if (chart && !chart[String(l.acc)]) add('UNKNOWN_ACCOUNT', 'high', e.no, `ردیف ${i + 1}: کد حساب ${l.acc} در کدینگ نیست.`);
        d += de; c += cr;
      });
      const diff = d - c;
      if (Math.abs(diff) > 0) {
        if (Math.abs(diff) <= tol) {
          // بزرگ‌ترین ردیف طرف مقابل را اصلاح می‌کنیم
          const side = diff > 0 ? 'credit' : 'debit';
          let idx = -1, best = -1; L.forEach((l, i) => { if (num(l[side]) > best) { best = num(l[side]); idx = i; } });
          add('ROUNDING', 'medium', e.no, `اختلاف گرد‌کردن ${Math.abs(diff)} ریال (بدهکار ${d} / بستانکار ${c}).`, { type: 'adjustLine', line: idx, side, delta: Math.abs(diff) });
        } else add('UNBALANCED', 'high', e.no, `جمع بدهکار (${d}) با بستانکار (${c}) برابر نیست؛ اختلاف ${diff}.`);
      }
      // تاریخ
      if (e.mon != null || e.day != null) {
        const m = num(e.mon), dd = num(e.day), mx = m >= 1 && m <= 12 ? monthDays(m, opts.leap) : 0;
        if (!mx) add('BAD_DATE', 'high', e.no, `ماه ${e.mon} نامعتبر است.`);
        else if (dd < 1 || dd > mx) add('BAD_DATE', 'medium', e.no, `روز ${e.day} در ماه ${m} معتبر نیست.`, { type: 'clampDate', day: Math.min(Math.max(dd, 1), mx) });
      } else add('BAD_DATE', 'medium', e.no, 'تاریخ سند خالی است.');
      // شماره
      if (seen.has(e.no)) add('DUP_NO', 'high', e.no, `شماره سند ${e.no} تکراری است.`); else seen.set(e.no, e);
      // ثبت احتمالاً تکراری (بدون اصلاح خودکار)
      if (e.kind === 'عادی' || e.kind == null) {
        const key = [e.mon, e.day, ...L.map(l => `${l.acc}:${num(l.debit)}:${num(l.credit)}:${l.party || ''}`)].join('|');
        if (sig.has(key) && L.length) add('POSSIBLE_DUPLICATE', 'low', e.no, `شبیه سند ${sig.get(key)} است (همان تاریخ، حساب‌ها و مبالغ).`); else sig.set(key, e.no);
      }
    }
    // شکاف شماره
    const nos = (opts.allNos || entries.map(e => e.no)).filter(Number.isInteger).sort((a, b) => a - b);
    for (let i = 1; i < nos.length; i++) for (let k = nos[i - 1] + 1; k < nos[i]; k++) add('GAP_NO', 'low', k, `شماره سند ${k} در توالی وجود ندارد.`);
    return F;
  };

  /* ───── اعمال اصلاح‌های انتخاب‌شده؛ خروجی: سندهای جدید + سابقه‌ی قبل/بعد ───── */
  R.applyFixes = function (entries, findings, ids) {
    const pick = new Set(ids), out = clone(entries), log = [];
    const byNo = new Map(out.map(e => [e.no, e]));
    const dropped = new Map();
    for (const f of findings) {
      if (!pick.has(f.id) || !f.fix) continue;
      const e = byNo.get(f.no); if (!e) continue;
      const before = clone(e), x = f.fix;
      if (x.type === 'adjustLine') { const l = e.lines[x.line]; l[x.side] = num(l[x.side]) + (x.side === 'credit' ? x.delta : x.delta); }
      else if (x.type === 'flipSign') { const l = e.lines[x.line], d = num(l.debit), c = num(l.credit); l.debit = c < 0 ? -c : (d > 0 ? d : 0); l.credit = d < 0 ? -d : (c > 0 ? c : 0); if (d < 0) { l.credit = -d; l.debit = 0; } else if (c < 0) { l.debit = -c; l.credit = 0; } }
      else if (x.type === 'netLine') { const l = e.lines[x.line], n = num(l.debit) - num(l.credit); l.debit = n > 0 ? n : 0; l.credit = n < 0 ? -n : 0; }
      else if (x.type === 'dropLine') { (dropped.get(e.no) || dropped.set(e.no, new Set()).get(e.no)).add(x.line); }
      else if (x.type === 'clampDate') e.day = x.day;
      log.push({ no: e.no, rule: f.rule, before, after: null, findingId: f.id });
    }
    for (const [no, set] of dropped) byNo.get(no).lines = byNo.get(no).lines.filter((_, i) => !set.has(i));
    const touched = new Set(log.map(l => l.no));
    log.forEach(l => { l.after = clone(byNo.get(l.no)); });
    return { entries: out, log, touched: [...touched] };
  };

  /* ───── تراز آزمایشی از سندها ───── */
  R.trialBalance = function (entries, kinds) {
    const T = {};
    for (const e of entries) {
      if (kinds && !kinds.includes(e.kind)) continue;
      for (const l of e.lines) { const t = T[l.acc] || (T[l.acc] = { acc: String(l.acc), debit: 0, credit: 0 }); t.debit += num(l.debit); t.credit += num(l.credit); }
    }
    return Object.values(T).sort((a, b) => a.acc.localeCompare(b.acc, 'en', { numeric: true }));
  };

  /* ───── مقایسه‌ی زیرحساب (کاردکس/کارت مشتری/…) با حساب کنترل ───── */
  R.controlCompare = function (entries, items, kinds) {
    // items: [{ name, accounts:['111'], expected: عدد, sign: 1 (بدهکار) | -1 (بستانکار) }]
    const tb = R.trialBalance(entries, kinds), bal = {};
    tb.forEach(t => { bal[t.acc] = t.debit - t.credit; });
    return items.map(it => {
      const gl = it.accounts.reduce((s, a) => s + (bal[a] || 0), 0) * (it.sign || 1);
      const diff = gl - it.expected;
      return { name: it.name, gl, expected: it.expected, diff, ok: Math.abs(diff) <= (it.tolerance ?? 1),
        // پیشنهاد سند تعدیل (فقط پیشنهاد؛ ثبت با تأیید کاربر)
        suggestion: Math.abs(diff) > (it.tolerance ?? 1) ? { accounts: it.accounts, amount: Math.abs(diff), direction: diff > 0 ? 'کاهش مانده دفتر' : 'افزایش مانده دفتر' } : null };
    });
  };

  /* ───── تطبیق سندهای یک ماژول با دفتر روزنامه‌ی اصلی بر پایه‌ی شماره سند ───── */
  R.compareModuleToMaster = function (master, moduleEntries, name) {
    const m = new Map(master.map(e => [e.no, e])), F = [];
    const sum = e => e.lines.reduce((s, l) => [s[0] + num(l.debit), s[1] + num(l.credit)], [0, 0]);
    for (const e of moduleEntries) {
      const t = m.get(e.no);
      if (!t) { F.push({ rule: 'MISSING_IN_MASTER', no: e.no, message: `سند ${e.no} (${name}) در دفتر روزنامه‌ی اصلی نیست.` }); continue; }
      const a = sum(e), b = sum(t);
      if (a[0] !== b[0] || a[1] !== b[1]) F.push({ rule: 'AMOUNT_DIFF', no: e.no, message: `سند ${e.no}: جمع در ${name} (${a[0]}) با دفتر اصلی (${b[0]}) فرق دارد.` });
    }
    return F;
  };

  /* ───── تبدیل داده‌ی برنامه (journals + accounts) به entries ───── */
  R.fromAppData = function (journals, accounts, g2j) {
    const acc = {}; accounts.forEach(a => { acc[a.id] = a; });
    return journals.filter(j => j.status === 'posted' || j.status === 'voided').map(j => {
      const [y, m, d] = j.date.split('-').map(Number), [, jm, jd] = g2j(y, m, d);
      return { no: j.no, day: jd, mon: jm, kind: j.kind || 'normal', status: j.status, appId: j.id, description: j.description || '',
        lines: j.lines.map(l => ({ acc: acc[l.accountId] ? acc[l.accountId].code : l.accountId, desc: (acc[l.accountId] || {}).name || '', party: l.party || '', debit: l.debit || 0, credit: l.credit || 0 })) };
    }).sort((a, b) => a.no - b.no);
  };

  /* ───── خواندن فایل اکسل سال (ExcelJS) به entries — ستون‌ها مثل برگه‌ی «دفتر روزنامه» ───── */
  R.entriesFromWorksheet = function (ws, firstRow = 6) {
    const val = c => { const v = c.value; return v && typeof v === 'object' && 'result' in v ? v.result : (v && v.richText ? v.richText.map(t => t.text).join('') : v); };
    const map = new Map(); let cur = null;
    ws.eachRow({ includeEmpty: false }, (row, i) => {
      if (i < firstRow) return;
      const no = val(row.getCell(2)); if (typeof no !== 'number') return;      // ستون B = شماره سند
      if (!map.has(no)) { cur = { no, day: val(row.getCell(3)), mon: val(row.getCell(4)), kind: val(row.getCell(11)), lines: [] }; map.set(no, cur); }
      cur = map.get(no);
      cur.lines.push({ acc: String(val(row.getCell(5))), desc: String(val(row.getCell(6)) || '').trim(), party: val(row.getCell(10)) || '', debit: num(val(row.getCell(7))), credit: num(val(row.getCell(8))) });
    });
    return [...map.values()];
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = R; else root.Reconcile = R;
})(typeof window !== 'undefined' ? window : globalThis);
