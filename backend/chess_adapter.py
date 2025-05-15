"""
Convert between your 8×8-array representation (e.g. 'P3', 'q', None)
and a python-chess `Board` so we can let the engine validate moves.
"""

import chess


def _sq_name(row: int, col: int) -> str:
    """(row 0-7, col 0-7) → algebraic square name like 'a8'."""
    return f"{chr(col + 97)}{8 - row}"


# ─────────────────────────── array  →  Board ────────────────────────────
def arr_to_board(arr, *, turn: str,
                 castling_rights, ep_target):
    """
    Build a `chess.Board` from:
        • arr              – 8×8 list (DB format)
        • turn             – 'White' | 'Black'
        • castling_rights  – {White:{K:bool,Q:bool}, Black:{K:bool,Q:bool}}
        • ep_target        – [row,col] | None
    """
    fen_rows = []
    for r in range(8):
        empty = 0
        row_fen = ""
        for c in range(8):
            cell = arr[r][c]
            if cell:
                if empty:
                    row_fen += str(empty)
                    empty = 0
                row_fen += cell[0]        # save only the letter
            else:
                empty += 1
        if empty:
            row_fen += str(empty)
        fen_rows.append(row_fen)

    pieces_part = "/".join(fen_rows)
    active_part = "w" if turn == "White" else "b"

    cr = castling_rights
    castling_part = (
        ("K" if cr["White"]["K"] else "") +
        ("Q" if cr["White"]["Q"] else "") +
        ("k" if cr["Black"]["K"] else "") +
        ("q" if cr["Black"]["Q"] else "")
    ) or "-"

    ep_part = _sq_name(ep_target[0], ep_target[1]) if ep_target else "-"

    # half-move + move counters not used by the app – leave 0 1
    fen = f"{pieces_part} {active_part} {castling_part} {ep_part} 0 1"
    return chess.Board(fen)


# ─────────────────────────── Board →  array ─────────────────────────────
def board_to_arr(board: chess.Board, prev_arr):
    """Convert python-chess Board back to 8×8 list **without shuffling IDs**."""
    new_arr = [[None for _ in range(8)] for _ in range(8)]

    # ----- first keep every piece that stayed on the same square -----
    used_ids = set()
    for sq in chess.SQUARES:
        piece = board.piece_at(sq)
        if not piece:
            continue
        r, c = 7 - sq // 8, sq % 8
        prev_id = prev_arr[r][c]
        if prev_id and prev_id[0] == piece.symbol():
            new_arr[r][c] = prev_id
            used_ids.add(prev_id)

    # pool of **unused** IDs, keyed by letter
    pool = {}
    for row in prev_arr:
        for cell in row:
            if cell and cell not in used_ids:
                pool.setdefault(cell[0], []).append(cell)

    # ----- fill remaining squares -----
    for sq in chess.SQUARES:
        piece = board.piece_at(sq)
        if not piece:
            continue
        r, c = 7 - sq // 8, sq % 8
        if new_arr[r][c]:
            continue                    # already assigned above
        letter = piece.symbol()
        lst = pool.get(letter, [])
        new_arr[r][c] = lst.pop(0) if lst else letter  # fall-back: bare letter

    return new_arr 