import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import googleTokenHandler from '../api/google/token';
import googleRefreshHandler from '../api/google/refresh';
import { createMockRequest, createMockResponse } from './helper';

describe('Google OAuth Endpoints', () => {
  const originalEnv = { ...process.env };
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      GOOGLE_CLIENT_ID: 'mock-google-client-id',
      GOOGLE_CLIENT_SECRET: 'mock-google-client-secret',
    };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    globalThis.fetch = originalFetch;
  });

  describe('POST /api/google/token', () => {
    test('handles OPTIONS preflight correctly', async () => {
      const req = createMockRequest({ method: 'OPTIONS' });
      const res = createMockResponse();

      await googleTokenHandler(req, res);

      assert.equal(res.statusCode, 200);
      assert.equal(res.headers['access-control-allow-origin'], '*');
      assert.equal(res.headers['access-control-allow-methods'], 'POST, OPTIONS');
      assert.equal(res.ended, true);
    });

    test('rejects non-POST methods with 405', async () => {
      const req = createMockRequest({ method: 'GET' });
      const res = createMockResponse();

      await googleTokenHandler(req, res);

      assert.equal(res.statusCode, 405);
      assert.deepEqual(res.jsonData, { error: 'Method Not Allowed' });
    });

    test('returns 500 when Google credentials are missing', async () => {
      delete process.env.GOOGLE_CLIENT_ID;
      const req = createMockRequest({
        method: 'POST',
        body: { code: 'auth-code', code_verifier: 'verifier-123' },
      });
      const res = createMockResponse();

      await googleTokenHandler(req, res);

      assert.equal(res.statusCode, 500);
      assert.match(res.jsonData.error, /Missing Google credentials/);
    });

    test('returns 400 when code or code_verifier is missing', async () => {
      const req = createMockRequest({
        method: 'POST',
        body: { code: 'only-code' },
      });
      const res = createMockResponse();

      await googleTokenHandler(req, res);

      assert.equal(res.statusCode, 400);
      assert.match(res.jsonData.error, /Missing code or code_verifier/);
    });

    test('successfully exchanges code for tokens and uses custom redirect_uri if allowed', async () => {
      let fetchUrl = '';
      let fetchBody = '';

      globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
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
      };

      const req = createMockRequest({
        method: 'POST',
        body: {
          code: 'test-code',
          code_verifier: 'test-verifier',
          redirect_uri: 'http://localhost:42813/callback',
        },
      });
      const res = createMockResponse();

      await googleTokenHandler(req, res);

      assert.equal(res.statusCode, 200);
      assert.equal(fetchUrl, 'https://oauth2.googleapis.com/token');
      assert.ok(fetchBody.includes('redirect_uri=http%3A%2F%2Flocalhost%3A42813%2Fcallback'));
      assert.ok(fetchBody.includes('client_id=mock-google-client-id'));
      assert.equal(res.jsonData.access_token, 'mock-access-token');
      assert.equal(res.jsonData.refresh_token, 'mock-refresh-token');
    });

    test('falls back to default redirect_uri if provided uri is disallowed', async () => {
      let fetchBody = '';
      globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
        fetchBody = init?.body?.toString() || '';
        return new Response(JSON.stringify({ access_token: 'mock-token' }), { status: 200 });
      };

      const req = createMockRequest({
        method: 'POST',
        body: {
          code: 'test-code',
          code_verifier: 'test-verifier',
          redirect_uri: 'https://malicious.com/callback',
        },
      });
      const res = createMockResponse();

      await googleTokenHandler(req, res);

      assert.equal(res.statusCode, 200);
      assert.ok(fetchBody.includes('redirect_uri=http%3A%2F%2F127.0.0.1%3A42813%2Fcallback'));
    });

    test('handles upstream Google error correctly', async () => {
      globalThis.fetch = async () => {
        return new Response(
          JSON.stringify({
            error: 'invalid_grant',
            error_description: 'Bad Request',
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      };

      const req = createMockRequest({
        method: 'POST',
        body: { code: 'bad-code', code_verifier: 'verifier' },
      });
      const res = createMockResponse();

      await googleTokenHandler(req, res);

      assert.equal(res.statusCode, 400);
      assert.equal(res.jsonData.error, 'invalid_grant');
    });

    test('catches unexpected exceptions and returns 500', async () => {
      const originalConsoleError = console.error;
      console.error = () => {};
      try {
        globalThis.fetch = async () => {
          throw new Error('Network failure');
        };

        const req = createMockRequest({
          method: 'POST',
          body: { code: 'code', code_verifier: 'verifier' },
        });
        const res = createMockResponse();

        await googleTokenHandler(req, res);

        assert.equal(res.statusCode, 500);
        assert.deepEqual(res.jsonData, { error: 'Internal Server Error' });
      } finally {
        console.error = originalConsoleError;
      }
    });
  });

  describe('POST /api/google/refresh', () => {
    test('handles OPTIONS preflight correctly', async () => {
      const req = createMockRequest({ method: 'OPTIONS' });
      const res = createMockResponse();

      await googleRefreshHandler(req, res);

      assert.equal(res.statusCode, 200);
      assert.equal(res.ended, true);
    });

    test('returns 400 when refresh_token is missing', async () => {
      const req = createMockRequest({ method: 'POST', body: {} });
      const res = createMockResponse();

      await googleRefreshHandler(req, res);

      assert.equal(res.statusCode, 400);
      assert.match(res.jsonData.error, /Missing refresh_token/);
    });

    test('successfully refreshes token', async () => {
      let fetchBody = '';
      globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
        fetchBody = init?.body?.toString() || '';
        return new Response(
          JSON.stringify({
            access_token: 'new-google-access-token',
            expires_in: 3600,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      const req = createMockRequest({
        method: 'POST',
        body: { refresh_token: 'my-stored-refresh-token' },
      });
      const res = createMockResponse();

      await googleRefreshHandler(req, res);

      assert.equal(res.statusCode, 200);
      assert.ok(fetchBody.includes('grant_type=refresh_token'));
      assert.ok(fetchBody.includes('refresh_token=my-stored-refresh-token'));
      assert.equal(res.jsonData.access_token, 'new-google-access-token');
    });
  });
});
