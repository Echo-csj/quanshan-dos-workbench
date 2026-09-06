/* ============================================
   router.js — 哈希路由
   免服务端配置，file:// 与 GitHub Pages 通吃
   ============================================ */

window.App = window.App || {};

(function() {

  var routes = {};
  var currentRoute = null;
  var currentParams = {};

  // 注册路由
  function register(path, handler) {
    routes[path] = handler;
  }

  // 导航到指定路由
  function navigate(path) {
    window.location.hash = '#' + path;
  }

  // 渲染路由处理器，出错时显示可见错误面板而非整屏空白
  function renderRoute(handler, hash, params) {
    try {
      handler(params || {});
    } catch (err) {
      console.error('[router] 渲染失败 @ ' + hash, err);
      var vc = document.getElementById('view-container');
      if (vc) {
        var esc = (App.util && App.util.escapeHtml) ? App.util.escapeHtml : function (s) { return String(s); };
        vc.innerHTML = '<div style="padding:48px 20px;text-align:center;color:#ef4444;font-family:system-ui,sans-serif">'
          + '<div style="font-size:16px;font-weight:600;margin-bottom:12px">页面渲染出错</div>'
          + '<pre style="text-align:left;white-space:pre-wrap;background:#fafafa;border:1px solid #eee;border-radius:8px;padding:12px;font-size:12px;color:#333;max-width:680px;margin:0 auto;overflow:auto">'
          + esc(err && err.stack ? err.stack : String(err)) + '</pre>'
          + '<div style="margin-top:16px"><button class="btn btn-secondary" onclick="location.reload()">刷新重试</button></div></div>';
      }
    }
  }

  // 解析并执行路由
  function resolve() {
    var hash = window.location.hash.replace('#', '') || '/today';

    // 登录守卫：未登录不渲染任何内容（防止直接访问网址看到数据/接口内容）
    if (!(App.auth && App.auth.isAuthed && App.auth.isAuthed())) {
      var vc = document.getElementById('view-container');
      if (vc) vc.innerHTML = '';
      return;
    }

    // 权限守卫：子台无权访问的模块，重定向到「今日指挥台」
    if (App.perm && App.perm.canView && !App.perm.canView(hash)) {
      navigate('/today');
      return;
    }

    // 精确匹配
    if (routes[hash]) {
      currentRoute = hash;
      currentParams = {};
      renderRoute(routes[hash], hash);
      updateActiveNav(hash);
      return;
    }

    // 参数路由匹配 (如 /projects/:id)
    var matched = false;
    Object.keys(routes).forEach(function(pattern) {
      if (matched) return;
      var paramNames = [];
      var regexPattern = pattern.replace(/:([^/]+)/g, function(_, name) {
        paramNames.push(name);
        return '([^/]+)';
      });
      var regex = new RegExp('^' + regexPattern + '$');
      var match = hash.match(regex);
      if (match) {
        matched = true;
        currentRoute = hash;
        currentParams = {};
        paramNames.forEach(function(name, i) {
          currentParams[name] = match[i + 1];
        });
        renderRoute(routes[pattern], pattern, currentParams);
        updateActiveNav(hash);
      }
    });

    if (!matched && routes['/today']) {
      navigate('/today');
    }
  }

  // 更新侧边栏激活状态
  function updateActiveNav(activePath) {
    document.querySelectorAll('.nav-item').forEach(function(item) {
      var href = item.getAttribute('data-route');
      if (href && activePath.indexOf(href) === 0) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });
  }

  // 监听 hash 变化
  window.addEventListener('hashchange', resolve);

  // 初始化时解析一次
  function init() {
    resolve();
  }

  App.router = {
    register: register,
    navigate: navigate,
    resolve: resolve,
    getCurrentRoute: function() { return currentRoute; },
    getParams: function() { return currentParams; },
    init: init
  };

})();
