'use strict';
/* ورود شرکت از فایل داده (نمونه: شرکت دوغ آبعلی)
   فایل داده را اسکریپت build_dough_dataset.py از اکسل‌ها می‌سازد.
   یک شرکت جدید با همه‌ی اطلاعاتش اضافه می‌شود؛ اطلاعات شرکت‌های دیگر دست نمی‌خورد. */

const _backupViewImp = backupView;
backupView = async function () {
  return (await _backupViewImp()) + `<h3>ورود شرکت از فایل داده</h3>
  <p>یک شرکت جدید با همه‌ی اطلاعاتش (کدینگ، اسناد حسابداری، کالا، انبار، فاکتورها، تولید، چک‌ها) ساخته می‌شود. اطلاعات فعلی شما تغییر نمی‌کند.</p>
  <button class="btn" data-act="importDough">افزودن شرکت «دوغ آبعلی» (سال مالی ۱۴۰۵)</button>
  <input type="file" id="cf" accept=".json,application/json" style="display:none" data-change="importCompanyFile">
  <button class="btn alt" data-act="pickCompanyFile">انتخاب فایل داده شرکت (JSON)</button>
  <div id="cmsg"></div>`;
};

async function importCompanyData(D) {
  if (!me || !(me.isAdmin || can('backup'))) throw new Error('اجازه «پشتیبان و بازیابی» را ندارید.');
  if (!D || !D.meta || !D.company || !D.accounts) throw new Error('این فایل، فایل داده شرکت نیست.');
  const dup = (await all('companies')).find(c => !c.voided && c.importSource === D.meta.source);
  if (dup && !confirm('این شرکت قبلاً وارد شده است. یک نسخه‌ی تازه هم ساخته شود؟')) return null;

  const now = new Date().toISOString(), cid = uid(), idMap = new Map();
  const mapId = k => { let v = idMap.get(k); if (!v) { v = uid(); idMap.set(k, v); } return v; };
  const walk = v => typeof v === 'string' ? (v.length > 1 && v[0] === '~' ? mapId(v) : v)
    : Array.isArray(v) ? v.map(walk)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)])) : v;
  const base = { companyId: cid, createdAt: now, updatedAt: now, createdBy: me.id, updatedBy: me.id, syncStatus: 'pending', voided: false };
  const list = [], nodeName = {};
  for (const n of D.nodes || []) nodeName[n.id] = n.name;
  const add = (store, rec) => list.push([store, { ...base, ...walk(rec) }]);

  const companyRec = { ...base, id: cid, name: D.company.name, nationalId: D.company.nationalId || '', importSource: D.meta.source };
  list.push(['companies', companyRec]);
  for (const s of ['factories', 'units', 'items', 'nodes', 'parties', 'accounts', 'fiscalYears', 'boms', 'ohRates', 'ohActuals', 'activities', 'abcUsage', 'checks']) {
    for (const r of D[s] || []) add(s, r);
  }
  for (const r of D.journals || []) { const { numberPrefix, ...x } = r; add('journals', { ...x, number: (numberPrefix || 'س-') + devCode + r.no }); }
  for (const r of D.docs || []) { const { numberFull, ...x } = r; add('docs', { ...x, number: numberFull }); }
  for (const r of D.stockMoves || []) { const { whId, ...x } = r; add('stockMoves', { ...x, warehouseId: whId }); }
  for (const r of D.prodOrders || []) add('prodOrders', { ...r, lineName: nodeName[r.lineId] || '' });
  list.push(['meta', { id: 'acct:' + cid, value: { auto: true, map: walk(D.acctMap || {}) } }]);
  for (const [k, n] of Object.entries(D.seq || {})) list.push(['meta', { id: 'seq:' + cid + ':' + k.replace(/~fy:\d+/, m => mapId(m)), value: n }]);
  list.push(['meta', { id: 'importNotes:' + cid, value: { at: now, notes: D.notes || [] } }]);
  list.push(['audit', { ...auditRec('ورود داده شرکت', 'companies', cid, D.meta.title || D.company.name), companyId: cid }]);

  for (let i = 0; i < list.length; i += 400) await putMany(list.slice(i, i + 400));

  company = companyRec;
  if (!me.isAdmin) { me = touch({ ...me, companyIds: [...(me.companyIds || []), cid] }); await put('users', me); }
  await setMeta('currentCompany', cid);

  // سناریوها با موتور خود برنامه محاسبه می‌شوند
  let scn = 0;
  try {
    const bom = (await rows('boms'))[0], pool = (await rows('ohRates'))[0];
    for (const d of D.scenarioDefs || []) {
      const r = await scnCompute({ bomId: bom.id, volume: d.volume, matPct: d.matPct, labPct: d.labPct, effPct: d.effPct, scrap: '', ohMode: 'pool', ohId: pool.id, price: 1060000 });
      if (r.err) continue;
      const rec = newRec({ name: d.name, version: 1, productId: bom.productId, productName: bom.productName, bomId: bom.id, bomVersion: bom.version, calcAt: now, userName: me.name, recalcMode: recalc,
        assumptions: { volume: d.volume, matPct: d.matPct, labPct: d.labPct, effPct: d.effPct, scrap: r.scrap, ohMode: 'pool', ohName: pool.name, price: r.price }, result: r });
      await putMany([['scenarios', rec]]); scn++;
    }
  } catch (e) { console.warn('scenario import', e); }

  const counts = {};
  for (const [s] of list) counts[s] = (counts[s] || 0) + 1;
  counts.scenarios = scn;
  return { cid, counts, notes: D.notes || [] };
}

function importSummary(res) {
  const c = res.counts, n = x => fmt(x || 0, 0);
  return `<div class="ok">شرکت وارد شد و به آن رفتید.<br>
  حساب‌ها: ${n(c.accounts)} – اسناد حسابداری: ${n(c.journals)} – کالا: ${n(c.items)} – حرکت انبار: ${n(c.stockMoves)}<br>
  فاکتور خرید و فروش: ${n(c.docs)} – سفارش تولید: ${n(c.prodOrders)} – چک: ${n(c.checks)} – اشخاص: ${n(c.parties)} – سناریو: ${n(c.scenarios)}</div>
  <div class="warn"><b>فرض‌هایی که برای تکمیل اطلاعات اضافه شد:</b><ul>${res.notes.map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>`;
}

async function _runImport(getData, box) {
  box.innerHTML = '<div class="warn">در حال خواندن و ورود اطلاعات… چند ثانیه صبر کنید.</div>';
  try {
    const res = await importCompanyData(await getData());
    if (!res) { box.innerHTML = ''; return; }
    toast('شرکت وارد شد'); await render();
    $('main').insertAdjacentHTML('afterbegin', importSummary(res));
  } catch (e) { box.innerHTML = `<div class="err">ورود انجام نشد: ${esc(e.message)}</div>`; }
}
ACT.importDough = () => _runImport(async () => {
  const resp = await fetch('doogh-abali.json'); if (!resp.ok) throw new Error('فایل داده‌ی دوغ آبعلی در برنامه پیدا نشد.');
  return resp.json();
}, $('#cmsg'));
ACT.pickCompanyFile = () => $('#cf').click();
document.addEventListener('change', e => {
  const t = e.target.closest('[data-change="importCompanyFile"]'); if (!t || !t.files[0]) return;
  _runImport(async () => JSON.parse(await t.files[0].text()), $('#cmsg'));
});
