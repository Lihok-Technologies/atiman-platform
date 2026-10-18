'use strict';

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert');

const { getPublicBaseUrl } = require('../src/utils/helpers');

const ORIGINAL_APP_URL = process.env.APP_URL;

const setAppUrl = (value) => {
  if (value === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = value;
};

afterEach(() => {
  if (ORIGINAL_APP_URL === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = ORIGINAL_APP_URL;
});

describe('getPublicBaseUrl — canonical URL validation', () => {
  it('returns the canonical origin for a valid production URL', () => {
    setAppUrl('https://atiman-api.onrender.com');
    assert.strictEqual(getPublicBaseUrl(), 'https://atiman-api.onrender.com');
  });

  it('normalizes a trailing slash', () => {
    setAppUrl('https://app.example.com/');
    assert.strictEqual(getPublicBaseUrl(), 'https://app.example.com');
  });

  it('rejects a missing APP_URL (fails closed)', () => {
    setAppUrl(undefined);
    assert.throws(() => getPublicBaseUrl(), /not configured/);
  });

  it('rejects a malformed APP_URL', () => {
    setAppUrl('not a url');
    assert.throws(() => getPublicBaseUrl(), /malformed/);
  });

  it('rejects a non-http(s) scheme', () => {
    setAppUrl('ftp://app.example.com');
    assert.throws(() => getPublicBaseUrl(), /unsupported scheme/);
  });

  it('rejects embedded credentials', () => {
    setAppUrl('https://user:pass@example.com');
    assert.throws(() => getPublicBaseUrl(), /credentials/);
  });

  it('rejects a path / query / fragment (must be a bare origin)', () => {
    setAppUrl('https://app.example.com/path');
    assert.throws(() => getPublicBaseUrl(), /origin only/);
    setAppUrl('https://app.example.com/?q=1');
    assert.throws(() => getPublicBaseUrl(), /origin only/);
    setAppUrl('https://app.example.com/#frag');
    assert.throws(() => getPublicBaseUrl(), /origin only/);
  });

  it('accepts HTTPS in production', () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      setAppUrl('https://atiman-api.onrender.com');
      assert.strictEqual(getPublicBaseUrl(), 'https://atiman-api.onrender.com');
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it('rejects HTTP in production', () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      setAppUrl('http://atiman-api.onrender.com');
      assert.throws(() => getPublicBaseUrl(), /HTTPS in production/);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it('accepts HTTP in development', () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      setAppUrl('http://localhost:3000');
      assert.strictEqual(getPublicBaseUrl(), 'http://localhost:3000');
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});

describe('controllers ignore client-controllable headers', () => {
  // A request that aggressively spoofs every proxy/forwarding header.
  const spoofedReq = (extra = {}) => ({
    user: { organization_id: 7 },
    body: { planCode: 'basic' },
    params: { id: 123 },
    protocol: 'http',
    headers: {
      'x-forwarded-proto': 'http',
      'x-forwarded-host': 'evil.example.com',
      'x-forwarded-for': '203.0.113.9',
      host: 'evil.example.com'
    },
    ...extra
  });

  const jsonRes = () => {
    const res = {
      statusCode: 200,
      payload: null,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.payload = body; return this; }
    };
    return res;
  };

  it('payment createCheckout builds return URLs from APP_URL, not headers', async () => {
    setAppUrl('https://app.example.com');
    const paymentService = require('../src/services/payment.service');
    const original = paymentService.createCheckoutSession;
    let captured = null;
    paymentService.createCheckoutSession = async (orgId, planCode, successUrl, cancelUrl) => {
      captured = { successUrl, cancelUrl };
      return { sessionId: 'sess_123', url: 'https://checkout.stripe.com/c/pay/cs_test' };
    };
    try {
      const controller = require('../src/controllers/payment.controller');
      await controller.createCheckout(spoofedReq(), jsonRes(), () => {});
      assert.ok(captured, 'payment service must have been called');
      assert.strictEqual(captured.successUrl, 'https://app.example.com/mobile/admin/subscription?payment=success');
      assert.strictEqual(captured.cancelUrl, 'https://app.example.com/mobile/admin/subscription?payment=cancelled');
      assert.ok(!captured.successUrl.includes('evil.example.com'), 'spoofed x-forwarded-host must be ignored');
      assert.ok(!captured.successUrl.startsWith('http://'), 'spoofed x-forwarded-proto must be ignored');
    } finally {
      paymentService.createCheckoutSession = original;
    }
  });

  it('payment createCheckout fails closed when APP_URL is invalid', async () => {
    setAppUrl('ftp://app.example.com');
    const paymentService = require('../src/services/payment.service');
    const original = paymentService.createCheckoutSession;
    let called = false;
    paymentService.createCheckoutSession = async () => { called = true; return {}; };
    try {
      const controller = require('../src/controllers/payment.controller');
      const res = jsonRes();
      await controller.createCheckout(spoofedReq(), res, () => {});
      assert.strictEqual(called, false, 'payment service must not be called on invalid canonical URL');
      assert.strictEqual(res.statusCode, 500, 'the endpoint must fail closed');
    } finally {
      paymentService.createCheckoutSession = original;
    }
  });

  it('qr-label getAssetQR uses APP_URL, not headers', async () => {
    setAppUrl('https://app.example.com');
    const qrLabelService = require('../src/services/qr-label.service');
    const original = qrLabelService.generateForAsset;
    let captured = null;
    qrLabelService.generateForAsset = async (assetId, baseUrl) => {
      captured = { assetId, baseUrl };
      return { asset: { id: assetId, name: 'A', code: 'A' }, qrData: 'qr', qrImage: 'img' };
    };
    try {
      const controller = require('../src/controllers/qr-label.controller');
      await controller.getAssetQR(spoofedReq(), jsonRes(), () => {});
      assert.ok(captured, 'qr service must have been called');
      assert.strictEqual(captured.baseUrl, 'https://app.example.com');
      assert.ok(!captured.baseUrl.includes('evil.example.com'), 'spoofed headers must be ignored');
    } finally {
      qrLabelService.generateForAsset = original;
    }
  });

  it('equipment getQRCode uses APP_URL, not headers', async () => {
    setAppUrl('https://app.example.com');
    const Equipment = require('../src/models/equipment.model');
    const original = Equipment.getQRCodeData;
    let captured = null;
    Equipment.getQRCodeData = async (id, organizationId, baseUrl) => {
      captured = { id, organizationId, baseUrl };
      return { qr: 'data' };
    };
    try {
      const equipment = require('../src/controllers/equipment.controller');
      await equipment.getQRCode(spoofedReq(), jsonRes(), () => {});
      assert.ok(captured, 'equipment model must have been called');
      assert.strictEqual(captured.baseUrl, 'https://app.example.com');
      assert.ok(!captured.baseUrl.includes('evil.example.com'), 'spoofed headers must be ignored');
    } finally {
      Equipment.getQRCodeData = original;
    }
  });
});
