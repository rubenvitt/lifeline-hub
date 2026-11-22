# Fällige Erinnerung nur einmal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eine automatische Frist (Erinnerung mit `quelle = 'auto_frist'`) steht in Offene
Vorgänge, Nächste Marken und jeder Zahl genau einmal, nämlich an ihrem Bezug.

**Architecture:** Eine Regel R1 („am Bezug getragen“) steht je Seite einmal als Konstante:
Rust in `src/erinnerung/mod.rs`, TypeScript in `frontend/src/erinnerung/amBezug.ts`. Der
Server-Zähler `faellige_offene` lässt die Bezugstypen aus, die der Aufrufer nennt. Der Client
filtert Offene Vorgänge → Erinnerungen und Nächste Marken mit derselben Regel.

**Tech Stack:** Rust/axum/sqlx (SQLite), React/TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-22-ndd6jaby-faellige-erinnerung-einmal-design.md`

**Zunder:** https://zunder.rubeen.dev/#/aufgabe/ndd6jaby8ednfan6z2wx3usx

## Global Constraints

- Am Bezug getragen sind nur `quelle = 'auto_frist'` mit `bezug_typ` ∈ {`meldung` → Modul
  `meldungen`, `auftrag` → `auftraege`, `abloesung` → `abloesung`, `abloesung_vorwarnung` →
  `abloesung`}, und nur, wenn das Modul des Bezugs für die Person frei ist.
- `abloesung_planung` und selbst angelegte Erinnerungen (`quelle = 'manuell'`) bleiben
  Erinnerungen, auch mit Bezug.
- Keine Wire-Änderung (kein neues Feld, kein Typ-Codegen).
- Bezeichner: Fachbegriffe deutsch, Technik englisch (Wurzel-`AGENTS.md`, LFH-1312).
- Gate vor dem PR: `./scripts/check-all.sh --geaendert --ohne-e2e`.

## Review Focus

1. Modul Meldungen nicht frei: Die Bestätigungsfrist bleibt sichtbar (als Erinnerung in Offene
   Vorgänge, in Nächste Marken und in der Zahl). → Tests in Task 1 (Zähler ohne `meldungen`),
   Task 2 und Task 3.
2. Selbst angelegte Erinnerung mit Bezug auf eine Meldung bleibt in Liste und Zahl. → Task 1, Task 2.
3. Planungshinweis der Ablösung bleibt in Liste und Zahl. → Task 1, Task 2.
4. Auftragsfrist ohne Auftragsmarke (Modul Aufträge nicht frei, Liste leer) bleibt als
   Erinnerungsmarke. → Task 3.
5. Zahl und Zeilen in Offene Vorgänge → Erinnerungen zeigen dieselbe Menge (Server-Regel =
   Client-Regel). → gleiche Testfälle in Task 1 und Task 2.

---

### Task 1: Server-Zähler „Erinnerungen fällig“ lässt am Bezug getragene Fristen aus

**Files:**
- Modify: `src/erinnerung/mod.rs` (Konstante, Hilfsfunktion)
- Modify: `src/erinnerung/repo.rs:55-75` (`faellige_offene`), Tests im `mod tests`
- Modify: `src/einsatz/zaehler.rs:406-410` (Aufruf aus `erlaubt`)
- Modify: `src/routes/lagemonitor.rs:278-279` (Aufruf mit Meldung und Auftrag)
- Modify: `tests/geraet_kopplung.rs:8970-8978` (Erwartung der Lagemonitor-Zahl)

**Interfaces:**
- Produces: `pub const AM_BEZUG_GETRAGEN: &[(&str, &str)]` (Paare `bezug_typ`, Modul-Key) und
  `pub fn am_bezug_getragen(frei: impl Fn(&str) -> bool) -> Vec<&'static str>` in
  `crate::erinnerung`; `pub async fn faellige_offene(pool: &SqlitePool, einsatz_id: i64, jetzt: &str, am_bezug: &[&str]) -> Result<i64, AppError>`.

- [x] **Step 1: Failing test** `faellige_offene_laesst_am_bezug_getragene_aus` in
  `src/erinnerung/repo.rs` `mod tests`. Fällig sind: eine Auto-Frist `meldung`, eine `auftrag`,
  eine `abloesung`, eine `abloesung_vorwarnung`, eine `abloesung_planung` und eine manuelle mit
  Bezug `meldung`. Anlegen per `setze_auto_frist_tx` bzw. `anlegen` mit `bezug_typ`.
  - `faellige_offene(.., &[])` == 6
  - `faellige_offene(.., &am_bezug_getragen(|_| true))` == 2 (Planung und manuell)
  - `faellige_offene(.., &am_bezug_getragen(|m| m != "meldungen"))` == 3
- [x] **Step 2:** `cargo test --lib erinnerung::repo::tests::faellige_offene_laesst` → FAIL (Signatur).
- [x] **Step 3: Implement** Die Konstante und `am_bezug_getragen` gehören nach `src/erinnerung/mod.rs`
  und nehmen die `OBJEKT_*`-Konstanten aus `crate::kommunikation`. `faellige_offene` hängt
  bei nicht leerem `am_bezug` dieses SQL an:
  `AND NOT (e.quelle = 'auto_frist' AND e.bezug_typ IN (?,…))`. Die Platzhalter werden
  dynamisch gebaut, die Werte als Binds übergeben. Der Doc-Kommentar verweist auf `src/AGENTS.md`,
  „Automatische Fristen stehen am Bezug“.
  `zaehler::berechne` ruft `am_bezug_getragen(|m| erlaubt.contains(m))` auf. `lagemonitor::alarm`
  ruft `&[OBJEKT_MELDUNG, OBJEKT_AUFTRAG]` auf, denn seine Alarmzeile zeigt keine Ablösungen. Dazu
  kommt ein Kommentar.
- [x] **Step 4:** Den Test in `tests/geraet_kopplung.rs` anpassen. Die Quittierfrist des
  überfälligen Auftrags zählt jetzt am Auftrag: `erinnerungen_faellig` == 0 und weiter gleich dem
  Modulzähler. Der Kommentar wird angepasst.
- [x] **Step 5:** `cargo test --lib erinnerung:: einsatz::zaehler` und
  `cargo test --test geraet_kopplung lagemonitor` → PASS.
- [x] **Step 6: Commit** `feat(erinnerung): Zähler „fällig“ lässt am Bezug getragene Fristen aus (LLH-1908)`

### Task 2: Offene Vorgänge → Erinnerungen ohne am Bezug getragene Fristen

**Files:**
- Create: `frontend/src/erinnerung/amBezug.ts`, Test `frontend/src/erinnerung/amBezug.test.ts`
- Modify: `frontend/src/pages/fuehrung/offeneVorgaenge.ts:195-206` (`vorgangsErinnerungen`)
- Modify: `frontend/src/pages/fuehrung/offeneVorgaenge.test.ts`
- Modify: `frontend/src/pages/fuehrung/OffeneVorgaengePaneel.tsx` (Aufruf mit den Freigaben)

**Interfaces:**
- Produces: `export type BezugModul = 'meldungen' | 'auftraege' | 'abloesung'`,
  `export const AM_BEZUG_GETRAGEN: Readonly<Record<string, BezugModul>>` und
  `export function amBezugGetragen(e: Pick<Erinnerung, 'quelle' | 'bezug_typ'>, frei: (modul: BezugModul) => boolean): boolean`.
  Außerdem `vorgangsErinnerungen(liste, jetzt, frei: (modul: BezugModul) => boolean = () => false)`.

- [x] **Step 1: Failing tests:**
  - `amBezug.test.ts`: je Bezugstyp `true`, wenn das Modul frei ist. `false` gilt für
    `abloesung_planung`, für `quelle: 'manuell'` mit Bezug `meldung` und für `meldung`, wenn
    `meldungen` nicht frei ist.
  - `offeneVorgaenge.test.ts`, neuer Fall „Erinnerungen: automatische Frist steht am Bezug“: Die
    sechs Erinnerungen aus Task 1, Step 1, alle fällig. Mit `() => true` bleiben ids Planung und
    manuell, mit `(m) => m !== 'meldungen'` zusätzlich die Meldungsfrist.
- [x] **Step 2:** `mise exec -- pnpm -C frontend exec vitest run src/erinnerung/amBezug.test.ts src/pages/fuehrung/offeneVorgaenge.test.ts` → FAIL.
- [x] **Step 3: Implement** `amBezug.ts`. `vorgangsErinnerungen` filtert zusätzlich
  `!amBezugGetragen(e, frei)`. Das Paneel übergibt
  `(m) => ({ meldungen: meldungen.frei, auftraege: auftraege.frei, abloesung: abloesungen.frei })[m] ?? false`
  und trägt einen Kommentarverweis auf `src/AGENTS.md`.
- [x] **Step 4:** derselbe Lauf → PASS.
- [x] **Step 5: Commit** `feat(ueberblick): Offene Vorgänge zeigen automatische Frist nur am Bezug (LLH-1908)`

### Task 3: Nächste Marken — Auftragsfrist einmal, Bestätigungsfrist als eigene Marke

**Files:**
- Modify: `frontend/src/pages/fuehrung/ueberblickDaten.ts` (`MarkenArt`, `markenBewertung`, `naechsteMarken`)
- Modify: `frontend/src/pages/fuehrung/ueberblickDaten.test.ts`
- Modify: `frontend/src/pages/fuehrung/UeberblickPage.tsx:486-505` (Aufruf), `:666-680` (`markenZiel`)

**Interfaces:**
- Consumes: `AM_BEZUG_GETRAGEN`/`amBezugGetragen` aus Task 2 nur für die Typnamen; die Regel
  hier ist enger (s. Steps).
- Produces: `MarkenArt` um `'bestaetigung'` erweitert (`id` = Meldung). `naechsteMarken` bekommt
  als neunten Parameter `optionen: { meldungenFrei?: boolean } = {}`.

- [x] **Step 1: Failing tests** in `ueberblickDaten.test.ts`, `describe naechsteMarken`:
  - „Auftrag mit Frist steht einmal“: Auftrag 7 mit `frist_at: nach(30)` plus Auto-Frist
    `bezug_typ: 'auftrag', bezug_id: 7` zur selben Zeit → eine Marke, `art: 'auftrag'`.
  - „Quittierfrist ohne Auftragsmarke bleibt“: Auftragsliste leer, dieselbe Auto-Frist → eine
    Marke `art: 'erinnerung'`.
  - „Bestätigungsfrist wird Marke der Meldung“: Auto-Frist `bezug_typ: 'meldung', bezug_id: 3`,
    `titel: 'Sofortmeldung #3 unbestätigt'`, `faellig_at: vor(5)`, `{ meldungenFrei: true }` →
    `[art, id, text, ton, wort]` = `['bestaetigung', 3, 'Sofortmeldung #3 unbestätigt', 'alarm', 'überfällig']`.
    Dasselbe mit `ist_faellig: true` und `faellig_at: nach(1)` → ebenfalls `alarm`/`überfällig`.
    Kommend (`nach(20)`) → wie jede Frist (kein „fällig“).
  - „Bestätigungsfrist ohne Modul Meldungen bleibt Erinnerung“: ohne Optionen → `art: 'erinnerung'`,
    `wort: 'fällig'` bei `vor(5)`.
- [x] **Step 2:** `mise exec -- pnpm -C frontend exec vitest run src/pages/fuehrung/ueberblickDaten.test.ts` → FAIL.
- [x] **Step 3: Implement.** Die Auto-Frist mit `bezug_typ: 'auftrag'` wird übersprungen, wenn
  `a-<bezug_id>` schon in `roh` steht. Die Aufträge kommen zuerst in die Liste, so wie heute. Die
  Auto-Frist mit `bezug_typ: 'meldung'` wird bei `meldungenFrei` zu `art: 'bestaetigung'`,
  `id: bezug_id`, `key: b-<bezug_id>`. `markenBewertung` behandelt `'bestaetigung'` mit `faellig`
  oder `abstand <= 0` als `{ ton: 'alarm', wort: 'überfällig' }`. Den Doc-Kommentar von
  `naechsteMarken` ergänzen, mit Verweis auf `src/AGENTS.md`. In `UeberblickPage` gibt es
  `{ meldungenFrei: rueckmeldungenFrei }`, und `markenZiel` führt `'bestaetigung'` →
  `meldungenPfad(einsatzId, { meldung: m.id ?? undefined })`.
- [x] **Step 4:** derselbe Lauf plus `src/pages/fuehrung/UeberblickPage.test.tsx` → PASS;
  `mise exec -- pnpm -C frontend exec tsc --noEmit -p .` ohne Fehler.
- [x] **Step 5: Commit** `feat(ueberblick): Nächste Marken zeigen jede Frist einmal (LLH-1908)`

### Task 4: Regel und Anwenderdoku

**Files:**
- Modify: `src/AGENTS.md` (neuer Unterpunkt unter „Backend — Benachrichtigungen (LLH-1207)“:
  „Automatische Fristen stehen am Bezug (LLH-1908)“ mit R1, den Orten der Konstanten und dem
  Hinweis, dass eine neue Auto-Frist-Art beide Konstanten nachzieht)
- Modify: `docs/anwender/kapitel/ueberblick.md` (Offene Vorgänge: Abschnitt Erinnerungen;
  Nächste Marken: Bestätigungsfrist „überfällig“, Klick öffnet die Meldung)
- Modify: `docs/anwender/kapitel/erinnerungen.md` (automatische Erinnerungen: stehen im Modul,
  im Überblick und in der Zahl am Bezug)

- [x] **Step 1:** Texte schreiben, dabei `docs/anwender/AGENTS.md` (Kapitelform, Wächter) beachten.
- [x] **Step 2:** `./scripts/check-all.sh --nur schnell` (Doku-Wächter, Prettier) → grün.
- [x] **Step 3: Commit** `docs(erinnerung): Regel „automatische Frist steht am Bezug“ (LLH-1908)`

### Task 5: Gate, Bilder, PR

- [x] **Step 1:** `./scripts/check-all.sh --geaendert --ohne-e2e` → grün (Ergebnis für „Geprüft“ im PR).
- [x] **Step 2:** Bilder vorher/nachher des Überblicks (unbestätigte Sofortmeldung, Auftrag mit
  Frist) per Wegwerf-Spec `frontend/e2e/doku-bilder/zz-ndd6jaby.bilder.ts`
  (`dev-zunder-ausfuehren`, „Bilder der Änderung“).
- [x] **Step 3:** Push, PR gegen `alpha`, Board `review` mit `pr_url`.
