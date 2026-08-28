// 獨立、可插拔模組：全域鍵盤快捷鍵。
//
// Esc 用「註冊/取消註冊」堆疊的方式運作，讓各頁面自己決定要不要參與，
// 這個模組完全不需要認識任何特定頁面的 DOM 結構（不用知道 .graph-drawer、
// .modal-backdrop 這些 class 叫什麼名字）：哪個畫面元件目前最後被開啟，
// 按 Esc 就先問它要不要處理、要處理就消費掉這次按鍵，不繼續往下一層問。
//
// J/K/方向鍵／Space 這組快捷鍵原本是設計給「翻頁」用的，但 Marginalia 目前
// 沒有分頁式的內文閱讀畫面——這裡刻意保留成「可選、預設不做任何事」的
// onNextPage／onPrevPage callback，呼叫端可以自行決定要接什麼行為
// （例如在書籍詳情頁把它們接到「切換到下一個／上一個分頁」，
// 或在書籍列表接到「跳到下一本／上一本書」），不接就完全沒有作用。

const escapeHandlerStack = [];

export function pushEscapeHandler(handler) {
  escapeHandlerStack.push(handler);
  return function popEscapeHandler() {
    const idx = escapeHandlerStack.indexOf(handler);
    if (idx !== -1) escapeHandlerStack.splice(idx, 1);
  };
}

export function focusSearchInput(selector = '#book-search, #quote-search') {
  const input = document.querySelector(selector);
  if (input) {
    input.focus();
    input.select?.();
    return true;
  }
  return false;
}

function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

let uninstall = null;

// searchInputSelector：Cmd/Ctrl+F 要聚焦的搜尋框選擇器（找不到就讓瀏覽器原生
// 頁內搜尋照常運作，不會強制攔截）。
// onPrevPage／onNextPage：見檔案開頭說明，選用。
// 回傳一個 uninstall() 函式，重新呼叫 installGlobalShortcuts 前不需要手動呼叫，
// 這裡已經做了「只裝一份監聽」的保護。
export function installGlobalShortcuts({ searchInputSelector, onPrevPage, onNextPage } = {}) {
  if (uninstall) uninstall();

  function handleKeydown(event) {
    const isCmdOrCtrl = event.metaKey || event.ctrlKey;

    if (isCmdOrCtrl && event.key.toLowerCase() === 'f') {
      const focused = focusSearchInput(searchInputSelector);
      if (focused) event.preventDefault();
      return;
    }

    if (event.key === 'Escape') {
      const handler = escapeHandlerStack[escapeHandlerStack.length - 1];
      if (handler) {
        // handler 回傳 false 代表「這次 Esc 我其實沒有東西可關」（例如抽屜早就是關的），
        // 這種情況故意不 preventDefault，讓瀏覽器原生的 Esc 行為（例如退出全螢幕）
        // 不會被一個「registered 但這次沒做事」的 handler 意外攔下來。
        const consumed = handler();
        if (consumed !== false) event.preventDefault();
      }
      return;
    }

    // 排除「正在輸入文字」的情境（輸入框／文字區塊／contenteditable），
    // 不然在筆記欄位打字打到 j/k/空白鍵會被誤判成翻頁指令。
    if (isTypingTarget(event.target)) return;

    if ((event.key === 'j' || event.key === 'ArrowDown' || event.key === ' ') && onNextPage) {
      onNextPage();
      event.preventDefault();
    } else if ((event.key === 'k' || event.key === 'ArrowUp') && onPrevPage) {
      onPrevPage();
      event.preventDefault();
    }
  }

  document.addEventListener('keydown', handleKeydown);
  uninstall = () => {
    document.removeEventListener('keydown', handleKeydown);
    uninstall = null;
  };
  return uninstall;
}
