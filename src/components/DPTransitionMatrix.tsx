import { useState, useMemo, useCallback } from 'react';

/*
  P1004 方格取数 - DP 状态转移矩阵模拟器
  展示 dp[k][x1][x2] 三维 DP 表的逐步构建过程
*/

const SAMPLE_GRID = [
  [0, 0, 0, 0],
  [0, 0, 10, 0],
  [0, 0, 5, 8],
  [0, 0, 0, 0],
];

const N = 4;

interface TransitionStep {
  k: number;
  x1: number;
  x2: number;
  y1: number;
  y2: number;
  preds: { label: string; val: number; coords: [number, number] }[];
  cellVal: number;
  result: number;
  bestPred: number;
}

export default function DPTransitionMatrix() {
  const [stepIdx, setStepIdx] = useState(-1);
  const [grid] = useState(SAMPLE_GRID);

  // Compute full DP table
  const dpTable = useMemo(() => {
    const f: number[][][] = Array.from({ length: 2 * N + 1 }, () =>
      Array.from({ length: N + 1 }, () => Array(N + 1).fill(0))
    );

    for (let k = 2; k <= 2 * N; k++) {
      for (let i = 1; i <= N; i++) {
        const j1 = k - i;
        if (j1 < 1 || j1 > N) continue;
        for (let j = 1; j <= N; j++) {
          const j2 = k - j;
          if (j2 < 1 || j2 > N) continue;

          let best = 0, bestDir = 0;
          if (k > 2) {
            const opts = [
              { v: f[k-1][i-1][j-1], d: 0 },
              { v: f[k-1][i][j], d: 1 },
              { v: f[k-1][i-1][j], d: 2 },
              { v: f[k-1][i][j-1], d: 3 },
            ];
            for (const o of opts) {
              if (o.v > best) { best = o.v; bestDir = o.d; }
            }
          }

          const val = grid[i-1]?.[j1-1] ?? 0;
          const val2 = i !== j ? (grid[j-1]?.[j2-1] ?? 0) : 0;
          f[k][i][j] = best + val + val2;
        }
      }
    }
    return f;
  }, [grid]);

  // Generate all valid transition steps
  const steps = useMemo(() => {
    const s: TransitionStep[] = [];
    for (let k = 2; k <= 2 * N; k++) {
      for (let i = 1; i <= N; i++) {
        const j1 = k - i;
        if (j1 < 1 || j1 > N) continue;
        for (let j = 1; j <= N; j++) {
          const j2 = k - j;
          if (j2 < 1 || j2 > N) continue;

          const predLabels = ['上+上', '左+左', '上+左', '左+上'];
          const preds: { label: string; val: number; coords: [number, number] }[] = [];

          if (k > 2) {
            preds.push({ label: predLabels[0], val: dpTable[k-1][i-1][j-1], coords: [i-1, j-1] });
            preds.push({ label: predLabels[1], val: dpTable[k-1][i][j], coords: [i, j] });
            preds.push({ label: predLabels[2], val: dpTable[k-1][i-1][j], coords: [i-1, j] });
            preds.push({ label: predLabels[3], val: dpTable[k-1][i][j-1], coords: [i, j-1] });
          } else {
            preds.push({ label: '起点', val: 0, coords: [0, 0] });
          }

          const cellVal = grid[i-1]?.[j1-1] ?? 0;
          const val2 = i !== j ? (grid[j-1]?.[j2-1] ?? 0) : 0;
          const bestPredVal = Math.max(...preds.map(p => p.val));
          const bestPredIdx = preds.findIndex(p => p.val === bestPredVal);

          s.push({
            k, x1: i, x2: j, y1: j1, y2: j2,
            preds, cellVal: cellVal + (i !== j ? val2 : 0),
            result: dpTable[k][i][j],
            bestPred: bestPredIdx,
          });
        }
      }
    }
    return s;
  }, [dpTable, grid]);

  const goForward = useCallback(() => {
    if (stepIdx < steps.length - 1) setStepIdx(s => s + 1);
  }, [stepIdx, steps.length]);

  const goBack = useCallback(() => {
    if (stepIdx > -1) setStepIdx(s => s - 1);
  }, [stepIdx]);

  const reset = useCallback(() => setStepIdx(-1), []);

  const current = stepIdx >= 0 ? steps[stepIdx] : null;

  // DP matrix for current k: dp[k][x1][x2]
  const renderDPMatrix = (k: number, highlight: [number, number] | null) => {
    const rows = [];
    for (let x1 = 1; x1 <= N; x1++) {
      const cells = [];
      for (let x2 = 1; x2 <= N; x2++) {
        const y1 = k - x1, y2 = k - x2;
        if (y1 < 1 || y1 > N || y2 < 1 || y2 > N) {
          cells.push(<td key={`${x1}-${x2}`} className="dp-cell dp-invalid">-</td>);
        } else {
          const isHighlighted = highlight && highlight[0] === x1 && highlight[1] === x2;
          cells.push(
            <td key={`${x1}-${x2}`} className={`dp-cell ${isHighlighted ? 'dp-active' : ''}`}>
              {dpTable[k][x1][x2]}
            </td>
          );
        }
      }
      rows.push(<tr key={x1}>{cells}</tr>);
    }
    return rows;
  };

  return (
    <div className="widget-container">
      <div className="widget-header">
        <h3>DP 状态转移矩阵</h3>
        <p className="widget-subtitle">
          逐步展示 <code>dp[k][x₁][x₂]</code> 三维 DP 表的构建过程。每个格子表示一个状态，值是该状态的最大得分。
        </p>
      </div>

      {/* Input Grid */}
      <div className="widget-section">
        <h4>输入方格</h4>
        <table className="dp-input-grid">
          <tbody>
            {grid.map((row, r) => (
              <tr key={r}>
                {row.map((v, c) => (
                  <td key={c} className="grid-cell" style={{ backgroundColor: v > 0 ? '#e8eaf6' : '#fafafa' }}>
                    {v}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Controls */}
      <div className="widget-controls">
        <button onClick={goBack} disabled={stepIdx < 0} className="btn-step">
          ◀ 上一个状态
        </button>
        <button onClick={goForward} disabled={stepIdx >= steps.length - 1} className="btn-step">
          下一个状态 ▶
        </button>
        <button onClick={reset} className="btn-reset">重置</button>
        <span className="widget-info">
          步骤: <strong>{stepIdx + 1} / {steps.length}</strong>
        </span>
      </div>

      {/* Current Transition */}
      {current && (
        <div className="widget-section">
          <h4>当前转移</h4>
          <div className="transition-info">
            <div className="state-label">
              <code>dp[{current.k}][{current.x1}][{current.x2}]</code>
            </div>
            <div className="state-label">
              路径一位置: <code>({current.x1}, {current.y1})</code>
            </div>
            <div className="state-label">
              路径二位置: <code>({current.x2}, {current.y2})</code>
            </div>

            <div className="pred-grid">
              {current.preds.map((p, i) => (
                <div key={i} className={`pred-card ${i === current.bestPred ? 'pred-best' : ''}`}>
                  <div className="pred-label">{p.label}</div>
                  <div className="pred-coords">dp[{current.k-1}][{p.coords[0]}][{p.coords[1]}]</div>
                  <div className="pred-val">{p.val}</div>
                  {i === current.bestPred && <div className="pred-badge">✓ 最优</div>}
                </div>
              ))}
            </div>

            <div className="transition-formula">
              <code>max({current.preds.map(p => p.val).join(', ')}) + {current.cellVal} = {current.result}</code>
            </div>
          </div>
        </div>
      )}

      {/* DP Matrix for current k */}
      <div className="widget-section">
        <h4>
          DP 矩阵 — 步数 k = {current ? current.k : '—'}
          {current && (
            <span className="k-badge">k={current.k}</span>
          )}
        </h4>
        <div className="dp-matrix-wrap">
          <table className="dp-matrix">
            <thead>
              <tr>
                <th>x₁ \ x₂</th>
                {Array.from({ length: N }, (_, i) => <th key={i}>{i + 1}</th>)}
              </tr>
            </thead>
            <tbody>
              {current ? renderDPMatrix(current.k, [current.x1, current.x2]) :
                renderDPMatrix(2, null)}
            </tbody>
          </table>
          <div className="dp-matrix-legend">
            <span className="dp-legend-item dp-active-legend">● 当前计算状态</span>
            <span className="dp-legend-item dp-invalid-legend">● 越界状态（跳过）</span>
          </div>
        </div>
      </div>

      {/* All k matrices overview */}
      <div className="widget-section">
        <h4>全部步数的 DP 矩阵概览</h4>
        <div className="dp-overview">
          {Array.from({ length: 2 * N - 1 }, (_, ki) => {
            const k = ki + 2;
            return (
              <div key={k} className={`dp-mini-card ${current && current.k === k ? 'dp-mini-active' : ''}`}>
                <div className="dp-mini-title">k={k}</div>
                <table className="dp-mini-matrix">
                  <tbody>
                    {Array.from({ length: N }, (_, ri) => {
                      const x1 = ri + 1;
                      return (
                        <tr key={ri}>
                          {Array.from({ length: N }, (_, ci) => {
                            const x2 = ci + 1;
                            const y1 = k - x1, y2 = k - x2;
                            const valid = y1 >= 1 && y1 <= N && y2 >= 1 && y2 <= N;
                            return (
                              <td key={ci} className="dp-mini-cell">
                                {valid ? dpTable[k][x1][x2] : '-'}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {k === 2 * N && (
                  <div className="dp-mini-answer">答案: {dpTable[2 * N][N][N]}</div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="widget-note">
        <p>
          💡 每个 <code>k</code> 对应一步。两条路径各走一步后到达同一「对角线」，
          <code>y₁ = k - x₁</code>，<code>y₂ = k - x₂</code>，所以只需记录 <code>x₁, x₂</code>。
        </p>
      </div>
    </div>
  );
}
