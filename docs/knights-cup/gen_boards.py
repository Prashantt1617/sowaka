"""Kings/Meow puzzle generator: n×n grid, n colour regions; one piece per row, column and region,
no two pieces touching (diagonals included). Keeps only puzzles with exactly one solution."""
import json, random, sys, time


def solutions(n, g, limit=2):
    """Count solutions (up to `limit`) row by row."""
    found = []
    cols, regs = [False] * n, [False] * n

    def go(r, prev_c, picks):
        if len(found) >= limit:
            return
        if r == n:
            found.append(list(picks))
            return
        for c in range(n):
            if cols[c] or regs[g[r * n + c]]:
                continue
            if prev_c is not None and abs(prev_c - c) <= 1:
                continue
            cols[c] = regs[g[r * n + c]] = True
            picks.append(r * n + c)
            go(r + 1, c, picks)
            picks.pop()
            cols[c] = regs[g[r * n + c]] = False

    go(0, None, [])
    return found


def random_solution(n):
    """A random placement: one per row and column, none touching."""
    for _ in range(10000):
        cols, ok = [], True
        for r in range(n):
            choices = [c for c in range(n) if c not in cols and (not cols or abs(cols[-1] - c) > 1)]
            if not choices:
                ok = False
                break
            cols.append(random.choice(choices))
        if ok:
            return [r * n + c for r, c in enumerate(cols)]
    raise RuntimeError('no placement')


def grow_regions(n, seeds):
    """Grow n regions out from the solution cells, randomly, until the grid is full."""
    g = [-1] * (n * n)
    for k, s in enumerate(seeds):
        g[s] = k
    frontier = list(seeds)
    while -1 in g:
        cell = random.choice(frontier)
        r, c = divmod(cell, n)
        nbrs = [(r + dr) * n + (c + dc) for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1))
                if 0 <= r + dr < n and 0 <= c + dc < n and g[(r + dr) * n + (c + dc)] == -1]
        if not nbrs:
            frontier.remove(cell)
            continue
        nxt = random.choice(nbrs)
        g[nxt] = g[cell]
        frontier.append(nxt)
    return g


def make(n, tries=4000):
    for _ in range(tries):
        sol = random_solution(n)
        g = grow_regions(n, sol)
        found = solutions(n, g)
        if len(found) == 1 and sorted(found[0]) == sorted(sol):
            return {'n': n, 'g': g, 's': sorted(sol)}
    return None


if __name__ == '__main__':
    n, count = int(sys.argv[1]), int(sys.argv[2])
    random.seed(int(sys.argv[3]) if len(sys.argv) > 3 else None)
    out, t = [], time.time()
    while len(out) < count:
        p = make(n)
        if p:
            out.append(p)
    print(json.dumps(out))
    print(f'{count} unique {n}x{n} in {time.time() - t:.1f}s', file=sys.stderr)
