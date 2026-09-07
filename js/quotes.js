import { DB } from './db.js';
import { escapeHtml, renderTextWithHashtags, confirmModal, guardUnsavedChanges, showToast } from './utils.js';
import { ICON_CLIPBOARD, ICON_EDIT, ICON_DELETE } from './icons.js';

// 頁碼欄位是自由文字（例如「45-47」），排序時只抓第一串數字當排序依據。
function parsePageNumber(page) {
  if (!page) return null;
  const match = String(page).match(/\d+/);
  return match ? Number(match[0]) : null;
}

// 「珍貴典藏」精簡：搜尋框／排序選單／「共 X 條」提示都拿掉了（見
// renderQuotesWorkspace 開頭的說明），排序不再讓使用者選，固定用頁碼排序——
// 佳句本來就是跟著書本身的頁數走，翻書複習時照頁碼由小到大排列最直覺，
// 「依新增時間排序」那個選項連同 sortByNewest() 一起刪除，不留死碼。
function sortByPage(quotes) {
  return [...quotes].sort((a, b) => {
    const pageA = parsePageNumber(a.page);
    const pageB = parsePageNumber(b.page);
    if (pageA != null && pageB != null && pageA !== pageB) return pageA - pageB;
    if (pageA != null && pageB == null) return -1;
    if (pageA == null && pageB != null) return 1;
    return (a.createdAt || '').localeCompare(b.createdAt || '');
  });
}

async function getQuotesByBook(bookId) {
  return DB.getByIndex('quotes', 'bookId', bookId);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    window.prompt('複製失敗，請手動選取複製：', text);
    return false;
  }
}

// ---------- 佳句典藏（新增／單欄式列表）----------
// 獨立佳句頁面（/books/:id/quotes）跟書籍詳情頁的「佳句摘錄」Tab 共用同一份邏輯，
// 差別只在外層有沒有包一層「回列表」的 toolbar，所以拆成這個函式讓兩邊都能呼叫。

// 卡片右下角頁碼是淡化的純文字（不再是有底色的標籤），「複製／編輯／刪除」
// 三顆操作改成極簡圖示，平常整組隱藏（見 .quote-actions 的 opacity:0），
// 只有滑鼠移到卡片上才浮現——列表變成安靜的典藏陳列，不是隨時掛滿功能按鈕
// 的管理介面。引號裝飾只留左上角的開頭引號，收尾的右引號拿掉：一句話裡
// 出現兩個裝飾性引號在「單欄沉浸閱讀」的排版裡略嫌多餘，只留開頭這一個
// 更貼近「翻開書頁看到摘錄」的感覺。
function quoteCardHtml(quote) {
  return `
    <div class="quote-card" data-id="${quote.id}">
      <div class="quote-actions">
        <button type="button" class="quote-icon-btn quote-copy-btn" data-id="${quote.id}" title="複製內文" aria-label="複製內文">${ICON_CLIPBOARD}</button>
        <button type="button" class="quote-icon-btn quote-edit-btn" data-id="${quote.id}" title="編輯" aria-label="編輯">${ICON_EDIT}</button>
        <button type="button" class="quote-icon-btn quote-delete-btn" data-id="${quote.id}" title="刪除" aria-label="刪除">${ICON_DELETE}</button>
      </div>
      <span class="quote-mark" aria-hidden="true">“</span>
      <div class="quote-content-wrap">
        <p class="quote-content is-clamped">${renderTextWithHashtags(quote.content)}</p>
        <button type="button" class="quote-expand-btn" style="display:none;">展開全文</button>
      </div>
      ${quote.page ? `<div class="quote-card-footer"><span class="quote-page-note">p.${escapeHtml(quote.page)}</span></div>` : ''}
    </div>
  `;
}

function quoteEditFormHtml(quote) {
  return `
    <form class="quote-card quote-edit-form" data-id="${quote.id}">
      <textarea name="content" rows="4" required>${escapeHtml(quote.content)}</textarea>
      <input name="page" class="quote-page-edit-input" value="${escapeHtml(quote.page || '')}" placeholder="頁碼（選填），例如：45 或 45-47">
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">儲存</button>
        <button type="button" class="btn quote-cancel-btn">取消</button>
      </div>
    </form>
  `;
}

// options.onCountChange(total)：每次重繪清單都會回報目前總條數，
// 書籍詳情頁的「佳句摘錄」Tab 用這個把數字同步更新到分頁按鈕上的「(X 條)」。
// 不吃 book 這個參數——原本只有「匯出文字檔／Markdown」需要書名，兩個匯出
// 按鈕都拿掉之後，這個函式只需要 bookId 就能運作。
export async function renderQuotesWorkspace(container, bookId, options = {}) {
  // 呼叫端（bookDetail.js 的 refreshDetail()）在某些操作後會整頁重新渲染，
  // 導致這個函式被重新呼叫一次——先清掉上一次殘留的未儲存內容守衛，不然它
  // 還讀著已經被換掉的舊表單內容（同一個成因跟 outputs.js／notes.js 處理過
  // 的問題一樣）。
  container._unsavedGuardDestroy?.();
  const onCountChange = options.onCountChange || (() => {});
  let editingId = null;

  // 「珍貴典藏」精簡：使用者反映佳句摘錄頁籤管理元件太多（搜尋框、「共 X 條」
  // 提示、排序選單），要求整組拿掉，回歸單欄沉浸式的閱讀/收藏體驗——列表
  // 固定用頁碼排序（見上面 sortByPage 的說明），不再需要搜尋跟排序狀態，
  // 也不需要另外一段文字告訴使用者「共幾條」，捲一下列表本身就看得到。
  // 左右兩欄（新增表單／佳句列表）的 .quotes-page-layout grid 也一併拿掉，
  // 改成新增區在上、列表在下的單欄「垂直流」佈局。曾經試過在外面再包一層
  // .quote-workspace 限制 max-width:720px 置中，使用者反映這會跟上方
  // 「閱讀進度」等滿版寬度的區塊對不齊、像切一半，已經拿掉那層限制，這裡
  // 恢復成兩個平輩 div，過度留白的問題改成下面卡片本身的字級/內距/間距
  // 處理，不再靠限制整體寬度。
  container.innerHTML = `
    <div class="quote-composer">
      <form id="quote-form">
        <textarea name="content" class="quote-composer-input" rows="2" placeholder="輸入書中打動你的句子……" required></textarea>
        <div class="quote-composer-actions">
          <input name="page" class="quote-page-input" placeholder="頁碼（選填）">
          <button type="submit" class="btn btn-primary">＋ 新增佳句</button>
        </div>
      </form>
    </div>
    <div class="quote-list" id="quote-list"></div>
  `;

  const form = container.querySelector('#quote-form');
  const listEl = container.querySelector('#quote-list');

  async function redrawList() {
    const quotes = sortByPage(await getQuotesByBook(bookId));
    onCountChange(quotes.length);

    listEl.innerHTML = quotes.length === 0
      ? '<p class="empty">還沒有摘錄任何佳句。</p>'
      : quotes.map((q) => (q.id === editingId ? quoteEditFormHtml(q) : quoteCardHtml(q))).join('');

    wireListEvents();
  }

  function wireListEvents() {
    // 圖示按鈕本身沒有文字可以拿來閃「已複製」這種暫時性回饋（不像原本
    // 「複製內文」是一顆有文字的按鈕，可以直接把文字換掉一下子），改用
    // 全站共用的 showToast——跟複製其他內容（分享連結、匯出結果……）用
    // 同一種確認方式，使用者不用盯著圖示看才知道有沒有複製成功。
    listEl.querySelectorAll('.quote-copy-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const quote = await DB.getById('quotes', Number(btn.dataset.id));
        if (!quote) return;
        const ok = await copyText(quote.content);
        if (ok) showToast('已複製佳句內容');
      });
    });

    listEl.querySelectorAll('.quote-edit-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        editingId = Number(btn.dataset.id);
        redrawList();
      });
    });

    listEl.querySelectorAll('.quote-cancel-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        editingId = null;
        redrawList();
      });
    });

    listEl.querySelectorAll('.quote-edit-form').forEach((editForm) => {
      editForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const id = Number(editForm.dataset.id);
        const content = editForm.elements.content.value.trim();
        if (!content) return;
        const page = editForm.elements.page.value.trim();
        const existing = await DB.getById('quotes', id);
        await DB.update('quotes', { ...existing, content, page });
        editingId = null;
        await redrawList();
      });
    });

    listEl.querySelectorAll('.quote-delete-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const confirmed = await confirmModal({
          title: '確定要刪除嗎？',
          message: '這句佳句刪除後無法復原。',
          confirmText: '確認刪除',
          cancelText: '取消',
          danger: true,
        });
        if (!confirmed) return;
        await DB.remove('quotes', Number(btn.dataset.id));
        await redrawList();
      });
    });

    listEl.querySelectorAll('.quote-expand-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const wrap = btn.closest('.quote-content-wrap');
        const p = wrap.querySelector('.quote-content');
        const expanded = p.classList.toggle('is-expanded');
        p.classList.toggle('is-clamped', !expanded);
        btn.textContent = expanded ? '收合' : '展開全文';
      });
    });

    listEl.querySelectorAll('.quote-content.is-clamped').forEach((p) => {
      if (p.scrollHeight > p.clientHeight + 2) {
        const btn = p.closest('.quote-content-wrap').querySelector('.quote-expand-btn');
        if (btn) btn.style.display = '';
      }
    });
  }

  // 未儲存內容離開防護（Unsaved Changes Guard）：「新增佳句」欄位打了字卻還沒
  // 送出就想離開，跳出提醒（見 utils.js 的 guardUnsavedChanges 完整說明）。
  let isDirty = false;
  form.elements.content.addEventListener('input', () => {
    isDirty = form.elements.content.value.trim() !== '';
  });
  container._unsavedGuardDestroy = guardUnsavedChanges(() => isDirty);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const content = form.elements.content.value.trim();
    if (!content) return;
    const page = form.elements.page.value.trim();
    await DB.add('quotes', { bookId, content, page });
    form.reset();
    isDirty = false;
    await redrawList();
  });

  await redrawList();
}

// ---------- 獨立佳句子頁面（/books/:id/quotes），外面多包一層「回列表」toolbar ----------

export async function renderQuotesPage(container, rawBookId) {
  const bookId = Number(rawBookId);
  const book = await DB.getById('books', bookId);
  if (!book) {
    container.innerHTML = '<p class="empty">找不到這本書。</p>';
    return;
  }

  container.innerHTML = `
    <div class="toolbar">
      <a href="#/books/${bookId}">⬅ 回《${escapeHtml(book.title || '未命名')}》</a>
      <h2>佳句摘錄</h2>
    </div>
    <div id="quotes-workspace"></div>
  `;

  await renderQuotesWorkspace(container.querySelector('#quotes-workspace'), bookId);
}
