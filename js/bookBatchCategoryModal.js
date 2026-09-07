// 批量操作列的「批次變更類別」彈窗，是從 bookList.js 拆出來降低單一檔案
// 行數的一部分（見 js/bookListPagination.js 開頭的說明）——這個彈窗本身是
// 完全自包含的一次性 Modal（開啟、等使用者選擇、關閉），跟 bookList.js
// 主體的列表狀態沒有互相依賴。
import { categoryOptionsHtml, wireCategorySelect } from './categories.js';

// 跟 utils.js 的 confirmModal() 同一套 .modal-backdrop／.modal-card／Esc／
// 點外面關閉的寫法，差別只是內容換成一顆分類下拉選單。
// 選單本身直接借用 categoryOptionsHtml()／wireCategorySelect()——書籍表單怎麼
// 選分類、怎麼跳「＋自訂分類」彈窗，這裡就跟著一樣，不用另外重寫一份分類邏輯。
// resolve(null) 代表取消（不異動任何書籍），resolve('') 是「先不分類」的合法選擇，
// 跟 resolve(null) 要分清楚，呼叫端用 `=== null` 判斷取消，不是用「假值」判斷。
export function openBatchCategoryModal() {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="batch-category-modal-title">
        <h3 id="batch-category-modal-title">批次變更類別</h3>
        <label for="batch-category-select">套用到選取的書籍
          <select id="batch-category-select">
            <option value="">（先不分類）</option>
            ${categoryOptionsHtml('')}
          </select>
        </label>
        <div class="modal-actions">
          <button type="button" class="btn" id="batch-category-cancel-btn">取消</button>
          <button type="button" class="btn btn-primary" id="batch-category-confirm-btn">套用</button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);
    const selectEl = backdrop.querySelector('#batch-category-select');
    wireCategorySelect(selectEl);

    function settle(result) {
      document.removeEventListener('keydown', onKeydown);
      backdrop.remove();
      resolve(result);
    }
    function onKeydown(event) {
      if (event.key === 'Escape') settle(null);
    }
    backdrop.addEventListener('mousedown', (event) => { if (event.target === backdrop) settle(null); });
    backdrop.querySelector('#batch-category-cancel-btn').addEventListener('click', () => settle(null));
    backdrop.querySelector('#batch-category-confirm-btn').addEventListener('click', () => settle(selectEl.value));
    document.addEventListener('keydown', onKeydown);
  });
}
