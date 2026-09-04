// 獨立、可插拔模組：純本機、不連網的語音朗讀，直接包裝瀏覽器原生
// window.speechSynthesis。跟 Marginalia 其餘 local-first 的原則完全一致——
// 不會把任何文字送出裝置。

import { ICON_VOLUME } from '../icons.js';

export function isSpeechSupported() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

let currentUtterance = null;

export function speak(text, { rate = 1, voiceName, lang = 'zh-TW' } = {}) {
  if (!isSpeechSupported() || !text || !text.trim()) return null;
  stop();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = Math.min(1.5, Math.max(0.8, rate));
  utterance.lang = lang;
  if (voiceName) {
    const voice = window.speechSynthesis.getVoices().find((v) => v.name === voiceName);
    if (voice) utterance.voice = voice;
  }
  currentUtterance = utterance;
  window.speechSynthesis.speak(utterance);
  return utterance;
}

export function stop() {
  if (isSpeechSupported()) window.speechSynthesis.cancel();
  currentUtterance = null;
}

export function isSpeaking() {
  return isSpeechSupported() && window.speechSynthesis.speaking;
}

export function getAvailableVoices() {
  if (!isSpeechSupported()) return [];
  return window.speechSynthesis.getVoices();
}

// 「全頁朗讀」：把一個容器裡的可見文字整段唸出來（用 innerText，不含 <script>／
// 隱藏元素這類非顯示內容），例如整篇閱讀後輸出或整區筆記。
export function speakElement(el, options = {}) {
  if (!el) return null;
  const text = el.innerText || el.textContent || '';
  return speak(text, options);
}

// 小型朗讀速度控制列，掛在呼叫端指定的容器裡；純 UI 元件，不綁定特定頁面結構。
// getText()：呼叫端提供，回傳「現在應該唸什麼」（例如目前選取的文字、或整個容器）。
export function renderSpeechControls(container, { getText }) {
  container.innerHTML = `
    <div class="speech-controls">
      <button type="button" id="speech-play-btn" aria-label="朗讀">${ICON_VOLUME}</button>
      <input type="range" id="speech-rate-input" min="0.8" max="1.5" step="0.1" value="1" aria-label="朗讀速度">
      <span id="speech-rate-label">1.0x</span>
      <button type="button" id="speech-stop-btn" aria-label="停止朗讀">⏹️</button>
    </div>
  `;
  const rateInput = container.querySelector('#speech-rate-input');
  const rateLabel = container.querySelector('#speech-rate-label');

  container.querySelector('#speech-play-btn').addEventListener('click', () => {
    speak(getText(), { rate: Number(rateInput.value) });
  });
  container.querySelector('#speech-stop-btn').addEventListener('click', stop);
  rateInput.addEventListener('input', () => {
    rateLabel.textContent = `${Number(rateInput.value).toFixed(1)}x`;
  });
}
