import { geolocation, waitUntil } from "@vercel/functions";
import type { VercelRequest } from "@vercel/node";

function buildHeaders(req: VercelRequest): Headers {
  const h = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) h.set(key, value.join(","));
    else if (typeof value === "string") h.set(key, value);
  }
  return h;
}

function toWebRequest(req: VercelRequest): Request {
  const proto = (req.headers["x-forwarded-proto"] as string) || "https";
  const host = (req.headers["host"] as string) || "localhost";
  const fullUrl = `${proto}://${host}${req.url}`;
  return new Request(fullUrl, { method: req.method, headers: buildHeaders(req) });
}

function safeUserAgent(rawUA: string): string {
  const lower = rawUA.toLowerCase();
  if (!rawUA || lower.includes("curl") || lower.includes("wget")) {
    return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";
  }
  return rawUA;
}

function getClientIp(req: VercelRequest): string {
  const xff = req.headers["x-forwarded-for"];
  const xri = req.headers["x-real-ip"];
  if (typeof xff === "string" && xff.length) return xff.split(",")[0].trim();
  if (typeof xri === "string" && xri.length) return xri;
  return "unknown";
}

function getScreenTier(ua: string) {
  const u = ua.toLowerCase();

  if (u.includes("mobile")) return "mobile";
  if (u.includes("tablet")) return "tablet";
  return "desktop_wide";
}

function getDeviceOrientation(ua: string) {
  // No real orientation on server → best approximation
  return "unknown";
}

function getBrowserLanguage(header: string) {
  if (!header) return "unknown";
  return header.split(",")[0];
}

export function trackUmami(
  req: VercelRequest,
  eventName: string,
  eventUrl: string,
  data: Record<string, any> = {},
) {
  const UMAMI_URL = process.env.UMAMI_URL;
  const UMAMI_WEBSITE_ID = process.env.UMAMI_WEBSITE_ID;
  if (!UMAMI_URL || !UMAMI_WEBSITE_ID) return;

  try {
    const webReq = toWebRequest(req);
    const geo = geolocation(webReq);

    const ua = safeUserAgent((req.headers["user-agent"] as string) || "");
    const language = (req.headers["accept-language"] as string) || "en-US";
    const referrer = (req.headers["referer"] as string) || "";

    // Fire-and-forget; do NOT await (keeps auth fast)
    waitUntil(
      fetch(UMAMI_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": ua,
        },
        body: JSON.stringify({
          type: "event",
          payload: {
            website: UMAMI_WEBSITE_ID,
            hostname: new URL(webReq.url).hostname,
            language,
            referrer,
            url: eventUrl,
            title: eventName,
            // name: eventName,
            ip: getClientIp(req),
            userAgent: ua,
            data: {
              browser_language: getBrowserLanguage(language),
              device_orientation: getDeviceOrientation(ua),
              screen_tier: getScreenTier(ua),
              theme_preference: "unknown",

              vercel_country: geo.country ?? "unknown",
              vercel_region: geo.countryRegion ?? "unknown",
              vercel_city: geo.city ?? "unknown",
              vercel_lat: geo.latitude ?? "unknown",
              vercel_lon: geo.longitude ?? "unknown",
              ...data,
            },
          },
        }),
      }).catch((err) => {
        if (process.env.UMAMI_DEBUG === "1") console.error("Umami send failed:", err);
      }),
    );
    } catch {
      // Never break OAuth flow
    }
}