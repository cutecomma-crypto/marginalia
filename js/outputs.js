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
  { key: 'bold', label: 'B', title: '粗體 (Bold)' },
  { key: 'italic', label: 'I', title: '斜體 (Italic)' },
  { key: 'heading', label: 'H', title: '標題 (Heading)' },
  { key: 'list', label: '•', title: '項目符號清單 (Bullet List)' },
  { key: 'strike', label: 'S', title: '刪除線 (Strikethrough)' },
  { key: 'mark', label: '〰', title: '螢光標記 (Highlight)' },
  { key: 'clear', label: '⌦', title: '清除格式 (Clear Formatting)' },
];

// 5 色文字顏色色票：都是實心圓點按鈕，點下去對「目前選取的文字」套用 foreColor。
const TEXT_COLOR_PALETTE = [
  { name: '預設黑', hex: '#2C2C2C' },
  { name: '莫蘭迪紅', hex: '#C85A54' },
  { name: '經典藍', hex: '#3B6998' },
  { name: '橄欖綠', hex: '#5A8262' },
  { name: '溫暖棕', hex: '#9E6B43' },
];

// 原生 title 屬性靠瀏覽器/作業系統控制顯示時機，Chrome 大概要 hover 快 1 秒才跳出來，
// 感覺明顯延遲。改用 data-tooltip + CSS ::after（見 styles.css 的 .md-tool-btn::after），
// :hover 觸發是瀏覽器渲染的一部分、沒有額外等待邏輯，滑鼠移上去幾乎當下就顯示。
function mdToolbarHtml() {
  return `
    <div class="md-toolbar">
      ${WYSIWYG_TOOLS.map((t) => `<button type="button" class="md-tool-btn" data-cmd="${t.key}" data-tooltip="${escapeHtml(t.title)}" aria-label="${escapeHtml(t.title)}">${escapeHtml(t.label)}</button>`).join('')}
      <span class="md-toolbar-divider" aria-hidden="true"></span>
      <div class="md-color-group" role="group" aria-label="文字顏色">
        ${TEXT_COLOR_PALETTE.map((c) => `<button type="button" class="md-color-btn" data-color="${c.hex}" style="background:${c.hex};" data-tooltip="文字顏色：${escapeHtml(c.name)}" aria-label="文字顏色：${escapeHtml(c.name)}"></button>`).join('')}
      </div>
    </div>
  `;
}

// --- 選取範圍的保存／還原 ---
// 根本問題：工具列按鈕是 <button>，點下去中間會經過 mousedown → mouseup → click 好幾個事件，
// 瀏覽器原生行為是「點到可聚焦元素以外的地方就把目前的選取範圍砍掉」。光是 mousedown 時
// preventDefault 讓焦點留在編輯區「通常」夠用，但沒辦法涵蓋所有瀏覽器/時機的差異，
// 保險做法是在 mousedown 當下就把使用者選好的 Range 明確存起來，click 真的要套用格式的
// 那一刻再強制還原成同一個 Range，這樣執行的 execCommand 保證作用在「使用者原本選的那段字」，
// 不會因為中間任何一個事件把選取範圍改掉、擴大甚至清空而套用到不該套用的範圍。
let savedRange = null;

function saveSelectionIfInsideEditor(editor) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  if (editor.contains(range.commonAncestorContainer)) {
    savedRange = range.cloneRange();
  }
}

function restoreSelection(editor) {
  if (!savedRange || !editor.contains(savedRange.commonAncestorContainer)) return;
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(savedRange);
}

// 螢光標記改用原生 execCommand（跟粗體/斜體同一套機制，行為更可靠、不用自己處理
// Range.surroundContents 在選取範圍切到元素邊界中間時會丟例外的邊界情況）。
// hiliteColor 才是語意正確的指令，但 Safari 一路以來都不支援，backColor 是所有主流
// 瀏覽器都認得的備援指令。存進資料庫前，sanitizeReflectionHtml 會把這個顏色收斂回
// 語意化的 <mark> 標籤（不留 inline style），畫面上的顯示樣式跟舊資料共用同一套規則。
const HIGHLIGHT_COLOR = '#FFF200';

function applyHighlight() {
  const supportsHiliteColor = document.queryCommandSupported && document.queryCommandSupported('hiliteColor');
  document.execCommand(supportsHiliteColor ? 'hiliteColor' : 'backColor', false, HIGHLIGHT_COLOR);
}

// 「清除格式」嚴格限定在使用者目前選取的範圍內：execCommand('removeFormat') 本來就只
// 作用在選取範圍，天生符合這個需求；它唯一處理不到的是手動插入的 <mark>（不是 execCommand
// 產生的標籤，removeFormat 不認得），所以另外只掃「跟這次選取範圍有交集」的 <mark> 元素攤平，
// 選取範圍以外的 <mark> 完全不會被動到。
function clearFormatting(editor) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) return;
  document.execCommand('removeFormat');
  const scopeRoot = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
    ? range.commonAncestorContainer
    : range.commonAncestorContainer.parentElement;
  if (scopeRoot && scopeRoot.querySelectorAll) {
    scopeRoot.querySelectorAll('mark').forEach((el) => {
      if (range.intersectsNode(el)) el.replaceWith(document.createTextNode(el.textContent));
    });
  }
  editor.normalize();
}

function applyWysiwygCommand(editor, cmd) {
  if (cmd === 'bold') { document.execCommand('bold'); return; }
  if (cmd === 'italic') { document.execCommand('italic'); return; }
  if (cmd === 'list') { document.execCommand('insertUnorderedList'); return; }
  if (cmd === 'strike') { document.execCommand('strikeThrough'); return; }
  if (cmd === 'heading') {
    const isHeading = document.queryCommandValue('formatBlock').toLowerCase() === 'h2';
    document.execCommand('formatBlock', false, isHeading ? 'p' : 'h2');
    return;
  }
  if (cmd === 'mark') { applyHighlight(); return; }
  if (cmd === 'clear') { clearFormatting(editor); return; }
}

// 貼上內容、或瀏覽器產生的格式標籤五花八門（<b>/<i>/<span style>/<font>…），
// 存進資料庫前一律過白名單：只留語意標籤本身（不留任何屬性，沒有 style／class 污染的空間），
// 其餘標籤攤平成純文字內容（不整段丟掉），從根本避免樣式污染，也避免存進去任何可執行的 HTML。
const ALLOWED_REFLECTION_TAGS = new Set(['STRONG', 'EM', 'S', 'H2', 'H3', 'UL', 'OL', 'LI', 'MARK', 'P']);
// 文字顏色是唯一允許保留的「屬性」，而且刻意收得極窄：只認得跟色票完全相同的 6 碼色碼字串，
// 不是把使用者／瀏覽器貼過來的任意色碼原樣收下——顏色值永遠來自這個常數本身，不會有 CSS 注入的空間。
const ALLOWED_TEXT_COLORS = new Set(TEXT_COLOR_PALETTE.map((c) => c.hex.toLowerCase()));

function rgbStringToHex(rgbStr) {
  const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/i.exec(rgbStr || '');
  if (!m) return null;
  return `#${[1, 2, 3].map((i) => Number(m[i]).toString(16).padStart(2, '0')).join('')}`;
}

// execCommand('foreColor') 預設（styleWithCSS 關閉）在多數瀏覽器會插入 <font color="#hex">，
// 但保險起見 <span style="color:..."> 這個常見的替代形式也一併認得（值可能是 rgb(...) 格式）。
function extractElementColor(el) {
  if (el.tagName === 'FONT') {
    const raw = (el.getAttribute('color') || '').toLowerCase();
    return raw.startsWith('#') ? raw : null;
  }
  if (el.style && el.style.color) {
    return rgbStringToHex(el.style.color);
  }
  return null;
}

function appendSanitizedChildren(sourceParent, targetParent) {
  sourceParent.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      targetParent.appendChild(document.createTextNode(child.textContent));
      return;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) return;
    if (child.tagName === 'BR') { targetParent.appendChild(document.createElement('br')); return; }

    if (child.tagName === 'FONT' || child.tagName === 'SPAN') {
      const bgColor = child.style && child.style.backgroundColor ? rgbStringToHex(child.style.backgroundColor) : null;
      if (bgColor === HIGHLIGHT_COLOR.toLowerCase()) {
        // execCommand('hiliteColor'/'backColor') 產生的螢光標記背景色，收斂回語意化的
        // <mark>（不留 inline style），跟既有的顯示樣式與舊資料共用同一套渲染規則。
        const mark = document.createElement('mark');
        appendSanitizedChildren(child, mark);
        targetParent.appendChild(mark);
        return;
      }
      const color = extractElementColor(child);
      if (color && ALLOWED_TEXT_COLORS.has(color)) {
        const span = document.createElement('span');
        span.style.color = color;
        appendSanitizedChildren(child, span);
        targetParent.appendChild(span);
      } else {
        // 顏色不在白名單內（例如貼上內容夾帶的任意色碼），攤平成純文字，不留下顏色也不留任何屬性。
        appendSanitizedChildren(child, targetParent);
      }
      return;
    }

    let tagName = child.tagName;
    if (tagName === 'B') tagName = 'STRONG';
    if (tagName === 'I') tagName = 'EM';
    if (tagName === 'STRIKE' || tagName === 'DEL') tagName = 'S';
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
  // 把段落轉成清單時，瀏覽器原本產生的是不合法巢狀 <p><ul>…</ul></p>；重新解析成字串
  // 再讀回 DOM 那一步，瀏覽器的 HTML parser 會依規範自動把 <p> 提前關閉，多切出幾個完全
  // 空白（連 <br> 都沒有）的 <p></p>，變成畫面上莫名其妙的空行。這裡只清掉「真的完全沒有
  // 任何子節點」的段落——使用者自己按 Enter 留的空行一定會帶著 <br> 撐高度，不會被誤刪。
  output.querySelectorAll('p').forEach((p) => {
    if (p.childNodes.length === 0) p.remove();
  });
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
      <div class="reflection-input-group">
        ${mdToolbarHtml()}
        <div class="reflection-editor is-empty" id="reflection-editor" contenteditable="true" data-placeholder="寫下你的心得..."><p><br></p></div>
      </div>
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

  // Enter 換行統一用 <p>（不是 Chrome 預設的 <div>），讓每一行文字都活在一個明確的區塊裡——
  // 這是修掉「點條列／標題會整個輸入框都套用」的關鍵：execCommand 的 formatBlock／
  // insertUnorderedList 是靠「離選取範圍最近的區塊元素」決定作用範圍，如果編輯區裡的文字
  // 一開始就沒有任何區塊包住（直接是 contenteditable 根節點底下的純文字節點），
  // 瀏覽器找不到更小的區塊邊界，「最近的區塊」就會是整個編輯區本身，於是格式套用到全部內容。
  // 上面模板已經把初始內容包成 <p><br></p>，這裡再確保之後每次按 Enter 建立的新行也是 <p>。
  document.execCommand('defaultParagraphSeparator', false, 'p');

  // contenteditable 不是表單控制項，不會出現在 FormData／form.elements 裡，
  // 工具列按鈕跟送出邏輯都要直接操作這個 DOM 節點本身。
  function wireToolbarButton(btn, run) {
    // 按鈕預設的 mousedown 會把焦點從編輯區搶走、連帶清掉選取範圍——先攔掉 mousedown，
    // 並在那個當下就把使用者選好的 Range 存起來；click 真正執行指令前再強制還原同一個 Range，
    // 保證兩次事件之間不管發生什麼，套用格式的對象永遠是使用者實際選取的那段文字，不多不少。
    btn.addEventListener('mousedown', (event) => {
      event.preventDefault();
      saveSelectionIfInsideEditor(editor);
    });
    btn.addEventListener('click', () => {
      editor.focus();
      restoreSelection(editor);
      run();
    });
  }

  form.querySelectorAll('.md-tool-btn').forEach((btn) => {
    wireToolbarButton(btn, () => applyWysiwygCommand(editor, btn.dataset.cmd));
  });
  form.querySelectorAll('.md-color-btn').forEach((btn) => {
    wireToolbarButton(btn, () => document.execCommand('foreColor', false, btn.dataset.color));
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
