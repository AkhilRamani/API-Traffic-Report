# API Traffic Report

A TypeScript CLI that reads JSONL request logs and prints request counts, malformed-line counts, and clients exceeding a rate limit. No runtime dependencies.

## Run

Requires Node.js 22+. Tested with Node.js 22.23.1 and npm 10.9.8.

```sh
npm ci
npm run build
node dist/cli.js sample_input/requests.jsonl
```

Pass exactly one file path. The report goes to stdout; use `> report.json` to save it. Usage or file-read errors go to stderr and exit with code 1. Malformed lines are counted and skipped; processing continues with exit code 0.

Run tests with `npm test`.

## Approach

- `src/cli.ts` reads the file line by line and prints the finished report.
- `src/validation.ts` parses each record and checks its fields.
- `src/report.ts` counts requests by client, endpoint, and status, then checks each client's rate.

Logs may be out of order, so timestamps are sorted per client. Two pointers track the requests inside a ten-second window and record the highest count. Output is sorted for repeatable results.

## Rate limit

**5 requests per client in any 10 seconds**, across all endpoints and response statuses. Failed requests count too.

This is a sample policy: it flags `acct_1`, which makes six requests in eight seconds. A production threshold would depend on API capacity and client agreements. Change `MAX_REQUESTS` and `WINDOW_MS` in `src/report.ts` to adjust it.

The window is `(t − 10 seconds, t]`: a request exactly ten seconds old is excluded. A sliding window catches bursts that cross fixed-window boundaries.

## Input assumptions

- Each line is a JSON object containing all five required fields. Extra fields are ignored.
- Request and client IDs must be non-empty strings. Endpoints must start with `/`. Values are preserved as supplied.
- Status codes must be integers from 100 to 599.
- Timestamps must have a valid date and time, with `Z` or a signed `HH:MM` offset. Fractions are handled at millisecond precision. Leap seconds and `24:00` are rejected.
- Request IDs are assumed unique. Duplicate records count again.
- Blank lines are malformed; a final newline adds no record. LF and CRLF are supported. Empty files produce zero counts.
- Input is expected to be UTF-8; byte-level encoding validation is not performed.

## Output

For the supplied sample:

```json
{
  "total_lines": 8,
  "valid_requests": 8,
  "malformed_lines": 0,
  "requests_by_endpoint": { "/v1/reports": 2, "/v1/widgets": 6 },
  "requests_by_status": { "200": 8 },
  "rate_limit": { "max_requests": 5, "window_seconds": 10 },
  "clients": [
    {
      "client_id": "acct_1",
      "request_count": 6,
      "peak_window_requests": 6,
      "rate_limit_exceeded": true
    },
    {
      "client_id": "acct_2",
      "request_count": 2,
      "peak_window_requests": 2,
      "rate_limit_exceeded": false
    }
  ]
}
```

`total_lines` includes valid and malformed lines. All request counts use valid records only. Each client entry gives its total requests, busiest window count, and whether that count exceeds the limit. Clients with no valid records are omitted.

## Trade-offs

Sorting takes O(n log n) time in the worst case. Timestamps stay in memory, so memory usage is O(n), plus the largest input line. There is no line-size limit.

With more time, I'd establish file-size limits and add malformed-reason counts for diagnosis. Files too large for memory would need external sorting. Duplicate handling would need an agreed upstream policy.
