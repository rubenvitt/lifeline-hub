# Proposal

## Why

Die e2e-Suite braucht seriell rund 335 Testminuten (Chromium, `frontend/e2e/laufzeiten.json`), die
20 längsten von 264 Dateien davon 46 %. Jeder PR zahlt das in vier Shards mit je bis zu 58 min
Wanduhr (LLH-1488). Die Durchsicht der 20 längsten Specs (12.11.2026) zeigt: Gemessen wird fast
nur echtes Browser-Layout, aber ein großer Teil der Zeit geht in Anmeldung über das Formular,
doppeltes Laden je Dichtestufe und wiederholtes Säen derselben Daten. Dazu kommen wenige
Fälle, die Logik prüfen, die Vitest oder `tests/` schon genauso belegen.

Der Auftrag (Zunder LLH-1665) schlug zusätzlich vor, die Layout-Gates im PR nur für die Seiten
zu fahren, die der Diff berührt. Das wird **nicht** umgesetzt (Begründung in `design.md`, D1):
Es gibt keinen Seitenkatalog, die Zuordnung Seite → Datei bräuchte einen Importgraphen, und nur
etwa ein Viertel der Frontend-PRs bliebe in einem Fachordner.

## What Changes

- **Keine Diff-Auswahl der Layout-Gates.** Läuft die e2e-Suite, fährt sie jeden Gate-Fall, im PR
  wie auf `alpha`. Festgehalten als Anforderung, damit die Frage nicht still wiederkehrt.
- **Anmeldung per API in der ganzen Suite.** Die geteilten Helfer (`anmelden`, `anmeldenAls`,
  `anmeldenAlsAdmin`, `wechsleZu…`) melden über `POST /api/auth/login` an statt über das
  Formular. Die rund 40 lokalen Kopien in einzelnen Specs fallen weg. Das Formular prüfen nur noch
  die Specs, die die Anmeldung selbst prüfen. Ein Lint-Riegel hält das.
- **Eine Ladung je Dichtestufe.** Die Gates setzen die Stufe vor dem Laden der gemessenen
  Seite, statt erst zu laden und dann neu zu laden (`stelleDichte`; gate3 69×,
  `fokus-verdeckung`, `pegel-pruefliste`, `leisten-flaeche`).
- **Saat einmal statt je Fall.** Gate 1 sät den Überlaufstoff einmal je Worker statt in jedem
  seiner 48 Tests. Admin- und Beobachter-Geschwister, die dieselben Daten säen, säen einmal und
  wechseln die Rolle im selben Kontext.
- **Gleiche Flächen einmal laden.** Wo gate3 und `fokus-verdeckung` dieselbe Seite mit derselben
  Saat, Rolle und Breite messen, misst eine Ladung beides. Die Dichtetests in `fokus-verdeckung`
  werden je Breite gebündelt. Die Titel- und h1-Prüfung aus `orientierung` läuft in der
  Routenschleife von Gate 1 mit, wo diese die Route ohnehin lädt.
- **Duplikate streichen oder verschieben**, je mit Mutationsprobe: `funkplan` (3 Fälle, dazu
  einer nach Vitest), `lagekarte-smoke` (reiner API-Fall), `dokumente`, `fernmeldeskizze`,
  `command-palette`, Gefahrenmatrix in `trefflaeche-pruefflaechen` (doppelt zu gate3).
- **`kopfhoehe-tonpruefung` straffen**, soweit die Herleitung der Messdauer es trägt.
- **Regel in `frontend/e2e/AGENTS.md`:** e2e nur für Abläufe über mehrere Seiten und für das,
  was nur der Browser zeigt. Logik einer Seite gehört nach Vitest, Serververhalten nach `tests/`.
- **Zielwert:** Die Chromium-Summe in `frontend/e2e/laufzeiten.json` sinkt um mindestens 10 %
  (mindestens 34 von 335 min). Keine Gate-Messung (Seite × Breite × Stufe × Rolle) entfällt.

## Capabilities

### New Capabilities
- `e2e-zuschnitt`: Was die e2e-Suite prüft und wie sie es tut, ohne Laufzeit zu verschenken:
  Zuständigkeit gegenüber Vitest und `tests/`, vollständige Layout-Gates in jedem Lauf,
  Anmeldung per API, eine Ladung je Dichtestufe, Kürzung nur ohne Messverlust.

### Modified Capabilities
<!-- keine: `layout-gates-rollen` bleibt unverändert erfüllt; die zusammengelegten
     Admin-/Beobachter-Durchgänge behalten Vorbedingung und Mutationsprobe (design.md, D6). -->

## Impact

- `frontend/e2e/`: die Kern-Helfer (`rollen-kern.ts`, `trefflaeche-kern.ts`, `funkplan-kern.ts`,
  `meldebild-kern.ts` u. a.), rund 40 Specs mit eigener Anmeldung, die 20 längsten Specs.
- `frontend/src/**`: neue bzw. ergänzte Vitest-Fälle für verschobene Logik (Funkplan,
  ggf. Dokumente).
- `tests/`: ggf. ein Nachweis für den ETB-Eintrag beim Bearbeiten eines Dokuments.
- `frontend/eslint.config.js`: Riegel gegen Formular-Anmeldung in `e2e/**` außerhalb der
  Anmelde-Specs.
- `frontend/e2e/AGENTS.md`: neue Regel; `frontend/e2e/laufzeiten.json`: aufgefrischt.
- Keine Änderung an App-Code, CI-Ablauf, Shard-Zahl oder `scripts/bereiche.sh`.
