// 獨立、可插拔模組：把一本書的劃線／筆記／閱讀後輸出匯出成標準 Markdown 檔，
// 含 YAML Frontmatter，劃線用 Obsidian 認得的 Callout 語法。
// 只吃純資料物件（book / quotes / notes / reflections），不 import db.js、
// 不認識任何頁面元件，呼叫端從既有的 DB.getAll(...) 撈完資料後直接傳進來就好。

function yamlEscape(value) {
  if (value === undefined || value === null || value === '') return '""';
  const str = String(value);
  if (/[:"\n#]/.test(str) || str !== str.trim()) {
    return `"${str.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return str;
}

function yamlList(items) {
  const list = (items || []).filter(Boolean);
  if (list.length === 0) return '[]';
  return `[${list.map((item) => yamlEscape(item)).join(', ')}]`;
}

function buildFrontmatter({ title, author, readDate, tags }) {
  return [
    '---',
    `title: ${yamlEscape(title)}`,
    `author: ${yamlEscape(author)}`,
    `read_date: ${yamlEscape(readDate)}`,
    `tags: ${yamlList(tags)}`,
    '---',
    '',
  ].join('\n');
}

// 把「閱讀後輸出」存的 HTML（新格式，見 outputs.js 的 WYSIWYG 編輯器）或純文字
// （改版前的舊格式）轉成 Markdown：語意標籤逐一對應，<mark> 對應 Obsidian 原生
// 支援的 ==螢光標記== 語法。不認得的標籤／屬性一律忽略、只取文字內容，跟
// outputs.js 的 sanitizer 一樣不信任來源格式，純字串處理不會執行任何內嵌腳本。
function htmlToMarkdown(html) {
  const root = document.createElement('div');
  root.innerHTML = html;

  function walk(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const inner = Array.from(node.childNodes).map(walk).join('');
    switch (node.tagName) {
      case 'STRONG':
      case 'B':
        return `**${inner}**`;
      case 'EM':
      case 'I':
        return `*${inner}*`;
      case 'S':
      case 'STRIKE':
      case 'DEL':
        return `~~${inner}~~`;
      case 'MARK':
        return `==${inner}==`;
      case 'H2':
      case 'H3':
        return `\n## ${inner}\n`;
      case 'LI':
        return `- ${inner}\n`;
      case 'UL':
      case 'OL':
        return inner;
      case 'P':
      case 'DIV':
        return `${inner}\n`;
      case 'BR':
        return '\n';
      default:
        return inner;
    }
  }

  return walk(root).replace(/\n{3,}/g, '\n\n').trim();
}

function quoteToCallout(quote) {
  const pageLabel = quote.page ? ` P. ${quote.page}` : '';
  const lines = String(quote.content || '').split('\n').filter((l) => l.trim());
  const body = lines.map((line) => `> ${line}`).join('\n');
  return `> [!quote]${pageLabel}\n${body}`;
}

function reflectionToSection(item) {
  const date = item.date || (item.createdAt || '').slice(0, 10);
  const body = item.format === 'html' ? htmlToMarkdown(item.text || '') : (item.text || '');
  const tags = (item.tags || []).map((t) => `#${t}`).join(' ');
  return [`**${date}**${tags ? `　${tags}` : ''}`, '', body].filter(Boolean).join('\n');
}

// book: { title, author, category, tags?, readDate? }
// quotes/notes/reflections: 對應 DB.getByIndex('quotes'|'notes'|'outputs', 'bookId', id) 的結果
// （reflections 記得先過濾 kind === 'reflection'）。
export function buildBookMarkdown(book, { quotes = [], notes = [], reflections = [] } = {}) {
  const readDate = book.readDate || '';
  const tags = [book.category, ...(book.tags || [])].filter(Boolean);
  const frontmatter = buildFrontmatter({ title: book.title, author: book.author, readDate, tags });

  const sections = [`# ${book.title || '未命名書籍'}`, ''];

  if (quotes.length > 0) {
    sections.push('## 📖 劃線與佳句', '');
    sections.push(quotes.map(quoteToCallout).join('\n\n'));
    sections.push('');
  }

  if (notes.length > 0) {
    sections.push('## 📝 快速筆記', '');
    sections.push(notes.map((n) => `- ${(n.text || '').replace(/\n/g, ' ')}`).join('\n'));
    sections.push('');
  }

  if (reflections.length > 0) {
    sections.push('## ✍️ 閱讀後輸出', '');
    sections.push(reflections.map(reflectionToSection).join('\n\n---\n\n'));
    sections.push('');
  }

  return frontmatter + sections.join('\n');
}

export function downloadMarkdown(markdown, filename) {
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// obsidian://new 這個 URI 有長度限制（不同作業系統／瀏覽器不一定一致，經驗上
// 抓在幾千字元內比較保險），內容太長時退而求其次只帶 vault/name，讓使用者自己
// 在 Obsidian 裡貼上內容，而不是產生一個因為太長而打不開的連結。
const OBSIDIAN_URI_SAFE_LENGTH = 6000;

export function buildObsidianNewNoteUri(vaultName, noteName, content) {
  const baseParams = new URLSearchParams();
  if (vaultName) baseParams.set('vault', vaultName);
  baseParams.set('name', noteName);

  const withContent = new URLSearchParams(baseParams);
  withContent.set('content', content);
  const fullUri = `obsidian://new?${withContent.toString()}`;
  if (fullUri.length <= OBSIDIAN_URI_SAFE_LENGTH) return fullUri;
  return `obsidian://new?${baseParams.toString()}`;
}

// 可直接掛進「佳句摘錄」或書籍詳情頁的匯出按鈕列。
// fetchExportData()：呼叫端提供，回傳 { book, quotes, notes, reflections }。
export function renderMarkdownExportButton(container, { fetchExportData, obsidianVaultName }) {
  container.innerHTML = `
    <button type="button" class="btn" id="export-md-btn">📤 匯出為 Markdown</button>
    ${obsidianVaultName ? '<button type="button" class="btn" id="export-obsidian-btn">🔗 在 Obsidian 開啟</button>' : ''}
  `;

  container.querySelector('#export-md-btn').addEventListener('click', async () => {
    const { book, quotes, notes, reflections } = await fetchExportData();
    const markdown = buildBookMarkdown(book, { quotes, notes, reflections });
    downloadMarkdown(markdown, `${book.title || '未命名書籍'}.md`);
  });

  const obsidianBtn = container.querySelector('#export-obsidian-btn');
  if (obsidianBtn) {
    obsidianBtn.addEventListener('click', async () => {
      const { book, quotes, notes, reflections } = await fetchExportData();
      const markdown = buildBookMarkdown(book, { quotes, notes, reflections });
      const uri = buildObsidianNewNoteUri(obsidianVaultName, book.title || '未命名書籍', markdown);
      window.location.href = uri;
    });
  }
}
