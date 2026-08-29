/* ============================================
   auth-gate.js — 访问控制（前端门禁）
   未登录时锁定整个应用：隐藏侧栏/顶栏/内容区，仅显示登录屏，
   登录成功后恢复完整内容。与 Supabase RLS（后端已拒匿名读取）配合，
   杜绝未登录用户通过直接访问网址看到任何文本/数据/接口内容。
   依赖：App.sync（登录状态 getStatus / 登录方法 signIn / 状态回调 onStatus）。
   ============================================ */
(function (global) {
  'use strict';
  var App = global.App || (global.App = {});

  function status() {
    return (App.sync && App.sync.getStatus) ? App.sync.getStatus() : 'signedout';
  }
  function isAuthed() { return status() === 'ok'; }

  // 锁定 / 解锁整个应用（body.auth-locked 控制 CSS：隐藏 app-shell，显示登录屏）
  function apply() {
    var locked = !isAuthed();
    if (locked) {
      document.body.classList.add('auth-locked');
      // 清除已渲染内容，避免 DOM 残留（防御：即便用 devtools 去掉锁定类也看不到数据）
      var vc = document.getElementById('view-container');
      if (vc) vc.innerHTML = '';
    } else {
      document.body.classList.remove('auth-locked');
      // 登录成功 → 重新渲染当前路由，恢复完整内容
      try { if (App.router && App.router.resolve) App.router.resolve(); } catch (e) {}
    }
  }

  function showError(msg) {
    var err = document.getElementById('ag-err');
    if (err) { err.textContent = msg || '登录失败，请重试'; err.style.display = ''; }
  }

  function signIn() {
    var e = document.getElementById('ag-email');
    var p = document.getElementById('ag-pass');
    var email = e ? e.value.trim() : '';
    var pass = p ? p.value : '';
    if (!email || !pass) { showError('请填写邮箱和密码'); return; }
    var err = document.getElementById('ag-err');
    if (err) err.style.display = 'none';
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

    if (status() === 'disabled') renderDisabled();

    if (App.sync && App.sync.onStatus) {
      App.sync.onStatus(function (s, msg) {
        if (s === 'disabled') renderDisabled();
        if (s === 'error') showError(msg);
        apply();
      });
    }
    apply();
  }

  App.auth = { isAuthed: isAuthed, apply: apply };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
