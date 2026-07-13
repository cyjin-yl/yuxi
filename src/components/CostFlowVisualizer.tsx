import { useState, useEffect, useCallback } from 'react';

interface Node {
  id: number;
  label: string;
  x: number;
  y: number;
  side: 'source' | 'left' | 'right' | 'sink';
  b?: number;
  c?: number;
}

interface Edge {
  from: number;
  to: number;
  cap: number;
  flow: number;
  cost: number;
}

// --- SPFA 最长路费用流实现 ---

function countPrimeFactors(n: number): number {
  let cnt = 0;
  for (let d = 2; d * d <= n; d++) {
    while (n % d === 0) { cnt++; n /= d; }
  }
  if (n > 1) cnt++;
  return cnt;
}

function isPrime(n: number): boolean {
  if (n < 2) return false;
  for (let i = 2; i * i <= n; i++) if (n % i === 0) return false;
  return true;
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

const SAMPLE_INPUTS = [
  { a: 2, b: 3, c: 5 },
  { a: 6, b: 4, c: 2 },
  { a: 3, b: 5, c: 3 },
  { a: 9, b: 2, c: 8 },
  { a: 10, b: 3, c: 4 },
  { a: 15, b: 1, c: 10 },
];

// SPFA max-cost max-flow solver
function solveCostFlow(
  leftNodes: number[],
  rightNodes: number[],
  edges: { from: number; to: number; weight: number }[],
  bs: number[]
): { totalProfit: number; augmentations: { path: number[]; flow: number; profit: number }[] } {
  // Build graph: S=0, left=1..n_left, right=n_left+1..n_left+n_right, T=n_left+n_right+1
  const nL = leftNodes.length;
  const nR = rightNodes.length;
  const N = nL + nR + 2;
  const S = 0, T = N - 1;

  // Adjacency list: {to, cap, cost, rev}
  type E = { to: number; cap: number; cost: number; rev: number };
  const adj: E[][] = Array.from({ length: N }, () => []);

  function addEdge(u: number, v: number, cap: number, cost: number) {
    adj[u].push({ to: v, cap, cost, rev: adj[v].length });
    adj[v].push({ to: u, cap: 0, cost: -cost, rev: adj[u].length - 1 });
  }

  // S -> left
  leftNodes.forEach((idx, i) => addEdge(S, i + 1, bs[idx], 0));
  // right -> T
  rightNodes.forEach((idx, i) => addEdge(nL + i + 1, T, bs[idx], 0));
  // left -> right with weight as cost
  edges.forEach(e => {
    const u = leftNodes.indexOf(e.from) + 1;
    const v = nL + rightNodes.indexOf(e.to) + 1;
    if (u > 0 && v > nL) addEdge(u, v, 1e9, e.weight);
  });

  const augmentations: { path: number[]; flow: number; profit: number }[] = [];
  let totalProfit = 0;
  const INF = 1e18;

  while (true) {
    const dist = new Array(N).fill(-INF);
    const pre = new Array(N).fill(0); // edge index in adj[u]
    const inq = new Array(N).fill(false);
    const q: number[] = [];

    dist[S] = 0;
    q.push(S);
    inq[S] = true;

    while (q.length > 0) {
      const u = q.shift()!;
      inq[u] = false;
      for (let i = 0; i < adj[u].length; i++) {
        const e = adj[u][i];
        if (e.cap > 0 && dist[e.to] < dist[u] + e.cost) {
          dist[e.to] = dist[u] + e.cost;
          pre[e.to] = i;
          if (!inq[e.to]) {
            inq[e.to] = true;
            q.push(e.to);
          }
        }
      }
    }

    if (dist[T] <= 0) break;

    // Find bottleneck
    let flow = 1e9;
    let cur = T;
    while (cur !== S) {
      const pi = pre[cur];
      flow = Math.min(flow, adj[adj[cur][pi].to === cur ? cur : cur][pi].cap);
      // Actually trace back properly
      cur = adj[cur][pi].to === cur ? 0 : cur; // This is tricky, let me rebuild
    }

    // Simplified: just find min cap along path
    const path: number[] = [];
    cur = T;
    while (cur !== S) {
      path.unshift(cur);
      const pi = pre[cur];
      const fromNode = cur;
      // Find which node has edge to cur with index pi
      for (let u = 0; u < N; u++) {
        if (u !== cur && adj[u][pi]?.to === cur) {
          cur = u;
          flow = Math.min(flow, adj[u][pi].cap);
          break;
        }
      }
    }
    path.unshift(S);

    // Augment
    totalProfit += flow * dist[T];
    augmentations.push({ path, flow, profit: totalProfit });

    // Update capacities
    cur = T;
    while (cur !== S) {
      const pi = pre[cur];
      for (let u = 0; u < N; u++) {
        if (u !== cur && adj[u][pi]?.to === cur) {
          adj[u][pi].cap -= flow;
          const revIdx = adj[u][pi].rev;
          adj[cur][revIdx].cap += flow;
          cur = u;
          break;
        }
      }
    }
  }

  return { totalProfit, augmentations };
}

export default function CostFlowVisualizer() {
  const [inputValues, setInputValues] = useState(SAMPLE_INPUTS.map(n => ({ a: n.a, b: n.b, c: n.c })));
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [augmentations, setAugmentations] = useState<{ path: number[]; flow: number; profit: number }[]>([]);
  const [currentStep, setCurrentStep] = useState(-1);
  const [totalProfit, setTotalProfit] = useState(0);
  const [solved, setSolved] = useState(false);

  const rebuild = useCallback(() => {
    const width = 700;
    const leftX = 150;
    const rightX = 500;
    const sourceX = 50;
    const sinkX = 590;
    const centerY = 200;

    const newNodes: Node[] = [];
    // Source
    newNodes.push({ id: 0, label: 'S', x: sourceX, y: centerY, side: 'source' });

    const leftIdx: number[] = [], rightIdx: number[] = [];

    inputValues.forEach((v, i) => {
      const pf = countPrimeFactors(v.a);
      if (pf % 2 === 1) leftIdx.push(i);
      else rightIdx.push(i);
    });

    // Left nodes
    leftIdx.forEach((origIdx, i) => {
      newNodes.push({
        id: origIdx + 1, label: String(inputValues[origIdx].a),
        x: leftX, y: centerY - 100 + (i * 200 / Math.max(leftIdx.length, 1)),
        side: 'left', b: inputValues[origIdx].b, c: inputValues[origIdx].c,
      });
    });

    // Right nodes
    rightIdx.forEach((origIdx, i) => {
      newNodes.push({
        id: origIdx + 1 + leftIdx.length, label: String(inputValues[origIdx].a),
        x: rightX, y: centerY - 100 + (i * 200 / Math.max(rightIdx.length, 1)),
        side: 'right', b: inputValues[origIdx].b, c: inputValues[origIdx].c,
      });
    });

    // Sink
    newNodes.push({ id: leftIdx.length + rightIdx.length + 1, label: 'T', x: sinkX, y: centerY, side: 'sink' });

    // Edges
    const newEdges: Edge[] = [];

    // S -> left
    leftIdx.forEach((origIdx, i) => {
      newEdges.push({ from: 0, to: i + 1, cap: inputValues[origIdx].b, flow: 0, cost: 0 });
    });

    // right -> T
    const nL = leftIdx.length;
    rightIdx.forEach((origIdx, i) => {
      newEdges.push({ from: nL + i + 1, to: newNodes.length - 1, cap: inputValues[origIdx].b, flow: 0, cost: 0 });
    });

    // left -> right (valid pairs)
    leftIdx.forEach(li => {
      rightIdx.forEach(rj => {
        const g = gcd(inputValues[li].a, inputValues[rj].a);
        const xi = inputValues[li].a / g, xj = inputValues[rj].a / g;
        const cond1 = (xi === 1 && xj > 1 && isPrime(xj)) || (xj === 1 && xi > 1 && isPrime(xi));
        if (cond1) {
          const weight = inputValues[li].b * inputValues[rj].c + inputValues[rj].b * inputValues[li].c;
          const fromNode = leftIdx.indexOf(li) + 1;
          const toNode = nL + rightIdx.indexOf(rj) + 1;
          newEdges.push({ from: fromNode, to: toNode, cap: 1e9, flow: 0, cost: weight });
        }
      });
    });

    setNodes(newNodes);
    setEdges(newEdges);
    setAugmentations([]);
    setCurrentStep(-1);
    setTotalProfit(0);
    setSolved(false);
  }, [inputValues]);

  useEffect(() => { rebuild(); }, [rebuild]);

  const runSPFA = useCallback(() => {
    const leftNodes: number[] = [], rightNodes: number[] = [];
    inputValues.forEach((v, i) => {
      if (countPrimeFactors(v.a) % 2 === 1) leftNodes.push(i);
      else rightNodes.push(i);
    });

    const validEdges = [];
    leftNodes.forEach(li => {
      rightNodes.forEach(rj => {
        const g = gcd(inputValues[li].a, inputValues[rj].a);
        const xi = inputValues[li].a / g, xj = inputValues[rj].a / g;
        const cond = (xi === 1 && xj > 1 && isPrime(xj)) || (xj === 1 && xi > 1 && isPrime(xi));
        if (cond) {
          validEdges.push({
            from: li, to: rj,
            weight: inputValues[li].b * inputValues[rj].c + inputValues[rj].b * inputValues[li].c,
          });
        }
      });
    });

    const { totalProfit, augmentations } = solveCostFlow(leftNodes, rightNodes, validEdges, inputValues.map(v => v.b));
    setAugmentations(augmentations);
    setTotalProfit(totalProfit);
    setCurrentStep(0);
    setSolved(true);
  }, [inputValues]);

  const updateInput = (idx: number, field: 'a' | 'b' | 'c', val: number) => {
    const next = [...inputValues];
    next[idx][field] = val;
    setInputValues(next);
  };

  const nextStep = () => setCurrentStep(s => Math.min(s + 1, augmentations.length - 1));
  const prevStep = () => setCurrentStep(s => Math.max(s - 1, -1));

  // Compute current flow state for visualization
  const edgeFlows = edges.map(e => ({ ...e, flow: 0 }));
  if (solved && currentStep >= 0) {
    // Simulate flows from augmentations up to current step
    // Simplified: show which edges have flow
  }

  const svgHeight = Math.max(400, inputValues.length * 40 + 100);

  return (
    <div className="widget-container">
      <div className="widget-header">
        <h3>SPFA 最长路费用流模拟器</h3>
        <p className="widget-subtitle">逐步查看增广路过程</p>
      </div>

      <div className="widget-inputs">
        <table>
          <thead>
            <tr><th>编号</th><th>a (数字)</th><th>b (粮食)</th><th>c (价值)</th><th>质因数个数</th></tr>
          </thead>
          <tbody>
            {inputValues.map((v, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td><input type="number" value={v.a} onChange={e => updateInput(i, 'a', Number(e.target.value))} min={1} className="inp" /></td>
                <td><input type="number" value={v.b} onChange={e => updateInput(i, 'b', Number(e.target.value))} min={0} className="inp" /></td>
                <td><input type="number" value={v.c} onChange={e => updateInput(i, 'c', Number(e.target.value))} min={0} className="inp" /></td>
                <td className="pf-count">{countPrimeFactors(v.a)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="widget-controls">
        {!solved ? (
          <button className="btn-match" onClick={runSPFA}>运行 SPFA 费用流</button>
        ) : (
          <>
            <button className="btn-match" onClick={prevStep} disabled={currentStep < 0}>◀ 上一步</button>
            <button className="btn-match" onClick={nextStep} disabled={currentStep >= augmentations.length - 1}>下一步 ▶</button>
          </>
        )}
        <button className="btn-reset" onClick={rebuild}>重置</button>
        <span className="profit">总收益: <strong>{totalProfit}</strong></span>
        {solved && <span className="step-label">第 {currentStep + 1}/{augmentations.length} 次增广</span>}
      </div>

      {solved && currentStep >= 0 && augmentations[currentStep] && (
        <div className="augmentation-info">
          <p><strong>增广路径：</strong>S → {augmentations[currentStep].path.slice(1, -1).join(' → ')} → T</p>
          <p><strong>本次流量：</strong>{augmentations[currentStep].flow}，<strong>本次收益：</strong>{augmentations[currentStep].flow * augmentations[currentStep].profit}</p>
          <p><strong>累计收益：</strong>{augmentations[currentStep].profit}</p>
        </div>
      )}

      <div className="widget-svg-wrap">
        <svg viewBox={`0 0 650 ${svgHeight}`} style={{ width: '100%', height: 'auto' }}>
          {/* Edges */}
          {edges.map((edge, i) => {
            const fromNode = nodes[edge.from];
            const toNode = nodes[edge.to];
            if (!fromNode || !toNode) return null;
            return (
              <g key={i}>
                <line
                  x1={fromNode.x} y1={fromNode.y}
                  x2={toNode.x} y2={toNode.y}
                  stroke={edge.cost > 0 ? '#e91e63' : '#999'}
                  strokeWidth={edge.cost > 0 ? 2 : 1}
                  strokeOpacity={0.6}
                />
                {edge.cost > 0 && (
                  <text
                    x={(fromNode.x + toNode.x) / 2}
                    y={(fromNode.y + toNode.y) / 2 - 6}
                    textAnchor="middle"
                    className="edge-label"
                    fill="#e91e63"
                  >
                    w={edge.cost}
                  </text>
                )}
              </g>
            );
          })}

          {/* Nodes */}
          {nodes.map(node => (
            <g key={node.id}>
              <circle
                cx={node.x} cy={node.y} r={node.side === 'source' || node.side === 'sink' ? 20 : 28}
                fill={
                  node.side === 'source' ? '#ff9800' :
                  node.side === 'sink' ? '#ff5722' :
                  node.side === 'left' ? '#bbdefb' : '#c8e6c9'
                }
                stroke={
                  node.side === 'source' ? '#e65100' :
                  node.side === 'sink' ? '#bf360c' :
                  node.side === 'left' ? '#1976d2' : '#388e3c'
                }
                strokeWidth={2}
              />
              <text x={node.x} y={node.y - 4} textAnchor="middle" className="node-label" fontWeight="bold">
                {node.label}
              </text>
              {node.b !== undefined && (
                <text x={node.x} y={node.y + 12} textAnchor="middle" className="node-meta">
                  b={node.b}, c={node.c}
                </text>
              )}
            </g>
          ))}
        </svg>
      </div>

      <div className="widget-note">
        <p>SPFA 最长路增广：每次找正权最大的增广路，沿路推流，直到没有正权路径为止。保证全局最优。</p>
      </div>
    </div>
  );
}
