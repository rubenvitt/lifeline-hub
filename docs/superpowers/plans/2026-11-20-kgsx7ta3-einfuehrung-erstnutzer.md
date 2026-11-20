# Rundgang für Erstnutzer — Umsetzungsplan (LLH-1990)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zweigeteilter Rundgang mit Sprechblasen (Teil „Liste“ auf der Einsatzliste, Teil „Einsatz“ im Einsatzrahmen) mit Selbststart nur für Erstnutzer bzw. nur in Übungen, wieder aufrufbar über Willkommenskarte und Sprungpalette.

**Architecture:** Ein `RundgangProvider` (in `App.tsx` neben der Hilfe-Seitenleiste) hält den aktiven Teil und rendert antd `Tour`. Seiten melden per `useRundgangOrt(teil, selbststart)` an, welcher Teil zu ihnen gehört; Willkommenskarte und Palette starten ihn über `useRundgang().starte`. Schritt-Texte und Anker stehen in einer einzigen Datei, die der Erklärtext-Wächter ausnimmt. „Gesehen“ steht je Teil als Schlüssel in den Benutzer-Einstellungen (Server-Whitelist).

**Tech Stack:** React 19, antd 6 (`Tour`), TanStack Query, Vitest + Testing Library + MSW; Rust (axum) für die Whitelist.

**Spec:** `docs/superpowers/specs/2026-11-20-kgsx7ta3-einfuehrung-erstnutzer-design.md`

## Global Constraints

- Keine Anrede in Texten (LLH-1830; `anredeText.guard.test.ts` gilt auch für die Rundgang-Texte).
- Nur eingeführte Kürzel (LLH-1750).
- Bezeichner: Fachbegriffe deutsch, Technik englisch (`AGENTS.md`, LFH-1312); Prosa deutsch.
- Schlüsselnamen exakt: `rundgang_liste_gesehen`, `rundgang_einsatz_gesehen`.
- Kein Rundgang für Gerätekonten (`auth.geraet`) und im Kontext mobil (`!abBreite('md')`).
- Teil „Einsatz“ startet von selbst nur bei `isUebung(einsatz)`.
- Der Rundgang öffnet und schließt kein Paneel und keine Schublade.
- Gesehen-Schlüssel wird gesetzt, sobald die erste Sprechblase steht.
- Query-Keys nur über `api/queryKeys.ts` (`globalKeys.benutzerEinstellungenVon`).
- Gates: `./scripts/check-all.sh --geaendert --ohne-e2e`.

## Review Focus

1. **Stand lädt noch / Abruf scheitert** → kein Selbststart (wie `istWillkommenOffen`: nur bekannter Stand). Test in Task 2.
2. **Ziel nicht sichtbar** (Suche erst ab `lg`, Einsatz lädt, `visibility: hidden` der Kopfsuche) → Schritt entfällt; ohne Schritt kein Start und kein „gesehen“. Test in Task 3 und 4.
3. **Speichern scheitert** → Rundgang läuft trotzdem, Cache trägt den Schlüssel, kein Wiederauftauchen in derselben Sitzung. Test in Task 2 (Merker).
4. **Echter Einsatz** → nie Selbststart, auch wenn beide Schlüssel fehlen und die Karte offen ist. Test in Task 5.
5. **Kundiger Benutzer nach dem Update** (Karte geschlossen, keine Rundgang-Schlüssel) → weder Liste noch Übung startet von selbst. Test in Task 2.

---

### Task 1: Server kennt die zwei Schlüssel

**Files:**
- Modify: `src/benutzer_einstellungen/mod.rs` (Konstanten neben `SCHLUESSEL_WILLKOMMEN_GESCHLOSSEN`, Einträge in `BEKANNTE_SCHLUESSEL`, Tests)

**Interfaces:**
- Produces: `pub const SCHLUESSEL_RUNDGANG_LISTE_GESEHEN: &str = "rundgang_liste_gesehen";`, `pub const SCHLUESSEL_RUNDGANG_EINSATZ_GESEHEN: &str = "rundgang_einsatz_gesehen";`

- [ ] **Step 1: Failing test** `rundgang_schluessel_sind_gueltige_opake_schluessel`: beide `ist_gueltiger_schluessel(..)` true, Literale wie oben, `pruefe_wert(k, "2026-11-20T10:00:00Z").unwrap() == "2026-11-20T10:00:00Z"`.
- [ ] **Step 2:** `cargo test --lib benutzer_einstellungen` → FAIL (Konstante fehlt).
- [ ] **Step 3:** Konstanten mit Doc-Kommentar (Spiegel in `frontend/src/hilfe/rundgang/rundgangSchluessel.ts`), in `BEKANNTE_SCHLUESSEL` eintragen.
- [ ] **Step 4:** `cargo test --lib benutzer_einstellungen` → PASS.
- [ ] **Step 5:** Commit `feat(rundgang): Server kennt die Rundgang-Schlüssel (LLH-1990)`.

### Task 2: Selbststart-Regeln und gemeinsamer Merker

**Files:**
- Create: `frontend/src/hilfe/rundgang/rundgangSchluessel.ts`, `frontend/src/hilfe/rundgang/rundgangSchluessel.test.ts`
- Create: `frontend/src/hilfe/useEinstellungMerken.ts`, `frontend/src/hilfe/useEinstellungMerken.test.tsx`
- Modify: `frontend/src/hilfe/WillkommenKarte.tsx` (Schließen über `useEinstellungMerken`)

**Interfaces:**
- Produces:
  - `export type RundgangTeil = 'liste' | 'einsatz'`
  - `export const SCHLUESSEL_RUNDGANG: Record<RundgangTeil, string>` (Werte wie Task 1)
  - `export function sollListeSelbstStarten(stand: BenutzerEinstellungen | undefined): boolean` — Stand bekannt, `willkommen_geschlossen` fehlt, `rundgang_liste_gesehen` fehlt.
  - `export function sollEinsatzSelbstStarten(stand: BenutzerEinstellungen | undefined, uebung: boolean): boolean` — `uebung`, Stand bekannt, `rundgang_einsatz_gesehen` fehlt, und (`willkommen_geschlossen` fehlt **oder** `rundgang_liste_gesehen` da).
  - `export function useEinstellungMerken(): { stand: BenutzerEinstellungen | undefined; benutzerId: number | null; merke: (schluessel: string) => void }` — Query wie heute in `WillkommenKarte` (`enabled` nur mit Benutzer und ohne Gerät, `staleTime: Infinity`); `merke` ergänzt sofort nur den eigenen Schlüssel im Cache (`alsBackendZeit(dayjs())`) und ruft `setzeBenutzerEinstellung(..).catch(() => {})`.
  - Gerät/ohne Anmeldung: `benutzerId === null`, `stand` bleibt `undefined`.

- [ ] **Step 1: Failing tests** (`rundgangSchluessel.test.ts`, Tabelle):
  - `sollListeSelbstStarten(undefined)` → false; `{eintraege:{}}` → true; mit `willkommen_geschlossen` → false; mit `rundgang_liste_gesehen` → false.
  - `sollEinsatzSelbstStarten({eintraege:{}}, false)` → false (echter Einsatz); `({eintraege:{}}, true)` → true; `(undefined, true)` → false; `({willkommen_geschlossen:'x'}, true)` → false (kundig); `({willkommen_geschlossen:'x', rundgang_liste_gesehen:'y'}, true)` → true; mit `rundgang_einsatz_gesehen` → false.
- [ ] **Step 2: Failing test** `useEinstellungMerken.test.tsx`: `merke('rundgang_liste_gesehen')` setzt den Schlüssel im Cache **und** behält vorhandene Einträge (`zuletzt_befehle`), PUT trifft `/api/benutzer-einstellungen/rundgang_liste_gesehen` (Endpunkt wie in `api/benutzerEinstellungen.ts`); bei 500 bleibt der Cache-Eintrag stehen.
- [ ] **Step 3:** `mise exec -- pnpm -C frontend vitest run src/hilfe/rundgang src/hilfe/useEinstellungMerken` → FAIL.
- [ ] **Step 4:** Implementieren; `WillkommenKarte` nutzt `useEinstellungMerken` (Verhalten unverändert, `SCHLUESSEL_WILLKOMMEN_GESCHLOSSEN` weiter aus `willkommen.ts`).
- [ ] **Step 5:** Tests plus `src/hilfe/WillkommenKarte.test.tsx` → PASS.
- [ ] **Step 6:** Commit `feat(rundgang): Selbststart-Regeln und gemeinsamer Merker (LLH-1990)`.

### Task 3: Schritte, Anker und die Ausnahme von LFH-1078

**Files:**
- Create: `frontend/src/hilfe/rundgang/rundgangTexte.ts`, `frontend/src/hilfe/rundgang/rundgangAnker.ts`, `frontend/src/hilfe/rundgang/rundgangAnker.test.ts`
- Modify: `frontend/src/components/erklaertext.guard.test.ts` (Ausnahme), `frontend/AGENTS.md` (Bedien-Leitlinie, „Texte: zeigen statt erklären“)
- Modify (Anker): `frontend/src/hilfe/HilfeKnopf.tsx` (`data-lfh="hilfe-knopf"` am Icon-Knopf), `frontend/src/components/BenutzerMenu.tsx` (`data-lfh="benutzermenue"` am Auslöser), `frontend/src/components/CommandPaletteTrigger.tsx` (`data-lfh="suche-ausloeser"` an beiden Formen), `frontend/src/einsatz/EinsatzLayout.tsx` (`data-lfh="navigation-oeffnen"` am Hamburger)

**Interfaces:**
- Produces:
  - `export interface RundgangVariante { anker: string; text: string }` (`anker` = CSS-Selektor)
  - `export interface RundgangSchritt { id: string; titel: string; varianten: readonly RundgangVariante[] }` — erste sichtbare Variante gewinnt.
  - `export const RUNDGANG_SCHRITTE: Record<RundgangTeil, readonly RundgangSchritt[]>`
    - liste: `kachel` → `[data-lfh="einsatzkachel"]`; `suche` → `[data-lfh="suche-ausloeser"]`; `hilfe` → `[data-lfh="hilfe-knopf"]`; `menue` → `[data-lfh="benutzermenue"]`.
    - einsatz: `kopf` → `[data-lfh="kopf-einsatzname"]`; `kategorien` → `[data-lfh="rail-spalte"]`, sonst `[data-lfh="navigation-oeffnen"]`; `module` → `[data-lfh="modul-panel"]`, sonst `[data-lfh="rail-spalte"]` (Text: eine Kategorie öffnet ihre Module), sonst `[data-lfh="navigation-oeffnen"]`; `suche` → `[data-lfh="suche-ausloeser"]`; `hilfe` → `[data-lfh="hilfe-knopf"]`.
  - `export function istSichtbar(el: Element): boolean` — `getClientRects().length > 0` und kein `visibility: hidden` am Element oder Vorfahren (`getComputedStyle`).
  - `export function loeseSchritteAuf(schritte: readonly RundgangSchritt[], wurzel?: ParentNode): { schritt: RundgangSchritt; ziel: HTMLElement; text: string }[]` — Schritte ohne sichtbares Ziel entfallen.

- [ ] **Step 1: Failing tests** `rundgangAnker.test.ts` (jsdom; `getClientRects` per `vi.spyOn` stubben):
  - Ziel fehlt → Schritt entfällt; alle fehlen → `[]`.
  - `module`: Paneel sichtbar → Paneel-Text; nur Leiste → Leisten-Variante; nur Hamburger → Hamburger.
  - Vorfahr mit `visibility: hidden` (Kopfsuche wartet) → entfällt.
  - Jeder Schritt jedes Teils hat Titel und mindestens eine Variante; kein Text enthält `\b(du|dich|dir|Sie|Ihnen|Ihr)\b`.
- [ ] **Step 2:** `vitest run src/hilfe/rundgang` → FAIL.
- [ ] **Step 3:** Implementieren. Texte: je ein bis zwei Sätze, Sache benennen, Infinitiv, keine Anrede (z. B. „Kategorien“: „Links stehen die Kategorien. Ein Klick auf eine Kategorie zeigt ihre Module.“).
- [ ] **Step 4:** Erklärtext-Wächter: Konstante `AUSNAHMEN = new Set(['hilfe/rundgang/rundgangTexte.ts'])` mit Kommentar-Verweis auf `frontend/AGENTS.md`; Dateien darin werden in `quelldateien`-Auswertung übersprungen; Selbstbeweis-Test „nur die Rundgang-Texte sind ausgenommen“ (`AUSNAHMEN.size === 1` und Datei existiert). `anredeText.guard.test.ts` bleibt unverändert.
- [ ] **Step 5:** `frontend/AGENTS.md`: Spiegelpunkt unter „Texte: zeigen statt erklären“ — „**Ausnahme Rundgang** (LLH-1990, Entscheidung 20.11.2026): Der Rundgang für Erstnutzer darf die Bedienung erklären. Seine Texte stehen nur in `hilfe/rundgang/rundgangTexte.ts`, die der Wächter als einzige Datei ausnimmt; die Anrede-Regel gilt dort weiter. Herleitung: `docs/superpowers/specs/2026-11-20-kgsx7ta3-einfuehrung-erstnutzer-design.md`.“
- [ ] **Step 6:** `vitest run src/hilfe/rundgang src/components/erklaertext.guard.test.ts src/components/anredeText.guard.test.ts` plus vorhandene Tests der berührten Komponenten (`HilfeKnopf`, `BenutzerMenu`, `CommandPaletteTrigger`, `EinsatzLayout`) → PASS.
- [ ] **Step 7:** Commit `feat(rundgang): Schritte, Anker und Ausnahme vom Erklärtext-Wächter (LLH-1990)`.

### Task 4: RundgangProvider mit antd `Tour`

**Files:**
- Create: `frontend/src/hilfe/rundgang/RundgangProvider.tsx`, `frontend/src/hilfe/rundgang/RundgangProvider.test.tsx`
- Modify: `frontend/src/App.tsx` (Provider innerhalb `HilfeSeitenleisteProvider`, um `CommandPaletteProvider`)

**Interfaces:**
- Consumes: Task 2 (`useEinstellungMerken`, `SCHLUESSEL_RUNDGANG`, Regeln), Task 3 (`RUNDGANG_SCHRITTE`, `loeseSchritteAuf`).
- Produces:
  - `export function useRundgang(): { ort: RundgangTeil | null; starte: (() => void) | undefined }` — `starte` ist `undefined` ohne Ort, im Kontext mobil oder für Gerätekonten.
  - `export function useRundgangOrt(teil: RundgangTeil, selbststart: boolean): void` — meldet den Ort bei Mount an, beim Unmount ab; ist `selbststart` true, startet der Provider den Teil **einmal je Mount**, sobald er wahr wird.
  - Start (manuell wie selbst): `loeseSchritteAuf` im nächsten Frame (`requestAnimationFrame`); leer → kein Start, nichts gemerkt. Sonst `Tour` offen und `merke(SCHLUESSEL_RUNDGANG[teil])` sofort.
  - `Tour`: `open`, `steps` mit `target: () => ziel`, `title`, `description`; Knöpfe „Zurück“, „Weiter“, letzter Schritt „Fertig“; zusätzlich „Rundgang beenden“ (über `indicatorsRender`/`actionsRender`, was antd 6 bietet); Zähler `n/m`; `onClose` und Esc (antd `keyboard` an) schließen. Tour-Wurzel trägt `data-lfh="rundgang"`.
  - Wechselt der Ort während offener Tour (Navigation), schließt sie.

- [ ] **Step 1: Failing tests** (`RundgangProvider.test.tsx`, Testseite mit `useRundgangOrt` und Elementen mit den Ankern, `getClientRects` gestubbt, MSW für Einstellungen):
  - `starte()` öffnet die erste Sprechblase (Titel sichtbar, „1/4“), PUT `rundgang_liste_gesehen` erfolgt sofort.
  - „Weiter“ bis „Fertig“ schließt; Esc schließt; „Rundgang beenden“ schließt.
  - Selbststart: `useRundgangOrt('liste', true)` startet einmal; nach Schließen und Re-Render kein zweiter Start.
  - Keine sichtbaren Ziele → keine Sprechblase, kein PUT.
  - Gerätekonto bzw. `abBreite('md') === false` (useViewport gemockt) → `starte === undefined`, kein Selbststart.
  - Unmount des Orts → `ort === null`, offene Tour zu.
- [ ] **Step 2:** `vitest run src/hilfe/rundgang/RundgangProvider` → FAIL.
- [ ] **Step 3:** Implementieren; in `App.tsx` einhängen.
- [ ] **Step 4:** Tests plus `src/hilfe/hauptChunk.guard.test.ts` und `src/App*.test.tsx` → PASS. Schlägt der Haupt-Chunk-Wächter wegen `Tour` an: `Tour` per `lazy` in eine eigene Datei `RundgangTour.tsx` auslagern.
- [ ] **Step 5:** Commit `feat(rundgang): RundgangProvider mit antd Tour (LLH-1990)`.

### Task 5: Anbinden — Seiten, Willkommenskarte, Sprungpalette

**Files:**
- Modify: `frontend/src/pages/EinsaetzePage.tsx` (`useRundgangOrt('liste', sollListeSelbstStarten(stand))`)
- Modify: `frontend/src/einsatz/EinsatzLayout.tsx` (`useRundgangOrt('einsatz', einsatz != null && sollEinsatzSelbstStarten(stand, isUebung(einsatz)))`)
- Modify: `frontend/src/hilfe/WillkommenKarte.tsx` (Knopf „Rundgang starten“, nur wenn `starte` da; schließt die Karte nicht)
- Modify: `frontend/src/command-palette/typen.ts` (`starteRundgang?: () => void`), `useBefehle.ts`, `befehle.ts` (Befehl `hilfe:rundgang`, label „Rundgang“, Gruppe navigation, Schlagworte `['Einführung', 'Tour', 'Erste Schritte']`, Icon `IconHilfe`)
- Test: `frontend/src/hilfe/WillkommenKarte.test.tsx`, `frontend/src/command-palette/befehle.test.ts`, `frontend/src/einsatz/EinsatzLayout*.test.tsx`, `frontend/src/pages/EinsaetzePage.test.tsx`

**Interfaces:**
- Consumes: `useRundgang`, `useRundgangOrt` (Task 4), Regeln (Task 2).

- [ ] **Step 1: Failing tests:**
  - Willkommenskarte: mit `starte` erscheint „Rundgang starten“, Klick ruft `starte`, Karte bleibt; ohne `starte` kein Knopf.
  - `baueBefehle` mit `starteRundgang` → Befehl `hilfe:rundgang` vorhanden, `ausfuehren` ruft ihn; ohne → kein Befehl.
  - EinsatzLayout: echter Einsatz, leerer Einstellungsstand → kein Rundgang (`[data-lfh="rundgang"]` fehlt); Übungseinsatz, leerer Stand → Rundgang erscheint.
  - EinsaetzePage: leerer Stand → Rundgang erscheint; `willkommen_geschlossen` gesetzt → nicht.
- [ ] **Step 2:** betroffene Tests → FAIL.
- [ ] **Step 3:** Implementieren.
- [ ] **Step 4:** betroffene Tests → PASS.
- [ ] **Step 5:** Commit `feat(rundgang): Rundgang an Einsatzliste, Einsatz, Karte und Palette (LLH-1990)`.

### Task 6: Anwenderdoku und Gates

**Files:**
- Modify: `docs/anwender/kapitel/einsatz-oberflaeche.md` (Ablauf „Den Rundgang starten“; `quellen` um `frontend/src/hilfe/rundgang/` ergänzen)

- [ ] **Step 1:** Ablauf schreiben (ohne Anrede): Rundgang startet beim ersten Besuch der Einsatzliste von selbst, solange die Willkommenskarte steht; im Einsatz von selbst nur in einer Übung; jederzeit über „Rundgang starten“ auf der Karte oder „Rundgang“ in der Sprungpalette; „Rundgang beenden“ oder Esc beendet ihn; am Handschirm gibt es ihn nicht.
- [ ] **Step 2:** `mise exec -- pnpm -C frontend vitest run src/hilfe` (Doku-Wächter) → PASS.
- [ ] **Step 3:** `./scripts/check-all.sh --geaendert --ohne-e2e` → grün.
- [ ] **Step 4:** Commit `docs(anwender): Rundgang im Kapitel Oberfläche (LLH-1990)`.
