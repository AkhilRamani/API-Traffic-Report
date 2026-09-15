const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { spawnSync } = require('node:child_process');
const { buildReport } = require('../dist/report.js');

const record = (overrides = {}) => ({
  request_id: 'r1', timestamp: '2024-01-15T10:00:00Z',
  client_id: 'acct_1', endpoint: '/v1/widgets', status_code: 200, ...overrides,
});
const line = overrides => JSON.stringify(record(overrides));
const cli = (...args) => spawnSync(process.execPath, [resolve(__dirname, '../dist/cli.js'), ...args], { encoding: 'utf8' });

test('sample produces the full expected report', async () => {
  const input = readFileSync(resolve(__dirname, '../sample_input/requests.jsonl'), 'utf8').trimEnd().split('\n');
  assert.deepEqual(await buildReport(input), {
    total_lines: 8, valid_requests: 8, malformed_lines: 0,
    requests_by_endpoint: { '/v1/reports': 2, '/v1/widgets': 6 },
    requests_by_status: { '200': 8 },
    rate_limit: { max_requests: 5, window_seconds: 10 },
    clients: [
      { client_id: 'acct_1', request_count: 6, peak_window_requests: 6, rate_limit_exceeded: true },
      { client_id: 'acct_2', request_count: 2, peak_window_requests: 2, rate_limit_exceeded: false },
    ],
  });
});

test('empty input produces zero counts', async () => {
  const report = await buildReport([]);
  assert.equal(report.total_lines, 0);
  assert.equal(report.valid_requests, 0);
  assert.equal(report.malformed_lines, 0);
  assert.deepEqual(report.clients, []);
  assert.deepEqual(report.requests_by_endpoint, {});
});

test('malformed lines are discarded once and processing continues', async () => {
  const bad = ['', ' ', '{', 'null', '[]', '42', '{}',
    line({ request_id: '' }), line({ client_id: ' ' }), line({ endpoint: 'widgets' }),
    line({ status_code: '200' }), line({ status_code: 200.5 }),
    line({ status_code: 99 }), line({ status_code: 600 }),
    line({ timestamp: '2023-02-29T10:00:00Z' }),
    line({ timestamp: '2024-04-31T10:00:00Z' }),
    line({ timestamp: '2024-01-15T24:00:00Z' }),
    line({ timestamp: '2024-01-15T10:00:00' }),
    line({ timestamp: '2024-01-15T10:00:00+24:00' }),
    line({ timestamp: '2024-01-15T10:00:00+01:60' }),
    line({ timestamp: '2024-01-15T10:00:60Z' })];
  const report = await buildReport([line(), ...bad, line({ timestamp: '2024-02-29T10:00:00Z', extra: true })]);
  assert.equal(report.total_lines, bad.length + 2);
  assert.equal(report.malformed_lines, bad.length);
  assert.equal(report.valid_requests, 2);
  assert.deepEqual(report.requests_by_status, { '200': 2 });
});

test('five simultaneous requests are allowed and six violate', async () => {
  for (const count of [5, 6]) {
    const report = await buildReport(Array.from({ length: count }, (_, i) => line({ request_id: String(i) })));
    assert.equal(report.clients[0].peak_window_requests, count);
    assert.equal(report.clients[0].rate_limit_exceeded, count === 6);
  }
});

test('exact ten-second boundary is excluded; one millisecond inside is included', async () => {
  for (const [last, peak] of [['10.000', 5], ['09.999', 6]]) {
    const input = Array.from({ length: 5 }, () => line());
    input.push(line({ timestamp: `2024-01-15T10:00:${last}Z` }));
    const report = await buildReport(input.reverse());
    assert.equal(report.clients[0].peak_window_requests, peak);
  }
});

test('equivalent offsets share a window across endpoints and error statuses', async () => {
  const timestamps = ['2024-01-15T10:00:00Z', '2024-01-15T11:00:00+01:00', '2024-01-15T05:00:00-05:00'];
  const report = await buildReport(Array.from({ length: 6 }, (_, i) => line({
    timestamp: timestamps[i % 3], endpoint: i % 2 ? '/other' : '/', status_code: i % 2 ? 500 : 429,
  })));
  assert.equal(report.clients[0].peak_window_requests, 6);
  assert.equal(report.clients[0].rate_limit_exceeded, true);
  assert.deepEqual(report.requests_by_status, { '429': 3, '500': 3 });
});

test('clients are independent and arbitrary client IDs are safe', async () => {
  const report = await buildReport(['z', '__proto__', 'constructor', 'a'].map(client_id => line({ client_id })));
  assert.deepEqual(report.clients.map(c => c.client_id), ['__proto__', 'a', 'constructor', 'z']);
  assert.ok(report.clients.every(c => c.request_count === 1 && !c.rate_limit_exceeded));
});

test('CLI supports CRLF, blank lines, trailing newline and no final newline', () => {
  const directory = mkdtempSync(join(tmpdir(), 'traffic-report-'));
  try {
    for (const ending of ['', '\r\n']) {
      const path = join(directory, 'input.jsonl');
      writeFileSync(path, line() + '\r\n\r\n' + line() + ending);
      const result = cli(path);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stderr, '');
      const report = JSON.parse(result.stdout);
      assert.equal(report.total_lines, 3);
      assert.equal(report.valid_requests, 2);
      assert.equal(report.malformed_lines, 1);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('CLI failures have nonzero exit, stderr diagnostics and no report', () => {
  for (const args of [[], ['a', 'b'], [resolve(__dirname, 'missing-input.jsonl')], [__dirname]]) {
    const result = cli(...args);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /^Error: /);
  }
});

test('a read failure during processing rejects instead of returning a partial report', async () => {
  async function* brokenInput() {
    yield line();
    throw new Error('read failed');
  }
  await assert.rejects(buildReport(brokenInput()), /read failed/);
});
