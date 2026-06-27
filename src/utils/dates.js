// Format a Date as DD.MM.YYYY (matches FutureReportDate format used by the API)
export function toApiDate(date) {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = date.getFullYear();
  return `${d}.${m}.${y}`;
}

// Returns array of { date: Date, apiDate: string } for the next `count` days,
// starting from tomorrow (today is usually already locked/reported).
export function getUpcomingDates(count = 7, startFromToday = false) {
  const dates = [];
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (!startFromToday) start.setDate(start.getDate() + 1);

  for (let i = 0; i < count; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    dates.push({ date: d, apiDate: toApiDate(d) });
  }
  return dates;
}

// Converts a report object's date string (ISO, no TZ) to DD.MM.YYYY for matching
export function normalizeDate(report) {
  const raw = report?.date;
  if (!raw) return '';
  const d = new Date(raw);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${d.getFullYear()}`;
}

// Group a list of {date} by (year, month) -> Set of months to query getFutureReport for
export function monthsToQuery(dates) {
  const months = new Map();
  for (const { date } of dates) {
    const key = `${date.getFullYear()}-${date.getMonth() + 1}`;
    if (!months.has(key)) {
      months.set(key, { year: date.getFullYear(), month: date.getMonth() + 1 });
    }
  }
  return Array.from(months.values());
}
