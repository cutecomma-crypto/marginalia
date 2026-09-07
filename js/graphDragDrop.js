// 關係圖譜畫布上的拖放互動：人物卡片拖到別的群組／排序、群組卡片自由拖曳、
// 以及群組卡片標題列上（改名／副標／換色／刪除／快速新增人物）的表單邏輯。
// 這些全部要讀寫 renderGraphPage 手上的畫布狀態（groups/nodes/edges 會隨著
// reload() 整批換新），所以用一個共用的 `state` 物件（傳參考進來，直接改
// state.nodes 之類的屬性）取代原本 graph.js 裡各自獨立的 let 區域變數——
// 抽成獨立模組後沒有閉包可以共用區域變數，要嘛全部集中在一個物件裡互相看得到
// 最新值，要嘛每個函式簽名都要多帶好幾個參數，前者明顯乾淨很多。
// 一樣是從 graph.js 拆出來降低單一檔案行數的一部分（見 js/graphModel.js 開頭的說明）。
import { UNGROUPED } from './graphModel.js';
import { drawConnections } from './graphConnections.js';

// 存下群組卡片自由拖曳後的畫布座標。
async function saveGroupPosition(DB, state, groupId, x, y) {
  const group = state.groups.find((g) => g.id === groupId);
  if (!group) return;
  await DB.update('groups', { ...group, x, y });
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

// ctx: { state, DB, bookId, boardEl, svgEl, labelSvgEl, reload, showPersonPanel, showEdgePanel }
export function wireGroupCardEvents(trackEl, ctx) {
  const { state, DB, bookId, boardEl, svgEl, labelSvgEl, reload, showPersonPanel, showEdgePanel } = ctx;

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
        drawConnections(svgEl, labelSvgEl, boardEl, state.edges, showEdgePanel);
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
