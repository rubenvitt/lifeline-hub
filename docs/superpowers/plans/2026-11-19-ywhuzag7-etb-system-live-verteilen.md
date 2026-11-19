# System-ETB-Einträge live verteilen — Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Jeder System-ETB-Eintrag einer Route und der lesbar bleibenden Löschlauf-Phasen geht
nach dem Commit als Ereignis `etb` hinaus; ein Debug-Wächter macht jede Lücke in den Tests rot.

**Architecture:** Neues Modul `src/etb/nachlauf.rs` (nur `cfg(debug_assertions)` wirksam) sammelt
per `tokio::task_local!` geschriebene und verteilte ETB-IDs. Eine Router-Schicht außerhalb von
`CatchPanicLayer` und eine Klammer um den Scheduler-Tick prüfen nach dem Lauf, ob jede committete
ID verteilt wurde. Die Lücken werden pro Stelle nach dem Muster aus LLH-1952 geschlossen.

**Tech Stack:** Rust, axum (`middleware::from_fn_with_state`), tokio `task_local!`, sqlx/SQLite.

**Spec:** `docs/superpowers/specs/2026-11-19-ywhuzag7-etb-system-live-verteilen-design.md`

## Global Constraints

- Verteilung je ID per `LiveHub::publiziere(einsatz_id, etb_id)`, **nach** dem Commit, außerhalb
  der `write_retry!`-Closure; IDs innerhalb der Closure sammeln und per `Ok(…)` herausgeben.
- Wire-Format von `etb` und Frontend bleiben unverändert.
- Release-Build: keine Erfassung, keine Abfrage, kein Panic (`#[cfg(debug_assertions)]`).
- Ausnahmen nur über `nachlauf::ohne_verteilung(grund, fut)` mit `&'static str`-Grund; erlaubt
  für: Demo-Import, Instanz-Spiegel (Abgleich, Spiegel-Takt), Archivieren (Phase N),
  `soft_delete_einsatz`, `schwaerze_einsatz`.
- Bezeichner: Fachbegriffe deutsch, Technik englisch (Wurzel-`AGENTS.md`, LFH-1312); Prosa,
  Kommentare, Testnamen deutsch.
- Commit-Body trägt `Zunder: https://zunder.rubeen.dev/#/aufgabe/ywhuzag78bi3k31glbjlfjzs`.
- Rust-Tests: `cargo test --test <datei>`; kein `| tail` um Gate-Kommandos.

## Review Focus

- Ein `write_retry!`-Versuch, der bei `SQLITE_BUSY` zurückrollt: seine ID darf weder verteilt
  noch vom Wächter verlangt werden (Test in Task 1).
- Verschachtelter Router-Aufruf (Spiegel-Antrag per `oneshot`): innere Anfrage öffnet keinen
  zweiten Sammler, eine äußere Ausnahme deckt sie (Test in Task 1).
- Panic des Wächters muss den Test rot machen, nicht als 500 enden: Schicht liegt außerhalb von
  `CatchPanicLayer` (Test in Task 2).
- Ein Handler, der vor dem Commit verteilt (Ereignis vor Datenbestand): Review prüft je
  geänderter Stelle, dass `publiziere` hinter dem `write_retry!` steht.
- Gespawnter Task im Handler: weder Schreiben noch Verteilen wird gesehen, keine falschen Treffer
  (bewusste Grenze, im Modulkommentar dokumentiert).

---

### Task 1: Wächter-Modul `etb::nachlauf`

**Files:**
- Create: `src/etb/nachlauf.rs`
- Modify: `src/etb/mod.rs` (`pub mod nachlauf;`), `src/etb/repo.rs` (`einfuegen`, nach dem INSERT),
  `src/live/mod.rs` (`LiveHub::publiziere`)
- Test: `tests/etb_nachlauf.rs`

**Interfaces:**
- Produces:
  - `pub struct Luecke { pub einsatz_id: i64, pub etb_id: i64, pub inhalt: String }`
  - `pub async fn klammer<F: Future>(pool: &SqlitePool, fut: F) -> (F::Output, Vec<Luecke>)`.
    Ist schon ein Sammler aktiv, führt sie `fut` nur aus und gibt `vec![]` zurück (äußere Klammer
    prüft). Sonst neuer Sammler, nach `fut` die DB-Abfrage `SELECT id, einsatz_id, inhalt FROM
    etb_eintrag WHERE id IN (…)` über die geschriebenen, weder verteilten noch ausgenommenen IDs.
    Release: `(fut.await, Vec::new())`.
  - `pub async fn ohne_verteilung<F: Future>(grund: &'static str, fut: F) -> F::Output`:
    zählt im Sammler eine Ausnahmetiefe hoch; IDs, die bei Tiefe > 0 geschrieben werden, landen in
    `ausgenommen`. Ohne Sammler: nur `fut.await`.
  - `pub(crate) fn geschrieben(einsatz_id: i64, etb_id: i64)` und `pub(crate) fn verteilt(etb_id: i64)`:
    `try_with`, ohne Sammler no-op; in Release leere Funktionen.
  - `pub fn melde(luecken: &[Luecke]) -> String`: Panic-/Log-Text, je Lücke Einsatz, ETB-ID, Inhalt,
    plus Hinweis auf `src/AGENTS.md`, Abschnitt „ETB live verteilen“.

- [ ] **Step 1: Failing tests in `tests/etb_nachlauf.rs`** (Pool aus `tests/common`, Einsatz anlegen,
  dann direkt `crate::etb::system_audit_tx` in einer Transaktion):
  - `schreiben_ohne_verteilen_ist_eine_luecke`: `klammer` um Schreiben+Commit → `luecken.len() == 1`,
    `luecken[0].etb_id == id`.
  - `schreiben_und_verteilen_ist_keine_luecke`: dazu `live.publiziere(einsatz, id)` → leer.
  - `zurueckgerollt_ist_keine_luecke`: schreiben, `tx.rollback()` → leer.
  - `ohne_verteilung_nimmt_aus`: Schreiben in `ohne_verteilung("Test", …)` → leer.
  - `innere_klammer_prueft_nicht`: `klammer(klammer(schreiben))` → innere liefert `vec![]`,
    äußere 1 Lücke; `klammer(ohne_verteilung(klammer(schreiben)))` → äußere leer.
  - `ohne_sammler_kein_effekt`: Schreiben und `publiziere` ohne Klammer panicen nicht.
- [ ] **Step 2:** `cargo test --test etb_nachlauf` → FAIL (Modul fehlt).
- [ ] **Step 3:** Modul implementieren, `geschrieben` in `repo::einfuegen` nach dem INSERT,
  `verteilt` in `LiveHub::publiziere`. Modulkommentar nennt die Grenze „gespawnte Tasks“.
- [ ] **Step 4:** `cargo test --test etb_nachlauf` → PASS.
- [ ] **Step 5:** Commit `feat(etb): Wächter für unverteilte ETB-Einträge (LLH-1976)`.

### Task 2: Wächter scharf schalten (Router, Scheduler, Ausnahmen) und Lückenliste

**Files:**
- Modify: `src/etb/nachlauf.rs` (Middleware), `src/app.rs` (Schicht direkt **nach**
  `.layer(CatchPanicLayer::custom(on_panic))`, also außen davon, vor `stammdaten_live`),
  `src/einsatz/purge_scheduler.rs`, `src/routes/demo_daten.rs`,
  `src/instanz/spiegel/abgleich.rs` (`handle_abgleich`), `src/instanz/spiegel/takt.rs`,
  `src/einsatz/archiv.rs` (`archivieren`), `src/einsatz/repo.rs` (`soft_delete_einsatz`,
  `schwaerze_einsatz`)
- Test: `tests/etb_nachlauf.rs`

**Interfaces:**
- Consumes: `klammer`, `ohne_verteilung`, `melde` aus Task 1.
- Produces:
  - `pub async fn waechter(State(state): State<AppState>, req: Request, next: Next) -> Response`:
    `klammer(&state.pool, next.run(req))`, bei Lücken `panic!("{}", melde(&l))`.
  - `purge_scheduler::tick_mit_luecken(pool, live, jetzt, &mut bool) -> (usize, Vec<Luecke>)`;
    `tick_mit_rueckschrieb` (gleiche Signatur wie heute) ruft ihn und panict bei Lücken (Tests);
    die Schleife in `starte_purge_scheduler` ruft `tick_mit_luecken` und loggt
    `tracing::error!("{}", melde(&l))`.
  - Ausnahmegründe (wörtlich): `"Demo-Import: Hunderte Einträge auf einmal"`,
    `"Instanz-Spiegel: Einträge kommen aus der Partnerinstanz"`,
    `"Einsatz verlässt den Betrieb; kopf_melden meldet es"`.

- [ ] **Step 1: Failing test** `panic_der_schicht_erreicht_den_test` in `tests/etb_nachlauf.rs`:
  ein `#[should_panic(expected = "ETB-Eintrag")]`-Test, der über `common::app()` eine heute noch
  unverteilte Route ruft (`POST …/gefahren/{id}/bewertung`, `gefahr::bewerten`). Später (Task 5)
  wird dieser Test auf eine eigens im Test gebaute Mini-Route mit `build_router`-Schicht umgestellt,
  sobald `bewerten` verteilt. *(Builder: direkt eine Testroute nehmen, wenn `tests/common` das
  einfach erlaubt.)*
- [ ] **Step 2:** Test → FAIL (keine Schicht, kein Panic).
- [ ] **Step 3:** Schicht, Scheduler-Klammer und Ausnahmen einbauen.
- [ ] **Step 4:** Test → PASS. Dann `cargo test` voll laufen lassen (ein Aufruf, ggf.
  `run_in_background`); jede Panic-Meldung mit Test, Route/Phase und Inhalt in die Lückenliste
  unten unter „Ledger“ eintragen.
- [ ] **Step 5:** Commit `feat(etb): Wächter um Router und Löschlauf (LLH-1976)` — der Branch ist
  bis Task 8 erwartbar rot; im Commit-Body vermerken.

### Task 3: Material

**Files:** Modify `src/routes/einsatz_material.rs` (`disponieren`, `update` (Schleife), `aufteilen`,
`verknuepfen`, `loesen`, `entlassen`, `zuruecknehmen`, `stornieren`, `reaktivieren`);
Test `tests/einsatz_material.rs`.

- [ ] **Step 1:** Test `material_etb_eintraege_gehen_live_hinaus`: `EtbLive::neu`, dann jede der
  neun Handlungen nacheinander mit `etb.pruefe(&app, &admin, einsatz, "<Handlung>")`.
- [ ] **Step 2:** `cargo test --test einsatz_material material_etb` → FAIL (Wächter-Panic bzw.
  „ETB-Einträge gehen live hinaus“).
- [ ] **Step 3:** IDs aus den Closures herausgeben (`update`: `Vec<i64>` in der Closure),
  nach dem Commit verteilen.
- [ ] **Step 4:** `cargo test --test einsatz_material` → PASS.
- [ ] **Step 5:** Commit `fix(material): System-ETB-Einträge live verteilen (LLH-1976)`.

### Task 4: Einheiten

**Files:** Modify `src/routes/einsatz_einheit.rs` (`end_einheit` — Auflöse-Eintrag aus
`link_einheit_tx` zusätzlich zu den Geräte-IDs aus `notify_aufgeloest`; `personal_zuordnen`
(beide Zweige), `personal_freigeben`, `fahrzeug_zuordnen`, `fahrzeug_freigeben`, `status_setzen`);
Test `tests/einsatz_einheit.rs`.

- [ ] **Step 1:** Test `einheit_etb_eintraege_gehen_live_hinaus` mit `EtbLive` über alle sechs
  Handlungen, `end_einheit` zuletzt.
- [ ] **Step 2:** → FAIL. **Step 3:** umsetzen. **Step 4:** `cargo test --test einsatz_einheit` → PASS.
- [ ] **Step 5:** Commit `fix(einheit): System-ETB-Einträge live verteilen (LLH-1976)`.

### Task 5: Tier, Lage-Zone, Gefahr, Abschnitt, Bereitstellungsraum, Fahrzeug

**Files:** Modify `src/routes/einsatz_tier.rs` (`anlegen`, `status_wechsel`, `stornieren`),
`src/routes/lage_zone.rs` (`anlegen`, `aufloesen`), `src/routes/gefahr.rs` (`bewerten`),
`src/routes/einsatzabschnitt.rs` (`aufloesen`: Abschnitt + je widerrufenem Gerät),
`src/routes/einsatz_bereitstellungsraum.rs` (`status_wechsel`),
`src/routes/einsatz_fahrzeug.rs` (`status_zuruecknehmen`). Tests in den gleichnamigen Dateien
unter `tests/`.

- [ ] **Step 1:** je Datei ein Test `<modul>_etb_eintraege_gehen_live_hinaus` mit `EtbLive`
  (Abschnitt: mit einem gebundenen Gerät, damit die Schleife greift).
- [ ] **Step 2:** → FAIL. **Step 3:** umsetzen; Task-2-Test auf Mini-Route umstellen, falls er
  `gefahr::bewerten` nutzt. **Step 4:** die sechs Testdateien → PASS.
- [ ] **Step 5:** Commit `fix(einsatz): System-ETB-Einträge weiterer Module live verteilen (LLH-1976)`.

### Task 6: Person anlegen

**Files:** Modify `src/routes/einsatz_person.rs` (`anlegen`: Erfasst/Kontakt-Eintrag :925 und
Sichtungs-Eintrag :972 zusätzlich zu `uhs_etb_id`/`verbleib_etb_id`); Test `tests/einsatz_person.rs`.

- [ ] **Step 1:** Test `person_anlegen_etb_eintraege_gehen_live_hinaus`: Anlegen mit Sichtung und
  mit UHS-Zuordnung, je `etb.pruefe`.
- [ ] **Step 2–4:** FAIL → umsetzen → PASS. **Step 5:** Commit `fix(person): …`.

### Task 7: Aufbewahrung

**Files:** Modify `src/aufbewahrung/antrag.rs` (`stellen`, `zuruecknehmen` geben die ETB-ID
heraus), `src/routes/aufbewahrung.rs` (`antrag_stellen`, `antrag_zuruecknehmen` verteilen),
`src/routes/einsatz.rs` (Route zu `kategorie_frist_setzen`: zusätzlich zur Listenauffrischung
`publiziere` mit der ID); Tests `tests/aufbewahrung.rs`, `tests/aufbewahrung_kategorie.rs`.

- [ ] **Step 1:** Tests `antrag_etb_eintraege_gehen_live_hinaus`, `kategorie_frist_etb_geht_live_hinaus`.
- [ ] **Step 2–4:** FAIL → umsetzen → PASS. **Step 5:** Commit `fix(aufbewahrung): …`.

### Task 8: Löschlauf

**Files:** Modify `src/einsatz/repo.rs` (Wrapper `system_audit_tx` → `Result<i64, AppError>`),
`src/aufbewahrung/antrag.rs` (`vollziehen_ergebnis`, `vollziehe_faellige`: IDs heraus, verteilen),
`src/einsatz/aufbewahrung_kategorie.rs` (`vormerken`, `schwaerzen`: ID heraus),
`src/einsatz/archiv.rs` (`abgelaufene_bloecke_loeschen`: IDs heraus),
`src/einsatz/purge_scheduler.rs` (verteilen nach den Phasen); Test `tests/aufbewahrung_kategorie.rs`
bzw. `tests/einsatz_archiv.rs` (dort, wo es heute Tick-Tests der Phase gibt).

- [ ] **Step 1:** je Phase ein Test über `tick_einmal` + `live.abonniere`: die ETB-IDs der Phase
  kommen als `etb` an (`vollziehe_faellige`, `vormerken`, `kategorie::schwaerzen`,
  `abgelaufene_bloecke_loeschen`). Für Archivieren/`soft_delete`/`schwaerze_einsatz`: Test, dass
  der Tick **nicht** panict und **kein** `etb` mit deren ID kommt.
- [ ] **Step 2–4:** FAIL → umsetzen → PASS. **Step 5:** Commit `fix(aufbewahrung): Löschlauf verteilt ETB-Einträge (LLH-1976)`.

### Task 9: Restliche Lücken aus der Lückenliste

**Files:** je Treffer aus dem Ledger (erwartet u. a. `src/routes/einsatzakte.rs`,
`src/routes/infotelefon.rs`, Archiv-Pfade `loeschersuchen::ablegen`, `archiv/einspielen`,
`abraeumen`).

- [ ] **Step 1:** `cargo test` voll → jede verbleibende Wächter-Panic.
- [ ] **Step 2:** je Treffer: Route → verteilen + Test mit `EtbLive` in der Testdatei des Moduls;
  Archiv-Pfad → lesbar bleibender Einsatz verteilt, sonst `ohne_verteilung("Einsatz verlässt den
  Betrieb; kopf_melden meldet es", …)`. Neue Ausnahme jenseits der Liste in „Global Constraints“
  → anhalten und dem Menschen vorlegen.
- [ ] **Step 3:** `cargo test` voll → grün.
- [ ] **Step 4:** Commit(s) `fix(…): …` je Modul.

### Task 10: Regel, Mutationsprobe, Gate

**Files:** Modify `src/AGENTS.md` (neuer Abschnitt „Backend — ETB live verteilen (LLH-1976)“ mit
den drei Regelpunkten aus dem Entwurf, Abschnitt „Regel“), Wurzel-`AGENTS.md`-Tabelle: `src/AGENTS.md`-
Zeile um „ETB live verteilen“ ergänzen.

- [ ] **Step 1:** Abschnitt schreiben; Code-Kommentare in `nachlauf.rs` verweisen darauf.
- [ ] **Step 2: Mutationsprobe:** in `einsatz_material::stornieren` den `publiziere`-Aufruf
  entfernen → ein **bestehender** Test in `tests/einsatz_material.rs`, der `stornieren` ruft, aber
  nicht `EtbLive` nutzt, wird rot (Wächter-Panic). Ergebnis notieren, Mutation zurücknehmen.
- [ ] **Step 3:** `./scripts/check-all.sh --geaendert --ohne-e2e` → grün.
- [ ] **Step 4:** Commit `docs(agents): Regel ETB live verteilen (LLH-1976)`.

## Ledger

Lückenliste aus Task 2, Step 4 (Test → Stelle → erledigt in Task):

- (wird beim Lauf gefüllt)
