// Resolve the theme before React and CSS paint. Served locally under the existing CSP.
(function () {
  var preference = 'system';
  try { preference = localStorage.getItem('minio-appearance') || 'system'; } catch (_) {}
  var dark = preference === 'abyssus' || (preference !== 'vallum' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'abyssus' : 'vallum';
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
})();
