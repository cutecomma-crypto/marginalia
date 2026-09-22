// 「陣營看板」檢視——這是關係圖譜原本、也是唯一的畫面呈現方式，現在被抽成
// 一個獨立、可插拔的檢視模組，跟新增的「網狀圖譜」（js/graphForceView.js）
// 並列，由 js/graph.js 這個外殼依螢幕寬度或使用者手動切換來決定顯示哪一個
// （見 graph.js 開頭的架構說明）。拆出來之後這裡的資料模型（groups/nodes/
// edges）跟拆分之前完全沒有改變——「陣營看板」只是這次規格給「群組卡片」
// 重新取的名字，底層讀寫的還是同一組 Supabase 資料表，符合「兩邊讀取
// 相同的人物與關係資料庫結構」的要求。
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
