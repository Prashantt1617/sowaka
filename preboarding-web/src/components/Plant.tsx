import type { PlantState } from '../api/types';

/**
 * The Plant (Kit · 6Zs §8.3). One component so the final 3D art swaps in here only.
 * Clay pot; stages 0 seed · 1 sprout · 2 seedling · 3 sapling · 4 bud · 5 bloom.
 * At stage 0 the water level 0–3 shows pre-boarding progress: wet soil and drops →
 * cracked seed → green tip. Overdue → droops (never red); the "Needs water" pill
 * is drawn by the component under the pot when `droop` is on.
 */
const STAGES = ['Seed', 'Sprout', 'Seedling', 'Sapling', 'Bud', 'Bloom'] as const;

export interface PlantProps {
  stage?: PlantState['stage'];
  water?: PlantState['water'];
  droop?: boolean;
  size?: number;
  sway?: boolean;
  /** Show the "Needs water" pill when drooping. */
  pill?: boolean;
  className?: string;
}

export function plantLabel(stage: number, water: number): string {
  return `Plant at ${STAGES[stage] ?? 'Seed'} stage${stage === 0 ? `, watered ${water} of 3` : ''}`;
}

const LEAF = 'M0 0 C 6 -10 18 -12 26 -6 C 18 2 8 4 0 0 Z';

export function Plant({ stage = 0, water = 0, droop = false, size = 120, sway = true, pill = true, className }: PlantProps) {
  const height = Math.round((size * 140) / 120);
  const s = Math.max(0, Math.min(5, stage));
  const w = s === 0 ? Math.max(0, Math.min(3, water)) : 3;
  const soil = s === 0 && w === 0 ? '#8B5A3C' : '#5E3A24';
  // stem height per stage (from the soil line at y=88)
  const stemTop = [88, 70, 58, 44, 34, 30][s];
  const droopTilt = droop ? 14 : 0;

  return (
    <div className={`plant ${className ?? ''}`} style={{ width: size }}>
      <svg
        width={size}
        height={height}
        viewBox="0 0 120 140"
        role="img"
        aria-label={plantLabel(s, w) + (droop ? ', needs water' : '')}
      >
        {/* shadow */}
        <ellipse cx="60" cy="134" rx="34" ry="4" fill="rgba(17,24,39,.08)" />
        {/* growth, swaying from the soil */}
        <g className={sway ? 'plant-sway' : undefined} style={{ transformOrigin: '60px 88px' }}>
          <g transform={`rotate(${droopTilt} 60 88)`}>
            {s >= 1 && (
              <path
                d={`M60 90 C ${droop ? 62 : 59} ${(90 + stemTop) / 2} ${droop ? 66 : 61} ${stemTop + 8} 60 ${stemTop}`}
                stroke="#2E9E4F"
                strokeWidth={s >= 3 ? 4 : 3}
                strokeLinecap="round"
                fill="none"
              />
            )}
            {s >= 1 && <Leaf x={60} y={stemTop + 6} angle={droop ? 40 : -20} scale={s === 1 ? 0.55 : 0.75} />}
            {s >= 1 && <Leaf x={60} y={stemTop + 6} angle={droop ? 140 : 200} scale={s === 1 ? 0.55 : 0.75} flip />}
            {s >= 2 && <Leaf x={60} y={stemTop + 22} angle={droop ? 30 : -10} scale={0.85} />}
            {s >= 2 && <Leaf x={60} y={stemTop + 22} angle={droop ? 150 : 190} scale={0.85} flip />}
            {s >= 3 && <Leaf x={60} y={stemTop + 38} angle={droop ? 25 : 0} scale={0.95} />}
            {s >= 3 && <Leaf x={60} y={stemTop + 36} angle={droop ? 155 : 180} scale={0.95} flip />}
            {s === 4 && (
              <g>
                <ellipse cx="60" cy={stemTop - 4} rx="6" ry="9" fill="#F28CA8" />
                <path d={`M54 ${stemTop} q6 6 12 0`} fill="#2E9E4F" />
              </g>
            )}
            {s === 5 && (
              <g>
                {[0, 72, 144, 216, 288].map((a) => (
                  <ellipse key={a} cx="60" cy={stemTop - 12} rx="6.5" ry="11" fill="#F28CA8" transform={`rotate(${a} 60 ${stemTop - 2})`} />
                ))}
                <circle cx="60" cy={stemTop - 2} r="5.5" fill="#FFC93C" />
              </g>
            )}
          </g>
        </g>
        {/* pot */}
        <path d="M30 92 L90 92 L83 130 Q82 133 79 133 L41 133 Q38 133 37 130 Z" fill="#C8693F" />
        <path d="M30 92 L90 92 L88.6 99 L31.4 99 Z" fill="#B45A33" opacity=".55" />
        <rect x="25" y="82" width="70" height="12" rx="4" fill="#D97A4E" />
        <rect x="25" y="82" width="70" height="4" rx="2" fill="#E89069" />
        {/* soil */}
        <ellipse cx="60" cy="86" rx="31" ry="4.2" fill={soil} />
        {w >= 1 && s === 0 && <ellipse cx="60" cy="86" rx="22" ry="2.6" fill="#4A2C1A" opacity=".6" />}
        {/* seed */}
        {s === 0 && (
          <g>
            <ellipse cx="60" cy="84" rx="7" ry="5" fill="#C9A26B" />
            <ellipse cx="58" cy="82.6" rx="2.6" ry="1.4" fill="#E2C493" />
            {w >= 2 && <path d="M58 80.5 L60.5 84 L59 86.5" stroke="#7A5A33" strokeWidth="1.2" fill="none" strokeLinecap="round" />}
            {w >= 3 && <path d="M60.5 80 q1 -7 5 -9 q-1.5 5 -4 9" fill="#30D158" stroke="#2E9E4F" strokeWidth=".8" />}
          </g>
        )}
        {/* drops */}
        {s === 0 && w >= 1 && <Drop x={46} y={66} />}
        {s === 0 && w >= 2 && <Drop x={74} y={60} />}
        {s === 0 && w >= 3 && <Drop x={60} y={52} small />}
      </svg>
      {droop && pill && <span className="tag tag--water plant-pill">Needs water</span>}
    </div>
  );
}

function Leaf({ x, y, angle, scale, flip }: { x: number; y: number; angle: number; scale: number; flip?: boolean }) {
  return (
    <path
      d={LEAF}
      fill={flip ? '#3DBE63' : '#30D158'}
      stroke="#2E9E4F"
      strokeWidth=".8"
      transform={`translate(${x} ${y}) rotate(${angle}) scale(${scale} ${flip ? -scale : scale})`}
    />
  );
}

function Drop({ x, y, small }: { x: number; y: number; small?: boolean }) {
  const k = small ? 0.75 : 1;
  return (
    <path
      className="plant-drop"
      d={`M${x} ${y} c ${-4 * k} ${6 * k} ${-5 * k} ${8 * k} ${-5 * k} ${10 * k} a ${5 * k} ${5 * k} 0 0 0 ${10 * k} 0 c 0 ${-2 * k} ${-1 * k} ${-4 * k} ${-5 * k} ${-10 * k} z`}
      fill="#7FD3FF"
      stroke="#0571A6"
      strokeWidth=".6"
    />
  );
}
