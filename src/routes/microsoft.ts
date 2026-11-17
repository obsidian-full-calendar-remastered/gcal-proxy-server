import type { Context } from 'hono';
import type { Env } from '../types';
import { trackUmami } from '../lib/umami';

export async function handleMicrosoftToken(c: Context<{ Bindings: Env }>) {
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

  const { MICROSOFT_CLIENT_ID } = c.env;

  if (!MICROSOFT_CLIENT_ID) {
    return c.json({ error: 'Server configuration error: Missing MICROSOFT_CLIENT_ID.' }, 500);
  }

  const { code, code_verifier } = body;

  if (!code || !code_verifier) {
    return c.json({ error: 'Bad Request: Missing code or code_verifier.' }, 400);
  }

  try {
    const tokenUrl = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';

    const postBody = new URLSearchParams({
      client_id: MICROSOFT_CLIENT_ID,
      code: code,
      code_verifier: code_verifier,
      grant_type: 'authorization_code',
      redirect_uri: 'http://localhost:42813/callback',
    });

    const msResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: postBody,
    });

    const tokenData: any = await msResponse.json().catch(() => ({ error: 'invalid_json_response' }));

    if (!msResponse.ok) {
      console.error("Microsoft Token Error:", tokenData);
      const outcome = msResponse.status === 429
        ? 'rate_limited'
        : (tokenData?.error === 'invalid_grant' ? 'invalid_grant' : 'upstream_error');

      trackUmami(c, `Microsoft Token (${flowTitle}) - ${outcome}`, `/api/microsoft/token/${flowSlug}/${outcome}`, {
        provider: 'microsoft',
        flow: `token_${flowSlug}`,
        outcome,
        http_status: msResponse.status,
      });

      return c.json(tokenData, msResponse.status as any);
    }

    trackUmami(c, `Microsoft Token (${flowTitle}) - Success`, `/api/microsoft/token/${flowSlug}/success`, {
      provider: 'microsoft',
      flow: `token_${flowSlug}`,
      outcome: 'success',
      http_status: 200,
      subject_seed: tokenData.refresh_token,
    });

    return c.json(tokenData, 200);

  } catch (error) {
    console.error("Error during Microsoft token exchange:", error);
    trackUmami(c, `Microsoft Token (${flowTitle}) - Server Error`, `/api/microsoft/token/${flowSlug}/server_error`, {
      provider: 'microsoft',
      flow: `token_${flowSlug}`,
      outcome: 'server_error',
      http_status: 500,
    });
    return c.json({ error: 'Internal Server Error' }, 500);
  }
}

export async function handleMicrosoftRefresh(c: Context<{ Bindings: Env }>) {
  let body: Record<string, any> = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }

  const { MICROSOFT_CLIENT_ID } = c.env;

  if (!MICROSOFT_CLIENT_ID) {
    return c.json({ error: 'Server configuration error: Missing MICROSOFT_CLIENT_ID.' }, 500);
  }

  const { refresh_token } = body;

  if (!refresh_token) {
    return c.json({ error: 'Bad Request: Missing refresh_token.' }, 400);
  }

  try {
    const tokenUrl = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';

    const postBody = new URLSearchParams({
      client_id: MICROSOFT_CLIENT_ID,
      refresh_token: refresh_token,
      grant_type: 'refresh_token',
    });

    const msResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: postBody,
    });

    const tokenData: any = await msResponse.json().catch(() => ({ error: 'invalid_json_response' }));

    if (!msResponse.ok) {
      console.error("Microsoft Refresh Error:", tokenData);
      const outcome = msResponse.status === 429
        ? 'rate_limited'
        : (tokenData?.error === 'invalid_grant' ? 'invalid_grant' : 'upstream_error');

      trackUmami(c, `Microsoft Refresh - ${outcome}`, `/api/microsoft/refresh/${outcome}`, {
        provider: 'microsoft',
        flow: 'refresh',
        outcome,
        http_status: msResponse.status,
        subject_seed: refresh_token,
      });

      return c.json(tokenData, msResponse.status as any);
    }

    trackUmami(c, 'Microsoft Refresh - Success', '/api/microsoft/refresh/success', {
      provider: 'microsoft',
      flow: 'refresh',
      outcome: 'success',
      http_status: 200,
      subject_seed: refresh_token,
    });

    return c.json(tokenData, 200);

  } catch (error) {
    console.error("Error during Microsoft token refresh:", error);
    trackUmami(c, 'Microsoft Refresh - Server Error', '/api/microsoft/refresh/server_error', {
      provider: 'microsoft',
      flow: 'refresh',
      outcome: 'server_error',
      http_status: 500,
      subject_seed: refresh_token,
    });
    return c.json({ error: 'Internal Server Error' }, 500);
  }
}
