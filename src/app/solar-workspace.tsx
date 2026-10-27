'use client';

import Link from 'next/link';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, Check, ChevronLeft, ChevronRight, Clipboard, Download, Info, MapPin, Monitor, Moon, Plus, RotateCcw, Save, Search, Sun, Trash2, Upload, X } from 'lucide-react';
import * as XLSX from 'xlsx';
import demoData from '@/lib/solar-demo-data.json';

type State = 'down' | 'unreachable';
type Entry = { site: string; equipment: string; state: State; source: string };
type Report = { id: string; createdAt: string; entries: Entry[]; downText: string; unreachableText: string; specialText?: string; showSpecialSites?: boolean; equipmentColumns?: string[] };
type SiteRow = { site: string; states: Map<string, State> };
const STORAGE_KEY = 'solar.reports.v1';
const DRAFT_KEY = 'solar.draft.v1';
const SPECIAL_SITES_KEY = 'solar.special-sites.v1';
const EQUIPMENT_COLUMNS_VERSION = 2;
const EQUIPMENT_GROUPS = [
  { key: 'LTE', label: 'LTE', codes: ['LTE-1', 'LTE-2'] },
  { key: 'RTR-1', label: 'RTR-1', codes: ['RTR-1'] },
  { key: 'RTR-2', label: 'RTR-2', codes: ['RTR-2'] },
  { key: 'CAM-1', label: 'CAM-1', codes: ['CAM-1'] },
  { key: 'RAD-1', label: 'RAD-1', codes: ['RAD-1'] },
  { key: 'RAD-2', label: 'RAD-2', codes: ['RAD-2'] },
  { key: 'PC', label: 'PC', codes: ['PC'] },
  { key: 'RLY', label: 'RLY', codes: ['RLY'] },
  { key: 'RLY-1', label: 'RLY-1', codes: ['RLY-1'] },
  { key: 'WL-1', label: 'WL-1', codes: ['WL-1'] },
  { key: 'WLP2P', label: 'WLP2P', codes: ['WLP2P'] },
];
const DEFAULT_COLUMNS = ['LTE', 'RTR-1', 'CAM-1', 'RAD-1'];
const PROVINCE_NAMES: Record<string, string> = { ESF: 'اصفهان' };
const DEFAULT_SPECIAL_SITE_TEXT = [
  '062S13002\tسرقت و تخریب',
  '007E13025\tسرقت و تخریب',
  '062D13029\tتعریض و جابه‌جایی',
  '065E13005\tسرقت و تخریب',
  '065W13000\tتعریض و جابه‌جایی',
  '903N13004\tسرقت و تخریب',
].join('\n');
const SPECIAL_THEFT = 'سرقت و تخریب';
const SPECIAL_RELOCATION = 'تعریض و جابه‌جایی';

function parseList(text: string, state: State): Entry[] {
  const entries: Entry[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^(down|unreachable)$/i.test(line)) continue;
    const rahcom = line.match(/Rahcom\s*\(([^)]+)\)/i);
    const site = line.match(/\d{3}[A-Z]\d{5}/i)?.[0]?.toUpperCase();
    if (!site) continue;
    const equipmentToken = rahcom?.[1] ?? '';
    const knownEquipment = equipmentToken.match(/^(LTE-[12]|RTR-[12]|RAD-[12]|RLY-1|CAM-1|WL-1|WLP2P|RLY|PC)(?:-|$)/i)?.[1];
    const equipment = knownEquipment ?? equipmentToken.match(/^(.+?)-ESF/i)?.[1] ?? equipmentToken.split('-')[0] ?? 'WLP2P';
    entries.push({ site, equipment: equipment.toUpperCase() || 'WLP2P', state, source: line });
  }
  return entries;
}

function filterLtePairs(entries: Entry[]) {
  const pairs = new Map<string, Set<string>>();
  for (const entry of entries) if (/^LTE-[12]$/i.test(entry.equipment)) {
    const pair = pairs.get(entry.site) ?? new Set<string>();
    pair.add(entry.equipment.toUpperCase());
    pairs.set(entry.site, pair);
  }
  return entries.filter((entry) => !/^LTE-[12]$/i.test(entry.equipment) || pairs.get(entry.site)?.size === 2);
}

function extractSiteCodes(text: string) {
  return new Set((text.toUpperCase().match(/\d{3}[A-Z]\d{5}/g) ?? []).map((code) => code.toUpperCase()));
}

function parseSpecialSiteList(text: string) {
  const result = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const site = line.match(/\d{3}[A-Z]\d{5}/i)?.[0]?.toUpperCase();
    if (!site) continue;
    const label = line.slice(line.indexOf(site) + site.length).replace(/^\s*[\t|,;:\-–—]+\s*/, '').trim();
    result.set(site, label || 'سرقت، تخریب، تعریض یا جابه‌جایی');
  }
  return result;
}

function jalaliParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-u-ca-persian-nu-latn', { timeZone: 'Asia/Tehran', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(date);
  return Object.fromEntries(parts.map(({ type, value }) => [type, value]));
}

function currentJalaliDateTime() {
  const now = new Date();
  const date = jalaliParts(now);
  const time = Object.fromEntries(new Intl.DateTimeFormat('en-u-ca-gregory-nu-latn', { timeZone: 'Asia/Tehran', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map(({ type, value }) => [type, value]));
  const pad = (value: string) => value.padStart(2, '0');
  return { date: `${date.year}/${pad(date.month)}/${pad(date.day)}`, time: `${time.hour}:${time.minute}` };
}

function toAsciiDigits(value: string) {
  return value.replace(/[۰-۹٠-٩]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) >= 0x06f0 && digit.charCodeAt(0) <= 0x06f9 ? digit.charCodeAt(0) - 0x06f0 + 48 : digit.charCodeAt(0) - 0x0660 + 48));
}

function jalaliToGregorian(value: string) {
  const match = toAsciiDigits(value.trim()).match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (!match) return null;
  const target = match.slice(1).map(Number);
  const cursor = new Date(Date.UTC(target[0] + 621, 0, 1, 12));
  for (let offset = 0; offset < 370; offset += 1) {
    const parts = jalaliParts(cursor);
    if ([Number(parts.year), Number(parts.month), Number(parts.day)].every((part, index) => part === target[index])) return { year: cursor.getUTCFullYear(), month: cursor.getUTCMonth() + 1, day: cursor.getUTCDate() };
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return null;
}

function captureTimestamp(dateValue: string, timeValue: string) {
  const gregorian = jalaliToGregorian(dateValue);
  const time = toAsciiDigits(timeValue).match(/^(\d{2}):(\d{2})$/);
  if (!gregorian || !time) return null;
  const [hour, minute] = time.slice(1).map(Number);
  if (hour > 23 || minute > 59) return null;
  const wallClockAsUtc = Date.UTC(gregorian.year, gregorian.month - 1, gregorian.day, hour, minute);
  const parts = new Intl.DateTimeFormat('en-US-u-nu-latn', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(wallClockAsUtc));
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const representedAsUtc = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), Number(values.hour), Number(values.minute));
  return new Date(wallClockAsUtc - (representedAsUtc - wallClockAsUtc)).toISOString();
}

function jalaliDateTimeFromTimestamp(value: string) {
  const date = jalaliParts(new Date(value));
  const time = Object.fromEntries(new Intl.DateTimeFormat('en-u-ca-gregory-nu-latn', { timeZone: 'Asia/Tehran', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value)).map(({ type, value: part }) => [type, part]));
  const pad = (part: string) => part.padStart(2, '0');
  return { date: `${date.year}/${pad(date.month)}/${pad(date.day)}`, time: `${time.hour}:${time.minute}` };
}

const JALALI_MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
const JALALI_WEEKDAYS = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];
const PERSIAN_WEEKDAY_NAMES = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'];

function formatJalaliDateWithWeekday(value: string) {
  const parts = jalaliDateParts(value);
  const gregorian = jalaliToGregorian(value);
  if (!parts || !gregorian) return null;
  const weekday = PERSIAN_WEEKDAY_NAMES[new Date(Date.UTC(gregorian.year, gregorian.month - 1, gregorian.day)).getUTCDay()];
  const fa = (number: number) => number.toLocaleString('fa-IR', { useGrouping: false });
  return `${weekday} ${fa(parts.day)} ${JALALI_MONTHS[parts.month - 1]} ${fa(parts.year)}`;
}

function jalaliMonthLength(year: number, month: number) {
  if (month <= 6) return 31;
  if (month <= 11) return 30;
  const yearStart = jalaliToGregorian(`${year}/01/01`);
  const nextYearStart = jalaliToGregorian(`${year + 1}/01/01`);
  if (!yearStart || !nextYearStart) return 29;
  return (Date.UTC(nextYearStart.year, nextYearStart.month - 1, nextYearStart.day) - Date.UTC(yearStart.year, yearStart.month - 1, yearStart.day)) / 86_400_000 === 366 ? 30 : 29;
}

function jalaliDateParts(value: string) {
  const match = toAsciiDigits(value.trim()).match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (!match) return null;
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (month < 1 || month > 12 || day < 1 || day > jalaliMonthLength(year, month) || !jalaliToGregorian(`${year}/${month}/${day}`)) return null;
  return { year, month, day };
}

function JalaliDatePicker({ label, value, onChange }: { label?: string; value: string; onChange: (value: string) => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const initial = jalaliDateParts(value) ?? jalaliDateParts(currentJalaliDateTime().date)!;
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(initial.year);
  const [viewMonth, setViewMonth] = useState(initial.month);

  useEffect(() => {
    const parts = jalaliDateParts(value);
    if (parts) { setViewYear(parts.year); setViewMonth(parts.month); }
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => { if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false); };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => { document.removeEventListener('pointerdown', closeOutside); document.removeEventListener('keydown', closeOnEscape); };
  }, [open]);

  function moveMonth(amount: number) {
    let nextYear = viewYear;
    let nextMonth = viewMonth + amount;
    if (nextMonth < 1) { nextMonth = 12; nextYear -= 1; }
    if (nextMonth > 12) { nextMonth = 1; nextYear += 1; }
    setViewYear(nextYear);
    setViewMonth(nextMonth);
  }

  const firstGregorian = jalaliToGregorian(`${viewYear}/${viewMonth}/01`);
  const firstDayOffset = firstGregorian ? (new Date(Date.UTC(firstGregorian.year, firstGregorian.month - 1, firstGregorian.day)).getUTCDay() + 1) % 7 : 0;
  const dayCount = jalaliMonthLength(viewYear, viewMonth);
  const selected = jalaliDateParts(value);

  return <div className="jalali-picker" ref={rootRef}>
    {label && <span className="jalali-picker-label">{label}</span>}
    <div className="jalali-picker-control">
      <button type="button" className="calendar-button" aria-label={label ? `انتخاب ${label}` : 'انتخاب تاریخ گزارش'} aria-expanded={open} onClick={() => setOpen((current) => !current)}><CalendarDays size={17} /></button>
      <input type="text" inputMode="numeric" dir="ltr" placeholder="۱۴۰۵/۰۸/۰۵" value={value} onFocus={() => setOpen(true)} onClick={() => setOpen(true)} onChange={(event) => onChange(event.target.value)} />
    </div>
    {open && <div className="jalali-calendar" role="dialog" aria-label={`تقویم ${label}`}>
      <div className="calendar-heading"><button type="button" aria-label="ماه بعد" onClick={() => moveMonth(1)}><ChevronRight size={17} /></button><strong>{JALALI_MONTHS[viewMonth - 1]} {viewYear.toLocaleString('fa-IR', { useGrouping: false })}</strong><button type="button" aria-label="ماه قبل" onClick={() => moveMonth(-1)}><ChevronLeft size={17} /></button></div>
      <div className="calendar-grid" role="grid">{JALALI_WEEKDAYS.map((day, index) => <span className="calendar-weekday" key={`${day}-${index}`}>{day}</span>)}{Array.from({ length: firstDayOffset }, (_, index) => <span aria-hidden="true" className="calendar-blank" key={`blank-${index}`} />)}{Array.from({ length: dayCount }, (_, index) => {
        const day = index + 1;
        const dateValue = `${viewYear}/${String(viewMonth).padStart(2, '0')}/${String(day).padStart(2, '0')}`;
        const isSelected = selected?.year === viewYear && selected.month === viewMonth && selected.day === day;
        return <button type="button" role="gridcell" aria-selected={isSelected} className={isSelected ? 'calendar-day selected' : 'calendar-day'} key={day} onClick={() => { onChange(dateValue); setOpen(false); }}>{day.toLocaleString('fa-IR')}</button>;
      })}</div>
      <button type="button" className="calendar-today" onClick={() => { const today = currentJalaliDateTime().date; const todayParts = jalaliDateParts(today); if (todayParts) { setViewYear(todayParts.year); setViewMonth(todayParts.month); } onChange(today); setOpen(false); }}>رفتن به امروز</button>
    </div>}
  </div>;
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeStyle: 'short', hourCycle: 'h23', timeZone: 'Asia/Tehran' }).format(new Date(value));
}

function workbookWithColoredSolarStatuses(workbook: XLSX.WorkBook) {
  const original = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  const archive = XLSX.CFB.read(new Uint8Array(original), { type: 'array' });
  const worksheetFile = XLSX.CFB.find(archive, '/xl/worksheets/sheet1.xml');
  const stylesFile = XLSX.CFB.find(archive, '/xl/styles.xml');
  if (!worksheetFile || !stylesFile) return original;

  let stylesXml = new TextDecoder().decode(stylesFile.content as Uint8Array);
  const fillCount = Number(stylesXml.match(/<fills\b[^>]*count="(\d+)"/)?.[1] ?? 0);
  const fontCount = Number(stylesXml.match(/<fonts\b[^>]*count="(\d+)"/)?.[1] ?? 0);
  const formatCount = Number(stylesXml.match(/<cellXfs\b[^>]*count="(\d+)"/)?.[1] ?? 1);
  const addedFills = '<fill><patternFill patternType="solid"><fgColor rgb="FF202224"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF0F4F8"/><bgColor indexed="64"/></patternFill></fill>';
  stylesXml = stylesXml.replace(/<fills\b([^>]*)>([\s\S]*?)<\/fills>/, (_all, attrs: string, body: string) => `<fills ${attrs.replace(/\s+count="\d+"/, '').trim()} count="${fillCount + 2}">${body}${addedFills}</fills>`);
  const addedFont = '<font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font>';
  stylesXml = stylesXml.replace(/<fonts\b([^>]*)>([\s\S]*?)<\/fonts>/, (_all, attrs: string, body: string) => `<fonts ${attrs.replace(/\s+count="\d+"/, '').trim()} count="${fontCount + 1}">${body}${addedFont}</fonts>`);
  const centeredWrap = '<alignment horizontal="center" vertical="center" wrapText="1"/>';
  const centeredNoWrap = '<alignment horizontal="center" vertical="center"/>';
  const addedFormats = [
    `<xf numFmtId="0" fontId="${fontCount}" fillId="${fillCount}" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1">${centeredWrap}</xf>`,
    `<xf numFmtId="0" fontId="0" fillId="${fillCount + 1}" borderId="0" xfId="0" applyFill="1" applyAlignment="1">${centeredWrap}</xf>`,
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1">${centeredWrap}</xf>`,
    `<xf numFmtId="0" fontId="0" fillId="${fillCount + 1}" borderId="0" xfId="0" applyFill="1" applyAlignment="1">${centeredNoWrap}</xf>`,
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1">${centeredNoWrap}</xf>`,
  ].join('');
  stylesXml = stylesXml.replace(/<cellXfs\b([^>]*)>([\s\S]*?)<\/cellXfs>/, (_all, attrs: string, body: string) => `<cellXfs ${attrs.replace(/\s+count="\d+"/, '').trim()} count="${formatCount + 5}">${body}${addedFormats}</cellXfs>`);

  let worksheetXml = new TextDecoder().decode(worksheetFile.content as Uint8Array);
  worksheetXml = worksheetXml.replace(/<sheetView\b([^>]*?)(\/?)>/i, (_all, attrs: string, slash: string) => `<sheetView ${attrs.replace(/\s+rightToLeft="[^"]*"/i, '').trim()} rightToLeft="1"${slash ? '/' : ''}>`);
  worksheetXml = worksheetXml.replace(/<c\b[^>]*>[\s\S]*?<\/c>/g, (cellXml) => {
    const reference = cellXml.match(/\br="([A-Z]+\d+)"/)?.[1];
    if (!reference) return cellXml;
    const rowNumber = Number(reference.match(/\d+$/)?.[0] ?? 1);
    const baseFormat = rowNumber === 1 ? formatCount : rowNumber % 2 === 0 ? formatCount + 1 : formatCount + 2;
    const statusFormat = rowNumber % 2 === 0 ? formatCount + 3 : formatCount + 4;
    let output = cellXml;
    const value = cellXml.match(/<v>([\s\S]*?)<\/v>/)?.[1];
    if (value?.includes('[[RAHCOM_STATUS_')) {
      const runs: string[] = [];
      let position = 0;
      const marker = /\[\[RAHCOM_STATUS_(DOWN|UNREACHABLE)\]\]/g;
      let match: RegExpExecArray | null;
      while ((match = marker.exec(value))) {
        const label = value.slice(position, match.index);
        if (label) runs.push(`<r><t xml:space="preserve">${label}</t></r>`);
        const color = match[1] === 'DOWN' ? 'FFDC2626' : 'FF9CA3AF';
        runs.push(`<r><rPr><sz val="20"/><color rgb="${color}"/></rPr><t xml:space="preserve"> ● </t></r>`);
        position = marker.lastIndex;
      }
      const tail = value.slice(position);
      if (tail) runs.push(`<r><t xml:space="preserve">${tail}</t></r>`);
      output = `<c r="${reference}" t="inlineStr" s="${statusFormat}"><is>${runs.join('')}</is></c>`;
      return output;
    }
    return output.replace(/<c\b([^>]*)>/, (_tag, attrs: string) => {
      const clean = attrs.replace(/\s+s="[^"]*"/, '').trim();
      return `<c ${clean}${baseFormat ? ` s="${baseFormat}"` : ''}>`;
    });
  });
  XLSX.CFB.utils.cfb_add(archive, '/xl/styles.xml', new TextEncoder().encode(stylesXml));
  XLSX.CFB.utils.cfb_add(archive, '/xl/worksheets/sheet1.xml', new TextEncoder().encode(worksheetXml));
  return XLSX.CFB.write(archive, { fileType: 'zip', type: 'array' });
}

export default function SolarWorkspace() {
  const [downText, setDownText] = useState('');
  const [unreachableText, setUnreachableText] = useState('');
  const [specialText, setSpecialText] = useState(DEFAULT_SPECIAL_SITE_TEXT);
  const [specialDraftText, setSpecialDraftText] = useState(DEFAULT_SPECIAL_SITE_TEXT);
  const [newSpecialCode, setNewSpecialCode] = useState('');
  const [showSpecialSites, setShowSpecialSites] = useState(false);
  const [reports, setReports] = useState<Report[]>([]);
  const [selectedColumns, setSelectedColumns] = useState<string[]>(DEFAULT_COLUMNS);
  const [columnsCustomized, setColumnsCustomized] = useState(false);
  const [editingColumns, setEditingColumns] = useState(false);
  const [capturedDate, setCapturedDate] = useState('');
  const [capturedTime, setCapturedTime] = useState('');
  const [selectedHistoryDate, setSelectedHistoryDate] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [specialEditorOpen, setSpecialEditorOpen] = useState(false);
  const [activeReport, setActiveReport] = useState<Report | null>(null);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState('');
  const [ready, setReady] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system');
  const [systemTheme, setSystemTheme] = useState<'light' | 'dark'>('dark');
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [analytics, setAnalytics] = useState<{ onlineNow: number; today: number; week: number; month: number } | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const specialFileInputRef = useRef<HTMLInputElement>(null);

  const inputEntries = useMemo(() => filterLtePairs([
    ...parseList(downText, 'down'),
    ...parseList(unreachableText, 'unreachable'),
  ]), [downText, unreachableText]);
  const entries = useMemo(() => activeReport && hasSubmitted
    ? filterLtePairs([...parseList(activeReport.downText, 'down'), ...parseList(activeReport.unreachableText, 'unreachable')])
    : inputEntries, [activeReport, hasSubmitted, inputEntries]);
  const indexedEntries = useMemo(() => entries.map((entry) => ({ entry, searchText: `${entry.site} ${entry.equipment} ${entry.source}`.toLocaleLowerCase() })), [entries]);
  const deferredQuery = useDeferredValue(query);
  const activeShowSpecialSites = showSpecialSites;
  const specialSites = useMemo(() => parseSpecialSiteList(specialText), [specialText]);
  const specialDraftSites = useMemo(() => parseSpecialSiteList(specialDraftText), [specialDraftText]);
  const showSpecialColumn = activeShowSpecialSites && specialSites.size > 0;
  const availableEquipment = useMemo(() => [...new Set(entries.map((entry) => entry.equipment))], [entries]);
  const provinces = useMemo(() => [...new Set(entries.flatMap((entry) => {
    const code = entry.source.match(/(?:^|-)\b([A-Z]{3})\b(?=-)/i)?.[1]?.toUpperCase();
    return code && PROVINCE_NAMES[code] ? [PROVINCE_NAMES[code]] : [];
  }))], [entries]);
  const groups = useMemo(() => {
    const selected = new Set(selectedColumns);
    const routers = ['RTR-1', 'RTR-2'].filter((code) => selected.has(code));
    const radars = ['RAD-1', 'RAD-2'].filter((code) => selected.has(code));
    const known = [
      ...(selected.has('LTE') ? [{ key: 'LTE', label: 'LTE', codes: ['LTE-1', 'LTE-2'] }] : []),
      ...(routers.length ? [{ key: routers.join('|'), label: `روتر (${routers.join('/')})`, codes: routers }] : []),
      ...(selected.has('CAM-1') ? [{ key: 'CAM-1', label: 'دوربین (CAM-1)', codes: ['CAM-1'] }] : []),
      ...(radars.length ? [{ key: radars.join('|'), label: `رادار (${radars.join('/')})`, codes: radars }] : []),
      ...EQUIPMENT_GROUPS.filter((group) => !['LTE', 'RTR-1', 'RTR-2', 'CAM-1', 'RAD-1', 'RAD-2'].includes(group.key) && selected.has(group.key)),
    ];
    const knownCodes = new Set(EQUIPMENT_GROUPS.flatMap((group) => [group.key, ...group.codes]));
    const custom = [...new Set([...availableEquipment, ...selectedColumns].filter((code) => !knownCodes.has(code) && !/^LTE-[12]$/.test(code)))].sort();
    return [...known, ...custom.map((code) => ({ key: code, label: code, codes: [code] }))];
  }, [availableEquipment, selectedColumns]);
  const previousReport = useMemo(() => {
    if (!activeReport || !hasSubmitted) return null;
    return reports
      .filter((report) => report.id !== activeReport.id && new Date(report.createdAt).getTime() < new Date(activeReport.createdAt).getTime() && jalaliDateTimeFromTimestamp(report.createdAt).date === jalaliDateTimeFromTimestamp(activeReport.createdAt).date)
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())[0] ?? null;
  }, [activeReport, hasSubmitted, reports]);
  const previousStatesBySite = useMemo(() => {
    const result = new Map<string, Map<string, State>>();
    if (!previousReport) return result;
    const previousEntries = filterLtePairs([...parseList(previousReport.downText, 'down'), ...parseList(previousReport.unreachableText, 'unreachable')]);
    for (const entry of previousEntries) {
      const states = result.get(entry.site) ?? new Map<string, State>();
      const prior = states.get(entry.equipment);
      states.set(entry.equipment, prior === 'down' || entry.state === 'down' ? 'down' : 'unreachable');
      result.set(entry.site, states);
    }
    return result;
  }, [previousReport]);
  const siteRows = useMemo(() => {
    const bySite = new Map<string, Map<string, State>>();
    const normalizedQuery = deferredQuery.trim().toLocaleLowerCase();
    const visibleEntries = indexedEntries.filter(({ searchText }) => !normalizedQuery || searchText.includes(normalizedQuery)).map(({ entry }) => entry);
    const specialSitesWithStatus = new Set(entries.filter((entry) => specialSites.has(entry.site)).map((entry) => entry.site));
    for (const entry of visibleEntries) {
      const isSpecial = specialSites.has(entry.site);
      if (isSpecial && (!activeShowSpecialSites || !specialSitesWithStatus.has(entry.site))) continue;
      if (!selectedColumns.includes(entry.equipment) && !selectedColumns.some((key) => EQUIPMENT_GROUPS.find((group) => group.key === key)?.codes.includes(entry.equipment))) continue;
      const states = bySite.get(entry.site) ?? new Map<string, State>();
      const previous = states.get(entry.equipment);
      states.set(entry.equipment, previous === 'down' || entry.state === 'down' ? 'down' : 'unreachable');
      bySite.set(entry.site, states);
    }
    if (activeShowSpecialSites) for (const entry of visibleEntries) {
      if (!specialSites.has(entry.site)) continue;
      if (!bySite.has(entry.site)) bySite.set(entry.site, new Map());
    }
    if (previousReport) for (const [site, states] of previousStatesBySite) {
      if (bySite.has(site) || (specialSites.has(site) && !activeShowSpecialSites)) continue;
      if (normalizedQuery && !site.toLocaleLowerCase().includes(normalizedQuery)) continue;
      const visible = [...states.keys()].some((code) => selectedColumns.includes(code) || selectedColumns.some((key) => EQUIPMENT_GROUPS.find((group) => group.key === key)?.codes.includes(code)));
      if (visible) bySite.set(site, new Map());
    }
    return [...bySite.entries()].map(([site, states]) => ({ site, states } satisfies SiteRow)).sort((a, b) => a.site.localeCompare(b.site));
  }, [entries, indexedEntries, deferredQuery, selectedColumns, specialSites, activeShowSpecialSites, previousReport, previousStatesBySite]);
  const historyForSite = (row: SiteRow) => {
    if (!previousReport) return 'اولین گزارش روز';
    const current = row.states;
    const previous = previousStatesBySite.get(row.site) ?? new Map<string, State>();
    const codes = new Set([...current.keys(), ...previous.keys()]);
    const changes: string[] = [];
    for (const code of codes) {
      const before = previous.get(code);
      const after = current.get(code);
      if (before === after) continue;
      if (!before && after) changes.push(`جدید: ${code} (${after === 'down' ? 'قطع' : 'غیرقابل‌دسترس'})`);
      else if (before && !after) changes.push(`رفع: ${code}`);
      else if (before && after) changes.push(`${code}: ${before === 'down' ? 'قطع' : 'غیرقابل‌دسترس'} ← ${after === 'down' ? 'قطع' : 'غیرقابل‌دسترس'}`);
    }
    return changes.length ? changes.join('، ') : 'بدون تغییر';
  };
  const reportsForSelectedDate = useMemo(() => reports
    .filter((report) => jalaliDateTimeFromTimestamp(report.createdAt).date === selectedHistoryDate)
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()), [reports, selectedHistoryDate]);

  useEffect(() => {
    try {
      const savedReports = localStorage.getItem(STORAGE_KEY);
      const draft = localStorage.getItem(DRAFT_KEY);
      const savedTheme = localStorage.getItem('solar.theme');
      const savedSpecialSites = localStorage.getItem(SPECIAL_SITES_KEY);
      if (savedSpecialSites) {
        try {
          const stored = JSON.parse(savedSpecialSites) as { text?: string; enabled?: boolean };
          if (typeof stored.text === 'string') { setSpecialText(stored.text); setSpecialDraftText(stored.text); }
          if (typeof stored.enabled === 'boolean') setShowSpecialSites(stored.enabled);
        } catch { localStorage.removeItem(SPECIAL_SITES_KEY); }
      }
      if (savedReports) setReports(JSON.parse(savedReports) as Report[]);
      if (savedTheme === 'light' || savedTheme === 'dark' || savedTheme === 'system') setTheme(savedTheme);
      if (draft) {
        const parsed = JSON.parse(draft) as { downText?: string; unreachableText?: string; specialText?: string; showSpecialSites?: boolean; equipmentColumns?: string[]; equipmentColumnsCustomized?: boolean; equipmentColumnsVersion?: number; capturedAt?: string; capturedDate?: string; capturedTime?: string; selectedHistoryDate?: string };
        setDownText(parsed.downText ?? '');
        setUnreachableText(parsed.unreachableText ?? '');
        if (!savedSpecialSites && typeof parsed.specialText === 'string') { setSpecialText(parsed.specialText); setSpecialDraftText(parsed.specialText); }
        if (!savedSpecialSites && typeof parsed.showSpecialSites === 'boolean') setShowSpecialSites(parsed.showSpecialSites);
        const hasCustomSelection = parsed.equipmentColumnsVersion === EQUIPMENT_COLUMNS_VERSION && parsed.equipmentColumnsCustomized === true;
        setColumnsCustomized(hasCustomSelection);
        if (hasCustomSelection && parsed.equipmentColumns?.length) setSelectedColumns(parsed.equipmentColumns);
        const restoredTime = parsed.capturedAt ? jalaliDateTimeFromTimestamp(parsed.capturedAt) : currentJalaliDateTime();
        setCapturedDate(parsed.capturedDate ?? restoredTime.date);
        setCapturedTime(parsed.capturedTime ?? restoredTime.time);
        setSelectedHistoryDate(parsed.selectedHistoryDate ?? restoredTime.date);
      } else {
        const current = currentJalaliDateTime();
        setCapturedDate(current.date);
        setCapturedTime(current.time);
        setSelectedHistoryDate(current.date);
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(DRAFT_KEY);
      const current = currentJalaliDateTime();
      setCapturedDate(current.date);
      setCapturedTime(current.time);
      setSelectedHistoryDate(current.date);
    }
    setReady(true);
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setSystemTheme(media.matches ? 'dark' : 'light');
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const effectiveTheme = theme === 'system' ? systemTheme : theme;
    document.documentElement.dataset.theme = effectiveTheme;
    if (ready) localStorage.setItem('solar.theme', theme);
  }, [theme, systemTheme, ready]);

  useEffect(() => {
    if (!analyticsOpen) return;
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') return;
    let active = true;
    setAnalyticsLoading(true);
    fetch('/api/analytics/summary', { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('analytics unavailable')))
      .then((data: { onlineNow: number; today: number; week: number; month: number }) => { if (active) setAnalytics(data); })
      .catch(() => { if (active) setAnalytics(null); })
      .finally(() => { if (active) setAnalyticsLoading(false); });
    return () => { active = false; };
  }, [analyticsOpen]);

  useEffect(() => {
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') return;

    const heartbeat = () => {
      void fetch('/api/analytics/presence', {
        method: 'POST',
        keepalive: true,
      }).catch(() => undefined);
    };

    const onVisible = () => { if (!document.hidden) heartbeat(); };
    heartbeat();
    const interval = window.setInterval(heartbeat, 30_000);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ downText, unreachableText, equipmentColumns: selectedColumns, equipmentColumnsCustomized: columnsCustomized, equipmentColumnsVersion: EQUIPMENT_COLUMNS_VERSION, capturedDate, capturedTime, selectedHistoryDate }));
  }, [downText, unreachableText, selectedColumns, columnsCustomized, capturedDate, capturedTime, selectedHistoryDate, ready]);

  useEffect(() => {
    if (!ready) return;
    localStorage.setItem(SPECIAL_SITES_KEY, JSON.stringify({ text: specialText, enabled: showSpecialSites }));
  }, [specialText, showSpecialSites, ready]);

  function saveReport() {
    if (!entries.length) { setNotice('مورد قابل‌نمایشی پیدا نشد؛ متن ورودی را بررسی کن.'); return; }
    const createdAt = captureTimestamp(capturedDate, capturedTime);
    if (!createdAt) { setNotice('تاریخ شمسی یا ساعت معتبر نیست؛ قالب تاریخ ۱۴۰۵/۰۸/۰۵ و ساعت ۲۳:۵۹ را وارد کن.'); return; }
    const report: Report = { id: crypto.randomUUID(), createdAt, entries, downText, unreachableText, specialText, showSpecialSites, equipmentColumns: selectedColumns };
    const updated = [report, ...reports];
    setReports(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    setActiveReport(report);
    setSelectedHistoryDate(capturedDate);
    setHasSubmitted(true);
    setFormOpen(false);
    setSpecialEditorOpen(false);
    setNotice('گزارش ذخیره شد و جدول وضعیت نمایش داده شد.');
  }

  function restoreReport(report: Report) {
    setDownText(report.downText);
    setUnreachableText(report.unreachableText);
    if (report.equipmentColumns?.length) setSelectedColumns(report.equipmentColumns);
    const restoredTime = jalaliDateTimeFromTimestamp(report.createdAt);
    setCapturedDate(restoredTime.date);
    setCapturedTime(restoredTime.time);
    setSelectedHistoryDate(restoredTime.date);
    setActiveReport(report);
    setFormOpen(false);
    setSpecialEditorOpen(false);
    setHasSubmitted(true);
    setNotice('گزارش برای نمایش و ویرایش بارگذاری شد.');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function deleteReport(id: string) {
    const updated = reports.filter((report) => report.id !== id);
    setReports(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    if (activeReport?.id === id) { setActiveReport(null); setHasSubmitted(false); }
  }

  function clearBrowserData() {
    if (!window.confirm('همهٔ گزارش‌ها، ورودی‌ها و تنظیمات سولیار از حافظهٔ این مرورگر پاک شود؟')) return;
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (key?.startsWith('solar.')) localStorage.removeItem(key);
    }
    const current = currentJalaliDateTime();
    setDownText(''); setUnreachableText(''); setSpecialText(''); setSpecialDraftText(''); setNewSpecialCode('');
    setShowSpecialSites(false); setReports([]); setSelectedColumns(DEFAULT_COLUMNS); setColumnsCustomized(false); setEditingColumns(false);
    setCapturedDate(current.date); setCapturedTime(current.time); setSelectedHistoryDate(current.date);
    setFormOpen(false); setSpecialEditorOpen(false); setActiveReport(null); setHasSubmitted(false); setQuery(''); setTheme('system');
    setNotice('تمام اطلاعات ذخیره‌شدهٔ سولیار از حافظهٔ مرورگر پاک شد.');
  }

  function clearInputs() {
    setDownText('');
    setUnreachableText('');
    setHasSubmitted(false);
    setNotice('ورودی‌ها پاک شدند.');
  }

  function beginNewStatus() {
    const current = currentJalaliDateTime();
    setDownText('');
    setUnreachableText('');
    setCapturedTime(current.time);
    setEditingColumns(false);
    setActiveReport(null);
    setSpecialEditorOpen(false);
    setHasSubmitted(false);
    setFormOpen(true);
    setNotice('');
  }

  function closeStatusForm() {
    setFormOpen(false);
    setHasSubmitted(Boolean(activeReport));
  }

  function toggleSpecialEditor() {
    if (specialEditorOpen) { cancelSpecialEditor(); return; }
    setFormOpen(false);
    setActiveReport(null);
    setHasSubmitted(false);
    setSpecialDraftText(specialText);
    setNewSpecialCode('');
    setSpecialEditorOpen(true);
    setNotice('');
  }

  function saveSpecialEditor() {
    setSpecialText(specialDraftText);
    setSpecialEditorOpen(false);
    setNewSpecialCode('');
    setNotice('فهرست سرقت و تخریب ذخیره شد.');
  }

  function cancelSpecialEditor() {
    setSpecialDraftText(specialText);
    setSpecialEditorOpen(false);
    setNewSpecialCode('');
    setNotice('');
  }

  function closeDisplayedStatus() {
    setActiveReport(null);
    setFormOpen(false);
    setSpecialEditorOpen(false);
    setHasSubmitted(false);
    setQuery('');
  }

  function returnToIdle() {
    setFormOpen(false);
    setSpecialEditorOpen(false);
    setSpecialDraftText(specialText);
    setEditingColumns(false);
    setActiveReport(null);
    setHasSubmitted(false);
    setQuery('');
    setNotice('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function fillDemoData() {
    setDownText(demoData.DownText);
    setUnreachableText(demoData.UnreachableText);
    setHasSubmitted(false);
    setNotice('فهرست‌های نمونه بارگذاری شدند؛ برای ساخت جدول، «ذخیره و نمایش جدول» را بزن.');
  }

  function updateSpecialSite(site: string, value: string, category?: string) {
    const lines = specialDraftText.split(/\r?\n/).filter((line) => line.trim());
    const index = lines.findIndex((line) => line.match(/\d{3}[A-Z]\d{5}/i)?.[0]?.toUpperCase() === site);
    if (index < 0) return;
    const currentSite = lines[index].match(/\d{3}[A-Z]\d{5}/i)?.[0] ?? site;
    const currentCategory = specialDraftSites.get(site) ?? SPECIAL_THEFT;
    lines[index] = `${category ? currentSite : value.toUpperCase()}\t${category ?? currentCategory}`;
    setSpecialDraftText(lines.join('\n'));
  }

  function addSpecialSite() {
    const site = newSpecialCode.trim().toUpperCase();
    if (!/^\d{3}[A-Z]\d{5}$/.test(site)) { setNotice('کد سامانه را با قالب درست وارد کن؛ نمونه: 062S13002'); return; }
    if (specialDraftSites.has(site)) { setNotice('این کد از قبل در فهرست ویژه وجود دارد.'); return; }
    setSpecialDraftText(`${specialDraftText.trim()}${specialDraftText.trim() ? '\n' : ''}${site}\t${SPECIAL_THEFT}`);
    setNewSpecialCode('');
    setNotice('کد به فهرست ویژه اضافه شد.');
  }

  function downloadSpecialSitesJson() {
    const payload = { version: 1, sites: [...specialDraftSites].map(([site, category]) => ({ site, category })) };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'solyar-special-sites.json';
    link.click();
    URL.revokeObjectURL(url);
  }

  async function uploadSpecialSitesJson(file?: File) {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as { sites?: Array<{ site?: string; category?: string }> };
      if (!Array.isArray(parsed.sites)) throw new Error('invalid format');
      const rows = parsed.sites.flatMap(({ site, category }) => {
        const code = site?.trim().toUpperCase() ?? '';
        if (!/^\d{3}[A-Z]\d{5}$/.test(code)) return [];
        const label = category === SPECIAL_RELOCATION ? SPECIAL_RELOCATION : SPECIAL_THEFT;
        return [`${code}\t${label}`];
      });
      if (!rows.length) throw new Error('no valid sites');
      setSpecialDraftText(rows.join('\n'));
      setNotice('فهرست ویژه از فایل JSON بارگذاری شد.');
    } catch {
      setNotice('فایل JSON معتبر نیست یا کد سامانهٔ قابل‌قبولی ندارد.');
    } finally {
      if (specialFileInputRef.current) specialFileInputRef.current.value = '';
    }
  }

  function fillSpecialSitesDemo() {
    setSpecialDraftText(DEFAULT_SPECIAL_SITE_TEXT);
    setNotice('فهرست شش کد نمونهٔ ویژه بارگذاری شد و به‌صورت محلی ذخیره می‌شود.');
  }

  function downloadExcel() {
    const headers = ['ردیف', 'کد سامانه', ...(showSpecialColumn ? ['سرقت و تخریب / تعریض و جابه‌جایی'] : []), ...groups.map((group) => group.label), 'تاریخچه وضعیت'];
    const rows = siteRows.map((row, index) => [index + 1, row.site, ...(showSpecialColumn ? [specialSites.get(row.site) ?? '—'] : []), ...groups.map((group) => group.codes
      .filter((code) => row.states.has(code))
      .map((code) => `${code} [[RAHCOM_STATUS_${row.states.get(code)!.toUpperCase()}]]`)
      .join(' | ') || '—'), historyForSite(row)]);
    const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    sheet['!views'] = [{ rightToLeft: true }];
    sheet['!cols'] = headers.map((header, index) => {
      const longest = Math.max(header.length, ...rows.map((row) => String(row[index] ?? '').replace(/\[\[RAHCOM_STATUS_(?:DOWN|UNREACHABLE)\]\]/g, '').length));
      const isLteColumn = header.trim().toUpperCase() === 'LTE';
      const minWidth = isLteColumn ? 32 : index === 0 ? 7 : 12;
      const maxWidth = isLteColumn ? 42 : index === 1 ? 22 : 42;
      return { wch: Math.min(maxWidth, Math.max(minWidth, longest + (isLteColumn ? 10 : 3))) };
    });
    sheet['!rows'] = [{ hpt: 30 }, ...rows.map(() => ({ hpt: 30 }))];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'وضعیت سولار');
    const fileData = workbookWithColoredSolarStatuses(workbook);
    const fileUrl = URL.createObjectURL(new Blob([new Uint8Array(fileData as ArrayBuffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const link = document.createElement('a');
    link.href = fileUrl;
    link.download = `solyar-${new Date().toISOString().slice(0, 10)}.xlsx`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(fileUrl), 1000);
  }

  function toggleColumn(key: string) {
    setColumnsCustomized(true);
    setSelectedColumns((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  }

  function renderStatusTable(rows: SiteRow[]) {
    return <div className="table-scroll"><table><thead><tr><th>ردیف</th><th>کد سامانه</th>{showSpecialColumn && <th>سرقت و تخریب / تعریض و جابه‌جایی</th>}{groups.map((group) => <th key={group.key} dir="auto">{group.label}</th>)}<th>تاریخچه وضعیت</th></tr></thead><tbody>
      {rows.length ? rows.map((row, index) => <tr key={row.site}><td className="row-number">{(index + 1).toLocaleString('fa-IR')}</td><td className="code" dir="ltr">{row.site}</td>{showSpecialColumn && <td className="special-status">{specialSites.get(row.site) ?? <span className="muted-dash">—</span>}</td>}{groups.map((group) => <td key={group.key} className="equipment-cell">{group.codes.some((code) => row.states.has(code)) ? <div className="equipment-statuses">{group.codes.filter((code) => row.states.has(code)).map((code) => <span className="equipment-status" key={code} dir="ltr"><bdi>{code}</bdi><i title={row.states.get(code) === 'down' ? 'قطع' : 'غیرقابل‌دسترس'} className={`status-dot ${row.states.get(code) === 'down' ? 'down-dot' : 'unreachable-dot'}`} /></span>)}</div> : <span className="muted-dash">—</span>}</td>)}<td className="history-status">{historyForSite(row)}</td></tr>) : <tr><td className="empty" colSpan={groups.length + 3 + (showSpecialColumn ? 1 : 0)}>{query ? 'نتیجه‌ای برای این جستجو پیدا نشد.' : 'فهرست‌ها را در کادرهای بالا جای‌گذاری کن تا جدول ساخته شود.'}</td></tr>}
    </tbody></table></div>;
  }

  return <div className="solar-app" data-theme={theme}>
    <header className="solar-topbar" dir="ltr">
      <div className="topbar-spacer" aria-hidden="true" />
      <Link href="/" className="topbar-brand" aria-label="SOLYAR | سولیار" onClick={(event) => { event.preventDefault(); returnToIdle(); }}>
        <span dir="rtl">سولیار</span><img className="topbar-logo" src="/favicon.ico" alt="" /><strong dir="ltr">SOLYAR</strong>
      </Link>
      <div className="topbar-controls">
        <button type="button" className="info-button" aria-label="آمار بازدید و افراد آنلاین" title="آمار بازدید و افراد آنلاین" onClick={() => setAnalyticsOpen(true)}><Info size={18} /></button>
        <button type="button" className="theme-button" aria-label={`پوسته: ${{ system: 'سیستم', light: 'روشن', dark: 'تیره' }[theme]}؛ برای تغییر کلیک کنید`} title={`پوسته: ${{ system: 'سیستم', light: 'روشن', dark: 'تیره' }[theme]}`} onClick={() => setTheme((current) => current === 'system' ? 'light' : current === 'light' ? 'dark' : 'system')}>
          {theme === 'system' ? <Monitor size={18} /> : theme === 'dark' ? <Moon size={18} /> : <Sun size={18} />}
        </button>
      </div>
    </header>
    {analyticsOpen && <div className="analytics-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setAnalyticsOpen(false); }}>
      <section className="analytics-dialog" role="dialog" aria-modal="true" aria-labelledby="analytics-title" dir="rtl">
        <div className="analytics-heading"><div><h2 id="analytics-title">آمار سامانه</h2><p>بازدیدکنندگان یکتا بر اساس IP</p></div><button className="icon-button" type="button" aria-label="بستن" onClick={() => setAnalyticsOpen(false)}>×</button></div>
        <div className="analytics-grid">{([['onlineNow', 'آنلاین یکتا'], ['today', 'امروز'], ['week', 'این هفته'], ['month', 'این ماه']] as const).map(([key, label]) => <div className="analytics-stat" key={key}><span>{label}</span><strong>{analytics ? analytics[key].toLocaleString('fa-IR') : '—'}</strong></div>)}</div>
        <p className="analytics-note" role="status">{window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? 'آمار بازدید فقط در نسخهٔ مستقرشده روی Vercel فعال است.' : analyticsLoading ? 'در حال دریافت آمار…' : analytics ? 'آمار به‌روز است.' : 'پس از اتصال دیتابیس Vercel، آمار اینجا نمایش داده می‌شود.'}</p>
      </section>
    </div>}    <main className="solar-content" dir="rtl">
      <section className="solar-intro"><div className="intro-actions"><button className={`button ${formOpen ? 'button-quiet' : 'button-primary'}`} type="button" onClick={() => formOpen ? closeStatusForm() : beginNewStatus()}>{formOpen ? <X size={18} /> : <Plus size={18} />}{formOpen ? 'بستن وضعیت' : 'افزودن وضعیت جدید'}</button><button className="button button-quiet special-entry-button" type="button" onClick={toggleSpecialEditor}><Plus size={17} />{specialEditorOpen ? 'بستن ویرایش' : 'ویرایش سرقت و تخریب'}</button><JalaliDatePicker value={capturedDate} onChange={(value) => { setCapturedDate(value); setSelectedHistoryDate(value); }} /><label className="special-list-toggle special-table-toggle"><input type="checkbox" checked={showSpecialSites} onChange={(event) => setShowSpecialSites(event.target.checked)} /><span>نمایش سرقت و تخریب</span></label><button className="icon-button clear-browser-data" type="button" aria-label="پاک‌سازی همهٔ اطلاعات مرورگر" title="پاک‌سازی همهٔ اطلاعات مرورگر" onClick={clearBrowserData}><Trash2 size={17} /></button>{notice && <p className="notice notice-inline" role="status"><Check size={15} />{notice}</p>}</div></section>

      {formOpen && <section className="status-form" aria-label="افزودن وضعیت جدید">
        <div className="form-heading"><div><h2>افزودن وضعیت جدید</h2><p>فهرست‌ها را وارد کنید، ستون‌ها را در صورت نیاز ویرایش و ذخیره را بزنید.</p><button className="button button-quiet demo-fill-button" type="button" onClick={fillDemoData}><Clipboard size={16} />پر کردن با داده‌های تست</button></div></div>
        <div className="input-grid" aria-label="ورودی فهرست‌ها">
          <label className="input-card down-card"><span className="field-title"><i className="status-dot down-dot" />فهرست DOWN</span><textarea value={downText} onChange={(event) => { setDownText(event.target.value); setHasSubmitted(false); }} placeholder={'DOWN\nRahcom (LTE-1-...) (...) (...)'} spellCheck={false} /></label>
          <label className="input-card unreachable-card"><span className="field-title"><i className="status-dot unreachable-dot" />فهرست Unreachable</span><textarea value={unreachableText} onChange={(event) => { setUnreachableText(event.target.value); setHasSubmitted(false); }} placeholder={'Unreachable\nRahcom (CAM-1-...) (...) (...)'} spellCheck={false} /></label>
        </div>
        <div className="form-bottom-row"><section className="columns-card"><div><div className="columns-title-row"><h2>ستون‌های قابل نمایش</h2><button type="button" className="button button-quiet" onClick={() => setEditingColumns((open) => !open)}>{editingColumns ? 'پایان ویرایش ستون‌ها' : 'ویرایش ستون‌ها'}</button></div><p>گروه‌هایی را که می‌خواهی در جدول ببینی انتخاب کن.</p></div>{editingColumns && <div className="equipment-choices">
          {EQUIPMENT_GROUPS.map((group) => <label key={group.key} className="equipment-choice"><input type="checkbox" checked={selectedColumns.includes(group.key)} onChange={() => toggleColumn(group.key)} /><span dir="ltr">{group.label}</span></label>)}
          {[...new Set(availableEquipment.filter((code) => !EQUIPMENT_GROUPS.some((group) => group.codes.includes(code))))].map((code) => <label key={code} className="equipment-choice"><input type="checkbox" checked={selectedColumns.includes(code)} onChange={() => toggleColumn(code)} /><span dir="ltr">{code}</span></label>)}
        </div>}</section>
        <div className="input-actions">
          <label className="capture-field"><span>ساعت وضعیت</span><input type="text" inputMode="numeric" dir="ltr" placeholder="۲۳:۵۹" maxLength={5} value={capturedTime} onChange={(event) => setCapturedTime(event.target.value)} /></label>
          <button className="button button-quiet" type="button" onClick={clearInputs}><RotateCcw size={16} />پاک‌کردن</button>
          <button className="button button-primary" type="button" onClick={saveReport}><Save size={16} />ذخیره وضعیت</button>
        </div></div>
      </section>}
      {specialEditorOpen && <section className="special-sites-panel" aria-label="ویرایش فهرست سامانه‌های ویژه" dir="rtl"><div className="special-sites-header"><div><h2>فهرست سرقت و تخریب / تعریض و جابه‌جایی</h2><p>این فهرست مستقل از گزارش‌های روزانه است و در همین مرورگر نگه‌داری می‌شود.</p></div></div><div className="special-site-rows">{[...specialDraftSites].map(([site, category]) => <div className="special-site-row" key={site}><input aria-label="کد سامانه" dir="ltr" value={site} onChange={(event) => updateSpecialSite(site, event.target.value)} /><select aria-label="نوع عملیات" value={category} onChange={(event) => updateSpecialSite(site, site, event.target.value)}><option value={SPECIAL_THEFT}>{SPECIAL_THEFT}</option><option value={SPECIAL_RELOCATION}>{SPECIAL_RELOCATION}</option></select><button className="icon-button" type="button" aria-label={`حذف ${site}`} title="حذف کد" onClick={() => setSpecialDraftText(specialDraftText.split(/\r?\n/).filter((line) => line.match(/\d{3}[A-Z]\d{5}/i)?.[0]?.toUpperCase() !== site).join('\n'))}><X size={16} /></button></div>)}</div><div className="special-site-footer"><div className="special-site-add"><input aria-label="کد سامانهٔ جدید" dir="ltr" placeholder="مثلاً 062S13002" value={newSpecialCode} onChange={(event) => setNewSpecialCode(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addSpecialSite(); } }} /><button className="button button-primary" type="button" onClick={addSpecialSite}><Plus size={16} />افزودن کد</button></div><div className="special-site-actions"><button className="button button-primary" type="button" onClick={saveSpecialEditor}><Save size={16} />ذخیره</button><button className="button button-quiet" type="button" onClick={cancelSpecialEditor}><X size={16} />انصراف</button><button className="button button-quiet" type="button" onClick={fillSpecialSitesDemo}><Clipboard size={16} />پر کردن با داده‌های تست</button><button className="button button-quiet" type="button" onClick={downloadSpecialSitesJson}><Download size={16} />دانلود JSON</button><button className="button button-quiet" type="button" onClick={() => specialFileInputRef.current?.click()}><Upload size={16} />بارگذاری JSON</button><input ref={specialFileInputRef} type="file" accept="application/json,.json" hidden onChange={(event) => void uploadSpecialSitesJson(event.target.files?.[0])} /></div></div></section>}
      {hasSubmitted && <section className="table-card">
        <div className="table-report-heading">
          <div className="table-province"><button type="button" className="status-dismiss" aria-label="بستن وضعیت نمایش‌داده‌شده" title="بستن وضعیت نمایش‌داده‌شده" onClick={closeDisplayedStatus}><X size={17} /></button><MapPin size={18} /><span>{provinces.length ? `استان ${provinces.join('، ')}` : 'وضعیت سولار'}</span><span className="report-date">{formatJalaliDateWithWeekday(capturedDate) ?? capturedDate}</span><span className="report-clock">ساعت {capturedTime.replace(/\d/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)])}</span></div>
          <div className="table-toolbar"><form className="table-search" role="search" onSubmit={(event) => event.preventDefault()}><Search size={17} aria-hidden="true" /><input type="search" aria-label="جستجو در جدول سولار" placeholder="جستجو" value={query} onChange={(event) => setQuery(event.target.value)} /></form><div className="table-summary"><strong className="table-count">{siteRows.length.toLocaleString('fa-IR')} سامانه</strong></div><button className="button button-quiet excel-button" type="button" onClick={downloadExcel} disabled={!siteRows.length}><Download size={16} />دانلود اکسل</button></div>
        </div>
        {renderStatusTable(siteRows)}
      </section>}

      <section className="history-card"><div className="history-title"><div><h2>گزارش‌های ذخیره‌شده</h2><span className="count history-count">{reportsForSelectedDate.length.toLocaleString('fa-IR')}</span></div></div>
        {reportsForSelectedDate.length ? <ul className="report-list">{reportsForSelectedDate.map((report) => <li className={activeReport?.id === report.id ? 'active-report' : undefined} key={report.id}><button type="button" className="report-main" onClick={() => restoreReport(report)}><span>{formatTime(report.createdAt)}</span><small>{new Set(report.entries.map((entry) => entry.site).filter((site) => showSpecialSites || !specialSites.has(site))).size.toLocaleString('fa-IR')} سامانه</small></button><button type="button" className="icon-button" aria-label="حذف گزارش" title="حذف گزارش" onClick={() => deleteReport(report.id)}><Trash2 size={17} /></button></li>)}</ul> : <p className="empty-history">برای این تاریخ گزارشی ذخیره نشده است.</p>}
      </section>
      <footer className="page-footer-intro" dir="rtl"><div className="page-footer-heading"><h1>وضعیت تجهیزات در سامانه سولار</h1><span className="footer-intro-icon" aria-hidden="true">📡</span></div><p>فهرست‌های Down و Unreachable را در باکس‌های مربوطه جای‌گذاری کنید؛ اطلاعات به‌صورت محلی در حافظهٔ مرورگر ذخیره می‌شوند.</p></footer>
    </main>
  </div>;
}
