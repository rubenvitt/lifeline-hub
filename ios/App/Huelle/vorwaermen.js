// Vorwärmen der Assets für den Start ohne Server (LLH-1980; Regeln: ios/AGENTS.md).
//
// Die Hülle führt diese Datei per `callAsyncJavaScript` als Funktionsrumpf in der Seite des
// aktiven Servers aus, mit den Argumenten `pfade` (aus `GET /api/shell`, vom Kern geprüft) und
// `gleichzeitig`. Jeder Abruf läuft im Webview selbst, damit die Antwort im HTTP-Cache seines
// Datenspeichers landet; den Körper liest das Skript ganz, sonst bricht WebKit den Eintrag ab.
// Ergebnis: `{ ok, fehler }`, `fehler` mit den Pfaden, die nicht ankamen. Getestet von
// frontend/src/huelle/iosVorwaermen.test.ts.
const offen = [...pfade];
const fehler = [];
let ok = 0;

async function arbeite() {
  for (let pfad = offen.shift(); pfad !== undefined; pfad = offen.shift()) {
    try {
      const antwort = await fetch('/' + pfad, { cache: 'force-cache', credentials: 'same-origin' });
      await antwort.arrayBuffer();
      if (antwort.ok) {
        ok += 1;
      } else {
        fehler.push(pfad);
      }
    } catch {
      fehler.push(pfad);
    }
  }
}

const arbeiter = [];
for (let i = 0; i < Math.max(1, gleichzeitig); i += 1) {
  arbeiter.push(arbeite());
}
await Promise.all(arbeiter);
return { ok, fehler };
