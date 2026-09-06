import { DB } from './db.js';
import { escapeHtml, applyHashtagLinks, renderTagChip } from './utils.js';
import { ICON_LIGHTBULB } from './icons.js';

// 對照 PROJECT_SPEC.md 第 4 節：低壓力、選填，不要求填完。
export const MOTIVATION_TAGS = ['好奇', '解決問題', '工作需要', '自我成長', '主題學習', '別人推薦', '文案吸引', '隨意閱讀', '其他'];

// 「UI 極簡化」精簡：「閱讀後輸出」（原本這裡的所見即所得工具列＋心得標籤）
// 已經跟「快速筆記」合併成 notes.js 的「個人筆記」單一乾淨文字輸入區塊，
// 新增內容一律走 notes.js（存進 notes 表），這裡不再提供新增輸出的表單。
// 保留在這個檔案的只剩：(1) 匯出給 notes.js 合併清單重用的舊資料渲染函式
// （既有的 kind='reflection' 輸出資料不遷移、不砍掉，繼續留在 outputs 表，
// 只是不再是使用者「新增」內容的入口）；(2) 完全獨立、跟這次合併無關的
// 「閱讀動機」表單。原本這裡一大段所見即所得工具列／HTML 清理／Markdown
// 相容解析的程式碼都是「閱讀後輸出」新增表單專屬的，新增入口拿掉後全部
// 變成用不到的死碼，一併刪除（不是留著沒呼叫的殘骸）。
export async function getOutputsByKind(bookId, kind) {
  const all = await DB.getByIndex('outputs', 'bookId', bookId);
  return all.filter((o) => o.kind === kind);
}

// labelClass：只有閱讀動機會傳，套用全站共用的 .motivation-tag 樣式元件
// （見 css/styles.css 同名規則的說明）；閱讀後輸出的心得標籤不屬於「動機
// 標籤」，呼叫端不傳這個參數，維持原本 .tag-checkboxes 的通用膠囊樣式。
function tagCheckboxes(name, options, selected, labelClass) {
  const selectedList = selected || [];
  return options.map((tag) => `
    <label${labelClass ? ` class="${labelClass}"` : ''}>
      <input type="checkbox" name="${name}" value="${escapeHtml(tag)}" ${selectedList.includes(tag) ? 'checked' : ''}>
      ${escapeHtml(tag)}
    </label>
  `).join('');
}

function readTags(form, name) {
  return Array.from(form.querySelectorAll(`input[name="${name}"]:checked`)).map((el) => el.value);
}

// 「唯讀展示」版的動機標籤——跟上面 tagCheckboxes() 產生的可勾選版本共用
// 同一個 .motivation-tag class（見 css/styles.css 的說明），純粹是沒有
// <input> 的 <span>，給 home.js 的「最近輸出」清單這種「只是要顯示這本書
// 選過哪些動機、不能互動」的場合用，不要再套用 utils.js 的 renderTagChip()
// （那組是給書籍/心得的「自由文字標籤」用的高彩度粉/橘/黃三色階，跟這裡
// 的莫蘭迪配色是兩回事）。
export function renderMotivationTagChip(tag) {
  return `<span class="motivation-tag">${escapeHtml(tag)}</span>`;
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

// 舊格式相容：這個工具列改版之前（更早的版本，比這次「閱讀後輸出／快速筆記合併」
// 更早一輪），心得是存成一段帶 **粗體**／## 標題／- 條列／<mark> 語法的純文字，
// 不是真的 HTML。既有資料不重新遷移，靠 item.format 分辨兩種格式（見下面
// renderLegacyReflectionItem），這個函式只負責繼續把「舊資料」轉成排版效果。
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
    <h4 class="section-heading icon-heading">${ICON_LIGHTBULB}閱讀動機</h4>
    <form id="motivation-form" class="book-form">
      <label>可以選擇（可複選）
        <span class="tag-checkboxes motivation-tags">${tagCheckboxes('motivationTags', MOTIVATION_TAGS, existing && existing.tags, 'motivation-tag')}</span>
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

// 「個人筆記」合併清單裡，屬於舊 outputs／kind='reflection' 資料的那些項目
// 沿用這個渲染邏輯（標籤 chip、HTML／Markdown 相容內文、可調整的日期欄位）——
// 這幾樣是舊資料才有的欄位，合併後新增的筆記（notes.js）不會再有，所以呼叫端
// （notes.js 的 renderPersonalNotes）需要分別判斷一筆資料是從哪個表來的，
// 對應資料來源分別呼叫 notes.js 自己的 noteItem() 或這裡匯出的這個函式。
// data-source="outputs"：merged 清單的刪除/日期變更事件委派需要知道該對
// 哪張表下 DB 操作，跟 notes.js 自己的項目共用同一批 .output-delete／
// .output-date-input class，只靠這個屬性分流，不是新增一整套平行邏輯。
export function renderLegacyReflectionItem(item) {
  const dateValue = item.date || (item.createdAt || '').slice(0, 10);
  return `
    <div class="output-item" data-id="${item.id}" data-source="outputs">
      <button type="button" class="btn btn-danger output-delete" data-id="${item.id}" data-source="outputs">刪除</button>
      ${item.tags && item.tags.length ? `<div class="output-tags">${item.tags.map((t) => renderTagChip(t)).join('')}</div>` : ''}
      ${item.text ? `<div class="reflection-body">${item.format === 'html' ? renderStoredReflectionHtml(item.text) : renderReflectionMarkdown(item.text)}</div>` : ''}
      <input type="date" class="output-date-input" data-id="${item.id}" value="${escapeHtml(dateValue)}">
    </div>
  `;
}
