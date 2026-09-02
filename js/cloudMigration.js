// 首次登入的「把本機藏書搬到雲端帳號」提示與遷移邏輯。
//
// 觸發時機：每次登入成功後（見 authUI.js 的 onAuthStateChange），檢查「雲端帳號
// 目前是空的」且「本機 IndexedDB 有書」且「這個帳號沒被標記已經遷移過」——
// 三個條件同時成立才顯示提示條，避免同一個帳號每次登入都被問一次，也避免
// 已經有雲端資料的帳號（例如換一台裝置登入）被本機這台裝置的舊資料嚇到。
//
// 遷移完成後不刪除本機資料（留著當備份，使用者可以之後自己用「資料管理」頁清除），
// 只跳 Toast 告知完成，DB 路由器接下來自然全部改讀寫雲端。
import { LocalDB } from './localDb.js';
import { CloudDB } from './cloudDb.js';
import { getCurrentUser } from './services/authService.js';
import { showToast } from './utils.js';

function migratedFlagKey(userId) {
  return `marginalia_cloud_migrated_${userId}`;
}

function bannerEl() {
  let el = document.getElementById('cloud-migration-banner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'cloud-migration-banner';
    el.className = 'cloud-migration-banner';
    document.body.appendChild(el);
  }
  return el;
}

function removeBanner() {
  document.getElementById('cloud-migration-banner')?.remove();
}

// 累積好幾年的本機資料，欄位型別很容易「歷史悠久」——例如某個版本的表單曾經把
// 空白數字欄位存成空字串 ''，而不是 null。Postgres 的 numeric／integer 欄位
// 收到 '' 會直接丟出「invalid input syntax」，這正是 HTTP 400 最常見的成因之一。
// 搬移到雲端前統一用這個函式清過一次：''、undefined、NaN 一律變成 null，
// 其餘保留原本的數字，比事後一本一本猜哪個欄位壞掉快得多、也更保險。
function toNullableNumber(value) {
  if (value === '' || value === undefined || value === null) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function sanitizeBookPayload(book) {
  return {
    ...book,
    purchasePrice: toNullableNumber(book.purchasePrice),
    tags: Array.isArray(book.tags) ? book.tags : [],
  };
}

function sanitizeGroupPayload(group) {
  return { ...group, x: toNullableNumber(group.x), y: toNullableNumber(group.y) };
}

function sanitizeNodePayload(node) {
  return { ...node, order: toNullableNumber(node.order) };
}

function sanitizeReadingRecordPayload(record) {
  return {
    ...record,
    currentPage: toNullableNumber(record.currentPage),
    readCount: toNullableNumber(record.readCount) ?? 0,
    rating: toNullableNumber(record.rating) ?? 0,
  };
}

// outputs 的 tags 跟 books 一樣是 jsonb 欄位，同樣可能因為舊資料格式漂移
// 存到非陣列的值，一起清過一次。
function sanitizeOutputPayload(output) {
  return { ...output, tags: Array.isArray(output.tags) ? output.tags : [] };
}

// 逐本書搬，不是逐張表搬：這樣「某一本書的資料本身有問題」只會讓那一本書
// （以及掛在它名下的閱讀紀錄、心得、筆記、佳句、關係圖譜）被跳過，不會讓
// 後面還沒搬到的兩三百本書全部卡住、整個遷移一次全部失敗。每個失敗都記下
// 「哪一本書、哪張表、Postgres 實際回傳什麼訊息」，遷移結束後一次印出來，
// 不用使用者自己一筆一筆去猜壞在哪裡。
async function migrateLocalToCloud() {
  const [books, allGroups, allNodes, allEdges, allReadingRecords, allOutputs, allNotes, allQuotes] = await Promise.all([
    LocalDB.getAll('books'),
    LocalDB.getAll('groups'),
    LocalDB.getAll('nodes'),
    LocalDB.getAll('edges'),
    LocalDB.getAll('reading_records'),
    LocalDB.getAll('outputs'),
    LocalDB.getAll('notes'),
    LocalDB.getAll('quotes'),
  ]);

  const failures = [];
  let migratedBookCount = 0;

  for (const book of books) {
    const { id: oldBookId, ...bookRest } = book;
    let newBookId;
    try {
      newBookId = await CloudDB.add('books', sanitizeBookPayload(bookRest));
      migratedBookCount++;
    } catch (error) {
      failures.push({ store: 'books', title: book.title || '（未命名）', error });
      continue; // 書本身搬失敗，掛在它名下的其他資料搬過去也沒有意義，整批跳過
    }

    const groupIdMap = new Map();
    for (const group of allGroups.filter((g) => g.bookId === oldBookId)) {
      const { id: oldGroupId, bookId, ...rest } = group;
      try {
        const newGroupId = await CloudDB.add('groups', sanitizeGroupPayload({ ...rest, bookId: newBookId }));
        groupIdMap.set(oldGroupId, newGroupId);
      } catch (error) {
        failures.push({ store: 'groups', title: `${book.title}／${group.name || '未命名群組'}`, error });
      }
    }

    const nodeIdMap = new Map();
    for (const node of allNodes.filter((n) => n.bookId === oldBookId)) {
      const { id: oldNodeId, bookId, groupId, ...rest } = node;
      try {
        const newNodeId = await CloudDB.add('nodes', sanitizeNodePayload({
          ...rest,
          bookId: newBookId,
          groupId: groupId ? (groupIdMap.get(groupId) ?? null) : null,
        }));
        nodeIdMap.set(oldNodeId, newNodeId);
      } catch (error) {
        failures.push({ store: 'nodes', title: `${book.title}／${node.label || '未命名人物'}`, error });
      }
    }

    for (const edge of allEdges.filter((e) => e.bookId === oldBookId)) {
      const { fromNodeId, toNodeId, ...rest } = edge;
      const newFromNodeId = nodeIdMap.get(fromNodeId);
      const newToNodeId = nodeIdMap.get(toNodeId);
      if (!newFromNodeId || !newToNodeId) continue; // 這條線兩端有人物卡片搬失敗，連帶跳過，不留斷頭的關係線
      try {
        await CloudDB.add('edges', { ...rest, bookId: newBookId, fromNodeId: newFromNodeId, toNodeId: newToNodeId });
      } catch (error) {
        failures.push({ store: 'edges', title: `${book.title}／${edge.label || '關係線'}`, error });
      }
    }

    const bookIdKeyedStores = [
      ['reading_records', allReadingRecords, sanitizeReadingRecordPayload],
      ['outputs', allOutputs, sanitizeOutputPayload],
      ['notes', allNotes, (r) => r],
      ['quotes', allQuotes, (r) => r],
    ];
    for (const [storeName, records, sanitize] of bookIdKeyedStores) {
      for (const record of records.filter((r) => r.bookId === oldBookId)) {
        const { id, bookId, ...rest } = record;
        try {
          await CloudDB.add(storeName, sanitize({ ...rest, bookId: newBookId }));
        } catch (error) {
          failures.push({ store: storeName, title: book.title || '（未命名）', error });
        }
      }
    }
  }

  for (const favorite of await LocalDB.getAll('favorite_authors')) {
    const { id, ...rest } = favorite; // 沒有外鍵（只認作者名字字串），直接搬
    try {
      await CloudDB.add('favorite_authors', rest);
    } catch (error) {
      failures.push({ store: 'favorite_authors', title: favorite.name || '（未命名）', error });
    }
  }

  if (failures.length > 0) {
    console.error(`雲端同步：${failures.length} 筆資料失敗，明細如下（表格 / 標題 / Postgres 錯誤訊息）：`);
    failures.forEach((f) => console.error(`[${f.store}] ${f.title} →`, f.error?.message || f.error, f.error));
  }

  return { migratedBookCount, totalBooks: books.length, failures };
}

export async function maybeOfferCloudMigration() {
  const user = getCurrentUser();
  if (!user) return;
  if (localStorage.getItem(migratedFlagKey(user.id))) return;

  const [localBooks, cloudBooks] = await Promise.all([LocalDB.getAll('books'), CloudDB.getAll('books')]);
  if (localBooks.length === 0 || cloudBooks.length > 0) return;

  const el = bannerEl();
  el.innerHTML = `
    <span>偵測到本機有 ${localBooks.length} 本書，要同步到雲端帳號嗎？</span>
    <button type="button" class="btn btn-primary btn-sm" id="cloud-migration-confirm">立即同步</button>
    <button type="button" class="btn btn-sm" id="cloud-migration-dismiss">暫不同步</button>
  `;
  el.querySelector('#cloud-migration-dismiss').addEventListener('click', removeBanner);
  el.querySelector('#cloud-migration-confirm').addEventListener('click', async (event) => {
    const btn = event.currentTarget;
    btn.disabled = true;
    btn.textContent = '同步中…';
    try {
      const result = await migrateLocalToCloud();
      // 就算有部分失敗也標記成「已遷移過」——不然下次登入會拿全部 303 本書重跑一次，
      // 已經成功搬過去的那些會在雲端重複一份。失敗的細節已經印在主控台，
      // 使用者可以照著明細手動把那幾筆漏掉的資料補上去。
      localStorage.setItem(migratedFlagKey(user.id), 'true');
      if (result.failures.length > 0) {
        showToast(`已同步 ${result.migratedBookCount}/${result.totalBooks} 本書，${result.failures.length} 筆資料失敗，詳情請看主控台`);
      } else {
        showToast(`本機 ${result.migratedBookCount} 本書已全部同步到雲端帳號`);
      }
      removeBanner();
      // hash 沒變，瀏覽器不會自己觸發 hashchange（跟 app.js 裡 Logo 點擊重置用的
      // 同一個處理方式），手動補發一次讓目前頁面重新抓一次資料，畫出剛同步好的雲端內容。
      window.dispatchEvent(new Event('hashchange'));
    } catch (err) {
      showToast('同步失敗，請稍後再試一次');
      console.error(err);
      btn.disabled = false;
      btn.textContent = '立即同步';
    }
  });
}
