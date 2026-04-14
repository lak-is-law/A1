from __future__ import annotations

import time
import random
from dataclasses import dataclass
from typing import Any, Dict, List, Literal, Optional, Tuple

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

import chess
import chess.polyglot


app = FastAPI(title="Red Gambit AI Engine", version="1.0.0")


GameType = Literal["chess", "baduk"]
Difficulty = Literal["adaptive", "medium", "hard", "god"]


class MoveRequest(BaseModel):
    game: GameType
    difficulty: Difficulty = "adaptive"
    time_ms: int = Field(default=2500, ge=50, le=10000)

    # Chess input (required for game="chess")
    fen: Optional[str] = None

    # Baduk / Go input (required for game="baduk")
    size: int = Field(default=9, ge=5, le=13)
    to_play: Optional[Literal["black", "white"]] = None
    komi: float = 7.5
    board: Optional[List[int]] = None  # row-major; 0 empty, 1 black, -1 white


class MoveResponse(BaseModel):
    move: str
    depth: int
    nodes: int
    score: float
    pv: List[str] = []


class TimeoutError(Exception):
    pass


MATERIAL = {
    chess.PAWN: 100,
    chess.KNIGHT: 320,
    chess.BISHOP: 330,
    chess.ROOK: 500,
    chess.QUEEN: 900,
}


def _piece_square_tables() -> Dict[int, List[int]]:
    # Values for WHITE perspective. Mirror by rank for BLACK.
    # 8x8 flattened row-major.
    pawn = [
        0, 0, 0, 0, 0, 0, 0, 0,
        5, 10, 10, -20, -20, 10, 10, 5,
        5, -5, -10, 0, 0, -10, -5, 5,
        0, 0, 0, 20, 20, 0, 0, 0,
        5, 5, 10, 25, 25, 10, 5, 5,
        10, 10, 20, 30, 30, 20, 10, 10,
        50, 50, 50, 50, 50, 50, 50, 50,
        0, 0, 0, 0, 0, 0, 0, 0,
    ]
    knight = [
        -50, -40, -30, -30, -30, -30, -40, -50,
        -40, -20, 0, 5, 5, 0, -20, -40,
        -30, 5, 10, 15, 15, 10, 5, -30,
        -30, 0, 15, 20, 20, 15, 0, -30,
        -30, 5, 15, 20, 20, 15, 5, -30,
        -30, 0, 10, 15, 15, 10, 0, -30,
        -40, -20, 0, 0, 0, 0, -20, -40,
        -50, -40, -30, -30, -30, -30, -40, -50,
    ]
    bishop = [
        -20, -10, -10, -10, -10, -10, -10, -20,
        -10, 5, 0, 0, 0, 0, 5, -10,
        -10, 10, 10, 10, 10, 10, 10, -10,
        -10, 0, 10, 10, 10, 10, 0, -10,
        -10, 5, 5, 10, 10, 5, 5, -10,
        -10, 0, 5, 10, 10, 5, 0, -10,
        -10, 0, 0, 0, 0, 0, 0, -10,
        -20, -10, -10, -10, -10, -10, -10, -20,
    ]
    rook = [
        0, 0, 0, 5, 5, 0, 0, 0,
        -5, 0, 0, 0, 0, 0, 0, -5,
        -5, 0, 0, 0, 0, 0, 0, -5,
        -5, 0, 0, 0, 0, 0, 0, -5,
        -5, 0, 0, 0, 0, 0, 0, -5,
        -5, 0, 0, 0, 0, 0, 0, -5,
        5, 10, 10, 10, 10, 10, 10, 5,
        0, 0, 0, 0, 0, 0, 0, 0,
    ]
    queen = [
        -20, -10, -10, -5, -5, -10, -10, -20,
        -10, 0, 0, 0, 0, 0, 0, -10,
        -10, 0, 5, 5, 5, 5, 0, -10,
        -5, 0, 5, 5, 5, 5, 0, -5,
        0, 0, 5, 5, 5, 5, 0, -5,
        -10, 5, 5, 5, 5, 5, 0, -10,
        -10, 0, 5, 0, 0, 0, 0, -10,
        -20, -10, -10, -5, -5, -10, -10, -20,
    ]
    king = [
        -50, -40, -30, -30, -30, -30, -40, -50,
        -40, -20, -10, -10, -10, -10, -20, -40,
        -30, -10, 20, 30, 30, 20, -10, -30,
        -30, -10, 30, 40, 40, 30, -10, -30,
        -30, -10, 30, 40, 40, 30, -10, -30,
        -30, -10, 20, 30, 30, 20, -10, -30,
        -40, -20, -10, -10, -10, -10, -20, -40,
        -50, -40, -30, -30, -30, -30, -40, -50,
    ]
    return {
        chess.PAWN: pawn,
        chess.KNIGHT: knight,
        chess.BISHOP: bishop,
        chess.ROOK: rook,
        chess.QUEEN: queen,
        chess.KING: king,
    }


PST = _piece_square_tables()


def _sq_index(square: chess.Square) -> int:
    # chess.Square is 0..63 with A1=0. Convert to row-major for WHITE tables.
    file = chess.square_file(square)
    rank = chess.square_rank(square)
    return rank * 8 + file


def _mirror_index(idx: int) -> int:
    # Mirror ranks for BLACK pieces: rank r -> 7-r.
    row = idx // 8
    col = idx % 8
    mirrored_row = 7 - row
    return mirrored_row * 8 + col


def evaluate_chess(board: chess.Board) -> int:
    # Positive means advantage for the side to move (for negamax we apply sign).
    if board.is_checkmate():
        # If side to move is checkmated, it's losing.
        return -250000

    if board.is_stalemate() or board.is_insufficient_material():
        return 0

    # Base evaluation from WHITE's perspective.
    score = 0

    for piece_type, val in MATERIAL.items():
        white_count = len(board.pieces(piece_type, chess.WHITE))
        black_count = len(board.pieces(piece_type, chess.BLACK))
        score += val * (white_count - black_count)

    # Piece-square tables
    for color in [chess.WHITE, chess.BLACK]:
        sign = 1 if color == chess.WHITE else -1
        for piece_type in [chess.PAWN, chess.KNIGHT, chess.BISHOP, chess.ROOK, chess.QUEEN, chess.KING]:
            for sq in board.pieces(piece_type, color):
                idx = _sq_index(sq)
                if color == chess.BLACK:
                    idx = _mirror_index(idx)
                score += sign * PST[piece_type][idx]

    # Mobility (legal move count)
    mobility = board.legal_moves.count()
    score += (mobility - 28) * 2

    # King safety: pawn shield around king
    for color in [chess.WHITE, chess.BLACK]:
        king_sq = board.king(color)
        if king_sq is None:
            continue
        kf = chess.square_file(king_sq)
        kr = chess.square_rank(king_sq)
        shield = 0
        for df in (-1, 0, 1):
            for dr in (-1, 0, 1):
                nf = kf + df
                nr = kr + dr if color == chess.WHITE else kr - dr
                if 0 <= nf < 8 and 0 <= nr < 8:
                    nsq = chess.square(nf, nr)
                    if board.piece_at(nsq) == chess.Piece(chess.PAWN, color):
                        shield += 1
        # Encourage more shield in midgame.
        score += (shield - 3) * (8 if color == chess.WHITE else -8)

    # Convert to side-to-move perspective.
    return score if board.turn == chess.WHITE else -score


EXACT = 0
LOWER = 1
UPPER = 2


@dataclass
class TTEntry:
    depth: int
    flag: int
    value: int
    best_move: Optional[chess.Move]


def _capture_score(board: chess.Board, move: chess.Move) -> int:
    promo = move.promotion
    if promo is not None:
        return 10000 + MATERIAL.get(promo, 0)

    captured = board.piece_at(move.to_square)
    if captured is None and board.is_en_passant(move):
        captured_type = chess.PAWN
    elif captured is not None:
        captured_type = captured.piece_type
    else:
        return 0

    return 1000 + MATERIAL.get(captured_type, 0)


def order_moves(board: chess.Board, tt_best: Optional[chess.Move], history: Dict[str, int]) -> List[chess.Move]:
    moves = list(board.legal_moves)
    scored: List[Tuple[int, chess.Move]] = []
    for mv in moves:
        score = history.get(mv.uci(), 0)
        if tt_best is not None and mv == tt_best:
            score += 100000
        score += _capture_score(board, mv)
        if board.gives_check(mv):
            score += 250
        scored.append((score, mv))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [m for _, m in scored]


def alpha_beta_negamax(
    board: chess.Board,
    depth: int,
    alpha: int,
    beta: int,
    end_time: float,
    tt: Dict[int, TTEntry],
    nodes_counter: List[int],
    history: Dict[str, int],
) -> Tuple[int, Optional[chess.Move], List[chess.Move]]:
    if time.monotonic() >= end_time:
        raise TimeoutError()

    nodes_counter[0] += 1

    if depth <= 0:
        # Quiescence: only capture moves at leaf nodes.
        return quiescence(board, alpha, beta, end_time, tt, nodes_counter), None, []

    if board.is_checkmate():
        return -250000 + (3 - depth), None, []
    if board.is_stalemate():
        return 0, None, []

    # python-chess versions expose Zobrist hashing via chess.polyglot.
    key = chess.polyglot.zobrist_hash(board)
    entry = tt.get(key)
    if entry is not None and entry.depth >= depth:
        if entry.flag == EXACT:
            return entry.value, entry.best_move, [entry.best_move] if entry.best_move else []
        if entry.flag == LOWER:
            alpha = max(alpha, entry.value)
        elif entry.flag == UPPER:
            beta = min(beta, entry.value)
        if alpha >= beta:
            return entry.value, entry.best_move, [entry.best_move] if entry.best_move else []

    alpha_orig = alpha
    best_value = -10**9
    best_move: Optional[chess.Move] = None
    best_line: List[chess.Move] = []

    tt_best = entry.best_move if entry is not None else None
    moves = order_moves(board, tt_best, history)

    for mv in moves:
        board.push(mv)
        try:
            value, _, line = alpha_beta_negamax(
                board, depth - 1, -beta, -alpha, end_time, tt, nodes_counter, history
            )
            value = -value
        finally:
            board.pop()

        if value > best_value:
            best_value = value
            best_move = mv
            best_line = [mv] + (line if line else [])

        alpha = max(alpha, value)
        if alpha >= beta:
            # Killer/history update on cutoff
            history[mv.uci()] = history.get(mv.uci(), 0) + depth * depth
            break

    # Store in TT
    flag = EXACT
    if best_value <= alpha_orig:
        flag = UPPER
    elif best_value >= beta:
        flag = LOWER
    tt[key] = TTEntry(depth=depth, flag=flag, value=best_value, best_move=best_move)
    return best_value, best_move, best_line


def quiescence(
    board: chess.Board,
    alpha: int,
    beta: int,
    end_time: float,
    tt: Dict[int, TTEntry],
    nodes_counter: List[int],
) -> int:
    if time.monotonic() >= end_time:
        raise TimeoutError()

    nodes_counter[0] += 1

    stand_pat = evaluate_chess(board)
    if stand_pat >= beta:
        return beta
    if alpha < stand_pat:
        alpha = stand_pat

    # Explore only captures/check moves for stability.
    moves = []
    for mv in board.legal_moves:
        if board.is_capture(mv) or board.gives_check(mv) or mv.promotion is not None:
            moves.append(mv)
    moves.sort(key=lambda m: _capture_score(board, m), reverse=True)

    for mv in moves:
        board.push(mv)
        try:
            score = -quiescence(board, -beta, -alpha, end_time, tt, nodes_counter)
        finally:
            board.pop()

        if score >= beta:
            return beta
        if score > alpha:
            alpha = score
    return alpha


def pick_depth(difficulty: Difficulty, time_ms: int, board: chess.Board) -> int:
    # Empirical safe defaults. Iterative deepening stops early if time runs out.
    legal = max(1, board.legal_moves.count())
    branching = legal / 30.0

    if difficulty == "medium":
        base = 4
    elif difficulty == "hard":
        base = 6
    elif difficulty == "god":
        base = 7
    else:
        base = 5

    # Higher branching -> lower depth to stay within time.
    depth = int(max(2, min(8, base - max(0, branching - 1) * 2)))
    return depth


def best_move_chess(fen: str, difficulty: Difficulty, time_ms: int) -> MoveResponse:
    try:
        board = chess.Board(fen)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid FEN: {e}")

    if board.turn not in [chess.WHITE, chess.BLACK]:
        raise HTTPException(status_code=400, detail="Invalid side to move")

    # Time control
    end_time = time.monotonic() + time_ms / 1000.0

    tt: Dict[int, TTEntry] = {}
    history: Dict[str, int] = {}
    nodes_counter = [0]

    max_depth = pick_depth(difficulty, time_ms, board)
    best_mv: Optional[chess.Move] = None
    best_score = 0
    best_line: List[chess.Move] = []
    reached_depth = 0

    # Iterative deepening
    for depth in range(1, max_depth + 1):
        if time.monotonic() >= end_time:
            break
        reached_depth = depth
        try:
            score, mv, line = alpha_beta_negamax(
                board, depth, -10**9, 10**9, end_time, tt, nodes_counter, history
            )
            if mv is not None:
                best_mv = mv
                best_score = score
                best_line = line
        except TimeoutError:
            break

    if best_mv is None:
        # Fallback: pick any legal move.
        best_mv = next(iter(board.legal_moves))

    pv_uci = [m.uci() for m in best_line[:6]]
    return MoveResponse(move=best_mv.uci(), depth=reached_depth, nodes=nodes_counter[0], score=float(best_score), pv=pv_uci)


# ---------------------------
# Baduk (Go) MVP minimax
# ---------------------------


def _go_zobrist(size: int, seed: int = 1337) -> Dict[Tuple[int, int], int]:
    rng = random.Random(seed + size)
    table: Dict[Tuple[int, int], int] = {}
    # color_index: 0 black, 1 white
    for idx in range(size * size):
        for color_idx in [0, 1]:
            table[(idx, color_idx)] = rng.getrandbits(64)
    table[(-1, 2)] = rng.getrandbits(64)  # to_play toggle
    return table


def go_hash(board: List[int], size: int, to_play: int, table: Dict[Tuple[int, int], int]) -> int:
    h = 0
    for idx, v in enumerate(board):
        if v == 0:
            continue
        color_idx = 0 if v == 1 else 1
        h ^= table[(idx, color_idx)]
    if to_play == -1:
        h ^= table[(-1, 2)]
    return h


DIRS = [(-1, 0), (1, 0), (0, -1), (0, 1)]


def go_neighbors(idx: int, size: int) -> List[int]:
    r = idx // size
    c = idx % size
    out = []
    for dr, dc in DIRS:
        nr, nc = r + dr, c + dc
        if 0 <= nr < size and 0 <= nc < size:
            out.append(nr * size + nc)
    return out


def go_group(board: List[int], size: int, start: int) -> Tuple[List[int], int]:
    color = board[start]
    visited = {start}
    stack = [start]
    group = []
    liberties = 0
    while stack:
        cur = stack.pop()
        group.append(cur)
        for nb in go_neighbors(cur, size):
            v = board[nb]
            if v == 0:
                liberties += 1
            elif v == color and nb not in visited:
                visited.add(nb)
                stack.append(nb)
    return group, liberties


def go_is_legal(board: List[int], size: int, move: Optional[int], to_play: int) -> bool:
    # move=None means PASS
    if move is None:
        return True
    if board[move] != 0:
        return False

    next_board = board[:]
    next_board[move] = to_play

    # Check self-capture (suicide) after captures.
    for nb in go_neighbors(move, size):
        if next_board[nb] == -to_play:
            grp, libs = go_group(next_board, size, nb)
            if libs == 0:
                for s in grp:
                    next_board[s] = 0

    # Now the placed stone's group must have liberties.
    grp, libs = go_group(next_board, size, move)
    return libs > 0


def go_apply_move(board: List[int], size: int, move: Optional[int], to_play: int) -> List[int]:
    next_board = board[:]
    if move is None:
        return next_board

    next_board[move] = to_play

    # Capture opponent groups with no liberties
    for nb in go_neighbors(move, size):
        if next_board[nb] == -to_play:
            grp, libs = go_group(next_board, size, nb)
            if libs == 0:
                for s in grp:
                    next_board[s] = 0

    return next_board


def go_candidate_moves(board: List[int], size: int, to_play: int, max_candidates: int = 10) -> List[Optional[int]]:
    empties = [i for i, v in enumerate(board) if v == 0]
    scored: List[Tuple[int, int]] = []
    opponent = -to_play
    opponent_before = sum(1 for v in board if v == opponent)

    for mv in empties:
        if not go_is_legal(board, size, mv, to_play):
            continue

        # Lightweight impact scoring for pruning.
        impact = 0

        # Immediate captures (count opponent stones removed).
        temp = go_apply_move(board, size, mv, to_play)
        opponent_after = sum(1 for v in temp if v == opponent)
        captured = opponent_before - opponent_after
        impact += max(0, captured) * 20

        # Proximity to opponent stones
        prox = 0
        for nb in go_neighbors(mv, size):
            if board[nb] == -to_play:
                prox += 1
        impact += prox * 3

        scored.append((impact, mv))

    scored.sort(key=lambda x: x[0], reverse=True)
    top = [mv for _, mv in scored[:max_candidates]]
    # Always allow pass.
    return [None] + top


def evaluate_go(board: List[int], size: int, to_play: int, komi: float = 7.5) -> int:
    # Return positive for the side to move.
    black = sum(1 for v in board if v == 1)
    white = sum(1 for v in board if v == -1)

    # Simple territory approximation:
    # For each empty point, assign to color with more adjacent stones.
    territory_black = 0
    territory_white = 0
    for idx, v in enumerate(board):
        if v != 0:
            continue
        adj = [board[nb] for nb in go_neighbors(idx, size)]
        b = sum(1 for x in adj if x == 1)
        w = sum(1 for x in adj if x == -1)
        if b > w:
            territory_black += 1
        elif w > b:
            territory_white += 1

    # Mobility / pressure: count legal moves for current side
    mobility = 0
    for mv in range(size * size):
        if board[mv] == 0 and go_is_legal(board, size, mv, to_play):
            mobility += 1
    # Bonus for having the move
    mobility_bonus = min(30, mobility) * 3

    raw = (black - white) * 120 + (territory_black - territory_white) * 90
    # Komi: typically White gets compensation.
    raw -= komi * 60

    # Convert to to_play perspective.
    if to_play == -1:
        raw = -raw
    return int(raw + mobility_bonus)


def go_negamax(
    board: List[int],
    size: int,
    to_play: int,
    depth: int,
    alpha: int,
    beta: int,
    end_time: float,
    tt: Dict[int, Tuple[int, int]],
    nodes_counter: List[int],
    zobrist: Dict[Tuple[int, int], int],
    komi: float,
) -> int:
    if time.monotonic() >= end_time:
        raise TimeoutError()

    nodes_counter[0] += 1
    key = go_hash(board, size, to_play, zobrist)
    entry = tt.get(key)
    if entry is not None:
        stored_depth, stored_value = entry
        if stored_depth >= depth:
            return stored_value

    if depth <= 0:
        return evaluate_go(board, size, to_play, komi=komi)

    best = -10**12
    moves = go_candidate_moves(board, size, to_play, max_candidates=10)
    # Move ordering: prioritize non-pass moves by proximity/capture score order in candidate generator.
    # (pass is first) so swap to search best moves first.
    if len(moves) > 1:
        moves = moves[1:] + moves[:1]

    for mv in moves:
        if not go_is_legal(board, size, mv, to_play):
            continue
        next_board = go_apply_move(board, size, mv, to_play)
        score = -go_negamax(
            next_board,
            size,
            -to_play,
            depth - 1,
            -beta,
            -alpha,
            end_time,
            tt,
            nodes_counter,
            zobrist,
            komi,
        )

        best = max(best, score)
        alpha = max(alpha, score)
        if alpha >= beta:
            break

    tt[key] = (depth, best)
    return best


def best_move_baduk(req: MoveRequest) -> MoveResponse:
    if req.board is None or req.to_play is None:
        raise HTTPException(status_code=400, detail="Missing baduk board/to_play")

    size = req.size
    if len(req.board) != size * size:
        raise HTTPException(status_code=400, detail="Invalid baduk board length")

    board = req.board
    to_play = 1 if req.to_play == "black" else -1

    end_time = time.monotonic() + req.time_ms / 1000.0
    zobrist = _go_zobrist(size)
    tt: Dict[int, Tuple[int, int]] = {}
    nodes_counter = [0]

    if req.difficulty == "medium":
        max_depth = 2
        max_candidates = 10
    elif req.difficulty == "hard":
        max_depth = 3
        max_candidates = 10
    elif req.difficulty == "god":
        max_depth = 4
        max_candidates = 14
    else:
        max_depth = 3
        max_candidates = 10

    best_mv: Optional[int] = None
    best_score = -10**12
    reached_depth = 0

    # Iterative deepening
    for depth in range(1, max_depth + 1):
        if time.monotonic() >= end_time:
            break
        reached_depth = depth
        try:
            best_this_depth: Optional[int] = None
            best_this_score = -10**12
            moves = go_candidate_moves(board, size, to_play, max_candidates=max_candidates)
            if len(moves) > 1:
                moves = moves[1:] + moves[:1]

            alpha = -10**12
            beta = 10**12

            for mv in moves:
                if not go_is_legal(board, size, mv, to_play):
                    continue
                next_board = go_apply_move(board, size, mv, to_play)
                score = -go_negamax(
                    next_board,
                    size,
                    -to_play,
                    depth - 1,
                    -beta,
                    -alpha,
                    end_time,
                    tt,
                    nodes_counter,
                    zobrist,
                    req.komi,
                )
                if score > best_this_score:
                    best_this_score = score
                    best_this_depth = mv
                alpha = max(alpha, score)
                if alpha >= beta:
                    break

            if best_this_depth is not None:
                best_mv = best_this_depth
                best_score = best_this_score
        except TimeoutError:
            break

    # Encode move.
    if best_mv is None:
        move_str = "pass"
    else:
        r = best_mv // size
        c = best_mv % size
        move_str = f"{r},{c}"

    return MoveResponse(
        move=move_str,
        depth=reached_depth,
        nodes=nodes_counter[0],
        score=float(best_score),
        pv=[],
    )


@app.get("/health")
def health() -> Dict[str, str]:
    """Used by Red Gambit `GET /api/engine/health` when BADUK_GOD_HEALTH_URL is derived from /move."""
    return {"status": "ok"}


@app.post("/move", response_model=MoveResponse)
def move(req: MoveRequest) -> MoveResponse:
    if req.game == "chess":
        if not req.fen:
            raise HTTPException(status_code=400, detail="Missing fen for chess")
        return best_move_chess(req.fen, req.difficulty, req.time_ms)

    if req.game == "baduk":
        return best_move_baduk(req)

    raise HTTPException(status_code=400, detail="Unsupported game type")

