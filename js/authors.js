import { DB } from './db.js';

// 喜愛作者用「名字」比對，不是綁定某一本書，所以同一位作者的所有書都會一起標記。
// 這裡同時做「動態聚合」＋「自動垃圾回收」：favorite_authors 這張表只負責記錄
// 「哪些名字被標記過喜愛」，實際「這個名字底下還有沒有書」永遠是即時對照 books 表算出來的，
// 不是另外存一份數字快取——書籍作者改名、書被刪掉之後，這裡下一次讀取就會反映最新狀態，
// 不會出現「作者(0本)」這種殘留在畫面上的死資料。
// 名下已經沒有任何書的收藏紀錄，順手直接從資料庫刪掉（垃圾回收），不是只在畫面上濾掉——
// 呼叫時機不用刻意綁在「刪除書籍」「編輯書籍」等特定操作上：只要書籍列表、書籍詳情
// 任何一個地方重新渲染時會呼叫到這裡，就會順便清乾淨，涵蓋所有可能讓作者變孤兒的
// 來源（手動編輯、刪除、Notion 匯入後的清理、未來新增的批次操作……）。
// 注意：「喜愛的作者」側邊欄卡片本身（renderFavoriteAuthorsPanel）已隨「功能簡化」
// 拿掉，這裡保留的兩個函式是書籍表單／列表「♥ 星號」互動仍在使用的部分。
export async function getFavoriteAuthorMap() {
  const [list, books] = await Promise.all([DB.getAll('favorite_authors'), DB.getAll('books')]);
  const usedAuthors = new Set(books.map((b) => (b.author || '').trim()).filter(Boolean));
  const orphaned = list.filter((f) => !usedAuthors.has(f.name));
  if (orphaned.length > 0) {
    await Promise.all(orphaned.map((f) => DB.remove('favorite_authors', f.id)));
  }
  const survivors = list.filter((f) => usedAuthors.has(f.name));
  return new Map(survivors.map((f) => [f.name, f.id]));
}

export async function toggleFavoriteAuthor(name, favoriteMap) {
  const trimmed = (name || '').trim();
  if (!trimmed) return favoriteMap;
  if (favoriteMap.has(trimmed)) {
    await DB.remove('favorite_authors', favoriteMap.get(trimmed));
    favoriteMap.delete(trimmed);
  } else {
    const id = await DB.add('favorite_authors', { name: trimmed });
    favoriteMap.set(trimmed, id);
  }
  return favoriteMap;
}
