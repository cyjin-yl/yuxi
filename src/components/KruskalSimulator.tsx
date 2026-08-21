import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useDeferredValue,
  memo,
} from 'react';

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

const MAX_N = 40;
const MAX_EDGES = 500;
const TABLE_PAGE_SIZE = 40;
const EDGE_EDIT_DEBOUNCE_MS = 120;
const SVG_HEAVY_THRESHOLD = 60;

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
    const rx = this.find(x);
    const ry = this.find(y);
    if (rx === ry) return false;
    if (this.rank[rx] < this.rank[ry]) this.parent[rx] = ry;
    else if (this.rank[rx] > this.rank[ry]) this.parent[ry] = rx;
    else {
      this.parent[ry] = rx;
      this.rank[rx]++;
    }
    return true;
  }
}

const SAMPLE_EDGES: GraphEdge[] = [
  { id: 0, u: 1, v: 2, w: 1 },
  { id: 1, u: 2, v: 3, w: 2 },
  { id: 2, u: 3, v: 4, w: 3 },
  { id: 3, u: 1, v: 3, w: 4 },
  { id: 4, u: 1, v: 4, w: 5 },
];

function runKruskal(n: number, edges: GraphEdge[]): Step[] {
  const sorted = [...edges].sort((a, b) => a.w - b.w || a.id - b.id);
  const uf = new UnionFind(n);
  const steps: Step[] = [];
  let mstCost = 0;
  let edgesAccepted = 0;

  for (const e of sorted) {
    if (edgesAccepted >= n - 1) {
      steps.push({
        edgeId: e.id,
        action: 'reject',
        reason: `已选满 ${n - 1} 条边，跳过 (${e.u}, ${e.v})`,
        mstCost,
      });
      continue;
    }
    const merged = uf.union(e.u, e.v);
    if (merged) {
      mstCost += e.w;
      edgesAccepted++;
      steps.push({
        edgeId: e.id,
        action: 'accept',
        reason: `合并 ${e.u} 和 ${e.v}`,
        mstCost,
      });
    } else {
      steps.push({
        edgeId: e.id,
        action: 'reject',
        reason: `${e.u} 和 ${e.v} 已连通，跳过`,
        mstCost,
      });
    }
  }
  return steps;
}

function useDebouncedCallback<T extends (...args: never[]) => void>(fn: T, delay: number) {
  const fnRef = useRef(fn);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  fnRef.current = fn;

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return useCallback(
    (...args: Parameters<T>) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => fnRef.current(...args), delay);
    },
    [delay],
  );
}

function useRafThrottle<T extends (...args: never[]) => void>(fn: T) {
  const fnRef = useRef(fn);
  const raf = useRef<number | null>(null);
  const latest = useRef<Parameters<T> | null>(null);
  fnRef.current = fn;

  useEffect(
    () => () => {
      if (raf.current != null) cancelAnimationFrame(raf.current);
    },
    [],
  );

  return useCallback((...args: Parameters<T>) => {
    latest.current = args;
    if (raf.current != null) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = null;
      if (latest.current) fnRef.current(...latest.current);
    });
  }, []);
}

const EdgeRow = memo(function EdgeRow({
  index,
  edge,
  onChange,
  onRemove,
  canRemove,
}: {
  index: number;
  edge: GraphEdge;
  onChange: (idx: number, field: 'u' | 'v' | 'w', val: number) => void;
  onRemove: (idx: number) => void;
  canRemove: boolean;
}) {
  const [u, setU] = useState(String(edge.u));
  const [v, setV] = useState(String(edge.v));
  const [w, setW] = useState(String(edge.w));

  useEffect(() => {
    setU(String(edge.u));
    setV(String(edge.v));
    setW(String(edge.w));
  }, [edge.u, edge.v, edge.w, edge.id]);

  const commit = useDebouncedCallback((field: 'u' | 'v' | 'w', raw: string) => {
    const num = Number(raw);
    if (!Number.isFinite(num)) return;
    onChange(index, field, num);
  }, EDGE_EDIT_DEBOUNCE_MS);

  return (
    <tr>
      <td>{index + 1}</td>
      <td>
        <input
          type="number"
          value={u}
          onChange={(ev) => {
            setU(ev.target.value);
            commit('u', ev.target.value);
          }}
          min={1}
          className="inp"
        />
      </td>
      <td>
        <input
          type="number"
          value={v}
          onChange={(ev) => {
            setV(ev.target.value);
            commit('v', ev.target.value);
          }}
          min={1}
          className="inp"
        />
      </td>
      <td>
        <input
          type="number"
          value={w}
          onChange={(ev) => {
            setW(ev.target.value);
            commit('w', ev.target.value);
          }}
          min={0}
          className="inp"
        />
      </td>
      <td>
        <button type="button" className="btn-remove" onClick={() => onRemove(index)} disabled={!canRemove}>
          ✕
        </button>
      </td>
    </tr>
  );
});

export default function KruskalSimulator() {
  const [n, setN] = useState(4);
  const [edges, setEdges] = useState<GraphEdge[]>(SAMPLE_EDGES);
  const [steps, setSteps] = useState<Step[]>([]);
  const [currentStep, setCurrentStep] = useState(-1);
  const [solved, setSolved] = useState(false);
  const [running, setRunning] = useState(false);
  const [tablePage, setTablePage] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const runToken = useRef(0);

  const deferredEdges = useDeferredValue(edges);
  const heavy = deferredEdges.length > SVG_HEAVY_THRESHOLD;

  const rebuild = useCallback(() => {
    setSteps([]);
    setCurrentStep(-1);
    setSolved(false);
    setRunning(false);
    setStatus(null);
  }, []);

  const runKruskalAlg = useCallback(() => {
    if (edges.length === 0) {
      setStatus('至少需要一条边。');
      return;
    }
    setRunning(true);
    setStatus(null);
    const token = ++runToken.current;

    const kick = () => {
      if (token !== runToken.current) return;
      const t0 = performance.now();
      const s = runKruskal(n, edges);
      if (token !== runToken.current) return;
      setSteps(s);
      setCurrentStep(s.length ? 0 : -1);
      setSolved(true);
      setRunning(false);
      const ms = Math.round(performance.now() - t0);
      if (edges.length >= SVG_HEAVY_THRESHOLD) {
        setStatus(`已处理 ${edges.length} 条边 · ${s.length} 步 · ${ms} ms`);
      }
    };

    if (edges.length >= SVG_HEAVY_THRESHOLD) {
      requestAnimationFrame(() => setTimeout(kick, 0));
    } else {
      kick();
    }
  }, [n, edges]);

  useEffect(() => {
    rebuild();
  }, [n, rebuild]);

  const updateEdge = useCallback((idx: number, field: 'u' | 'v' | 'w', val: number) => {
    setEdges((prev) => {
      const next = prev.slice();
      const cur = next[idx];
      if (!cur) return prev;
      let v = val;
      if (field === 'u' || field === 'v') v = Math.max(1, Math.floor(v) || 1);
      if (field === 'w') v = Math.max(0, Number.isFinite(v) ? v : 0);
      if (cur[field] === v) return prev;
      next[idx] = { ...cur, [field]: v };
      return next;
    });
    setSolved(false);
    setSteps([]);
    setCurrentStep(-1);
  }, []);

  const addEdge = useCallback(() => {
    setEdges((prev) => {
      if (prev.length >= MAX_EDGES) {
        setStatus(`边数上限 ${MAX_EDGES}`);
        return prev;
      }
      setStatus(null);
      return [...prev, { id: prev.length, u: 1, v: Math.min(2, n), w: 1 }];
    });
    setSolved(false);
    setSteps([]);
    setCurrentStep(-1);
  }, [n]);

  const removeEdge = useCallback((idx: number) => {
    setEdges((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((_, i) => i !== idx).map((e, i) => ({ ...e, id: i }));
    });
    setSolved(false);
    setSteps([]);
    setCurrentStep(-1);
  }, []);

  const stepPrev = useRafThrottle(() => setCurrentStep((s) => Math.max(s - 1, -1)));
  const stepNext = useRafThrottle(() =>
    setCurrentStep((s) => Math.min(s + 1, steps.length - 1)),
  );

  const mstEdgeIds = useMemo(() => {
    if (!solved) return new Set<number>();
    const ids = new Set<number>();
    for (let i = 0; i <= currentStep && i < steps.length; i++) {
      if (steps[i].action === 'accept') ids.add(steps[i].edgeId);
    }
    return ids;
  }, [solved, currentStep, steps]);

  const currentEdgeId =
    solved && currentStep >= 0 ? steps[currentStep]?.edgeId : undefined;

  const nodePositions = useMemo(() => {
    const cx = 200;
    const cy = 160;
    const r = 120;
    const pos: { x: number; y: number }[] = new Array(n + 1);
    pos[0] = { x: cx, y: cy };
    for (let i = 1; i <= n; i++) {
      const angle = (2 * Math.PI * i) / n - Math.PI / 2;
      pos[i] = { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
    }
    return pos;
  }, [n]);

  const drawableEdges = useMemo(() => {
    if (!heavy) return deferredEdges;
    const keep = new Set<number>();
    mstEdgeIds.forEach((id) => keep.add(id));
    if (currentEdgeId != null) keep.add(currentEdgeId);
    let budget = 40;
    for (const e of deferredEdges) {
      if (keep.has(e.id)) continue;
      if (budget-- <= 0) break;
      keep.add(e.id);
    }
    return deferredEdges.filter((e) => keep.has(e.id));
  }, [heavy, deferredEdges, mstEdgeIds, currentEdgeId]);

  const tablePageCount = Math.max(1, Math.ceil(edges.length / TABLE_PAGE_SIZE));
  const safeTablePage = Math.min(tablePage, tablePageCount - 1);
  const tableSlice = useMemo(() => {
    const start = safeTablePage * TABLE_PAGE_SIZE;
    return edges.slice(start, start + TABLE_PAGE_SIZE).map((e, i) => ({
      edge: e,
      index: start + i,
    }));
  }, [edges, safeTablePage]);

  const onNChange = useDebouncedCallback((raw: string) => {
    setN(Math.min(MAX_N, Math.max(2, Number(raw) || 2)));
  }, 150);

  const [nDraft, setNDraft] = useState(String(n));
  useEffect(() => setNDraft(String(n)), [n]);

  return (
    <div className="widget-container">
      <div className="widget-header">
        <h3>Kruskal 最小生成树模拟器</h3>
        <p className="widget-subtitle">边排序 → 并查集判环。大图输入防抖、边表分页、SVG 抽样。</p>
      </div>

      <div className="widget-inputs">
        <div style={{ marginBottom: '0.5rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <label>
            顶点数 n:{' '}
            <input
              type="number"
              value={nDraft}
              onChange={(e) => {
                setNDraft(e.target.value);
                onNChange(e.target.value);
              }}
              min={2}
              max={MAX_N}
              className="inp"
              style={{ width: '60px' }}
            />
          </label>
          <span className="widget-info">
            边 {edges.length}/{MAX_EDGES}
            {heavy ? ' · 大图模式' : ''}
          </span>
        </div>

        <table>
          <thead>
            <tr>
              <th>编号</th>
              <th>u</th>
              <th>v</th>
              <th>w</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {tableSlice.map(({ edge, index }) => (
              <EdgeRow
                key={edge.id}
                index={index}
                edge={edge}
                onChange={updateEdge}
                onRemove={removeEdge}
                canRemove={edges.length > 1}
              />
            ))}
          </tbody>
        </table>

        {tablePageCount > 1 && (
          <div className="widget-controls" style={{ marginTop: '0.5rem' }}>
            <button
              type="button"
              className="btn-reset"
              disabled={safeTablePage <= 0}
              onClick={() => setTablePage((p) => Math.max(0, p - 1))}
            >
              边表上一页
            </button>
            <span className="step-label">
              边表 {safeTablePage + 1}/{tablePageCount}
            </span>
            <button
              type="button"
              className="btn-reset"
              disabled={safeTablePage >= tablePageCount - 1}
              onClick={() => setTablePage((p) => Math.min(tablePageCount - 1, p + 1))}
            >
              边表下一页
            </button>
          </div>
        )}

        <button
          type="button"
          className="btn-add"
          onClick={addEdge}
          disabled={edges.length >= MAX_EDGES}
          style={{
            marginTop: '0.5rem',
            width: '100%',
            padding: '0.4rem',
            fontSize: '0.8rem',
            cursor: edges.length >= MAX_EDGES ? 'default' : 'pointer',
            background: 'var(--accent-soft)',
            border: '1px dashed var(--border)',
            borderRadius: '0.35rem',
            color: 'var(--ink-secondary)',
          }}
        >
          + 添加一条边
        </button>
      </div>

      <div className="widget-controls">
        {!solved ? (
          <button type="button" className="btn-match" onClick={runKruskalAlg} disabled={running}>
            {running ? '计算中…' : '运行 Kruskal'}
          </button>
        ) : (
          <>
            <button type="button" className="btn-match" onClick={stepPrev} disabled={currentStep < 0}>
              ◀ 上一步
            </button>
            <button
              type="button"
              className="btn-match"
              onClick={stepNext}
              disabled={currentStep >= steps.length - 1}
            >
              下一步 ▶
            </button>
          </>
        )}
        <button type="button" className="btn-reset" onClick={rebuild}>
          重置
        </button>
        {solved && currentStep >= 0 && (
          <span className="profit">
            MST 边权和: <strong>{steps[currentStep]?.mstCost ?? 0}</strong>
          </span>
        )}
        <span className="step-label">
          步骤 {solved ? currentStep + 1 : 0} / {steps.length}
        </span>
      </div>

      {status && <p className="widget-info">{status}</p>}

      {solved && currentStep >= 0 && steps[currentStep] && (
        <div className="augmentation-info">
          <p>
            <strong>
              {steps[currentStep].action === 'accept' ? '接受' : '跳过'} 第 {currentStep + 1} 条边：
            </strong>{' '}
            ({edges[steps[currentStep].edgeId]?.u}, {edges[steps[currentStep].edgeId]?.v}, w=
            {edges[steps[currentStep].edgeId]?.w})
          </p>
          <p>{steps[currentStep].reason}</p>
          <p>
            <strong>MST 边权和：</strong>
            {steps[currentStep].mstCost}
          </p>
        </div>
      )}

      {drawableEdges.length > 0 && (
        <div className="widget-svg-wrap">
          <svg viewBox="0 0 400 320" role="img" aria-label="Kruskal 图示">
            {drawableEdges.map((e) => {
              const from = nodePositions[e.u];
              const to = nodePositions[e.v];
              if (!from || !to) return null;
              const isMst = mstEdgeIds.has(e.id);
              const isCurrent = currentEdgeId === e.id;
              const showLabel = !heavy || isMst || isCurrent;
              return (
                <g key={e.id}>
                  <line
                    x1={from.x}
                    y1={from.y}
                    x2={to.x}
                    y2={to.y}
                    stroke={isMst ? 'var(--mark)' : isCurrent ? '#c47b1a' : 'var(--rule-strong)'}
                    strokeWidth={isMst ? 3 : isCurrent ? 2.5 : 1.25}
                    opacity={isMst || isCurrent ? 1 : heavy ? 0.35 : 1}
                  />
                  {showLabel && (
                    <text
                      x={(from.x + to.x) / 2}
                      y={(from.y + to.y) / 2 - 6}
                      textAnchor="middle"
                      className="edge-label"
                      fill={isMst ? 'var(--mark)' : isCurrent ? '#c47b1a' : 'var(--ink-3)'}
                    >
                      {e.w}
                    </text>
                  )}
                </g>
              );
            })}
            {nodePositions.slice(1).map((pos, i) => (
              <g key={i}>
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r={18}
                  fill="var(--mark-soft)"
                  stroke="var(--mark)"
                  strokeWidth={2}
                />
                <text x={pos.x} y={pos.y + 1} textAnchor="middle" className="node-label" dy="0.35em">
                  {i + 1}
                </text>
              </g>
            ))}
          </svg>
        </div>
      )}

      <div className="widget-note">
        <p>
          大图：输入防抖 {EDGE_EDIT_DEBOUNCE_MS}ms · 边表分页 {TABLE_PAGE_SIZE} · SVG 超过{' '}
          {SVG_HEAVY_THRESHOLD} 条只绘 MST/当前边/抽样。
        </p>
      </div>
    </div>
  );
}
