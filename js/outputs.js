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

// 心得輸入框上方的極簡 Markdown 小工具列：粗體／條列／標題／螢光標記各自對應一種語法，
// 有選取文字就包住選取的部分，沒有就插入一段預設文字並選取起來方便直接改寫。
const MD_TOOLS = [
  { key: 'bold', label: 'B', title: '粗體', before: '**', after: '**', placeholder: '粗體文字' },
  { key: 'list', label: '•', title: '條列點', line: '- ', placeholder: '條列項目' },
  { key: 'heading', label: 'H', title: '標題', line: '## ', placeholder: '標題文字' },
  { key: 'mark', label: '〰', title: '螢光標記', before: '<mark>', after: '</mark>', placeholder: '重點文字' },
];

function mdToolbarHtml() {
  return `
    <div class="md-toolbar">
      ${MD_TOOLS.map((t) => `<button type="button" class="md-tool-btn" data-md="${t.key}" title="${escapeHtml(t.title)}">${escapeHtml(t.label)}</button>`).join('')}
    </div>
  `;
}

function insertMarkdown(textarea, key) {
  const tool = MD_TOOLS.find((t) => t.key === key);
  if (!tool) return;
  const { value } = textarea;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selected = value.slice(start, end);

  // 條列／標題是整行語法：直接接在游標所在那一行的最前面，不管游標原本停在行中哪個位置。
  if (tool.line) {
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    textarea.value = value.slice(0, lineStart) + tool.line + value.slice(lineStart);
    textarea.focus();
    textarea.setSelectionRange(start + tool.line.length, end + tool.line.length);
    return;
  }

  // 粗體／螢光標記是包住式語法：有選取文字就包住選取範圍，沒有就插入預設文字並選取起來，
  // 讓使用者可以直接打字覆蓋掉它。
  const content = selected || tool.placeholder;
  textarea.value = value.slice(0, start) + tool.before + content + tool.after + value.slice(end);
  const selectStart = start + tool.before.length;
  textarea.focus();
  textarea.setSelectionRange(selectStart, selectStart + content.length);
}

function wireMdToolbar(form) {
  const textarea = form.elements.text;
  form.querySelectorAll('.md-tool-btn').forEach((btn) => {
    btn.addEventListener('click', () => insertMarkdown(textarea, btn.dataset.md));
  });
}

// 心得列表顯示時，把工具列插入的那幾種語法轉回真的排版（其餘文字維持逐行純文字＋#標籤連結）。
// 順序：先跳脫＋接上 #標籤連結（安全的部分先做完），再處理 <mark>／**粗體**，
// 最後逐行判斷標題／條列／一般段落。<mark> 是在「跳脫過」的字串上找 &lt;mark&gt; 這個固定樣式
// 換回真正的標籤，不是直接放行使用者輸入的任意 HTML，所以不會有 XSS 風險。
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
      ${item.text ? `<div class="reflection-body">${renderReflectionMarkdown(item.text)}</div>` : ''}
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
        <textarea name="text" rows="2" placeholder="寫下你的心得...（提示：輸入 #心理學 或 #榮格 可建立主題標籤）"></textarea>
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
  wireMdToolbar(form);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const tags = readTags(form, 'reflectionTags');
    const text = form.elements.text.value.trim();
    if (tags.length === 0 && !text) return;
    // 不再讓使用者每次都挑日期，統一沿用「閱讀進度」設定的完成日期（沒完成就是今天）。
    // 這裡要在送出當下重新查一次，不能用渲染當下就算好的 defaultDate——
    // 現在進度模組跟這個表單同一個頁籤，使用者很可能剛改完日期就馬上寫心得。
    const date = await getDefaultReflectionDate(bookId);
    await DB.add('outputs', { bookId, kind: 'reflection', tags, text, date });
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
