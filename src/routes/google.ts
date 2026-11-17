import type { Context } from 'hono';
import type { Env } from '../types';
import { trackUmami } from '../lib/umami';

const ALLOWED_REDIRECT_URIS = [
  'http://127.0.0.1:42813/callback',
  'http://localhost:42813/callback',
  'https://obsidian-full-calendar-remastered.github.io/plugin-full-calendar/assets/meta/google-auth-callback.html'
];

export async function handleGoogleToken(c: Context<{ Bindings: Env }>) {
  let body: Record<string, any> = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }

  const isReconnect = Boolean(
    body?.reconnect || c.req.query('reconnect') === '1' || c.req.query('reconnect') === 'true'
  );
  const flowSlug = isReconnect ? 'reconnect' : 'initial';
  const flowTitle = isReconnect ? 'Reconnect' : 'Initial';

  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = c.env;

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return c.json({ error: 'Server configuration error: Missing Google credentials.' }, 500);
  }

  const { code, code_verifier, redirect_uri } = body;

  if (!code || !code_verifier) {
    return c.json({ error: 'Bad Request: Missing code or code_verifier.' }, 400);
  }

  try {
    const tokenUrl = 'https://oauth2.googleapis.com/token';

    const effectiveRedirectUri =
      redirect_uri && ALLOWED_REDIRECT_URIS.includes(redirect_uri)
        ? redirect_uri
        : 'http://127.0.0.1:42813/callback';

    const postBody = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      code: code,
      code_verifier: code_verifier,
      grant_type: 'authorization_code',
      redirect_uri: effectiveRedirectUri,
    });

    const googleResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: postBody,
    });

    const tokenData: any = await googleResponse.json().catch(() => ({ error: 'invalid_json_response' }));

    if (!googleResponse.ok) {
      const outcome = googleResponse.status === 429
        ? 'rate_limited'
        : (tokenData?.error === 'invalid_grant' ? 'invalid_grant' : 'upstream_error');

      trackUmami(c, `Google Token (${flowTitle}) - ${outcome}`, `/api/google/token/${flowSlug}/${outcome}`, {
        provider: 'google',
        flow: `token_${flowSlug}`,
        outcome,
        http_status: googleResponse.status,
      });

      return c.json(tokenData, googleResponse.status as any);
    }

    trackUmami(c, `Google Token (${flowTitle}) - Success`, `/api/google/token/${flowSlug}/success`, {
      provider: 'google',
      flow: `token_${flowSlug}`,
      outcome: 'success',
      http_status: 200,
      subject_seed: tokenData.refresh_token,
    });

    return c.json(tokenData, 200);

  } catch (error) {
    console.error("Error during Google token exchange:", error);
    trackUmami(c, `Google Token (${flowTitle}) - Server Error`, `/api/google/token/${flowSlug}/server_error`, {
      provider: 'google',
      flow: `token_${flowSlug}`,
      outcome: 'server_error',
      http_status: 500,
    });
    return c.json({ error: 'Internal Server Error' }, 500);
  }
}

export async function handleGoogleRefresh(c: Context<{ Bindings: Env }>) {
  let body: Record<string, any> = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }

  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = c.env;

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return c.json({ error: 'Server configuration error: Missing Google credentials.' }, 500);
  }

  const { refresh_token } = body;

  if (!refresh_token) {
    return c.json({ error: 'Bad Request: Missing refresh_token.' }, 400);
  }

  try {
    const tokenUrl = 'https://oauth2.googleapis.com/token';

    const postBody = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: refresh_token,
      grant_type: 'refresh_token',
    });

    const googleResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: postBody,
    });

    const tokenData: any = await googleResponse.json().catch(() => ({ error: 'invalid_json_response' }));

    if (!googleResponse.ok) {
      const outcome = googleResponse.status === 429
        ? 'rate_limited'
        : (tokenData?.error === 'invalid_grant' ? 'invalid_grant' : 'upstream_error');

      trackUmami(c, `Google Refresh - ${outcome}`, `/api/google/refresh/${outcome}`, {
        provider: 'google',
        flow: 'refresh',
        outcome,
        http_status: googleResponse.status,
        subject_seed: refresh_token,
      });

      return c.json(tokenData, googleResponse.status as any);
    }

    trackUmami(c, 'Google Refresh - Success', '/api/google/refresh/success', {
      provider: 'google',
      flow: 'refresh',
      outcome: 'success',
      http_status: 200,
      subject_seed: refresh_token,
    });

    return c.json(tokenData, 200);

  } catch (error) {
    console.error("Error during Google token refresh:", error);
    trackUmami(c, 'Google Refresh - Server Error', '/api/google/refresh/server_error', {
      provider: 'google',
      flow: 'refresh',
      outcome: 'server_error',
      http_status: 500,
      subject_seed: refresh_token,
    });
    return c.json({ error: 'Internal Server Error' }, 500);
  }
}
