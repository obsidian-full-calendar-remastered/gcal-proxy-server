import type { Env } from '../src/types';

export const mockEnv: Env = {
  GOOGLE_CLIENT_ID: 'mock-google-client-id',
  GOOGLE_CLIENT_SECRET: 'mock-google-client-secret',
  MICROSOFT_CLIENT_ID: 'mock-ms-client-id',
  UMAMI_URL: 'https://umami.example.com/api/send',
  UMAMI_WEBSITE_ID: 'mock-website-id',
  UMAMI_USER_SALT: 'mock-salt',
};

export function createMockExecutionContext() {
  const promises: Promise<any>[] = [];
  return {
    waitUntil(promise: Promise<any>) {
      promises.push(promise);
    },
    passThroughOnException() {},
    props: {},
    waitForAll() {
      return Promise.all(promises);
    },
  };
}
