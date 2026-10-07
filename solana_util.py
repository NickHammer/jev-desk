"""Small Solana helpers with no dependencies.

is_on_curve() is how we tell real wallets from pools: a normal wallet address is a point
on the ed25519 curve, while pools, bonding curves and lockers are program-derived
addresses (PDAs), which are deliberately OFF the curve. The guide's top-wallet check
counted the liquidity pool as a "whale" and would have rejected nearly every token.
"""

_B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
_P = 2**255 - 19
_D = (-121665 * pow(121666, _P - 2, _P)) % _P


def b58decode(s: str) -> bytes:
    n = 0
    for ch in s:
        n = n * 58 + _B58.index(ch)
    raw = n.to_bytes((n.bit_length() + 7) // 8, "big") if n else b""
    pad = len(s) - len(s.lstrip("1"))
    return b"\x00" * pad + raw


def is_on_curve(address: str) -> bool:
    """True for regular wallets, False for PDAs (pools, curves, vaults, lockers)."""
    try:
        b = b58decode(address)
    except ValueError:
        return False
    if len(b) != 32:
        return False
    y = int.from_bytes(b, "little")
    sign = y >> 255
    y &= (1 << 255) - 1
    if y >= _P:
        return False
    y2 = y * y % _P
    u = (y2 - 1) % _P
    v = (_D * y2 + 1) % _P
    x2 = u * pow(v, _P - 2, _P) % _P
    if x2 == 0:
        return sign == 0
    return pow(x2, (_P - 1) // 2, _P) == 1      # x^2 must be a quadratic residue
