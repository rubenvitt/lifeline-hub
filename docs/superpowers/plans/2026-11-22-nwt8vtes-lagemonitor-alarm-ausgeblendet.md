# Lagemonitor: Alarmzeile lässt ausgeblendete Module weg — Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Zunder: https://zunder.rubeen.dev/#/aufgabe/nwt8vtesp5k9mozact6fp1tc (LLH-1964)

**Goal:** Der Block `alarm` der Lagemonitor-Antwort lässt Quellen aus Modulen weg, die im Einsatz ausgeblendet sind, und der Monitor zeigt dazu kein „Stand unvollständig“.

**Architecture:** Der Server bestimmt die im Einsatz ausgeblendeten Module (wirksame Sichtbarkeit, eine Auswertung in `einsatz::berechtigung`), liest deren Daten nicht und nennt die betroffenen Quellen in `alarm.ausgeblendet`. Der Client (`alarmAusMonitor`) meldet diese Quellen als `gesperrt`; `wasBrennt` bleibt unverändert.

**Tech Stack:** Rust (axum, sqlx/SQLite, utoipa), TypeScript (React, Vitest), Typ-Codegen über `openapi.json`.

**Spec:** `docs/superpowers/specs/2026-11-22-nwt8vtes-lagemonitor-alarm-ausgeblendet-design.md`

## Global Constraints

- Maßgeblich ist nur die wirksame Sichtbarkeit (`effektiv_sichtbar`: Einsatz-Override ?? Org-Vorgabe ?? sichtbar); `benoetigte_rolle` zählt nicht. Nicht ausblendbare Module sind nie ausgeblendet.
- Werte ausgeblendeter Quellen werden nicht gelesen und als `0` bzw. `[]` geliefert; `sofort_aelteste_at` fehlt dann.
- `AlarmQuelle`-Werte (snake_case, feste Folge): `meldungen`, `auftraege`, `erinnerungen`, `nachforderungen`, `vermisst`, `kritisch`, `rueckmeldung`, `ausfall`.
- Zuordnung: meldungen→`meldungen`; auftraege→`auftraege`; erinnerungen→`erinnerungen`; nachforderungen→`nachforderungen`; vermisst→`personen`; kritisch→`einsatzabschnitte`; rueckmeldung→`meldungen` oder `einheiten`; ausfall→`einheiten`. `personal`/`fahrzeuge`/`material` ausgeblendet → deren Zeilen gehen leer in den Ausfall.
- `verdichte`, Lagebild für Externe und API v1 bleiben unverändert; Kachel `sofortmeldungen_offen` behält ihre eigene Zählung, wenn `meldungen` ausgeblendet ist.
- Bezeichner: Fachbegriffe deutsch, Technik englisch (`AGENTS.md`, LFH-1312). Prosa deutsch.
- Nach der DTO-Änderung `scripts/check-typ-codegen.sh`, beide generierten Dateien mitcommitten.

## Review Focus

1. Org-Vorgabe blendet aus, Einsatz-Override macht wieder sichtbar → Quelle erscheint (Test in Task 1).
2. Nur Material ausgeblendet → Ausfall durch krankes Personal bleibt, defektes Material zählt nicht (Task 2 und 3).
3. Meldungen ausgeblendet → Kachel `sofortmeldungen_offen` springt nicht auf 0 (Task 3).
4. Älterer Server ohne `ausgeblendet` → Monitor verhält sich wie bisher (Task 4).
5. Nichts ausgeblendet → `ausgeblendet: []`, alle übrigen Werte unverändert (bestehender Test, angepasst in Task 3).

---

### Task 1: Ausgeblendete Module eines Einsatzes

**Files:**
- Modify: `src/einsatz/berechtigung.rs` (neben `lade_modul_regeln`; Tests im `mod tests` derselben Datei)

**Interfaces:**
- Produces: `pub fn ausgeblendete_module_aus(overrides: &HashMap<String, EinsatzModulOverride>, org_defaults: &HashMap<String, OrgModulVorgabe>) -> HashSet<&'static str>` (rein, über `MODUL_KEYS`) und `pub async fn ausgeblendete_module(pool: &SqlitePool, einsatz_id: i64, org_id: i64) -> Result<HashSet<&'static str>, AppError>`.

- [ ] **Step 1: Failing test** `ausgeblendet_folgt_der_wirksamen_sichtbarkeit` im `mod tests`: Overrides `material: sichtbar=Some(false)`, `auftraege: sichtbar=Some(true)`; Org-Vorgaben `auftraege: sichtbar=Some(false)`, `erinnerungen: sichtbar=Some(false)`, `einsatzdaten: sichtbar=Some(false)`, `personen: benoetigte_rolle=Some("admin")`. Erwartet: Menge == `{"material", "erinnerungen"}`.
- [ ] **Step 2:** `cargo test --lib ausgeblendet_folgt_der_wirksamen_sichtbarkeit` → FAIL (Funktion fehlt).
- [ ] **Step 3:** Implementieren. Die reine Funktion wertet `modul_freigabe(...).sichtbar` nicht über einen Benutzer aus, sondern direkt `ist_ausblendbar(key) && !effektiv_sichtbar(override.sichtbar, vorgabe.sichtbar)` — genau die erste Hälfte von `modul_freigabe`; `modul_freigabe` ruft für `sichtbar` künftig dieselbe kleine Hilfsfunktion `fn ist_ausgeblendet(overrides, org_defaults, key) -> bool`, damit die Regel nur einmal steht. Die async-Fassung lädt über `lade_modul_regeln`.
- [ ] **Step 4:** Test → PASS; `cargo test --lib einsatz::berechtigung` grün.
- [ ] **Step 5:** Commit `feat: ausgeblendete Module eines Einsatzes bestimmen (LLH-1964)`.

### Task 2: Ausfall-Lader ohne ausgeblendete Mittel-Listen

**Files:**
- Modify: `src/einsatz/ausfall.rs` (`load_einheiten_mit_ausfall`, Test `lader_liest_die_zeilen_wie_die_listen`)

**Interfaces:**
- Produces: `#[derive(Debug, Clone, Copy)] pub struct AusfallListen { pub personal: bool, pub fahrzeuge: bool, pub material: bool }` mit `AusfallListen::ALLE` (alle `true`); Signatur `load_einheiten_mit_ausfall(pool, einsatz_id, listen: AusfallListen)`. Eine Liste mit `false` wird nicht abgefragt und geht leer ein.

- [ ] **Step 1: Failing test** `lader_liest_ausgeblendete_listen_nicht`: Einheit „Logistiktrupp“ mit defekter Trage direkt an der Einheit (`einheit_id`), Einheit „Sanitätszug“ mit krankem Personal. `listen = { material: false, ..ALLE }` → `["Sanitätszug"]`; `{ personal: false, ..ALLE }` → `["Logistiktrupp"]`; `ALLE` → `["Logistiktrupp", "Sanitätszug"]` (Folge nach `sortier`, Logistiktrupp zuerst anlegen mit kleinerem `sortier`). Fahrzeug-Fall: Fahrzeug mit Status `nicht_verfuegbar` an „Sanitätszug“, `fahrzeuge: false` → zählt nicht; seine Beladung zählt dann ebenfalls nicht (kein bekanntes Fahrzeug).
- [ ] **Step 2:** `cargo test --lib ausfall::tests` → FAIL (Signatur).
- [ ] **Step 3:** Signatur erweitern, je Liste die Abfrage nur bei `true`; bestehenden Test auf `AusfallListen::ALLE` umstellen.
- [ ] **Step 4:** `cargo test --lib ausfall::tests` → PASS.
- [ ] **Step 5:** Commit `feat: Ausfall-Lader liest ausgeblendete Listen nicht (LLH-1964)`.

### Task 3: Block `alarm` lässt ausgeblendete Quellen weg

**Files:**
- Modify: `src/routes/lagemonitor.rs` (`LagemonitorAlarm`, neues `AlarmQuelle`, `fn alarm`, `fn lagebild`)
- Modify: `tests/geraet_kopplung.rs` (Ruhige-Lage-Assertion um `"ausgeblendet": []`; neue Tests)
- Regenerate: `openapi.json`, `frontend/src/api/types.generated.ts` (über `scripts/check-typ-codegen.sh`); ggf. OpenAPI-Registrierung von `AlarmQuelle`, wie andere `ToSchema`-Enums der Datei

**Interfaces:**
- Consumes: `ausgeblendete_module` (Task 1), `AusfallListen` (Task 2).
- Produces: `#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)] #[serde(rename_all = "snake_case")] pub enum AlarmQuelle { Meldungen, Auftraege, Erinnerungen, Nachforderungen, Vermisst, Kritisch, Rueckmeldung, Ausfall }`; Feld `pub ausgeblendet: Vec<AlarmQuelle>` an `LagemonitorAlarm` (immer serialisiert, Folge der Enum-Varianten). TS: `LagemonitorAlarm['ausgeblendet']`.

- [ ] **Step 1: Failing tests** in `tests/geraet_kopplung.rs`, Override per `PUT {basis}/modul-overrides/{modul}` mit `{"sichtbar":false,"benoetigte_rolle":null}` als Admin:
  - `lagemonitor_alarm_laesst_ausgeblendetes_material_weg`: Aufbau wie `lagemonitor_alarm_nennt_ausfall_ohne_personennamen`, dazu defekter Materialposten am Sanitätszug (`INSERT INTO einsatz_material (einsatz_id, snap_bezeichnung, art, menge, status, einheit_id) VALUES (?, 'Trage', 'geraet', 1, 'defekt', ?)`); vor dem Ausblenden `ausfall == ["Sanitätszug","Logistiktrupp"]`, nach `material` aus `ausfall == ["Logistiktrupp"]`, `ausgeblendet == []`.
  - `lagemonitor_alarm_nennt_ausgeblendete_quellen`: überfälliger Auftrag (wie im bestehenden Test), Sofortmeldung, kritischer Abschnitt, Einheit mit krankem Personal; dann `auftraege`, `meldungen`, `einheiten`, `einsatzabschnitte`, `personen` aus. Erwartet: `ausgeblendet == ["meldungen","auftraege","vermisst","kritisch","rueckmeldung","ausfall"]`, `auftraege_ueberfaellig == 0`, `sofort_offen == 0`, kein Feld `sofort_aelteste_at`, `abschnitte_kritisch == []`, `ausfall == []`, und `sofortmeldungen_offen == 1` (Kachel behält ihre Zählung).
  - Ruhige Lage im bestehenden Test: erwartetes JSON um `"ausgeblendet": []` ergänzen.
- [ ] **Step 2:** `cargo test --test geraet_kopplung lagemonitor_alarm` → FAIL.
- [ ] **Step 3:** In `fn alarm` einmal `ausgeblendete_module(pool, einsatz_id, org_id)` laden; je Quelle nur lesen, wenn sichtbar, sonst Default (0, `None`, `Vec::new()`) und Quelle in `ausgeblendet`. `ausfall` mit `AusfallListen { personal: !aus("personal"), fahrzeuge: !aus("fahrzeuge"), material: !aus("material") }`. In `fn lagebild` `anzeige.sofortmeldungen_offen = alarm.sofort_offen` nur, wenn `Meldungen` nicht in `alarm.ausgeblendet`. Doku-Kommentar an `fn alarm` (prüft keine Rechte, aber die Sichtbarkeit) mit Verweis auf `frontend/src/geraet/AGENTS.md`, Lagemonitor.
- [ ] **Step 4:** `cargo test --test geraet_kopplung lagemonitor` → PASS; `./scripts/check-typ-codegen.sh` → grün, generierte Dateien geändert.
- [ ] **Step 5:** Commit `fix: Lagemonitor-Alarm lässt ausgeblendete Module weg (LLH-1964)` inkl. generierter Dateien.

### Task 4: Monitor meldet ausgeblendete Quellen als gesperrt

**Files:**
- Modify: `frontend/src/lage/alarmAusMonitor.ts`, `frontend/src/lage/alarmAusMonitor.test.ts`

**Interfaces:**
- Consumes: `LagemonitorAlarm.ausgeblendet?: AlarmQuelle[]` (generiert in Task 3; optional lesen, älterer Server).
- Produces: unveränderte Signatur `alarmAusMonitor(lage, fehler?)`.

- [ ] **Step 1: Failing tests** in `alarmAusMonitor.test.ts`:
  - `ausgeblendete Quellen sind gesperrt, nicht unvollständig (LLH-1964)`: Antwort mit `ausgeblendet: ['auftraege','vermisst','ausfall']`, `betroffene.vermisst: 2` → `quellen.auftraege`, `quellen.vermisst`, `quellen.ausfall` sind `{ zustand: 'gesperrt' }`; `wasBrennt(quellen, JETZT)` enthält keinen Hinweis „Stand unvollständig“ (Feld wie im bestehenden Test geprüft) und keinen Eintrag der Arten `auftrag`, `vermisst`, `ausfall`.
  - `ohne Feld ausgeblendet wie bisher`: bestehender Monitor-Fall ohne `ausgeblendet` ergibt dieselbe Zeile wie vorher (der bestehende Gleichheitstest deckt das; `ausgeblendet` dort nicht setzen).
- [ ] **Step 2:** `mise exec -- pnpm -C frontend exec vitest run src/lage/alarmAusMonitor.test.ts` → FAIL.
- [ ] **Step 3:** In `alarmAusMonitor` eine Menge aus `a.ausgeblendet ?? []` bilden und jede Quelle darin als `{ zustand: 'gesperrt' }` liefern; Kopfkommentar um den Verweis auf die Regel ergänzen.
- [ ] **Step 4:** Vitest → PASS; `mise exec -- pnpm -C frontend exec tsc --noEmit -p .` und `lint` auf die Datei grün.
- [ ] **Step 5:** Commit `fix: Monitor meldet ausgeblendete Alarmquellen als gesperrt (LLH-1964)`.

### Task 5: Regel festhalten, Gate

**Files:**
- Modify: `frontend/src/geraet/AGENTS.md` (Absatz Lagemonitor, Satz zur Alarmzeile)

- [ ] **Step 1:** Nach „… nie Meldungs-, Auftrags- oder Erinnerungstexte;“ einfügen: Quellen aus Modulen, die im Einsatz ausgeblendet sind (wirksame Sichtbarkeit, keine Rollenschranke), liest der Server nicht; er nennt sie in `alarm.ausgeblendet`, und `alarmAusMonitor` meldet sie als `gesperrt`, damit Monitor und Überblick dasselbe zeigen (LLH-1964, Zuordnung in `fn alarm`). Prettier über die Datei.
- [ ] **Step 2:** `./scripts/check-all.sh --geaendert --ohne-e2e` → grün.
- [ ] **Step 3:** Commit `docs: Regel ausgeblendete Module in der Monitor-Alarmzeile (LLH-1964)`.
