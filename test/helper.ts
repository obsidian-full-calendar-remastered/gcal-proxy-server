import type { VercelRequest, VercelResponse } from '@vercel/node';

export interface MockResponse extends VercelResponse {
  statusCode: number;
  headers: Record<string, string>;
  jsonData: any;
  ended: boolean;
}

export function createMockRequest(options: {
  method?: string;
  url?: string;
  headers?: Record<string, string | string[]>;
  body?: any;
  query?: Record<string, string>;
} = {}): VercelRequest {
  return {
    method: options.method ?? 'POST',
    url: options.url ?? '/',
    headers: options.headers ?? {},
    body: options.body ?? {},
    query: options.query ?? {},
  } as unknown as VercelRequest;
}

export function createMockResponse(): MockResponse {
  const headers: Record<string, string> = {};
  const res: any = {
    statusCode: 200,
    headers,
    jsonData: undefined,
    ended: false,
    setHeader(key: string, value: string) {
      headers[key.toLowerCase()] = value;
      return res;
    },
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(data: any) {
      res.jsonData = data;
      return res;
    },
    end() {
      res.ended = true;
      return res;
    },
  };
  return res as MockResponse;
}
