# Webhooks: Zertifikats-Pinning (LLH-1872) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Am Webhook optional einen SHA-256-Fingerabdruck des Zielzertifikats hinterlegen, der
dann allein über TLS entscheidet; dazu Abruf des Fingerabdrucks vom Ziel, Admin-Spur und Anzeige.

**Architecture:** Der Verifier der Direktkopplung (`instanz::zertifikat::Verifier`) wird über eine
herausgelöste `tls_config` auch vom Webhook-Client genutzt; ein zweiter, erfassender Verifier liest
beim Abruf nur das Zertifikat und bricht den Handshake ab. Der Pin liegt als Spalte an
`maschine_webhook`, die Routen der Anbindungsverwaltung setzen, prüfen und protokollieren ihn,
das Frontend zeigt und erfasst ihn im bestehenden Webhook-Paneel.

**Tech Stack:** Rust (axum, sqlx/SQLite, reqwest 0.13 mit rustls 0.23, rcgen/axum-server in
Tests), React + antd + TanStack Query, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-22-wx6bfsmc-webhook-zertifikat-pin-design.md`

## Global Constraints

- Pin = SHA-256 über das DER-Zertifikat, gespeichert als 64 Zeichen Kleinbuchstaben-Hex, gleiche
  Funktion wie `instanz::identitaet::tls_fingerabdruck`.
- Mit Pin zählen weder Kette noch Hostname noch Vertrauensanker; Abweichung = Fehlerart `tls`
  (kein neuer Wire-Wert in `WebhookFehler`).
- Pin an jedem Webhook, unabhängig von `lan_erlaubt`.
- Zielschutz bleibt mit und ohne Pin: `check_url`, `WebhookResolver`, `.no_proxy()`,
  `redirect::Policy::none()`, `https_only(true)` (ADR-0046-Prüfungen bleiben grün).
- Abruf vom Ziel sendet nie ein HTTP-Byte; gespeichert wird nur, was der Admin speichert.
- Neuer Host bei gesetztem Pin ohne Angabe zu `zertifikat_pin` → 400
  „zertifikat_pin: Neues Ziel: Fingerabdruck neu holen oder entfernen.“; gleicher Host behält den Pin.
- Neue Admin-Aktionen (Wire-Werte): `maschinenzugang_webhook_pin_gesetzt`,
  `maschinenzugang_webhook_pin_entfernt`, `maschinenzugang_webhook_zertifikat_abgerufen`.
- Bezeichner: Fachbegriffe deutsch, Technik englisch (`AGENTS.md`, LFH-1312); Prosa deutsch.
- Nach DTO-/Enum-Änderungen `scripts/check-typ-codegen.sh` und beide generierten Dateien
  mitcommitten.
- Node/pnpm nur über `mise exec -- …`.

## Review Focus

1. Pin mit Doppelpunkten und Großbuchstaben eingefügt (`AB:CD:…`) → wird angenommen und
   normalisiert gespeichert (Task 2, `normalize_pin`-Test; Task 4, Route-Test).
2. Nur der Pfad der URL ändert sich → Pin bleibt, kein 400 (Task 4, Test
   `pfadwechsel_behaelt_den_pin`).
3. Ein gepinnter Client darf Loopback trotzdem nicht erreichen (Task 2, Test
   `gepinnter_client_lehnt_loopback_ab`).
4. Abruf an ein Ziel, das gar kein TLS spricht oder nicht antwortet → `fehler_art`, kein
   Fingerabdruck, kein 500 (Task 1, Test `erfasser_ohne_tls_liefert_nichts`; Task 4).
5. Alte `tls`-Fehler von vor dem Pin werden nicht als „passt nicht zum Fingerabdruck“ beschriftet
   (Task 5, neutraler Text, Test am Paneel-Hinweis).

---

### Task 1: TLS-Bausteine in `instanz::zertifikat`

**Files:**
- Modify: `src/instanz/zertifikat.rs`
- Test: `src/instanz/zertifikat/tests.rs`

**Interfaces:**
- Produces:
  - `pub fn tls_config(erwartet: Option<String>) -> Result<rustls::ClientConfig, String>` — genau
    die Konfiguration, die `build_client` heute baut; `build_client` nutzt sie.
  - `pub struct Erfasser` mit `pub fn new() -> Self` und `pub fn gesehen(&self) -> Option<String>`
    (Fingerabdruck des Endzertifikats nach dem Handshake-Versuch); `impl ServerCertVerifier`:
    `verify_server_cert` merkt den Fingerabdruck und gibt
    `Err(rustls::Error::General(ERFASST.into()))` zurück; Signatur-Methoden wie `Verifier`.
  - `pub const ERFASST: &str = "Zertifikat erfasst, Verbindung abgebrochen";`
  - `pub fn erfasser_config(erfasser: Arc<Erfasser>) -> Result<rustls::ClientConfig, String>`

- [x] **Step 1: Failing tests** in `tests.rs`, mit der vorhandenen `gegenstelle()`:
  - `tls_config_mit_passendem_fingerabdruck_verbindet`: reqwest-Client mit
    `tls_backend_preconfigured(tls_config(Some(fp)).unwrap())` → GET `/` liefert `"ok"`.
  - `erfasser_liest_den_fingerabdruck_ohne_anfrage`: Gegenstelle zählt Anfragen (Router mit
    `AtomicUsize`-Zähler in einem `any`-Handler; dafür eine Variante `gegenstelle_mit_zaehler()`).
    Client mit `erfasser_config(e.clone())`, `POST /` mit Body → `Err`; danach
    `e.gesehen() == Some(fp)` und Zähler `== 0`.
  - `erfasser_ohne_tls_liefert_nichts`: `TcpListener` auf Loopback, der Verbindungen annimmt und
    sofort schließt; Anfrage scheitert, `e.gesehen() == None`.
- [x] **Step 2:** `cargo test --lib instanz::zertifikat` → die drei Tests scheitern (fehlende Items).
- [x] **Step 3:** `tls_config`, `Erfasser`, `ERFASST`, `erfasser_config` implementieren; `gesehen` hält
  den Wert in einem `Mutex<Option<String>>`. `build_client` auf `tls_config` umstellen.
- [x] **Step 4:** `cargo test --lib instanz::zertifikat` → alle grün (auch die bestehenden).
- [x] **Step 5: Commit** `feat: TLS-Konfiguration und Erfasser der Direktkopplung wiederverwendbar (LLH-1872)`

### Task 2: Pin im Webhook-Client und in der Zustellung

**Files:**
- Modify: `src/public_api/webhook/ziel.rs`, `src/public_api/webhook/lauf.rs`,
  `src/public_api/webhook/mod.rs`
- Test: `src/public_api/webhook/ziel.rs` (Modul `tests`), neue Datei
  `src/public_api/webhook/ziel_tls_tests.rs` falls `ziel.rs` sonst über ~500 Zeilen wächst

**Interfaces:**
- Consumes: `instanz::zertifikat::{tls_config, Erfasser, erfasser_config}` (Task 1).
- Produces:
  - `pub const PIN_LAENGE: usize = 64;` in `webhook/mod.rs`
  - `pub fn normalize_pin(roh: &str) -> Result<Option<String>, PinFehler>` in `ziel.rs`: entfernt
    `:`, Leerzeichen und `-`, Kleinbuchstaben; leer → `Ok(None)`; genau 64 Hex-Zeichen →
    `Ok(Some(..))`; sonst `Err(PinFehler)`. `PinFehler::text()` =
    „Der Fingerabdruck besteht aus 64 Hex-Zeichen (SHA-256), mit oder ohne Doppelpunkte.“
  - `pub fn client(lan_erlaubt: bool, pin: Option<&str>) -> Result<reqwest::Client, String>`
    (ersetzt die bisherige Signatur; ohne Pin die zwei Singletons als Klon, mit Pin Cache
    `HashMap<(bool, String), Client>`, bei 64 Einträgen leeren).
  - `fn baue_client(lan_erlaubt: bool, tls: Option<rustls::ClientConfig>) -> reqwest::Client` —
    einzige Stelle mit den Schutzeinstellungen; `tls` → `.tls_backend_preconfigured(..)`.
  - `Zustellung` bekommt `pub zertifikat_pin: Option<String>`.
  - `pub async fn hole_fingerabdruck(url: &str, lan_erlaubt: bool) -> Result<String, WebhookFehler>`:
    `check_url` (Intern → `ZielIntern`, sonst `ZielUngueltig`), einmaliger Client
    `baue_client(lan, Some(erfasser_config(..)))`, `POST` ohne Body; ist danach `gesehen()` gesetzt
    → `Ok(fp)`, sonst `Err(fehler_art(&e))`.

- [x] **Step 1: Failing tests**
  - `normalize_pin_nimmt_schreibweisen_an`: `"AB:CD…"` (64 Hex mit Doppelpunkten, groß),
    mit Leerzeichen, klein ohne Trenner → gleiches `Some(klein)`; `""`/`"  "` → `Ok(None)`;
    63 Zeichen, 65 Zeichen, `"zz…"` → `Err`.
  - `pin_passt_nicht_ist_tls`: rcgen-Gegenstelle (Helfer aus `instanz/zertifikat/tests.rs` per
    `#[cfg(test)] pub(crate)` freigeben), reqwest-Client mit `tls_config(Some(fremd))` → Fehler,
    `fehler_art(&e) == WebhookFehler::Tls`.
  - `gepinnter_client_lehnt_loopback_ab`: `client(true, Some(&"0".repeat(64)))` →
    `POST https://localhost:<port>/` → `fehler_art == ZielIntern`, Lauscher ohne Verbindung
    (Muster `loopback_bekommt_keine_verbindung`).
  - `hole_fingerabdruck_internes_ziel`: `hole_fingerabdruck("https://127.0.0.1/", true)` →
    `Err(ZielIntern)`; `"http://x.example/"` → `Err(ZielUngueltig)`.
- [x] **Step 2:** `cargo test --lib public_api::webhook` → neue Tests scheitern.
- [x] **Step 3:** Implementieren wie unter Interfaces; `HttpZusteller::senden` nimmt
  `client(z.lan_erlaubt, z.zertifikat_pin.as_deref())` (Fehler beim Bauen → `ZielUngueltig`);
  `lauf.rs` (beide Stellen) und der Test in `ziel.rs` füllen `zertifikat_pin` aus
  `webhook.zertifikat_pin` (Feld kommt in Task 3 — bis dahin `None` an den zwei Stellen im Lauf,
  Task 3 stellt um). `adapter::ziel` bleibt unverändert.
- [x] **Step 4:** `cargo test --lib public_api::webhook` und `scripts/check-adr.sh` (bzw. der
  ADR-Schritt aus `check-all.sh --nur adr`, falls so benannt) → grün.
- [x] **Step 5: Commit** `feat: Webhook-Client mit Zertifikats-Pin (LLH-1872)`

### Task 3: Datenmodell — Spalte, Repo, Admin-Aktionen

**Files:**
- Create: `migrations/0364_webhook_zertifikat_pin.sql` (Nummer vor dem Anlegen mit
  `git fetch origin alpha && scripts/check-migrationen.sh` bestätigen)
- Modify: `src/public_api/webhook/repo.rs`, `src/public_api/webhook/lauf.rs`,
  `src/auth/admin_audit.rs`
- Test: `src/public_api/webhook/repo.rs` (Tests), bestehender
  `jede_aktion_passiert_den_db_check`

**Interfaces:**
- Produces:
  - Spalte `maschine_webhook.zertifikat_pin TEXT NULL CHECK (zertifikat_pin IS NULL OR
    (length(zertifikat_pin) = 64 AND zertifikat_pin NOT GLOB '*[^0-9a-f]*'))`.
  - `Webhook.zertifikat_pin: Option<String>`, in `SPALTEN`.
  - `Eingabe.zertifikat_pin: Option<String>`; `create` schreibt ihn; `update` vergleicht ihn mit,
    und ein geänderter Pin zählt als `ziel_neu`.
  - `AdminAktion::{MaschinenzugangWebhookPinGesetzt, MaschinenzugangWebhookPinEntfernt,
    MaschinenzugangWebhookZertifikatAbgerufen}` mit den Wire-Werten aus den Global Constraints.
- Migration: `ALTER TABLE maschine_webhook ADD COLUMN …` plus Umbau `admin_audit` nach Muster
  `0361` (Liste aus 0361 übernehmen, drei Werte anhängen, Kopfkommentar mit LLH-1872).

- [x] **Step 1: Failing tests** (Repo-Tests mit In-Memory-DB wie die vorhandenen, sonst als
  Integrationstest in `tests/anbindungen_webhook.rs`):
  - `pin_wechsel_setzt_die_stoerung_zurueck`: Webhook mit `fehler_seit`/`fehlversuche` gesetzt,
    `update` mit anderem Pin → `fehler_seit == None`, `fehlversuche == 0`, `geaendert_at` steigt.
  - `gleicher_pin_schreibt_nicht`: `update` mit identischer Eingabe → vorher == nachher.
  - DB-CHECK: `UPDATE maschine_webhook SET zertifikat_pin = 'XYZ'` scheitert.
- [x] **Step 2:** `cargo test public_api::webhook::repo` / betroffene Tests → scheitern.
- [x] **Step 3:** Migration, Repo, Enum; in `lauf.rs` `zertifikat_pin: webhook.zertifikat_pin.clone()`.
- [x] **Step 4:** `cargo test --lib admin_audit` und Repo-Tests → grün; `scripts/check-migrationen.sh`
  → grün.
- [x] **Step 5: Commit** `feat: Fingerabdruck am Webhook speichern (LLH-1872)`

### Task 4: Routen — Pin setzen, Host-Regel, Abruf, Anzeige

**Files:**
- Modify: `src/routes/anbindungen_webhook.rs`, `src/app.rs` (Route), `src/api_doc.rs` (falls die
  Routen dort gelistet sind), `frontend/src/api/types.generated.ts` + zweite generierte Datei
  (Codegen)
- Test: `tests/anbindungen_webhook.rs`

**Interfaces:**
- Consumes: `normalize_pin`, `hole_fingerabdruck` (Task 2), Repo/Enum (Task 3).
- Produces (Wire):
  - `WebhookEingabe.zertifikat_pin?: string | null`
  - `WebhookAenderung.zertifikat_pin` tri-state via
    `#[serde(default, deserialize_with = "support::deserialize_optional_field")]`
  - `WebhookAnzeige.zertifikat_pin?: string` (für jeden, der die Anbindung sieht)
  - `POST /api/admin/anbindungen/{id}/webhook/zertifikat-abrufen`, Body
    `WebhookZertifikatAbruf { url: String, lan_erlaubt: bool }`, Antwort
    `WebhookZertifikat { fingerabdruck?: String, fehler_art?: WebhookFehler }` (200).
- Regeln:
  - Ungültiger Pin → 400 `zertifikat_pin: <PinFehler::text()>`.
  - PATCH: alter Pin gesetzt, `host_von(neue url) != host_von(alte url)`, Feld fehlt → 400 (Text
    aus Global Constraints).
  - Spur: Anlegen mit Pin → zusätzlich `…_pin_gesetzt` (`fingerabdruck`); PATCH Pin neu/anders →
    `…_pin_gesetzt` (`fingerabdruck`, `fingerabdruck_vorher` falls vorher einer); Pin weg →
    `…_pin_entfernt` (`fingerabdruck_vorher`). `spur()` bekommt dafür die zwei Angaben als
    Parameter. Pin-Änderung allein schreibt **kein** `…_geaendert`.
  - Abruf: `AdminUser`, `zugang_fuer_schreiben`, `check_url` der Route (400 bei ungültiger URL),
    dann `hole_fingerabdruck`; Spur `…_zertifikat_abgerufen` mit Host und ggf. `fingerabdruck`,
    auch bei Fehlschlag.

- [x] **Step 1: Failing tests** in `tests/anbindungen_webhook.rs`:
  - `pin_beim_einrichten_wird_normalisiert_und_protokolliert`: POST mit `"AB:…"` (64 Hex,
    Doppelpunkte) → 201, `zertifikat_pin` klein ohne Trenner; Spur endet mit
    `…_angelegt`, `…_pin_gesetzt`; `detail` enthält den Fingerabdruck.
  - `ungueltiger_pin_400`: `"abc"` → 400.
  - `pin_setzen_wechseln_entfernen`: PATCH setzen → `…_pin_gesetzt`; anderer → `…_pin_gesetzt`
    mit `fingerabdruck_vorher`; `null` → `…_pin_entfernt`; jeweils kein `…_geaendert`.
  - `hostwechsel_ohne_pin_angabe_400`: Webhook mit Pin, PATCH `url` auf anderen Host → 400;
    mit `"zertifikat_pin": null` → 200 und `…_pin_entfernt`.
  - `pfadwechsel_behaelt_den_pin`: PATCH `url` gleicher Host, anderer Pfad → 200, Pin unverändert.
  - `pin_sieht_auch_wer_nur_liest`: Führungskraft liest Anzeige mit `zertifikat_pin`
    (Muster `fuehrungskraft_liest_aber_schreibt_nicht`).
  - `abruf_internes_ziel_liefert_fehlerart_und_spur`: `{"url":"https://127.0.0.1/","lan_erlaubt":true}`
    → 400 (URL-Prüfung der Route); `{"url":"https://localhost./x","lan_erlaubt":true}` → 400;
    Führungskraft → 403; Spur-Eintrag nur bei bestandener URL-Prüfung. Für einen 200-Pfad mit
    `fehler_art`: URL `https://nicht-aufloesbar.invalid/` → 200 mit `fehler_art` (`dns` oder
    `verbindung`) und Spur `…_zertifikat_abgerufen`.
- [x] **Step 2:** `cargo test --test anbindungen_webhook` → neue Tests scheitern.
- [x] **Step 3:** Implementieren; Route in `app.rs` neben `/webhook/test`; Codegen
  `scripts/check-typ-codegen.sh` (schreibt die generierten Dateien neu).
- [x] **Step 4:** `cargo test --test anbindungen_webhook --test public_api_webhook` und
  `scripts/check-typ-codegen.sh` → grün.
- [x] **Step 5: Commit** `feat: Fingerabdruck über die Anbindungsverwaltung setzen und abrufen (LLH-1872)`

### Task 5: Frontend — Feld, Abruf, Hinweise

**Files:**
- Modify: `frontend/src/api/anbindungen.ts`, `frontend/src/pages/einstellungen/AnbindungWebhook.tsx`,
  `frontend/src/zugangsprotokoll/zugangsprotokollText.ts`
- Test: `frontend/src/pages/einstellungen/AnbindungWebhook.test.tsx`,
  `frontend/src/zugangsprotokoll/zugangsprotokollText.test.ts`, ggf. `frontend/src/api/…test.ts`

**Interfaces:**
- Consumes: Wire aus Task 4 (`WebhookAnzeige.zertifikat_pin`, `WebhookZertifikat`).
- Produces:
  - `WebhookEingabe.zertifikat_pin?: string | null`, `WebhookPatch.zertifikat_pin?: string | null`
  - `holeZertifikat(id: string, url: string, lanErlaubt: boolean): Promise<WebhookZertifikat>`
  - `fingerabdruckGruppen(hex: string): string` → `"AB:CD:…"` (Großbuchstaben, je 2 Zeichen)
  - `pinNormal(roh: string): string` (wie Backend: `:`/Leerzeichen/`-` weg, klein)
  - `WebhookWerte.zertifikat_pin: string` (leer = kein Pin)
  - `PIN_HINWEIS = 'Mit Fingerabdruck zählt nur dieses Zertifikat. Wechselt das Ziel sein Zertifikat, muss der Fingerabdruck neu hinterlegt werden.'`
- Texte (exakt):
  - `FEHLER_TEXT.tls` bleibt `'Zertifikat des Ziels nicht anerkannt'`.
  - `LAN_WARNUNG` letzter Satz: `'Das Ziel braucht ein Zertifikat, dem dieser Server vertraut, oder einen hinterlegten Fingerabdruck.'`
  - Anzeige ohne Pin: `'kein Fingerabdruck – es gelten die Vertrauensanker des Servers'`
  - Paneel „Zustellung“, Zustand `fehler`/`angehalten` mit `letzter_fehler.art === 'tls'` und Pin:
    `'Hat das Ziel sein Zertifikat gewechselt? Fingerabdruck neu holen.'`
  - Bestätigung: Titel `'Zertifikat des Ziels'`, Text `'Das Ziel zeigt dieses Zertifikat. Fingerabdruck mit dem am Zielgerät vergleichen.'` (Anrede-Regel, Review-Fix), Knöpfe `'Übernehmen'`/`'Abbrechen'`.
  - Zugangsprotokoll: `maschinenzugang_webhook_pin_gesetzt: 'Webhook: Fingerabdruck hinterlegt'`,
    `…_pin_entfernt: 'Webhook: Fingerabdruck entfernt'`,
    `…_zertifikat_abgerufen: 'Webhook: Zertifikat vom Ziel abgerufen'`.
- Verhalten: Feld „Zertifikat“ (Name `zertifikat_pin`) in Modal und Paneel unter „Lokales Netz“,
  Eingabe = `Input` (Monoschrift) + Knopf „Vom Ziel holen“, der die aktuellen Formularwerte `url`
  und `lan_erlaubt` liest (`Form.useFormInstance`), `holeZertifikat` ruft und den Bestätigungs-
  dialog zeigt; erst „Übernehmen“ setzt das Feld. Ändert sich der Host der URL im Formular
  gegenüber dem gespeicherten, leert das Formular das Pin-Feld (`onValuesChange` bzw.
  `dependencies`). `webhookPatch`: `zertifikat_pin` nur bei Änderung (normalisiert verglichen),
  leer → `null`. Client-Regel: leer oder `pinNormal(v)` ist 64 Hex, sonst Text aus Task 2.

- [x] **Step 1: Failing tests**
  - `webhookPatch` mit Pin: unverändert (auch andere Schreibweise) → kein Feld; geleert → `null`;
    neu → normalisiert.
  - `fingerabdruckGruppen('ab12…')` → `'AB:12:…'`.
  - Paneel zeigt gruppierten Pin bzw. den Text ohne Pin.
  - „Vom Ziel holen“: gemockte API liefert `fingerabdruck` → Dialog zeigt gruppierten Wert; ohne
    „Übernehmen“ bleibt das Feld leer, mit „Übernehmen“ steht der Wert drin.
  - Abruf mit `fehler_art: 'dns'` → Fehlertext aus `webhookFehlerText`.
  - Hinweis „Hat das Ziel sein Zertifikat gewechselt? …“ nur bei Pin **und** `tls`.
  - Zugangsprotokoll-Texte der drei Aktionen.
- [x] **Step 2:** `mise exec -- pnpm -C frontend vitest run src/pages/einstellungen/AnbindungWebhook.test.tsx src/zugangsprotokoll` → scheitert.
- [x] **Step 3:** Implementieren.
- [x] **Step 4:** Tests grün; `mise exec -- pnpm -C frontend lint` und `tsc` (Skript `typecheck`
  o. ä. aus `package.json`) grün.
- [x] **Step 5: Commit** `feat: Fingerabdruck im Webhook-Paneel erfassen und zeigen (LLH-1872)`

### Task 6: Regeln und Doku

**Files:**
- Create: `docs/architektur/entscheidungen/ADR-0085-ein-webhook-mit-fingerabdruck-vertraut-nur-diesem-zertifikat.md`
  (Nummer vorher gegen `origin/alpha` und offene PRs prüfen)
- Modify: `docs/architektur/entscheidungen/ADR-0046-…md` (nur falls ein Verweis erlaubt ist; ADR
  ist akzeptiert und unveränderlich — sonst unangetastet), `src/AGENTS.md` („Webhooks“),
  `docs/anwender/kapitel/anbindungen.md` (Abschnitt „Fingerabdruck hinterlegen“, `quellen` um
  `src/instanz/zertifikat.rs` ergänzen)

- [x] **Step 1:** ADR-0085 nach `docs/architektur/AGENTS.md` (Kopf, `status: akzeptiert`,
  `gilt_fuer` = `src/public_api/webhook/**`, `src/routes/anbindungen_webhook.rs`,
  `src/instanz/zertifikat.rs`; `herleitung` = Design-Doc). Regeln: MUST „mit Fingerabdruck nur
  dieses Zertifikat, Kette/Name/Anker zählen nicht“; MUST „Zielschutz unverändert, TLS nur über
  `instanz::zertifikat::tls_config`“; MUST NOT „Abruf sendet eine HTTP-Anfrage“; MUST „neuer
  Host verlangt eine Angabe zum Fingerabdruck“. Prüfung: `verlange 'tls_config' src/public_api/webhook/ziel.rs`,
  `verlange 'erfasser_config' src/public_api/webhook/ziel.rs`.
- [x] **Step 2:** `src/AGENTS.md`, „Webhooks“: ein Punkt „Pin: ein Client je `(lan, pin)` aus
  `baue_client`, TLS nur über `instanz::zertifikat::tls_config`, Abruf nur mit `Erfasser`“, Verweis
  auf ADR-0085.
- [x] **Step 3:** Anwenderkapitel: Schritte „Fingerabdruck hinterlegen“ (Vom Ziel holen →
  vergleichen → Übernehmen → Speichern), Hinweis zu Zertifikatswechsel und neuem Server.
- [x] **Step 4:** `./scripts/check-all.sh --geaendert --ohne-e2e` → grün (ein Aufruf).
- [x] **Step 5: Commit** `docs: ADR-0085, Regeln und Anwenderdoku zum Webhook-Fingerabdruck (LLH-1872)`
