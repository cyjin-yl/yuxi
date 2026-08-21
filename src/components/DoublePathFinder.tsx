import { useState, useMemo, useCallback } from 'react';

/*
  P1004 方格取数 交互模拟器
  — 双路径逐步取数；格子被任一路径取走后显示为 0
*/

const DEFAULT_GRID = [
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 13, 0, 0, 6, 0, 0],
  [0, 0, 0, 0, 7, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 14, 0],
  [0, 0, 0, 0, 21, 0, 0, 0],
  [0, 0, 0, 0, 0, 4, 0, 0],
  [0, 0, 0, 0, 0, 0, 15, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
];

type Pos = [number, number]; // 1-indexed (row, col)

function cellKey(r: number, c: number) {
  return `${r},${c}`;
}

export default function DoublePathFinder() {
  const gridSize = 8;
  const [grid] = useState(DEFAULT_GRID);
  const [step, setStep] = useState(-1);

  // Build DP table + predecessor
  const dp = useMemo(() => {
    const n = gridSize;
    const f: number[][][] = Array.from({ length: 2 * n + 1 }, () =>
      Array.from({ length: n + 1 }, () => Array(n + 1).fill(Number.NEGATIVE_INFINITY)),
    );
    const pre: number[][][] = Array.from({ length: 2 * n + 1 }, () =>
      Array.from({ length: n + 1 }, () => Array(n + 1).fill(-1)),
    );

    // k = x1 + y1 = x2 + y2; start both at (1,1) when k=2
    f[2][1][1] = grid[0]?.[0] ?? 0;
    pre[2][1][1] = -1;

    for (let k = 3; k <= 2 * n; k++) {
      for (let i = 1; i <= n; i++) {
        const j1 = k - i;
        if (j1 < 1 || j1 > n) continue;
        for (let j = 1; j <= n; j++) {
          const j2 = k - j;
          if (j2 < 1 || j2 > n) continue;

          const opts = [
            { v: f[k - 1][i - 1]?.[j - 1] ?? Number.NEGATIVE_INFINITY, d: 0 }, // both from up
            { v: f[k - 1][i]?.[j] ?? Number.NEGATIVE_INFINITY, d: 1 }, // both from left
            { v: f[k - 1][i - 1]?.[j] ?? Number.NEGATIVE_INFINITY, d: 2 }, // p1 up, p2 left
            { v: f[k - 1][i]?.[j - 1] ?? Number.NEGATIVE_INFINITY, d: 3 }, // p1 left, p2 up
          ];

          let best = Number.NEGATIVE_INFINITY;
          let bestDir = 0;
          for (const o of opts) {
            if (o.v > best) {
              best = o.v;
              bestDir = o.d;
            }
          }
          if (!Number.isFinite(best)) continue;

          const val = grid[i - 1]?.[j1 - 1] ?? 0;
          const val2 = i !== j ? (grid[j - 1]?.[j2 - 1] ?? 0) : 0;
          f[k][i][j] = best + val + val2;
          pre[k][i][j] = bestDir;
        }
      }
    }

    return { f, pre };
  }, [grid, gridSize]);

  // Reconstruct optimal paths from end → start, then reverse
  const optimalPaths = useMemo(() => {
    const n = gridSize;
    const p1: Pos[] = [];
    const p2: Pos[] = [];

    let i = n;
    let j = n;
    let k = 2 * n;

    if (!Number.isFinite(dp.f[k][i][j])) {
      return { path1: p1, path2: p2 };
    }

    p1.push([n, n]);
    p2.push([n, n]);

    while (k > 2) {
      const d = dp.pre[k][i][j];
      let ni = i;
      let nj = j;
      switch (d) {
        case 0:
          ni = i - 1;
          nj = j - 1;
          break;
        case 1:
          ni = i;
          nj = j;
          break;
        case 2:
          ni = i - 1;
          nj = j;
          break;
        case 3:
          ni = i;
          nj = j - 1;
          break;
        default:
          return { path1: p1.reverse() as Pos[], path2: p2.reverse() as Pos[] };
      }
      // At step k-1: y = (k-1) - x
      p1.push([ni, k - 1 - ni]);
      p2.push([nj, k - 1 - nj]);
      i = ni;
      j = nj;
      k--;
    }

    p1.reverse();
    p2.reverse();
    return { path1: p1, path2: p2 };
  }, [dp.pre, dp.f, gridSize]);

  const maxStep = optimalPaths.path1.length;
  const totalScore = (() => {
    const v = dp.f[2 * gridSize][gridSize][gridSize];
    return Number.isFinite(v) ? v : 0;
  })();

  const goForward = useCallback(() => {
    if (step < maxStep - 1) setStep((s) => s + 1);
  }, [step, maxStep]);

  const goBack = useCallback(() => {
    if (step > -1) setStep((s) => s - 1);
  }, [step]);

  const reset = useCallback(() => setStep(-1), []);

  const currentPos1 = step >= 0 ? optimalPaths.path1[step] : null;
  const currentPos2 = step >= 0 ? optimalPaths.path2[step] : null;

  /**
   * Remaining values after both paths have taken cells through `step`.
   * First visit collects the original value; later visit sees 0.
   */
  const { remaining, takenKeys, stepGain, cumulativeScore } = useMemo(() => {
    const rem = grid.map((row) => row.slice());
    const taken = new Set<string>();
    let cum = 0;
    let gain = 0;

    if (step < 0) {
      return { remaining: rem, takenKeys: taken, stepGain: 0, cumulativeScore: 0 };
    }

    for (let t = 0; t <= step && t < optimalPaths.path1.length; t++) {
      const [r1, c1] = optimalPaths.path1[t];
      const [r2, c2] = optimalPaths.path2[t];
      let g = 0;

      const k1 = cellKey(r1, c1);
      if (!taken.has(k1)) {
        g += rem[r1 - 1]?.[c1 - 1] ?? 0;
        if (rem[r1 - 1]) rem[r1 - 1][c1 - 1] = 0;
        taken.add(k1);
      }

      const k2 = cellKey(r2, c2);
      if (!taken.has(k2)) {
        g += rem[r2 - 1]?.[c2 - 1] ?? 0;
        if (rem[r2 - 1]) rem[r2 - 1][c2 - 1] = 0;
        taken.add(k2);
      }

      cum += g;
      if (t === step) gain = g;
    }

    return { remaining: rem, takenKeys: taken, stepGain: gain, cumulativeScore: cum };
  }, [step, optimalPaths, grid]);

  const CELL = 42;
  const GRID_W = gridSize * CELL;

  return (
    <div className="widget-container">
      <div className="widget-header">
        <h3>方格取数 交互模拟器</h3>
        <p className="widget-subtitle">
          两条路径同步前进；格子被取走后变为 0（第二次经过不计分）。
        </p>
      </div>

      <div className="widget-controls">
        <button type="button" onClick={goBack} disabled={step < 0} className="btn-step">
          ◀ 上一步
        </button>
        <button
          type="button"
          onClick={goForward}
          disabled={step >= maxStep - 1 || maxStep === 0}
          className="btn-step"
        >
          下一步 ▶
        </button>
        <button type="button" onClick={reset} className="btn-reset">
          重置
        </button>
        <span className="widget-info">
          步数: <strong>{step + 1} / {maxStep}</strong>
        </span>
        <span className="widget-info">
          本步得分: <strong>{step < 0 ? 0 : stepGain}</strong>
        </span>
        <span className="widget-info">
          累计得分: <strong>{cumulativeScore}</strong>
        </span>
        <span className="widget-info widget-ans">
          最优答案: <strong>{totalScore}</strong>
        </span>
      </div>

      <div className="widget-svg-wrap">
        <svg
          viewBox={`0 0 ${GRID_W + 20} ${GRID_W + 20}`}
          style={{ width: '100%', maxWidth: 500, height: 'auto' }}
          role="img"
          aria-label="方格取数棋盘"
        >
          <rect x="10" y="10" width={GRID_W} height={GRID_W} fill="var(--paper-2)" rx="4" />

          {remaining.map((row, r) =>
            row.map((v, c) => {
              const orig = grid[r]?.[c] ?? 0;
              if (orig === 0 && v === 0) return null;
              const key = cellKey(r + 1, c + 1);
              const isTaken = takenKeys.has(key);
              const onP1 =
                step >= 0 &&
                optimalPaths.path1.slice(0, step + 1).some(([rr, cc]) => rr === r + 1 && cc === c + 1);
              const onP2 =
                step >= 0 &&
                optimalPaths.path2.slice(0, step + 1).some(([rr, cc]) => rr === r + 1 && cc === c + 1);

              let fill = 'var(--mark-soft)';
              if (isTaken) fill = 'var(--paper-2)';
              else if (onP1 && onP2) fill = 'color-mix(in srgb, var(--mark) 25%, var(--paper))';
              else if (onP1) fill = 'color-mix(in srgb, #c45c7a 20%, var(--paper))';
              else if (onP2) fill = 'color-mix(in srgb, #4a7ab5 20%, var(--paper))';

              return (
                <g key={`${r}-${c}`}>
                  <rect
                    x={10 + c * CELL}
                    y={10 + r * CELL}
                    width={CELL}
                    height={CELL}
                    fill={fill}
                    stroke="var(--rule)"
                    strokeWidth="1"
                  />
                  <text
                    x={10 + c * CELL + CELL / 2}
                    y={10 + r * CELL + CELL / 2 + 4}
                    textAnchor="middle"
                    fontSize="11"
                    fill={isTaken ? 'var(--ink-3)' : 'var(--ink)'}
                    fontWeight="bold"
                    fontFamily="var(--font-mono)"
                  >
                    {isTaken ? 0 : v}
                  </text>
                  {isTaken && orig > 0 && (
                    <text
                      x={10 + c * CELL + CELL / 2}
                      y={10 + r * CELL + 12}
                      textAnchor="middle"
                      fontSize="8"
                      fill="var(--ink-3)"
                      fontFamily="var(--font-mono)"
                    >
                      已取{orig}
                    </text>
                  )}
                </g>
              );
            }),
          )}

          {currentPos1 && (
            <circle
              cx={10 + (currentPos1[1] - 1) * CELL + CELL / 2}
              cy={10 + (currentPos1[0] - 1) * CELL + CELL / 2}
              r={10}
              fill="none"
              stroke="#c45c7a"
              strokeWidth={3}
            />
          )}
          {currentPos2 && (
            <circle
              cx={10 + (currentPos2[1] - 1) * CELL + CELL / 2}
              cy={10 + (currentPos2[0] - 1) * CELL + CELL / 2}
              r={10}
              fill="none"
              stroke="#4a7ab5"
              strokeWidth={3}
            />
          )}
        </svg>

        <div className="widget-legend" style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem', fontSize: '0.85rem' }}>
          <span style={{ color: '#c45c7a' }}>● 路径一</span>
          <span style={{ color: '#4a7ab5' }}>● 路径二</span>
          <span style={{ color: 'var(--ink-3)' }}>0 = 已取走</span>
        </div>
      </div>

      {step >= 0 && currentPos1 && currentPos2 && (
        <div className="augmentation-info">
          <p>
            <strong>路径一</strong> ({currentPos1[0]}, {currentPos1[1]}) · <strong>路径二</strong> (
            {currentPos2[0]}, {currentPos2[1]})
          </p>
          <p>
            本步取分 <strong>{stepGain}</strong>
            {currentPos1[0] === currentPos2[0] && currentPos1[1] === currentPos2[1]
              ? '（两路径同格，只计一次）'
              : ''}
            ；累计 <strong>{cumulativeScore}</strong> / 最优 {totalScore}
          </p>
        </div>
      )}

      <div className="widget-note">
        <p>
          规则：走过的格子数字被取走后变为 0。同步双路径 DP 用{' '}
          <code>dp[k][x₁][x₂]</code>，同格 <code>x₁=x₂</code> 时只加一次。
        </p>
      </div>
    </div>
  );
}
