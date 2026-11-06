/**
 * Sowaka Pool: the table, the physics and the 8-ball rules, shared by the server
 * (the referee of a live room) and the page (the animation). Pure and
 * deterministic: no I/O, no Math.random, a fixed time step, so the same shot
 * from the same positions gives the same result everywhere.
 *
 * World: a 7-ft table's playing area, 78 x 39 in, as 2 x 1 (x along the
 * length, the foot spot at x = 1.5); a 2.25 in ball; pockets at the corners
 * and the long sides. A ball "drops" within a pocket's capture radius of its
 * centre, or past the table's edge inside a pocket mouth (the jaws).
 */

export interface Ball { n: number; x: number; y: number; vx: number; vy: number; on: boolean }
export interface Shot { aim: number; power: number; spin: { top: number; side: number } }
export type ShotEvent =
  | { t: 'hit'; a: number; b: number; v: number }
  | { t: 'cushion'; n: number; v: number }
  | { t: 'pocket'; n: number; p: number }
  | { t: 'scratch'; p: number };
export interface Pocket { i: number; x: number; y: number; r: number; side: boolean }

export const L = 2;
export const W = 1;
export const R = 1.125 / 39;
export const CORNER = 0.058;
export const SIDE = 0.054;
export const MOUTH = 0.074;
export const FOOT = { x: 1.5, y: 0.5 };
export const HEAD_X = 0.5;
export const FRICTION = 0.62;
export const VMAX = 4.6;
export const E_BALL = 0.96;
export const E_CUSHION = 0.78;
export const DT = 1 / 240;
export const MAX_STEPS = 240 * 40; // 40 s of motion at most

export const POCKETS: Pocket[] = [
  { x: 0, y: 0 }, { x: 1, y: -0.012 }, { x: 2, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1.012 }, { x: 2, y: 1 },
].map((p, i) => ({ ...p, i, r: i === 1 || i === 4 ? SIDE : CORNER, side: i === 1 || i === 4 }));

export const isStripe = (n: number) => n >= 9;
export const groupOf = (n: number): 'solid' | 'stripe' | null => (n === 0 || n === 8 ? null : isStripe(n) ? 'stripe' : 'solid');

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/** The opening rack: the 8 in the middle, a solid and a stripe at the back corners, the cue ball in the kitchen. */
export function rack(): Ball[] {
  const order = [1, 9, 2, 10, 8, 3, 11, 4, 12, 5, 13, 6, 14, 7, 15];
  const balls: Ball[] = [];
  let k = 0;
  const d = R * 2.02, h = (d * Math.sqrt(3)) / 2;
  for (let row = 0; row < 5; row++) for (let i = 0; i <= row; i++) {
    const n = order[k++];
    balls.push({ n, x: FOOT.x + row * h, y: FOOT.y - (row * d) / 2 + i * d, vx: 0, vy: 0, on: true });
  }
  balls.unshift({ n: 0, x: HEAD_X - 0.1, y: 0.5, vx: 0, vy: 0, on: true });
  return balls;
}

interface SpinState { top: number; side: number; dirx: number; diry: number; used: boolean }

function sideSpin(spin: SpinState, b: Ball, nx: number, ny: number) {
  const s = spin.side;
  if (Math.abs(s) < 0.02) return;
  const vn = Math.abs(nx ? b.vx : b.vy);
  const tx = -ny, ty = nx;
  const k = s * 0.55 * vn;
  b.vx += tx * k; b.vy += ty * k;
  spin.side *= 0.45;
}

/** One fixed step of the table. Returns true when every ball has stopped. */
export function step(balls: Ball[], spin: SpinState | null, ev: ShotEvent[], dt: number): boolean {
  const B = balls.filter((b) => b.on);
  let maxv = 0;
  for (const b of B) maxv = Math.max(maxv, Math.hypot(b.vx, b.vy));
  const n = Math.max(1, Math.ceil((maxv * dt) / (R * 0.45)));
  const h = dt / n;
  for (let s = 0; s < n; s++) {
    for (const b of B) {
      if (!b.on) continue;
      b.x += b.vx * h; b.y += b.vy * h;
      const v = Math.hypot(b.vx, b.vy);
      if (v > 0) {
        const nv = Math.max(0, v - FRICTION * h - v * 0.09 * h);
        const k = nv / v;
        b.vx *= k; b.vy *= k;
        if (nv < 0.012) { b.vx = 0; b.vy = 0; }
      }
    }
    // cushions (not inside a pocket mouth)
    for (const b of B) {
      if (!b.on) continue;
      let nearPocket = false;
      for (const p of POCKETS) if (Math.hypot(b.x - p.x, b.y - p.y) < MOUTH) { nearPocket = true; break; }
      if (nearPocket) continue;
      let bounced = 0;
      if (b.x < R && b.vx < 0) { b.x = R; b.vx = -b.vx * E_CUSHION; bounced = Math.abs(b.vx); if (b.n === 0 && spin) sideSpin(spin, b, 1, 0); }
      else if (b.x > L - R && b.vx > 0) { b.x = L - R; b.vx = -b.vx * E_CUSHION; bounced = Math.abs(b.vx); if (b.n === 0 && spin) sideSpin(spin, b, -1, 0); }
      if (b.y < R && b.vy < 0) { b.y = R; b.vy = -b.vy * E_CUSHION; bounced = Math.abs(b.vy); if (b.n === 0 && spin) sideSpin(spin, b, 0, 1); }
      else if (b.y > W - R && b.vy > 0) { b.y = W - R; b.vy = -b.vy * E_CUSHION; bounced = Math.abs(b.vy); if (b.n === 0 && spin) sideSpin(spin, b, 0, -1); }
      if (bounced > 0.05) ev.push({ t: 'cushion', n: b.n, v: bounced });
    }
    // ball on ball
    for (let i = 0; i < B.length; i++) {
      const a = B[i];
      if (!a.on) continue;
      for (let j = i + 1; j < B.length; j++) {
        const c = B[j];
        if (!c.on) continue;
        const dx = c.x - a.x, dy = c.y - a.y, d = Math.hypot(dx, dy);
        if (d >= 2 * R || d === 0) continue;
        const nx = dx / d, ny = dy / d, overlap = 2 * R - d;
        a.x -= (nx * overlap) / 2; a.y -= (ny * overlap) / 2; c.x += (nx * overlap) / 2; c.y += (ny * overlap) / 2;
        const rel = (a.vx - c.vx) * nx + (a.vy - c.vy) * ny;
        if (rel <= 0) continue;
        const jn = (rel * (1 + E_BALL)) / 2;
        a.vx -= jn * nx; a.vy -= jn * ny; c.vx += jn * nx; c.vy += jn * ny;
        ev.push({ t: 'hit', a: a.n, b: c.n, v: rel });
        // follow or draw on the cue ball's first contact: a push along its old line
        const cue = a.n === 0 ? a : c.n === 0 ? c : null;
        if (cue && spin && !spin.used) {
          spin.used = true;
          if (Math.abs(spin.top) > 0.02) { const k = spin.top * 0.42 * rel; cue.vx += spin.dirx * k; cue.vy += spin.diry * k; }
        }
      }
    }
    // pockets: within the capture radius, or past the edge inside a mouth (the jaws)
    for (const b of B) {
      if (!b.on) continue;
      for (const p of POCKETS) {
        const d = Math.hypot(b.x - p.x, b.y - p.y);
        const past = b.x < 0 || b.x > L || b.y < 0 || b.y > W;
        if (d < p.r || (d < MOUTH + R && past)) {
          b.on = false; b.vx = 0; b.vy = 0;
          ev.push(b.n === 0 ? { t: 'scratch', p: p.i } : { t: 'pocket', n: b.n, p: p.i });
          break;
        }
      }
      if (b.on && (b.x < -R || b.x > L + R || b.y < -R || b.y > W + R)) {
        b.x = clamp(b.x, R, L - R); b.y = clamp(b.y, R, W - R); b.vx *= -0.3; b.vy *= -0.3;
      }
    }
  }
  for (const b of B) if (b.on && (b.vx !== 0 || b.vy !== 0)) return false;
  return true;
}

export const copyBalls = (balls: Ball[]): Ball[] => balls.map((b) => ({ n: b.n, x: b.x, y: b.y, vx: b.vx, vy: b.vy, on: b.on }));

/** A whole shot from rest to rest. The input is not changed. */
export function simulateShot(balls: Ball[], shot: Shot): { balls: Ball[]; events: ShotEvent[]; steps: number } {
  const out = copyBalls(balls);
  const cue = out.find((b) => b.n === 0);
  const events: ShotEvent[] = [];
  if (!cue || !cue.on) return { balls: out, events, steps: 0 };
  const power = clamp(Number(shot.power) || 0, 0, 1);
  const dx = Math.cos(shot.aim), dy = Math.sin(shot.aim);
  const v = VMAX * (0.18 + 0.82 * power);
  cue.vx = dx * v; cue.vy = dy * v;
  const spin: SpinState = { top: clamp(Number(shot.spin?.top) || 0, -1, 1), side: clamp(Number(shot.spin?.side) || 0, -1, 1), dirx: dx, diry: dy, used: false };
  let steps = 0;
  while (steps < MAX_STEPS) { steps += 1; if (step(out, spin, events, DT)) break; }
  for (const b of out) { b.vx = 0; b.vy = 0; }
  return { balls: out, events, steps };
}

// ---------------------------------------------------------------- rules

export type Group = 'solid' | 'stripe' | null;
export interface RuleState {
  balls: Ball[];
  turn: 0 | 1;
  groups: [Group, Group];
  open: boolean;
  inHand: boolean;
  kitchen: boolean;
  breakShot: boolean;
  calledPocket: number | null;
}
export interface RuleOutcome {
  foul: string | null;
  keepTurn: boolean;
  winner: 0 | 1 | null;
  potted: number[];
  message: string | null;
  next: RuleState;
}

export const remaining = (balls: Ball[], group: Group) => balls.filter((b) => b.on && groupOf(b.n) === group).length;
export const onEight = (st: RuleState, i: 0 | 1) => !!st.groups[i] && remaining(st.balls, st.groups[i]) === 0;

/** Puts a ball back on its spot (the 8) or in the kitchen (the cue ball), nudged along the line if the spot is taken. */
export function respot(balls: Ball[], n: number): void {
  const b = balls.find((x) => x.n === n);
  if (!b) return;
  b.on = true; b.vx = 0; b.vy = 0;
  let x = n === 0 ? HEAD_X - 0.1 : FOOT.x;
  const y = 0.5;
  for (let k = 0; k < 40 && balls.some((o) => o.on && o !== b && Math.hypot(o.x - x, o.y - y) < 2 * R + 0.002); k++) x += n === 0 ? -0.03 : 0.03;
  b.x = clamp(x, R, L - R); b.y = y;
}

/** Whether the cue ball may be placed here with ball in hand. */
export function placementOk(balls: Ball[], x: number, y: number, kitchen: boolean): boolean {
  if (!(x >= R && x <= (kitchen ? HEAD_X - R : L - R) && y >= R && y <= W - R)) return false;
  return !balls.some((b) => b.on && b.n !== 0 && Math.hypot(b.x - x, b.y - y) < 2 * R + 0.001);
}

/**
 * The 8-ball rules on a finished shot. `after` is the table after the shot;
 * the state's balls are replaced by it. Fouls give the other player ball in
 * hand (behind the head string after a break foul). The 8 on the break is
 * spotted; otherwise the 8 decides the game: legal in the called pocket wins,
 * anything else loses.
 */
export function resolve(st: RuleState, after: Ball[], events: ShotEvent[]): RuleOutcome {
  const i = st.turn, opp = (1 - i) as 0 | 1;
  const balls = copyBalls(after);
  let firstHit: number | null = null, cushions = 0, scratch = false;
  const rails = new Set<number>();
  const pocketed: number[] = [];
  let eightIn: number | null = null;
  let contact = false;
  for (const e of events) {
    if (e.t === 'hit') { if (firstHit == null && (e.a === 0 || e.b === 0)) { firstHit = e.a === 0 ? e.b : e.a; contact = true; } }
    else if (e.t === 'cushion') { if (contact || st.breakShot) cushions += 1; rails.add(e.n); }
    else if (e.t === 'pocket') { pocketed.push(e.n); if (e.n === 8) eightIn = e.p; }
    else if (e.t === 'scratch') scratch = true;
  }
  let foul: string | null = null, keep = false, winner: 0 | 1 | null = null, message: string | null = null;
  const pot = pocketed.filter((n) => n !== 8);
  const eight = pocketed.includes(8);
  if (st.breakShot && eight) { respot(balls, 8); message = 'The 8 went in on the break: it is back on its spot'; }
  const mine = st.groups[i];
  if (scratch) foul = 'Scratch: the cue ball went in';
  else if (firstHit == null) foul = 'Foul: the cue ball hit nothing';
  else if (!st.breakShot) {
    const g = groupOf(firstHit);
    if (firstHit === 8 && !onEight(st, i)) foul = 'Foul: the 8 was hit first';
    else if (!st.open && mine && firstHit !== 8 && g !== mine) foul = `Foul: ${mine === 'solid' ? 'a stripe' : 'a solid'} was hit first`;
    else if (pot.length === 0 && !eight && cushions === 0) foul = 'Foul: no ball reached a cushion';
  } else if (pot.length === 0 && rails.size < 4) foul = 'Weak break: four balls must reach a cushion';
  if (!st.breakShot && eight) {
    if (foul || !onEight(st, i) || st.calledPocket == null || eightIn !== st.calledPocket) {
      winner = opp;
      foul = foul || (onEight(st, i) ? 'The 8 went in the wrong pocket' : 'The 8 went in too early');
    } else winner = i;
  }
  const groups: [Group, Group] = [st.groups[0], st.groups[1]];
  let open = st.open;
  if (!foul && open && pot.length && !st.breakShot) { // the table stays open after the break, whatever drops
    const firstPot = pot[0];
    groups[i] = groupOf(firstPot); groups[opp] = groups[i] === 'solid' ? 'stripe' : 'solid'; open = false;
    message = `${groups[i] === 'solid' ? 'Solids' : 'Stripes'} to the shooter`;
  }
  if (!foul) {
    const own = pot.filter((n) => groups[i] == null || groupOf(n) === groups[i]);
    if (own.length) keep = true;
    if (st.breakShot && pot.length) keep = true;
  }
  if (scratch) respot(balls, 0);
  const next: RuleState = {
    balls, turn: winner != null ? i : foul || !keep ? opp : i, groups, open,
    inHand: !!foul && winner == null, kitchen: !!foul && st.breakShot, breakShot: false, calledPocket: null,
  };
  return { foul, keepTurn: !foul && keep, winner, potted: pot, message: foul ?? message, next };
}
