// 「所有書籍」列表在資料庫真的一本書都沒有時顯示的新手引導畫面，以及
// 「載入範例書籍」的種子資料——是從 bookList.js 拆出來降低單一檔案行數的
// 一部分（見 js/bookListPagination.js 開頭的說明）。
import { DB } from './db.js';
import { ICON_SPARKLES } from './icons.js';
import { DEFAULT_RETENTION_STATUS } from './bookForm.js';

// 「空白頁面與新手引導」：資料庫真的一本書都沒有時（不是搜尋/篩選篩到剩零筆——
// 那種情況維持原本簡短的文字提示，見 bookList.js 的 renderList() 判斷式），比起單純一行
// 「還沒有任何書籍」的文字，一張莫蘭迪風格的插畫＋一顆「載入範例書籍」按鈕
// 更能讓剛註冊、還沒開始建立藏書的新使用者馬上摸得到「這個平台實際長什麼樣子」，
// 不用自己想書名、慢慢建立才看得到列表、統計、分類這些功能運作起來的樣子。
// 插畫刻意純用行內 SVG＋CSS 變數上色（跟全站 icons.js 的線條圖示同一種筆觸：
// stroke-width 1.5、圓角端點），不是外部圖檔——完全繼承目前的莫蘭迪配色（含
// 深色模式），不用另外準備、维護一張點陣圖素材。
export function emptyLibraryStateHtml() {
  return `
    <div class="empty-library-state">
      <svg class="empty-library-illustration" viewBox="0 0 120 100" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <rect x="14" y="70" width="92" height="6" rx="3" fill="var(--border-soft)"></rect>
        <path d="M24 70V32a4 4 0 0 1 4-4h20a4 4 0 0 1 4 4v38" stroke="var(--color-primary-accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></path>
        <path d="M52 70V24a4 4 0 0 1 4-4h20a4 4 0 0 1 4 4v46" stroke="var(--primary)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></path>
        <path d="M80 70V38a4 4 0 0 1 4-4h12a4 4 0 0 1 4 4v32" stroke="var(--accent-green)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></path>
        <line x1="32" y1="46" x2="40" y2="46" stroke="var(--color-primary-accent)" stroke-width="2" stroke-linecap="round"></line>
        <line x1="60" y1="38" x2="70" y2="38" stroke="var(--primary)" stroke-width="2" stroke-linecap="round"></line>
        <circle cx="90" cy="52" r="3" fill="var(--gold)"></circle>
      </svg>
      <p class="empty-library-title">還沒有任何藏書</p>
      <p class="empty-library-subtitle">點擊上方「＋ 新增書籍」開始記錄，<br>或先載入幾本範例書籍熟悉一下功能。</p>
      <button type="button" class="btn btn-primary" id="load-sample-books-btn">${ICON_SPARKLES}載入 3 本範例書籍</button>
    </div>
  `;
}

// 範例書籍刻意挑三種不同閱讀狀態（已讀完＋評分／閱讀中／尚未閱讀）跟三個不同
// 分類，讓新使用者一載入就能同時看到列表、側邊欄「年度已讀進度」「藏書分類
// 統計」這幾個核心功能實際運作起來的樣子，不是三本內容完全相同、只有書名不同
// 的空殼資料。
const SAMPLE_BOOKS = [
  { title: '原子習慣', author: '詹姆斯．克利爾', category: '自我提升', status: '已讀完', rating: 5, daysAgo: 20 },
  { title: '人類大歷史', author: '哈拉瑞', category: '社會科學', status: '閱讀中', rating: 0, daysAgo: 0 },
  { title: '小王子', author: '安東尼．聖修伯里', category: '歐美文學', status: '尚未閱讀', rating: 0, daysAgo: 0 },
];

function isoDateDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export async function loadSampleBooks() {
  for (const sample of SAMPLE_BOOKS) {
    const bookId = await DB.add('books', {
      title: sample.title,
      author: sample.author,
      publisher: '',
      publishDate: '',
      purchaseDate: '',
      purchasePrice: null,
      format: '紙本購買',
      retentionStatus: DEFAULT_RETENTION_STATUS,
      libraryBorrowType: '',
      libraryName: '',
      category: sample.category,
      coverImage: '',
    });
    await DB.add('reading_records', {
      bookId,
      status: sample.status,
      startDate: '',
      endDate: sample.status === '已讀完' ? isoDateDaysAgo(sample.daysAgo) : '',
      currentPage: null,
      readCount: sample.status === '已讀完' ? 1 : 0,
      rating: sample.rating,
    });
  }
}
