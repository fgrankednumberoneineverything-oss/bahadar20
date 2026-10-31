'use strict';
/* مغایرت‌گیری و دفاتر اکسل */
const RECON = { findings: [], entries: [] };

async function reconEntries() {
  const accounts = await rows('accounts'), journals = await rows('journals');
  RECON.accounts = accounts;
  return Reconcile.fromAppData(journals, accounts, g2j);
}
async function reconView() {
  const f = RECON.findings, fixable = f.filter(x => x.fix).length;
  return `${back('opBack')}<h2>مغایرت‌گیری و دفاتر اکسل</h2>
  <button class="btn" data-act="reconRun">بررسی اسناد سال</button>
  <button class="btn alt" data-act="reconExport">خروجی اکسل: روزنامه + دفتر کل + تراز</button>
  ${RECON.ran ? (f.length ? `<p class="warn">${fmt(f.length, 0)} مورد پیدا شد؛ ${fmt(fixable, 0)} مورد قابل اصلاح خودکار.</p>
    ${f.slice(0, 200).map(x => `<label class="row"><input type="checkbox" class="rf" value="${x.id}" ${x.fix ? 'checked' : 'disabled'}><span class="t">سند ${esc(x.no)} — ${esc(x.message)}<span class="s">${esc(x.rule)}${x.fix ? ' ← اصلاح: ' + esc(x.fix.type) : ' ← دستی'}</span></span></label>`).join('')}
    ${fixable && can('post') ? '<button class="btn" data-act="reconApply">اعمال اصلاح‌های انتخاب‌شده</button>' : ''}`
    : '<p class="ok">هیچ مغایرتی پیدا نشد ✓</p>') : ''}`;
}
ACT.reconRun = async () => {
  RECON.entries = await reconEntries();
  const chart = {}; RECON.accounts.forEach(a => { chart[a.code] = a.name; });
  RECON.findings = Reconcile.checkEntries(RECON.entries.filter(e => (e.kind !== 'reversal' && e.status !== 'voided')), { chart, allNos: RECON.entries.map(e => e.no) });
  RECON.ran = true; render();
};
/* اصلاح = ابطال سند قدیم با سند معکوس + ثبت سند اصلاح‌شده (قاعده‌ی «ابطال، نه حذف»).
   هر سند در تراکنش جدا ذخیره می‌شود تا شماره‌ی سند (nextNo) تکراری نشود. */
ACT.reconApply = async () => {
  if (!can('post')) return err('اجازه «ثبت و تأیید اسناد» را ندارید.');
  const ids = [...document.querySelectorAll('.rf:checked')].map(x => x.value);
  if (!ids.length) return toast('موردی انتخاب نشده');
  const res = Reconcile.applyFixes(RECON.entries, RECON.findings, ids), codeToAcc = {};
  RECON.accounts.forEach(a => { codeToAcc[a.code] = a.id; });
  let done = 0;
  try {
    for (const no of res.touched) {
      const e = res.entries.find(x => x.no === no), old = RECON.entries.find(x => x.no === no);
      if (!old.appId) continue;
      const lines = e.lines.map(l => ({ accountId: codeToAcc[l.acc], debit: l.debit, credit: l.credit, party: l.party }));
      const rev = await reverseJ(old.appId, 'اصلاح مغایرت');
      await putMany(rev);                                             // ۱) ابطال سند قدیم
      const j0 = (await get('journals', old.appId));
      const nj = await makeJournal({ date: j0.date, desc: (old.description || '') + ' (اصلاح مغایرت سند ' + j0.number + ')', lines, kind: j0.kind, source: { type: 'recon', id: j0.id, no: j0.number } });
      await putMany([...nj.entries, ['audit', auditRec('اصلاح مغایرت', 'journals', j0.id, JSON.stringify(res.log.filter(l => l.no === no).map(l => l.rule)))]]);   // ۲) سند جدید + سابقه
      done++;
    }
    toast(done + ' سند اصلاح شد'); await ACT.reconRun();
  } catch (e) { err('اصلاح متوقف شد: ' + e.message); }
};
ACT.reconExport = async () => {
  if (!can('reports')) return err('اجازه «مشاهده گزارش‌ها» را ندارید.');
  if (typeof ExcelJS === 'undefined') return err('کتابخانه خروجی Excel در این نسخه همراه برنامه نیست؛ برنامه را با ساخت کامل (GitHub Actions) بسازید.');
  try {
    const entries = await reconEntries(), chart = {}; RECON.accounts.forEach(a => { chart[a.code] = a.name; });
    const live = entries.filter(e => (e.kind !== 'reversal' && e.status !== 'voided'));
    const findings = Reconcile.checkEntries(live, { chart, allNos: entries.map(e => e.no) });
    const wb = ExcelReports.buildWorkbook(ExcelJS, live, { chart, company: company.name, year: String((await rows('fiscalYears')).sort((a, b) => b.start.localeCompare(a.start))[0]?.name || ''), findings });
    await ExcelReports.saveXlsx(wb, 'دفاتر_' + company.name + '_' + todayISO() + '.xlsx');
  } catch (e) { err('خروجی ساخته نشد: ' + e.message); }
};
