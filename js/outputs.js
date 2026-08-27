import { DB } from './db.js';
import { escapeHtml, applyHashtagLinks } from './utils.js';

// 對照 PROJECT_SPEC.md 第 4 節：低壓力、選填，不要求填完。
// 閱讀動機一本書只有一筆（存在就更新）；閱讀後輸出可以隨閱讀過程累積多筆。
export const MOTIVATION_TAGS = ['好奇', '解決問題', '工作需要', '自我成長', '主題學習', '別人推薦', '文案吸引', '隨意閱讀', '其他'];
const REFLECTION_TAGS = ['發現', '思考', '疑問', '認同', '不認同', '聯想到其他事情', '改變了某個看法', '一般心得'];

async function getOutputsByKind(bookId, kind) {
  const all = await DB.getByIndex('outputs', 'bookId', bookId);
  return all.filter((o) => o.kind === kind);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// 閱讀後輸出的日期預設帶入書籍的完成日期（沒有就用今天），使用者仍可自己改。
async function getDefaultReflectionDate(bookId) {
  const records = await DB.getByIndex('reading_records', 'bookId', bookId);
  records.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  const latest = records[0];
  return (latest && latest.endDate) || todayIso();
}

function tagCheckboxes(name, options, selected) {
  const selectedList = selected || [];
  return options.map((tag) => `
    <label>
      <input type="checkbox" name="${name}" value="${escapeHtml(tag)}" ${selectedList.includes(tag) ? 'checked' : ''}>
      ${escapeHtml(tag)}
    </label>
  `).join('');
}

function readTags(form, name) {
  return Array.from(form.querySelectorAll(`input[name="${name}"]:checked`)).map((el) => el.value);
}

// 心得輸入框改成所見即所得（contenteditable + execCommand）：點粗體/斜體/標題，
// 選取的文字當場變粗變斜變大，不會再看到 **這種原始碼符號**。
// 「螢光標記」execCommand 沒有對應的語意標籤指令，用 Selection/Range API 手動包一層 <mark>。
const WYSIWYG_TOOLS = [
  { key: 'bold', label: 'B', title: '粗體' },
  { key: 'italic', label: 'I', title: '斜體' },
  { key: 'heading', label: 'H', title: '標題' },
  { key: 'list', label: '•', title: '條列點' },
  { key: 'mark', label: '〰', title: '螢光標記（需先選取文字）' },
  { key: 'clear', label: '⌫', title: '清除格式，還原為預設黑字' },
];

function mdToolbarHtml() {
  return `
    <div class="md-toolbar">
      ${WYSIWYG_TOOLS.map((t) => `<button type="button" class="md-tool-btn" data-cmd="${t.key}" title="${escapeHtml(t.title)}">${escapeHtml(t.label)}</button>`).join('')}
    </div>
  `;
}

// 螢光標記一定要選到文字才有意義——execCommand 沒有這個語意標籤，
// 用 Range.surroundContents 手動包一層 <mark>；選取範圍剛好切在元素邊界中間時
// surroundContents 會丟例外，退而求其次用 extractContents 重新包裝。
function wrapSelectionWithMark(editor) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  if (range.collapsed || !editor.contains(range.commonAncestorContainer)) return;
  const mark = document.createElement('mark');
  try {
    range.surroundContents(mark);
  } catch {
    mark.appendChild(range.extractContents());
    range.insertNode(mark);
  }
  selection.removeAllRanges();
  const newRange = document.createRange();
  newRange.selectNodeContents(mark);
  selection.addRange(newRange);
}

// 「清除格式」刻意清整個編輯區塊而不是只清選取範圍：這是單人筆記工具，使用者按這顆按鈕
// 的意圖通常是「這段亂了，整個重來」，比起實作精確到選取範圍邊界的巢狀標籤拆解（容易漏邊界），
// 全區塊重置的行為更好預期、也更不會留下清一半的中間狀態。
// execCommand('removeFormat') 處理得掉 bold/italic/heading，但處理不掉手動插入的 <mark>，
// 也可能因為使用者從別處貼上內容而殘留 style/class，所以還要手動掃一次全部攤平掉。
function clearFormatting(editor) {
  editor.focus();
  document.execCommand('selectAll');
  document.execCommand('removeFormat');
  document.execCommand('formatBlock', false, 'p');
  editor.querySelectorAll('mark').forEach((el) => el.replaceWith(document.createTextNode(el.textContent)));
  editor.querySelectorAll('[style], [class]').forEach((el) => {
    el.removeAttribute('style');
    el.removeAttribute('class');
  });
  editor.normalize();
}

function applyWysiwygCommand(editor, cmd) {
  editor.focus();
  if (cmd === 'bold') { document.execCommand('bold'); return; }
  if (cmd === 'italic') { document.execCommand('italic'); return; }
  if (cmd === 'list') { document.execCommand('insertUnorderedList'); return; }
  if (cmd === 'heading') {
    const isHeading = document.queryCommandValue('formatBlock').toLowerCase() === 'h2';
    document.execCommand('formatBlock', false, isHeading ? 'p' : 'h2');
    return;
  }
  if (cmd === 'mark') { wrapSelectionWithMark(editor); return; }
  if (cmd === 'clear') { clearFormatting(editor); return; }
}

// 貼上內容、或瀏覽器產生的格式標籤五花八門（<b>/<i>/<span style>/<font>…），
// 存進資料庫前一律過白名單：只留語意標籤本身（不留任何屬性，沒有 style／class 污染的空間），
// 其餘標籤攤平成純文字內容（不整段丟掉），從根本避免樣式污染，也避免存進去任何可執行的 HTML。
const ALLOWED_REFLECTION_TAGS = new Set(['STRONG', 'EM', 'H2', 'H3', 'UL', 'OL', 'LI', 'MARK', 'P']);

function appendSanitizedChildren(sourceParent, targetParent) {
  sourceParent.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      targetParent.appendChild(document.createTextNode(child.textContent));
      return;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) return;
    if (child.tagName === 'BR') { targetParent.appendChild(document.createElement('br')); return; }
    let tagName = child.tagName;
    if (tagName === 'B') tagName = 'STRONG';
    if (tagName === 'I') tagName = 'EM';
    if (tagName === 'DIV') tagName = 'P';
    if (!ALLOWED_REFLECTION_TAGS.has(tagName)) {
      appendSanitizedChildren(child, targetParent);
      return;
    }
    const el = document.createElement(tagName.toLowerCase());
    appendSanitizedChildren(child, el);
    targetParent.appendChild(el);
  });
}

function sanitizeReflectionHtml(rawHtml) {
  const source = document.createElement('div');
  source.innerHTML = rawHtml;
  const output = document.createElement('div');
  appendSanitizedChildren(source, output);
  return output.innerHTML;
}

// 顯示階段才把 #標籤 轉成連結，不是編輯階段——編輯中的 contenteditable 如果把 #心理學
// 變成可點的 <a>，使用者打字打到一半點錯就整頁跳走，體驗很差，所以純文字保留到儲存後才轉換。
// 只走文字節點（TreeWalker 只吃 SHOW_TEXT），不會誤動到已經是 <strong>/<mark> 等標籤本身。
const REFLECTION_HASHTAG_PATTERN = /#([\p{L}\p{N}_]+)/gu;

function linkifyHashtagsInFragment(container) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  let node = walker.nextNode();
  while (node) { textNodes.push(node); node = walker.nextNode(); }

  for (const textNode of textNodes) {
    const text = textNode.textContent;
    const matches = [...text.matchAll(REFLECTION_HASHTAG_PATTERN)];
    if (matches.length === 0) continue;
    const frag = document.createDocumentFragment();
    let cursor = 0;
    for (const match of matches) {
      frag.appendChild(document.createTextNode(text.slice(cursor, match.index)));
      const a = document.createElement('a');
      a.className = 'hashtag-chip';
      a.href = `#/tags/${encodeURIComponent(match[1])}`;
      a.textContent = match[0];
      frag.appendChild(a);
      cursor = match.index + match[0].length;
    }
    frag.appendChild(document.createTextNode(text.slice(cursor)));
    textNode.replaceWith(frag);
  }
}

// 新格式（WYSIWYG 存下來的已清理過 HTML）的顯示邏輯：重新插入 DOM、補上 #標籤連結即可，
// 不用像舊格式那樣逐行解析 Markdown 語法。
function renderStoredReflectionHtml(sanitizedHtml) {
  const container = document.createElement('div');
  container.innerHTML = sanitizedHtml;
  linkifyHashtagsInFragment(container);
  return container.innerHTML;
}

// 舊格式相容：這個工具列改版之前，心得是存成一段帶 **粗體**／## 標題／- 條列／<mark> 語法的
// 純文字，不是真的 HTML。既有資料不重新遷移，靠 item.format 分辨兩種格式（見 reflectionItem），
// 這個函式只負責繼續把「舊資料」轉成排版效果，新增的心得一律走 WYSIWYG／HTML 那條路徑。
function renderReflectionMarkdown(rawText) {
  let html = applyHashtagLinks(escapeHtml(rawText));
  html = html.replace(/&lt;mark&gt;([\s\S]+?)&lt;\/mark&gt;/g, '<mark>$1</mark>');
  html = html.replace(/\*\*([^\n]+?)\*\*/g, '<strong>$1</strong>');

  const parts = [];
  let listBuffer = [];
  const flushList = () => {
    if (listBuffer.length > 0) {
      parts.push(`<ul class="reflection-list">${listBuffer.map((li) => `<li>${li}</li>`).join('')}</ul>`);
      listBuffer = [];
    }
  };

  for (const line of html.split('\n')) {
    const heading = line.match(/^##\s+(.+)$/);
    const listItem = line.match(/^-\s+(.+)$/);
    if (heading) {
      flushList();
      parts.push(`<h4 class="reflection-heading">${heading[1]}</h4>`);
    } else if (listItem) {
      listBuffer.push(listItem[1]);
    } else {
      flushList();
      if (line.trim()) parts.push(`<p class="reflection-line">${line}</p>`);
    }
  }
  flushList();

  return parts.join('');
}

export async function renderMotivation(container, bookId) {
  const existing = (await getOutputsByKind(bookId, 'motivation'))[0] || null;

  container.innerHTML = `
    <h4 class="section-heading">💡 閱讀動機</h4>
    <form id="motivation-form" class="book-form">
      <label>可以選擇（可複選）
        <span class="tag-checkboxes motivation-tags">${tagCheckboxes('motivationTags', MOTIVATION_TAGS, existing && existing.tags)}</span>
      </label>
      <label>我為什麼想看這本書？
        <textarea name="text" rows="2">${escapeHtml(existing && existing.text)}</textarea>
      </label>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">儲存</button>
      </div>
    </form>
  `;

  const form = container.querySelector('#motivation-form');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = {
      bookId,
      kind: 'motivation',
      tags: readTags(form, 'motivationTags'),
      text: form.elements.text.value.trim(),
    };
    if (existing) {
      await DB.update('outputs', { ...existing, ...payload, id: existing.id });
    } else {
      await DB.add('outputs', payload);
    }
    await renderMotivation(container, bookId);
  });
}

function reflectionItem(item) {
  const dateValue = item.date || (item.createdAt || '').slice(0, 10);
  return `
    <div class="output-item" data-id="${item.id}">
      <button type="button" class="btn btn-danger output-delete" data-id="${item.id}">刪除</button>
      ${item.tags && item.tags.length ? `<div class="output-tags">${item.tags.map((t) => `<span class="output-tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
      ${item.text ? `<div class="reflection-body">${item.format === 'html' ? renderStoredReflectionHtml(item.text) : renderReflectionMarkdown(item.text)}</div>` : ''}
      <input type="date" class="output-date-input" data-id="${item.id}" value="${escapeHtml(dateValue)}">
    </div>
  `;
}

export async function renderReflections(container, bookId) {
  const items = await getOutputsByKind(bookId, 'reflection');
  items.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

  container.innerHTML = `
    <h4 class="section-heading">✍️ 閱讀後輸出</h4>
    <form id="reflection-form" class="book-form">
      <label>可以自由選擇（可複選，不用填完）
        <span class="tag-checkboxes">${tagCheckboxes('reflectionTags', REFLECTION_TAGS)}</span>
      </label>
      <label>想寫點什麼都可以
        ${mdToolbarHtml()}
        <div class="reflection-editor is-empty" id="reflection-editor" contenteditable="true" data-placeholder="寫下你的心得...（提示：輸入 #心理學 或 #榮格 可建立主題標籤）"></div>
      </label>
      <p class="hashtag-hint">💡 提示：內文中輸入 #標籤名稱（例如 #心理學），系統將自動分類並串聯相關書籍內容。</p>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">新增</button>
      </div>
    </form>
    <div class="output-list">
      ${items.length === 0 ? '<p class="empty">還沒有任何輸出。</p>' : items.map(reflectionItem).join('')}
    </div>
  `;

  const form = container.querySelector('#reflection-form');
  const editor = container.querySelector('#reflection-editor');

  // contenteditable 不是表單控制項，不會出現在 FormData／form.elements 裡，
  // 工具列按鈕跟送出邏輯都要直接操作這個 DOM 節點本身。
  form.querySelectorAll('.md-tool-btn').forEach((btn) => {
    // 按鈕預設的 mousedown 會把焦點從編輯區搶走，連帶清掉目前的選取範圍——
    // 先攔掉 mousedown 讓焦點留在編輯區上，執行的指令才會真的套用到使用者選取的文字。
    btn.addEventListener('mousedown', (event) => event.preventDefault());
    btn.addEventListener('click', () => applyWysiwygCommand(editor, btn.dataset.cmd));
  });
  editor.addEventListener('input', () => {
    editor.classList.toggle('is-empty', editor.textContent.trim() === '');
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const tags = readTags(form, 'reflectionTags');
    const html = sanitizeReflectionHtml(editor.innerHTML);
    const plainText = editor.textContent.trim();
    if (tags.length === 0 && !plainText) return;
    // 不再讓使用者每次都挑日期，統一沿用「閱讀進度」設定的完成日期（沒完成就是今天）。
    // 這裡要在送出當下重新查一次，不能用渲染當下就算好的 defaultDate——
    // 現在進度模組跟這個表單同一個頁籤，使用者很可能剛改完日期就馬上寫心得。
    const date = await getDefaultReflectionDate(bookId);
    await DB.add('outputs', { bookId, kind: 'reflection', tags, text: plainText ? html : '', format: 'html', date });
    await renderReflections(container, bookId);
  });

  container.querySelectorAll('.output-delete').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await DB.remove('outputs', Number(btn.dataset.id));
      await renderReflections(container, bookId);
    });
  });

  container.querySelectorAll('.output-date-input').forEach((input) => {
    input.addEventListener('change', async () => {
      const id = Number(input.dataset.id);
      const item = items.find((i) => i.id === id);
      if (!item) return;
      await DB.update('outputs', { ...item, date: input.value });
    });
  });
}
