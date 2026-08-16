(function () {
  'use strict';

  function removeBrowserEntrypoints() {
    document.querySelectorAll('button[title="浏览器"], button[aria-label="打开浏览器"]').forEach(function (button) {
      button.remove();
    });
  }

  removeBrowserEntrypoints();
  new MutationObserver(removeBrowserEntrypoints).observe(document.documentElement, {childList:true, subtree:true});
}());
