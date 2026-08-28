import { DB } from './db.js';
import { escapeHtml } from './utils.js';

// 對照 PROJECT_SPEC.md 第 10 節首頁建議區塊。「我的閱讀」數字概覽併進 stats.js 的側邊欄精簡統計，
// 這裡只負責「最近輸出」「最近關聯」，放在首頁側邊欄下半部。
async function buildRecentOutputs(limit) {
  const [outputs, books] = await Promise.all([DB.getAll('outputs'), DB.getAll('books')]);
  const bookById = new Map(books.map((b) => [b.id, b]));
  return outputs
    .filter((o) => o.text || (o.tags && o.tags.length))
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    .slice(0, limit)
    .map((o) => ({ ...o, book: bookById.get(o.bookId) }));
}

async function buildRecentEdges(limit) {
  const [edges, nodes, books] = await Promise.all([DB.getAll('edges'), DB.getAll('nodes'), DB.getAll('books')]);
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const bookById = new Map(books.map((b) => [b.id, b]));
  return edges
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    .slice(0, limit)
    .map((e) => ({
      ...e,
      book: bookById.get(e.bookId),
      fromNode: nodeById.get(e.fromNodeId),
      toNode: nodeById.get(e.toNodeId),
    }))
    .filter((e) => e.fromNode && e.toNode);
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
    ? `<div class="output-tags">${o.tags.map((t) => `<span class="output-tag">${escapeHtml(t)}</span>`).join('')}</div>`
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

function edgeItemHtml(e) {
  const title = e.book ? escapeHtml(e.book.title || '（未命名）') : '（書籍已刪除）';
  return `
    <li>
      <div class="home-list-title">${e.book ? `<a href="#/books/${e.bookId}/graph">${title}</a>` : title}</div>
      <p class="home-list-text">${escapeHtml(e.fromNode.label)} —${escapeHtml(e.label || '關聯')}→ ${escapeHtml(e.toNode.label)}</p>
    </li>
  `;
}

export async function renderRecentActivity(container) {
  const [outputs, edges] = await Promise.all([
    buildRecentOutputs(5),
    buildRecentEdges(5),
  ]);

  container.innerHTML = `
    <div class="sidebar-panel">
      <h4>最近輸出</h4>
      ${outputs.length === 0
        ? '<p class="empty">還沒有任何輸出。</p>'
        : `<ul class="home-list">${outputs.map(outputItemHtml).join('')}</ul>`}
    </div>
    <div class="sidebar-panel">
      <h4>最近關聯</h4>
      ${edges.length === 0
        ? '<p class="empty">還沒有任何圖譜關聯。</p>'
        : `<ul class="home-list">${edges.map(edgeItemHtml).join('')}</ul>`}
    </div>
  `;
}
