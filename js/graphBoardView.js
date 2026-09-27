// 關係圖譜的群組卡片畫布渲染邏輯——群組容器裝人物卡片，人物卡片可以跨
// 群組自由拖放。曾經有過第二種檢視模式（「網狀圖譜」，力導向物理模擬
// 呈現），拆成獨立模組跟這個並列讓 js/graph.js 依螢幕寬度切換；使用者
// 實際用過一陣子後反映兩種檢視反而是多餘的負擔，只需要保留這一種，
// 已經整批移除（見 js/graph.js 開頭的說明），這裡重新變回唯一、直接
// 被 js/graph.js 呼叫的畫布渲染邏輯，不再是「兩個可插拔模組之一」。
import { datalistOptions, groupCardHtml, ungroupedTrayHtml, personOptionsHtml } from './graphTemplates.js';
import { drawConnections } from './graphConnections.js';
import { wireGroupCardEvents } from './graphDragDrop.js';

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
    state, trackEl, boardEl, svgEl, labelSvgEl,
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
  // 「未分組」卡片緊接在最後一個群組後面、用同一套網格順序排列（見
  // ungroupedTrayHtml 開頭的說明）；完全沒有未分組人物時整張卡片不畫出來，
  // 不留一張「沒有未分組的人物」的空卡片佔位置。
  const ungroupedIndex = groups.length;
  trackEl.innerHTML = groups.map((g, i) => groupCardHtml(
    g,
    peopleByGroup.get(g.id) || [],
    20 + (i % GRID_COLS) * GRID_COL_STEP,
    20 + Math.floor(i / GRID_COLS) * GRID_ROW_STEP,
  )).join('') + (ungrouped.length > 0 ? ungroupedTrayHtml(
    ungrouped,
    20 + (ungroupedIndex % GRID_COLS) * GRID_COL_STEP,
    20 + Math.floor(ungroupedIndex / GRID_COLS) * GRID_ROW_STEP,
  ) : '')
    + `<datalist id="existing-people-list">${datalistOptions(nodes.map((n) => n.label))}</datalist>`;

  wireGroupCardEvents(trackEl, ctx);

  const options = personOptionsHtml(nodes, groups);
  fromSelect.innerHTML = options;
  toSelect.innerHTML = options;
  const enough = nodes.length >= 2;
  edgeForm.style.display = enough ? '' : 'none';
  edgeHint.style.display = enough ? 'none' : '';

  requestAnimationFrame(() => drawConnections(svgEl, labelSvgEl, boardEl, edges, showEdgePanel));
}
