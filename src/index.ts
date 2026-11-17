import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './types';
import { handleGoogleToken, handleGoogleRefresh } from './routes/google';
import { handleMicrosoftToken, handleMicrosoftRefresh } from './routes/microsoft';

const app = new Hono<{ Bindings: Env }>();

// Global CORS Middleware: allows any origin, POST and OPTIONS methods
app.use('*', cors({
  origin: '*',
  allowMethods: ['POST', 'OPTIONS', 'GET'],
  allowHeaders: ['Content-Type'],
}));

// Root health check endpoint
app.get('/', (c) => {
  return c.json({
    status: 'ok',
    service: 'gcal-proxy-server',
    runtime: 'Cloudflare Workers (Hono)',
  });
});

// Google OAuth endpoints
app.post('/api/google/token', handleGoogleToken);
app.post('/api/google/refresh', handleGoogleRefresh);

// Microsoft OAuth endpoints
app.post('/api/microsoft/token', handleMicrosoftToken);
app.post('/api/microsoft/refresh', handleMicrosoftRefresh);

// 404 Handler
app.notFound((c) => {
  return c.json({ error: 'Not Found' }, 404);
});

export default app;
