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

// circleStyle 只有獨立（未分組）人物卡片會傳 true（見 ungroupedPersonCardHtml
// 的說明）——群組卡片裡的人物項目維持原本那種有底色的矩形清單樣式，不受影響。
// 圓形樣式多畫一個「頭像」圓圈，裡面放名字的第一個字當作沒有照片時的替代視覺——
// 用 Array.from() 取第一個字元而不是 charAt(0)，是為了讓名字萬一是由兩個
// UTF-16 code unit 組成的字（例如罕見字、emoji）時也能正確取到完整一個字，
// 不會切到一半變成亂碼。
function personItemHtml(person, { circleStyle = false } = {}) {
  const avatarHtml = circleStyle
    ? `<div class="person-avatar-circle">${escapeHtml(Array.from(person.label.trim())[0] || '?')}</div>`
    : '';
  return `
    <div class="person-item${person.isProtagonist ? ' is-protagonist' : ''}${circleStyle ? ' person-item-circle' : ''}" data-node-id="${person.id}">
      ${avatarHtml}
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
        ${people.map((p) => personItemHtml(p)).join('')}
        <form class="quick-add-person-form" data-group-id="${group.id}">
          <input name="name" list="existing-people-list" placeholder="＋ 新增人物，Enter 送出（打已存在的名字會直接移過來，不會重複）">
        </form>
      </div>
    </div>
  `;
}

// 未分組的人物不再共用一張「未分組」容器卡片——使用者反映「先建人物、
// 之後真的需要分類再手動拖進群組」是他實際的用法，用「＋ 新增人物」
// 工具列按鈕一直新增時，畫面上如果每次都多一層帶標題列、帶提示文字的
// 「未分組」外框，看起來會像「全部都已經分類好了」，不符合直覺。改成
// 每個未分組的人物各自是一張獨立的小卡片（跟一般群組卡片同一套網格
// 定位，見呼叫端 renderBoardView() 怎麼算 x/y），沒有標題列、沒有群組
// 名字、沒有提示文字，直接漂浮在畫布上。
// data-drop-group="ungrouped" 直接放在卡片本身（不像群組卡片是放在
// .group-card-body 上）——既有的拖放邏輯（graphDragDrop.js）靠
// .closest('[data-drop-group]') 從被拖曳／被懸停的人物卡片往上找最近的
// 容器，這裡只有一層，卡片本身就是最近的祖先節點，一樣抓得到，不用
// 另外包一層看不出差異的 wrapper div。
// 使用者反映獨立人物卡片沒有辦法自由拖曳調整位置——人物卡片本身的拖放
// （拖進某個群組、或在同一張卡片裡重新排序）已經被既有的 .person-item
// 拖曳邏輯佔用了（見 graphDragDrop.js），不能讓整張卡片的拖曳跟它共用
// 同一個觸發區域，不然兩種拖曳意圖（「移動這張獨立卡片本身」跟「把這個
// 人拖進某個群組」）會互相打架、分不清楚使用者到底想做哪一個。保留一個
// 很小的拖曳把手（⠿，CSS 改成浮在頭像圓圈右上角的小圓點，平常半透明、
// hover／拖曳時才完全顯示，見 styles.css 的說明），按住它拖的是整張卡片
// 的位置，跟底下人物項目本身的拖曳互不干擾。
// 使用者後來又反映虛線方框的外觀看起來太像「正式的群組」，他想要的是
// 參考戲劇人物關係圖那種「圓形頭像＋名字」的簡約呈現，沒有外框——這裡
// 把 personItemHtml 的 circleStyle 選項打開（只有這裡會用到，一般群組
// 卡片內的人物清單完全不受影響），卡片本身的虛線邊框／底色也在
// styles.css 透過 .ungrouped-tray 的規則整個拿掉，只留下頭像圓圈本身
// 看得見。
export function ungroupedPersonCardHtml(person, x, y) {
  return `
    <div class="group-card ungrouped-tray" data-drop-group="ungrouped" style="left: ${x}px; top: ${y}px;">
      <div class="ungrouped-card-handle" data-tooltip="按住拖曳可自由移動位置" aria-label="按住拖曳可自由移動位置">⠿</div>
      <div class="group-card-body">
        ${personItemHtml(person, { circleStyle: true })}
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
