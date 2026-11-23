# Führungsfunktion nur für die Führung — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mitarbeit und Beobachter tragen keine Führungsfunktion mehr; Anzeige und Hinweise nennen
wieder dieselben Personen.

**Architecture:** Eine Rust-Funktion bildet „Funktion weicht → Freitext“ (D1) und ist die einzige
Quelle im laufenden Code; Mitgliederroute (D2) und Spiegel (D4) rufen sie auf. Eine Migration baut
`einsatz_mitgliedschaft` mit CHECK neu und bereinigt den Bestand in SQL (D3). Die Oberfläche bietet
den Katalog nur der Führung an und warnt vor dem Rollenwechsel (D5).

**Tech Stack:** Rust (axum, sqlx/SQLite), React + antd, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-22-u195f4et-funktion-nur-mit-schreibrecht-design.md`

Zunder: https://zunder.rubeen.dev/#/aufgabe/u195f4et5a9pz4u1lm466n2l

## Global Constraints

- Funktion nur bei `EinsatzRolle::gehoert_zur_fuehrung()` (Einsatzleitung, Führungspersonal).
- Freitext: `el`/`s1`…`s7` → Kürzel (`EL`, `S1` …); FHP/FB → `"<Standardlabel>: <Bezeichnung>"`, ohne
  Bezeichnung nur das Standardlabel; geschwärzter Einsatz → Code weg, `fuehrungsstelle` unverändert.
  Kürzen auf `fuehrung::TEXT_MAX` (200 Zeichen). Keine Mandantenlabels.
- Explizite Funktion für Mitarbeit/Beobachter → 422 (`AppError::UnprocessableEntity`).
- Bezeichner nach LLH-1312 (Fachwort deutsch, Technik englisch); Prosa deutsch.
- Migration: neue Nummer größer als jede auf `origin/alpha` (heute 0363), Neubau ohne
  `-- no-transaction` (Blatt), Index und sechs Spiegel-Trigger wortgleich aus 0358.
- Keine Wire-Felder, Spalten oder Routen umbenennen.

## Review Focus

1. Rollenwechsel S4-Führungspersonal → Mitarbeit über die echte Route: danach `fuehrungsfunktion`
   NULL, `fuehrungsstelle` „S4“, Auftrag an S4 „nicht vergeben“ — Task 2.
2. Älteres Gegenüber liefert Beobachter + `s4`: Spiegel übernimmt die Zeile ohne Fehler (sonst
   hinge der Abgleich) — Task 4.
3. Geschwärzter Einsatz: weder Migration noch Spiegel schreiben Text — Tasks 1, 3, 4.
4. Eigene Herabstufung + Funktion zugleich: genau eine Bestätigung mit beiden Folgen — Task 5.
5. Zeilen der Führung bleiben bei der Migration Byte für Byte gleich (`zugewiesen_at` eingeschlossen) —
   Task 3.

---

### Task 1: D1 — `Funktionsangabe::as_freitext`

**Files:**
- Modify: `src/fuehrung/mod.rs` (bei `Funktionsangabe`, ~Z. 224)
- Test: `src/fuehrung/tests.rs`

**Interfaces:**
- Produces: `impl Funktionsangabe { pub fn as_freitext(&self, geschwaerzt: bool) -> Funktionsangabe }`
  — liefert immer `funktion: None`; `text` nach Global Constraints. Ohne Code: unverändert.

- [x] **Step 1: Tests schreiben** (`src/fuehrung/tests.rs`)
  - `funktion_wird_zum_kuerzel`: `S4` ohne Text → text `Some("S4")`; `El` → `"EL"`; `S7` → `"S7"`.
  - `fachberater_wird_zu_label_mit_bezeichnung`: `Fachberater` + `"THW"` → `"Fachberater: THW"`;
    `Fuehrungshilfspersonal` + `"Funk"` → `"Führungshilfspersonal: Funk"`.
  - `ohne_bezeichnung_nur_das_label`: `Fachberater` + `None` → `"Fachberater"`.
  - `geschwaerzt_nur_code_weg`: `S4`/`None`, `geschwaerzt = true` → `{None, None}`; `Fachberater`/`None`
    → `{None, None}`.
  - `freitext_bleibt_freitext`: `{None, Some("ELW 2")}` → unverändert.
  - `wird_auf_text_max_gekuerzt`: Fachberater + 195×„x“ → `chars().count() == TEXT_MAX`.
- [x] **Step 2:** `cargo test --lib fuehrung::tests` → FAIL (Methode fehlt).
- [x] **Step 3:** Implementieren; Kürzel aus `kuerzel()`, Label aus `standard_label()`, Kürzen per
  `chars().take(TEXT_MAX)`.
- [x] **Step 4:** `cargo test --lib fuehrung::tests` → PASS.
- [x] **Step 5:** Commit `feat(fuehrung): Funktionsangabe als Freitext (LLH-2064)`.

### Task 2: D2 — Mitgliederroute

**Files:**
- Modify: `src/routes/einsatz.rs` (`mitglied_setzen`, ~Z. 1173–1200)
- Modify: `src/einsatz/repo.rs` (`setze_mitgliedschaft`, ~Z. 2168)
- Modify (Anpassen): `tests/einsatz_live.rs:749` (Rolle `fuehrungspersonal` statt `beobachter`),
  `tests/benachrichtigung_chat.rs:285` (`ohne_sicht_auf_den_chat_kein_hinweis`: Dora bleibt
  Beobachterin **ohne** Funktion; `@S4` und `funktion("s4")` aus dem Body nehmen, Zusicherung bleibt
  „nur Anna“), `tests/fuehrungsfunktionen.rs` ~Z. 609 (Kommentar „Rollenwechsel ohne Feld behält
  die Stelle“ → „… macht die Funktion zur Bezeichnung“; Wert „Fachberater: THW“ bleibt, dazu
  `fuehrungsfunktion` fehlt in der Mitgliederliste).
- Test: `tests/fuehrungsfunktionen.rs` (neuer Abschnitt `// ---------- Nur die Führung (LLH-2064) ----------`)

**Interfaces:**
- Consumes: `Funktionsangabe::as_freitext` (Task 1).
- Produces: `setze_mitgliedschaft` gleiche Signatur und Rückgabe (`Ok(true)` = neu aufgenommen).

- [x] **Step 1: Tests schreiben**
  - `mitarbeit_und_beobachter_mit_funktion_sind_422`: PUT mit `{"einsatz_rolle":"mitarbeit","fuehrungsfunktion":"s4"}`
    → 422; dasselbe für `beobachter`; Mitgliedschaft danach unverändert (keine Zeile bzw. alte Rolle).
  - `mitarbeit_mit_freitext_ist_erlaubt`: `{"einsatz_rolle":"mitarbeit","fuehrungsstelle":"Funk ELW 2"}`
    → 200, `fuehrungsstelle` „Funk ELW 2“, kein `fuehrungsfunktion`.
  - `rollenwechsel_macht_die_funktion_zur_bezeichnung`: `mitglied_fuehrt(…, "s4", "Anna")`, Auftrag an
    S4 anlegen, `rolle_setzen(…, "mitarbeit")` → Mitgliederliste: kein `fuehrungsfunktion`,
    `fuehrungsstelle == "S4"`; `erster_auftrag(…)["empfaenger"][0]["aktuelle_besetzung"]["zustand"] == "nicht_vergeben"`.
  - `rollenwechsel_in_der_fuehrung_behaelt_die_funktion`: S4-Führungspersonal → `einsatzleitung` →
    `fuehrungsfunktion == "s4"`.
  - `herabgestufte_funktion_bekommt_keinen_hinweis`: Anna führt S4, wird Mitarbeit, Auftrag an S4 →
    keine Zeile in `benachrichtigung` für Anna (Pool-Abfrage wie in `tests/benachrichtigung.rs`).
- [x] **Step 2:** `cargo test --test fuehrungsfunktionen` → neue Tests FAIL.
- [x] **Step 3:** Route: nach `pruefe_funktion` 422, wenn `!neue_rolle.gehoert_zur_fuehrung()` und
  `angabe.funktion.is_some()`. Repo: `setze_mitgliedschaft` öffnet `pool.begin_with("BEGIN IMMEDIATE")`
  (sqlx ≥ 0.8; sonst `BEGIN IMMEDIATE` per `conn`), INSERT wie bisher; im UPDATE-Zweig, wenn die
  Rolle nicht zur Führung gehört und `fuehrungsstelle` `None` ist: `fuehrungsfunktion`,
  `fuehrungsstelle` und `einsatz.geschwaerzt_at IS NOT NULL` lesen, `as_freitext` anwenden und als
  `Some(angabe)` ins bestehende UPDATE geben. Org-Guard unverändert.
- [x] **Step 4:** `cargo test --test fuehrungsfunktionen --test einsatz_live --test benachrichtigung_chat --test einsatzrolle_mitarbeit` → PASS.
- [x] **Step 5:** Commit `feat(einsatz): Führungsfunktion nur für die Führung (LLH-2064)`.

### Task 3: D3 — Migration mit CHECK und Bereinigung

**Files:**
- Create: `migrations/0363_mitgliedschaft_funktion_nur_fuehrung.sql` (Nummer vorher mit
  `git fetch origin alpha && scripts/check-migrationen.sh` bestätigen)
- Modify (Anpassen): `src/benachrichtigung/vorgabe.rs:335` nur falls ein Test dort Mitarbeit/Beobachter mit Funktion schreibt (heute nicht).
- Test: `src/db/tests.rs` (neben `migration_0358_…`, ~Z. 6968)

**Interfaces:**
- Consumes: `Funktionsangabe::as_freitext` (Task 1) im Gleichheitstest.

- [x] **Step 1: Tests schreiben** (Muster: der 0358-Test spielt bis zur Vorgängerversion, legt Zeilen an, spielt nach)
  - `migration_0363_erhaelt_zeilen_trigger_und_schema`: Index `idx_mitgliedschaft_benutzer` und
    sechs Trigger `einsatz_mitgliedschaft_spiegel%` existieren; Zeilen der Führung inkl.
    `zugewiesen_at` unverändert; Änderungslog (`einsatz_aenderung`) bekommt durch die Migration keine
    neue Zeile.
  - `migration_0363_bereinigt_wie_as_freitext`: je Katalogcode × Rolle {mitarbeit, beobachter} ×
    {mit/ohne Bezeichnung bei FHP/FB} × {geschwärzt, nicht} eine Zeile; nach der Migration gilt je
    Zeile `(None, fuehrungsstelle) == Funktionsangabe{…}.as_freitext(geschwaerzt)`.
  - `migration_0363_check_lehnt_funktion_bei_mitarbeit_ab`: INSERT `mitarbeit` + `s4` → Fehler mit
    „CHECK constraint failed“; `fuehrungspersonal` + `s4` → ok.
- [x] **Step 2:** `cargo test --lib db::tests::migration_0363` → FAIL.
- [x] **Step 3:** Migration schreiben: Kopf-Kommentar wie 0358 (Herleitung, Blatt, Test-Name),
  `CREATE TABLE einsatz_mitgliedschaft_neu` = Schema 0358 + `CHECK (fuehrungsfunktion IS NULL OR
  einsatz_rolle IN ('einsatzleitung', 'fuehrungspersonal'))`; `INSERT … SELECT … FROM
  einsatz_mitgliedschaft m JOIN einsatz e ON e.id = m.einsatz_id` mit `CASE` für die beiden
  Spalten; DROP, RENAME, Index und Trigger wortgleich aus 0358 kopieren.
- [x] **Step 4:** `cargo test --lib db::tests` → PASS; `scripts/check-migrationen.sh` → ok.
- [x] **Step 5:** Commit `feat(db): Mitgliedschaft trägt Funktion nur in der Führung (LLH-2064)`.

### Task 4: D4 — Spiegel normalisiert beim Übernehmen

**Files:**
- Modify: `src/instanz/spiegel/uebernehmen.rs` (neben `keep_mitarbeit`, Aufruf ~Z. 337 direkt danach)
- Test: `src/instanz/spiegel/tests.rs`

**Interfaces:**
- Consumes: `Funktionsangabe::as_freitext` (Task 1).
- Produces: `fn normalize_funktion(werte: &mut [(String, Value)], geschwaerzt: bool)` (rein, für
  `einsatz_mitgliedschaft`) und `async fn strip_funktion(conn, t, werte) -> Result<(), AppError>`
  (liest `geschwaerzt_at` des lokalen Einsatzes über die `einsatz_id` aus `werte`).

- [x] **Step 1: Tests schreiben**
  - `normalize_funktion_macht_beobachter_s4_zu_freitext`: werte mit `einsatz_rolle = "beobachter"`,
    `fuehrungsfunktion = "s4"`, `fuehrungsstelle = null` → `fuehrungsfunktion` Null, `fuehrungsstelle` „S4“.
  - `normalize_funktion_laesst_fuehrung_stehen`: `fuehrungspersonal` + `s4` unverändert.
  - `normalize_funktion_geschwaerzt_nur_code_weg`.
  - `normalize_funktion_ohne_rollenspalte_unveraendert` (Teil-Lieferung ohne `einsatz_rolle`).
- [x] **Step 2:** `cargo test --lib instanz::spiegel` → FAIL.
- [x] **Step 3:** Implementieren; in der Übernahme nach `keep_mitarbeit` aufrufen. Doc-Kommentar
  verweist auf das Design-Doc D4 und auf `keep_mitarbeit`.
- [x] **Step 4:** `cargo test --lib instanz::spiegel` → PASS.
- [x] **Step 5:** Commit `feat(spiegel): Funktion von Mitarbeit und Beobachter beim Übernehmen als Freitext (LLH-2064)`.

### Task 5: D5 — Oberfläche im Reiter „Zugriff“

**Files:**
- Modify: `frontend/src/pages/MitgliederAbschnitt.tsx`
- Test: `frontend/src/pages/MitgliederAbschnitt.test.tsx`

**Interfaces:**
- Consumes: Server-Verhalten aus Task 2 (Rollenwechsel schickt weiter nur die Rolle).
- Produces: `const FUEHRUNG: ReadonlySet<EinsatzRolle> = new Set(['einsatzleitung', 'fuehrungspersonal'])`
  (lokal); `Herabstufung` wird zu `{ benutzerId; rolle; eigene: boolean; funktion?: string }`.

- [x] **Step 1: Tests schreiben**
  - `LLH-2064: für Mitarbeit bietet die Führungsstelle nur Freitext`: Mitglied `mitarbeit`, Dialog
    öffnen → keine Option „S2 …“; Freitext eingeben und speichern sendet `fuehrungsfunktion: null`.
  - `LLH-2064: Wechsel einer S4 auf Mitarbeit fragt vorher`: Mitglied `fuehrungspersonal` mit
    `fuehrungsfunktion: 's4'`, `fuehrungsstelle_anzeige: 'S4 Versorgung'`, Rolle „Mitarbeit“ wählen →
    Dialog „Führungsfunktion endet“ mit Text (s. Step 3); erst „Rolle ändern“ sendet PUT.
  - `LLH-2064: ohne Funktion keine Rückfrage`: Mitglied ohne Code → Rolle „Beobachter“ sendet sofort.
  - `LLH-2064: eigene Herabstufung mit Funktion zeigt eine Bestätigung mit beiden Folgen`.
- [x] **Step 2:** `mise exec -- pnpm -C frontend exec vitest run src/pages/MitgliederAbschnitt.test.tsx` → FAIL.
- [x] **Step 3:** Implementieren. `FuehrungsstelleModal`: für Rolle außerhalb `FUEHRUNG`
  `vorschlaege={{ ...funktionen, katalog: [] }}`, `extra="Nur als erster Vorschlag für den
  ETB-Rufnamen – Mitarbeit und Beobachter tragen keine Führungsfunktion"`, Platzhalter „Freitext,
  z. B. Funk ELW 2“. `rolleWaehlen`: Rückfrage, wenn eigene Herabstufung **oder**
  (`m.fuehrungsfunktion` und Zielrolle ∉ `FUEHRUNG`). Titel: nur eigene → „Eigene Rolle
  herabstufen?“, sonst „Führungsfunktion endet“; okText „Rolle ändern“ (eigene: „Rolle
  herabstufen“). Text Funktion: `Mit „<Rolle>“ endet die Führungsfunktion <anzeige>. „<Kürzel bzw.
  anzeige>“ bleibt als Bezeichnung stehen; Hinweise an diese Funktion erreichen <Name> nicht mehr.`
  Beide Sätze untereinander, wenn beides gilt. Texte vor dem Commit mit `design:ux-copy` gegenlesen.
- [x] **Step 4:** Vitest wie Step 2 → PASS; `mise exec -- pnpm -C frontend lint` und
  `mise exec -- pnpm -C frontend exec tsc --noEmit` → ohne Fehler.
- [x] **Step 5:** Commit `feat(zugriff): Funktion nur für die Führung wählbar (LLH-2064)`.

### Task 6: D6 — Regeln, Doku, Gates

**Files:**
- Modify: `src/AGENTS.md` (Abschnitt Benachrichtigungen, Punkt „Eine Funktion löst nur über die Mitgliedschaft auf“, ~Z. 802)
- Modify: `frontend/src/fuehrung/AGENTS.md` (Absatz „Wer eine Funktion trägt …“)
- Modify: `docs/anwender/kapitel/rechte-im-einsatz.md` („Führungsfunktionen der Mitglieder“, ~Z. 109–131)

- [x] **Step 1:** `scripts/adr-fuer.sh` über alle geänderten Pfade; Ergebnis beachten.
- [x] **Step 2:** Regel in `src/AGENTS.md` ergänzen (Satz: Eine Funktion tragen nur Einsatzleitung
  und Führungspersonal — CHECK aus 0363, 422 der Route, Spiegel normalisiert; muss sie weichen,
  bleibt ihre Anzeige als Freitext, nach `Funktionsangabe::as_freitext`; Anzeige und Hinweise lesen
  deshalb ohne Rollenfilter dieselben Personen). `frontend/src/fuehrung/AGENTS.md`: Rollenbedingung
  mit Verweis auf `src/AGENTS.md`. Anwenderdoku nach `docs/anwender/AGENTS.md` (Kapitelform,
  Wächter).
- [x] **Step 3:** `./scripts/check-all.sh --geaendert --ohne-e2e` (einmal, ggf. `run_in_background`) → grün.
  Erledigt in Portionen wegen des Plattenkontingents der Cloud-Sitzung: `--nur schnell` und
  `--nur frontend` grün, Rust-Suite stückweise (lib, 273 Integrationstests, doc, Dev-Seed,
  Server-Binary) grün; die Desktop-Hülle baut hier nicht (`gdk-3.0` fehlt), sie ist nicht berührt.
- [x] **Step 4:** Commit `docs: Führungsfunktion nur für die Führung (LLH-2064)`.

### Nach LLH-2008 (falls es vor dem PR auf `alpha` liegt)

- [x] `git fetch origin alpha && git merge origin/alpha`; Konflikte in `src/AGENTS.md`,
  `rechte-im-einsatz.md`, `benachrichtigung/aufloesung.rs` zusammenführen. Tests aus LLH-2008, die
  einer Mitarbeit/Beobachterin eine Funktion geben, auf den Rollenwechsel umstellen (Funktion wird
  zur Bezeichnung, kein Hinweis). Filter in `funktion_nutzer` bleibt, Kommentar verweist auf 0363.
  Danach Task-6-Gate erneut.
