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

// 使用者手動拖曳調整過的連線／標籤水平位置——跟 graphDragDrop.js 的
// restoreUngroupedPosition／saveUngroupedPosition（獨立人物卡片的位置記憶）
// 是同一個考量：存進 localStorage，不是 Supabase 的 edges 表。edges 表目前
// 沒有「水平偏移量」這個欄位，貿然塞進 DB.update() 的 payload，對登入雲端
// 帳號的使用者會重演這個專案踩過的舊 Bug（多送一個資料庫沒有的欄位，本機
// 模式測不出問題，只有連 Supabase 才會出錯或靜默失敗）。存 localStorage
// 換來的取捨跟獨立人物卡片位置一致：只有目前這台瀏覽器記得住，但完全不用
// 碰 Supabase schema。
function edgeOffsetKey(bookId, edgeId) {
  return `marginalia_edge_offset_${bookId}_${edgeId}`;
}

function getStoredEdgeOffset(bookId, edgeId) {
  if (bookId == null) return 0;
  try {
    const raw = localStorage.getItem(edgeOffsetKey(bookId, edgeId));
    if (!raw) return 0;
    const value = Number(raw);
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

function setStoredEdgeOffset(bookId, edgeId, offset) {
  if (bookId == null) return;
  try {
    localStorage.setItem(edgeOffsetKey(bookId, edgeId), String(offset));
  } catch {
    // 存不進去（私密瀏覽模式／容量滿了）就放棄記住這次手動調整，畫面上
    // 這次操作仍然立刻生效，只是下次重新整理後會掉回系統自動排列的位置。
  }
}

// 拖曳途中（放開滑鼠之前）的即時位置，刻意不先寫進 localStorage——每一次
// pointermove 都會呼叫 drawConnections() 重畫一次做即時預覽（見下面
// wireEdgeDrag 的說明），用一個模組層級的 Map 暫存當下正在拖曳的那條線的
// 偏移量，drawConnections() 畫線時優先讀這裡、放開滑鼠那一刻才正式存檔，
// 避免每拖一格就寫一次 localStorage。
const activeDragOffsets = new Map();

function getEdgeOffset(bookId, edgeId) {
  if (activeDragOffsets.has(edgeId)) return activeDragOffsets.get(edgeId);
  return getStoredEdgeOffset(bookId, edgeId);
}

// 「重設連線位置」按鈕用：把這本書底下所有手動調整過的連線位置清掉，
// 之後重畫就會全部掉回系統自動排列（車道／置中）的位置。
export function clearAllEdgeOffsets(bookId) {
  if (bookId == null) return;
  const prefix = `marginalia_edge_offset_${bookId}_`;
  try {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix)) keysToRemove.push(key);
    }
    keysToRemove.forEach((key) => localStorage.removeItem(key));
  } catch {
    // 同上，私密瀏覽模式／容量問題就放棄，不影響畫面上已經重新渲染的結果。
  }
}

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

// 同卡片連線專用的畫法：一條單純往外弧出去再弧回來的曲線，不是直角轉彎的
// 折線。同卡片連線的起點／終點 X 座標永遠相同（都是卡片外邊框，見下面
// drawConnections 裡的說明），smoothStepPath() 在這種「起點終點同一個 X」
// 的情況下，兩點之間的水平距離是 0，算出來的圓角半徑 r 必然小於 1，
// 一定會走進「直角硬轉彎」那個分支——畫出來是兩個 90 度直角銜接的折線，
// 使用者反映「雙向關係（兩端都有箭頭）常常看起來變成一個方框」正是這個：
// 兩個直角轉彎加上兩端的箭頭，視覺上很容易被看成矩形的四個角。
// 改成二次貝茲曲線，整條線只有一個平滑的弧度，不管方向是單向還是雙向、
// 不管兩端有沒有畫箭頭，都不可能再被看成一個方框。
// peakOffset 是希望曲線「弧出去最遠」那一點離卡片邊框的距離（跟車道系統
// 的基準距離意義相同）；貝茲曲線的控制點在參數 t=0.5 時只會貢獻一半的
// 偏移量，所以控制點的 X 要設成 peakOffset 的兩倍，曲線實際弧出去的
// 最遠距離才會剛好等於 peakOffset，車道距離（10px／20px）才會跟畫出來的
// 視覺距離一致。
function bulgeCurvePath(start, end, cardX, peakOffset) {
  const controlX = cardX + peakOffset * 2;
  const controlY = (start.y + end.y) / 2;
  return `M ${start.x},${start.y} Q ${controlX},${controlY} ${end.x},${end.y}`;
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
export function drawConnections(svgEl, labelSvgEl, boardEl, edges, onEdgeClick, bookId) {
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
  // 「同一對人之間」的重複關係，dupSpread 管不到這種情況——原本的做法是
  // 「只要同卡片就一律分配一條新車道」，不管兩條線實際涵蓋的 Y 範圍
  // 有沒有真的重疊，車道數一多，每多一條線就無條件往外推一次，使用者
  // 回報「第二條線看起來佔用了很大一塊畫面」。
  //
  // 改成先算出每一條同卡片關係線實際涵蓋的 Y 範圍（從起點到終點），
  // 只有當兩條線的範圍「真的有重疊」（不是像「家人」佔【湯姆,榭爾比】、
  // 「搭檔」佔【榭爾比,亞當】這種只在榭爾比那個 Y 座標相接、範圍本身
  // 完全不重疊的情況）才需要分配不同車道、錯開一點點距離；完全沒有
  // 跟任何人重疊的線，固定用同一個最窄的基準距離，不會因為卡片裡還有
  // 其他不相干範圍的關係線存在就被迫往外推——這才是使用者手繪圖真正
  // 要表達的：「兩條線的差異應該只在 Y 軸涵蓋的長短，不是 X 軸外推的
  // 深度」。
  const sameCardRanges = [];
  for (const v of validEdges) {
    if (!v.sameCard) continue;
    const cardEl = v.fromEl.closest('.group-card');
    if (!cardEl) continue;
    v.cardEl = cardEl;
    v.rangeTop = Math.min(v.fromCenter.y, v.toCenter.y);
    v.rangeBottom = Math.max(v.fromCenter.y, v.toCenter.y);
    sameCardRanges.push(v);
  }
  // 只在同一張卡片內比較範圍重不重疊，不同卡片的關係線彼此不相干。
  const cardGroups = new Map();
  for (const v of sameCardRanges) {
    if (!cardGroups.has(v.cardEl)) cardGroups.set(v.cardEl, []);
    cardGroups.get(v.cardEl).push(v);
  }
  // 同卡片連線的外推基準點必須是「整張卡片」的最右側外邊框，不能用
  // person-item 自己的 getBoundingClientRect()——.group-card-body 有
  // 0.7rem 的內距，person-item 的右邊界落在卡片邊框「內側」一整段內距
  // 的距離，如果拿 person-item 的右邊界去加車道外推量，算出來的折角
  // X 座標很容易還留在卡片邊框以內（內距的空白範圍內，甚至更糟時連進
  // 卡片內容區域），造成使用者回報的「連線直接橫切穿過卡片內部文字」。
  // 改成在這裡預先量好每一張牽涉到同卡片連線的卡片，真正的外邊框
  // （border box）右邊界在哪，下面畫線時全部的同卡片連線都用這個基準，
  // 保證折角一定落在卡片本身的範圍完全之外，不會因為內距大小而跑進去。
  const cardRightByEl = new Map();
  for (const v of sameCardRanges) {
    if (cardRightByEl.has(v.cardEl)) continue;
    const cardRect = v.cardEl.getBoundingClientRect();
    cardRightByEl.set(v.cardEl, (cardRect.right - boardRect.left) / scale);
  }

  // 容許一點點誤差（0.5px），剛好「相接但不重疊」（像上面家人／搭檔共用
  // 榭爾比那個 Y 座標的情況）不會被誤判成需要錯開。
  const OVERLAP_EPSILON = 0.5;
  function rangesOverlap(a, b) {
    return Math.max(a.rangeTop, b.rangeTop) < Math.min(a.rangeBottom, b.rangeBottom) - OVERLAP_EPSILON;
  }
  // 車道分配的優先順序不能看「哪條線先被處理」（陣列順序跟使用者建立
  // 關係的先後順序綁在一起，不是視覺上該優先的順序），而要看「涵蓋的
  // Y 範圍誰比較短」——使用者明確要求重疊時「涵蓋範圍較長的那條線」
  // 排到外面那一軌，範圍短的留在貼邊的第一軌。先依範圍長度由短到長
  // 排序再跑貪婪分配，短的一定比長的先搶到車道 0，真的跟它重疊的
  // 長線才會被推到車道 1（或更外側）。
  for (const group of cardGroups.values()) {
    const sorted = [...group].sort((a, b) => (a.rangeBottom - a.rangeTop) - (b.rangeBottom - b.rangeTop));
    const placed = [];
    for (const v of sorted) {
      let lane = 0;
      while (placed.some((p) => p.lane === lane && rangesOverlap(p, v))) {
        lane += 1;
      }
      placed.push({ lane, rangeTop: v.rangeTop, rangeBottom: v.rangeBottom });
      v.laneIndex = lane;
    }
  }

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

  for (const { edge, fromEl, toEl, fromRect, toRect, fromCenter, toCenter, sameCard, laneIndex, cardEl } of validEdges) {
    // 同一對人物重複建立的關係，依序多拉開一點距離，讓每一條重複的關係都有自己獨立、
    // 點得到的線跟標籤，不會疊在同一個位置。
    const pairKey = pairKeyOf(edge);
    const dupTotal = pairTotalCount.get(pairKey) || 1;
    const dupIndex = pairSeenIndex.get(pairKey) || 0;
    pairSeenIndex.set(pairKey, dupIndex + 1);
    const DUPLICATE_SPACING = 24;
    const dupSpread = dupTotal > 1 ? (dupIndex - (dupTotal - 1) / 2) * DUPLICATE_SPACING : 0;

    // 兩軌固定距離——第一軌（貼邊）10px、第二軌（真的重疊時外推）20px，
    // 兩軌間距固定 10px，不管這張卡片裡同時牽出去幾條關係線，基準距離
    // 永遠是同一個值，不會因為車道數變多就整組往外推。laneIndex 另外
    // 封頂在 2（最多 30px），就算極端情況下同一張卡片疊了三條以上互相
    // 重疊的關係線，也絕不會把線推到使用者明確禁止的 30px 以上。
    const SAME_CARD_BEND_OFFSET = 10;
    const OVERLAP_LANE_SPACING = 10;
    const MAX_LANE_INDEX = 2;
    const laneSpread = sameCard ? Math.min(laneIndex ?? 0, MAX_LANE_INDEX) * OVERLAP_LANE_SPACING : 0;

    // 使用者手動拖過這條連線（或它的標籤）留下的水平偏移量，疊加在系統
    // 自動排好的基準位置上——拖曳途中讀 activeDragOffsets 即時預覽，放開
    // 滑鼠後讀 localStorage 的存檔值，兩者由 getEdgeOffset() 統一處理，
    // 這裡不用關心現在是不是正在拖曳。
    const manualOffset = getEdgeOffset(bookId, edge.id);

    let startPulled;
    let end;
    let bendX;
    let pathD;
    if (sameCard) {
      // 關鍵修正：起點／終點／折角一律釘在「整張卡片」量到的外邊框
      // 右側（cardRightByEl，見上面的說明），不能用 person-item 自己的
      // 右邊界——person-item 的右邊界落在卡片內距以內，用它當基準會讓
      // 算出來的折角落在卡片邊框內側，使用者實測看到連線直接橫切過
      // 卡片內部的人名文字就是這個誤差造成的。起點／終點的橫線段也是
      // 從這個卡片外邊框的位置拉出來，不會經過卡片內容區塊一步。
      const cardRight = cardRightByEl.get(cardEl);
      const autoExtra = SAME_CARD_BEND_OFFSET + laneSpread + dupSpread;
      // 手動拖曳可以把線拉得更遠，但不能拖回卡片邊框以內（那正是之前
      // 修掉的「連線橫切過卡片文字」那個 bug）——離卡片邊框至少保留 4px。
      const MIN_EXTRA_FROM_CARD = 4;
      const clampedOffset = Math.max(manualOffset, MIN_EXTRA_FROM_CARD - autoExtra);
      const peakOffset = autoExtra + clampedOffset;
      startPulled = { x: cardRight, y: fromCenter.y };
      end = { x: cardRight, y: toCenter.y };
      bendX = cardRight + peakOffset;
      // 同卡片一律用單純往外弧一下的曲線（見 bulgeCurvePath 的說明），不要
      // 直角轉彎的折線——雙向關係兩端都有箭頭時，兩個 90 度直角轉彎很容易
      // 被看成一個方框的四個角，換成一條平滑的弧線就不可能再被誤認成方框。
      pathD = bulgeCurvePath(startPulled, end, cardRight, peakOffset);
    } else {
      const fromRectLocal = { width: fromRect.width / scale, height: fromRect.height / scale };
      const toRectLocal = { width: toRect.width / scale, height: toRect.height / scale };
      startPulled = attachSidePoint(fromRectLocal, fromCenter, toCenter);
      end = attachSidePoint(toRectLocal, toCenter, fromCenter);
      // 使用者回報雙向關係（如「競爭對手」）跨卡片時兩端箭頭都「無法顯示」——
      // 實測發現這其實不是沒畫出來，是畫在看不到的地方：跨卡片連線的起點／
      // 終點是接在 person-item 自己的邊界（卡片內距以內，不是卡片外邊框），
      // 而且 smoothStepPath 在起點/終點的第一／最後一段是純水平線，箭頭的
      // marker 方向跟著這段路徑的切線方向走，等於整個箭頭的寬度（7px）
      // 完全沿著水平方向、筆直地往卡片裡面鑽——不管是最靠外側的 person-item
      // 邊界，箭頭還是會鑽進卡片內距以內，被不透明的卡片背景整個蓋住（連線
      // 的 SVG 層原本就刻意疊在卡片下面，見 drawConnections 開頭的說明）。
      // 同卡片的弧線不會這樣：切線方向是斜的（朝控制點的方向），箭頭長度
      // 有一部分「浪費」在垂直分量上，水平方向鑽進去的深度小很多，肉眼看
      // 起來才會覺得同卡片的箭頭沒事、跨卡片的箭頭卻完全不見。
      // 修法：只要這一端真的有箭頭，就把這一端的接點再往外推一點（遠離
      // 對方、退出卡片的方向），留出剛好夠箭頭完整畫在卡片外面空白處的
      // 間隙，不會再鑽到卡片底下被蓋住；沒有箭頭的那一端維持原本貼齊
      // person-item 邊界的畫法，不會無緣無故多出一截看起來像斷開的缺口。
      const ARROW_CLEARANCE = 8;
      if (hasStartArrow(edge)) {
        const sideStart = toCenter.x >= fromCenter.x ? 1 : -1;
        startPulled = { x: startPulled.x + sideStart * ARROW_CLEARANCE, y: startPulled.y };
      }
      if (hasEndArrow(edge)) {
        const sideEnd = fromCenter.x >= toCenter.x ? 1 : -1;
        end = { x: end.x + sideEnd * ARROW_CLEARANCE, y: end.y };
      }
      bendX = (startPulled.x + end.x) / 2 + dupSpread + manualOffset;
      // 跨卡片的連線起點終點 X 座標本來就不同，smoothStepPath 走的是有
      // 圓角的那個分支，不會變成直角方框，維持原本的折線畫法即可。
      pathD = smoothStepPath(startPulled, end, bendX);
    }

    // 連線本身／標籤的拖曳共用這一份邏輯——按住線或標籤左右拖，即時用
    // activeDragOffsets 暫存偏移量重畫整張圖做預覽，放開滑鼠才正式存進
    // localStorage。跟 graphDragDrop.js 裡卡片拖曳走的是同一套 Pointer
    // Events 模式（document 層級監聽 move/up，不綁在被拖的元素本身上，
    // 元素在拖曳途中被整批重畫置換掉也不受影響）。按下去沒有真的移動
    // （小於 3px）就當成一般點擊，開編輯面板，跟拖曳調整位置是兩種互斥
    // 的操作意圖，不會互相干擾。
    function wireEdgeDrag(el) {
      el.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        const startClientX = event.clientX;
        const startClientY = event.clientY;
        const startOffset = manualOffset;
        let moved = false;
        function onMove(moveEvent) {
          const dxScreen = moveEvent.clientX - startClientX;
          const dyScreen = moveEvent.clientY - startClientY;
          if (!moved) {
            if (Math.hypot(dxScreen, dyScreen) < 3) return;
            moved = true;
          }
          activeDragOffsets.set(edge.id, startOffset + dxScreen / scale);
          drawConnections(svgEl, labelSvgEl, boardEl, edges, onEdgeClick, bookId);
        }
        function onUp() {
          document.removeEventListener('pointermove', onMove);
          document.removeEventListener('pointerup', onUp);
          if (moved) {
            const finalOffset = activeDragOffsets.get(edge.id) ?? startOffset;
            activeDragOffsets.delete(edge.id);
            setStoredEdgeOffset(bookId, edge.id, finalOffset);
            drawConnections(svgEl, labelSvgEl, boardEl, edges, onEdgeClick, bookId);
          } else {
            activeDragOffsets.delete(edge.id);
            onEdgeClick(edge);
          }
        }
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
      });
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
    line.style.cursor = 'ew-resize';
    line.style.touchAction = 'none';
    wireEdgeDrag(line);
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
      rect.style.cursor = 'ew-resize';
      rect.style.touchAction = 'none';
      wireEdgeDrag(rect);
      labelSvgEl.insertBefore(rect, text);
    }
  }
}
