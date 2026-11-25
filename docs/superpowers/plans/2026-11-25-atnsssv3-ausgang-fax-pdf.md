# Ausgang per Fax (sipgate) und PDF am Server — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fax über sipgate als zweiter Kanal im Ausgangskorb, mit PDF am Server (auch als
Mail-Anhang) und dem Zustand „zugestellt“.

**Architecture:** Der Ausgangskorb aus LLH-2093 (`src/ausgang/`) wird kanalbewusst: ein Korb,
ein Lauf, je Kanal eine Adapter-Art und ein Zusteller. Ein reines Rust-Modul
`src/ausgang/pdf.rs` baut das PDF aus Schnappschuss und PNG-Anlagen. Faxe auf `uebergeben` fragt
derselbe Lauf bei sipgate nach, bis `zugestellt` oder `fehlgeschlagen`.

**Tech Stack:** Rust (axum, sqlx/SQLite, reqwest, `printpdf` neu), React/TypeScript (antd),
Playwright.

**Spec:** `docs/superpowers/specs/2026-11-25-atnsssv3-ausgang-fax-pdf-design.md`

Zunder: https://zunder.rubeen.dev/#/aufgabe/atnsssv3lxb9m7h4r2rkr8ag

## Global Constraints

- Bezeichner: Fachbegriffe deutsch, Technik englisch; Wire-Felder neuer Felder im Typ `Versand`
  englisch (der Typ ist englisch); Grenzwerte wie `smtp_status`, `fehler_status`, `zustand`
  werden nicht umbenannt (AGENTS.md, Bezeichner-Sprache).
- Prosa deutsch: Kommentare, Commits, UI-Texte, Testnamen als Satz.
- Kein `.decrypt(` in `src/ausgang/**` und `src/routes/ausgang.rs`; Geheimnisse nur über
  `adapter::lauf::zugang_fuer_versand` (ADR-0104).
- Keine DB-Verbindung während Netz-I/O; höchstens 4 Versände parallel (`PARALLEL`).
- Kein neuer Korb, kein neuer Lauf: neuer Kanal = Adapter-Art mit Versandweg (ADR-0104).
- PDF: A4 hochkant, 20 mm Rand, schwarz auf weiß, eingebettete Archivo (OFL) Regular/Bold.
- Fax-Grenze: höchstens **30 Seiten** und **10 MiB** (`10 * 1024 * 1024`), **nur für Fax**.
- Mail-Anhänge zusammen höchstens 20 MiB (bestehend, `ANHANG_MAX_BYTES`), PDF zählt mit.
- Backoff Fax-Absenden wie E-Mail: 30 s · 2ⁿ, Deckel 5 min, Fenster 30 min.
- Nachfragen: erste nach **30 s**, dann alle **60 s**, Frist **120 min** → `fehlgeschlagen` /
  `ungewiss`.
- sipgate: `POST https://api.sipgate.com/v2/sessions/fax`
  (`faxlineId`, `recipient`, `filename`, `base64Content`) → `sessionId`;
  `GET https://api.sipgate.com/v2/history/{sessionId}` → `faxStatusType`
  (`PENDING|SENDING|SCHEDULED|SENT|FAILED`). Basic-Auth `token_id:token`.
- Nach jeder Response-DTO-/Enum-Änderung `scripts/check-typ-codegen.sh`, beide generierten
  Dateien mitcommitten (`src/AGENTS.md`).
- Migration mit Tabellenumbau nach `migrations/AGENTS.md` („Tabellenumbau und
  `-- no-transaction`“); Nummer nach Migrationsvergabe dort.
- Node/pnpm nur über `mise exec --`. Vor dem PR `./scripts/check-all.sh --geaendert --ohne-e2e`.

## Review Focus

1. **Faxnummer in Alltagsform** („0511 / 123 45-6“, „+49 (0) 511 …“): wird zu `+49511…`, das
   „(0)“ nach Länderkennung fällt weg → Test in Task 1.
2. **Sitzung bricht nach dem Absenden ab** (Timeout nach Verbindungsaufbau): kein zweites Fax,
   Zustand `ungewiss` → Test in Task 6.
3. **Server-Neustart, während ein Fax auf `uebergeben` steht**: Nachfragen läuft weiter, kein
   erneutes Senden, kein `ungewiss` durch die Wiederaufnahme → Test in Task 7.
4. **Lagebericht mit sehr langem Wort / langer URL** im Text: bricht hart um, kein Überlauf, keine
   Panik → Test in Task 3.
5. **Ein Absenden an Mail und Fax zugleich, das Fax-PDF ist zu groß**: der ganze Antrag wird mit
   `zu_gross` abgelehnt, damit nichts halb rausgeht und der Mensch bewusst neu wählt → Test in
   Task 5.

---

## Dateiplan

| Datei | Verantwortung |
| --- | --- |
| `src/externe_stelle/kanal.rs` | `normalize_fax`, `list_fuer_org(kanal)` |
| `src/externe_stelle/mod.rs` | `KanalArt::is_freigeschaltet`, `KanalArt::adapter_art` |
| `src/routes/externe_stelle.rs` | Fax prüfen, Sammlung für `email` und `fax` |
| `migrations/0386_ausgang_fax.sql` | Umbau `ausgang` (neue Werte, neue Spalten) |
| `src/ausgang/zustand.rs` | `Zugestellt`, `NichtZugestellt`, Abfrage-Konstanten, `naechste_abfrage` |
| `src/ausgang/mod.rs` | `Versand.delivered_at`, `Versand.without_pdf`, `VersandZeile`-Spalten |
| `src/ausgang/pdf.rs` (neu) | `baue_pdf`, Fax-Grenze, Dateiname |
| `assets/schriften/` (neu) | `Archivo-Regular.ttf`, `Archivo-Bold.ttf`, `OFL.txt` |
| `src/adapter/sipgate.rs` (neu) | HTTP-Client sipgate (senden, status, prüfen), `SipgateFehler` |
| `src/adapter/sipgate_fax_art.rs` (neu) | Adapter-Art `sipgate_fax` |
| `src/adapter/lauf.rs`, `src/adapter/repo.rs` | Zugang je Kanal |
| `src/ausgang/zusteller.rs` | `FaxZusteller`, `SipgateZusteller`, Test-Doppelgänger, `Zustellwege` |
| `src/ausgang/lauf.rs` | Verzweigung je Kanal, PDF an Mail, Fax senden, Nachfragen |
| `src/ausgang/repo.rs` | `Ergebnis` erweitert, `load_abzufragende`, `save_abfrage_tx` |
| `src/routes/ausgang.rs` | Prüfung je Kanal, Fax-PDF-Grenze beim Anlegen |
| `frontend/src/stammdaten/ExterneStelleKanaele.tsx` | Fax anlegen |
| `frontend/src/ausgang/*` | Dialog beide Kanäle, Versandliste neue Zustände |
| `docs/…` | ADR, AGENTS, arc42, Anwenderdoku, Konzept |

---

### Task 1: Kanal `fax` freischalten und Faxnummern prüfen

**Files:**
- Modify: `src/externe_stelle/kanal.rs` (neben `normalize_email`, `list_email_fuer_org` → `list_fuer_org`)
- Modify: `src/externe_stelle/mod.rs:42-55` (`KanalArt`)
- Modify: `src/routes/externe_stelle.rs:145-185` (`parse_kanal`, `pruefe_adresse`, Sammlung)
- Test: `src/externe_stelle/tests.rs`, `tests/externe_stelle_kanal.rs`

**Interfaces:**
- Produces: `pub fn normalize_fax(roh: &str) -> Result<String, String>`;
  `pub async fn list_fuer_org(pool, org_id: i64, kanal: KanalArt) -> Result<Vec<…>, AppError>`
  (gleicher Rückgabetyp wie bisher `list_email_fuer_org`);
  `KanalArt::adapter_art(self) -> Option<&'static str>` (`Email` → `adapter::smtp_art::CODE`,
  `Fax` → `adapter::sipgate_fax_art::CODE`, sonst `None`; bis Task 4 liefert `Fax` die
  Konstante `"sipgate_fax"` aus einer vorläufigen `pub const` in `sipgate_fax_art.rs`, die Task 4
  füllt).

- [ ] **Step 1: Failing tests schreiben**

```rust
#[test]
fn faxnummern_in_alltagsform_werden_e164() {
    assert_eq!(normalize_fax("0511 / 123 45-6").unwrap(), "+49511123456");
    assert_eq!(normalize_fax("+49 (0) 511 123456").unwrap(), "+49511123456");
    assert_eq!(normalize_fax("0049 511 123456").unwrap(), "+49511123456");
    assert_eq!(normalize_fax("+43 1 5880").unwrap(), "+4315880");
    assert!(normalize_fax("511 123").is_err());       // ohne 0, 00 oder +
    assert!(normalize_fax("+49 12").is_err());        // unter 8 Ziffern
    assert!(normalize_fax("+49 1234 5678 9012 34").is_err()); // über 15 Ziffern
    assert!(normalize_fax("0511 abc").is_err());
}
// Property-Test (proptest, wie die bestehenden in src/externe_stelle/tests.rs):
// jede Ausgabe passt auf ^\+[1-9][0-9]{7,14}$, und normalize_fax(ausgabe) == ausgabe.
```

Routen-Tests in `tests/externe_stelle_kanal.rs`: Fax-Adresse anlegen liefert 201 mit
`address == "+49511123456"`; ungültige Nummer → 400; `channel=matrix` und `channel=threema`
bleiben 400 „noch nicht freigeschaltet“ (ersetzt `fax_ist_noch_nicht_freigeschaltet`);
`GET /api/external-agencies/channels?channel=fax` liefert nur Fax-Adressen der Org.

- [ ] **Step 2: Tests laufen lassen, sie scheitern**

Run: `cargo test --lib externe_stelle && cargo test --test externe_stelle_kanal`
Expected: FAIL (`normalize_fax` fehlt, Fax gesperrt)

- [ ] **Step 3: Umsetzen**

`normalize_fax`: Zeichen ` -/().` entfernen; `(0)` direkt nach einer Länderkennung entfällt
(vor dem Entfernen der Klammern behandeln); `+` → Rest; `00` → `+`; `0` → `+49` + Rest; sonst
Fehler. Ergebnis gegen `^\+[1-9][0-9]{7,14}$`. Fehlertexte deutsch („Keine gültige
Faxnummer“). `is_freigeschaltet` gilt für `Email | Fax`. `pruefe_adresse` verzweigt auf
`normalize_fax`. Die Sammlungsroute nimmt jeden freigeschalteten Kanal, ohne `debug_assert`.

- [ ] **Step 4: Tests laufen lassen, sie bestehen** (gleiche Kommandos, PASS)

- [ ] **Step 5: Commit** — `feat(externe-stelle): Faxnummern als Kanaladresse (LLH-2095)`

---

### Task 2: Datenmodell „zugestellt“, „nicht zugestellt“, Abfrage und „ohne PDF“

**Files:**
- Create: `migrations/0386_ausgang_fax.sql` (Nummer nach `migrations/AGENTS.md` prüfen)
- Modify: `src/ausgang/zustand.rs`, `src/ausgang/mod.rs`, `src/ausgang/repo.rs` (Anzeige-Mapping)
- Modify: `tests/enum_wire_kontrakt.rs`, `src/ausgang/tests.rs` (`check_listen_entsprechen_den_enums`)
- Regenerate: `frontend/src/api/openapi.json`, `frontend/src/api/types.generated.ts` (Pfade wie `scripts/check-typ-codegen.sh` sie nennt)

**Interfaces:**
- Produces:
  - `VersandZustand::Zugestellt => "zugestellt"`, `AusgangFehler::NichtZugestellt => "nicht_zugestellt"`
  - Spalten `anbieter_ref TEXT NULL`, `zugestellt_at TEXT NULL`, `naechste_abfrage_at TEXT NULL`,
    `ohne_pdf INTEGER NOT NULL DEFAULT 0 CHECK (ohne_pdf IN (0,1))`; in `VersandZeile` als
    `anbieter_ref: Option<String>`, `zugestellt_at: Option<String>`,
    `naechste_abfrage_at: Option<String>`, `ohne_pdf: bool`
  - `Versand.delivered_at: Option<String>` (skip if none), `Versand.without_pdf: bool`
  - in `zustand.rs`: `pub const ABFRAGE_ERSTE_S: i64 = 30; pub const ABFRAGE_TAKT_S: i64 = 60;
    pub const ABFRAGE_FRIST_MINUTEN: i64 = 120;`,
    `pub fn erste_abfrage(uebergeben: DateTime<Utc>) -> DateTime<Utc>` (= `uebergeben + 30 s`) und
    `pub fn naechste_abfrage(uebergeben: DateTime<Utc>, jetzt: DateTime<Utc>) -> Option<DateTime<Utc>>`
    (`None`, wenn `jetzt - uebergeben > 120 min`; sonst `jetzt + 60 s`)

- [ ] **Step 1: Failing tests** — `check_listen_entsprechen_den_enums` deckt die neuen Werte im
  CHECK ab; Wire-Kontrakt um `zugestellt`, `nicht_zugestellt`; Unit-Test
  `abfrage_erst_nach_30s_dann_jede_minute_und_nach_zwei_stunden_nicht_mehr`
  (`erste_abfrage(t0) == t0+30s`; `naechste_abfrage(t0, t0+31s) == Some(t0+91s)`;
  `naechste_abfrage(t0, t0+121min) == None`).
- [ ] **Step 2:** `cargo test --lib ausgang && cargo test --test enum_wire_kontrakt` → FAIL
- [ ] **Step 3:** Migration als Tabellenumbau (neue CHECKs für `zustand` und `fehler_art`,
  vier Spalten, Indizes und Trigger von 0383 neu anlegen, Daten kopieren). Zusätzlicher Index
  `ausgang_abfrage_idx ON ausgang(naechste_abfrage_at) WHERE zustand = 'uebergeben' AND anbieter_ref IS NOT NULL`.
  Enums, Konstanten, `naechste_abfrage`, DTO-Felder, Mapping in `repo.rs`. Codegen laufen lassen.
- [ ] **Step 4:** Tests + `scripts/check-typ-codegen.sh` → PASS
- [ ] **Step 5: Commit** — `feat(ausgang): Zustand zugestellt und Abfrage im Datenmodell (LLH-2095)`

---

### Task 3: PDF am Server

**Files:**
- Create: `src/ausgang/pdf.rs`, `assets/schriften/Archivo-Regular.ttf`, `assets/schriften/Archivo-Bold.ttf`, `assets/schriften/OFL.txt`
- Modify: `Cargo.toml` (`printpdf`, ggf. `ttf-parser` für Breiten), `src/ausgang/mod.rs` (`pub mod pdf;`)
- Create: `docs/architektur/entscheidungen/ADR-0106-ein-pdf-entsteht-am-server-nur-fuer-den-ausgang.md` (nächste freie Nummer prüfen; Form und Prüfzeilen nach `docs/architektur/AGENTS.md`)
- Modify: `frontend/src/druck/AGENTS.md` (Verweis auf die Ausnahme), Prüfskript der ADR-Regeln, wie `docs/architektur/AGENTS.md` es nennt

**Interfaces:**
- Produces:
```rust
pub struct PdfVorlage<'a> {
    pub absender: &'a str,        // absender_kennung der Fax-Anbindung oder Org-Name
    pub erzeugt_at: DateTime<Utc>,// erscheint als Ortszeit Europe/Berlin „25.11.2026 17:40“
    pub uebung: bool,
    pub betreff: &'a str,
    pub an: &'a str,              // „Leitstelle Nord (Fax +49…)“ bzw. „… (a@b.de)“
    pub einsatz: &'a str,
    pub inhalt: &'a str,          // Schnappschuss-Inhalt, wie der Mailtext
    pub anlagen: &'a [(String, Vec<u8>)], // PNG wie aus load_anhaenge
}
pub struct PdfDatei { pub bytes: Vec<u8>, pub seiten: usize }
pub enum PdfFehler { Bild(usize), Erzeugung }   // Bild(n): Anlage n nicht lesbar
pub const FAX_SEITEN_MAX: usize = 30;
pub const FAX_BYTES_MAX: usize = 10 * 1024 * 1024;
pub fn baue_pdf(v: &PdfVorlage<'_>) -> Result<PdfDatei, PdfFehler>;
pub fn passt_fuer_fax(d: &PdfDatei) -> bool;
pub fn dateiname(quelle: QuelleArt, version: Option<i64>) -> String; // lagebericht-3.pdf, befehl-2.pdf, nachforderung.pdf
```

- [ ] **Step 1: Failing tests** (in `pdf.rs`, `#[cfg(test)]`):
  - `ein_kurzer_text_ergibt_eine_seite`: `seiten == 1`, `bytes` beginnt mit `%PDF-`.
  - `jede_anlage_bekommt_eine_eigene_seite`: Text + 2 PNG (mit `image` erzeugt, 1×1 und 4000×1000) → `seiten == 3`.
  - `umlaute_und_eszett_stehen_im_pdf`: Text „Größe Übergabe Straße“ ist nach Text-Extraktion
    (`lopdf` als dev-dependency oder Suche nach den Glyphen im entpackten Content-Stream) enthalten.
  - `uebung_steht_nur_bei_einer_uebung_im_kopf`: „ÜBUNG“ enthalten bei `uebung: true`, nicht bei `false`.
  - `ein_ueberlanges_wort_bricht_hart_um`: 500 × „x“ ohne Leerzeichen → kein Panic, `seiten >= 1`.
  - `langer_text_macht_mehrere_seiten_mit_seitenzahl`: 400 Absätze → `seiten > 1`, „Seite 2 von“ enthalten.
  - `gleiche_eingabe_gleiche_bytes`: zweimal `baue_pdf` mit gleicher Vorlage → identische Bytes.
  - `kaputte_anlage_ist_bild_fehler`: Anlage `b"kein png"` → `Err(PdfFehler::Bild(1))`.
  - `fax_grenze`: `passt_fuer_fax` false bei 31 Seiten bzw. > 10 MiB, true bei 30 Seiten.
- [ ] **Step 2:** `cargo test --lib ausgang::pdf` → FAIL
- [ ] **Step 3:** Umsetzen. Layout: Kopfzeile klein (Absender links, Zeit rechts); bei Übung
  „ÜBUNG“ fett 20 pt; Betreff fett 14 pt; „An: …“, „Einsatz: …“ 10 pt; Linie; Text 10,5 pt,
  Zeilenabstand 1,3, Umbruch an Leerzeichen mit gemessener Breite, harter Umbruch für Wörter
  breiter als die Zeile, Leerzeilen bleiben Absätze. Anlagen: je Seite „Anlage n“ 12 pt fett, Bild
  proportional eingepasst; ist das Bild breiter als hoch, Seite A4 quer. Fuß jeder Seite
  „Seite x von y · Lifeline Hub“ 8 pt. Feste Metadaten (Erzeuger „Lifeline Hub“, Datum =
  `erzeugt_at`, feste Dokument-ID aus Hash der Eingabe). Schriften per `include_bytes!`.
  ADR schreiben (MUST: PDF nur in `src/ausgang/pdf.rs`, nur aus Schnappschuss und Anlagen;
  MUST NOT: Browser oder Systemschrift im Laufzeitbild; Prüfung: `printpdf` nur in
  `src/ausgang/pdf.rs`). `frontend/src/druck/AGENTS.md`: Satz „Gedruckt wird über den Browser,
  nie auf dem Server“ um „Ausnahme: das PDF des Ausgangs, ADR-0106“ ergänzen.
- [ ] **Step 4:** Tests + `scripts/adr-fuer.sh src/ausgang/pdf.rs` + Lizenz-/Advisory-Prüfung
  laut `scripts/AGENTS.md` → PASS
- [ ] **Step 5: Commit** — `feat(ausgang): PDF des Ausgangs am Server (LLH-2095)`

---

### Task 4: Adapter-Art „Fax (sipgate)“ und sipgate-Client

**Files:**
- Create: `src/adapter/sipgate.rs`, `src/adapter/sipgate_fax_art.rs`
- Modify: `src/adapter/mod.rs`, `src/adapter/art.rs:269-273` (`Verzeichnis::produktiv`)
- Modify: `frontend/src/pages/einstellungen/adapterAnzeige.ts` (Name „Fax (sipgate)“, Symbol)
- Test: in den neuen Dateien und `tests/` nach Muster der SMTP-Art-Tests

**Interfaces:**
- Produces:
```rust
// sipgate.rs
pub const API: &str = "https://api.sipgate.com/v2";
pub enum SipgateFehler { Status(u16), Verbindung, Dns, Ungewiss, Antwort, ZielIntern }
impl SipgateFehler { pub fn status(&self) -> Option<u16>; }
pub struct FaxAuftrag<'a> { pub faxline_id: &'a str, pub empfaenger: &'a str, pub dateiname: &'a str, pub pdf: &'a [u8] }
pub enum FaxStatus { Laeuft, Gesendet, Gescheitert }   // PENDING|SENDING|SCHEDULED → Laeuft
pub fn parse_fax_status(s: &str) -> Option<FaxStatus>;
pub async fn senden(client: &reqwest::Client, token_id: &str, token: &SecretString, a: &FaxAuftrag<'_>) -> Result<String, SipgateFehler>;
pub async fn status(client: &reqwest::Client, token_id: &str, token: &SecretString, session: &str) -> Result<FaxStatus, SipgateFehler>;
// sipgate_fax_art.rs
pub const CODE: &str = "sipgate_fax";
pub struct SipgateFaxArt { … }   // impl AdapterArt, produktiv() und new(pruefer) wie SmtpArt
```
- Fehlerklassen von `senden`: Antwort mit Status ≠ 2xx → `Status(code)`; `is_connect()` →
  `Verbindung`; DNS-Fehler → `Dns`; Zielschutz → `ZielIntern`; jeder andere Fehler **nach**
  Verbindungsaufbau (inkl. Timeout) → `Ungewiss`; 2xx ohne lesbare `sessionId` → `Antwort`.

- [ ] **Step 1: Failing tests**:
  `fax_status_werte_werden_eingeordnet` (`PENDING`, `SENDING`, `SCHEDULED` → `Laeuft`, `SENT`
  → `Gesendet`, `FAILED` → `Gescheitert`, `"x"` → `None`); Art: Felder `token_id`, `faxline_id`
  (Pflicht, `^f[0-9]+$`, sonst Feldfehler), `absender_kennung` optional ≤ 100 Zeichen,
  Platz `token` Pflicht; „Verbindung prüfen“ mit Skript-Prüfer: Erfolg → `OhneUebernahme(0)`,
  401 → `AdapterFehler` der Anmeldung; zweite `sipgate_fax`-Anbindung derselben Org → 409 (wie
  SMTP). Ein Test mit lokalem axum-Server **nur** für die Request-Form ist nicht möglich
  (fester Host); stattdessen `fn fax_body(a: &FaxAuftrag) -> serde_json::Value` als reine
  Funktion testen: Felder `faxlineId`, `recipient`, `filename`, `base64Content` (Base64 der
  PDF-Bytes).
- [ ] **Step 2:** `cargo test --lib adapter::sipgate` → FAIL
- [ ] **Step 3:** Umsetzen. HTTP über den Zielschutz wie `AbrufKontext::request` (kein Redirect,
  `http_begrenzt` für Antworten, Deckel 64 KiB). Prüfung: authentifiziertes GET auf einen
  Endpunkt, der Token und Faxline prüft (aus `https://api.sipgate.com/v2/doc` wählen; Kandidat
  `GET /v2/authorization/userinfo`). Periodischer Lauf nur Prüfung, Intervall ≥ 15 min. Höchstens
  eine Anbindung je Org wie bei SMTP.
- [ ] **Step 4:** Tests → PASS
- [ ] **Step 5: Commit** — `feat(adapter): Anbindung Fax über sipgate (LLH-2095)`

---

### Task 5: Zugang und Anlegen je Kanal

**Files:**
- Modify: `src/adapter/repo.rs:150` (`load_smtp_fuer_org` → `load_fuer_org`)
- Modify: `src/adapter/lauf.rs:319-370` (`pruefe_versand_moeglich`, `zugang_fuer_versand`, `Versandzugang`)
- Modify: `src/routes/ausgang.rs` (`anlegen`)
- Test: `tests/ausgang_routen.rs`

**Interfaces:**
- Consumes: `KanalArt::adapter_art` (Task 1), `pdf::{baue_pdf, passt_fuer_fax, PdfVorlage}` (Task 3)
- Produces:
  - `repo::load_fuer_org(pool, org_id: i64, art: &str) -> Result<Option<Adapter>, sqlx::Error>`
  - `pruefe_versand_moeglich(pool, rahmen, org_id, kanal: KanalArt)`,
    `zugang_fuer_versand(pool, rahmen, org_id, kanal: KanalArt)` (sonst unverändert)
  - `Versandzugang::einstellung(&self, name: &str) -> Option<&str>` (öffentlich; `absender()`
    und `absender_name()` bleiben)
  - `nachricht::pdf_vorlage_laden(conn, einsatz_id, absender_kennung: Option<&str>) -> Result<PdfKopf, AppError>`
    mit `pub struct PdfKopf { pub absender: String, pub einsatz: String, pub uebung: bool }`
    (Übung über `einsatz`-Art `uebung`, `src/einsatz/mod.rs:81`)

- [ ] **Step 1: Failing tests** in `tests/ausgang_routen.rs`:
  - `fax_ohne_faxzugang_ist_anbindung_fehlt` (Org hat nur SMTP → 422 `anbindung_fehlt`)
  - `mail_ohne_mailzugang_aber_mit_faxzugang_ist_anbindung_fehlt`
  - `ein_fax_ueber_30_seiten_wird_beim_anlegen_abgelehnt` (Lagebericht mit 31 Anlagen → 422
    `zu_gross`, keine Zeile in `ausgang`)
  - `mail_und_fax_zusammen_werden_ganz_abgelehnt_wenn_das_fax_zu_gross_ist` (Review Focus 5:
    keine Zeile für die Mail)
  - `eine_lange_mail_ist_nicht_begrenzt` (31 kleine Anlagen nur an Mail → 201)
- [ ] **Step 2:** `cargo test --test ausgang_routen` → FAIL
- [ ] **Step 3:** Umsetzen. `anlegen` prüft je vorkommendem Kanal einmal
  `pruefe_versand_moeglich`. Ist mindestens ein Fax-Empfänger dabei: Anlagen laden
  (`nachricht::load_anhaenge`), `PdfKopf` laden, PDF bauen und `passt_fuer_fax` prüfen, bevor
  irgendetwas angelegt wird; Netz entfällt hier. Kanalgerechter Text für `anbindung_fehlt`
  kommt aus dem Frontend (Fehlercode + Kanal).
- [ ] **Step 4:** Tests → PASS; bestehende `ausgang_routen`- und `ausgang_lauf`-Tests grün.
- [ ] **Step 5: Commit** — `feat(ausgang): Zugang und Anlegen je Kanal (LLH-2095)`

---

### Task 6: Lauf — PDF an der Mail, Fax absenden

**Files:**
- Modify: `src/ausgang/zusteller.rs`, `src/ausgang/lauf.rs`, `src/ausgang/repo.rs`, `src/ausgang/nachricht.rs` (`baue_mail` mit PDF), `src/main.rs:435-450`
- Test: `tests/ausgang_lauf.rs`

**Interfaces:**
- Consumes: Tasks 2–5.
- Produces:
```rust
// zusteller.rs
pub trait FaxZusteller: Send + Sync {
    fn senden<'a>(&'a self, zugang: &'a Versandzugang, auftrag: &'a FaxAuftrag<'a>) -> BoxFuture<'a, Result<String, SipgateFehler>>;
    fn status<'a>(&'a self, zugang: &'a Versandzugang, session: &'a str) -> BoxFuture<'a, Result<FaxStatus, SipgateFehler>>;
}
pub struct SipgateZusteller { … }  // produktiv(), liest token_id/faxline_id aus zugang.einstellung, token aus zugang.geheimnisse
pub struct Zustellwege { pub mail: Arc<dyn Zusteller>, pub fax: Arc<dyn FaxZusteller> }
#[cfg(debug_assertions)] pub struct AufzeichnenderFaxZusteller { … }
    // gesendet() -> Vec<(String /*empfaenger*/, String /*dateiname*/, usize /*pdf-bytes*/)>,
    // setze_antwort_senden(Result<String, SipgateFehler>), setze_status(Result<FaxStatus, SipgateFehler>)
#[cfg(debug_assertions)] pub fn testfaxzusteller() -> Option<Arc<AufzeichnenderFaxZusteller>>; // gleiche Schaltung wie testzusteller()
// repo.rs — Ergebnis wird Clone (nicht mehr Copy)
Ergebnis::Uebergeben { at: DateTime<Utc>, anbieter_ref: Option<String>, ohne_pdf: bool }
```
- `durchgang`, `zustellen_zeile`, `start` nehmen `&Zustellwege` statt `&Arc<dyn Zusteller>`.
- `nachricht::baue_mail(…, pdf: Option<(&str /*dateiname*/, &[u8])>)`: PDF als erster Anhang
  `application/pdf`; Summe mit PNG ≤ 20 MiB, sonst Mail ohne PDF.

- [ ] **Step 1: Failing tests** in `tests/ausgang_lauf.rs`:
  - `eine_mail_traegt_das_pdf_als_ersten_anhang` (MIME enthält `application/pdf` vor `image/png`, Dateiname `lagebericht-1.pdf`)
  - `scheitert_das_pdf_geht_die_mail_ohne_pdf_und_ist_vermerkt` (kaputte Anlage → Mail übergeben, `without_pdf == true`)
  - `ein_fax_wird_uebergeben_und_merkt_die_session` (Doppelgänger `Ok("s1")` → `uebergeben`, `anbieter_ref == "s1"`, **kein** ETB-Eintrag)
  - `fax_402_ist_anbindung_fehler_mit_etb` (→ `fehlgeschlagen`, `anbindung_fehler`, `smtp_status == 402`, ETB-Text enthält „Guthaben bei sipgate“)
  - `fax_407_ist_abgelehnt`
  - `fax_503_wird_wiederholt` (→ `wartet`, `voruebergehend`, nächster Versuch +30 s)
  - `fax_abbruch_nach_dem_senden_ist_ungewiss_ohne_zweiten_versuch` (Review Focus 2: `Ungewiss` → `fehlgeschlagen/ungewiss`, ein zweiter Durchgang ruft `senden` nicht erneut; `gesendet().len() == 1`)
  - `fax_401_zieht_die_pruefung_der_anbindung_vor`
- [ ] **Step 2:** `cargo test --test ausgang_lauf` → FAIL
- [ ] **Step 3:** Umsetzen. `run_one` holt den Zugang mit `zeile.kanal`; Mail-Zweig wie bisher plus
  PDF (vorher `PdfKopf` laden; Absender = Org-Name); Fax-Zweig: PDF bauen (Absender =
  `absender_kennung` oder Org-Name), `passt_fuer_fax` sonst `fehlgeschlagen/zu_gross` mit ETB,
  dann `fax.senden`. Einordnung als eigene `fn nach_fax_fehler(...)` neben `nach_fehler` nach
  der Tabelle der Spec (401/403/402 → `AnbindungFehler`; 400/407/413/415 → `Abgelehnt`;
  429/5xx/`Verbindung`/`Dns` → Backoff; `Ungewiss` → `Ungewiss`; `Antwort`/`ZielIntern` →
  `AnbindungFehler`). Fax-`Uebergeben` schreibt `naechste_abfrage_at = erste_abfrage(at)` und **keinen**
  ETB-Text; den ETB-Nachlauf (`etb::nachlauf`) so anpassen, dass ein Fax auf `uebergeben` keine
  Lücke ist. Texte: `ziel_text` „{quelle} per Fax an {stelle} ({nummer})“ bzw. „per E-Mail …“;
  `grund` je Kanal („Mailserver …“ / „sipgate …“; 402 → „Guthaben bei sipgate aufgebraucht“).
  `main.rs` verdrahtet `Zustellwege` (Debug: beide Doppelgänger, wenn `testzusteller()` aktiv).
- [ ] **Step 4:** Tests → PASS
- [ ] **Step 5: Commit** — `feat(ausgang): Fax absenden und PDF an der Mail (LLH-2095)`

---

### Task 7: Lauf — Nachfragen bis „zugestellt“

**Files:**
- Modify: `src/ausgang/lauf.rs` (`takt`, `beim_start`, `raeume_haengende`), `src/ausgang/repo.rs`
- Test: `tests/ausgang_lauf.rs`

**Interfaces:**
- Produces:
```rust
pub async fn load_abzufragende(pool: &SqlitePool, jetzt: &str) -> Result<Vec<VersandZeile>, AppError>; // zustand='uebergeben' AND anbieter_ref IS NOT NULL AND naechste_abfrage_at <= jetzt
pub enum Abfrage { Zugestellt { at: DateTime<Utc> }, NichtZugestellt, Ungewiss, Weiter { naechste: DateTime<Utc> } }
pub async fn save_abfrage_tx(conn: &mut SqliteConnection, id: &str, a: Abfrage) -> Result<bool, AppError>; // nur WHERE zustand='uebergeben'
```

- [ ] **Step 1: Failing tests**:
  - `sent_wird_zugestellt_mit_etb` (Status `Gesendet` → `zugestellt`, `delivered_at` gesetzt, ein ETB-Eintrag „… per Fax an … zugestellt“, Live-Ereignis)
  - `failed_wird_nicht_zugestellt_und_laesst_sich_erneut_senden` (→ `fehlgeschlagen/nicht_zugestellt`, ETB, `retry` → `wartet`, `anbieter_ref` geleert)
  - `laeuft_fragt_eine_minute_spaeter_erneut`
  - `abfragefehler_fragt_spaeter_erneut` (`Verbindung` → `Weiter`)
  - `ohne_endstand_nach_zwei_stunden_ungewiss` (→ `fehlgeschlagen/ungewiss`, ETB „Zustellung nicht bestätigt“)
  - `vor_der_ersten_abfrage_wird_nicht_gefragt` (t+29 s: kein `status`-Aufruf)
  - `neustart_mit_uebergebenem_fax_fragt_weiter_und_sendet_nicht` (Review Focus 3: `beim_start` lässt die Zeile unberührt; nächster Durchgang ruft nur `status`)
  - `eine_mail_auf_uebergeben_wird_nie_abgefragt`
- [ ] **Step 2:** `cargo test --test ausgang_lauf` → FAIL
- [ ] **Step 3:** Umsetzen. `takt` holt neben `load_faellige` auch `load_abzufragende` und
  verteilt beide auf dieselben Plätze (`PARALLEL`). Abfrage: Zugang laden (fehlt/angehalten →
  `Weiter`, die Frist entscheidet), `fax.status` ohne DB-Verbindung, Ergebnis + ETB in einer
  Transaktion wie `abschliessen`. `retry_tx` leert `anbieter_ref`, `naechste_abfrage_at`,
  `zugestellt_at`, `ohne_pdf`.
- [ ] **Step 4:** Tests → PASS
- [ ] **Step 5: Commit** — `feat(ausgang): Zustellung von Faxen nachfragen (LLH-2095)`

---

### Task 8: Oberfläche

**Files:**
- Modify: `frontend/src/stammdaten/ExterneStelleKanaele.tsx`, `frontend/src/stammdaten/ExterneStellenTab.tsx`
- Modify: `frontend/src/api/externeStellen.ts` (`'email'` → `KanalArt` aus den generierten Typen), `frontend/src/api/ausgang.ts`
- Modify: `frontend/src/ausgang/SendenDialog.tsx`, `frontend/src/ausgang/Versandliste.tsx`
- Test: `SendenDialog.test.tsx`, `Versandliste.test.tsx`, neuer `frontend/src/stammdaten/ExterneStelleKanaele.test.tsx`, `frontend/e2e/ausgang.spec.ts`

**Interfaces:**
- Consumes: Wire aus Tasks 1–2 (`channel: 'email' | 'fax' | …`, `state: … | 'zugestellt'`,
  `error: … | 'nicht_zugestellt'`, `delivered_at`, `without_pdf`).
- Produces: `pruefeFaxnummer(roh: string): boolean` in `ExterneStelleKanaele.tsx` (gleiche
  Regel wie `normalize_fax`, ohne Normalisierung; der Server normalisiert).

- [ ] **Step 1: Failing tests** (vitest):
  - Kanäle: Kanalwahl E-Mail/Fax beim Hinzufügen; Fax-Feld `inputMode="tel"`; „0511 123456“
    gültig, „abc“ zeigt „Keine gültige Faxnummer“.
  - Dialog: Stelle mit Mail und Fax zeigt zwei Gruppen „E-Mail“ und „Fax“; ohne Faxzugang
    (`anbindung_fehlt` für `fax` aus der Prüfung) steht „Kein Faxzugang eingerichtet“ statt der
    Faxnummern.
  - Versandliste: `zugestellt` zeigt „Zugestellt“ mit Zeit; `uebergeben` bei Fax zeigt
    „Übergeben, Zustellung wird geprüft“; `nicht_zugestellt` zeigt „Fax nicht zugestellt“ und
    „Erneut senden“; `without_pdf` zeigt „ohne PDF“.
  - e2e `ausgang.spec.ts`: Faxnummer an einer Stelle anlegen, freigegebenen Lagebericht per Fax
    senden, Versandliste zeigt nach dem Doppelgänger-`SENT` „Zugestellt“.
- [ ] **Step 2:** `mise exec -- pnpm -C frontend vitest run src/ausgang src/stammdaten` → FAIL
- [ ] **Step 3:** Umsetzen nach `frontend/AGENTS.md` (Gestaltung, Erfassung, Lint).
- [ ] **Step 4:** vitest PASS; `mise exec -- pnpm -C frontend lint --max-warnings 0`;
  e2e-Spec einzeln laufen lassen (`frontend/e2e/AGENTS.md`).
- [ ] **Step 5: Commit** — `feat(ausgang): Fax in Stellen, Senden und Versandliste (LLH-2095)`

---

### Task 9: Doku, Gates, Bilder

**Files:**
- Modify: `src/AGENTS.md` („Ausgang an Menschen“: Kanäle, zugestellt, Faxfehler, PDF nur für Fax begrenzt)
- Modify: `docs/architektur/05-bausteinsicht.md`, `06-laufzeitsicht.md` (Ablauf Fax mit Nachfragen), `08-querschnittliche-konzepte.md`, `12-glossar.md` („zugestellt“), ADR-0104 (Verweis auf ADR-0106)
- Modify: `docs/anwender/kapitel/anbindungen.md` (sipgate einrichten: Token mit Scopes `sessions:fax:write` und `history:read`, Faxline-ID `f0` aus der sipgate-App), Kapitel zum Senden, `quellen:` der Kapitel nach `docs/anwender/AGENTS.md`
- Modify: `docs/konzepte/2026-11-10-schnittstellen-ausbau.md:53` (E8 „entschieden: PDF am Server, LLH-2095“)

- [ ] **Step 1:** Doku schreiben; Wächter laut `docs/architektur/AGENTS.md` und
  `docs/anwender/AGENTS.md` laufen lassen.
- [ ] **Step 2:** `./scripts/check-all.sh --geaendert --ohne-e2e` → grün.
- [ ] **Step 3:** `/verify` mit den Routen Anbindungen (Fax-Anbindung), Externe Stelle (Faxnummer),
  Lagebericht (Senden-Dialog, Versandliste) — Bilder unter `pr-bilder/atnsssv3/`; ein Beispiel-PDF
  aus dem Test als Bild der ersten Seite dazu.
- [ ] **Step 4: Commit** — `docs(ausgang): Fax und PDF dokumentiert (LLH-2095)`
