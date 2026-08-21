import { useState, useCallback, useMemo, useEffect, useRef } from 'react';

interface Node {
  id: number;
  label: string;
  x: number;
  y: number;
  side: 'source' | 'left' | 'right' | 'sink';
  b?: number;
  c?: number;
  origIdx?: number;
}

interface Edge {
  from: number;
  to: number;
  cap: number;
  flow: number;
  cost: number;
}

function countPrimeFactors(n: number): number {
  if (!Number.isFinite(n) || n <= 1) return 0;
  let x = Math.floor(Math.abs(n));
  let cnt = 0;
  for (let d = 2; d * d <= x; d++) {
    while (x % d === 0) {
      cnt++;
      x = Math.floor(x / d);
    }
  }
  if (x > 1) cnt++;
  return cnt;
}

function isPrime(n: number): boolean {
  if (n < 2 || !Number.isFinite(n)) return false;
  const x = Math.floor(n);
  if (x % 2 === 0) return x === 2;
  for (let i = 3; i * i <= x; i += 2) if (x % i === 0) return false;
  return true;
}

function gcd(a: number, b: number): number {
  let x = Math.abs(Math.floor(a));
  let y = Math.abs(Math.floor(b));
  while (y) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x;
}

const SAMPLE_INPUTS = [
  { a: 2, b: 3, c: 5 },
  { a: 6, b: 4, c: 2 },
  { a: 3, b: 5, c: 3 },
  { a: 9, b: 2, c: 8 },
  { a: 10, b: 3, c: 4 },
  { a: 15, b: 1, c: 10 },
];

type GraphEdge = { to: number; cap: number; cost: number; rev: number };

interface AugStep {
  /** Solver node ids along S…T */
  path: number[];
  flow: number;
  profit: number;
  pathCost: number;
  /** Residual edge snapshots after this augmentation (from→to remaining cap) */
  residual: { from: number; to: number; cap: number; cost: number }[];
}

/**
 * Max-cost max-flow via successive longest-path SPFA on residual network.
 * Unit pairing profit is c_i + c_j (not b_i*c_j + b_j*c_i).
 */
function solveCostFlow(
  leftNodes: number[],
  rightNodes: number[],
  validEdges: { from: number; to: number; unitCost: number }[],
  bs: number[],
): { totalProfit: number; augmentations: AugStep[] } {
  const nL = leftNodes.length;
  const nR = rightNodes.length;
  const N = nL + nR + 2;
  const S = 0;
  const T = N - 1;

  const adj: GraphEdge[][] = Array.from({ length: N }, () => []);

  function addEdge(u: number, v: number, cap: number, cost: number) {
    adj[u].push({ to: v, cap, cost, rev: adj[v].length });
    adj[v].push({ to: u, cap: 0, cost: -cost, rev: adj[u].length - 1 });
  }

  leftNodes.forEach((idx, i) => addEdge(S, i + 1, Math.max(0, bs[idx] | 0), 0));
  rightNodes.forEach((idx, i) => addEdge(nL + i + 1, T, Math.max(0, bs[idx] | 0), 0));

  validEdges.forEach((e) => {
    const u = leftNodes.indexOf(e.from) + 1;
    const v = nL + rightNodes.indexOf(e.to) + 1;
    if (u > 0 && v > nL) {
      // capacity large; actual flow limited by S→L and R→T
      addEdge(u, v, 1e9, e.unitCost);
    }
  });

  const augmentations: AugStep[] = [];
  let totalProfit = 0;
  const NEG = Number.NEGATIVE_INFINITY;
  const MAX_AUG = 5000; // safety

  for (let round = 0; round < MAX_AUG; round++) {
    const dist = new Array(N).fill(NEG);
    const preNode = new Array(N).fill(-1);
    const preIdx = new Array(N).fill(-1);
    const inq = new Array(N).fill(false);
    // SPFA with SLF + visit cap against rare bad graphs
    const visits = new Array(N).fill(0);
    const q: number[] = [];

    dist[S] = 0;
    q.push(S);
    inq[S] = true;

    let qi = 0;
    let ok = true;
    while (qi < q.length) {
      const u = q[qi++];
      inq[u] = false;
      if (++visits[u] > N) {
        // potential positive cycle — abort this SPFA
        ok = false;
        break;
      }
      for (let i = 0; i < adj[u].length; i++) {
        const e = adj[u][i];
        if (e.cap <= 0) continue;
        const nd = dist[u] + e.cost;
        if (dist[e.to] < nd) {
          dist[e.to] = nd;
          preNode[e.to] = u;
          preIdx[e.to] = i;
          if (!inq[e.to]) {
            // Small Label First: push front if better than head
            if (q.length > qi && dist[e.to] > dist[q[qi]]) {
              q.splice(qi, 0, e.to);
            } else {
              q.push(e.to);
            }
            inq[e.to] = true;
          }
        }
      }
    }

    if (!ok || !Number.isFinite(dist[T]) || dist[T] <= 0) break;
    if (preNode[T] < 0) break;

    // bottleneck
    let flow = 1e9;
    let cur = T;
    while (cur !== S) {
      const pn = preNode[cur];
      const pi = preIdx[cur];
      if (pn < 0 || pi < 0) {
        flow = 0;
        break;
      }
      flow = Math.min(flow, adj[pn][pi].cap);
      cur = pn;
    }
    if (flow <= 0 || !Number.isFinite(flow)) break;

    // path S → T
    const revPath: number[] = [];
    cur = T;
    while (cur !== S) {
      revPath.unshift(cur);
      cur = preNode[cur];
      if (cur < 0) break;
    }
    revPath.unshift(S);
    if (revPath[0] !== S) break;

    const pathCost = dist[T];
    totalProfit += flow * pathCost;

    // push flow
    cur = T;
    while (cur !== S) {
      const pn = preNode[cur];
      const pi = preIdx[cur];
      adj[pn][pi].cap -= flow;
      const rev = adj[pn][pi].rev;
      adj[cur][rev].cap += flow;
      cur = pn;
    }

    // residual snapshot of forward edges with remaining cap or cost≠0 original
    const residual: AugStep['residual'] = [];
    for (let u = 0; u < N; u++) {
      for (const e of adj[u]) {
        // only store original-direction-ish: positive cost or from S/to T structure
        if (e.cap > 0) residual.push({ from: u, to: e.to, cap: e.cap, cost: e.cost });
      }
    }

    augmentations.push({
      path: revPath,
      flow,
      profit: totalProfit,
      pathCost,
      residual,
    });
  }

  return { totalProfit, augmentations };
}

function canPair(ai: number, aj: number): boolean {
  if (ai <= 0 || aj <= 0) return false;
  const g = gcd(ai, aj);
  const xi = ai / g;
  const xj = aj / g;
  return (xi === 1 && xj > 1 && isPrime(xj)) || (xj === 1 && xi > 1 && isPrime(xi));
}

export default function CostFlowVisualizer() {
  const [inputValues, setInputValues] = useState(
    SAMPLE_INPUTS.map((n) => ({ a: n.a, b: n.b, c: n.c })),
  );
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [augmentations, setAugmentations] = useState<AugStep[]>([]);
  const [currentStep, setCurrentStep] = useState(-1);
  const [totalProfit, setTotalProfit] = useState(0);
  const [solved, setSolved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoRun = useRef(true);

  const buildGraph = useCallback((values: typeof inputValues) => {
    const leftIdx: number[] = [];
    const rightIdx: number[] = [];
    values.forEach((v, i) => {
      if (countPrimeFactors(v.a) % 2 === 1) leftIdx.push(i);
      else rightIdx.push(i);
    });

    const nL = leftIdx.length;
    const nR = rightIdx.length;
    const S = 0;
    const T = nL + nR + 1;

    const width = 650;
    const leftX = 160;
    const rightX = 480;
    const sourceX = 50;
    const sinkX = 600;
    const h = Math.max(360, Math.max(nL, nR, 1) * 56 + 80);
    const centerY = h / 2;

    const newNodes: Node[] = [];
    newNodes.push({ id: S, label: 'S', x: sourceX, y: centerY, side: 'source' });

    leftIdx.forEach((origIdx, i) => {
      const y =
        nL === 1 ? centerY : 40 + (i * (h - 80)) / Math.max(nL - 1, 1);
      newNodes.push({
        id: i + 1,
        label: String(values[origIdx].a),
        x: leftX,
        y,
        side: 'left',
        b: values[origIdx].b,
        c: values[origIdx].c,
        origIdx,
      });
    });

    rightIdx.forEach((origIdx, i) => {
      const y =
        nR === 1 ? centerY : 40 + (i * (h - 80)) / Math.max(nR - 1, 1);
      newNodes.push({
        id: nL + i + 1,
        label: String(values[origIdx].a),
        x: rightX,
        y,
        side: 'right',
        b: values[origIdx].b,
        c: values[origIdx].c,
        origIdx,
      });
    });

    newNodes.push({ id: T, label: 'T', x: sinkX, y: centerY, side: 'sink' });

    const newEdges: Edge[] = [];
    leftIdx.forEach((origIdx, i) => {
      newEdges.push({
        from: S,
        to: i + 1,
        cap: Math.max(0, values[origIdx].b | 0),
        flow: 0,
        cost: 0,
      });
    });
    rightIdx.forEach((origIdx, i) => {
      newEdges.push({
        from: nL + i + 1,
        to: T,
        cap: Math.max(0, values[origIdx].b | 0),
        flow: 0,
        cost: 0,
      });
    });

    leftIdx.forEach((li, i) => {
      rightIdx.forEach((rj, j) => {
        if (!canPair(values[li].a, values[rj].a)) return;
        // unit profit = c_i + c_j
        const unit = values[li].c + values[rj].c;
        newEdges.push({
          from: i + 1,
          to: nL + j + 1,
          cap: 1e9,
          flow: 0,
          cost: unit,
        });
      });
    });

    return {
      nodes: newNodes,
      edges: newEdges,
      leftIdx,
      rightIdx,
      height: h,
    };
  }, []);

  const runSPFA = useCallback(
    (values: typeof inputValues = inputValues) => {
      setError(null);
      const { nodes: ns, edges: es, leftIdx, rightIdx } = buildGraph(values);
      setNodes(ns);
      setEdges(es);

      const validEdges: { from: number; to: number; unitCost: number }[] = [];
      leftIdx.forEach((li) => {
        rightIdx.forEach((rj) => {
          if (!canPair(values[li].a, values[rj].a)) return;
          validEdges.push({
            from: li,
            to: rj,
            unitCost: values[li].c + values[rj].c,
          });
        });
      });

      try {
        const result = solveCostFlow(
          leftIdx,
          rightIdx,
          validEdges,
          values.map((v) => v.b),
        );
        setAugmentations(result.augmentations);
        setTotalProfit(result.totalProfit);
        setCurrentStep(result.augmentations.length ? 0 : -1);
        setSolved(true);

        // apply residual of first step onto display edges if any
        if (result.augmentations.length > 0) {
          applyResidualToEdges(es, result.augmentations[0]);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'SPFA 运行失败');
        setSolved(false);
        setAugmentations([]);
        setTotalProfit(0);
      }
    },
    [buildGraph, inputValues],
  );

  function applyResidualToEdges(base: Edge[], aug: AugStep) {
    // recompute displayed flow as originalCap - residualCap for matching directed edges
    const resMap = new Map<string, number>();
    for (const r of aug.residual) {
      resMap.set(`${r.from}-${r.to}`, r.cap);
    }
    setEdges(
      base.map((e) => {
        const key = `${e.from}-${e.to}`;
        const rem = resMap.has(key) ? (resMap.get(key) as number) : 0;
        // If edge not in residual list with cap, remaining is 0 (fully used or never stored)
        // For infinite caps, residual may still be large
        const remaining = resMap.has(key) ? rem : e.cap >= 1e9 ? e.cap : 0;
        const used =
          e.cap >= 1e9
            ? Math.max(0, 1e9 - remaining) > 1e8
              ? 0
              : Math.max(0, 1e9 - remaining)
            : Math.max(0, e.cap - remaining);
        return { ...e, flow: used };
      }),
    );
  }

  const rebuild = useCallback(() => {
    const { nodes: ns, edges: es } = buildGraph(inputValues);
    setNodes(ns);
    setEdges(es);
    setAugmentations([]);
    setCurrentStep(-1);
    setTotalProfit(0);
    setSolved(false);
    setError(null);
  }, [buildGraph, inputValues]);

  // Rebuild layout + auto-run when inputs change (debounced)
  useEffect(() => {
    const { nodes: ns, edges: es } = buildGraph(inputValues);
    setNodes(ns);
    setEdges(es);
    setAugmentations([]);
    setCurrentStep(-1);
    setTotalProfit(0);
    setSolved(false);

    if (!autoRun.current) return;
    const t = setTimeout(() => runSPFA(inputValues), 180);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputValues, buildGraph]);

  // Update edge residual display when stepping
  useEffect(() => {
    if (!solved || currentStep < 0 || !augmentations[currentStep]) return;
    const { edges: base } = buildGraph(inputValues);
    applyResidualToEdges(base, augmentations[currentStep]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep, solved, augmentations, inputValues, buildGraph]);

  const updateInput = (idx: number, field: 'a' | 'b' | 'c', val: number) => {
    setInputValues((prev) => {
      const next = prev.map((row, i) =>
        i === idx ? { ...row, [field]: Number.isFinite(val) ? val : 0 } : row,
      );
      return next;
    });
  };

  const addRow = () => setInputValues((prev) => [...prev, { a: 1, b: 1, c: 1 }]);
  const removeRow = (idx: number) => {
    if (inputValues.length <= 1) return;
    setInputValues((prev) => prev.filter((_, i) => i !== idx));
  };

  const svgHeight = useMemo(
    () => Math.max(360, nodes.reduce((m, n) => Math.max(m, n.y), 0) + 60),
    [nodes],
  );

  const nodeMap = useMemo(() => {
    const m = new Map<number, Node>();
    nodes.forEach((n) => m.set(n.id, n));
    return m;
  }, [nodes]);

  const highlightEdge = useMemo(() => {
    if (!solved || currentStep < 0 || !augmentations[currentStep]) return new Set<string>();
    const p = augmentations[currentStep].path;
    const set = new Set<string>();
    for (let i = 0; i < p.length - 1; i++) set.add(`${p[i]}-${p[i + 1]}`);
    return set;
  }, [solved, currentStep, augmentations]);

  const highlightNode = useMemo(() => {
    if (!solved || currentStep < 0 || !augmentations[currentStep]) return new Set<number>();
    return new Set(augmentations[currentStep].path);
  }, [solved, currentStep, augmentations]);

  const pathLabels = (path: number[]) =>
    path
      .map((id) => nodeMap.get(id)?.label ?? String(id))
      .join(' → ');

  return (
    <div className="widget-container">
      <div className="widget-header">
        <h3>SPFA 最长路费用流模拟器</h3>
        <p className="widget-subtitle">
          单位配对收益为 cᵢ + cⱼ；残量网络上反复最长路增广。节点编号与求解器一致。
        </p>
      </div>

      <div className="widget-inputs">
        <table>
          <thead>
            <tr>
              <th>编号</th>
              <th>a (数字)</th>
              <th>b (数量)</th>
              <th>c (价值)</th>
              <th>质因数个数</th>
              <th>侧</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {inputValues.map((v, i) => {
              const pf = countPrimeFactors(v.a);
              return (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td>
                    <input
                      type="number"
                      value={v.a}
                      onChange={(e) => updateInput(i, 'a', Number(e.target.value))}
                      min={1}
                      className="inp"
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      value={v.b}
                      onChange={(e) => updateInput(i, 'b', Number(e.target.value))}
                      min={0}
                      className="inp"
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      value={v.c}
                      onChange={(e) => updateInput(i, 'c', Number(e.target.value))}
                      min={0}
                      className="inp"
                    />
                  </td>
                  <td className="pf-count">{pf}</td>
                  <td className="pf-count">{pf % 2 === 1 ? 'L' : 'R'}</td>
                  <td>
                    <button
                      type="button"
                      className="btn-remove"
                      onClick={() => removeRow(i)}
                      disabled={inputValues.length <= 1}
                      title="删除此行"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <button
          type="button"
          className="btn-add"
          onClick={addRow}
          style={{
            marginTop: '0.5rem',
            width: '100%',
            padding: '0.4rem',
            fontSize: '0.8rem',
            cursor: 'pointer',
            background: 'var(--accent-soft)',
            border: '1px dashed var(--border)',
            borderRadius: '0.35rem',
            color: 'var(--ink-secondary)',
          }}
        >
          + 添加一行
        </button>
      </div>

      <div className="widget-controls">
        {!solved ? (
          <button type="button" className="btn-match" onClick={() => runSPFA()}>
            运行 SPFA 费用流
          </button>
        ) : (
          <>
            <button
              type="button"
              className="btn-match"
              onClick={() => setCurrentStep((s) => Math.max(s - 1, -1))}
              disabled={currentStep < 0}
            >
              ◀ 上一步
            </button>
            <button
              type="button"
              className="btn-match"
              onClick={() =>
                setCurrentStep((s) => Math.min(s + 1, augmentations.length - 1))
              }
              disabled={currentStep >= augmentations.length - 1}
            >
              下一步 ▶
            </button>
          </>
        )}
        <button type="button" className="btn-reset" onClick={rebuild}>
          重置
        </button>
        <span className="profit">
          总收益: <strong>{totalProfit}</strong>
        </span>
        {solved && (
          <span className="step-label">
            增广路 {augmentations.length === 0 ? 0 : currentStep + 1} / {augmentations.length}
          </span>
        )}
      </div>

      {error && (
        <p className="widget-info" style={{ color: 'var(--slop, #c62828)' }}>
          {error}
        </p>
      )}

      {solved && currentStep >= 0 && augmentations[currentStep] && (
        <div className="augmentation-info">
          <p>
            <strong>当前增广路径：</strong>
            {pathLabels(augmentations[currentStep].path)}
          </p>
          <p>
            <strong>本次流量：</strong>
            {augmentations[currentStep].flow}
            {' · '}
            <strong>路径单位费用：</strong>
            {augmentations[currentStep].pathCost}
            {' · '}
            <strong>本次收益：</strong>
            {augmentations[currentStep].flow * augmentations[currentStep].pathCost}
          </p>
          <p>
            <strong>累计收益：</strong>
            {augmentations[currentStep].profit}
          </p>
        </div>
      )}

      {solved && augmentations.length === 0 && (
        <p className="widget-info">无正权增广路，总收益为 0。</p>
      )}

      {nodes.length > 0 && (
        <div className="widget-svg-wrap">
          <svg viewBox={`0 0 650 ${svgHeight}`} role="img" aria-label="费用流残量网络">
            {edges.map((edge, i) => {
              const fromNode = nodeMap.get(edge.from);
              const toNode = nodeMap.get(edge.to);
              if (!fromNode || !toNode) return null;
              const key = `${edge.from}-${edge.to}`;
              const isHighlighted = highlightEdge.has(key);
              const isPair = edge.cost > 0;
              return (
                <g key={i}>
                  <line
                    x1={fromNode.x}
                    y1={fromNode.y}
                    x2={toNode.x}
                    y2={toNode.y}
                    stroke={
                      isHighlighted ? '#c47b1a' : isPair ? 'var(--mark)' : 'var(--rule-strong)'
                    }
                    strokeWidth={isHighlighted ? 3 : isPair ? 2 : 1.25}
                    strokeOpacity={isHighlighted ? 1 : 0.65}
                  />
                  {isPair && (
                    <text
                      x={(fromNode.x + toNode.x) / 2}
                      y={(fromNode.y + toNode.y) / 2 - 6}
                      textAnchor="middle"
                      className="edge-label"
                      fill={isHighlighted ? '#c47b1a' : 'var(--mark)'}
                    >
                      c={edge.cost}
                    </text>
                  )}
                </g>
              );
            })}

            {nodes.map((node) => {
              const isHighlighted = highlightNode.has(node.id);
              return (
                <g key={node.id}>
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={node.side === 'source' || node.side === 'sink' ? 20 : 28}
                    fill={
                      isHighlighted
                        ? 'var(--mark-soft)'
                        : node.side === 'source' || node.side === 'sink'
                          ? 'var(--paper-2)'
                          : node.side === 'left'
                            ? 'var(--mark-soft)'
                            : 'var(--paper-2)'
                    }
                    stroke={isHighlighted ? '#c47b1a' : 'var(--mark)'}
                    strokeWidth={isHighlighted ? 3 : 2}
                  />
                  <text
                    x={node.x}
                    y={node.y - 4}
                    textAnchor="middle"
                    className="node-label"
                    fontWeight="bold"
                  >
                    {node.label}
                  </text>
                  {node.b !== undefined && (
                    <text x={node.x} y={node.y + 12} textAnchor="middle" className="node-meta">
                      b={node.b}, c={node.c}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      )}

      <div className="widget-note">
        <p>
          修正：交叉边单位费用为 <code>cᵢ + cⱼ</code>（每配对 1 次）；S→L / R→T 容量为 b。SPFA
          求最长路，直到无正权路径。路径高亮使用与求解器相同的节点编号。
        </p>
      </div>
    </div>
  );
}
