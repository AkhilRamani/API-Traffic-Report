# Reading the ten-second rate window

Demo documentation for MySubscriptions. Related issue: #1. The examples below follow the current README policy; a manual CLI verification is still pending.

## Exact boundary: six requests, peak five

For one client, take six requests at 00:00:00, 00:00:02, 00:00:04, 00:00:06, 00:00:08 and 00:00:10 UTC on the same date. Give every request a distinct request ID.

At the final request, the window is (00:00:00, 00:00:10]. The first request is excluded, so the expected peak is 5 and rate_limit_exceeded is false. The total request_count is still 6.

## Just inside: peak six

Move only the final request to 00:00:09.999. All six now fall in the ten-second window, so the expected peak is 6 and rate_limit_exceeded is true.

## What does not reset the window

- Changing the endpoint: the policy is per client across all endpoints.
- Returning a failed response: failed requests count too.
- Reordering input lines: timestamps are sorted per client.
- Reusing a request ID: duplicates count again under the current input contract.

## Reviewer checklist

- Run both sequences through the CLI with otherwise valid JSONL records.
- Compare total request_count with peak_window_requests; they answer different questions.
- Shuffle the records and confirm the results stay the same.
- Do not silently deduplicate records or change the report schema.

Malformed-reason counts and duplicate policy changes are separate product decisions. No rate-limit or runtime behavior is changed by this guide.

Reference: [current input and rate-limit contract](../../README.md).
