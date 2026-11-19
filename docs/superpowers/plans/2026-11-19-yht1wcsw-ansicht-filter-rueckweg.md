# Ansicht, Filter und Rollposition überleben den Rückweg — Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ansicht und Filter aller Einsatzseiten stehen in der Adresse, und beim Browser-Zurück steht
die Seite wieder auf ihrer Rollposition.

**Architecture:** Ein kleiner Satz Hooks in `routing/useAdressWert.ts` liest und schreibt einzelne
Query-Parameter (`replace`, Vorgabe fehlt in der Adresse). Die Seiten tauschen ihr `useState` gegen
diese Hooks. Eine Komponente `RollWiederherstellung` im Stab-Rahmen merkt die Rollposition je
`location.key` in `sessionStorage` und stellt sie beim POP wieder her, sobald die Seite hoch genug
ist.

**Tech Stack:** React 19, react-router (Data Router), TanStack Query, Vitest + Testing Library,
Playwright.

**Spec:** `docs/superpowers/specs/2026-11-19-yht1wcsw-ansicht-filter-rueckweg-design.md`

## Global Constraints

- Schreiben immer mit `setSearchParams(alt => …, { replace: true })`. Fremde Parameter bleiben.
  Die Vorgabe löscht den Parameter.
- Ein unbekannter Wert gilt als Vorgabe (exhaustiver `Record<T, true>`, wie `parseFahrzeugeAnsicht`).
- Kein Sitzungsgedächtnis für Ansicht und Filter. Ein Neueinstieg über das Modulmenü beginnt mit der
  Vorgabe.
- Freitext wird entprellt geschrieben, `GEDAECHTNIS_ENTPRELLUNG_MS` (300 ms,
  `components/listenGedaechtnis.ts`). Die Personensuche kommt nie in die Adresse.
- Parameternamen wie in D3/D3a des Entwurfs. Keine Kollision mit `meldung`, `auftrag`, `befehl`,
  `reiter`, `eintrag`, `neu`, `person`, `einheit`, `personal`, `sort`, `f.*`, und `q` nur einmal je
  Seite.
- Bezeichner: Fachbegriffe deutsch, Technik englisch (`AGENTS.md`, LLH-1312). Prosa deutsch.
- `sessionStorage` nur mit `try/catch`. Jeder neue Speicherort steht in `GERAETESPEICHER`
  (`offline/geraetRaeumung.ts`).
- Die Rollwiederherstellung gilt nur im Stab-Rahmen (`components/AppLayout.tsx`), nicht in der
  Gerätehülle.
- Tests laufen aus der Repo-Wurzel:
  `mise exec -- pnpm -C frontend exec vitest run <pfad relativ zu frontend/>`.

## Review Focus

1. **Zurück nach einem Filterwechsel:** Drei Filterwechsel und dann Browser-Zurück führen aus der
   Seite heraus, nicht durch die Filter (`replace`). Test in Task 1.
2. **Eigene Eingabe während der Wiederherstellung:** Wer schon rollt, wird nicht zurückgerissen.
   Test in Task 2.
3. **Deeplink mit Ziel beim POP** (`?meldung=7`, `?eintrag=3`): Die Seite steuert ihr Ziel an, der
   Wiederhersteller hält still. Test in Task 2.
4. **Wechsel des Einsatzes auf derselben Route:** Ein Filter von Einsatz 1 gilt nicht in Einsatz 2.
   Das trägt die Adresse; Test in Task 3 (Meldungen) als Vertreter.
5. **Suchfeld und Zurück:** Nach Browser-Zurück zeigt das Feld den Text der Adresse, nicht den
   zuletzt getippten. Test in Task 1.

---

### Task 1: Hooks für Werte in der Adresse

**Files:**
- Create: `frontend/src/routing/useAdressWert.ts`
- Test: `frontend/src/routing/useAdressWert.test.tsx`

**Interfaces:**
- Produces:
  - `setzeParam(alt: URLSearchParams, schluessel: string, wert: string | undefined): URLSearchParams`
    (neue Instanz, `undefined` oder `''` löscht)
  - `liesErlaubt<T extends string>(params: URLSearchParams, schluessel: string, erlaubt: Record<T, true>): T | undefined`
  - `useAdressWert<T extends string>(schluessel: string, erlaubt: Record<T, true>, vorgabe: T): [T, (neu: T) => void]`:
    `neu === vorgabe` löscht.
  - `useAdressWahl<T extends string>(schluessel: string, erlaubt: Record<T, true>): [T | undefined, (neu: T | undefined) => void]`:
    ohne feste Vorgabe, schreibt jede ausdrückliche Wahl (Befehle, D3a).
  - `useAdressSchalter(schluessel: string): [boolean, (an: boolean) => void]`: `=1` oder fehlt.
  - `useAdressKennung(schluessel: string): [number | undefined, (id: number | undefined) => void]`:
    liest über `parseRouteId`, eine ungültige Kennung gilt als `undefined`.
  - `useAdressSuche(schluessel?: string): [string, (text: string) => void]`: Vorgabe `'q'`. Hält
    den Text lokal, schreibt nach `GEDAECHTNIS_ENTPRELLUNG_MS`, setzt neu auf, wenn sich der
    Parameter von außen ändert.

- [x] **Step 1: Write the failing tests** in `useAdressWert.test.tsx`. Mit `createMemoryRouter` und
  einer Sonde, die `useLocation().search` zeigt:
  - `setzeParam lässt fremde Parameter stehen`: `setzeParam(new URLSearchParams('meldung=7&richtung=extern'), 'richtung', undefined).toString() === 'meldung=7'`
  - `useAdressWert liest den Wert und nimmt bei Unbekanntem die Vorgabe`: `?richtung=extern` →
    `'extern'`; `?richtung=quer` → `'alle'`
  - `die Vorgabe steht nicht in der Adresse`: setzen auf `'extern'` → `search === '?richtung=extern'`,
    dann auf `'alle'` → `search === ''`
  - `ein Wechsel legt keinen Verlaufseintrag an`: Start `['/liste', '/einsaetze/1/meldungen']`,
    dreimal wechseln, `router.navigate(-1)` → `pathname === '/liste'`
  - `useAdressWahl schreibt auch den Wert, der gerade Vorgabe wäre`: setzen auf `'entwuerfe'` →
    `search === '?befehle_sicht=entwuerfe'`
  - `useAdressSchalter`: `?luecken=1` → `true`; ausschalten → Parameter fehlt
  - `useAdressKennung verwirft eine ungültige Kennung`: `?abschnitt=abc` → `undefined`
  - `useAdressSuche schreibt entprellt`: Fake-Timer, `setzeText('Bra')`, nach 299 ms kein `q`, nach
    300 ms `search === '?q=Bra'`
  - `useAdressSuche folgt einer fremden Änderung`: Start `?q=alt`, `router.navigate('?q=neu', { replace: true })`
    → Text `'neu'`

- [x] **Step 2: Run, expect FAIL** (`Cannot find module './useAdressWert'`):
  `mise exec -- pnpm -C frontend exec vitest run src/routing/useAdressWert.test.tsx`

- [x] **Step 3: Implement** in `routing/useAdressWert.ts`. Alle Hooks bauen auf `useSearchParams`
  und `setzeParam`. `useAdressSuche` nutzt einen Timer-Ref und vergleicht den Adresswert mit dem
  zuletzt selbst geschriebenen, um eine fremde Änderung zu erkennen.

- [x] **Step 4: Run, expect PASS** (gleiches Kommando).

- [x] **Step 5: Commit** `feat: Hooks für Ansicht und Filter in der Adresse (LLH-1826)`

### Task 2: Rollposition beim Zurück wiederherstellen

**Files:**
- Create: `frontend/src/routing/rollGedaechtnis.ts`
- Create: `frontend/src/components/RollWiederherstellung.tsx`
- Modify: `frontend/src/components/AppLayout.tsx` (einmal montieren, neben `<Outlet />`)
- Modify: `frontend/src/offline/geraetRaeumung.ts` (Eintrag in `GERAETESPEICHER`, Räumer in `geraetRaeumen`)
- Test: `frontend/src/routing/rollGedaechtnis.test.ts`, `frontend/src/components/RollWiederherstellung.test.tsx`

**Interfaces:**
- Produces:
  - `merkeRolle(key: string, y: number): void`, `liesRolle(key: string): number | undefined`,
    `rollGedaechtnisRaeumen(): void`. Ein Eintrag `sessionStorage['lfh:rolle']` als JSON-Liste
    `[key, y][]`, höchstens `ROLL_HOECHSTENS = 50`, die ältesten fallen heraus. Ohne Speicher
    wirkt eine Modul-`Map` als Ersatz.
  - `ROLL_FRIST_MS = 2000`
  - `RollWiederherstellung(): null`
  - `traegtZiel(params: URLSearchParams): boolean`: wahr, wenn einer der Deeplink-Parameter
    `meldung`, `auftrag`, `befehl`, `eintrag`, `erinnerung`, `fahrzeug`, `abschnitt`,
    `gefahrengebiet`, `personal`, `einheit` gesetzt ist (Liste in `rollGedaechtnis.ts`, aus dem
    Abschnitt „Deeplink-Muster“ in `frontend/AGENTS.md`).

- [x] **Step 1: Write the failing tests.** `rollGedaechtnis.test.ts`:
  - `merkt und liest je Schlüssel`; `hält höchstens 50 Einträge` (51. Eintrag verdrängt den ersten)
  - `arbeitet ohne sessionStorage`: `sessionStorage.setItem` wirft → `liesRolle` liefert trotzdem
    den Wert aus der Map

  `RollWiederherstellung.test.tsx` (Data Router mit Liste `/a` und `/b`, `window.scrollTo` und
  `document.documentElement.scrollHeight` gestubbt, Fake-Timer):
  - `POP rollt zurück, sobald die Seite hoch genug ist`: auf `/a` `scrollY = 1400`, PUSH `/b`,
    POP. Bei `scrollHeight = 800` kein `scrollTo(0, 1400)`. Danach `scrollHeight = 3000` und
    Resize-Callback → `scrollTo(0, 1400)`.
  - `gibt nach ROLL_FRIST_MS auf`: Höhe bleibt 800, nach 2000 ms kein `scrollTo(0, 1400)`, auch
    nicht nach späterem Wachsen.
  - `eigene Eingabe bricht ab`: nach POP `wheel` auf `window`, dann wächst die Höhe → kein
    `scrollTo(0, 1400)`.
  - `PUSH beginnt oben`: `scrollTo(0, 0)`.
  - `REPLACE rollt nicht`: `navigate('/a?richtung=extern', { replace: true })` → kein `scrollTo`.
  - `ein Deeplink-Ziel hat Vorrang`: POP auf `/a?meldung=7` → kein `scrollTo(0, 1400)`.
  - `setzt history.scrollRestoration auf manual und beim Abbau zurück`.

- [x] **Step 2: Run, expect FAIL.**
  `mise exec -- pnpm -C frontend exec vitest run src/routing/rollGedaechtnis.test.ts src/components/RollWiederherstellung.test.tsx`

- [x] **Step 3: Implement.** Gemerkt wird im Aufräumen eines `useLayoutEffect` auf `location.key`
  (Position des verlassenen Eintrags) und bei `pagehide`. Beim POP: `liesRolle(key)`, dann ein
  `ResizeObserver` auf `document.documentElement` bis
  `scrollHeight - innerHeight >= y`; Abbruch über `wheel`, `touchstart`, `keydown`, `pointerdown`
  (`{ once: true, passive: true }`) und Frist. Der `GERAETESPEICHER`-Eintrag:
  `ort: 'sessionStorage lfh:rolle'`, `entscheidung: 'jeder-ausgang'`, Grund: Rollpositionen je
  Verlaufseintrag für das Zurück (LLH-1826), ohne Inhalt, ein Ausgang braucht sie nicht.

- [x] **Step 4: Run, expect PASS** (Kommando aus Step 2, dazu
  `src/offline/geraetRaeumung.guard.test.ts`).

- [x] **Step 5: Commit** `feat: Rollposition beim Zurück wiederherstellen (LLH-1826)`

### Task 3: Meldungen

**Files:**
- Modify: `frontend/src/pages/MeldungenPage.tsx:158-159` (und Segment ~:977, Select ~:991)
- Modify: `frontend/src/meldungen/MeldungenSchmal.tsx:58` (Filter über Props bzw. dieselben Hooks)
- Modify: `frontend/src/routing/deeplinks.ts` (`MELDUNGEN_SICHT_ERLAUBT`, `MELDUNGEN_RICHTUNG_ERLAUBT`)
- Test: `frontend/src/pages/MeldungenPage.test.tsx`

**Interfaces:**
- Consumes: `useAdressWert` (Task 1)
- Produces: Parameter `sicht` (`offen` Vorgabe | `abgeschlossen`), `richtung` (`alle` Vorgabe |
  `intern` | `extern`)

- [x] **Step 1: Write the failing tests:**
  - `„Extern“ steht nach der Wahl in der Adresse`: Wahl → `search` enthält `richtung=extern`
  - `?richtung=extern&sicht=abgeschlossen zeigt die gewählte Sicht`: Select zeigt „Extern“, Segment
    „Abgeschlossen“ aktiv
  - `der Filter eines Einsatzes gilt nicht im anderen`: auf `/einsaetze/1/meldungen?richtung=extern`,
    navigiere zu `/einsaetze/2/meldungen` → „Alle Richtungen“
- [x] **Step 2: Run, expect FAIL.**
- [x] **Step 3: Implement:** `useState` durch `useAdressWert` ersetzen. `MeldungenSchmal` bekommt
  dieselben Werte (keine zweite Wahrheit).
- [x] **Step 4: Run, expect PASS** (`src/pages/MeldungenPage.test.tsx`, `src/meldungen/`).
- [x] **Step 5: Commit** `feat: Meldungen merken Sicht und Richtung in der Adresse (LLH-1826)`

### Task 4: Aufträge und Befehle

**Files:**
- Modify: `frontend/src/auftraege/AuftraegeListe.tsx:108-116`
- Modify: `frontend/src/auftraege/BefehlListe.tsx:114-133,154`
- Modify: `frontend/src/routing/deeplinks.ts` (Erlaubt-Records)
- Test: `frontend/src/auftraege/AuftraegeListe.test.tsx`, `frontend/src/auftraege/BefehlListe.test.tsx`

**Interfaces:**
- Consumes: `useAdressWert`, `useAdressWahl`, `useAdressSuche`
- Produces: Aufträge `sicht`, `richtung`, `empf`, `q`; Befehle `befehle_sicht` (Werte = die
  bestehenden Segmentwerte), `befehle_empf`, `befehle_q`

- [x] **Step 1: Write the failing tests:**
  - `Aufträge: Sicht, Richtung, Empfänger und Suche stehen in der Adresse` (je ein Assert auf `search`)
  - `Befehle: Suche filtert die Aufträge nicht`: `befehle_q=Foo` → Aufträge zeigen alle
  - `Befehle: ohne befehle_sicht gilt die abgeleitete Vorgabe` (Entwurf vorhanden → „Entwürfe“)
  - `Befehle: ausdrückliche Wahl bleibt, auch wenn der letzte Entwurf freigegeben ist`:
    `?befehle_sicht=entwuerfe` mit Daten ohne Entwurf → Segment „Entwürfe“ aktiv
  - `?befehl=<id> schreibt das Segment des Befehls als befehle_sicht`
- [x] **Step 2: Run, expect FAIL.**
- [x] **Step 3: Implement.** Die abgeleitete Vorgabe bleibt in `BefehlListe`, sie greift nur, wenn
  `useAdressWahl` `undefined` liefert.
- [x] **Step 4: Run, expect PASS** (`src/auftraege/`, `src/pages/AuftraegePage*.test.tsx`).
- [x] **Step 5: Commit** `feat: Aufträge und Befehle merken Sicht und Filter in der Adresse (LLH-1826)`

### Task 5: Betroffene — die Sicht ist Zustand der Adresse (D4)

**Files:**
- Modify: `frontend/src/pages/PersonenPage.tsx:196-215,640-671` (`sichtNachEinsatz`, Effekt mit
  `sichtAuftrag` entfernen; `?neu=1` und `?person=` bleiben)
- Modify: `frontend/src/personen/personenFilter.ts` (`sichtNachSprung` entfernen, wenn ohne Nutzer)
- Modify: `frontend/src/routing/deeplinks.ts:360-395` (`parsePersonenSicht` bleibt Leser; Doku-Kommentar
  „Auftrag“ → „Zustand“)
- Test: `frontend/src/pages/PersonenPage.test.tsx`, `frontend/src/einsatz/sprungmarken.test.ts`

**Interfaces:**
- Consumes: `useAdressWert`, `useAdressSchalter`
- Produces: `ansicht` (`zeilen` Vorgabe | `raster` | `karte`), `filter` (`alle` Vorgabe | …),
  `luecken=1`, `abgeschlossen=1`. Suche bleibt außerhalb der Adresse.

- [x] **Step 1: Write the failing tests:**
  - `das Sichtungsraster steht in der Adresse`: Wahl „Raster“ → `search` enthält `ansicht=raster`
  - `?ansicht=raster bleibt nach dem Anwenden in der Adresse` (bisher geräumt)
  - `die Sprungmarke „Vermisste“ zeigt genau ihre Sicht`: Start `?ansicht=raster`, navigiere zu
    `?filter=vermisst` → Ansicht „Zeilen“, Filter „Vermisste“
  - `die Suche kommt nicht in die Adresse` (bestehender Test bleibt grün)
  - Bestehende Tests, die das Räumen von `filter`/`ansicht` erwarten, auf das neue Verhalten
    umschreiben.
- [x] **Step 2: Run, expect FAIL.**
- [x] **Step 3: Implement.**
- [x] **Step 4: Run, expect PASS** (`src/pages/PersonenPage*.test.tsx`, `src/personen/`,
  `src/einsatz/sprungmarken.test.ts`).
- [x] **Step 5: Commit** `feat: Betroffene merken Ansicht und Filter in der Adresse (LLH-1826)`

### Task 6: Fahrzeuge und Einsatzabschnitte

**Files:**
- Modify: `frontend/src/pages/FahrzeugePage.tsx:471,493-505`
- Modify: `frontend/src/pages/EinsatzabschnittePage.tsx:227,290-300`
- Modify: `frontend/src/routing/deeplinks.ts` (Kommentare von `fahrzeugePfad`,
  `einsatzabschnittePfad`: „Auftrag … apply-then-clean“ → „Zustand der Adresse“)
- Test: `frontend/src/pages/FahrzeugePage.test.tsx`, `frontend/src/pages/EinsatzabschnittePage.test.tsx`

**Interfaces:**
- Consumes: `useAdressWert` mit `FAHRZEUGE_ANSICHT_ERLAUBT` (Vorgabe `liste`) und
  `ABSCHNITTE_ANSICHT_ERLAUBT` (Vorgabe `gliederung`); beide Records exportieren.

- [x] **Step 1: Write the failing tests:** je Seite „Wahl steht in der Adresse“ und „`?ansicht=…`
  bleibt nach dem Anwenden“; Tests, die das Räumen erwarten, umschreiben.
- [x] **Step 2: Run, expect FAIL.**
- [x] **Step 3: Implement** (`…NachEinsatz` entfällt).
- [x] **Step 4: Run, expect PASS.**
- [x] **Step 5: Commit** `feat: Fahrzeuge und Abschnitte merken die Ansicht in der Adresse (LLH-1826)`

### Task 7: Kräfteübersicht und Lagemeldungen

**Files:**
- Modify: `frontend/src/pages/KraefteuebersichtPage.tsx:820` (nur `filter`; Ausklappstufe und
  `expandedKeys` bleiben `useState`)
- Modify: `frontend/src/pages/LagemeldungenPage.tsx:138`, `frontend/src/lagemeldungen/zeitachse.ts:83`
- Test: `frontend/src/pages/KraefteuebersichtPage.test.tsx`, `frontend/src/pages/LagemeldungenPage.test.tsx`

**Interfaces:**
- Consumes: `useAdressKennung` (`abschnitt`), `useAdressWert` oder `useAdressKennung` für `traeger`
  und `kategorie` (je nach bestehendem Typ: Schlüssel → `useAdressWert` mit Record aus den
  bekannten Werten, ID → `useAdressKennung`), `useAdressSchalter` (`ohne_auftrag`,
  `rueckmeldung_fehlt`), `useAdressSuche` (`q`).
- Lagemeldungen: `ort` und `herkunft` mit dem Hook, der zum bestehenden Typ passt, `q` über
  `useAdressSuche`. Der Zeitraum (`parseLageZeitraum`) bleibt unverändert.

- [x] **Step 1: Write the failing tests:** je Filterfeld „steht nach der Wahl in der Adresse“; eine
  Adresse mit allen Feldern zeigt sie gesetzt; ein unbekannter Abschnitt wird verworfen.
- [x] **Step 2: Run, expect FAIL.**
- [x] **Step 3: Implement.**
- [x] **Step 4: Run, expect PASS.**
- [x] **Step 5: Commit** `feat: Kräfteübersicht und Lagemeldungen merken Filter in der Adresse (LLH-1826)`

### Task 8: Einfache Segmente der übrigen Module und die Einsatzliste

**Files** (je Seite den Startwert des bisherigen `useState` als Vorgabe, die Werte des bestehenden
Typs als Record in `routing/deeplinks.ts`):
- `pages/ErinnerungenPage.tsx:52` → `sicht`
- `pages/InfotelefonPage.tsx:116` → `sicht`
- `pages/SchaedenPage.tsx:254` → `sicht`
- `pages/TierePage.tsx:220` → `sicht` (`…NachEinsatz` entfällt)
- `pages/VerpflegungPage.tsx:212` → `ansicht`
- `pages/AbloesungPage.tsx:~234` → `vergangen` (neben dem bestehenden `?ansicht=`)
- `pages/MaterialPage.tsx:267` → `gruppierung`
- `pages/UnterkunftPlanenPage.tsx:84` → `ansicht`
- `pages/EinsaetzePage.tsx:318` → `q` über `useAdressSuche`
- Tests: die jeweilige `*.test.tsx` der Seite

**Interfaces:** Consumes `useAdressWert`, `useAdressSuche`.

- [x] **Step 1: Write the failing tests:** je Seite ein Test „die Wahl steht in der Adresse“ und ein
  Test „eine Adresse mit dem Wert zeigt die Wahl“.
- [x] **Step 2: Run, expect FAIL.**
- [x] **Step 3: Implement**, Seite für Seite.
- [x] **Step 4: Run, expect PASS.**
- [x] **Step 5: Commit** `feat: übrige Module merken Sicht und Ansicht in der Adresse (LLH-1826)`

### Task 9: Regeln, Doku, e2e

**Files:**
- Modify: `frontend/AGENTS.md` — „Deeplink-Muster“: „Filter gehören in die URL“ →
  „**Ansicht und Filter gehören in die Adresse** (LLH-1826)“: jede Einsatzseite, Hooks aus
  `routing/useAdressWert.ts`, `replace`, Vorgabe fehlt, kein Sitzungsspeicher, Personensuche
  ausgenommen. Neuer Punkt **Rollposition**: `components/RollWiederherstellung.tsx`, POP stellt
  wieder her, PUSH oben, REPLACE nichts, Deeplink-Ziel hat Vorrang, nur Stab-Rahmen.
  Sprungmarken (~Z. 738): „`parsePersonenSicht`/`sichtNachSprung` apply-then-clean“ → „die Sicht
  ist Zustand der Adresse“.
- Modify: Bereichs-`AGENTS.md`, die eine geänderte Stelle anders beschreiben. Finden mit
  `grep -rn "apply-then-clean\|Seitenzustand\|sichtNachSprung" frontend/ docs/ --include=*.md`.
- Modify: `docs/anwender/…`, wo ein Kapitel das Zurücksetzen einer Sicht beschreibt (gleicher
  `grep` auf „zurückgesetzt“ und „Ansicht“ in `docs/anwender/`; Kapitelregeln in
  `docs/anwender/AGENTS.md`).
- Create: `frontend/e2e/rueckweg.spec.ts`

- [x] **Step 1:** `scripts/adr-fuer.sh frontend/src/pages/PersonenPage.tsx frontend/src/routing/deeplinks.ts`
  ausführen. Steht dort eine ADR, die „Ansicht ist Seitenzustand“ festschreibt, anhalten und dem
  Menschen melden.
- [x] **Step 2: Write the e2e spec** `rueckweg.spec.ts`:
  - `Meldungen „Extern“ überlebt Weg und Zurück`: Wahl „Extern“, zu ETB, `page.goBack()` →
    „Extern“ gewählt
  - `Betroffene im Raster und Rollposition 1400 überleben das Zurück`: Ansicht „Raster“ (bei zu
    wenig Demo-Daten die Zeilenansicht mit Fensterhöhe 400), `window.scrollTo(0, 1400)`, Person
    öffnen, `page.goBack()` → `ansicht=raster` in der URL und `scrollY` innerhalb ±2 px des
    gemerkten Werts
- [x] **Step 3: Run** `mise exec -- pnpm -C frontend exec playwright test e2e/rueckweg.spec.ts --trace off`,
  expect PASS (vorher `cargo build` in der Wurzel).
- [x] **Step 4: Regeln und Doku schreiben** (oben), `mise exec -- pnpm -C frontend exec prettier --check AGENTS.md`.
- [x] **Step 5: Commit** `docs: Ansicht und Filter gehören in die Adresse, Rollposition (LLH-1826)`

### Task 10: Gate

- [x] **Step 1:** `./scripts/check-all.sh --geaendert --ohne-e2e` aus der Repo-Wurzel, ein Aufruf
  (bei Bedarf `run_in_background`). Expected: alle Schritte grün.
- [x] **Step 2:** Rote Schritte beheben und je Ursache einen Commit machen.
