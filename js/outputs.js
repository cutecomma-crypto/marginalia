import { DB } from './db.js';
import { escapeHtml, applyHashtagLinks, renderTagChip, renderTextWithHashtags } from './utils.js';

// 對照 PROJECT_SPEC.md 第 4 節：低壓力、選填，不要求填完。
// 仍然匯出給 bookForm.js 新增書籍表單裡的「閱讀動機（可複選，選填）」欄位
// 使用——那是「新增書籍當下」順手記錄的入口，跟這次「書籍詳情頁分頁」的
// 整併是兩件事，不受這次調整影響（見下面 renderLegacyMotivationItem 的說明）。
export const MOTIVATION_TAGS = ['好奇', '解決問題', '工作需要', '自我成長', '主題學習', '別人推薦', '文案吸引', '隨意閱讀', '其他'];

// 「功能簡化」精簡：書籍詳情頁原本「閱讀動機」「閱讀後輸出」「快速筆記」
// 三個各自獨立的分頁／表單，已經全部合併成 notes.js 的「閱讀心得」
// 單一乾淨文字輸入區塊，新增內容一律走 notes.js（存進 notes 表），這裡
// 不再提供任何新增用的表單。保留在這個檔案的只剩匯出給 notes.js 合併清單
// 重用的舊資料渲染函式——既有的 kind='reflection'／kind='motivation' 輸出
// 資料不遷移、不砍掉，繼續留在 outputs 表，只是不再是使用者「新增」內容
// 的入口，合併清單裡用唯讀卡片顯示。原本這裡一大段所見即所得工具列／
// HTML 清理／Markdown 相容解析／動機表單的程式碼都是這幾個分頁專屬的，
// 新增入口拿掉後全部變成用不到的死碼，一併刪除（不是留著沒呼叫的殘骸）。
export async function getOutputsByKind(bookId, kind) {
  const all = await DB.getByIndex('outputs', 'bookId', bookId);
  return all.filter((o) => o.kind === kind);
}

// 「唯讀展示」版的動機標籤——跟 bookForm.js 新增書籍表單裡可勾選的版本共用
// 同一個 .motivation-tag class（見 css/styles.css 的說明），純粹是沒有
// <input> 的 <span>，給下面 renderLegacyMotivationItem() 這種「只是要顯示
// 這本書選過哪些動機、不能互動」的場合用，不要再套用 utils.js 的
// renderTagChip()（那組是給書籍/心得的「自由文字標籤」用的高彩度粉/橘/黃
// 三色階，跟這裡的莫蘭迪配色是兩回事）。
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

// 「閱讀心得」合併清單裡，屬於舊 outputs／kind='reflection' 資料的那些
// 項目沿用這個渲染邏輯（標籤 chip、HTML／Markdown 相容內文、可調整的日期
// 欄位）——這幾樣是舊資料才有的欄位，合併後新增的筆記（notes.js）不會再有，
// 所以呼叫端（notes.js 的 renderPersonalNotes）需要分別判斷一筆資料是從哪個
// 表、哪個 kind 來的，對應分別呼叫 notes.js 自己的 noteItem()、這裡的這個
// 函式、或下面的 renderLegacyMotivationItem。data-source="outputs"：merged
// 清單的刪除/日期變更事件委派需要知道該對哪張表下 DB 操作，跟 notes.js 自己
// 的項目共用同一批 .output-delete／.output-date-input class，只靠這個屬性
// 分流，不是新增一整套平行邏輯。
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

// 合併清單裡，屬於舊 outputs／kind='motivation' 資料的項目——「閱讀動機」
// 分頁跟它自己的表單已經整個拿掉（見這個檔案開頭的說明），既有資料改用
// 這個唯讀卡片顯示：動機標籤（若有）＋文字內容，跟 noteItem() 一樣支援
// #標籤連結，但沒有行內編輯（舊資料本來就沒有這個功能，維持一致，不
// 為了這次合併另外新增）。只有刪除，沒有日期欄位——動機記錄本來就沒有
// 「日期」的概念，跟心得（reflection）不同。
export function renderLegacyMotivationItem(item) {
  return `
    <div class="output-item" data-id="${item.id}" data-source="outputs">
      <button type="button" class="btn btn-danger output-delete" data-id="${item.id}" data-source="outputs">刪除</button>
      ${item.tags && item.tags.length ? `<div class="output-tags">${item.tags.map((t) => renderMotivationTagChip(t)).join('')}</div>` : ''}
      ${item.text ? `<p>${renderTextWithHashtags(item.text)}</p>` : ''}
      <div class="output-date">${escapeHtml((item.createdAt || '').slice(0, 10))}</div>
    </div>
  `;
}
