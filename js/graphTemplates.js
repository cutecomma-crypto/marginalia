// 關係圖譜畫面裡各種卡片／表單片段的 HTML 樣板，以及跟這些樣板緊密綁在一起、
// 沒有依賴 renderGraphPage 內部畫布狀態（groups/nodes/edges/svgEl……）的
// 小段 DOM 事件邏輯（例如色塊選色）。同樣是從 graph.js 拆出來降低單一檔案
// 行數的一部分，見 js/graphModel.js 開頭的說明。
import { escapeHtml } from './utils.js';
import {
  DEFAULT_EDGE_COLOR,
  DEFAULT_GROUP_COLOR,
  GROUP_COLOR_PALETTE,
  EDGE_COLOR_PALETTE,
  edgeColorNameForHex,
  presetColorForLabel,
  DIRECTION_OPTIONS,
} from './graphModel.js';

export function datalistOptions(list) {
  return list.map((v) => `<option value="${escapeHtml(v)}"></option>`).join('');
}

export function directionOptionsHtml(selected) {
  return DIRECTION_OPTIONS.map((opt) => `<option value="${opt.value}" ${opt.value === selected ? 'selected' : ''}>${opt.label}</option>`).join('');
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
      <button type="button" class="group-color-trigger" style="background: ${escapeHtml(current)};" data-tooltip="群組顏色" aria-label="選擇群組顏色"></button>
      <div class="group-color-swatches" hidden>
        ${GROUP_COLOR_PALETTE.map((c) => `
          <button type="button" class="group-color-swatch${c.hex === current ? ' is-selected' : ''}" data-hex="${c.hex}" style="background: ${c.hex};" data-tooltip="${escapeHtml(c.name)}" aria-label="選擇群組顏色 ${escapeHtml(c.name)}"></button>
        `).join('')}
      </div>
    </div>
  `;
}

// 群組卡片自由定位：x/y 是相對畫布左上角的像素座標，沒存過（舊資料／新群組）就用 fallbackX/Y 排成一個網格當預設位置。
export function groupCardHtml(group, people, fallbackX, fallbackY) {
  const x = group.x != null ? group.x : fallbackX;
  const y = group.y != null ? group.y : fallbackY;
  return `
    <div class="group-card" data-group-id="${group.id}" style="--group-color: ${escapeHtml(group.color || DEFAULT_GROUP_COLOR)}; left: ${x}px; top: ${y}px;">
      <div class="group-card-header">
        <div class="group-card-header-main">
          <span class="group-drag-handle" data-tooltip="按住拖曳到畫布任何位置" aria-label="按住拖曳到畫布任何位置">⠿</span>
          <input class="group-name-input" data-group-id="${group.id}" value="${escapeHtml(group.name)}">
          ${colorSwatchPickerHtml(group)}
          <button type="button" class="group-delete-btn" data-group-id="${group.id}" data-tooltip="刪除群組" aria-label="刪除群組">×</button>
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

// 「未分組」卡片改成跟一般群組卡片同一套網格定位（見呼叫端 draw() 怎麼算
// x/y），不再靠 CSS 寫死的 top:1rem/right:1rem 釘在畫布右側——那個位置是
// 相對整個 .group-track（min-width:1400px）算的，不是相對實際看得到的
// .canvas-wrap 視窗，畫布內容不夠寬、或視窗本身比 1400px 窄時，這張卡片
// 會被切在可視範圍外面，100% 縮放下看起來像「右側被裁掉一半」。改成跟
// 群組卡片同一套網格順序排列，永遠緊接在最後一個群組後面，內容有多少
// 畫布就佔多少，不會再脫離實際內容範圍。
export function ungroupedTrayHtml(people, x, y) {
  return `
    <div class="group-card ungrouped-tray" style="left: ${x}px; top: ${y}px;">
      <div class="group-card-header">
        <span class="group-name-static">未分組</span>
      </div>
      <div class="group-card-body" data-drop-group="ungrouped">
        ${people.map(personItemHtml).join('')}
        <p class="graph-hint" style="margin:0;">拖曳人物卡片到上面的群組即可分類。</p>
      </div>
    </div>
  `;
}

// 選色的共用邏輯：設定隱藏欄位、更新哪個色塊被打勾、更新下方「目前顏色：XX」文字說明。
// 手動點色塊、或關係字自動套用預設色（戀人／家人）都走這一份，狀態才不會兜不起來。
export function applyEdgeColor(form, hex) {
  form.elements.color.value = hex;
  form.querySelectorAll('.edge-color-swatch').forEach((b) => b.classList.toggle('is-selected', b.dataset.hex.toLowerCase() === hex.toLowerCase()));
  const label = form.querySelector('.edge-color-current-label');
  if (label) {
    const name = edgeColorNameForHex(hex);
    label.textContent = name ? `目前顏色：${name}` : '';
  }
}

export function wireCoupleAutoColor(form) {
  form.elements.label.addEventListener('input', () => {
    const preset = presetColorForLabel(form.elements.label.value.trim());
    if (!preset) return;
    applyEdgeColor(form, preset);
  });
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
        <button type="button" class="edge-color-swatch${c.hex.toLowerCase() === current.toLowerCase() ? ' is-selected' : ''}" data-hex="${c.hex}" style="background: ${c.hex};" data-tooltip="${escapeHtml(c.name)}" aria-label="選擇關係線顏色 ${escapeHtml(c.name)}">
          <span class="edge-color-check">✓</span>
        </button>
      `).join('')}
    </div>
    <div class="edge-color-current-label">${currentName ? `目前顏色：${escapeHtml(currentName)}` : ''}</div>
  `;
}

export function wireEdgeColorSwatches(form) {
  form.querySelectorAll('.edge-color-swatch').forEach((btn) => {
    btn.addEventListener('click', () => applyEdgeColor(form, btn.dataset.hex));
  });
}

export function edgeStyleFieldsHtml(edge) {
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

export function personOptionsHtml(nodes, groups) {
  const groupNameById = new Map(groups.map((g) => [g.id, g.name]));
  return nodes
    .map((p) => {
      const groupLabel = p.groupId ? (groupNameById.get(p.groupId) || '未分組') : '未分組';
      return `<option value="${p.id}">${escapeHtml(groupLabel)} › ${escapeHtml(p.label)}</option>`;
    })
    .join('');
}
