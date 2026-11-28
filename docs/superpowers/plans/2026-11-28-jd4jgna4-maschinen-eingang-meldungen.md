# Maschinen-Eingang für Meldungen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein signierter Maschinenzugang mit Scope `meldungen:write` legt Kurztexte als
unverifizierte Vorschläge im freigegebenen Einsatz ab; ein Mensch übernimmt sie als Meldung oder
verwirft sie.

**Architecture:** Neue Tabelle `meldung_vorschlag` (instanzlokal) mit Repo in
`src/meldung/vorschlag.rs`. Die öffentliche Route `POST /api/v1/report-suggestions` findet den
Einsatz über `public_api::freigabe`. Interne Routen listen, übernehmen (über denselben Prüf- und
Schreibweg wie `POST /api/incidents/{id}/reports`, in einer Transaktion) und verwerfen. Das
Frontend zeigt einen Bereich „Vorschläge · unverifiziert“ über der Meldungsliste.

**Tech Stack:** Rust (axum, sqlx/SQLite, utoipa), React + TanStack Query, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-28-jd4jgna4-maschinen-eingang-meldungen-design.md`

Zunder: https://zunder.rubeen.dev/#/aufgabe/jd4jgna48kqghdvwl9yz5lev

## Global Constraints

- Scope-Wire-Wert `meldungen:write`, Enum-Variante `Scope::MeldungenWrite`, am Ende von `wire_enum! Scope` (ADR-0006, nur anhängen).
- Route `POST /api/v1/report-suggestions`; intern `GET /api/incidents/{id}/report-suggestions`, `POST …/{vid}/accept`, `POST …/{vid}/discard`. Glossarzeile `report-suggestions<TAB>Meldungsvorschläge` in `scripts/api-routen-woerter.tsv`.
- Neue Request-/Response-Typen mit englischen Wire-Feldern; neue Felder an `MeldungAnzeige`/`MeldungsZaehler` deutsch (`maschinen_herkunft`, `vorschlaege_offen`).
- `text` ≤ `crate::etb::INHALT_MAX`, nicht leer; `external_id` Pflicht ≤ 128; `source.adapter` `[a-z0-9_-]{1,32}`; `source.sender_id` 1–64; `source.sender_name` ≤ `crate::etb::PARTEI_MAX`; `source.signed` Pflicht.
- Antwort v1: 201 neu, 200 Dopplung (gleiche `external_id` am selben Zugang, jeder Status), Körper `{ id, status, received_at }`; `status` ∈ `offen|angenommen|verworfen|abgelaufen`.
- Fehler v1: 409 `incident_not_released` (neu, ohne wirksame Freigabe), 409 `fuehrung_elsewhere` (Einsatz ist hier Spiegel), 422 `validation`-Code des Bestands, 429 über die Drossel.
- Abgelaufen = offen und (`empfangen_at` älter als 12 h ODER Einsatz nicht aktiv ODER Einsatz in `einsatz_spiegel`); beim Lesen bestimmt.
- Löschen: 7 Tage nach `erledigt_at`, offene 7 Tage nach `empfangen_at`; Text bei Übernahme sofort `NULL`.
- Übernahme schreibt ETB nur nach `effektiv_auto_etb_aktiv`; kein Sofortalarm, keine Benachrichtigung für Vorschläge.
- Gekoppelte Instanz (`zugang::hub_fuer_org` liefert etwas): nur Zugänge mit Scopes genau `[MeldungenWrite]` werden angelegt, angenommen und freigegeben, und nur für Einsätze, die nicht in `einsatz_spiegel` stehen.
- Geräte (`ctx.geraet.is_some()`) bekommen auf allen internen Vorschlagsrouten 403.
- Migration `0392_meldung_vorschlag.sql` (vor dem Commit `scripts/check-migrationen.sh`; bei Kollision umnummerieren). Neue ADR `ADR-0112` ersetzt ADR-0035 (Nummer vor dem Commit gegen `origin/alpha` prüfen).
- Prosa, Kommentare, Testnamen deutsch; Bezeichner nach LFH-1312.

## Review Focus

1. Ein Zugang mit `meldungen:write` **und** einem weiteren Scope an einem gekoppelten ELW wird weiter abgelehnt (`instanz_gekoppelt`), auch wenn er vor der Kopplung angelegt wurde. → Test in Task 2.
2. Übernahme eines Vorschlags, der in der Zwischenzeit abgelaufen (12 h) oder von einer zweiten Person übernommen wurde → 409, keine zweite Meldung. → Test in Task 5.
3. Wiederholte Übernahme mit derselben `client_id` (Offline-Queue) nach erfolgreicher Übernahme → 201 mit derselben Meldung, kein 409. → Test in Task 5.
4. Dopplung derselben `external_id` von zwei **verschiedenen** Zugängen → zwei Vorschläge (Eindeutigkeit gilt je Zugang). → Test in Task 4.
5. Freigabe wechselt auf einen anderen Einsatz, während Vorschläge im alten offen sind → die alten bleiben im alten Einsatz übernehmbar, neue landen im neuen. → Test in Task 4.

---

### Task 1: Scope `meldungen:write` mit Einsatzbezug

**Files:**
- Modify: `src/public_api/scope.rs` (Enum, `has_einsatzbezug`, Tests)
- Modify: `tests/enum_wire_kontrakt.rs`
- Modify: `frontend/src/api/anbindungen.ts` (`SCOPE_TEXT`)
- Modify: `src/public_api/description.md` (Absatz „Einsatzbezug“, neuer Abschnitt „Meldungsvorschläge“)

**Interfaces:**
- Produces: `Scope::MeldungenWrite`; `pub fn is_nur_meldungen(scopes: &[Scope]) -> bool` in `scope.rs` (true genau bei `[MeldungenWrite]`).

- [ ] **Step 1: Failing tests** in `scope.rs`: Test `lage_und_einsaetze_lesen_haben_einsatzbezug` umbenennen zu `scopes_mit_einsatzbezug` mit Erwartung `["lage:read", "einsaetze:read", "meldungen:write"]`; neuer Test `nur_meldungen_ist_genau_der_eine_scope`: `is_nur_meldungen(&[MeldungenWrite])`, nicht für `&[]`, nicht für `&[MeldungenWrite, LageRead]`. In `enum_wire_kontrakt.rs` den Wert `meldungen:write` ergänzen.
- [ ] **Step 2:** `cargo test --lib public_api::scope` → FAIL (Variante fehlt).
- [ ] **Step 3:** Variante, `has_einsatzbezug`-Zweig, `is_nur_meldungen` implementieren; Doc-Kommentar von „Lese-Scope“ auf „Scope mit Einsatzbezug“. `SCOPE_TEXT`: `'meldungen:write': 'Meldungen einreichen (als unverifizierte Vorschläge)'`. `description.md` ergänzen.
- [ ] **Step 4:** `cargo test --lib public_api::scope && cargo test --test enum_wire_kontrakt` → PASS; `mise exec -- pnpm -C frontend typecheck` → PASS.
- [ ] **Step 5: Commit** `feat(public-api): Scope meldungen:write mit Einsatzbezug (LLH-2112)`.

### Task 2: Ausnahme am gekoppelten ELW

**Files:**
- Modify: `src/public_api/machine.rs` (Schritt 6, `hub.is_some()`)
- Modify: `src/routes/anbindungen.rs` (Anlegen/Ändern, Zeilen um 310 und 494; Listenmarke um 123)
- Modify: `src/public_api/freigabe.rs` (`list_fuer_einsatz`, `load_freigebbar`)
- Modify: `src/routes/einsatz_anbindungen.rs` (Freigeben am Spiegel)
- Test: `tests/maschinenzugang.rs`, `tests/einsatz_anbindungen.rs`

**Interfaces:**
- Consumes: `scope::is_nur_meldungen`.
- Produces: `pub fn is_am_hub_erlaubt(zugang: &Zugang) -> bool` in `freigabe.rs` (= `is_nur_meldungen(&zugang.scopes)`); `AnbindungFreigabe.ruht` ist `am_hub && !is_am_hub_erlaubt(z)`.

- [ ] **Step 1: Failing tests:**
  - `tests/maschinenzugang.rs`: `am_gekoppelten_elw_geht_ein_reiner_meldungszugang` — nach `org_koppeln(…, "standard")` legt `POST /api/integrations` (Route wie im bestehenden Test `am_gekoppelten_elw_ist_anlegen_gesperrt`) einen Zugang mit `["meldungen:write"]` an (201), mit `["meldungen:write","lage:read"]` nicht (Status und Grund wie im bestehenden Test).
  - `ein_gemischter_zugang_von_vor_der_kopplung_bleibt_am_elw_abgelehnt`: Zugang mit `meldungen:write` + `lage:read` anbinden, dann koppeln; signiertes `GET /api/v1/me` → 401 und am Zugang `letzte_ablehnung = "instanz_gekoppelt"`. Der reine Meldungszugang bekommt 200.
  - `tests/einsatz_anbindungen.rs`: `reiner_meldungszugang_laesst_sich_am_gekoppelten_elw_freigeben` (200, `ruht == false`) und `meldungszugang_laesst_sich_am_spiegel_nicht_freigeben` (409).
- [ ] **Step 2:** `cargo test --test maschinenzugang --test einsatz_anbindungen` → die neuen FAIL.
- [ ] **Step 3:** Implementieren: Extractor lehnt bei Hub nur ab, wenn `!is_nur_meldungen(&zugang.scopes)`. Anlegen/Ändern: `gesperrt_grund` greift nur, wenn die angefragten Scopes nicht `is_nur_meldungen` sind (die Fehlermeldung bleibt). `list_fuer_einsatz`/`load_freigebbar` nach `is_am_hub_erlaubt`. Freigeben eines `is_nur_meldungen`-Zugangs an einem Einsatz mit `ctx.einsatz.spiegel.spiegel_ist` → `AppError::Conflict("Der Einsatz wird an einer anderen Instanz geführt".into())`.
- [ ] **Step 4:** Dieselben Tests → PASS; außerdem `cargo test --lib public_api::freigabe` (bestehende Ruht-Tests bleiben grün).
- [ ] **Step 5: Commit** `feat(public-api): reiner Meldungszugang am gekoppelten ELW (LLH-2112)`.

### Task 3: Tabelle und Repo der Vorschläge

**Files:**
- Create: `migrations/0392_meldung_vorschlag.sql`
- Create: `src/meldung/vorschlag.rs`; Modify: `src/meldung/mod.rs` (`pub mod vorschlag;`)
- Modify: `src/instanz/spiegel/art.rs` (`AUSGENOMMEN`: `("meldung_vorschlag", "Vorschläge von Fremdsystemen hängen an der Instanz des Zugangs (LLH-2112)")`)
- Modify: `src/einsatz/purge_scheduler.rs` (Aufruf neben `einwurf::purge`)

**Migration:** Tabelle wie im Design-Doc („Tabelle `meldung_vorschlag`“), `CHECK (status IN ('offen','angenommen','verworfen'))`, `CHECK (signiert IN (0,1))`, `UNIQUE (zugang_id, external_id)`, Index `(einsatz_id, status, empfangen_at)`. Dazu `ALTER TABLE meldung ADD COLUMN herkunft_adapter TEXT`, `herkunft_kennung TEXT`, `herkunft_name TEXT`, `herkunft_signiert INTEGER` (alle nullbar). `zugang_id` mit FK auf die Zugangstabelle des Bestands (Name in `src/public_api/zugang.rs` nachsehen), `ON DELETE SET NULL`.

**Interfaces:**
- Produces (alle in `src/meldung/vorschlag.rs`):
  - `pub const ABLAUF_STUNDEN: i64 = 12; pub const AUFBEWAHRUNG_TAGE: i64 = 7;`
  - `pub struct Herkunft { pub adapter: String, pub kennung: String, pub name: Option<String>, pub signiert: bool }`
  - `pub struct NeuerVorschlag<'a> { pub einsatz_id: i64, pub zugang_id: &'a str, pub external_id: &'a str, pub text: &'a str, pub herkunft: &'a Herkunft, pub gesendet_at: Option<&'a str>, pub empfangen_at: &'a str }`
  - `pub enum VorschlagStatus { Offen, Angenommen, Verworfen, Abgelaufen }` mit `as_str()` (Wire-Werte wie oben).
  - `pub struct Vorschlag { pub id: i64, pub einsatz_id: i64, pub text: Option<String>, pub herkunft: Herkunft, pub gesendet_at: Option<String>, pub empfangen_at: String, pub status: VorschlagStatus }`
  - `pub async fn einreichen_tx(conn, &NeuerVorschlag, jetzt: &str) -> Result<(Vorschlag, bool /*neu*/), AppError>` — bei vorhandener `(zugang_id, external_id)` den Bestand mit bestimmtem Status, `false`.
  - `pub async fn offene(pool, einsatz_id, jetzt) -> Result<Vec<Vorschlag>, AppError>` — nicht abgelaufen, älteste zuerst.
  - `pub async fn zaehle_offene(pool, einsatz_id, jetzt) -> Result<i64, AppError>`
  - `pub async fn laden_offen_tx(conn, einsatz_id, vorschlag_id, jetzt) -> Result<Vorschlag, AppError>` — 404 fremd/unbekannt, `Conflict` wenn nicht offen oder abgelaufen.
  - `pub async fn annehmen_tx(conn, vorschlag_id, meldung_id, benutzer_id, jetzt) -> Result<(), AppError>` — Status, `text = NULL`, `meldung_id`, `erledigt_*`, und `UPDATE meldung SET herkunft_* …`.
  - `pub async fn verwerfen_tx(conn, einsatz_id, vorschlag_id, benutzer_id, jetzt) -> Result<(), AppError>`
  - `pub async fn purge(pool, jetzt) -> Result<u64, AppError>`
  - Abgelaufen-Regel als ein SQL-Fragment (Makro oder `const`), das alle Lesewege teilen.

- [ ] **Step 1: Failing tests** (Modul-Tests in `vorschlag.rs`, Testpool des Bestands):
  - `einreichen_legt_an_und_meldet_die_dopplung` (zweiter Aufruf gleiche `external_id` → `false`, gleiche `id`).
  - `gleiche_external_id_zweier_zugaenge_sind_zwei_vorschlaege` (Review Focus 4).
  - `nach_zwoelf_stunden_ist_ein_vorschlag_abgelaufen` (`jetzt` = `empfangen_at` + 12 h 1 min → nicht in `offene`, Status `Abgelaufen`, `laden_offen_tx` → Conflict).
  - `am_abgeschlossenen_einsatz_und_am_spiegel_abgelaufen` (Einsatz `status='abgeschlossen'`; Zeile in `einsatz_spiegel`).
  - `annehmen_leert_den_text_und_setzt_die_herkunft_der_meldung`.
  - `annehmen_zweimal_ist_ein_konflikt`.
  - `purge_loescht_nach_sieben_tagen_und_laesst_juengere`.
- [ ] **Step 2:** `cargo test --lib meldung::vorschlag` → FAIL.
- [ ] **Step 3:** Migration, Repo, `AUSGENOMMEN`-Eintrag, Purge-Aufruf (`tracing::error!` bei Fehler wie der Einwurf) implementieren.
- [ ] **Step 4:** `cargo test --lib meldung::vorschlag && cargo test --lib instanz::spiegel` → PASS; `scripts/check-migrationen.sh` → OK.
- [ ] **Step 5: Commit** `feat(meldung): Ablage für Meldungsvorschläge (LLH-2112)`.

### Task 4: Öffentliche Route `POST /api/v1/report-suggestions`

**Files:**
- Create: `src/public_api/meldung_vorschlag.rs`; Modify: `src/public_api/mod.rs` (Modul, `.routes(routes!(meldung_vorschlag::einreichen).layer(Extension(ScopeAnforderung::Scope(Scope::MeldungenWrite))))`)
- Modify: `src/public_api/error.rs` (`IncidentNotReleased => "incident_not_released"`, 409)
- Modify: `scripts/api-routen-woerter.tsv`
- Regenerate: `docs/api/public-v1.json`
- Test: `tests/public_api_meldung_vorschlag.rs` (mit `common::maschine::{angebunden, signiert_mit_body, …}`)

**Interfaces:**
- Consumes: `vorschlag::einreichen_tx`, `freigabe::freigegebener_einsatz_tx`, `MachineClient::antwort`.
- Produces: Typen `ReportSuggestionRequest { text, external_id, sent_at: Option<String>, source: ReportSuggestionSource { adapter, sender_id, sender_name: Option<String>, signed: bool } }` und `ReportSuggestionResponse { id: i64, status: String, received_at: String }` (ToSchema); Handler `pub async fn einreichen(State<AppState>, MachineClient) -> Result<Response, ApiError>`.

- [ ] **Step 1: Failing tests:**
  - `ohne_freigabe_lehnt_die_route_mit_incident_not_released_ab` (409, `code`).
  - `mit_freigabe_entsteht_ein_vorschlag_und_kein_etb_eintrag` (201, Körper `status:"offen"`; `SELECT COUNT(*) FROM meldung` und `etb_eintrag` des Einsatzes unverändert; Antwort hat `Lifeline-Signature`).
  - `dieselbe_external_id_liefert_200_und_denselben_vorschlag`.
  - `am_spiegel_lehnt_die_route_mit_fuehrung_elsewhere_ab` (Zeile in `einsatz_spiegel`).
  - `ungueltige_felder_sind_422` (leerer Text, Text > `INHALT_MAX`, `adapter` mit Großbuchstaben, fehlendes `signed`).
  - `ohne_scope_ist_403_missing_scope`.
  - `nach_wechsel_der_freigabe_landet_der_neue_vorschlag_im_neuen_einsatz` (Review Focus 5).
- [ ] **Step 2:** `cargo test --test public_api_meldung_vorschlag` → FAIL.
- [ ] **Step 3:** Handler: Body aus `client.body` parsen (wie die übrigen schreibenden v1-Routen), prüfen, in `write_retry!`-Transaktion Freigabe lesen (keine → `IncidentNotReleased`), Spiegel prüfen (`einsatz_spiegel` → `FuehrungElsewhere`), `einreichen_tx`; nach dem Commit bei `neu` `state.live.publiziere_einsatz(einsatz_id, LiveEvent::Meldung)`. `utoipa::path` mit allen Antworten. Glossarzeile anhängen.
- [ ] **Step 4:** Test → PASS; `cargo test --test public_api_spec_aktuell` nach Neuerzeugen von `docs/api/public-v1.json` (Befehl in `docs/api/maschinenzugang.md`) → PASS; `scripts/check-api-routen.sh` → OK.
- [ ] **Step 5: Commit** `feat(public-api): Meldungsvorschläge einreichen (LLH-2112)`.

### Task 5: Interne Routen: Liste, Übernehmen, Verwerfen

**Files:**
- Modify: `src/routes/meldung.rs` — Rumpf von `anlegen` aufteilen in `pub(crate) async fn pruefe_neue_meldung(state: &AppState, ctx: &EinsatzErfassungsfreigabe<Meldungen>, req: &NeueMeldung) -> Result<GepruefteMeldung, AppError>` (alle Prüfungen bis vor `anlegen_idempotent`; `GepruefteMeldung` hält die Werte als `String`/owned und hat `fn daten(&self) -> repo::MeldungDaten<'_>`). `anlegen` ruft sie unverändert im Verhalten.
- Modify: `src/meldung/repo.rs` — `anlegen_mit_client_id_tx` wird `pub(crate)`.
- Create: `src/routes/meldung_vorschlag.rs`; Modify: `src/routes/mod.rs`, `src/app.rs` (neben den Meldungsrouten um Zeile 1025).
- Modify: `src/meldung/mod.rs` (`MeldungAnzeige.maschinen_herkunft: Option<MaschinenHerkunft>` mit `adapter, kennung, name: Option<String>, signiert`, `skip_serializing_if`), Lesewege in `repo.rs` laden die Spalten.
- Regenerate: `scripts/check-typ-codegen.sh` (beide generierten Dateien).
- Test: `tests/meldung_vorschlag.rs`

**Interfaces:**
- Consumes: Task 3, `pruefe_neue_meldung`, `repo::anlegen_mit_client_id_tx`, `meldung::live_publikation_sicherstellen`, `meldung::auto_frist_erinnerung_sicherstellen`.
- Produces: Handler `liste` (`EinsatzLesezugriff<Meldungen>`), `accept` (`EinsatzErfassungsfreigabe<Meldungen>`, `JsonBody<NeueMeldung>`, Antwort `(StatusCode::CREATED, Json<MeldungAnzeige>)`), `discard` (`EinsatzErfassungsfreigabe<Meldungen>`, 204). Antworttyp der Liste `ReportSuggestion { id, text, source { adapter, sender_id, sender_name, signed }, sent_at, received_at }` (ToSchema, im generierten Typ).

- [ ] **Step 1: Failing tests** (`tests/meldung_vorschlag.rs`, Vorschlag direkt per `vorschlag::einreichen_tx` anlegen):
  - `liste_zeigt_offene_vorschlaege_aelteste_zuerst`.
  - `uebernahme_legt_meldung_mit_herkunft_an_und_schreibt_etb_nur_mit_auto_etb` (zwei Fälle: Auto-ETB an → `etb_meldung_id` gesetzt; aus → `NULL`; beide Male `maschinen_herkunft` in der Antwort, Vorschlag nicht mehr in der Liste).
  - `uebernahme_eines_abgelaufenen_oder_angenommenen_vorschlags_ist_409` (Review Focus 2; danach genau eine Meldung).
  - `wiederholte_uebernahme_mit_derselben_client_id_liefert_dieselbe_meldung` (Review Focus 3).
  - `verwerfen_entfernt_den_vorschlag_und_legt_nichts_an` (204; zweites Verwerfen 409).
  - `geraet_bekommt_403` (Liste, Übernahme, Verwerfen).
  - `am_spiegel_lehnen_uebernahme_und_verwerfen_ab` (409).
  - `vorschlag_eines_anderen_einsatzes_ist_404`.
  - Bestehende Tests in `tests/meldung.rs` bleiben grün (Verhalten von `anlegen` unverändert).
- [ ] **Step 2:** `cargo test --test meldung_vorschlag` → FAIL.
- [ ] **Step 3:** Implementieren. `accept`: Gerät → 403; `client_id`-Wiederholung vor allem anderen wie in `anlegen` (liefert Bestand, 201); `ctx.fordere_aktiv()`; Spiegel → 409; `pruefe_neue_meldung`; dann eine Transaktion: `laden_offen_tx` → `anlegen_mit_client_id_tx` → `annehmen_tx` → Commit; danach `repo::laden`, `live_publikation_sicherstellen`, `auto_frist_erinnerung_sicherstellen`, `publiziere_einsatz(…, LiveEvent::Meldung)`. `discard`: Gerät 403, aktiv, Spiegel 409, `verwerfen_tx`, Live.
- [ ] **Step 4:** `cargo test --test meldung_vorschlag --test meldung --test etb_meldungseingang` → PASS; `scripts/check-typ-codegen.sh` → keine Abweichung nach dem Mitcommitten.
- [ ] **Step 5: Commit** `refactor(meldung): Prüfung der Erfassung herausgelöst (LLH-2112)` (nur der Schnitt in `routes/meldung.rs`) und danach `feat(meldung): Vorschläge übernehmen und verwerfen (LLH-2112)`.

### Task 6: Modulzähler

**Files:**
- Modify: `src/einsatz/zaehler.rs` (`MeldungsZaehler.vorschlaege_offen: i64`), `src/meldung/repo.rs::zaehlen` (setzt das Feld über `vorschlag::zaehle_offene`)
- Test: `tests/modul_zaehler.rs`
- Regenerate: Typ-Codegen

- [ ] **Step 1: Failing test** `offene_vorschlaege_zaehlen_im_meldungszaehler`: zwei offene, ein abgelaufener, ein verworfener → `vorschlaege_offen == 2`, `offen` unverändert.
- [ ] **Step 2:** `cargo test --test modul_zaehler` → FAIL.
- [ ] **Step 3:** Implementieren; reine Zählregel `zaehle_meldungen` bleibt unberührt, `zaehlen` setzt das Feld wie `sofort_aelteste_at`.
- [ ] **Step 4:** `cargo test --test modul_zaehler --test modul_zaehler_abfragen` → PASS.
- [ ] **Step 5: Commit** `feat(meldung): offene Vorschläge im Modulzähler (LLH-2112)`.

### Task 7: Oberfläche

**Files:**
- Modify: `frontend/src/api/meldungen.ts` (`listeMeldungVorschlaege(einsatzId)`, `uebernehmeMeldungVorschlag(einsatzId, vid, d: NeueMeldung): Promise<Meldung>`, `verwirfMeldungVorschlag(einsatzId, vid): Promise<void>`)
- Modify: `frontend/src/api/queryKeys.ts` (`EINSATZ_KEYS.meldungVorschlaege`, Eintrag in der Liste von `meldung`)
- Create: `frontend/src/meldungen/MeldungVorschlaege.tsx` (+ `MeldungVorschlaege.test.tsx`), `frontend/src/meldungen/maschinenHerkunft.ts` (+ Test)
- Modify: `frontend/src/meldungen/MeldungFormular.tsx` (Props `vorbelegung?: Partial<MeldungFormWerte>` und `hinweis?: ReactNode`; Vorbelegung über das vorhandene Re-Seeding, `DEFAULTS` bleiben)
- Modify: `frontend/src/pages/MeldungenPage.tsx`, `frontend/src/meldungen/MeldungenSchmal.tsx` (Bereich über der Liste), `frontend/src/meldungen/MeldungKarte.tsx`, `frontend/src/pages/LagemeldungenPage.tsx` (Herkunftsetikett), Navigationszähler des Moduls (Stelle, die `modulZaehler.meldungen.offen` anzeigt: `offen + vorschlaege_offen`)

**Interfaces:**
- Produces: `herkunftText(h: { adapter: string; kennung|sender_id: string; name?|sender_name?: string|null; signiert|signed: boolean }): string` in `maschinenHerkunft.ts` → `"Mesh · Knoten „Nord-1“ (!a1b2c3d4) · nicht signiert"`; Adapternamen `{ meshtastic: 'Mesh' }`, sonst das Kennwort; ohne Name `"Mesh · Knoten !77ee01ff · signiert"`.

- [ ] **Step 1: Failing tests:**
  - `maschinenHerkunft.test.ts`: die beiden Texte oben, unbekannter Adapter `postfach` → `"postfach · …"`.
  - `MeldungVorschlaege.test.tsx`: ohne Vorschläge rendert nichts; mit zwei zeigt die Überschrift „Vorschläge · unverifiziert (2)“, Text, Herkunft; „Als Meldung übernehmen“ öffnet das Formular mit Inhalt = Text, Absender = Name sonst Kennung, Meldeweg `funk`, Ereigniszeit = `sent_at` sonst `received_at`, und Speichern ruft `uebernehmeMeldungVorschlag`; „Verwerfen“ ruft `verwirfMeldungVorschlag`.
  - `MeldungKarte.test.tsx`: mit `maschinen_herkunft` erscheint „unverifiziert übernommen · …“, ohne nicht.
- [ ] **Step 2:** `mise exec -- pnpm -C frontend test -- --run meldungen` → FAIL.
- [ ] **Step 3:** Implementieren nach `frontend/AGENTS.md` (Gestaltungssprache, Bedien-Leitlinie, Query-Keys). Ob „Verwerfen“ eine Rückfrage bekommt, entscheidet die Bedien-Leitlinie; die Wahl im Commit nennen.
- [ ] **Step 4:** `mise exec -- pnpm -C frontend test -- --run && mise exec -- pnpm -C frontend typecheck && mise exec -- pnpm -C frontend lint` → PASS.
- [ ] **Step 5: Commit** `feat(meldungen): Vorschläge im Meldungseingang (LLH-2112)`.

### Task 8: Regeln, Doku, Gates, Bilder

**Files:**
- Create: `docs/architektur/entscheidungen/ADR-0112-ein-maschinenzugang-liest-und-schreibt-einsatzbezogen-nur-im-freigegebenen-einsatz.md` (Vorlage `VORLAGE.md`; Regeln aus dem Design-Doc, Abschnitt „Entscheidung“; `ersetzt: ADR-0035`; Prüfung übernimmt die von ADR-0035 und ergänzt `verlange 'Scope::MeldungenWrite' src/public_api/scope.rs`, `verlange '"meldung_vorschlag"' src/instanz/spiegel/art.rs`)
- Modify: ADR-0035 (`status: ersetzt`, `ersetzt_durch: ADR-0112`)
- Modify: `src/AGENTS.md`, Abschnitt „Öffentliche API v1“ (zwei Sätze mit Verweis auf ADR-0112); Verweise auf ADR-0035 im Code greppen und, wo sie die Regel meinen, auf ADR-0112 umstellen
- Modify: Anwenderdoku (Kapitel Meldungseingang, Kapitel Anbindungen) und Architekturdoku nach `docs/anwender/AGENTS.md` bzw. `docs/architektur/AGENTS.md`

- [ ] **Step 1:** `scripts/adr-fuer.sh src/public_api/scope.rs` zeigt ADR-0112 mit ihren Regeln; `scripts/check-adr-nummern.sh` → OK.
- [ ] **Step 2:** Doku schreiben, Wächter der Anwenderdoku laufen lassen (Kommando in `docs/anwender/AGENTS.md`).
- [ ] **Step 3:** `./scripts/check-all.sh --geaendert --ohne-e2e` → grün (ein Aufruf, ggf. `run_in_background`).
- [ ] **Step 4:** Bilder der Änderung per Wegwerf-Spec `frontend/e2e/doku-bilder/zz-jd4jgna4.bilder.ts` (Vorschlagsbereich mit zwei Vorschlägen, vorbelegtes Formular, Meldungskarte mit Herkunft); Spec danach löschen.
- [ ] **Step 5: Commit** `docs(meldung): ADR-0112 und Doku zum Maschinen-Eingang (LLH-2112)`.
