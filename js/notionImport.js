import { DB } from './db.js';
import { escapeHtml } from './utils.js';

// 對照使用者需求：從 Notion 匯出的閱讀紀錄 CSV，欄位名稱因人而異，所以用「欄位對照」
// 讓使用者自己選哪一欄對應到 Marginalia 的哪個欄位，而不是寫死固定的表頭名稱。
const MARGINALIA_FIELDS = [
  { key: 'title', label: '書名', required: true },
  { key: 'author', label: '作者', required: false },
  { key: 'status', label: '閱讀狀態', required: false },
  { key: 'rating', label: '評分', required: false },
  { key: 'endDate', label: '完成日期', required: false },
];

// Marginalia 有、但 Notion 對照不到的欄位，匯入時一律套用這組預設值。
const DEFAULT_CATEGORY = '';
const DEFAULT_RETENTION_STATUS = '保存';

const FIELD_GUESS_PATTERNS = {
  title: ['title', '書名', '書籍名稱', 'name', '名稱'],
  author: ['author', '作者'],
  status: ['status', '狀態', '閱讀狀態', 'read status'],
  rating: ['rating', '評分', '星等', 'score'],
  endDate: ['finish', 'finished', '完成', 'date read', 'date finished', '完成日期'],
};

// 簡易但支援雙引號欄位（含逗號、換行、"" 跳脫）的 CSV 解析，不依賴任何外部套件。
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];
    if (inQuotes) {
      if (char === '"') {
        if (normalized[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const cleanRows = rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
  if (cleanRows.length === 0) return { headers: [], rows: [] };
  const headers = cleanRows[0].map((h) => h.trim());
  return { headers, rows: cleanRows.slice(1) };
}

function guessColumnForField(headers, fieldKey) {
  const patterns = FIELD_GUESS_PATTERNS[fieldKey] || [];
  const lowerHeaders = headers.map((h) => h.toLowerCase());
  for (const pattern of patterns) {
    const idx = lowerHeaders.findIndex((h) => h.includes(pattern));
    if (idx !== -1) return headers[idx];
  }
  return '';
}

// 需求明確提到 Read/Unread 這兩個值，其餘常見說法（進行中、想讀等）一併涵蓋，
// 辨識不出來的一律當作「尚未閱讀」，不會讓匯入中斷。
function normalizeStatus(raw) {
  const v = (raw || '').trim().toLowerCase();
  if (['read', 'done', 'finished', 'complete', 'completed', '已讀', '已讀完', '讀完'].includes(v)) return '已讀完';
  if (['reading', 'in progress', 'currently reading', '閱讀中', '進行中'].includes(v)) return '閱讀中';
  return '尚未閱讀';
}

function normalizeRating(raw) {
  const n = Number(String(raw || '').trim().replace(/[^\d.]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.max(0, Math.min(5, Math.round(n)));
}

function normalizeDate(raw) {
  const v = (raw || '').trim();
  if (!v) return '';
  const parsed = new Date(v);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function buildRecordsFromMapping(headers, rows, mapping) {
  const colIndex = {};
  for (const field of Object.keys(mapping)) {
    colIndex[field] = mapping[field] ? headers.indexOf(mapping[field]) : -1;
  }
  const get = (row, field) => (colIndex[field] >= 0 ? (row[colIndex[field]] || '').trim() : '');

  return rows
    .map((row) => ({
      title: get(row, 'title'),
      author: get(row, 'author'),
      status: mapping.status ? normalizeStatus(get(row, 'status')) : '尚未閱讀',
      rating: mapping.rating ? normalizeRating(get(row, 'rating')) : 0,
      endDate: mapping.endDate ? normalizeDate(get(row, 'endDate')) : '',
    }))
    .filter((r) => r.title);
}

async function importRecords(records) {
  const existingTitles = new Set((await DB.getAll('books')).map((b) => (b.title || '').trim().toLowerCase()));
  let imported = 0;
  let skipped = 0;

  for (const record of records) {
    const key = record.title.trim().toLowerCase();
    if (existingTitles.has(key)) {
      skipped++;
      continue;
    }
    existingTitles.add(key); // 同一個檔案裡自己重複的書名，只匯入第一筆

    const bookId = await DB.add('books', {
      title: record.title,
      author: record.author,
      category: DEFAULT_CATEGORY,
      retentionStatus: DEFAULT_RETENTION_STATUS,
    });
    await DB.add('reading_records', {
      bookId,
      status: record.status,
      startDate: '',
      endDate: record.endDate,
      currentPage: null,
      readCount: 0,
      rating: record.rating,
    });
    imported++;
  }

  return { imported, skipped };
}

function fieldMappingStepHtml(headers, guesses) {
  return `
    <h3>對照 Notion 欄位</h3>
    <p class="graph-hint">選好要對應的欄位後，下一步會先預覽再確認匯入，不會馬上寫入資料。</p>
    ${MARGINALIA_FIELDS.map((f) => `
      <label>${escapeHtml(f.label)}${f.required ? ' *' : ''}
        <select data-field="${f.key}">
          ${f.required ? '' : '<option value="">（不對應，套用預設值）</option>'}
          ${headers.map((h) => `<option value="${escapeHtml(h)}" ${guesses[f.key] === h ? 'selected' : ''}>${escapeHtml(h)}</option>`).join('')}
        </select>
      </label>
    `).join('')}
    <p class="category-manager-error" id="notion-import-error" hidden></p>
    <div class="modal-actions">
      <button type="button" class="btn" id="notion-import-cancel-btn">取消</button>
      <button type="button" class="btn btn-primary" id="notion-import-next-btn">下一步：預覽</button>
    </div>
  `;
}

function previewStepHtml(records, dupCount) {
  const preview = records.slice(0, 3);
  return `
    <h3>確認匯入</h3>
    <p class="graph-hint">
      解析出 ${records.length} 筆有書名的資料${dupCount > 0 ? `，其中 ${dupCount} 筆書名跟現有書籍重複，匯入時會自動略過` : ''}。
      以下預覽前 ${preview.length} 筆：
    </p>
    <div class="notion-import-preview">
      <table>
        <thead><tr><th>書名</th><th>作者</th><th>閱讀狀態</th><th>評分</th><th>完成日期</th></tr></thead>
        <tbody>
          ${preview.map((r) => `
            <tr>
              <td>${escapeHtml(r.title)}</td>
              <td>${escapeHtml(r.author) || '—'}</td>
              <td>${escapeHtml(r.status)}</td>
              <td>${r.rating || '—'}</td>
              <td>${escapeHtml(r.endDate) || '—'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    <div class="modal-actions">
      <button type="button" class="btn" id="notion-import-back-btn">上一步</button>
      <button type="button" class="btn btn-primary" id="notion-import-confirm-btn">確認匯入 ${records.length - dupCount} 筆</button>
    </div>
  `;
}

// 整個匯入流程（欄位對照 → 預覽 → 確認寫入）包在同一個彈窗裡，用 resolve 回傳結果摘要字串，
// 取消（背景、Esc、取消鈕）一律 resolve(null)，呼叫端只要判斷有沒有結果就好。
function openNotionImportModal(headers, rows) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const card = document.createElement('div');
    card.className = 'modal-card notion-import-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    backdrop.appendChild(card);
    document.body.appendChild(backdrop);

    const guesses = {};
    for (const field of MARGINALIA_FIELDS) guesses[field.key] = guessColumnForField(headers, field.key);

    function close(result) {
      document.removeEventListener('keydown', onKeydown);
      backdrop.remove();
      resolve(result);
    }
    function onKeydown(event) {
      if (event.key === 'Escape') close(null);
    }
    backdrop.addEventListener('mousedown', (event) => {
      if (event.target === backdrop) close(null);
    });
    document.addEventListener('keydown', onKeydown);

    function renderMappingStep() {
      card.innerHTML = fieldMappingStepHtml(headers, guesses);
      const errorEl = card.querySelector('#notion-import-error');
      card.querySelector('#notion-import-cancel-btn').addEventListener('click', () => close(null));
      card.querySelector('#notion-import-next-btn').addEventListener('click', () => {
        const mapping = {};
        card.querySelectorAll('select[data-field]').forEach((sel) => {
          mapping[sel.dataset.field] = sel.value;
        });
        if (!mapping.title) {
          errorEl.textContent = '請至少選擇「書名」對應的欄位。';
          errorEl.hidden = false;
          return;
        }
        const records = buildRecordsFromMapping(headers, rows, mapping);
        if (records.length === 0) {
          errorEl.textContent = '選擇的書名欄位裡沒有找到任何資料。';
          errorEl.hidden = false;
          return;
        }
        renderPreviewStep(records);
      });
    }

    async function renderPreviewStep(records) {
      const existingTitles = new Set((await DB.getAll('books')).map((b) => (b.title || '').trim().toLowerCase()));
      const seen = new Set();
      let dupCount = 0;
      for (const r of records) {
        const key = r.title.trim().toLowerCase();
        if (existingTitles.has(key) || seen.has(key)) dupCount++;
        seen.add(key);
      }

      card.innerHTML = previewStepHtml(records, dupCount);
      card.querySelector('#notion-import-back-btn').addEventListener('click', renderMappingStep);
      card.querySelector('#notion-import-confirm-btn').addEventListener('click', async (event) => {
        event.target.disabled = true;
        event.target.textContent = '匯入中…';
        const summary = await importRecords(records);
        close(summary);
      });
    }

    renderMappingStep();
  });
}

// 「匯入 Notion 資料 (CSV)」按鈕：選檔 → 解析 CSV → 開對照／預覽彈窗 → 寫入資料庫，
// 完成或取消後都會呼叫 onDone，讓資料管理頁面可以更新畫面上的統計數字跟狀態文字。
export function wireNotionImportButton(button, statusEl, onDone) {
  // 每次呼叫都是重新渲染整個資料管理頁面之後重新綁定，先清掉上一輪留下的隱藏 input，
  // 不然每匯入一次就會在 body 底下多殘留一個孤兒節點。
  document.getElementById('notion-import-hidden-file-input')?.remove();
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.id = 'notion-import-hidden-file-input';
  // macOS 的原生選檔視窗有時候是照 MIME type 過濾，而 Notion 匯出的 .csv 常被系統標成
  // application/vnd.ms-excel 甚至 text/plain，只寫 text/csv 會讓檔案整個變灰點不了；
  // 這裡把常見的幾種都列進去，讓副檔名／MIME 只要對到一種就能選。
  fileInput.accept = '.csv,text/csv,application/vnd.ms-excel,text/plain';
  fileInput.style.display = 'none';
  document.body.appendChild(fileInput);

  button.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;

    statusEl.textContent = '讀取 CSV 中…';
    // file.text() 本身就是用 UTF-8 解碼，Notion 匯出的 CSV 沒有編碼問題；
    // 唯一要處理的是 Excel／部分匯出工具會在檔案最前面加一個 UTF-8 BOM（U+FEFF），
    // 沒濾掉的話第一個欄位表頭會被污染出一個看不見的字元，選單對照時完全比對不到。
    const text = (await file.text()).replace(/^﻿/, '');
    const { headers, rows } = parseCsv(text);
    if (headers.length === 0 || rows.length === 0) {
      statusEl.textContent = '匯入失敗：這個 CSV 檔案沒有可用的表頭或資料列。';
      return;
    }

    statusEl.textContent = '';
    const summary = await openNotionImportModal(headers, rows);
    if (!summary) {
      statusEl.textContent = '已取消匯入 Notion 資料，沒有變更任何資料。';
      return;
    }
    const message = `匯入完成：新增 ${summary.imported} 本書籍${summary.skipped > 0 ? `，略過 ${summary.skipped} 本重複書名` : ''}。`;
    // onDone 通常會整個重繪資料管理頁面（含這個狀態文字本身），所以訊息要交給它，
    // 讓它在重繪「之後」才貼回去，不然訊息會被自己的重繪立刻蓋掉，使用者只會看到空白。
    if (onDone) await onDone(message);
    else statusEl.textContent = message;
  });
}
