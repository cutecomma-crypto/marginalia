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

    // 觸控裝置上，手指按在工具列的按鈕上（touchstart／mousedown）這個動作本身
    // 就會被瀏覽器當成「點到選取範圍以外的地方」，直接把文字選取清空——選取一清空，
    // 下面的 selectionchange 監聽就會把工具列 hide() 掉，button 上的 click 事件
    // 根本沒機會觸發，這是 iPad 上工具列「點了沒反應」最主要的原因。標準解法是在
    // touchstart／mousedown 這一步就 preventDefault，讓瀏覽器不要清掉選取範圍，
    // click 事件不受影響、還是會照常在放開手指後觸發。這個 el 是跨頁共用的單例，
    // 監聽器只在第一次建立時掛一次，避免每次 attachSelectionToolbar() 都重複疊加。
    el.addEventListener('mousedown', (event) => event.preventDefault());
    el.addEventListener('touchstart', (event) => event.preventDefault(), { passive: false });
  }
  return el;
}

// iOS／iPadOS 選取文字時，系統原生會在選取範圍「正上方」蓋一層自己的
// 選單（複製／查詢／分享…），畫在瀏覽器 DOM 之上、任何 CSS z-index 都蓋不過去。
// 唯一有效的辦法是「不要疊在同一個位置」：優先畫在選取範圍下方，下方空間不夠
// （例如選在螢幕最下緣）才退回畫在上方。左右也夾在視窗範圍內，避免在窄螢幕上被裁掉。
function positionToolbar(el, rect) {
  const margin = 8;
  const spaceBelow = window.innerHeight - rect.bottom;
  const placeBelow = spaceBelow >= el.offsetHeight + margin * 2;
  const top = placeBelow
    ? window.scrollY + rect.bottom + margin
    : window.scrollY + rect.top - el.offsetHeight - margin;
  let left = window.scrollX + rect.left + rect.width / 2 - el.offsetWidth / 2;
  left = Math.max(margin, Math.min(left, window.scrollX + document.documentElement.clientWidth - el.offsetWidth - margin));
  el.style.top = `${Math.max(margin, top)}px`;
  el.style.left = `${left}px`;
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

    // iOS Safari 的限制：speechSynthesis.speak() 必須在使用者手勢的 handler 裡
    // 同步呼叫，中間不能經過任何 await／Promise 排隊，不然會被視為「不是使用者
    // 主動觸發」而靜音失敗。speak() 本身內部也是同步呼叫，這裡故意不包 async。
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

  // iPad／iPhone 用手指拖曳選取範圍兩端的「小圓點」把手來調整選取範圍時，
  // 那個把手是系統原生元件，拖曳過程中的觸控事件不一定會在 rootEl 上冒泡出
  // touchend（不像一般手指滑過文字選字），單靠上面的 touchend 監聽會抓不到——
  // 這裡另外用 selectionchange 當保底：拖曳把手的整個過程會一直觸發
  // selectionchange，用 debounce 等選取範圍「安定下來」（放開手指）那一刻才真正
  // 重新渲染工具列，避免拖曳中途畫面一直閃爍、重新定位。
  let selectionSettleTimer = null;
  const onSelectionChange = () => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      clearTimeout(selectionSettleTimer);
      hide();
      return;
    }
    clearTimeout(selectionSettleTimer);
    selectionSettleTimer = setTimeout(handleSelectionChange, 150);
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
      clearTimeout(selectionSettleTimer);
      rootEl.removeEventListener('mouseup', onMouseUp);
      rootEl.removeEventListener('touchend', onTouchEnd);
      document.removeEventListener('selectionchange', onSelectionChange);
      document.removeEventListener('mousedown', onDocMouseDown);
      hide();
    },
  };
}
