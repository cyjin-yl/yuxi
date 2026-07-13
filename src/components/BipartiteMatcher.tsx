import { useState, useEffect, useCallback } from 'react';

interface Node {
  id: number;
  label: string;
  x: number;
  y: number;
  side: 'left' | 'right';
  b: number; // 粮食
  c: number; // 价值
  matched: boolean;
}

interface Edge {
  from: number;
  to: number;
  weight: number; // b_i * c_j + b_j * c_i
  matched: boolean;
  valid: boolean; // gcd condition
}

// Compute prime factorization count (with multiplicity)
function countPrimeFactors(n: number): number {
  let cnt = 0;
  for (let d = 2; d * d <= n; d++) {
    while (n % d === 0) {
      cnt++;
      n /= d;
    }
  }
  if (n > 1) cnt++;
  return cnt;
}

// Check if a number is prime
function isPrime(n: number): boolean {
  if (n < 2) return false;
  for (let i = 2; i * i <= n; i++) {
    if (n % i === 0) return false;
  }
  return true;
}

function gcd(a: number, b: number): number {
  while (b) {
    [a, b] = [b, a % b];
  }
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

export default function BipartiteMatcher() {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selectedEdge, setSelectedEdge] = useState<number | null>(null);
  const [totalProfit, setTotalProfit] = useState(0);
  const [step, setStep] = useState(0);
  const [inputValues, setInputValues] = useState(SAMPLE_INPUTS.map(n => ({ a: n.a, b: n.b, c: n.c })));

  const rebuild = useCallback(() => {
    const width = 600;
    const leftX = 100;
    const rightX = 500;
    const paddingY = 30;

    const newNodes: Node[] = inputValues.map((v, i) => {
      const pf = countPrimeFactors(v.a);
      const side: 'left' | 'right' = (pf % 2 === 1) ? 'left' : 'right';
      const x = side === 'left' ? leftX : rightX;
      const y = paddingY + (i * 180) / inputValues.length;
      return {
        id: i,
        label: String(v.a),
        x,
        y,
        side,
        b: v.b,
        c: v.c,
        matched: false,
      };
    });

    const newEdges: Edge[] = [];
    for (let i = 0; i < newNodes.length; i++) {
      for (let j = i + 1; j < newNodes.length; j++) {
        const ni = newNodes[i];
        const nj = newNodes[j];
        if (ni.side === nj.side) continue; // same side, no edge

        const g = gcd(Number(ni.label), Number(nj.label));
        const xi = Number(ni.label) / g;
        const xj = Number(nj.label) / g;

        const cond1 = (xi === 1 && xj > 1 && isPrime(xj)) || (xj === 1 && xi > 1 && isPrime(xi));
        const weight = ni.b * nj.c + nj.b * ni.c;

        newEdges.push({
          from: ni.side === 'left' ? i : j,
          to: ni.side === 'right' ? i : j,
          weight,
          matched: false,
          valid: cond1,
        });
      }
    }

    setNodes(newNodes);
    setEdges(newEdges.filter(e => e.valid));
    setSelectedEdge(null);
    setTotalProfit(0);
    setStep(0);
  }, [inputValues]);

  useEffect(() => {
    rebuild();
  }, [rebuild]);

  const greedyMatch = () => {
    const sortedEdges = [...edges].filter(e => e.valid).sort((a, b) => b.weight - a.weight);
    const matchedLeft = new Set<number>();
    const matchedRight = new Set<number>();
    let profit = 0;
    const steps: { edgeIdx: number; profit: number }[] = [];

    sortedEdges.forEach(edge => {
      if (matchedLeft.has(edge.from) || matchedRight.has(edge.to)) return;
      matchedLeft.add(edge.from);
      matchedRight.add(edge.to);
      profit += edge.weight;
      steps.push({ edgeIdx: edges.indexOf(edge), profit });
    });

    // Apply final state
    setNodes(prev => prev.map(n => {
      if (matchedLeft.has(n.id) || matchedRight.has(n.id)) {
        return { ...n, matched: true };
      }
      return n;
    }));
    setEdges(prev => prev.map(e => {
      const matchedLeftSet = new Set(matchedLeft);
      const matchedRightSet = new Set(matchedRight);
      if (matchedLeftSet.has(e.from) && matchedRightSet.has(e.to)) {
        return { ...e, matched: true };
      }
      return e;
    }));
    setTotalProfit(profit);
    setStep(steps.length);
  };

  const reset = () => {
    rebuild();
  };

  const updateInput = (idx: number, field: 'a' | 'b' | 'c', val: number) => {
    const next = [...inputValues];
    next[idx][field] = val;
    setInputValues(next);
  };

  const validEdges = edges.filter(e => e.valid);
  const sortedEdges = [...validEdges].sort((a, b) => b.weight - a.weight);

  return (
    <div className="widget-container">
      <div className="widget-header">
        <h3>二分图最大权匹配模拟器</h3>
        <p className="widget-subtitle">修改参数，点击"贪心匹配"查看匹配过程</p>
      </div>

      <div className="widget-inputs">
        <table>
          <thead>
            <tr>
              <th>编号</th>
              <th>a (数字)</th>
              <th>b (粮食)</th>
              <th>c (价值)</th>
              <th>质因数个数</th>
            </tr>
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
        <button className="btn-match" onClick={greedyMatch}>贪心匹配（按权降序）</button>
        <button className="btn-reset" onClick={reset}>重置</button>
        <span className="profit">总收益: <strong>{totalProfit}</strong></span>
      </div>

      <div className="widget-svg-wrap">
        <svg viewBox="0 0 600 {paddingY * 2 + (inputValues.length * 180) / inputValues.length}" style={{ width: '100%', height: 'auto' }}>
          {validEdges.map((edge, i) => {
            const fromNode = nodes[edge.from];
            const toNode = nodes[edge.to];
            if (!fromNode || !toNode) return null;
            return (
              <g key={i}>
                <line
                  x1={fromNode.x} y1={fromNode.y}
                  x2={toNode.x} y2={toNode.y}
                  stroke={edge.matched ? '#e91e63' : '#ccc'}
                  strokeWidth={edge.matched ? 3 : 1.5}
                  strokeOpacity={edge.matched ? 1 : 0.4}
                  onClick={() => setSelectedEdge(selectedEdge === i ? null : i)}
                  style={{ cursor: 'pointer' }}
                />
                {selectedEdge === i && (
                  <text
                    x={(fromNode.x + toNode.x) / 2}
                    y={(fromNode.y + toNode.y) / 2 - 8}
                    textAnchor="middle"
                    className="edge-label"
                  >
                    w={edge.weight}
                  </text>
                )}
              </g>
            );
          })}

          {nodes.map(node => (
            <g key={node.id}>
              <circle
                cx={node.x} cy={node.y} r={28}
                fill={node.matched ? '#e91e63' : node.side === 'left' ? '#bbdefb' : '#c8e6c9'}
                stroke={node.side === 'left' ? '#1976d2' : '#388e3c'}
                strokeWidth={2}
                style={{ cursor: 'pointer', transition: 'fill 0.3s' }}
              />
              <text x={node.x} y={node.y - 5} textAnchor="middle" className="node-label">
                {node.label}
              </text>
              <text x={node.x} y={node.y + 12} textAnchor="middle" className="node-meta">
                b={node.b}, c={node.c}
              </text>
            </g>
          ))}
        </svg>
      </div>

      {sortedEdges.length > 0 && (
        <div className="widget-edge-list">
          <h4>边按权重降序排列（贪心顺序）</h4>
          <ol>
            {sortedEdges.map((e, i) => (
              <li key={i} className={e.matched ? 'matched' : ''}>
                城市 {e.from + 1} ↔ 城市 {e.to + 1}
                <span className="edge-w">w = {e.weight}</span>
                {e.matched && <span className="badge">✓ 匹配</span>}
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="widget-note">
        <p>⚠️ 贪心策略（按权降序选边）不一定最优。实际 AC 代码使用 <strong>SPFA 最长路费用流</strong>，能保证全局最优。</p>
      </div>
    </div>
  );
}
