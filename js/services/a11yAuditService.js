// 獨立、可插拔模組：無障礙輔助工具。
//
// auditMissingAriaLabels 是開發期用的檢查工具，不是自動修復器——這裡刻意
// 不「自動生成」aria-label，因為只有人知道那顆按鈕實際上是做什麼用的，
// 亂猜文字（例如照 emoji 反推）反而更誤導螢幕報讀器使用者。掃描結果印在
// console，方便你人工逐一在對應的頁面模組補上 aria-label。
export function auditMissingAriaLabels(root = document) {
  const buttons = root.querySelectorAll('button, [role="button"], a.btn');
  const missing = [];
  buttons.forEach((btn) => {
    const hasAriaLabel = btn.hasAttribute('aria-label') && btn.getAttribute('aria-label').trim();
    const hasTitle = btn.hasAttribute('title') && btn.getAttribute('title').trim();
    const visibleText = btn.textContent.replace(/\s+/g, '').trim();
    // 純 emoji／符號、或完全沒有文字，才視為「看起來像圖示按鈕」需要額外標註；
    // 一般有中文標籤的按鈕（例如「刪除」）已經有可讀名稱，不需要額外的 aria-label。
    const looksIconOnly = visibleText.length > 0 && visibleText.length <= 2;
    const hasNoText = visibleText.length === 0;
    if (!hasAriaLabel && !hasTitle && (looksIconOnly || hasNoText)) {
      missing.push(btn);
    }
  });
  if (missing.length > 0) {
    console.warn(`[a11yAudit] 找到 ${missing.length} 個疑似缺少 aria-label 的圖示按鈕：`, missing);
  } else {
    console.info('[a11yAudit] 沒有找到缺少 aria-label 的圖示按鈕。');
  }
  return missing;
}

// Focus 管理：開啟 Modal／Drawer 時，把焦點移進去、限制 Tab 循環在容器內，
// 並記住原本的焦點元素；關閉時把焦點還原，鍵盤使用者才不會「消失」在畫面上
// 找不到焦點在哪。回傳 release()，記得在關閉該 Modal／Drawer 時呼叫。
const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), input:not([disabled]), '
  + 'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function trapFocusReturn(containerEl) {
  const previouslyFocused = document.activeElement;
  const focusables = containerEl.querySelectorAll(FOCUSABLE_SELECTOR);
  if (focusables.length > 0) focusables[0].focus();

  function handleTabKey(event) {
    if (event.key !== 'Tab') return;
    const list = Array.from(containerEl.querySelectorAll(FOCUSABLE_SELECTOR));
    if (list.length === 0) return;
    const first = list[0];
    const last = list[list.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  containerEl.addEventListener('keydown', handleTabKey);

  return function release() {
    containerEl.removeEventListener('keydown', handleTabKey);
    previouslyFocused?.focus?.();
  };
}
