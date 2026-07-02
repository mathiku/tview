/**
 * NYSE trading-session calendar (America/New_York, DST-aware via Intl).
 *
 * The scanner runs on *daily* bars, so its data only changes once per completed
 * session. `sessionKey(now)` returns the date of the most recent completed
 * session; callers refresh only when that key changes, and never fetch on
 * nights / weekends / holidays.
 */

const ET = "America/New_York";
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Close at 16:00 ET; add a buffer so Yahoo has finalized the day's bar before we
// treat today as a completed session.
const CLOSE_MINUTE = 16 * 60 + 30;
const OPEN_MINUTE = 9 * 60 + 30;

// Full-day NYSE closures (ET calendar dates). Early-close days are treated as
// normal — harmless for a daily scanner. Extend as new years are published.
const HOLIDAYS = new Set([
  // 2025
  "2025-01-01", "2025-01-20", "2025-02-17", "2025-04-18", "2025-05-26",
  "2025-06-19", "2025-07-04", "2025-09-01", "2025-11-27", "2025-12-25",
  // 2026
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25",
  "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
  // 2027
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31",
  "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
]);

function etParts(now) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  });
  const parts = {};
  for (const p of fmt.formatToParts(now)) parts[p.type] = p.value;
  return {
    year: +parts.year,
    month: +parts.month,
    day: +parts.day,
    hour: +parts.hour % 24,
    minute: +parts.minute,
    weekday: parts.weekday,
    dateStr: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

function isoUTCDate(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function isHoliday(dateStr) {
  return HOLIDAYS.has(dateStr);
}

export function isTradingDay(dateStr, weekday) {
  if (weekday === "Sat" || weekday === "Sun") return false;
  return !isHoliday(dateStr);
}

/** Date (YYYY-MM-DD, ET) of the most recent *completed* trading session. */
export function sessionKey(now = new Date()) {
  const p = etParts(now);
  const minutes = p.hour * 60 + p.minute;
  const todayCompleted = isTradingDay(p.dateStr, p.weekday) && minutes >= CLOSE_MINUTE;

  // Anchor arithmetic on the ET calendar date via a UTC-midnight cursor.
  let cursor = new Date(Date.UTC(p.year, p.month - 1, p.day));
  if (!todayCompleted) cursor = new Date(cursor.getTime() - 86400000);

  for (let i = 0; i < 12; i++) {
    const ds = isoUTCDate(cursor);
    const wd = WEEKDAYS[cursor.getUTCDay()];
    if (isTradingDay(ds, wd)) return ds;
    cursor = new Date(cursor.getTime() - 86400000);
  }
  return isoUTCDate(cursor);
}

/** "open" during regular trading hours on a trading day, else "closed". */
export function marketStatus(now = new Date()) {
  const p = etParts(now);
  if (!isTradingDay(p.dateStr, p.weekday)) return "closed";
  const minutes = p.hour * 60 + p.minute;
  return minutes >= OPEN_MINUTE && minutes < 16 * 60 ? "open" : "closed";
}
