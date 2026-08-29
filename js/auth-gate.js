/* ============================================
   auth-gate.js — 访问控制（前端门禁）
   未登录时锁定整个应用：隐藏侧栏/顶栏/内容区，仅显示登录屏，
   登录成功后恢复完整内容。与 Supabase RLS（后端已拒匿名读取）配合，
   杜绝未登录用户通过直接访问网址看到任何文本/数据/接口内容。
   依赖：App.sync（登录状态 getStatus / 登录方法 signIn / 状态回调 onStatus）。

   登录体验增强：
   - 记住邮箱：仅在本机保存邮箱用于下次自动填充；绝不保存密码。明文密码
     是安全隐患，已改为依赖 Supabase 会话持久化实现「保持登录」。
   - 状态反馈：点击登录后立即进入「加载中」态，成功显示「登录成功 ✓」，
     失败显示明确错误；退出登录后立即重新锁屏并清空已渲染内容。
   ============================================ */
(function (global) {
  'use strict';
  var App = global.App || (global.App = {});

  var REMEMBER_KEY = 'ca_remember';   // 仅存邮箱（不存密码）
  var prevStatus = null;

  function status() {
    return (App.sync && App.sync.getStatus) ? App.sync.getStatus() : 'signedout';
  }
  function isAuthed() { return status() === 'ok'; }

  /* ---------------- 记住邮箱（本地持久化，只存邮箱） ---------------- */
  function loadRemember() {
    try {
      var raw = localStorage.getItem(REMEMBER_KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      // 迁移：清掉历史版本遗留的明文密码，只保留邮箱
      if (o && o.password) {
        var clean = { email: typeof o.email === 'string' ? o.email : '' };
        try { localStorage.setItem(REMEMBER_KEY, JSON.stringify(clean)); } catch (e) {}
        return clean;
      }
      if (o && typeof o.email === 'string') return o;
    } catch (e) {}
    return null;
  }
  function saveRemember(email) {
    try { localStorage.setItem(REMEMBER_KEY, JSON.stringify({ email: email })); } catch (e) {}
  }
  function clearRemember() {
    try { localStorage.removeItem(REMEMBER_KEY); } catch (e) {}
  }

  /* ---------------- 视觉反馈 ---------------- */
  function setLoading(on) {
    var btn = document.getElementById('ag-login');
    var label = btn && btn.querySelector('.ag-btn-label');
    var spin = btn && btn.querySelector('.ag-spinner');
    if (!btn) return;
    btn.disabled = !!on;
    if (btn.classList) btn.classList.toggle('loading', !!on);
    if (label) label.textContent = on ? '登录中…' : '登录';
    if (spin) spin.style.display = on ? '' : 'none';
  }
  function showError(msg) {
    setLoading(false);
    var err = document.getElementById('ag-err');
    var ok = document.getElementById('ag-ok');
    if (ok) ok.style.display = 'none';
    if (err) { err.textContent = msg || '登录失败，请重试'; err.style.display = ''; }
  }
  function showSuccess() {
    var btn = document.getElementById('ag-login');
    var label = btn && btn.querySelector('.ag-btn-label');
    var spin = btn && btn.querySelector('.ag-spinner');
    var ok = document.getElementById('ag-ok');
    var err = document.getElementById('ag-err');
    if (err) err.style.display = 'none';
    if (btn && btn.classList) btn.classList.add('success');
    if (label) label.textContent = '登录成功';
    if (spin) spin.style.display = 'none';
    if (ok) { ok.textContent = '登录成功 ✓ 正在进入…'; ok.style.display = ''; }
  }

  function signIn() {
    var e = document.getElementById('ag-email');
    var p = document.getElementById('ag-pass');
    var rem = document.getElementById('ag-remember');
    var email = e ? e.value.trim() : '';
    var pass = p ? p.value : '';
    if (!email || !pass) { showError('请填写邮箱和密码'); return; }
    var err = document.getElementById('ag-err');
    if (err) err.style.display = 'none';
    setLoading(true);   // 立即进入加载态，避免“点击无响应”
    // 记住邮箱：勾选则保存邮箱，未勾选则清除（不保存密码）
    if (rem && rem.checked) saveRemember(email);
    else clearRemember();
    App.sync.signIn(email, pass);
  }

  // 云端未配置（APP_CONFIG 为 YOUR_ 占位）时无登录能力，给出提示
  function renderDisabled() {
    var form = document.getElementById('ag-form');
    var off = document.getElementById('ag-offline');
    if (form) form.style.display = 'none';
    if (off) off.style.display = '';
  }

  function init() {
    var btn = document.getElementById('ag-login');
    if (btn) btn.onclick = signIn;
    var pass = document.getElementById('ag-pass');
    if (pass) pass.onkeydown = function (ev) { if (ev.key === 'Enter') signIn(); };

    // 回显已记住的邮箱（仅邮箱，不存密码）
    var rem = loadRemember();
    if (rem && rem.email) {
      var e = document.getElementById('ag-email');
      var cb = document.getElementById('ag-remember');
      if (e) e.value = rem.email;
      if (cb) cb.checked = true;
    }

    if (status() === 'disabled') renderDisabled();

    if (App.sync && App.sync.onStatus) {
      App.sync.onStatus(function (s, msg) {
        if (s === 'disabled') renderDisabled();
        if (s === 'signingin') { setLoading(true); }
        else if (s === 'error') { showError(msg); }
        else if (s === 'ok') {
          // 仅当本次是“主动登录”流程才展示成功态；页面加载即带有效会话则直接解锁
          if (prevStatus === 'signingin') {
            showSuccess();
            setTimeout(function () { apply(); }, 650);
          } else {
            apply();
          }
        }
        else if (s === 'signedout') {
          setLoading(false);
          apply();   // 退出登录 → 立即重新锁屏并清空已渲染内容
        }
        prevStatus = s;
      });
    }
    apply();
  }

  // 锁定 / 解锁整个应用（body.auth-locked 控制 CSS：隐藏 app-shell，显示登录屏）
  function apply() {
    var locked = !isAuthed();
    if (locked) {
      document.body.classList.add('auth-locked');
      // 清除已渲染内容，避免 DOM 残留（防御：即便用 devtools 去掉锁定类也看不到数据）
      var vc = document.getElementById('view-container');
      if (vc) vc.innerHTML = '';
      // 回到锁定态时复位按钮与密码框（防止残留 success/loading 样式与明文密码）
      var btn = document.getElementById('ag-login');
      if (btn && btn.classList) btn.classList.remove('success', 'loading');
      setLoading(false);
      var pass = document.getElementById('ag-pass');
      if (pass) pass.value = '';
    } else {
      document.body.classList.remove('auth-locked');
      // 登录成功 → 重新渲染当前路由，恢复完整内容
      try { if (App.router && App.router.resolve) App.router.resolve(); } catch (e) {}
    }
  }

  App.auth = { isAuthed: isAuthed, apply: apply };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
