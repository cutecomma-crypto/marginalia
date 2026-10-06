// 關係圖譜的純資料層：色盤常數、關係預設色/線寬邏輯、方向選項、資料讀取——
// 這裡刻意不碰任何 DOM，全部是可以直接單元測試的純函式，從 graph.js 拆出來
// 是這次「單一檔案超過 500 行」健檢的第一步：graph.js 原本 1128 行裡，這一段
// 是最容易獨立、風險最低的部分（沒有任何一個函式依賴 renderGraphPage 內部
// 的區域變數或畫布狀態）。
import { DB } from './db.js';

// 對照 PROJECT_SPEC.md 第 5 節（階層式群組卡片版）：群組容器裝人物卡片，
// 人物跨群組連線標註關係。範圍限單一書籍。
// 關係名稱、人物狀態標籤都是純自由輸入，不提供預設清單——這張圖不是只給推理小說用，
// 也可能拿來畫工具書的概念關係（引申出、反駁…），硬塞一份固定詞彙表反而綁死用途。
export const DEFAULT_EDGE_COLOR = '#c2b299';
export const DEFAULT_GROUP_COLOR = '#4a2e2b';
// 新增群組時依序輪流套用的 15 色調色盤，深淺都控制在跟白色標題文字有足夠對比的範圍。
export const GROUP_COLOR_PALETTE = [
  { name: '莫蘭迪棕', hex: '#8C6D58' },
  { name: '鼠尾草綠', hex: '#728C74' },
  { name: '霧藍', hex: '#5C768D' },
  { name: '灰赤桃', hex: '#A66B6C' },
  { name: '芥末黃', hex: '#C89B3C' },
  { name: '陶土橙', hex: '#B25B42' },
  { name: '板岩灰', hex: '#6A7B82' },
  { name: '薰衣草紫', hex: '#85768D' },
  { name: '橄欖綠', hex: '#5B7355' },
  { name: '珊瑚粉', hex: '#D9787A' },
  { name: '海軍藍', hex: '#2E4057' },
  { name: '勃根地紅', hex: '#6B2D39' },
  { name: '青苔綠', hex: '#4E6A58' },
  { name: '暖焦糖', hex: '#9E623B' },
  { name: '煙燻藍', hex: '#4A5568' },
];

export function nextGroupColor(existingGroupCount) {
  return GROUP_COLOR_PALETTE[existingGroupCount % GROUP_COLOR_PALETTE.length].hex;
}

// 關係線顏色改用固定 12 色日系馬卡龍柔和色盤（6 欄 x 2 排整齊對齊），
// 取代原本偏灰暗的莫蘭迪色系——關係線只是分類用途，色調要明亮好認但不刺眼。
//
// 使用者後來反映想要黑色／正紅色／灰色，但維持 12 色的總數，所以先拿掉
// 3 個跟其他色塊太相近、區分度低的顏色，騰出位置：
//   - 靜謐藍綠（#729B98）跟鼠尾草綠（#82A3A1）幾乎同一色系，留一個就夠。
//   - 深灰藍（#5B6A72）、藍灰（#7B889B）、霧藍（#6B8EA7）三個是同一組偏藍
//     的灰色調，拿掉深灰藍，剩兩個已經有足夠的區隔，空出來的位置剛好
//     換成真正中性、不偏藍的灰色。
//   - 珊瑚暖粉（#D68F85）跟暖心磚紅（#D4726B）都是偏粉的紅色調，拿掉
//     珊瑚暖粉，留下的暖心磚紅已經涵蓋那個色系，空出來的位置換成真正
//     飽和的正紅色。
// 新增的黑／紅／灰刻意不用純黑 #000000／純紅 #FF0000 這種高飽和的數位
// 色，而是比照整個色盤「馬卡龍柔和」的調性，用偏暖、稍微降低飽和度的
// 版本（炭黑帶一點暖棕、正紅帶一點磚紅底），跟其餘 9 色維持同一套視覺
// 語言，不會突兀地冒出三個特別「硬」的顏色。
// 使用者也要求這組顏色要能跟 PERSON_COLOR_PALETTE（人物卡片底色，見
// 下面的說明）互相「呼應」——兩組色盤的用途不同（這裡是關係線本身的
// 顏色，深、飽和度較高；人物卡片是淺色粉彩底色，深色文字要讀得清楚），
// 沒辦法也不應該用完全一樣的色號，但同一個色相家族要兩邊都找得到：
// 這裡的「灰色」對應人物色盤的「粉彩灰」，這裡的「正紅」對應人物色盤
// 偏紅的「粉彩玫瑰」／「粉彩粉」——深淺不同、色相呼應。黑色是唯一沒有
// 對應色的例外：真正的黑／近黑沒辦法變成淺色系的卡片底色（上面深色
// 文字會看不清楚），這裡退而求其次，讓黑色的底色調（偏暖的炭黑，不是
// 冷調純黑）跟人物色盤「粉彩灰」「粉彩卡其」那種偏暖中性色系同一個
// 方向，至少色溫上互相呼應。
export const EDGE_COLOR_PALETTE = [
  { name: '鼠尾草綠', hex: '#82A3A1' },
  { name: '霧藍', hex: '#6B8EA7' },
  { name: '風信子紫', hex: '#8F81A3' },
  { name: '蜜桃杏橘', hex: '#DE9B72' },
  { name: '芥末奶油黃', hex: '#E3B04B' },
  { name: '溫潤淺褐', hex: '#9B8265' },
  { name: '暖心磚紅', hex: '#D4726B' },
  { name: '藍灰', hex: '#7B889B' },
  { name: '可可棕', hex: '#8B6B5D' },
  { name: '正紅', hex: '#BE3A2E' },
  { name: '炭黑', hex: '#33302D' },
  { name: '中性灰', hex: '#8A8580' },
];

export function edgeColorNameForHex(hex) {
  const found = EDGE_COLOR_PALETTE.find((c) => c.hex.toLowerCase() === (hex || '').toLowerCase());
  return found ? found.name : null;
}

// 人物卡片自訂底色——使用者特別問「顏色如果跟關係線那 12 個一樣會不會
// 很奇怪」，所以刻意不跟 EDGE_COLOR_PALETTE／GROUP_COLOR_PALETTE 共用
// 任何色號，三組色盤分屬三種不同用途（人物底色／關係線／群組標題底色），
// 視覺上要一眼就能分辨「這是哪一種顏色選擇」，不會互相搞混。原本只有
// 6 色，使用者實際用起來覺得不夠，要求跟關係線一樣擴充到 12 色——
// 數量對齊但色調完全不同：刻意選飽和度低很多的粉彩色系（比
// EDGE_COLOR_PALETTE 更淺、更接近現在人物色塊預設的 --surface-alt
// 底色），背景色要襯得住上面的深色文字，不能跟關係線那種拿來當線條
// 本身顏色的中飽和度色盤一樣搶眼。
export const PERSON_COLOR_PALETTE = [
  { name: '粉彩藍', hex: '#D7E3F0' },
  { name: '粉彩綠', hex: '#DCEADC' },
  { name: '粉彩黃', hex: '#F8EFD6' },
  { name: '粉彩粉', hex: '#F3DEE3' },
  { name: '粉彩紫', hex: '#E6DFEF' },
  { name: '粉彩灰', hex: '#E5E2DC' },
  { name: '粉彩橘', hex: '#F5E0CC' },
  { name: '粉彩薄荷', hex: '#D9EDE8' },
  { name: '粉彩靛藍', hex: '#DCE0F2' },
  { name: '粉彩玫瑰', hex: '#F0D9DC' },
  { name: '粉彩卡其', hex: '#EAE2D0' },
  { name: '粉彩青', hex: '#D8EEF2' },
];

export function personColorNameForHex(hex) {
  const found = PERSON_COLOR_PALETTE.find((c) => c.hex.toLowerCase() === (hex || '').toLowerCase());
  return found ? found.name : null;
}

// 常見關係預設顏色／線寬，選到這些關係字時自動套用，不用手動調
const COUPLE_LABELS = ['戀人', '夫妻'];
const COUPLE_COLOR = '#c9738f';
const FAMILY_LABELS = ['家人'];
const FAMILY_COLOR = '#6b7a8f';
// 所有關係線一律用同一個粗細，只靠顏色分辨關係類型——家人關係線之前故意調粗，
// 反而讓不同關係的線看起來粗細不一致，容易被誤會是顯示錯誤，所以統一掉。
const DEFAULT_STROKE_WIDTH = 1.5;

export function presetColorForLabel(label) {
  if (COUPLE_LABELS.includes(label)) return COUPLE_COLOR;
  if (FAMILY_LABELS.includes(label)) return FAMILY_COLOR;
  return null;
}

export function strokeWidthForLabel() {
  return DEFAULT_STROKE_WIDTH;
}

// 顏色沒被手動改過（還是預設色）時，依關係字套用常見關係的預設色；
// 使用者手動選過別的顏色就尊重那個選擇，不覆蓋。
export function effectiveEdgeColor(edge) {
  if (!edge.color || edge.color === DEFAULT_EDGE_COLOR) {
    return presetColorForLabel(edge.label) || DEFAULT_EDGE_COLOR;
  }
  return edge.color;
}

export const DIRECTION_OPTIONS = [
  { value: 'forward', label: '單向（→ 從到）' },
  { value: 'backward', label: '單向（← 到從）' },
  { value: 'both', label: '雙向（↔）' },
  { value: 'none', label: '無方向（— 純線）' },
];
export const UNGROUPED = 'ungrouped';

export function colorId(hex) {
  return (hex || DEFAULT_EDGE_COLOR).replace('#', '');
}

export function hasEndArrow(d) {
  return d.direction === 'forward' || d.direction === 'both' || !d.direction;
}

export function hasStartArrow(d) {
  return d.direction === 'backward' || d.direction === 'both';
}

export function readEdgeStyleFields(data) {
  return {
    direction: DIRECTION_OPTIONS.some((o) => o.value === data.direction) ? data.direction : 'forward',
    color: data.color || DEFAULT_EDGE_COLOR,
    lineStyle: data.lineStyle === 'dashed' ? 'dashed' : 'solid',
  };
}

export async function loadGraphData(bookId) {
  const [groups, nodes, edges] = await Promise.all([
    DB.getByIndex('groups', 'bookId', bookId),
    DB.getByIndex('nodes', 'bookId', bookId),
    DB.getByIndex('edges', 'bookId', bookId),
  ]);
  return { groups, nodes, edges };
}
