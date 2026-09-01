import { DB } from './db.js';
import { BORROWED_RETENTION_STATUS, LIBRARY_SOURCE_FORMAT } from './bookForm.js';

// 共用的「書籍 → 最新一筆閱讀紀錄」查表邏輯。原本 stats.js／authors.js／bookList.js
// 三個地方各自重複了一份幾乎一樣的 Map 建法，抽成這裡單一個來源。
// 每本書理論上只會有一筆 reading_records（更新既有那筆，不會新增第二筆），
// 這裡仍保留「取 createdAt 最新的一筆」的邏輯以防萬一。
// 拆成 pure 版（吃現成的 records 陣列，給已經自己 fetch 過 records 的呼叫端用，
// 不用多打一次 DB）跟 async 版（自己去 DB 撈，給只需要這張表的呼叫端用）兩種。
export function buildRecordByBookMap(records) {
  const byBook = new Map();
  for (const record of records) {
    const current = byBook.get(record.bookId);
    if (!current || (record.createdAt || '').localeCompare(current.createdAt || '') > 0) {
      byBook.set(record.bookId, record);
    }
  }
  return byBook;
}

export async function loadRecordByBookMap() {
  const records = await DB.getAll('reading_records');
  return buildRecordByBookMap(records);
}

// 「這本書的閱讀紀錄，是否算是在某個年份已讀完」的單一判斷來源。
// 之前這行判斷式在 stats.js（分類統計）、authors.js（喜愛作者統計）、bookList.js
// （右側列表篩選）各自重複了一份，年份篩選的定義要是以後想調整（例如把「重讀」也算進去），
// 只要改這裡一個地方就好，不用擔心三個地方改到不一致。
export function isCompletedInYear(record, year) {
  return Boolean(record && record.status === '已讀完' && record.endDate && record.endDate.startsWith(year));
}

// year 為 null／空字串代表不篩選，直接回傳原始清單。
export function filterBooksCompletedInYear(books, recordByBook, year) {
  if (!year) return books;
  return books.filter((book) => isCompletedInYear(recordByBook.get(book.id), year));
}

// 左側「閱讀中／尚未閱讀／已讀完」統計方塊的篩選邏輯：沒有紀錄的書籍一律視為「尚未閱讀」，
// 跟 stats.js 算 wantToRead 數字時用的判斷一致，不會出現方塊上的數字跟篩選結果對不上的情況。
export function matchesStatusFilter(record, status) {
  if (!status) return true;
  const actual = (record && record.status) || '尚未閱讀';
  return actual === status;
}

export function filterBooksByStatus(books, recordByBook, status) {
  if (!status) return books;
  return books.filter((book) => matchesStatusFilter(recordByBook.get(book.id), status));
}

// 「各類型書籍數量」點擊篩選：沒分類的書籍歸在「未分類」，跟分類清單本身算數量的邏輯一致。
export function filterBooksByCategory(books, category) {
  if (!category) return books;
  return books.filter((book) => (book.category || '未分類') === category);
}

// 「借出中／借入未還」快捷篩選：直接看書籍本身的存留狀態欄位，不用查閱讀紀錄。
// 「借入未還」比較特殊，要同時符合「來源是圖書館借閱」且「存留狀態是借入未還」
// 兩個條件，跟左側邊欄「借入未還」按鈕的計數口徑一致——避免使用者手動把某本
// 非圖書館來源的書標成「借入未還」時，被誤算進這個專屬圖書館書籍的統計／篩選結果。
export function filterBooksByRetentionStatus(books, retentionStatus) {
  if (!retentionStatus) return books;
  if (retentionStatus === BORROWED_RETENTION_STATUS) {
    return books.filter((book) => book.format === LIBRARY_SOURCE_FORMAT && book.retentionStatus === BORROWED_RETENTION_STATUS);
  }
  return books.filter((book) => book.retentionStatus === retentionStatus);
}

// 點擊作者名稱篩選：認完全相同（trim 過）的作者名稱字串，跟喜愛作者、
// 側邊欄作者統計用的比對邏輯（authors.js）一致，不做子字串模糊比對。
export function filterBooksByAuthor(books, author) {
  if (!author) return books;
  return books.filter((book) => (book.author || '').trim() === author);
}
