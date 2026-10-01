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
  (Vorgabe: alle). Die vier Pflicht-Shards `e2e 1/4` … `e2e 4/4` fahren alle drei Projekte,
  `--shard` verteilt die Firefox- und WebKit-Fälle mit. Ein roter Fall sperrt damit den PR,
  ohne neuen Check-Namen und ohne Eintrag im Ruleset 17017911. Shard-Zahl, Check-Namen,
  `berichte` und `release.needs` bleiben unverändert.
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
  (die e2e-Shards installieren `chromium firefox webkit`).
- **CI-Laufzeit:** Die e2e-Shards sind heute der kritische Pfad (in PR #297 zwischen 10 und
  23 min). Je Shard kommen schätzungsweise 2–4 min dazu: die Installation der Systempakete
  plus der Anteil an rund 26 zusätzlichen Testfällen.
- **Lokal:** Wer `./scripts/check-all.sh` ohne `PW_PROJEKTE` startet, braucht Firefox und
  WebKit für Playwright (`playwright install firefox webkit`). Fehlen sie, bricht Schritt 7 mit
  dieser Anweisung ab, nicht mit einem Stacktrace.
- **Dokumentation:** `frontend/src/druck/AGENTS.md`,
  `docs/superpowers/specs/2026-09-25-lfh-22-pruefliste.md` (Browser-Verdikt).
