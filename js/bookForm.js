import { DB } from './db.js';
import { STATUS_OPTIONS } from './readingRecords.js';
import { MOTIVATION_TAGS } from './outputs.js';
import { getFavoriteAuthorMap, toggleFavoriteAuthor } from './authors.js';
import { escapeHtml } from './utils.js';
import { categoryOptionsHtml, wireCategorySelect } from './categories.js';

const FORMAT_OPTIONS = ['紙本', '電子書', '有聲書', '其他'];
const RETENTION_STATUS_OPTIONS = ['保存', '待售', '借閱', '售出', '轉贈'];
export const DEFAULT_RETENTION_STATUS = '保存';
export const BORROWED_RETENTION_STATUS = '借閱';
const LIBRARY_BORROW_TYPE_OPTIONS = ['實體圖書館', '線上圖書館 / 電子書'];

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
  const removeBtn = form.querySelector('#cover-remove-btn');

  // 部分手機瀏覽器在關閉「分類」這種選項很多的原生下拉選單時，偶爾會把關閉當下的觸控事件
  // 誤判成點在下面緊鄰的檔案輸入框上，憑空跳出選擇檔案視窗。這裡不管實際成因是什麼，
  // 只要是「分類」欄位剛互動完的一小段時間內，一律擋掉檔案輸入框的點擊，從根本阻止誤觸。
  fileInput.addEventListener('click', (event) => {
    const suppressUntil = Number(fileInput.dataset.suppressClickUntil || 0);
    if (Date.now() < suppressUntil) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    try {
      const dataUrl = await resizeImageToDataUrl(file, 500, 0.82);
      valueInput.value = dataUrl;
      preview.innerHTML = `<img src="${dataUrl}" alt="封面預覽">`;
      removeBtn.style.display = '';
    } catch {
      window.alert('封面圖片讀取失敗，換一張試試看。');
    }
  });

  removeBtn.addEventListener('click', () => {
    valueInput.value = '';
    fileInput.value = '';
    preview.innerHTML = '<span class="cover-preview-empty">尚未上傳封面</span>';
    removeBtn.style.display = 'none';
  });
}

// 存留狀態選「借閱」才展開圖書館借閱細節，其他狀態下藏起來，避免表單看起來欄位一堆用不到。
function wireRetentionStatusToggle(form) {
  const select = form.elements.retentionStatus;
  const fields = form.querySelector('#library-borrow-fields');
  select.addEventListener('change', () => {
    fields.hidden = select.value !== BORROWED_RETENTION_STATUS;
  });
}

function formTemplate(book, isNew, isFavoriteAuthor) {
  return `
    <form id="book-form" class="book-form" novalidate>
      <fieldset class="form-section">
        <legend>📖 書籍基本資料</legend>
        <label class="field-required field-wide" for="field-title">書名 *<input id="field-title" name="title" required value="${escapeHtml(book.title)}" placeholder="這本書叫什麼名字？"></label>
        <label for="field-author">作者
          <span class="author-input-row">
            <input id="field-author" name="author" value="${escapeHtml(book.author)}">
            <button type="button" id="author-favorite-btn" class="star-btn${isFavoriteAuthor ? ' filled' : ''}" title="標記為喜愛的作者">♥</button>
          </span>
        </label>
        <label for="field-publisher">出版社<input id="field-publisher" name="publisher" value="${escapeHtml(book.publisher)}"></label>
        <label for="field-publish-date">出版日期<input id="field-publish-date" type="date" name="publishDate" value="${escapeHtml(book.publishDate)}"></label>
        <label for="field-category">分類
          <select id="field-category" name="category">
            <option value="">（先不分類）</option>
            ${categoryOptionsHtml(book.category)}
          </select>
        </label>
        <label class="field-wide" for="cover-file-input">封面圖片（選填）
          <div class="cover-upload" id="cover-upload">
            <div class="cover-preview" id="cover-preview">
              ${book.coverImage ? `<img src="${book.coverImage}" alt="封面預覽">` : '<span class="cover-preview-empty">尚未上傳封面</span>'}
            </div>
            <div class="cover-upload-actions">
              <input type="file" accept="image/*" id="cover-file-input">
              <button type="button" id="cover-remove-btn" class="btn" style="${book.coverImage ? '' : 'display:none;'}">移除封面</button>
            </div>
          </div>
          <input type="hidden" name="coverImage" id="cover-image-value" value="${escapeHtml(book.coverImage || '')}">
        </label>
      </fieldset>

      <fieldset class="form-section form-section-quiet">
        <legend>🛒 擁有／購買資料</legend>
        <label for="field-purchase-date">購買日期<input id="field-purchase-date" type="date" name="purchaseDate" value="${escapeHtml(book.purchaseDate)}"></label>
        <label for="field-purchase-source">購買來源<input id="field-purchase-source" name="purchaseSource" value="${escapeHtml(book.purchaseSource)}"></label>
        <label for="field-purchase-price">購買價格<input id="field-purchase-price" type="number" name="purchasePrice" min="0" value="${escapeHtml(book.purchasePrice)}"></label>
        <label for="field-format">書籍形式
          <select id="field-format" name="format">
            ${FORMAT_OPTIONS.map((f) => `<option value="${escapeHtml(f)}" ${book.format === f ? 'selected' : ''}>${escapeHtml(f)}</option>`).join('')}
          </select>
        </label>
        <label for="retention-status-select">存留狀態
          <select name="retentionStatus" id="retention-status-select">
            ${RETENTION_STATUS_OPTIONS.map((o) => `<option value="${escapeHtml(o)}" ${(book.retentionStatus || DEFAULT_RETENTION_STATUS) === o ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('')}
          </select>
        </label>
        <div class="field-wide library-borrow-fields" id="library-borrow-fields" ${(book.retentionStatus || DEFAULT_RETENTION_STATUS) === BORROWED_RETENTION_STATUS ? '' : 'hidden'}>
          <label for="field-library-borrow-type">借閱管道
            <select id="field-library-borrow-type" name="libraryBorrowType">
              ${LIBRARY_BORROW_TYPE_OPTIONS.map((o) => `<option value="${escapeHtml(o)}" ${book.libraryBorrowType === o ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('')}
            </select>
          </label>
          <label for="field-library-name">圖書館名稱
            <input id="field-library-name" name="libraryName" value="${escapeHtml(book.libraryName)}" placeholder="例如：市立圖書館、HyRead 電子書平台">
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
          <span class="tag-checkboxes motivation-tags">${MOTIVATION_TAGS.map((m) => `<label><input type="checkbox" name="motivationTags" value="${escapeHtml(m)}"> ${escapeHtml(m)}</label>`).join('')}</span>
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
  wireRetentionStatusToggle(form);

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

    const payload = {
      title,
      author: (data.author || '').trim(),
      publisher: (data.publisher || '').trim(),
      publishDate: data.publishDate || '',
      purchaseDate: data.purchaseDate || '',
      purchaseSource: (data.purchaseSource || '').trim(),
      purchasePrice: data.purchasePrice ? Number(data.purchasePrice) : null,
      format: data.format || '其他',
      retentionStatus: data.retentionStatus || DEFAULT_RETENTION_STATUS,
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
    }
    window.location.hash = `#/books/${targetBookId}`;
  });
}
