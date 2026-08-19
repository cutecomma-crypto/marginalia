import { DB } from './db.js';
import { escapeHtml, renderTextWithHashtags } from './utils.js';

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
      ${item.text ? `<p>${renderTextWithHashtags(item.text)}</p>` : ''}
      <input type="date" class="output-date-input" data-id="${item.id}" value="${escapeHtml(dateValue)}">
    </div>
  `;
}

export async function renderReflections(container, bookId) {
  const items = await getOutputsByKind(bookId, 'reflection');
  items.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  const defaultDate = await getDefaultReflectionDate(bookId);

  container.innerHTML = `
    <h4 class="section-heading">✍️ 閱讀後輸出</h4>
    <form id="reflection-form" class="book-form">
      <label>日期
        <input type="date" name="date" value="${escapeHtml(defaultDate)}">
      </label>
      <label>可以自由選擇（可複選，不用填完）
        <span class="tag-checkboxes">${tagCheckboxes('reflectionTags', REFLECTION_TAGS)}</span>
      </label>
      <label>想寫點什麼都可以
        <textarea name="text" rows="2"></textarea>
      </label>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">新增</button>
      </div>
    </form>
    <div class="output-list">
      ${items.length === 0 ? '<p class="empty">還沒有任何輸出。</p>' : items.map(reflectionItem).join('')}
    </div>
  `;

  const form = container.querySelector('#reflection-form');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const tags = readTags(form, 'reflectionTags');
    const text = form.elements.text.value.trim();
    if (tags.length === 0 && !text) return;
    const date = form.elements.date.value || todayIso();
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
