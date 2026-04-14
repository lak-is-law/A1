import { NextResponse } from "next/server";

export const runtime = "nodejs";

type ProviderStatus = {
  configured: boolean;
  healthy: boolean;
  url?: string;
  detail?: string;
  status?: number;
  checkedAt: string;
};

function redactUrl(raw: string): string {
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return raw;
  }
}

function resolveHealthUrl(): string | null {
  const explicit = process.env.BADUK_GOD_HEALTH_URL?.trim();
  if (explicit) return explicit;
  const base = process.env.BADUK_GOD_API_URL?.trim();
  if (!base) return null;
  try {
    const u = new URL(base);
    if (u.pathname.endsWith("/move")) u.pathname = u.pathname.replace(/\/move$/, "/health");
    else if (!u.pathname.endsWith("/health")) u.pathname = `${u.pathname.replace(/\/$/, "")}/health`;
    return u.toString();
  } catch {
    return null;
  }
}

async function probeGodProvider(): Promise<ProviderStatus> {
  const url = resolveHealthUrl();
  const checkedAt = new Date().toISOString();
  if (!url) {
    return {
      configured: false,
      healthy: false,
      detail: "BADUK_GOD_API_URL is not configured",
      checkedAt,
    };
  }

  const apiKey = process.env.BADUK_GOD_API_KEY?.trim();
  const headers: Record<string, string> = {};
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;

  try {
    const res = await fetch(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) {
      return {
        configured: true,
        healthy: false,
        url: redactUrl(url),
        detail: `Provider returned HTTP ${res.status}`,
        status: res.status,
        checkedAt,
      };
    }

    return {
      configured: true,
      healthy: true,
      url: redactUrl(url),
      detail: "Provider health probe succeeded",
      status: res.status,
      checkedAt,
    };
  } catch {
    return {
      configured: true,
      healthy: false,
      url: redactUrl(url),
      detail: "Provider unreachable or timed out",
      checkedAt,
    };
  }
}

export async function GET() {
  const badukGod = await probeGodProvider();
  const ok = badukGod.healthy || !badukGod.configured;
  return NextResponse.json(
    {
      status: ok ? "ok" : "degraded",
      badukGod,
    },
    { status: ok ? 200 : 503 }
  );
}

