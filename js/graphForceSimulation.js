// 「網狀圖譜」的物理模擬引擎——純邏輯，完全不碰 DOM，方便獨立測試、
// 之後想換渲染方式（SVG／Canvas）也不用動這裡一行。
//
// 採用經典的 force-directed graph 演算法（概念上跟 d3-force 一樣，但這裡
// 手刻不依賴外部函式庫——這個專案一直是零框架、手刻渲染邏輯的風格，
// 跟 graphConnections.js 手刻 SVG 平滑折線路徑是同一種考量，不為了一個
// 圖表效果就多引入一包依賴）：
//   1. 排斥力（Repulsion）：任兩個節點之間都互相推開，模擬同電荷排斥，
//      距離越近推力越大，避免所有節點擠成一團。
//   2. 引力（Attraction／Spring）：有關係連線的兩個節點之間像彈簧一樣
//      互相拉近，離「自然長度」越遠拉力越大，讓有關係的人物自然聚在一起。
//   3. 置中力（Centering）：所有節點都被輕輕拉向畫布中心，避免整個圖
//      隨著時間慢慢漂移到畫面外面。
//   4. 阻尼（Damping）：每一格速度乘上一個小於 1 的係數，模擬摩擦力，
//      讓系統最終會「靜止」下來，不會永遠抖動。
//   5. 碰撞避免（Collision）：兩個節點距離小於各自半徑加總時直接推開，
//      保證人名文字不會完全疊在一起看不清楚——純靠排斥力調參數很難同時
//      兼顧「疏密好看」跟「絕對不重疊」兩個目標，這裡分開處理更可靠。
export const SIM_DEFAULTS = {
  // 排斥力／彈簧自然長度都調大過一輪——原本的數值在人物比較多（5、6 個
  // 以上）時，節點會擠在畫布中央黏成一團、幾乎疊在一起，人名看不清楚也
  // 分不出誰跟誰有關係；調大之後角色球體會自動散開成看得出彼此距離感的
  // 疏密關係，跟關係線的自然長度（springLength）也拉開，圖看起來更像
  // 「一張關係圖」而不是「一坨圓點」。
  repulsionStrength: 4200,
  springStrength: 0.02,
  springLength: 200,
  centeringStrength: 0.015,
  damping: 0.82,
};

// nodes: [{ id, x, y, vx, vy, r, fixed }]——fixed 為 true 的節點是使用者正在
// 拖曳中的那一顆，物理模擬完全跳過它（不計算受力、不更新位置），呼叫端
// 直接把它的 x/y 設成滑鼠/手指目前的座標，體感才會是「跟著手指走」，
// 不是「手指鬆開節點才追上去」。
// edges: [{ source, target }]，source/target 是節點 id（不是陣列索引）。
// 回傳 { maxSpeed }：所有非固定節點裡最大的速度分量，呼叫端可以用這個
// 判斷「系統是不是已經穩定下來了」，決定要不要停止繼續呼叫這個函式
// （見 graphForceView.js 的動畫迴圈）。
export function stepSimulation(nodes, edges, width, height, options = {}) {
  const opts = { ...SIM_DEFAULTS, ...options };
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const fx = new Map(nodes.map((n) => [n.id, 0]));
  const fy = new Map(nodes.map((n) => [n.id, 0]));

  // 1. 排斥力：每一對節點都互推，O(n²) 對這個用途（一本書的人物通常
  // 幾個到幾十個，不會是幾千個）完全夠快，不需要 quadtree 這類優化。
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      let distSq = dx * dx + dy * dy;
      if (distSq < 1) distSq = 1; // 避免兩點幾乎重疊時除以 0 炸開
      const dist = Math.sqrt(distSq);
      const force = opts.repulsionStrength / distSq;
      const fxC = (dx / dist) * force;
      const fyC = (dy / dist) * force;
      fx.set(a.id, fx.get(a.id) + fxC);
      fy.set(a.id, fy.get(a.id) + fyC);
      fx.set(b.id, fx.get(b.id) - fxC);
      fy.set(b.id, fy.get(b.id) - fyC);
    }
  }

  // 2. 彈簧引力：沿著每條關係線互拉，displacement 是「目前距離」跟
  // 「彈簧自然長度」的差——比自然長度遠就拉近，比自然長度近（很少見，
  // 通常是排斥力還沒推開）就推遠，兩個方向共用同一條公式。
  for (const edge of edges) {
    const a = nodeById.get(edge.source);
    const b = nodeById.get(edge.target);
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
    const displacement = dist - opts.springLength;
    const force = opts.springStrength * displacement;
    const fxC = (dx / dist) * force;
    const fyC = (dy / dist) * force;
    fx.set(a.id, fx.get(a.id) + fxC);
    fy.set(a.id, fy.get(a.id) + fyC);
    fx.set(b.id, fx.get(b.id) - fxC);
    fy.set(b.id, fy.get(b.id) - fyC);
  }

  // 3. 置中力：輕輕拉向畫布中心，係數刻意調得很小（0.015），只是防止
  // 整體隨時間漂移，不會蓋過排斥力／彈簧力原本該呈現的疏密關係。
  const cx = width / 2;
  const cy = height / 2;
  for (const n of nodes) {
    fx.set(n.id, fx.get(n.id) + (cx - n.x) * opts.centeringStrength);
    fy.set(n.id, fy.get(n.id) + (cy - n.y) * opts.centeringStrength);
  }

  // 套用力、更新速度／位置——拖曳中的節點（fixed）完全跳過，呼叫端會
  // 自己直接設定它的 x/y，這裡動它的話會跟拖曳事件的座標互相打架。
  let maxSpeed = 0;
  for (const n of nodes) {
    if (n.fixed) {
      n.vx = 0;
      n.vy = 0;
      continue;
    }
    n.vx = (n.vx + fx.get(n.id)) * opts.damping;
    n.vy = (n.vy + fy.get(n.id)) * opts.damping;
    n.x += n.vx;
    n.y += n.vy;
    maxSpeed = Math.max(maxSpeed, Math.abs(n.vx), Math.abs(n.vy));
  }

  // 4. 碰撞避免：距離小於「兩者半徑加總＋一點緩衝」的節點，直接各退讓
  // 一半的重疊量——這是位置層級的硬性修正（不是力），保證視覺上兩個
  // 人名圓圈絕對不會完全疊在一起看不清楚，跟上面的排斥力分開處理、
  // 互不衝突（排斥力負責「疏密好看」的長期趨勢，這裡負責「絕對不
  // 重疊」的下限保證）。
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const minDist = (a.r || 0) + (b.r || 0) + 28;
      if (dist < minDist) {
        const overlap = (minDist - dist) / 2;
        const ux = dx / dist;
        const uy = dy / dist;
        if (!a.fixed) { a.x -= ux * overlap; a.y -= uy * overlap; }
        if (!b.fixed) { b.x += ux * overlap; b.y += uy * overlap; }
      }
    }
  }

  return { maxSpeed };
}

// 初始位置：沿著一個圓圈平均分佈（不是隨機亂灑）——force simulation 對
// 初始位置其實不敏感（跑幾格之後自然會被推開排好），但一開始就用圓形
// 排列，畫面「還沒穩定下來」的那零點幾秒過渡動畫看起來比隨機亂點收斂
// 更順眼、更容易讓人理解「這是同一群東西在自己找位置」，不是雜訊。
export function initialCirclePosition(index, total, centerX, centerY, radius) {
  if (total <= 1) return { x: centerX, y: centerY };
  const angle = (index / total) * Math.PI * 2;
  return {
    x: centerX + Math.cos(angle) * radius,
    y: centerY + Math.sin(angle) * radius,
  };
}
