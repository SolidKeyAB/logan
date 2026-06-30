// Shared fast timestamp parser. Lives in its own module so BOTH the main process
// (src/main/index.ts) and the off-thread trend worker (src/main/trendWorker.ts) use
// the exact same parsing — no drift between what the UI and the worker compute.

const MONTH_MAP: Record<string, number> = {
  'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
  'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
};

// Pre-compiled regexes — checked in order of prevalence.
const ISO_TIMESTAMP_REGEX = /(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/;
const EURO_TIMESTAMP_REGEX = /(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/;
const SYSLOG_TIMESTAMP_REGEX = /([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})/;

export function parseTimestampFast(text: string): { date: Date; str: string } | null {
  // Check first 60 chars for performance (enough for most timestamp formats)
  const sample = text.length > 60 ? text.substring(0, 60) : text;

  // Try ISO format first (most common)
  const isoMatch = sample.match(ISO_TIMESTAMP_REGEX);
  if (isoMatch) {
    const [match, year, month, day, hour, min, sec] = isoMatch;
    return {
      date: new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(min), parseInt(sec)),
      str: match,
    };
  }

  // Try European format: DD.MM.YYYY HH:mm:ss
  const euroMatch = sample.match(EURO_TIMESTAMP_REGEX);
  if (euroMatch) {
    const [match, day, month, year, hour, min, sec] = euroMatch;
    return {
      date: new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(min), parseInt(sec)),
      str: match,
    };
  }

  // Try syslog format
  const syslogMatch = sample.match(SYSLOG_TIMESTAMP_REGEX);
  if (syslogMatch) {
    const [match, monthStr, day, hour, min, sec] = syslogMatch;
    const month = MONTH_MAP[monthStr];
    if (month !== undefined) {
      return {
        date: new Date(new Date().getFullYear(), month, parseInt(day), parseInt(hour), parseInt(min), parseInt(sec)),
        str: match,
      };
    }
  }

  return null;
}
