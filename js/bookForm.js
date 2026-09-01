import { DB } from './db.js';
import { STATUS_OPTIONS } from './readingRecords.js';
import { MOTIVATION_TAGS, MOTIVATION_TAG_GROUPS } from './outputs.js';
import { getFavoriteAuthorMap, toggleFavoriteAuthor } from './authors.js';
import { escapeHtml } from './utils.js';
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

// 存留狀態改成單純描述「這本書現在的持有狀態」，跟來源脫鉤：
// 保存中（手上留著）／借入未還（跟圖書館借的，還沒還）／已歸還（跟圖書館借的，已經還了）／
// 借出（借給朋友，還沒拿回來）／已售出/贈送（不再是我的書了）。
const RETENTION_STATUS_OPTIONS = ['保存中', '借入未還', '已歸還', '借出', '已售出/贈送'];
export const DEFAULT_RETENTION_STATUS = '保存中';
export const BORROWED_RETENTION_STATUS = '借入未還';
export const RETURNED_RETENTION_STATUS = '已歸還';
export const LENT_OUT_RETENTION_STATUS = '借出';
export const SOLD_RETENTION_STATUS = '已售出/贈送';
const LIBRARY_BORROW_TYPE_OPTIONS = ['實體圖書館', '線上圖書館 / 電子書'];

// 存留狀態的選項字串改名／合併後，既有書籍資料庫裡存的還是舊字串，不會自動跟著變。
// 「借閱」比較特殊：解耦之前它同時代表「這本書是圖書館借的」跟「現在還沒還」兩件事，
// 拆開後「現在還沒還」變成新的「借入未還」，但「這本書是圖書館借的」這個來源資訊
// 也要順便搬到「書籍形式／來源」欄位，不然舊資料的來源會維持原本 format 值
// （例如「紙本」→「紙本購買」），沒辦法反映出它其實是跟圖書館借的。
const LEGACY_RETENTION_RENAMES = {
  保存: DEFAULT_RETENTION_STATUS,
  借閱: BORROWED_RETENTION_STATUS,
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
function wireSourceAndRetentionToggles(form) {
  const formatSelect = form.elements.format;
  const retentionSelect = form.elements.retentionStatus;
  const borrowFields = form.querySelector('#library-borrow-fields');
  const lentOutFields = form.querySelector('#lent-out-fields');
  formatSelect.addEventListener('change', () => {
    borrowFields.hidden = formatSelect.value !== LIBRARY_SOURCE_FORMAT;
  });
  retentionSelect.addEventListener('change', () => {
    lentOutFields.hidden = retentionSelect.value !== LENT_OUT_RETENTION_STATUS;
  });
}

function formTemplate(book, isNew, isFavoriteAuthor) {
  return `
    <form id="book-form" class="book-form" novalidate>
      <fieldset class="form-section book-basic-grid">
        <legend>📖 書籍基本資料</legend>
        <div class="basic-fields-col">
          <label class="field-required" for="field-title">書名 *<input id="field-title" name="title" required value="${escapeHtml(book.title)}" placeholder="這本書叫什麼名字？"></label>
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
            <button type="button" id="cover-change-btn" class="cover-action-btn cover-change-btn" ${book.coverImage ? '' : 'hidden'}>📷 更換</button>
            <button type="button" id="cover-remove-btn" class="cover-action-btn cover-remove-btn" ${book.coverImage ? '' : 'hidden'}>🗑️ 移除</button>
          </div>
          <input type="file" accept="image/*" id="cover-file-input" class="cover-file-input-hidden">
          <input type="hidden" name="coverImage" id="cover-image-value" value="${escapeHtml(book.coverImage || '')}">
        </div>
      </fieldset>

      <fieldset class="form-section form-section-quiet book-purchase-grid">
        <legend>🛒 擁有／購買資料</legend>
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
        <div class="field-wide library-borrow-fields" id="lent-out-fields" ${(book.retentionStatus || DEFAULT_RETENTION_STATUS) === LENT_OUT_RETENTION_STATUS ? '' : 'hidden'}>
          <label class="field-wide" for="field-lent-to">借給誰 / 借出備註
            <input id="field-lent-to" name="lentTo" value="${escapeHtml(book.lentTo)}" placeholder="例如：小明，或「小明（2026/08/27 借出）」">
          </label>
        </div>
      </fieldset>

      ${isNew ? `
      <fieldset class="form-section">
        <legend>📚 我的閱讀</legend>
        <label for="field-status">閱讀狀態
          <select id="field-status" name="status">
            ${STATUS_OPTIONS.map((s) => `<option value="${escapeHtml(s)}" ${s === '尚未閱讀' ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('')}
          </select>
        </label>
        <label class="field-wide">閱讀動機（可複選，選填）
          <span class="tag-checkboxes motivation-tags">${MOTIVATION_TAGS.map((m) => `<label data-group="${MOTIVATION_TAG_GROUPS[m]}"><input type="checkbox" name="motivationTags" value="${escapeHtml(m)}"> ${escapeHtml(m)}</label>`).join('')}</span>
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
  const book = existing || {};
  const isNew = !bookId;
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

    // 新增書籍時如果一次把「來源」設成圖書館借閱、「存留狀態」設成借入未還、
    // 「閱讀狀態」又直接選已讀完（例如補登一本早就看完的借閱書），三個條件同時成立
    // 就順手問一句要不要直接存成「已歸還」，跟 readingRecords.js 更新閱讀進度時
    // 觸發的提示是同一個情境、同一句用語，只是這裡發生在新增當下。
    let retentionStatus = data.retentionStatus || DEFAULT_RETENTION_STATUS;
    if (isNew && data.format === LIBRARY_SOURCE_FORMAT && retentionStatus === BORROWED_RETENTION_STATUS && data.status === '已讀完') {
      if (window.confirm('這本書的來源是「圖書館借閱」，閱讀狀態也已經是「已讀完」，要順便把存留狀態切換成「已歸還」嗎？')) {
        retentionStatus = RETURNED_RETENTION_STATUS;
      }
    }

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
      lentTo: (data.lentTo || '').trim(),
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
    }
    window.location.hash = `#/books/${targetBookId}`;
  });
}
