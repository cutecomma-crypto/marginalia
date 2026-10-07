// 關係圖譜畫布上的拖放互動：人物卡片拖到別的群組／排序、群組卡片自由拖曳、
// 以及群組卡片標題列上（改名／副標／換色／刪除／快速新增人物）的表單邏輯。
// 這些全部要讀寫 renderGraphPage 手上的畫布狀態（groups/nodes/edges 會隨著
// reload() 整批換新），所以用一個共用的 `state` 物件（傳參考進來，直接改
// state.nodes 之類的屬性）取代原本 graph.js 裡各自獨立的 let 區域變數——
// 抽成獨立模組後沒有閉包可以共用區域變數，要嘛全部集中在一個物件裡互相看得到
// 最新值，要嘛每個函式簽名都要多帶好幾個參數，前者明顯乾淨很多。
// 一樣是從 graph.js 拆出來降低單一檔案行數的一部分（見 js/graphModel.js 開頭的說明）。
import { UNGROUPED } from './graphModel.js';
import { drawConnections, getBoardScale } from './graphConnections.js';

// 使用者反映未分組的獨立人物一多（支線角色還沒整理進群組），要一張一張
// 拖曳調整位置「有點累」——這裡補上類似繪圖軟體常見的「框選＋一起拖曳」：
// 在畫布空白處按住拖出一個框，框到的獨立卡片就加入選取，之後拖曳其中
// 任何一張被選取的卡片，所有被選取的卡片會一起移動，不用再一張一張拖。
// 選取狀態（selectedPersonIds）刻意放在模組層級，不是 state 或 DOM 屬性——
// reload() 會把 trackEl 底下整批 DOM 換新，選取狀態要撐過這次換新才有
// 意義（撐到下一次拖曳），放在 state 上也可以，但這個狀態純粹是畫布的
// 暫時性 UI 狀態（不用存檔、也不是書的資料），獨立出來不跟著 state 混在
// 一起，語意上更清楚。
const selectedPersonIds = new Set();

function applySelectionHighlight(trackEl) {
  trackEl.querySelectorAll('.group-card.ungrouped-tray').forEach((card) => {
    const personEl = card.querySelector('.person-item');
    const id = personEl ? Number(personEl.dataset.nodeId) : null;
    card.classList.toggle('is-multi-selected', id != null && selectedPersonIds.has(id));
  });
}

// 存下群組卡片自由拖曳後的畫布座標。
async function saveGroupPosition(DB, state, groupId, x, y) {
  const group = state.groups.find((g) => g.id === groupId);
  if (!group) return;
  await DB.update('groups', { ...group, x, y });
}

// 未分組的獨立人物卡片拖曳後的座標存進 localStorage，不是 Supabase 的
// nodes 表——這是刻意的選擇，不是偷懶：nodes 表目前沒有 x/y 欄位（只有
// groups 表有），貿然把這兩個欄位塞進 DB.update() 的 payload，對登入
// 雲端帳號的使用者會複製這個專案踩過的舊 Bug（多送一個資料庫沒有的
// 欄位，本機模式測不出問題，只有連 Supabase 才會出錯或靜默失敗）。
// 存 localStorage 只有目前這台瀏覽器記得住，換裝置或換瀏覽器要重新拖
// 一次——換來的是完全不用碰 Supabase schema、不用使用者手動跑 SQL
// 就能立刻用，這個取捨值得（跟之前群組卡片內容區「可調整大小」那次
// 考量一致，只是這次是位置不是大小）。
function ungroupedPositionKey(bookId, personId) {
  return `marginalia_ungrouped_pos_${bookId}_${personId}`;
}

export function restoreUngroupedPosition(bookId, personId) {
  try {
    const raw = localStorage.getItem(ungroupedPositionKey(bookId, personId));
    if (!raw) return null;
    const { x, y } = JSON.parse(raw);
    return (typeof x === 'number' && typeof y === 'number') ? { x, y } : null;
  } catch {
    return null;
  }
}

function saveUngroupedPosition(bookId, personId, x, y) {
  try {
    localStorage.setItem(ungroupedPositionKey(bookId, personId), JSON.stringify({ x, y }));
  } catch {
    // 存不進去（例如私密瀏覽模式、或 localStorage 容量滿了）就放棄記住
    // 這次拖曳的位置，畫面上這次操作仍然立刻生效，只是下次重新整理後
    // 會掉回預設的網格位置，不影響正常使用。
  }
}

// 把 personId 放進 targetGroupId（null＝未分組），插在 insertBeforeId 那個人前面
// （insertBeforeId 是 null 就放最後）。同群組內其他人依序重新編號，維持你拖曳排出來的順序。
async function movePerson(DB, state, personId, targetGroupId, insertBeforeId) {
  const person = state.nodes.find((n) => n.id === personId);
  if (!person) return;
  const siblings = state.nodes
    .filter((n) => n.id !== personId && (n.groupId || null) === targetGroupId)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id - b.id);
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

function clearDropHighlights(trackEl) {
  trackEl.querySelectorAll('.drag-insert-before, .drag-insert-after').forEach((el) => {
    el.classList.remove('drag-insert-before', 'drag-insert-after');
  });
  trackEl.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over'));
}

// 在畫布空白處（不是卡片本身）按住拖出一個框，鬆開時把框到的獨立人物
// 卡片整批加入選取。只在 trackEl 自己的空白區域才會觸發——event.target
// 落在任何 .group-card 裡面（包含分組卡片）一律當作「使用者是要拖卡片
// 或點卡片」，不搶走那個手勢，直接 return。
// 框選範圍要換算成「縮放套用之前」的本地座標（除以 getBoardScale() 量到
// 的倍率）才能跟卡片的 offsetLeft／offsetTop（本來就是縮放前的版面座標，
// 見 graphConnections.js 開頭的說明）放在同一套單位比較，不然縮放不是
// 100% 時框選範圍會跟畫面上看到的位置對不上。
// 按下去沒有真的拖出範圍（純點擊）就當作「點空白處清除選取」，不用
// 另外做一個「取消選取」按鈕。
function wireMarqueeSelection(trackEl, boardEl) {
  // wireGroupCardEvents() 每次 reload() 都會重新呼叫一次，底下那些用
  // trackEl.querySelectorAll(...) 抓「卡片內部元素」掛監聽器的寫法天生
  // 沒事——trackEl.innerHTML 整批換新，舊的子節點連同監聽器一起被丟棄，
  // 新節點才會被掛上新的監聽器，不會疊加。但這裡監聽器是直接掛在
  // trackEl 本身，trackEl 這個節點從頭到尾只建立一次（只有它的 innerHTML
  // 被整批換掉，節點本身沒有被換掉），如果每次 reload() 都重新掛一次，
  // 監聽器會一直疊加、同一次框選動作觸發好幾倍次的選取邏輯。用一個
  // dataset 旗標擋掉第二次以後的掛載，保證整個頁面存活期間只掛一次。
  if (trackEl.dataset.marqueeWired) return;
  trackEl.dataset.marqueeWired = '1';
  // selectedPersonIds 是整個模組共用的狀態，換到別本書的關係圖（trackEl
  // 第一次被建立）時清空一次——人物 id 是跨書共用的全域流水號，不清空
  // 的話，上一本書選取過的 id 萬一剛好跟這本書的某個人物 id 相同，會
  // 出現莫名其妙的選取外框。
  selectedPersonIds.clear();
  trackEl.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    if (event.target.closest('.group-card')) return;
    event.preventDefault();
    const scale = getBoardScale(boardEl);
    const trackRect = trackEl.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    let moved = false;
    const box = document.createElement('div');
    box.className = 'marquee-select-box';
    trackEl.appendChild(box);

    function localRectFrom(curX, curY) {
      const x1 = Math.min(startX, curX);
      const x2 = Math.max(startX, curX);
      const y1 = Math.min(startY, curY);
      const y2 = Math.max(startY, curY);
      return {
        left: (x1 - trackRect.left) / scale,
        top: (y1 - trackRect.top) / scale,
        width: (x2 - x1) / scale,
        height: (y2 - y1) / scale,
      };
    }

    function onMove(moveEvent) {
      if (!moved) {
        if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 4) return;
        moved = true;
      }
      const rect = localRectFrom(moveEvent.clientX, moveEvent.clientY);
      box.style.left = `${rect.left}px`;
      box.style.top = `${rect.top}px`;
      box.style.width = `${rect.width}px`;
      box.style.height = `${rect.height}px`;
    }

    function onUp(upEvent) {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      box.remove();
      if (moved) {
        const rect = localRectFrom(upEvent.clientX, upEvent.clientY);
        selectedPersonIds.clear();
        trackEl.querySelectorAll('.group-card.ungrouped-tray').forEach((card) => {
          const intersects = card.offsetLeft < rect.left + rect.width
            && card.offsetLeft + card.offsetWidth > rect.left
            && card.offsetTop < rect.top + rect.height
            && card.offsetTop + card.offsetHeight > rect.top;
          if (!intersects) return;
          const personEl = card.querySelector('.person-item');
          if (personEl) selectedPersonIds.add(Number(personEl.dataset.nodeId));
        });
      } else {
        selectedPersonIds.clear();
      }
      applySelectionHighlight(trackEl);
    }

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  });
}

// ctx: { state, DB, bookId, boardEl, svgEl, labelSvgEl, reload, showPersonPanel, showEdgePanel }
export function wireGroupCardEvents(trackEl, ctx) {
  const { state, DB, bookId, boardEl, svgEl, labelSvgEl, reload, showPersonPanel, showEdgePanel } = ctx;

  // reload() 每次都會把 trackEl 底下整批 DOM 換新，換新後的卡片當然不會
  // 自動帶著「這張之前有被框選」的樣式——用模組層級存的 selectedPersonIds
  // 重新套用一次，拖完一批之後的選取狀態才能延續到下一次操作，不會每次
  // reload() 就悄悄清空。
  applySelectionHighlight(trackEl);
  wireMarqueeSelection(trackEl, boardEl);

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
        clearDropHighlights(trackEl);
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
        clearDropHighlights(trackEl);
        if (!dragging) {
          const person = state.nodes.find((n) => n.id === nodeId);
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
          await movePerson(DB, state, nodeId, targetGroupId, insertBeforeId);
          await reload();
          return;
        }
        const targetBody = hovered ? hovered.closest('[data-drop-group]') : null;
        if (targetBody) {
          const target = targetBody.dataset.dropGroup;
          const targetGroupId = target === UNGROUPED ? null : Number(target);
          await movePerson(DB, state, nodeId, targetGroupId, null);
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
        drawConnections(svgEl, labelSvgEl, boardEl, state.edges, showEdgePanel, bookId);
      }
      async function onUp() {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        card.classList.remove('is-dragging');
        await saveGroupPosition(DB, state, groupId, card.offsetLeft, card.offsetTop);
        await reload();
      }
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    });
  });

  // 獨立人物卡片（未分組）自由拖曳：使用者反映原本只能把人物拖進某個
  // 群組，沒辦法像群組卡片一樣直接拖著整張卡片調整位置，只能卡在固定的
  // 網格座標上——這裡補上跟群組卡片標題列同一套拖曳邏輯，差別只在拖曳
  // 目標是 .ungrouped-card-handle（獨立卡片沒有標題列可以附著，見
  // graphTemplates.js 的說明）、放開後存位置的地方是 localStorage 不是
  // Supabase（見 saveUngroupedPosition 的說明）。
  //
  // 使用者後來反映獨立人物一多，一張一張拖曳調整位置「有點累」，這裡
  // 加上「拖其中一張，框選中的全部一起動」：按下去的這張卡片如果本身
  // 就在目前的框選範圍（selectedPersonIds）裡、且框選範圍不只一張，
  // 就把所有被選取的卡片都當成這次拖曳的對象，用同一組滑鼠位移量平移；
  // 否則維持原本「只拖這一張」的行為——即使框選範圍裡還有別的卡片，
  // 拖一張不在選取範圍內的卡片也只會移動它自己，不會波及其他已選取的
  // 卡片，使用者才能在框選一批之後，還是能單獨挑一張出來微調位置。
  // 滑鼠位移量要除以 getBoardScale() 量到的縮放倍率，換算回卡片
  // offsetLeft／offsetTop 用的那套「縮放前」座標，不然縮放不是 100%
  // 時卡片移動的距離會跟滑鼠實際移動的距離對不上。
  trackEl.querySelectorAll('.ungrouped-card-handle').forEach((handle) => {
    handle.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      const card = handle.closest('.group-card.ungrouped-tray');
      if (!card) return;
      const personEl = card.querySelector('.person-item');
      const personId = personEl ? Number(personEl.dataset.nodeId) : null;
      if (personId == null) return;

      const isMultiDrag = selectedPersonIds.has(personId) && selectedPersonIds.size > 1;
      const dragCards = isMultiDrag
        ? Array.from(trackEl.querySelectorAll('.group-card.ungrouped-tray')).filter((c) => {
          const p = c.querySelector('.person-item');
          return p && selectedPersonIds.has(Number(p.dataset.nodeId));
        })
        : [card];

      const scale = getBoardScale(boardEl);
      const startX = event.clientX;
      const startY = event.clientY;
      const origins = dragCards.map((c) => ({ card: c, left: c.offsetLeft, top: c.offsetTop }));
      dragCards.forEach((c) => c.classList.add('is-dragging'));

      function onMove(moveEvent) {
        const dx = (moveEvent.clientX - startX) / scale;
        const dy = (moveEvent.clientY - startY) / scale;
        origins.forEach(({ card: c, left, top }) => {
          c.style.left = `${Math.max(0, left + dx)}px`;
          c.style.top = `${Math.max(0, top + dy)}px`;
        });
        drawConnections(svgEl, labelSvgEl, boardEl, state.edges, showEdgePanel, bookId);
      }
      async function onUp() {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        origins.forEach(({ card: c }) => {
          c.classList.remove('is-dragging');
          const p = c.querySelector('.person-item');
          const id = p ? Number(p.dataset.nodeId) : null;
          if (id != null) saveUngroupedPosition(bookId, id, c.offsetLeft, c.offsetTop);
        });
        await reload();
      }
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    });
  });

  trackEl.querySelectorAll('.group-name-input').forEach((input) => {
    input.addEventListener('change', async () => {
      const group = state.groups.find((g) => g.id === Number(input.dataset.groupId));
      if (!group) return;
      await DB.update('groups', { ...group, name: input.value.trim() || '未命名群組' });
      await reload();
    });
  });

  trackEl.querySelectorAll('.group-subtitle-input').forEach((input) => {
    input.addEventListener('change', async () => {
      const group = state.groups.find((g) => g.id === Number(input.dataset.groupId));
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
        const group = state.groups.find((g) => g.id === Number(picker.dataset.groupId));
        if (!group) return;
        await DB.update('groups', { ...group, color: swatch.dataset.hex });
        await reload();
      });
    });
  });

  trackEl.querySelectorAll('.group-delete-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const group = state.groups.find((g) => g.id === Number(btn.dataset.groupId));
      if (!group) return;
      if (!window.confirm(`確定要刪除群組「${group.name}」嗎？裡面的人物不會被刪除，會變成未分組。`)) return;
      const members = state.nodes.filter((n) => n.groupId === group.id);
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
      const siblingCount = state.nodes.filter((n) => (n.groupId || null) === groupId).length;
      // 打的名字如果跟現有人物一模一樣，直接把那個人搬過來，不要另外新增一個重複的人物
      // （例如群組被刪除、人物變未分組後，想把他重新加回某個群組）。
      const existing = state.nodes.find((n) => n.label.trim() === name);
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
