// 「網狀圖譜」檢視——跟 js/graphBoardView.js 並列的另一個檢視模組，讀寫的是
// 完全相同的 groups/nodes/edges（見 js/graph.js 開頭的架構說明）。跟陣營看板
// 那種「群組卡片＋自由拖放定位」的呈現方式不同，這裡是手刻的力導向物理
// 模擬（見 js/graphForceSimulation.js）：人物是自由漂浮的圓圈節點，關係是
// 連著兩顆節點的線，位置由物理模擬自動排開，不用使用者手動一張一張卡片
// 去拖。
//
// 這個檢視預設是手機／平板（≤1024px）的預設畫面，並且是「點兩下建立關係」
// （Tap to Link）流程唯一會用到的地方——陣營看板維持原本側邊抽屜裡的
// 下拉選單表單，這裡改成直接在畫布上點選人物卡片操作：
//   1. 點一下人物 A → 彈出極簡選單（🔗 連結／✏️ 編輯）
//   2. 選「🔗 連結」→ 該節點外圈亮起提示「正在等你選下一個人」
//   3. 點一下人物 B → 彈出單一文字輸入框（關係名稱），Enter 或按「建立」
//      直接寫入一段新關係，自動畫出箭頭與標籤
// 全程刻意不出現任何預設關係清單選單，維持規格要求的「介面極致乾淨」。
import {
  DEFAULT_EDGE_COLOR,
  colorId,
  effectiveEdgeColor,
  hasEndArrow,
  hasStartArrow,
} from './graphModel.js';
import { stepSimulation, initialCirclePosition } from './graphForceSimulation.js';

const NODE_RADIUS = 24;
const PROTAGONIST_RADIUS = 29;
const UNGROUPED_NODE_COLOR = '#9a9188';
// 模擬跑到「最快的節點速度」低於這個門檻，畫面已經肉眼看不出還在動，
// 停止繼續呼叫 requestAnimationFrame，省得背景一直空轉耗電——見下面
// tick() 的判斷。拖曳節點的當下無論如何都繼續跑（見呼叫端 draggingNodeId）。
const SETTLE_SPEED_THRESHOLD = 0.04;

// 節點在畫布上的座標／速度盡量跨次重繪保留：使用者編輯一個人物的名字、
// 新增一段關係都會觸發 reload() 整批重新呼叫 renderNetworkView()，如果
// 每次都重新灑一次初始位置，畫面會像「整張圖被打散重排」，體感很差。
// 只有 id 是第一次出現的新節點才會被指派全新位置，其餘節點接著上一次
// 模擬跑到的地方繼續呼吸，不是每次都從頭來過。用模組層級變數（不是
// renderNetworkView 內部的區域變數）就是為了讓它活得比單次呼叫更久。
const positionsByNodeId = new Map();
let animationFrameId = null;
let draggingNodeId = null;
let linking = null; // { sourceId } —— 目前是否處在「已選第一個人、等待點第二個人」的連結模式
let activeMenu = null; // 目前開著的浮動小選單／輸入框，同時間只允許存在一個

function closeActiveMenu() {
  if (activeMenu) {
    activeMenu.remove();
    activeMenu = null;
  }
}
// 點畫面任何地方（含畫布以外）都順手關掉還開著的浮動選單，跟站內其他
// 浮動面板（例如 bookStatusPopover）同一種「點外面自動收起」的習慣。
// 點在人物節點上的這次點擊要排除在外：節點的 pointerdown/pointerup 判斷
// 已經在 handleNodeTap() 裡自己決定「要不要開新選單」，而瀏覽器在
// pointerup 之後、緊接著同一個手勢還會補發一個原生 click 事件往上冒泡——
// 這裡如果來者不拒地一律關閉，剛剛在 handleNodeTap() 裡才開出來的選單
// 會被自己這個補發的 click 事件立刻關掉，選單等於完全打不開。
document.addEventListener('click', (event) => {
  if (event.target.closest('.network-node')) return;
  closeActiveMenu();
});

// 浮動小面板共用的定位邏輯：以觸發節點在螢幕上的座標為錨點，往下浮一點，
// 超出視窗邊界時自動內縮／改往上浮，不會被裁在畫面外面點不到。
function positionFloating(el, anchorRect) {
  el.style.top = `${anchorRect.bottom + 8}px`;
  el.style.left = `${anchorRect.left + anchorRect.width / 2}px`;
  requestAnimationFrame(() => {
    const rect = el.getBoundingClientRect();
    let left = anchorRect.left + anchorRect.width / 2 - rect.width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - rect.width - 8));
    let top = anchorRect.bottom + 8;
    if (top + rect.height > window.innerHeight - 8) top = anchorRect.top - rect.height - 8;
    el.style.left = `${left}px`;
    el.style.top = `${Math.max(8, top)}px`;
  });
}

// 「🔗 連結／✏️ 編輯」極簡選單——刻意只有這兩顆按鈕，不塞更多預設選項。
function showQuickMenu(anchorRect, options) {
  closeActiveMenu();
  const menu = document.createElement('div');
  menu.className = 'graph-quick-menu';
  menu.innerHTML = options.map((opt, i) => `<button type="button" data-idx="${i}">${opt.label}</button>`).join('');
  document.body.appendChild(menu);
  menu.addEventListener('click', (event) => event.stopPropagation());
  menu.querySelectorAll('button').forEach((btn, i) => {
    btn.addEventListener('click', () => {
      closeActiveMenu();
      options[i].onSelect();
    });
  });
  positionFloating(menu, anchorRect);
  activeMenu = menu;
}

// 建立關係用的極簡文字輸入框——只有一個關係名稱欄位，沒有方向／顏色／
// 線型這些進階選項（那些留給陣營看板的完整表單，或事後點這條線用
// showEdgePanel 補上），符合規格要求的「極簡自填」。
function showLinkLabelInput(anchorRect, onConfirm) {
  closeActiveMenu();
  const box = document.createElement('form');
  box.className = 'graph-quick-menu graph-link-input';
  box.innerHTML = `
    <input type="text" name="label" placeholder="關係（例：朋友、敵人、家人...）" maxlength="30">
    <button type="submit">建立</button>
  `;
  document.body.appendChild(box);
  box.addEventListener('click', (event) => event.stopPropagation());
  box.addEventListener('submit', (event) => {
    event.preventDefault();
    const label = box.elements.label.value.trim();
    closeActiveMenu();
    onConfirm(label);
  });
  positionFloating(box, anchorRect);
  activeMenu = box;
  requestAnimationFrame(() => box.elements.label.focus());
}

function clearLinking(svgEl) {
  linking = null;
  svgEl.querySelectorAll('.network-node.is-linking-source').forEach((el) => el.classList.remove('is-linking-source'));
}

// ctx: { state, DB, bookId, svgEl, wrapEl, reload, showPersonPanel, showEdgePanel }
// svgEl 是網狀圖譜自己專用的一個 <svg>（跟陣營看板的 connections-svg 是
// 不同元素，兩者是 .canvas-board 底下互斥顯示的手足層，見 graph.js 樣板）。
export function renderNetworkView(ctx) {
  const {
    state, DB, bookId, svgEl, wrapEl, reload, showPersonPanel, showEdgePanel,
  } = ctx;
  const { nodes: people, edges: edgeRecords, groups } = state;

  // 每次重繪都是「換了一本書」或「資料整批 reload 完成」之後才會呼叫，
  // 上一次還沒完成的連結流程／選單一定跟這次的資料對不上了，直接清掉，
  // 避免使用者切換書籍或整批重新整理後點到殘留的舊連結狀態。
  linking = null;
  draggingNodeId = null;
  closeActiveMenu();

  const width = Math.max(wrapEl.clientWidth - 64, 320);
  const height = Math.max(wrapEl.clientHeight - 64, 320);
  svgEl.setAttribute('width', width);
  svgEl.setAttribute('height', height);
  svgEl.setAttribute('viewBox', `0 0 ${width} ${height}`);

  const groupColorById = new Map(groups.map((g) => [g.id, g.color]));

  // 幫每個目前存在的人物準備模擬用的節點物件：已經有位置紀錄的人接著
  // 上次的位置／速度繼續跑，全新出現的人物沿著畫布中心一圈平均分佈
  // （見 initialCirclePosition 的說明），不是疊在同一個點爆開。
  const simNodes = people.map((person, index) => {
    let pos = positionsByNodeId.get(person.id);
    if (!pos) {
      const seed = initialCirclePosition(index, people.length, width / 2, height / 2, Math.min(width, height) / 3);
      pos = { x: seed.x, y: seed.y, vx: 0, vy: 0 };
      positionsByNodeId.set(person.id, pos);
    }
    return {
      id: person.id,
      x: pos.x,
      y: pos.y,
      vx: pos.vx,
      vy: pos.vy,
      r: person.isProtagonist ? PROTAGONIST_RADIUS : NODE_RADIUS,
      fixed: false,
      person,
    };
  });
  const simNodeById = new Map(simNodes.map((n) => [n.id, n]));
  const simEdges = edgeRecords
    .filter((e) => simNodeById.has(e.fromNodeId) && simNodeById.has(e.toNodeId))
    .map((e) => ({ source: e.fromNodeId, target: e.toNodeId, record: e }));

  // ---- 整批重建 DOM（位置延續靠上面的 positionsByNodeId，不是靠保留舊的
  // DOM 節點）——跟陣營看板 draw() 整批重寫 trackEl.innerHTML 是同一種
  // 「資料是唯一事實來源，畫面整批照資料重畫」的作法。 ----
  const svgNS = 'http://www.w3.org/2000/svg';
  svgEl.innerHTML = '';

  const defs = document.createElementNS(svgNS, 'defs');
  const usedColors = new Set(simEdges.map((e) => effectiveEdgeColor(e.record)));
  usedColors.forEach((color) => {
    const id = colorId(color);
    const marker = document.createElementNS(svgNS, 'marker');
    marker.setAttribute('id', `network-arrow-${id}`);
    marker.setAttribute('viewBox', '0 -5 10 10');
    marker.setAttribute('refX', '9');
    marker.setAttribute('refY', '0');
    marker.setAttribute('markerWidth', '7');
    marker.setAttribute('markerHeight', '7');
    marker.setAttribute('markerUnits', 'userSpaceOnUse');
    marker.setAttribute('orient', 'auto');
    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute('d', 'M0,-5L10,0L0,5Z');
    path.setAttribute('fill', color);
    marker.appendChild(path);
    defs.appendChild(marker);
  });
  svgEl.appendChild(defs);

  const edgeEls = new Map();
  for (const e of simEdges) {
    const line = document.createElementNS(svgNS, 'line');
    const edgeColor = effectiveEdgeColor(e.record);
    line.setAttribute('stroke', edgeColor);
    line.setAttribute('stroke-width', '1.5');
    if (e.record.lineStyle === 'dashed') line.setAttribute('stroke-dasharray', '6,4');
    if (hasEndArrow(e.record)) line.setAttribute('marker-end', `url(#network-arrow-${colorId(edgeColor)})`);
    if (hasStartArrow(e.record)) line.setAttribute('marker-start', `url(#network-arrow-${colorId(edgeColor)})`);
    line.style.cursor = 'pointer';
    line.addEventListener('click', (event) => {
      event.stopPropagation();
      showEdgePanel(e.record);
    });
    svgEl.appendChild(line);

    let label = null;
    if (e.record.label) {
      label = document.createElementNS(svgNS, 'text');
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('dominant-baseline', 'middle');
      label.setAttribute('font-size', '11');
      label.setAttribute('font-weight', '700');
      label.setAttribute('fill', edgeColor);
      label.style.cursor = 'pointer';
      // 文字加一圈跟畫布同色的描邊當底色（paint-order 讓描邊畫在文字下面），
      // 線穿過標籤中央時文字仍然清楚可讀，不用另外畫一顆背景膠囊矩形。
      label.style.paintOrder = 'stroke';
      label.style.stroke = 'var(--surface, #fff)';
      label.style.strokeWidth = '3px';
      label.textContent = e.record.label;
      label.addEventListener('click', (event) => {
        event.stopPropagation();
        showEdgePanel(e.record);
      });
      svgEl.appendChild(label);
    }
    edgeEls.set(e, { line, label });
  }

  const nodeEls = new Map();
  for (const n of simNodes) {
    const g = document.createElementNS(svgNS, 'g');
    g.setAttribute('class', `network-node${n.person.isProtagonist ? ' is-protagonist' : ''}`);
    g.style.cursor = 'pointer';

    const circle = document.createElementNS(svgNS, 'circle');
    circle.setAttribute('r', String(n.r));
    circle.setAttribute('fill', groupColorById.get(n.person.groupId) || UNGROUPED_NODE_COLOR);
    circle.setAttribute('stroke', '#fff');
    circle.setAttribute('stroke-width', '2');
    g.appendChild(circle);

    const text = document.createElementNS(svgNS, 'text');
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'middle');
    text.setAttribute('font-size', '11');
    text.setAttribute('font-weight', '600');
    text.setAttribute('fill', '#fff');
    // 人名文字固定是白色，但名字長度常常比圓圈直徑寬，超出圓圈範圍的那一截
    // 會直接疊在畫布底色上——日間模式的畫布底色是接近白色的米白色，白字疊
    // 白底那一截完全看不見（夜間模式底色深，白字反而沒有這個問題，所以只
    // 有日間模式會實際看到這個 Bug）。加一圈深色描邊當文字的「邊框」，不管
    // 文字最後落在彩色圓圈上還是溢出到畫布底色上，都靠這圈深色邊界跟四周
    // 分開，兩種模式都看得清楚，比另外判斷背景色來源動態換文字顏色更簡單、
    // 也更不會有算錯的風險。
    text.style.paintOrder = 'stroke';
    text.style.stroke = 'rgba(0, 0, 0, 0.55)';
    text.style.strokeWidth = '3px';
    text.style.strokeLinejoin = 'round';
    text.textContent = (n.person.isProtagonist ? '★ ' : '') + n.person.label;
    g.appendChild(text);

    svgEl.appendChild(g);
    nodeEls.set(n.id, g);
  }

  // ---- 每一格模擬：更新座標、寫回 positionsByNodeId（讓下次重繪接續），
  // 套用到節點與連線的 DOM ----
  function paint() {
    for (const n of simNodes) {
      const g = nodeEls.get(n.id);
      if (g) g.setAttribute('transform', `translate(${n.x},${n.y})`);
      const pos = positionsByNodeId.get(n.id);
      if (pos) { pos.x = n.x; pos.y = n.y; pos.vx = n.vx; pos.vy = n.vy; }
    }
    for (const e of simEdges) {
      const a = simNodeById.get(e.source);
      const b = simNodeById.get(e.target);
      const els = edgeEls.get(e);
      if (!a || !b || !els) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy) || 1;
      const ux = dx / dist;
      const uy = dy / dist;
      // 線的起訖點縮進到圓圈邊緣，不是節點正中心——不然線會直接貫穿
      // 圓圈畫到人名文字正中央，箭頭也會被圓圈蓋住看不到。
      const x1 = a.x + ux * a.r;
      const y1 = a.y + uy * a.r;
      const x2 = b.x - ux * b.r;
      const y2 = b.y - uy * b.r;
      els.line.setAttribute('x1', x1);
      els.line.setAttribute('y1', y1);
      els.line.setAttribute('x2', x2);
      els.line.setAttribute('y2', y2);
      if (els.label) {
        els.label.setAttribute('x', (x1 + x2) / 2);
        els.label.setAttribute('y', (y1 + y2) / 2 - 6);
      }
    }
  }
  paint();

  function tick() {
    // 使用者切換到陣營看板、切到別本書、或整個離開頁面時，這個 SVG 元素
    // 會從畫面上被拿掉（hidden 或整批被新的 innerHTML 取代）——這裡用
    // isConnected 當一個簡單的安全網，元素一旦離開文件就自然停止繼續跑
    // 物理模擬，不會留下一個永遠背景空轉、找不到對象可以更新的殭屍迴圈。
    if (!svgEl.isConnected) { animationFrameId = null; return; }
    const { maxSpeed } = stepSimulation(simNodes, simEdges, width, height);
    paint();
    if (maxSpeed > SETTLE_SPEED_THRESHOLD || draggingNodeId != null) {
      animationFrameId = requestAnimationFrame(tick);
    } else {
      animationFrameId = null;
    }
  }
  if (animationFrameId) cancelAnimationFrame(animationFrameId);
  animationFrameId = requestAnimationFrame(tick);

  function handleNodeTap(n, g) {
    const rect = g.querySelector('circle').getBoundingClientRect();
    if (linking && linking.sourceId === n.id) {
      // 點回起點自己＝取消這次連結。
      clearLinking(svgEl);
      return;
    }
    if (linking) {
      const sourceId = linking.sourceId;
      clearLinking(svgEl);
      showLinkLabelInput(rect, async (label) => {
        await DB.add('edges', {
          bookId,
          fromNodeId: sourceId,
          toNodeId: n.id,
          label,
          direction: 'forward',
          color: DEFAULT_EDGE_COLOR,
          lineStyle: 'solid',
        });
        await reload();
      });
      return;
    }
    showQuickMenu(rect, [
      {
        label: '🔗 連結',
        onSelect: () => {
          linking = { sourceId: n.id };
          g.classList.add('is-linking-source');
        },
      },
      {
        label: '✏️ 編輯',
        onSelect: () => showPersonPanel(n.person),
      },
    ]);
  }

  // 節點拖曳／點擊：用 Pointer Events 判斷「這是拖曳還是單純點一下」
  // （5px 位移門檻），跟陣營看板的人物卡片拖放（graphDragDrop.js）、
  // 群組卡片拖放是同一套判斷手法，觸控與滑鼠共用同一份程式碼。
  for (const n of simNodes) {
    const g = nodeEls.get(n.id);
    g.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      closeActiveMenu();
      const startX = event.clientX;
      const startY = event.clientY;
      let dragging = false;

      function onMove(moveEvent) {
        if (!dragging) {
          if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 5) return;
          dragging = true;
          draggingNodeId = n.id;
          n.fixed = true;
          if (!animationFrameId) animationFrameId = requestAnimationFrame(tick);
        }
        const svgRect = svgEl.getBoundingClientRect();
        // 縮放（.canvas-board 的 CSS transform:scale）會讓螢幕座標跟 SVG
        // 內部座標系不再是 1:1，先量出目前實際的縮放比例再換算，不然
        // 縮小檢視時拖曳節點會有「手指移動 1px、節點卻跳好幾 px」這種
        // 對不齊手感。
        const scaleX = svgRect.width / width || 1;
        const scaleY = svgRect.height / height || 1;
        n.x = (moveEvent.clientX - svgRect.left) / scaleX;
        n.y = (moveEvent.clientY - svgRect.top) / scaleY;
        paint();
      }
      function onUp() {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        if (!dragging) {
          handleNodeTap(n, g);
          return;
        }
        draggingNodeId = null;
        n.fixed = false;
      }
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    });
  }

  // 點畫布空白處：取消連結中的狀態、關閉還開著的浮動選單，維持乾淨。
  // 同樣要排除點在節點上這次的原生 click（見上面 document 層級監聽器的
  // 說明，是同一個「pointerup 之後還會補發一次 click」的瀏覽器行為）。
  svgEl.addEventListener('click', (event) => {
    if (event.target.closest('.network-node')) return;
    closeActiveMenu();
    clearLinking(svgEl);
  });
}
