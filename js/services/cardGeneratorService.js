// 獨立、可插拔模組：把一句佳句／一段心得排版成圖片卡片，方便分享到社群平台。
// 純 Canvas 2D 繪圖，不依賴任何外部繪圖函式庫（專案本身沒有建置流程，沒辦法
// 額外引入 html2canvas 這類套件），只吃純資料（bookTitle / author / content / date），
// 不 import db.js、不認識任何頁面的 DOM 結構。

const DEFAULT_WIDTH = 800;
const DEFAULT_HEIGHT = 1000;

// 中文字之間沒有空白可以斷行，用「逐字量測寬度」換行才準確，
// 用空白 split 的話一長串中文字會直接爆版、完全不換行。
function wrapText(ctx, text, maxWidth) {
  const lines = [];
  let currentLine = '';
  for (const char of String(text || '')) {
    if (char === '\n') {
      lines.push(currentLine);
      currentLine = '';
      continue;
    }
    const testLine = currentLine + char;
    if (ctx.measureText(testLine).width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = char;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

// cardData: { bookTitle, author, content, date }
export function generateQuoteCard(cardData, options = {}) {
  const width = options.width || DEFAULT_WIDTH;
  const height = options.height || DEFAULT_HEIGHT;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  // 背景＋裝飾外框，沿用專案本身的暖色調色票（跟 css/styles.css 的 --surface/--accent/
  // --text 這組色系一致，PANTONE 奶油米╱柔粉杏╱深紅棕主題），不是隨便選的顏色。
  // 外框跟大引號用 --accent 柔粉杏色，跟佳句頁碼標籤／#Hashtag 膠囊同一套「標籤／
  // 重點強調」語意；內文、書名用 --text 深紅棕，取代原本偏黑灰的內文色。
  ctx.fillStyle = options.backgroundColor || '#faf6ee';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = options.accentColor || '#e38b97';
  ctx.lineWidth = 6;
  ctx.strokeRect(24, 24, width - 48, height - 48);

  // 大引號裝飾
  ctx.fillStyle = options.accentColor || '#e38b97';
  ctx.font = '140px Georgia, "Noto Serif TC", serif';
  ctx.fillText('“', 60, 220);

  // 內文（自動換行，置中偏上）
  const contentFontSize = options.contentFontSize || 34;
  ctx.fillStyle = '#7b382b';
  ctx.font = `${contentFontSize}px "Noto Sans TC", "PingFang TC", sans-serif`;
  const maxTextWidth = width - 160;
  const lines = wrapText(ctx, cardData.content || '', maxTextWidth);
  const lineHeight = contentFontSize * 1.5;
  let y = 260;
  const maxY = height - 220;
  for (const line of lines) {
    if (y > maxY) {
      ctx.fillText('…', 80, y);
      break;
    }
    ctx.fillText(line, 80, y);
    y += lineHeight;
  }

  // 分隔線
  const metaTop = height - 170;
  ctx.strokeStyle = '#e1d0b3';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(80, metaTop);
  ctx.lineTo(width - 80, metaTop);
  ctx.stroke();

  // 書名／作者／日期
  ctx.fillStyle = '#7b382b';
  ctx.font = 'bold 30px "Noto Sans TC", "PingFang TC", sans-serif';
  ctx.fillText(`《${cardData.bookTitle || '未命名書籍'}》`, 80, height - 120);

  ctx.fillStyle = '#9c7a6e';
  ctx.font = '22px "Noto Sans TC", "PingFang TC", sans-serif';
  const metaLine = [cardData.author, cardData.date].filter(Boolean).join('　·　');
  ctx.fillText(metaLine, 80, height - 84);

  ctx.fillStyle = '#c7bba8';
  ctx.font = '18px "Noto Sans TC", "PingFang TC", sans-serif';
  ctx.fillText('Marginalia', width - 200, height - 44);

  return canvas;
}

export function canvasToBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

export function downloadCanvasAsImage(canvas, filename) {
  const url = canvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export async function copyCanvasToClipboard(canvas) {
  if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
    throw new Error('此瀏覽器不支援複製圖片到剪貼簿，請改用下載圖片。');
  }
  const blob = await canvasToBlob(canvas);
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}

function showCardPreviewModal(canvas, cardData) {
  const backdrop = document.createElement('div');
  backdrop.className = 'card-preview-backdrop';
  backdrop.innerHTML = `
    <div class="card-preview-modal">
      <button type="button" class="card-preview-close" aria-label="關閉分享卡片預覽">✕</button>
      <div class="card-preview-canvas-wrap"></div>
      <div class="card-preview-actions">
        <button type="button" class="btn btn-primary" id="card-download-btn">下載圖片</button>
        <button type="button" class="btn" id="card-copy-btn">複製圖片</button>
      </div>
      <p class="card-preview-status graph-hint"></p>
    </div>
  `;
  canvas.className = 'card-preview-canvas';
  backdrop.querySelector('.card-preview-canvas-wrap').appendChild(canvas);
  document.body.appendChild(backdrop);

  function close() {
    document.removeEventListener('keydown', onKeydown);
    backdrop.remove();
  }
  function onKeydown(event) {
    if (event.key === 'Escape') close();
  }
  backdrop.addEventListener('mousedown', (event) => {
    if (event.target === backdrop) close();
  });
  backdrop.querySelector('.card-preview-close').addEventListener('click', close);
  document.addEventListener('keydown', onKeydown);

  const statusEl = backdrop.querySelector('.card-preview-status');
  const filename = `${(cardData.bookTitle || '分享卡片').replace(/[\\/:*?"<>|]/g, '')}-${(cardData.date || '').slice(0, 10)}.png`;

  backdrop.querySelector('#card-download-btn').addEventListener('click', () => {
    downloadCanvasAsImage(canvas, filename);
    statusEl.textContent = '已下載圖片。';
  });
  backdrop.querySelector('#card-copy-btn').addEventListener('click', async () => {
    try {
      await copyCanvasToClipboard(canvas);
      statusEl.textContent = '已複製圖片到剪貼簿，可以直接貼到社群貼文。';
    } catch (err) {
      statusEl.textContent = `複製失敗：${err.message}`;
    }
  });
}

// 一次呼叫完成「產生卡片＋跳出預覽視窗（含下載／複製按鈕）」，是大部分呼叫端會用到的
// 進入點；如果只想要 canvas 本身自己刻畫面，直接用上面的 generateQuoteCard 就好。
export function previewAndShareCard(cardData, options = {}) {
  const canvas = generateQuoteCard(cardData, options);
  showCardPreviewModal(canvas, cardData);
}

// 可直接掛進「閱讀後輸出」「佳句摘錄」頁面工具列的按鈕。
// fetchCardData()：呼叫端提供，回傳 { bookTitle, author, content, date }。
export function renderCardGeneratorButton(container, { fetchCardData }) {
  container.innerHTML = '<button type="button" class="btn" id="generate-card-btn">🎴 生成分享卡片</button>';
  container.querySelector('#generate-card-btn').addEventListener('click', async () => {
    const cardData = await fetchCardData();
    previewAndShareCard(cardData);
  });
}
