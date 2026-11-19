# Fehlergrenze je Kachel (LLH-1958) — Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wirft eine Kachel auf Überblick, Lagebild, Lagebild-Großbild oder Lagemonitor, fällt nur
diese Kachel aus. Die übrigen bleiben stehen, und genau ein Bericht geht an den Server.

**Architecture:** `KachelGrenze` ist eine Klassen-Error-Boundary in
`frontend/src/components/KachelGrenze.tsx`. Ihre Hülle ist ein `div` mit `display: contents`.
Sie hat zwei Formen: `paneel` mit „Neu laden“ und `gross` ohne Knopf, mit Neuversuch über
`neuversuch`. Die Seiten schließen jede Kachel einzeln darin ein. Render-Wächter in den
vorhandenen Seitentests prüfen, dass jede Kachel eine Grenze über sich hat.

**Tech Stack:** React 19, TypeScript, antd, Vitest und Testing Library. Node und pnpm kommen nur
über `mise exec --` (LFH-773).

**Spec:** `docs/superpowers/specs/2026-11-19-ft74hjiv-fehlergrenze-je-kachel-design.md`

Zunder: https://zunder.rubeen.dev/#/aufgabe/ft74hjivesqlac82pjb85h3h

## Global Constraints

- Texte, wörtlich:
  - Titel des Ersatzes: „Diese Kachel konnte nicht angezeigt werden“.
  - Satz der Form `paneel`: „Der Fehler wurde gemeldet.“
  - Knopf der Form `paneel`: „Neu laden“, ruft `window.location.reload()`.
  - Form `gross`: nur der Titel mit Punkt, „Diese Kachel konnte nicht angezeigt werden.“
- Meldung und Stack des Wurfs stehen nie im DOM. Sie gehen nur über
  `meldeClientFehler(fehler, window.location.pathname)` an den Server.
- Die Kante des Ersatzes in der Form `paneel` steht in `rollen.alarm`
  (`boxShadow: inset 3px 0 0 0`), wie bei `Fehlergrenze`. Im Fugenraster gilt `IM_RASTER`, ohne
  eigenen Rand.
- Die Form `gross` setzt ihre Schrift über `grossMass(GROSS_BEZUG.titel)` bzw.
  `grossMass(GROSS_BEZUG.text)`, mindestens 28 px (`geraet/AGENTS.md`).
- Die Grenze fügt keine Box ins Layout ein: Die Hülle ist
  `<div data-lfh-kachelgrenze="" style={{ display: 'contents' }}>`.
- Bezeichner: Fachbegriffe deutsch, Technik englisch (`AGENTS.md`, LLH-1312). Also
  `KachelGrenze`, `hasError`, `neuversuch`.
- Kommentare, Testnamen und Commits schreibst du auf Deutsch. Jeder Commit-Body trägt die
  Zunder-Zeile.

## Review Focus

1. **Ein Wurf, den die Kachelgrenze fängt, darf die Rahmengrenze nicht erreichen.** Sonst wären es
   zwei Berichte und die Seite wäre trotzdem weg. Das prüft Task 1, Test „genau ein Bericht“.
2. **Ein Wurf in einem Hook einer Paneel-Komponente**, nicht nur im Körper, landet in der Grenze
   am Aufrufort. Das prüft Task 1 mit einer werfenden Komponente, die per Hook wirft.
3. **Lagemonitor:** Wirft eine Kachel bei jedem Datenstand neu, meldet die Grenze dasselbe
   Fehlerobjekt nicht doppelt (`WeakSet` in `meldeClientFehler`). Ein neues Fehlerobjekt je
   Versuch gilt als neuer Bericht; die Drossel des Servers fängt das ab. Den Neuversuch prüft
   Task 1, Test zu `neuversuch`. Die Drossel ist Sache des Servers und wird hier nicht getestet.
4. **`display: contents` darf das Grid nicht brechen.** `PaneelReihe` zählt ihre Kinder mit
   `Children.toArray`, und eine Grenze ist dort genau ein Kind. Das prüft Task 2: Die
   vorhandenen Layout-Tests der Reihen bleiben grün.
5. **Ersatz in einem bedingt fehlenden Paneel:** Eine Grenze um `{bedingung && <X/>}` darf
   keine leere Spur hinterlassen. Deshalb steht die Grenze innerhalb der Bedingung. Das prüft
   Task 2 über den Wächter, der Grenzen und Kacheln eins zu eins zählt.

---

### Task 1: `KachelGrenze`

**Files:**
- Create: `frontend/src/components/KachelGrenze.tsx`
- Test: `frontend/src/components/KachelGrenze.test.tsx`

**Interfaces:**
- Produces:
  - `export default class KachelGrenze extends Component<KachelGrenzeProps, State>`
  - `export interface KachelGrenzeProps { titel: string; form?: 'paneel' | 'gross'; neuversuch?: unknown; children: ReactNode }`
  - `export const KACHELGRENZE_TITEL = 'Diese Kachel konnte nicht angezeigt werden'`
  - `export const KACHELGRENZE_SELEKTOR = '[data-lfh-kachelgrenze]'`
  - Die Ersatzfläche trägt `data-lfh="kachelgrenze"`.

- [ ] **Step 1: Write the failing tests.** Mocke `../api/clientFehler` per `vi.mock` mit
  `meldeClientFehler: vi.fn(() => Promise.resolve())`. Unterdrücke `console.error` per `vi.spyOn`.
  Dazu zwei Hilfskomponenten: `Wirft`, die beim Zeichnen ein `new Error('geheim-123')` wirft, und
  `WirftImHook`, die in `useMemo` wirft. Die Tests:
  - „wirft eine Kachel, zeigt nur sie den Hinweis; die Nachbarkachel bleibt bedienbar“: Rendere
    `<><KachelGrenze titel="Marken"><Wirft/></KachelGrenze><button onClick={spy}>Nachbar</button></>`.
    Erwartet wird: `getByText(KACHELGRENZE_TITEL)` und `getByRole('button', {name: 'Neu laden'})`
    sind sichtbar. Ein Klick auf „Nachbar“ ruft `spy` einmal.
  - „genau ein Bericht, ohne Meldung im DOM“: `meldeClientFehler` wird einmal mit
    `(expect.any(Error), window.location.pathname)` gerufen. `queryByText(/geheim-123/)` ist `null`.
  - „ein Wurf im Hook der Kachel landet in der Grenze“: Mit `WirftImHook` steht der Titel.
  - „ohne Wurf zeichnet die Grenze nur ihr Kind, in einer Hülle mit display: contents“: Das Kind
    ist sichtbar, und `container.querySelector(KACHELGRENZE_SELEKTOR)` hat `style.display`
    `'contents'`.
  - „Form gross: kein Knopf, Titel mit Punkt“: `queryByRole('button')` ist `null`, und
    `getByText(KACHELGRENZE_TITEL + '.')` ist sichtbar.
  - „ein neuer neuversuch zeichnet die Kachel neu“: Ein Kind wirft nur, solange ein äußerer Schalter
    an ist. Beim `rerender` mit Schalter aus und `neuversuch` 2 statt 1 ist der Inhalt des Kindes
    zu sehen. Bei gleichem `neuversuch` bleibt der Ersatz stehen.
- [ ] **Step 2: Run** `cd frontend && mise exec -- pnpm exec vitest run src/components/KachelGrenze.test.tsx`
  → FAIL (Modul fehlt).
- [ ] **Step 3: Implement `KachelGrenze`.**
  - State: `{ hasError: boolean; neuversuch: unknown }`.
  - `static getDerivedStateFromError()` gibt `{ hasError: true }` zurück.
  - `static getDerivedStateFromProps(props, state)` setzt `{ hasError: false, neuversuch: props.neuversuch }`,
    wenn `props.neuversuch !== state.neuversuch`, sonst `null`.
  - `componentDidCatch(fehler)` ruft `void meldeClientFehler(fehler, window.location.pathname)`.
  - Der Ersatz ist eine Funktionskomponente `KachelErsatz({ titel, form })`, weil sie `useRollen`
    braucht.
    - Form `paneel`: `Paneel` mit `titel={titel}`, `koerperPolster` und
      `style={{ ...IM_RASTER, boxShadow: \`inset 3px 0 0 0 ${rollen.alarm}\` }}`. Im Körper stehen
      der Titelsatz, der Satz und `<Button type="primary">Neu laden</Button>`. Die Optik nimmst du
      von `FehlerPaneel` in `Fehlergrenze.tsx`.
    - Form `gross`: ein `section` mit `aria-label={titel}`. Der Rahmen folgt der Lagemonitor-`Kachel`
      (`rollen.flaeche`, Rand `rollen.linie`, Radius 8, Polster `16px 24px`). Darin der Kacheltitel
      in `grossMass(GROSS_BEZUG.titel)` und der Satz in `grossMass(GROSS_BEZUG.text)`.
  - Der Dateikopf-Kommentar verweist auf die Regel in `frontend/AGENTS.md` und auf LLH-1958.
- [ ] **Step 4: Run** wie Step 2 → PASS.
- [ ] **Step 5: Commit** `feat(frontend): KachelGrenze fängt den Wurf einer einzelnen Kachel (LLH-1958)`.

### Task 2: Überblick und Lagebild, mit Render-Wächter

**Files:**
- Modify: `frontend/src/pages/fuehrung/UeberblickPage.tsx`, der Render-Abschnitt ab
  `<DashboardFlaeche kennung="ueberblick">`
- Modify: `frontend/src/pages/lage-dashboard/LageDashboardPage.tsx`, der Render-Abschnitt ab
  `<DashboardFlaeche kennung="lagebild">`
- Test: `frontend/src/pages/fuehrung/UeberblickPage.test.tsx` und
  `frontend/src/pages/lage-dashboard/LageDashboardPage.test.tsx`, je ein neues `it`
- Create: `frontend/src/test/kachelWaechter.ts`

**Interfaces:**
- Consumes: `KachelGrenze` und `KACHELGRENZE_SELEKTOR` aus Task 1.
- Produces:
  - `export const KACHEL_SELEKTOR = '[data-lfh="alarm-zeile"], [data-lfh="kennzahlenband"], [data-lfh="paneel"], [data-lfh="monitor-kachel"]'`
  - `export function pruefeKachelGrenzen(flaeche: Element, mindestens: number): void`. Sie nimmt
    die obersten Kacheln der Fläche, also jene, deren Vorfahr innerhalb der Fläche keine Kachel
    ist. Erwartet wird:
    - Ihre Anzahl ist mindestens `mindestens`.
    - Jede hat `closest(KACHELGRENZE_SELEKTOR)` innerhalb von `flaeche`.
    - Die Menge dieser Grenzen ist so groß wie die Zahl der Kacheln, also eins zu eins.

- [ ] **Step 1: Write the failing guard tests.**
  - Schreibe `pruefeKachelGrenzen` in `src/test/kachelWaechter.ts`.
  - In `UeberblickPage.test.tsx` kommt
    `it('Wächter: jede Kachel des Überblicks steht in ihrer eigenen KachelGrenze (LLH-1958)')` hinzu.
    Es nutzt `rendern()`, wartet auf „Nächste Marken“ und ruft
    `pruefeKachelGrenzen(container.querySelector('[data-lfh="ueberblick"]')!, 5)`. Das sind die
    Alarmzeile und vier Paneele.
  - Erscheint die Startliste in den Fixtures, wird `mindestens` 6. Prüfe das am vorhandenen
    Startlisten-Test.
  - In `LageDashboardPage.test.tsx` kommt dasselbe für `[data-lfh="lagebild"]` mit `mindestens`
    6 hinzu: Alarmzeile, zwei Bänder und drei Paneele.
- [ ] **Step 2: Run** beide Testdateien → die neuen `it` FAIL (keine Grenze).
- [ ] **Step 3: Wrap.**
  - **Überblick:** Je eine `KachelGrenze` umschließt
    - `AlarmZeile` (titel „Was brennt“),
    - `StartlistePaneel` (titel „Einsatz starten“, innerhalb der Bedingung `zeigeStartliste`),
    - `ListenPaneel` („Nächste Marken“),
    - `OffeneVorgaengePaneel` („Offene Vorgänge“),
    - `GliederungsPaneel` („Einsatzabschnitte“),
    - `StromPaneel` (`entscheidungTitel`).
  - **Lagebild:** Je eine `KachelGrenze` umschließt
    - `AlarmZeile`,
    - das Band „Lage in Zahlen“,
    - `VerlaufPaneel` bzw. `GefahrenmatrixPaneel`, je Zweig eine eigene Grenze,
    - `SichtungsPaneel`,
    - `MeldungsstromPaneel`,
    - das Band „Stand“.
  - Das `Sammelbanner` bleibt ohne Grenze.
- [ ] **Step 4: Run** beide Testdateien vollständig → PASS, auch die vorhandenen Layout-Tests.
- [ ] **Step 5: Mutationsprobe.** Nimm im Überblick vorübergehend eine Grenze heraus. Der Wächter
  muss rot werden. Danach machst du die Probe rückgängig.
- [ ] **Step 6: Commit** `feat(frontend): Überblick und Lagebild fangen Würfe je Kachel (LLH-1958)`.

### Task 3: Lagebild-Großbild und Lagemonitor (Form `gross`)

**Files:**
- Modify: `frontend/src/pages/lage-dashboard/LagebildGrossbild.tsx`, der Render-Abschnitt
- Modify: `frontend/src/geraet/LagemonitorPage.tsx`: `Kachel` (Zeile ~104), `Kacheln`
  (Zeile ~299) und der Render-Abschnitt (Zeile ~797)
- Test: `frontend/src/geraet/LagemonitorPage.test.tsx`, ein neues `it`

**Interfaces:**
- Consumes: `KachelGrenze` (Form `gross`, `neuversuch`) und `pruefeKachelGrenzen` aus Task 1/2.
- Produces:
  - Die `section` der Lagemonitor-`Kachel` trägt `data-lfh="monitor-kachel"`.
  - `Kacheln` bekommt die Prop `neuversuch: number`.

- [ ] **Step 1: Write the failing guard test** in `LagemonitorPage.test.tsx`:
  `it('Wächter: jede Kachel des Lagemonitors steht in ihrer eigenen KachelGrenze (LLH-1958)')`.
  Es nutzt `renderApp` wie „startet auf dem Großbild …“, wartet auf die Kopfzahlen und ruft
  `pruefeKachelGrenzen(container.querySelector('main')!, 4)`. Das sind Alarmzeile, Lagekarte,
  Meldungen und mindestens eine Kachel aus `Kacheln`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Wrap.**
  - **Lagemonitor:** `neuversuch` ist überall `lageQuery.dataUpdatedAt`, und die Form ist
    `gross`. Eine Grenze bekommen
    - `AlarmZeile`,
    - die Kachel „Lagekarte“,
    - `MeldungenKachel`,
    - `AblaufKachel`, innerhalb der Bedingung,
    - in `Kacheln` jede `Kachel` bzw. `SanitaetsdienstKachel` einzeln.
  - **Großbild:** Form `gross`, mit `neuversuch={meta}`. Der Meta-String enthält den Datenstand und
    die Uhrzeit, ein Neuversuch kommt also spätestens je Minute. Eine Grenze bekommen
    - `AlarmZeile`,
    - der Kennzahlenblock,
    - `VerlaufBlock` bzw. `GefahrenBlock`,
    - `SichtungsBlock`,
    - der Block „Stand“.
- [ ] **Step 4: Run** `LagemonitorPage.test.tsx`, `LagemonitorKarte.test.tsx` und
  `LagebildGrossbild.test.tsx` → PASS.
- [ ] **Step 5: Commit** `feat(frontend): Großbild und Lagemonitor fangen Würfe je Kachel ohne Knopf (LLH-1958)`.

### Task 4: Regel und Gates

**Files:**
- Modify: `frontend/AGENTS.md`: Neue Regel direkt nach „Jede Rahmenebene hat eine Fehlergrenze“.
- Modify: `frontend/src/geraet/AGENTS.md`: Ein Satz kommt hinzu, wenn dort Kachel- oder
  Großbildregeln stehen; vorher greppen.

- [ ] **Step 1: Regel schreiben.**
  - Wortlaut nach dem Design-Doc, Abschnitt „Regel“.
  - Sie nennt `components/KachelGrenze.tsx`, die Formen `paneel` und `gross`, die Wächter
    (`src/test/kachelWaechter.ts` und die drei `it` aus Task 2/3) und den Nachweis
    `KachelGrenze.test.tsx`.
  - Abgrenzung: Abfragefehler bleiben bei `PaneelZustand`, Würfe im Seitenrumpf bei der
    Rahmengrenze.
- [ ] **Step 2: Run** `scripts/adr-fuer.sh frontend/src/components/KachelGrenze.tsx frontend/src/geraet/LagemonitorPage.tsx`.
  Prüfe, ob eine ADR berührt ist, und passe sonst nichts an.
- [ ] **Step 3: Run** `./scripts/check-all.sh --geaendert --ohne-e2e` im Repo-Wurzelverzeichnis →
  grün. Prettier, Lint, Typen und die Vitest-Suiten des Diffs laufen dabei mit.
- [ ] **Step 4: Commit** `docs(frontend): Regel „Jede Kachel einer Lagefläche hat ihre eigene Fehlergrenze“ (LLH-1958)`.
