// In api/microsoft/refresh.ts

import type { VercelRequest, VercelResponse } from '@vercel/node';

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

  const { MICROSOFT_CLIENT_ID } = process.env;

  if (!MICROSOFT_CLIENT_ID) {
    return response.status(500).json({ error: 'Server configuration error: Missing MICROSOFT_CLIENT_ID.' });
  }

  const { refresh_token } = request.body;

  if (!refresh_token) {
    return response.status(400).json({ error: 'Bad Request: Missing refresh_token.' });
  }

  try {
    const tokenUrl = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
    
    const body = new URLSearchParams({
        client_id: MICROSOFT_CLIENT_ID,
        refresh_token: refresh_token,
        grant_type: 'refresh_token',
    });

    const msResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body,
    });

    const tokenData = await msResponse.json();

    if (!msResponse.ok) {
      console.error("Microsoft Refresh Error:", tokenData);
      return response.status(msResponse.status).json(tokenData);
    }
    
    return response.status(200).json(tokenData);

  } catch (error) {
    console.error("Error during token refresh:", error);
    return response.status(500).json({ error: 'Internal Server Error' });
  }
}