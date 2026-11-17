import type { Context } from "hono";
import type { Env } from "../types";

function safeUserAgent(rawUA: string): string {
  const lower = rawUA.toLowerCase();
  if (!rawUA || lower.includes("curl") || lower.includes("wget") || lower.includes("node") || lower.includes("undici")) {
    return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Obsidian/1.7.0 Chrome/126.0.0.0 Electron/31.0.0 Safari/537.36";
  }
  return rawUA;
}

async function hashUserSubject(seed?: string, salt: string = "salt"): Promise<string | undefined> {
  if (!seed || typeof seed !== "string") return undefined;
  const data = new TextEncoder().encode(`${salt}:${seed}`);
  const digestBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(digestBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  return hashHex.slice(0, 32);
}

function getClientIp(req: Request): string {
  const cfIp = req.headers.get("cf-connecting-ip");
  if (cfIp) return cfIp;
  const xff = req.headers.get("x-forwarded-for");
  const xri = req.headers.get("x-real-ip");
  if (xff) return xff.split(",")[0].trim();
  if (xri) return xri;
  return "unknown";
}

function getScreenTier(ua: string) {
  const u = ua.toLowerCase();
  if (u.includes("mobile")) return "mobile";
  if (u.includes("tablet")) return "tablet";
  return "desktop_wide";
}

function getDeviceOrientation(_ua: string) {
  return "unknown";
}

function getBrowserLanguage(header: string) {
  if (!header) return "unknown";
  return header.split(",")[0];
}

export function trackUmami(
  c: Context<{ Bindings: Env }>,
  eventName: string,
  eventUrl: string,
  data: Record<string, any> = {},
) {
  const { UMAMI_URL, UMAMI_WEBSITE_ID, UMAMI_USER_SALT, UMAMI_DEBUG } = c.env;
  if (!UMAMI_URL || !UMAMI_WEBSITE_ID) return;

  try {
    const rawReq = c.req.raw;
    const cf = (rawReq as any).cf;

    const ua = safeUserAgent(rawReq.headers.get("user-agent") || "");
    const language = rawReq.headers.get("accept-language") || "en-US";
    const referrer = rawReq.headers.get("referer") || "";
    const clientIp = getClientIp(rawReq);
    const salt = UMAMI_USER_SALT || UMAMI_WEBSITE_ID || "salt";

    const country = cf?.country ?? "unknown";
    const region = cf?.region ?? cf?.regionCode ?? "unknown";
    const city = cf?.city ?? "unknown";
    const latitude = cf?.latitude ?? "unknown";
    const longitude = cf?.longitude ?? "unknown";

    // Non-blocking fire-and-forget in Cloudflare Worker via ExecutionContext
    c.executionCtx.waitUntil(
      (async () => {
        const distinctId = await hashUserSubject(data?.subject_seed, salt);

        await fetch(UMAMI_URL, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "user-agent": ua,
            "true-client-ip": clientIp,
            "x-forwarded-for": clientIp,
          },
          body: JSON.stringify({
            type: "event",
            payload: {
              website: UMAMI_WEBSITE_ID,
              hostname: new URL(rawReq.url).hostname,
              language,
              referrer,
              url: eventUrl,
              title: eventName,
              ...(distinctId ? { id: distinctId } : {}),
              ip: clientIp,
              userAgent: ua,
              data: {
                browser_language: getBrowserLanguage(language),
                device_orientation: getDeviceOrientation(ua),
                screen_tier: getScreenTier(ua),
                theme_preference: "unknown",

                country,
                region,
                city,
                lat: latitude,
                lon: longitude,

                // Backward compatibility for existing Umami reports
                vercel_country: country,
                vercel_region: region,
                vercel_city: city,
                vercel_lat: latitude,
                vercel_lon: longitude,

                ...data,
              },
            },
          }),
        });
      })().catch((err) => {
        if (UMAMI_DEBUG === "1") console.error("Umami send failed:", err);
      }),
    );
  } catch {
    // Never break OAuth flow
  }
}
