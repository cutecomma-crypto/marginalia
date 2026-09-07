import { DB } from './db.js';
import { escapeHtml, renderTextWithHashtags, showToast, confirmModal, guardUnsavedChanges } from './utils.js';
import { ICON_NOTEBOOK, ICON_LIGHTBULB, ICON_EDIT, ICON_DELETE } from './icons.js';
import { attachSelectionToolbar } from './services/selectionToolbarService.js';
import { getOutputsByKind, renderLegacyReflectionItem, renderLegacyMotivationItem } from './outputs.js';

// 「功能簡化」精簡：原本分開的「閱讀動機」「閱讀後輸出」（outputs.js 的
// 兩個表單）跟「快速筆記」（這個檔案）三個各自獨立的分頁，合併成單一個
// 「閱讀心得」區塊，介面上只留一個乾淨的純文字輸入框——不再有三組
// 各自獨立的表單、標題、動機／心得標籤、格式化工具列。既有的三種資料
// 完全不遷移、不刪除：notes 表跟 outputs 表（kind='reflection'／
// kind='motivation'）都繼續留著原本的欄位與內容，這裡只是把「讀取」跟
// 「新增」的入口收斂成一個——新增一律寫進 notes 表（本來就是比較單純的
// 那張表，之後也只有一種資料格式要維護），既有的 outputs 資料則繼續用
// outputs.js 匯出的 renderLegacyReflectionItem()／renderLegacyMotivationItem()
// 顯示（標籤 chip／HTML或 Markdown 相容內文／可調整日期都保留），三種來源
// 合併成同一份時間排序清單。
async function getNotesForBook(bookId) {
  const notes = await DB.getByIndex('notes', 'bookId', bookId);
  return notes.map((n) => ({ ...n, _source: 'notes' }));
}

async function getLegacyReflectionsForBook(bookId) {
  const reflections = await getOutputsByKind(bookId, 'reflection');
  return reflections.map((r) => ({ ...r, _source: 'outputs', _kind: 'reflection' }));
}

async function getLegacyMotivationsForBook(bookId) {
  const motivations = await getOutputsByKind(bookId, 'motivation');
  return motivations.map((m) => ({ ...m, _source: 'outputs', _kind: 'motivation' }));
}

// isEditing：這張卡片是不是正在被編輯——是的話整個 <p> 內文換成一個帶原始
// 內容的 <textarea>，右上角的「編輯／刪除」也換成「儲存／取消」，跟原本
// 唯讀狀態共用同一個 .output-item 外殼／同一組按鈕定位規則，只是內容跟按鈕
// 文字不同，不需要另外寫一套完全獨立的卡片樣板。舊 outputs 資料沒有這個
// 行內編輯功能（沿用合併前就有的限制，見 outputs.js 的 renderLegacyReflectionItem），
// 只有 notes 來源的項目會走這裡。data-source="notes"：跟舊 outputs 項目共用
// 同一批 .output-delete class，靠這個屬性分流刪除時該動哪張表。
function noteItem(note, isEditing) {
  if (isEditing) {
    return `
      <div class="output-item" data-id="${note.id}" data-source="notes">
        <div class="output-item-actions">
          <button type="button" class="btn btn-primary output-save-edit" data-id="${note.id}">儲存</button>
          <button type="button" class="btn output-cancel-edit" data-id="${note.id}">取消</button>
        </div>
        <textarea class="output-edit-textarea" rows="8">${escapeHtml(note.text)}</textarea>
        <div class="output-date">${escapeHtml((note.createdAt || '').slice(0, 10))}</div>
      </div>
    `;
  }
  return `
    <div class="output-item" data-id="${note.id}" data-source="notes">
      <div class="output-item-actions">
        <button type="button" class="btn output-edit" data-id="${note.id}" data-tooltip="編輯" aria-label="編輯">${ICON_EDIT}</button>
        <button type="button" class="btn btn-danger output-delete" data-id="${note.id}" data-source="notes" data-tooltip="刪除" aria-label="刪除">${ICON_DELETE}</button>
      </div>
      <p>${renderTextWithHashtags(note.text)}</p>
      <div class="output-date">${escapeHtml((note.createdAt || '').slice(0, 10))}</div>
    </div>
  `;
}

// editingId：目前正在編輯中的那一條筆記 id（同一時間只開放編輯一條，符合
// 一般「行內編輯」的直覺——同時開兩條編輯欄容易搞不清楚哪個「儲存」對應
// 哪一條）。整個函式每次都會重新從資料庫抓一次最新的合併清單（跟既有的
// 新增／刪除操作完全同一套模式），editingId 只是額外告訴 noteItem() 要把
// 哪一張卡片換成編輯狀態，取消編輯不需要另外寫回資料庫，直接重繪回唯讀
// 狀態即可。
// onQuoteAdded：合併後這裡也接手了原本「閱讀後輸出」選取文字存成佳句的
// 功能（見下面 attachSelectionToolbar）——存完一句佳句要通知外層
// （bookDetail.js 的 refreshQuotesTab）同步更新「佳句摘錄」分頁，做法完全
// 沿用 outputs.js 原本 renderReflections() 的那一套。
export async function renderPersonalNotes(container, bookId, { editingId = null, onQuoteAdded } = {}) {
  // 這個函式在新增／刪除／編輯筆記時會重新呼叫自己好幾次，每次都整個重繪
  // DOM——先清掉上一次殘留的 guardUnsavedChanges() 監聽器，不然它還讀著
  // 已經被換掉的舊輸入框內容，可能一路累加、卡在假警報（同一個成因跟
  // bookList.js 的 inline-status-popover 都處理過的問題一樣）。
  container._unsavedGuardDestroy?.();
  const [notes, reflections, motivations] = await Promise.all([
    getNotesForBook(bookId),
    getLegacyReflectionsForBook(bookId),
    getLegacyMotivationsForBook(bookId),
  ]);
  const merged = [...notes, ...reflections, ...motivations].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

  function renderItem(item) {
    if (item._source === 'notes') return noteItem(item, item.id === editingId);
    if (item._kind === 'motivation') return renderLegacyMotivationItem(item);
    return renderLegacyReflectionItem(item);
  }

  container.innerHTML = `
    <div class="notes-section">
      <h4 class="section-heading icon-heading">${ICON_NOTEBOOK}閱讀心得</h4>
      <form id="note-form" class="book-form">
        <label>想到什麼就先寫下來，之後再整理
          <textarea name="text" rows="8" placeholder="例如：這裡提到榮格，感覺跟之前看的那本書有關"></textarea>
        </label>
        <p class="hashtag-hint">${ICON_LIGHTBULB}提示：內文中輸入 #標籤名稱（例如 #心理學），系統將自動分類並串聯相關書籍內容。</p>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary">儲存</button>
        </div>
      </form>
      <div class="output-list">
        ${merged.length === 0 ? '<p class="empty">還沒有任何筆記。</p>' : merged.map(renderItem).join('')}
      </div>
    </div>
  `;

  const form = container.querySelector('#note-form');
  const textarea = form.elements.text;

  // 未儲存內容離開防護（Unsaved Changes Guard）：打了字卻還沒按「儲存」就想
  // 關分頁／重新整理／換網址，跳出瀏覽器原生的離開提醒。
  let isDirty = false;
  textarea.addEventListener('input', () => {
    isDirty = textarea.value.trim() !== '';
  });
  container._unsavedGuardDestroy = guardUnsavedChanges(() => isDirty);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = textarea.value.trim();
    if (!text) return;
    await DB.add('notes', { bookId, text });
    isDirty = false;
    await renderPersonalNotes(container, bookId, { onQuoteAdded });
  });

  textarea.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      form.requestSubmit();
    }
  });

  // 刪除：notes／舊 outputs 兩種來源共用同一顆 .output-delete 按鈕，靠
  // data-source 決定要對哪張表下 DB.remove，不用另外寫兩套幾乎一樣的邏輯。
  container.querySelectorAll('.output-delete').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const confirmed = await confirmModal({
        title: '確定要刪除嗎？',
        message: '這則筆記刪除後無法復原。',
        confirmText: '確認刪除',
        cancelText: '取消',
        danger: true,
      });
      if (!confirmed) return;
      await DB.remove(btn.dataset.source, Number(btn.dataset.id));
      await renderPersonalNotes(container, bookId, { onQuoteAdded });
    });
  });

  // 行內編輯／日期調整：只有 notes 來源的項目才有 .output-edit 按鈕（見
  // noteItem()），舊 outputs 心得項目沒有這幾個 class，底下這幾段
  // querySelectorAll 自然不會選到，不用另外判斷來源。
  container.querySelectorAll('.output-edit').forEach((btn) => {
    btn.addEventListener('click', () => {
      renderPersonalNotes(container, bookId, { editingId: Number(btn.dataset.id), onQuoteAdded });
    });
  });

  container.querySelectorAll('.output-cancel-edit').forEach((btn) => {
    btn.addEventListener('click', () => {
      renderPersonalNotes(container, bookId, { onQuoteAdded });
    });
  });

  container.querySelectorAll('.output-save-edit').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.id);
      const note = notes.find((n) => n.id === id);
      const editTextarea = container.querySelector(`.output-item[data-id="${id}"] .output-edit-textarea`);
      const newText = editTextarea.value.trim();
      if (!newText) {
        showToast('筆記內容不能是空的');
        return;
      }
      await DB.update('notes', { ...note, text: newText, updatedAt: new Date().toISOString() });
      showToast('筆記已更新');
      await renderPersonalNotes(container, bookId, { onQuoteAdded });
    });
  });

  // 編輯欄位快捷鍵跟上面「新增筆記」的主輸入框同一套習慣：Cmd/Ctrl+Enter
  // 直接送出儲存，額外加 Esc 取消編輯（純粹方便，不用另外去點小小的取消
  // 按鈕），只在編輯狀態的 textarea 上生效。
  const editTextareaEl = container.querySelector('.output-edit-textarea');
  if (editTextareaEl) {
    editTextareaEl.focus();
    editTextareaEl.setSelectionRange(editTextareaEl.value.length, editTextareaEl.value.length);
    editTextareaEl.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        container.querySelector('.output-save-edit').click();
      } else if (event.key === 'Escape') {
        container.querySelector('.output-cancel-edit').click();
      }
    });
  }

  // 日期只有舊 outputs 心得項目才有（見 renderLegacyReflectionItem），
  // 沿用它原本存在 outputs 表的行為，改了直接寫回 outputs，不動 notes。
  container.querySelectorAll('.output-date-input').forEach((input) => {
    input.addEventListener('change', async () => {
      const id = Number(input.dataset.id);
      const item = reflections.find((r) => r.id === id);
      if (!item) return;
      await DB.update('outputs', { ...item, date: input.value });
    });
  });

  // 選取已儲存的筆記／心得文字時跳出懸浮工具列（高亮／朗讀／複製），沿用
  // outputs.js 原本「閱讀後輸出」就有的功能——合併後 notes 來源的內容也
  // 一併擁有這個能力，不是只有舊心得才能劃線存成佳句。「高亮」在這裡的
  // 意思是把選到的句子存成一句新的佳句摘錄，沿用 quotes.js 既有的資料結構，
  // 不是畫面上疊一層存不下來的顏色。
  const outputListEl = container.querySelector('.output-list');
  attachSelectionToolbar(outputListEl, {
    onHighlight: async (selectedText) => {
      await DB.add('quotes', { bookId, content: selectedText });
      showToast('已加入佳句摘錄');
      // 存完立刻讓「佳句摘錄」分頁的數量／列表同步更新，不用使用者自己重新
      // 整理整頁才看得到剛剛存的這句——見 bookDetail.js 的 refreshQuotesTab() 說明。
      await onQuoteAdded?.();
    },
  });
}
