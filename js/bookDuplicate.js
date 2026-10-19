import { DB } from './db.js';
import { DEFAULT_RETENTION_STATUS } from './bookForm.js';

// 複製書籍：同作者的系列作品常常共用一批人物，複製一本書的人物關係圖譜
// （群組→人物→關係線）跟快速筆記過去，新書只帶author／書籍類型，其餘留白
// 給使用者自己填——書名／封面／出版社／出版日期是「這本新書」自己的事，
// 心得／佳句摘錄／閱讀紀錄是「讀這本原書」的個人經驗，都不該被複製過去。
//
// 建立順序 groups → nodes → edges 不能打亂：nodes.groupId／edges.fromNodeId
// ／toNodeId 都要用「新 id」，而新 id 只有在對應那一批 DB.add() 真正建立完成後
// 才知道（Supabase 用 identity column 自動配號，本機 IndexedDB 用
// autoIncrement，兩邊都一樣——呼叫端絕對不能自己塞 id 進去）。
export async function duplicateBook(bookId) {
  const original = await DB.getById('books', bookId);
  if (!original) throw new Error('找不到原書籍資料');

  const newBookId = await DB.add('books', {
    title: '',
    author: original.author || '',
    publisher: '',
    publishDate: '',
    format: '其他',
    retentionStatus: DEFAULT_RETENTION_STATUS,
    libraryBorrowType: '',
    libraryName: '',
    category: original.category || '',
    coverImage: '',
  });

  await DB.add('reading_records', {
    bookId: newBookId,
    status: '尚未閱讀',
    startDate: '',
    endDate: '',
    currentPage: null,
    readCount: 0,
    rating: 0,
  });

  const [groups, nodes, edges, notes] = await Promise.all([
    DB.getByIndex('groups', 'bookId', bookId),
    DB.getByIndex('nodes', 'bookId', bookId),
    DB.getByIndex('edges', 'bookId', bookId),
    DB.getByIndex('notes', 'bookId', bookId),
  ]);

  const newGroupIds = await Promise.all(groups.map((g) => DB.add('groups', {
    bookId: newBookId,
    name: g.name,
    subtitle: g.subtitle || '',
    color: g.color || '',
    x: g.x ?? null,
    y: g.y ?? null,
  })));
  const groupIdMap = new Map(groups.map((g, i) => [g.id, newGroupIds[i]]));

  const newNodeIds = await Promise.all(nodes.map((n) => DB.add('nodes', {
    bookId: newBookId,
    groupId: n.groupId != null ? (groupIdMap.get(n.groupId) ?? null) : null,
    label: n.label,
    title: n.title || '',
    status: n.status || '',
    description: n.description || '',
    order: n.order ?? 0,
    isProtagonist: !!n.isProtagonist,
    color: n.color || '',
  })));
  const nodeIdMap = new Map(nodes.map((n, i) => [n.id, newNodeIds[i]]));

  await Promise.all(edges.map((e) => {
    const newFrom = nodeIdMap.get(e.fromNodeId);
    const newTo = nodeIdMap.get(e.toNodeId);
    if (newFrom == null || newTo == null) return null;
    return DB.add('edges', {
      bookId: newBookId,
      fromNodeId: newFrom,
      toNodeId: newTo,
      label: e.label || '',
      direction: e.direction || 'forward',
      color: e.color || '',
      lineStyle: e.lineStyle || 'solid',
    });
  }));

  await Promise.all(notes.map((note) => DB.add('notes', {
    bookId: newBookId,
    text: note.text,
  })));

  return newBookId;
}
