import { DB } from './db.js';
import { STATUS_OPTIONS } from './readingRecords.js';
import { MOTIVATION_TAGS } from './outputs.js';
import { getFavoriteAuthorMap, toggleFavoriteAuthor } from './authors.js';
import { escapeHtml, wireCoverImage, showToast } from './utils.js';
import { ICON_BOOK_OPEN, ICON_CART, ICON_BOOK, ICON_IMAGE, ICON_DELETE } from './icons.js';
import { categoryOptionsHtml, wireCategorySelect } from './categories.js';

// 「書籍形式／來源」跟「存留狀態」解耦：來源只回答「這本書從哪裡來」（買的、圖書館借的…），
// 跟這本書現在手上還在不在、還了沒，是兩件互不相干的事——舊版把「圖書館借閱」塞進存留狀態
// 的一個選項（「借閱」），導致書一旦讀完歸還，存留狀態卻永遠卡在「借閱」，沒有地方可以標記
// 「已經還了」。LIBRARY_SOURCE_FORMAT 是唯一需要在別的模組（stats.js／bookStats.js／
// readingRecords.js／bookDetail.js）拿來做條件判斷的來源值，其餘來源純粹顯示用，不用另外匯出常數。
// 「紙本購買」排第一個：新增書籍時沒特別選就是這個隱性預設值（<select> 沒有任何
// option 帶 selected 時瀏覽器會選第一個），大多數人的藏書還是買來的書居多，
// 「圖書館借閱」是使用者要主動選才會變成的狀態，不該是預設猜測。
const FORMAT_OPTIONS = ['紙本購買', '電子書', '有聲書', '圖書館借閱', '其他'];
export const LIBRARY_SOURCE_FORMAT = '圖書館借閱';

// 「架構安全性強化與功能簡化」精簡：存留狀態原本還有「借入未還／已歸還／
// 借出」三個描述「書現在流通在外」的狀態（連同對應的一鍵歸還／已收回快捷
// 操作、側邊欄借出借入統計、書籍表單的「借給誰」欄位），使用者反映這一整套
// 「借閱追蹤」不是核心需求，要求拿掉，回歸單純的藏書管理——現在存留狀態
// 只剩「保存中」（手上留著）跟「已售出/贈送」（不再是我的書了）兩種。
// 「書籍形式／來源」欄位的「圖書館借閱」選項（連同借閱管道／圖書館名稱
// 兩個欄位）維持不變：那是「這本書從哪裡來」的描述性資訊，跟「現在有沒有
// 流通在外」是兩件事（這個解耦本來就是更早一輪改版的既有設計，見下面
// migrateLegacyBookFields 的說明），不屬於這次要拿掉的「借閱狀態追蹤」。
const RETENTION_STATUS_OPTIONS = ['保存中', '已售出/贈送'];
export const DEFAULT_RETENTION_STATUS = '保存中';
export const SOLD_RETENTION_STATUS = '已售出/贈送';
const LIBRARY_BORROW_TYPE_OPTIONS = ['實體圖書館', '線上圖書館 / 電子書'];

// 存留狀態的選項字串改名／合併後，既有書籍資料庫裡存的還是舊字串，不會自動跟著變。
// 「借閱」比較特殊：解耦之前它同時代表「這本書是圖書館借的」跟「現在還沒還」兩件事，
// 拆開後「這本書是圖書館借的」這個來源資訊要搬到「書籍形式／來源」欄位，不然舊資料的
// 來源會維持原本 format 值（例如「紙本」→「紙本購買」），沒辦法反映出它其實是跟圖書館借的。
// 「借入未還」「已歸還」「借出」這三個更是直接退回「保存中」——拿掉借閱狀態追蹤之後，
// 新選項清單裡已經沒有對應的概念，這三個舊值不能放著不管（會變成下拉選單裡選不到、
// 畫面顯示空白的殘影值），統一收斂回最安全的預設狀態。
const LEGACY_RETENTION_RENAMES = {
  保存: DEFAULT_RETENTION_STATUS,
  借閱: DEFAULT_RETENTION_STATUS,
  借入未還: DEFAULT_RETENTION_STATUS,
  已歸還: DEFAULT_RETENTION_STATUS,
  借出: DEFAULT_RETENTION_STATUS,
  售出: SOLD_RETENTION_STATUS,
  轉贈: SOLD_RETENTION_STATUS,
  待售: DEFAULT_RETENTION_STATUS, // 新選項清單沒有對應的「待售」概念，退回保存中。
};
const LEGACY_FORMAT_RENAMES = {
  紙本: '紙本購買',
};

export async function migrateLegacyBookFields() {
  const books = await DB.getAll('books');
  for (const book of books) {
    const wasLibraryLoan = book.retentionStatus === '借閱';
    const newRetention = LEGACY_RETENTION_RENAMES[book.retentionStatus];
    const newFormat = wasLibraryLoan ? LIBRARY_SOURCE_FORMAT : LEGACY_FORMAT_RENAMES[book.format];
    if (newRetention || newFormat) {
      await DB.update('books', {
        ...book,
        ...(newRetention ? { retentionStatus: newRetention } : {}),
        ...(newFormat ? { format: newFormat } : {}),
      });
    }
  }
}

// 上傳的封面圖直接壓縮成 base64 存進 IndexedDB（純本機，不用連網、不用外部圖床）。
// 縮到最長邊 500px、JPEG 品質 0.82，避免原圖太大把資料庫和備份檔案撐爆。
function resizeImageToDataUrl(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxDim) {
          height = Math.round(height * (maxDim / width));
          width = maxDim;
        } else if (height >= width && height > maxDim) {
          width = Math.round(width * (maxDim / height));
          height = maxDim;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('無法讀取圖片'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error('無法讀取檔案'));
    reader.readAsDataURL(file);
  });
}

function wireCoverUpload(form) {
  const fileInput = form.querySelector('#cover-file-input');
  const preview = form.querySelector('#cover-preview');
  const valueInput = form.querySelector('#cover-image-value');
  const uploadBtn = form.querySelector('#cover-upload-btn');
  const changeBtn = form.querySelector('#cover-change-btn');
  const removeBtn = form.querySelector('#cover-remove-btn');

  wireCoverImage(preview.querySelector('img'));

  // 部分手機瀏覽器在關閉「分類」這種選項很多的原生下拉選單時，偶爾會把關閉當下的觸控事件
  // 誤判成點在下面緊鄰的檔案輸入框上，憑空跳出選擇檔案視窗。這裡不管實際成因是什麼，
  // 只要是「分類」欄位剛互動完的一小段時間內，一律擋掉檔案輸入框的點擊，從根本阻止誤觸。
  // 現在檔案輸入框本身也已經用 CSS 完全隱藏＋pointer-events:none，使用者的手指／滑鼠
  // 根本點不到它本尊，這條時間窗防呆留著當多一層保險，不衝突。
  fileInput.addEventListener('click', (event) => {
    const suppressUntil = Number(fileInput.dataset.suppressClickUntil || 0);
    if (Date.now() < suppressUntil) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);

  // 「上傳」／「更換」都是同一個動作（打開檔案選擇器），只是沒封面/有封面時顯示的按鈕文字不同。
  function openFilePicker() {
    fileInput.click();
  }
  uploadBtn.addEventListener('click', openFilePicker);
  changeBtn.addEventListener('click', openFilePicker);

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    try {
      const dataUrl = await resizeImageToDataUrl(file, 500, 0.82);
      valueInput.value = dataUrl;
      preview.innerHTML = `<img src="${dataUrl}" alt="封面預覽">`;
      wireCoverImage(preview.querySelector('img'));
      uploadBtn.hidden = true;
      changeBtn.hidden = false;
      removeBtn.hidden = false;
    } catch {
      window.alert('封面圖片讀取失敗，換一張試試看。');
    }
  });

  removeBtn.addEventListener('click', () => {
    valueInput.value = '';
    fileInput.value = '';
    preview.innerHTML = '<span class="cover-preview-empty">尚未上傳封面</span>';
    uploadBtn.hidden = false;
    changeBtn.hidden = true;
    removeBtn.hidden = true;
  });
}

// 圖書館借閱細節（借閱管道／圖書館名稱）跟著「來源」欄位展開／收起，「借給誰」
// 則跟著「存留狀態」欄位——來源與存留狀態解耦之後，這兩組細節欄位分別依附在
// 各自真正相關的欄位上，不再都綁在存留狀態一個欄位切換。
// 從願望清單「轉為藏書」點過來時，用跟 bookList.js 作者篩選同一種手法（hash 帶
// 查詢字串，見該檔案 readAndClearAuthorFilterFromHash 開頭註解）把書名／作者／
// 推薦來源／願望清單項目 id 帶進新增書籍表單直接預填，讀完立刻用 replaceState
// 把網址清乾淨，避免重新整理或再次造訪 #/books/new 時殘留上一次轉換的資料。
function readAndClearWishlistPrefillFromHash() {
  const hash = window.location.hash;
  const qIndex = hash.indexOf('?');
  if (qIndex === -1) return null;
  const params = new URLSearchParams(hash.slice(qIndex + 1));
  const title = params.get('title') || '';
  const author = params.get('author') || '';
  const note = params.get('note') || '';
  const wishlistId = params.get('wishlistId');
  history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/books/new`);
  return { title, author, note, wishlistId: wishlistId ? Number(wishlistId) : null };
}

function wireSourceAndRetentionToggles(form) {
  const formatSelect = form.elements.format;
  const borrowFields = form.querySelector('#library-borrow-fields');
  formatSelect.addEventListener('change', () => {
    borrowFields.hidden = formatSelect.value !== LIBRARY_SOURCE_FORMAT;
  });
}

function formTemplate(book, isNew, isFavoriteAuthor) {
  return `
    <form id="book-form" class="book-form" novalidate>
      <fieldset class="form-section book-basic-grid">
        <legend class="icon-heading">${ICON_BOOK_OPEN}書籍基本資料</legend>
        <div class="basic-fields-col">
          <label class="field-required" for="field-title">書名 *<input id="field-title" name="title" required value="${escapeHtml(book.title)}" placeholder="這本書叫什麼名字？"></label>
          <p class="field-hint field-warning" id="title-duplicate-warning" hidden>資料庫中已存在同名書籍</p>
          <div class="basic-fields-row">
            <label for="field-author">作者
              <span class="author-input-row">
                <input id="field-author" name="author" value="${escapeHtml(book.author)}">
                <button type="button" id="author-favorite-btn" class="star-btn${isFavoriteAuthor ? ' filled' : ''}" title="標記為喜愛的作者">♥</button>
              </span>
            </label>
            <label for="field-publisher">出版社<input id="field-publisher" name="publisher" value="${escapeHtml(book.publisher)}"></label>
          </div>
          <div class="basic-fields-row">
            <label for="field-publish-date">出版日期<input id="field-publish-date" type="date" name="publishDate" value="${escapeHtml(book.publishDate)}"></label>
            <label for="field-category">分類
              <select id="field-category" name="category">
                <option value="">（先不分類）</option>
                ${categoryOptionsHtml(book.category)}
              </select>
            </label>
          </div>
        </div>
        <div class="cover-upload-col">
          <span class="cover-upload-label">封面圖片（選填）</span>
          <div class="cover-preview" id="cover-preview">
            ${book.coverImage ? `<img src="${book.coverImage}" alt="封面預覽">` : '<span class="cover-preview-empty">尚未上傳封面</span>'}
          </div>
          <div class="cover-upload-actions">
            <button type="button" id="cover-upload-btn" class="cover-action-btn cover-upload-btn" ${book.coverImage ? 'hidden' : ''}>＋ 上傳封面</button>
            <button type="button" id="cover-change-btn" class="cover-action-btn cover-change-btn" ${book.coverImage ? '' : 'hidden'}>${ICON_IMAGE}更換</button>
            <button type="button" id="cover-remove-btn" class="cover-action-btn cover-remove-btn" ${book.coverImage ? '' : 'hidden'}>${ICON_DELETE}移除</button>
          </div>
          <input type="file" accept="image/*" id="cover-file-input" class="cover-file-input-hidden">
          <input type="hidden" name="coverImage" id="cover-image-value" value="${escapeHtml(book.coverImage || '')}">
        </div>
      </fieldset>

      <fieldset class="form-section form-section-quiet book-purchase-grid">
        <legend class="icon-heading">${ICON_CART}擁有／購買資料</legend>
        <label for="field-purchase-date">購買日期<input id="field-purchase-date" type="date" name="purchaseDate" value="${escapeHtml(book.purchaseDate)}"></label>
        <label for="field-purchase-price">購買價格<input id="field-purchase-price" type="number" name="purchasePrice" min="0" value="${escapeHtml(book.purchasePrice)}"></label>
        <label for="field-format">書籍形式／來源
          <select id="field-format" name="format">
            ${FORMAT_OPTIONS.map((f) => `<option value="${escapeHtml(f)}" ${book.format === f ? 'selected' : ''}>${escapeHtml(f)}</option>`).join('')}
          </select>
        </label>
        <div class="field-wide library-borrow-fields" id="library-borrow-fields" ${book.format === LIBRARY_SOURCE_FORMAT ? '' : 'hidden'}>
          <label for="field-library-borrow-type">借閱管道
            <select id="field-library-borrow-type" name="libraryBorrowType">
              ${LIBRARY_BORROW_TYPE_OPTIONS.map((o) => `<option value="${escapeHtml(o)}" ${book.libraryBorrowType === o ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('')}
            </select>
          </label>
          <label for="field-library-name">圖書館名稱
            <input id="field-library-name" name="libraryName" value="${escapeHtml(book.libraryName)}" placeholder="例如：市立圖書館、HyRead 電子書平台">
          </label>
        </div>
        <label for="retention-status-select">存留狀態
          <select name="retentionStatus" id="retention-status-select">
            ${RETENTION_STATUS_OPTIONS.map((o) => `<option value="${escapeHtml(o)}" ${(book.retentionStatus || DEFAULT_RETENTION_STATUS) === o ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('')}
          </select>
        </label>
      </fieldset>

      ${isNew ? `
      <fieldset class="form-section">
        <legend class="icon-heading">${ICON_BOOK}我的閱讀</legend>
        <label for="field-status">閱讀狀態
          <select id="field-status" name="status">
            ${STATUS_OPTIONS.map((s) => `<option value="${escapeHtml(s)}" ${s === '尚未閱讀' ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('')}
          </select>
        </label>
        <label class="field-wide">閱讀動機（可複選，選填）
          <span class="tag-checkboxes motivation-tags">${MOTIVATION_TAGS.map((m) => `<label class="motivation-tag"><input type="checkbox" name="motivationTags" value="${escapeHtml(m)}"> ${escapeHtml(m)}</label>`).join('')}</span>
        </label>
        <label class="field-wide" for="field-motivation-text">我現在為什麼想讀它？
          <textarea id="field-motivation-text" name="motivationText" rows="2" placeholder="低壓力，想到什麼寫什麼，不寫也沒關係"></textarea>
        </label>
      </fieldset>
      ` : ''}

      <div class="form-actions">
        <button type="submit" class="btn btn-primary">${isNew ? '加入我的書庫' : '儲存'}</button>
        <a class="btn" href="${book.id ? `#/books/${book.id}` : '#/books'}">取消</a>
      </div>
    </form>
  `;
}

export async function renderBookForm(container, rawId) {
  const bookId = rawId ? Number(rawId) : null;
  const existing = bookId ? await DB.getById('books', bookId) : null;
  if (bookId && !existing) {
    container.innerHTML = '<p class="empty">找不到這本書。</p>';
    return;
  }
  const isNew = !bookId;
  const wishlistPrefill = isNew ? readAndClearWishlistPrefillFromHash() : null;
  const book = existing || (wishlistPrefill?.title ? { title: wishlistPrefill.title, author: wishlistPrefill.author } : {});
  let favoriteAuthors = await getFavoriteAuthorMap();

  container.innerHTML = `
    <div class="toolbar">
      <h2>${isNew ? '加入一本書' : '編輯書籍'}</h2>
    </div>
    ${formTemplate(book, isNew, book.author && favoriteAuthors.has(book.author))}
  `;

  const form = container.querySelector('#book-form');
  wireCoverUpload(form);
  wireCategorySelect(form.elements.category);
  wireSourceAndRetentionToggles(form);

  // 關鍵字與書籍新增防呆（Duplicate Check）：輸入書名時即時比對現有藏書庫，
  // 完全同名（去頭尾空白）就顯示提醒——只是提醒，不阻擋送出，使用者可能真的
  // 就是收了兩本同名書（例如不同版本／譯者），不強制當成錯誤處理。編輯既有
  // 書籍時要排除自己本身，不然書名沒改也會對著自己跳出「已存在同名書籍」。
  const allBooks = await DB.getAll('books');
  const titleInput = form.elements.title;
  const titleWarningEl = container.querySelector('#title-duplicate-warning');
  titleInput.addEventListener('input', () => {
    const value = titleInput.value.trim();
    const isDuplicate = value.length > 0 && allBooks.some((b) => b.id !== bookId && (b.title || '').trim() === value);
    titleWarningEl.hidden = !isDuplicate;
  });

  const authorInput = form.elements.author;
  const favoriteBtn = container.querySelector('#author-favorite-btn');
  authorInput.addEventListener('input', () => {
    favoriteBtn.classList.toggle('filled', favoriteAuthors.has(authorInput.value.trim()));
  });
  favoriteBtn.addEventListener('click', async () => {
    favoriteAuthors = await toggleFavoriteAuthor(authorInput.value, favoriteAuthors);
    favoriteBtn.classList.toggle('filled', favoriteAuthors.has(authorInput.value.trim()));
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    const title = (data.title || '').trim();
    if (!title) {
      form.elements.title.focus();
      return;
    }

    const retentionStatus = data.retentionStatus || DEFAULT_RETENTION_STATUS;

    const payload = {
      title,
      author: (data.author || '').trim(),
      publisher: (data.publisher || '').trim(),
      publishDate: data.publishDate || '',
      purchaseDate: data.purchaseDate || '',
      purchasePrice: data.purchasePrice ? Number(data.purchasePrice) : null,
      format: data.format || '其他',
      retentionStatus,
      libraryBorrowType: data.libraryBorrowType || '',
      libraryName: (data.libraryName || '').trim(),
      category: data.category || '',
      coverImage: data.coverImage || '',
    };

    let targetBookId = bookId;
    if (bookId) {
      await DB.update('books', { ...book, ...payload, id: bookId });
    } else {
      targetBookId = await DB.add('books', payload);
      const motivationTags = Array.from(form.querySelectorAll('input[name="motivationTags"]:checked')).map((el) => el.value);
      const motivationText = (data.motivationText || '').trim();
      await DB.add('reading_records', {
        bookId: targetBookId,
        status: data.status || '尚未閱讀',
        startDate: '',
        endDate: '',
        currentPage: null,
        readCount: 0,
        rating: 0,
      });
      if (motivationTags.length > 0 || motivationText) {
        await DB.add('outputs', { bookId: targetBookId, kind: 'motivation', tags: motivationTags, text: motivationText });
      }
      // 從願望清單「轉為藏書」轉過來的新書：推薦來源／備註原本只是願望清單自己的
      // 欄位，books 表沒有對應欄位可以存，改成順手存成一則快速筆記，資訊不會憑空
      // 消失；願望清單裡的這筆項目也才真的移除——特意等到書籍「確定送出成功」才刪，
      // 使用者半路按「取消」不會平白弄丟這筆願望清單資料（見 wishlist.js 開頭註解）。
      if (wishlistPrefill?.wishlistId) {
        if (wishlistPrefill.note) {
          await DB.add('notes', { bookId: targetBookId, text: `推薦來源／備註：${wishlistPrefill.note}` });
        }
        await DB.remove('wishlist', wishlistPrefill.wishlistId);
      }
      // 送出這一刻書就已經真的存進書庫了（上面的 DB.add('books', ...)），接下來
      // 跳轉去的書籍詳情頁只是「順便可以繼續補資料」的地方，不是還沒完成的下一步——
      // 但詳情頁預設停在「閱讀動機」分頁（見 bookDetail.js），那個分頁本身就是一個
      // 帶著「儲存」按鈕的空白表單，使用者剛送出表單就立刻看到另一個表單＋儲存鍵，
      // 很容易誤以為「還要再按一次儲存才算加入書庫」。這裡明確跳一個成功提示，
      // 讓使用者不用靠自己讀懂分頁邏輯就知道書已經加好了，後面的閱讀動機、快速筆記
      // 這些都是選填、可以隨時再回來補。編輯既有書籍（上面的 if (bookId) 分支）
      // 不需要這則提示——那個情境本來就是使用者主動點進來修改，不會有「這樣算完成
      // 了嗎」的疑惑。
      showToast(`已將「${title}」加入書庫`);
    }
    window.location.hash = `#/books/${targetBookId}`;
  });
}
