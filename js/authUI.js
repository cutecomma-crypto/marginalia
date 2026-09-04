// Header 右側的登入狀態徽章 + 登入／註冊／忘記密碼／設定新密碼 Modal。
// 沿用既有的 .modal-backdrop／.modal-card／.modal-actions／.btn／.btn-primary
// class（跟 categories.js 的自訂分類管理彈窗同一套），沒有新增任何顏色變數——
// 配色完全繼承現有的奶油米＋深紅棕＋靈魂粉紅設計系統。
import { escapeHtml, showToast, initPasswordToggles } from './utils.js';
import { isSupabaseConfigured } from './config.js';
import {
  signUp, signIn, signOut, resetPasswordForEmail, updatePassword,
  getCurrentUser, onAuthStateChange, ensureAuthReady,
} from './services/authService.js';
import { loadCloudCategoriesIntoCache, clearCloudCategoriesCache } from './categories.js';
import { maybeOfferCloudMigration } from './cloudMigration.js';
import { clearAllCache } from './services/cloudCache.js';

function initialOf(user) {
  const source = user.user_metadata?.nickname || user.email || '?';
  return source.trim().charAt(0).toUpperCase();
}

function nicknameOf(user) {
  return user.user_metadata?.nickname || (user.email || '').split('@')[0];
}

function renderLoggedOut(slot) {
  slot.innerHTML = '<button type="button" class="auth-login-btn" id="auth-login-btn">登入</button>';
  slot.querySelector('#auth-login-btn').addEventListener('click', () => openAuthModal('login'));
}

function renderLoggedIn(slot, user) {
  slot.innerHTML = `
    <div class="auth-status">
      <span class="auth-avatar" title="${escapeHtml(user.email || '')}">${escapeHtml(initialOf(user))}</span>
      <span class="auth-nickname">👤 ${escapeHtml(nicknameOf(user))}</span>
      <button type="button" class="auth-logout-btn" id="auth-logout-btn">登出</button>
    </div>
  `;
  slot.querySelector('#auth-logout-btn').addEventListener('click', async () => {
    await signOut();
    showToast('已登出');
  });
}

async function renderAuthSlot() {
  const slot = document.getElementById('auth-status-slot');
  if (!slot) return;
  await ensureAuthReady();
  const user = getCurrentUser();
  if (user) renderLoggedIn(slot, user);
  else renderLoggedOut(slot);
}

// 註冊成功的精緻提示：原本跟登入成功一樣只跳一句 Toast，訊息一閃即逝、
// 份量感也跟「帳號正式建立」這件事不太搭——改成一個獨立的奶油米色系
// 彈窗（見 css/styles.css 的 .auth-info-modal），文案照 signUp() 實際回傳
// 的結果分兩種講法：Supabase 專案關掉「Confirm email」要求時 signUp()
// 當下就直接給一個可用的 session（已經自動登入，不需要再登入一次），
// 開著的話 session 會是 null（要等使用者點驗證信裡的連結才能登入）——
// 兩種情況文案不一樣，不要不管實際狀態一律都叫使用者「請登入」。
function showRegisterSuccessModal(hasSession) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal-card auth-info-modal" role="alertdialog" aria-modal="true" aria-labelledby="auth-info-title">
      <div class="auth-info-icon">🎉</div>
      <h3 id="auth-info-title">註冊成功！</h3>
      <p class="auth-info-message">${hasSession ? '已自動登入，開始使用 Marginalia 記錄你的閱讀吧。' : '請至信箱收取驗證信，完成驗證後即可登入。'}</p>
      <div class="modal-actions">
        <button type="button" class="btn btn-primary" id="auth-info-ok-btn">${hasSession ? '開始使用' : '好，我知道了'}</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  function close() {
    document.removeEventListener('keydown', onKeydown);
    backdrop.remove();
  }
  function onKeydown(event) { if (event.key === 'Escape') close(); }
  backdrop.addEventListener('mousedown', (event) => { if (event.target === backdrop) close(); });
  backdrop.querySelector('#auth-info-ok-btn').addEventListener('click', close);
  document.addEventListener('keydown', onKeydown);
  backdrop.querySelector('#auth-info-ok-btn').focus();
}

// 登入／註冊／忘記密碼共用同一個 Modal，用 mode 切換標題、按鈕文字跟要不要顯示
// 密碼欄位；「設定新密碼」是第 4 種 mode，只有從忘記密碼信裡的連結點回來才會用到
// （見檔案最下面的 handlePasswordRecoveryRedirect）。
function openAuthModal(initialMode = 'login') {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal-card auth-modal-card" role="dialog" aria-modal="true" aria-labelledby="auth-modal-title">
      <h3 id="auth-modal-title">登入</h3>
      <p class="auth-modal-error" id="auth-modal-error" hidden></p>
      <form id="auth-modal-form">
        <label for="auth-email-input" id="auth-email-label">Email
          <input type="email" id="auth-email-input" required autocomplete="email">
        </label>
        <label for="auth-password-input" id="auth-password-label">密碼
          <div class="password-field">
            <input type="password" id="auth-password-input" required autocomplete="current-password" minlength="6">
            <button type="button" class="password-toggle-btn" data-target="auth-password-input" aria-label="顯示密碼">👁️</button>
          </div>
        </label>
        <div class="modal-actions">
          <button type="button" class="btn" id="auth-cancel-btn">取消</button>
          <button type="submit" class="btn btn-primary" id="auth-submit-btn">登入</button>
        </div>
      </form>
      <div class="auth-modal-switch" id="auth-modal-switch"></div>
    </div>
  `;
  document.body.appendChild(backdrop);
  initPasswordToggles(backdrop);

  const titleEl = backdrop.querySelector('#auth-modal-title');
  const errorEl = backdrop.querySelector('#auth-modal-error');
  const form = backdrop.querySelector('#auth-modal-form');
  const emailLabel = backdrop.querySelector('#auth-email-label');
  const emailInput = backdrop.querySelector('#auth-email-input');
  const passwordLabel = backdrop.querySelector('#auth-password-label');
  const passwordInput = backdrop.querySelector('#auth-password-input');
  const submitBtn = backdrop.querySelector('#auth-submit-btn');
  const switchEl = backdrop.querySelector('#auth-modal-switch');

  let mode = initialMode; // 'login' | 'register' | 'forgot' | 'reset'

  function showError(message) {
    errorEl.textContent = message;
    errorEl.hidden = false;
  }
  function clearError() {
    errorEl.hidden = true;
  }

  function wireSwitchLinks() {
    switchEl.querySelectorAll('.link-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        mode = btn.dataset.mode;
        applyMode();
      });
    });
  }

  function applyMode() {
    clearError();
    passwordInput.value = '';
    emailLabel.hidden = mode === 'reset';
    emailInput.required = mode !== 'reset';
    passwordLabel.hidden = mode === 'forgot';
    passwordLabel.firstChild.textContent = mode === 'reset' ? '新密碼' : '密碼';
    passwordInput.required = mode !== 'forgot';
    passwordInput.autocomplete = mode === 'register' || mode === 'reset' ? 'new-password' : 'current-password';
    if (mode === 'login') {
      titleEl.textContent = '登入';
      submitBtn.textContent = '登入';
      switchEl.innerHTML = '還沒有帳號？<button type="button" class="link-btn" data-mode="register">註冊</button>　'
        + '<button type="button" class="link-btn" data-mode="forgot">忘記密碼</button>';
    } else if (mode === 'register') {
      titleEl.textContent = '註冊帳號';
      submitBtn.textContent = '註冊';
      switchEl.innerHTML = '已經有帳號？<button type="button" class="link-btn" data-mode="login">登入</button>';
    } else if (mode === 'forgot') {
      titleEl.textContent = '忘記密碼';
      submitBtn.textContent = '寄送重設密碼信';
      switchEl.innerHTML = '想起密碼了？<button type="button" class="link-btn" data-mode="login">登入</button>';
    } else {
      titleEl.textContent = '設定新密碼';
      submitBtn.textContent = '更新密碼';
      switchEl.innerHTML = '';
    }
    wireSwitchLinks();
    (mode === 'reset' ? passwordInput : emailInput).focus();
  }
  applyMode();

  function close() {
    document.removeEventListener('keydown', onKeydown);
    backdrop.remove();
  }
  function onKeydown(event) {
    if (event.key === 'Escape') close();
  }
  backdrop.addEventListener('mousedown', (event) => { if (event.target === backdrop) close(); });
  backdrop.querySelector('#auth-cancel-btn').addEventListener('click', close);
  document.addEventListener('keydown', onKeydown);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearError();
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    submitBtn.disabled = true;
    try {
      if (mode === 'login') {
        await signIn(email, password);
        showToast('登入成功');
        close();
      } else if (mode === 'register') {
        // Supabase 專案的「Confirm email」設定決定 signUp() 完成當下是不是已經直接
        // 拿到一個可用的 session（關掉驗證信要求時就是；沒關掉的話 session 會是 null，
        // 要等使用者點信裡的連結才會有）——Toast 文案照實際結果講，不要不管設定
        // 一律都叫使用者去收信，關掉驗證信的情境下根本沒有信可收。
        const { session } = await signUp(email, password);
        close();
        showRegisterSuccessModal(Boolean(session));
      } else if (mode === 'forgot') {
        await resetPasswordForEmail(email);
        showToast('已寄出重設密碼信，請至信箱收取');
        close();
      } else {
        await updatePassword(password);
        showToast('密碼已更新');
        close();
      }
    } catch (err) {
      showError(err.message || '發生錯誤，請再試一次。');
    } finally {
      submitBtn.disabled = false;
    }
  });

  return backdrop;
}

// 忘記密碼信裡的連結會把使用者導回這個網站、網址帶著 #access_token=...&type=recovery
// 這種 hash 片段——這個站台本身用 hash 當路由（#/books 之類），所以這裡讀完就立刻
// 把 hash 清乾淨、換成 #/books，不留一段 token 字串卡在網址列，也不會被 app.js 的
// 路由器誤判成一個奇怪的頁面路徑。Supabase client 初始化時已經自動吃掉這段 hash、
// 建立一個暫時的 recovery session（見 supabaseClient.js／authService.js），這裡只需要
// 判斷「網址曾經帶著 type=recovery」就跳出「設定新密碼」的表單。
function handlePasswordRecoveryRedirect() {
  if (!window.location.hash.includes('type=recovery')) return;
  history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/books`);
  openAuthModal('reset');
}

export async function initAuthUI() {
  if (!isSupabaseConfigured()) return; // 沒設定 Supabase：不掛任何 UI、不監聽，本機模式維持原樣
  await renderAuthSlot();
  handlePasswordRecoveryRedirect();
  onAuthStateChange(async (user, event) => {
    await renderAuthSlot();
    if (user) {
      await loadCloudCategoriesIntoCache();
      // 只有「這次真的是使用者剛登入」（event === 'SIGNED_IN'）才做一次完整的
      // 本機／雲端比對＋補同步提示——網頁重新整理時 Supabase 用 INITIAL_SESSION
      // 事件把已經登入過的 session 還原回來（見 authService.js 的 ensureReady()
      // 開頭說明），這種情況資料狀態根本沒有任何改變，沒有必要每次重新整理都
      // 重新抓一次全部書籍、全部願望清單、算一次指紋比對——這正是拖慢「重新
      // 整理」速度、也在 Console 洗一堆比對紀錄的元兇。真的有漏同步的資料，
      // 使用者可以到「資料管理」頁手動點「檢查雲端同步」主動觸發（見 backup.js）。
      if (event === 'SIGNED_IN') {
        await maybeOfferCloudMigration();
      }
    } else {
      clearCloudCategoriesCache();
      // 登出後清掉雲端資料的本機鏡像快取（見 cloudCache.js）：同一台裝置、
      // 同一個瀏覽器之後可能換別人登入，快取內容不該一直留在 IndexedDB 裡。
      await clearAllCache();
    }
  });
}
