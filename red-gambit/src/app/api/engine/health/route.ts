import { NextResponse } from "next/server";

import { resolveGodEngineHealthUrl } from "@/lib/engine/resolveGodEngineUrl";

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

async function probeGodProvider(): Promise<ProviderStatus> {
  const url = resolveGodEngineHealthUrl();
  const checkedAt = new Date().toISOString();
  if (!url) {
    return {
      configured: false,
      healthy: false,
      detail: "AI_ENGINE_URL or BADUK_GOD_API_URL is not set",
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

