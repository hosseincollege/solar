'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, Clipboard, Download, RotateCcw, Save, Sun, Trash2 } from 'lucide-react';

type State = 'down' | 'unreachable';
type Entry = { site: string; equipment: string; state: State; source: string };
type Report = { id: string; createdAt: string; entries: Entry[]; downText: string; unreachableText: string };
const STORAGE_KEY = 'solar.reports.v1';
const DRAFT_KEY = 'solar.draft.v1';

function parseList(text: string, state: State): Entry[] {
  const entries: Entry[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^(down|unreachable)$/i.test(line)) continue;
    const rahcom = line.match(/Rahcom\s*\(([^)]+)\)/i);
    const site = line.match(/\d{3}[A-Z]\d{5}/i)?.[0]?.toUpperCase();
    if (!site) continue;
    const equipmentToken = rahcom?.[1] ?? '';
    const equipment = equipmentToken.match(/^(LTE-[12])(?:-|$)/i)?.[1]
      ?? equipmentToken.match(/^(.+?)-ESF/i)?.[1]
      ?? equipmentToken.split('-')[0]
      ?? 'WLP2P';
    entries.push({ site, equipment: equipment.toUpperCase() || 'WLP2P', state, source: line });
  }
  return entries;
}

function formatTime(date: string) {
  return new Intl.DateTimeFormat('fa-IR-u-ca-persian', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(date));
}

export default function Home() {
  const [downText, setDownText] = useState('');
  const [unreachableText, setUnreachableText] = useState('');
  const [reports, setReports] = useState<Report[]>([]);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState('');
  const entries = useMemo(() => [...parseList(downText, 'down'), ...parseList(unreachableText, 'unreachable')], [downText, unreachableText]);

  useEffect(() => {
    try {
      const savedReports = localStorage.getItem(STORAGE_KEY);
      const draft = localStorage.getItem(DRAFT_KEY);
      if (savedReports) setReports(JSON.parse(savedReports) as Report[]);
      if (draft) {
        const parsed = JSON.parse(draft) as { downText?: string; unreachableText?: string };
        setDownText(parsed.downText ?? '');
        setUnreachableText(parsed.unreachableText ?? '');
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(DRAFT_KEY);
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ downText, unreachableText }));
  }, [downText, unreachableText, ready]);

  function saveReport() {
    if (entries.length === 0) {
      setNotice('مورد قابل‌نمایشی پیدا نشد؛ متن ورودی را بررسی کن.');
      return;
    }
    const report: Report = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), entries, downText, unreachableText };
    const updated = [report, ...reports];
    setReports(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    setNotice('گزارش در همین مرورگر ذخیره شد.');
  }

  function restoreReport(report: Report) {
    setDownText(report.downText);
    setUnreachableText(report.unreachableText);
    setNotice('گزارش برای ویرایش بارگذاری شد.');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function deleteReport(id: string) {
    const updated = reports.filter((report) => report.id !== id);
    setReports(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  }

  function clearInputs() {
    setDownText('');
    setUnreachableText('');
    setNotice('ورودی‌ها پاک شدند.');
  }

  async function copyTable() {
    const rows = [['کد سامانه', 'تجهیز', 'وضعیت'], ...entries.map(({ site, equipment, state }) => [site, equipment, state === 'down' ? 'قطع' : 'غیرقابل دسترس'])];
    await navigator.clipboard.writeText(rows.map((row) => row.join('\t')).join('\n'));
    setNotice('جدول در کلیپ‌بورد کپی شد.');
  }

  function downloadCsv() {
    const rows = [['کد سامانه', 'تجهیز', 'وضعیت'], ...entries.map(({ site, equipment, state }) => [site, equipment, state === 'down' ? 'قطع' : 'غیرقابل دسترس'])];
    const csv = '\uFEFF' + rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `solar-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return <main className="page">
    <header className="hero">
      <div className="brand-mark"><Sun size={25} strokeWidth={1.8} /></div>
      <div><p className="eyebrow">ابزار مستقل پایش</p><h1>وضعیت سولار</h1><p className="subtitle">دو فهرست را جای‌گذاری کن؛ جدول وضعیت همان لحظه ساخته می‌شود.</p></div>
      <span className="local-badge">ذخیره‌سازی محلی</span>
    </header>

    <section className="input-grid" aria-label="ورودی فهرست‌ها">
      <label className="input-card down-card"><span className="field-title"><i className="status-dot down-dot" />فهرست قطع (Down)</span><textarea value={downText} onChange={(event) => setDownText(event.target.value)} placeholder={'DOWN\nRahcom (LTE-1-...) (...) (...)'} spellCheck={false} /></label>
      <label className="input-card unreachable-card"><span className="field-title"><i className="status-dot unreachable-dot" />فهرست غیرقابل‌دسترس (Unreachable)</span><textarea value={unreachableText} onChange={(event) => setUnreachableText(event.target.value)} placeholder={'Unreachable\nRahcom (CAM-1-...) (...) (...)'} spellCheck={false} /></label>
    </section>

    <section className="table-card">
      <div className="table-heading"><div><h2>پیش‌نمایش جدول</h2><p>{entries.length.toLocaleString('fa-IR')} ردیف شناسایی‌شده</p></div><div className="actions">
        <button className="button button-quiet" type="button" onClick={clearInputs}><RotateCcw size={16} />پاک‌کردن</button>
        <button className="button button-quiet" type="button" onClick={() => void copyTable()} disabled={!entries.length}><Clipboard size={16} />کپی جدول</button>
        <button className="button button-quiet" type="button" onClick={downloadCsv} disabled={!entries.length}><Download size={16} />خروجی CSV</button>
        <button className="button button-primary" type="button" onClick={saveReport}><Save size={16} />ذخیره گزارش</button>
      </div></div>
      {notice && <p className="notice" role="status"><Check size={15} />{notice}</p>}
      <div className="table-scroll"><table><thead><tr><th>ردیف</th><th>کد سامانه</th><th>تجهیز</th><th>وضعیت</th><th>متن منبع</th></tr></thead><tbody>
        {entries.length ? entries.map((entry, index) => <tr key={`${entry.state}-${entry.site}-${entry.equipment}-${index}`}><td>{(index + 1).toLocaleString('fa-IR')}</td><td className="code" dir="ltr">{entry.site}</td><td className="code" dir="ltr">{entry.equipment}</td><td><span className={`state-pill ${entry.state}`}><i className={`status-dot ${entry.state === 'down' ? 'down-dot' : 'unreachable-dot'}`} />{entry.state === 'down' ? 'قطع' : 'غیرقابل‌دسترس'}</span></td><td className="source" dir="auto">{entry.source}</td></tr>) : <tr><td className="empty" colSpan={5}>برای ساخت جدول، فهرست‌ها را در کادرهای بالا جای‌گذاری کن.</td></tr>}
      </tbody></table></div>
    </section>

    <section className="history-card"><div className="history-title"><div><h2>گزارش‌های ذخیره‌شده</h2><p>گزارش‌ها فقط در همین مرورگر باقی می‌مانند.</p></div><span className="count">{reports.length.toLocaleString('fa-IR')}</span></div>
      {reports.length ? <ul className="report-list">{reports.map((report) => <li key={report.id}><button type="button" className="report-main" onClick={() => restoreReport(report)}><span>{formatTime(report.createdAt)}</span><small>{report.entries.length.toLocaleString('fa-IR')} ردیف</small></button><button type="button" className="icon-button" aria-label="حذف گزارش" title="حذف گزارش" onClick={() => deleteReport(report.id)}><Trash2 size={17} /></button></li>)}</ul> : <p className="empty-history">هنوز گزارشی ذخیره نشده است.</p>}
    </section>
    <footer>این ابزار مستقل است؛ داده‌ها در فضای ذخیره‌سازی مرورگر شما نگه‌داری می‌شوند.</footer>
  </main>;
}
