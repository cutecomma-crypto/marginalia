// 「所有書籍」搜尋索引建構——跟畫面渲染完全無關的純資料處理，是從
// bookList.js 拆出來降低單一檔案行數的一部分（見 js/bookListPagination.js
// 開頭的說明）。
import { DB } from './db.js';

function groupTextByBookId(items, field) {
  const map = {};
  for (const item of items) {
    if (!map[item.bookId]) map[item.bookId] = [];
    map[item.bookId].push(item[field]);
  }
  return map;
}

// 跨書名／作者／筆記／佳句／閱讀後輸出內容搜尋（含 #hashtag，因為標籤本來就是內文的一部分，
// 子字串比對天生就會吃到）：把每本書的可搜尋文字先組好，輸入時直接子字串比對。
export async function buildSearchIndex(books) {
  const [allNotes, allQuotes, allOutputs] = await Promise.all([
    DB.getAll('notes'),
    DB.getAll('quotes'),
    DB.getAll('outputs'),
  ]);
  const notesByBook = groupTextByBookId(allNotes, 'text');
  const quotesByBook = groupTextByBookId(allQuotes, 'content');
  const reflectionsByBook = groupTextByBookId(allOutputs.filter((o) => o.kind === 'reflection'), 'text');

  return books.map((book) => ({
    book,
    searchText: [
      book.title, book.author, ...(book.tags || []),
      ...(notesByBook[book.id] || []), ...(quotesByBook[book.id] || []), ...(reflectionsByBook[book.id] || []),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase(),
  }));
}
