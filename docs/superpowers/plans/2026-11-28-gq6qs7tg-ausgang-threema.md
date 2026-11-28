# Ausgang per Threema Gateway – Umsetzungsplan (LLH-2096)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Zunder: https://zunder.rubeen.dev/#/aufgabe/gq6qs7tgguzqhfg3za8nfigo

**Goal:** Threema-IDs als Kanal des Ausgangskorbs: Adresse an der Externen Stelle, Anbindung „Threema Gateway“ (E2E), Zustellung über einen eigenen Zusteller, Senden-Dialog und Doku.

**Architecture:** Ein schlanker Client `adapter::threema` (vier Aufrufe, Zielschutz wie sipgate) mit
eigenem Krypto-Teil (`crypto_box`, `crypto_secretbox`), eine Adapter-Art `threema`, ein
`ThreemaZusteller` in der bestehenden `Zustellerwahl`. Empfängerschlüssel werden in einer neuen
Org-Tabelle gemerkt; der Lauf liest und schreibt sie, der Zusteller hält keine DB-Verbindung.

**Tech Stack:** Rust (axum, sqlx/SQLite, reqwest 0.13), `crypto_box`, `crypto_secretbox`, `zeroize`; React/AntD-Frontend, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-28-gq6qs7tg-ausgang-threema-design.md` (freigegeben 28.11.2026)

## Global Constraints

- Nur E2E-Modus, nie Basis-Modus, nie Klartext an Threema, auch nicht als Rückfall.
- Fester Host `https://msgapi.threema.ch`, `ausgehend::client_builder(Zweck::Adapter)` mit dem Resolver des Zielschutzes, keine Weiterleitung; Zeitlimits Abfrage 20 s, Senden 30 s, Upload 120 s; Antworten ≤ 64 KiB.
- Nie Secret, privater Schlüssel, Inhalt, URL mit Query oder Antworttext von Threema in Log, Fehler, Antwort, ETB, Admin-Spur.
- Text ≤ 3500 Bytes je Nachricht; Padding PKCS#7 zufällig 1–255, Nutzlast+Padding ≥ 32 Bytes; Nonce 24 Bytes zufällig je Nachricht; Dateiblob mit `crypto_secretbox`, Zufallsschlüssel 32 Bytes, feste Nonce `0x00…01`.
- Ein gemerkter Empfängerschlüssel wird nie überschrieben; Abweichung → `verschluesselung`, ETB-Grund „Der Schlüssel der Threema-ID hat sich geändert“, nichts gesendet.
- Abbruch nach dem Absenden von `send_e2e` → `Ungewiss`, nie selbst wiederholt.
- Höchstens eine Threema-Anbindung je Org; Intervall Minimum 900 s, Vorschlag 3600 s.
- Bezeichner: Fachbegriffe deutsch, Technik englisch (`AGENTS.md`, LFH-1312); Prosa deutsch; neue Wire-Felder englisch.
- Typ-Codegen nach jeder DTO-/Enum-Änderung: `scripts/check-typ-codegen.sh`, beide generierten Dateien mitcommitten (`src/AGENTS.md`).
- Node/pnpm nur über `mise exec -- …`.

## Review Focus

1. **Threema-ID mit Kleinbuchstaben oder Leerzeichen eingetippt** (`echo echo`): wird zu `ECHOECHO`, nicht abgelehnt → Test in Task 1.
2. **Langer Lagebericht über 3500 Bytes mit Umlauten an der Grenze**: Teile nie mitten in einem UTF-8-Zeichen, jeder Teil inkl. „(i/k)“ ≤ 3500 Bytes, Fuß im letzten → Test in Task 5.
3. **Zweiter Versuch nach teilweisem Erfolg** (Text gesendet, Bild-Upload 5xx): der nächste Versuch sendet nur das Bild → Test in Task 5.
4. **Privater Schlüssel mit Präfix `private:`, Großbuchstaben oder Zeilenumbruch eingefügt**: wird angenommen und normalisiert; 63 Zeichen oder Nicht-Hex → 400/422 mit Text → Test in Task 3.
5. **Matrix und Threema beide ohne Anbindung in einem Versand**: eine einzige Ablehnung, beide Kanäle im Dialog gesperrt, Mail-Rückfall je Stelle → Tests in Task 7 und Task 8.

---

### Task 1: Kanal `threema` freischalten und Adresse prüfen

**Files:**
- Modify: `src/externe_stelle/mod.rs` (`is_freigeschaltet`, `adapter_art`)
- Modify: `src/externe_stelle/kanal.rs` (neu `normalize_threema`, Aufruf dort, wo `normalize_matrix` je Kanal gewählt wird)
- Modify: `src/externe_stelle/tests.rs` (Test `email_fax_und_matrix_sind_freigeschaltet_threema_nicht` umbenennen und umdrehen)
- Modify: `src/routes/ausgang.rs:329` (Kommentar „Threema nimmt noch kein Versand an“ fällt; der Check bleibt allgemein)

**Interfaces:**
- Produces: `pub fn normalize_threema(roh: &str) -> Result<String, String>`; `KanalArt::Threema.adapter_art() == Some(crate::adapter::threema_art::CODE)` (Konstante entsteht in Task 3; bis dahin `Some("threema")` und in Task 3 auf die Konstante umstellen).

- [ ] **Step 1: Tests schreiben** in `src/externe_stelle/tests.rs`:
  - `alle_vier_kanaele_sind_freigeschaltet`: `is_freigeschaltet()` ist `true` für alle vier.
  - `threema_id_wird_normalisiert`: `"echoecho"→"ECHOECHO"`, `" ECHO ECHO "→"ECHOECHO"`, `"*ABCDEF1"→"*ABCDEF1"`.
  - `threema_id_wird_abgelehnt`: `""`, `"ECHOECH"` (7), `"ECHOECHO1"` (9), `"ECHO-ECH"`, `"ECHÖECHO"`, `"AB*CDEFG"` → `Err`, Text enthält „acht Zeichen“.
- [ ] **Step 2: Laufen lassen, rot:** `cargo test --lib externe_stelle::tests` → FAIL (Funktion fehlt, Threema nicht freigeschaltet).
- [ ] **Step 3: Umsetzen:** `normalize_threema` (alle Leerraumzeichen entfernen, `to_ascii_uppercase`, genau 8 Zeichen `[A-Z0-9]`, erstes darf `*` sein; Fehler „Eine Threema-ID hat acht Zeichen (Buchstaben und Ziffern)“, leer: „Threema-ID darf nicht leer sein“). `is_freigeschaltet` → `true` für alle; Doc-Kommentare der Enum nachziehen.
- [ ] **Step 4: Grün:** `cargo test --lib externe_stelle` → PASS; Routen-Tests in `tests/` mit `threema`-Ablehnung (grep `noch nicht unterstützt`) anpassen.
- [ ] **Step 5: Commit** `feat(externe-stelle): Threema-ID als Kanaladresse (LLH-2096)`.

### Task 2: Krypto (`adapter::threema::krypto`) und Abhängigkeiten

**Files:**
- Modify: `Cargo.toml` (`crypto_box = "0.9"` mit Feature `salsa20`, `crypto_secretbox = "0.1"`, `zeroize` falls nicht direkt da; je ein Kommentar wozu)
- Create: `src/adapter/threema/krypto.rs`
- Create: `src/adapter/threema.rs` (vorerst nur `pub mod krypto;`), `src/adapter/mod.rs` (`pub mod threema;`)

**Interfaces:**
- Produces:
  - `pub struct PrivaterSchluessel` (32 Bytes, `Zeroize` beim Drop), `pub fn parse_privater_schluessel(s: &str) -> Result<PrivaterSchluessel, &'static str>` (trimmt, optionales Präfix `private:`, 64 Hex, Groß/Klein egal) und `pub fn normalize_privater_schluessel(s: &str) -> Result<String, &'static str>` (64 Hex klein).
  - `pub fn oeffentlicher_schluessel(p: &PrivaterSchluessel) -> [u8; 32]`, `pub fn parse_oeffentlich_hex(s: &str) -> Option<[u8; 32]>`.
  - `pub enum Inhalt<'a> { Text(&'a str), Datei { blob_id: &'a str, schluessel: &'a [u8; 32], mime: &'a str, name: &'a str, groesse: usize } }`
  - `pub struct Verschluesselt { pub nonce: [u8; 24], pub box_: Vec<u8> }`
  - `pub fn verschluesseln(inhalt: &Inhalt, von: &PrivaterSchluessel, an: &[u8; 32]) -> Result<Verschluesselt, KryptoFehler>` (Typ `0x01` Text, `0x17` Datei mit JSON `{"b","k","m","n","s","j":1}`).
  - `pub fn verschluessele_blob(bytes: &[u8]) -> Result<([u8; 32], Vec<u8>), KryptoFehler>` (Schlüssel, Chiffrat; Nonce `[0;23]+[1]`).
  - `pub const TEXT_MAX: usize = 3500;`

- [ ] **Step 1: Tests** (in `krypto.rs`, `#[cfg(test)]`):
  - `text_laesst_sich_mit_dem_gegenschluessel_oeffnen`: Schlüsselpaar A, B; `verschluesseln(Text("Hallo"), A, pub(B))`; mit `crypto_box` (B, pub(A)) öffnen → erstes Byte `0x01`, Padding-Länge = letztes Byte, `1..=255`, alle Padding-Bytes gleich, Rest = `"Hallo"`, Gesamtlänge ≥ 33.
  - `kurzer_text_wird_auf_mindestens_32_bytes_aufgefuellt`: Text `""` → Nutzlast+Padding ≥ 32.
  - `datei_traegt_das_json_mit_j_eins`: geöffnet → `0x17`, JSON hat `b`,`k` (64 Hex), `m:"image/png"`, `n`, `s`, `j:1`.
  - `blob_ist_mit_fester_nonce_entschluesselbar`: `crypto_secretbox` mit Schlüssel und Nonce `…01` öffnet zum Original.
  - `nonce_ist_je_nachricht_neu`: zwei Aufrufe → verschiedene Nonces.
  - `privater_schluessel_wird_gelesen`: mit/ohne `private:`, Großbuchstaben, `\n` am Ende → ok; 63 Zeichen, `zz…` → Err.
  - `fester_vektor`: fester privater Schlüssel, fester Empfängerschlüssel, eingespeiste Nonce und Padding (interne Funktion `verschluesseln_mit(…, nonce, pad)`) → festgeschriebenes Chiffrat-Hex (beim ersten grünen Lauf erzeugen und festschreiben).
- [ ] **Step 2: Rot:** `cargo test --lib adapter::threema::krypto` → FAIL.
- [ ] **Step 3: Umsetzen** mit `crypto_box::SalsaBox`, `crypto_secretbox::XSalsa20Poly1305`, `rand_core::OsRng`. Keine eigene Primitive.
- [ ] **Step 4: Grün** + `./scripts/check-all.sh --nur advisories` (bzw. der Schritt für Lizenzen/Advisories laut `scripts/AGENTS.md`) → grün.
- [ ] **Step 5: Commit** `feat(threema): Ende-zu-Ende-Verschlüsselung für das Gateway (LLH-2096)`.

### Task 3: Client und Adapter-Art `threema`

**Files:**
- Modify: `src/adapter/threema.rs` (Client)
- Create: `src/adapter/threema_art.rs`; Modify: `src/adapter/mod.rs`, `src/adapter/art.rs:306-320` (in `Verzeichnis::produktiv` eintragen)
- Modify: `src/adapter/art.rs` (neue Trait-Methode `check_geheimnis`), `src/routes/adapter.rs` (`set_geheimnis` ruft sie; `meldung_schon_vorhanden` um `threema` ergänzen)
- Modify: `src/main.rs:371` (neben `--ausgang-testzusteller` auch `ThreemaArt::ohne_netz()` einsetzen)
- Modify: `src/externe_stelle/mod.rs` (`adapter_art` auf `threema_art::CODE`)
- Modify: `src/benachrichtigung/adapter.rs:119`, `frontend/src/api/adapter.ts` (`ADAPTER_FEHLER_TEXT.schluessel_passen_nicht`: „Schlüssel passen nicht zum Zugang. Bei Matrix ein neues Access-Token anlegen, bei Threema den privaten Schlüssel der Gateway-ID eintragen.“)
- Test: `tests/adapter_threema.rs`

**Interfaces:**
- Consumes: Task 2 (`PrivaterSchluessel`, `oeffentlicher_schluessel`, `Verschluesselt`).
- Produces (`adapter::threema`):
  - `pub const API: &str = "https://msgapi.threema.ch";`
  - `pub struct ThreemaZugang<'a> { pub gateway_id: &'a str, pub secret: &'a SecretString, pub privat: &'a PrivaterSchluessel, pub lan_erlaubt: bool }`
  - `pub enum ThreemaFehler { Status(u16), Verbindung, Dns, Tls, ZielIntern, Ungewiss, Antwort, SchluesselPassenNicht }` mit `status()`, `adapter_fehler()` (Muster `SipgateFehler`; `SchluesselPassenNicht → AdapterFehler::SchluesselPassenNicht`).
  - `pub struct Ziel<'a> { pub basis: &'a str, pub client: &'a reqwest::Client }` und `pub fn produktiv_ziel(lan_erlaubt: bool, zweck: Aufruf) -> Ziel<'static>` (`Aufruf::{Abfrage, Senden, Upload}` wählt das Zeitlimit).
  - `pub async fn credits(z: &Ziel<'_>, zugang: &ThreemaZugang<'_>) -> Result<i64, ThreemaFehler>`
  - `pub async fn pubkey(z: &Ziel<'_>, zugang: &ThreemaZugang<'_>, id: &str) -> Result<[u8; 32], ThreemaFehler>` (404/400 bleiben `Status`)
  - `pub async fn upload_blob(z: &Ziel<'_>, zugang: &ThreemaZugang<'_>, chiffrat: &[u8]) -> Result<String, ThreemaFehler>` (Multipart von Hand, ein Feld `blob`, feste Boundary; jeder Abbruch ist `Verbindung`, nie `Ungewiss`)
  - `pub async fn send_e2e(z: &Ziel<'_>, zugang: &ThreemaZugang<'_>, an: &str, v: &Verschluesselt) -> Result<String, ThreemaFehler>` (Formular `from,to,nonce,box,secret` hex; Abbruch nach dem Absenden → `Ungewiss`)
  - `pub async fn pruefe(z: &Ziel<'_>, zugang: &ThreemaZugang<'_>) -> Result<i64, ThreemaFehler>` (credits, dann eigener pubkey == `oeffentlicher_schluessel(privat)`, sonst `SchluesselPassenNicht`; liefert das Guthaben)
- Produces (`adapter::threema_art`): `pub const CODE: &str = "threema";`, `pub struct ThreemaArt` mit `produktiv()`, `ohne_netz() -> Option<Self>` (nur Debug), `new(Arc<dyn ThreemaPruefer>)`; Felder `gateway_id` (Text, Pflicht, max 8), Plätze `secret` („API-Secret“), `privater_schluessel` („Privater Schlüssel“), beide Pflicht, nicht intern; `intervall_min_s 900`, `vorschlag 3600`; `abrufen` liefert `OhneUebernahme(guthaben)` (das Guthaben steht so in `letzte_anzahl`).
- Produces (`adapter::art`): `fn check_geheimnis(&self, _platz: &str, wert: &str) -> Result<String, String> { Ok(wert.to_string()) }` (Default); `ThreemaArt` normalisiert `privater_schluessel` über `normalize_privater_schluessel`.

- [ ] **Step 1: Tests schreiben**
  - In `threema.rs` gegen einen kleinen axum-Server auf `127.0.0.1:0` mit einem schlichten `reqwest::Client` als `Ziel`: `credits_liest_die_zahl` (Antwort `"1234"` → 1234); `pubkey_liest_hex`; `upload_schickt_ein_multipart_feld_blob` (Server prüft `Content-Type: multipart/form-data` und Feldnamen, Antwort Blob-ID); `send_e2e_schickt_formular_ohne_klartext` (Server prüft Felder `from,to,nonce,box,secret`, `nonce` 48 Hex); je Status 400/401/402/404/413/429/500 → `Status(n)`; `abbruch_nach_dem_absenden_ist_ungewiss` (Server liest den Body und schließt die Verbindung ohne Antwort) → `Ungewiss`; `kein_fehlertext_traegt_das_secret` (Debug-Ausgabe aller Fehler enthält das Secret nicht).
  - `pruefe_erkennt_fremden_schluessel` (pubkey liefert anderen Schlüssel → `SchluesselPassenNicht`), `pruefe_liefert_guthaben`.
  - In `threema_art.rs`: `gateway_id_ist_stern_und_sieben_zeichen` über `check_extra` (`*ABCDEF1` ok und großgeschrieben; `ABCDEFGH`, `*ABC`, `*abcdef1`→ok nach Großschreibung); `ohne_netz_ersetzt_die_art` (Muster `sipgate_fax_art::tests`).
  - `tests/adapter_threema.rs`: `zweite_threema_anbindung_ist_422`; `privater_schluessel_wird_beim_setzen_geprueft` (`PUT …/secrets/privater_schluessel` mit 63 Hex → Ablehnung mit Text, mit `private:` + Großbuchstaben → 204).
- [ ] **Step 2: Rot:** `cargo test --lib adapter::threema` und `cargo test --test adapter_threema` → FAIL.
- [ ] **Step 3: Umsetzen** nach den Interfaces; `gateway_id` in `check_extra` prüfen und großschreiben (wie andere Arten bereinigen: über die Rückgabe der Einstellungen, falls `check_extra` nicht bereinigen kann, dann Prüfung nur auf Großschreibung und Text „Gateway-ID: * und sieben Zeichen“). Den Text für `schluessel_passen_nicht` in beiden Stellen ändern.
- [ ] **Step 4: Grün:** `cargo test --lib adapter`, `cargo test --test adapter_threema --test adapter_admin` → PASS; `scripts/check-typ-codegen.sh`.
- [ ] **Step 5: Commit** `feat(threema): Client und Anbindung „Threema Gateway“ (LLH-2096)`.

### Task 4: Empfängerschlüssel merken (Migration 0392, Repo)

**Files:**
- Create: `migrations/0392_threema_schluessel.sql` (Nummer vorher nach `migrations/AGENTS.md` prüfen)
- Modify: `src/ausgang/repo.rs` (zwei Funktionen)
- Modify: Register, die ein Wächtertest für neue Tabellen verlangt (`instanz::spiegel::art::AUSGENOMMEN` mit Grund „Org-Betriebsangabe des Ausgangs: gemerkte Threema-Schlüssel“, ggf. Org-Isolations- oder Schwärzungsregister – dem Text des roten Wächters folgen)

**Interfaces:**
- Produces:
  - Tabelle `org_threema_schluessel (org_id INTEGER NOT NULL REFERENCES org(id) ON DELETE CASCADE, threema_id TEXT NOT NULL, public_key TEXT NOT NULL CHECK (length(public_key) = 64), gemerkt_at TEXT NOT NULL, PRIMARY KEY (org_id, threema_id))` (FK-Ziel wie die übrigen `org_*`-Tabellen).
  - `pub async fn load_threema_schluessel(pool: &SqlitePool, org_id: i64, threema_id: &str) -> Result<Option<String>, AppError>`
  - `pub async fn save_threema_schluessel_tx(conn: &mut SqliteConnection, org_id: i64, threema_id: &str, public_key: &str, at: DateTime<Utc>) -> Result<(), AppError>` (`INSERT … ON CONFLICT DO NOTHING`: nie überschreiben)

- [ ] **Step 1: Tests** in `src/ausgang/repo.rs` (oder `src/ausgang/tests.rs`): `schluessel_wird_gemerkt_und_nie_ueberschrieben` (save A, save B → load = A); `schluessel_sind_je_org_getrennt` (Org 1 merkt, Org 2 lädt `None`).
- [ ] **Step 2: Rot:** `cargo test --lib ausgang::` → FAIL.
- [ ] **Step 3: Migration und Funktionen**; Wächter (`cargo test --lib instanz::spiegel db::tests`) grün bekommen.
- [ ] **Step 4: Grün:** `cargo test --lib ausgang instanz::spiegel db` → PASS.
- [ ] **Step 5: Commit** `feat(ausgang): gemerkte Threema-Schlüssel je Org (LLH-2096)`.

### Task 5: `ThreemaZusteller` (Teile, Ablauf, Fehlerzuordnung)

**Files:**
- Create: `src/ausgang/zusteller/threema.rs`
- Modify: `src/ausgang/zusteller.rs` (`mod threema; pub use …`, Felder an `Versandauftrag`, `Zustellt`, `Fehlschlag`; `Zustellerwahl` um `threema`)
- Modify: `src/ausgang/lauf.rs:141-151` (Compile-Zeit-Prüfung `THREEMA_ZUSTELL_ZEITLIMIT < HAENGT_NACH`)

**Interfaces:**
- Consumes: Task 2 (`verschluesseln`, `verschluessele_blob`, `TEXT_MAX`, `parse_privater_schluessel`), Task 3 (Client-Funktionen, `Ziel`, `ThreemaZugang`, `ThreemaFehler`).
- Produces:
  - `Versandauftrag.threema_schluessel: Option<&'a str>` (gemerkter Schlüssel, Hex; nur bei Threema `Some`)
  - `Zustellt.neuer_schluessel: Option<String>` und `Fehlschlag.neuer_schluessel: Option<String>` (abgefragter Schlüssel, wenn keiner gemerkt war; sonst `None`). Alle bestehenden Konstruktoren setzen `None`.
  - `pub fn threema_teile(betreff: &str, inhalt: &str, anhaenge: usize) -> Vec<Teil>` mit `pub enum Teil { Text(String), Anlage(usize) }` (Index in `anhaenge`), Nummer = Position in der Liste.
  - `pub fn teile_text(text: &str, max: usize) -> Vec<String>` (Algorithmus unten).
  - `pub struct ThreemaZusteller` mit `produktiv()` und `new(ziel: Arc<dyn Fn(Aufruf, bool) -> Ziel<'static> + Send + Sync>)` (Tests geben einen axum-Server als Ziel).
  - `pub const THREEMA_ZUSTELL_ZEITLIMIT: Duration` = 10 min.
  - `Zustellerwahl::new(email, matrix, threema)`; `produktiv` setzt `ThreemaZusteller::produktiv()`.

`teile_text`: Ganzer Text `*{betreff}*\n\n{inhalt}`. Passt er in `max`, ein Teil ohne Präfix. Sonst `k` schätzen, Präfix `({i}/{k}) ` reservieren, an `\n\n` teilen, zu große Absätze an `\n`, zu große Zeilen an der letzten Zeichengrenze ≤ Rest; ändert sich die Stellenzahl von `k`, neu rechnen. Jeder Teil inkl. Präfix ≤ `max` Bytes.

Fehlerzuordnung (`Fehlschlag.grund` fest, deutsch):
- `Verbindung|Dns|Tls|ZielIntern|Status(429)|Status(500..)` und jeder Upload-Fehler außer 401/402/413 → `Voruebergehend { nicht_vor: None }`, Grund „Threema nicht erreichbar“ (429: „Zu viele Anfragen an Threema“).
- `Ungewiss` → `Ungewiss`.
- `Status(401)` → `Anbindung { pruefung_vorziehen: true }`, „Threema lehnt die Anmeldung ab“; `Status(402)` → dasselbe, „Kein Guthaben im Threema-Gateway“.
- `Status(400|404)` bei pubkey/send → `Abgelehnt`, „Threema-ID unbekannt“.
- `Status(413)` → `ZuGross`.
- Schlüssel weicht ab → `Verschluesselung`, „Der Schlüssel der Threema-ID hat sich geändert“; Krypto-Fehler oder privater Schlüssel unlesbar → `Verschluesselung`, „Verschlüsseln nicht möglich“.
- `SchluesselPassenNicht`, `Antwort` → `Anbindung { pruefung_vorziehen: true }`, „Threema-Gateway nicht nutzbar“.

- [ ] **Step 1: Tests** in `threema.rs`:
  - `teile_text`: `kurzer_text_ist_ein_teil_ohne_praefix`; `langer_text_teilt_an_absaetzen_mit_praefix` (3 Absätze à 1500 Bytes → 2 Teile, Präfixe `(1/2) `, `(2/2) `); `kein_teil_ist_laenger_als_max_auch_mit_umlauten` (proptest: beliebiger String aus `ä`, `\n`, `a`, Länge bis 20 000 → jeder Teil ≤ 3500 Bytes, gültiges UTF-8, Verkettung ohne Präfixe = Original ohne die Trenner an Teilgrenzen); `fuss_steht_im_letzten_teil` (Inhalt mit `\n-- \nGesendet mit Lifeline Hub` → nur der letzte Teil enthält „Gesendet mit“).
  - `threema_teile`: Text zuerst, dann Anlagen, fortlaufend ab 0.
  - Zusteller gegen axum-Doppel des Gateways (zeichnet Aufrufe auf): `sendet_text_und_bild_und_meldet_nachrichten_ids` (Teile `[(0,id0),(1,id1)]`, ein Upload); `laesst_gemerkte_teile_aus` (`gesendet = [0]` → nur Upload+Senden des Bilds); `neuer_schluessel_wird_zurueckgemeldet`; `abweichender_schluessel_sendet_nichts` (kein `send_e2e`-Aufruf, `Verschluesselung`); `fehlerzuordnung` (je Status aus der Liste oben); `abbruch_nach_dem_absenden_ist_ungewiss_und_teile_davor_bleiben` (zweiter Teil bricht ab → `Ungewiss`, `teile = [(0, …)]`); `upload_5xx_ist_voruebergehend_mit_gesendetem_text`.
- [ ] **Step 2: Rot:** `cargo test --lib ausgang::zusteller` → FAIL.
- [ ] **Step 3: Umsetzen.** Ablauf: Zugang aus `Versandzugang` (`gateway_id`, `secret`, `privater_schluessel`), pubkey holen, vergleichen, je fehlendem Teil senden, nach jedem Teil merken. Die ganze Zustellung unter `tokio::time::timeout(THREEMA_ZUSTELL_ZEITLIMIT)`; Zeitüberschreitung während `send_e2e` → `Ungewiss`, sonst `Voruebergehend`.
- [ ] **Step 4: Grün:** `cargo test --lib ausgang` → PASS; `cargo build`.
- [ ] **Step 5: Commit** `feat(ausgang): Threema-Zusteller (LLH-2096)`.

### Task 6: Lauf: Schlüssel lesen und merken

**Files:**
- Modify: `src/ausgang/lauf.rs` (`run_one` um 459/596; `Abschluss::Versuch` und `schreibe_abschluss` um 997-1025)
- Test: `tests/ausgang_lauf.rs`

**Interfaces:**
- Consumes: Task 4 (`load_threema_schluessel`, `save_threema_schluessel_tx`), Task 5 (`threema_schluessel`, `neuer_schluessel`).
- Produces: `Abschluss::Versuch { …, schluessel: Option<(i64, &'a str, &'a str)> }` (org_id, threema_id, public_key).

- [ ] **Step 1: Tests** in `tests/ausgang_lauf.rs` mit einem Doppel-`Zusteller`: `threema_schluessel_wird_mit_dem_ergebnis_gemerkt` (Doppel meldet `neuer_schluessel: Some(K)` → Tabelle hat K); `auch_bei_fehlschlag_gemerkt`; `gemerkter_schluessel_geht_in_den_auftrag` (Doppel sieht `threema_schluessel == Some(K)`); `ungewiss_bei_threema_wird_nicht_wiederholt` (Zustand `fehlgeschlagen`/`ungewiss` wie bei SMTP, kein weiterer Versuch).
- [ ] **Step 2: Rot:** `cargo test --test ausgang_lauf threema` → FAIL.
- [ ] **Step 3: Umsetzen:** nur bei `zeile.kanal == KanalArt::Threema` laden; `save_threema_schluessel_tx` in derselben Transaktion wie `save_teile_tx`.
- [ ] **Step 4: Grün:** `cargo test --test ausgang_lauf --test ausgang_routen` → PASS.
- [ ] **Step 5: Commit** `feat(ausgang): Threema im Lauf des Ausgangskorbs (LLH-2096)`.

### Task 7: Route: alle Kanäle ohne Anbindung in einer Ablehnung

**Files:**
- Modify: `src/routes/ausgang.rs:76-89` (`meldung_anbindung` um Threema), `:338-355` (Schleife sammelt)
- Test: `tests/ausgang_routen.rs`

**Interfaces:**
- Produces: Antwort 422 `UnprocessableGrund { grund: <Code des ersten Kanals>, meldung: Meldungen aller betroffenen Kanäle, mit „; “ verbunden, Reihenfolge `KanalArt::ALLE` }`. Threema-Texte: „Kein Threema-Gateway eingerichtet“, „Das Threema-Gateway ist angehalten“, „Das Threema-Gateway ist nicht nutzbar; Einstellungen prüfen“.

- [ ] **Step 1: Tests:** `ohne_threema_anbindung_422_mit_text` ; `matrix_und_threema_fehlen_in_einer_ablehnung` (Meldung enthält „Matrix-Konto“ und „Threema-Gateway“, kein Versand angelegt); `threema_mit_anbindung_legt_versand_an` (Antwort 201, Kanal `threema`, Adresse normalisiert).
- [ ] **Step 2: Rot:** `cargo test --test ausgang_routen threema` → FAIL.
- [ ] **Step 3: Umsetzen.**
- [ ] **Step 4: Grün:** `cargo test --test ausgang_routen` → PASS.
- [ ] **Step 5: Commit** `feat(ausgang): Threema annehmen, fehlende Anbindungen gesammelt melden (LLH-2096)`.

### Task 8: Frontend: Stelle, Senden-Dialog, Versandliste, Anbindung

**Files:**
- Modify: `frontend/src/api/externeStellen.ts:52` (Kommentar), `frontend/src/stammdaten/ExterneStelleKanaele.tsx` (Kanalwahl Threema-ID, `KANAL_TEXT.threema`, Sonderfall Z. 78/145 fällt)
- Modify: `frontend/src/api/ausgang.ts` (`AusgangKanal` um `'threema'`, `ausgangKanal`, `AUSGANG_FEHLER_TEXT.threema`, `anbindungKanaele` ersetzt `anbindungKanal` und liefert alle Kanäle der Meldung)
- Modify: `frontend/src/ausgang/empfaengerVorschlag.ts` (Rang Matrix > Threema > Mail)
- Modify: `frontend/src/ausgang/SendenDialog.tsx` (Filter Z. 93-102 um `threema`; `merkeMatrixSperre` → `merkeSperren` für Matrix und Threema, Rückfall je Stelle auf die nächste nicht gesperrte Adresse in der Rangfolge)
- Modify: `frontend/src/pages/einstellungen/AdapterAnsicht.tsx` (Art `threema`: Paneel „Guthaben“ aus `letzte_anzahl`, Hinweis bei 0: „Kein Guthaben: jeder Versand scheitert, bis Credits nachgekauft sind.“)
- Tests: neben den Dateien (`*.test.ts(x)`)

**Interfaces:**
- Consumes: Task 7 (Meldungstexte), Task 3 (Art `threema`, `letzte_anzahl`).
- Produces: `export function anbindungKanaele(fehler: unknown, gesendet?: readonly KanalArt[]): AusgangKanal[]`.

`AUSGANG_FEHLER_TEXT.threema`: `voruebergehend` „Threema vorübergehend nicht erreichbar“, `abgelehnt` „Von Threema abgelehnt“, `ungewiss` „Zustellung unklar“, `anbindung_fehlt` „Kein Threema-Gateway eingerichtet“, `anbindung_angehalten` „Das Threema-Gateway ist angehalten“, `anbindung_fehler` „Das Threema-Gateway ist nicht nutzbar; Einstellungen prüfen“, `zu_gross` „Anlage zu groß für Threema“, `verschluesselung` „Verschlüsseln nicht möglich“, übrige wie Matrix.

- [ ] **Step 1: Tests:**
  - `empfaengerVorschlag.test.ts`: `threema_vor_mail`, `matrix_vor_threema`, `fax_nie`.
  - `ausgang.test.ts`: `anbindungKanaele_liest_beide_aus_der_meldung` („Kein Matrix-Konto eingerichtet; Kein Threema-Gateway eingerichtet“, gesendet `['matrix','threema','email']` → `['matrix','threema']`); ein Kanal gesendet → nur dieser.
  - `SendenDialog.test.tsx`: `threema_wird_angeboten`; `matrix_und_threema_gesperrt_mail_rueckt_nach` (422 mit beiden → beide Adressen deaktiviert mit Grund, je Stelle die Mail gewählt); bestehende Matrix-Sperre-Tests bleiben grün.
  - `ExterneStelleKanaele.test.tsx`: `threema_id_hinzufuegen` (Auswahl Threema-ID, Eingabe `echo echo`, POST-Body Kanal `threema`).
  - `AdapterAnsicht.test.tsx`: `threema_zeigt_guthaben` und `threema_guthaben_null_zeigt_hinweis`.
- [ ] **Step 2: Rot:** `mise exec -- pnpm -C frontend test -- --run src/ausgang src/stammdaten src/pages/einstellungen src/api` → FAIL.
- [ ] **Step 3: Umsetzen** nach `frontend/AGENTS.md` (Texte, Komponenten der Gestaltungssprache).
- [ ] **Step 4: Grün:** dieselben Tests, dazu `mise exec -- pnpm -C frontend lint` und `mise exec -- pnpm -C frontend typecheck` (Skriptnamen aus `frontend/package.json`) → PASS.
- [ ] **Step 5: Commit** `feat(ausgang): Threema in Stammdaten, Senden-Dialog und Anbindungen (LLH-2096)`.

### Task 9: e2e

**Files:**
- Modify: `frontend/e2e/ausgang.spec.ts` (Muster Matrix ab Z. 108: Anbindung `threema` mit `gateway_id: '*E2ETEST'` anlegen, Geheimnisse setzen, Threema-ID an einer Stelle eintragen, senden, Versandliste „übergeben“)

- [ ] **Step 1: Test** `threema_versand_wird_uebergeben` schreiben.
- [ ] **Step 2: Rot** (vor Task 8 wäre er rot; hier direkt ausführen): `cargo build && mise exec -- pnpm -C frontend exec playwright test e2e/ausgang.spec.ts --trace off` → erwartet PASS nach Task 1–8; scheitert er, Ursache beheben (höchstens drei Runden, `dev-zunder-ausfuehren`, „Drei Runden“).
- [ ] **Step 3: Commit** `test(ausgang): e2e für den Versand an eine Threema-ID (LLH-2096)`.

### Task 10: Regeln, ADR, Doku

**Files:**
- Create: `docs/architektur/entscheidungen/ADR-0112-threema-ist-ein-kanal-des-ausgangskorbs-nur-e2e-mit-gemerktem-schluessel.md` (Vorlage `VORLAGE.md`, Status `vorgeschlagen`, präzisiert ADR-0104; Nummer vorher prüfen)
- Modify: `src/AGENTS.md`, Abschnitt „Ausgang an Menschen“ (Kanalliste `threema → threema`, Regeln aus der Spec Abschnitt 8)
- Modify: `docs/architektur/05-bausteinsicht.md`, `06-laufzeitsicht.md`, `08-querschnittliche-konzepte.md` (Mitänderungsregel `docs/architektur/AGENTS.md`)
- Modify: `docs/anwender/kapitel/anbindungen.md`, `stammdaten.md`, `lageberichte.md` (Senden; Kosten, kein „zugestellt“), nach `docs/anwender/AGENTS.md` (Kapitelform, Wächter)

- [ ] **Step 1:** ADR und Regeln schreiben; `scripts/adr-fuer.sh src/ausgang/zusteller/threema.rs` nennt ADR-0112.
- [ ] **Step 2:** Doku; Wächter: `./scripts/check-all.sh --nur doku` (bzw. die Schritte für Architektur- und Anwenderdoku laut Skriptkopf) → grün.
- [ ] **Step 3: Commit** `docs(ausgang): Threema in Regeln, Entscheidung und Doku (LLH-2096)`.

### Task 11: Abschluss

- [ ] `./scripts/check-all.sh --geaendert --ohne-e2e` → grün (Ergebnis in den PR unter „Geprüft“).
- [ ] Review nach Ermessen: Anlass „Eingaben von außen“ und Größe → ein Review-Agent mit `references/review-pruefliste.md`, Befunde abarbeiten.
- [ ] Bilder der Änderung (Stelle mit Threema-ID, Senden-Dialog, Anbindung mit Guthaben) per Wegwerf-Spec, in `pr-bilder/gq6qs7tg/` committen, im PR einbinden, danach wieder entfernen.
- [ ] Handprobe mit echter Gateway-ID: nur wenn ein Zugang da ist; sonst im PR vermerken, dass sie fehlt.
