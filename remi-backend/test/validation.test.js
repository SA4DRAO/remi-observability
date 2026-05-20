const assert = require('node:assert/strict');
const test = require('node:test');

const {
  EventBatchSchema,
  SessionCreateSchema,
  SessionListQuerySchema,
  EventsListQuerySchema,
  GeneralEventsListQuerySchema,
} = require('../dist/types/validation');

// ── EventBatchSchema ───────────────────────────────────────────────────────────

test('EventBatchSchema accepts and trims org_id', () => {
  const parsed = EventBatchSchema.parse({
    events: [{ event_type: 'llm_start' }],
    org_id: ' org-123 ',
  });

  assert.equal(parsed.org_id, 'org-123');
});

test('EventBatchSchema rejects missing event_type', () => {
  const result = EventBatchSchema.safeParse({
    events: [{ run_id: '550e8400-e29b-41d4-a716-446655440000' }],
  });

  assert.equal(result.success, false);
});

test('EventBatchSchema rejects batch larger than 1000 events', () => {
  const result = EventBatchSchema.safeParse({
    events: Array.from({ length: 1001 }, () => ({ event_type: 'llm_start' })),
  });

  assert.equal(result.success, false);
});

test('EventBatchSchema accepts batch of exactly 1000 events', () => {
  const result = EventBatchSchema.safeParse({
    events: Array.from({ length: 1000 }, () => ({ event_type: 'llm_start' })),
  });

  assert.equal(result.success, true);
});

test('EventBatchSchema rejects negative _seq', () => {
  const result = EventBatchSchema.safeParse({
    events: [{ event_type: 'llm_start', _seq: -1 }],
  });

  assert.equal(result.success, false);
});

test('EventBatchSchema rejects non-integer _seq (float)', () => {
  const result = EventBatchSchema.safeParse({
    events: [{ event_type: 'llm_start', _seq: 1.5 }],
  });

  assert.equal(result.success, false);
});

test('EventBatchSchema deduplicates by session_id + _seq via DB (schema allows same seq across requests)', () => {
  // Two events with same session_id and _seq are structurally valid —
  // deduplication is enforced at the DB layer, not here.
  const result = EventBatchSchema.safeParse({
    events: [
      { event_type: 'llm_start', session_id: 's1', _seq: 1 },
      { event_type: 'llm_end', session_id: 's1', _seq: 1 },
    ],
  });

  assert.equal(result.success, true);
});

test('EventBatchSchema rejects run_id that is not a UUID', () => {
  const result = EventBatchSchema.safeParse({
    events: [{ event_type: 'llm_start', run_id: 'not-a-uuid' }],
  });

  assert.equal(result.success, false);
});

test('EventBatchSchema accepts run_id as valid UUID', () => {
  const result = EventBatchSchema.safeParse({
    events: [{ event_type: 'llm_start', run_id: '550e8400-e29b-41d4-a716-446655440000' }],
  });

  assert.equal(result.success, true);
});

// ── SessionCreateSchema ────────────────────────────────────────────────────────

test('SessionCreateSchema rejects blank org_id', () => {
  const result = SessionCreateSchema.safeParse({
    name: 'Session',
    org_id: '   ',
  });

  assert.equal(result.success, false);
});

// ── SessionListQuerySchema ─────────────────────────────────────────────────────

test('SessionListQuerySchema rejects limit=-1', () => {
  const result = SessionListQuerySchema.safeParse({ limit: '-1', offset: '0' });
  assert.equal(result.success, false);
});

test('SessionListQuerySchema rejects limit=abc', () => {
  const result = SessionListQuerySchema.safeParse({ limit: 'abc', offset: '0' });
  assert.equal(result.success, false);
});

test('SessionListQuerySchema rejects offset=-1', () => {
  const result = SessionListQuerySchema.safeParse({ limit: '10', offset: '-1' });
  assert.equal(result.success, false);
});

test('SessionListQuerySchema rejects limit exceeding max (500)', () => {
  const result = SessionListQuerySchema.safeParse({ limit: '501' });
  assert.equal(result.success, false);
});

test('SessionListQuerySchema applies defaults when params absent', () => {
  const parsed = SessionListQuerySchema.parse({});
  assert.equal(parsed.limit, 50);
  assert.equal(parsed.offset, 0);
});

test('SessionListQuerySchema coerces string numbers', () => {
  const parsed = SessionListQuerySchema.parse({ limit: '25', offset: '10' });
  assert.equal(parsed.limit, 25);
  assert.equal(parsed.offset, 10);
});

// ── EventsListQuerySchema ──────────────────────────────────────────────────────

test('EventsListQuerySchema rejects limit=-1', () => {
  const result = EventsListQuerySchema.safeParse({ limit: '-1' });
  assert.equal(result.success, false);
});

test('EventsListQuerySchema rejects limit exceeding max (1000)', () => {
  const result = EventsListQuerySchema.safeParse({ limit: '1001' });
  assert.equal(result.success, false);
});

test('EventsListQuerySchema rejects blank event_type', () => {
  const result = EventsListQuerySchema.safeParse({ event_type: '   ' });
  assert.equal(result.success, false);
});

test('EventsListQuerySchema accepts valid event_type', () => {
  const parsed = EventsListQuerySchema.parse({ event_type: 'llm_end' });
  assert.equal(parsed.event_type, 'llm_end');
});

// ── GeneralEventsListQuerySchema ───────────────────────────────────────────────

test('GeneralEventsListQuerySchema rejects limit=abc', () => {
  const result = GeneralEventsListQuerySchema.safeParse({ limit: 'abc' });
  assert.equal(result.success, false);
});

test('GeneralEventsListQuerySchema rejects offset=-1', () => {
  const result = GeneralEventsListQuerySchema.safeParse({ offset: '-1' });
  assert.equal(result.success, false);
});

test('GeneralEventsListQuerySchema rejects limit exceeding max (2000)', () => {
  const result = GeneralEventsListQuerySchema.safeParse({ limit: '2001' });
  assert.equal(result.success, false);
});

test('GeneralEventsListQuerySchema accepts valid session_id filter', () => {
  const parsed = GeneralEventsListQuerySchema.parse({ session_id: 'session-abc' });
  assert.equal(parsed.session_id, 'session-abc');
});

test('GeneralEventsListQuerySchema rejects blank session_id', () => {
  const result = GeneralEventsListQuerySchema.safeParse({ session_id: '  ' });
  assert.equal(result.success, false);
});