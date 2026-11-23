# Mitarbeit-Nachtrag an den Führer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein Spiegel N meldet die Mitgliedschaften, die er gegen einen alten Führer O als
`mitarbeit` festgehalten hat, nach dessen Aufrüsten nach; O stellt sie unter engen Bedingungen
wieder her, und beide Seiten sind danach einig.

**Architecture:** Neues Modul `src/instanz/spiegel/nachtrag.rs` (Muster `hinweis.rs`): Ausgang
an N, Grenze und Annahme an O. Beide Seiten tun beim Wechsel der Fähigkeit 0 → 1
(`repo::save_rolle_mitarbeit`) dasselbe: vormerken und Grenze setzen. Der Abgleich trägt zwei
additive Paketfelder in beide Richtungen.

**Tech Stack:** Rust, axum, sqlx/SQLite, Tests mit `#[tokio::test]`.

**Spec:** `docs/superpowers/specs/2026-11-22-s110uic4-mitarbeit-nachtrag-fuehrer-design.md`

## Global Constraints

- Bezeichner: Fachbegriffe deutsch, Abläufe englisch (`queue_nachtraege`, nicht `merke_vor`);
  Prosa, Kommentare, Testnamen deutsch (Wurzel-`AGENTS.md`, „Bezeichner-Sprache“).
- Neue Paketfelder nur mit `#[serde(default)]`; ein älteres Gegenüber überliest sie.
- Listen von außen sind begrenzt (`src/AGENTS.md`, „Listen von außen“), geprüft in
  `SpiegelPaket::check`.
- Schreiben in `einsatz_aenderung` nur unter `src/instanz/spiegel/` (ADR-0018).
- Migration: nächste freie Nummer **0363** (vorher `git fetch origin alpha`,
  `scripts/check-migrationen.sh`), keine bestehende anfassen.
- Kein Protokoll-Bump, kein Frontend, keine Anwenderdoku.
- Commits deutsch, mit `Zunder: https://zunder.rubeen.dev/#/aufgabe/s110uic4zxjbai171xkgekqj`.

## Review Focus

1. **Nachtrag für eine Mitgliedschaft, die O nach der Grenze bearbeitet hat** → bleibt, N folgt
   O (Task 3, Test `abgelehnter_nachtrag_legt_die_zeile_neu_ins_log`).
2. **Doppelter Nachtrag** (Quittung verloren, N schickt erneut, Zeile steht schon auf
   `mitarbeit`) → nur quittieren, kein Neu-Log, keine Änderung (Task 3,
   `wiederholter_nachtrag_aendert_nichts`).
3. **`gegen` zeigt auf eine Mitgliedschaft eines anderen Einsatzes** → nicht anheben (Task 3,
   `gegen_aus_einem_anderen_einsatz_hebt_nicht_an`).
4. **Paket mit zu vielen oder zu langen Nachträgen** → `check` lehnt ab (Task 1).
5. **Kopplung widerrufen oder Spiegel beendet, Ausgang noch voll** → nichts geht mehr hinaus,
   Ausgang leert sich mit dem Einsatz (Task 2, `nur_aktive_spiegel_dieser_kopplung`).

---

### Task 1: Tabelle, Grenze und Wire

**Files:**
- Create: `migrations/0364_mitarbeit_nachtrag.sql`
- Create: `src/instanz/spiegel/nachtrag.rs` (nur Wire-Typ und Konstanten in diesem Task)
- Modify: `src/instanz/spiegel/mod.rs` (`pub mod nachtrag;`)
- Modify: `src/instanz/spiegel/paket.rs` (`SpiegelPaket`, `check`, Tests unten in der Datei)
- Modify: `src/instanz/spiegel/art.rs` (`AUSGENOMMEN`)
- Modify: `src/einsatz/schwaerzung_registry.rs` (Regel wie `hinweis_ausgang`)
- Modify: alle `SpiegelPaket { … }`-Literale (`abgleich.rs` und Tests): die zwei Felder leer

**Interfaces:**
- Produces:
  - Tabelle `mitarbeit_nachtrag (id INTEGER PRIMARY KEY, kopplung_id INTEGER NOT NULL REFERENCES instanz_kopplung(id) ON DELETE CASCADE, einsatz_id INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE, schluessel TEXT NOT NULL, angelegt_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (kopplung_id, einsatz_id, schluessel))`
  - Spalte `instanz_kopplung.mitarbeit_grenze_stand INTEGER` (NULL = nie gelernt)
  - `pub struct MitarbeitNachtrag { pub id: i64, pub kennung: String, pub schluessel: String, #[serde(default)] pub gegen: Option<String> }` (Serialize, Deserialize, Debug, Clone, PartialEq, Eq)
  - `pub const NACHTRAEGE_MAX: usize = 500;` und `pub const SCHLUESSEL_BYTES_MAX: usize = 64;`
  - `SpiegelPaket.mitarbeit_nachtraege: Vec<nachtrag::MitarbeitNachtrag>`,
    `SpiegelPaket.mitarbeit_quittungen: Vec<i64>`, beide `#[serde(default)]`

- [x] **Step 1: Failing tests in `paket.rs`** (`mod tests`):
  - `leeres_paket_und_paket_ohne_neue_felder_sind_lesbar` um
    `assert!(p.mitarbeit_nachtraege.is_empty() && p.mitarbeit_quittungen.is_empty())` ergänzen.
  - `zu_viele_oder_zu_lange_nachtraege_lehnt_check_ab`: `NACHTRAEGE_MAX` Nachträge → `Ok`;
    `NACHTRAEGE_MAX + 1` → `Err`; `NACHTRAEGE_MAX + 1` Quittungen → `Err`; `kennung` mit `"`
    → `Err` (`is_kennung_nennbar`); `schluessel` oder `gegen` mit 65 Byte → `Err`.
- [x] **Step 2:** `cargo test --lib instanz::spiegel::paket` → FAIL (Felder fehlen).
- [x] **Step 3: Migration, Typ, Felder, `check`.** Die Migration kommentiert Zweck (LLH-2007,
  Design D2/D4) wie 0359. `art::AUSGENOMMEN` bekommt `("mitarbeit_nachtrag", "Ausgang der
  Mitarbeit-Nachträge an den Führer; der Nachtrag reist im Paket (LLH-2007)")`; die
  Schwärzungsregel wie `hinweis_ausgang` mit den Spalten der Tabelle und `Z_EINSATZ`.
- [x] **Step 4:** `cargo test --lib instanz::spiegel::paket` und die Wächter der Tabellenlisten
  (`cargo test --lib art`, `cargo test --lib schwaerzung`, `cargo test --lib db::tests`) → PASS.
- [x] **Step 5: Commit** `feat(spiegel): Paketfelder und Ausgang für Mitarbeit-Nachträge`

### Task 2: N vormerkt, schickt und löscht quittierte Nachträge

**Files:**
- Modify: `src/instanz/spiegel/nachtrag.rs`
- Modify: `src/instanz/repo.rs:666-691` (`save_rolle_mitarbeit`)
- Test: `src/instanz/spiegel/tests.rs` (neben den LLH-1817-Tests ab Zeile ~1598)

**Interfaces:**
- Consumes: Tabelle und `MitarbeitNachtrag` aus Task 1.
- Produces:
  - `pub async fn queue_nachtraege(conn: &mut SqliteConnection, kopplung_id: i64) -> Result<(), AppError>` —
    `INSERT OR IGNORE` je Mitgliedschaft mit `einsatz_rolle = 'mitarbeit'` in einem Einsatz mit
    `einsatz.spiegel = 1`, dessen `einsatz_spiegel.kopplung_org_id` zu einer nicht widerrufenen
    Org dieser Kopplung gehört und `einsatz_spiegel.beendet_at IS NULL`; Schlüssel über
    `schema::…tabelle("einsatz_mitgliedschaft").schluessel.ausdruck("m")` wie `resend_mitarbeit`.
  - `pub async fn save_grenze(conn: &mut SqliteConnection, kopplung_id: i64) -> Result<(), AppError>` —
    `UPDATE instanz_kopplung SET mitarbeit_grenze_stand = (SELECT COALESCE(MAX(stand), 0) FROM einsatz_aenderung) WHERE id = ?`.
  - `pub async fn list_offene(conn: &mut SqliteConnection, kopplung_id: i64) -> Result<Vec<MitarbeitNachtrag>, AppError>` —
    leer, wenn `load_gegenueber_rolle_mitarbeit` falsch ist; sonst höchstens `NACHTRAEGE_MAX`
    Zeilen nach `id`, nur aktive Spiegel wie oben; `kennung` = `einsatz_spiegel.fremde_kennung`,
    `gegen` = `spiegel_herkunft.fremder_schluessel` mit `lokaler_schluessel = schluessel` im
    selben Einsatz und `art = 'einsatz_mitgliedschaft'`, sonst `None`.
  - `pub async fn delete_quittiert(conn: &mut SqliteConnection, kopplung_id: i64, ids: &[i64]) -> Result<(), AppError>` (Muster `hinweis::quittiert`, nur Zeilen dieser Kopplung).
  - `save_rolle_mitarbeit`: im Zweig `rolle_mitarbeit && geaendert > 0` nach `resend_mitarbeit`
    `nachtrag::save_grenze` und `nachtrag::queue_nachtraege`; Doc-Kommentar nennt LLH-2007.

- [x] **Step 1: Failing tests** (Aufbau: `zwei_seiten`, dann `s` als Spiegel mit `mitarbeit`
  wie `mitarbeit_beim_alten_spiegel`; die Mitarbeit an `s` setzt der Test unter dem Merker
  `spiegel_uebernahme`, wie es `keep_mitarbeit` getan hätte):
  - `wechsel_der_faehigkeit_merkt_festgehaltene_mitarbeit_vor`: `save_rolle_mitarbeit(s, 1, true)`
    → genau eine Zeile in `mitarbeit_nachtrag` mit dem Schlüssel der Mitarbeit; Führungspersonal
    nicht; `mitarbeit_grenze_stand` = `MAX(stand)` vor dem Aufruf.
  - `zweites_melden_merkt_nichts_neu_vor`: zweiter Aufruf mit `true` → weiter eine Zeile,
    Grenze unverändert.
  - `nur_aktive_spiegel_dieser_kopplung`: Einsatz mit `beendet_at` gesetzt → nichts vorgemerkt;
    `list_offene` bei Flag 0 → leer.
  - `quittung_loescht_nur_eigene`: `delete_quittiert(…, kopplung 2, ids)` lässt Zeilen von
    Kopplung 1 stehen; mit Kopplung 1 → leer.
- [x] **Step 2:** `cargo test --lib instanz::spiegel::tests::` mit den Namen → FAIL.
- [x] **Step 3:** Funktionen und Aufruf in `save_rolle_mitarbeit` umsetzen.
- [x] **Step 4:** Tests dieses Tasks und die drei bestehenden LLH-1817-Tests
  (`aufgeruestetes_gegenueber_…`, `zweites_melden_ohne_wechsel_…`, `nachlieferung_nutzt_…`) → PASS.
- [x] **Step 5: Commit** `feat(spiegel): festgehaltene Mitarbeit beim Wechsel der Fähigkeit vormerken`

### Task 3: O nimmt Nachträge an

**Files:**
- Modify: `src/instanz/spiegel/nachtrag.rs`
- Test: `src/instanz/spiegel/tests.rs`

**Interfaces:**
- Consumes: Task 1, `abbildung::einsatz_lokal`, `repo::load_gegenueber_rolle_mitarbeit`.
- Produces:
  - `pub struct Annahme { pub quittungen: Vec<i64>, pub einsaetze: Vec<i64> }` (`Default`)
  - `pub async fn accept(conn: &mut SqliteConnection, kopplung_id: i64, nachtraege: &[MitarbeitNachtrag]) -> Result<Annahme, AppError>`

  Ablauf je Nachtrag, in dieser Reihenfolge (Design D4):
  0. Flag von O für N = 0 → überspringen, **nicht** quittieren.
  1. Einsatz `WHERE kennung = ? AND spiegel = 0`, sonst quittieren.
  2. `einsatz_fuehrung.herkunft_kopplung_id = kopplung_id` für diesen Einsatz, sonst quittieren.
  3. Lokaler Schlüssel: `gegen`, wenn er eine Mitgliedschaft **dieses** Einsatzes nennt
     (`json_extract(gegen, '$[0]') = einsatz_id` und die Zeile existiert), sonst
     `einsatz_lokal(conn, einsatz_id, "einsatz_mitgliedschaft", &schluessel)`; keiner → quittieren.
  4. Rolle `mitarbeit` → nur quittieren. Andere Rolle als `beobachter` → Neu-Log, quittieren.
  5. `mitarbeit_grenze_stand` NULL oder ein Logeintrag der Zeile mit `stand >` Grenze →
     Neu-Log, quittieren.
  Sonst `UPDATE einsatz_mitgliedschaft SET einsatz_rolle = 'mitarbeit' WHERE einsatz_id = ? AND benutzer_id = ?`,
  Einsatz in `einsaetze`, `tracing::info!(einsatz_id, kopplung_id, "Mitarbeit nachgetragen")`,
  quittieren. „Neu-Log“ = alte Zeile in `einsatz_aenderung` weg, neue einfügen (wie
  `resend_mitarbeit`); eine private Hilfsfunktion `relog_mitgliedschaft(conn, einsatz_id, schluessel)`
  in `nachtrag.rs`, die `resend_mitarbeit` danach ebenfalls nutzt.

- [x] **Step 1: Failing tests.** Ein Pool als O: Org, Kopplung 1 mit Flag 1, eigener Einsatz,
  Akte in `einsatz_fuehrung` mit `herkunft_kopplung_id = 1`, Konto, Mitgliedschaft `beobachter`,
  `spiegel_herkunft`-Zeile (`fremder_schluessel = '[7,9]'` → lokaler Schlüssel), danach
  `save_grenze`. Ein Nachtrag `{id: 1, kennung, schluessel: "[7,9]", gegen: None}`:
  - `nachtrag_hebt_beobachter_an`: Rolle `mitarbeit`, `quittungen == [1]`, `einsaetze == [e]`,
    Logstand der Zeile > Grenze.
  - `vor_der_grenze_bearbeitet_hebt_trotzdem_an`: Zeile vor `save_grenze` per UPDATE geändert
    (Führungsfunktion) → angehoben.
  - `abgelehnter_nachtrag_legt_die_zeile_neu_ins_log`: Zeile nach `save_grenze` geändert
    (Führungsfunktion, Rolle bleibt `beobachter`) → bleibt `beobachter`, quittiert, Logstand
    höher als nach der Änderung.
  - `wiederholter_nachtrag_aendert_nichts`: zweimal `accept` → zweiter Lauf quittiert, Rolle
    bleibt `mitarbeit`, `MAX(stand)` unverändert.
  - `ohne_faehigkeit_des_spiegels_wartet_der_nachtrag`: Flag 0 → keine Quittung, Rolle
    `beobachter`.
  - `fuehrung_von_anderer_kopplung_hebt_nicht_an`: `herkunft_kopplung_id = 2` → quittiert,
    `beobachter`, kein Neu-Log.
  - `gegen_aus_einem_anderen_einsatz_hebt_nicht_an`: `gegen` = Schlüssel einer
    Beobachter-Mitgliedschaft eines zweiten eigenen Einsatzes → beide bleiben `beobachter`.
  - `spiegel_nimmt_keinen_nachtrag_an`: Einsatz mit `spiegel = 1` → quittiert, unverändert.
- [x] **Step 2:** Tests → FAIL.
- [x] **Step 3:** `accept` und `relog_mitgliedschaft` umsetzen, `resend_mitarbeit` auf die
  Hilfsfunktion umstellen.
- [x] **Step 4:** Tests dieses Tasks und die LLH-1817-Tests → PASS.
- [x] **Step 5: Commit** `feat(spiegel): Führer trägt Mitarbeit unter engen Bedingungen nach`

### Task 4: Abgleich trägt beide Felder

**Files:**
- Modify: `src/instanz/spiegel/abgleich.rs` (`handle_abgleich` ab Zeile 448, `abgleich_einmal` ab 606)
- Modify: `src/instanz/spiegel/takt.rs:55-70` (`aktiv`)
- Test: `src/instanz/spiegel/tests.rs`

**Interfaces:**
- Consumes: `list_offene`, `delete_quittiert`, `accept`, `Annahme` (Tasks 2, 3).

- `handle_abgleich` (erreichte Seite), in der Transaktion nach `uebernehme_alle` und vor
  `liefere_alle`: `delete_quittiert(anfrage.mitarbeit_quittungen)`, `accept(anfrage.mitarbeit_nachtraege)`
  → `einsaetze` in `uebernommen.einsaetze`, `quittungen` in die Antwort; Antwort trägt
  `list_offene`. Weil `accept` vor `liefere_alle` läuft, geht eine angehobene Rolle in derselben
  Antwort hinaus.
- `abgleich_einmal` (meldende Seite): Anfrage trägt `list_offene` und die Quittungen der
  vorigen Runde (Variable über die Runden wie `bruch_antworten`); nach der Antwort
  `delete_quittiert(antwort.mitarbeit_quittungen)` und `accept(antwort.mitarbeit_nachtraege)` in
  der Schreibtransaktion nach `uebernehme_alle`. Quittungen der letzten Runde gehen verloren; der
  wiederholte Nachtrag ist harmlos (Task 3, `wiederholter_nachtrag_aendert_nichts`).
- `takt.rs`: `aktiv` auch, wenn `mitarbeit_nachtrag` Zeilen für die Kopplung hat.

- [x] **Step 1: Failing test** `nachtrag_kommt_im_abgleich_an` mit `zwei_seiten`: `f` führt (Akte
  mit `herkunft_kopplung_id = 1`, Mitgliedschaft `beobachter`), `s` spiegelt mit festgehaltener
  `mitarbeit`; Flags beidseitig 0, dann `save_rolle_mitarbeit(…, true)` auf beiden Seiten
  (zuerst `f`, dann `s`); `while abgleichen(&f, &s, 500).await > 0 {}` → `rolle(f) == "mitarbeit"`,
  `rolle(s) == "mitarbeit"`, `mitarbeit_nachtrag` an `s` leer. Zweite Schleife mit vertauschter
  Reihenfolge der Flags (zuerst `s`): erst nach dem Flag an `f` angehoben.
- [x] **Step 2:** Test → FAIL.
- [x] **Step 3:** Einbau wie oben.
- [x] **Step 4:** `cargo test --lib instanz::spiegel` → PASS.
- [x] **Step 5: Commit** `feat(spiegel): Mitarbeit-Nachträge reisen im Abgleich`

### Task 5: Rollentausch mit zwei echten Instanzen

**Files:**
- Modify: `src/instanz/melden.rs` (Fähigkeit aus einem Test-Hook statt `true` an den Stellen,
  die die eigene Anfrage und Antwort bauen, heute Zeile ~832 und ~1717)
- Create: `tests/instanz_mitarbeit_nachtrag.rs` (eigenes Test-Binary, weil der Hook prozessweit gilt)

**Interfaces:**
- Produces: `#[doc(hidden)] pub fn rolle_mitarbeit_fuer_tests(an: bool)` in `melden.rs` über ein
  `static ROLLE_MITARBEIT: AtomicBool` (Vorgabe `true`); Doc-Kommentar wie
  `auth::oidc::state::platz_fuer_tests` (prozessweit, nur in einem eigenen Test-Binary).
  `melden.rs`-Unit-Test `alte_antwort_ohne_feld_heisst_keine_mitarbeit` bleibt grün.

- [x] **Step 1: Failing test(s)** in `tests/instanz_mitarbeit_nachtrag.rs` (`mod common;`,
  Helfer nach `tests/instanz_fuehrung.rs`: `instanz(true)`, `gekoppelt_mit`, `elw_meldet`,
  `abgleichen`; Konto beider Seiten wie `gemeinsames_konto` in `tests/instanz_spiegel.rs`). Alle
  Tests hinter einem `static NACHEINANDER: tokio::sync::Mutex<()>`. ELW = N, Hub = O.
  - `rueckgabe_an_alte_instanz_traegt_mitarbeit_nach`: Hook `false`; ELW legt Einsatz an, setzt
    Erika (gemeinsames Konto) per `PUT /api/einsaetze/{e}/mitglieder/{id}` auf `mitarbeit`;
    melden, abgleichen → Hub `beobachter`. `POST /api/einsaetze/{e}/fuehrung/uebergeben` an den
    Hub, abgleichen → Hub `beobachter`, ELW `mitarbeit`. Hook `true`, `elw_meldet` (zweimal
    abgleichen) → Hub `mitarbeit`, ELW `mitarbeit`, `mitarbeit_nachtrag` am ELW leer.
  - `bearbeitung_nach_dem_aufruesten_bleibt_und_der_spiegel_folgt`: wie oben, aber nach
    Hook `true` und Melden setzt die Einsatzleitung am Hub Erika auf `beobachter` mit
    Führungsfunktion, bevor der Abgleich läuft (Reihenfolge: `run_durchlauf`, dann PUT am Hub,
    dann `abgleichen`) → Hub `beobachter`, ELW `beobachter`.
  - `notuebernahme_durch_alte_instanz_traegt_mitarbeit_nach`: wie der erste, aber der Hub
    übernimmt mit `hub_uebernimmt_mit_unterschrift` (Setup aus `instanz_fuehrung.rs`
    übernehmen). Gelingt das ohne größeren Umbau nicht, entfällt der Test und der Commit sagt,
    dass `herkunft_kopplung_id` beide Wege setzt (`spiegel::fuehrung::werde_fuehrer`).
- [x] **Step 2:** `cargo test --test instanz_mitarbeit_nachtrag` → FAIL (Hook fehlt).
- [x] **Step 3:** Hook einbauen.
- [x] **Step 4:** `cargo test --test instanz_mitarbeit_nachtrag` und `cargo test --lib instanz::melden` → PASS.
- [x] **Step 5: Commit** `test(instanz): Rollentausch mit alter Instanz trägt Mitarbeit nach`

### Task 6: Regel, ADR, Gates

**Files:**
- Modify: `docs/architektur/08-querschnittliche-konzepte.md` (8.2, ein Satz nach dem Mitarbeit-Absatz)
- Modify: `src/AGENTS.md:680-684` (Satz zum Nachtrag an den Absatz „Fähigkeit `rolle_mitarbeit`“;
  Nachweis-Zeile um `tests/instanz_mitarbeit_nachtrag.rs` ergänzen)
- Create: `docs/architektur/entscheidungen/ADR-0084-ein-spiegel-traegt-festgehaltene-mitarbeit-einmal-beim-fuehrer-nach.md`
  (Nummer vorher mit `git fetch origin alpha` und `scripts/adr-fuer.sh --alle` prüfen)

- [x] **Step 1: ADR** nach `VORLAGE.md`, `status: akzeptiert`, `gilt_fuer: src/instanz/spiegel/nachtrag.rs`,
  `herleitung` = Design-Doc. Regeln:
  - MUST: Ein Führer hebt eine Mitgliedschaft auf Nachtrag eines Spiegels nur von `beobachter`
    auf `mitarbeit`, nur wenn die Führung von dessen Kopplung kam und die Zeile seit der Grenze
    unverändert ist.
  - MUST NOT: Ein Nachtrag ändert keine andere Spalte, Rolle oder Tabelle.
  - MUST: Ein abgelehnter, auflösbarer Nachtrag legt die Zeile neu ins Log.
  Prüfung: `verlange 'mitarbeit_grenze_stand' 'src/instanz/spiegel/nachtrag.rs'` und
  `verlange 'herkunft_kopplung_id' 'src/instanz/spiegel/nachtrag.rs'`.
- [x] **Step 2:** `src/AGENTS.md` ergänzen: „Hat ein Spiegel `mitarbeit` gegen einen alten Führer
  festgehalten, meldet er sie beim Wechsel 0 → 1 einmal nach (`spiegel::nachtrag`, ADR-0084).“
- [x] **Step 2b:** arc42 8.2: „Ein Spiegel, der `mitarbeit` gegen einen älteren Führer
  festgehalten hat, trägt sie nach dessen Aufrüsten einmal nach (ADR-0084).“
- [x] **Step 3:** `cargo fmt`, dann `./scripts/check-all.sh --geaendert --ohne-e2e` (ein Aufruf,
  ggf. im Hintergrund) → grün. `scripts/check-migrationen.sh` → grün.
- [x] **Step 4: Commit** `docs(instanz): Regel und ADR zum Mitarbeit-Nachtrag`
