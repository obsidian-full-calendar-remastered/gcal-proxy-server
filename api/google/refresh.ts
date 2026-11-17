// In api/google/refresh.ts

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { trackUmami } from '../../lib/umami';

export default async function handler(
  request: VercelRequest,
  response: VercelResponse,
) {
  // Set CORS headers
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (request.method === 'OPTIONS') {
    return response.status(200).end();
  }

  
  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Method Not Allowed' });
  }
  
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return response.status(500).json({ error: 'Server configuration error: Missing Google credentials.' });
  }

  // Get the refresh token from the plugin's request body
  const { refresh_token } = request.body;

  if (!refresh_token) {
    return response.status(400).json({ error: 'Bad Request: Missing refresh_token.' });
  }

  try {
    const tokenUrl = 'https://oauth2.googleapis.com/token';
    
    const body = new URLSearchParams({
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
      body: body,
    });

    const tokenData = await googleResponse.json().catch(() => ({ error: 'invalid_json_response' }));

    if (!googleResponse.ok) {
      const outcome = googleResponse.status === 429
        ? 'rate_limited'
        : (tokenData?.error === 'invalid_grant' ? 'invalid_grant' : 'upstream_error');

      trackUmami(request, `Google Refresh - ${outcome}`, `/api/google/refresh/${outcome}`, {
        provider: 'google',
        flow: 'refresh',
        outcome,
        http_status: googleResponse.status,
        subject_seed: refresh_token,
      });

      return response.status(googleResponse.status).json(tokenData);
    }
    
    // Success! Send the new access token back to the Obsidian plugin
    trackUmami(request, 'Google Refresh - Success', '/api/google/refresh/success', {
      provider: 'google',
      flow: 'refresh',
      outcome: 'success',
      http_status: 200,
      subject_seed: refresh_token,
    });

    return response.status(200).json(tokenData);

  } catch (error) {
    console.error("Error during token refresh:", error);
    trackUmami(request, 'Google Refresh - Server Error', '/api/google/refresh/server_error', {
      provider: 'google',
      flow: 'refresh',
      outcome: 'server_error',
      http_status: 500,
      subject_seed: refresh_token,
    });
    return response.status(500).json({ error: 'Internal Server Error' });
  }
}