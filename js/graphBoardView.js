// 關係圖譜的群組卡片畫布渲染邏輯——群組容器裝人物卡片，人物卡片可以跨
// 群組自由拖放。曾經有過第二種檢視模式（「網狀圖譜」，力導向物理模擬
// 呈現），拆成獨立模組跟這個並列讓 js/graph.js 依螢幕寬度切換；使用者
// 實際用過一陣子後反映兩種檢視反而是多餘的負擔，只需要保留這一種，
// 已經整批移除（見 js/graph.js 開頭的說明），這裡重新變回唯一、直接
// 被 js/graph.js 呼叫的畫布渲染邏輯，不再是「兩個可插拔模組之一」。
import { datalistOptions, groupCardHtml, ungroupedPersonCardHtml, personOptionsHtml } from './graphTemplates.js';
import { drawConnections } from './graphConnections.js';
import { wireGroupCardEvents, restoreUngroupedPosition } from './graphDragDrop.js';

function byOrder(a, b) {
  return (a.order ?? 0) - (b.order ?? 0) || a.id - b.id;
}

// ctx: { state, DB, bookId, trackEl, boardEl, svgEl, labelSvgEl,
//        edgeForm, fromSelect, toSelect, edgeHint,
//        reload, showPersonPanel, showEdgePanel }
// （ctx 裡其餘欄位是 wireGroupCardEvents 需要的，直接整包透傳給它，
// 兩邊約定的欄位名稱本來就一致，不用另外重新組一份。）
export function renderBoardView(ctx) {
  const {
    state, bookId, trackEl, boardEl, svgEl, labelSvgEl,
    edgeForm, fromSelect, toSelect, edgeHint,
    showEdgePanel,
  } = ctx;
  const { groups, nodes, edges } = state;
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
  const groupsHtml = groups.map((g, i) => groupCardHtml(
    g,
    peopleByGroup.get(g.id) || [],
    20 + (i % GRID_COLS) * GRID_COL_STEP,
    20 + Math.floor(i / GRID_COLS) * GRID_ROW_STEP,
  )).join('');
  // 未分組的人物接續在最後一個群組卡片後面、用同一套網格順序排列，但
  // 每個人各自佔一格、各自是一張獨立卡片（見 ungroupedPersonCardHtml
  // 開頭的說明），不是全部擠在同一張「未分組」容器卡片裡。如果這個人物
  // 之前用拖曳把手調整過位置（見 graphDragDrop.js 的
  // restoreUngroupedPosition），優先用存起來的位置，沒拖過的才落在
  // 預設的網格位置上——這樣使用者拖好的位置在換頁/重新整理後才不會
  // 每次都跳回網格排列。
  const ungroupedHtml = ungrouped.map((person, i) => {
    const index = groups.length + i;
    const fallbackX = 20 + (index % GRID_COLS) * GRID_COL_STEP;
    const fallbackY = 20 + Math.floor(index / GRID_COLS) * GRID_ROW_STEP;
    const saved = restoreUngroupedPosition(bookId, person.id);
    return ungroupedPersonCardHtml(
      person,
      saved ? saved.x : fallbackX,
      saved ? saved.y : fallbackY,
    );
  }).join('');
  trackEl.innerHTML = groupsHtml + ungroupedHtml
    + `<datalist id="existing-people-list">${datalistOptions(nodes.map((n) => n.label))}</datalist>`;

  wireGroupCardEvents(trackEl, ctx);

  const options = personOptionsHtml(nodes, groups);
  fromSelect.innerHTML = options;
  toSelect.innerHTML = options;
  const enough = nodes.length >= 2;
  edgeForm.style.display = enough ? '' : 'none';
  edgeHint.style.display = enough ? 'none' : '';

  requestAnimationFrame(() => drawConnections(svgEl, labelSvgEl, boardEl, edges, showEdgePanel, bookId));
}
