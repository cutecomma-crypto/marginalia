// 獨立、可插拔模組：選取文字（滑鼠選取或手機長按）時跳出的懸浮工具列
// 「[高亮] [劃詞翻譯] [朗讀] [複製]」。
//
// 「高亮」在 Marginalia 裡最自然的意思：把選到的這段文字存成一條佳句摘錄
// （對照 quotes.js 的資料結構），不是在畫面上疊一層看得到、但存不下來的顏色——
// 這裡刻意不自己碰 DB，onHighlight(selectedText, range) 這個 callback 交給
// 呼叫端決定「高亮」實際上要做什麼（通常就是 DB.add('quotes', ...)，見整合指南）。
//
// enableTranslate 預設是 false：劃詞翻譯會把選取文字送到第三方 API
// （見 translateService.js 開頭的警語），必須由呼叫端明確選擇要不要打開。

import { speak } from './speechService.js';
import { translateText } from './translateService.js';

const TOOLBAR_ID = 'marginalia-selection-toolbar';

function ensureToolbarEl() {
  let el = document.getElementById(TOOLBAR_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = TOOLBAR_ID;
    el.className = 'selection-toolbar';
    el.hidden = true;
    document.body.appendChild(el);
  }
  return el;
}

function positionToolbar(el, rect) {
  const top = window.scrollY + rect.top - el.offsetHeight - 8;
  const left = window.scrollX + rect.left + rect.width / 2 - el.offsetWidth / 2;
  el.style.top = `${Math.max(8, top)}px`;
  el.style.left = `${Math.max(8, left)}px`;
}

// root：只有選取範圍落在這個容器「裡面」才會跳出工具列（例如某本書的筆記／
// 心得／佳句顯示區），不會在整個網站任何地方選字都跳出來干擾。
// 回傳 { hide, destroy }：destroy() 會移除所有事件監聽，用在該畫面卸載的時候。
export function attachSelectionToolbar(rootEl, options = {}) {
  const { onHighlight, enableTranslate = false } = options;
  const toolbarEl = ensureToolbarEl();
  let lastRange = null;

  function hide() {
    toolbarEl.hidden = true;
    toolbarEl.innerHTML = '';
  }

  function renderIdle(selectedText) {
    toolbarEl.innerHTML = `
      <button type="button" data-action="highlight" aria-label="加入佳句摘錄">🖍️ 佳句摘錄</button>
      ${enableTranslate ? '<button type="button" data-action="translate" aria-label="劃詞翻譯">🌐 翻譯</button>' : ''}
      <button type="button" data-action="read" aria-label="朗讀選取文字">🔊 朗讀</button>
      <button type="button" data-action="copy" aria-label="複製選取文字">📋 複製</button>
    `;

    toolbarEl.querySelector('[data-action="highlight"]')?.addEventListener('click', () => {
      onHighlight?.(selectedText, lastRange);
      hide();
      window.getSelection()?.removeAllRanges();
    });

    toolbarEl.querySelector('[data-action="translate"]')?.addEventListener('click', async (event) => {
      event.stopPropagation();
      let resultEl = toolbarEl.querySelector('.selection-toolbar-result');
      if (!resultEl) {
        resultEl = document.createElement('div');
        resultEl.className = 'selection-toolbar-result';
        toolbarEl.appendChild(resultEl);
      }
      resultEl.textContent = '翻譯中…';
      try {
        resultEl.textContent = await translateText(selectedText, 'zh-TW');
      } catch (err) {
        resultEl.textContent = `翻譯失敗：${err.message}`;
      }
    });

    toolbarEl.querySelector('[data-action="read"]')?.addEventListener('click', () => {
      speak(selectedText);
    });

    toolbarEl.querySelector('[data-action="copy"]')?.addEventListener('click', async () => {
      await navigator.clipboard.writeText(selectedText);
      hide();
    });
  }

  function handleSelectionChange() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      hide();
      return;
    }
    const range = selection.getRangeAt(0);
    if (!rootEl.contains(range.commonAncestorContainer)) {
      hide();
      return;
    }
    const selectedText = selection.toString().trim();
    if (!selectedText) {
      hide();
      return;
    }
    lastRange = range.cloneRange();
    renderIdle(selectedText);
    toolbarEl.hidden = false;
    positionToolbar(toolbarEl, range.getBoundingClientRect());
  }

  // mouseup／touchend 都要重新檢查一次選取範圍——觸控裝置長按選字結束的時機，
  // 常常跟瀏覽器觸發 selectionchange 的時間點不同步，兩種事件都掛比較保險。
  const onMouseUp = () => handleSelectionChange();
  const onTouchEnd = () => handleSelectionChange();
  const onSelectionChange = () => {
    const selection = window.getSelection();
    if (selection && selection.isCollapsed) hide();
  };
  const onDocMouseDown = (event) => {
    if (!toolbarEl.contains(event.target) && !rootEl.contains(event.target)) hide();
  };

  rootEl.addEventListener('mouseup', onMouseUp);
  rootEl.addEventListener('touchend', onTouchEnd);
  document.addEventListener('selectionchange', onSelectionChange);
  document.addEventListener('mousedown', onDocMouseDown);

  return {
    hide,
    destroy() {
      rootEl.removeEventListener('mouseup', onMouseUp);
      rootEl.removeEventListener('touchend', onTouchEnd);
      document.removeEventListener('selectionchange', onSelectionChange);
      document.removeEventListener('mousedown', onDocMouseDown);
      hide();
    },
  };
}
