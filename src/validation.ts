interface RequestRecord {
  clientId: string;
  endpoint: string;
  statusCode: number;
  timestamp: number;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

// Return a usable request, or null when the line is malformed.
export function parseRequest(line: string): RequestRecord | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }

  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const row = value as Record<string, unknown>;
  if (!isNonEmptyString(row.request_id)) return null;
  if (!isNonEmptyString(row.client_id)) return null;
  if (!isNonEmptyString(row.endpoint) || !row.endpoint.startsWith("/")) return null;

  if (typeof row.status_code !== "number") return null;
  if (!Number.isInteger(row.status_code)) return null;
  if (row.status_code < 100 || row.status_code > 599) return null;

  const timestamp = parseTimestamp(row.timestamp);
  if (timestamp === null) return null;

  return {
    clientId: row.client_id,
    endpoint: row.endpoint,
    statusCode: row.status_code,
    timestamp,
  };
}

function parseTimestamp(value: unknown): number | null {
  if (typeof value !== "string") return null;

  // Match date, time, optional fraction, and a required timezone.
  const format = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|[+-](\d{2}):(\d{2}))$/;
  const parts = format.exec(value);
  if (!parts) return null;

  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);
  const hour = Number(parts[4]);
  const minute = Number(parts[5]);
  const second = Number(parts[6]);
  const offsetHour = Number(parts[7] ?? 0);
  const offsetMinute = Number(parts[8] ?? 0);

  // Date.parse can silently turn February 30 into a March date.
  // Check the calendar ourselves before converting to milliseconds.
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth[month - 1]!) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  if (offsetHour > 23 || offsetMinute > 59) return null;

  const timestamp = Date.parse(value.toUpperCase());
  if (!Number.isFinite(timestamp)) return null;
  return timestamp;
}
