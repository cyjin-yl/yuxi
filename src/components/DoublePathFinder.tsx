import { useState, useMemo, useCallback } from 'react';

/*
  P1004 方格取数 交互模拟器
  — 可视化两条路径同时遍历方格，展示状态压缩 DP 的核心思路
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

interface PathState {
  path1: [number, number][];
  path2: [number, number][];
}

export default function DoublePathFinder() {
  const [gridSize, setGridSize] = useState(8);
  const [grid, setGrid] = useState(DEFAULT_GRID);
  const [step, setStep] = useState(-1);
  const [running, setRunning] = useState(false);

  // Build DP table
  const dp = useMemo(() => {
    const n = gridSize;
    const f: number[][][] = Array.from({ length: 2 * n + 1 }, () =>
      Array.from({ length: n + 1 }, () => Array(n + 1).fill(0))
    );
    const pre: number[][][] = Array.from({ length: 2 * n + 1 }, () =>
      Array.from({ length: n + 1 }, () => Array(n + 1).fill(0))
    );

    for (let k = 2; k <= 2 * n; k++) {
      for (let i = 1; i <= n; i++) {
        const j1 = k - i;
        if (j1 < 1 || j1 > n) continue;
        for (let j = 1; j <= n; j++) {
          const j2 = k - j;
          if (j2 < 1 || j2 > n) continue;

          let best = 0, bestDir = 0;
          if (k > 2) {
            const opts = [
              { v: f[k-1][i-1][j-1], d: 0 }, // both up
              { v: f[k-1][i][j], d: 1 },      // both left
              { v: f[k-1][i-1][j], d: 2 },   // p1 up, p2 left
              { v: f[k-1][i][j-1], d: 3 },   // p1 left, p2 up
            ];
            for (const o of opts) {
              if (o.v > best) { best = o.v; bestDir = o.d; }
            }
          }

          const val = grid[i-1]?.[j1-1] ?? 0;
          const val2 = i !== j ? (grid[j-1]?.[j2-1] ?? 0) : 0;
          f[k][i][j] = best + val + val2;
          pre[k][i][j] = bestDir;
        }
      }
    }

    return { f, pre };
  }, [grid, gridSize]);

  // Reconstruct optimal paths
  const optimalPaths = useMemo(() => {
    const n = gridSize;
    const p1: [number, number][] = [];
    const p2: [number, number][] = [];

    let i = n, j = n, k = 2 * n;
    p1.push([n, n]);
    p2.push([n, n]);

    while (k > 2) {
      const d = dp.pre[k][i][j];
      let ni = i, nj = j;
      switch (d) {
        case 0: ni = i - 1; nj = j - 1; break;
        case 1: ni = i; nj = j; break;
        case 2: ni = i - 1; nj = j; break;
        case 3: ni = i; nj = j - 1; break;
      }
      p1.push([ni, k - 1 - (k - 1 - ni)]);
      p2.push([nj, k - 1 - (k - 1 - nj)]);
      i = ni; j = nj; k--;
    }

    p1.reverse();
    p2.reverse();
    return { path1: p1, path2: p2 };
  }, [dp.pre, gridSize]);

  const maxStep = optimalPaths.path1.length;
  const totalScore = dp.f[2 * gridSize][gridSize][gridSize];

  const goForward = useCallback(() => {
    if (step < maxStep - 1) setStep(s => s + 1);
  }, [step, maxStep]);

  const goBack = useCallback(() => {
    if (step > -1) setStep(s => s - 1);
  }, [step]);

  const reset = useCallback(() => setStep(-1), []);

  const currentPos1 = step >= 0 ? optimalPaths.path1[step] : null;
  const currentPos2 = step >= 0 ? optimalPaths.path2[step] : null;

  // Cumulative score up to current step
  const cumulativeScore = useMemo(() => {
    if (step < 0) return 0;
    return dp.f[step + 2][currentPos1?.[0] ?? 1][currentPos2?.[0] ?? 1] || 0;
  }, [step, dp.f, currentPos1, currentPos2]);

  const CELL = 42;
  const GRID_W = gridSize * CELL;

  return (
    <div className="widget-container">
      <div className="widget-header">
        <h3>方格取数 交互模拟器</h3>
        <p className="widget-subtitle">
          两条路径同时遍历方格，最大化取数总和。点击「下一步」逐步查看 DP 过程。
        </p>
      </div>

      <div className="widget-controls">
        <button onClick={goBack} disabled={step < 0} className="btn-step">
          ◀ 上一步
        </button>
        <button onClick={goForward} disabled={step >= maxStep - 1} className="btn-step">
          下一步 ▶
        </button>
        <button onClick={reset} className="btn-reset">重置</button>
        <span className="widget-info">
          步数: <strong>{step + 1} / {maxStep}</strong>
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
        >
          {/* Grid background */}
          <rect x="10" y="10" width={GRID_W} height={GRID_W} fill="#f5f5f5" rx="4" />

          {/* Cell values */}
          {grid.map((row, r) =>
            row.map((v, c) => {
              if (v === 0) return null;
              return (
                <g key={`${r}-${c}`}>
                  <rect
                    x={10 + c * CELL} y={10 + r * CELL}
                    width={CELL} height={CELL}
                    fill="#e8eaf6" stroke="#c5cae9" strokeWidth="1"
                  />
                  <text
                    x={10 + c * CELL + CELL / 2}
                    y={10 + r * CELL + CELL / 2 + 4}
                    textAnchor="middle"
                    fontSize="11"
                    fill="#283593"
                    fontWeight="bold"
                  >
                    {v}
                  </text>
                </g>
              );
            })
          )}

          {/* Path 1 trail */}
          {step >= 0 && optimalPaths.path1.slice(0, step + 1).map(([r, c], idx) => (
            <rect
              key={`p1-${idx}`}
              x={10 + (c - 1) * CELL + 1} y={10 + (r - 1) * CELL + 1}
              width={CELL - 2} height={CELL - 2}
              fill="rgba(233, 30, 99, 0.15)" stroke="none"
            />
          ))}

          {/* Path 2 trail */}
          {step >= 0 && optimalPaths.path2.slice(0, step + 1).map(([r, c], idx) => (
            <rect
              key={`p2-${idx}`}
              x={10 + (c - 1) * CELL + 1} y={10 + (r - 1) * CELL + 1}
              fill="rgba(33, 150, 243, 0.15)" stroke="none"
            />
          ))}

          {/* Current position markers */}
          {currentPos1 && (
            <circle
              cx={10 + (currentPos1[1] - 1) * CELL + CELL / 2}
              cy={10 + (currentPos1[0] - 1) * CELL + CELL / 2}
              r={10}
              fill="none" stroke="#e91e63" strokeWidth={3}
            />
          )}
          {currentPos2 && (
            <circle
              cx={10 + (currentPos2[1] - 1) * CELL + CELL / 2}
              cy={10 + (currentPos2[0] - 1) * CELL + CELL / 2}
              r={10}
              fill="none" stroke="#2196f3" strokeWidth={3}
            />
          )}

          {/* Labels */}
          <text x="5" y={10 + gridSize * CELL / 2} fontSize="11" fill="#555"
            textAnchor="middle" transform={`rotate(-90, 5, ${10 + gridSize * CELL / 2})`}>
            行
          </text>
          <text x={10 + GRID_W / 2} y="5" fontSize="11" fill="#555" textAnchor="middle">
            列
          </text>
        </svg>

        <div className="widget-legend">
          <span style={{ color: '#e91e63' }}>● 路径一</span>
          <span style={{ color: '#2196f3' }}>● 路径二</span>
        </div>
      </div>

      {/* State display */}
      {step >= 0 && currentPos1 && currentPos2 && (
        <div className="widget-state">
          <h4>当前状态</h4>
          <div className="state-grid">
            <div className="state-card">
              <span className="state-label">路径一</span>
              <span className="state-val">({currentPos1[0]}, {currentPos1[1]})</span>
            </div>
            <div className="state-card">
              <span className="state-label">路径二</span>
              <span className="state-val">({currentPos2[0]}, {currentPos2[1]})</span>
            </div>
            <div className="state-card">
              <span className="state-label">步数</span>
              <span className="state-val">{step + 1}</span>
            </div>
            <div className="state-card">
              <span className="state-label">累计得分</span>
              <span className="state-val">{cumulativeScore}</span>
            </div>
          </div>
        </div>
      )}

      <div className="widget-note">
        <p>
          💡 核心技巧：两条路径走相同步数时，<code>x₁+y₁ = x₂+y₂</code>，
          用这个约束把四维状态压缩为三维 <code>dp[k][x₁][x₂]</code>。
        </p>
      </div>
    </div>
  );
}
