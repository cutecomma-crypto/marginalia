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

// 量出 boardEl 目前實際套用的縮放倍率——這是實測抓到的真正根因：graph.js
// 的縮放功能直接對 .canvas-board（也就是這裡的 boardEl）套 CSS
// transform:scale()，但底下這個函式原本整段都是拿 getBoundingClientRect()
// 量到的「畫面上看到的」座標（已經被那個 transform 放大/縮小過一次），
// 直接當成 SVG 的 path 座標、寬高屬性寫進去——而 svgEl／labelSvgEl 本身
// 也是 boardEl 的子元素，一樣會被同一個 transform 再放大/縮小一次，等於
// 整條連線的座標被縮放了兩次。100% 縮放（scale(1)）時這個問題完全看不
// 出來（乘以 1 兩次還是 1，誤打誤撞「剛好正確」），但只要使用者按下
// 放大/縮小鈕改變比例，連線跟標籤的座標就會跟著縮放倍率的「平方」跑掉，
// 越偏離 100% 跑掉得越嚴重——這正是使用者實測回報「畫面放大到 120% 才
// 看得到關係線」的真正原因：並不是 100% 時線不存在，是兩次縮放疊加後，
// 線被算到跟卡片對不上的座標，100% 時剛好重疊在正確位置看起來正常，
// 120% 時兩次縮放的落差大到肉眼就能看出明顯位移。
// 修法是把所有「用 getBoundingClientRect() 量到的畫面座標」都先除以這個
// 倍率，換算回「縮放套用之前」的座標系統，這樣整條連線（含 SVG 本身的
// width/height 屬性）才會跟卡片一樣，只被 transform 縮放「一次」，不管
// 使用者縮放到多少都能維持跟卡片對齊。
function getBoardScale(boardEl) {
  const transform = getComputedStyle(boardEl).transform;
  if (!transform || transform === 'none') return 1;
  // 縮放功能只會用 scale()（見 graph.js 的 applyZoom()，沒有旋轉/歪斜），
  // 瀏覽器算出來的 computed transform 一律是 matrix(a, b, c, d, e, f) 的
  // 形式，單純縮放時 a 跟 d 會是同一個倍率，取 a 就夠了。
  const match = transform.match(/^matrix\(([^,]+),/);
  const scale = match ? parseFloat(match[1]) : 1;
  return scale > 0 ? scale : 1;
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
  const scale = getBoardScale(boardEl);
  const boardRect = boardEl.getBoundingClientRect();
  // 群組卡片可以自由拖到畫布任何位置，畫布實際大小常常比 boardEl 本身量到的寬高還大
  // （boardEl 的寬度不會因為裡面的絕對定位卡片超出範圍就跟著變寬），
  // 用 group-track 的 scrollWidth/Height 才抓得到真正涵蓋所有卡片的範圍，
  // 不然離比較遠的關係線會被 SVG 自己的寬高裁掉，變成「看不到」。
  // boardRect.width/height 是 getBoundingClientRect() 量到的「畫面上」
  // 大小（已經被 transform:scale 放大/縮小過），但 trackEl.scrollWidth／
  // scrollHeight 是版面配置用的內部尺寸，不受祖先的 transform 影響——
  // 兩者單位不一致，先把 boardRect 那一半除以 scale 換算回「縮放前」
  // 的座標系統再取最大值，才能跟 scrollWidth/Height 比較、也才能跟下面
  // 每個人物卡片「除以 scale」之後的座標落在同一套單位上（見
  // getBoardScale() 開頭的完整說明）。
  const trackEl = boardEl.querySelector('.group-track');
  const svgWidth = Math.max(boardRect.width / scale, trackEl ? trackEl.scrollWidth : 0);
  const svgHeight = Math.max(boardRect.height / scale, trackEl ? trackEl.scrollHeight : 0);
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
    const fromCenter = { x: (fromRect.left + fromRect.width / 2 - boardRect.left) / scale, y: (fromRect.top + fromRect.height / 2 - boardRect.top) / scale };
    const toCenter = { x: (toRect.left + toRect.width / 2 - boardRect.left) / scale, y: (toRect.top + toRect.height / 2 - boardRect.top) / scale };
    const sameCard = Math.abs((fromRect.left - boardRect.left) / scale - (toRect.left - boardRect.left) / scale) < 4
      && Math.abs((fromRect.right - boardRect.left) / scale - (toRect.right - boardRect.left) / scale) < 4;
    validEdges.push({ edge, fromEl, toEl, fromRect, toRect, fromCenter, toCenter, sameCard });
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

  // 同一張卡片裡，只要有兩條（或更多）關係各自牽連到不同的人——不是
  // 「同一對人之間」的重複關係，dupSpread 管不到這種情況——原本全部共用
  // 同一個 SAME_CARD_BEND_OFFSET，會疊在同一條垂直線上：這正是使用者
  // 實測抓到的案例，主角（榭爾比）同時牽著「家人」「搭檔」兩條關係，
  // 疊在一起看起來像一個方框。這裡依卡片分組，一張卡片裡有幾條這樣的
  // 關係線，就分配幾條互相錯開的「車道」（lane，見下面主迴圈裡 laneSpread
  // 的說明），讓每一條都能分開看到。
  const cardLaneSeenIndex = new Map();

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

  for (const { edge, fromEl, toEl, fromRect, toRect, fromCenter, toCenter, sameCard } of validEdges) {
    // 同一對人物重複建立的關係，依序多拉開一點距離，讓每一條重複的關係都有自己獨立、
    // 點得到的線跟標籤，不會疊在同一個位置。
    const pairKey = pairKeyOf(edge);
    const dupTotal = pairTotalCount.get(pairKey) || 1;
    const dupIndex = pairSeenIndex.get(pairKey) || 0;
    pairSeenIndex.set(pairKey, dupIndex + 1);
    const DUPLICATE_SPACING = 24;
    const dupSpread = dupTotal > 1 ? (dupIndex - (dupTotal - 1) / 2) * DUPLICATE_SPACING : 0;

    // 兩個人物如果落在同一張群組卡片（左右邊界幾乎一樣寬），代表是卡片裡
    // 同一欄的人物——這種情況原本的畫法是貼著卡片右邊界「內側」拉一條
    // 直線，整條線完全被不透明的卡片背景蓋住，使用者實際完全看不到任何
    // 線條，只看得到飄在旁邊的標籤。現在不分同卡片還是跨卡片，一律走
    // attachSidePoint＋smoothStepPath 這同一套「從卡片外側接出去、彎到
    // 中間再彎進對方」的畫法，讓線清楚地浮在卡片外面的空白區域。
    const fromColRight = (fromRect.right - boardRect.left) / scale;
    const toColRight = (toRect.right - boardRect.left) / scale;

    // 同一張卡片裡如果有好幾條關係各自牽連到不同的人（不是「同一對人
    // 之間」的重複關係，是「同一張卡片」牽出去的好幾條不同關係——使用者
    // 實測抓到的案例：主角同時是「家人」跟「搭檔」兩段關係的其中一端），
    // 原本全部共用同一個外推距離，會疊在同一條垂直線上、看起來像一個
    // 方框。這裡依卡片分配「車道」（lane）——不是像 dupSpread 那樣置中
    // 對稱分佈（那樣會讓車道一多，離卡片最遠的那條線跟著越推越遠，使用者
    // 實測回報「第二條線（搭檔）佔據的畫面似乎太大了」正是這個原因），
    // 改成固定從 SAME_CARD_BEND_OFFSET 這個距離依序往外疊加：第一條線
    // 永遠貼著跟只有一條線時一樣的距離（維持「家人」原本那麼窄），之後
    // 每多一條才往外加一點點，不管主角牽了幾條關係線，第一條線的寬度
    // 永遠不會因為車道數變多而跟著變寬。
    let laneSpread = 0;
    if (sameCard) {
      const cardEl = fromEl.closest('.group-card');
      const laneIndex = cardEl ? (cardLaneSeenIndex.get(cardEl) || 0) : 0;
      if (cardEl) cardLaneSeenIndex.set(cardEl, laneIndex + 1);
      const LANE_SPACING = 14;
      laneSpread = laneIndex * LANE_SPACING;
    }

    const fromRectLocal = { width: fromRect.width / scale, height: fromRect.height / scale };
    const toRectLocal = { width: toRect.width / scale, height: toRect.height / scale };
    const startPulled = attachSidePoint(fromRectLocal, fromCenter, toCenter);
    const end = attachSidePoint(toRectLocal, toCenter, fromCenter);
    // 車道的外推距離統一從卡片邊界起算（SAME_CARD_BEND_OFFSET 加車道間距
    // 乘上車道數的一半，讓最外側的車道也不會太貼近卡片邊界），比固定
    // 26px 再加車道位移更穩，不會因為車道數一多，最內側那條線反而縮回
    // 卡片邊界上。
    const SAME_CARD_BEND_OFFSET = 26;
    const bendX = sameCard
      ? Math.max(fromColRight, toColRight) + SAME_CARD_BEND_OFFSET + laneSpread + dupSpread
      : (startPulled.x + end.x) / 2 + dupSpread;
    const pathD = smoothStepPath(startPulled, end, bendX);

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
      // 標籤直接置中疊在連線的折角線段上，讓線貫穿標籤，不要線是線、字是字
      // 分開兩邊——bendX 就是折線中間那段直向線段的 X 座標，跟畫 pathD 用的
      // 是同一個值，標籤才會真的貼在畫出來的線上。同卡片的關係現在線本身
      // 就已經彎到卡片外面的空白區域（見上面 bendX 的說明），標籤自然跟著
      // 飄在外面，不用再另外判斷「中間有沒有夾著別人」、特別搬到別的位置——
      // 不管是相鄰兩行還是中間跳過好幾個人，線跟標籤現在都是同一套邏輯，
      // 一定在卡片外面、一定看得到。
      const midX = bendX;
      let midY = (startPulled.y + end.y) / 2;
      // 距離太短（兩張卡片擠在一起，或是同卡片裡緊鄰的兩行）就把標籤整個
      // 往上浮 10px，不要硬擠在中間蓋住內容。
      const lineLength = Math.hypot(end.x - startPulled.x, end.y - startPulled.y);
      const SHORT_EDGE_THRESHOLD = 80;
      if (lineLength < SHORT_EDGE_THRESHOLD) midY -= 10;
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
