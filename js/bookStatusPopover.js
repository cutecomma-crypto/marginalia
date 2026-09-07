// 列表頁快速更新閱讀狀態／完成日期（Inline Status Switcher）：點擊「完成日期」
// 欄位跳出一個小面板，只放「狀態」跟「完成日期」這兩個最常需要臨場調整的欄位
// （開始日期／頁數／閱讀次數／評分這些留在書籍詳情頁的「閱讀進度設定」，那裡才是
// 完整表單），選了就立刻存檔（跟 outputs.js 的 .output-date-input 同一套「change
// 就自動存、不用另外按儲存」的習慣），不用整個跳頁就能完成最常見的操作。
// 是從 bookList.js 拆出來降低單一檔案行數的一部分（見 js/bookListPagination.js
// 開頭的說明）——這個彈出面板本身是掛在 document.body 上的單例元素，跟
// bookList.js 主體的畫面狀態沒有互相依賴，適合獨立成一個模組。
import { DB } from './db.js';
import { escapeHtml, showToast } from './utils.js';
import { STATUS_OPTIONS } from './readingRecords.js';
import { ICON_X } from './icons.js';

// 單例面板（跟 selectionToolbarService.js 的 ensureToolbarEl() 同一種做法）：
// 掛在 document.body 上、每次開啟時重新填內容跟定位，不用每次 renderList() 都
// 重新建立/銷毀一次。
let statusPopoverEl = null;
function ensureStatusPopoverEl() {
  if (!statusPopoverEl) {
    statusPopoverEl = document.createElement('div');
    statusPopoverEl.className = 'inline-status-popover';
    statusPopoverEl.hidden = true;
    document.body.appendChild(statusPopoverEl);
  }
  return statusPopoverEl;
}

export function hideStatusPopover() {
  if (statusPopoverEl) statusPopoverEl.hidden = true;
}

function positionStatusPopover(el, anchorRect) {
  const margin = 6;
  const top = window.scrollY + anchorRect.bottom + margin;
  let left = window.scrollX + anchorRect.left;
  const maxLeft = window.scrollX + document.documentElement.clientWidth - el.offsetWidth - margin;
  left = Math.max(margin, Math.min(left, maxLeft));
  el.style.top = `${top}px`;
  el.style.left = `${left}px`;
}

// 點面板以外的地方、或按 Esc 都收起面板——跟 selectionToolbarService.js 的
// onDocMouseDown 同一種收尾方式。這兩個監聽器掛在模組最外層、只會執行一次
// （不會因為 renderBookList() 被重複呼叫而重複疊加監聽器）。
document.addEventListener('mousedown', (event) => {
  if (!statusPopoverEl || statusPopoverEl.hidden) return;
  if (statusPopoverEl.contains(event.target) || event.target.closest('.book-status-trigger')) return;
  hideStatusPopover();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') hideStatusPopover();
});
// 這是單例元素，掛在 document.body 上不會因為離開書籍列表頁就被清掉（hash
// 路由只是整個換掉 container 的內容，不是真的重新整理頁面）——沒有這一行，
// 面板開著的狀態下切去別的頁面（例如書籍詳情頁、資料管理頁），面板會維持
// 顯示、浮在完全不相干的畫面上面，這是實測抓到的真實問題，不是預防性猜測。
window.addEventListener('hashchange', hideStatusPopover);

// recordMap 是整頁共用的同一份 Map，存檔成功後直接原地更新這個 Map 裡對應的
// 那一筆（不用整批重新從資料庫撈一次 reading_records），onSaved() 呼叫端負責
// 決定要不要重繪列表（通常是 renderList()，讓這一列的完成日期文字立刻反映新值）。
export function openStatusPopover(anchorBtn, book, recordMap, onSaved) {
  const el = ensureStatusPopoverEl();
  const record = recordMap.get(book.id);
  el.innerHTML = `
    <button type="button" class="inline-status-popover-close" aria-label="關閉">${ICON_X}</button>
    <label>狀態
      <select name="status">
        ${STATUS_OPTIONS.map((s) => `<option value="${escapeHtml(s)}" ${record && record.status === s ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('')}
      </select>
    </label>
    <label>完成日期
      <input type="date" name="endDate" value="${escapeHtml((record && record.endDate) || '')}">
    </label>
  `;
  el.hidden = false;
  positionStatusPopover(el, anchorBtn.getBoundingClientRect());

  el.querySelector('.inline-status-popover-close').addEventListener('click', hideStatusPopover);

  const statusSelect = el.querySelector('select[name="status"]');
  const dateInput = el.querySelector('input[name="endDate"]');
  statusSelect.focus();

  // 跟書籍詳情頁「閱讀進度設定」表單（見 readingRecords.js 的 renderReadingSection）
  // 完全同一套存檔邏輯：沒有既有記錄就新增一筆，有就在原本那筆上面補新的欄位值——
  // 兩個入口（詳情頁完整表單／列表頁這個快速面板）改的是同一張 reading_records
  // 資料表，行為只能有一套，不能各寫一份、彼此邏輯兜不起來。
  async function persist(patch) {
    const current = recordMap.get(book.id);
    const payload = {
      bookId: book.id,
      status: current?.status || '尚未閱讀',
      startDate: current?.startDate || '',
      endDate: current?.endDate || '',
      currentPage: current?.currentPage ?? null,
      readCount: current?.readCount || 0,
      rating: current?.rating || 0,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    let saved;
    if (current) {
      saved = { ...current, ...payload, id: current.id };
      await DB.update('reading_records', saved);
    } else {
      const newId = await DB.add('reading_records', payload);
      saved = { ...payload, id: newId };
    }
    recordMap.set(book.id, saved);
    showToast('已更新閱讀狀態');
    hideStatusPopover();
    onSaved();
  }

  statusSelect.addEventListener('change', () => persist({ status: statusSelect.value }));
  dateInput.addEventListener('change', () => persist({ endDate: dateInput.value }));
}
