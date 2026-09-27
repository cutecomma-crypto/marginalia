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

// 群組卡片內容區（.group-card-body）大小可以自由拖曳調整（見 styles.css
// .group-card-body 的 resize:both 說明），拖過的大小存進 localStorage，
// 不寫進 Supabase 的 groups 表——這是刻意的選擇，不是偷懶：groups 表目前
// 沒有 width/height 欄位，貿然把這兩個欄位塞進 DB.update() 的 payload，
// 對登入雲端帳號的使用者會直接複製這個專案踩過的舊 Bug（見
// marginalia-cloud-update-annotation-leak 這個 Bug 類型的說明：多送一個
// 資料庫沒有的欄位，本機模式測不出問題，只有連 Supabase 才會出錯或靜默
// 失敗）。存在 localStorage 只有目前這台瀏覽器記得住，換裝置或換瀏覽器
// 要重新調一次——換來的是完全不用碰 Supabase schema、不用使用者手動跑
// SQL 就能立刻用，這個取捨值得。
function groupBodySizeKey(bookId, groupKey) {
  return `marginalia_group_body_size_${bookId}_${groupKey}`;
}

function restoreGroupBodySize(bodyEl, bookId, groupKey) {
  try {
    const raw = localStorage.getItem(groupBodySizeKey(bookId, groupKey));
    if (!raw) return;
    const { width, height } = JSON.parse(raw);
    if (width) bodyEl.style.width = `${width}px`;
    if (height) bodyEl.style.height = `${height}px`;
  } catch {
    // 讀取失敗（例如私密瀏覽模式擋掉 localStorage、或存進去的內容不是
    // 合法 JSON）就當作沒存過，維持卡片預設大小，不影響正常使用。
  }
}

// ResizeObserver 偵測使用者拖曳右下角把手時的大小變化：一邊即時重繪連線
// （卡片變大/變小，連線的接點位置也跟著變，拖曳群組卡片本身早就是這樣
// 即時重繪，這裡的手感要一致，不然拖完放開瞬間連線「跳」到新位置，體感
// 像卡住過）、一邊把最新大小存進 localStorage（見 groupBodySizeKey 的
// 說明，不需要特別只在拖曳「結束」才存，反正每次都是覆寫同一個 key，
// 存最後一次生效的大小結果一樣）。
function watchGroupBodyResize(bodyEl, bookId, groupKey, redrawConnections) {
  const observer = new ResizeObserver((entries) => {
    const entry = entries[0];
    if (!entry) return;
    const { inlineSize: width, blockSize: height } = entry.borderBoxSize?.[0] || {};
    if (!width || !height) return;
    try {
      localStorage.setItem(groupBodySizeKey(bookId, groupKey), JSON.stringify({ width, height }));
    } catch {
      // 存不進去（例如私密瀏覽模式、或 localStorage 容量滿了）就放棄記住這次調整，
      // 使用者這次調整的大小在畫面上仍然立刻生效，只是下次重新整理不會保留。
    }
    redrawConnections();
  });
  observer.observe(bodyEl);
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

  // 每張群組卡片（含「未分組」那張特殊的卡片，用固定的 'ungrouped' 當
  // key，因為它沒有真正的群組 id）還原上次拖曳調整過的大小、並且開始
  // 監看接下來的調整——整批 innerHTML 重寫之後才做，確保抓到的是這次
  // 剛畫出來、貨真價實在畫面上的 DOM 節點。
  trackEl.querySelectorAll('.group-card').forEach((cardEl) => {
    const bodyEl = cardEl.querySelector('.group-card-body');
    if (!bodyEl) return;
    const groupKey = cardEl.dataset.groupId || 'ungrouped';
    restoreGroupBodySize(bodyEl, bookId, groupKey);
    watchGroupBodyResize(bodyEl, bookId, groupKey, () => drawConnections(svgEl, labelSvgEl, boardEl, edges, showEdgePanel));
  });

  const options = personOptionsHtml(nodes, groups);
  fromSelect.innerHTML = options;
  toSelect.innerHTML = options;
  const enough = nodes.length >= 2;
  edgeForm.style.display = enough ? '' : 'none';
  edgeHint.style.display = enough ? 'none' : '';

  requestAnimationFrame(() => drawConnections(svgEl, labelSvgEl, boardEl, edges, showEdgePanel));
}
