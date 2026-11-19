# Knopfreihe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Baustein `Knopfreihe` mit festem Abstand `md` einführen, Kopf-, Fuß- und Rot-Reihen
darauf umstellen, die Wächter `aktionsabstand.guard` und `aktionenSpace.guard` durch einen
Ratschen-Wächter ersetzen.

**Architecture:** `components/instrument/Knopfreihe.tsx` (Flex-Zeile, `gap` = `rasterAbstand(token, 'md')`,
Variante `fuss`). Ein Ratschen-Wächter zählt je Datei die verbliebenen `<Space>`-Knopfreihen
gegen eine Schuldliste. Jede Umstellung senkt die Schuld im selben Commit.

**Tech Stack:** React 19, antd 6.7, Vitest + Testing Library, Playwright (e2e), mise/pnpm.

**Spec:** `docs/superpowers/specs/2026-11-19-jysfxw29-knopfreihe-design.md`

## Global Constraints

- Ein Abstand für jede Knopfreihe: Rasterstufe `md` (kompakt 12, komfortabel 20, handschuh 24 px), `rasterAbstand(token, 'md')`; kein Prop für den Abstand.
- `Knopfreihe` hat kein `style`-Prop und nimmt keine Zahl an; sie ordnet ihre Kinder nicht um (kein CSS-`order`).
- Immer `flex-wrap: wrap`, `min-width: 0`, `align-items: center`.
- `fuss`: ab `md` rechtsbündig; unter `md` (`useViewport().istSchmal`) untereinander in voller Breite, Lesefolge bleibt (Primär zuletzt = unten).
- Reihenfolge-Regel (Text, kein Wächter): Kopf/Paneel/Zeile Primär vorn, Fuß Primär hinten.
- Der Seitenkopf bleibt ab `lg` einzeilig (LLH-1786); bricht er um, rückt `BUENDELN_AB_STEUERHOEHE` bzw. die Bündelungsschwelle, nicht die Erwartung im e2e.
- Bezeichner: Fachbegriffe deutsch, Technik englisch (`AGENTS.md`, LFH-1312); Prosa deutsch.
- Prettier über ganz `frontend/`; Node/pnpm nur über `mise exec --`.
- Commits mit Zeile `Zunder: https://zunder.rubeen.dev/#/aufgabe/jysfxw296payquntyrijvyog`.

## Review Focus

- Dialogfuß bei 390 px Breite mit drei Knöpfen (Serie der Erfassung): kein Knopf läuft links hinaus, alle in voller Breite untereinander. → Test in Task 1 (`fuss` schmal) und e2e-Lauf in Task 8.
- Handschuh-Dichte: Abstand 24 px zwischen zwei Kopfknöpfen, Kopf bleibt ab `lg` einzeilig (Kräfte). → Task 3, e2e `kraefte-seitenkopf`.
- Leere oder bedingte Kinder (`{darf && <Button/>}` liefert `false`): keine Doppel-Lücke, keine leere Reihe mit Höhe. → Test in Task 1.
- `aktionen` als Fragment im Kopf behält „Genau eine Primäraktion“ (Dev-Zählung `primaeraktionen(aktionenRef.current)`). → Task 3 Schritt 4.
- Drucken: `className="kraefte-no-print"` an der Kräfte-Reihe darf nicht verloren gehen. → Task 3, `className`-Prop.

---

### Task 1: Baustein `Knopfreihe`

**Files:**
- Create: `frontend/src/components/instrument/Knopfreihe.tsx`
- Create: `frontend/src/components/instrument/Knopfreihe.test.tsx`
- Modify: `frontend/src/components/instrument/index.ts` (Export neben `Stapel`)

**Interfaces:**
- Produces:
  ```ts
  export interface KnopfreiheProps extends Pick<AriaAttributes, 'aria-label' | 'aria-labelledby'> {
    children: ReactNode;
    /** Dialogfuß: ab md rechtsbündig, unter md untereinander in voller Breite. */
    fuss?: boolean;
    id?: string;
    className?: string;
    'data-lfh'?: string;
    ref?: Ref<HTMLDivElement>;   // React 19: ref als Prop
  }
  export default function Knopfreihe(props: KnopfreiheProps): JSX.Element
  ```
  Export in `index.ts`: `export { default as Knopfreihe, type KnopfreiheProps } from './Knopfreihe';`
- Dateikopf nennt Regel: `frontend/AGENTS.md`, „Aktionen“, und ADR-0070.

- [x] **Step 1: Failing tests** in `Knopfreihe.test.tsx` (Vorbild `Stapel.test.tsx` für Dichte-Wrapper):
  - `setzt den Abstand md der aktiven Dichte` — je Dichte `kompakt`/`komfortabel`/`handschuh`: `style.gap` === `${dichten[d].abstand.md}px` (12/20/24).
  - `bricht um und schrumpft` — `flexWrap: 'wrap'`, `minWidth: '0px'`, `alignItems: 'center'`, `flexDirection: 'row'`.
  - `behält die Reihenfolge der Kinder` — drei Knöpfe A, B, C → `getAllByRole('button')` Namen `['A','B','C']`.
  - `fuss ist ab md rechtsbündig` — `justifyContent: 'flex-end'`, `flexDirection: 'row'`.
  - `fuss stapelt unter md in voller Breite` — `useViewport` gemockt auf `istSchmal: true`: `flexDirection: 'column'`, `alignItems: 'stretch'`; Reihenfolge unverändert.
  - `lässt false-Kinder ohne Lücke weg` — `<Knopfreihe>{false}<Button>A</Button>{null}</Knopfreihe>` → genau ein Kindelement im Container.
  - `reicht data-lfh, className und ref durch`.
  - Typprobe: `// @ts-expect-error kein style` an `<Knopfreihe style={{}}>`.
- [x] **Step 2:** `mise exec -- pnpm -C frontend exec vitest run src/components/instrument/Knopfreihe.test.tsx` → FAIL (Modul fehlt).
- [x] **Step 3: Implementieren.** Stil wie `Stapel` (inline `CSSProperties`, `theme.useToken()`, `rasterAbstand` aus `./Stapel`, `useViewport` wie in `components/Erfassung.tsx:283`). Volle Breite unter `md` über `alignItems: 'stretch'` der Spalte; antd-`Button` als Flex-Kind streckt sich damit; prüfen, dass kein `block` nötig ist.
- [x] **Step 4:** Test erneut → PASS. `mise exec -- pnpm -C frontend exec tsc --noEmit -p .` grün.
- [x] **Step 5: Commit** `feat(instrument): Baustein Knopfreihe mit Abstand md (LLH-1973)`.

### Task 2: Ratschen-Wächter `knopfreihe.guard`

**Files:**
- Create: `frontend/src/components/knopfreihe.guard.test.ts`
- Create: `frontend/src/components/knopfreihe.schuld.ts`

**Interfaces:**
- Produces: `export const KNOPFREIHE_SCHULD: Readonly<Record<string, number>>` (Pfad relativ zu `frontend/src/` → Zahl), sortiert; und im Test `export function knopfreihenIn(quelltext: string): number[]` (Zeilennummern).
- Scanner: aus `reihenIn` in `aktionsabstand.guard.test.ts` ableiten (Kopie von `ohneKommentare`, `tagEnde`; Stack je unmittelbar umschließendem `<Space>`), ohne Rot-Bewertung. Zählt ein `<Space>` (nicht `Space.Compact`, nicht selbstschließend, ohne `orientation="vertical"`/`direction="vertical"`) mit ≥ 2 unmittelbaren `<Button>`/`<StatusWahl>`. `.test.tsx` und `.stories` ausgenommen.

- [x] **Step 1: Tests schreiben:**
  - `keine Datei hat mehr Knopfreihen als ihre Schuld` (Meldung `pfad: n > schuld`).
  - `keine neue Datei mit Knopfreihen` (Datei ohne Eintrag und Zahl > 0).
  - `gesunkene Schuld wird nachgetragen` (Zahl < Schuld → rot mit „Schuld auf n senken“; 0 → „Eintrag streichen“).
  - Selbstbeweise: zählt `<Space><Button/><Button/></Space>` als 1; nicht `<Space orientation="vertical">…`; nicht `<Space.Compact>`; nicht über Schachtelung hinweg; nicht im Kommentar; `StatusWahl<number>` zählt; Pfeilfunktion im Tag beendet es nicht.
- [x] **Step 2: Schuld erzeugen.** Einmal mit leerer Liste laufen lassen, die gemeldeten Zahlen als `KNOPFREIHE_SCHULD` eintragen (Stand heute ≈ 74 Reihen in 62 Dateien). Dateikopf: Abbaubedingung „Liste leer → Wächter und Liste löschen, ADR-0070 auf `ersetzt` prüfen“.
- [x] **Step 3:** `vitest run src/components/knopfreihe.guard.test.ts` → PASS.
- [x] **Step 4: Commit** `test(components): Ratschen-Wächter gegen Knopfreihen aus Space (LLH-1973)`.

### Task 3: Seitenkopf

**Files:**
- Modify: `frontend/src/components/EinsatzSeite.tsx:676-694` (Hülle `seitenkopf-aktionen` → `<Knopfreihe ref={aktionenRef} data-lfh="seitenkopf-aktionen">`), ggf. `:289` `BUENDELN_AB_STEUERHOEHE`
- Modify: `frontend/src/pages/LagekartePage.tsx:1546-1549` (gleiche Hülle)
- Modify (inneres `<Space>` in `aktionen` → Fragment `<>…</>`; `className` an der Kräfte-Reihe als `<span className="kraefte-no-print" style={{display:'contents'}}>` oder auf jeden Knopf, Implementierer wählt, Druck prüfen):
  `pages/KraefteuebersichtPage.tsx:1527`, `pages/MaterialPage.tsx:1100`, `pages/EvakuierungsbezirkPage.tsx:192`, `pages/LagemeldungenPage.tsx:413`, `pages/FahrzeugePage.tsx:1285`, `pages/uhs/UhsDetailPage.tsx:388`, `pages/PersonalPage.tsx:678`, `pages/EinsatzabschnittePage.tsx:798`, `pages/bereitstellungsraum/BrDetailPage.tsx:813`, `pages/LageberichtDetailPage.tsx:409`, `geraet/GeraetBetreuungsstellePage.tsx:132` (vorher prüfen, dass der Slot in `EinsatzSeite` mündet; sonst wie Task 4)
- Modify: `frontend/src/components/knopfreihe.schuld.ts` (Zahlen senken)
- Test: `frontend/src/components/EinsatzSeite.test.tsx`

**Interfaces:** Consumes `Knopfreihe` (Task 1).

- [x] **Step 1: Failing test** in `EinsatzSeite.test.tsx`: `die Kopfaktionen stehen md auseinander` — `[data-lfh="seitenkopf-aktionen"]` hat `gap` = `${dichten.kompakt.abstand.md}px`.
- [x] **Step 2:** FAIL bestätigen (heute `marginSM` = 8).
- [x] **Step 3:** Hüllen umstellen, Slots auf Fragment, Schuld senken.
- [x] **Step 4:** Unit-Tests der berührten Seiten + Wächter grün; im Dev-Build „Genau eine Primäraktion“ zählt weiter (bestehender Test zu `primaeraktionen`).
- [x] **Step 5: Einzeiligkeit messen:** `cargo build` (Wurzel), dann in `frontend/` `mise exec -- pnpm exec playwright test --trace off e2e/kraefte-seitenkopf.spec.ts e2e/trefflaeche-pruefflaechen.spec.ts e2e/betroffene-handy.spec.ts e2e/gate3-trefflaeche.spec.ts`. Rot wegen Umbruch → Bündelungsschwelle in `EinsatzSeite.tsx:289-298` anpassen, bis `kraefte-seitenkopf` grün ist; Erwartung der Spec nicht ändern. `gate3-trefflaeche` („Personal (LLH-1273)“) misst den Abstand: Erwartung auf ≥ `md` nachziehen ist erlaubt.
- [x] **Step 6: Commit** `refactor(seitenkopf): Kopfaktionen als Knopfreihe (LLH-1973)`.

### Task 4: Übrige `aktionen`-Slots

**Files:**
- Modify: `frontend/src/instanz/InstanzkopplungSeite.tsx:205` (`<Space wrap size={token.marginSM}>` → `<Knopfreihe>`, Hülle `adminpage-aktionen` in `components/AdminPage.tsx` bleibt)
- Modify: `frontend/src/offline/OfflineRecoveryDrawer.tsx:600` (`AntragKarte`, `<Space size="middle">` → `<Knopfreihe>`) und die übrigen Reihen dieser Datei (Wächterliste)
- Modify: `knopfreihe.schuld.ts`

- [x] **Step 1:** Bestehende Tests der Dateien laufen lassen (Baseline grün).
- [x] **Step 2:** Umstellen, Schuld senken.
- [x] **Step 3:** `vitest run src/instanz src/offline src/components/knopfreihe.guard.test.ts src/components/aktionsabstand.guard.test.ts` → PASS. (`aktionsabstand` sieht `OfflineRecoveryDrawer` danach nicht mehr: die Datei vorübergehend aus `MIT_NACHBARSCHAFT` streichen; der Wächter geht in Task 7.)
- [x] **Step 4: Commit** `refactor: Aktionen in Verwaltung und Offline-Wiederherstellung als Knopfreihe (LLH-1973)`.

### Task 5: Dialogfüße

**Files:**
- Modify: `frontend/src/components/Erfassung.tsx:536-560` (`<Space size="middle" orientation=… wrap=… style=…>` → `<Knopfreihe fuss>`; `block={istSchmal}` an den Knöpfen entfällt, wenn Task 1 die Breite trägt; Dateikopf-Absatz „Die Knöpfe der Aktion stehen mit `size="middle"`…“ auf `Knopfreihe` umschreiben)
- Modify: `footer`-Reihen → `<Knopfreihe fuss>`: `pages/MaterialPage.tsx:1227`, `pages/FahrzeugePage.tsx:1569`, `pages/EinsatzabschnittePage.tsx:1109`, `pages/lagekarte/ZeichenWahlDialog.tsx:41`, `pages/lagekarte/LageplanAnlageDialog.tsx:208`, `pages/lagekarte/ZeichenHierDialog.tsx:79`
- Modify: `knopfreihe.schuld.ts`
- Test: `frontend/src/components/Erfassung.test.tsx`

- [x] **Step 1: Failing test** in `Erfassung.test.tsx`: `der Fuß ist eine Knopfreihe` — Fuß-Container hat `gap` `md` und unter `istSchmal` `flexDirection: 'column'`, Primärknopf ist letzter Knopf.
- [x] **Step 2:** FAIL bestätigen.
- [x] **Step 3:** Umstellen; Primärknopf in jedem Fuß zuletzt (heute schon so, prüfen). `aktionsabstand`-Liste: `components/Erfassung.tsx`, `pages/EinsatzabschnittePage.tsx` bleiben dort nur, solange sie noch eine `<Space>`-Reihe mit Rot haben; sonst streichen.
- [x] **Step 4:** `vitest run` der berührten Dateien + beide Wächter → PASS.
- [x] **Step 5: Commit** `refactor: Dialogfüße als Knopfreihe (LLH-1973)`.

### Task 6: Rot-Reihen der Wächterlisten

**Files (Liste aus `aktionsabstand.guard.test.ts`, ohne die in Task 3–5 erledigten):**
`stammdaten/EtbBausteineTab.tsx`, `stammdaten/SprechgruppenTab.tsx`, `stammdaten/dienststatus.tsx`, `stammdaten/KatalogVerwaltung.tsx`, `pages/DokumentePage.tsx`, `karten/OfflineKartenVerwaltung.tsx`, `karten/OnlineQuellenVerwaltung.tsx`, `pages/PersonenDetailPage.tsx` (zwei Reihen), `pages/einheit/EinheitUebernahme.tsx`, `auftraege/AuftragTeile.tsx`, `stammdaten/StichworteTab.tsx`, `pages/MitgliederAbschnitt.tsx`, `pages/lagekarte/ZonenInspector.tsx`, `pages/SchaedenDetailPage.tsx`, `pages/TiereDetailPage.tsx` — alle unter `frontend/src/`.

- [x] **Step 1:** Baseline: Tests der Dateien grün; `PersonenDetailPage.test.tsx` erwähnt den Wächter, Erwartung lesen.
- [x] **Step 2:** Jede waagerechte `<Space>`-Knopfreihe dieser Dateien → `<Knopfreihe>` (in Tabellen-Aktionsspalten ebenso); `<Space size="middle">` um gespreizte `{aktionen}` in `AuftragTeile.tsx` → `<Knopfreihe>`. Schuld je Datei senken oder Eintrag streichen.
- [x] **Step 3:** `vitest run` der berührten Ordner + `knopfreihe.guard` → PASS. `aktionsabstand.guard` darf hier rot werden (Listen belegen nichts mehr): direkt mit Task 7 im selben Lauf weitermachen, Commit erst nach Task 7 Schritt 2 grün.
- [x] **Step 4: Commit** `refactor: Reihen mit roter Aktion als Knopfreihe (LLH-1973)`.

### Task 7: Wächter, Regeln, ADR

**Files:**
- Delete: `frontend/src/components/aktionsabstand.guard.test.ts`, `frontend/src/components/aktionenSpace.guard.test.ts`
- Modify: `frontend/AGENTS.md` — Abschnitt „Aktionen“: die Spiegelstriche „Ein `<Space>` in `aktionen` nennt seinen Abstand“ und „Rot steht nicht bündig neben Neutralem“ (heute ~Z. 1325-1333) ersetzen durch einen: „**Knopfreihen über `Knopfreihe`** (LLH-1973, ADR-0070): zwei oder mehr Knöpfe nebeneinander stehen in `Knopfreihe` (Abstand `md`, fest), Dialogfüße mit `fuss`; Primär im Kopf/Paneel/Zeile vorn, im Fuß hinten; der Baustein ordnet nicht um. Bestand: `components/knopfreihe.schuld.ts` (Ratsche). antds eigene Füße bleiben bei der Regel in `index.css`.“ — den Teil zu `index.css`/„Kein Komponenten-Token `marginXS`“ behalten. Bausteinliste (~Z. 102) und Bausteinwahl-Tabelle (~Z. 400) um `Knopfreihe` ergänzen. Zeile 125 („`aktionen` rechts …“) um „Abstand `md`“ nicht doppeln, nur verweisen.
- Create: `docs/architektur/entscheidungen/ADR-0070-knopfreihen-stehen-in-knopfreihe-mit-einem-abstand.md` (Vorlage `VORLAGE.md`; vorher `git fetch origin alpha` und `scripts/adr-fuer.sh --alle`, Nummer prüfen). `gilt_fuer`: `frontend/src/components/instrument/Knopfreihe.tsx`, `frontend/src/components/knopfreihe.guard.test.ts`, `frontend/src/components/knopfreihe.schuld.ts`, `frontend/src/**/*.tsx`. Regeln: MUST Knopfreihen in `Knopfreihe` (Verweis `frontend/AGENTS.md`, „Aktionen“); MUST NOT `Knopfreihe` nimmt `style` oder einen Abstand an; MUST NOT Schuld wächst. Prüfung: `verbiete '^  style\??:|abstand\??:' frontend/src/components/instrument/Knopfreihe.tsx`, `verlange "rasterAbstand\(token, 'md'\)" frontend/src/components/instrument/Knopfreihe.tsx`, `test -f frontend/src/components/knopfreihe.guard.test.ts`. `herleitung`: Design-Doc + Zunder LLH-1973.
- Modify: Verweise — `git grep -n 'aktionsabstand\|aktionenSpace\|LLH-1273\|LFH-363 · B5c'` (u. a. `components/AdminPage.tsx`, `pages/PersonenDetailPage.test.tsx`, `components/Erfassung.tsx`, `src/**/AGENTS.md`, `theme/tokens.test.ts`) auf `Knopfreihe`/ADR-0070 umbiegen; e2e-Kommentare ebenso.

- [x] **Step 1:** Wächter löschen, Verweise umbiegen, AGENTS.md, ADR.
- [x] **Step 2:** `./scripts/check-all.sh --nur schnell` (Wurzel) → grün (ADR-Wächter, Links, Prettier).
- [x] **Step 3: Commit** `refactor: Abstands-Wächter durch Knopfreihe ersetzen, ADR-0070 (LLH-1973)` (zusammen mit Task 6, falls dort offen).

### Task 8: Design System, Gates, Bilder

**Files:**
- Modify: `frontend/scripts/design-system/previews.tsx` (Karte `Knopfreihe`: Kopfreihe Primär + Sekundär, Fuß mit Abbrechen + rotem Primär, wie die Karte `Stapel`)
- Generated: `docs/design/design-system/project/components/Knopfreihe/{README.md,preview.html}` und was `pnpm design-system` sonst neu schreibt

- [x] **Step 1:** Karte ergänzen, `mise exec -- pnpm -C frontend design-system`, `vitest run src/designSystem.test.ts` → PASS.
- [x] **Step 2:** `./scripts/check-all.sh --geaendert --ohne-e2e` (ein Aufruf) → grün; Ergebnis für „Geprüft“ notieren.
- [x] **Step 3:** e2e gezielt: `kraefte-seitenkopf`, `trefflaeche-pruefflaechen`, `betroffene-handy`, `gate3-trefflaeche`, `dialogfuss-dichte`, `dokumente` → grün.
- [x] **Step 4:** Bilder per Wegwerf-Spec `frontend/e2e/doku-bilder/zz-jysfxw29.bilder.ts` (nicht committen): Seitenkopf Personal, Rückfrage „Abschnitt auflösen“, Erfassungsfuß bei 390 px; kompakt und handschuh, vorher (alpha) und nachher.
- [x] **Step 5: Commit** `docs(design-system): Karte Knopfreihe (LLH-1973)`; Plan-Kästchen abhaken.
