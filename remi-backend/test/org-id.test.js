const assert = require('node:assert/strict');
const test = require('node:test');

const {
  OrgIdResolutionError,
  normalizeOrgId,
  resolveOrgId,
} = require('../dist/utils/org-id');

test('normalizeOrgId trims values and treats blanks as null', () => {
  assert.equal(normalizeOrgId(' org-123 '), 'org-123');
  assert.equal(normalizeOrgId('   '), null);
  assert.equal(normalizeOrgId(undefined), null);
});

test('resolveOrgId prefers request org_id when no stored org exists', () => {
  assert.equal(resolveOrgId({ bodyOrgId: 'org-123' }), 'org-123');
  assert.equal(resolveOrgId({ headerOrgId: 'org-123' }), 'org-123');
});

test('resolveOrgId preserves stored org_id when request org_id is missing', () => {
  assert.equal(resolveOrgId({ existingOrgId: 'org-123' }), 'org-123');
});

test('resolveOrgId rejects mismatched body and header org_id', () => {
  assert.throws(
    () => resolveOrgId({ bodyOrgId: 'org-a', headerOrgId: 'org-b' }),
    (error) =>
      error instanceof OrgIdResolutionError &&
      error.status === 400 &&
      error.message.includes('does not match')
  );
});

test('resolveOrgId rejects request org_id that conflicts with stored session org_id', () => {
  assert.throws(
    () =>
      resolveOrgId({
        bodyOrgId: 'org-b',
        existingOrgId: 'org-a',
        sessionId: 'session-123',
      }),
    (error) =>
      error instanceof OrgIdResolutionError &&
      error.status === 409 &&
      error.message.includes('session-123')
  );
});