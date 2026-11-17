import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/index';
import { mockEnv, createMockExecutionContext } from './helper';

describe('Microsoft OAuth Endpoints', () => {
  let env = { ...mockEnv };
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    env = { ...mockEnv };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('POST /api/microsoft/token', () => {
    test('handles OPTIONS preflight correctly', async () => {
      const res = await app.request('/api/microsoft/token', {
        method: 'OPTIONS',
      }, env, createMockExecutionContext());

      assert.equal(res.status, 204);
      assert.equal(res.headers.get('access-control-allow-origin'), '*');
      assert.ok(res.headers.get('access-control-allow-methods')?.includes('POST'));
    });

    test('returns 500 when MICROSOFT_CLIENT_ID is missing', async () => {
      const missingEnv = { ...env, MICROSOFT_CLIENT_ID: '' };
      const res = await app.request('/api/microsoft/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'code', code_verifier: 'verifier' }),
      }, missingEnv, createMockExecutionContext());

      assert.equal(res.status, 500);
      const data: any = await res.json();
      assert.match(data.error, /Missing MICROSOFT_CLIENT_ID/);
    });

    test('returns 400 when code or code_verifier is missing', async () => {
      const res = await app.request('/api/microsoft/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'code' }),
      }, env, createMockExecutionContext());

      assert.equal(res.status, 400);
      const data: any = await res.json();
      assert.match(data.error, /Missing code or code_verifier/);
    });

    test('successfully exchanges code with Entra ID PKCE flow', async () => {
      let fetchUrl = '';
      let fetchBody = '';

      globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
        if (url.toString().includes('microsoftonline.com')) {
          fetchUrl = url.toString();
          fetchBody = init?.body?.toString() || '';
          return new Response(
            JSON.stringify({
              access_token: 'mock-ms-access-token',
              refresh_token: 'mock-ms-refresh-token',
              expires_in: 3600,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response(null, { status: 200 });
      };

      const res = await app.request('/api/microsoft/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'ms-auth-code', code_verifier: 'ms-verifier' }),
      }, env, createMockExecutionContext());

      assert.equal(res.status, 200);
      assert.equal(fetchUrl, 'https://login.microsoftonline.com/common/oauth2/v2.0/token');
      assert.ok(fetchBody.includes('client_id=mock-ms-client-id'));
      assert.ok(fetchBody.includes('code=ms-auth-code'));
      assert.ok(fetchBody.includes('code_verifier=ms-verifier'));
      assert.ok(fetchBody.includes('redirect_uri=http%3A%2F%2Flocalhost%3A42813%2Fcallback'));
      const data: any = await res.json();
      assert.equal(data.access_token, 'mock-ms-access-token');
      assert.equal(data.refresh_token, 'mock-ms-refresh-token');
    });

    test('handles upstream Microsoft error correctly', async () => {
      globalThis.fetch = async (url: string | URL | Request) => {
        if (url.toString().includes('microsoftonline.com')) {
          return new Response(
            JSON.stringify({
              error: 'invalid_grant',
              error_description: 'Code expired',
            }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response(null, { status: 200 });
      };

      const res = await app.request('/api/microsoft/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'bad-code', code_verifier: 'verifier' }),
      }, env, createMockExecutionContext());

      assert.equal(res.status, 400);
      const data: any = await res.json();
      assert.equal(data.error, 'invalid_grant');
    });
  });

  describe('POST /api/microsoft/refresh', () => {
    test('handles OPTIONS preflight correctly', async () => {
      const res = await app.request('/api/microsoft/refresh', {
        method: 'OPTIONS',
      }, env, createMockExecutionContext());

      assert.equal(res.status, 204);
    });

    test('returns 400 when refresh_token is missing', async () => {
      const res = await app.request('/api/microsoft/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }, env, createMockExecutionContext());

      assert.equal(res.status, 400);
      const data: any = await res.json();
      assert.match(data.error, /Missing refresh_token/);
    });

    test('successfully refreshes token with Microsoft', async () => {
      let fetchBody = '';
      globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
        if (url.toString().includes('microsoftonline.com')) {
          fetchBody = init?.body?.toString() || '';
          return new Response(
            JSON.stringify({
              access_token: 'new-ms-access-token',
              expires_in: 3600,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response(null, { status: 200 });
      };

      const res = await app.request('/api/microsoft/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: 'stored-ms-refresh' }),
      }, env, createMockExecutionContext());

      assert.equal(res.status, 200);
      assert.ok(fetchBody.includes('grant_type=refresh_token'));
      assert.ok(fetchBody.includes('refresh_token=stored-ms-refresh'));
      const data: any = await res.json();
      assert.equal(data.access_token, 'new-ms-access-token');
    });
  });
});
