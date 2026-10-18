'use strict';

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { resolvePgSsl } = require('../src/config/pg-ssl');

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

  it('disables TLS entirely when DB_SSL is not true and no SSL mode is set', () => {
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

  it('PGSSLMODE=verify-full enables TLS and forces verification', () => {
    setEnv('DB_SSL', undefined);
    setEnv('PGSSLMODE', 'verify-full');
    assert.deepStrictEqual(resolvePgSsl(), { rejectUnauthorized: true });
  });

  it('PGSSLMODE=verify-ca enables TLS and forces verification', () => {
    setEnv('DB_SSL', undefined);
    setEnv('PGSSLMODE', 'verify-ca');
    assert.deepStrictEqual(resolvePgSsl(), { rejectUnauthorized: true });
  });

  it('PGSSLMODE=verify-full forces verification even when DB_SSL_REJECT_UNAUTHORIZED=false', () => {
    setEnv('DB_SSL', 'true');
    setEnv('DB_SSL_REJECT_UNAUTHORIZED', 'false');
    setEnv('PGSSLMODE', 'verify-full');
    assert.deepStrictEqual(resolvePgSsl(), { rejectUnauthorized: true });
  });

  it('PGSSLMODE=require enables TLS (verification per DB_SSL_REJECT_UNAUTHORIZED)', () => {
    setEnv('DB_SSL', undefined);
    setEnv('PGSSLMODE', 'require');
    setEnv('DB_SSL_REJECT_UNAUTHORIZED', undefined);
    assert.deepStrictEqual(resolvePgSsl(), { rejectUnauthorized: true });
  });

  it('PGSSLMODE=prefer enables TLS (verification per DB_SSL_REJECT_UNAUTHORIZED)', () => {
    setEnv('DB_SSL', undefined);
    setEnv('PGSSLMODE', 'prefer');
    assert.deepStrictEqual(resolvePgSsl(), { rejectUnauthorized: true });
  });

  it('no silent fallback: any value other than exactly "false" for DB_SSL_REJECT_UNAUTHORIZED keeps verification enabled', () => {
    setEnv('DB_SSL', 'true');
    setEnv('DB_SSL_REJECT_UNAUTHORIZED', 'no');
    assert.deepStrictEqual(resolvePgSsl(), { rejectUnauthorized: true });
  });
});

describe('every pg connection path uses the shared TLS policy', () => {
  const pgPaths = [
    'src/config/database.js',
    'scripts/migrate-postgres.js',
    'scripts/smoke-test-pg.js',
    'scripts/bootstrap-knowledge/bootstrap.js',
    'scripts/m5r4b2/apply-taxonomy-application.js'
  ];

  for (const rel of pgPaths) {
    it(`${rel} uses resolvePgSsl and no legacy PGSSL flag`, () => {
      const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
      assert.ok(src.includes('resolvePgSsl'), `${rel} must use resolvePgSsl`);
      assert.ok(!/\bPGSSL\b/.test(src), `${rel} must not reference the legacy PGSSL flag`);
    });
  }
});
