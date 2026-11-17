import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { trackUmami } from '../lib/umami';
import { createMockRequest } from './helper';

describe('Umami Telemetry', () => {
  const originalEnv = { ...process.env };
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    globalThis.fetch = originalFetch;
  });

  test('does nothing if UMAMI_URL or UMAMI_WEBSITE_ID is not set', async () => {
    delete process.env.UMAMI_URL;
    delete process.env.UMAMI_WEBSITE_ID;

    let fetchCalled = false;
    globalThis.fetch = async () => {
      fetchCalled = true;
      return new Response('{}');
    };

    const req = createMockRequest({
      method: 'POST',
      url: '/api/google/token',
    });

    trackUmami(req, 'Test Event', '/api/google/token/success', { outcome: 'success' });

    assert.equal(fetchCalled, false);
  });

  test('sends formatted pageview event when UMAMI configured', async () => {
    process.env.UMAMI_URL = 'https://analytics.example.com/api/send';
    process.env.UMAMI_WEBSITE_ID = 'test-website-uuid';
    process.env.UMAMI_USER_SALT = 'super-secret-salt';

    let sentUrl = '';
    let sentOptions: any = null;

    globalThis.fetch = async (url: string | URL | Request, options?: RequestInit) => {
      sentUrl = url.toString();
      sentOptions = options;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    const req = createMockRequest({
      method: 'POST',
      url: '/api/google/token',
      headers: {
        'user-agent': 'Obsidian/1.7.0',
        'x-forwarded-for': '203.0.113.195, 10.0.0.1',
        'accept-language': 'en-US,en;q=0.9',
        'referer': 'https://obsidian.md',
        'x-forwarded-proto': 'https',
        'host': 'proxy.example.com',
      },
    });

    trackUmami(req, 'Google Token (Initial) - Success', '/api/google/token/initial/success', {
      provider: 'google',
      flow: 'token_initial',
      outcome: 'success',
      http_status: 200,
      subject_seed: 'refresh_token_abc_123',
    });

    assert.equal(sentUrl, 'https://analytics.example.com/api/send');
    assert.ok(sentOptions);
    assert.equal(sentOptions.method, 'POST');
    assert.equal(sentOptions.headers['content-type'], 'application/json');
    assert.equal(sentOptions.headers['true-client-ip'], '203.0.113.195');
    assert.equal(sentOptions.headers['x-forwarded-for'], '203.0.113.195');

    const body = JSON.parse(sentOptions.body);
    assert.equal(body.type, 'event');
    assert.equal(body.payload.website, 'test-website-uuid');
    assert.equal(body.payload.url, '/api/google/token/initial/success');
    assert.equal(body.payload.title, 'Google Token (Initial) - Success');
    assert.equal(body.payload.ip, '203.0.113.195');
    assert.equal(body.payload.language, 'en-US,en;q=0.9');
    assert.equal(body.payload.hostname, 'proxy.example.com');
    assert.ok(body.payload.id, 'Should include distinct visitor id');
    assert.equal(body.payload.id.length, 32);

    assert.equal(body.payload.data.provider, 'google');
    assert.equal(body.payload.data.outcome, 'success');
    assert.equal(body.payload.data.http_status, 200);
    assert.equal(body.payload.data.browser_language, 'en-US');
  });

  test('replaces bot/node user-agent with realistic Obsidian user agent', async () => {
    process.env.UMAMI_URL = 'https://analytics.example.com/api/send';
    process.env.UMAMI_WEBSITE_ID = 'test-website-uuid';

    let capturedHeaders: any = null;
    let capturedPayload: any = null;

    globalThis.fetch = async (_url: string | URL | Request, options?: RequestInit) => {
      capturedHeaders = options?.headers;
      capturedPayload = JSON.parse(options?.body as string).payload;
      return new Response('{}');
    };

    const req = createMockRequest({
      method: 'POST',
      url: '/api/microsoft/refresh',
      headers: {
        'user-agent': 'undici',
      },
    });

    trackUmami(req, 'Microsoft Refresh - Success', '/api/microsoft/refresh/success');

    assert.ok(capturedHeaders['user-agent'].includes('Obsidian/1.7.0'));
    assert.ok(capturedPayload.userAgent.includes('Obsidian/1.7.0'));
  });
});
