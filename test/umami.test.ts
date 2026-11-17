import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { trackUmami } from '../src/lib/umami';
import type { Env } from '../src/types';
import { mockEnv, createMockExecutionContext } from './helper';

describe('Umami Telemetry', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('does nothing if UMAMI_URL or UMAMI_WEBSITE_ID is not set', async () => {
    let fetchCalled = false;
    globalThis.fetch = async () => {
      fetchCalled = true;
      return new Response('{}');
    };

    const app = new Hono<{ Bindings: Env }>();
    app.post('/test', (c) => {
      trackUmami(c, 'Test Event', '/api/google/token/success', { outcome: 'success' });
      return c.text('ok');
    });

    const emptyEnv = { ...mockEnv, UMAMI_URL: '', UMAMI_WEBSITE_ID: '' };
    const ctx = createMockExecutionContext();

    await app.request('https://proxy.example.com/test', {
      method: 'POST',
    }, emptyEnv, ctx);
    await ctx.waitForAll();

    assert.equal(fetchCalled, false);
  });

  test('sends formatted pageview event when UMAMI configured', async () => {
    let sentUrl = '';
    let sentOptions: any = null;

    globalThis.fetch = async (url: string | URL | Request, options?: RequestInit) => {
      sentUrl = url.toString();
      sentOptions = options;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    const app = new Hono<{ Bindings: Env }>();
    app.post('/test', (c) => {
      trackUmami(c, 'Google Token (Initial) - Success', '/api/google/token/initial/success', {
        provider: 'google',
        flow: 'token_initial',
        outcome: 'success',
        http_status: 200,
        subject_seed: 'refresh_token_abc_123',
      });
      return c.text('ok');
    });

    const ctx = createMockExecutionContext();
    await app.request('https://proxy.example.com/test', {
      method: 'POST',
      headers: {
        'user-agent': 'Obsidian/1.7.0',
        'cf-connecting-ip': '203.0.113.195',
        'accept-language': 'en-US,en;q=0.9',
        'referer': 'https://obsidian.md',
      },
    }, mockEnv, ctx);
    await ctx.waitForAll();

    assert.equal(sentUrl, 'https://umami.example.com/api/send');
    assert.ok(sentOptions);
    assert.equal(sentOptions.method, 'POST');
    assert.equal(sentOptions.headers['content-type'], 'application/json');
    assert.equal(sentOptions.headers['true-client-ip'], '203.0.113.195');
    assert.equal(sentOptions.headers['x-forwarded-for'], '203.0.113.195');

    const body = JSON.parse(sentOptions.body);
    assert.equal(body.type, 'event');
    assert.equal(body.payload.website, 'mock-website-id');
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
    let sentOptions: any = null;

    globalThis.fetch = async (_url: string | URL | Request, options?: RequestInit) => {
      sentOptions = options;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    const app = new Hono<{ Bindings: Env }>();
    app.post('/test', (c) => {
      trackUmami(c, 'Google Token - Success', '/api/google/token/success', {});
      return c.text('ok');
    });

    const ctx = createMockExecutionContext();
    await app.request('https://proxy.example.com/test', {
      method: 'POST',
      headers: {
        'user-agent': 'node-fetch/1.0 (undici)',
      },
    }, mockEnv, ctx);
    await ctx.waitForAll();

    const body = JSON.parse(sentOptions.body);
    assert.match(body.payload.userAgent, /Electron/);
    assert.match(sentOptions.headers['user-agent'], /Electron/);
  });
});
