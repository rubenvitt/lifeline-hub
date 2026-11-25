# Ausgang per Matrix (LLH-2094) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Zunder: https://zunder.rubeen.dev/#/aufgabe/ntaizaveziu8k9qzqu9tencu

**Goal:** Matrix-Räume als zweiter Kanal des Ausgangskorbs, mit E2EE über matrix-sdk, Anbindung
„Matrix“ (Homeserver + Access-Token) und kanalneutralem Zusteller.

**Architecture:** Der Zusteller des Ausgangskorbs wird kanalneutral (`Versandauftrag` →
`Zustellfehler`); SMTP und Matrix sind zwei Umsetzungen. `adapter::matrix` kapselt matrix-sdk:
ein Client je Anbindung hinter einer Mutex, Speicherverzeichnis je Anbindung, unser reqwest mit
Zielschutz. Gesendete Teile stehen in `ausgang_teil`, damit nichts doppelt im Raum landet.

**Tech Stack:** Rust (axum, sqlx/SQLite, tokio), matrix-sdk 0.20 (gepatchtes
`matrix-sdk-sqlite` auf rusqlite 0.42), React/TypeScript (Mantine, TanStack Query, MSW).

**Spec:** `docs/superpowers/specs/2026-11-25-ntaizave-ausgang-matrix-design.md`
(baut auf `docs/superpowers/specs/2026-11-24-w1ymakq6-ausgang-email-design.md`).

## Global Constraints

- `matrix-sdk = "=0.20.0"`, `default-features = false`, Features `e2e-encryption`, `sqlite`,
  `rustls-aws-lc-rs`, `markdown`; im Dev-Baum zusätzlich `testing`.
- Genau ein `libsqlite3-sys` (0.40) im Lockfile; kein `ring` im Normalbaum; ein rustls-Provider.
- `vendor/matrix-sdk-sqlite/` = unveränderte Kopie von 0.20.0, einzige Änderung `rusqlite = "0.42"`,
  eingebunden über `[patch.crates-io]`, mit `PATCH.md`.
- Wiederholung unverändert: `30 s · 2^(n−1)`, Deckel 5 min, Fenster 30 min.
- Nie `m.room.message` in einen verschlüsselten Raum; Abbruch beim Verschlüsseln → `verschluesselung`.
- Transaktions-ID je Teil: `ausgang-{versand_id}-{teil}` (Text = 0, Anlage n = n).
- Speicherverzeichnis `<Verzeichnis der Datenbank>/matrix/<adapter_id>/`, nie in der Sicherung.
- Zeitlimits Matrix-HTTP: Verbindung 5 s, Anfrage 30 s, Upload 120 s; keine Weiterleitungen.
- Neue Wire-Werte: `AusgangFehler::KeinZutritt => "kein_zutritt"`,
  `AusgangFehler::Verschluesselung => "verschluesselung"`,
  `AdapterFehler::SchluesselPassenNicht => "schluessel_passen_nicht"`. `smtp_status` bleibt.
- Routen englisch (ADR-0097), Wire-Felder englisch, Prosa deutsch; Typ-Codegen nach jeder
  DTO-/Enum-Änderung (`scripts/check-typ-codegen.sh`).
- Vor dem PR `./scripts/check-all.sh --geaendert --ohne-e2e`.

## Review Focus

1. **Token gewechselt, alter Speicher liegt noch da** → alter Speicher wird gelöscht, nie mit
   dem neuen Gerät geöffnet (Task 5, Test `neues_token_loescht_speicherverzeichnis`).
2. **Text gesendet, Anlage 2 scheitert, „Erneut senden“ am nächsten Tag** → nur Anlage 2 geht
   hinaus (Task 7, Test `erneut_senden_ueberspringt_gemerkte_teile`).
3. **Alias zeigt auf einen Raum, in den der Bot nicht eingeladen ist** → `kein_zutritt`, ETB-Eintrag,
   keine Wiederholung (Task 7, Test `ohne_einladung_kein_zutritt_endgueltig`).
4. **Zwei Versände an dieselbe Anbindung gleichzeitig plus Prüflauf** → laufen nacheinander auf
   einem Client (Task 4, Test `zugriffe_auf_eine_anbindung_laufen_nacheinander`).
5. **Homeserver liefert 429 mit `retry_after_ms` über dem Backoff** → nächster Versuch nicht vor
   `retry_after_ms` (Task 7, Test `rate_limit_respektiert_retry_after`).

---

### Task 1: Abhängigkeit, Patch und Machbarkeit der E2EE-Tests (Spike)

**Files:**
- Create: `vendor/matrix-sdk-sqlite/` (Kopie aus `~/.cargo/registry/src/*/matrix-sdk-sqlite-0.20.0`, ohne `Cargo.lock`), `vendor/matrix-sdk-sqlite/PATCH.md`
- Modify: `Cargo.toml` (Abhängigkeit mit Kommentar, `[patch.crates-io]`, Dev-Feature `testing`), `Cargo.lock`
- Modify: `tests/sqlite_version.rs` (oder neuer `tests/sqlite_einmal.rs`)
- Create: `tests/matrix_spike.rs` (nur während des Spikes, wird in Task 7 zum echten Test)

**Interfaces:** Produces: `matrix_sdk` im Baum; Befund des Spikes als Kommentar an der Aufgabe.

- [ ] **Step 1: Test** `lockfile_hat_genau_ein_libsqlite3_sys`: liest `Cargo.lock`, zählt Blöcke
  `name = "libsqlite3-sys"`, `assert_eq!(anzahl, 1)`.
- [ ] **Step 2:** Abhängigkeit und Patch eintragen; `cargo tree -i libsqlite3-sys` zeigt nur 0.40,
  `cargo tree -e normal -i ring` meldet „nothing to print“.
- [ ] **Step 3:** `cargo test --test sqlite_version` (bzw. neuer Test) und
  `cargo test tls::tests::rcgen_pem_ist_per_rustls_ladbar` grün.
- [ ] **Step 4:** Lizenzen/Advisories nach `scripts/AGENTS.md` (`scripts/check-all.sh --nur
  <Advisory-Schritt>`) grün; neue Lizenzen ggf. in die Erlaubnisliste mit Begründung.
- [ ] **Step 5: Spike** in `tests/matrix_spike.rs`: mit `MatrixMockServer` einen eingeloggten
  Client (Speicher in `tempdir`) bauen, einen verschlüsselten Raum per Sync anlegen
  (`m.room.encryption`, ein Mitglied mit Gerät), `keys/query` und `keys/claim` mocken, `room.send`
  aufrufen und prüfen, dass der Mock `PUT …/send/m.room.encrypted/{txn}` empfängt. Ergebnis
  (geht / geht nicht, Aufwand) als `add_comment` an LLH-2094. Geht es nicht: Fallback aus der
  Spec (Test „nie `m.room.message` in verschlüsselten Raum“) gilt für Task 7.
- [ ] **Step 6: Commit** `build(matrix): matrix-sdk 0.20 mit gepatchtem matrix-sdk-sqlite (LLH-2094)`.

### Task 2: Kanalneutraler Zusteller (refactor)

**Files:**
- Modify: `src/ausgang/zusteller.rs`, `src/ausgang/lauf.rs`, `src/ausgang/tests.rs`, `tests/ausgang_lauf.rs`, `src/main.rs` (Bau des Zustellers)

**Interfaces:**
- Produces (in `src/ausgang/zusteller.rs`):
  ```rust
  pub struct Versandauftrag<'a> {
      pub versand_id: &'a str, pub kanal: KanalArt, pub zugang: &'a Versandzugang,
      pub adresse: &'a str, pub betreff: &'a str, pub inhalt: &'a str,
      pub anhaenge: &'a [Anhang],          // bestehender Anhangstyp aus nachricht.rs
      pub gesendet: &'a [i64],             // schon gemerkte Teile (Task 6), bei SMTP leer
  }
  pub enum Zustellfehler {
      Voruebergehend { nicht_vor: Option<DateTime<Utc>> }, Abgelehnt, Ungewiss,
      Anbindung { pruefung_vorziehen: bool }, KeinZutritt, Verschluesselung, ZuGross,
  }
  pub struct Zustellt { pub teile: Vec<(i64, String)> }   // (teil, event_id); SMTP: leer
  pub struct Fehlschlag { pub fehler: Zustellfehler, pub grund: String, pub smtp_status: Option<u16>,
                          pub teile: Vec<(i64, String)> } // bis zum Fehler gesendete Teile
  pub trait Zusteller: Send + Sync {
      fn zustellen<'a>(&'a self, auftrag: &'a Versandauftrag<'a>) -> BoxFuture<'a, Result<Zustellt, Fehlschlag>>;
  }
  ```
  `grund` ist der fertige deutsche ETB-Grund (heute `lauf::grund`), so bleibt die Zuordnung je
  Kanal beim Kanal. `nach_fehler` im Lauf ordnet `Zustellfehler` → `AusgangFehler` an einer Stelle.
- `SmtpZusteller` baut die Mail (heute in `run_one`) selbst; `AufzeichnenderZusteller` zeichnet
  `(kanal, adresse, bytes_oder_teile)` auf.

- [ ] **Step 1:** Bestehende Tests auf die neue Signatur umstellen (keine neuen Fälle);
  `cargo test --test ausgang_lauf --test ausgang_routen` kompiliert nicht.
- [ ] **Step 2:** Umbau; SMTP-Verhalten bleibt bitgleich (Fehlerzuordnung, ETB-Texte, Vorziehen
  der Prüfung bei Anmeldung/TLS).
- [ ] **Step 3:** `cargo test --test ausgang_lauf --test ausgang_routen --test adapter_smtp` und
  `cargo test --lib ausgang` grün.
- [ ] **Step 4: Commit** `refactor(ausgang): Zusteller kanalneutral (LLH-2094)`; danach
  `add_comment` an LLH-2095: neue Schnittstelle, Commit-Hash, Branch.

### Task 3: Kanal `matrix` an der Externen Stelle

**Files:**
- Modify: `src/externe_stelle/mod.rs` (`is_freigeschaltet`), `src/externe_stelle/kanal.rs`, `src/routes/externe_stelle.rs`, `tests/externe_stelle_kanal.rs`, `src/externe_stelle/tests.rs`

**Interfaces:**
- Produces: `pub fn normalize_matrix(roh: &str) -> Result<String, String>` (ruma
  `OwnedRoomOrAliasId`, ≤ 255 Bytes); `pub async fn list_fuer_org(pool, org_id, kanaele: &[KanalArt])
  -> Result<Vec<(ExterneStelle, ExterneStelleKanal)>, AppError>` ersetzt `list_email_fuer_org`.
  `GET /api/external-agencies/channels` ohne `channel` liefert alle freigeschalteten Kanäle;
  mit `channel` nur diesen.

- [ ] **Step 1: Tests** in `src/externe_stelle/tests.rs`:
  `matrix_raum_id_und_alias_werden_angenommen` (`"!abc:example.org"`, `" #lage:example.org "` →
  getrimmt), `matrix_nutzer_id_wird_mit_eigenem_text_abgelehnt` (`"@a:example.org"` → Text enthält
  „Nutzer-IDs“), `matrix_adresse_ueber_255_bytes_abgelehnt`, `matrix_ist_freigeschaltet`
  (Fax/Threema weiter nicht). In `tests/externe_stelle_kanal.rs`:
  `post_matrix_kanal_legt_an_und_sammlung_liefert_beide_kanaele`.
- [ ] **Step 2:** Tests rot. **Step 3:** umsetzen. **Step 4:** grün.
- [ ] **Step 5: Commit** `feat(externe-stelle): Matrix-Räume als Kanaladresse (LLH-2094)`.

### Task 4: Adapter-Art `matrix` mit Client und Verbindungsprüfung

**Files:**
- Create: `src/adapter/matrix.rs` (Client-Verwaltung, HTTP-Client, Speicher, `pruefe`), `src/adapter/matrix_art.rs` (Art)
- Modify: `src/adapter/mod.rs`, `src/adapter/art.rs` (`Verzeichnis::produktiv`), `src/adapter/zustand.rs` (`SchluesselPassenNicht`), `src/adapter/ziel.rs` (Client-Bau für Matrix wiederverwendbar), `src/adapter/repo.rs` (`load_fuer_org(pool, org_id, art_code)`, ersetzt `load_smtp_fuer_org`), `src/routes/adapter.rs` (eine je Org gilt auch für `matrix`; `speicher_passphrase` beim Anlegen erzeugen), `src/config.rs` (Pfad des Speicherverzeichnisses), `tests/enum_wire_kontrakt.rs`
- Test: `tests/adapter_matrix.rs`

**Interfaces:**
- Produces (`src/adapter/matrix.rs`):
  ```rust
  pub const CODE: &str = "matrix";            // in matrix_art.rs
  pub struct MatrixZiel { pub homeserver: Url, pub access_token: SecretString,
                          pub passphrase: SecretString, pub lan_erlaubt: bool,
                          pub adapter_id: String }
  pub struct Clients { /* HashMap<adapter_id, Arc<tokio::sync::Mutex<Eintrag>>> */ }
  impl Clients {
      pub fn new(basis: PathBuf) -> Self;
      pub async fn mit_client<T>(&self, ziel: &MatrixZiel,
          f: impl for<'c> FnOnce(&'c matrix_sdk::Client) -> BoxFuture<'c, T>) -> Result<T, MatrixFehler>;
      pub async fn verwerfen(&self, adapter_id: &str);   // Client weg + Verzeichnis löschen
  }
  pub enum MatrixFehler { Token, Netz, Zeit, Dns, ZielIntern, RateLimit(Option<Duration>),
                          Verboten, NichtGefunden, ZuGross, Verschluesselung, SchluesselPassenNicht,
                          Antwort }
  pub async fn pruefe(clients: &Clients, ziel: &MatrixZiel) -> Result<Pruefbefund, MatrixFehler>;
  pub struct Pruefbefund { pub user_id: String, pub device_id: String,
                           pub cross_signing: bool, pub upload_max: Option<u64> }
  ```
  `impl From<MatrixFehler> for AdapterFehler` (Token → `Abgelehnt`, `SchluesselPassenNicht` →
  neuer Code, Netz/Zeit/Dns/ZielIntern wie SMTP, Rest → `AntwortUngueltig`).
- Art: Felder `homeserver` (URL, Pflicht), `anzeigename` (Text, optional, ≤ 100); Plätze
  `access_token` (Pflicht), `speicher_passphrase` (intern, nicht im Formular; erzeugt beim
  Anlegen, 32 Zufallsbytes base64). Intervall min 900 s, Vorschlag 3600 s. `abrufen` = `pruefe`,
  `OhneUebernahme(0)`.

- [ ] **Step 1: Tests** in `tests/adapter_matrix.rs` (MatrixMockServer):
  `pruefung_mit_gueltigem_token_meldet_ok_und_geraet` (`whoami` → device `BOT1`, Zustand `ok`),
  `ungueltiges_token_ist_abgelehnt` (401 `M_UNKNOWN_TOKEN` → `AdapterFehler::Abgelehnt`),
  `speicher_eines_anderen_geraets_meldet_schluessel_passen_nicht` (Verzeichnis mit `BOT1` angelegt,
  dann `whoami` → `BOT2`), `zweite_matrix_anbindung_je_org_ist_422`,
  `homeserver_im_gesperrten_netz_wird_abgelehnt` (`https://127.0.0.1` ohne LAN → 400),
  `zugriffe_auf_eine_anbindung_laufen_nacheinander` (zwei `mit_client` gleichzeitig, die zweite
  beginnt erst nach Ende der ersten), `anlegen_erzeugt_speicher_passphrase_und_zeigt_sie_nie`
  (GET der Anbindung nennt `speicher_passphrase` nicht als gesetzten Platz im Formular).
  In `tests/enum_wire_kontrakt.rs`: `schluessel_passen_nicht`.
- [ ] **Step 2:** rot. **Step 3:** umsetzen; HTTP-Client aus `adapter::ziel` (filternder Resolver,
  `redirect(Policy::none())`, Limits aus den Global Constraints) an `ClientBuilder::http_client`;
  `homeserver_url` direkt; `sqlite_store(verzeichnis, Some(passphrase))`; Anmeldung über
  `restore_session` mit `whoami`-Ergebnis; Cross-Signing per `encryption().bootstrap_cross_signing_if_needed(None)`,
  Fehler dort nur als `cross_signing: false`. **Step 4:** grün.
- [ ] **Step 5:** Typ-Codegen, beide Dateien mitcommitten.
- [ ] **Step 6: Commit** `feat(adapter): Anbindung Matrix mit Verbindungsprüfung (LLH-2094)`.

### Task 5: Lebenszyklus des Speicherverzeichnisses

**Files:** Modify: `src/routes/adapter.rs`, `src/adapter/matrix.rs`; Test: `tests/adapter_matrix.rs`

**Interfaces:** Consumes `Clients::verwerfen` (Task 4).

- [ ] **Step 1: Tests** `neues_token_loescht_speicherverzeichnis`,
  `geaenderter_homeserver_loescht_speicherverzeichnis_und_token`,
  `geloeschte_anbindung_loescht_speicherverzeichnis`, `restore_ohne_verzeichnis_meldet_schluessel_passen_nicht`
  (Server kennt Schlüssel für `BOT1`, Verzeichnis fehlt).
- [ ] **Step 2:** rot. **Step 3:** In den Schreibwegen der Anbindung nach dem Commit
  `verwerfen` aufrufen, wenn Platz `access_token` neu gesetzt, `has_neues_ziel` oder gelöscht.
  Ein fehlendes Verzeichnis bei bekanntem Gerät erkennt `pruefe` an hochgeladenen Geräteschlüsseln
  (`keys/query` für das eigene Gerät liefert Schlüssel, der lokale Speicher keine). **Step 4:** grün.
- [ ] **Step 5: Commit** `feat(adapter): Matrix-Speicher folgt Token und Homeserver (LLH-2094)`.

### Task 6: Gesendete Teile merken (`ausgang_teil`) und Zugang je Kanal

**Files:**
- Create: `migrations/0384_ausgang_teil.sql` (Nummer nach `migrations/AGENTS.md`)
- Modify: `src/ausgang/repo.rs`, `src/ausgang/lauf.rs`, `src/adapter/lauf.rs` (`zugang_fuer_versand(pool, rahmen, org_id, kanal: KanalArt)`, `pruefe_versand_moeglich(…, kanal)`), `src/routes/ausgang.rs` (Prüfung je Kanal der Empfänger, Meldung je Kanal), `src/instanz/spiegel/art.rs` (`AUSGENOMMEN`), `src/einsatz/schwaerzung_registry.rs` (event_id ist kein Inhalt, prüfen ob Eintrag nötig), Aufbewahrung nach bestehendem Muster
- Test: `tests/ausgang_lauf.rs`, `tests/ausgang_routen.rs`

**Interfaces:**
- Tabelle `ausgang_teil(versand_id TEXT NOT NULL REFERENCES ausgang(id) ON DELETE CASCADE,
  teil INTEGER NOT NULL, event_id TEXT NOT NULL, gesendet_at TEXT NOT NULL,
  PRIMARY KEY (versand_id, teil))`.
- Produces: `repo::list_teile(pool, versand_id) -> Result<Vec<i64>, AppError>`;
  `abschliessen` schreibt `Zustellt.teile`/`Fehlschlag.teile` in derselben Transaktion.
- Meldungen bei 422: `email` → wie heute; `matrix` → „Kein Matrix-Konto eingerichtet“ /
  „Das Matrix-Konto ist angehalten“ / „Das Matrix-Konto ist nicht nutzbar; Einstellungen prüfen“.

- [ ] **Step 1: Tests** `matrix_versand_ohne_matrix_anbindung_ist_422_anbindung_fehlt`
  (SMTP vorhanden, Matrix nicht), `gemischte_empfaenger_brauchen_beide_anbindungen`,
  `teile_werden_mit_dem_ergebnis_gespeichert` (Doppel meldet Teile 0 und 1),
  `spiegel_registry_kennt_ausgang_teil`.
- [ ] **Step 2:** rot. **Step 3:** umsetzen. **Step 4:** grün, plus
  `scripts/check-all.sh --nur schnell` (Migrationsnummern, Spiegel-/Schwärzungs-Wächter).
- [ ] **Step 5: Commit** `feat(ausgang): gesendete Teile merken, Zugang je Kanal (LLH-2094)`.

### Task 7: Matrix-Zusteller

**Files:**
- Create: `src/ausgang/zusteller/matrix.rs` (oder `src/ausgang/matrix_zusteller.rs`)
- Modify: `src/ausgang/zustand.rs` (`KeinZutritt`, `Verschluesselung`), `src/ausgang/lauf.rs` (Zuordnung, `nicht_vor` beachten), `src/main.rs` (Kanal-Weiche: Zusteller je Kanal), `tests/enum_wire_kontrakt.rs`
- Test: `tests/ausgang_matrix.rs` (MatrixMockServer), `tests/ausgang_lauf.rs`

**Interfaces:**
- Consumes: `Versandauftrag`, `Zustellfehler` (Task 2), `Clients::mit_client` (Task 4), `gesendet` (Task 6).
- Ablauf genau wie Spec §6 (auflösen → beitreten → `sync_once` gefiltert auf den Raum →
  Text per `RoomMessageEventContent::text_markdown(format!("**{betreff}**\n\n{inhalt}"))` mit
  `with_transaction_id("ausgang-{id}-0")` → je Anlage `send_attachment` mit Txn
  `ausgang-{id}-{n}`); bereits in `gesendet` enthaltene Teile auslassen. Strategie zum Teilen der
  Raumschlüssel ausdrücklich „alle Geräte“ (`CollectStrategy::AllDevices` bzw. Name in 0.20) im
  `EncryptionSettings` des Clients.
- Zuordnung: Netz/Zeit/Dns/5xx → `Voruebergehend { nicht_vor: None }`; 429 →
  `Voruebergehend { nicht_vor: Some(jetzt + retry_after) }`; Token → `Anbindung { pruefung_vorziehen: true }`;
  403/404 beim Beitreten oder Senden → `KeinZutritt`; `M_TOO_LARGE` → `ZuGross`; jeder Krypto-Fehler
  → `Verschluesselung`. Ein Abbruch mitten im Senden ist **nie** `Ungewiss`.
- Text = Betreff fett, Inhalt, dann derselbe Fuß wie die Mail (Fußbau aus `nachricht.rs` als
  gemeinsame Funktion herausziehen). Eine Anlage über `Pruefbefund.upload_max` (an der Anbindung
  gemerkt) → `ZuGross` vor dem Senden des Texts.

- [ ] **Step 1: Tests** in `tests/ausgang_matrix.rs`:
  `alias_wird_aufgeloest_und_text_mit_txn_0_gesendet`,
  `anlagen_gehen_als_m_image_mit_eigenen_txn`,
  `ohne_einladung_kein_zutritt_endgueltig`,
  `rate_limit_respektiert_retry_after` (`retry_after_ms: 600000` → `naechster_versuch_at` ≥ jetzt + 10 min),
  `abbruch_beim_senden_ist_voruebergehend_nicht_ungewiss`,
  `erneut_senden_ueberspringt_gemerkte_teile` (Teil 0 gemerkt → nur `send/…/ausgang-{id}-1`),
  `in_verschluesselten_raum_geht_nie_klartext` (Mock sieht nur `m.room.encrypted` oder Versand
  scheitert mit `verschluesselung`; Form nach dem Befund aus Task 1).
  In `tests/enum_wire_kontrakt.rs`: `kein_zutritt`, `verschluesselung`.
- [ ] **Step 2:** rot. **Step 3:** umsetzen. **Step 4:** grün; `tests/matrix_spike.rs` entfernen oder
  in `tests/ausgang_matrix.rs` aufgehen lassen.
- [ ] **Step 5:** Typ-Codegen, beide Dateien mitcommitten.
- [ ] **Step 6: Commit** `feat(ausgang): Zustellung in Matrix-Räume mit E2EE (LLH-2094)`.

### Task 8: Oberfläche

**Files:**
- Modify: `frontend/src/api/externeStellen.ts` (Kanaltyp `'email' | 'matrix'`, Sammlung ohne Filter), `frontend/src/stammdaten/ExterneStelleKanaele.tsx` (+ Test), `frontend/src/stammdaten/ExterneStellenTab.tsx` (+ Test: „2 Mail, 1 Matrix“), `frontend/src/ausgang/SendenDialog.tsx` (+ Test), `frontend/src/ausgang/empfaengerVorschlag.ts` (+ Test), `frontend/src/ausgang/Versandliste.tsx` (+ Test), `frontend/src/api/ausgang.ts`, `frontend/src/pages/einstellungen/AdapterAnsicht.tsx` bzw. `adapterAnzeige.ts` (Hinweis Verifizierung, `device_id` aus dem Prüfbefund, falls der Rahmen ihn ausliefert; sonst nur Hinweistext)

**Interfaces:**
- `ausgangFehlerText(code, kanal: 'email' | 'matrix')`: kanalabhängig für `voruebergehend`
  („Matrix-Server vorübergehend nicht erreichbar“), `abgelehnt`, `anbindung_*` (Matrix-Wortlaut aus
  Task 6), neu `kein_zutritt` „Kein Zutritt zum Raum“, `verschluesselung` „Verschlüsseln nicht möglich“.
- `empfaengerVorschlag`: je vorbelegter Stelle genau eine Adresse, Matrix vor Mail.

- [ ] **Step 1: Tests (vitest)**: `bietet_bei_neuer_adresse_email_und_matrix_raum_an`,
  `sammlung_zeigt_kanal_zeichen_je_adresse`, `vorschlag_nimmt_je_stelle_eine_adresse_matrix_vor_mail`,
  `sperrt_nur_matrix_adressen_wenn_kein_matrix_konto` (422 `anbindung_fehlt` für Matrix),
  `versandliste_zeigt_raum_und_kanal`, `fehlertext_haengt_vom_kanal_ab`.
- [ ] **Step 2:** rot (`mise exec -- pnpm --dir frontend vitest run <dateien>`). **Step 3:** umsetzen.
  **Step 4:** grün; `./scripts/check-all.sh --nur frontend`.
- [ ] **Step 5: Commit** `feat(ausgang): Matrix im Senden-Dialog und an der Stelle (LLH-2094)`.

### Task 9: e2e, Regeln, Doku, Bilder

**Files:**
- Modify: `frontend/e2e/ausgang.spec.ts` (Matrix-Raum eintragen, senden, „übergeben“ mit Testdoppel)
- Modify: `docs/architektur/entscheidungen/ADR-0103-…md` (Nachtrag; prüfen gegen `docs/architektur/AGENTS.md`, ob neue ADR nötig), `src/AGENTS.md` („Ausgang an Menschen“, „Adapter“), `docs/architektur/05-bausteinsicht.md`, `06-laufzeitsicht.md`, `07-verteilungssicht.md`, `docs/betrieb/…` (Datenverzeichnis `matrix/`, Restore → neues Token), `docs/anwender/kapitel/anbindungen.md`, `stammdaten.md`, `lageberichte.md` (Senden), Bilder nach `docs/anwender/AGENTS.md`
- Create: `pr-bilder/ntaizave/*.png` (verify-Skill)

- [ ] **Step 1:** e2e-Fall schreiben, rot; Testdoppel nimmt Matrix an; grün
  (`mise exec -- pnpm --dir frontend playwright test e2e/ausgang.spec.ts --trace off`).
- [ ] **Step 2:** Regeln und Doku nachziehen; Wächter grün (`./scripts/check-all.sh --nur schnell`).
- [ ] **Step 3:** Bilder der Änderung mit dem verify-Skill (Stelle mit Matrix-Raum, Anbindung
  Matrix, Senden-Dialog gemischt, Versandliste).
- [ ] **Step 4:** `./scripts/check-all.sh --geaendert --ohne-e2e` grün.
- [ ] **Step 5: Commit** `docs(ausgang): Matrix in Regeln, Architektur und Anwenderdoku (LLH-2094)`.
- [ ] **Step 6:** Handprobe gegen einen echten Synapse mit Element als Empfänger (wenn in der
  Umgebung möglich; sonst im PR als offen benennen).
