import { DB } from './db.js';
import { escapeHtml, renderTagChip } from './utils.js';

// 對照 PROJECT_SPEC.md 第 10 節首頁建議區塊。「我的閱讀」數字概覽併進 stats.js 的側邊欄精簡統計，
// 這裡只負責「最近輸出」，放在首頁側邊欄下半部。
// 原本這裡還有一個讀取 edges／nodes 的「最近關聯」預覽區塊，已依需求移除——
// 純粹是這個檔案不再「讀」這兩個 store 來組首頁預覽，關係圖本身的資料邏輯
// （新增／編輯／刪除人物與關係）完全在 graph.js，不受影響。
async function buildRecentOutputs(limit) {
  const [outputs, books] = await Promise.all([DB.getAll('outputs'), DB.getAll('books')]);
  const bookById = new Map(books.map((b) => [b.id, b]));
  return outputs
    .filter((o) => o.text || (o.tags && o.tags.length))
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    .slice(0, limit)
    .map((o) => ({ ...o, book: bookById.get(o.bookId) }));
}

// 閱讀後輸出改版後（見 outputs.js），o.text 對新資料來說存的是已清理過的 HTML
// （例如 "<p>閱讀心得...</p>"），直接 escapeHtml 只會把標籤原封不動印成看得到的文字。
// 這裡先用瀏覽器自己的 HTML 解析拿掉標籤、只留純文字，再摘要成一行短預覽——
// 舊格式（改版前的 markdown 純文字，沒有 format 欄位）本來就不是真的 HTML，
// 不用特別處理，直接當純文字截斷即可。
const OUTPUT_PREVIEW_LENGTH = 80;

function stripHtmlTags(html) {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.textContent || '';
}

function buildOutputPreview(item) {
  const raw = item.format === 'html' ? stripHtmlTags(item.text) : (item.text || '');
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  if (!collapsed) return '';
  if (collapsed.length <= OUTPUT_PREVIEW_LENGTH) return collapsed;
  return `${collapsed.slice(0, OUTPUT_PREVIEW_LENGTH)}…`;
}

function outputItemHtml(o) {
  const title = o.book ? escapeHtml(o.book.title || '（未命名）') : '（書籍已刪除）';
  const tags = o.tags && o.tags.length
    ? `<div class="output-tags">${o.tags.map((t) => renderTagChip(t)).join('')}</div>`
    : '';
  const preview = buildOutputPreview(o);
  const text = preview ? `<p class="home-list-text">${escapeHtml(preview)}</p>` : '';
  return `
    <li>
      <div class="home-list-title">${o.book ? `<a href="#/books/${o.bookId}">${title}</a>` : title}</div>
      ${tags}
      ${text}
    </li>
  `;
}

export async function renderRecentActivity(container) {
  const outputs = await buildRecentOutputs(5);

  container.innerHTML = `
    <div class="sidebar-panel">
      <h4>最近輸出</h4>
      ${outputs.length === 0
        ? '<p class="empty">還沒有任何輸出。</p>'
        : `<ul class="home-list">${outputs.map(outputItemHtml).join('')}</ul>`}
    </div>
  `;
}
