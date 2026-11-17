# Tasks

## 1. c11mj7y1 (LLH-1822): Bericht an den Server

- [x] 1.1 `src/routes/client_fehler.rs` mit `POST /api/client-fehler`: Sitzungspflicht
  (`CurrentUser`), `CLIENT_FEHLER_BODY_MAX` als `DefaultBodyLimit` an der Route in `src/app.rs`,
  `*_MAX` für `route`/`version`/`meldung`/`stack` mit 400 nach `src/AGENTS.md`
  „Eingabegrenzen“, `static Sammelzeile` und `tracing::warn!` ohne Benutzer und Organisation,
  Antwort 204. Belegt durch Integrationstests in `tests/`: 204 mit Sitzung, 401 ohne, 413 bei
  übergroßem Body, 400 bei zu langem Feld. Ein Unit-Test zeigt, dass die Sammelzeile die zweite
  Zeile in derselben Minute zurückhält.
- [x] 1.2 `frontend/src/api/clientFehler.ts` (`meldeClientFehler`): Routenmuster über
  `routenMuster`, `__APP_VERSION__`, Kürzen auf 500/2000 Zeichen, `fetch` mit `keepalive`, den
  Schreibköpfen des API-Clients, Dedup per `WeakSet`, verschluckte Fehler. Ein Vitest belegt:
  ein Aufruf je Fehlerobjekt, keine Kennungen im Pfad, kein Wurf bei Netzfehler.
- [x] 1.3 Kapitel 5/8 der Architekturdoku nachziehen (neues Modul `routes/client_fehler`;
  Abschnitt „Fehlergrenze und Client-Fehlerbericht“, Verweis aus 8.16) und den Wächter der
  Architekturdoku grün sehen (`scripts/check-all.sh --nur <Schritt der Architekturdoku>` bzw.
  der zugehörige Test).

## 2. c11mj7y1 (LLH-1822): Fehlergrenze je Rahmen

- [x] 2.1 `frontend/src/components/Fehlergrenze.tsx` (`rahmen`: `einsatz` | `ebene1` | `verwaltung`
  | `geraet` | `wurzel`): `useRouteError`, Paneelform mit Kante in `alarm`, Titel und Satz aus
  D2, „Neu laden“ und der rahmenabhängige zweite Ausweg, Aufruf von `meldeClientFehler` im
  Effekt. Die Rückweg-Wahl im Einsatz teilt sich die Grenze mit `SeiteNichtGefunden` (eine
  herausgezogene Funktion). Belegt durch Vitests je Rahmen: deutscher Text, genau zwei Knöpfe,
  keine Fehlermeldung oder kein Stack im DOM, „Zum Überblick“ führt bei gesperrtem Überblick ins
  erste freie Modul, die Wurzel-Variante zeichnet ohne `AuthProvider`.
- [x] 2.2 `App.tsx`: pfadlose Kindroute mit `errorElement` unter `EinsatzLayout`, `AppLayout`,
  `AdminLayout`, `GeraeteLayout`, `GeraetEinsatzRahmen`, dazu `errorElement` an der Wurzelroute.
  Belegt durch einen Wächter-Test an `appRouten` (jede Layout-Route hat genau eine solche
  Kindroute, die Wurzel ein `errorElement`) und einen Integrationstest über
  `createMemoryRouter(appRouten)`, in dem ein Modul wirft: Rail und Kopf bleiben bedienbar, ein
  Wechsel über die Rail zeigt wieder die normale Seite, genau ein Bericht geht ab.
- [x] 2.3 e2e `frontend/e2e/fehlergrenze.spec.ts`: ein Modul per eingeschleustem Wurf (Route mit
  kaputter Antwort, die beim Zeichnen wirft) zum Absturz bringen. Der Rahmen bleibt, der Text
  ist deutsch, „Unexpected Application Error“ fehlt, ein `POST /api/client-fehler` geht ab. Lauf
  der einen Spec grün.
- [x] 2.4 `frontend/AGENTS.md`: Regel „Jede Rahmenebene hat eine Fehlergrenze“ samt Wächter.
  Anwenderkapitel `docs/anwender/kapitel/einsatz-oberflaeche.md`: Abschnitt zur Fehlerseite und
  ihren zwei Auswegen, unpersönlich formuliert. Den Wächter der Anwenderdoku
  (`anwenderdoku.guard.test.ts`) und Prettier über `frontend/AGENTS.md` grün sehen.

## 3. qick1bpd (LLH-1827): Ein Muster für „gibt es nicht (mehr)“

- [x] 3.1 `components/SeitenZustand.tsx`: `SeitenNichtGefunden({ titel, rueckweg })` (neutrale
  Form, ein Knopf, `useMarkNichtGefunden`) und `istNichtGefunden(error)`. Vitests:
  - kein „Erneut abrufen“, genau ein Knopf mit Ziel
  - die Marke ist gesetzt, solange der Baustein steht
  - `istNichtGefunden` ist nur bei `ApiError` 404 wahr
- [x] 3.2 Detailseiten Person, Tier, Schaden auf das Muster umstellen (404 →
  `SeitenNichtGefunden`, sonst `SeitenFehler`, ungültige Kennung → Muster statt `Navigate`).
  Belegt je Seite durch einen Vitest für 404 (Text, Rückweg, kein „Erneut abrufen“, keine Zeile
  „Nicht gefunden“) und für 500 („Erneut abrufen“ bleibt).
- [x] 3.3 UHS und Bereitstellungsraum (bloßer `Alert`), Lagebericht und Befehl (roter Text)
  umstellen, mit denselben zwei Tests je Seite. `BefehlDetailPage.test.tsx` zieht den neuen
  Wortlaut nach.
- [x] 3.4 Betreuungsstelle, Evakuierungsbezirk und Unterkunft: Das stille `Navigate` entfällt
  zugunsten des Musters. Ein Vitest je Seite zeigt, dass die Adresse bleibt und das Muster
  erscheint.
- [x] 3.5 Einheit, Zeitfenster (`AusgabeAnsicht`) und Einsatzkraft auf `SeitenNichtGefunden`
  umstellen, Wortlaut unverändert. Die vorhandenen Tests bleiben grün, dazu ein neuer Test, der
  die Marke für den letzten Ort prüft.
- [x] 3.6 Profil-Rückweg: Integrationstest, dass nach einer Nicht-gefunden-Detailseite „Zurück“
  aus dem Profil nicht auf deren Adresse führt.

## 4. qick1bpd (LLH-1827): Deeplink auf Unbekanntes

- [x] 4.1 `routing/useQueryParamSelektion.ts`: `anwenden` darf `false` liefern, der Hook gibt die
  `DeeplinkHinweisLage` (`unbekannt`, `melde`, `schliesse`) zurück. Ein neuer Deeplink setzt die
  Lage neu. Die Tests in `useQueryParamSelektion.test.tsx` und `.mutation.test.tsx` werden
  ergänzt: Rückgabe `false` setzt `unbekannt`, der Parameter wird trotzdem geräumt,
  `schliesse` leert die Lage.
- [x] 4.2 `components/DeeplinkHinweis.tsx`: schließbarer `Alert` vom Typ `info`, Text
  „<Sache> #<id> gibt es nicht (mehr)“. Ein Vitest prüft Text, Schließen, keinen Toast und keine
  Rolle `alert`.
- [x] 4.3 Meldungen und Aufträge (Einzelabruf): Ein 404 des Einzelabrufs ruft `melde(id)` auf,
  die Wahl ruft `schliesse()` auf. Vitests: `?meldung=99999` mit 404 zeigt den Hinweis, keine
  Karte ist gewählt, die Adresse ist geräumt; ein Klick auf eine Karte schließt den Hinweis.
- [x] 4.4 Die übrigen Aufrufer (Befehle, Kräfteübersicht, Material, Gefahren, Nachforderungen,
  Fahrzeuge, Personal, Einsatzabschnitte, Einheiten, Erinnerungen, Ablösung, Informationstelefon)
  geben `false` zurück, wo die Existenzprüfung scheitert, und zeichnen `DeeplinkHinweis` über
  ihrer Liste. Je Seite ein Vitest „unbekannte Kennung zeigt den Hinweis“.
- [x] 4.5 e2e `fehlertext-kontrast.spec.ts` auf „Gebiet konnte nicht geladen werden“ umstellen
  (D6, Zonenabruf per `page.route` mit 500). Dazu eine e2e-Probe „`?meldung=99999` zeigt die
  Hinweisleiste“. Lauf beider Specs grün.
- [x] 4.6 `frontend/AGENTS.md`: Regel „Ein Objekt, das es nicht (mehr) gibt“
  (`SeitenNichtGefunden`/`istNichtGefunden`, `DeeplinkHinweis`) am Abschnitt der Zustände bzw.
  „Sprungmarken“. Anwenderkapitel nachziehen, wo es das stille Verschwinden eines Links oder
  „Erneut abrufen“ bei fehlenden Objekten beschreibt (grep über `docs/anwender/kapitel/`).
  Prettier und der Wächter der Anwenderdoku sind grün.

## 5. Integration

- [x] 5.1 `./scripts/check-all.sh --geaendert --ohne-e2e` grün (Backend und Frontend) und die
  e2e-Specs aus 2.3 und 4.5 einzeln grün. (17.11.2026: Bündel `schnell` und `frontend` grün;
  die Rust-Suite passt nicht ins Plattenkontingent der Cloud-Sitzung und läuft in der
  PR-Prüfung, die geänderten Rust-Ziele einzeln grün.)
- [x] 5.2 Nach dem Review vor dem PR (`dev-zunder-orchestrieren`, Phase 4) bestätigte Befunde
  behandelt.

## Workflow follow-up

- `/opsx:archive a12ms7g9-seitenzustaende` im selben Branch vor dem PR (Spec-Sync für
  `seiten-zustaende`, `liste-detail`, `textkontrast-rollen`).
- Bilder der Änderung für den PR: Fehlerseite im Einsatz, Nicht-gefunden-Person, Hinweisleiste
  bei den Meldungen.
- Folgeaufgaben anlegen: „rolle“-Absturz bei Personen nachstellen und beheben; Grenze je Kachel
  auf Überblick und Lagebild.
