# Design

## Context

- **Router:** Es gibt eine Routenquelle, `appRouten` in `frontend/src/App.tsx`. Sie wird in
  `main.tsx` über `createBrowserRouter` eingehängt, mit react-router ^8.5. Keine Route trägt ein
  `errorElement`. Deshalb zeichnet der Router bei jedem Wurf seine eingebaute Seite an der Wurzel
  und ersetzt die ganze App.
- **Provider:** `ThemeModeProvider`, `AntApp` und `QueryClientProvider` liegen in `main.tsx`
  **außerhalb** des Routers. Sie stehen also auch an der Wurzel noch zur Verfügung.
  `AuthProvider` sitzt dagegen im Wurzelelement `App` und fehlt dort.
- **Vorhandene Zustände** in `components/SeitenZustand.tsx`: `SeitenSkeleton`, `SeitenLeer`,
  `SeitenFehler` (Banner), `SeitenSackgasse` (Großform mit Kante in `alarm`, ein Konsument:
  `EinsatzLayout`) und `SeitenStandVeraltet`. Hinzu kommt die Auffangseite
  `einsatz/SeiteNichtGefunden.tsx` (LLH-1729). Sie zeigt einen `SeitenLeer` mit Rückweg über
  `freiesRueckwegModul` und setzt über `nichtGefundenContext.ts` die Marke „nicht als letzten Ort
  merken“.
- **Detailseiten** zeigen ein fehlendes Objekt auf fünf Arten:
  - `SeitenFehler` mit der Servermeldung „Nicht gefunden“ und „Erneut abrufen“ (Person, Tier,
    Schaden)
  - ein bloßer `Alert` (UHS, Bereitstellungsraum)
  - roter Text (Lagebericht, Befehl)
  - eine stille Weiterleitung per `Navigate` (Betreuungsstelle, Evakuierungsbezirk, Unterkunft)
  - der Zielzustand `SeitenLeer` mit Rückweg (Einheit, Zeitfenster, Einsatzkraft)
- **Query-Parameter-Deeplinks** laufen über `routing/useQueryParamSelektion.ts`. Das Muster heißt
  „apply-then-clean“, es gibt 13 Aufrufer. Ob das Objekt existiert, prüft die
  `anwenden`-Closure: meist mit `some(...)` gegen die Liste, bei Meldungen und Aufträgen über
  einen eigenen Einzelabruf. Ein Fehlschlag bleibt in beiden Fällen unsichtbar.
- **Backend:** Einen Endpunkt für Berichte aus dem Client gibt es nicht. Vorhanden sind
  `log_drossel::Sammelzeile` (eine Zeile je Minute samt Zähler, LFH-925) und die Regeln der
  Eingabegrenzen (`src/AGENTS.md`, Body-Grenze je Route, `*_MAX` je Feld).
- **Routenmuster ohne Kennungen** liefert `routenMuster(appRouten, pfad)` aus
  `rueckmeldung/adresse.ts`; `main.tsx` merkt die Routen dafür schon vor (`merkeRouten`). Die
  Version steht als `__APP_VERSION__` bereit.

## Goals / Non-Goals

**Goals:**
- Kein Wurf einer Seite nimmt den Rahmen mit, und die Standardseite des Routers erscheint nie
  mehr.
- Der Betreuer der Instanz sieht jeden Absturz im Log, ohne dass Daten des Einsatzes dorthin
  gelangen.
- Für „gibt es nicht (mehr)“ gibt es eine Form und einen Helfer, an denen sich jede neue
  Detailseite orientiert.

**Non-Goals:**
- Eine Grenze je Kachel auf Überblick und Lagebild (Folgeaufgabe).
- Fehler außerhalb des Zeichnens (`window.onerror`, `unhandledrejection`): Ein abgelehntes
  Promise einer Mutation meldet die Seite schon selbst.
- Die Ursache des „rolle“-Absturzes bei Personen (eigener Bug).
- Seiten außerhalb des Einsatzrahmens: Stammdaten-Details der Verwaltung und die
  Geräteansichten. Sie behalten ihre heutige Form, die schon einen Rückweg hat.
- Eine Tabelle oder Ansicht für die Berichte.

## Decisions

### D1 Router-`errorElement` an pfadlosen Routen je Rahmen

Jeder Rahmen bekommt unter seiner Layout-Route eine pfadlose Kindroute mit
`errorElement={<Fehlergrenze rahmen="…" />}`, die alle bisherigen Kindrouten umschließt. Das
sind `EinsatzLayout`, `AppLayout`, `AdminLayout`, `GeraeteLayout` und `GeraetEinsatzRahmen`.
Wirft eine Seite, zeichnet der Router das `errorElement` dieser pfadlosen Route im `<Outlet/>`
des Layouts. Der Rahmen bleibt deshalb stehen. Bei jedem Ortswechsel räumt der Router den Fehler
selbst ab, und Fehler beim Nachladen eines lazy Chunks fängt dieselbe Stelle.

Hinzu kommt ein **Wurzelnetz**: `errorElement={<Fehlergrenze rahmen="wurzel" />}` an der
obersten Route (`element={<App/>}`). Dort fehlen `AuthProvider` und alle Rahmen-Kontexte. Diese
Variante zeichnet deshalb eine ganze Seite ohne Sitzung und ohne Einsatzdaten, mit den Auswegen
„Neu laden“ und „Zur Einsatzliste“ (ein Link, kein Router-Kontext nötig). Theme und `AntApp`
liegen außerhalb des Routers und stehen bereit.

Ein Wächter-Test an `appRouten` prüft, dass jede Layout-Route genau eine pfadlose Kindroute mit
`errorElement` trägt und die Wurzel eines hat. Kommt ein neuer Rahmen ohne Grenze dazu, wird er
rot.

*Alternativen:*
- **Klassen-ErrorBoundary um jedes `<Outlet/>`:** Zurücksetzen (Schlüssel auf `pathname`),
  doppelte Meldungen unter StrictMode und Chunk-Fehler müsste man selbst lösen. An der Wurzel
  bliebe trotzdem die Standardseite des Routers, man bräuchte also beides.
- **`errorElement` direkt an der Layout-Route:** Dann ersetzt es das Layout selbst, und der
  Rahmen ginge verloren.

### D2 Form der Fehlergrenze

Die Form ist die der `SeitenSackgasse`: ein Paneel mit Kante in `alarm`, denn hier ist wirklich
etwas gescheitert. Titel „Diese Seite konnte nicht angezeigt werden“, Satz „Der Fehler wurde
gemeldet. Die anderen Module arbeiten weiter.“ (außerhalb des Einsatzes ohne den zweiten Satz).
Primär steht „Neu laden“ (`window.location.reload()`). Ein Neuladen holt auch einen neuen Chunk
nach einem Update und kostet keine ungespeicherte Eingabe anderswo, denn die Seite ist ohnehin
weg. Der zweite Knopf führt an einen sicheren Ort, je nach Rahmen:
- **Einsatz:** „Zum Überblick“. Die Zielwahl teilt sich die Grenze mit `SeiteNichtGefunden`
  über `freiesRueckwegModul`; dafür wird der Teil als kleine Funktion herausgezogen. Der Text
  bleibt „Zum Überblick“, auch wenn das Ziel ein anderes freies Modul ist, denn so steht es in
  der Abstimmung. Das Ziel ist korrekt, die Beschriftung bleibt fest.
- **Ebene 1 und Verwaltung:** „Zur Einsatzliste“.
- **Gerätehülle:** „Zur Startseite“ des Geräts.

`SeitenSackgasse` bekommt dafür keinen neuen Konsumenten. `Fehlergrenze` baut dieselbe
Paneelform, ohne `ursache`-Zeile. Damit bleibt `SeitenSackgasse` bei ihrer Aufgabe, eine
Sackgasse mit „Erneut abrufen“ zu zeigen. Die Fehlermeldung des Wurfs wird nie gezeichnet.

### D3 Bericht: `POST /api/client-fehler`, nur Log

- **Client:** `api/clientFehler.ts` (`meldeClientFehler(fehler, pfad)`) sendet einmal je
  Fehlerobjekt. Doppelte Effekte unter StrictMode fängt ein `WeakSet` der gemeldeten Objekte ab.
  Gesendet wird per `fetch` mit `keepalive: true`, `credentials: 'same-origin'` und den
  Schreibköpfen des API-Clients (`schreibKoepfe()`). Der Bericht läuft **nicht** über
  `apiFetch`: kein Wiederholen, keine Offline-Warteschlange, keine Fehleranzeige. Jeder Fehler
  beim Senden wird verschluckt.
- **Inhalt:**
  - `route`: Routenmuster über `routenMuster`
  - `version`: `__APP_VERSION__`
  - `meldung`: höchstens 500 Zeichen
  - `stack`: höchstens 2000 Zeichen
  Werte aus Props oder Daten kommen nicht hinein.
- **Server:** `routes/client_fehler.rs` nimmt nur an, was eine Sitzung mitbringt
  (`CurrentUser`, sonst 401). Die Route hat eine eigene Body-Grenze
  (`CLIENT_FEHLER_BODY_MAX`, 8 KiB) nach `src/AGENTS.md`, „Eingabegrenzen“. Für die Felder gelten
  `*_MAX` mit 400, auch wenn der Client schon kürzt, denn ein Fremder schickt beliebig viel. Eine
  `static Sammelzeile` lässt höchstens eine `tracing::warn!`-Zeile je Minute durch. Die Zeile
  trägt Route, Version, Meldung, Stack-Anfang und die Zahl seit der letzten Zeile. Benutzer und
  Organisation stehen nicht darin, damit das Log keine Personendaten trägt. Die Antwort ist 204.
  Es gibt keine Datenbank, keine Migration und kein Response-DTO.

*Alternativen:*
- **DB-Tabelle mit Ansicht:** Migration, Aufbewahrungsregel und Oberfläche wären mehr, als die
  Diagnose braucht.
- **Rückmeldeformular:** Es braucht einen Klick und erzeugt ein öffentliches Issue.
- **Ohne Sitzung annehmen:** Das wäre ein offener Schreibweg ins Log. Die Grenze an der Wurzel
  (ohne Sitzung) sendet trotzdem: ist eine Sitzung da, kommt der Bericht an, sonst nicht.

### D4 Ein Baustein für „gibt es nicht (mehr)“

In `components/SeitenZustand.tsx` kommen zwei Teile dazu:
- `SeitenNichtGefunden({ titel, rueckweg })`: die neutrale Form von `SeitenLeer` (es ist kein
  Fehler der Anwendung) mit genau einem Knopf. Der Baustein ruft `useMarkNichtGefunden()` auf,
  damit der Rahmen die Adresse nicht als letzten Ort merkt.
- `istNichtGefunden(error)`: `ApiError` mit Status 404.

Jede Detailseite im Einsatzrahmen entscheidet in einer Zeile:
- `istNichtGefunden` → `SeitenNichtGefunden`
- ein anderer Fehler → `SeitenFehler` mit „Erneut abrufen“
- eine ungültige Kennung in der Adresse (`parseRouteId` liefert `null`) →
  `SeitenNichtGefunden`; das stille `Navigate` entfällt

Den Wortlaut setzt jede Seite selbst in richtiger Grammatik („Diese Person …“, „Diesen
Befehl …“, „Dieses Tier …“), den Rückweg aus `routing/deeplinks.ts` („Zu den Betroffenen“, „Zur
Befehlsliste“ …). Die bestehenden guten Fälle (Einheit, Zeitfenster, Einsatzkraft) wechseln auf
den Baustein; ihr Text bleibt gleich. `einsatz/SeiteNichtGefunden.tsx` behält ihren eigenen Text
„Diese Adresse gibt es im Einsatz nicht“, denn dort fehlt eine Adresse und kein Objekt.

*Alternativen:*
- **Ein zentraler Hook `useDetailAbfrage`, der alle Zustände zeichnet:** Er griffe in
  Hook-Reihenfolge und frühe Rückgaben jeder Seite ein und hätte zu viel Fläche für eine Welle.
- **Ein eigener Fehlercode des Servers mit Objektart:** Das hieße, das Wire-Format über alle
  Detail-Endpunkte zu ändern, unverhältnismäßig.

### D5 Hinweisleiste für Deeplinks auf Unbekanntes

`useQueryParamSelektion` bleibt bei apply-then-clean. Neu:
- `anwenden` darf `false` zurückgeben, das heißt „gibt es nicht“.
- Der Hook gibt eine `DeeplinkHinweisLage` zurück: `{ unbekannt: number | null, melde(id),
  schliesse() }`.
- `melde(id)` ist für die beiden Seiten mit Einzelabruf (Meldungen, Aufträge), die das 404 erst
  später erfahren.

Ein neuer Baustein `DeeplinkHinweis({ lage, sache })` zeichnet über der Liste einen schließbaren
`Alert` vom Typ `info`: „<Sache> #<id> gibt es nicht (mehr)“. Rot kommt nicht in Frage, denn
gescheitert ist nichts in der Anwendung; ein Toast auch nicht, denn Toasts tragen nur Alarme
(`frontend/AGENTS.md`). Jede Seite ruft `schliesse()` in ihrer Wahl-Handlung auf. Ein neuer
Deeplink setzt die Lage neu. Alle 13 Aufrufer stellen um; die `anwenden`-Closures geben nur
zusätzlich `false` zurück, wo sie heute still nichts tun.

*Alternativen:*
- **Leerzustand im Detailpaneel:** Das ginge nur bei Liste-Detail-Seiten. Fahrzeuge, Personal
  und Material hätten dann eine zweite Form.
- **Parameter stehen lassen:** Das widerspräche apply-then-clean, und der Hinweis käme bei jedem
  Neuladen wieder.

### D6 Kontrast-Nachweis zieht auf einen anderen roten Text um

„Befehl nicht gefunden.“ (roter Text) entfällt durch D4. Die e2e-Spec `fehlertext-kontrast`
misst stattdessen „Gebiet konnte nicht geladen werden“ auf der Seite eines
Evakuierungsbezirks. Den Abruf der Zonen lässt sie per `page.route` mit 500 scheitern. Der Text
ist ein `Typography.Text type="danger"` aus derselben globalen Färbung, die Anforderung bleibt
also belegt.

### D7 Anrede und Regeln

Neue Texte sind unpersönlich formuliert. In `frontend/AGENTS.md` kommen zwei Regeln dazu: „Jede
Rahmenebene hat eine Fehlergrenze (pfadlose Route mit `errorElement`), Wächter in `App`-Tests“
und „Ein Objekt, das es nicht (mehr) gibt: `SeitenNichtGefunden`/`istNichtGefunden`,
Query-Deeplink: `DeeplinkHinweis`“. Kapitel 8 der Architekturdoku bekommt einen Abschnitt
„Fehlergrenze und Client-Fehlerbericht“ (Abschnitt 8.16 Logging verweist dorthin). Das
Anwenderkapitel zur Einsatzoberfläche nennt die Fehlerseite und ihre zwei Auswege
(Mitänderungsregel 3, eine neue Sonderlage).

## Risks / Trade-offs

- **[Ein Fehler im Layout selbst fällt bis zur Wurzel und nimmt den Rahmen doch mit]** → Das
  ist für Layouts gewollt, denn ohne heilen Rahmen gibt es keinen sicheren Teilrahmen. Das
  Wurzelnetz hält es wenigstens deutsch und bedienbar.
- **[StrictMode und erneutes Zeichnen melden doppelt]** → Ein `WeakSet` je Fehlerobjekt; dazu
  drosselt der Server.
- **[Ein Fremder mit Sitzung flutet das Log]** → Body-Grenze, `*_MAX` und `Sammelzeile` (eine
  Zeile je Minute). Die Zählung hält fest, wie viele es waren.
- **[Die Sammelzeile verschluckt den Inhalt späterer Berichte bis zur nächsten fälligen
  Zeile]** → Das wird für die Diagnose in Kauf genommen. Der erste Bericht steht sofort im Log,
  ein wiederkehrender Fehler zeigt sich in der Zählung.
- **[Eine Detailseite sieht 404 auch, wenn ihr Einsatz fehlt oder gesperrt ist]** → Der
  Einsatzrahmen fängt einen fehlenden Einsatz schon vorher (`SeitenSackgasse` im
  `EinsatzLayout`). Ein 403 bleibt ein Abruffehler mit „Erneut abrufen“, das Muster gilt nur für
  404.
- **[13 Aufrufer, viele kleine Diffs]** → Jeder bekommt einen Test „unbekannte Kennung zeigt den
  Hinweis“, und ein Grep-Wächter prüft, dass jeder Aufrufer die Lage zeichnet.

## Migration Plan

Keine Datenmigration. Die neue Route ist additiv, der Rückbau ist ein Revert. Eine ältere
Frontend-Version ruft den Endpunkt nicht auf, eine neue gegen einen alten Server bekommt 404 und
verwirft den Bericht still.
