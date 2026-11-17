import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/index';
import { mockEnv, createMockExecutionContext } from './helper';

describe('Google OAuth Endpoints', () => {
  let env = { ...mockEnv };
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    env = { ...mockEnv };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('POST /api/google/token', () => {
    test('handles OPTIONS preflight correctly', async () => {
      const res = await app.request('/api/google/token', {
        method: 'OPTIONS',
      }, env, createMockExecutionContext());

      assert.equal(res.status, 204);
      assert.equal(res.headers.get('access-control-allow-origin'), '*');
      assert.ok(res.headers.get('access-control-allow-methods')?.includes('POST'));
    });

    test('rejects unmapped methods with 404', async () => {
      const res = await app.request('/api/google/token', {
        method: 'PUT',
      }, env, createMockExecutionContext());

      assert.equal(res.status, 404);
    });

    test('returns 500 when Google credentials are missing', async () => {
      const missingEnv = { ...env, GOOGLE_CLIENT_ID: '' };
      const res = await app.request('/api/google/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'auth-code', code_verifier: 'verifier-123' }),
      }, missingEnv, createMockExecutionContext());

      assert.equal(res.status, 500);
      const data: any = await res.json();
      assert.match(data.error, /Missing Google credentials/);
    });

    test('returns 400 when code or code_verifier is missing', async () => {
      const res = await app.request('/api/google/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'only-code' }),
      }, env, createMockExecutionContext());

      assert.equal(res.status, 400);
      const data: any = await res.json();
      assert.match(data.error, /Missing code or code_verifier/);
    });

    test('successfully exchanges code for tokens and uses custom redirect_uri if allowed', async () => {
      let fetchUrl = '';
      let fetchBody = '';

      globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
        if (url.toString().includes('oauth2.googleapis.com')) {
          fetchUrl = url.toString();
          fetchBody = init?.body?.toString() || '';
          return new Response(
            JSON.stringify({
              access_token: 'mock-access-token',
              refresh_token: 'mock-refresh-token',
              expires_in: 3600,
              token_type: 'Bearer',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response(null, { status: 200 });
      };

      const ctx = createMockExecutionContext();
      const res = await app.request('/api/google/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: 'test-code',
          code_verifier: 'test-verifier',
          redirect_uri: 'http://localhost:42813/callback',
        }),
      }, env, ctx);

      assert.equal(res.status, 200);
      assert.equal(fetchUrl, 'https://oauth2.googleapis.com/token');
      assert.ok(fetchBody.includes('redirect_uri=http%3A%2F%2Flocalhost%3A42813%2Fcallback'));
      assert.ok(fetchBody.includes('client_id=mock-google-client-id'));
      const data: any = await res.json();
      assert.equal(data.access_token, 'mock-access-token');
      assert.equal(data.refresh_token, 'mock-refresh-token');
    });

    test('falls back to default redirect_uri if provided uri is disallowed', async () => {
      let fetchBody = '';
      globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
        if (url.toString().includes('oauth2.googleapis.com')) {
          fetchBody = init?.body?.toString() || '';
          return new Response(JSON.stringify({ access_token: 'mock-token' }), { status: 200 });
        }
        return new Response(null, { status: 200 });
      };

      const res = await app.request('/api/google/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: 'test-code',
          code_verifier: 'test-verifier',
          redirect_uri: 'https://malicious.com/callback',
        }),
      }, env, createMockExecutionContext());

      assert.equal(res.status, 200);
      assert.ok(fetchBody.includes('redirect_uri=http%3A%2F%2F127.0.0.1%3A42813%2Fcallback'));
    });

    test('handles upstream Google error correctly', async () => {
      globalThis.fetch = async (url: string | URL | Request) => {
        if (url.toString().includes('oauth2.googleapis.com')) {
          return new Response(
            JSON.stringify({
              error: 'invalid_grant',
              error_description: 'Bad Request',
            }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response(null, { status: 200 });
      };

      const res = await app.request('/api/google/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'bad-code', code_verifier: 'verifier' }),
      }, env, createMockExecutionContext());

      assert.equal(res.status, 400);
      const data: any = await res.json();
      assert.equal(data.error, 'invalid_grant');
    });

    test('catches unexpected exceptions and returns 500', async () => {
      const originalConsoleError = console.error;
      console.error = () => {};
      try {
        globalThis.fetch = async () => {
          throw new Error('Network failure');
        };

        const res = await app.request('/api/google/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: 'code', code_verifier: 'verifier' }),
        }, env, createMockExecutionContext());

        assert.equal(res.status, 500);
        const data: any = await res.json();
        assert.deepEqual(data, { error: 'Internal Server Error' });
      } finally {
        console.error = originalConsoleError;
      }
    });
  });

  describe('POST /api/google/refresh', () => {
    test('handles OPTIONS preflight correctly', async () => {
      const res = await app.request('/api/google/refresh', {
        method: 'OPTIONS',
      }, env, createMockExecutionContext());

      assert.equal(res.status, 204);
    });

    test('returns 400 when refresh_token is missing', async () => {
      const res = await app.request('/api/google/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }, env, createMockExecutionContext());

      assert.equal(res.status, 400);
      const data: any = await res.json();
      assert.match(data.error, /Missing refresh_token/);
    });

    test('successfully refreshes token', async () => {
      let fetchBody = '';
      globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
        if (url.toString().includes('oauth2.googleapis.com')) {
          fetchBody = init?.body?.toString() || '';
          return new Response(
            JSON.stringify({
              access_token: 'new-google-access-token',
              expires_in: 3600,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response(null, { status: 200 });
      };

      const res = await app.request('/api/google/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: 'my-stored-refresh-token' }),
      }, env, createMockExecutionContext());

      assert.equal(res.status, 200);
      assert.ok(fetchBody.includes('grant_type=refresh_token'));
      assert.ok(fetchBody.includes('refresh_token=my-stored-refresh-token'));
      const data: any = await res.json();
      assert.equal(data.access_token, 'new-google-access-token');
    });
  });
});
