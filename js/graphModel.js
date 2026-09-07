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
export const EDGE_COLOR_PALETTE = [
  { name: '鼠尾草綠', hex: '#82A3A1' },
  { name: '靜謐藍綠', hex: '#729B98' },
  { name: '霧藍', hex: '#6B8EA7' },
  { name: '風信子紫', hex: '#8F81A3' },
  { name: '珊瑚暖粉', hex: '#D68F85' },
  { name: '蜜桃杏橘', hex: '#DE9B72' },
  { name: '芥末奶油黃', hex: '#E3B04B' },
  { name: '溫潤淺褐', hex: '#9B8265' },
  { name: '暖心磚紅', hex: '#D4726B' },
  { name: '藍灰', hex: '#7B889B' },
  { name: '深灰藍', hex: '#5B6A72' },
  { name: '可可棕', hex: '#8B6B5D' },
];

export function edgeColorNameForHex(hex) {
  const found = EDGE_COLOR_PALETTE.find((c) => c.hex.toLowerCase() === (hex || '').toLowerCase());
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
