/**
 * ATM-001-SEC-LEGACY-01-R1 — sensitive-field protection primitive.
 *
 * Non-database suite: exercises the redaction utility that guards every
 * user-bearing API response, including the recursive case (a list of users) and
 * the "must NOT over-redact" case (a permission matrix whose resource keys are
 * legitimate response data). The HTTP-level proof that no endpoint actually
 * emits credential material lives in the database-mutating suite
 * tests/user-route-tenant-isolation.test.js.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  sanitizeUser,
  redactSensitiveFields,
  isSensitiveField
} = require('../src/utils/helpers');

describe('ATM-001-SEC-LEGACY-01-R1 sensitive-field redaction', () => {
  it('removes credential material from a single user record', () => {
    const row = {
      id: 7,
      username: 'operator',
      email: 'operator@test.local',
      password_hash: '$2a$10$abcdefghijklmnopqrstuv',
      is_active: true
    };

    const sanitized = sanitizeUser(row);

    assert.ok(!('password_hash' in sanitized), 'password_hash must be removed');
    assert.strictEqual(sanitized.id, 7);
    assert.strictEqual(sanitized.username, 'operator');
    assert.strictEqual(sanitized.is_active, true);
  });

  it('does not mutate the record it sanitizes', () => {
    const row = { id: 1, password_hash: 'secret-hash' };
    sanitizeUser(row);
    assert.strictEqual(row.password_hash, 'secret-hash',
      'redaction must copy, never mutate the source row');
  });

  it('redacts credential fields recursively through arrays and nested envelopes', () => {
    const payload = {
      success: true,
      data: {
        users: [
          { id: 1, username: 'a', password_hash: 'hash-a' },
          { id: 2, username: 'b', password_hash: 'hash-b', reset_token: 'tok-b' }
        ]
      }
    };

    const redacted = redactSensitiveFields(payload);

    assert.deepStrictEqual(redacted, {
      success: true,
      data: { users: [{ id: 1, username: 'a' }, { id: 2, username: 'b' }] }
    });
    assert.strictEqual(payload.data.users[0].password_hash, 'hash-a',
      'the source payload must not be mutated');
  });

  it('recognises the credential vocabulary case-insensitively', () => {
    for (const field of [
      'password', 'PASSWORD_HASH', 'new_password', 'reset_token', 'refreshToken',
      'mfa_secret', 'client_secret', 'api_key', 'APIKEY', 'private_key', 'credentials',
      'accessToken', 'password_reset_token', 'id_token', 'otp_code', 'tokens', 'secrets',
      'passphrase', 'salt', 'pin', 'pin_hash', 'otp', 'backup_codes', 'recovery_codes',
      'key_hash', 'license_key', 'session_key', 'two_factor_code'
    ]) {
      assert.strictEqual(isSensitiveField(field), true, `${field} must be treated as sensitive`);
    }
  });

  it('does not over-redact legitimate non-credential response fields', () => {
    // Regression guard: the user router also serves /me/permissions. A blanket
    // substring rule would delete a permission resource key such as API_KEYS,
    // silently changing the presentation contract. Ordinary user fields,
    // permission resource names, and flag-style fields that merely mention a
    // credential concept must survive.
    for (const field of [
      'id', 'username', 'email', 'full_name', 'role', 'facility_id',
      'organization_id', 'is_organization_admin', 'is_sso_user', 'sso_provider',
      'last_login', 'status', 'is_billable',
      'mfa_enabled', 'otp_enabled', 'pin_required', 'salt_level',
      'USERS', 'WORK_ORDERS', 'KNOWLEDGE', 'SUBSCRIPTION', 'API_KEYS', 'api_keys', 'SSO'
    ]) {
      assert.strictEqual(isSensitiveField(field), false, `${field} must survive redaction`);
    }

    const permissions = {
      role: 'admin',
      permissions: { API_KEYS: { VIEW: 'all', CREATE: 'all' }, USERS: { VIEW: 'all' } }
    };
    assert.deepStrictEqual(redactSensitiveFields(permissions), permissions);
  });

  it('withholds password-adjacent metadata fail-closed, and that is a deliberate documented trade-off', () => {
    // The segment rule withholds any field whose name contains a credential word
    // as a delimited segment. A password-adjacent timestamp is therefore withheld
    // even though it is metadata, not a secret. That is the accepted direction of
    // error for a disclosure guard: losing a non-sensitive field is recoverable,
    // leaking a credential is not. No current response has such a field, so this
    // test exists to make the trade-off explicit rather than surprising.
    for (const field of ['password_expires_at', 'password_changed_at', 'password_last_used']) {
      assert.strictEqual(isSensitiveField(field), true,
        `${field} is withheld fail-closed by the segment rule`);
    }
  });

  it('passes primitives, null, dates and buffers through unchanged', () => {
    const date = new Date('2026-01-01T00:00:00.000Z');
    const buffer = Buffer.from('opaque');

    assert.strictEqual(redactSensitiveFields('text'), 'text');
    assert.strictEqual(redactSensitiveFields(42), 42);
    assert.strictEqual(redactSensitiveFields(null), null);
    assert.strictEqual(redactSensitiveFields(undefined), undefined);
    assert.strictEqual(redactSensitiveFields(date), date);
    assert.strictEqual(redactSensitiveFields(buffer), buffer);
    assert.strictEqual(sanitizeUser(null), null);
  });
});
