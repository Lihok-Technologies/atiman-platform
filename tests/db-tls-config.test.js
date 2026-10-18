'use strict';

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { resolvePgSsl } = require('../src/config/database');

const ORIGINAL = {
  DB_SSL: process.env.DB_SSL,
  DB_SSL_REJECT_UNAUTHORIZED: process.env.DB_SSL_REJECT_UNAUTHORIZED,
  PGSSLMODE: process.env.PGSSLMODE
};

const setEnv = (key, value) => {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
};

afterEach(() => {
  for (const [key, value] of Object.entries(ORIGINAL)) setEnv(key, value);
});

describe('resolvePgSsl — shared PostgreSQL TLS policy', () => {
  it('enables TLS with verification when DB_SSL=true and DB_SSL_REJECT_UNAUTHORIZED=true', () => {
    setEnv('DB_SSL', 'true');
    setEnv('DB_SSL_REJECT_UNAUTHORIZED', 'true');
    assert.deepStrictEqual(resolvePgSsl(), { rejectUnauthorized: true });
  });

  it('enables TLS with verification disabled only on explicit DB_SSL_REJECT_UNAUTHORIZED=false', () => {
    setEnv('DB_SSL', 'true');
    setEnv('DB_SSL_REJECT_UNAUTHORIZED', 'false');
    assert.deepStrictEqual(resolvePgSsl(), { rejectUnauthorized: false });
  });

  it('disables TLS entirely when DB_SSL is not true', () => {
    setEnv('DB_SSL', undefined);
    setEnv('PGSSLMODE', undefined);
    setEnv('DB_SSL_REJECT_UNAUTHORIZED', undefined);
    assert.strictEqual(resolvePgSsl(), false);
  });

  it('defaults to verification (rejectUnauthorized=true) when DB_SSL_REJECT_UNAUTHORIZED is unset', () => {
    setEnv('DB_SSL', 'true');
    setEnv('DB_SSL_REJECT_UNAUTHORIZED', undefined);
    assert.deepStrictEqual(resolvePgSsl(), { rejectUnauthorized: true });
  });

  it('enables TLS via PGSSLMODE=require', () => {
    setEnv('DB_SSL', undefined);
    setEnv('PGSSLMODE', 'require');
    assert.deepStrictEqual(resolvePgSsl(), { rejectUnauthorized: true });
  });

  it('no silent fallback: any value other than exactly "false" keeps verification enabled', () => {
    setEnv('DB_SSL', 'true');
    setEnv('DB_SSL_REJECT_UNAUTHORIZED', 'no'); // not exactly 'false'
    assert.deepStrictEqual(resolvePgSsl(), { rejectUnauthorized: true });
  });
});

describe('operational scripts use the shared TLS policy (no PGSSL bypass)', () => {
  const scripts = [
    'scripts/bootstrap-knowledge/bootstrap.js',
    'scripts/m5r4b2/apply-taxonomy-application.js'
  ];

  for (const script of scripts) {
    it(`${script} uses resolvePgSsl and no longer references the legacy PGSSL flag`, () => {
      const src = fs.readFileSync(path.join(__dirname, '..', script), 'utf8');
      assert.ok(src.includes('resolvePgSsl'), `${script} must import/use resolvePgSsl`);
      assert.ok(!/\bPGSSL\b/.test(src), `${script} must not reference the legacy PGSSL flag`);
    });
  }
});
