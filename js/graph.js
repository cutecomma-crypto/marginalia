import { DB } from './db.js';
import { escapeHtml, showToast } from './utils.js';
import { pushEscapeHandler } from './services/keyboardShortcutsService.js';
import { ICON_LINK } from './icons.js';
import { nextGroupColor, loadGraphData, readEdgeStyleFields } from './graphModel.js';
import {
  datalistOptions,
  groupCardHtml,
  ungroupedTrayHtml,
  edgeStyleFieldsHtml,
  personOptionsHtml,
  wireCoupleAutoColor,
  wireEdgeColorSwatches,
} from './graphTemplates.js';
import { drawConnections } from './graphConnections.js';
import { wireGroupCardEvents } from './graphDragDrop.js';

// 本檔案是關係圖譜頁面的主控制器（畫面組裝、狀態管理、事件串接）。
// 純資料／色盤邏輯拆到 js/graphModel.js，HTML 樣板拆到 js/graphTemplates.js，
// SVG 連線繪製拆到 js/graphConnections.js，群組／人物卡片的拖放與表單互動
// 拆到 js/graphDragDrop.js——這支檔案原本 1128 行，是全站健檢中單一檔案
// 行數最高的一個，拆成五份各自獨立、職責單一的模組後，這裡只剩「串起
// 畫面、串起狀態、串起各模組」的膠水邏輯，見各檔案開頭的說明。

function byOrder(a, b) {
  return (a.order ?? 0) - (b.order ?? 0) || a.id - b.id;
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
            <button type="button" class="canvas-tool-btn" id="zoom-out-btn" data-tooltip="縮小" aria-label="縮小">－</button>
            <span class="canvas-zoom-level" id="zoom-level">100%</span>
            <button type="button" class="canvas-tool-btn" id="zoom-in-btn" data-tooltip="放大" aria-label="放大">＋</button>
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
              <svg class="connections-overlay connections-labels-overlay" id="connections-labels-svg"></svg>
            </div>
            <div class="canvas-empty-state" id="canvas-empty-state" hidden>
              <p>點擊右上角「＋ 新增群組」開始建立角色關係圖</p>
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
  const labelSvgEl = container.querySelector('#connections-labels-svg');
  const emptyStateEl = container.querySelector('#canvas-empty-state');
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

  // groups/nodes/edges 集中放在一個共用物件裡（不是各自獨立的 let 區域變數），
  // 好讓拆到 js/graphDragDrop.js 的拖放邏輯也能直接讀到 reload() 換上的最新資料——
  // 見 graphDragDrop.js 開頭對這個設計的說明。
  const state = { groups: [], nodes: [], edges: [] };

  async function reload() {
    const data = await loadGraphData(bookId);
    state.groups = data.groups;
    state.nodes = data.nodes;
    state.edges = data.edges;
    draw();
  }

  function draw() {
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

    // 畫布完全空白（沒有任何群組、也沒有任何人物）才顯示置中的引導文字——
    // 只有群組數是 0 但還留著未分組人物的情況不算「完全空白」，上面的
    // 未分組卡片本身已經有內容可以看，不需要再疊一句「這裡是空的」。
    emptyStateEl.hidden = !(groups.length === 0 && nodes.length === 0);

    wireGroupCardEvents(trackEl, {
      state, DB, bookId, boardEl, svgEl, labelSvgEl, reload, showPersonPanel, showEdgePanel,
    });

    const options = personOptionsHtml(nodes, groups);
    fromSelect.innerHTML = options;
    toSelect.innerHTML = options;
    const enough = nodes.length >= 2;
    edgeForm.style.display = enough ? '' : 'none';
    edgeHint.style.display = enough ? 'none' : '';

    requestAnimationFrame(() => drawConnections(svgEl, labelSvgEl, boardEl, edges, showEdgePanel));
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
            ${state.groups.map((g) => `<option value="${g.id}" ${person.groupId === g.id ? 'selected' : ''}>${escapeHtml(g.name)}</option>`).join('')}
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
        ? state.nodes.filter((n) => n.id !== person.id && (n.groupId || null) === newGroupId).length
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
      const related = state.edges.filter((e) => e.fromNodeId === person.id || e.toNodeId === person.id);
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
  // 手機螢幕（≤768px）起始縮放比例調小：畫布卡片是用固定像素座標排版
  // （見 draw() 的 GRID_COL_STEP／GRID_ROW_STEP），100% 縮放在桌面可以看到
  // 大部分內容，在手機螢幕一開始只會看到左上角一小塊，其餘群組卡片都在
  // 可視範圍外——改成偵測到手機寬度就用 45%（落在使用者要求的 40%-50%
  // 區間、也不低於 MIN_ZOOM），讓大部分群組卡片一開始就進到畫面裡。
  // 「重設縮放」按鈕也吃同一個預設值（見下面 DEFAULT_ZOOM 的用法），不然
  // 使用者在手機上按「重設」反而會跳回太大的 100%，等於重新製造同一個問題。
  const MOBILE_ZOOM_BREAKPOINT = 768;
  const MOBILE_DEFAULT_ZOOM = 0.45;
  const MIN_ZOOM = 0.4;
  const MAX_ZOOM = 2;
  const DEFAULT_ZOOM = window.innerWidth <= MOBILE_ZOOM_BREAKPOINT ? MOBILE_DEFAULT_ZOOM : 1;
  let zoomLevel = DEFAULT_ZOOM;
  const zoomLevelEl = container.querySelector('#zoom-level');

  function applyZoom() {
    boardEl.style.transform = `scale(${zoomLevel})`;
    boardEl.style.transformOrigin = '0 0';
    zoomLevelEl.textContent = `${Math.round(zoomLevel * 100)}%`;
    requestAnimationFrame(() => drawConnections(svgEl, labelSvgEl, boardEl, state.edges, showEdgePanel));
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
    zoomLevel = DEFAULT_ZOOM;
    applyZoom();
  });
  // 滾輪／觸控板縮放刻意不做：畫布縮放完全交給頂部工具列的 −／＋／重設三顆按鈕，
  // 使用者在瀏覽或用滾輪捲動畫布找位置時，不會不小心把畫面滾到暴增暴縮。
  // 拿掉這個監聽器後，滾輪在 .canvas-wrap 上就是它原生 overflow:auto 的捲動行為。

  addGroupBtn.addEventListener('click', async () => {
    const newGroupId = await DB.add('groups', { bookId, name: '新群組', color: nextGroupColor(state.groups.length) });
    await reload();
    // 新群組永遠排在網格順序最後一格，畫布內容一多就可能落在目前捲動位置
    // 看不到的地方——新增後自動把這張卡片捲進可視範圍，不用使用者自己
    // 摸索著往下/往右找剛剛按下去到底新增在哪裡。
    const newCardEl = trackEl.querySelector(`.group-card[data-group-id="${newGroupId}"]`);
    if (newCardEl) newCardEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
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
  // 只有手機起始縮放（DEFAULT_ZOOM !== 1）才需要在載入時多套用一次——
  // zoomLevel 變數雖然已經是縮小過的值，但畫面本身的 transform:scale 要靠
  // applyZoom() 才會真的套用上去，不然卡片還是照瀏覽器預設 100% 畫出來，
  // 縮放膠囊卻顯示 45%，數字跟畫面對不上。桌面版 DEFAULT_ZOOM 是 1，
  // 套用 scale(1) 是無害的恆等變換，不用另外判斷跳過。
  applyZoom();
}
