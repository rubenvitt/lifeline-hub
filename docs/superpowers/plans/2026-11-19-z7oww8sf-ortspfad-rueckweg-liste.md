# Ortspfad zurück zur Liste — Implementation Plan (LLH-1997)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der Ortspfad einer Detailseite geht per `navigate(-1)` zurück, wenn die vorige Seite seine Liste war, sonst verlinkt er wie heute auf die Liste.

**Architecture:** `VerlaufMerken` im `BetriebsLayout` schreibt bei jedem PUSH die vorige Adresse unter dem neuen `location.key` in ein Verlaufsgedächtnis (`sessionStorage`, Fallback `Map`). `ListenRueckweg` liest sie über `useVorigeAdresse()` und entscheidet zwischen Zurück und Link.

**Tech Stack:** React 19, react-router (data router), Vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-19-z7oww8sf-ortspfad-rueckweg-liste-design.md`

Zunder: https://zunder.rubeen.dev/#/aufgabe/z7oww8sfepbi4g4mpa016wnn

## Global Constraints

- Speicherschlüssel `lfh:verlauf`, höchstens 50 Einträge, Key `default` nie gemerkt.
- Jeder `sessionStorage`-Zugriff in `try/catch`; ohne Speicher Modul-`Map`.
- `GERAETESPEICHER`-Eintrag mit `entscheidung: 'jeder-ausgang'`; Räumfunktion in `geraetRaeumen`.
- Vergleich Ziel ↔ vorige Adresse nur über `pathname`.
- Klicks mit Zusatztaste über `handleLinkKlick` (`routing/linkModifier.ts`) dem Browser lassen.
- Bezeichner: Fachwörter deutsch, Technik englisch (`AGENTS.md`, LLH-1312); Prosa deutsch.
- Frontend-Kommandos aus `frontend/` mit `mise exec -- pnpm …`.

## Review Focus

- Verlaufseintrag nach Neuladen der Detailseite: Herkunft bleibt (Key im `history.state`) → Test in Task 1 (Speicher überlebt neues Modul-Laden).
- Detailseite schreibt Reiter per `replace` in die Adresse, dann Ortspfad: muss trotzdem zurückgehen → REPLACE-Übertrag, Test in Task 2.
- Detail → anderes Detail (Switcher) → Ortspfad: kein `navigate(-1)` auf die erste Detailseite → Test in Task 3 („von anderer Seite“).
- Gesperrter `sessionStorage` (wirft): keine weiße Seite → Test in Task 1.
- Strg-/Mittelklick: neuer Tab mit gefilterter Liste, alte Seite bleibt → Test in Task 3.

---

### Task 1: Verlaufsgedächtnis (Speicher)

**Files:**

- Create: `frontend/src/routing/verlaufGedaechtnis.ts`
- Create: `frontend/src/routing/verlaufGedaechtnis.test.ts`
- Modify: `frontend/src/offline/geraetRaeumung.ts` (Eintrag neben `lfh:liste`, Räumer in der Liste um Z. 313)

**Interfaces:**

- Produces:
  - `type VorigeAdresse = { pathname: string; search: string }`
  - `merkeHerkunft(key: string, adresse: VorigeAdresse): void` (ignoriert `'default'`)
  - `uebertrageHerkunft(alterKey: string, neuerKey: string): void`
  - `leseHerkunft(key: string): VorigeAdresse | null`
  - `verlaufGedaechtnisRaeumen(): void`
  - `VERLAUF_SCHLUESSEL = 'lfh:verlauf'`, `VERLAUF_HOECHSTENS = 50`

- [ ] **Step 1: Failing tests** in `verlaufGedaechtnis.test.ts`:
  - `merkt und liest die Herkunft je Key`: `merkeHerkunft('a', {pathname:'/x', search:'?q=1'})` → `leseHerkunft('a')` gleich.
  - `merkt nichts für den Key default`: → `leseHerkunft('default') === null`.
  - `überträgt die Herkunft bei replace`: merke `a`, `uebertrageHerkunft('a','b')` → `leseHerkunft('b')` gleich; ohne Herkunft an `a` bleibt `b` `null`.
  - `hält höchstens 50 Einträge`: 51 Keys merken → der erste ist `null`, der 51. da.
  - `überlebt ein neues Laden des Moduls`: merken, `vi.resetModules()`, neu importieren → noch da (liegt in `sessionStorage`).
  - `arbeitet ohne Speicher weiter`: `sessionStorage.getItem/setItem` werfen lassen (`vi.spyOn(Storage.prototype, …)`) → merken/lesen ohne Wurf, Wert aus der Map.
  - `räumen leert alles`: merken, `verlaufGedaechtnisRaeumen()` → `null`, `sessionStorage.getItem('lfh:verlauf') === null`.
- [ ] **Step 2:** `mise exec -- pnpm vitest run src/routing/verlaufGedaechtnis.test.ts` → FAIL (Modul fehlt).
- [ ] **Step 3:** Implementieren: JSON-Liste `[key, adresse][]` im `sessionStorage`, neuer Eintrag ans Ende, Duplikat-Key vorher entfernen, vorne kürzen auf 50; die Map spiegelt immer den letzten Stand.
- [ ] **Step 4:** Eintrag in `GERAETESPEICHER`: `ort: 'sessionStorage lfh:verlauf'`, `datei: 'routing/verlaufGedaechtnis.ts'`, `entscheidung: 'jeder-ausgang'`, `grund`: vorige Adresse je Verlaufseintrag für den Rückweg im Ortspfad (LLH-1997); Adressen tragen Filter- und Suchtexte, auch Namen. Räumer `verlaufGedaechtnis: verlaufGedaechtnisRaeumen` dazu.
- [ ] **Step 5:** `mise exec -- pnpm vitest run src/routing/verlaufGedaechtnis.test.ts src/offline/` → PASS (inkl. `geraetRaeumung.guard.test.ts`).
- [ ] **Step 6:** Commit `feat: Verlaufsgedächtnis merkt die vorige Adresse je Verlaufseintrag (LLH-1997)`.

### Task 2: `VerlaufMerken` und `useVorigeAdresse`

**Files:**

- Create: `frontend/src/routing/VerlaufMerken.tsx`
- Create: `frontend/src/routing/VerlaufMerken.test.tsx`
- Modify: `frontend/src/App.tsx` (`BetriebsLayout`, vor `<Outlet />`)

**Interfaces:**

- Consumes: Task 1.
- Produces: `VerlaufMerken(): null` (Komponente), `useVorigeAdresse(): VorigeAdresse | null`.

- [ ] **Step 1: Failing tests** mit `createMemoryRouter` (Routen `/liste`, `/detail/:id`), `VerlaufMerken` im Layout-Element, eine Sonde zeigt `JSON.stringify(useVorigeAdresse())`:
  - `PUSH merkt die vorige Adresse`: Start `/liste?f.status=offen`, `router.navigate('/detail/1')` → Sonde `{"pathname":"/liste","search":"?f.status=offen"}`.
  - `erster Eintrag hat keine Herkunft`: Start `/detail/1` → `null`.
  - `REPLACE behält die Herkunft`: wie oben, dann `router.navigate('/detail/1?reiter=b', { replace: true })` → weiter `/liste`.
  - `POP liest die Herkunft des Eintrags`: `/liste` → `/detail/1` → `/detail/2` → `router.navigate(-1)` → Sonde `/liste`.
- [ ] **Step 2:** Test laufen lassen → FAIL.
- [ ] **Step 3:** Implementieren: `useLocation()`, `useNavigationType()`, `useRef` mit der zuletzt gesehenen Location; in `useLayoutEffect([location.key])`: PUSH → `merkeHerkunft(location.key, {pathname, search} der Ref)`, REPLACE → `uebertrageHerkunft(ref.key, location.key)`, dann Ref aktualisieren. `useVorigeAdresse` = `leseHerkunft(useLocation().key)` (Effekt im Layout läuft vor den Effekten nicht, deshalb Lesen per `useSyncExternalStore` oder: Merken synchron im Render des Layouts über eine Ref-Prüfung `if (ref.key !== location.key)` — Wahl des Bauenden, der Test „PUSH merkt“ muss im ersten Render der Detailseite grün sein).
- [ ] **Step 4:** In `BetriebsLayout` `<VerlaufMerken />` einhängen (Kommentar mit Verweis auf das Design-Doc).
- [ ] **Step 5:** Tests → PASS.
- [ ] **Step 6:** Commit `feat: Layout merkt die Herkunft jeder Seite (LLH-1997)`.

### Task 3: `ListenRueckweg`

**Files:**

- Create: `frontend/src/components/ListenRueckweg.tsx`
- Create: `frontend/src/components/ListenRueckweg.test.tsx`

**Interfaces:**

- Consumes: `useVorigeAdresse` (Task 2), `handleLinkKlick` (`routing/linkModifier.ts`).
- Produces: `ListenRueckweg(props: { to: string; children: ReactNode }): JSX.Element` — rendert immer ein `<a>`.

- [ ] **Step 1: Failing tests** (Memory-Router mit `VerlaufMerken`, Liste zeigt `useLocation().search` an):
  - `von der Liste gekommen: Klick geht zurück`: `/liste?q=meier` → `/detail/1` → Klick auf „Liste“ → Liste zeigt `?q=meier`, `router.state.historyAction === 'POP'`.
  - `href trägt die Query der vorigen Liste`: → `href === '/liste?q=meier'`.
  - `direkt geöffnet: Link auf die nackte Liste`: Start `/detail/1`, Klick → `/liste`, Search leer, Aktion `PUSH`.
  - `von anderer Seite: Link`: `/liste` → `/detail/2` → `/detail/1` → Klick → PUSH auf `/liste`.
  - `Ziel mit Zeilenmarke passt über den Pfad`: `to='/liste?personal=5'`, vorher `/liste?q=x` → Klick POP, Liste `?q=x`.
  - `Strg-Klick wird nicht abgefangen`: `fireEvent.click(a, { ctrlKey: true })` → `defaultPrevented === false`, Ort unverändert.
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3:** Implementieren: `passt = vorige && new URL(to, window.location.origin).pathname === vorige.pathname`; bei `passt` `<Link to={vorige.pathname + vorige.search} onClick={(e) => handleLinkKlick(e, () => navigate(-1))}>`, sonst `<Link to={to}>`. Kurzer Doku-Kommentar mit Verweis auf `frontend/AGENTS.md`, „Ortspfad zur Liste über `ListenRueckweg`“.
- [ ] **Step 4:** → PASS.
- [ ] **Step 5:** Commit `feat: ListenRueckweg geht zurück, wenn man von der Liste kam (LLH-1997)`.

### Task 4: Einsatz-Detailseiten umstellen

**Files (je Ortspfad-Glied zur Liste `<Link to={…}>` → `<ListenRueckweg to={…}>`):**

- `pages/PersonenDetailPage.tsx:864`, `pages/TiereDetailPage.tsx:518`, `pages/SchaedenDetailPage.tsx:394`, `pages/BetreuungsstelleDetailPage.tsx:702`, `pages/uhs/UhsDetailPage.tsx:381`, `pages/bereitstellungsraum/BrDetailPage.tsx:805`, `pages/EvakuierungsbezirkPage.tsx:185`, `pages/EinsatzkraftPage.tsx:513`, `pages/BefehlDetailPage.tsx:405`, `pages/EinheitDetailPage.tsx:540`, `pages/einheit/EinheitAufgeloestAnsicht.tsx:179`, `pages/LageberichtDetailPage.tsx:394`, `verpflegung/AusgabeAnsicht.tsx:399` (Zeilen Stand `alpha`, vor dem Bearbeiten neu suchen)
- Test: `frontend/src/pages/PersonenDetailPage.rueckweg.test.tsx`

**Interfaces:** Consumes `ListenRueckweg` (Task 3).

- [ ] **Step 1: Failing Seitentest** nach dem Muster vorhandener `PersonenDetailPage`-Tests (gleiche Mocks/Wrapper): Router startet auf `personenPfad(1)` + `?q=meier`, navigiert zu `personDetailPfad(1, 7)`, Klick auf das Ortspfad-Glied „Betroffene“ → Ort ist `personenPfad(1)` mit `?q=meier`.
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3:** Alle Stellen oben umstellen; nur das Ortspfad-Glied, keine anderen Rückwege (Storno-Knopf, `SeitenNichtGefunden`, `navigate` nach Löschen bleiben).
- [ ] **Step 4:** `mise exec -- pnpm vitest run src/pages src/verpflegung` und `mise exec -- pnpm exec tsc -b` → PASS.
- [ ] **Step 5:** Commit `feat: Detailseiten im Einsatz kehren über den Ortspfad zur Liste zurück (LLH-1997)`.

### Task 5: Unterseiten und Verwaltung umstellen

**Files:**

- Unterseiten: `pages/UnterkunftPlanenPage.tsx:212-213` (beide Glieder), `pages/PersonDruckPage.tsx:93`, `pages/AuftragDruckPage.tsx:93`, `pages/personen/AufnahmePage.tsx:182-184`, `verpflegung/TagAusVorlage.tsx:186`, `pages/EinheitAusVorlagePage.tsx:226`
- Verwaltung (`pfad` von `AdminPage`): `stammdaten/FahrzeugDetailPage.tsx:150`, `stammdaten/PersonalDetailPage.tsx:144`, `stammdaten/EinheitVorlageDetailPage.tsx:312`, `planung/PlanungPage.tsx:106`, `pages/einstellungen/AnbindungAnsicht.tsx:207`

- [ ] **Step 1:** Umstellen wie Task 4.
- [ ] **Step 2:** Vorhandene Tests der Dateien und `tsc -b` → PASS (`ListenRueckweg` ist ein `<a>`; Tests, die `getByRole('link', …)` nutzen, bleiben gültig).
- [ ] **Step 3:** Commit `feat: Unterseiten und Verwaltung kehren über den Ortspfad zurück (LLH-1997)`.

### Task 6: Regel und Wächter

**Files:**

- Modify: `frontend/AGENTS.md`, Abschnitt „Deeplink-Muster“ (neuer Punkt)
- Optional Create: `frontend/src/components/ListenRueckweg.guard.test.ts`

- [ ] **Step 1:** Regelpunkt **„Ortspfad zur Liste über `ListenRueckweg`“**: Ein Ortspfad-Glied auf eine Liste oder übergeordnete Seite ist `ListenRueckweg`, nie ein nackter `Link`; Herkunft aus dem Verlaufsgedächtnis (`routing/verlaufGedaechtnis.ts`, `VerlaufMerken` im `BetriebsLayout`), `navigate(-1)` nur bei passendem Pfad, sonst Link; andere Rückwege (nach Aktionen, Nicht-gefunden) bleiben Links. Herleitung: das Design-Doc.
- [ ] **Step 2 (Wahl des Bauenden):** Wächter versuchen, der in Dateien mit `breadcrumb=`/`pfad=` innerhalb eines `items`/`pfad`-Arrays `title: <Link` meldet. Wird er an Bestand falsch rot (Glieder, die keine Rückwege sind), weglassen und im Commit sagen.
- [ ] **Step 3:** `mise exec -- pnpm exec prettier --check AGENTS.md` → PASS.
- [ ] **Step 4:** Commit `docs: Regel Ortspfad zur Liste über ListenRueckweg (LLH-1997)`.

### Task 7: e2e-Nachweis

**Files:**

- Create: `frontend/e2e/ortspfad-rueckweg.spec.ts`

- [ ] **Step 1:** Spec nach dem Muster der Betroffenen-Specs (`anmeldenPerApi`, Seeding per `page.request`): Einsatz mit ≥ 30 Personen, Betroffene mit Suchbegriff/Spaltenfilter in der Adresse öffnen, eine Person öffnen, Ortspfad „Betroffene“ klicken → `expect(page).toHaveURL(/q=…/)` und Filter sichtbar. Zweiter Test: Detailseite direkt öffnen → Ortspfad führt auf die nackte Liste. Rollposition nur prüfen, wenn LLH-1826 (`RollWiederherstellung`) auf dem Branch liegt.
- [ ] **Step 2:** `cargo build` (Wurzel), dann `mise exec -- pnpm exec playwright test e2e/ortspfad-rueckweg.spec.ts --trace off` → PASS.
- [ ] **Step 3:** Commit `test: e2e Rückweg über den Ortspfad (LLH-1997)`.

### Task 8: Abschluss

- [ ] `git fetch origin alpha && git merge origin/alpha` (falls LLH-1826 inzwischen da ist: Konflikt in `BetriebsLayout` auflösen, beide Bausteine behalten; Rollposition in Task 7 nachziehen).
- [ ] `./scripts/check-all.sh --geaendert --ohne-e2e` (aus der Wurzel) → grün.
- [ ] Plan abhaken, Bilder der Änderung, PR gegen `alpha`.
