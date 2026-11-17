import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import msTokenHandler from '../api/microsoft/token';
import msRefreshHandler from '../api/microsoft/refresh';
import { createMockRequest, createMockResponse } from './helper';

describe('Microsoft OAuth Endpoints', () => {
  const originalEnv = { ...process.env };
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      MICROSOFT_CLIENT_ID: 'mock-ms-client-id',
    };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    globalThis.fetch = originalFetch;
  });

  describe('POST /api/microsoft/token', () => {
    test('handles OPTIONS preflight correctly', async () => {
      const req = createMockRequest({ method: 'OPTIONS' });
      const res = createMockResponse();

      await msTokenHandler(req, res);

      assert.equal(res.statusCode, 200);
      assert.equal(res.headers['access-control-allow-origin'], '*');
      assert.equal(res.ended, true);
    });

    test('rejects non-POST with 405', async () => {
      const req = createMockRequest({ method: 'GET' });
      const res = createMockResponse();

      await msTokenHandler(req, res);

      assert.equal(res.statusCode, 405);
      assert.deepEqual(res.jsonData, { error: 'Method Not Allowed' });
    });

    test('returns 500 when MICROSOFT_CLIENT_ID is missing', async () => {
      delete process.env.MICROSOFT_CLIENT_ID;
      const req = createMockRequest({
        method: 'POST',
        body: { code: 'code', code_verifier: 'verifier' },
      });
      const res = createMockResponse();

      await msTokenHandler(req, res);

      assert.equal(res.statusCode, 500);
      assert.match(res.jsonData.error, /Missing MICROSOFT_CLIENT_ID/);
    });

    test('returns 400 when code or code_verifier is missing', async () => {
      const req = createMockRequest({ method: 'POST', body: { code: 'code' } });
      const res = createMockResponse();

      await msTokenHandler(req, res);

      assert.equal(res.statusCode, 400);
      assert.match(res.jsonData.error, /Missing code or code_verifier/);
    });

    test('successfully exchanges code with Entra ID PKCE flow', async () => {
      let fetchUrl = '';
      let fetchBody = '';

      globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
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
      };

      const req = createMockRequest({
        method: 'POST',
        body: { code: 'ms-auth-code', code_verifier: 'ms-verifier' },
      });
      const res = createMockResponse();

      await msTokenHandler(req, res);

      assert.equal(res.statusCode, 200);
      assert.equal(fetchUrl, 'https://login.microsoftonline.com/common/oauth2/v2.0/token');
      assert.ok(fetchBody.includes('client_id=mock-ms-client-id'));
      assert.ok(fetchBody.includes('code=ms-auth-code'));
      assert.ok(fetchBody.includes('code_verifier=ms-verifier'));
      assert.ok(fetchBody.includes('redirect_uri=http%3A%2F%2Flocalhost%3A42813%2Fcallback'));
      assert.equal(res.jsonData.access_token, 'mock-ms-access-token');
      assert.equal(res.jsonData.refresh_token, 'mock-ms-refresh-token');
    });

    test('handles upstream Microsoft error and returns status', async () => {
      const originalConsoleError = console.error;
      console.error = () => {};
      try {
        globalThis.fetch = async () => {
          return new Response(
            JSON.stringify({ error: 'invalid_grant', error_description: 'Code expired' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          );
        };

        const req = createMockRequest({
          method: 'POST',
          body: { code: 'bad-code', code_verifier: 'verifier' },
        });
        const res = createMockResponse();

        await msTokenHandler(req, res);

        assert.equal(res.statusCode, 400);
        assert.equal(res.jsonData.error, 'invalid_grant');
      } finally {
        console.error = originalConsoleError;
      }
    });
  });

  describe('POST /api/microsoft/refresh', () => {
    test('returns 400 when refresh_token is missing', async () => {
      const req = createMockRequest({ method: 'POST', body: {} });
      const res = createMockResponse();

      await msRefreshHandler(req, res);

      assert.equal(res.statusCode, 400);
      assert.match(res.jsonData.error, /Missing refresh_token/);
    });

    test('successfully refreshes Microsoft token', async () => {
      let fetchBody = '';
      globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
        fetchBody = init?.body?.toString() || '';
        return new Response(
          JSON.stringify({
            access_token: 'new-ms-access-token',
            refresh_token: 'new-ms-refresh-token',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      const req = createMockRequest({
        method: 'POST',
        body: { refresh_token: 'existing-ms-refresh-token' },
      });
      const res = createMockResponse();

      await msRefreshHandler(req, res);

      assert.equal(res.statusCode, 200);
      assert.ok(fetchBody.includes('grant_type=refresh_token'));
      assert.ok(fetchBody.includes('refresh_token=existing-ms-refresh-token'));
      assert.equal(res.jsonData.access_token, 'new-ms-access-token');
    });
  });
});
