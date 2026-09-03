// 首次登入的「把本機藏書搬到雲端帳號」提示與遷移邏輯。
//
// 觸發時機：每次登入成功後（見 authUI.js 的 onAuthStateChange），只要「本機有
// 雲端還沒有的書」就會顯示提示條——這個判斷是即時比對本機／雲端書籍算出來的，
// 不是靠一個「migrated: true」的一次性旗標。原本用旗標的版本有個真實發生過的
// 問題：搬移途中部分失敗（例如某幾本書的欄位格式導致寫入失敗），旗標還是被設成
// true，之後不管重新整理幾次都不會再提示，使用者也沒有簡單的入口把漏掉的書
// 補齊。改成即時比對之後，只要本機、雲端book 數量或內容對不起來，登入時就會
// 一直提示，直到真的補齊為止；「暫不同步」只是把這次的提示條關掉，不是永久壓下去。
//
// 比對方式：書籍沒有一個「本機 id 對應雲端 id」的紀錄可查（雲端 id 是 Postgres
// 重新指派的），所以用「書名＋作者＋建立時間」當指紋，本機每一本書算一個指紋，
// 雲端也算一次，指紋不在雲端裡的本機書就是「還沒搬過去的書」。這個比對法可以
// 放心重複執行——不管按幾次「立即同步」、重新整理幾次，已經搬過去的書永遠不會
// 被指紋比對出來、不會被重複插入第二次。
//
// migrateLocalToCloud() 特意 export 出來，除了給下面的提示條按鈕呼叫，也是設計
// 成可以直接在瀏覽器主控台手動呼叫的「補齊」工具：
//   const { migrateLocalToCloud } = await import('/js/cloudMigration.js');
//   await migrateLocalToCloud();
// 不用等提示條出現、也不用重新整理頁面，執行完主控台會印出完整的成功/略過/
// 失敗明細（失敗的話用 console.table 列出每一筆的表格、書名、Postgres 錯誤訊息）。
//
// 遷移完成後不刪除本機資料（留著當備份，使用者可以之後自己用「資料管理」頁清除），
// 只跳 Toast 告知完成，DB 路由器接下來自然全部改讀寫雲端。
import { LocalDB } from './localDb.js';
import { CloudDB } from './cloudDb.js';
import { getCurrentUser } from './services/authService.js';
import { showToast, escapeHtml } from './utils.js';

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

// 同步失敗的明細直接畫在頁面上的 Modal，不是只印到瀏覽器主控台——Console 對
// 一般使用者來說門檻太高（連貼上指令都可能被 Chrome 的防貼上機制擋下來），
// 失敗清單就應該跟成功/失敗的 Toast 一樣，是「看得到、點得到」的頁面內容。
// 沿用跟登入 Modal、自訂分類管理 Modal 同一套 .modal-backdrop/.modal-card 樣式。
function openMigrationFailuresModal(failures) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal-card migration-failures-card" role="dialog" aria-modal="true" aria-labelledby="migration-failures-title">
      <h3 id="migration-failures-title">⚠️ ${failures.length} 本書同步失敗</h3>
      <p class="migration-failures-hint">本機資料完全沒有受影響，以下是搬移到雲端時發生錯誤的項目，可以之後再重試「立即同步」補齊。</p>
      <ul class="migration-failures-list">
        ${failures.map((f) => `
          <li>
            <div class="migration-failure-head">
              <span class="migration-failure-title">${escapeHtml(f.title)}</span>
              <span class="migration-failure-store">${escapeHtml(f.store)}</span>
            </div>
            <p class="migration-failure-message">${escapeHtml(f.error?.message || String(f.error))}</p>
          </li>
        `).join('')}
      </ul>
      <div class="modal-actions">
        <button type="button" class="btn btn-primary" id="migration-failures-close">關閉</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);

  function close() {
    document.removeEventListener('keydown', onKeydown);
    backdrop.remove();
  }
  function onKeydown(event) {
    if (event.key === 'Escape') close();
  }
  backdrop.addEventListener('mousedown', (event) => { if (event.target === backdrop) close(); });
  backdrop.querySelector('#migration-failures-close').addEventListener('click', close);
  document.addEventListener('keydown', onKeydown);
}

// createdAt 在本機（IndexedDB）存的是 new Date().toISOString() 那種 Z 結尾格式，
// 但同一個時間點搬到 Postgres 的 timestamptz 欄位、再讀回來，Supabase 會用
// 「+00:00」結尾格式回傳（例如本機是 "...321Z"、雲端讀回來變成 "...321+00:00"）——
// 兩個字串代表的其實是同一個時間瞬間，但字串本身不相等，直接比對字串會誤判成
// 「雲端還沒有這本書」，讓已經搬過去的書每次都被重新判定成缺漏（這是實測抓到的
// 真實 bug，不是預防性猜測）。統一都用 Date 物件轉一次 toISOString()，不管輸入是
// 哪種結尾格式，輸出永遠是同一種標準格式，比對才會準。
function normalizeTimestamp(value) {
  if (!value) return '';
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : String(value);
}

// 書名＋作者＋建立時間三個欄位本機本來就有、不用額外存任何對照表。createdAt
// 精確到毫秒，同一本書不可能重複建立兩次剛好撞到同一個毫秒，足夠當指紋用。
function bookFingerprint(book) {
  return `${(book.title || '').trim()} ${(book.author || '').trim()} ${normalizeTimestamp(book.createdAt)}`;
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

// 這次實測抓到的真正根本原因：有些書是很早期版本建立的，本機記錄裡還帶著
// 「contentType」「owned」這類更早期資料結構用過、現在 Supabase 資料表根本
// 沒有對應欄位的舊屬性。原本用 {...book} 整包複製，這些歷史包袱也會一起被
// 塞進送給 Postgres 的 payload，PostgREST 收到一個схema 完全不認識的欄位名稱
// 就直接拒絕整筆寫入（「Could not find the 'x' column of 'books' in the
// schema cache」）——不是資料型別錯，是欄位本身在雲端資料表裡根本不存在。
//
// 修法是每張表都明確列出「資料庫實際擁有的欄位」，只挑這些欄位出來組 payload，
// 不管本機這筆記錄身上還背著多少歷史上用過又被淘汰的舊屬性，通通不會被夾帶
// 過去——比 {...spread} 整包複製安全得多，之後不管本機資料多久以前建立的、
// 中間經過幾次改版，都不會再因為欄位對不上而整筆搬移失敗。
function sanitizeBookPayload(book) {
  return {
    title: book.title,
    author: book.author,
    publisher: book.publisher,
    category: book.category,
    format: book.format,
    retentionStatus: book.retentionStatus,
    libraryBorrowType: book.libraryBorrowType,
    libraryName: book.libraryName,
    lentTo: book.lentTo,
    publishDate: book.publishDate,
    purchaseDate: book.purchaseDate,
    purchasePrice: toNullableNumber(book.purchasePrice),
    coverImage: book.coverImage,
    tags: Array.isArray(book.tags) ? book.tags : [],
    createdAt: book.createdAt,
  };
}

function sanitizeGroupPayload(group) {
  return {
    name: group.name,
    subtitle: group.subtitle,
    color: group.color,
    x: toNullableNumber(group.x),
    y: toNullableNumber(group.y),
    bookId: group.bookId,
    createdAt: group.createdAt,
  };
}

function sanitizeNodePayload(node) {
  return {
    label: node.label,
    title: node.title,
    status: node.status,
    description: node.description,
    order: toNullableNumber(node.order),
    bookId: node.bookId,
    groupId: node.groupId,
    createdAt: node.createdAt,
  };
}

function sanitizeEdgePayload(edge) {
  return {
    label: edge.label,
    direction: edge.direction,
    color: edge.color,
    lineStyle: edge.lineStyle,
    bookId: edge.bookId,
    fromNodeId: edge.fromNodeId,
    toNodeId: edge.toNodeId,
    createdAt: edge.createdAt,
  };
}

function sanitizeReadingRecordPayload(record) {
  return {
    status: record.status,
    startDate: record.startDate,
    endDate: record.endDate,
    currentPage: toNullableNumber(record.currentPage),
    readCount: toNullableNumber(record.readCount) ?? 0,
    rating: toNullableNumber(record.rating) ?? 0,
    updatedAt: record.updatedAt,
    bookId: record.bookId,
    createdAt: record.createdAt,
  };
}

// outputs 的 tags 跟 books 一樣是 jsonb 欄位，同樣可能因為舊資料格式漂移
// 存到非陣列的值，一起清過一次。
function sanitizeOutputPayload(output) {
  return {
    kind: output.kind,
    tags: Array.isArray(output.tags) ? output.tags : [],
    text: output.text,
    format: output.format,
    date: output.date,
    bookId: output.bookId,
    createdAt: output.createdAt,
  };
}

function sanitizeNotePayload(note) {
  return { text: note.text, bookId: note.bookId, createdAt: note.createdAt };
}

function sanitizeQuotePayload(quote) {
  return { content: quote.content, page: quote.page, bookId: quote.bookId, createdAt: quote.createdAt };
}

function sanitizeFavoriteAuthorPayload(favorite) {
  return { name: favorite.name, createdAt: favorite.createdAt };
}

function sanitizeWishlistPayload(item) {
  return { title: item.title, author: item.author, note: item.note, createdAt: item.createdAt };
}

// wishlist 沒有外鍵、也不屬於任何一本書，指紋邏輯跟 bookFingerprint 同一套精神
// （書名＋作者＋備註＋建立時間），可以放心重複執行 migrateLocalToCloud() 而不會重複插入。
function wishlistFingerprint(item) {
  return `${(item.title || '').trim()} ${(item.author || '').trim()} ${(item.note || '').trim()} ${normalizeTimestamp(item.createdAt)}`;
}

// 把這次執行的結果完整印到主控台：先印一行總覽（略過幾本／嘗試幾本／成功幾本／
// 失敗幾本），有失敗的話再用 console.table 把「哪張表、哪本書、Postgres 實際
// 錯誤訊息」攤開來，不用使用者自己一筆一筆去猜壞在哪裡、也不用重新執行一次
// 才看得到明細——這個函式在成功與失敗時都會被呼叫，永遠看得到完整結果。
function logMigrationResult(result) {
  console.log(
    `[Marginalia 雲端同步] 本機共 ${result.totalLocalBooks} 本書，`
    + `${result.alreadyInCloudCount} 本雲端已有（略過），`
    + `${result.attemptedCount} 本嘗試搬移，`
    + `${result.migratedBookCount} 本成功；`
    + `願望清單本機共 ${result.totalLocalWishlist} 筆，${result.migratedWishlistCount} 筆成功搬移；`
    + `${result.failures.length} 筆失敗。`,
  );
  if (result.failures.length > 0) {
    console.error(`[Marginalia 雲端同步] 失敗明細（共 ${result.failures.length} 筆）：`);
    console.table(result.failures.map((f) => ({
      表格: f.store,
      標題: f.title,
      錯誤訊息: f.error?.message || String(f.error),
    })));
    // console.table 只能顯示字串摘要，完整的錯誤物件（含 details／hint／code）
    // 再逐筆展開印一次，需要深入除錯時可以直接展開看。
    result.failures.forEach((f) => console.error(`[${f.store}] ${f.title}`, f.error));
  }
}

// 逐本書搬，不是逐張表搬：這樣「某一本書的資料本身有問題」只會讓那一本書
// （以及掛在它名下的閱讀紀錄、心得、筆記、佳句、關係圖譜）被跳過，不會讓
// 後面還沒搬到的書全部卡住、整個遷移一次全部失敗。
export async function migrateLocalToCloud() {
  const [books, cloudBooks, allGroups, allNodes, allEdges, allReadingRecords, allOutputs, allNotes, allQuotes, wishlistItems, cloudWishlistItems] = await Promise.all([
    LocalDB.getAll('books'),
    CloudDB.getAll('books'),
    LocalDB.getAll('groups'),
    LocalDB.getAll('nodes'),
    LocalDB.getAll('edges'),
    LocalDB.getAll('reading_records'),
    LocalDB.getAll('outputs'),
    LocalDB.getAll('notes'),
    LocalDB.getAll('quotes'),
    LocalDB.getAll('wishlist'),
    CloudDB.getAll('wishlist'),
  ]);

  const existingFingerprints = new Set(cloudBooks.map(bookFingerprint));
  const booksToMigrate = books.filter((b) => !existingFingerprints.has(bookFingerprint(b)));

  const failures = [];
  let migratedBookCount = 0;

  for (const book of booksToMigrate) {
    const oldBookId = book.id;
    let newBookId;
    try {
      newBookId = await CloudDB.add('books', sanitizeBookPayload(book));
      migratedBookCount++;
    } catch (error) {
      failures.push({ store: 'books', title: book.title || '（未命名）', error });
      continue; // 書本身搬失敗，掛在它名下的其他資料搬過去也沒有意義，整批跳過
    }

    const groupIdMap = new Map();
    for (const group of allGroups.filter((g) => g.bookId === oldBookId)) {
      try {
        const newGroupId = await CloudDB.add('groups', sanitizeGroupPayload({ ...group, bookId: newBookId }));
        groupIdMap.set(group.id, newGroupId);
      } catch (error) {
        failures.push({ store: 'groups', title: `${book.title}／${group.name || '未命名群組'}`, error });
      }
    }

    const nodeIdMap = new Map();
    for (const node of allNodes.filter((n) => n.bookId === oldBookId)) {
      try {
        const newNodeId = await CloudDB.add('nodes', sanitizeNodePayload({
          ...node,
          bookId: newBookId,
          groupId: node.groupId ? (groupIdMap.get(node.groupId) ?? null) : null,
        }));
        nodeIdMap.set(node.id, newNodeId);
      } catch (error) {
        failures.push({ store: 'nodes', title: `${book.title}／${node.label || '未命名人物'}`, error });
      }
    }

    for (const edge of allEdges.filter((e) => e.bookId === oldBookId)) {
      const newFromNodeId = nodeIdMap.get(edge.fromNodeId);
      const newToNodeId = nodeIdMap.get(edge.toNodeId);
      if (!newFromNodeId || !newToNodeId) continue; // 這條線兩端有人物卡片搬失敗，連帶跳過，不留斷頭的關係線
      try {
        await CloudDB.add('edges', sanitizeEdgePayload({ ...edge, bookId: newBookId, fromNodeId: newFromNodeId, toNodeId: newToNodeId }));
      } catch (error) {
        failures.push({ store: 'edges', title: `${book.title}／${edge.label || '關係線'}`, error });
      }
    }

    const bookIdKeyedStores = [
      ['reading_records', allReadingRecords, sanitizeReadingRecordPayload],
      ['outputs', allOutputs, sanitizeOutputPayload],
      ['notes', allNotes, sanitizeNotePayload],
      ['quotes', allQuotes, sanitizeQuotePayload],
    ];
    for (const [storeName, records, sanitize] of bookIdKeyedStores) {
      for (const record of records.filter((r) => r.bookId === oldBookId)) {
        try {
          await CloudDB.add(storeName, sanitize({ ...record, bookId: newBookId }));
        } catch (error) {
          failures.push({ store: storeName, title: book.title || '（未命名）', error });
        }
      }
    }
  }

  // 喜愛作者沒有外鍵、也沒有天然的指紋欄位可以拿來判斷「雲端是不是已經有了」，
  // 只在本機書籍一本都還沒搬過（首次搬移）時才一起搬，避免每次補齊漏掉的書時
  // 都把喜愛作者清單重複插入。
  if (cloudBooks.length === 0) {
    for (const favorite of await LocalDB.getAll('favorite_authors')) {
      try {
        await CloudDB.add('favorite_authors', sanitizeFavoriteAuthorPayload(favorite));
      } catch (error) {
        failures.push({ store: 'favorite_authors', title: favorite.name || '（未命名）', error });
      }
    }
  }

  // 願望清單跟書籍是各自獨立的指紋比對、各自的成功/失敗計數，不會因為某一本書
  // 搬移失敗就連帶跳過願望清單，兩者互不影響。
  const existingWishlistFingerprints = new Set(cloudWishlistItems.map(wishlistFingerprint));
  const wishlistToMigrate = wishlistItems.filter((w) => !existingWishlistFingerprints.has(wishlistFingerprint(w)));
  let migratedWishlistCount = 0;
  for (const item of wishlistToMigrate) {
    try {
      await CloudDB.add('wishlist', sanitizeWishlistPayload(item));
      migratedWishlistCount++;
    } catch (error) {
      failures.push({ store: 'wishlist', title: item.title || '（未命名）', error });
    }
  }

  const result = {
    totalLocalBooks: books.length,
    alreadyInCloudCount: books.length - booksToMigrate.length,
    attemptedCount: booksToMigrate.length,
    migratedBookCount,
    totalLocalWishlist: wishlistItems.length,
    migratedWishlistCount,
    failures,
  };
  logMigrationResult(result);
  return result;
}

export async function maybeOfferCloudMigration() {
  const user = getCurrentUser();
  if (!user) return;

  const [localBooks, cloudBooks, localWishlist, cloudWishlist] = await Promise.all([
    LocalDB.getAll('books'),
    CloudDB.getAll('books'),
    LocalDB.getAll('wishlist'),
    CloudDB.getAll('wishlist'),
  ]);
  const existingFingerprints = new Set(cloudBooks.map(bookFingerprint));
  const missingBookCount = localBooks.filter((b) => !existingFingerprints.has(bookFingerprint(b))).length;
  const existingWishlistFingerprints = new Set(cloudWishlist.map(wishlistFingerprint));
  const missingWishlistCount = localWishlist.filter((w) => !existingWishlistFingerprints.has(wishlistFingerprint(w))).length;
  if (missingBookCount === 0 && missingWishlistCount === 0) return; // 本機資料雲端都已經有了，不用提示

  // 兩種資料至少有一種缺漏就會提示，文案照實際缺漏的種類組（可能只缺書、只缺
  // 願望清單，或兩者都缺），不會講出「0 筆」這種沒意義的數字。
  const parts = [];
  if (missingBookCount > 0) parts.push(`${missingBookCount} 本書`);
  if (missingWishlistCount > 0) parts.push(`${missingWishlistCount} 筆願望清單`);

  const el = bannerEl();
  el.innerHTML = `
    <span>偵測到本機有${parts.join('、')}尚未同步到雲端帳號，要同步嗎？</span>
    <button type="button" class="btn btn-primary btn-sm" id="cloud-migration-confirm">強制補同步</button>
    <button type="button" class="btn btn-sm" id="cloud-migration-dismiss">暫不同步</button>
  `;
  el.querySelector('#cloud-migration-dismiss').addEventListener('click', removeBanner);
  el.querySelector('#cloud-migration-confirm').addEventListener('click', async (event) => {
    const btn = event.currentTarget;
    btn.disabled = true;
    btn.textContent = '同步中…';
    try {
      const result = await migrateLocalToCloud();
      removeBanner();

      // 失敗明細（如果有）特意排在觸發 hashchange 重新整理頁面「之前」處理，
      // 不要讓兩件事搶著跑：就算 hashchange 觸發的重繪過程中出了什麼意外，
      // Modal 也已經確實掛上 document.body 了。openMigrationFailuresModal 本身
      // 又包一層 try/catch、萬一還是失敗就退而求其次跳原生 alert()——這樣不管
      // Modal 的 DOM/CSS 有沒有意外出狀況，錯誤明細都保證會有某種形式顯示在
      // 畫面上，不會整個安靜失敗、只留主控台看得到。
      // 書籍／願望清單各自的成功筆數只在「這次真的有嘗試搬移」時才拼進 Toast 文字，
      // 避免兩種資料只有一種缺漏時，訊息裡出現一句沒意義的「0 筆願望清單」。
      const syncedParts = [];
      if (result.attemptedCount > 0) syncedParts.push(`${result.migratedBookCount}/${result.attemptedCount} 本書`);
      if (result.totalLocalWishlist > 0 && result.migratedWishlistCount > 0) syncedParts.push(`${result.migratedWishlistCount} 筆願望清單`);

      if (result.failures.length > 0) {
        showToast(`已同步${syncedParts.length > 0 ? syncedParts.join('、') : '部分資料'}，${result.failures.length} 筆失敗`);
        console.log(`[Marginalia 雲端同步] 準備開啟失敗明細視窗（共 ${result.failures.length} 筆）…`);
        try {
          openMigrationFailuresModal(result.failures);
          console.log('[Marginalia 雲端同步] 失敗明細視窗已開啟。');
        } catch (modalErr) {
          console.error('[Marginalia 雲端同步] 開啟失敗明細視窗時發生例外，改用 alert() 顯示：', modalErr);
          window.alert(
            `${result.failures.length} 筆同步失敗：\n\n`
            + result.failures.map((f) => `《${f.title}》（${f.store}）\n${f.error?.message || String(f.error)}`).join('\n\n'),
          );
        }
      } else if (syncedParts.length === 0) {
        showToast('本機資料已經全部在雲端帳號裡了');
      } else {
        showToast(`已補齊${syncedParts.join('、')}到雲端帳號`);
      }

      // hash 沒變，瀏覽器不會自己觸發 hashchange（跟 app.js 裡 Logo 點擊重置用的
      // 同一個處理方式），手動補發一次讓目前頁面重新抓一次資料，畫出剛同步好的雲端內容。
      window.dispatchEvent(new Event('hashchange'));
    } catch (err) {
      showToast('同步失敗，請稍後再試一次');
      console.error(err);
      btn.disabled = false;
      btn.textContent = '強制補同步';
    }
  });
}
