# Rücknahme für Personal-, Material- und Einheitsstatus — Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quittung „<Name>: <alt> → <neu> · Rückgängig“ mit echtem Server-Rückweg für Personal-, Material- und Einheits-Handstatus, auf einem gemeinsamen Baustein, den auch das Fahrzeug nutzt.

**Architecture:** Jede Tabelle merkt sich beim Wechsel wer, wann, Vorzustand und Zeitachsen-Ereignis (Migration 0363). `src/status_ruecknahme.rs` prüft den Riegel und streicht das Ereignis; je Art eine Route `…/status/zuruecknehmen`. Im Frontend ein Hook `useStatusQuittung` für alle vier Arten.

**Tech Stack:** Rust (axum, sqlx/SQLite), React + TanStack Query + antd, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-22-hau6f7rm-status-ruecknahme-handstatus-design.md`

## Global Constraints

- Frist: `crate::entlassung::RUECKNAHME_FRIST_MINUTEN` (10), Prüfung über `is_in_ruecknahme_frist(gesetzt_at, jetzt)`.
- Status inzwischen anders → `AppError::Veraltet` (409 `veraltet`); andere Person/Frist/Ordnung → `AppError::Conflict` mit Grund.
- Grund der Streichung: „Statuswechsel zurückgenommen“ (`GRUND_STATUS_RUECKNAHME`).
- ETB: „Person «X»: Statuswechsel «A» → «B» zurückgenommen“, „Material «X»: …“, „Einheit «X»: …“; fehlender Wert „—“.
- Fahrzeug-Wire (Route, `StatusRuecknahmeBeleg`, `FahrzeugPatchAntwort`) bleibt unverändert.
- Bezeichner: Fachbegriffe deutsch, Technik englisch (`AGENTS.md`, LFH-1312); Prosa deutsch.
- Nach DTO-Änderungen `scripts/check-typ-codegen.sh`, beide erzeugten Dateien committen.
- Quittung: 6 s, Knopf „Rückgängig“, antd-`message`, kein Fokuswechsel; Schlüssel `lfh-status-quittung-<art>-<id>`.

## Review Focus

1. Zwei Wechsel derselben Person hintereinander (A→B→C): Beleg des ersten → 409 `veraltet`, Beleg des zweiten → zurück auf B, nicht A. (Task 3)
2. Material: Status wechseln, dann Menge oder Art ändern oder aufteilen, dann Rückgängig → 409, Zeile unverändert. (Task 4)
3. Einheit: Handstatus gesetzt, danach Fahrzeug zugeordnet, Rückgängig → 409; war der Vorzustand „kein Status“, gelingt sie. (Task 5)
4. Personalstatus ohne Zeitachsen-Marke (kein Ereignis): Rücknahme gelingt trotzdem. (Task 3)
5. Gleiche ID bei verschiedenen Arten (Fahrzeug 7, Person 7) überschreibt die Quittung nicht. (Task 6)

---

### Task 1: Gemeinsamer Baustein, Fahrzeug umgestellt

**Files:**
- Create: `src/status_ruecknahme.rs`; Modify: `src/lib.rs` (Modul), `src/fahrzeug/disposition_repo.rs:2943-3084`

**Interfaces:**
- Produces:
  - `pub const GRUND_STATUS_RUECKNAHME: &str` (aus `fahrzeug/disposition_repo.rs` verschoben, dort `pub use` für bestehende Verweise)
  - `pub fn conflict() -> AppError` (Text wie bisher `status_ruecknahme_conflict`)
  - `pub struct Gemerkt<S> { pub status: S, pub kennung: Option<String>, pub gesetzt_von: Option<i64> }`
  - `pub fn pruefe<S: PartialEq>(gemerkt: &Gemerkt<S>, beleg_status: &S, beleg_kennung: &str, benutzer_id: i64, jetzt: &str) -> Result<(), AppError>` — Status oder Kennung ungleich → `Veraltet`; Person ungleich oder Frist um → `conflict()`
  - `pub async fn streiche_ereignis_tx(conn, einsatz_id, benutzer_id, kraft: zeitachse::repo::Kraft, ereignis_id: Option<i64>) -> Result<zeitachse::repo::Beruehrt, AppError>` — streicht nur ein offenes Ereignis dieser Kraft; Fehler `UnprocessableEntity|Conflict` → `Conflict("Der Statuswechsel lässt sich nicht zurücknehmen: {m}")`

- [ ] **Step 1:** Unit-Tests in `src/status_ruecknahme.rs`: `pruefe_gelingt_fuer_dieselbe_person_in_der_frist`, `anderer_status_ist_veraltet`, `andere_kennung_ist_veraltet`, `andere_person_ist_conflict`, `nach_elf_minuten_ist_conflict` (Kennung `2026-11-22 10:00:00`, jetzt `10:11:00`), `ohne_gesetzt_von_ist_conflict`.
- [ ] **Step 2:** `cargo test --lib status_ruecknahme` → FAIL (Modul fehlt).
- [ ] **Step 3:** Modul bauen; `status_zuruecknehmen_tx` des Fahrzeugs ruft `pruefe` (Kennung = `status_seit`) und `streiche_ereignis_tx` (Kraft `Einheit`, nur wenn `einheit_id`).
- [ ] **Step 4:** `cargo test --lib status_ruecknahme` und `cargo test --test einsatz_fahrzeug statuswechsel rueckname gleicher_status` → PASS (Fahrzeug unverändert grün).
- [ ] **Step 5:** Commit `refactor: gemeinsamer Riegel für die Rücknahme eines Statuswechsels`.

### Task 2: Migration und Schwärzung

**Files:**
- Create: `migrations/0363_status_ruecknahme_hand.sql` (Nummer gegen `origin/alpha` prüfen); Modify: `src/einsatz/schwaerzung_registry.rs` (Regeln `einsatz_personal`, `einsatz_einheit`, `einsatz_material`)

**Interfaces:**
- Produces Spalten laut Design E1: `einsatz_personal(status_gesetzt_von, status_gesetzt_at, status_vorher_id, status_ereignis_id)`, `einsatz_material(status_gesetzt_von, status_gesetzt_at, status_vorher)`, `einsatz_einheit(status_gesetzt_von, status_gesetzt_at, status_vorher_id, status_vorher_seit, status_ereignis_id)`. Kopfkommentar wie 0356.

- [ ] **Step 1:** Migration schreiben; `status_vorher` des Materials mit `CHECK (status_vorher IS NULL OR status_vorher IN (…fünf Werte…))`.
- [ ] **Step 2:** Registry: `retain(…, G_FK)` für `*_von`, `*_id`; `G_ZEIT` für `*_at`, `*_seit`; `status_vorher` wie `status` des Materials (`G_ENUM`).
- [ ] **Step 3:** `cargo test --lib schwaerzung` und `cargo test --lib migrationslauf` → PASS (der Registry-Wächter verlangt jede Spalte).
- [ ] **Step 4:** Commit `feat: Spalten für die Rücknahme von Personal-, Material- und Einheitsstatus`.

### Task 3: Personal — Wechsel merken, Rücknahme-Route

**Files:**
- Modify: `src/personal/disposition_repo.rs` (`DispositionPatch`, `update_tx`, `entlassen_tx`, neue `merke_status_ereignis_tx`, `status_zuruecknehmen_tx`), `src/personal/mod.rs` (Beleg, Antwort, ETB-Text), `src/routes/einsatz_personal.rs` (`update`, neue `status_zuruecknehmen`), `src/app.rs`, `src/api_doc.rs`, `src/abloesung/schichtplan/vollzug.rs:590` (roher UPDATE leert die Spalten)
- Test: `tests/einsatz_personal.rs`

**Interfaces:**
- Consumes: Task 1 (`pruefe`, `streiche_ereignis_tx`), Task 2.
- Produces:
  - `DispositionPatch { …, pub gesetzt_von: Option<i64>, pub gesetzt_at: Option<&'a str> }` — bei echtem Statuswechsel: `status_gesetzt_von = gesetzt_von`, `status_gesetzt_at = COALESCE(gesetzt_at, datetime('now'))`, `status_vorher_id = alter status_id`, `status_ereignis_id = NULL`.
  - `pub struct HandStatusRuecknahmeBeleg { #[serde(default)] pub vorher_status_id: Option<i64>, pub status_id: Option<i64>, pub gesetzt_at: String }` in `src/status_ruecknahme.rs` (geteilt mit Task 5), `ToSchema`.
  - `pub struct PersonalPatchAntwort { #[serde(flatten)] pub person: EinsatzPersonalAnzeige, #[serde(skip_serializing_if = "Option::is_none")] pub status_ruecknahme: Option<HandStatusRuecknahmeBeleg> }`
  - `POST /api/einsaetze/{id}/personal/{ep_id}/status/zuruecknehmen` → `EinsatzPersonalAnzeige`
  - `pub fn etb_text_statuswechsel_zurueckgenommen(name: &str, alt: Option<&str>, neu: Option<&str>) -> String`

- [ ] **Step 1:** Integrationstests (Helfer wie `statuswechsel_welt` in `tests/einsatz_fahrzeug.rs`): `personalstatus_zuruecknehmen_stellt_status_her_und_streicht_das_ereignis` (Status mit Marke; Beleg ohne `ereignis_id`; ETB endet auf „» zurückgenommen“; zweites Mal 409 `veraltet`); `personalstatus_ohne_marke_ist_zuruecknehmbar`; `zwei_wechsel_erster_beleg_veraltet_zweiter_stellt_den_mittleren_her`; `personalstatus_andere_person_409`; `personalstatus_nach_elf_minuten_409` (`status_gesetzt_at` per SQL `-11 minutes`); `personalstatus_gleicher_status_ohne_beleg`; `schichtplan_wechsel_ist_nicht_zuruecknehmbar` (Spalten nach `update_tx` ohne `gesetzt_von` leer); `entlassene_person_rueckname_409`.
- [ ] **Step 2:** `cargo test --test einsatz_personal personalstatus` → FAIL.
- [ ] **Step 3:** `update_tx` erweitern; Route `update` setzt `gesetzt_von`/`gesetzt_at`, nimmt `aus_personalstatus_id_tx`, merkt das Ereignis, antwortet `PersonalPatchAntwort` mit Beleg bei echtem Wechsel; `entlassen_tx` und `vollzug.rs:590` leeren die vier Spalten; `status_zuruecknehmen_tx` (aktiv, Zeile lesen, `pruefe` mit Kennung `status_gesetzt_at`, Ereignis streichen mit `Kraft::Person`, UPDATE mit CAS `status_id IS ? AND status_gesetzt_at = ?`, Spalten leeren); Route mit ETB und `sse_personal` je berührter Person; Route in `app.rs`, Typen in `api_doc.rs`.
- [ ] **Step 4:** `cargo test --test einsatz_personal` und `cargo test --test abloesung` → PASS.
- [ ] **Step 5:** Commit `feat: Rücknahme eines Personalstatuswechsels`.

### Task 4: Material — Wechsel merken, Rücknahme-Route

**Files:**
- Modify: `src/material/disposition_repo.rs` (`MaterialPatch`, `update_tx`, `teile_auf_tx`, `entlassen_tx`, neue `status_zuruecknehmen_tx`), `src/material/mod.rs` (Beleg, Antwort, ETB-Text), `src/routes/einsatz_material.rs`, `src/app.rs`, `src/api_doc.rs`, `src/demo/import.rs:871` (Patch-Literal)
- Test: `tests/einsatz_material.rs`

**Interfaces:**
- Produces:
  - `MaterialPatch { …, pub gesetzt_von: Option<i64>, pub gesetzt_at: Option<&'a str> }` — echter Statuswechsel setzt `status_gesetzt_von/at`, `status_vorher`; ändert der Patch Menge oder Art (Wert anders als vorher), werden die drei Spalten geleert.
  - `pub struct MaterialStatusRuecknahmeBeleg { #[serde(default)] pub vorher_status: Option<MaterialStatus>, pub status: MaterialStatus, pub gesetzt_at: String }`
  - `pub struct MaterialPatchAntwort { #[serde(flatten)] pub material: EinsatzMaterialAnzeige, status_ruecknahme: Option<…> }`
  - `POST /api/einsaetze/{id}/material/{em_id}/status/zuruecknehmen` → `EinsatzMaterialAnzeige`

- [ ] **Step 1:** Tests: `materialstatus_zuruecknehmen_stellt_status_her` (ETB „Material «…»: Statuswechsel …“); `materialstatus_nach_mengenaenderung_409`; `materialstatus_nach_artwechsel_409`; `materialstatus_nach_aufteilen_409_und_teilzeile_ohne_beleg`; `materialstatus_andere_person_409`; `materialstatus_nach_elf_minuten_409`.
- [ ] **Step 2:** `cargo test --test einsatz_material materialstatus` → FAIL.
- [ ] **Step 3:** Umsetzen; Rücknahme prüft die Zielzeile mit `check_zeile(art, menge, ausgegeben, vorher_status, false)` (Fehler → `Conflict` mit Grund), CAS `status = ? AND status_gesetzt_at = ?`; Live wie `notify_orte` (Vor- und Nachzustand der Anzeige) plus `sse_material`; `etb_verteilen`.
- [ ] **Step 4:** `cargo test --test einsatz_material` → PASS.
- [ ] **Step 5:** Commit `feat: Rücknahme eines Materialstatuswechsels`.

### Task 5: Einheit — Handstatus merken, Rücknahme-Route, Gerät

**Files:**
- Modify: `src/einheit/repo.rs` (`setze_hand_status_tx`, `aufloesen_tx`, neue `status_zuruecknehmen_tx`), `src/einheit/mod.rs` (Antwort, ETB-Text), `src/routes/einsatz_einheit.rs` (`status_setzen`, neue Route), `src/app.rs`, `src/api_doc.rs`, `src/geraet/mod.rs` (`EINHEIT` + Test `einheitengeraet_meldet_status_und_quittiert_aber_fuehrt_nicht`)
- Test: `tests/einsatz_einheit.rs`, Gerätefall in der bestehenden Gerätetestdatei für den Einheitsstatus (`grep -l "einheiten/{eid}/status\|/status\"" tests/geraet*.rs`)

**Interfaces:**
- Consumes: `HandStatusRuecknahmeBeleg` (Task 3).
- Produces:
  - `setze_hand_status_tx(conn, einsatz_id, id, status_id, gesetzt_von: Option<i64>, jetzt: &str)`; `status_seit = jetzt` statt `datetime('now')`; merkt `status_vorher_id`, `status_vorher_seit`, `status_gesetzt_*`.
  - `pub struct EinheitStatusAntwort { #[serde(flatten)] pub einheit: EinheitAnzeige, status_ruecknahme: Option<HandStatusRuecknahmeBeleg> }` als Antwort von `PUT …/einheiten/{eid}/status`.
  - `POST /api/einsaetze/{id}/einheiten/{eid}/status/zuruecknehmen` → `EinheitAnzeige`

- [ ] **Step 1:** Tests: `handstatus_zuruecknehmen_stellt_status_und_seit_her_und_streicht_das_ereignis`; `handstatus_loeschen_ist_zuruecknehmbar` (Beleg `status_id: null`); `handstatus_rueckname_nach_fahrzeugzuordnung_409` und `…_zu_kein_status_gelingt`; `handstatus_andere_person_409`; `handstatus_nach_elf_minuten_409`; `aufgeloeste_einheit_rueckname_409`; Gerät: `einheitengeraet_nimmt_eigenen_handstatus_zurueck`, fremde Einheit 404.
- [ ] **Step 2:** `cargo test --test einsatz_einheit handstatus` → FAIL.
- [ ] **Step 3:** Umsetzen; Route schneidet wie `status_setzen` über `abschnitt::bereich` zu; Rücknahme zu `Some(_)` bei aktiven Fahrzeugen → `Conflict("Die Einheit führt ihren Status über ihre Fahrzeuge")`; Live wie `status_setzen` (`sse_einheit`, Personen aus `Beruehrt`, `publish_kopplung`).
- [ ] **Step 4:** `cargo test --test einsatz_einheit`, Gerätetests, `cargo test --lib geraet` → PASS.
- [ ] **Step 5:** Commit `feat: Rücknahme eines Einheits-Handstatus, auch am Gerät`.

### Task 6: Typen, Quittungs-Hook, Fahrzeug umgestellt

**Files:**
- Modify: erzeugte Typen (`scripts/check-typ-codegen.sh`), `frontend/src/api/types.ts` (Aliase), `frontend/src/api/einsatzPersonal.ts`, `einsatzMaterial.ts`, `einheiten.ts` (Antworttypen, `nimmPersonalStatuswechselZurueck`, `nimmMaterialStatuswechselZurueck`, `nimmEinheitStatuswechselZurueck`), `frontend/src/kommunikation/rueckgaengig.tsx`
- Create: `frontend/src/kraefte/useStatusQuittung.ts` (+ `.test.ts`); Delete: `useFahrzeugStatusQuittung.ts` (+ Test, Inhalt wandert); Modify: `FahrzeugePage.tsx`, `pages/einheit/FahrzeugeBesatzung.tsx`

**Interfaces:**
- Produces:
  - `type StatusArt = 'fahrzeug' | 'personal' | 'material' | 'einheit'`
  - `zeigeStatusQuittung(api, q: { art: StatusArt; id: number; name: string; vorher: string; neu: string }, aufRueckgaengig)`; `statusQuittungSchluessel(art, id)` → `lfh-status-quittung-${art}-${id}`
  - `statusKurz(katalog, statusId)` (unverändert), `materialStatusKurz(s?: MaterialStatus | null)` → Label aus `theme/statusFarben.materialStatus` oder „—“, `ruecknahmeFehlerText(name, e)` (unverändert)
  - `useStatusQuittung<B>(opts: { einsatzId: number; art: StatusArt; zuruecknehmen: (id: number, beleg: B) => Promise<unknown>; neuLaden: readonly QueryKey[] })` → `(q: { id: number; name: string; vorher: string; neu: string; beleg: B }) => void`
  - `useFahrzeugStatusQuittung(einsatzId, katalog)` bleibt als dünne Hülle (gleiche Signatur) in `useStatusQuittung.ts`.

- [ ] **Step 1:** Vitest: Schlüssel `('fahrzeug', 7)` ≠ `('personal', 7)`; `statusQuittungText` wie bisher; `materialStatusKurz('desinfektion_noetig') === 'Desinfektion nötig'`, `materialStatusKurz(null) === '—'`; bisherige Fälle aus `useFahrzeugStatusQuittung.test.ts`.
- [ ] **Step 2:** `mise exec -- pnpm -C frontend exec vitest run src/kraefte/useStatusQuittung.test.ts` → FAIL.
- [ ] **Step 3:** Codegen laufen lassen, Hook und API bauen, Fahrzeug-Aufrufer umstellen.
- [ ] **Step 4:** Vitest → PASS; `mise exec -- pnpm -C frontend exec tsc -b` → ohne Fehler.
- [ ] **Step 5:** Commit `feat: gemeinsame Quittung für Statuswechsel im Frontend`.

### Task 7: Aufrufer Personal und Material

**Files:**
- Modify: `frontend/src/pages/PersonalPage.tsx:222-234`, `pages/EinsatzkraftPage.tsx:197-212`, `einteilung/useEinteilungSchreiben.ts` (Pfad per `grep -rl useEinteilungSchreiben frontend/src`), `pages/MaterialPage.tsx:487-500`, `kraefte/MaterialAmOrt.tsx:259-267`
- Test: `frontend/e2e/statusmenue.spec.ts` (ein Fall Personal)

- [ ] **Step 1:** e2e-Fall `personalstatus quittiert und nimmt zurück`: Status einer Person über `StatusWahl` wechseln → Quittung „<Name>: <alt> → <neu>“ sichtbar → „Rückgängig“ → Zeile zeigt alten Status.
- [ ] **Step 2:** Spec laufen lassen (Befehl aus `frontend/e2e/AGENTS.md`) → FAIL.
- [ ] **Step 3:** Mutationen geben die Antwort an `useStatusQuittung` (Name = `name` bzw. `bezeichnung`, Kurzform Label aus Katalog bzw. `materialStatusKurz`); `status_ruecknahme` vor jedem Cache-Schreiben abnehmen.
- [ ] **Step 4:** Spec → PASS; `tsc -b` sauber.
- [ ] **Step 5:** Commit `feat: Quittung nach Personal- und Materialstatuswechsel`.

### Task 8: Aufrufer Einheit und Gerät

**Files:**
- Modify: `frontend/src/pages/KraefteuebersichtPage.tsx:1106-1180`, `pages/EinheitDetailPage.tsx:425-435` (ersetzt `message.success('Status gespeichert')`), `geraet/GeraetStatusPage.tsx:58-63`

- [ ] **Step 1:** Vitest-Fall in `useStatusQuittung.test.ts`: Einheitstext mit gelöschtem Status `statusKurz(k, null) === '—'` und Name = Funkrufname, sonst Name (`einheitQuittungName({ funkrufname, name })`).
- [ ] **Step 2:** Vitest → FAIL.
- [ ] **Step 3:** `einheitQuittungName` exportieren; drei Aufrufer anschließen.
- [ ] **Step 4:** Vitest → PASS; `tsc -b` sauber.
- [ ] **Step 5:** Commit `feat: Quittung nach Einheits-Handstatus, auch am Gerät`.

### Task 9: Regeln und Anwenderdoku

**Files:**
- Modify: `frontend/AGENTS.md:1364-1369`, `frontend/src/kraefte/AGENTS.md` (neuer Abschnitt „Quittung und Rücknahme eines Statuswechsels (LLH-1986)“), Anwenderkapitel zu Personal/Material/Einheit-Status (`grep -rl "Status" docs/anwender/kapitel | xargs grep -l "Rückgängig\|Status setzen"`)

- [ ] **Step 1:** Regeltext nach Design E5 schreiben; Anwenderkapitel um einen Satz „Rückgängig“ ergänzen (Kapitelform `docs/anwender/AGENTS.md`).
- [ ] **Step 2:** `./scripts/check-all.sh --geaendert --ohne-e2e` → grün.
- [ ] **Step 3:** Commit `docs: Regel und Anleitung zur Rücknahme von Statuswechseln`.
