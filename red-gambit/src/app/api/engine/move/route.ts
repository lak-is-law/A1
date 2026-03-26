import { NextResponse } from "next/server";
import { z } from "zod";

const MoveReqSchema = z.object({
  game: z.enum(["chess", "baduk"]),
  difficulty: z.enum(["adaptive", "medium", "hard"]).default("adaptive"),
  time_ms: z.number().int().min(50).max(10000).default(2500),

  fen: z.string().optional(),
  size: z.number().int().min(5).max(13).default(9),
  to_play: z.enum(["black", "white"]).optional(),
  komi: z.number().default(7.5),
  board: z.array(z.number().int()).optional(), // row-major; 0 empty, 1 black, -1 white
});

export const runtime = "nodejs";

export async function POST(req: Request) {
  const aiUrl = process.env.AI_ENGINE_URL;
  if (!aiUrl) {
    return NextResponse.json(
      { error: "Missing AI_ENGINE_URL" },
      { status: 500 }
    );
  }

  const json = await req.json();
  const parsed = MoveReqSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // FastAPI expects snake_case fields (fen, time_ms, to_play, board, etc.).
  const payload = parsed.data;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9500);

  try {
    const resp = await fetch(`${aiUrl.replace(/\/$/, "")}/move`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const data = await resp.json().catch(() => ({}));
    return NextResponse.json(data, { status: resp.status });
  } catch (e) {
    let name: string | undefined;
    if (e && typeof e === "object" && "name" in e) {
      const maybeName = (e as { name?: unknown }).name;
      if (typeof maybeName === "string") name = maybeName;
    }
    return NextResponse.json(
      { error: name === "AbortError" ? "AI engine timeout" : "AI engine fetch failed" },
      { status: 502 }
    );
  } finally {
    clearTimeout(timeout);
  }
}

