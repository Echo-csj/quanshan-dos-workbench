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

  // 解析并执行路由
  function resolve() {
    var hash = window.location.hash.replace('#', '') || '/today';

    // 精确匹配
    if (routes[hash]) {
      currentRoute = hash;
      currentParams = {};
      routes[hash]();
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
        routes[pattern](currentParams);
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

    // 移动端 tab 更新
    document.querySelectorAll('.mobile-tab').forEach(function(tab) {
      var href = tab.getAttribute('data-route');
      if (href && activePath.indexOf(href) === 0) {
        tab.classList.add('active');
      } else {
        tab.classList.remove('active');
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
