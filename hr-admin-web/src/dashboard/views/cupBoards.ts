// The Odd One Out boards of a tournament match, for the TV to draw what each
// player has in front of them. A copy of the seeded-boards block of
// backend/game-pages/cup/play.js (itself from game-pages/odd-one-out.html):
// the same logic, with only type annotations added, so board g of a seed here is
// board g of that seed on the player's phone. Change one, change both.

export interface Board {
  /** n × n tiles. */
  n: number;
  base: string;
  odd: string;
  /** The odd tile is the base mirrored. */
  flip: boolean;
  /** Index of the odd tile. */
  at: number;
}

/* seeded-boards:start
   Everything a board depends on, and nothing else: board g of a round is a pure function of (seed, g), so two players given one seed see the same
   boards in the same order whatever they tap. A solo round takes a random seed; a challenge takes the server's. The Sowaka backend's check script
   (src/scripts/game-challenge-check.ts) runs this block on its own, so keep it free of anything outside it. */
const EASY: [string, string][]=[['🐶','🐱'],['🍎','🍌'],['⭐','🌙'],['🚗','🚲'],['🌵','🌸'],['🐸','🐷'],['🍕','🍩'],['⚽','🎈'],['🐧','🦊'],['☕','🍦']];
const MED: [string, string][]=[['🙂','🙃'],['🍊','🍑'],['🐭','🐹'],['🐻','🐨'],['🌲','🌳'],['👍','👎'],['🔒','🔓'],['🍋','🍐'],['🐯','🦁'],['🌞','🌝'],['🚕','🚗'],['👈','👉'],['🐰','🐭'],['🍓','🍒']];
const HARD: [string, string][]=[['😀','😃'],['😐','😑'],['🕐','🕑'],['🌖','🌔'],['😮','😯'],['🔈','🔉'],['🙈','🙉'],['😺','😸'],['📪','📫'],['😛','😝'],['🕒','🕘'],['🌗','🌓'],['😄','😁'],['🐵','🙊']];
const MIRROR: string[]=['🐟','🦆','🐕','🚀','🐌','🦖','🏃','🐘','🚜','🦄','🐊','🐿'];
export const sizeFor=(g: number)=>g<3?2:g<7?3:g<13?4:g<21?5:6;
function rng(a: number){ return ()=>{ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
export function boardAt(sd: number,g: number): Board{
  const r=rng(sd*7919+g*104729+13), n=sizeFor(g), pick=<T,>(a: T[]): T=>a[Math.floor(r()*a.length)];
  const roll=r(); let tier=g<4?'e':g<10?(roll<.5?'e':'m'):g<18?(roll<.5?'m':'h'):(roll<.45?'h':roll<.75?'x':'m');
  let base: string,odd: string,flip=false;
  if(tier==='x'){ base=odd=pick(MIRROR); flip=true; } else { const p=pick(tier==='e'?EASY:tier==='m'?MED:HARD); const sw=r()<.5; base=sw?p[1]:p[0]; odd=sw?p[0]:p[1]; }
  return {n,base,odd,flip,at:Math.floor(r()*n*n)};
}
/* seeded-boards:end */
