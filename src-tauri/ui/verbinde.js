// Startseite „Verbinde…“ (LLH-1982): zeigt nur, mit welchem Server die Hülle gerade verbindet.
(() => {
  const server = new URLSearchParams(window.location.search).get('server');
  if (server) document.getElementById('adresse').textContent = server;
})();
