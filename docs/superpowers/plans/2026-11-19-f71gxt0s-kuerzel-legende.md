# Kürzel-Legende Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die sichtbare Schreibweise „F/UF/M//Σ“ ist an jeder Stärke-Fläche antippbar und erklärt sich in einem Popover; die Hilfe findet die Kürzel.

**Architecture:** Ein Baustein `anzeige/KuerzelErklaerung.tsx` (Knopf ohne Knopfoptik + antd-`Popover`, Daten aus `EINGEFUEHRTE_KUERZEL`) mit der Abkürzung `StaerkeSchreibweise`. Alle Stärke-Flächen nutzen ihn; ein Wächter verbietet die nackte Schreibweise in `.tsx`. Kapitel und Suchtests in der Hilfe.

**Tech Stack:** React 18, antd 5, Vitest + Testing Library, Markdown-Kapitel unter `docs/anwender/kapitel/`.

**Spec:** `docs/superpowers/specs/2026-11-19-f71gxt0s-kuerzel-legende-design.md`

Pfade ohne Präfix sind relativ zu `frontend/src/`. Tests: `mise exec -- pnpm -C frontend exec vitest run <pfad>` aus der Repo-Wurzel.

## Global Constraints

- Umfang nur die Stärke-Schreibweise; keine Legende für FMS, SK oder andere Kürzel.
- Kein Knopf in einem Link; ein Tippen auf Auslöser oder Popover löst weder Zeile, Link noch Tabellensortierung aus.
- Im Druck (`@media print`) nur Text, ohne Unterstreichung.
- Texte unpersönlich, deutsch; Link-Text „Zeiten und Kürzel“, Ziel `/hilfe/zeiten-und-kuerzel`.
- Stärke-Werte behalten `title={STAERKE_AUSGESCHRIEBEN}` und werden nicht antippbar.
- Bezeichner: Fachbegriffe deutsch, Technik englisch (`AGENTS.md`, LLH-1312).
- Kapitelform nach `docs/anwender/AGENTS.md` (vier `##`, keine weiteren; nur GFM).

## Review Focus

- Tippen auf die Legende in einer Tabelle mit `sorter` (`stammdaten/FahrzeugeTab.tsx`): sortiert nicht → Test in Task 2.
- Tippen in einer klickbaren Zeile/Karte: Klick-Handler der Umgebung feuert nicht → Test in Task 1 (Eltern-`onClick` bleibt ungerufen, auch beim Klick in den Popover-Inhalt).
- Tastatur: Enter öffnet, Escape schließt, Fokus zurück auf den Auslöser → Test in Task 1.
- Feldetikett eines Formulars (`DatenfeldEingabe` als `<label>`): Antippen öffnet das Popover, nicht das Eingabefeld → Test in Task 2 an `EinheitKopf`.
- Schmale Köpfe (390 px), z. B. UHS-Meta: die Schreibweise bricht nicht mitten im Kürzel → bleibt `whiteSpace: nowrap` am Auslöser, Sichtprüfung im Bildlauf (Task 4).

---

### Task 1: Baustein `KuerzelErklaerung`

**Files:**
- Modify: `anzeige/kuerzel.ts` (Feld `beispiel?: string`, Typ `Kuerzel`)
- Create: `anzeige/KuerzelErklaerung.tsx`
- Test: `anzeige/KuerzelErklaerung.test.tsx`

**Interfaces:**
- Produces: `type Kuerzel = (typeof EINGEFUEHRTE_KUERZEL)[number]['kuerzel']` (Liste dafür `as const satisfies …`); `export default function KuerzelErklaerung(props: { kuerzel: Kuerzel; children?: ReactNode }): JSX.Element`; `export function StaerkeSchreibweise(props: { children?: ReactNode }): JSX.Element` (= `KuerzelErklaerung kuerzel="F/UF/M//Σ"`).

- [ ] **Step 1: Failing tests** in `KuerzelErklaerung.test.tsx` (Router um die Komponente):
  - `zeigt das Kürzel als Knopf mit Bedeutung im Namen`: `getByRole('button', { name: /F\/UF\/M\/\/Σ.*Führer \/ Unterführer \/ Mannschaft \/\/ Summe/ })`, sichtbarer Text `F/UF/M//Σ`, `aria-expanded="false"`.
  - `öffnet per Klick die Erklärung mit Beispiel und Link`: nach Klick `aria-expanded="true"`, Dialog/Tooltip-Inhalt enthält „Führer / Unterführer / Mannschaft // Summe (Stärke)“, „1/2/5//8: ein Führer, zwei Unterführer, fünf Helferinnen und Helfer, zusammen acht“, `getByRole('link', { name: 'Zeiten und Kürzel' })` mit `href` `/hilfe/zeiten-und-kuerzel`.
  - `löst den Klick der Umgebung nicht aus`: Elternelement mit `onClick = vi.fn()`; Klick auf Auslöser und Klick in den Popover-Text → `not.toHaveBeenCalled()`.
  - `Tastatur: Enter öffnet, Escape schließt und gibt den Fokus zurück`.
  - `ohne Beispiel kein Beispielsatz` (z. B. `kuerzel="UHS"`).
  - `children ersetzen den sichtbaren Text, die Bedeutung bleibt im Namen`.
- [ ] **Step 2:** Lauf → FAIL (Modul fehlt).
- [ ] **Step 3:** `kuerzel.ts`: `beispiel` für `F/UF/M//Σ` = `'1/2/5//8: ein Führer, zwei Unterführer, fünf Helferinnen und Helfer, zusammen acht'`. `KuerzelErklaerung.tsx`: `<Popover trigger="click" open/onOpenChange>` um `<button type="button" className="lfh-kuerzel">`; Stil: Schrift/Farbe erben, kein Rand/Hintergrund/Polster, `text-decoration: underline dotted`, `cursor: help`, `white-space: nowrap`, Tippfeld über `::after` (inset −8px), `@media print` ohne Unterstreichung (CSS in `anzeige/KuerzelErklaerung.css` oder bestehender Stil-Weg des Ordners). `aria-label` = `` `${kuerzel}: ${bedeutung}, Erklärung öffnen` ``. `onClick`/`onKeyDown` am Knopf und ein Wrapper um den Popover-Inhalt stoppen die Weitergabe. Link per `react-router` `Link`.
- [ ] **Step 4:** Lauf → PASS; dazu `anzeige/kuerzel.test.ts` grün.
- [ ] **Step 5:** Commit `feat(kuerzel): antippbare Erklärung eines eingeführten Kürzels`.

### Task 2: Stärke-Flächen auf den Baustein, Wächter

**Files:**
- Create: `anzeige/kuerzelErklaerung.guard.test.ts`
- Modify (Schreibweise → `<StaerkeSchreibweise />`): `stammdaten/EinheitVorlagenTab.tsx:111`, `stammdaten/EinheitTypenTab.tsx:34`, `stammdaten/EinheitVorlageDetailPage.tsx:490`, `stammdaten/FahrzeugeTab.tsx:146`, `kraefte/EinheitVorschau.tsx:74,83`, `kraefte/FahrzeugVorschau.tsx:59`, `kraefte/Verdichtungszeile.tsx:155`, `pages/KraefteuebersichtPage.tsx:386` (die `<wbr>`-Teilung als `children`), `pages/uhs/UhsKraefte.tsx:309`, `pages/uhs/UhsDetailPage.tsx:283` (`metaTeile` wird `ReactNode[]`, Schlüssel per Index), `pages/EinsatzabschnittePage.tsx:900`, `pages/bereitstellungsraum/BrDetailPage.tsx:886`, `pages/einheit/EinheitKopf.tsx:395,462`, `pages/einsatzabschnitte/Organigramm.tsx:553`, `pages/einsatzabschnitte/AbschnittDaten.tsx:57,60`, `pages/einsatzabschnitte/AbschnittDetail.tsx:255,258`, `geraet/GeraetAbschnittPage.tsx:144`
- Modify (Sonderfälle): `pages/fuehrung/UeberblickPage.tsx` (Augenbraue in der Link-Zeile bleibt Text; Meta des `GliederungsPaneel` „Einsatzabschnitte“ um „· Stärke <StaerkeSchreibweise />“ ergänzt), `pages/lagekarte/leistenDaten.ts` + `pages/lagekarte/Inspector.tsx` (`RasterFeld` bekommt `labelKuerzel?: Kuerzel`; Label „Stärke“, `RasterZelle` hängt den Baustein an), `geraet/LagemonitorPage.tsx:361` (vorher in `geraet/AGENTS.md` prüfen: ist der Lagemonitor ohne Bedienung → Ausnahme; sonst `bezeichnung: ReactNode`)
- Test: bestehende Tests der Liste unten anpassen; `stammdaten/FahrzeugeTab` bzw. `pages/FahrzeugePage.test.tsx`, `pages/einheit/EinheitKopf.test.tsx`

**Interfaces:**
- Consumes: `StaerkeSchreibweise`, `Kuerzel` aus Task 1.

- [ ] **Step 1: Failing Wächter** `kuerzelErklaerung.guard.test.ts` (Muster wie `anzeige/staerke.guard.test.ts`): alle nicht-Test-`.tsx` unter `/src`; Treffer = Zeile mit `STAERKE_SCHREIBWEISE` oder dem Literal `F/UF/M//Σ`, die keine `import`-Zeile ist; erlaubt nur in `/src/anzeige/KuerzelErklaerung.tsx` und in `AUSNAHMEN: Record<string, string>` (Pfad → Grund; erwartet: `UeberblickPage.tsx` „Link-Zeile, Legende im Paneelkopf“, ggf. `LagemonitorPage.tsx`). Zweiter Test: jede Ausnahme hat noch einen Treffer (keine toten Einträge). Gegenprobe: `treffer('<span>Stärke {STAERKE_SCHREIBWEISE}</span>')` hat Länge 1, `treffer("import { STAERKE_SCHREIBWEISE } from './staerke';")` Länge 0.
- [ ] **Step 2:** Lauf → FAIL mit der Liste der Stellen oben.
- [ ] **Step 3: Failing Verhaltenstests:**
  - `FahrzeugePage.test.tsx`: `Tippen auf „F/UF/M//Σ“ im Spaltenkopf sortiert nicht` (Reihenfolge der Zeilen vor/nach Klick gleich, Popover offen).
  - `EinheitKopf.test.tsx`: `das Etikett „Soll-Stärke (F/UF/M//Σ)“ öffnet die Erklärung` (Knopf mit Namen /F\/UF\/M\/\/Σ/, nach Klick Link „Zeiten und Kürzel“; kein Eingabefeld fokussiert).
- [ ] **Step 4:** Stellen umbauen (Liste oben), Ausnahmen eintragen.
- [ ] **Step 5:** Wächter, neue Tests und die betroffenen Tests laufen lassen: `anzeige/StaerkeAnzeige.test.tsx pages/EinheitDetailPage.test.tsx pages/EinsatzabschnittePage.test.tsx pages/einheit/EinheitKopf.test.tsx pages/lage-dashboard/LageDashboardPage.test.tsx pages/FahrzeugePage.test.tsx pages/EinheitenPage.test.tsx pages/einsatzabschnitte/AbschnittVorschau.test.tsx pages/einsatzabschnitte/AbschnittDetail.test.tsx pages/uhs pages/fuehrung pages/lagekarte geraet kraefte stammdaten`. Textsuchen, die an einem zusammenhängenden Textknoten hängen („Stärke F/UF/M//Σ“), auf Rolle/Teiltext umstellen, Aussage der Tests nicht abschwächen. Erwartet: alle grün.
- [ ] **Step 6:** Commit `feat(kuerzel): Stärke-Schreibweise überall antippbar, Wächter`.

### Task 3: Hilfe — Glossar und Suche

**Files:**
- Modify: `docs/anwender/kapitel/zeiten-und-kuerzel.md`
- Test: `hilfe/HilfePage.test.tsx`

- [ ] **Step 1: Tests** in `HilfePage.test.tsx`, je Suchwort `F/UF/M`, `SK`, `Glossar`, `EA 1`: `die Suche nach „<wort>“ findet „Zeiten und Kürzel“` (Suchfeld `searchbox` „Kapitel durchsuchen“, danach Link/Eintrag „Zeiten und Kürzel“ sichtbar, „Kein Kapitel passt zur Suche.“ fehlt).
- [ ] **Step 2:** Lauf → erwartet FAIL bei „Glossar“ und „EA 1“. Scheitert auch „F/UF/M“: Ursache in `falte`/Filter von `HilfePage.tsx` per `systematic-debugging` klären und beheben.
- [ ] **Step 3:** Kapitel: Überblick-Satz „Es ist das Glossar der App: …“; Ablauf „Eine Stärke lesen“ Schritt 3 → „Auf „F/UF/M//Σ“ tippen oder klicken: ein Fenster nennt die Bedeutung, ein Beispiel und führt mit „Zeiten und Kürzel“ hierher.“; Hintergrund neuer `### Kurzbezeichnungen der Organisation` (EA 1, EA 1.1 vergibt die Organisation, die App zeigt sie unverändert; ohne Kurzbezeichnung steht der Name); Quelle `frontend/src/anzeige/KuerzelErklaerung.tsx` in den Kopf. Den Satz „Organisationen vergeben … EA 1.1 …“ aus „### Stärke“ in den neuen Abschnitt verschieben, nicht doppeln.
- [ ] **Step 4:** Lauf `hilfe/` und `anzeige/kuerzel.test.ts` → PASS (inkl. `anwenderdoku.guard.test.ts`).
- [ ] **Step 5:** Commit `docs(anwender): Zeiten und Kürzel als Glossar, Suche nach Kürzeln`.

### Task 4: Regel, Gates, Bilder

**Files:**
- Modify: `frontend/AGENTS.md` (Abschnitt „Kürzel sind eingeführt oder erklärt“), `anzeige/StaerkeAnzeige.tsx` (Kommentar auf den Baustein verweisen)

- [ ] **Step 1:** Regel ergänzen: „Die sichtbare Schreibweise der Stärke steht über `anzeige/KuerzelErklaerung.tsx` (`StaerkeSchreibweise`, antippbar, Popover mit Bedeutung, Beispiel und Link ins Kapitel), nicht als nackter Text; in einem Link steht sie als Text und die Legende einmal im Kopf der Fläche (LLH-1825). Wächter: `anzeige/kuerzelErklaerung.guard.test.ts`.“
- [ ] **Step 2:** `./scripts/check-all.sh --geaendert --ohne-e2e` → grün (Prettier über `frontend/`).
- [ ] **Step 3:** Bilder per Wegwerf-Spec `frontend/e2e/doku-bilder/zz-f71gxt0s.bilder.ts` (nach `cargo build`): Einheitenseite mit offenem Popover, Überblick-Paneelkopf, UHS-Kopf bei 390 px; Ablage außerhalb `docs/anwender/bilder/`, Spec danach löschen.
- [ ] **Step 4:** Commit `docs(agents): Regel antippbare Stärke-Schreibweise`.
