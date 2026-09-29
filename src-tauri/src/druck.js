// Druck-Umleitung der macOS-Hülle (LFH-721, desktop-huelle: „Drucken erreicht den Systemdialog“).
// `window.print()` tut in WKWebView nichts (LFH-720, Befund 17); hier geht der Aufruf an den
// nativen Druck des Webviews (Command `drucken`, nur für die Server-Origin freigegeben).
(() => {
  const ipc = window.__TAURI_INTERNALS__;
  if (!ipc || typeof ipc.invoke !== 'function') return;
  window.print = () => {
    ipc.invoke('drucken').catch((fehler) => console.error('Drucken nicht möglich:', fehler));
  };
})();
