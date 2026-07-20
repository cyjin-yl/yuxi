import { useState, useEffect, useCallback, useMemo } from 'react';

interface GraphEdge {
  id: number;
  u: number;
  v: number;
  w: number;
}

interface Step {
  edgeId: number;
  action: 'accept' | 'reject';
  reason: string;
  mstCost: number;
}

// --- Union-Find ---
class UnionFind {
  parent: number[];
  rank: number[];

  constructor(n: number) {
    this.parent = Array.from({ length: n + 1 }, (_, i) => i);
    this.rank = new Array(n + 1).fill(0);
  }

  find(x: number): number {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]];
      x = this.parent[x];
    }
    return x;
  }

  union(x: number, y: number): boolean {
    const rx = this.find(x), ry = this.find(y);
    if (rx === ry) return false;
    if (this.rank[rx] < this.rank[ry]) this.parent[rx] = ry;
    else if (this.rank[rx] > this.rank[ry]) this.parent[ry] = rx;
    else { this.parent[ry] = rx; this.rank[rx]++; }
    return true;
  }

  copy(): UnionFind {
    const c = new UnionFind(this.parent.length - 1);
    c.parent = [...this.parent];
    c.rank = [...this.rank];
    return c;
  }
}

const SAMPLE_EDGES: GraphEdge[] = [
  { id: 0, u: 1, v: 2, w: 1 },
  { id: 1, u: 2, v: 3, w: 2 },
  { id: 2, u: 3, v: 4, w: 3 },
  { id: 3, u: 1, v: 3, w: 4 },
  { id: 4, u: 1, v: 4, w: 5 },
];

// --- Run Kruskal step by step ---
function runKruskal(n: number, edges: GraphEdge[]): Step[] {
  const sorted = [...edges].sort((a, b) => a.w - b.w);
  const uf = new UnionFind(n);
  const steps: Step[] = [];
  let mstCost = 0;
  let edgesAccepted = 0;

  for (const e of sorted) {
    const ufCopy = uf.copy();
    const merged = uf.union(e.u, e.v);
    if (merged) {
      mstCost += e.w;
      edgesAccepted++;
      steps.push({ edgeId: e.id, action: 'accept', reason: `合并 {${e.u}} 和 {${e.v}}`, mstCost });
    } else {
      steps.push({ edgeId: e.id, action: 'reject', reason: `{${e.u}} 和 {${e.v}} 已连通，跳过`, mstCost });
    }
  }
  return steps;
}

// --- React Component ---
export default function KruskalSimulator() {
  const [n, setN] = useState(4);
  const [edges, setEdges] = useState<GraphEdge[]>(SAMPLE_EDGES);
  const [steps, setSteps] = useState<Step[]>([]);
  const [currentStep, setCurrentStep] = useState(-1);
  const [solved, setSolved] = useState(false);

  const rebuild = useCallback(() => {
    setSteps([]);
    setCurrentStep(-1);
    setSolved(false);
  }, []);

  const runKruskalAlg = useCallback(() => {
    const s = runKruskal(n, edges);
    setSteps(s);
    setCurrentStep(0);
    setSolved(true);
  }, [n, edges]);

  useEffect(() => { rebuild(); }, [n]);

  const updateEdge = (idx: number, field: 'u' | 'v' | 'w', val: number) => {
    setEdges(prev => prev.map((e, i) => i === idx ? { ...e, [field]: val } : e));
  };

  const addEdge = () => {
    setEdges(prev => [...prev, { id: prev.length, u: 1, v: 2, w: 1 }]);
  };

  const removeEdge = (idx: number) => {
    if (edges.length <= 1) return;
    setEdges(prev => prev.filter((_, i) => i !== idx).map((e, i) => ({ ...e, id: i })));
  };

  // Compute which edges are in MST
  const mstEdgeIds = useMemo(() => {
    if (!solved) return new Set<number>();
    const ids = new Set<number>();
    for (let i = 0; i <= currentStep && i < steps.length; i++) {
      if (steps[i].action === 'accept') ids.add(steps[i].edgeId);
    }
    return ids;
  }, [solved, currentStep, steps]);

  // Layout: simple circle
  const nodePositions = useMemo(() => {
    const cx = 200, cy = 160, r = 120;
    const pos: { x: number; y: number }[] = new Array(n + 1);
    pos[0] = { x: cx, y: cy };
    for (let i = 1; i <= n; i++) {
      const angle = (2 * Math.PI * i / n) - Math.PI / 2;
      pos[i] = { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
    }
    return pos;
  }, [n]);

  return (
    <div className="widget-container">
      <div className="widget-header">
        <h3>Kruskal 最小生成树模拟器</h3>
        <p className="widget-subtitle">逐步执行 Kruskal：边排序 → 逐条处理 → 并查集判环</p>
      </div>

      <div className="widget-inputs">
        <div style={{ marginBottom: '0.5rem' }}>
          <label>顶点数 n: </label>
          <input type="number" value={n} onChange={e => setN(Math.max(2, Number(e.target.value)))} min={2} max={20} className="inp" style={{ width: '60px' }} />
        </div>
        <table>
          <thead>
            <tr><th>编号</th><th>u</th><th>v</th><th>w</th><th>操作</th></tr>
          </thead>
          <tbody>
            {edges.map((e, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td><input type="number" value={e.u} onChange={ev => updateEdge(i, 'u', Number(ev.target.value))} min={1} className="inp" /></td>
                <td><input type="number" value={e.v} onChange={ev => updateEdge(i, 'v', Number(ev.target.value))} min={1} className="inp" /></td>
                <td><input type="number" value={e.w} onChange={ev => updateEdge(i, 'w', Number(ev.target.value))} min={0} className="inp" /></td>
                <td><button className="btn-remove" onClick={() => removeEdge(i)} disabled={edges.length <= 1}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="btn-add" onClick={addEdge} style={{ marginTop: '0.5rem', width: '100%', padding: '0.4rem', fontSize: '0.8rem', cursor: 'pointer', background: 'var(--accent-soft)', border: '1px dashed var(--border)', borderRadius: '0.35rem', color: 'var(--ink-secondary)' }}>
          + 添加一条边
        </button>
      </div>

      <div className="widget-controls">
        {!solved ? (
          <button className="btn-match" onClick={runKruskalAlg}>运行 Kruskal</button>
        ) : (
          <>
            <button className="btn-match" onClick={() => setCurrentStep(s => Math.max(s - 1, -1))} disabled={currentStep < 0}>◀ 上一步</button>
            <button className="btn-match" onClick={() => setCurrentStep(s => Math.min(s + 1, steps.length - 1))} disabled={currentStep >= steps.length - 1}>下一步 ▶</button>
          </>
        )}
        <button className="btn-reset" onClick={rebuild}>重置</button>
        {solved && currentStep >= 0 && (
          <span className="profit">MST 边权和: <strong>{steps[currentStep]?.mstCost ?? 0}</strong></span>
        )}
        <span className="step-label">步骤 {currentStep + 1} / {steps.length}</span>
      </div>

      {solved && currentStep >= 0 && steps[currentStep] && (
        <div className="augmentation-info">
          <p><strong>{steps[currentStep].action === 'accept' ? '✅ 接受' : '❌ 跳过'} 第 {currentStep + 1} 条边：</strong> ({edges[steps[currentStep].edgeId]?.u}, {edges[steps[currentStep].edgeId]?.v}, w={edges[steps[currentStep].edgeId]?.w})</p>
          <p>{steps[currentStep].reason}</p>
          <p><strong>MST 边权和：</strong>{steps[currentStep].mstCost}</p>
        </div>
      )}

      {edges.length > 0 && (
        <div className="widget-svg-wrap">
          <svg viewBox="0 0 400 320">
            {edges.map((e, i) => {
              const from = nodePositions[e.u];
              const to = nodePositions[e.v];
              if (!from || !to) return null;
              const isMst = mstEdgeIds.has(e.id);
              const isCurrent = solved && currentStep >= 0 && steps[currentStep]?.edgeId === e.id;
              return (
                <g key={i}>
                  <line
                    x1={from.x} y1={from.y}
                    x2={to.x} y2={to.y}
                    stroke={isMst ? '#4caf50' : isCurrent ? '#ff9800' : '#ccc'}
                    strokeWidth={isMst ? 3 : isCurrent ? 2.5 : 1.5}
                    strokeDasharray={isCurrent ? 'none' : isMst ? 'none' : 'none'}
                  />
                  <text
                    x={(from.x + to.x) / 2}
                    y={(from.y + to.y) / 2 - 6}
                    textAnchor="middle"
                    className="edge-label"
                    fill={isMst ? '#4caf50' : isCurrent ? '#ff9800' : '#999'}
                  >
                    {e.w}
                  </text>
                </g>
              );
            })}
            {nodePositions.slice(1).map((pos, i) => (
              <g key={i}>
                <circle cx={pos.x} cy={pos.y} r={18} fill="#bbdefb" stroke="#1976d2" strokeWidth={2} />
                <text x={pos.x} y={pos.y + 1} textAnchor="middle" className="node-label" dy="0.35em">{i + 1}</text>
              </g>
            ))}
          </svg>
        </div>
      )}

      <div className="widget-note">
        <p>Kruskal 算法：将所有边按权值从小到大排序，依次考虑每条边。若两端点不在同一连通分量（并查集判断），则将边加入生成树；否则跳过。</p>
      </div>
    </div>
  );
}
