import { DB } from './db.js';
import { escapeHtml, showToast } from './utils.js';
import { pushEscapeHandler } from './services/keyboardShortcutsService.js';
import { ICON_LINK } from './icons.js';
import { nextGroupColor, loadGraphData, readEdgeStyleFields } from './graphModel.js';
import { edgeStyleFieldsHtml, wireCoupleAutoColor, wireEdgeColorSwatches } from './graphTemplates.js';
import { drawConnections } from './graphConnections.js';
import { renderBoardView } from './graphBoardView.js';
import { renderNetworkView } from './graphForceView.js';

// 本檔案是關係圖譜頁面的「外殼」（Shell）：工具列、側邊抽屜、縮放、全螢幕、
// 兩種檢視模式的自動偵測與手動切換——這些不管使用者現在看的是哪一種檢視
// 都完全共用。畫布中間實際畫出來的內容拆成兩個可插拔的檢視模組：
//   - js/graphBoardView.js ——「陣營看板」：既有的群組卡片版面（拖放、
//     自由定位），沒有引入任何新的資料結構，讀寫的都是同一組 groups/
//     nodes/edges，桌面大螢幕（>1024px）預設顯示這個。
//   - js/graphForceView.js ——「網狀圖譜」：手刻的力導向物理模擬（見
//     js/graphForceSimulation.js），讀寫的同樣是 groups/nodes/edges，只是
//     換一種「節點＋連線自動排開」的視覺呈現，並且是手機/平板（≤1024px）
//     的預設畫面、也是「點兩下建立關係」快速連結流程唯一會用到的地方。
// 兩者共用同一份 state（groups/nodes/edges）、同一個 reload()、同一個
// showPersonPanel()/showEdgePanel() 編輯面板——「編輯一個人物/一段關係」
// 這件事不管在哪種檢視底下點出來都應該長一樣，不用各自重寫一份表單。
//
// 這支檔案原本 1128 行、後來拆成五個模組後剩 432 行；這次加入雙檢視架構
// 沒有讓它再變肥：畫布渲染邏輯整段搬進兩個新的檢視模組，這裡繼續維持
// 「只管串起畫面、串起狀態」的膠水邏輯。
const VIEW_BREAKPOINT = 1024;

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
          <div class="graph-view-toggle" id="graph-view-toggle" role="group" aria-label="切換檢視模式">
            <button type="button" class="graph-view-toggle-btn" data-view="board" data-tooltip="陣營看板" aria-label="切換到陣營看板">⊞ 陣營看板</button>
            <button type="button" class="graph-view-toggle-btn" data-view="network" data-tooltip="網狀圖譜" aria-label="切換到網狀圖譜">🕸️ 網狀圖譜</button>
          </div>
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
              <div class="graph-board-view" id="graph-board-view">
                <svg class="connections-overlay" id="connections-svg"></svg>
                <div class="group-track" id="group-track"></div>
                <svg class="connections-overlay connections-labels-overlay" id="connections-labels-svg"></svg>
              </div>
              <svg class="graph-network-view" id="graph-network-view" hidden></svg>
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
          <div id="board-add-content">
            <p class="graph-hint">拖曳人物卡片可以換群組；點一下人物或連線可以編輯／刪除。</p>
            <p class="empty" id="edge-form-hint">至少要有兩個人物才能建立關係。</p>
            <form id="edge-form" class="book-form compact-form" style="display:none;">
              <label>從<select name="fromNodeId" id="edge-from"></select></label>
              <label>到<select name="toNodeId" id="edge-to"></select></label>
              <label>關係
                <input name="label" type="text" placeholder="例如：朋友、敵人、家人、懷疑...">
              </label>
              ${edgeStyleFieldsHtml(null)}
              <div class="form-actions"><button type="submit" class="btn btn-primary">新增關係</button></div>
            </form>
          </div>
          <div id="network-add-content" hidden>
            <p class="graph-hint">在畫布上點一下人物卡片，選擇「🔗 連結」，再點一下另一位人物，輸入關係名稱即可建立連線。</p>
          </div>
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
  const boardViewEl = container.querySelector('#graph-board-view');
  const networkViewEl = container.querySelector('#graph-network-view');
  const trackEl = container.querySelector('#group-track');
  const svgEl = container.querySelector('#connections-svg');
  const labelSvgEl = container.querySelector('#connections-labels-svg');
  const emptyStateEl = container.querySelector('#canvas-empty-state');
  const canvasWrapEl = container.querySelector('#canvas-wrap');
  const addGroupBtn = container.querySelector('#add-group-btn');
  const edgeForm = container.querySelector('#edge-form');
  const fromSelect = container.querySelector('#edge-from');
  const toSelect = container.querySelector('#edge-to');
  const edgeHint = container.querySelector('#edge-form-hint');
  const boardAddContent = container.querySelector('#board-add-content');
  const networkAddContent = container.querySelector('#network-add-content');
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
    if (event.target === boardEl || event.target === trackEl || event.target === networkViewEl) closeDrawer();
  });

  wireCoupleAutoColor(edgeForm);
  wireEdgeColorSwatches(edgeForm);

  // groups/nodes/edges 集中放在一個共用物件裡（不是各自獨立的 let 區域變數），
  // 好讓拆到 graphBoardView.js／graphForceView.js 的兩個檢視模組都能直接讀到
  // reload() 換上的最新資料——兩邊都是「同一份 state」，不是各自維護一份拷貝。
  const state = { groups: [], nodes: [], edges: [] };

  async function reload() {
    const data = await loadGraphData(bookId);
    state.groups = data.groups;
    state.nodes = data.nodes;
    state.edges = data.edges;
    draw();
  }

  function showPersonPanel(person) {
    switchTab('detail');
    openDrawer();
    selectionPanel.innerHTML = `
      <h4>編輯人物</h4>
      <form id="edit-person-form" class="book-form compact-form">
        <label>姓名<input name="label" value="${escapeHtml(person.label)}" required></label>
        <label>頭銜／備註<input name="title" value="${escapeHtml(person.title)}" placeholder="例如：代理警隊長"></label>
        <label>角色狀態
          <input type="text" name="status" value="${escapeHtml(person.status)}" placeholder="例如：死亡、失蹤、待驗證、黑化...">
        </label>
        <label>人物簡介
          <textarea name="description" rows="2" placeholder="輸入簡短背景或重要記事...">${escapeHtml(person.description)}</textarea>
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

  // ---- 響應式雙檢視架構：>1024px 預設「陣營看板」，≤1024px 預設「網狀圖譜」，
  // 右上角一顆手動切換鈕隨時可以蓋過去。使用者手動切過一次之後，這次停留
  // 在這個頁面期間就不再被自動偵測蓋回去——尊重使用者剛剛做的選擇，不會
  // 使用者選了看板、卻因為視窗被稍微調整寬度就被硬跳回網狀圖譜。 ----
  let currentView = window.innerWidth > VIEW_BREAKPOINT ? 'board' : 'network';
  let manualOverride = false;
  const viewToggleButtons = container.querySelectorAll('.graph-view-toggle-btn');

  // 用 setAttribute/removeAttribute 手動切換 hidden，不是直接指定 `.hidden = true/false`——
  // 這是實測抓出來的真實瀏覽器行為差異：`.hidden` 這個 IDL 屬性在一般 HTML 元素
  // （<div>／<button>……）上會正確反映到 hidden 內容屬性，但在 <svg> 根元素
  // （SVGSVGElement，這裡就是 #graph-network-view）上，這個引擎並不會把
  // `.hidden = false` 真的反映成拿掉 hidden 屬性——寫入的值只是停在一個
  // 獨立的 JS 屬性上，DOM 屬性跟畫面樣式完全沒有跟著變，切換鈕點了看起來
  // 有作用（class 有切換、log 讀回來也是 false），畫布卻永遠是一片空白。
  // 改用明確的 attribute 操作，四個元素（含兩個 <div>）統一同一套寫法，
  // 不管是不是 SVG 元素都保證真的加上/拿掉屬性，CSS 的 [hidden] 選擇器
  // 才會確實生效。
  function setHidden(el, hidden) {
    if (hidden) el.setAttribute('hidden', '');
    else el.removeAttribute('hidden');
  }
  function applyViewVisibility() {
    viewToggleButtons.forEach((btn) => btn.classList.toggle('is-active', btn.dataset.view === currentView));
    setHidden(boardViewEl, currentView !== 'board');
    setHidden(networkViewEl, currentView !== 'network');
    setHidden(boardAddContent, currentView !== 'board');
    setHidden(networkAddContent, currentView !== 'network');
  }

  function setView(view, { manual = false } = {}) {
    if (view === currentView && !manual) return;
    if (manual) manualOverride = true;
    currentView = view;
    applyViewVisibility();
    draw();
  }

  viewToggleButtons.forEach((btn) => {
    btn.addEventListener('click', () => setView(btn.dataset.view, { manual: true }));
  });

  window.addEventListener('resize', () => {
    if (manualOverride) return;
    const next = window.innerWidth > VIEW_BREAKPOINT ? 'board' : 'network';
    setView(next);
  });

  function draw() {
    emptyStateEl.hidden = !(state.groups.length === 0 && state.nodes.length === 0);
    if (currentView === 'board') {
      renderBoardView({
        state, DB, bookId, trackEl, boardEl, svgEl, labelSvgEl,
        edgeForm, fromSelect, toSelect, edgeHint,
        reload, showPersonPanel, showEdgePanel,
      });
    } else {
      renderNetworkView({
        state, DB, bookId, svgEl: networkViewEl, wrapEl: canvasWrapEl,
        reload, showPersonPanel, showEdgePanel,
      });
    }
  }

  applyViewVisibility();

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

  // 縮放：直接對 .canvas-board 套 CSS transform:scale，兩種檢視共用同一顆
  // transform（陣營看板的卡片、網狀圖譜的 SVG 都在它底下，一起等比例縮放）。
  // 陣營看板另外需要縮放後重新呼叫 drawConnections 讓連線重新對齊卡片新的
  // 視覺位置（drawConnections 是用 getBoundingClientRect 量測，量出來的本來
  // 就已經反映縮放後的樣子）；網狀圖譜的線是靠自己內部的 SVG 座標系畫的，
  // 不是量測 DOM 位置，純 CSS 縮放本身就已經正確，不需要另外重畫。
  // 手機螢幕（≤768px）起始縮放比例調小：畫布卡片是用固定像素座標排版
  // （見 graphBoardView.js 的 GRID_COL_STEP／GRID_ROW_STEP），100% 縮放在桌面可以看到
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
    if (currentView === 'board') {
      requestAnimationFrame(() => drawConnections(svgEl, labelSvgEl, boardEl, state.edges, showEdgePanel));
    }
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
    // 摸索著往下/往右找剛剛按下去到底新增在哪裡（只有陣營看板有這張卡片，
    // 網狀圖譜下找不到對應的 DOM 元素，querySelector 拿到 null 就跳過即可）。
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
