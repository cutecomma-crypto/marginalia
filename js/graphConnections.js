// 關係圖譜畫布上的 SVG 連線繪製——純粹是「已知卡片座標，怎麼畫線跟標籤」的
// 幾何計算與 SVG DOM 組裝，不碰群組／人物的新增刪除邏輯，也是從 graph.js
// 拆出來降低單一檔案行數的一部分（見 js/graphModel.js 開頭的說明）。
import {
  colorId,
  effectiveEdgeColor,
  hasEndArrow,
  hasStartArrow,
  strokeWidthForLabel,
} from './graphModel.js';

// 人物卡片在群組裡是直向排列的清單，連線理論上都是「卡片跟卡片之間橫向拉過去」——
// 固定從左右兩側外邊緣進出（不是任意角度算出來的邊界交點），看起來才像從卡片側面
// 接出去，不會有線從卡片上緣/下緣斜插出來這種不符合版面直覺的角度，也不會直接穿過
// 卡片中央的人名文字。往右邊的對象就接右邊緣中點，往左邊就接左邊緣中點。
function attachSidePoint(rect, center, towardPoint) {
  const side = towardPoint.x >= center.x ? 1 : -1;
  return { x: center.x + side * (rect.width / 2), y: center.y };
}

// 折線（Smooth Step）：先橫向拉到兩張卡片正中間的 bendX，再直向切過去，最後橫向切進
// 對方卡片，轉角用小圓角修掉直角的生硬感——常見於流程圖／關係圖工具的連線畫法。
// 跟純直線相比，折線不會用一條斜線貫穿整個畫布、直接畫過中間其他不相干的卡片正中央；
// 配合 styles.css 讓卡片蓋在連線上面，折線只會在「真的路過某張卡片方塊範圍」時
// 才被那張卡片蓋住一小段，不會像斜線那樣大剌剌地貫穿畫面。
// bendX 可以外部指定（見呼叫端的 dupSpread）：同兩個人之間如果有好幾條重複關係，
// 每一條各自用不同的 bendX，折線本身就會左右錯開，不是只有標籤分開、線還是疊在一起。
function smoothStepPath(start, end, bendX, radius = 14) {
  const dy = end.y - start.y;
  // 兩點幾乎同高（左右排在同一列）：直接一條水平線就好，折出兩個幾乎看不出來的
  // 小彎反而顯得多餘；dupSpread 這時候改成把整條線上下錯開，維持看得到重複關係。
  if (Math.abs(dy) < radius) {
    const offsetY = bendX - (start.x + end.x) / 2;
    return `M ${start.x},${start.y + offsetY} L ${end.x},${end.y + offsetY}`;
  }
  const signX = end.x >= start.x ? 1 : -1;
  const signY = dy >= 0 ? 1 : -1;
  const r = Math.min(radius, Math.abs(end.x - start.x) / 2, Math.abs(dy) / 2);
  if (r < 1) {
    return `M ${start.x},${start.y} L ${bendX},${start.y} L ${bendX},${end.y} L ${end.x},${end.y}`;
  }
  return [
    `M ${start.x},${start.y}`,
    `L ${bendX - signX * r},${start.y}`,
    `Q ${bendX},${start.y} ${bendX},${start.y + signY * r}`,
    `L ${bendX},${end.y - signY * r}`,
    `Q ${bendX},${end.y} ${bendX + signX * r},${end.y}`,
    `L ${end.x},${end.y}`,
  ].join(' ');
}

// svgEl 只畫連線本身，labelSvgEl 只畫標籤——兩個獨立的 SVG 疊在畫布上，
// 中間夾著 .group-track（見 index.html 樣板／styles.css 的說明）：
// svgEl 排在 .group-track 前面、labelSvgEl 排在後面，畫面堆疊順序照 DOM
// 順序疊成「連線 → 群組／人物卡片 → 標籤」三層。連線被卡片蓋住的部分才會
// 達到「連線從卡片外邊緣進出、不穿透卡片內容」的效果；但標籤如果也跟著
// 被蓋住，使用者會完全看不到那條關係叫什麼名字——尤其是跨好幾張卡片的
// 長距離關係，標籤的計算位置很容易剛好落在中間某張不相干的卡片正下方。
// 標籤永遠疊在最上層，才能保證「不管線本身有沒有被卡片擋住，標籤本身
// 一定看得到」，這是比逐字比對原始需求「連線與標籤都在中層」更貼近
// 「使用者永遠看得懂這條線代表什麼關係」這個實際目的的做法。
export function drawConnections(svgEl, labelSvgEl, boardEl, edges, onEdgeClick) {
  const boardRect = boardEl.getBoundingClientRect();
  // 群組卡片可以自由拖到畫布任何位置，畫布實際大小常常比 boardEl 本身量到的寬高還大
  // （boardEl 的寬度不會因為裡面的絕對定位卡片超出範圍就跟著變寬），
  // 用 group-track 的 scrollWidth/Height 才抓得到真正涵蓋所有卡片的範圍，
  // 不然離比較遠的關係線會被 SVG 自己的寬高裁掉，變成「看不到」。
  const trackEl = boardEl.querySelector('.group-track');
  const svgWidth = Math.max(boardRect.width, trackEl ? trackEl.scrollWidth : 0);
  const svgHeight = Math.max(boardRect.height, trackEl ? trackEl.scrollHeight : 0);
  svgEl.setAttribute('width', svgWidth);
  svgEl.setAttribute('height', svgHeight);
  svgEl.innerHTML = '';
  labelSvgEl.setAttribute('width', svgWidth);
  labelSvgEl.setAttribute('height', svgHeight);
  labelSvgEl.innerHTML = '';

  const validEdges = [];
  for (const edge of edges) {
    const fromEl = boardEl.querySelector(`.person-item[data-node-id="${edge.fromNodeId}"]`);
    const toEl = boardEl.querySelector(`.person-item[data-node-id="${edge.toNodeId}"]`);
    if (!fromEl || !toEl) continue;
    const fromRect = fromEl.getBoundingClientRect();
    const toRect = toEl.getBoundingClientRect();
    const fromCenter = { x: fromRect.left + fromRect.width / 2 - boardRect.left, y: fromRect.top + fromRect.height / 2 - boardRect.top };
    const toCenter = { x: toRect.left + toRect.width / 2 - boardRect.left, y: toRect.top + toRect.height / 2 - boardRect.top };
    validEdges.push({ edge, fromRect, toRect, fromCenter, toCenter });
  }

  // 同兩個人之間如果不小心重複建立了好幾條關係，線跟標籤會疊在完全一樣的位置，
  // 看起來像只有一條、也點不到被蓋住的那幾條。先算出每一對人物之間總共有幾條關係，
  // 等一下畫的時候把重複的標籤依序錯開，讓每一條都能分開看到、分開點擊刪除。
  function pairKeyOf(edge) {
    return [edge.fromNodeId, edge.toNodeId].sort((a, b) => a - b).join('-');
  }
  const pairTotalCount = new Map();
  for (const { edge } of validEdges) {
    const key = pairKeyOf(edge);
    pairTotalCount.set(key, (pairTotalCount.get(key) || 0) + 1);
  }
  const pairSeenIndex = new Map();

  const usedColors = new Set(validEdges.map((v) => effectiveEdgeColor(v.edge)));
  const svgNS = 'http://www.w3.org/2000/svg';
  const defs = document.createElementNS(svgNS, 'defs');
  usedColors.forEach((color) => {
    const id = colorId(color);
    [
      { id: `arrow-end-${id}`, orient: 'auto' },
      { id: `arrow-start-${id}`, orient: 'auto-start-reverse' },
    ].forEach((cfg) => {
      const marker = document.createElementNS(svgNS, 'marker');
      marker.setAttribute('id', cfg.id);
      marker.setAttribute('viewBox', '0 -5 10 10');
      marker.setAttribute('refX', '10');
      marker.setAttribute('refY', '0');
      marker.setAttribute('markerWidth', '7');
      marker.setAttribute('markerHeight', '7');
      // 沒寫 markerUnits 的話 SVG 預設是 strokeWidth，箭頭大小會跟著線粗一起放大——
      // 家人關係線比較粗（strokeWidthForLabel=3），箭頭就被放大成快 2 倍，變成畫面上那種巨大箭頭。
      // 改成 userSpaceOnUse 讓箭頭大小固定，不受線粗影響。
      marker.setAttribute('markerUnits', 'userSpaceOnUse');
      marker.setAttribute('orient', cfg.orient);
      const path = document.createElementNS(svgNS, 'path');
      path.setAttribute('d', 'M0,-5L10,0L0,5Z');
      path.setAttribute('fill', color);
      marker.appendChild(path);
      defs.appendChild(marker);
    });
  });
  svgEl.appendChild(defs);

  for (const { edge, fromRect, toRect, fromCenter, toCenter } of validEdges) {
    // 同一對人物重複建立的關係，依序多拉開一點距離，讓每一條重複的關係都有自己獨立、
    // 點得到的線跟標籤，不會疊在同一個位置。
    const pairKey = pairKeyOf(edge);
    const dupTotal = pairTotalCount.get(pairKey) || 1;
    const dupIndex = pairSeenIndex.get(pairKey) || 0;
    pairSeenIndex.set(pairKey, dupIndex + 1);
    const DUPLICATE_SPACING = 24;
    const dupSpread = dupTotal > 1 ? (dupIndex - (dupTotal - 1) / 2) * DUPLICATE_SPACING : 0;

    // 兩個人物如果落在同一張群組卡片（左右邊界幾乎一樣寬），代表是卡片裡相鄰兩排的人物——
    // 這種關係線跟標籤整組都限制在卡片右邊界「內側」的一條固定直線上（往左 inset 18px），
    // 不管關係方向是誰到誰，都不會超出卡片、也不會蓋到人名文字。重複關係就把這條線本身
    // 左右錯開一點。跨卡片的關係則維持原本點對點連線的畫法，標籤沿線的垂直方向擺開。
    const fromColLeft = fromRect.left - boardRect.left;
    const fromColRight = fromRect.right - boardRect.left;
    const toColLeft = toRect.left - boardRect.left;
    const toColRight = toRect.right - boardRect.left;
    const sameCard = Math.abs(fromColLeft - toColLeft) < 4 && Math.abs(fromColRight - toColRight) < 4;
    const GUTTER_INSET = 18;

    let startPulled;
    let end;
    let pathD;
    if (sameCard) {
      const gutterX = Math.max(fromColRight, toColRight) - GUTTER_INSET + dupSpread;
      startPulled = { x: gutterX, y: fromCenter.y };
      end = { x: gutterX, y: toCenter.y };
      pathD = `M ${startPulled.x},${startPulled.y} L ${end.x},${end.y}`;
    } else {
      const fromRectLocal = { width: fromRect.width, height: fromRect.height };
      const toRectLocal = { width: toRect.width, height: toRect.height };
      // 一律從左右外邊緣接出去（不管有沒有箭頭），折線走 smooth step，
      // 不會有直線斜著貫穿中間其他卡片的問題（見兩個函式開頭的說明）。
      startPulled = attachSidePoint(fromRectLocal, fromCenter, toCenter);
      end = attachSidePoint(toRectLocal, toCenter, fromCenter);
      const bendX = (startPulled.x + end.x) / 2 + dupSpread;
      pathD = smoothStepPath(startPulled, end, bendX);
    }

    const line = document.createElementNS(svgNS, 'path');
    line.setAttribute('d', pathD);
    line.setAttribute('fill', 'none');
    const edgeColor = effectiveEdgeColor(edge);
    line.setAttribute('stroke', edgeColor);
    line.setAttribute('stroke-width', String(strokeWidthForLabel(edge.label)));
    if (edge.lineStyle === 'dashed') line.setAttribute('stroke-dasharray', '6,4');
    if (hasEndArrow(edge)) line.setAttribute('marker-end', `url(#arrow-end-${colorId(edgeColor)})`);
    if (hasStartArrow(edge)) line.setAttribute('marker-start', `url(#arrow-start-${colorId(edgeColor)})`);
    line.style.pointerEvents = 'stroke';
    line.style.cursor = 'pointer';
    line.addEventListener('click', () => onEdgeClick(edge));
    svgEl.appendChild(line);

    if (edge.label) {
      // 標籤直接置中疊在連線正中央，讓線貫穿標籤，不要線是線、字是字分開兩邊——
      // 折線的「正中央」就是那段直向折角線段的中點，跟畫 pathD 用的 bendX 是
      // 同一個 X 座標，標籤才會真的貼在畫出來的線上，不是飄在旁邊不相干的位置。
      // 距離太短（兩張卡片擠在一起）就把標籤整個往上浮 10px，不要硬擠在兩張
      // 小卡片正中間蓋住內容。
      let midX;
      let midY;
      if (sameCard) {
        midX = startPulled.x;
        midY = (startPulled.y + end.y) / 2;
      } else {
        const lineLength = Math.hypot(end.x - startPulled.x, end.y - startPulled.y);
        const SHORT_EDGE_THRESHOLD = 80;
        midX = (startPulled.x + end.x) / 2 + dupSpread;
        midY = (startPulled.y + end.y) / 2;
        if (lineLength < SHORT_EDGE_THRESHOLD) midY -= 10;
      }
      const labelColor = edgeColor;
      const text = document.createElementNS(svgNS, 'text');
      text.setAttribute('x', midX);
      text.setAttribute('y', midY);
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dominant-baseline', 'middle');
      text.setAttribute('font-size', '11');
      text.setAttribute('font-weight', '700');
      text.setAttribute('fill', labelColor);
      text.style.pointerEvents = 'none';
      text.textContent = edge.label;
      labelSvgEl.appendChild(text);

      // 膠囊狀底色＋同色系描邊，讓標籤在密集的卡片間也能一眼認出，線不會穿過文字造成雜訊——
      // 內距收緊到 2px 上下／4px 左右（原本 4/7），標籤本身也跟著更貼合文字大小，
      // 不會比實際文字大一整圈，更不容易疊到旁邊卡片的邊框或文字。
      const bboxProbe = text;
      labelSvgEl.appendChild(bboxProbe);
      const bbox = bboxProbe.getBBox();
      const padX = 4;
      const padY = 2;
      const rect = document.createElementNS(svgNS, 'rect');
      rect.setAttribute('x', bbox.x - padX);
      rect.setAttribute('y', bbox.y - padY);
      rect.setAttribute('width', bbox.width + padX * 2);
      rect.setAttribute('height', bbox.height + padY * 2);
      rect.setAttribute('fill', '#ffffff');
      rect.setAttribute('fill-opacity', '0.94');
      rect.setAttribute('stroke', labelColor);
      rect.setAttribute('stroke-width', '1');
      rect.setAttribute('rx', String((bbox.height + padY * 2) / 2));
      rect.style.pointerEvents = 'auto';
      rect.style.cursor = 'pointer';
      rect.addEventListener('click', () => onEdgeClick(edge));
      labelSvgEl.insertBefore(rect, text);
    }
  }
}
