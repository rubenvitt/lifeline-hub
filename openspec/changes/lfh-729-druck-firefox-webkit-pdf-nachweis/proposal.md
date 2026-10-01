# Proposal

## Why

Der Druck im normalen Fluss soll laut Auftraggeber in Chromium, Firefox und Safari halten
(Spec `druck-dokumente`, „Mehrseitiger Druck in allen drei Browsern“). Automatisch belegt ist
er heute nur in Chromium. Firefox und Safari prüft vor jedem Merge ein Mensch von Hand nach
der Prüfliste aus LFH-22. Zwei Zusagen sind auch in Chromium nur von Hand prüfbar: das Logo im
Druckkopf und die Seitenzählung „Seite n von m“. Der e2e-Spec sagt selbst, dass er den PDF-Text
nicht liest, weil der Text subsetted und komprimiert ist. Eine Regression in einer dieser
Stellen fiele erst auf, wenn jemand auf Papier nachsieht (LFH-729, Folge aus LFH-22/LFH-71,
Epic LFH-60).

## What Changes

- **Playwright-Projekte `firefox` und `webkit`**, beschränkt auf die beiden Druck-Specs
  `e2e/druck-fluss.spec.ts` und `e2e/etb-druck.spec.ts`. Dort laufen die Aussagen zur
  Druckmechanik (Wurzel im Fluss, Rahmen `display: none`, Endmarke jenseits Seite 1,
  `thead` als `table-header-group`) unter der CSS-Engine des jeweiligen Browsers. Die Schritte
  mit `page.pdf()` bleiben Chromium vorbehalten, denn nur Chromium kann ein PDF erzeugen.
- **PDF-Nachweis in Chromium:** Ein Textauszug aus dem erzeugten PDF belegt je Seite die
  Seitenzählung „Seite n von m“ (mit n = 1 … m und m = Seitenzahl) und die Endmarke auf der
  letzten Inhaltsseite. Ein neuer Druckfall mit hochgeladenem Organisationslogo belegt, dass auf
  Seite 1 genau dieses Bild gezeichnet wird und auf den Folgeseiten keines.
- **Logo im Druckkopf in allen drei Engines:** Unter Druckmedium steht im Druckkopf ein
  geladenes Bild mit den Abmessungen des hochgeladenen Logos.
- **Neue devDependency `pdfjs-dist`** (nur Testwerkzeug, nicht im ausgelieferten Bundle). Sie
  muss durch `scripts/check-deps.sh`.
- **Gate und CI:** `scripts/check-all.sh` wählt die Playwright-Projekte über `PW_PROJEKTE`
  (Vorgabe: alle). Die vier bestehenden e2e-Shards laufen nur `chromium`. Firefox und WebKit
  laufen in einem eigenen Job `e2e Druck Firefox/WebKit`, parallel zu den Shards. Der
  Release wartet auch auf diesen Job, der Berichts-Job zählt fünf Teilberichte.
  Die Shard-Zahl und ihre Check-Namen bleiben unverändert (Pin im Ruleset 17017911).
- **Regeln und Prüfliste:** `frontend/src/druck/AGENTS.md` sagt nicht mehr „Firefox/Safari
  per Hand“, sondern nennt, was die Engines automatisch belegen und was weiter nur das Blatt
  zeigt. Das Browser-Verdikt der LFH-22-Prüfliste wird mit den neuen Belegen umgeschrieben.

## Capabilities

### New Capabilities

(keine)

### Modified Capabilities

- `druck-dokumente`: neue Anforderungen an den Nachweis. Die Druckmechanik muss automatisch in
  den Engines von Chromium, Firefox und WebKit geprüft werden. Seitenzählung und Logo im
  Druckkopf müssen am erzeugten PDF belegt werden. Die bestehenden Anforderungen an das
  Druckbild selbst ändern sich nicht.

## Impact

- **Frontend (Tests):** `frontend/playwright.config.ts` (zwei Projekte mit `testMatch`),
  `frontend/e2e/druck-fluss.spec.ts` (PDF-Schritte nur in Chromium, neuer Logo-Fall,
  Seitenzählung), `frontend/e2e/etb-druck.spec.ts` (läuft unverändert in drei Engines,
  Seitenzählung im PDF), neues Hilfsmodul `frontend/e2e/pdf-kern.ts` mit Selbsttest.
  Am Anwendungscode ändert sich nichts.
- **Abhängigkeiten:** `frontend/package.json`, `frontend/pnpm-lock.yaml` (`pdfjs-dist` als
  devDependency).
- **Gate und CI:** `scripts/check-all.sh` (Schritt 7: `PW_PROJEKTE`, Vorprüfung der
  installierten Browser mit klarer Meldung), `scripts/AGENTS.md`, `.github/workflows/ci.yml`
  (neuer Job, Shards auf `chromium`, `berichte`, `release.needs`).
- **CI-Laufzeit:** Der kritische Pfad wächst nicht, weil der neue Job parallel zu den Shards
  läuft. Es kommt ein Runner hinzu: Browser-Installation plus rund 26 Testfälle.
- **Ruleset (Handgriff außerhalb des Repos):** Damit ein roter Firefox/WebKit-Lauf einen PR
  sperrt, muss ein Mensch den neuen Check-Namen im Ruleset 17017911 als Required Check
  eintragen. Bis dahin hält ihn nur `release.needs` vom Release fern.
- **Lokal:** Wer `./scripts/check-all.sh` ohne `PW_PROJEKTE` startet, braucht Firefox und
  WebKit für Playwright (`playwright install firefox webkit`). Fehlen sie, bricht Schritt 7 mit
  dieser Anweisung ab, nicht mit einem Stacktrace.
- **Dokumentation:** `frontend/src/druck/AGENTS.md`,
  `docs/superpowers/specs/2026-09-25-lfh-22-pruefliste.md` (Browser-Verdikt).
