// Resolve the theme before React and CSS paint. Served locally under the existing CSP.
(function () {
  var preference = 'system';
  try { preference = localStorage.getItem('minio-appearance') || 'system'; } catch (_) {}
  var dark = preference === 'abyssus' || (preference !== 'vallum' && matchMedia('(prefers-color-scheme: dark)').matches);
  var root = document.documentElement;
  root.dataset.theme = dark ? 'abyssus' : 'vallum';
  root.style.colorScheme = dark ? 'dark' : 'light';

  var icon = document.getElementById('minio-favicon');
  if (icon) {
    var updateIcon = function () {
      var href = icon.dataset[root.dataset.theme];
      if (href && icon.getAttribute('href') !== href) icon.setAttribute('href', href);
    };
    updateIcon();
    new MutationObserver(updateIcon).observe(root, { attributeFilter: ['data-theme'] });
  }
})();
