import { DB } from './db.js';
import { escapeHtml, showToast } from './utils.js';
import { pushEscapeHandler } from './services/keyboardShortcutsService.js';
import { ICON_LINK } from './icons.js';

// 對照 PROJECT_SPEC.md 第 5 節（階層式群組卡片版）：群組容器裝人物卡片，
// 人物跨群組連線標註關係。範圍限單一書籍。
// 關係名稱、人物狀態標籤都是純自由輸入，不提供預設清單——這張圖不是只給推理小說用，
// 也可能拿來畫工具書的概念關係（引申出、反駁…），硬塞一份固定詞彙表反而綁死用途。
const DEFAULT_EDGE_COLOR = '#c2b299';
const DEFAULT_GROUP_COLOR = '#4a2e2b';
// 新增群組時依序輪流套用的 15 色調色盤，深淺都控制在跟白色標題文字有足夠對比的範圍。
const GROUP_COLOR_PALETTE = [
  { name: '莫蘭迪棕', hex: '#8C6D58' },
  { name: '鼠尾草綠', hex: '#728C74' },
  { name: '霧藍', hex: '#5C768D' },
  { name: '灰赤桃', hex: '#A66B6C' },
  { name: '芥末黃', hex: '#C89B3C' },
  { name: '陶土橙', hex: '#B25B42' },
  { name: '板岩灰', hex: '#6A7B82' },
  { name: '薰衣草紫', hex: '#85768D' },
  { name: '橄欖綠', hex: '#5B7355' },
  { name: '珊瑚粉', hex: '#D9787A' },
  { name: '海軍藍', hex: '#2E4057' },
  { name: '勃根地紅', hex: '#6B2D39' },
  { name: '青苔綠', hex: '#4E6A58' },
  { name: '暖焦糖', hex: '#9E623B' },
  { name: '煙燻藍', hex: '#4A5568' },
];

function nextGroupColor(existingGroupCount) {
  return GROUP_COLOR_PALETTE[existingGroupCount % GROUP_COLOR_PALETTE.length].hex;
}

// 關係線顏色改用固定 12 色日系馬卡龍柔和色盤（6 欄 x 2 排整齊對齊），
// 取代原本偏灰暗的莫蘭迪色系——關係線只是分類用途，色調要明亮好認但不刺眼。
const EDGE_COLOR_PALETTE = [
  { name: '鼠尾草綠', hex: '#82A3A1' },
  { name: '靜謐藍綠', hex: '#729B98' },
  { name: '霧藍', hex: '#6B8EA7' },
  { name: '風信子紫', hex: '#8F81A3' },
  { name: '珊瑚暖粉', hex: '#D68F85' },
  { name: '蜜桃杏橘', hex: '#DE9B72' },
  { name: '芥末奶油黃', hex: '#E3B04B' },
  { name: '溫潤淺褐', hex: '#9B8265' },
  { name: '暖心磚紅', hex: '#D4726B' },
  { name: '藍灰', hex: '#7B889B' },
  { name: '深灰藍', hex: '#5B6A72' },
  { name: '可可棕', hex: '#8B6B5D' },
];

function edgeColorNameForHex(hex) {
  const found = EDGE_COLOR_PALETTE.find((c) => c.hex.toLowerCase() === (hex || '').toLowerCase());
  return found ? found.name : null;
}
// 常見關係預設顏色／線寬，選到這些關係字時自動套用，不用手動調
const COUPLE_LABELS = ['戀人', '夫妻'];
const COUPLE_COLOR = '#c9738f';
const FAMILY_LABELS = ['家人'];
const FAMILY_COLOR = '#6b7a8f';
// 所有關係線一律用同一個粗細，只靠顏色分辨關係類型——家人關係線之前故意調粗，
// 反而讓不同關係的線看起來粗細不一致，容易被誤會是顯示錯誤，所以統一掉。
const DEFAULT_STROKE_WIDTH = 1.5;

function presetColorForLabel(label) {
  if (COUPLE_LABELS.includes(label)) return COUPLE_COLOR;
  if (FAMILY_LABELS.includes(label)) return FAMILY_COLOR;
  return null;
}

function strokeWidthForLabel() {
  return DEFAULT_STROKE_WIDTH;
}

// 顏色沒被手動改過（還是預設色）時，依關係字套用常見關係的預設色；
// 使用者手動選過別的顏色就尊重那個選擇，不覆蓋。
function effectiveEdgeColor(edge) {
  if (!edge.color || edge.color === DEFAULT_EDGE_COLOR) {
    return presetColorForLabel(edge.label) || DEFAULT_EDGE_COLOR;
  }
  return edge.color;
}
const DIRECTION_OPTIONS = [
  { value: 'forward', label: '單向（→ 從到）' },
  { value: 'backward', label: '單向（← 到從）' },
  { value: 'both', label: '雙向（↔）' },
  { value: 'none', label: '無方向（— 純線）' },
];
const UNGROUPED = 'ungrouped';

function datalistOptions(list) {
  return list.map((v) => `<option value="${escapeHtml(v)}"></option>`).join('');
}

function directionOptionsHtml(selected) {
  return DIRECTION_OPTIONS.map((opt) => `<option value="${opt.value}" ${opt.value === selected ? 'selected' : ''}>${opt.label}</option>`).join('');
}

function colorId(hex) {
  return (hex || DEFAULT_EDGE_COLOR).replace('#', '');
}

// 選色的共用邏輯：設定隱藏欄位、更新哪個色塊被打勾、更新下方「目前顏色：XX」文字說明。
// 手動點色塊、或關係字自動套用預設色（戀人／家人）都走這一份，狀態才不會兜不起來。
function applyEdgeColor(form, hex) {
  form.elements.color.value = hex;
  form.querySelectorAll('.edge-color-swatch').forEach((b) => b.classList.toggle('is-selected', b.dataset.hex.toLowerCase() === hex.toLowerCase()));
  const label = form.querySelector('.edge-color-current-label');
  if (label) {
    const name = edgeColorNameForHex(hex);
    label.textContent = name ? `目前顏色：${name}` : '';
  }
}

function wireCoupleAutoColor(form) {
  form.elements.label.addEventListener('input', () => {
    const preset = presetColorForLabel(form.elements.label.value.trim());
    if (!preset) return;
    applyEdgeColor(form, preset);
  });
}

function hasEndArrow(d) {
  return d.direction === 'forward' || d.direction === 'both' || !d.direction;
}

function hasStartArrow(d) {
  return d.direction === 'backward' || d.direction === 'both';
}

async function loadGraphData(bookId) {
  const [groups, nodes, edges] = await Promise.all([
    DB.getByIndex('groups', 'bookId', bookId),
    DB.getByIndex('nodes', 'bookId', bookId),
    DB.getByIndex('edges', 'bookId', bookId),
  ]);
  return { groups, nodes, edges };
}

function personItemHtml(person) {
  return `
    <div class="person-item${person.isProtagonist ? ' is-protagonist' : ''}" data-node-id="${person.id}">
      <div class="person-item-main">
        <span class="person-name">${person.isProtagonist ? '★ ' : ''}${escapeHtml(person.label)}</span>
        ${person.title ? `<span class="person-title">${escapeHtml(person.title)}</span>` : ''}
      </div>
      ${person.status ? `<span class="person-status-badge">${escapeHtml(person.status)}</span>` : ''}
    </div>
  `;
}

// 固定 15 色色塊選單，取代原生光譜選色器：按顏色小圓點打開色塊面板，點色塊直接套用。
function colorSwatchPickerHtml(group) {
  const current = group.color || DEFAULT_GROUP_COLOR;
  return `
    <div class="group-color-picker" data-group-id="${group.id}">
      <button type="button" class="group-color-trigger" style="background: ${escapeHtml(current)};" title="群組顏色" aria-label="選擇群組顏色"></button>
      <div class="group-color-swatches" hidden>
        ${GROUP_COLOR_PALETTE.map((c) => `
          <button type="button" class="group-color-swatch${c.hex === current ? ' is-selected' : ''}" data-hex="${c.hex}" style="background: ${c.hex};" data-tooltip="${escapeHtml(c.name)}" aria-label="選擇群組顏色 ${escapeHtml(c.name)}"></button>
        `).join('')}
      </div>
    </div>
  `;
}

// 群組卡片自由定位：x/y 是相對畫布左上角的像素座標，沒存過（舊資料／新群組）就用 fallbackX/Y 排成一個網格當預設位置。
function groupCardHtml(group, people, fallbackX, fallbackY) {
  const x = group.x != null ? group.x : fallbackX;
  const y = group.y != null ? group.y : fallbackY;
  return `
    <div class="group-card" data-group-id="${group.id}" style="--group-color: ${escapeHtml(group.color || DEFAULT_GROUP_COLOR)}; left: ${x}px; top: ${y}px;">
      <div class="group-card-header">
        <div class="group-card-header-main">
          <span class="group-drag-handle" title="按住拖曳到畫布任何位置">⠿</span>
          <input class="group-name-input" data-group-id="${group.id}" value="${escapeHtml(group.name)}">
          ${colorSwatchPickerHtml(group)}
          <button type="button" class="group-delete-btn" data-group-id="${group.id}" title="刪除群組">×</button>
        </div>
        <input class="group-subtitle-input" data-group-id="${group.id}" value="${escapeHtml(group.subtitle || '')}" placeholder="副標（選填）">
      </div>
      <div class="group-card-body" data-drop-group="${group.id}">
        ${people.map(personItemHtml).join('')}
        <form class="quick-add-person-form" data-group-id="${group.id}">
          <input name="name" list="existing-people-list" placeholder="＋ 新增人物，Enter 送出（打已存在的名字會直接移過來，不會重複）">
        </form>
      </div>
    </div>
  `;
}

function ungroupedTrayHtml(people) {
  return `
    <div class="group-card ungrouped-tray">
      <div class="group-card-header">
        <span class="group-name-static">未分組</span>
      </div>
      <div class="group-card-body" data-drop-group="${UNGROUPED}">
        ${people.map(personItemHtml).join('')}
        <p class="graph-hint" style="margin:0;">${people.length === 0 ? '沒有未分組的人物。' : '拖曳人物卡片到上面的群組即可分類。'}</p>
      </div>
    </div>
  `;
}

// 從中心點沿著直線方向，算出跟卡片矩形邊界的交點，讓連線停在卡片邊緣而不是穿過卡片中央。
function edgePointOnRect(rect, center, towardPoint) {
  const dx = towardPoint.x - center.x;
  const dy = towardPoint.y - center.y;
  if (dx === 0 && dy === 0) return center;
  const halfW = rect.width / 2;
  const halfH = rect.height / 2;
  const scaleX = dx !== 0 ? halfW / Math.abs(dx) : Infinity;
  const scaleY = dy !== 0 ? halfH / Math.abs(dy) : Infinity;
  const scale = Math.min(scaleX, scaleY, 1);
  return { x: center.x + dx * scale, y: center.y + dy * scale };
}

function drawConnections(svgEl, boardEl, edges, onEdgeClick) {
  const boardRect = boardEl.getBoundingClientRect();
  // 群組卡片可以自由拖到畫布任何位置，畫布實際大小常常比 boardEl 本身量到的寬高還大
  // （boardEl 的寬度不會因為裡面的絕對定位卡片超出範圍就跟著變寬），
  // 用 group-track 的 scrollWidth/Height 才抓得到真正涵蓋所有卡片的範圍，
  // 不然離比較遠的關係線會被 SVG 自己的寬高裁掉，變成「看不到」。
  const trackEl = boardEl.querySelector('.group-track');
  const svgWidth = Math.max(boardRect.width, trackEl ? trackEl.scrollWidth : 0);
  const svgHeight = Math.max(boardRect.height, trackEl ? trackEl.scrollHeight : 0);
  svgEl.setAttribute('width', svgWidth);
  svgEl.setAttribute('height', svgHeight);
  svgEl.innerHTML = '';

  const validEdges = [];
  for (const edge of edges) {
    const fromEl = boardEl.querySelector(`.person-item[data-node-id="${edge.fromNodeId}"]`);
    const toEl = boardEl.querySelector(`.person-item[data-node-id="${edge.toNodeId}"]`);
    if (!fromEl || !toEl) continue;
    const fromRect = fromEl.getBoundingClientRect();
    const toRect = toEl.getBoundingClientRect();
    const fromCenter = { x: fromRect.left + fromRect.width / 2 - boardRect.left, y: fromRect.top + fromRect.height / 2 - boardRect.top };
    const toCenter = { x: toRect.left + toRect.width / 2 - boardRect.left, y: toRect.top + toRect.height / 2 - boardRect.top };
    validEdges.push({ edge, fromRect, toRect, fromCenter, toCenter });
  }

  // 同兩個人之間如果不小心重複建立了好幾條關係，線跟標籤會疊在完全一樣的位置，
  // 看起來像只有一條、也點不到被蓋住的那幾條。先算出每一對人物之間總共有幾條關係，
  // 等一下畫的時候把重複的標籤依序錯開，讓每一條都能分開看到、分開點擊刪除。
  function pairKeyOf(edge) {
    return [edge.fromNodeId, edge.toNodeId].sort((a, b) => a - b).join('-');
  }
  const pairTotalCount = new Map();
  for (const { edge } of validEdges) {
    const key = pairKeyOf(edge);
    pairTotalCount.set(key, (pairTotalCount.get(key) || 0) + 1);
  }
  const pairSeenIndex = new Map();

  const usedColors = new Set(validEdges.map((v) => effectiveEdgeColor(v.edge)));
  const svgNS = 'http://www.w3.org/2000/svg';
  const defs = document.createElementNS(svgNS, 'defs');
  usedColors.forEach((color) => {
    const id = colorId(color);
    [
      { id: `arrow-end-${id}`, orient: 'auto' },
      { id: `arrow-start-${id}`, orient: 'auto-start-reverse' },
    ].forEach((cfg) => {
      const marker = document.createElementNS(svgNS, 'marker');
      marker.setAttribute('id', cfg.id);
      marker.setAttribute('viewBox', '0 -5 10 10');
      marker.setAttribute('refX', '10');
      marker.setAttribute('refY', '0');
      marker.setAttribute('markerWidth', '7');
      marker.setAttribute('markerHeight', '7');
      // 沒寫 markerUnits 的話 SVG 預設是 strokeWidth，箭頭大小會跟著線粗一起放大——
      // 家人關係線比較粗（strokeWidthForLabel=3），箭頭就被放大成快 2 倍，變成畫面上那種巨大箭頭。
      // 改成 userSpaceOnUse 讓箭頭大小固定，不受線粗影響。
      marker.setAttribute('markerUnits', 'userSpaceOnUse');
      marker.setAttribute('orient', cfg.orient);
      const path = document.createElementNS(svgNS, 'path');
      path.setAttribute('d', 'M0,-5L10,0L0,5Z');
      path.setAttribute('fill', color);
      marker.appendChild(path);
      defs.appendChild(marker);
    });
  });
  svgEl.appendChild(defs);

  for (const { edge, fromRect, toRect, fromCenter, toCenter } of validEdges) {
    // 同一對人物重複建立的關係，依序多拉開一點距離，讓每一條重複的關係都有自己獨立、
    // 點得到的線跟標籤，不會疊在同一個位置。
    const pairKey = pairKeyOf(edge);
    const dupTotal = pairTotalCount.get(pairKey) || 1;
    const dupIndex = pairSeenIndex.get(pairKey) || 0;
    pairSeenIndex.set(pairKey, dupIndex + 1);
    const DUPLICATE_SPACING = 24;
    const dupSpread = dupTotal > 1 ? (dupIndex - (dupTotal - 1) / 2) * DUPLICATE_SPACING : 0;

    // 兩個人物如果落在同一張群組卡片（左右邊界幾乎一樣寬），代表是卡片裡相鄰兩排的人物——
    // 這種關係線跟標籤整組都限制在卡片右邊界「內側」的一條固定直線上（往左 inset 18px），
    // 不管關係方向是誰到誰，都不會超出卡片、也不會蓋到人名文字。重複關係就把這條線本身
    // 左右錯開一點。跨卡片的關係則維持原本點對點連線的畫法，標籤沿線的垂直方向擺開。
    const fromColLeft = fromRect.left - boardRect.left;
    const fromColRight = fromRect.right - boardRect.left;
    const toColLeft = toRect.left - boardRect.left;
    const toColRight = toRect.right - boardRect.left;
    const sameCard = Math.abs(fromColLeft - toColLeft) < 4 && Math.abs(fromColRight - toColRight) < 4;
    const GUTTER_INSET = 18;

    let startPulled;
    let end;
    if (sameCard) {
      const gutterX = Math.max(fromColRight, toColRight) - GUTTER_INSET + dupSpread;
      startPulled = { x: gutterX, y: fromCenter.y };
      end = { x: gutterX, y: toCenter.y };
    } else {
      const fromRectLocal = { width: fromRect.width, height: fromRect.height };
      const toRectLocal = { width: toRect.width, height: toRect.height };
      startPulled = hasStartArrow(edge) ? edgePointOnRect(fromRectLocal, fromCenter, toCenter) : fromCenter;
      end = hasEndArrow(edge) ? edgePointOnRect(toRectLocal, toCenter, fromCenter) : toCenter;
    }

    const line = document.createElementNS(svgNS, 'line');
    line.setAttribute('x1', startPulled.x);
    line.setAttribute('y1', startPulled.y);
    line.setAttribute('x2', end.x);
    line.setAttribute('y2', end.y);
    const edgeColor = effectiveEdgeColor(edge);
    line.setAttribute('stroke', edgeColor);
    line.setAttribute('stroke-width', String(strokeWidthForLabel(edge.label)));
    if (edge.lineStyle === 'dashed') line.setAttribute('stroke-dasharray', '6,4');
    if (hasEndArrow(edge)) line.setAttribute('marker-end', `url(#arrow-end-${colorId(edgeColor)})`);
    if (hasStartArrow(edge)) line.setAttribute('marker-start', `url(#arrow-start-${colorId(edgeColor)})`);
    line.style.pointerEvents = 'stroke';
    line.style.cursor = 'pointer';
    line.addEventListener('click', () => onEdgeClick(edge));
    svgEl.appendChild(line);

    if (edge.label) {
      // 標籤直接置中疊在連線正中央，讓線貫穿標籤，不要線是線、字是字分開兩邊。
      let midX;
      let midY;
      if (sameCard) {
        midX = startPulled.x;
        midY = (startPulled.y + end.y) / 2;
      } else {
        const dx = end.x - startPulled.x;
        const dy = end.y - startPulled.y;
        const lineLength = Math.hypot(dx, dy) || 1;
        const LABEL_OFFSET = 30;
        const perpX = dy / lineLength;
        const perpY = -dx / lineLength;
        midX = (startPulled.x + end.x) / 2 + perpX * LABEL_OFFSET + perpX * dupSpread;
        midY = (startPulled.y + end.y) / 2 + perpY * LABEL_OFFSET + perpY * dupSpread;
      }
      const labelColor = edgeColor;
      const text = document.createElementNS(svgNS, 'text');
      text.setAttribute('x', midX);
      text.setAttribute('y', midY);
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dominant-baseline', 'middle');
      text.setAttribute('font-size', '11');
      text.setAttribute('font-weight', '700');
      text.setAttribute('fill', labelColor);
      text.style.pointerEvents = 'none';
      text.textContent = edge.label;
      svgEl.appendChild(text);

      // 膠囊狀底色＋同色系描邊，讓標籤在密集的卡片間也能一眼認出，線不會穿過文字造成雜訊
      const bboxProbe = text;
      svgEl.appendChild(bboxProbe);
      const bbox = bboxProbe.getBBox();
      const padX = 7;
      const padY = 4;
      const rect = document.createElementNS(svgNS, 'rect');
      rect.setAttribute('x', bbox.x - padX);
      rect.setAttribute('y', bbox.y - padY);
      rect.setAttribute('width', bbox.width + padX * 2);
      rect.setAttribute('height', bbox.height + padY * 2);
      rect.setAttribute('fill', '#ffffff');
      rect.setAttribute('fill-opacity', '0.94');
      rect.setAttribute('stroke', labelColor);
      rect.setAttribute('stroke-width', '1');
      rect.setAttribute('rx', String((bbox.height + padY * 2) / 2));
      rect.style.pointerEvents = 'auto';
      rect.style.cursor = 'pointer';
      rect.addEventListener('click', () => onEdgeClick(edge));
      svgEl.insertBefore(rect, text);
    }
  }
}

// 固定 12 色色盤（6 欄 x 2 排）取代原生光譜選色器：色點按 title／aria-label 顯示中文顏色名，
// 選中的色塊打勾，下方另外顯示一行「目前顏色：XX」文字說明，選了什麼一眼就看到。
function edgeColorSwatchesHtml(currentColor) {
  const current = currentColor || DEFAULT_EDGE_COLOR;
  const currentName = edgeColorNameForHex(current);
  return `
    <input type="hidden" name="color" value="${escapeHtml(current)}">
    <div class="edge-color-swatches">
      ${EDGE_COLOR_PALETTE.map((c) => `
        <button type="button" class="edge-color-swatch${c.hex.toLowerCase() === current.toLowerCase() ? ' is-selected' : ''}" data-hex="${c.hex}" style="background: ${c.hex};" title="${escapeHtml(c.name)}" aria-label="選擇關係線顏色 ${escapeHtml(c.name)}">
          <span class="edge-color-check">✓</span>
        </button>
      `).join('')}
    </div>
    <div class="edge-color-current-label">${currentName ? `目前顏色：${escapeHtml(currentName)}` : ''}</div>
  `;
}

function wireEdgeColorSwatches(form) {
  form.querySelectorAll('.edge-color-swatch').forEach((btn) => {
    btn.addEventListener('click', () => applyEdgeColor(form, btn.dataset.hex));
  });
}

function edgeStyleFieldsHtml(edge) {
  const edgeData = edge || {};
  return `
    <label>方向
      <select name="direction">${directionOptionsHtml(edgeData.direction || 'forward')}</select>
    </label>
    <label>顏色
      ${edgeColorSwatchesHtml(edgeData.color)}
    </label>
    <label>線型
      <select name="lineStyle">
        <option value="solid" ${(edgeData.lineStyle || 'solid') === 'solid' ? 'selected' : ''}>實線</option>
        <option value="dashed" ${edgeData.lineStyle === 'dashed' ? 'selected' : ''}>虛線</option>
      </select>
    </label>
  `;
}

function readEdgeStyleFields(data) {
  return {
    direction: DIRECTION_OPTIONS.some((o) => o.value === data.direction) ? data.direction : 'forward',
    color: data.color || DEFAULT_EDGE_COLOR,
    lineStyle: data.lineStyle === 'dashed' ? 'dashed' : 'solid',
  };
}

function personOptionsHtml(nodes, groups) {
  const groupNameById = new Map(groups.map((g) => [g.id, g.name]));
  return nodes
    .map((p) => {
      const groupLabel = p.groupId ? (groupNameById.get(p.groupId) || '未分組') : '未分組';
      return `<option value="${p.id}">${escapeHtml(groupLabel)} › ${escapeHtml(p.label)}</option>`;
    })
    .join('');
}

export async function renderGraphPage(container, rawBookId) {
  const bookId = Number(rawBookId);
  const book = await DB.getById('books', bookId);
  if (!book) {
    container.innerHTML = '<p class="empty">找不到這本書。</p>';
    return;
  }

  container.classList.add('graph-page-wide');
  container.innerHTML = `
    <div id="graph-app-container">
      <div class="toolbar graph-toolbar">
        <div class="graph-toolbar-left">
          <a class="graph-toolbar-back" href="#/books/${bookId}">← 回《${escapeHtml(book.title || '未命名')}》</a>
          <h2 class="graph-toolbar-title">本書關係圖</h2>
        </div>
        <div class="toolbar-actions graph-toolbar-right">
          <div class="canvas-zoom-toolbar" id="canvas-zoom-toolbar">
            <button type="button" class="canvas-tool-btn" id="zoom-out-btn" title="縮小">－</button>
            <span class="canvas-zoom-level" id="zoom-level">100%</span>
            <button type="button" class="canvas-tool-btn" id="zoom-in-btn" title="放大">＋</button>
            <button type="button" class="canvas-tool-btn" id="zoom-reset-btn" title="重設縮放">重設</button>
          </div>
          <button type="button" class="btn graph-toolbar-secondary-btn drawer-toggle-btn" id="drawer-toggle-btn">${ICON_LINK}關係／編輯面板</button>
          <button type="button" class="btn graph-toolbar-secondary-btn" id="fullscreen-btn" title="讓畫布鋪滿螢幕">⛶ 全螢幕展繪</button>
          <button type="button" class="btn btn-primary" id="add-group-btn">＋ 新增群組</button>
        </div>
      </div>
      <div class="graph-layout">
        <div class="graph-canvas-area" id="graph-canvas-area">
          <div class="canvas-wrap" id="canvas-wrap">
            <div class="canvas-board" id="canvas-board">
              <svg class="connections-overlay" id="connections-svg"></svg>
              <div class="group-track" id="group-track"></div>
            </div>
          </div>
        </div>
      </div>
      <div class="graph-drawer-backdrop" id="graph-drawer-backdrop"></div>
      <aside class="graph-drawer" id="graph-drawer">
        <button type="button" class="graph-drawer-close" id="graph-drawer-close" title="關閉面板">✕ 關閉</button>
        <div class="graph-tabs">
          <button type="button" class="graph-tab-btn is-active" data-tab="add">新增關係</button>
          <button type="button" class="graph-tab-btn" data-tab="detail">編輯詳情</button>
        </div>
        <div class="graph-tab-panel" data-tab-panel="add">
          <p class="graph-hint">拖曳人物卡片可以換群組；點一下人物或連線可以編輯／刪除。</p>
          <p class="empty" id="edge-form-hint">至少要有兩個人物才能建立關係。</p>
          <form id="edge-form" class="book-form compact-form" style="display:none;">
            <label>從<select name="fromNodeId" id="edge-from"></select></label>
            <label>到<select name="toNodeId" id="edge-to"></select></label>
            <label>關係
              <input name="label" type="text" placeholder="輸入任何關係名稱，例如：懷疑、引申出、反駁、主管">
            </label>
            ${edgeStyleFieldsHtml(null)}
            <div class="form-actions"><button type="submit" class="btn btn-primary">新增關係</button></div>
          </form>
        </div>
        <div class="graph-tab-panel" data-tab-panel="detail" hidden>
          <div id="selection-panel">
            <p class="empty">點一下左邊的人物或關係連線，可以在這裡編輯／刪除。</p>
          </div>
        </div>
      </aside>
    </div>
  `;

  const boardEl = container.querySelector('#canvas-board');
  const trackEl = container.querySelector('#group-track');
  const svgEl = container.querySelector('#connections-svg');
  const addGroupBtn = container.querySelector('#add-group-btn');
  const edgeForm = container.querySelector('#edge-form');
  const fromSelect = container.querySelector('#edge-from');
  const toSelect = container.querySelector('#edge-to');
  const edgeHint = container.querySelector('#edge-form-hint');
  const selectionPanel = container.querySelector('#selection-panel');
  const tabButtons = container.querySelectorAll('.graph-tab-btn');
  const tabPanels = container.querySelectorAll('.graph-tab-panel');
  function switchTab(tabName) {
    tabButtons.forEach((btn) => btn.classList.toggle('is-active', btn.dataset.tab === tabName));
    tabPanels.forEach((panel) => { panel.hidden = panel.dataset.tabPanel !== tabName; });
  }
  tabButtons.forEach((btn) => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

  // 右側面板改成可收折的抽屜：預設收起，讓畫布佔滿寬度，點人物/連線或按鈕才滑出。
  const drawerEl = container.querySelector('#graph-drawer');
  const drawerBackdrop = container.querySelector('#graph-drawer-backdrop');
  function openDrawer() {
    drawerEl.classList.add('is-open');
    drawerBackdrop.classList.add('is-open');
  }
  function closeDrawer() {
    drawerEl.classList.remove('is-open');
    drawerBackdrop.classList.remove('is-open');
  }
  function toggleDrawer() {
    if (drawerEl.classList.contains('is-open')) closeDrawer();
    else openDrawer();
  }
  container.querySelector('#drawer-toggle-btn').addEventListener('click', toggleDrawer);
  container.querySelector('#graph-drawer-close').addEventListener('click', closeDrawer);
  drawerBackdrop.addEventListener('click', closeDrawer);
  // 這個抽屜原本完全沒有 Esc 可以關（分類彈窗、Notion 匯入彈窗都各自處理了 Esc，
  // 只有這裡漏掉）。只在抽屜真的開著的時候關閉並回傳 true；抽屜關著時回傳 false，
  // 讓 Esc 正常往下（例如瀏覽器自己的退出全螢幕）傳遞，不會搶走跟這個抽屜無關的行為。
  pushEscapeHandler(() => {
    if (!drawerEl.classList.contains('is-open')) return false;
    closeDrawer();
    return true;
  });
  // 點畫布空白處（不是卡片、不是人物）順手把面板收起來，保持畫面清爽。
  boardEl.addEventListener('click', (event) => {
    if (event.target === boardEl || event.target === trackEl) closeDrawer();
  });

  wireCoupleAutoColor(edgeForm);
  wireEdgeColorSwatches(edgeForm);

  let groups = [];
  let nodes = [];
  let edges = [];

  async function reload() {
    const data = await loadGraphData(bookId);
    groups = data.groups;
    nodes = data.nodes;
    edges = data.edges;
    draw();
  }

  function byOrder(a, b) {
    return (a.order ?? 0) - (b.order ?? 0) || a.id - b.id;
  }

  function draw() {
    const peopleByGroup = new Map();
    const ungrouped = [];
    for (const person of nodes) {
      if (person.groupId && groups.some((g) => g.id === person.groupId)) {
        if (!peopleByGroup.has(person.groupId)) peopleByGroup.set(person.groupId, []);
        peopleByGroup.get(person.groupId).push(person);
      } else {
        ungrouped.push(person);
      }
    }
    for (const list of peopleByGroup.values()) list.sort(byOrder);
    ungrouped.sort(byOrder);

    const GRID_COLS = 4;
    const GRID_COL_STEP = 240;
    const GRID_ROW_STEP = 280;
    trackEl.innerHTML = groups.map((g, i) => groupCardHtml(
      g,
      peopleByGroup.get(g.id) || [],
      20 + (i % GRID_COLS) * GRID_COL_STEP,
      20 + Math.floor(i / GRID_COLS) * GRID_ROW_STEP,
    )).join('') + ungroupedTrayHtml(ungrouped)
      + `<datalist id="existing-people-list">${datalistOptions(nodes.map((n) => n.label))}</datalist>`;

    wireGroupCardEvents();

    const options = personOptionsHtml(nodes, groups);
    fromSelect.innerHTML = options;
    toSelect.innerHTML = options;
    const enough = nodes.length >= 2;
    edgeForm.style.display = enough ? '' : 'none';
    edgeHint.style.display = enough ? 'none' : '';

    requestAnimationFrame(() => drawConnections(svgEl, boardEl, edges, showEdgePanel));
  }

  // 把 personId 放進 targetGroupId（null＝未分組），插在 insertBeforeId 那個人前面
  // （insertBeforeId 是 null 就放最後）。同群組內其他人依序重新編號，維持你拖曳排出來的順序。
  async function movePerson(personId, targetGroupId, insertBeforeId) {
    const person = nodes.find((n) => n.id === personId);
    if (!person) return;
    const siblings = nodes
      .filter((n) => n.id !== personId && (n.groupId || null) === targetGroupId)
      .sort(byOrder);
    let insertAt = siblings.length;
    if (insertBeforeId != null) {
      const idx = siblings.findIndex((n) => n.id === insertBeforeId);
      if (idx !== -1) insertAt = idx;
    }
    siblings.splice(insertAt, 0, person);
    for (let i = 0; i < siblings.length; i++) {
      const p = siblings[i];
      await DB.update('nodes', { ...p, groupId: targetGroupId, order: i });
    }
  }

  // 存下群組卡片自由拖曳後的畫布座標。
  async function saveGroupPosition(groupId, x, y) {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;
    await DB.update('groups', { ...group, x, y });
  }

  function clearDropHighlights() {
    trackEl.querySelectorAll('.drag-insert-before, .drag-insert-after').forEach((el) => {
      el.classList.remove('drag-insert-before', 'drag-insert-after');
    });
    trackEl.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over'));
  }

  function wireGroupCardEvents() {
    // 人物卡片改用 Pointer Events 手動判斷拖曳，不用瀏覽器原生 HTML5 drag-and-drop——
    // 原生拖曳在觸控板上常常判斷不到「這是一個拖曳」，導致卡片完全拖不動，
    // 跟群組卡片自由拖曳用同一套邏輯比較穩定，兩者行為也一致。
    // 用 Pointer Events（不是分開的 mouse/touch 事件）是因為它天生就同時涵蓋滑鼠、觸控、
    // 觸控筆同一份程式碼，不用另外寫一套 touchstart/touchmove 邏輯：平板上單指按住拖曳
    // 卡片，跟滑鼠按住拖曳，走的是完全一樣的判斷。搭配 CSS 的 touch-action:none／
    // user-select:none（見 styles.css），平板才不會把拖曳誤判成頁面捲動或選取文字。
    trackEl.querySelectorAll('.person-item').forEach((el) => {
      el.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        const startX = event.clientX;
        const startY = event.clientY;
        const nodeId = Number(el.dataset.nodeId);
        let dragging = false;

        function onMove(moveEvent) {
          if (!dragging) {
            if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 5) return;
            dragging = true;
            el.classList.add('is-dragging');
          }
          clearDropHighlights();
          const hovered = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY);
          const targetPersonEl = hovered ? hovered.closest('.person-item') : null;
          if (targetPersonEl && targetPersonEl !== el) {
            const rect = targetPersonEl.getBoundingClientRect();
            const before = moveEvent.clientY < rect.top + rect.height / 2;
            targetPersonEl.classList.toggle('drag-insert-before', before);
            targetPersonEl.classList.toggle('drag-insert-after', !before);
          } else {
            const targetBody = hovered ? hovered.closest('[data-drop-group]') : null;
            if (targetBody) targetBody.classList.add('drag-over');
          }
        }

        async function onUp(upEvent) {
          document.removeEventListener('pointermove', onMove);
          document.removeEventListener('pointerup', onUp);
          el.classList.remove('is-dragging');
          clearDropHighlights();
          if (!dragging) {
            const person = nodes.find((n) => n.id === nodeId);
            if (person) showPersonPanel(person);
            return;
          }
          const hovered = document.elementFromPoint(upEvent.clientX, upEvent.clientY);
          const targetPersonEl = hovered ? hovered.closest('.person-item') : null;
          if (targetPersonEl && targetPersonEl !== el) {
            const body = targetPersonEl.closest('[data-drop-group]');
            const target = body.dataset.dropGroup;
            const targetGroupId = target === UNGROUPED ? null : Number(target);
            const rect = targetPersonEl.getBoundingClientRect();
            const before = upEvent.clientY < rect.top + rect.height / 2;
            const targetPersonId = Number(targetPersonEl.dataset.nodeId);
            const insertBeforeId = before ? targetPersonId : (() => {
              const siblingsEls = Array.from(body.querySelectorAll('.person-item'));
              const idx = siblingsEls.indexOf(targetPersonEl);
              const next = siblingsEls[idx + 1];
              return next ? Number(next.dataset.nodeId) : null;
            })();
            await movePerson(nodeId, targetGroupId, insertBeforeId);
            await reload();
            return;
          }
          const targetBody = hovered ? hovered.closest('[data-drop-group]') : null;
          if (targetBody) {
            const target = targetBody.dataset.dropGroup;
            const targetGroupId = target === UNGROUPED ? null : Number(target);
            await movePerson(nodeId, targetGroupId, null);
            await reload();
          }
        }

        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
      });
    });

    // 群組卡片自由拖曳：整個標題區（名稱、副標旁的空白處，含原本的 ⠿ 把手）都能按住拖曳，
    // 不用再精準點在那顆小把手上。點到名稱／副標輸入框、顏色選擇器、刪除按鈕則排除，
    // 讓這些控制項維持原本可以正常點擊、輸入的行為，不會被誤判成拖曳。
    // 用 Pointer Events 直接搬動卡片（不是 HTML5 drag），放開時把座標存進 group.x / group.y，
    // 跟人物卡片的拖放邏輯完全分開、互不影響；同一套事件同時涵蓋滑鼠跟平板單指拖曳。
    const GROUP_DRAG_EXCLUDE_SELECTOR = '.group-name-input, .group-subtitle-input, .group-color-picker, .group-delete-btn';
    trackEl.querySelectorAll('.group-card-header').forEach((header) => {
      header.addEventListener('pointerdown', (event) => {
        if (event.target.closest(GROUP_DRAG_EXCLUDE_SELECTOR)) return;
        event.preventDefault();
        const card = header.closest('.group-card[data-group-id]');
        if (!card) return;
        const groupId = Number(card.dataset.groupId);
        const startX = event.clientX;
        const startY = event.clientY;
        const originLeft = card.offsetLeft;
        const originTop = card.offsetTop;
        card.classList.add('is-dragging');

        function onMove(moveEvent) {
          const nextLeft = Math.max(0, originLeft + (moveEvent.clientX - startX));
          const nextTop = Math.max(0, originTop + (moveEvent.clientY - startY));
          card.style.left = `${nextLeft}px`;
          card.style.top = `${nextTop}px`;
          // 拖曳中卡片本身即時跟著游標移動，但連線只有放開滑鼠那一刻的 reload() 才會
          // 重新呼叫 drawConnections() 對齊新位置——中間拖曳的過程中，連線整條停在
          // 拖曳開始前的舊位置沒有動，卡片跟連線兩者「各走各的」，看起來就像卡片
          // 被拖走了、但連線硬生生被拉出一截還連在原地，直到放開才「跳」回正確位置。
          // 這裡拖曳的每一格都重新畫一次連線，卡片移到哪、連線就即時跟到哪，不用
          // 等放開滑鼠才校正——drawConnections() 本身是用 getBoundingClientRect()
          // 即時量測，卡片這時候已經套上新的 left/top，量到的自然就是新位置。
          drawConnections(svgEl, boardEl, edges, showEdgePanel);
        }
        async function onUp() {
          document.removeEventListener('pointermove', onMove);
          document.removeEventListener('pointerup', onUp);
          card.classList.remove('is-dragging');
          await saveGroupPosition(groupId, card.offsetLeft, card.offsetTop);
          await reload();
        }
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
      });
    });

    trackEl.querySelectorAll('.group-name-input').forEach((input) => {
      input.addEventListener('change', async () => {
        const group = groups.find((g) => g.id === Number(input.dataset.groupId));
        if (!group) return;
        await DB.update('groups', { ...group, name: input.value.trim() || '未命名群組' });
        await reload();
      });
    });

    trackEl.querySelectorAll('.group-subtitle-input').forEach((input) => {
      input.addEventListener('change', async () => {
        const group = groups.find((g) => g.id === Number(input.dataset.groupId));
        if (!group) return;
        await DB.update('groups', { ...group, subtitle: input.value.trim() });
        await reload();
      });
    });

    trackEl.querySelectorAll('.group-color-picker').forEach((picker) => {
      const trigger = picker.querySelector('.group-color-trigger');
      const panel = picker.querySelector('.group-color-swatches');
      trigger.addEventListener('click', () => {
        const willOpen = panel.hidden;
        // 一次只開一個色塊面板，開新的之前先把其他還開著的關掉。
        trackEl.querySelectorAll('.group-color-swatches').forEach((p) => { p.hidden = true; });
        panel.hidden = !willOpen;
      });
      panel.querySelectorAll('.group-color-swatch').forEach((swatch) => {
        swatch.addEventListener('click', async () => {
          const group = groups.find((g) => g.id === Number(picker.dataset.groupId));
          if (!group) return;
          await DB.update('groups', { ...group, color: swatch.dataset.hex });
          await reload();
        });
      });
    });

    trackEl.querySelectorAll('.group-delete-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const group = groups.find((g) => g.id === Number(btn.dataset.groupId));
        if (!group) return;
        if (!window.confirm(`確定要刪除群組「${group.name}」嗎？裡面的人物不會被刪除，會變成未分組。`)) return;
        const members = nodes.filter((n) => n.groupId === group.id);
        for (const person of members) {
          await DB.update('nodes', { ...person, groupId: null });
        }
        await DB.remove('groups', group.id);
        await reload();
      });
    });

    trackEl.querySelectorAll('.quick-add-person-form').forEach((form) => {
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const input = form.elements.name;
        const name = input.value.trim();
        if (!name) return;
        const groupId = Number(form.dataset.groupId);
        const siblingCount = nodes.filter((n) => (n.groupId || null) === groupId).length;
        // 打的名字如果跟現有人物一模一樣，直接把那個人搬過來，不要另外新增一個重複的人物
        // （例如群組被刪除、人物變未分組後，想把他重新加回某個群組）。
        const existing = nodes.find((n) => n.label.trim() === name);
        if (existing) {
          if ((existing.groupId || null) !== groupId) {
            await DB.update('nodes', { ...existing, groupId, order: siblingCount });
          }
        } else {
          await DB.add('nodes', { bookId, groupId, label: name, title: '', status: '', description: '', order: siblingCount });
        }
        input.value = '';
        await reload();
      });
    });
  }

  function showPersonPanel(person) {
    switchTab('detail');
    openDrawer();
    selectionPanel.innerHTML = `
      <h4>編輯人物</h4>
      <form id="edit-person-form" class="book-form compact-form">
        <label>姓名<input name="label" value="${escapeHtml(person.label)}" required></label>
        <label>頭銜／備註<input name="title" value="${escapeHtml(person.title)}" placeholder="例如：代理警隊長"></label>
        <label>狀態標籤
          <input type="text" name="status" value="${escapeHtml(person.status)}" placeholder="輸入任何狀態，例如：核心概念、待驗證、臥底">
        </label>
        <label>描述（補充說明，選填）
          <textarea name="description" rows="2">${escapeHtml(person.description)}</textarea>
        </label>
        <label class="checkbox"><input type="checkbox" name="isProtagonist" ${person.isProtagonist ? 'checked' : ''}> ★ 主角／重要角色</label>
        <label>群組
          <select name="groupId">
            <option value="">未分組</option>
            ${groups.map((g) => `<option value="${g.id}" ${person.groupId === g.id ? 'selected' : ''}>${escapeHtml(g.name)}</option>`).join('')}
          </select>
        </label>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary">儲存</button>
          <button type="button" class="btn btn-danger" id="delete-person-btn">刪除</button>
        </div>
      </form>
    `;
    const form = selectionPanel.querySelector('#edit-person-form');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      const newGroupId = data.groupId ? Number(data.groupId) : null;
      const groupChanged = newGroupId !== (person.groupId || null);
      const order = groupChanged
        ? nodes.filter((n) => n.id !== person.id && (n.groupId || null) === newGroupId).length
        : person.order;
      // 存檔失敗（例如雲端資料表缺欄位——這是實際發生過的真實 bug，見
      // supabase/schema.sql 裡 nodes 表 isProtagonist 欄位旁的說明）不能沒
      // 有任何提示：不包 try/catch 的話，DB.update() 丟出的例外只會變成
      // 主控台看不見的 unhandled rejection，畫面上完全沒反應，使用者只會
      // 覺得「這個功能是不是壞了」，沒有線索可以回報。
      try {
        await DB.update('nodes', {
          id: person.id,
          bookId,
          groupId: newGroupId,
          order,
          label: data.label.trim(),
          title: (data.title || '').trim(),
          status: (data.status || '').trim(),
          description: (data.description || '').trim(),
          isProtagonist: form.elements.isProtagonist.checked,
          createdAt: person.createdAt,
        });
      } catch (error) {
        // 直接把錯誤內容顯示在 Toast 上（不只是「請稍後再試一次」這種空泛的
        // 訊息）——這類存檔失敗十之八九是雲端資料表欄位對不上，錯誤訊息本身
        // 就會講清楚是哪個欄位、什麼原因，使用者不用另外打開瀏覽器主控台
        // 就能直接把這句話回報給開發者，一次到位。
        showToast(`儲存失敗：${error?.message || String(error)}`, 6000);
        console.error('[Marginalia 關係圖譜] 儲存人物失敗：', error);
        return;
      }
      switchTab('add');
      await reload();
    });
    selectionPanel.querySelector('#delete-person-btn').addEventListener('click', async () => {
      if (!window.confirm(`確定要刪除人物「${person.label}」嗎？連接到他的關係也會一併刪除。`)) return;
      const related = edges.filter((e) => e.fromNodeId === person.id || e.toNodeId === person.id);
      for (const e of related) await DB.remove('edges', e.id);
      await DB.remove('nodes', person.id);
      switchTab('add');
      await reload();
    });
  }

  function showEdgePanel(edge) {
    switchTab('detail');
    openDrawer();
    selectionPanel.innerHTML = `
      <h4>編輯關係</h4>
      <form id="edit-edge-form" class="book-form compact-form">
        <label>關係<input name="label" type="text" value="${escapeHtml(edge.label)}" placeholder="輸入任何關係名稱"></label>
        ${edgeStyleFieldsHtml(edge)}
        <div class="form-actions">
          <button type="submit" class="btn btn-primary">儲存</button>
          <button type="button" class="btn btn-danger" id="delete-edge-btn">刪除關係</button>
        </div>
      </form>
    `;
    const editEdgeForm = selectionPanel.querySelector('#edit-edge-form');
    wireCoupleAutoColor(editEdgeForm);
    wireEdgeColorSwatches(editEdgeForm);
    selectionPanel.querySelector('#edit-edge-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(event.target).entries());
      await DB.update('edges', {
        id: edge.id,
        bookId,
        fromNodeId: edge.fromNodeId,
        toNodeId: edge.toNodeId,
        label: data.label.trim(),
        ...readEdgeStyleFields(data),
        createdAt: edge.createdAt,
      });
      switchTab('add');
      await reload();
    });
    selectionPanel.querySelector('#delete-edge-btn').addEventListener('click', async () => {
      if (!window.confirm('確定要刪除這個關係嗎？')) return;
      await DB.remove('edges', edge.id);
      switchTab('add');
      await reload();
    });
  }

  // 全螢幕展繪：作用對象是最外層的 #graph-app-container（工具列＋畫布＋側邊抽屜全部包在裡面），
  // 不是只有畫布本身——之前只把畫布元素送進全螢幕，工具列跟側邊抽屜是它的兄弟節點、
  // 不在 fullscreen 的那顆元素底下，瀏覽器只會畫出 fullscreen 元素本身跟它的子孫，
  // 結果就是全螢幕時工具列被裁切消失、開抽屜也完全看不到（抽屜根本沒被畫出來）。
  const appContainer = container.querySelector('#graph-app-container');
  const fullscreenBtn = container.querySelector('#fullscreen-btn');
  fullscreenBtn.addEventListener('click', () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      (appContainer.requestFullscreen || appContainer.webkitRequestFullscreen)?.call(appContainer);
    }
  });
  document.addEventListener('fullscreenchange', () => {
    fullscreenBtn.textContent = document.fullscreenElement ? '✕ 退出全螢幕' : '⛶ 全螢幕展繪';
    // 側邊抽屜是 position:fixed 鋪滿右側 360px、z-index 又比一般文件流的工具列高，
    // 進入或離開全螢幕的當下如果抽屜還開著，會擋住（甚至在一般模式下也會擋住）
    // 工具列右側那幾顆按鈕，包含使用者剛按下去的「退出全螢幕」本身。
    // 切換全螢幕狀態時順手把抽屜收起來，兩種模式下工具列都保證按得到。
    closeDrawer();
  });

  // 縮放：直接對 .canvas-board 套 CSS transform:scale，連線用的 SVG 跟人物/群組卡片
  // 都在它底下，一起等比例縮放；縮放後重新呼叫 drawConnections 讓連線重新對齊卡片新的視覺位置
  // （drawConnections 是用 getBoundingClientRect 量測，量出來的本來就已經反映縮放後的樣子）。
  let zoomLevel = 1;
  const MIN_ZOOM = 0.4;
  const MAX_ZOOM = 2;
  const zoomLevelEl = container.querySelector('#zoom-level');

  function applyZoom() {
    boardEl.style.transform = `scale(${zoomLevel})`;
    boardEl.style.transformOrigin = '0 0';
    zoomLevelEl.textContent = `${Math.round(zoomLevel * 100)}%`;
    requestAnimationFrame(() => drawConnections(svgEl, boardEl, edges, showEdgePanel));
  }

  container.querySelector('#zoom-in-btn').addEventListener('click', () => {
    zoomLevel = Math.min(MAX_ZOOM, Math.round((zoomLevel + 0.1) * 10) / 10);
    applyZoom();
  });
  container.querySelector('#zoom-out-btn').addEventListener('click', () => {
    zoomLevel = Math.max(MIN_ZOOM, Math.round((zoomLevel - 0.1) * 10) / 10);
    applyZoom();
  });
  container.querySelector('#zoom-reset-btn').addEventListener('click', () => {
    zoomLevel = 1;
    applyZoom();
  });
  // 滾輪／觸控板縮放刻意不做：畫布縮放完全交給頂部工具列的 −／＋／重設三顆按鈕，
  // 使用者在瀏覽或用滾輪捲動畫布找位置時，不會不小心把畫面滾到暴增暴縮。
  // 拿掉這個監聽器後，滾輪在 .canvas-wrap 上就是它原生 overflow:auto 的捲動行為。

  addGroupBtn.addEventListener('click', async () => {
    await DB.add('groups', { bookId, name: '新群組', color: nextGroupColor(groups.length) });
    await reload();
  });

  edgeForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(edgeForm).entries());
    const fromNodeId = Number(data.fromNodeId);
    const toNodeId = Number(data.toNodeId);
    if (!fromNodeId || !toNodeId || fromNodeId === toNodeId) return;
    await DB.add('edges', {
      bookId,
      fromNodeId,
      toNodeId,
      label: (data.label || '').trim(),
      ...readEdgeStyleFields(data),
    });
    edgeForm.reset();
    await reload();
  });

  await reload();
}
