// In api/microsoft/token.ts

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { trackUmami } from '../../lib/umami';

export default async function handler(
  request: VercelRequest,
  response: VercelResponse,
) {
  // 1. Set CORS headers
  response.setHeader('Access-Control-Allow-Origin', '*'); 
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return response.status(200).end();
  }

  // 2. Ensure POST request
  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Method Not Allowed' });
  }

  const isReconnect = Boolean(
    request.body?.reconnect || request.query?.reconnect === '1' || request.query?.reconnect === 'true'
  );
  const flowSlug = isReconnect ? 'reconnect' : 'initial';
  const flowTitle = isReconnect ? 'Reconnect' : 'Initial';

  // 3. Retrieve Client ID (No Secret needed for SPA/PKCE flow in Entra ID)
  const { MICROSOFT_CLIENT_ID } = process.env;

  if (!MICROSOFT_CLIENT_ID) {
    return response.status(500).json({ error: 'Server configuration error: Missing MICROSOFT_CLIENT_ID.' });
  }

  // 4. Get payload from Obsidian
  const { code, code_verifier } = request.body;

  if (!code || !code_verifier) {
    return response.status(400).json({ error: 'Bad Request: Missing code or code_verifier.' });
  }

  try {
    // 5. Microsoft's token endpoint (using /common/ for multi-tenant)
    const tokenUrl = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
    
    const body = new URLSearchParams({
        client_id: MICROSOFT_CLIENT_ID,
        code: code,
        code_verifier: code_verifier,
        grant_type: 'authorization_code',
        // This must exactly match the Redirect URI registered in Entra ID and Obsidian
        redirect_uri: `http://localhost:42813/callback`, 
    });

    // 6. Exchange code for tokens
    const msResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body,
    });

    const tokenData = await msResponse.json().catch(() => ({ error: 'invalid_json_response' }));

    if (!msResponse.ok) {
      console.error("Microsoft Token Error:", tokenData);
      const outcome = msResponse.status === 429
        ? 'rate_limited'
        : (tokenData?.error === 'invalid_grant' ? 'invalid_grant' : 'upstream_error');

      trackUmami(request, `Microsoft Token (${flowTitle}) - ${outcome}`, `/api/microsoft/token/${flowSlug}/${outcome}`, {
        provider: 'microsoft',
        flow: `token_${flowSlug}`,
        outcome,
        http_status: msResponse.status,
      });

      return response.status(msResponse.status).json(tokenData);
    }
    
    // 7. Success! Send tokens to Obsidian
    trackUmami(request, `Microsoft Token (${flowTitle}) - Success`, `/api/microsoft/token/${flowSlug}/success`, {
      provider: 'microsoft',
      flow: `token_${flowSlug}`,
      outcome: 'success',
      http_status: 200,
      subject_seed: tokenData.refresh_token,
    });

    return response.status(200).json(tokenData);

  } catch (error) {
    console.error("Error during token exchange:", error);
    trackUmami(request, `Microsoft Token (${flowTitle}) - Server Error`, `/api/microsoft/token/${flowSlug}/server_error`, {
      provider: 'microsoft',
      flow: `token_${flowSlug}`,
      outcome: 'server_error',
      http_status: 500,
    });
    return response.status(500).json({ error: 'Internal Server Error' });
  }
}