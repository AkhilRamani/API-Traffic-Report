import { parseRequest } from "./validation.js";

export const MAX_REQUESTS = 5;
export const WINDOW_MS = 10_000;

export interface TrafficReport {
  total_lines: number;
  valid_requests: number;
  malformed_lines: number;
  requests_by_endpoint: Record<string, number>;
  requests_by_status: Record<string, number>;
  rate_limit: { max_requests: number; window_seconds: number };
  clients: Array<{
    client_id: string;
    request_count: number;
    peak_window_requests: number;
    rate_limit_exceeded: boolean;
  }>;
}

function increment(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function sortedCounts(counts: Map<string, number>): Record<string, number> {
  const entries = [...counts.entries()];
  entries.sort(([firstKey], [secondKey]) => {
    if (firstKey < secondKey) return -1;
    if (firstKey > secondKey) return 1;
    return 0;
  });
  return Object.fromEntries(entries);
}

function peakWindowRequests(timestamps: number[]): number {
  timestamps.sort((a, b) => a - b);

  let windowStart = 0;
  let peakCount = 0;

  for (let current = 0; current < timestamps.length; current++) {
    const currentTime = timestamps[current]!;

    // Move past requests that are at least ten seconds old.
    // A request exactly ten seconds old is outside the window.
    while (currentTime - timestamps[windowStart]! >= WINDOW_MS) {
      windowStart++;
    }

    const requestsInWindow = current - windowStart + 1;
    peakCount = Math.max(peakCount, requestsInWindow);
  }

  return peakCount;
}

export async function buildReport(
  lines: AsyncIterable<string> | Iterable<string>,
): Promise<TrafficReport> {
  let totalLines = 0;
  let malformedLines = 0;
  const endpoints = new Map<string, number>();
  const statuses = new Map<string, number>();
  const clientTimestamps = new Map<string, number[]>();

  // 1. Validate each line, count requests, and group timestamps by client.
  for await (const line of lines) {
    totalLines++;

    const request = parseRequest(line);

    if (request === null) {
      malformedLines++;
      continue;
    }

    increment(endpoints, request.endpoint);
    increment(statuses, String(request.statusCode));

    const timestamps = clientTimestamps.get(request.clientId) ?? [];

    timestamps.push(request.timestamp);
    clientTimestamps.set(request.clientId, timestamps);
  }

  // 2. Build one summary per client, in client ID order.
  const clients: TrafficReport["clients"] = [];
  const clientIds = [...clientTimestamps.keys()].sort();

  for (const clientId of clientIds) {
    const timestamps = clientTimestamps.get(clientId)!;

    const peak = peakWindowRequests(timestamps);

    clients.push({
      client_id: clientId,
      request_count: timestamps.length,
      peak_window_requests: peak,
      rate_limit_exceeded: peak > MAX_REQUESTS,
    });
  }

  // 3. Return the final report. The CLI handles printing it.
  return {
    total_lines: totalLines,
    valid_requests: totalLines - malformedLines,
    malformed_lines: malformedLines,
    requests_by_endpoint: sortedCounts(endpoints),
    requests_by_status: sortedCounts(statuses),
    rate_limit: {
      max_requests: MAX_REQUESTS,
      window_seconds: WINDOW_MS / 1000,
    },
    clients,
  };
}
