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
- **Einsatz ohne Dialog.** Fälle, die den Dialog „Neuen Einsatz anlegen“ nicht prüfen, legen
  ihren Einsatz über die API an (`einsatzPerApi`), mit denselben Werten wie der Dialog.
- **Saat einmal statt je Fall.** Gate 1 sät den Überlaufstoff einmal je Worker statt in jedem
  seiner 48 Tests.
- **Nur falls die CI unter 34 min Ersparnis bleibt** (Entscheidung 12.11.2026 nach lokaler
  Messung): Admin- und Beobachter-Geschwister mit gleicher Saat zusammenlegen, gleiche Flächen
  von gate3 und `fokus-verdeckung` in einer Ladung messen, die Titelprüfung aus `orientierung`
  in die Routenschleife von Gate 1 legen.
- **Duplikate streichen**, je mit Mutationsprobe: der reine API-Fall in `lagekarte-smoke`, der
  Zeilenlink in `funkplan`, die doppelte Gefahrenmatrix in `trefflaeche-pruefflaechen`. Weitere
  Kandidaten aus der Durchsicht prüfen Abläufe über mehrere Seiten und bleiben e2e.
- **`kopfhoehe-tonpruefung` bleibt unverändert**: Die Herleitung der Messdauer trägt keine
  Kürzung.
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
