# Helfer-App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eine Kraft scannt am Einsatz einen QR-Code mit der nativen App „Lifeline Helfer“
(iOS/Android), wird von der Einsatzleitung bestätigt, und ihre Position erscheint am gewählten
Ziel auf der Lagekarte, bis der Einsatz endet.

**Architecture:** Der Server erweitert die Gerätekopplung um eine mehrfach einlösbare
Helfer-Einladung und eine Ansicht `helfer` mit Zuständen. Neu sind ein Positionsbaustein (Quelle,
Zeitpunkt, eine Schreibstelle) und ein Org-Schalter „Ortung im Einsatz“. Die Leitung bedient das
im Frontend unter Einsatz → Einstellungen → Geräte. Zwei neue native Apps mit getestetem Kern
(`ios/HelferKern`, `android/helferkern`) lösen ein, orten im Hintergrund und senden an
`PUT /api/devices/me/position`.

**Tech Stack:** Rust/axum/sqlx (SQLite), React/antd/TanStack Query, Swift 6/SwiftUI/ActivityKit/
CoreLocation (iOS 17.4+), Kotlin 2.4/Jetpack Compose/Material 3 (minSdk 29), XcodeGen, Gradle,
GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-24-vakwvkpg-helfer-app-design.md`

Zunder: https://zunder.rubeen.dev/#/aufgabe/vakwvkpgn0ivb1wpq8mlqwhx

## Global Constraints

- Bezeichner: Fachbegriffe deutsch, Technik englisch (`AGENTS.md`, „Bezeichner-Sprache“).
  Prosa, Commits und Testnamen sind deutsch.
- **API-Routen englisch** (ADR-0097). `einsaetze` darf **nicht** in neuen Routen stehen; neue
  Einsatzrouten laufen unter `/api/incidents/{einsatz_id}/…`. Neue Segmente kommen ins Glossar
  `scripts/api-routen-woerter.tsv` (Schritt 14).
- **Neue Wire-Felder englisch**; ein neues Feld in einem bestehenden Typ folgt dessen Sprache.
- Migrationen: Nummer größer als jede auf `origin/alpha` (heute ≥ 0373). Eine Migration nie
  nachträglich ändern. Ein Tabellenumbau mit `-- no-transaction` und `PRAGMA foreign_keys=OFF`
  folgt `migrations/AGENTS.md`.
- Nach jeder DTO- oder Enum-Änderung `scripts/check-typ-codegen.sh` laufen lassen und
  `frontend/src/api/openapi.json` sowie `types.generated.ts` mitcommitten.
- **Statuscodes:** 401 Sitzung ungültig, 403 nicht berechtigt oder Ortung aus, 404 fremd oder
  weg, 409 Zustand passt nicht (`unbestaetigt`, Personenkonto), 422 Inhalt unbrauchbar.
- **Werte:**
  - Einladung: Vorgabe 4 h, höchstens 72 h.
  - Kopplung im Zustand `unbestaetigt`: 2 h.
  - Bestätigte Kopplung: bis zum Einsatzende, höchstens 72 h ab der Bestätigung; Warnung
    30 min vor dem Ablauf.
  - Takt: 30 s, 25 m, Lebenszeichen 5 min.
  - Puffer: höchstens 10 min alt.
  - „Veraltet“ ab 5 min.
  - Wiederholung bei Fehlern höchstens jede Minute.
- **Kennungen:**
  - iOS: Bundle-ID `dev.rubeen.lifeline.helfer`, Erweiterung
    `dev.rubeen.lifeline.helfer.aktivitaet`, Team `H95J852PKP`, ASC-App 6838950939,
    TestFlight-Gruppe „Intern“ (automatische Verteilung).
  - Android: Application-ID `dev.rubeen.lifeline.helfer`, derselbe Keystore (`ANDROID_KEY*`).
- **Deeplink und QR:**
  - QR: `https://<server>/helfer#<CODE>`.
  - Deeplink: `lifeline-helfer://anmelden?server=<url>#<CODE>`.
- **Ortung:**
  - iOS nur „When in Use“ plus `UIBackgroundModes location`, nie `NSLocationAlways…`.
  - Android: Vordergrund-Dienst `location`, nie `ACCESS_BACKGROUND_LOCATION`.
- Kein Verlauf: Server und Gerät halten nur die letzte Position, das Gerät nur im Speicher.
- Native Logik steht im Kern mit Tests; App-Ziele bleiben dünn.

## Review Focus

1. **Wiederholte Einlösung desselben Geräts:** Scannt eine Kraft den QR zweimal, entstehen zwei
   unbestätigte Kopplungen. Erwartet: die App beendet ihre alte Sitzung vor dem neuen Einlösen,
   und die Leitung sieht keine Leichen. Die alte läuft nach 2 h ab. Test in Task 5.
2. **Uhr des Geräts falsch:** Eine Position mit Zeitstempel in der Zukunft würde alle späteren
   sperren („ältere verwerfen“). Erwartet: Der Server klemmt den Zeitstempel auf seine Zeit, wenn
   er mehr als 60 s vorausläuft. Test in Task 3.
3. **Ziel gelöscht während aktiv:** Wird die Einheit aufgelöst oder das Fahrzeug entfernt, steht
   `einheit_id`/`fahrzeug_id` auf NULL. Erwartet: Die nächste Sendung bekommt 403, der Dienst
   stoppt, und die Leitung sieht „Ziel entfernt“. Test in Task 7.
4. **Org-Schalter wird während laufender Ortung ausgeschaltet:** Erwartet: Die nächste Sendung
   bekommt 403, alle Personenpositionen der Org verschwinden, und Einladungen sind gesperrt. Test
   in Task 7.
5. **Doppelklick „Bestätigen“ zweier Leitungen für dasselbe Ziel:** Erwartet: Die eindeutige
   Teilbedingung lässt nur ein Ortungsgerät zu, der zweite Aufruf bekommt 409 mit Grund. Test in
   Task 6.

---

### Task 1: ADR, Regeln, Glossar

**Files:**
- Create: `docs/architektur/entscheidungen/ADR-0098-die-helfer-app-ist-eine-eigene-native-app-und-ortet-im-hintergrund-nur-fuer-eine-aktive-helfer-kopplung.md`
  (Nummer vorher prüfen: die nächste freie auf alpha)
- Create: `ios/Helfer/AGENTS.md`, `android/helfer/AGENTS.md`
- Modify: `AGENTS.md` (Tabelle „Wo die Regeln stehen“: zwei Zeilen)
- Modify: `scripts/api-routen-woerter.tsv`: neu `invitations	Einladungen`, `targets	Ziele`
- Modify: `docs/architektur/` (arc42-Mitänderung nach `docs/architektur/AGENTS.md`: Baustein „Helfer-App“ in Kapitel 5, Verteilung in Kapitel 7)

- [x] **Step 1:** ADR nach `VORLAGE.md` mit Status `akzeptiert`, datum 2026-11-24, Regeln wörtlich
  aus dem Spec-Abschnitt „ADR (neu)“. `gilt_fuer`: `ios/Helfer/**`, `ios/HelferKern/**`,
  `android/helfer/**`, `android/helferkern/**`.
  Prüfung:
  ```sh
  verbiete 'NSLocationAlways' 'ios/Helfer/**'
  verlange 'UIBackgroundModes' 'ios/project.yml'
  verbiete 'ACCESS_BACKGROUND_LOCATION' 'android/helfer/**'
  verlange 'foregroundServiceType="location"' 'android/helfer/src/main/AndroidManifest.xml'
  ```
  Der Prüfblock greift erst, wenn die Dateien existieren. Gelingt das in Task 1 noch nicht,
  setzt Task 11 bzw. 13 die `verlange`-Zeilen.
- [x] **Step 2:** `AGENTS.md` beider Helfer-Ordner (je ≤ 25 Zeilen):
  - native App, für die „keine Anwendungslogik in der Hülle“ nicht gilt;
  - Logik im Kern mit Test;
  - nur der Server der Kopplung;
  - Ortungsregeln mit Verweis auf die ADR;
  - Design-Tokens nur aus dem Generator (Task 9).
- [x] **Step 3:** Run `scripts/check-architektur.sh && scripts/check-adr-nummern.sh && scripts/check-api-routen.sh` → PASS.
- [x] **Step 4:** Commit `docs: ADR und Regeln für die Helfer-App`.

### Task 2: Migration und Org-Schalter „Ortung im Einsatz“

**Files:**
- Create: `migrations/0373_helfer_app.sql` (Nummer prüfen)
- Modify: `src/org/einstellungen.rs` (Struct, Anzeige, Daten), `src/routes/org_einstellungen.rs`
- Modify: `frontend/src/pages/einstellungen/EinsatzDefaults.tsx`, `orgEinstellungenForm.ts`
- Test: `tests/org_einstellungen.rs` (bestehende Datei, sonst anlegen), `frontend/src/pages/einstellungen/EinsatzDefaults.test.tsx`

**Interfaces:**
- Produces:
  - DB: `org_einstellungen.ortung_im_einsatz INTEGER NOT NULL DEFAULT 0`, `ortung_personen INTEGER NOT NULL DEFAULT 0`, `ortung_bestaetigt_von INTEGER REFERENCES benutzer(id)`, `ortung_bestaetigt_at TEXT`.
  - Je `einsatz_einheit`, `einsatz_fahrzeug`, `einsatz_personal`: `position_aktualisiert_at TEXT`, `position_quelle TEXT CHECK (position_quelle IN ('manuell','einwurf','helfer'))`. Bestand: `UPDATE … SET position_quelle='manuell' WHERE lat IS NOT NULL`.
  - `helfer_einladung(id INTEGER PK, einsatz_id INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE, code_hash TEXT NOT NULL UNIQUE, laeuft_ab_at TEXT NOT NULL, widerrufen_at TEXT, erstellt_von INTEGER NOT NULL REFERENCES benutzer(id), erstellt_at TEXT NOT NULL, einloesungen INTEGER NOT NULL DEFAULT 0)`. Höchstens eine gültige je Einsatz sichert die Logik, nicht die DB.
  - Umbau `geraet_kopplung` (`-- no-transaction`, `_neu` + RENAME, Muster 0286):
    - `ansicht` CHECK um `'helfer'` ergänzt;
    - neue Spalten:
      - `helfer_zustand TEXT CHECK (helfer_zustand IN ('unbestaetigt','aktiv','abgelehnt'))`;
      - `einladung_id INTEGER REFERENCES helfer_einladung(id) ON DELETE SET NULL`;
      - `anzeigename TEXT`;
      - `fahrzeug_id INTEGER REFERENCES einsatz_fahrzeug(id) ON DELETE SET NULL`;
      - `person_id INTEGER REFERENCES einsatz_personal(id) ON DELETE SET NULL`;
      - `person_gewuenscht INTEGER NOT NULL DEFAULT 0`;
      - `ortungsgeraet INTEGER NOT NULL DEFAULT 0`;
      - `pausiert_at TEXT`;
      - `bestaetigt_at TEXT`, `bestaetigt_von INTEGER REFERENCES benutzer(id)`;
    - CHECK `(ansicht = 'helfer') = (helfer_zustand IS NOT NULL)`;
    - CHECK `(einheit_id IS NOT NULL)+(fahrzeug_id IS NOT NULL) <= 1`, zusätzlich zur alten Summenregel;
    - eindeutige Teilindizes `ux_helfer_ortung_einheit ON geraet_kopplung(einheit_id) WHERE ansicht='helfer' AND ortungsgeraet=1 AND widerrufen_at IS NULL` und dasselbe für `fahrzeug_id`.
  - `geraet_kopplung_ereignis.ereignis` CHECK um `bestaetigt`, `abgelehnt`, `abgemeldet` ergänzt; dafür ist ebenfalls ein Umbau nötig, in derselben Migration.
  - Rust: `OrgEinstellungen.ortung_im_einsatz: i64`, `ortung_personen: i64`. Wire in `OrgEinstellungenAnzeige`: `ortung_im_einsatz: bool`, `ortung_personen: bool`, `ortung_bestaetigt_at: Option<String>` (Typ deutsch, Feld folgt dem Typ).
  - `pub async fn ortung_der_org(pool: &SqlitePool, org_id: i64) -> Result<OrtungFreigabe, AppError>` in `src/org/einstellungen.rs` mit `pub struct OrtungFreigabe { pub im_einsatz: bool, pub personen: bool }`.

- [x] **Step 1: Failing test** `org_ortung_ist_anfangs_aus_und_braucht_bestaetigung` in `tests/org_einstellungen.rs`:
  - GET `/api/org-settings` → `ortung_im_einsatz == false`, `ortung_personen == false`;
  - PUT mit `ortung_im_einsatz: true` → 200 und `ortung_bestaetigt_at` gesetzt;
  - PUT `ortung_personen: true` bei `ortung_im_einsatz: false` → 422.
- [x] **Step 2:** Run `cargo test --test org_einstellungen org_ortung` → FAIL.
- [x] **Step 3:** Migration schreiben. Felder in Struct, Anzeige und `setzen` ergänzen: Bestätigung
  setzen, wenn der Schalter von aus auf an geht; 422, wenn `personen` ohne `im_einsatz` kommt.
  `ortung_der_org` anlegen.
- [x] **Step 4:** Run `cargo test --test org_einstellungen` und `scripts/check-migrationen.sh` → PASS.
- [x] **Step 5: Frontend failing test:** Ein Klick auf den Schalter „Ortung im Einsatz“ öffnet
  einen Dialog mit dem Text „Ich bestätige, dass für diese Organisation eine Einwilligung der
  Helfenden bzw. eine Betriebsvereinbarung vorliegt.“; erst „Bestätigen“ setzt das Feld. Darunter
  liegt der Schalter „Auch Personen orten“, gesperrt, solange der erste aus ist.
- [x] **Step 6:** Umsetzen in `EinsatzDefaults.tsx` unter einer eigenen Gruppe „Ortung“. Dann
  `scripts/check-typ-codegen.sh` und `mise exec -- pnpm -C frontend vitest run src/pages/einstellungen` → PASS.
- [x] **Step 7:** Commit `feat: Org-Schalter „Ortung im Einsatz“ und Schema der Helfer-App`.

### Task 3: Positionsbaustein

**Files:**
- Create: `src/ortung/mod.rs` (in `src/lib.rs` als `pub mod ortung;`)
- Modify: `src/einheit/repo.rs:1259 aktualisiere_position`, die Position-Handler in `src/routes/einsatz_einheit.rs:1548`, `einsatz_fahrzeug.rs:1035`, `einsatz_personal.rs:926` (Quelle `manuell`, Zeitpunkt jetzt)
- Modify: Anzeige-DTOs von Einheit, Fahrzeug und Personal: Felder `position_aktualisiert_at: Option<String>`, `position_quelle: Option<String>` (deutsche Typen)
- Modify: `frontend/src/pages/lagekarte/marker.ts` (Alter und Quelle, blass ab 5 min)
- Test: `tests/ortung.rs`, `frontend/src/pages/lagekarte/marker.test.ts`

**Interfaces:**
- Produces:
  ```rust
  pub enum Positionsquelle { Manuell, Einwurf, Helfer }          // wire: manuell|einwurf|helfer
  pub enum Ortungsziel { Einheit(i64), Fahrzeug(i64), Person(i64) }
  pub async fn schreibe_position(conn: &mut SqliteConnection, einsatz_id: i64, ziel: Ortungsziel,
      lat: f64, lon: f64, zeitpunkt: &str, quelle: Positionsquelle) -> Result<bool, AppError>
      // true = geschrieben; false = älter als gespeichert (verworfen)
  pub async fn loesche_position(conn: &mut SqliteConnection, ziel: Ortungsziel) -> Result<(), AppError>
      // lat/lon NULL, Quelle und Zeitpunkt bleiben
  pub fn klemme_zeitpunkt(geraet: &str, jetzt: &str) -> String   // > 60 s Zukunft → jetzt
  pub fn publiziere(state: &AppState, einsatz_id: i64, ziel: Ortungsziel)
      // ruft sse_einheit / sse_fahrzeug / sse_personal
  ```
  `pruefe_koordinate` aus den bestehenden Handlern wiederverwenden (422).
- Frontend: `export function positionsAlter(aktualisiertAt: string | null, jetzt: Date): { minuten: number; veraltet: boolean } | null` in `frontend/src/pages/lagekarte/positionsAlter.ts`.

- [x] **Step 1: Failing tests** in `tests/ortung.rs`:
  - `aeltere_position_wird_verworfen`: erst `t2` schreiben, dann `t1` → zweiter Aufruf `false`,
    `lat` bleibt bei `t2`;
  - `zukunftszeit_wird_auf_serverzeit_geklemmt`: `klemme_zeitpunkt("2026-11-24T12:05:00Z","2026-11-24T12:00:00Z") == "2026-11-24T12:00:00Z"`; bei 30 s Vorlauf unverändert;
  - `manuelle_position_setzt_quelle_manuell`: PATCH `…/units/{eid}/position` → Anzeige
    `position_quelle == "manuell"`, `position_aktualisiert_at` gesetzt.
- [x] **Step 2:** Run `cargo test --test ortung` → FAIL.
- [x] **Step 3:** `src/ortung/mod.rs` umsetzen; die drei Handler über `schreibe_position(…, Manuell)` führen. Die Feld-CAS (`erwartet`) bleibt im Handler.
- [x] **Step 4:** Run `cargo test --test ortung --test einsatz_einheit` → PASS, dann `scripts/check-typ-codegen.sh`.
- [x] **Step 5: Frontend failing test** `positionsAlter`:
  - `null` → `null`;
  - 4 min → `veraltet: false`;
  - 6 min → `veraltet: true`.
  - Marker-Test: Quelle `helfer` zeigt den Untertitel „Helfer-App · vor 6 min“, und das Symbol
    hat die Deckkraft 0,5.
- [x] **Step 6:** Umsetzen, `vitest run src/pages/lagekarte` → PASS.
- [x] **Step 7:** Commit `feat: Positionen mit Quelle und Zeitpunkt`.

### Task 4: Helfer-Einladung (Leitung)

**Files:**
- Create: `src/helfer/mod.rs`, `src/helfer/einladung.rs`, `src/routes/helfer.rs`
- Modify: `src/app.rs` (Routen), `src/api_doc.rs`
- Test: `tests/helfer.rs` (Helfer aus `tests/common/mod.rs`, Muster `tests/geraet_kopplung.rs`)

**Interfaces:**
- Consumes: `geraet::code` (Erzeugen und Hashen des Codes), `ortung_der_org` (Task 2).
- Produces:
  - Routen (Recht `EinsatzLeitungszugriff`, nur aktiver Einsatz):
    - `POST /api/incidents/{einsatz_id}/helpers/invitations` Body `{ "valid_minutes": 240 }` → 201 `HelferEinladungAnzeige { id, code, url, expires_at }`. Ersetzt eine gültige alte Einladung; höchstens 72 h und nicht nach dem Ende des Einsatzes; 403, wenn die Ortung der Org aus ist.
    - `POST /api/incidents/{einsatz_id}/helpers/invitations/{einladung_id}/revoke` → 204.
    - `GET /api/incidents/{einsatz_id}/helpers` → `HelferUebersicht { invitation: Option<HelferEinladungAnzeige ohne code>, helpers: Vec<HelferAnzeige> }`. `HelferAnzeige` hat englische Wire-Felder: `id, display_name, state, target: { kind: "unit"|"vehicle", id, name }, person: Option<{id,name}>, person_requested, is_tracker, paused, last_position_at, expires_at, created_at`.
  - `pub async fn einladung_einloesen(conn, code: &str) -> Result<(einladung_id, einsatz_id, org_id), AppError>` (zählt `einloesungen` hoch; abgelaufen, widerrufen oder Einsatz nicht aktiv → 401).
  - `url` = `helferAdresse(origin, code)` = `https://<host>/helfer#<CODE>`. Der Server baut sie aus der konfigurierten öffentlichen Adresse wie beim Koppeln; fehlt die, baut der Client sie.

- [ ] **Step 1: Failing tests:**
  - `leitung_legt_helfer_einladung_an_und_neue_ersetzt_alte`: zweiter POST → erste Einladung
    beim Einlösen 401;
  - `ohne_ortung_der_org_keine_einladung` (403);
  - `fuehrungspersonal_darf_keine_einladung_anlegen` (403);
  - `einladung_gilt_hoechstens_72_stunden` (`valid_minutes: 10000` → 422).
- [ ] **Step 2:** Run `cargo test --test helfer` → FAIL.
- [ ] **Step 3:** Umsetzen; Glossar-Wörter aus Task 1.
- [ ] **Step 4:** Run `cargo test --test helfer`, `scripts/check-api-routen.sh`, `scripts/check-typ-codegen.sh` → PASS.
- [ ] **Step 5:** Commit `feat: Helfer-Einladung am Einsatz`.

### Task 5: Einlösen, Ansicht `helfer`, eigener Zustand

**Files:**
- Modify: `src/geraet/mod.rs` (`Funktionsansicht::Helfer "helfer"`, `routen()`, `ist_verfuegbar` erst in Task 7 auf true, `stellenart` → None, `rolle` → Beobachter, `lese_module` → `[]`)
- Modify: `src/geraet/repo.rs` (Anlage mit Helferfeldern), `src/routes/helfer.rs`, `src/app.rs`
- Modify: `tests/geraet_routen_guard.rs` (neue Einträge)
- Test: `tests/helfer.rs`

**Interfaces:**
- Produces:
  - `POST /api/devices/helpers/redeem` (öffentlich, `AUTH_CODE_BODY_MAX`, Rate-Limit wie `/api/devices/pair`):
    - Body `{ code, display_name, target: {kind, id}, track_person: bool }`.
    - Antwort 201 mit Set-Cookie und `HelferZustand`.
    - Fehler: 401 Code ungültig; 409 `{reason:"person_session"}` bei Personensitzung im Cookie;
      422 Ziel fremd oder leer, Name leer oder länger als 60 Zeichen.
    - `track_person` wird still `false`, wenn `ortung_personen` aus ist.
    - Legt `geraet_kopplung` an: Ansicht `helfer`, `helfer_zustand='unbestaetigt'`,
      `laeuft_ab_at = jetzt + 2 h`. Sitzung über `session::anlegen_geraet`.
  - `GET /api/devices/helpers/targets?code=…`: Zielliste vor dem Einlösen (Name, Rufname,
    taktisches Zeichen der Einheiten und Fahrzeuge des Einsatzes, keine Personen), 401 bei
    ungültigem Code. Dazu `person_tracking_allowed: bool`.
  - `GET /api/devices/me` → `HelferZustand { state: "unbestaetigt"|"aktiv"|"abgelehnt"|"beendet", reason: Option<"incident_closed"|"revoked"|"expired"|"rejected"|"signed_out">, incident: {id, name}, target, person, is_tracker, paused, expires_at, server_time }`.
  - `PUT /api/devices/me` Body `{ target }` (nur `unbestaetigt`, sonst 409).
  - Routenliste `HELFER` in `src/geraet/mod.rs`: `GET /api/devices/me`, `PUT /api/devices/me`,
    `PUT /api/devices/me/position`, `POST /api/auth/logout`, `GET /api/auth/me`, `GET /api/live`
    (genauer Pfad aus `ALLE_GERAETE`).
  - „Beendet“ nach dem Ende der Sitzung beantwortet der Server mit 401. Den Grund liefert die
    App selbst aus der letzten bekannten Antwort; der Server hält ihn nicht.

- [ ] **Step 1: Failing tests:**
  - `helfer_loest_einladung_ein_und_ist_unbestaetigt`;
  - `zwei_geraete_loesen_dieselbe_einladung_ein`: zwei Kopplungen, beide `unbestaetigt`;
  - `personensitzung_kann_nicht_einloesen` (409);
  - `ziel_aus_fremdem_einsatz_ist_422`;
  - `helfer_darf_keine_lage_lesen`: GET `/api/einsaetze/{id}/units` → 403;
  - `unbestaetigte_kopplung_laeuft_nach_zwei_stunden_ab` (Zeit über `laeuft_ab_at` in der DB
    zurücksetzen → 401);
  - `ziel_aendern_nur_unbestaetigt`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Umsetzen.
- [ ] **Step 4:** Run `cargo test --test helfer --test geraet_kopplung --test geraet_routen_guard` → PASS; `scripts/check-typ-codegen.sh`.
- [ ] **Step 5:** Commit `feat: Helfer lösen die Einladung ein`.

### Task 6: Bestätigen, Ablehnen, Entfernen, Ortungsgerät

**Files:**
- Modify: `src/routes/helfer.rs`, `src/helfer/mod.rs`, `src/geraet/repo.rs` (Ereignisse), `src/geraet/ablauf.rs` (Warnung 30 min vor Ablauf für `helfer`)
- Test: `tests/helfer.rs`

**Interfaces:**
- Produces (Leitung):
  - `POST /api/incidents/{einsatz_id}/helpers/{gid}/confirm` Body `{ target?: {kind,id}, person_id?: i64, is_tracker: bool }`:
    - setzt `aktiv`, `bestaetigt_*`, `laeuft_ab_at = min(jetzt + 72 h, …)` und aktualisiert
      `session.expires_at` wie `verlaengern`;
    - ETB: „Helfer „{name}“ für {ziel} bestätigt von {leitung}.“;
    - 409 `{reason:"tracker_taken", holder: gid}`, wenn das Ziel schon ein Ortungsgerät hat
      (eindeutiger Index, `UNIQUE`-Fehler abfangen);
    - 422, wenn `person_id` nicht im Einsatz ist oder die Org keine Personenortung erlaubt.
  - `POST …/helpers/{gid}/reject` → `abgelehnt`, Sitzungen weg, ETB.
  - `POST …/helpers/{gid}/revoke` → `geraet::repo::widerrufen` + `ortung::loesche_position(Person)`, ETB wie beim Gerät.
  - Ersetzen: `confirm` mit `is_tracker: true, replace: true` nimmt dem bisherigen Ortungsgerät
    des Ziels die Rolle (`ortungsgeraet=0`) und gibt sie diesem Helfer, in einer Transaktion. Das
    ist keine eigene Route. Derselbe Body gilt für einen schon aktiven Helfer (die Rolle
    nachrücken).
  - `POST …/helpers/revoke` → alle Helfer des Einsatzes beendet, ETB als Sammeleintrag.
  - `POST …/helpers/{gid}/extend` → wie `devices/{gid}/extend`.
  - Live: `state.live.melde_kopplung_ende(kopplung_id)` bei Ende; Geräteliste-Ereignis bei jeder
    Änderung (bestehendes Ereignis der Seite `EinsatzGeraete`).

- [ ] **Step 1: Failing tests:**
  - `bestaetigung_macht_aktiv_und_schreibt_etb`;
  - `zweites_ortungsgeraet_fuer_dieselbe_einheit_ist_409`;
  - `zwei_parallele_bestaetigungen_ergeben_ein_ortungsgeraet` (Review Focus 5:
    `tokio::join!` zweier Requests → genau ein 200, ein 409);
  - `ersetzen_uebertraegt_die_ortungsrolle`;
  - `ablehnen_beendet_die_sitzung` (Gerät GET `/api/devices/me` → 401);
  - `entfernen_loescht_personenposition`;
  - `alle_abmelden_beendet_alle_helfer`;
  - `person_nur_mit_personenortung_der_org`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Umsetzen.
- [ ] **Step 4:** Run `cargo test --test helfer` → PASS; Codegen.
- [ ] **Step 5:** Commit `feat: Leitung bestätigt Helfer`.

### Task 7: Position senden

**Files:**
- Modify: `src/routes/helfer.rs`, `src/geraet/mod.rs` (`ist_verfuegbar` für `Helfer` true)
- Test: `tests/helfer.rs`

**Interfaces:**
- Consumes: `ortung::schreibe_position`, `ortung::loesche_position`, `ortung::publiziere`, `ortung_der_org`.
- Produces: `PUT /api/devices/me/position`
  - Body `{ lat, lon, accuracy_m?: f64, recorded_at: RFC3339 }` oder `{ paused: true }` /
    `{ paused: false }`.
  - Antworten:
    - `unbestaetigt` → 409 `{reason:"unconfirmed"}`, nichts gespeichert;
    - Org-Ortung aus, kein Ziel (gelöscht), weder Ortungsgerät noch Person → 403
      `{reason:"tracking_off"|"target_removed"|"no_role"}`;
    - Koordinate unplausibel → 422;
    - sonst 200 `{ stored: bool, server_time }`.
  - Geschrieben wird an das Ziel nur, wenn `ortungsgeraet=1`, an die Person nur bei `person_id`
    und `ortung_personen`. Quelle `helfer`, Zeitpunkt geklemmt.
  - `paused: true` → `pausiert_at` setzen, Personenposition löschen, 200.
  - Bei jeder erfolgreichen Sendung: `letzter_zugriff_at` setzen.
  - Beim Ausschalten des Org-Schalters (Task 2, `setzen`): Personenpositionen aller aktiven
    Helfer der Org löschen.

- [ ] **Step 1: Failing tests:**
  - `unbestaetigt_antwortet_409_ohne_speichern`;
  - `ortungsgeraet_schreibt_an_einheit_mit_quelle_helfer`;
  - `ohne_ortungsrolle_nur_person`;
  - `ohne_rolle_und_person_403`;
  - `geloeschtes_ziel_403_target_removed` (Review Focus 3);
  - `org_schalter_aus_403_und_personen_geloescht` (Review Focus 4);
  - `pausieren_loescht_personenposition`;
  - `einsatz_beendet_401`;
  - `unplausible_koordinate_422` (lat 91).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Umsetzen.
- [ ] **Step 4:** Run `cargo test --test helfer --test geraet_kopplung` → PASS.
- [ ] **Step 5:** Commit `feat: Helfer senden ihre Position`.

### Task 8: Frontend der Leitung und Weiche `/helfer`

**Files:**
- Create: `frontend/src/api/helfer.ts` (`ladeHelfer`, `legeHelferEinladungAn`, `widerrufeHelferEinladung`, `bestaetigeHelfer`, `lehneHelferAb`, `entferneHelfer`, `meldeAlleHelferAb`, `verlaengereHelfer`)
- Modify: `frontend/src/api/queryKeys.ts` (`EINSATZ_KEYS.helfer = 'einsatz-helfer'`, `helfer: (einsatzId) => [...]`; Guard-Test mitziehen)
- Create: `frontend/src/pages/einstellungen/EinsatzHelfer.tsx` (Abschnitt in `EinsatzGeraete.tsx` eingebunden), `helferKern.ts`
- Create: `frontend/src/geraet/HelferWeichePage.tsx`; Modify: `frontend/src/routing/deeplinks.ts` (`HELFER_PFAD='/helfer'`, `helferAdresse(origin, code)`, `helferAppLink(origin, code)` → `lifeline-helfer://anmelden?server=<origin>#<code>`), `App.tsx`
- Modify: Einsatzkopf (Hinweis „{n} Helfer warten auf Bestätigung“, Link zu `…/einstellungen/geraete#helfer`)
- Test: `EinsatzHelfer.test.tsx`, `helferKern.test.ts`, `HelferWeichePage.test.tsx`, `deeplinks.test.ts`

- [ ] **Step 1: Failing tests:**
  - `helferKern`: Sortierung „Wartet“ vor „Angemeldet“ vor „Beendet“, je nach `created_at`;
    Namensvorschlag für die Person nach Gleichheit von `display_name` und `snap_name` (ohne Groß-
    und Kleinschreibung, erstes Wort);
  - `EinsatzHelfer`: „Helfer einladen“ zeigt QR (`QRCodeSVG`, Wert `https://…/helfer#ABCD2345`) und
    Gültigkeit; „Bestätigen“ schickt `is_tracker: true`, wenn das Ziel frei ist; bei 409
    `tracker_taken` erscheint „{Ziel} hat schon ein Ortungsgerät (Name). Ersetzen oder nur Person
    orten?“;
  - die Weiche zeigt „In Lifeline Helfer öffnen“ mit dem `lifeline-helfer://`-Link und löst nicht
    ein (kein Request).
- [ ] **Step 2:** Run `mise exec -- pnpm -C frontend vitest run src/pages/einstellungen src/geraet src/routing` → FAIL.
- [ ] **Step 3:** Umsetzen nach `frontend/AGENTS.md`:
  - Gestaltung im bestehenden Stil der Geräteseite;
  - Druck des QR über das vorhandene Druckmuster (`frontend/src/druck/AGENTS.md`), Blatt
    „Helfer anmelden“ mit QR, Einsatzname, Gültigkeit und drei Schritten;
  - Live: Geräte-Ereignis invalidiert `EINSATZ_KEYS.helfer`.
- [ ] **Step 4:** Vitest und `mise exec -- pnpm -C frontend lint` → PASS.
- [ ] **Step 5:** Commit `feat: Helfer einladen und bestätigen`.

### Task 9: Gemeinsame Fälle und native Design-Tokens

**Files:**
- Create: `src-tauri/faelle/helfer.json`
- Create: `scripts/design/tokens-nativ.mjs` (liest `docs/design/design-system/project/tokens.json`, schreibt `ios/HelferKern/Sources/HelferKern/Tokens.swift` und `android/helferkern/src/main/kotlin/dev/rubeen/lifeline/helferkern/Tokens.kt`), `scripts/check-design-tokens-nativ.sh` (erzeugt neu und prüft per `git diff --exit-code`)
- Modify: `scripts/check-all.sh` (Schritt 21 „Native Tokens und Helfer-Kerne“ im Bündel `schnell`; Swift- und Kotlin-Kerntests der Helfer in den Schritten 18 und 20 mitlaufen lassen), `scripts/bereiche.sh`

**Interfaces:**
- `helfer.json`:
  - `"zweck"`;
  - `"deute"`: QR und Deeplink → `{server, code}` oder `null`. Fälle: https mit Fragment; Deeplink
    mit Server; Code klein geschrieben → groß; fremdes Schema → null; http ohne TLS → null außer
    `localhost` und `*.local`, wie in `adresse.json`;
  - `"antwort"`: Status → `"weiter"|"wiederholen"|"verwerfen"|"warten"|"stoppen"` mit
    200→weiter, 409→warten, 401/403/404→stoppen, 422→verwerfen, 429/500/502/503→wiederholen,
    Netzfehler (`status: 0`)→wiederholen;
  - `"takt"`: `{vorher_s, bewegt_m, seit_letzter_s}` → `senden: bool` mit den Werten aus den
    Global Constraints.
- Tokens: Swift `public enum LifelineFarbe { public static let rolleGrund = Paar(nacht: 0x08090B, tag: 0xE6E7E9) … }`, `enum LifelineAbstand`, `enum LifelineRadius`, `enum LifelineSchrift` (Familien und Skala als Punktwerte). Kotlin: `object LifelineFarbe { val rolleGrund = Paar(nacht = 0xFF08090B, tag = 0xFFE6E7E9) … }` analog. Namen: Token-Name in lowerCamelCase.

- [ ] **Step 1:** `helfer.json` schreiben (mindestens 6 `deute`-, 10 `antwort`- und 5 `takt`-Fälle).
- [ ] **Step 2: Failing check:** `scripts/check-design-tokens-nativ.sh` → FAIL (Dateien fehlen).
- [ ] **Step 3:** Generator umsetzen, laufen lassen, Ausgaben committen.
- [ ] **Step 4:** Run `scripts/check-design-tokens-nativ.sh && ./scripts/check-all.sh --nur 11` → PASS (die Selbsttests verlangen, dass die Bündel `alle` decken).
- [ ] **Step 5:** Commit `chore: gemeinsame Helfer-Fälle und native Design-Tokens`.

### Task 10: iOS `HelferKern`

**Files:**
- Create: `ios/HelferKern/Package.swift` (tools 6.1, `.iOS("17.4")`, `.macOS(.v14)`, Abhängigkeit `../LifelineKern`, Swift 6), `Sources/HelferKern/{Deutung.swift, Anmeldung.swift, Antwortentscheidung.swift, Takt.swift, Puffer.swift, Gruende.swift, Tokens.swift}`, `Tests/HelferKernTests/{GemeinsameFaelle.swift, AnmeldungTests.swift, PufferTests.swift}`
- Modify: `scripts/check-all.sh` Schritt 18 (`cd ios/HelferKern && swift test` zusätzlich)

**Interfaces (Swift):**
```swift
public struct HelferZiel: Equatable, Sendable { public let server: URL; public let code: String }
public func deuteHelferLink(_ text: String) -> HelferZiel?
public enum Antwort: Equatable, Sendable { case weiter, wiederholen, verwerfen, warten, stoppen }
public func entscheide(status: Int) -> Antwort            // status 0 = Netzfehler
public struct Takt: Sendable { public init(mindestabstandS: Double = 30, bewegungM: Double = 25, lebenszeichenS: Double = 300)
  public func soll(senden seitLetzterS: Double, bewegtM: Double) -> Bool }
public struct Puffer: Sendable { public mutating func merke(_ p: Position); public func faellig(jetzt: Date) -> Position? /* jünger als 600 s */ }
public enum Phase: Equatable, Sendable { case start, anmelden(HelferZiel), unbestaetigt, aktiv, pausiert, beendet(Grund) }
public enum Grund: String, Sendable { case einsatzBeendet, entfernt, abgelaufen, abgelehnt, abgemeldet }
public struct Anmeldung { public private(set) var phase: Phase
  public mutating func verarbeite(_ ereignis: Ereignis) }   // Zustandsautomat aus dem Spec
public enum Ereignis { case gescannt(HelferZiel), eingeloest, bestaetigt, antwort(Antwort), pausiert, fortgesetzt, abgemeldet, zustand(String, grund: String?) }
```

- [ ] **Step 1: Failing tests:** `GemeinsameFaelle` liest `src-tauri/faelle/helfer.json` (Muster
  aus `LifelineKern`) und prüft `deute`, `antwort` und `takt`. Dazu:
  - `AnmeldungTests`: `stoppen` in `aktiv` → `beendet`; `warten` in `unbestaetigt` bleibt;
  - `PufferTests`: 601 s alt → nil; nur die letzte Position bleibt.
- [ ] **Step 2:** Run `cd ios/HelferKern && swift test` → FAIL. Lokal gibt es kein Swift: dann in
  der CI über den Workflow `ios-pruefung.yml`, der um `HelferKern` ergänzt wird.
- [ ] **Step 3:** Umsetzen.
- [ ] **Step 4:** Run (CI) → PASS.
- [ ] **Step 5:** Commit `feat: Kern der iOS-Helfer-App`.

### Task 11: iOS-App `LifelineHelfer`

**Files:**
- Modify: `ios/project.yml`:
  - Paket `HelferKern`;
  - Ziel `LifelineHelfer` (application, iOS 17.4, Quellen `Helfer/App`, Bundle-ID
    `dev.rubeen.lifeline.helfer`, Entitlements `Helfer/App/LifelineHelfer.entitlements` mit App
    Group `group.dev.rubeen.lifeline.helfer`);
  - Info: `NSLocationWhenInUseUsageDescription` „Lifeline Helfer sendet deine Position an die
    Einsatzleitung, solange du am Einsatz angemeldet bist.“,
    `NSCameraUsageDescription` „Zum Scannen des QR-Codes der Einsatzleitung.“,
    `UIBackgroundModes [location]`, `NSSupportsLiveActivities YES`,
    URL-Schema `lifeline-helfer`;
  - Ziel `HelferAktivitaet` (app-extension WidgetKit, `dev.rubeen.lifeline.helfer.aktivitaet`);
  - Scheme `LifelineHelfer`.
- Create: `ios/Helfer/App/` mit
  - `HelferApp.swift`;
  - `Modell/HelferModell.swift` (`@Observable`, hält `Anmeldung`);
  - `Dienste/Serververbindung.swift` (URLSession, Cookie im Schlüsselbund);
  - `Dienste/Ortungsdienst.swift` (`CLLocationUpdate.liveUpdates`, `CLBackgroundActivitySession`,
    `CLServiceSession(authorization: .whenInUse)` ab iOS 18);
  - `Dienste/LiveAktivitaet.swift`;
  - `Seiten/{StartSeite, ScannerSeite, AnmeldenSeite, WartetSeite, AngemeldetSeite, BeendetSeite}.swift`;
  - `Gestaltung/{Thema.swift, Bausteine.swift}` mit Tokens aus `HelferKern`.
- Create: `ios/Helfer/Aktivitaet/` (ActivityAttributes `OrtungAttribute { einsatz, ziel }`, ContentState `{ letzteSendung: Date?, pausiert: Bool }`, Sperrbildschirm und Dynamic Island, Knopf „Pausieren“ über `LiveActivityIntent`)
- Create: `ios/HelferUITests/StartTests.swift` (ein Smoke-Test: Start zeigt „QR-Code scannen“)
- Create: `.github/workflows/ios-helfer.yml`:
  - Auslöser: `pull_request` mit `types: [labeled, synchronize]` und Bedingung Label
    `testflight-helfer`; dazu `workflow_dispatch`;
  - `macos-26`;
  - `xcodegen generate`; `xcodebuild archive -scheme LifelineHelfer` mit
    `-allowProvisioningUpdates` und `-authenticationKey*` (wie `scripts/ios/testflight.sh`);
    Export mit Upload;
  - `CURRENT_PROJECT_VERSION = github.run_number + 1000`, `MARKETING_VERSION` 0.1.0;
  - Secrets `APP_STORE_CONNECT_*`.
  - Der Upload-Teil kommt als Skript `scripts/ios/testflight-helfer.sh` (Muster `testflight.sh`,
    Scheme als Parameter statt Kopie, wenn sich `testflight.sh` sauber parametrisieren lässt:
    `--scheme`).
- Modify: `ios/AGENTS.md` (ein Satz: Helfer-App unter `ios/Helfer/`, eigene Regeln dort)

- [ ] **Step 1:** UI-Smoke-Test und ein Unit-Test für `HelferModell`: Scan → Phase `anmelden`.
- [ ] **Step 2:** Bildschirme bauen nach dem Spec, Abschnitt „Bildschirme“:
  - SwiftUI, `NavigationStack`, große Typografie;
  - `.glassEffect()` nur hinter `if #available(iOS 26, *)`;
  - Haptik bei Bestätigung;
  - Dynamic Type bis AX3 ohne Abschneiden;
  - Hell und Dunkel über `LifelineFarbe.Paar`.
- [ ] **Step 3:** Ortungsdienst und Live-Aktivität. Start nur aus dem Vordergrund beim
  Einlösen. Stopp bei `Antwort.stoppen` oder beim Abmelden; danach `Activity.end`.
- [ ] **Step 4:** Run (CI `ios-pruefung.yml` um das Ziel `LifelineHelfer` erweitert:
  `xcodebuild build test -scheme LifelineHelfer -destination 'platform=iOS Simulator,name=iPhone 17'`) → PASS.
- [ ] **Step 5:** ADR-Prüfung (`verlange 'UIBackgroundModes'`) aus Task 1 scharf schalten; `scripts/check-architektur.sh` → PASS.
- [ ] **Step 6:** Commit `feat: iOS-App Lifeline Helfer`.

### Task 12: Android `helferkern`

**Files:**
- Create: `android/helferkern/` (eigener Build wie `android/kern`: `settings.gradle.kts`, `build.gradle.kts`, Paket `dev.rubeen.lifeline.helferkern`, Abhängigkeit `dev.rubeen.lifeline:kern`), Quellen analog Task 10: `Deutung.kt`, `Anmeldung.kt`, `Antwortentscheidung.kt`, `Takt.kt`, `Puffer.kt`, `Gruende.kt`, `Tokens.kt`; Tests `GemeinsameFaelleTest.kt`, `AnmeldungTest.kt`, `PufferTest.kt`
- Modify: `android/settings.gradle.kts` (`includeBuild("helferkern")`), `scripts/check-all.sh` Schritt 20 (`-p android/helferkern test`)

**Interfaces (Kotlin):** dieselben Namen wie Task 10 (`deuteHelferLink(text: String): HelferZiel?`,
`entscheide(status: Int): Antwort`, `Takt.soll(seitLetzterS, bewegtM)`, `Puffer.merke/faellig`,
`Anmeldung.verarbeite(ereignis)`, sealed `Phase`, enum `Grund`).

- [ ] **Step 1: Failing tests** wie Task 10.
- [ ] **Step 2:** Run `LC_ALL=C.UTF-8 android/gradlew -p android/helferkern test --console=plain` → FAIL.
- [ ] **Step 3:** Umsetzen.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat: Kern der Android-Helfer-App`.

### Task 13: Android-App `:helfer`

**Files:**
- Create: `android/helfer/build.gradle.kts`:
  - `com.android.application` + `kotlin.compose`;
  - `namespace` und `applicationId` `dev.rubeen.lifeline.helfer`;
  - minSdk 29, targetSdk 36;
  - Signierung aus denselben vier `ANDROID_KEY*`-Variablen wie `:app`.
- Create: `android/helfer/src/main/AndroidManifest.xml`:
  - `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, `FOREGROUND_SERVICE`,
    `FOREGROUND_SERVICE_LOCATION`, `POST_NOTIFICATIONS`, `CAMERA`, `INTERNET`;
  - Dienst `OrtungsDienst` mit `foregroundServiceType="location"`;
  - Intent-Filter `lifeline-helfer://anmelden`.
- Create: `android/helfer/src/main/kotlin/dev/rubeen/lifeline/helfer/`:
  - `MainActivity.kt` (edge-to-edge, vorausschauendes Zurück);
  - `HelferModell.kt` (ViewModel mit `Anmeldung`);
  - `dienste/{Serververbindung.kt (HttpURLConnection oder OkHttp aus dem Katalog; Cookie verschlüsselt), OrtungsDienst.kt (LocationManager, Benachrichtigung mit „Pausieren“, ab API 36 als Live-Update über `Notification.ProgressStyle`/`setRequestPromotedOngoing`)}`;
  - `seiten/{Start, Scanner (CameraX + ML Kit gebündelt), Anmelden, Wartet, Angemeldet, Beendet}.kt`;
  - `ui/Thema.kt` (Material 3 `lightColorScheme`/`darkColorScheme` aus `LifelineFarbe`, keine dynamischen Farben).
- Create: Robolectric- und Roborazzi-Tests `StartSeiteTest.kt` (Text „QR-Code scannen“) und `HelferModellTest.kt` (Scan → `anmelden`).
- Modify: `android/settings.gradle.kts` (`include(":helfer")`).
- Create: `.github/workflows/android-helfer.yml`:
  - `workflow_dispatch` und ein Label `apk-helfer` am PR;
  - baut `:helfer:assembleRelease` mit dem Keystore aus `ANDROID_KEYSTORE_BASE64`;
  - lädt die APK als Workflow-Artefakt hoch. Ein Release-Kanal folgt später: Der Updater-Kanal
    der Helfer-App ist hier nicht Teil.

- [ ] **Step 1:** Failing Robolectric-Tests.
- [ ] **Step 2:** Run `android/gradlew -p android :helfer:testDebugUnitTest` (braucht das SDK; ohne SDK in der CI über `android-pruefung.yml`, erweitert um `:helfer`) → FAIL.
- [ ] **Step 3:** Umsetzen.
- [ ] **Step 4:** Run → PASS. ADR-Prüfung `foregroundServiceType` scharf schalten.
- [ ] **Step 5:** Commit `feat: Android-App Lifeline Helfer`.

### Task 14: Doku

**Files:**
- Create: `docs/datenschutz/dsfa-vorlage-ortung.md`. Inhalt nach Spec „Datenschutz“; die Vorlage
  aus LLH-2091 gibt es noch nicht, deshalb ist diese die gemeinsame.
- Create: `docs/anwender/<kapitel>/helfer-anmelden.md` nach `docs/anwender/AGENTS.md`
  (Kapitelform, Bilder im Bildlauf; die Bilder der Leitungsseite aus Task 8).
- Create: `docs/betrieb/helfer-app.md`:
  - TestFlight-Gruppe „Intern“, Label `testflight-helfer`, APK-Label `apk-helfer`;
  - derselbe Android-Schlüssel;
  - Org-Schalter.
- Modify: `docs/betrieb/endgeraete.md` (Verweis).

- [ ] **Step 1:** Schreiben. Run `scripts/check-architektur.sh` und die Wächter der
  Anwenderdoku aus `docs/anwender/AGENTS.md` → PASS.
- [ ] **Step 2:** Commit `docs: Helfer-App für Anwender, Betrieb und Datenschutz`.

### Task 15: Gates, TestFlight, PR

- [ ] **Step 1:** `./scripts/check-all.sh --geaendert --ohne-e2e` → PASS (ein Bash-Aufruf, ggf. `run_in_background`).
- [ ] **Step 2:** Review nach `dev-zunder-ausfuehren`, „Review nach Ermessen“. Es gibt Anlässe:
  Gerätekopplung, Berechtigung, Migration mit Umbau, Größe. Also ein Agent für das Backend und
  einer für Frontend und Apps; die Befunde abarbeiten.
- [ ] **Step 3:** Bilder: Leitungsseite (Einladen, Wartende, Angemeldete), Lagekarte mit
  Helferposition, Org-Schalter (Wegwerf-Spec im Bildlauf). Die Apps zeigen sich in TestFlight bzw.
  per APK.
- [ ] **Step 4:** Push, PR gegen `alpha` mit Vorlage. Label `testflight-helfer` setzen → Workflow
  `ios-helfer.yml` lädt den Build hoch; die Gruppe „Intern“ bekommt ihn automatisch. Label
  `apk-helfer` → APK als Artefakt.
- [ ] **Step 5:** Zunder: `review` + `pr_url`; Umsetzungsaufgaben als erledigt vermerken.
