// 「所有書籍」列表的排序選單／分頁邏輯，跟畫面其餘部分（搜尋、篩選、
// 表格/網格切換……）沒有互相依賴，是從 bookList.js 拆出來降低單一檔案
// 行數的一部分——bookList.js 原本 933 行，是全站健檢中偏大的檔案之一。

// 排序選項只留「建立時間」「完成日期」兩組時間排序，使用者反映「書名」
// 「評分」用不到，要求砍掉——連同底下 sortBooks() 對應的兩個分支、
// 專門給書名排序用的 titleCollator 一起刪除，不留半套用不到的排序邏輯。
export const SORT_OPTIONS = [
  { value: 'created-desc', label: '建立時間：新到舊' },
  { value: 'created-asc', label: '建立時間：舊到新' },
  { value: 'completed-desc', label: '完成日期：新到舊' },
  { value: 'completed-asc', label: '完成日期：舊到新' },
];

// 「每頁顯示」下拉選單：使用者反映捲動到底自動載入更多不方便掌握「大數據量
// 時要怎麼跳著看」，要求換回明確的分頁——PAGE_SIZE_OPTIONS／buildPageList／
// paginationHtml 都是照原本（拿掉之前）的版本原樣復原（見 bookList.js 的
// renderList() 分頁切片邏輯），不是重新設計一套。option 文字不再重複「每頁顯示」
// 四個字——工具列攤平成單行之後，這個下拉選單前面已經有一顆同樣文字的
// 小標籤（每頁：），選單裡的文字只要留數字本身（12 本／24 本／50 本／全部），
// 兩者合起來讀「每頁： 12 本」，不會變成「每頁顯示 每頁顯示：12 本」
// 這種疊字重複。
export const PAGE_SIZE_OPTIONS = [
  { value: '12', label: '12 本' },
  { value: '24', label: '24 本' },
  { value: '50', label: '50 本' },
  { value: 'all', label: '全部' },
];

// 頁碼超過 7 頁時用「1 … 上一頁 目前頁 下一頁 … 末頁」的縮寫排法，
// 不然書籍一多頁碼列會長到跟搜尋列一樣寬，反而看不出目前在第幾頁。
export function buildPageList(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const keep = new Set([1, total, current - 1, current, current + 1]);
  const sortedKeep = [...keep].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const result = [];
  let prev = null;
  for (const p of sortedKeep) {
    if (prev !== null && p - prev > 1) result.push('…');
    result.push(p);
    prev = p;
  }
  return result;
}

export function paginationHtml(current, total) {
  if (total <= 1) return '';
  const pages = buildPageList(current, total);
  return `
    <nav class="pagination-bar" aria-label="分頁導覽">
      <button type="button" class="pagination-btn" data-page="${current - 1}" ${current === 1 ? 'disabled' : ''}>‹ 上一頁</button>
      <div class="pagination-pages">
        ${pages.map((p) => (p === '…'
    ? '<span class="pagination-ellipsis">…</span>'
    : `<button type="button" class="pagination-page${p === current ? ' is-active' : ''}" data-page="${p}" ${p === current ? 'aria-current="page"' : ''}>${p}</button>`
  )).join('')}
      </div>
      <button type="button" class="pagination-btn" data-page="${current + 1}" ${current === total ? 'disabled' : ''}>下一頁 ›</button>
    </nav>
  `;
}

export function sortBooks(books, recordMap, sortMode) {
  const list = [...books];
  if (sortMode === 'created-asc') {
    list.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  } else if (sortMode === 'completed-desc') {
    list.sort((a, b) => {
      const endA = recordMap.get(a.id)?.endDate || '';
      const endB = recordMap.get(b.id)?.endDate || '';
      if (endA && endB) return endB.localeCompare(endA);
      if (endA && !endB) return -1;
      if (!endA && endB) return 1;
      return (b.createdAt || '').localeCompare(a.createdAt || '');
    });
  } else if (sortMode === 'completed-asc') {
    list.sort((a, b) => {
      const endA = recordMap.get(a.id)?.endDate || '';
      const endB = recordMap.get(b.id)?.endDate || '';
      if (endA && endB) return endA.localeCompare(endB);
      if (endA && !endB) return -1;
      if (!endA && endB) return 1;
      return (a.createdAt || '').localeCompare(b.createdAt || '');
    });
  } else {
    list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')); // created-desc（預設）
  }
  return list;
}
