# LFH-335 Tastaturbedienung Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Command-Palette, Erfassungsmasken, Filter und Einsatznavigation erfüllen den in LFH-335 beschriebenen Tastaturvertrag ohne die bereits gelieferten B2-/B4-Primitive zu duplizieren.

**Architecture:** `CommandPaletteProvider` erhält eine fokusbasierte Ebenen-Registry; die Tastenbelegung bleibt als Daten in `command-palette/befehle.ts` und wird zugleich in der Palette angezeigt. Native Router-Links tragen Navigation, `ErfassungsFormular` trägt Formularfokus und Submit, und ein kleines `Klickbar`-Primitiv deckt ausschließlich nicht-native Selektionszeilen ab.

**Tech Stack:** React 19, TypeScript, Ant Design 6.5.2, React Router, Vitest/Testing Library, Playwright.

## Global Constraints

- Alle Shell-Kommandos mit `rtk` prefixen.
- Änderungen ausschließlich im Worktree `feat/lfh-335-tastatur-palette-enter-vertrag`.
- Ant Design exakt gegen Version 6.5.2 prüfen; keine punktuellen `size`-Props.
- Von LFH-335 neu angelegte oder geänderte Einsatznavigation ausschließlich über
  `frontend/src/routing/deeplinks.ts` bauen; angefasste Pfadliterale migrieren.
- B4s Cmd/Strg+Enter-Serienlauf hat Vorrang vor dem globalen normalen Submit.
- Gezielte Frontendtests vom Repo-Root als
  `rtk mise exec pnpm@11.10.0 -- pnpm -C frontend exec vitest run <Dateien>` ausführen.
- Kein Feature-Commit oder Push ohne erneute ausdrückliche Benutzerfreigabe; die Checkpoints enden daher mit Test- und Diff-Prüfung.

---

### Task 1: Zentrale Einsatzpfade und native Einsatz-/Schaden-Links

**Files:**
- Modify: `frontend/src/routing/deeplinks.ts`
- Test: `frontend/src/routing/deeplinks.test.ts`
- Modify: `frontend/src/pages/EinsaetzePage.tsx`
- Test: `frontend/src/pages/EinsaetzePage.test.tsx`
- Modify: `frontend/src/pages/SchaedenPage.tsx`
- Test: `frontend/src/pages/SchaedenPage.test.tsx`
- Test: `frontend/src/pages/PersonenPage.test.tsx`
- Test: `frontend/src/pages/TierePage.test.tsx`

**Interfaces:**
- Produces: `einsaetzePfad(): string`, `einsatzPfad(einsatzId: number): string`.
- Consumes: vorhandene `personDetailPfad`, `tiereDetailPfad`, `schadenDetailPfad`.

- [x] Neue Builder zunächst in `deeplinks.test.ts` gegen `/einsaetze` und `/einsaetze/7` pinnen.
- [x] Den Test ausführen und den fehlenden Export als roten Zustand bestätigen:
  `rtk mise exec pnpm@11.10.0 -- pnpm -C frontend exec vitest run src/routing/deeplinks.test.ts`.
- [x] Builder implementieren und `EinsaetzePage` auf `Link` plus `einsatzPfad` umstellen; Kartenklick und Anlage-Navigation verwenden denselben Builder.
- [x] Einsatz-Titellink und Schaden-Registriernummer stoppen nur das Bubbling zum Elternklick, nie die Link-Defaultaktion; Ctrl-/Meta-Klick bleibt browsernativ.
- [x] Seitentests ergänzen: jede geladene Einsatzkarte per Tab erreichbar, Enter navigiert, Modifier-Klick löst den Kartenhandler nicht aus; Personen/Tiere/Schäden haben genau einen Datensatz-Link je Zeile.
- [x] Gezielte Dateien grün fahren:
  `rtk mise exec pnpm@11.10.0 -- pnpm -C frontend exec vitest run src/routing/deeplinks.test.ts src/pages/EinsaetzePage.test.tsx src/pages/SchaedenPage.test.tsx src/pages/PersonenPage.test.tsx src/pages/TierePage.test.tsx`.
- [x] `rtk git diff --check` ausführen.

### Task 2: Anwendungsweites Klickbar-Primitiv

**Files:**
- Create: `frontend/src/components/Klickbar.tsx`
- Create: `frontend/src/components/Klickbar.test.tsx`
- Modify: `frontend/src/components/Liste.tsx`
- Test: `frontend/src/components/Liste.test.tsx`
- Test: `frontend/src/chat/KanalListe.test.tsx`
- Test: `frontend/src/pages/gefahren/GefahrenPage.test.tsx`
- Test: `frontend/src/pages/lagekarte/Sidebar.test.tsx`

**Interfaces:**
- Produces: `aufTaste(aktion)` und `KlickbareZeile` mit Enter-/Space-Aktivierung.
- Consumes: `ListenEintrag.onClick` nur für Button-semantische Auswahl, niemals für Navigation.

- [x] Primitive-Tests schreiben: Rolle `button`, `tabIndex=0`, Enter und Space je genau einmal; andere Tasten wirkungslos.
- [x] Tests rot ausführen:
  `rtk mise exec pnpm@11.10.0 -- pnpm -C frontend exec vitest run src/components/Klickbar.test.tsx src/components/Liste.test.tsx`.
- [x] `KlickbareZeile` implementieren; Ereignisse aus interaktiven Kindelementen nicht als Zeilenaktivierung behandeln.
- [x] `ListenEintrag` bei `onClick` durch das Primitive rendern und die Typen so einschränken, dass `onClick` und `actions` nicht gemeinsam zulässig sind.
- [x] Drei aktuelle Caller per Tastaturtest absichern und gezielte Suite grün fahren:
  `rtk mise exec pnpm@11.10.0 -- pnpm -C frontend exec vitest run src/components/Klickbar.test.tsx src/components/Liste.test.tsx src/chat/KanalListe.test.tsx src/pages/gefahren/GefahrenPage.test.tsx src/pages/lagekarte/Sidebar.test.tsx`.
- [x] `rtk git diff --check` und geänderte antd-Dateien mit ESLint prüfen.

### Task 3: Fokusbasierte Shortcut-Ebenen und Palette-Befehle

**Files:**
- Modify: `frontend/src/command-palette/typen.ts`
- Modify: `frontend/src/command-palette/befehle.ts`
- Test: `frontend/src/command-palette/befehle.test.ts`
- Modify: `frontend/src/command-palette/CommandPaletteProvider.tsx`
- Test: `frontend/src/command-palette/CommandPaletteProvider.test.tsx`
- Modify: `frontend/src/command-palette/useBefehle.ts`
- Test: `frontend/src/command-palette/useBefehle.test.tsx`
- Modify: `frontend/src/command-palette/CommandPalette.tsx`
- Test: `frontend/src/command-palette/CommandPalette.test.tsx`

**Interfaces:**
- Produces: `TastaturAktionId`, `useTastaturEbene({ name, wurzel, aktionen, aktiv })`, `Befehl.kuerzel`.
- Produces: reine Ereignisauflösung für Speichern, Verwerfen und Filter-Reset in `befehle.ts`.
- Consumes: `einsaetzePfad()` und `einsatzPfad(id)` statt angefasster Pfadliterale.

- [x] Reine Tests für Tastenzuordnung, Plattform-Kürzel und kontextuelle Befehlserzeugung schreiben.
- [x] Provider-Tests schreiben: bei überlappenden Wurzeln gewinnt die tiefste fokussierte Ebene; `defaultPrevented` und Wiederholung lösen keine Mutation aus.
- [x] Cmd/Strg+Backspace ohne registrierten Filter-Callback lässt `defaultPrevented === false`; mit Callback wird genau einmal zurückgesetzt und das Event verhindert.
- [x] Palette-offen-Test mit zuvor aktiver Formular-/Filterebene: Cmd/Strg+S, Cmd/Strg+Enter und Cmd/Strg+Backspace erreichen die Ebene darunter nicht; Escape schließt nur die Palette und danach ist die vorherige Ebene wieder aktiv.
- [x] Escape-Eigentum testen: `CommandPalette` nutzt `keyboard={false}`, der globale Bubble-Dispatcher schließt genau einmal und respektiert einen lokalen `defaultPrevented`-Handler.
- [x] Rote Palette-Suite ausführen:
  `rtk mise exec pnpm@11.10.0 -- pnpm -C frontend exec vitest run src/command-palette/befehle.test.ts src/command-palette/CommandPaletteProvider.test.tsx src/command-palette/useBefehle.test.tsx src/command-palette/CommandPalette.test.tsx`.
- [x] Registry im bestehenden Context implementieren. Callback-Refs halten die Registrierung stabil; `focusin` wählt deterministisch die tiefste Ebene, Unmount entfernt sie.
- [x] `baueBefehle` um eine Aktionsgruppe und `<kbd>`-Anzeige erweitern; modifiziertes Enter in der geöffneten Palette nicht als Treffer-Enter behandeln; angefasste Einsatzpfade über die Builder erzeugen.
- [x] Gezielte Palette-Suite mit demselben Befehl grün fahren und geänderte Dateien linten.

### Task 4: Sichtbarer Trigger in beiden Kopfzeilen

**Files:**
- Create: `frontend/src/components/CommandPaletteTrigger.tsx`
- Test: `frontend/src/components/CommandPaletteTrigger.test.tsx`
- Modify: `frontend/src/components/AppLayout.tsx`
- Test: `frontend/src/components/AppLayout.test.tsx`
- Modify: `frontend/src/einsatz/EinsatzLayout.tsx`
- Test: `frontend/src/einsatz/EinsatzLayout.test.tsx`
- Modify: `frontend/e2e/kopfzeile-schmal.spec.ts`
- Modify: `frontend/e2e/command-palette.spec.ts`

**Interfaces:**
- Consumes: `useCommandPalette().toggle()` und `useViewport().abBreite('lg')`.
- Produces: Desktoptext „Suchen“ plus `<kbd>`, mobil `aria-label="Suchen"` bei 48 × 48 px.

- [x] Trigger- und Layouttests rot schreiben: Klick öffnet Palette, beide Shells rendern den Trigger, schmale Variante bleibt vorhanden und nutzt die bestehende Header-Vordergrundrolle.
- [x] Gemeinsamen Trigger implementieren und in beide Header einsetzen; mobil bleibt er 48 × 48 px.
- [x] Unit-Suite grün fahren:
  `rtk mise exec pnpm@11.10.0 -- pnpm -C frontend exec vitest run src/components/CommandPaletteTrigger.test.tsx src/components/AppLayout.test.tsx src/einsatz/EinsatzLayout.test.tsx`.
- [x] E2E ergänzen: 390-px-Bounding-Box mindestens 48 × 48 px, Trigger öffnet/fokussiert Palette, Navigation einer Option erfolgt wirklich per Enter.
- [x] Browser-Gates nach `rtk cargo build --bin lifeline-hub` gezielt ausführen:
  `rtk mise exec pnpm@11.10.0 -- pnpm -C frontend exec playwright test e2e/kopfzeile-schmal.spec.ts e2e/command-palette.spec.ts`.

### Task 5: Shortcut-Registry an Formulare und Filter anbinden

**Files:**
- Modify: `frontend/src/components/Erfassung.tsx`
- Test: `frontend/src/components/Erfassung.test.tsx`
- Modify: `frontend/src/components/Datensicht.tsx`
- Test: `frontend/src/components/Datensicht.test.tsx`
- Modify: `frontend/src/components/KatalogTabelle.tsx`
- Test: `frontend/src/components/KatalogTabelle.test.tsx`
- Modify: `frontend/src/pages/EtbPage.tsx`
- Test: `frontend/src/pages/EtbPage.test.tsx`

**Interfaces:**
- Consumes: `useTastaturEbene` aus Task 3.
- Registers: Formular `speichern`/`verwerfen`; ausschließlich die jeweilige Filter-/Werkzeugleiste von Datensicht, KatalogTabelle und ETB `filter-zuruecksetzen`.

- [x] Integrationstests schreiben: Cmd/Strg+S normaler Submit, lokales Cmd/Strg+Enter weiterhin Serienlauf, Repeat löst keine Mutation aus, Escape verwirft einmalig, Filter-Reset leert sichtbare und interne Zustände.
- [x] Rote Suite ausführen:
  `rtk mise exec pnpm@11.10.0 -- pnpm -C frontend exec vitest run src/components/Erfassung.test.tsx src/components/Datensicht.test.tsx src/components/KatalogTabelle.test.tsx src/pages/EtbPage.test.tsx`.
- [x] Eigene Ebenenwurzeln ausschließlich um Filter-/Werkzeugleisten ergänzen; die ETB-Wurzel umfasst nur `EtbFilterleiste`, nie Schnellerfassung oder Ergebnistabelle. Keine neuen globalen Listener hinzufügen.
- [x] `ErfassungsModal` mit `keyboard={false}` an den zentralen Escape-Dispatcher übergeben; B4s lokalen Serienhandler gegen `event.repeat` absichern.
- [x] `defaultPrevented`-Priorität mit einem expliziten Doppelabsende-Gegentest und die unveränderte `/`-Spezialinteraktion der Katalogtabelle absichern.
- [x] Gezielte Suite mit demselben Befehl grün fahren und linten.

### Task 6: ETB-Enter-Vertrag und Baustein-Formular

**Files:**
- Modify: `frontend/src/etb/Schnellerfassung.tsx`
- Test: `frontend/src/etb/Schnellerfassung.test.tsx`
- Modify: `frontend/src/etb/BausteinPlatzhalterModal.tsx`
- Test: `frontend/src/etb/BausteinPlatzhalterModal.test.tsx`

**Interfaces:**
- ETB: einfaches Enter sendet nur ohne `\n`; Cmd/Strg+Enter sendet immer, sofern kein Slash-Menü/Meta-Editor die Taste besitzt.
- Baustein: `Form<Record<string, string>>` mit `onFinish` und erstem dynamischen `autoFocus`.

- [x] Vertragstests schreiben: Einzeiler Enter, Mehrzeiler Enter, Ctrl+Enter, Meta+Enter, Repeat sendet nicht, exakter Hinweis in DOM und Placeholder.
- [x] Bausteintests schreiben: erstes Feld fokussiert, Enter setzt ein, sichtbarer Submit-Button löst `onFinish` aus, Abbruch leert Werte.
- [x] Rote Tests ausführen:
  `rtk mise exec pnpm@11.10.0 -- pnpm -C frontend exec vitest run src/etb/Schnellerfassung.test.tsx src/etb/BausteinPlatzhalterModal.test.tsx`.
- [x] Minimale Handler-/Form-Umstellung implementieren.
- [x] Gezielte Suite mit demselben Befehl grün fahren und linten.

### Task 7: Verbleibende konkrete Masken und sitzungsweite Ortswerte

**Files:**
- Create: `frontend/src/components/erfassungsSitzung.ts`
- Create: `frontend/src/components/erfassungsSitzung.test.ts`
- Modify: `frontend/src/personen/PersonErfassungModal.tsx`
- Test: `frontend/src/personen/PersonErfassungModal.test.tsx`
- Modify: `frontend/src/pages/TierePage.tsx`
- Test: `frontend/src/pages/TierePage.test.tsx`
- Modify: `frontend/src/pages/schaeden/SchadenErfassenModal.tsx`
- Test: `frontend/src/pages/SchaedenPage.test.tsx`
- Modify: `frontend/src/pages/uhs/UhsAnlegenDrawer.tsx`
- Test: `frontend/src/pages/UnfallhilfsstellenPage.test.tsx`
- Modify: `frontend/src/pages/bereitstellungsraum/BereitstellungsraeumePage.tsx`
- Test: `frontend/src/pages/bereitstellungsraum/BereitstellungsraeumePage.test.tsx`
- Test: `frontend/src/pages/uhs/Grundriss.test.tsx`

**Interfaces:**
- Produces: sichere `sessionStorage`-Helfer, Schlüssel enthält Einsatz-ID, Maskenname und Feld.
- Consumes: `ErfassungsFormular` für beide Drawer-Formulare.

- [x] Speicher-Helfer rot testen: Trennung nach Einsatz/Maske, nicht verfügbare Storage-API, nur Stringwerte.
- [x] Maskentests ergänzen: erfolgreicher Wert wird beim Wiederöffnen vorbelegt; Fehler wird nicht gespeichert; Session-Vorbelegung aktiviert B4s „Werte behalten“ nicht und ausgeschalteter Serienmodus übernimmt keine weiteren Werte; UHS/BR fokussieren Bezeichnung und Enter sendet; UHS-Verbleib sendet Enter aus Ziel.
- [x] Helfer und lokale Verdrahtung implementieren. Sitzungswerte beim Öffnen genau einmal per Formularwert einsetzen, nicht als dauerhaftes `initialValues`, damit ein Serien-Reset bei ausgeschaltetem „Werte behalten“ leer bleibt. Eigene Organisation nicht als Geschädigter vorbelegen.
- [x] UHS/BR auf `mutateAsync` in `onErfassen` umstellen; Close/Reset nur über `onFertig`/`onAbbrechen`, Fehler lässt Werte stehen. UHS ordnet Bezeichnung als erstes leeres Arbeitsfeld vor Typ an.
- [x] Gezielte Maskensuite grün fahren:
  `rtk mise exec pnpm@11.10.0 -- pnpm -C frontend exec vitest run src/components/erfassungsSitzung.test.ts src/personen/PersonErfassungModal.test.tsx src/pages/TierePage.test.tsx src/pages/SchaedenPage.test.tsx src/pages/UnfallhilfsstellenPage.test.tsx src/pages/bereitstellungsraum/BereitstellungsraeumePage.test.tsx src/pages/uhs/Grundriss.test.tsx`.
- [x] Geänderte Dateien linten.

### Task 8: Gesamtreview und Gates

**Files:**
- Review: alle in Tasks 1–7 geänderten Dateien
- Update: dieses Plan-Dokument mit abgehakten Schritten

**Interfaces:**
- Consumes: sämtliche vorherigen Task-Ergebnisse.
- Produces: reviewfähiger, ungecommiteter LFH-335-Diff.

- [ ] `rtk git diff --check` und `rtk git -c core.fsmonitor=false status --short --untracked-files=all` zur Scope-Prüfung ausführen.
- [ ] `rtk mise exec pnpm@11.10.0 -- pnpm -C frontend lint` ausführen.
- [ ] `rtk ./scripts/check-typ-codegen.sh` ausführen.
- [ ] Gesamte Vitest-Suite ausführen:
  `rtk mise exec pnpm@11.10.0 -- pnpm -C frontend exec vitest run --no-file-parallelism`.
- [ ] `rtk cargo build --bin lifeline-hub` ausführen und sicherstellen, dass `target/debug/lifeline-hub` ausführbar ist.
- [ ] Gezielte Playwright-Specs ausführen:
  `rtk mise exec pnpm@11.10.0 -- pnpm -C frontend exec playwright test e2e/command-palette.spec.ts e2e/kopfzeile-schmal.spec.ts`; der Drawer-Fall prüft sichtbaren Fokus, Tab und Shift+Tab.
- [ ] `rtk ./scripts/check-all.sh` vollständig ausführen.
- [ ] Zwei unabhängige read-only Reviews durchführen: Spezifikationsabdeckung und adversariale Qualitätsprüfung.
- [ ] ClickUp vorwärts auf Review/Testing/Shipped fortschreiben, aber nur nach belegten Gates.
