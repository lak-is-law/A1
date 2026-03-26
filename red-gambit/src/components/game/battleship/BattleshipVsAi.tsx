"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useThemeStore } from "@/lib/theme/themeStore";

type Difficulty = "easy" | "medium" | "hard";
type Phase = "setup" | "battle" | "replay";
type Turn = "player" | "ai";
type Dir = "H" | "V";

const SIZE = 10;

type ShipId = "carrier" | "battleship" | "cruiser" | "submarine" | "destroyer";
type Ship = { id: ShipId; name: string; length: number };

const SHIPS: Ship[] = [
  { id: "carrier", name: "Carrier", length: 5 },
  { id: "battleship", name: "Battleship", length: 4 },
  { id: "cruiser", name: "Cruiser", length: 3 },
  { id: "submarine", name: "Submarine", length: 3 },
  { id: "destroyer", name: "Destroyer", length: 2 },
];

function idxOf(r: number, c: number) {
  return r * SIZE + c;
}

function inBounds(r: number, c: number) {
  return r >= 0 && r < SIZE && c >= 0 && c < SIZE;
}

function rcOf(idx: number) {
  return { r: Math.floor(idx / SIZE), c: idx % SIZE };
}

function adjacent8(idx: number) {
  const { r, c } = rcOf(idx);
  const out: number[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const rr = r + dr;
      const cc = c + dc;
      if (!inBounds(rr, cc)) continue;
      out.push(idxOf(rr, cc));
    }
  }
  return out;
}

type ShipMap = Record<ShipId, number[]>;

type Knowledge = number[]; // per cell: 0 unknown, 1 miss, 2 hit, 3 blocked-null

function emptyKnowledge(): Knowledge {
  return new Array(SIZE * SIZE).fill(0);
}

function safeVibrate(pattern: number | number[]) {
  try {
    if (typeof navigator === "undefined") return;
    if (!("vibrate" in navigator)) return;
    navigator.vibrate(pattern);
  } catch {
    // ignore
  }
}

function tone(type: "hit" | "miss" | "sink" | "victory") {
  // Tiny WebAudio click tones (no external assets). Best-effort.
  try {
    if (typeof window === "undefined") return;
    const maybeWebkit = (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    const AudioCtx = window.AudioContext ?? maybeWebkit;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);

    const now = ctx.currentTime;
    const base =
      type === "hit" ? 420 : type === "miss" ? 180 : type === "sink" ? 620 : type === "victory" ? 520 : 200;
    const dur = type === "victory" ? 0.22 : type === "sink" ? 0.14 : type === "hit" ? 0.12 : 0.08;

    o.type = type === "victory" ? "triangle" : "sine";
    o.frequency.setValueAtTime(base, now);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.12, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    o.start(now);
    o.stop(now + dur);

    window.setTimeout(() => ctx.close().catch(() => {}), 400);
  } catch {
    // ignore
  }
}

function timeForDifficulty(difficulty: Difficulty) {
  // Config default: 15s, but these values are used as "feel" defaults for AI delay.
  if (difficulty === "medium") return 420;
  if (difficulty === "hard") return 520;
  return 380;
}

function placementCells(anchor: number, shipLength: number, dir: Dir): { cells: number[]; ok: boolean } {
  const { r, c } = rcOf(anchor);
  const cells: number[] = [];
  for (let i = 0; i < shipLength; i++) {
    const rr = r + (dir === "V" ? i : 0);
    const cc = c + (dir === "H" ? i : 0);
    if (!inBounds(rr, cc)) return { cells: [], ok: false };
    cells.push(idxOf(rr, cc));
  }
  return { cells, ok: true };
}

function fleetToShipByCell(fleet: ShipMap): (ShipId | null)[] {
  const byCell: (ShipId | null)[] = new Array(SIZE * SIZE).fill(null);
  for (const ship of SHIPS) {
    for (const cell of fleet[ship.id]) byCell[cell] = ship.id;
  }
  return byCell;
}

function randomFleet(seedShipMap: Partial<ShipMap> = {}): ShipMap {
  // Random placement with no overlap; ensures standard Fleet.
  const occupied = new Set<number>();
  const blocked = new Set<number>(); // cells adjacent to occupied ships (diagonals included)
  const fleet: Partial<ShipMap> = {};

  function markShip(cells: number[]) {
    for (const cell of cells) occupied.add(cell);
    for (const cell of cells) {
      for (const n of adjacent8(cell)) blocked.add(n);
    }
  }

  for (const ship of SHIPS) {
    if (seedShipMap[ship.id]) {
      const cells = seedShipMap[ship.id]!;
      fleet[ship.id] = cells;
      markShip(cells);
      continue;
    }

    let placed = false;
    for (let attempt = 0; attempt < 5000 && !placed; attempt++) {
      const dir: Dir = Math.random() < 0.5 ? "H" : "V";
      const r = Math.floor(Math.random() * SIZE);
      const c = Math.floor(Math.random() * SIZE);
      const anchor = idxOf(r, c);
      const { cells, ok } = placementCells(anchor, ship.length, dir);
      if (!ok) continue;
      if (cells.some((x) => occupied.has(x) || blocked.has(x))) continue;

      markShip(cells);
      fleet[ship.id] = cells;
      placed = true;
    }

    if (!placed) {
      // Retry full fleet (rare).
      return randomFleet(seedShipMap);
    }
  }

  return fleet as ShipMap;
}

function applySunkAdjacent(knowledge: Knowledge, sunkShipCells: number[]): Knowledge {
  // After a ship is sunk, mark all adjacent squares (including diagonals) as blocked-null.
  // Only cells that are still unknown are blocked; hits/misses remain unchanged.
  const next = knowledge.slice();
  const blocked = new Set<number>();
  for (const cell of sunkShipCells) {
    for (const n of adjacent8(cell)) blocked.add(n);
  }
  for (const b of blocked) {
    if (next[b] === 0) next[b] = 3;
  }
  return next;
}

function getDifficulty(difficultyFromUi: "adaptive" | "medium" | "hard"): Difficulty {
  // We reuse the existing difficulty selector on /play/[game] where possible.
  // Battleship doesn't currently have "adaptive", so map it:
  if (difficultyFromUi === "medium") return "medium";
  if (difficultyFromUi === "hard") return "hard";
  return "easy";
}

type ShotEvent = {
  by: "player" | "ai";
  cell: number;
  hit: boolean;
  shipId?: ShipId;
  sunk?: boolean;
};

function getRemainingShips(hitCounts: Record<ShipId, number>) {
  const remaining: Ship[] = [];
  for (const ship of SHIPS) {
    if (hitCounts[ship.id] < ship.length) remaining.push(ship);
  }
  return remaining;
}

function persistMatchHistory(record: {
  game: "battleship";
  result: "win" | "loss";
  difficulty: string;
  moveTimeSec: number;
  moves: number;
  at: number;
}) {
  try {
    if (typeof window === "undefined") return;
    const key = "rg_match_history_v1";
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    const arr = Array.isArray(parsed) ? parsed : [];
    arr.unshift(record);
    window.localStorage.setItem(key, JSON.stringify(arr.slice(0, 50)));
  } catch {
    // ignore
  }
}

function probabilityPick(args: {
  difficulty: Difficulty;
  aiShots: Knowledge; // ai's view of player's board: 0 unknown,1 miss,2 hit,3 blocked
  playerShipByCell: (ShipId | null)[];
  playerShipHitCounts: Record<ShipId, number>; // how many hit per player's ship
  blocked: Set<number>;
}) {
  // Enumerate all possible placements consistent with known misses/blocked.
  const { aiShots, playerShipHitCounts, blocked } = args;

  const remaining = getRemainingShips(playerShipHitCounts);
  if (!remaining.length) return null;

  // For each ship, score placements.
  const scores = new Array<number>(SIZE * SIZE).fill(0);

  // Confirmed hits that belong to not-yet-sunk ships.
  const confirmedHits = new Set<number>();
  for (let i = 0; i < aiShots.length; i++) {
    if (aiShots[i] === 2) {
      const sid = args.playerShipByCell[i];
      if (!sid) continue;
      const ship = SHIPS.find((s) => s.id === sid);
      if (!ship) continue;
      if (playerShipHitCounts[sid] < ship.length) confirmedHits.add(i);
    }
  }

  const hitList = Array.from(confirmedHits);

  const candidates = new Set<number>();
  for (let i = 0; i < aiShots.length; i++) {
    if (aiShots[i] === 0) candidates.add(i);
  }

  // Enumerate placements for each remaining ship length.
  for (const ship of remaining) {
    for (const dir of ["H", "V"] as Dir[]) {
      // Iterate anchors but only those that would fit.
      for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
          const anchor = idxOf(r, c);
          const { cells, ok } = placementCells(anchor, ship.length, dir);
          if (!ok) continue;
          if (cells.some((cell) => aiShots[cell] === 1 || aiShots[cell] === 3)) continue;

          // If there are confirmed hits, require placement to include at least one hit cell.
          if (hitList.length > 0 && !cells.some((x) => confirmedHits.has(x))) continue;

          // Score cells in this placement.
          for (const cell of cells) {
            if (!candidates.has(cell)) continue;
            scores[cell] += 1;
          }
        }
      }
    }
  }

  // Pick max score among unknown cells.
  let bestCell: number | null = null;
  let bestScore = -1;
  for (const cell of candidates) {
    if (blocked.has(cell)) continue;
    const s = scores[cell] ?? 0;
    if (s > bestScore) {
      bestScore = s;
      bestCell = cell;
    }
  }

  if (bestCell === null) {
    // Fallback to random among candidates.
    const arr = Array.from(candidates).filter((c) => !blocked.has(c));
    if (!arr.length) return null;
    return arr[Math.floor(Math.random() * arr.length)];
  }

  return bestCell;
}

function targetPick(args: {
  aiShots: Knowledge;
  playerShipByCell: (ShipId | null)[];
  playerShipHitCounts: Record<ShipId, number>;
  difficulty: Difficulty;
}) {
  const { aiShots, playerShipByCell, playerShipHitCounts } = args;

  // Find unsunk hit cells.
  const hitCells: number[] = [];
  for (let i = 0; i < aiShots.length; i++) {
    if (aiShots[i] !== 2) continue;
    const sid = playerShipByCell[i];
    if (!sid) continue;
    const ship = SHIPS.find((s) => s.id === sid);
    if (!ship) continue;
    if (playerShipHitCounts[sid] < ship.length) hitCells.push(i);
  }

  const candidates = new Set<number>();
  // If we have hits, try adjacent.
  for (const h of hitCells) {
    for (const n of adjacent8(h)) {
      if (aiShots[n] !== 0) continue;
      // For hunting adjacency, keep only N/E/S/W-ish by ignoring diagonal unless we have a single hit.
      candidates.add(n);
    }
  }

  const arr = Array.from(candidates);
  if (arr.length) return arr[Math.floor(Math.random() * arr.length)];

  // Otherwise, hunt random.
  const unknown = [];
  for (let i = 0; i < aiShots.length; i++) {
    if (aiShots[i] === 0) unknown.push(i);
  }
  if (!unknown.length) return null;
  return unknown[Math.floor(Math.random() * unknown.length)];
}

function randomPick(args: { aiShots: Knowledge }) {
  const unknown: number[] = [];
  for (let i = 0; i < args.aiShots.length; i++) {
    if (args.aiShots[i] === 0) unknown.push(i);
  }
  if (!unknown.length) return null;
  return unknown[Math.floor(Math.random() * unknown.length)];
}

export function BattleshipVsAi({ difficulty }: { difficulty: "adaptive" | "medium" | "hard" }) {
  const theme = useThemeStore((s) => s.theme);
  const [mounted, setMounted] = useState(false);

  const mappedDifficulty = useMemo(() => getDifficulty(difficulty), [difficulty]);

  const [phase, setPhase] = useState<Phase>("setup");
  const [setupRotation, setSetupRotation] = useState<Dir>("H");

  const [soundOn, setSoundOn] = useState(true);
  const [hapticsOn, setHapticsOn] = useState(true);

  const [playerFleet, setPlayerFleet] = useState<Partial<ShipMap>>({});
  const [dragShipId, setDragShipId] = useState<ShipId | null>(null);
  const [hoverAnchor, setHoverAnchor] = useState<number | null>(null);

  // Battle state
  const [playerShots, setPlayerShots] = useState<Knowledge>(emptyKnowledge()); // what player knows about AI grid
  const [aiShots, setAiShots] = useState<Knowledge>(emptyKnowledge()); // what AI knows about player grid

  const [aiFleet, setAiFleet] = useState<ShipMap | null>(null);
  const [playerShipHitCounts, setPlayerShipHitCounts] = useState<Record<ShipId, number>>(
    SHIPS.reduce((acc, s) => {
      acc[s.id] = 0;
      return acc;
    }, {} as Record<ShipId, number>)
  );
  const [aiShipHitCounts, setAiShipHitCounts] = useState<Record<ShipId, number>>(
    SHIPS.reduce((acc, s) => {
      acc[s.id] = 0;
      return acc;
    }, {} as Record<ShipId, number>)
  );

  const [turn, setTurn] = useState<Turn>("player");
  const [aiLoading, setAiLoading] = useState(false);

  const [sinkPulseCells, setSinkPulseCells] = useState<number[]>([]);
  const sinkPulseTokenRef = useRef(0);

  const [moveTimeSec, setMoveTimeSec] = useState<number>(15); // configurable, default 15s
  const [timeLeftMs, setTimeLeftMs] = useState<number>(15 * 1000);
  const intervalRef = useRef<number | null>(null);
  const lastTickRef = useRef<number>(Date.now());

  const [events, setEvents] = useState<ShotEvent[]>([]);
  const [replayIndex, setReplayIndex] = useState<number>(0);

  const playerFleetComplete = useMemo(() => {
    return SHIPS.every((s) => Array.isArray(playerFleet[s.id]) && playerFleet[s.id]!.length === s.length);
  }, [playerFleet]);

  const playerFleetShips = useMemo(() => {
    if (!playerFleetComplete) return null;
    return playerFleet as ShipMap;
  }, [playerFleet, playerFleetComplete]);

  const playerShipByCell = useMemo(() => {
    // During setup we must render ships immediately even if the full fleet isn't placed yet.
    const byCell: (ShipId | null)[] = new Array(SIZE * SIZE).fill(null);
    for (const ship of SHIPS) {
      const cells = playerFleet[ship.id];
      if (!cells || cells.length !== ship.length) continue; // show only fully placed ship segments
      for (const cell of cells) byCell[cell] = ship.id;
    }
    return byCell;
  }, [playerFleet]);

  const aiShipByCell = useMemo(() => {
    if (!aiFleet) return new Array(SIZE * SIZE).fill(null) as (ShipId | null)[];
    return fleetToShipByCell(aiFleet);
  }, [aiFleet]);

  const placedCells = useMemo(() => {
    const set = new Set<number>();
    for (const ship of SHIPS) {
      const cells = playerFleet[ship.id];
      if (!cells) continue;
      for (const c of cells) set.add(c);
    }
    return set;
  }, [playerFleet]);

  const preview = useMemo(() => {
    if (!dragShipId || hoverAnchor === null) return null;
    const ship = SHIPS.find((s) => s.id === dragShipId);
    if (!ship) return null;
    const { cells, ok } = placementCells(hoverAnchor, ship.length, setupRotation);
    if (!ok) return { cells: [], ok: false, valid: false };
    // Placement valid if none overlap and no cell touches any existing ship (diagonals included).
    const valid = cells.every((c) => {
      if (placedCells.has(c)) return false;
      return adjacent8(c).every((n) => !placedCells.has(n));
    });
    return { cells, ok: true, valid };
  }, [dragShipId, hoverAnchor, setupRotation, placedCells]);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Setup keyboard rotate
  useEffect(() => {
    if (!mounted) return;
    function onKeyDown(e: KeyboardEvent) {
      if (phase !== "setup") return;
      if (e.key.toLowerCase() === "r") setSetupRotation((d) => (d === "H" ? "V" : "H"));
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mounted, phase]);

  function resetToSetup() {
    setPhase("setup");
    setPlayerFleet({});
    setDragShipId(null);
    setHoverAnchor(null);
    setAiFleet(null);
    setSinkPulseCells([]);
    setPlayerShots(emptyKnowledge());
    setAiShots(emptyKnowledge());
    setPlayerShipHitCounts(
      SHIPS.reduce((acc, s) => {
        acc[s.id] = 0;
        return acc;
      }, {} as Record<ShipId, number>)
    );
    setAiShipHitCounts(
      SHIPS.reduce((acc, s) => {
        acc[s.id] = 0;
        return acc;
      }, {} as Record<ShipId, number>)
    );
    setTurn("player");
    setAiLoading(false);
    setEvents([]);
    setReplayIndex(0);
  }

  function placeShip(shipId: ShipId, anchor: number, dir: Dir): boolean {
    const ship = SHIPS.find((s) => s.id === shipId);
    if (!ship) return false;
    const { cells, ok } = placementCells(anchor, ship.length, dir);
    if (!ok) return false;
    const touchesExisting = cells.some((c) => placedCells.has(c) || adjacent8(c).some((n) => placedCells.has(n)));
    if (touchesExisting) return false;
    setPlayerFleet((prev) => ({ ...prev, [shipId]: cells }));
    return true;
  }

  function startBattle() {
    if (!playerFleetShips) return;
    const newAiFleet = randomFleet();
    setAiFleet(newAiFleet);

    setSinkPulseCells([]);
    setPlayerShots(emptyKnowledge());
    setAiShots(emptyKnowledge());
    setPlayerShipHitCounts(
      SHIPS.reduce((acc, s) => {
        acc[s.id] = 0;
        return acc;
      }, {} as Record<ShipId, number>)
    );
    setAiShipHitCounts(
      SHIPS.reduce((acc, s) => {
        acc[s.id] = 0;
        return acc;
      }, {} as Record<ShipId, number>)
    );

    setTurn("player");
    setAiLoading(false);
    setEvents([]);
    setReplayIndex(0);
    setPhase("battle");
    safeVibrate(12);
    if (soundOn) tone("miss");
  }

  const timeLimitMs = useMemo(() => moveTimeSec * 1000, [moveTimeSec]);

  useEffect(() => {
    if (!mounted) return;
    if (phase !== "battle") return;
    if (turn !== "player") return;

    setTimeLeftMs(timeLimitMs);
    lastTickRef.current = Date.now();

    if (intervalRef.current) window.clearInterval(intervalRef.current);

    intervalRef.current = window.setInterval(() => {
      const now = Date.now();
      const elapsed = now - lastTickRef.current;
      lastTickRef.current = now;
      setTimeLeftMs((t) => Math.max(0, t - elapsed));
    }, 100);

    return () => {
      if (intervalRef.current) window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    };
  }, [mounted, phase, turn, timeLimitMs]);

  function getRandomLegalShot(knowledge: Knowledge) {
    const candidates: number[] = [];
    for (let i = 0; i < knowledge.length; i++) {
      if (knowledge[i] === 0) candidates.push(i);
    }
    if (!candidates.length) return null;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  function pulseSink(cells: number[]) {
    const token = ++sinkPulseTokenRef.current;
    const set = new Set<number>(cells);
    for (const cell of cells) {
      for (const n of adjacent8(cell)) set.add(n);
    }
    setSinkPulseCells(Array.from(set));
    window.setTimeout(() => {
      if (sinkPulseTokenRef.current !== token) return;
      setSinkPulseCells([]);
    }, 650);
  }

  function commitPlayerShot(cell: number) {
    if (!aiFleet || !playerFleetShips) return;
    if (phase !== "battle") return;
    if (turn !== "player") return;
    if (playerShots[cell] !== 0) return;

    const shipId = aiShipByCell[cell];
    const hit = shipId !== null;
    const sunkAfter =
      hit && shipId !== null
        ? aiShipHitCounts[shipId] + 1 >= SHIPS.find((s) => s.id === shipId)!.length
        : false;

    // Update knowledge and hit counts atomically via functional updates.
    setPlayerShots((prev) => {
      const next = prev.slice();
      next[cell] = hit ? 2 : 1;
      if (sunkAfter && shipId !== null) return applySunkAdjacent(next, aiFleet[shipId]);
      return next;
    });

    if (hit && shipId !== null) {
      setAiShipHitCounts((prev) => ({ ...prev, [shipId]: prev[shipId] + 1 }));
    }

    setEvents((prev) => [
      ...prev,
      {
        by: "player",
        cell,
        hit,
        shipId: hit && shipId !== null ? shipId : undefined,
        sunk: sunkAfter || undefined,
      },
    ]);

    if (hapticsOn) safeVibrate(hit ? [18, 10, 18] : 10);
    if (soundOn) tone(hit ? "hit" : "miss");

    if (sunkAfter && shipId !== null) {
      pulseSink(aiFleet[shipId]);
      if (hapticsOn) safeVibrate([35, 20, 35, 20, 65]);
      if (soundOn) tone("sink");
    }

    // Turn switch to AI
    setTurn("ai");
    setAiLoading(true);
  }

  const commitAIShot = useCallback(
    (cell: number) => {
    if (!aiFleet || !playerFleetShips) return;
    if (phase !== "battle") return;
    if (turn !== "ai") return;
    if (aiShots[cell] !== 0) return;

    const shipId = playerShipByCell[cell];
    const hit = shipId !== null;
      const sunkAfter =
        hit && shipId !== null
          ? playerShipHitCounts[shipId] + 1 >= SHIPS.find((s) => s.id === shipId)!.length
          : false;

    setAiShots((prev) => {
      const next = prev.slice();
      next[cell] = hit ? 2 : 1;
        if (sunkAfter && shipId !== null) return applySunkAdjacent(next, playerFleetShips[shipId]);
      return next;
    });

    if (hit && shipId) {
      setPlayerShipHitCounts((prev) => ({ ...prev, [shipId]: prev[shipId] + 1 }));
    }

    setEvents((prev) => [
      ...prev,
      {
        by: "ai",
        cell,
        hit,
          shipId: hit && shipId !== null ? shipId : undefined,
          sunk: sunkAfter || undefined,
      },
    ]);

    if (hapticsOn) safeVibrate(hit ? [18, 10, 18, 30] : 10);
    if (soundOn) tone(hit ? "hit" : "miss");

      if (sunkAfter && shipId !== null) {
        pulseSink(playerFleetShips[shipId]);
        if (hapticsOn) safeVibrate([45, 25, 45, 20, 70]);
        if (soundOn) tone("sink");
      }

    setTurn("player");
    setAiLoading(false);
    },
    [aiFleet, playerFleetShips, phase, turn, aiShots, playerShipByCell, playerShipHitCounts, hapticsOn, soundOn]
  );

  const playerWins = useMemo(() => {
    // Player wins when all AI ships sunk (aiShipHitCounts >= lengths)
    if (!aiFleet) return false;
    return SHIPS.every((s) => aiShipHitCounts[s.id] >= s.length);
  }, [aiFleet, aiShipHitCounts]);

  const aiWins = useMemo(() => {
    if (!playerFleetShips) return false;
    return SHIPS.every((s) => playerShipHitCounts[s.id] >= s.length);
  }, [playerFleetShips, playerShipHitCounts]);

  useEffect(() => {
    if (!mounted) return;
    if (phase !== "battle") return;
    if (playerWins) {
      setPhase("replay");
      setReplayIndex(events.length);
      persistMatchHistory({
        game: "battleship",
        result: "win",
        difficulty: mappedDifficulty,
        moveTimeSec,
        moves: events.length,
        at: Date.now(),
      });
      if (hapticsOn) safeVibrate([55, 25, 65, 25, 75]);
      if (soundOn) tone("victory");
    } else if (aiWins) {
      setPhase("replay");
      setReplayIndex(events.length);
      persistMatchHistory({
        game: "battleship",
        result: "loss",
        difficulty: mappedDifficulty,
        moveTimeSec,
        moves: events.length,
        at: Date.now(),
      });
      if (hapticsOn) safeVibrate([30, 15, 30]);
      if (soundOn) tone("victory");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerWins, aiWins, phase, mounted]);

  // AI turn scheduler
  useEffect(() => {
    if (!mounted) return;
    if (phase !== "battle") return;
    if (turn !== "ai") return;
    if (aiLoading) {
      const delay = timeForDifficulty(mappedDifficulty);
      const t = window.setTimeout(() => {
        // Choose cell based on difficulty.
        const blocked = new Set<number>();
        for (let i = 0; i < aiShots.length; i++) {
          if (aiShots[i] === 3) blocked.add(i);
        }

        let choice: number | null = null;
        if (mappedDifficulty === "easy") {
          choice = randomPick({ aiShots });
        } else if (mappedDifficulty === "medium") {
          choice = targetPick({
            aiShots,
            playerShipByCell,
            playerShipHitCounts,
            difficulty: mappedDifficulty,
          });
        } else {
          choice = probabilityPick({
            difficulty: mappedDifficulty,
            aiShots,
            playerShipByCell,
            playerShipHitCounts,
            blocked,
          });
        }

        if (choice !== null) commitAIShot(choice);
      }, delay);
      return () => window.clearTimeout(t);
    }
  }, [
    mounted,
    phase,
    turn,
    aiLoading,
    mappedDifficulty,
    aiShots,
    playerShipByCell,
    playerShipHitCounts,
    commitAIShot,
  ]);

  // Timeout auto-shot
  useEffect(() => {
    if (!mounted) return;
    if (phase !== "battle") return;
    if (turn !== "player") return;
    if (timeLeftMs > 0) return;

    const choice = getRandomLegalShot(playerShots);
    if (choice !== null) commitPlayerShot(choice);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLeftMs, mounted, phase, turn, playerShots]);

  // Derived replay boards: we reconstruct knowledge by applying events sequentially.
  const replayBoards = useMemo(() => {
    if (phase !== "replay") return null;
    const playerKnowledge: Knowledge = emptyKnowledge();
    const aiKnowledge: Knowledge = emptyKnowledge();

    for (let i = 0; i < Math.min(replayIndex, events.length); i++) {
      const e = events[i];
      if (e.by === "player") {
        playerKnowledge[e.cell] = e.hit ? 2 : 1;
        if (e.hit && e.shipId && e.sunk && aiFleet) {
          const next = applySunkAdjacent(playerKnowledge, aiFleet[e.shipId]);
          playerKnowledge.splice(0, playerKnowledge.length, ...next);
        }
      }
      if (e.by === "ai") {
        aiKnowledge[e.cell] = e.hit ? 2 : 1;
        if (e.hit && e.shipId && e.sunk && playerFleetShips) {
          const next = applySunkAdjacent(aiKnowledge, playerFleetShips[e.shipId]);
          aiKnowledge.splice(0, aiKnowledge.length, ...next);
        }
      }
    }

    return { playerKnowledge, aiKnowledge };
  }, [phase, replayIndex, events, aiFleet, playerFleetShips]);

  const effectivePlayerShots = phase === "replay" && replayBoards ? replayBoards.playerKnowledge : playerShots;
  const effectiveAiShots = phase === "replay" && replayBoards ? replayBoards.aiKnowledge : aiShots;

  const oceanClass =
    theme === "midnight"
      ? "bg-[radial-gradient(circle_at_20%_10%,rgba(0,231,255,0.12),transparent_55%),radial-gradient(circle_at_80%_30%,rgba(123,11,255,0.10),transparent_50%),linear-gradient(180deg,rgba(0,20,40,0.65),rgba(0,0,0,0.35))] before:content-[''] before:absolute before:inset-0 before:bg-[repeating-linear-gradient(135deg,rgba(255,255,255,0.06)_0px,rgba(255,255,255,0.06)_2px,transparent_2px,transparent_8px)]"
      : theme === "british"
        ? "bg-[radial-gradient(circle_at_20%_10%,rgba(212,175,55,0.10),transparent_55%),radial-gradient(circle_at_80%_30%,rgba(0,231,255,0.12),transparent_52%),linear-gradient(180deg,rgba(90,170,255,0.35),rgba(20,70,140,0.18))] before:content-[''] before:absolute before:inset-0 before:bg-[repeating-linear-gradient(90deg,rgba(255,255,255,0.08)_0px,rgba(255,255,255,0.08)_2px,transparent_2px,transparent_10px)]"
        : "bg-[radial-gradient(circle_at_25%_10%,rgba(0,231,255,0.14),transparent_60%),radial-gradient(circle_at_85%_35%,rgba(255,42,42,0.10),transparent_55%),linear-gradient(180deg,rgba(10,80,70,0.55),rgba(10,0,20,0.25))] before:content-[''] before:absolute before:inset-0 before:bg-[repeating-linear-gradient(135deg,rgba(255,255,255,0.06)_0px,rgba(255,255,255,0.06)_2px,transparent_2px,transparent_9px)]";

  function cellTone(status: number, isEnemy: boolean) {
    if (status === 1) return "bg-white/10"; // miss
    if (status === 2) return `bg-[color:var(--rb-accent)]/20 ring-2 ring-[color:var(--rb-accent)]`; // hit
    if (status === 3) return "bg-white/5 opacity-70"; // blocked-null
    return isEnemy ? "bg-white/10 hover:bg-white/15" : "bg-white/10";
  }

  function renderSetupBoard() {
    return (
      <div className="grid grid-cols-10 gap-0.5 rounded-2xl bg-black/20 p-0.5">
        {Array.from({ length: SIZE }).map((_, r) =>
          Array.from({ length: SIZE }).map((__, c) => {
            const cell = idxOf(r, c);
            const previewCells = preview?.cells ?? [];
            const showGhost = previewCells.includes(cell);
            const ghostOk = preview?.valid ?? false;
            const hasShip = placedCells.has(cell);
            return (
              <div
                key={`${r}_${c}`}
                className={[
                  "relative aspect-square select-none rounded-[4px] transition",
                  oceanClass,
                  hasShip ? "opacity-70" : "opacity-85",
                  showGhost ? (ghostOk ? "ring-2 ring-emerald-300/60" : "ring-2 ring-red-300/60") : "",
                ].join(" ")}
                onDragOver={(e) => {
                  if (!dragShipId) return;
                  e.preventDefault();
                  setHoverAnchor(cell);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (!dragShipId) return;
                  const ok = placeShip(dragShipId, cell, setupRotation);
                  if (ok) {
                    setDragShipId(null);
                    setHoverAnchor(null);
                  }
                }}
              >
                {hasShip && playerShipByCell[cell] ? (
                  (() => {
                    const shipId = playerShipByCell[cell]!;
                    const sameLeft =
                      c > 0 && playerShipByCell[idxOf(r, c - 1)] === shipId;
                    const sameRight =
                      c < SIZE - 1 && playerShipByCell[idxOf(r, c + 1)] === shipId;
                    const dir: Dir = sameLeft || sameRight ? "H" : "V";
                    return (
                      <div
                        className={[
                          "absolute rounded-[7px] border border-white/10 shadow-[0_0_24px_rgba(255,42,42,0.18)]",
                          dir === "H"
                            ? "left-[12%] top-[45%] h-[12%] w-[76%]"
                            : "left-[45%] top-[12%] h-[76%] w-[12%]",
                          "bg-gradient-to-br from-red-500/95 via-red-600/95 to-red-950/90",
                        ].join(" ")}
                      >
                        <div className="absolute inset-[10%] rounded-[6px] bg-[repeating-linear-gradient(90deg,rgba(0,0,0,0.35),rgba(0,0,0,0.35)_2px,transparent_2px,transparent_7px)] opacity-70" />
                      </div>
                    );
                  })()
                ) : null}
                {showGhost ? (
                  <div
                    className={[
                      "absolute inset-[18%] rounded-[6px] transition",
                      ghostOk ? "bg-emerald-300/20" : "bg-red-300/20",
                      "shadow-[0_0_20px_rgba(255,42,42,0.10)]",
                    ].join(" ")}
                  />
                ) : null}
              </div>
            );
          })
        )}
      </div>
    );
  }

  function renderBattleBoardEnemy() {
    return (
      <div className="grid grid-cols-10 gap-0.5 rounded-2xl bg-black/20 p-0.5">
        {Array.from({ length: SIZE }).map((_, r) =>
          Array.from({ length: SIZE }).map((__, c) => {
            const cell = idxOf(r, c);
            const status = effectivePlayerShots[cell];
            const isSinking = sinkPulseSet.has(cell);
            const canShoot = phase === "battle" && turn === "player" && status === 0;
            return (
              <motion.button
                key={`${r}_${c}`}
                type="button"
                className={[
                  "relative aspect-square select-none rounded-[4px] overflow-hidden transition",
                  canShoot ? "hover:scale-[1.02]" : "",
                  cellTone(status, true),
                ].join(" ")}
                disabled={!canShoot}
                onClick={() => commitPlayerShot(cell)}
                initial={false}
                animate={status === 2 ? { scale: 1.06 } : status === 1 ? { scale: 1.01 } : { scale: 1 }}
                transition={{ duration: 0.12 }}
                aria-label={`Enemy cell ${r},${c}`}
              >
                {isSinking ? (
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(255,42,42,0.28),transparent_60%)] opacity-90 animate-pulse" />
                ) : null}
                {status === 2 ? (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="h-3.5 w-3.5 rounded-full bg-[color:var(--rb-accent)] shadow-[0_0_22px_var(--rb-glow)]" />
                  </div>
                ) : status === 1 ? (
                  <div className="absolute inset-0 flex items-center justify-center opacity-90">
                    <div className="h-2.5 w-2.5 rounded-full bg-white/20" />
                  </div>
                ) : status === 3 ? (
                  <div className="absolute inset-0 opacity-60" />
                ) : null}

                {canShoot ? (
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(255,42,42,0.18),transparent_60%)] opacity-0 hover:opacity-100 transition" />
                ) : null}
              </motion.button>
            );
          })
        )}
      </div>
    );
  }

  function renderBattleBoardPlayer() {
    return (
      <div className="grid grid-cols-10 gap-0.5 rounded-2xl bg-black/20 p-0.5">
        {Array.from({ length: SIZE }).map((_, r) =>
          Array.from({ length: SIZE }).map((__, c) => {
            const cell = idxOf(r, c);
            const shotStatus = effectiveAiShots[cell];
            const shipPresent = playerShipByCell[cell] !== null;
            const isSinking = sinkPulseSet.has(cell);
            const showShip = phase !== "setup" ? true : shipPresent;
            return (
              <motion.div
                key={`${r}_${c}`}
                className={[
                  "relative aspect-square select-none rounded-[4px] overflow-hidden",
                  oceanClass,
                  showShip ? "opacity-90" : "opacity-70",
                  shipPresent ? "bg-white/6" : "bg-transparent",
                  shotStatus === 2 ? "ring-2 ring-[color:var(--rb-accent)]" : "",
                ].join(" ")}
                initial={false}
                animate={shotStatus === 2 ? { scale: 1.04 } : shotStatus === 1 ? { scale: 1.01 } : { scale: 1 }}
                transition={{ duration: 0.12 }}
              >
                {isSinking ? (
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(255,42,42,0.24),transparent_62%)] opacity-70 animate-pulse" />
                ) : null}
                {shipPresent && showShip ? (
                  (() => {
                    const shipId = playerShipByCell[cell];
                    if (!shipId) return null;
                    const sameLeft =
                      c > 0 && playerShipByCell[idxOf(r, c - 1)] === shipId;
                    const sameRight =
                      c < SIZE - 1 && playerShipByCell[idxOf(r, c + 1)] === shipId;
                    const dir: Dir = sameLeft || sameRight ? "H" : "V";
                    return (
                      <div
                        className={[
                          "absolute rounded-[8px] border border-white/10 shadow-[0_0_28px_rgba(255,42,42,0.22)]",
                          dir === "H"
                            ? "left-[10%] top-[46%] h-[14%] w-[80%]"
                            : "left-[46%] top-[10%] h-[80%] w-[14%]",
                          "bg-gradient-to-br from-red-500/95 via-red-600/95 to-red-950/90",
                        ].join(" ")}
                      >
                        <div className="absolute inset-[10%] rounded-[6px] bg-black/20" />
                        <div className="absolute inset-[10%] rounded-[6px] bg-[repeating-linear-gradient(90deg,rgba(255,255,255,0.25),rgba(255,255,255,0.25)_2px,transparent_2px,transparent_7px)] opacity-60" />
                      </div>
                    );
                  })()
                ) : null}

                {shotStatus === 2 ? (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="h-3.5 w-3.5 rounded-full bg-[color:var(--rb-accent)] shadow-[0_0_22px_var(--rb-glow)]" />
                  </div>
                ) : shotStatus === 1 ? (
                  <div className="absolute inset-0 flex items-center justify-center opacity-90">
                    <div className="h-2.5 w-2.5 rounded-full bg-white/20" />
                  </div>
                ) : shotStatus === 3 ? (
                  <div className="absolute inset-0 bg-white/5 opacity-70" />
                ) : null}
              </motion.div>
            );
          })
        )}
      </div>
    );
  }

  const remainingShips = useMemo(() => {
    return SHIPS.filter((s) => !playerFleet[s.id] || playerFleet[s.id]!.length !== s.length);
  }, [playerFleet]);

  const sinkPulseSet = useMemo(() => new Set(sinkPulseCells), [sinkPulseCells]);

  const progress = useMemo(() => {
    const p = timeLimitMs <= 0 ? 0 : timeLeftMs / timeLimitMs;
    return Math.max(0, Math.min(1, p));
  }, [timeLeftMs, timeLimitMs]);

  const isBattleOver = phase === "replay" && (playerWins || aiWins);
  const victoryText = playerWins
    ? "Victory. The sea breaks under your gambit—fleet extinguished."
    : aiWins
      ? "Defeat. The AI sinks the final route—Red Gambit is punished."
      : null;

  if (!mounted) {
    return (
      <div className="space-y-4">
        <div className="rb-glass rounded-[28px] p-4 h-[520px] animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm">
          <div className="text-xs font-semibold tracking-[0.22em] text-white/60">BATTLESHIP</div>
          <div className="mt-1 font-extrabold">
            {phase === "setup" ? "Place your fleet" : isBattleOver ? "Match Ended" : turn === "player" ? "Your move" : "AI is aiming"}
          </div>
          {victoryText ? <div className="mt-2 text-xs text-white/65">{victoryText}</div> : null}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={resetToSetup}
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-bold hover:bg-white/10 transition disabled:opacity-60"
          >
            New
          </button>

          {phase === "setup" ? (
            <button
              type="button"
              disabled={!playerFleetComplete}
              onClick={startBattle}
              className="rounded-xl border border-[color:var(--rb-accent)]/40 bg-[color:var(--rb-accent)]/15 px-3 py-2 text-sm font-bold hover:bg-[color:var(--rb-accent)]/25 transition disabled:opacity-50"
            >
              Start Battle
            </button>
          ) : null}
        </div>
      </div>

      {phase === "battle" && turn === "player" ? (
        <div className="rb-glass rounded-2xl p-4">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold tracking-[0.18em] text-white/60">TURN TIMER</div>
            <div className="text-xs font-bold text-[color:var(--rb-accent)]">{Math.ceil(timeLeftMs / 1000)}s</div>
          </div>
          <div className="mt-3 h-2 rounded-full bg-white/10 overflow-hidden">
            <motion.div
              className="h-full rounded-full bg-[color:var(--rb-accent)] shadow-[0_0_22px_var(--rb-glow)]"
              initial={false}
              animate={{ width: `${Math.round(progress * 100)}%` }}
              transition={{ duration: 0.1 }}
            />
          </div>
        </div>
      ) : null}

      {phase === "setup" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rb-glass rounded-[28px] p-4">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold tracking-[0.22em] text-white/60">FLEET PLACEMENT</div>
              <button
                type="button"
                onClick={() => setSetupRotation((d) => (d === "H" ? "V" : "H"))}
                className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-bold hover:bg-white/10 transition"
              >
                Rotate: {setupRotation}
              </button>
            </div>

            <div className="mt-3">{renderSetupBoard()}</div>

            <div className="mt-4 text-xs text-white/60">
              Drag a ship onto the grid. Cells adjacent to invalid placements will highlight red.
            </div>
          </div>

          <div className="rb-glass rounded-[28px] p-4">
            <div className="text-xs font-semibold tracking-[0.22em] text-white/60">SHIPS</div>
            <div className="mt-3 flex flex-col gap-3">
              {remainingShips.map((ship) => (
                <div
                  key={ship.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/plain", ship.id);
                    setDragShipId(ship.id);
                    setHoverAnchor(null);
                  }}
                  onDragEnd={() => {
                    setDragShipId(null);
                    setHoverAnchor(null);
                  }}
                  className={[
                    "flex items-center justify-between gap-3 rounded-2xl border px-4 py-3",
                    "border-white/10 bg-white/5",
                    "cursor-grab active:cursor-grabbing",
                  ].join(" ")}
                >
                  <div>
                    <div className="text-sm font-extrabold">{ship.name}</div>
                    <div className="mt-0.5 text-xs text-white/60">{ship.length} cells</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-xs text-white/60">{setupRotation}</div>
                    <div className="flex items-center">
                      {Array.from({ length: ship.length }).map((_, i) => (
                        <div
                          key={i}
                          className={[
                            "h-2.5 w-2.5 rounded-sm",
                            theme === "midnight"
                              ? "bg-[rgba(123,11,255,0.25)]"
                              : theme === "british"
                                ? "bg-[rgba(212,175,55,0.20)]"
                                : "bg-[rgba(0,168,107,0.20)]",
                          ].join(" ")}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              ))}

              {playerFleetComplete ? (
                <div className="mt-2 text-xs text-white/70">
                  Fleet locked. Start the battle whenever you’re ready.
                </div>
              ) : null}

              <div className="mt-3">
                <div className="text-xs font-semibold tracking-[0.18em] text-white/60">TURN TIME</div>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <input
                    type="range"
                    min={5}
                    max={60}
                    value={moveTimeSec}
                    onChange={(e) => setMoveTimeSec(Number(e.target.value))}
                    className="w-full"
                  />
                  <div className="min-w-[44px] text-xs font-bold text-[color:var(--rb-accent)]">{moveTimeSec}s</div>
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-xs text-white/70 cursor-pointer select-none">
                  <input type="checkbox" checked={hapticsOn} onChange={(e) => setHapticsOn(e.target.checked)} />
                  Haptics
                </label>
                <label className="flex items-center gap-2 text-xs text-white/70 cursor-pointer select-none">
                  <input type="checkbox" checked={soundOn} onChange={(e) => setSoundOn(e.target.checked)} />
                  Sound
                </label>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {phase === "battle" || phase === "replay" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rb-glass rounded-[28px] p-4">
            <div className="text-xs font-semibold tracking-[0.22em] text-white/60">YOUR BOARD</div>
            <div className="mt-3">{renderBattleBoardPlayer()}</div>
          </div>
          <div className="rb-glass rounded-[28px] p-4">
            <div className="text-xs font-semibold tracking-[0.22em] text-white/60">ENEMY WATERS</div>
            <div className="mt-3">{renderBattleBoardEnemy()}</div>
          </div>
        </div>
      ) : null}

      {phase === "replay" ? (
        <div className="rb-glass rounded-[28px] p-4">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold tracking-[0.18em] text-white/60">REPLAY</div>
            <div className="text-xs text-white/60">
              {replayIndex}/{events.length}
            </div>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-bold hover:bg-white/10 transition"
              onClick={() => setReplayIndex(0)}
            >
              Start
            </button>
            <button
              type="button"
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-bold hover:bg-white/10 transition disabled:opacity-60"
              disabled={replayIndex <= 0}
              onClick={() => setReplayIndex((v) => Math.max(0, v - 1))}
            >
              Prev
            </button>
            <button
              type="button"
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-bold hover:bg-white/10 transition disabled:opacity-60"
              disabled={replayIndex >= events.length}
              onClick={() => setReplayIndex((v) => Math.min(events.length, v + 1))}
            >
              Next
            </button>
          </div>

          <div className="mt-3 text-xs text-white/60">
            Replay is currently focused on shot outcomes. Extending to full “sinking adjacency” visuals is straightforward after we store full sunk-step metadata.
          </div>
        </div>
      ) : null}
    </div>
  );
}

