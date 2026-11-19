# Einsatzrolle „Mitarbeit“ — Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eine vierte Einsatzrolle `mitarbeit`, die Meldungen, Chat, ETB-Einträge und eigene Anhänge erfasst und sonst nur liest.

**Architecture:** Neues Erfassungs-Gate (`EinsatzErfassungszugriff<M>` / `EinsatzErfassungsfreigabe<M>`) an genau neun Handlern (Positivliste). `darf_schreiben()` bleibt für Mitarbeit falsch, damit jeder andere Schreibweg zu bleibt. Instanzkopplung über eine Fähigkeit `rolle_mitarbeit`; ältere Gegenüber bekommen `beobachter`.

**Tech Stack:** Rust (Axum, sqlx/SQLite), React/TypeScript (Vitest), Typ-Codegen.

**Spec:** `docs/superpowers/specs/2026-11-19-yd9hmb6c-einsatzrolle-mitarbeit-design.md`

Zunder: https://zunder.rubeen.dev/#/aufgabe/yd9hmb6c5q32st2ddrz7gybq

## Global Constraints

- Wire-Wert `mitarbeit`, Anzeigename „Mitarbeit“; danach unveränderlich.
- `darf_schreiben()` und `gehoert_zur_fuehrung()` sind für Mitarbeit `false`.
- Statuscodes nach `src/AGENTS.md`, „Statuscode-Konvention“: fremdes Objekt 404, verbotene Handlung 403.
- Mitarbeit legt keine Meldung der Art `lagemeldung` an und stellt keine darauf um (403).
- Kein Protokoll-Bump (`PROTOKOLL` bleibt 4).
- Migrationen anhängen (> 0356), Blatt-Umbau ohne `-- no-transaction` (`migrations/AGENTS.md`).
- Bezeichner: Fachbegriffe deutsch, Technik englisch (Wurzel-`AGENTS.md`, LLH-1312); Testnamen als deutscher Satz.
- Nach der Enum-Änderung `scripts/check-typ-codegen.sh` und beide generierten Dateien mitcommitten.
- Vor dem PR `./scripts/check-all.sh --geaendert --ohne-e2e`, ohne `| tail`.

## Review Focus

1. **Offline-Replay als Mitarbeit:** dieselbe `client_id` zweimal an POST `/meldungen` und POST `/etb` gibt beim zweiten Mal den gespeicherten Datensatz zurück (201), auch nach Einsatzabschluss → Test in Task 4 und Task 5.
2. **Rollenwechsel mitten im Einsatz:** Ist die Person von Mitarbeit auf Beobachter herabgesetzt, gibt ihr nächster Chat-POST 403 → Test in Task 3.
3. **Modul auf „Führung im Einsatz“ gesperrt:** Mitarbeit bekommt am ETB-POST 403, Führungspersonal 201 → Test in Task 5.
4. **Rückfluss nach Notübernahme:** Ein Gegenüber ohne Fähigkeit liefert `beobachter` für eine Mitgliedschaft, die lokal `mitarbeit` ist; sie bleibt `mitarbeit` → Test in Task 7.
5. **Mitarbeit an einem fremden Anhang:** `anhang_ids` mit dem Anhang einer anderen Person am ETB-POST gibt 403 und legt keinen Eintrag an → Test in Task 5.

---

### Task 1: Rolle, Datenbank, Wire

**Files:**
- Modify: `src/einsatz/mod.rs:83-117` (Enum, Prädikate, Tests bei `:498`)
- Create: `migrations/0357_einsatz_rolle_mitarbeit.sql`
- Modify: `src/db/` Testmodul mit Migrationsprüfungen (Muster `migration_0208_br_belegung_neubau_erhaelt_zeilen_sequenz_und_schema`)
- Modify: `tests/enum_wire_kontrakt.rs`
- Modify: `frontend/src/einsatz/einsatzRolle.ts`, `frontend/src/pages/MitgliederAbschnitt.tsx:33` (Rangfolge), generierte Typen

**Interfaces:**
- Produces: `EinsatzRolle::Mitarbeit`, `EinsatzRolle::darf_erfassen(&self) -> bool`, `EinsatzRolle::ist_mitarbeit(&self) -> bool`; Frontend-Typ `EinsatzRolle` enthält `'mitarbeit'`.

- [ ] **Step 1: Failing Unit-Test** in `src/einsatz/mod.rs`:

```rust
#[test]
fn mitarbeit_erfasst_aber_schreibt_nicht_und_fuehrt_nicht() {
    let m = EinsatzRolle::Mitarbeit;
    assert_eq!(m.as_str(), "mitarbeit");
    assert!(m.darf_erfassen());
    assert!(!m.darf_schreiben());
    assert!(!m.gehoert_zur_fuehrung());
    assert!(m.ist_mitarbeit());
    assert!(EinsatzRolle::Einsatzleitung.darf_erfassen());
    assert!(EinsatzRolle::Fuehrungspersonal.darf_erfassen());
    assert!(!EinsatzRolle::Beobachter.darf_erfassen());
}
```

- [ ] **Step 2:** `cargo test --lib einsatz::tests::mitarbeit` → FAIL (Variante fehlt).
- [ ] **Step 3:** Variante `Mitarbeit => "mitarbeit"` im `wire_enum!` zwischen `Fuehrungspersonal` und `Beobachter`; `darf_erfassen` = `!matches!(self, Beobachter)`; `ist_mitarbeit`. Compiler-Fehler an allen `match`-Stellen beheben (Mitarbeit wie Beobachter behandeln, wo es um Führung oder Schreiben geht).
- [ ] **Step 4: Failing Migrationstest** `migration_0357_mitgliedschaft_neubau_erhaelt_zeilen_trigger_und_schema`: legt vor 0357 eine Mitgliedschaft mit `fuehrungsstelle` und `fuehrungsfunktion = 's2'` an, spielt 0357 ein und prüft: Zeile unverändert; `INSERT … 'mitarbeit'` gelingt; `INSERT … 'unsinn'` scheitert; `sqlite_master` enthält `idx_mitgliedschaft_benutzer` und die sechs Trigger `einsatz_mitgliedschaft_spiegellog_{i,u,d}`, `einsatz_mitgliedschaft_spiegelschutz_{i,u,d}`; ein INSERT schreibt eine Zeile in `einsatz_aenderung`.
- [ ] **Step 5:** Migration schreiben: `CREATE TABLE einsatz_mitgliedschaft_neu` mit allen Spalten aus 0003 + `fuehrungsstelle TEXT` (0100) + `fuehrungsfunktion` mit dem CHECK aus 0128, CHECK `einsatz_rolle IN ('einsatzleitung','fuehrungspersonal','mitarbeit','beobachter')`; Daten kopieren; DROP; RENAME; Index und die sechs Trigger wörtlich aus `0314_einsatz_spiegel.sql:187-202`. Kopfkommentar nach Muster 0208 (Blatt: `grep -l "REFERENCES einsatz_mitgliedschaft" migrations` ist leer).
- [ ] **Step 6:** `cargo test migration_0357` und `cargo test --lib einsatz::` → PASS.
- [ ] **Step 7:** `tests/enum_wire_kontrakt.rs` um `mitarbeit` ergänzen; `scripts/check-typ-codegen.sh` laufen lassen; `EINSATZ_ROLLE_LABELS` um `mitarbeit: 'Mitarbeit'` in der Reihenfolge Einsatzleitung, Führungspersonal, Mitarbeit, Beobachter; Rangfolge in `MitgliederAbschnitt.tsx` (`mitarbeit: 2, beobachter: 3`). `einsatzRolle.test.ts` prüft die Reihenfolge der Optionen.
- [ ] **Step 8:** `cargo test --test enum_wire_kontrakt`, `mise exec -- pnpm --dir frontend test einsatzRolle` und `mise exec -- pnpm --dir frontend typecheck` → PASS.
- [ ] **Step 9: Commit** `feat(einsatz): Einsatzrolle Mitarbeit mit Wire-Wert und Tabellenumbau`

### Task 2: Erfassungs-Gate

**Files:**
- Modify: `src/einsatz/berechtigung.rs` (neben `fordere_schreibrecht`, `:170`)
- Modify: `src/einsatz/kontext.rs` (neben `EinsatzSchreibzugriff`/`EinsatzSchreibfreigabe`, `:204-270`; `EinsatzKontext::fordere_erfassungsrecht`)
- Modify: `tests/einsatz_kontext_guard.rs:35` (`SANKTIONIERTE_GATES`)
- Modify: `docs/architektur/entscheidungen/ADR-0005-einsatz-autorisierung-ueber-typisierte-extractor.md`

**Interfaces:**
- Consumes: `EinsatzRolle::darf_erfassen`
- Produces: `pub fn fordere_erfassungsrecht(rolle: Option<EinsatzRolle>) -> Result<(), AppError>`; `pub struct EinsatzErfassungszugriff<M: ModulMarker = OhneModul>(pub EinsatzKontext, PhantomData<M>)` (Org-Floor → Erfassungsrecht → Modul → `fordere_aktiv`); `pub struct EinsatzErfassungsfreigabe<M: ModulMarker = OhneModul>` (Org-Floor → Erfassungsrecht → Modul → `fordere_lesezugriff`); beide `Deref<Target = EinsatzKontext>`.

- [ ] **Step 1: Failing Test** in `berechtigung.rs`: `fordere_erfassungsrecht_laesst_mitarbeit_durch_und_sperrt_beobachter` — `Ok` für `Some(Mitarbeit)`, `Some(Fuehrungspersonal)`, `Some(Einsatzleitung)`; `Err(AppError::Forbidden)` für `Some(Beobachter)` und `None`.
- [ ] **Step 2:** `cargo test --lib fordere_erfassungsrecht` → FAIL.
- [ ] **Step 3:** Funktion und beide Extractor-Typen implementieren; Doc-Kommentar verweist auf `src/AGENTS.md`, „Erfassungs-Gate (LLH-1817)“. Beide Namen in `SANKTIONIERTE_GATES` mit Kommentar `// LLH-1817: Erfassen ohne Schreibrecht (Mitarbeit), nur an der Positivliste.`
- [ ] **Step 4:** `cargo test --lib fordere_erfassungsrecht` und `cargo test --test einsatz_kontext_guard` → PASS.
- [ ] **Step 5:** ADR-0005: Abschnitt „Ergänzung LLH-1817“ mit den zwei Typen und der Regel „nur an Handlern der Positivliste im Design-Doc“. `scripts/adr-fuer.sh src/einsatz/kontext.rs` prüft, dass die ADR gefunden wird.
- [ ] **Step 6: Commit** `feat(einsatz): Erfassungs-Gate für Erfassen ohne Schreibrecht`

### Task 3: Chat und Anhänge auf das Erfassungs-Gate

**Files:**
- Modify: `src/routes/chat.rs` (`nachricht_erfassen` `:168`, `nachricht_bearbeiten` `:242`, `nachricht_loeschen` `:257`)
- Modify: `src/routes/anhang.rs` (`hochladen` `:35`, `loeschen` `:101`)
- Create: `tests/einsatzrolle_mitarbeit.rs` (geteilt mit Task 4–6; Helfer `mitarbeit_anlegen(app, admin, einsatz) -> (i64, String)` über `benutzer_anlegen` + `rolle_setzen(…, "mitarbeit")` + `login_cookie`)

**Interfaces:**
- Consumes: `EinsatzErfassungszugriff<Chat>`, `EinsatzErfassungszugriff` (Task 2)

- [ ] **Step 1: Failing Tests** in `tests/einsatzrolle_mitarbeit.rs`:
  - `mitarbeit_schreibt_bearbeitet_und_loescht_eigene_chatnachricht` → 201/200/204.
  - `mitarbeit_bearbeitet_fremde_chatnachricht_nicht` → 403 (Status wie heute von `fordere_autor` für fremde Nachricht).
  - `mitarbeit_legt_keinen_chatkanal_an_und_setzt_keinen_bezug` → 403, 403.
  - `beobachter_schreibt_weiter_nicht_in_den_chat` → 403.
  - `herabgestufte_mitarbeit_schreibt_nicht_mehr` (Review Focus 2): Chat 201, dann `rolle_setzen(…, "beobachter")`, Chat → 403.
  - `mitarbeit_laedt_anhang_hoch_und_loescht_eigenen` → 201/204; fremder ungebundener Anhang → 404.
  - `mitarbeit_legt_keine_kraefte_abschnitte_oder_einstellungen_an` → POST Einheit, POST Abschnitt, PUT Einstellungen je 403.
- [ ] **Step 2:** `cargo test --test einsatzrolle_mitarbeit` → FAIL bei den Erlaubt-Fällen.
- [ ] **Step 3:** Die fünf Handler-Signaturen auf `EinsatzErfassungszugriff<…>` umstellen, Rumpf unverändert.
- [ ] **Step 4:** `cargo test --test einsatzrolle_mitarbeit --test chat --test anhang --test einsatz_kontext_guard` → PASS.
- [ ] **Step 5: Commit** `feat(chat): Mitarbeit schreibt im Chat und lädt Anhänge hoch`

### Task 4: Meldungen anlegen und eigene korrigieren

**Files:**
- Modify: `src/routes/meldung.rs:252` (`anlegen`)
- Modify: `src/routes/meldung_korrektur.rs:128` (`korrigieren`)
- Modify: `src/meldung/mod.rs` (Hilfsfunktion)
- Test: `tests/einsatzrolle_mitarbeit.rs`

**Interfaces:**
- Consumes: `EinsatzErfassungsfreigabe<Meldungen>`, `EinsatzErfassungszugriff<Meldungen>`, `EinsatzRolle::ist_mitarbeit`
- Produces: `pub fn fordere_meldungsart_fuer_rolle(rolle: Option<EinsatzRolle>, art: Meldungsart) -> Result<(), AppError>` (Mitarbeit + `Lagemeldung` → `Forbidden`); `pub async fn fordere_eigene_meldung(pool, einsatz_id, meldung_id, benutzer_id) -> Result<(), AppError>` (fremd → `NotFound`).

- [ ] **Step 1: Failing Tests:**
  - `mitarbeit_legt_normale_meldung_mit_ort_an` → 201, `erfasst_von_id` = Mitarbeit.
  - `mitarbeit_legt_keine_lagemeldung_an` → 403, Meldungsliste leer.
  - `mitarbeit_korrigiert_eigene_meldung` (Priorität ändern) → 200.
  - `mitarbeit_korrigiert_fremde_meldung_nicht` → 404.
  - `mitarbeit_stellt_eigene_meldung_nicht_auf_lagemeldung_um` → 403; ebenso `lagerelevant: true` → 403 und `lage_text` → 403.
  - `mitarbeit_bestaetigt_weist_zu_und_erteilt_keinen_auftrag` → 403 je Route.
  - `mitarbeit_meldung_offline_replay_gibt_gespeicherte_zurueck` (Review Focus 1): zweimal gleiche `client_id` über `anfrage_mit_offline_queue_benutzer` → beide 201, gleiche ID; nach Einsatzabschluss weiter 201.
- [ ] **Step 2:** `cargo test --test einsatzrolle_mitarbeit meldung` → FAIL.
- [ ] **Step 3:** Gates umstellen; in `anlegen` nach der Art-Prüfung `fordere_meldungsart_fuer_rolle(ctx.rolle, art)?` (vor dem Insert, nach dem Replay-Lookup); in `korrigieren` für Mitarbeit zuerst `fordere_eigene_meldung`, dann 403, wenn `lagerelevant`, `lage_text` gesetzt oder `meldungsart == Lagemeldung` ist. Für EL/FüPers keine Änderung.
- [ ] **Step 4:** `cargo test --test einsatzrolle_mitarbeit --test meldung --test meldung_korrektur --test benachrichtigung_meldung` → PASS (Mitarbeit erhält keinen Hinweis „Neue Meldung“: Assertion in `mitarbeit_legt_normale_meldung_mit_ort_an`, dass eine zweite Mitarbeit keine Benachrichtigung hat).
- [ ] **Step 5: Commit** `feat(meldung): Mitarbeit meldet und korrigiert eigene Meldungen`

### Task 5: ETB-Erfassung

**Files:**
- Modify: `src/routes/etb.rs` (`erfassen` `:67`, `anhang_hochladen` `:300`)
- Modify: `src/etb/mod.rs` (Hilfsfunktion neben `EtbTyp`)
- Test: `tests/einsatzrolle_mitarbeit.rs`

**Interfaces:**
- Consumes: `EinsatzErfassungsfreigabe<Etb>`, `EinsatzErfassungszugriff<Etb>`
- Produces: `pub fn fordere_etb_typ_fuer_rolle(rolle: Option<EinsatzRolle>, typ: EtbTyp) -> Result<(), AppError>` (Mitarbeit erlaubt `Meldung`, `Lage`, `Berichtigung`); Prüfungen auf `etb_eintrag.erfasser_id` (Berichtigung) und `anhang.hochgeladen_von` (alle `anhang_ids`) nur für Mitarbeit, je → `Forbidden`.

- [ ] **Step 1: Failing Tests:**
  - `mitarbeit_erfasst_etb_meldung_und_lage` → 201, 201.
  - `mitarbeit_erfasst_keine_anordnung_oder_entscheidung` → 403, 403.
  - `mitarbeit_berichtigt_eigenen_eintrag` → 201; `…_fremden_eintrag_nicht` → 403.
  - `mitarbeit_haengt_eigenes_foto_an_etb_eintrag` (Upload über `/etb/anhaenge`, dann `anhang_ids`) → 201.
  - `mitarbeit_haengt_fremden_anhang_nicht_an` (Review Focus 5) → 403, ETB-Anzahl unverändert.
  - `mitarbeit_etb_offline_replay_gibt_gespeicherten_zurueck` (Review Focus 1).
  - `mitarbeit_erfasst_nicht_wenn_etb_auf_fuehrung_im_einsatz_steht` (Review Focus 3): Modul-Override `einsatzfuehrung` → Mitarbeit 403, Führungspersonal 201.
  - `mitarbeit_erteilt_keinen_etb_auftrag` → 403.
- [ ] **Step 2:** `cargo test --test einsatzrolle_mitarbeit etb` → FAIL.
- [ ] **Step 3:** Gates umstellen; Prüfungen nach dem Replay-Lookup und vor dem Insert in `erfassen`.
- [ ] **Step 4:** `cargo test --test einsatzrolle_mitarbeit --test etb --test eingabegrenzen_etb --test etb_zaehler` → PASS.
- [ ] **Step 5: Commit** `feat(etb): Mitarbeit erfasst Meldung, Lage und eigene Berichtigungen`

### Task 6: Spiegel-Antrag je Route

**Files:**
- Modify: `src/instanz/spiegel/antrag.rs` (`Beantragbar` `:56`, `BEANTRAGBAR` `:98ff`, `beantragen` `:476`)
- Test: `src/instanz/spiegel/tests.rs`

**Interfaces:**
- Consumes: `fordere_erfassungsrecht`, `fordere_schreibrecht`
- Produces: Feld `Beantragbar::recht: Antragsrecht` mit `enum Antragsrecht { Schreiben, Erfassen }`; `Erfassen` genau für POST `/api/einsaetze/{id}/etb` und POST `/api/einsaetze/{id}/meldungen`.

- [ ] **Step 1: Failing Tests:** `mitarbeit_beantragt_etb_eintrag_am_spiegel` → Antrag angelegt; `mitarbeit_beantragt_keine_person_am_spiegel` → 403; `beobachter_beantragt_weiter_nichts` → 403.
- [ ] **Step 2:** `cargo test --lib instanz::spiegel::tests::mitarbeit` → FAIL.
- [ ] **Step 3:** Feld setzen, in `beantragen` `match b.recht` statt fester `fordere_schreibrecht`. Die führende Instanz führt den Antrag über denselben Handler aus; die Eigen-Prüfungen aus Task 4/5 greifen dort ohne Zusatz.
- [ ] **Step 4:** `cargo test --lib instanz::spiegel` → PASS.
- [ ] **Step 5: Commit** `feat(spiegel): Mitarbeit beantragt ETB-Einträge und Meldungen`

### Task 7: Instanzkopplung — Fähigkeit und Herabstufen

**Files:**
- Create: `migrations/0358_kopplung_rolle_mitarbeit.sql` (`ALTER TABLE instanz_kopplung ADD COLUMN gegenueber_rolle_mitarbeit INTEGER NOT NULL DEFAULT 0`)
- Modify: `src/instanz/repo.rs` (`KopplungZeile` `:13`, `save_faehigkeiten` `:627`)
- Modify: `src/instanz/melden.rs` (`MeldenAnfrage` `:101`, `MeldenAntwort` `:168`, Speichern `:892`, Bau der Anfrage `:799`, Antwort `:1696`, Annahme in `handle_meldung` `:1274`)
- Modify: `src/instanz/spiegel/liefern.rs` (`Absender` `:19`, `baue_zeile` `:372`)
- Modify: `src/instanz/spiegel/abgleich.rs` (`Absender` füllen in `liefere_alle` `:212`)
- Modify: `src/instanz/spiegel/uebernehmen.rs` (neben `ist_mitgliedschaft_eines_stellvertreters` `:686`)
- Test: `src/instanz/spiegel/tests.rs`, `src/instanz/melden.rs` (Testmodul)

**Interfaces:**
- Produces: `MeldenAnfrage.rolle_mitarbeit: bool` und `MeldenAntwort.rolle_mitarbeit: bool`, je `#[serde(default)]`, eigene Seite sendet immer `true`; `KopplungZeile.gegenueber_rolle_mitarbeit: bool`; `save_faehigkeiten(conn, kopplung_id, hinweise, web_push, rolle_mitarbeit)` bzw. eigene `save_rolle_mitarbeit(conn, kopplung_id, bool)` für die erreichte Seite; `Absender.gegenueber_mitarbeit: bool`.

- [ ] **Step 1: Failing Tests:**
  - `alte_antwort_ohne_feld_heisst_keine_mitarbeit`: JSON ohne `rolle_mitarbeit` → `false` (Anfrage und Antwort).
  - `meldende_und_erreichte_seite_speichern_die_faehigkeit`: nach einem Melde-Durchlauf steht `gegenueber_rolle_mitarbeit = 1` auf beiden Seiten.
  - `mitarbeit_geht_an_altes_gegenueber_als_beobachter`: `baue_zeile` für `einsatz_mitgliedschaft` mit `gegenueber_mitarbeit: false` → `daten.einsatz_rolle == "beobachter"`; mit `true` → `"mitarbeit"`; andere Rollen unverändert.
  - `beobachter_vom_alten_gegenueber_ueberschreibt_mitarbeit_nicht` (Review Focus 4): lokale Mitgliedschaft `mitarbeit`, eingehende Zeile `beobachter` von Kopplung mit `gegenueber_rolle_mitarbeit = 0` → bleibt `mitarbeit`; von Kopplung mit `= 1` → wird `beobachter`.
- [ ] **Step 2:** `cargo test --lib instanz::` → FAIL.
- [ ] **Step 3:** Migration, Felder, Speichern (meldende Seite aus der Antwort, erreichte aus der Anfrage); in `baue_zeile` nach dem Laden: `if t.name == "einsatz_mitgliedschaft" && !a.gegenueber_mitarbeit` und `einsatz_rolle == "mitarbeit"` → `"beobachter"`; in `uebernehmen.rs` vor dem Schreiben: bei `einsatz_mitgliedschaft`, eingehend `beobachter`, lokal `mitarbeit`, Kopplung ohne Fähigkeit → Spalte `einsatz_rolle` aus den Werten nehmen.
- [ ] **Step 4:** `cargo test --lib instanz::` und `cargo test --test instanz_fuehrung` → PASS.
- [ ] **Step 5: Commit** `feat(instanz): Fähigkeit rolle_mitarbeit, Herabstufen für ältere Gegenüber`

### Task 8: Frontend

**Files:**
- Modify: `frontend/src/einsatz/schreibrecht.ts` (+ `schreibrecht.test.ts`)
- Modify: `frontend/src/pages/ChatPage.tsx:430`, `frontend/src/pages/EtbPage.tsx:818-821`, `frontend/src/pages/MeldungenPage.tsx:187,682,728-730`, `frontend/src/pages/fuehrung/UeberblickPage.tsx:432`
- Modify: ETB-Erfassung (Typauswahl und Berichtigen; über `EtbPage.tsx` und `frontend/src/etb/` finden), Meldungs-Erfassungsformular (Meldungsart ohne „Lagemeldung“, kein Lagerelevant-Schalter), `einsatzRechteGrund`
- Modify: Rollenwahl `frontend/src/pages/MitgliederAbschnitt.tsx` (zweite Zeile je Option nur für Mitarbeit nötig, siehe Step 3)
- Test: zugehörige `*.test.tsx`

**Interfaces:**
- Produces: `darfImEinsatzErfassen(einsatz?: EinsatzSchreibkontext): boolean` (`!istSpiegel && aktiv && rolle ∈ {einsatzleitung, fuehrungspersonal, mitarbeit}`); `darfErfassungBeantragen(einsatz?): boolean` (wie `darfBeantragen`, Rollenmenge mit Mitarbeit); `istMitarbeit(einsatz?): boolean`.

- [ ] **Step 1: Failing Tests** in `schreibrecht.test.ts`: Tabelle über Rolle × (aktiv, abgeschlossen, Spiegel, Spiegel beendet) für die drei Funktionen; `darfImEinsatzSchreiben`, `darfBeantragen` und `darfNachreichenVerwerfen` bleiben für Mitarbeit `false`.
- [ ] **Step 2:** `mise exec -- pnpm --dir frontend test schreibrecht` → FAIL.
- [ ] **Step 3:** Funktionen implementieren. Aufrufstellen: Chat-Eingabe und eigene Nachricht bearbeiten/löschen → `darfImEinsatzErfassen`, Kanal/Bezug/Heraufstufen bleiben `darfSchreiben`; ETB- und Meldungs-Erfassen (`darfErfassen`, `darfMelden`, `darfMeldenRoh`, `darfEtbErfassen`) → `darfErfassungBeantragen`; Erfassungs-Anhänge erhalten `darfSchreiben={darfImEinsatzErfassen(einsatz)}` an den Erfassungsorten. ETB-Typauswahl für `istMitarbeit` auf Meldung/Lage; Berichtigen-Knopf nur an Einträgen mit `erfasser_id === ich`. Meldung korrigieren nur an eigenen. Rollenwahl: Option „Mitarbeit“ mit Beschreibung „Erfasst Meldungen, Chat und ETB-Einträge, ändert sonst nichts.“ `einsatzRechteGrund` für Mitarbeit: „Du kannst erfassen, aber nichts ändern.“ `LagemeldungenPage` bleibt bei `darfBeantragen`.
- [ ] **Step 4: Komponententests:** ChatPage mit `meine_rolle: 'mitarbeit'` zeigt Eingabe, keinen „Kanal anlegen“; EtbPage zeigt Erfassen mit genau den Typen Meldung/Lage; MeldungenPage zeigt „Neue Meldung“ ohne Art „Lagemeldung“ und ohne „Bestätigen“/„Zuweisen“.
- [ ] **Step 5:** `mise exec -- pnpm --dir frontend test` für die berührten Dateien, `typecheck`, `lint` → PASS; `schreibrecht.guard.test.ts` grün.
- [ ] **Step 6: Commit** `feat(frontend): Mitarbeit erfasst Chat, ETB und Meldungen`

### Task 9: Doku und Regeln

**Files:**
- Modify: `docs/anwender/kapitel/rechte-im-einsatz.md`, `docs/anwender/kapitel/benutzer.md` (falls Rollen genannt)
- Modify: `src/AGENTS.md` (neuer Abschnitt „Erfassungs-Gate (LLH-1817)“)
- Modify: arc42-Kapitel nach `docs/architektur/AGENTS.md`, Mitänderungsregel (Querschnitt Sicherheit/Autorisierung)

- [ ] **Step 1:** Anwenderdoku: Rolle Mitarbeit mit Darf-Satz und Liste (Meldung ohne Lagemeldung, Chat, ETB Meldung/Lage, eigene Berichtigung, eigene Fotos; offline und am Spiegel für ETB und Meldungen). Form nach `docs/anwender/AGENTS.md`; Wächter laufen lassen, die dort genannt sind.
- [ ] **Step 2:** `src/AGENTS.md`: Regel „Ein Handler trägt das Erfassungs-Gate nur nach bewusster Entscheidung; `darf_schreiben()` bleibt für Mitarbeit falsch; Positivliste im Design-Doc LLH-1817“.
- [ ] **Step 3:** `./scripts/check-all.sh --geaendert --ohne-e2e` → alle Schritte grün (inkl. Migrationsnummern gegen `origin/alpha`, Prettier, rustfmt, Typ-Codegen).
- [ ] **Step 4: Commit** `docs(einsatz): Rolle Mitarbeit in Anwenderdoku, AGENTS und arc42`
