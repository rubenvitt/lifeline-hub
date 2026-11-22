# Spiegel: neu vergebene ID ist eine neue Zeile — Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Eine Zeile, die eine Instanz unter einer schon vergebenen ID neu anlegt, gilt weder am
Hub noch nach einem Rückfall als Zeile des Gegenübers (LLH-1893).

**Architecture:** Der generierte Log-Trigger `<tabelle>_spiegellog_i` räumt bei Tabellen mit
Ersatzschlüssel `id` die alte Herkunft (A) und setzt den Merker `spiegel_neu_vergeben` (C).
`fuehrung.rs` wertet den Merker beim Wechsel zum Spiegel, in der Bruchstellen-Antwort und bei
`gegen` aus. Eine Migration baut die Trigger neu und legt die Tabelle an.

**Tech Stack:** Rust, sqlx, SQLite-Trigger, Integrationstests mit zwei Instanzen
(`tests/instanz_fuehrung.rs`).

**Spec:** `docs/superpowers/specs/2026-11-22-k13jdo7f-spiegel-herkunft-neu-vergeben-design.md`

## Global Constraints

- Betroffen sind nur gespiegelte Tabellen mit `Schluessel::Spalte("id")`, ohne `einsatz` (D1).
- Herkunft räumen und Merker setzen nur außerhalb des Merkers `spiegel_uebernahme` (D2).
- Die Herkunft wird über `(art, lokaler_schluessel)` geräumt, ohne Einsatzbezug (D3).
- Migration `0362_spiegel_neu_vergeben.sql`; Nummer größer als jede auf `origin/alpha`
  (`scripts/check-migrationen.sh`). Bestehende Migrationen bleiben unverändert.
- Kein Schreibweg in Rust schreibt in `einsatz_aenderung` (`src/AGENTS.md`, Instanzkopplung).
- Bezeichner: Fachbegriffe deutsch, Technik englisch; Prosa, Kommentare und Testnamen deutsch.

## Review Focus

- Das `INSERT OR REPLACE` der Übernahme (unter Merker) darf weder Herkunft räumen noch einen
  Merker setzen → Unit-Test in Task 1.
- Eine gewöhnliche neue Zeile (ID nie vergeben) setzt keinen Merker → Unit-Test in Task 1.
- Ein abgeglichener Wechsel zum Spiegel räumt den Merker, ein `gegen` auf die Zeile gilt dann →
  Test in Task 2.
- Tabellen mit natürlichem oder mehrspaltigem Schlüssel behalten ihren alten Trigger → der Wächter
  `trigger_passen_zur_beschreibung` vergleicht alle Trigger mit dem Generator (Task 1).
- Ein Einsatz, der geht, nimmt seine Merker mit (`ON DELETE CASCADE`, Lebensende) → Task 2.

---

### Task 1: Trigger räumt die Herkunft und setzt den Merker (A und C im Trigger)

**Files:**
- Modify: `src/instanz/spiegel/art.rs` (`trigger_sql`, `AUSGENOMMEN`, Tests)
- Create: `migrations/0362_spiegel_neu_vergeben.sql`
- Modify: `src/einsatz/schwaerzung_registry.rs` (Regel für `spiegel_neu_vergeben`)
- Test: `src/instanz/spiegel/art.rs` (`mod tests`), `tests/instanz_fuehrung.rs`

**Interfaces:**
- Produces: Tabelle `spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand)`,
  PK `(einsatz_id, art, lokaler_schluessel)`, `einsatz_id` mit `ON DELETE CASCADE`.
  `trigger_sql(tabelle, sc, k, mit_schutz)` behält die Signatur; die Zusatzschritte hängen an
  `sc != Scoping::SelbstId && *k == Schluessel::Spalte("id".into())`.

- [x] **Step 1: Failing tests schreiben**
  - `art::tests::neu_vergebene_id_raeumt_die_herkunft_und_setzt_den_merker`: Einsatz, Zeile in
    `freies_zeichen` (id 1) anlegen, Herkunft `('freies_zeichen', 'x', '1')` eintragen, Zeile
    löschen, neue Zeile mit id 1 anlegen → keine Herkunft mehr, Merker
    `(einsatz, 'freies_zeichen', '1')` mit `stand` = Stand der Logzeile von `'1'`.
  - `art::tests::unter_dem_merker_bleibt_die_herkunft`: dasselbe, aber das Neuanlegen unter
    `spiegel_uebernahme` → Herkunft bleibt, kein Merker.
  - `art::tests::erste_vergabe_setzt_keinen_merker`: neue Zeile, ID nie vergeben → kein Merker.
  - `instanz_fuehrung::nach_widerspruch_steht_die_neue_zeile_unter_alter_id_in_der_bruchstelle`
    (Akzeptanz 1): ELW legt Einsatz und Zeichen Z an, meldet; Hub übernimmt mit Unterschrift,
    löscht Z über `DELETE /freie-zeichen/{id}`, legt N an (gleiche ID, assert); ELW meldet,
    widerspricht, meldet dreimal → am Hub genau ein Zeichen mit dem Label von Z,
    Bruchstelle `freies_zeichen` mit N-Label hat `entfernt = 1`.
  - `instanz_fuehrung::gegen_hinaus_nennt_fuer_die_neue_zeile_keinen_fremden_schluessel`
    (Akzeptanz 2): wie oben bis N angelegt → `spiegel::fuehrung::gegen_hinaus(conn, h, kopplung,
    "freies_zeichen", id)` ist `None` (öffentlich über `lifeline_hub::instanz::spiegel::fuehrung`;
    sonst über die Herkunftstabelle prüfen: keine Zeile mit `lokaler_schluessel = id`).
- [x] **Step 2: Tests laufen lassen, sie scheitern** (`cargo test --lib art::tests::` und
  `cargo test --test instanz_fuehrung neue_zeile`).
- [x] **Step 3: `trigger_sql` erweitern** wie Spec D3 (Reihenfolge: Merker mit `stand = 0` wenn
  alte Logzeile, Herkunft räumen, Log ersetzen, Merker-Stand setzen). Tabelle in der Migration
  anlegen, `DROP TRIGGER`/`CREATE TRIGGER` für jede betroffene Tabelle aus dem Generator
  (einmalig per lokalem, nicht committetem Test erzeugt). `spiegel_neu_vergeben` in
  `AUSGENOMMEN` („Verwaltung des Spiegels selbst“) und in der Schwärzungsregistrierung wie
  `spiegel_herkunft` (alle Spalten `retain`).
- [x] **Step 4: Tests laufen lassen**, dazu `art::tests::` (Wächter) und
  `schwaerzung_registry`-Wächter: grün.
- [x] **Step 5: Commit** `fix: neu vergebene ID räumt die Spiegel-Herkunft (LLH-1893)`.

### Task 2: Merker auswerten (`kennt: true`, `gegen`, Wechsel zum Spiegel, Lebensende)

**Files:**
- Modify: `src/instanz/spiegel/fuehrung.rs` (`werde_spiegel`, `uebernimm_bruch_antwort`,
  `uebernimm_gegen`, Doku von `nicht_vom_fuehrer`)
- Modify: `src/instanz/spiegel/lebensende.rs` (Liste beim Umwandeln)
- Test: `tests/instanz_fuehrung.rs`

**Interfaces:**
- Consumes: Tabelle `spiegel_neu_vergeben` aus Task 1.
- Produces: keine neuen öffentlichen Funktionen.

- [x] **Step 1: Failing tests schreiben**
  - `nach_notuebernahme_durch_den_elw_steht_die_neue_zeile_unter_alter_id_in_der_bruchstelle`
    (`kennt: true`): ELW legt Einsatz und Z an, meldet, übergibt an den Hub, meldet (der ELW wird
    Spiegel und bekommt Z mit `gegen`); Hub löscht Z, legt N unter derselben ID an; ohne Meldung
    übernimmt der ELW per Notübernahme; dreimal melden → am Hub genau ein Zeichen mit Label von Z,
    N in der Bruchstelle mit `entfernt = 1`.
  - `abgeglichene_rueckgabe_raeumt_den_merker`: wie oben, aber der ELW meldet nach N und der Hub
    übergibt regulär zurück → kein Merker am Hub, am Hub genau ein Zeichen mit Label von N, keine
    entfernte Zeile in der Bruchstelle.
- [x] **Step 2: Tests laufen lassen, der erste scheitert.**
- [x] **Step 3: Umsetzen** nach Spec D4: in `werde_spiegel` vor `sichere_bruchstelle`
  `DELETE FROM spiegel_neu_vergeben WHERE einsatz_id = ? AND stand <= ?` (`bekannt_bis`); in
  `uebernimm_bruch_antwort` bei `a.kennt` die offenen Zeilen bis `bis` mit Merker an `unbekannt`
  hängen (ohne Doppelte, höchstens `BRUCH_MAX`); in `uebernimm_gegen` nach der Prüfung
  `bisher == gegen` mit `Ok(false)` enden, wenn `(einsatz_id, art, gegen)` einen Merker hat; in
  `lebensende::umwandeln` `spiegel_neu_vergeben` mit den übrigen Spiegeltabellen räumen. Doku von
  `nicht_vom_fuehrer` (Lücke LLH-1893) berichtigen.
- [x] **Step 4: Tests laufen lassen**, dazu die ganze `instanz_fuehrung`-Suite: grün.
- [x] **Step 5: Commit** `fix: neu vergebene ID gilt nach dem Rückfall als unbekannt (LLH-1893)`.

### Task 2b: Befunde aus dem Review vor dem PR (Entwurf D8, D4)

**Files:** `src/instanz/spiegel/art.rs`, `src/instanz/spiegel/fuehrung.rs`,
`migrations/0362_spiegel_neu_vergeben.sql`, `src/einsatz/schwaerzung_registry.rs`,
`tests/instanz_fuehrung.rs`, ADR-0081, `docs/architektur/06-laufzeitsicht.md`

- [x] **Step 1: Failing tests:** `bestaetigte_notuebernahme_ersetzt_am_elw_die_geloeschte_zeile`
  (ersetzt den Test zu Akzeptanzkriterium 2), `merker_bleibt_bis_der_juengste_stand_der_zeile_quittiert_ist`,
  `gegen_hinaus_nennt_den_schluessel_der_geloeschten_nur_einmal`, Unit-Test mit
  `fremder_schluessel` statt `stand`.
- [x] **Step 2:** Merker mit `fremder_schluessel` statt `stand`; `gegen_hinaus` mit Merker als
  Rückfall; Aufräumen in `werde_spiegel` nach dem jüngsten Log-Stand. Migration neu erzeugt.
- [x] **Step 3:** ADR-0081 (Mitänderungsregel, Route `entwurf`, E1) und Kapitel 6.
- [x] **Step 4:** Tests grün, Gegenproben gegen Filter und Ablehnung rot.

### Task 3: Nachzug und Gates

- [x] **Step 1:** Folgeaufgabe für D7 (ID in anderem Einsatz neu vergeben, `gegen` ohne
  Einsatzprüfung) per `zunder-task-anlegen`.
- [x] **Step 2:** `./scripts/check-all.sh --geaendert --ohne-e2e` grün; Ergebnis kommt in den PR
  unter „Geprüft“.
