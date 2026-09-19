const pad = (n: number) => String(n).padStart(2, "0");

/** 本地日期 YYYY-MM-DD（避免 toISOString 的时区偏移） */
export function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayStr(): string {
  return fmtDate(new Date());
}

export function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return fmtDate(d);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function isoDaysAgo(days: number, hour = 9, minute = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

export function fmtTime(iso: string): string {
  const d = new Date(iso);
  return `${fmtDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
