// Druck-Umleitung der macOS-Hülle (LFH-721, desktop-huelle: „Drucken erreicht den Systemdialog“).
// `window.print()` tut in WKWebView nichts (LFH-720, Befund 17); hier geht der Aufruf an den
// nativen Druck des Webviews (Command `drucken`, nur für die Server-Origin freigegeben).
//
// KEIN eigenes `beforeprint`/`afterprint`: der native Druck löst `beforeprint` selbst aus
// (gemessen 29.09.2026: ~200 ms nach dem Aufruf, beim Aufbau des Druckbilds) — ein zusätzliches
// Ereignis ließe `useDruckModus` (LFH-22) doppelt schalten. `print()` kehrt sofort zurück (der
// Dialog ist ein Sheet ohne Rückmeldung); ein `afterprint` nach dem Aufruf käme vor dem Druckbild.
(() => {
  const ipc = window.__TAURI_INTERNALS__;
  if (!ipc || typeof ipc.invoke !== 'function') return;
  window.print = () => {
    ipc.invoke('drucken').catch((fehler) => console.error('Drucken nicht möglich:', fehler));
  };
})();
