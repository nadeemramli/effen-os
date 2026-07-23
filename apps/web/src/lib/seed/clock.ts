/**
 * The demo clock. Every timestamp in the prototype is derived from this
 * fixed instant so the seed is deterministic and the scripted Command Centre
 * opening line stays true forever. Never use Date.now() elsewhere.
 */
export const DEMO_NOW_ISO = "2026-07-23T09:00:00+08:00";
export const DEMO_NOW = new Date(DEMO_NOW_ISO);

const MS = { minute: 60_000, hour: 3_600_000, day: 86_400_000 } as const;

export function hoursAgo(h: number): string {
  return new Date(DEMO_NOW.getTime() - h * MS.hour).toISOString();
}

export function daysAgo(d: number, hourOfDay = 12): string {
  const base = new Date(DEMO_NOW.getTime() - d * MS.day);
  base.setUTCHours(hourOfDay - 8, 0, 0, 0); // +08:00 local
  return base.toISOString();
}

export function hoursFromNow(h: number): string {
  return new Date(DEMO_NOW.getTime() + h * MS.hour).toISOString();
}

export function daysFromNow(d: number): string {
  return new Date(DEMO_NOW.getTime() + d * MS.day).toISOString();
}

/** yyyy-mm-dd in workspace-local (+08:00) time, d days before today. */
export function dateKey(daysBefore: number): string {
  const t = new Date(DEMO_NOW.getTime() + 8 * MS.hour - daysBefore * MS.day);
  return t.toISOString().slice(0, 10);
}
