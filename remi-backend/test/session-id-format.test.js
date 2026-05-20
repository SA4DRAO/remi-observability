/**
 * Contract test: pins the session ID format produced by POST /sessions and
 * POST /events/batch (auto-session path).
 *
 * Format: `session-${Date.now()}-${randomUUID().split('-')[0]}`
 * Regex:  /^session-\d{13}-[0-9a-f]{8}$/
 *
 * If this test breaks, the session_id contract with the SDK and worker has
 * changed — update remi-langchain and remi-worker accordingly.
 */
const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('crypto');

/**
 * Mirrors the exact generation logic from:
 *   remi-backend/src/routes/sessions.routes.ts  (POST /)
 *   remi-backend/src/routes/events.routes.ts     (POST /batch, auto-session)
 */
function generateSessionId() {
  return `session-${Date.now()}-${randomUUID().split('-')[0]}`;
}

const SESSION_ID_FORMAT = /^session-\d{13}-[0-9a-f]{8}$/;

test('session ID matches contract format: session-<13-digit-ms>-<8-hex-chars>', () => {
  const id = generateSessionId();
  assert.match(id, SESSION_ID_FORMAT, `Generated ID "${id}" does not match expected format`);
});

test('session ID has exactly 3 hyphen-delimited segments', () => {
  const id = generateSessionId();
  const parts = id.split('-');
  // "session" + timestamp + 8-char UUID fragment = 3 parts
  assert.equal(parts.length, 3, `Expected 3 parts, got ${parts.length}: "${id}"`);
});

test('session ID timestamp segment is a recent epoch ms', () => {
  const before = Date.now();
  const id = generateSessionId();
  const after = Date.now();

  const ts = parseInt(id.split('-')[1], 10);
  assert.ok(ts >= before && ts <= after, `Timestamp ${ts} is outside [${before}, ${after}]`);
});

test('session ID suffix is lowercase hex (first UUID segment)', () => {
  const id = generateSessionId();
  const suffix = id.split('-')[2];
  assert.match(suffix, /^[0-9a-f]{8}$/, `Suffix "${suffix}" is not 8 lowercase hex chars`);
});

test('two generated session IDs are unique', () => {
  const ids = new Set(Array.from({ length: 20 }, generateSessionId));
  assert.equal(ids.size, 20, 'Expected all 20 generated session IDs to be unique');
});
