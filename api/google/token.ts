// In api/google/token.ts

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { trackUmami } from '../../lib/umami';

const ALLOWED_REDIRECT_URIS = [
  'http://127.0.0.1:42813/callback',
  'http://localhost:42813/callback',
  'https://obsidian-full-calendar-remastered.github.io/plugin-full-calendar/assets/meta/google-auth-callback.html'
];

export default async function handler(
  request: VercelRequest,
  response: VercelResponse,
) {
  // 1. Set CORS headers to allow requests from Obsidian
  response.setHeader('Access-Control-Allow-Origin', '*'); // Allows any origin
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle CORS preflight requests
  if (request.method === 'OPTIONS') {
    return response.status(200).end();
  }

  // 2. Ensure it's a POST request
  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Method Not Allowed' });
  }

  const isReconnect = Boolean(
    request.body?.reconnect || request.query?.reconnect === '1' || request.query?.reconnect === 'true'
  );
  const flowSlug = isReconnect ? 'reconnect' : 'initial';
  const flowTitle = isReconnect ? 'Reconnect' : 'Initial';

  // 3. Retrieve secrets from environment variables
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return response.status(500).json({ error: 'Server configuration error: Missing Google credentials.' });
  }

  // 4. Get the authorization code and verifier from the plugin's request body
  const { code, code_verifier, state, redirect_uri } = request.body;

  if (!code || !code_verifier) {
    return response.status(400).json({ error: 'Bad Request: Missing code or code_verifier.' });
  }

  try {
    // 5. Prepare the request to Google's token endpoint
    const tokenUrl = 'https://oauth2.googleapis.com/token';
    
    const effectiveRedirectUri =
      redirect_uri && ALLOWED_REDIRECT_URIS.includes(redirect_uri)
        ? redirect_uri
        : 'http://127.0.0.1:42813/callback';

    const body = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      code: code,
      code_verifier: code_verifier,
      grant_type: 'authorization_code',
      redirect_uri: effectiveRedirectUri,
    });

    // 6. Exchange the code for tokens by calling Google
    const googleResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body,
    });

    const tokenData = await googleResponse.json().catch(() => ({ error: 'invalid_json_response' }));

    if (!googleResponse.ok) {
      const outcome = googleResponse.status === 429
        ? 'rate_limited'
        : (tokenData?.error === 'invalid_grant' ? 'invalid_grant' : 'upstream_error');

      trackUmami(request, `Google Token (${flowTitle}) - ${outcome}`, `/api/google/token/${flowSlug}/${outcome}`, {
        provider: 'google',
        flow: `token_${flowSlug}`,
        outcome,
        http_status: googleResponse.status,
      });

      return response.status(googleResponse.status).json(tokenData);
    }
    
    // 7. Success! Send the tokens back to the Obsidian plugin
    trackUmami(request, `Google Token (${flowTitle}) - Success`, `/api/google/token/${flowSlug}/success`, {
      provider: 'google',
      flow: `token_${flowSlug}`,
      outcome: 'success',
      http_status: 200,
      subject_seed: tokenData.refresh_token,
    });

    return response.status(200).json(tokenData);

  } catch (error) {
    console.error("Error during token exchange:", error);
    trackUmami(request, `Google Token (${flowTitle}) - Server Error`, `/api/google/token/${flowSlug}/server_error`, {
      provider: 'google',
      flow: `token_${flowSlug}`,
      outcome: 'server_error',
      http_status: 500,
    });
    return response.status(500).json({ error: 'Internal Server Error' });
  }
}