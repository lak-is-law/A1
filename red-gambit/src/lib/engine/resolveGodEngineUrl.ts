/**
 * Baduk "God" mode POSTs to an engine /move endpoint.
 * Uses BADUK_GOD_API_URL if set; otherwise AI_ENGINE_URL + "/move"
 * (same FastAPI service as the rest of Red Gambit).
 */
export function resolveGodEngineMoveUrl(): string | null {
  const explicit = process.env.BADUK_GOD_API_URL?.trim();
  if (explicit) return explicit;

  const base = process.env.AI_ENGINE_URL?.trim();
  if (!base) return null;

  const normalized = base.replace(/\/$/, "");
  if (normalized.endsWith("/move")) return normalized;
  return `${normalized}/move`;
}

export function resolveGodEngineHealthUrl(): string | null {
  const explicit = process.env.BADUK_GOD_HEALTH_URL?.trim();
  if (explicit) return explicit;

  const moveUrl = resolveGodEngineMoveUrl();
  if (!moveUrl) return null;

  try {
    const u = new URL(moveUrl);
    if (u.pathname.endsWith("/move")) {
      u.pathname = u.pathname.replace(/\/move$/, "/health");
    } else {
      u.pathname = `${u.pathname.replace(/\/$/, "")}/health`;
    }
    return u.toString();
  } catch {
    return null;
  }
}

export function godEngineConfigHint(): string {
  return "Set AI_ENGINE_URL in Vercel to your deployed engine (e.g. https://your-app.onrender.com), then redeploy. Optional override: BADUK_GOD_API_URL.";
}
