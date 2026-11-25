# Ausgang per E-Mail — Umsetzungsplan (LLH-2093)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Lagebericht, Befehl und Nachforderung per E-Mail an Externe Stellen senden, über einen
Ausgangskorb am Server, mit Versandliste, Wiederholung und ETB-Eintrag.

**Architecture:** Kanaladressen als Kindtabelle der Externen Stelle. SMTP ist eine Adapter-Art
(Einstellungen, Passwort, Verbindungsprüfung im Rahmen); ein eigener kleiner SMTP-Client in
`adapter::smtp` verbindet sich nur mit geprüften Adressen. Der Ausgangskorb `src/ausgang/` hält
je Versand eine Zeile mit Schnappschuss und stellt in einem eigenen Lauf über einen
`Zusteller`-Trait zu.

**Tech Stack:** Rust (axum, sqlx/SQLite, tokio, tokio-rustls 0.26, rustls 0.23 mit `aws_lc_rs`,
rustls-platform-verifier 0.7, lettre nur `builder`), React/TypeScript (TanStack Query).

**Spec:** `docs/superpowers/specs/2026-11-24-w1ymakq6-ausgang-email-design.md`

Zunder: https://zunder.rubeen.dev/#/aufgabe/w1ymakq6rzew0lggh2ewwbxs

## Global Constraints

- Bezeichner: Fachbegriffe deutsch, Technik englisch (`AGENTS.md`, Bezeichner-Sprache). Neue
  Wire-Felder englisch. Prosa, Kommentare, Commit-Nachrichten, Testnamen deutsch.
- Routen: `/api/einsaetze/{id}/…/deliveries`, `/api/external-agencies/{id}/channels`; Wort
  `deliveries` ins Glossar `scripts/api-routen-woerter.tsv` (Wächter Schritt 14).
- Statuscodes nach `src/AGENTS.md`: 400 Feld, 422 Kontext, 404 fremde Org.
- Migrationen angehängt, nächste freie Nummer auf `origin/alpha` (heute 0373, 0374), prüfen mit
  `scripts/check-migrationen.sh`.
- Kein zweiter rustls-Crypto-Provider; TLS nur mit `instanz::zertifikat::provider()`.
- Kein Geheimnis in Log, Fehlertext, Antwort, ETB, Admin-Spur.
- Kein DB-Zugriff während SMTP; keine Verbindung an `filter_adressen` vorbei.
- Wiederholung: Backoff `30 s · 2^(n−1)`, Deckel 5 min, Fenster 30 min ab `erster_versuch_at`.
- Anhänge höchstens 20 MiB in Summe. Zeitlimits SMTP: Verbindung 5 s, je Antwort 30 s,
  Sitzung 120 s.
- Nach DTO-/Enum-Änderung `scripts/check-typ-codegen.sh`, beide generierten Dateien committen.
- Frontend: Formulare über `ErfassungsModal`, Query-Keys nur aus `api/queryKeys.ts`,
  `SOFORT_ODER_NIE` für Senden, Texte ohne Anrede.
- Node/pnpm nur über `mise exec --`.

## Review Focus

1. Ein Text mit einer Zeile, die nur aus `.` besteht, oder mit nacktem `\n`/`\r`: die Mail muss
   vollständig ankommen (Dot-Stuffing, CRLF). Test in Task 4.
2. Umlaute in Betreff, Absendername und Text (Einsatzname „Hochwasser Süd“): sauber kodiert.
   Test in Task 7.
3. Doppelklick auf „Senden“ (gleiche `client_id`): genau ein Versand. Test in Task 9.
4. Server stirbt während der Zustellung: Zeile endet als `ungewiss`, nicht als doppelter
   Versand. Test in Task 8.
5. Mailserver-Host wird auf einen anderen Rechner geändert: Passwort ist weg, bevor eine
   Verbindung entsteht. Test in Task 3.

---

### Task 1: Kanaladressen der Externen Stelle (Backend)

**Files:**
- Create: `migrations/0376_org_externe_stelle_kanal.sql`
- Create: `src/externe_stelle/kanal.rs`
- Modify: `src/externe_stelle/mod.rs` (Modul, `KanalArt`)
- Modify: `src/routes/externe_stelle.rs`, `src/app.rs` (Routen nahe 2318)
- Modify: `Cargo.toml` (`lettre = { version = "0.11", default-features = false, features = ["builder"] }`)
- Test: `src/externe_stelle/tests.rs`, `tests/externe_stelle_kanal.rs`

**Interfaces:**
- Produces:
  - `wire_enum! KanalArt { Email => "email", Fax => "fax", Matrix => "matrix", Threema => "threema" }`
    und `KanalArt::is_freigeschaltet(self) -> bool` (heute nur `Email`)
  - `struct ExterneStelleKanal { id: i64, externe_stelle_id: i64, channel: KanalArt, address: String, label: Option<String> }`
    (Wire englisch, Rust-Feld = Wire-Feld)
  - `kanal::normalize_email(roh: &str) -> Result<String, String>` (über `lettre::Address`)
  - `kanal::list(pool, org_id, stelle_id) -> Result<Vec<ExterneStelleKanal>, AppError>`
  - `kanal::list_email_fuer_org(pool, org_id) -> Result<Vec<(ExterneStelle, ExterneStelleKanal)>, AppError>` (nur aktive Stellen)
  - `kanal::load_in_org(conn, org_id, kanal_id) -> Result<(ExterneStelle, ExterneStelleKanal), AppError>`
  - `kanal::create/update/delete` (Org-isoliert, fremd → `NotFound`)
  - Sammelroute `GET /api/external-agencies/channels?channel=email` → `Vec<KanalMitStelle>` mit
    `struct KanalMitStelle { channel: ExterneStelleKanal, agency_id: i64, agency_name: String }`
    (nur aktive Stellen; für den Senden-Dialog in Task 10). Route vor `/{id}` registrieren.

- [x] **Step 1: Migration schreiben** — Tabelle wie Spec Abschnitt 1, `CHECK (kanal IN ('email','fax','matrix','threema'))`, `UNIQUE(externe_stelle_id, kanal, adresse)`, Index auf `(org_id, externe_stelle_id)`. Hat `org_externe_stelle` Änderungs-Trigger aus 0312, bekommt die Kanaltabelle dieselben; den Hub-Schreibschutz-Trigger aus 0312 für Kanäle einer synchronisierten Stelle mitziehen.
- [x] **Step 2: Failing Tests (Unit)** in `src/externe_stelle/tests.rs`:
  - `normalize_email_nimmt_eine_adresse` (`" Lage@Leitstelle-Nord.de "` → `"Lage@leitstelle-nord.de"`)
  - `normalize_email_lehnt_mehrere_und_anzeigenamen_ab` (`"a@b.de, c@d.de"`, `"Nord <a@b.de>"`, `""`, 255 Zeichen → `Err`)
- [x] **Step 3: Failing Tests (Routen)** in `tests/externe_stelle_kanal.rs`:
  - `admin_legt_mailadresse_an_und_liest_sie` (POST 201, GET liefert sie)
  - `fax_ist_noch_nicht_freigeschaltet` (POST `channel: "fax"` → 400)
  - `kein_admin_darf_nicht_schreiben` (403), `fremde_org_sieht_404`
  - `doppelte_adresse_ist_409_oder_422` (Konvention des Repos für UNIQUE übernehmen)
- [x] **Step 4: Run** `cargo test --test externe_stelle_kanal` und `cargo test externe_stelle` → FAIL
- [x] **Step 5: Implementieren** (Repo, Routen `GET|POST /api/external-agencies/{id}/channels`, `PATCH|DELETE …/channels/{kanal_id}`; Lesen `CurrentUser`, Schreiben `AdminUser`; Präfix liegt schon in `STAMMDATEN_PFADE`)
- [x] **Step 6: Run** dieselben Tests → PASS; `scripts/check-typ-codegen.sh`
- [x] **Step 7: Commit** `feat(externe-stelle): Kanaladressen je Stelle (LLH-2093)`

### Task 2: Kanaladressen pflegen (Frontend)

**Files:**
- Modify: `frontend/src/api/` (Datei der Externen Stellen; Typen aus dem Codegen), `frontend/src/api/queryKeys.ts` (`globalKeys.externeStelleKanaele(stelleId)`, unter `externeStellen()` einsortiert; Live-Klassifikation wie `externeStellen`)
- Modify: `frontend/src/stammdaten/ExterneStelleFormModal.tsx` (Abschnitt „Erreichbar per“), `frontend/src/stammdaten/ExterneStellenTab.tsx` (Hinweis „n Mailadressen“)
- Test: `frontend/src/stammdaten/ExterneStelleKanaele.test.tsx`

**Interfaces:**
- Consumes: Routen aus Task 1.
- Produces: `useExterneStelleKanaele(stelleId)`, `useCreateKanal`, `useDeleteKanal` (alle `SOFORT_ODER_NIE`).

- [x] **Step 1: Failing Test** `ExterneStelleKanaele.test.tsx`: „zeigt hinterlegte Mailadressen und fügt eine hinzu“ (MSW: GET liefert eine Adresse; Eingabe + „Adresse hinzufügen“ → POST mit `{channel:'email', address, label}`; Liste zeigt beide), „meldet ‚Mailadresse ungültig‘ ohne Request“.
- [x] **Step 2: Run** `mise exec -- pnpm -C frontend vitest run src/stammdaten/ExterneStelleKanaele.test.tsx` → FAIL
- [x] **Step 3: Implementieren** (Abschnitt nur bei bestehender Stelle; Hub-synchronisierte Stelle schreibgeschützt mit sichtbarem Grund wie `zustaendig`)
- [x] **Step 4: Run** Test → PASS; `mise exec -- pnpm -C frontend lint`
- [x] **Step 5: Commit** `feat(stammdaten): Mailadressen an Externen Stellen pflegen (LLH-2093)`

### Task 3: Feldtyp `Host` im Adapter-Rahmen

**Files:**
- Modify: `src/adapter/art.rs` (`FeldTyp::Host => "host"`, `check_einstellungen`, `has_neues_ziel`)
- Modify: `src/public_api/webhook/ziel.rs` (oder `src/adapter/ziel.rs`): `check_host(roh: &str, lan_erlaubt: bool) -> Result<String, ZielFehler>`
- Modify: `frontend/src/pages/einstellungen/AdapterPaneel.tsx`/`adapterAnzeige.ts` (Feldtyp `host` als Textfeld)
- Test: `src/adapter/` Unit-Tests, `tests/adapter_admin.rs`

**Interfaces:**
- Produces: `check_host` — getrimmt, kleingeschrieben; lehnt Schema, `/`, `:`-Port, Leerzeichen, `localhost`, IP-Literal in gesperrtem Netz (ohne LAN-Ausnahme auch privat) ab.

- [x] **Step 1: Failing Tests**
  - `check_host_nimmt_namen_und_oeffentliche_ip` (`"smtp.example.org"`, `"203.0.113.5"`)
  - `check_host_lehnt_url_port_loopback_ab` (`"smtps://x"`, `"x:25"`, `"localhost"`, `"127.0.0.1"`, `"10.0.0.1"` ohne LAN)
  - `has_neues_ziel_zaehlt_geaenderten_host` (Testart mit `Host`-Feld: `a.example` → `b.example` ⇒ `true`; gleich ⇒ `false`)
  - Review-Fokus 5, in `tests/adapter_admin.rs`: `geaenderter_host_entfernt_passwort` (PATCH mit neuem Host → Platz `passwort` nicht mehr gesetzt)
- [x] **Step 2: Run** `cargo test check_host has_neues_ziel` und `cargo test --test adapter_admin geaenderter_host` → FAIL
- [x] **Step 3: Implementieren**; Enum-Kontrakt/Codegen nachziehen
- [x] **Step 4: Run** → PASS; `scripts/check-typ-codegen.sh`
- [x] **Step 5: Commit** `feat(adapter): Feldtyp Host mit Zielschutz (LLH-2093)`

### Task 4: SMTP-Client

**Files:**
- Create: `src/adapter/smtp.rs` (Protokoll), `src/adapter/smtp/tests.rs`
- Modify: `src/instanz/zertifikat.rs` (`pub fn webpki_config() -> Result<rustls::ClientConfig, String>`: `provider()` + `rustls_platform_verifier::Verifier`)
- Modify: `Cargo.toml` (`tokio-rustls = { version = "0.26", default-features = false }`, `rustls-platform-verifier = "0.7"` — beide schon im Lockfile)

**Interfaces:**
- Produces:
  - `enum Verschluesselung { StartTls, Tls }`
  - `struct SmtpZiel<'a> { host: &'a str, port: u16, verschluesselung: Verschluesselung, lan_erlaubt: bool, benutzer: Option<&'a str>, passwort: Option<&'a SecretString>, ehlo_name: &'a str }`
  - `enum SmtpFehler { Dns, ZielIntern, Verbindung, Zeitueberschreitung, Tls, Anmeldung, Voruebergehend(u16), Abgelehnt(u16), Ungewiss, Antwort }` mit `fn adapter_fehler(&self) -> AdapterFehler` (Anmeldung → `Abgelehnt`, Tls → `Tls`, Antwort → `AntwortUngueltig`, Rest gleichnamig) — keine neuen `AdapterFehler`-Codes
  - `async fn pruefe(ziel: &SmtpZiel<'_>, tls: Arc<rustls::ClientConfig>) -> Result<(), SmtpFehler>` (EHLO, TLS, AUTH, QUIT)
  - `async fn sende(ziel: &SmtpZiel<'_>, tls: Arc<rustls::ClientConfig>, von: &str, an: &str, nachricht: &[u8]) -> Result<(), SmtpFehler>`
  - intern generisch: `async fn sitzung<S: AsyncRead + AsyncWrite + Unpin + Send>(…)`; die Verbindung entsteht in `fn verbinde(ziel) -> TcpStream` nach `tokio::net::lookup_host` + `filter_adressen` (leer ⇒ `ZielIntern`), Verbindung zur ersten erlaubten Adresse, SNI = `host`
- Zeitlimits wie Global Constraints; Antwortzeilen gedeckelt (4 KiB je Zeile, 64 Zeilen).

- [x] **Step 1: Failing Tests** gegen einen skriptbaren Testserver (`tokio::io::duplex` für Klartext; tokio-rustls-Server mit `rcgen`-Zertifikat und einem Test-`ClientConfig`, das genau dieses Zertifikat annimmt, für STARTTLS/TLS):
  - `starttls_auth_plain_und_zustellung` (Server sieht `EHLO`, `STARTTLS`, nach TLS `AUTH PLAIN <b64>`, `MAIL FROM:<a@x>`, `RCPT TO:<b@y>`, Daten, `QUIT`)
  - `punktzeile_wird_verdoppelt_und_lf_zu_crlf` (Review-Fokus 1: Text `"a\n.\nb"` kommt als `"a\r\n..\r\nb\r\n.\r\n"`)
  - `535_ist_anmeldung`, `450_bei_rcpt_ist_voruebergehend`, `550_bei_rcpt_ist_abgelehnt`
  - `abbruch_nach_daten_ist_ungewiss` (Server liest bis `\r\n.\r\n` und schließt) und `abbruch_vor_daten_ist_verbindung`
  - `ohne_starttls_angebot_kein_klartext` (EHLO ohne `STARTTLS` → `Tls`, kein `AUTH` gesendet)
  - `fremdes_zertifikat_ist_tls`
  - `verbinde_lehnt_loopback_ab` (`host = "127.0.0.1"` → `ZielIntern`, ohne Verbindung)
- [x] **Step 2: Run** `cargo test adapter::smtp` → FAIL
- [x] **Step 3: Implementieren** (Dot-Stuffing und CRLF-Normalisierung beim Schreiben der Daten; `Ungewiss` genau dann, wenn der Abschluss `\r\n.\r\n` geschrieben, aber keine 250 gelesen wurde)
- [x] **Step 4: Run** → PASS; `cargo tree -i ring` zeigt keinen neuen Pfad über diese Crates (kein zweiter Provider)
- [x] **Step 5: Commit** `feat(adapter): kleiner SMTP-Client mit Zielschutz (LLH-2093)`

### Task 5: Adapter-Art `smtp`

**Files:**
- Create: `src/adapter/arten/smtp.rs` (oder `src/adapter/smtp_art.rs`, Muster des Verzeichnisses folgen)
- Modify: `src/adapter/art.rs` (`Verzeichnis::produktiv()` nimmt `SmtpArt`)
- Modify: `src/routes/` Admin-Adapter-Anlage: höchstens eine Anbindung der Art `smtp` je Org (alle Zustände) → 422
- Modify: `frontend/src/api/adapter.ts` (Art-Anzeige „E-Mail (SMTP)“ kommt vom Server; nichts außer Feldtyp nötig)
- Test: `tests/adapter_smtp.rs`

**Interfaces:**
- Consumes: Task 3 (`FeldTyp::Host`), Task 4 (`pruefe`, `SmtpZiel`).
- Produces: `SmtpArt` (`code() = "smtp"`, `bezeichnung() = "E-Mail (SMTP)"`), Felder `host` (Host, Pflicht), `port` (Zahl, Pflicht), `verschluesselung` (Text, Pflicht, `check_extra`: `starttls|tls`), `benutzer` (Text), `absender` (Text, Pflicht, `check_extra` über `normalize_email`), `absender_name` (Text, max 100); Platz `passwort` (nicht Pflicht); `intervall_min_s = 900`, `intervall_vorschlag_s = 3600`.
  - `pub fn smtp_ziel<'a>(einstellungen: &'a Map<String, Value>, geheimnisse: &'a HashMap<String, SecretString>, lan_erlaubt: bool, ehlo_name: &'a str) -> Result<SmtpZiel<'a>, AdapterFehler>` (geteilt mit Task 8)
  - `abrufen`: `pruefe(...)`, Erfolg → `OhneUebernahme(0)`, Fehler → `Fehlschlag::new(e.adapter_fehler())`. Für Tests nimmt `SmtpArt` ein injizierbares `Arc<dyn SmtpPruefer>` (Produktion: echter Client).

- [x] **Step 1: Failing Tests**
  - `smtp_art_ist_im_verzeichnis` (`Verzeichnis::produktiv().find("smtp")`)
  - `einstellungen_ohne_absender_sind_400`, `verschluesselung_klartext_ist_400`
  - `zweite_smtp_anbindung_ist_422` (auch wenn die erste angehalten ist)
  - `probe_meldet_anmeldefehler_als_abgelehnt` (Pruefer-Doppel liefert `Anmeldung`)
- [x] **Step 2: Run** `cargo test --test adapter_smtp` → FAIL
- [x] **Step 3: Implementieren**
- [x] **Step 4: Run** → PASS; `cargo test --test adapter_admin --test adapter_lauf` bleibt grün
- [x] **Step 5: Commit** `feat(adapter): Anbindung E-Mail (SMTP) (LLH-2093)`

### Task 6: Ausgangskorb — Tabelle, Zustand, Repo

**Files:**
- Create: `migrations/0377_ausgang.sql`
- Create: `src/ausgang/mod.rs`, `src/ausgang/repo.rs`, `src/ausgang/zustand.rs`, `src/ausgang/tests.rs`
- Modify: `src/lib.rs`, `src/instanz/spiegel/art.rs` (`AUSGENOMMEN`, Grund aus Spec 3), `src/einsatz/schwaerzung_registry.rs` (`ausgang`: `betreff`, `inhalt`, `adresse`, `stelle_bezeichnung`), `src/aufbewahrung/` (wie ETB einsortieren)

**Interfaces:**
- Produces:
  - `wire_enum! QuelleArt { Lagebericht => "lagebericht", Befehl => "befehl", Nachforderung => "nachforderung" }`
  - `wire_enum! VersandZustand { Wartet => "wartet", Uebergeben => "uebergeben", Fehlgeschlagen => "fehlgeschlagen" }`
  - `wire_enum! AusgangFehler { Voruebergehend => "voruebergehend", Abgelehnt => "abgelehnt", Ungewiss => "ungewiss", Ueberholt => "ueberholt", AnbindungFehlt => "anbindung_fehlt", AnbindungAngehalten => "anbindung_angehalten", AnbindungFehler => "anbindung_fehler", ZuGross => "zu_gross", Spiegel => "spiegel" }`
  - `zustand::naechster_versuch(erster: DateTime<Utc>, versuche: i64, jetzt: DateTime<Utc>) -> Option<DateTime<Utc>>` (`None` = Fenster vorbei)
  - `struct Versand { id: String, source_kind: QuelleArt, source_id: i64, channel: KanalArt, agency_id: Option<i64>, agency_name: String, address: String, subject: String, state: VersandZustand, error: Option<AusgangFehler>, smtp_status: Option<u16>, attempts: i64, created_by_id: i64, created_by_name: Option<String>, created_at: String, handed_over_at: Option<String> }` (Wire englisch; `inhalt` nicht auf dem Wire)
  - `struct NeuerVersand<'a> { org_id, einsatz_id, client_id: &'a str, quelle: QuelleArt, quelle_id: i64, kanal: &'a ExterneStelleKanal, stelle: &'a ExterneStelle, betreff: &'a str, inhalt: &'a str, erstellt_von_id: i64 }`
  - `repo::create_tx(conn, &NeuerVersand) -> Result<Versand, AppError>` (gleiche `(org_id, client_id)` → vorhandene Zeile)
  - `repo::list_fuer_quelle(pool, einsatz_id, QuelleArt, quelle_id) -> Result<Vec<Versand>, AppError>`, `repo::list_fuer_einsatz(pool, einsatz_id)`
  - `repo::load(conn, einsatz_id, id) -> Result<VersandZeile, AppError>` (inkl. `inhalt`, `org_id`, `versuch_begonnen_at`, `erster_versuch_at`)
  - `repo::retry_tx(conn, einsatz_id, id, jetzt) -> Result<Versand, AppError>` (nur aus `fehlgeschlagen`, sonst 422)
  - `repo::load_faellige(pool, jetzt, limit) -> Result<Vec<VersandZeile>, AppError>` (mit `nicht_gespiegelt("einsatz_id")` **nicht** filtern — der Lauf muss Spiegel erkennen und fehlschlagen lassen)
  - `repo::mark_begonnen(pool, id, jetzt)`, `repo::save_ergebnis_tx(conn, id, Ergebnis)` mit `enum Ergebnis { Uebergeben { at }, Wiederholen { naechster, fehler, status }, Fehlgeschlagen { fehler, status } }`
  - `repo::recover_unterbrochene(pool) -> Result<u64, AppError>` (Zeilen mit `versuch_begonnen_at` ⇒ `fehlgeschlagen`/`ungewiss`)

- [x] **Step 1: Migration** nach Spec 3 (inkl. `versuch_begonnen_at`, `UNIQUE(org_id, client_id)`, Index `(zustand, naechster_versuch_at)`, Index `(einsatz_id, quelle_art, quelle_id)`); PK TEXT (nanoid wie andere Tabellen mit TEXT-id).
- [x] **Step 2: Failing Tests** `src/ausgang/tests.rs`:
  - `backoff_30s_60s_120s_dann_5min_deckel` (`versuche` 1..=5 → +30, +60, +120, +240, +300 s)
  - `nach_30_minuten_keine_wiederholung` (`erster` vor 30 min 1 s → `None`)
  - `doppelte_client_id_liefert_denselben_versand`
  - `retry_nur_aus_fehlgeschlagen` (aus `wartet` → 422)
  - `unterbrochener_versuch_wird_ungewiss`
  - Wächter grün: `cargo test instanz::spiegel::art` und `cargo test schwaerzung`
- [x] **Step 3: Run** `cargo test ausgang::` → FAIL
- [x] **Step 4: Implementieren**
- [x] **Step 5: Run** → PASS, Wächter grün
- [x] **Step 6: Commit** `feat(ausgang): Ausgangskorb mit Zustand und Wiederholung (LLH-2093)`

### Task 7: Nachricht bauen

**Files:**
- Create: `src/ausgang/nachricht.rs`
- Modify: `src/vorlagendokument/repo.rs` (Rendern aus `freigeben_tx` herausziehen: `pub async fn render_freigabe<T: Dokumentart>(conn, einsatz_id, dok: &Dokument<T::Abschnitt>) -> Result<String, AppError>`; `freigeben_tx` ruft sie)
- Modify: `src/vorlagendokument/repo.rs`: `pub async fn is_juengste_freigabe<T: Dokumentart>(conn, einsatz_id, id) -> Result<bool, AppError>` über `quittierbar_column`
- Modify: `src/nachforderung/repo.rs`: `pub fn mail_text(n: &Nachforderung, einsatz_name: &str) -> String`

**Interfaces:**
- Produces:
  - `struct Schnappschuss { betreff: String, inhalt: String }`
  - `async fn schnappschuss_dokument<T: Dokumentart>(conn, einsatz_id, id, absender: &Absenderzeile) -> Result<Schnappschuss, AppError>` (422, wenn nicht freigegeben oder nicht jüngste Freigabe)
  - `async fn schnappschuss_nachforderung(conn, einsatz_id, id, absender) -> Result<Schnappschuss, AppError>` (422 bei `zurueckgezogen`/`abgelehnt`)
  - `struct Absenderzeile { name: String, funktion: Option<String> }` (für den Fuß)
  - `fn baue_mail(von_adresse: &str, von_name: Option<&str>, an: &str, message_id: &str, s: &Schnappschuss, anhaenge: &[(String, Vec<u8>)]) -> Result<Vec<u8>, AusgangFehler>` (lettre `Message::builder`, `text/plain; charset=utf-8`, PNG als `image/png`)
  - `async fn load_anhaenge<T: Dokumentart>(pool, einsatz_id, id) -> Result<Vec<(String, Vec<u8>)>, AppError>` (`anlage-{n}.png`; Summe > 20 MiB → `AusgangFehler::ZuGross`)
- Betreff exakt nach Spec 4; `nr` = `version` des Dokuments, wenn es keine eigene Nummer gibt (im Modell prüfen und eine Zeile im Code kommentieren).

- [x] **Step 1: Failing Tests**
  - `render_freigabe_gleicht_etb_text` (freigeben, ETB-`inhalt` == `render_freigabe` danach)
  - `ueberholte_fassung_ist_422` (fortschreiben + freigeben, alte id → 422)
  - `umlaute_in_betreff_und_name_sind_kodiert` (Review-Fokus 2: `Subject: =?utf-8?…?=` o. ä., Rückparse über lettre ergibt „Hochwasser Süd“)
  - `png_anlage_haengt_an` (Content-Type `image/png`, Dateiname `anlage-1.png`)
  - `nachforderung_text_enthaelt_anzahl_bezeichnung_begruendung`
- [x] **Step 2: Run** `cargo test ausgang::nachricht vorlagendokument` → FAIL
- [x] **Step 3: Implementieren**
- [x] **Step 4: Run** → PASS (bestehende Freigabe-Tests unverändert grün)
- [x] **Step 5: Commit** `feat(ausgang): Nachricht aus freigegebener Fassung bauen (LLH-2093)`

### Task 8: Lauf des Ausgangskorbs

**Files:**
- Create: `src/ausgang/lauf.rs`, `src/ausgang/zusteller.rs`
- Modify: `src/adapter/lauf.rs` (`pub async fn zugang_fuer_versand(pool, rahmen, org_id) -> Result<Result<Versandzugang, AusgangFehler>, AppError>`; nutzt `prepare`)
- Modify: `src/adapter/repo.rs` (`pub async fn load_smtp_fuer_org(pool, org_id) -> Result<Option<Adapter>, sqlx::Error>`), `src/live/mod.rs` (`LiveEvent::Ausgang => "ausgang"`, Leser je Quelle: `["lageberichte", "auftraege", "nachforderungen"]`), `src/app.rs` (Lauf starten, `Notify` in `AppState`)

**Interfaces:**
- Consumes: Task 4 `sende`, Task 5 `smtp_ziel`, Task 6 Repo, Task 7 `baue_mail`/`load_anhaenge`, `etb::repo::anlegen_tx`, `einsatz::einstellungen::laden_oder_default(..).etb_startwert()`.
- Produces:
  - `struct Versandzugang { einstellungen: Map<String, Value>, geheimnisse: HashMap<String, SecretString>, lan_erlaubt: bool, adapter_id: String }` (nicht `Debug`-ausgebend für Geheimnisse)
  - `trait Zusteller: Send + Sync { fn zustellen<'a>(&'a self, zugang: &'a Versandzugang, von: &'a str, an: &'a str, mail: &'a [u8]) -> BoxFuture<'a, Result<(), SmtpFehler>>; }`, `SmtpZusteller` (Produktion)
  - `pub fn start(pool, rahmen, live, zusteller: Arc<dyn Zusteller>, wecker: Arc<Notify>) -> JoinHandle<()>` (Takt 2 s oder Wecken; 4 parallel; beim Start `recover_unterbrochene`)
  - `pub async fn durchgang(pool, rahmen, live, zusteller, jetzt) -> Result<(), AppError>` (für Tests)
- Ablauf je Zeile (in dieser Reihenfolge): Spiegel? → `Fehlgeschlagen{Spiegel}` ohne ETB; Quelle überholt/zurückgezogen? → `Fehlgeschlagen{Ueberholt}` + ETB; Zugang holen (fehlt → `AnbindungFehlt`, angehalten → `AnbindungAngehalten`); `mark_begonnen`; Anhänge laden; Mail bauen; zustellen (ohne DB-Verbindung); Ergebnis + ETB-Eintrag in einer Transaktion (`write_retry!`), `etb_eintrag_id` setzen; nach Commit `live.publiziere(einsatz_id, etb_id)` und `live.publiziere_einsatz(einsatz_id, LiveEvent::Ausgang)`; bei `SmtpFehler::{Anmeldung, Tls}` zusätzlich `adapter::repo::postpone(pool, adapter_id, jetzt)`.
- ETB-Text nach Spec 6; `erfasser_id = erstellt_von_id`, `an = stelle_bezeichnung`, `typ` wie bei `nachforderung::repo::protokollieren_tx`; Lauf in `etb::nachlauf::klammer`.
- Fehlerzuordnung: `Voruebergehend|Verbindung|Zeitueberschreitung|Dns` → wiederholen (solange `naechster_versuch` `Some`), sonst `Fehlgeschlagen{Voruebergehend}`; `Abgelehnt(_)` → `Abgelehnt`; `Ungewiss` → `Ungewiss`; `Anmeldung|Tls|ZielIntern|Antwort` → `AnbindungFehler`.

- [x] **Step 1: Failing Tests** `tests/ausgang_lauf.rs` mit skriptbarem `Zusteller`-Doppel und Test-`Rahmen` (SMTP-Adapter + Passwort angelegt):
  - `freigegebener_lagebericht_wird_uebergeben_und_steht_im_etb` (ETB `an` = Stelle, Text enthält „übergeben“ und Adresse)
  - `450_wird_wiederholt_dann_uebergeben` (zweiter Durchgang nach 30 s)
  - `nach_30_minuten_vorübergehend_fehlgeschlagen`
  - `abgelehnt_sofort_fehlgeschlagen_mit_etb`
  - `neuere_freigabe_im_fenster_macht_ueberholt` (wartende Zeile, dann fortschreiben+freigeben → `ueberholt`, nichts zugestellt)
  - `spiegel_nach_anlegen_fehlgeschlagen_ohne_etb` (`als_spiegel_markieren` vor dem Durchgang)
  - `angehaltene_anbindung_fehlgeschlagen`
  - `anmeldefehler_zieht_adapterpruefung_vor` (`naechster_lauf_at` der Anbindung ≤ jetzt)
  - Review-Fokus 4: `neustart_mit_begonnenem_versuch_ist_ungewiss_und_wird_nicht_zugestellt`
  - `kein_geheimnis_im_etb_oder_fehler` (Passwort-Text kommt in keiner ETB-Zeile und keiner Spalte von `ausgang` vor)
- [x] **Step 2: Run** `cargo test --test ausgang_lauf` → FAIL
- [x] **Step 3: Implementieren**
- [x] **Step 4: Run** → PASS; `cargo test --test adapter_lauf` grün
- [x] **Step 5: Commit** `feat(ausgang): Lauf stellt zu und schreibt ins ETB (LLH-2093)`

### Task 9: Routen

**Files:**
- Create: `src/routes/ausgang.rs`
- Modify: `src/app.rs` (Routen bei Lagebericht 1785–1870, Befehl, Nachforderung 1041–1070), `src/api_doc.rs`, `scripts/api-routen-woerter.tsv` (`deliveries	Versände`)
- Test: `tests/ausgang_routen.rs`

**Interfaces:**
- Consumes: Task 6/7, `fordere_schreiben::<T>` (aus `routes/vorlagendokument.rs` zugänglich machen), `EinsatzSchreibzugriff<Nachforderungen>`, Lesezugriffe der Module.
- Produces:
  - `#[derive(Deserialize)] struct CreateDeliveriesBody { client_id: String, recipients: Vec<RecipientBody> }`, `struct RecipientBody { channel_id: i64 }` (`client_id` je Empfänger abgeleitet: `{client_id}:{channel_id}`)
  - Handler `create_deliveries_lagebericht`, `create_deliveries_befehl`, `create_deliveries_nachforderung` → `201 Json<Vec<Versand>>`
  - `list_deliveries` (`GET /api/einsaetze/{id}/deliveries?source_kind&source_id`), `retry_delivery` (`POST …/deliveries/{did}/retry`)
  - Prüfreihenfolge im Anlegen: Recht → Einsatz aktiv → Spiegel (422 `spiegel`) → Empfänger nicht leer, höchstens 20 (400) → jede Kanaladresse in Org, Stelle aktiv, Kanal freigeschaltet (404/422) → SMTP-Anbindung da und nicht angehalten (422 mit Code) → Schnappschuss (422) → Anhänge ≤ 20 MiB (422 `zu_gross`) → `create_tx` je Empfänger in **einer** Transaktion → Wecker `notify_one()` → `publiziere_einsatz(Ausgang)`.
  - 422-Antworten tragen den `AusgangFehler`-Code maschinenlesbar (Muster für 422 mit Code im Repo suchen und übernehmen).

- [x] **Step 1: Failing Tests**
  - `senden_legt_je_empfaenger_einen_versand_an`
  - Review-Fokus 3: `doppelklick_mit_gleicher_client_id_ein_versand`
  - `entwurf_senden_ist_422`, `ohne_mailserver_ist_422_anbindung_fehlt`, `spiegel_ist_422`
  - `leser_ohne_schreibrecht_403`, `fremde_kanaladresse_404`
  - `erneut_senden_aus_fehlgeschlagen_setzt_wartet`, `erneut_senden_ueberholter_fassung_422`
  - `nachforderung_zurueckgezogen_ist_422`
- [x] **Step 2: Run** `cargo test --test ausgang_routen` → FAIL
- [x] **Step 3: Implementieren**
- [x] **Step 4: Run** → PASS; `scripts/check-api-routen.sh`; `scripts/check-typ-codegen.sh`
- [x] **Step 5: Commit** `feat(ausgang): Routen zum Senden und Wiederholen (LLH-2093)`

### Task 10: Senden-Dialog und Versandliste (Frontend)

**Files:**
- Create: `frontend/src/api/ausgang.ts`, `frontend/src/ausgang/SendenDialog.tsx`, `frontend/src/ausgang/Versandliste.tsx`, `frontend/src/ausgang/empfaengerVorschlag.ts`, Tests daneben
- Modify: `frontend/src/api/queryKeys.ts` (`einsatzKeys.deliveries(einsatzId, kind, id)`; live über `EINSATZ_STREAM_EVENTS.ausgang`; nicht in `LAGEBILD_OFFLINE`), `frontend/src/live/liveInvalidierung.ts`
- Modify: `frontend/src/pages/LageberichtDetailPage.tsx` (Aktion neben „Fortschreiben“, nur `freigegeben`), `frontend/src/pages/BefehlDetailPage.tsx` (Aktionsleiste), `frontend/src/nachforderungen/NachforderungKarte.tsx` (Menüeintrag + Liste)
- Modify: `frontend/src/components/erfassungsVerb.guard.test.ts` (Verb „Senden“ mit Begründung)
- Modify: `frontend/src/api/adapter.ts` (nichts, falls Feldtyp schon in Task 3)

**Interfaces:**
- Consumes: Task 9-Routen, Task 2 `list_email` (Frontend lädt Stellen + Kanäle; ggf. Sammelroute `GET /api/external-agencies/channels?channel=email` in Task 1 ergänzen, falls N+1 entstünde — **dann in Task 1 nachziehen**).
- Produces:
  - `empfaengerVorschlag(kanaele: KanalMitStelle[], namen: string[]): Set<number>` (Vergleich ohne Groß/Klein und Leerraum)
  - `<SendenDialog quelle={{kind, id}} vorschlagNamen={string[]} betreff vorschauText anhaenge={{anzahl, bytes}} />`
  - `<Versandliste einsatzId quelle />` mit Zustandstexten: „wartet“, „übergeben HH:MM“, „fehlgeschlagen: {Text}“, „Zustellung unklar“; Knopf „Erneut senden“ bei `fehlgeschlagen`.
- Texte der `AusgangFehler`-Codes in `frontend/src/api/ausgang.ts` (`AUSGANG_FEHLER_TEXT`), etwa `anbindung_fehlt` → „Kein Mailserver eingerichtet“, `ueberholt` → „Neuere Fassung freigegeben“, `ungewiss` → „Zustellung unklar“, `spiegel` → „Einsatz wird von einer anderen Instanz geführt“.

- [x] **Step 1: Failing Tests**
  - `empfaengerVorschlag.test.ts`: „Leitstelle  Nord“ trifft „leitstelle nord“; „Nord“ trifft nicht „Leitstelle Nord“
  - `SendenDialog.test.tsx`: vorbelegt angehakt; „Senden“ schickt `{client_id, recipients:[{channel_id}]}` einmal; 422 `anbindung_fehlt` zeigt „Kein Mailserver eingerichtet“; ohne Adressen gesperrt mit Grund „Keine Mailadresse hinterlegt“
  - `Versandliste.test.tsx`: zeigt Zustände; „Erneut senden“ nur bei `fehlgeschlagen`, POST an `/retry`
  - Verb-Wächter grün
- [x] **Step 2: Run** `mise exec -- pnpm -C frontend vitest run src/ausgang` → FAIL
- [x] **Step 3: Implementieren** (`ErfassungsModal`, Fokus im ersten Feld, `SOFORT_ODER_NIE`, ohne Netz gesperrt mit „Ohne Netz nicht möglich“)
- [x] **Step 4: Run** → PASS; `mise exec -- pnpm -C frontend lint`, `… typecheck`
- [x] **Step 5: Commit** `feat(ausgang): Senden-Dialog und Versandliste (LLH-2093)`

### Task 11: Regel, Entscheidung, Doku

**Files:**
- Create: `docs/architektur/entscheidungen/ADR-0100-nachrichten-an-menschen-gehen-nur-ueber-den-ausgangskorb.md` (Nummer vorher gegen `origin/alpha` und offene PRs prüfen)
- Modify: `src/AGENTS.md` (Abschnitt „Ausgang an Menschen“, Ergänzung „Adapter“: Versandweg, `zugang_fuer_versand`), `AGENTS.md`-Tabelle nur falls eine neue Bereichsdatei entsteht (keine geplant)
- Modify: `docs/architektur/` nach Mitänderungsregel (Bausteinsicht, Laufzeitsicht)
- Modify: `docs/anwender/` Kapitel „Senden an Externe Stellen“ nach `docs/anwender/AGENTS.md` (Bilder über den Bildlauf, falls dort Pflicht)

- [x] **Step 1:** ADR schreiben (Inhalt Spec 8), `scripts/check-adr-nummern.sh`
- [x] **Step 2:** `src/AGENTS.md` ergänzen; Verweise im Code (`// src/AGENTS.md, Ausgang an Menschen`) an `src/ausgang/mod.rs`
- [x] **Step 3:** Architektur- und Anwenderdoku; deren Wächter (`./scripts/check-all.sh --nur` für die Doku-Schritte, Namen im Skriptkopf)
- [x] **Step 4: Commit** `docs(ausgang): ADR, Regel und Anwenderdoku (LLH-2093)`

### Task 12: e2e und Gesamtprüfung

**Files:**
- Create: `frontend/e2e/ausgang.spec.ts` (Muster und Regeln aus `frontend/e2e/AGENTS.md`)
- Modify: Testbetrieb: ein `Zusteller`-Doppel, das im e2e-Server (Feature/Schalter der e2e-Suite) statt SMTP greift

- [x] **Step 1: Failing e2e** „Lagebericht freigeben → Senden an Leitstelle → Versandliste zeigt ‚übergeben‘“
- [x] **Step 2: Run** e2e-Einzeltest nach `frontend/e2e/AGENTS.md` → FAIL, dann implementieren → PASS
- [x] **Step 3: Gesamtprüfung** `./scripts/check-all.sh --geaendert --ohne-e2e` → grün
- [x] **Step 4: Commit** `test(ausgang): e2e Senden eines Lageberichts (LLH-2093)`
