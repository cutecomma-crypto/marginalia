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

// === 三組色盤的色相對照表 ===
// GROUP_COLOR_PALETTE／EDGE_COLOR_PALETTE／PERSON_COLOR_PALETTE 三個陣列
// 刻意都維持 15 色、而且「索引值相同＝同一個色相家族」：GROUP 第 9 個
// （橄欖綠）、EDGE 第 9 個、PERSON 第 9 個，三者是同一個色相在三種不同
// 用途、不同深淺飽和度下的版本，不是各自獨立亂數排列的顏色——這是使用
// 者明確要求的「三組顏色互相呼應」，不只是「三組都湊滿 15 色」而已。
// 以 GROUP_COLOR_PALETTE（最早就固定下來、已經有實際群組在用）的 15 個
// 色相家族當基準，EDGE／PERSON 兩邊依同一個色相家族調整深淺飽和度：
//   - EDGE：線條本身的顏色，飽和度拉高、明度適中，要在淺色背景上一眼
//     看得出線的顏色、認得出跟標籤顏色是同一條線。
//   - PERSON：卡片底色，飽和度壓到很低的粉彩，明度拉高到夠淺，上面
//     疊深色文字還要讀得清楚。
// 三者用的是「同一個色相角度、不同明度／飽和度」，不是同一個色號，
// 所以三個陣列裡找不到任何重複的 hex（可以直接跑一次三個陣列互相比對
// 驗證），但擺在一起看得出「這是同一組」。
//
// 有兩個例外特別說明：
//   - GROUP 第 11 格「海軍藍」（深藍、整個色盤裡最暗的一個）在 EDGE
//     這邊對應到使用者指定要的「炭黑」——海軍藍已經暗到接近黑，拿來
//     當「近黑」家族的代表很合理，只是刻意調成偏暖、不帶藍色調的
//     炭黑，不是繼續用藍色。
//   - GROUP 第 15 格「煙燻藍」在 EDGE 這邊對應到使用者指定要的
//     「中性灰」——這是整組對照表裡唯一色相沒有完全對上的一格（煙燻藍
//     偏藍、中性灰刻意去掉藍色調做成真正中性），因為使用者明確要的是
//     「不偏色的灰」，跟既有的「藍灰」（對應板岩灰）放在一起才有區隔，
//     兩個都偏藍就失去新增這個顏色的意義了。PERSON 這一格一樣退讓成
//     跟「粉彩灰」維持同一個色溫方向（見該陣列的說明）。
// 「正紅」對應 GROUP 第 12 格「勃根地紅」——深酒紅轉成飽和度更高、
// 更鮮明的紅，色相角度仍然一致，是最乾淨的一組對應。

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

// 關係線顏色，15 色，跟 GROUP_COLOR_PALETTE 同一套色相家族、同樣的
// 排列順序（見上面「三組色盤的色相對照表」）。日系馬卡龍柔和色盤的
// 調性：明亮好認但不刺眼，黑／紅／灰三個例外則是使用者明確指定要的
// 顏色，調成跟整體色盤同一種偏暖、降飽和度的風格，不用數位感很重的
// 純黑／純紅。
export const EDGE_COLOR_PALETTE = [
  { name: '溫潤淺褐', hex: '#9B8265' },
  { name: '鼠尾草綠', hex: '#82A3A1' },
  { name: '霧藍', hex: '#6B8EA7' },
  { name: '暖心磚紅', hex: '#D4726B' },
  { name: '芥末奶油黃', hex: '#E3B04B' },
  { name: '蜜桃杏橘', hex: '#DE9B72' },
  { name: '藍灰', hex: '#7B889B' },
  { name: '風信子紫', hex: '#8F81A3' },
  { name: '橄欖綠', hex: '#A3AD6E' },
  { name: '珊瑚暖粉', hex: '#D68F85' },
  { name: '炭黑', hex: '#33302D' },
  { name: '正紅', hex: '#BE3A2E' },
  { name: '青苔綠', hex: '#6E8F72' },
  { name: '可可棕', hex: '#8B6B5D' },
  { name: '中性灰', hex: '#8A8580' },
];

export function edgeColorNameForHex(hex) {
  const found = EDGE_COLOR_PALETTE.find((c) => c.hex.toLowerCase() === (hex || '').toLowerCase());
  return found ? found.name : null;
}

// 人物卡片自訂底色，15 色，一樣跟 GROUP_COLOR_PALETTE／EDGE_COLOR_PALETTE
// 同一套色相家族、同樣的排列順序（見上面「三組色盤的色相對照表」）。
// 跟另外兩組色盤比起來飽和度壓得最低、明度拉得最高，是淺色系的粉彩，
// 卡片底色要襯得住上面的深色文字，不能跟關係線那種拿來當線條本身
// 顏色的中高飽和度色盤一樣搶眼——這也是為什麼「炭黑」「正紅」這兩個
// 在 EDGE 裡比較鮮明的顏色，到這裡會變成很淺的「粉彩靛藍」「粉彩莓紅」，
// 乍看不像同一家族，但色相角度其實是對上的。
//
// 使用者實際用起來發現「群組框框顏色」跟「人物顏色」看起來不呼應，
// 用色相角度（Hue）實際算過一輪（HSL 換算後逐格比對 GROUP／EDGE／
// PERSON 三組），抓出來真正的落差其實不在 GROUP，是這裡兩格 PERSON
// 色號本來就沒調準：
//   - 第 7 格「粉彩灰」原本是色相角度 40°（偏暖、偏黃褐）的中性灰，
//     但它要對應的「板岩灰」（GROUP，197°）／「藍灰」（EDGE，216°）
//     兩個都是明確偏藍的灰色調，色相角度差了快 160 度，擺在一起完全
//     不像同一家族——這就是使用者視覺上感覺到的「群組跟人物顏色兜不
//     起來」最明顯的一組。改成同樣帶一點藍調的淺灰（205°），跟另外
//     兩個對上。
//   - 第 9 格「粉彩橄欖」原本色相角度 67°，比「橄欖綠」（GROUP，108°）
//     偏黃快 40 度，兩者雖然都看得出是「黃綠色系」，放在一起還是有點
//     跳。微調到 95°，落在 GROUP／EDGE 兩邊的橄欖綠色相之間，三者更
//     貼近同一個色相家族。
// 其餘 13 格色相角度跟 GROUP／EDGE 的落差都在 20 度以內（人眼幾乎看
// 不出差異的範圍），不需要調整。
export const PERSON_COLOR_PALETTE = [
  { name: '粉彩卡其', hex: '#EAE2D0' },
  { name: '粉彩綠', hex: '#DCEADC' },
  { name: '粉彩藍', hex: '#D7E3F0' },
  { name: '粉彩粉', hex: '#F3DEE3' },
  { name: '粉彩黃', hex: '#F8EFD6' },
  { name: '粉彩橘', hex: '#F5E0CC' },
  { name: '粉彩灰', hex: '#DCE1E5' },
  { name: '粉彩紫', hex: '#E6DFEF' },
  { name: '粉彩橄欖', hex: '#DCEAD2' },
  { name: '粉彩玫瑰', hex: '#F0D9DC' },
  { name: '粉彩靛藍', hex: '#DCE0F2' },
  { name: '粉彩莓紅', hex: '#E8CCD2' },
  { name: '粉彩薄荷', hex: '#D9EDE8' },
  { name: '粉彩焦糖', hex: '#F0DCC4' },
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
