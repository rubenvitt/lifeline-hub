# Globale Einstellungen + Admin-Bereich Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (empfohlen) oder superpowers:executing-plans — task-by-task TDD. Steps nutzen `- [ ]`.

**Goal:** Org-weite Einstellungen (Anzeige-Konventionen, Retention, Nummernkreis-Präfixe + Default-Fristen + Auto-ETB, Modul-Rollen-Default) aus den Einsatz-Einstellungen herauslösen, als Org-Default mit Pro-Einsatz-Override (Effektivwert = Einsatz ?? Org ?? hartkodiert) anbieten und in einem neuen `/admin`-Bereich neben den Stammdaten verwaltbar machen.

**Architecture:** Neue `org_einstellungen`- (1:1-Leaf/Org) + `org_modul_einstellung`-Tabelle, Domain `src/org/einstellungen.rs` spiegelt `src/einsatz/einstellungen.rs`. Ein reiner Resolver löst je Feld die Fallback-Kette auf; bestehende Konsumenten (Nummernvergabe, Fristen, Retention, Auto-ETB, Modul-Guard) stellen auf den Effektivwert um. Frontend: neuer `/admin`-Shell (Stammdaten + globale Einstellungen), Einsatz-Seite behält die Felder als optionale Overrides mit Org-Standard-Hinweis.

**Tech Stack:** Rust (axum + sqlx-sqlite 0.8.6), React/TS (antd, React Query).

## Global Constraints

- **ADD-COLUMN-/Leaf-freundlich, kein DB-CHECK** — Validierung in Rust (sqlx-sqlite-0.8.6-Rebuild-Limit). Muster strikt aus `src/einsatz/einstellungen.rs`.
- **Validatoren wiederverwenden** (nicht duplizieren) aus `einsatz::einstellungen` (`ist_gueltige_zeitzone`, `ist_gueltiges_zeitformat`, `ist_gueltiges_einheiten_system`, `ist_gueltiges_koordinatenformat`, `ist_gueltiges_nummer_praefix`, `ist_gueltige_frist_min`, `ist_gueltige_retention_dauer`) und `einsatz::modul` (`ist_gueltiger_modul_key`, `ist_gueltige_benoetigte_rolle`).
- **Effektivwert-Regel:** `einsatz_override ?? org_default ?? hartkodierter_fallback`. **Nummern-Startwerte bekommen KEINEN Org-Default** (bleiben rein pro Einsatz).
- **Berechtigung:** `/admin` sichtbar für `system_rolle=admin` ODER `org_rolle=fuehrungskraft` (wie Stammdaten heute, `AppLayout.tsx:29-31` `darfStammdaten`). Globale Einstellungen **schreiben nur `system_rolle=admin`** → sonst 403.
- **Org-Isolation:** alle Queries strikt per `org_id`; nie über Benutzer ableiten (Memory cross-org-lesezugriff-luecke).
- **Fehlercodes:** Validation=400, Forbidden=403, Conflict=409.
- **rust-embed:** Frontend-Änderung = `pnpm build` + Backend-Neustart (erst zur manuellen Verifikation).
- **Migrationsnummer:** nächste freie (`ls migrations/` — 0069 ist belegt; NICHT hart festschreiben).
- **Test-Gates ehrlich:** `rtk proxy cargo test`; Frontend `rtk proxy pnpm vitest run --no-file-parallelism <datei>` (Memory rtk-proxy / frontend-testsuite-parallel-timeouts).
- **Org = 1 Zeile (T1):** `org_id=1`; Tabellen trotzdem `org_id`-scoped (spätere Mandantenfähigkeit).
- Commit-Referenz: `admin-einstellungen`.

## File Structure

**Backend (neu):**
- `migrations/00XX_org_einstellungen.sql` — `org_einstellungen` + `org_modul_einstellung`.
- `src/org/mod.rs` + `src/org/einstellungen.rs` — Org-Domain (Spiegel von `einsatz/einstellungen.rs`).
- `src/org/modul_einstellung.rs` (oder in `einstellungen.rs`) — Modul-Rollen-Default-Repo.
- `src/einsatz/effektiv.rs` — reiner Resolver `effektiv_*`/`EffektiveEinstellungen`.
- `src/routes/org_einstellungen.rs` — GET/PUT-Handler.

**Backend (modifiziert):**
- `src/app.rs` — Modul `org` registrieren, Routen `/api/org-einstellungen`, `/api/org-modul-einstellungen`.
- `src/lib.rs` (oder `main.rs` mod-Liste) — `pub mod org;`.
- `src/einsatz/repo.rs` — Retention-Auto-Fill nutzt Effektivwert.
- `src/etb/repo.rs`, `src/meldung/repo.rs`, `src/auftrag/repo.rs` — Präfix-Quelle = Effektiv (Startwert unverändert).
- `src/routes/meldung.rs`, `src/routes/auftrag.rs` — Default-Fristen + Auto-ETB = Effektiv.
- `src/einsatz/berechtigung.rs` — `fordere_modul_zugriff`: `benoetigte_rolle` = Einsatz-Override ?? Org-Default ?? None.
- `src/routes/einsatz.rs` — `GET /einstellungen` liefert `org_defaults` mit.

**Frontend (neu):**
- `frontend/src/admin/AdminLayout.tsx` — Shell + Sub-Nav.
- `frontend/src/pages/GlobalEinstellungenPage.tsx` — globale Einstellungen.
- `frontend/src/api/orgEinstellungen.ts` — API-Client.

**Frontend (modifiziert):**
- `frontend/src/App.tsx` — Routen `/admin/*`, Redirect `/stammdaten`→`/admin/stammdaten`.
- `frontend/src/components/AppLayout.tsx` — Header-Link „Verwaltung" → `/admin`.
- `frontend/src/api/types.ts` — `OrgEinstellungen`, `OrgModulEinstellung`, `org_defaults` in der Einsatz-Antwort.
- `frontend/src/pages/EinsatzEinstellungenPage.tsx` — vier Gruppen mit Org-Standard-Hinweis.

---

## Task 1: Migration + `org_einstellungen`-Domain

**Files:**
- Create: `migrations/00XX_org_einstellungen.sql`
- Create: `src/org/mod.rs`, `src/org/einstellungen.rs`
- Modify: `src/lib.rs` (`pub mod org;`)

**Interfaces — Produces:**
- `struct OrgEinstellungen` (FromRow) mit Feldern: `org_id: i64`, `zeitzone/zeitformat/einheiten/koordinatenformat: Option<String>`, `retention_dauer_tage: Option<i64>`, `etb_nummer_praefix/meldung_nummer_praefix/auftrag_nummer_praefix: Option<String>`, `meldung_bestaetigung_frist_min/auftrag_quittierung_frist_min: Option<i64>`, `auto_etb_eintraege: Option<i64>`, `geaendert_at: Option<String>`, `geaendert_von: Option<i64>`.
- `struct OrgEinstellungenDaten<'a>` (Input, Borrows wie `EinstellungenDaten`).
- `async fn laden_oder_default(pool, org_id) -> Result<OrgEinstellungen, AppError>` (leere Zeile = alle None).
- `async fn speichern(pool, org_id, erfasser_id, OrgEinstellungenDaten) -> Result<OrgEinstellungen, AppError>` (UPSERT auf `org_id`, setzt `geaendert_at=datetime('now')`, `geaendert_von`).
- `fn anzeige(&self) -> OrgEinstellungenAnzeige` (Serialize; gleiche Felder).

- [ ] **Step 1:** Migration schreiben (Tabelle `org_einstellungen` + `org_modul_einstellung` exakt wie Spec; kein CHECK). `org_modul_einstellung` wird erst in Task 2 genutzt, hier mit anlegen.
- [ ] **Step 2 (Test, rot):** in `src/org/einstellungen.rs` `#[cfg(test)]`-Modul wie in `einsatz/einstellungen.rs` (Fixture: `INSERT OR IGNORE organisation(1)` + Benutzer). Tests: `laden_oder_default_ohne_zeile_ist_leer` (alle None), `speichern_upsert_und_laden` (Round-Trip aller Felder, `COUNT==1` nach zweitem Speichern, `geaendert_von` gesetzt).
- [ ] **Step 3:** `rtk proxy cargo test -p lifeline_hub org::einstellungen` → FAIL (Modul/Tabelle fehlt).
- [ ] **Step 4:** Domain implementieren, Muster 1:1 aus `einsatz/einstellungen.rs` übernehmen (SELECT/UPSERT-Spaltenliste an die neuen Felder anpassen). `pub mod org;` in `lib.rs`, `pub mod einstellungen;` in `org/mod.rs`.
- [ ] **Step 5:** Tests grün. Commit `admin-einstellungen`.

## Task 2: `org_modul_einstellung`-Repo (Modul-Rollen-Default)

**Files:**
- Create/Modify: `src/org/modul_einstellung.rs` (registrieren in `org/mod.rs`)

**Interfaces:**
- Consumes: Tabelle `org_modul_einstellung` (Task 1).
- Produces:
  - `async fn laden_alle(pool, org_id) -> Result<HashMap<String, Option<String>>, AppError>` (modul_key → benoetigte_rolle).
  - `async fn setzen(pool, org_id, modul_key, benoetigte_rolle: Option<&str>) -> Result<(), AppError>` (UPSERT auf (org_id, modul_key); `benoetigte_rolle=None` → Zeile löschen ODER NULL setzen — wähle NULL setzen für Konsistenz).

- [ ] **Step 1 (Test, rot):** `laden_alle_leer_ist_leere_map`; `setzen_dann_laden` (modul_key='etb', rolle='fuehrungskraft' → Map enthält Eintrag); `setzen_validiert_modul_key` ist NICHT hier (Route validiert) — Repo nimmt an, dass der Key gültig ist; `org_isolation` (fremde org_id beeinflusst Map nicht).
- [ ] **Step 2:** cargo test → FAIL.
- [ ] **Step 3:** Repo implementieren (UPSERT-Muster wie `einsatz/modul_override.rs::setzen`/`laden_alle`).
- [ ] **Step 4:** Tests grün. Commit.

## Task 3: Resolver `EffektiveEinstellungen`

**Files:**
- Create: `src/einsatz/effektiv.rs` (registrieren in `einsatz/mod.rs`)

**Interfaces:**
- Consumes: `EinsatzEinstellungen` (`einsatz::einstellungen`), `OrgEinstellungen` (`org::einstellungen`).
- Produces — reine Funktionen (kein DB-Zugriff, injizierte Structs):
  - `fn effektives_etb_praefix(e: &EinsatzEinstellungen, o: &OrgEinstellungen) -> Option<String>` = `e.etb_nummer_praefix.clone().or_else(|| o.etb_nummer_praefix.clone())`. Analog `meldung`/`auftrag`.
  - `fn effektive_meldung_frist_min(e, o) -> Option<i64>` = `e.meldung_bestaetigung_frist_min.or(o.meldung_bestaetigung_frist_min)`. Analog `auftrag_quittierung`.
  - `fn effektive_retention_dauer_tage(e, o) -> Option<i64>`.
  - `fn effektiv_auto_etb_aktiv(e, o) -> bool` = erste nicht-None von `e.auto_etb_eintraege`/`o.auto_etb_eintraege`, `Some(0)=false`, sonst `true` (hartkodierter Default an).
  - `fn effektive_zeitzone/zeitformat/einheiten/koordinatenformat(e, o) -> Option<String>`.
  - `fn effektive_modul_rolle(einsatz_override: Option<&str>, org_default: Option<&str>) -> Option<String>` = `einsatz_override.or(org_default).map(str::to_owned)`.

- [ ] **Step 1 (Test, rot):** Tabellarische Tests je Feld: (a) Einsatz gesetzt + Org gesetzt → Einsatz; (b) Einsatz None + Org gesetzt → Org; (c) beide None → None (bzw. für auto_etb: true). Mindestens ein Test je Resolver-Funktion. Structs direkt mit `..leer()` bauen (keine DB nötig).
- [ ] **Step 2:** cargo test → FAIL.
- [ ] **Step 3:** Resolver implementieren (triviale `or`/`or_else`-Ketten).
- [ ] **Step 4:** Tests grün. Commit.

## Task 4: Routen `GET/PUT /api/org-einstellungen`

**Files:**
- Create: `src/routes/org_einstellungen.rs`
- Modify: `src/app.rs` (Routen registrieren)

**Interfaces:**
- Consumes: `org::einstellungen` (Task 1), Auth-Extraktor (wie bestehende Routen, `system_rolle`/`org_rolle` aus Session).
- Produces: `GET /api/org-einstellungen` → `OrgEinstellungenAnzeige`; `PUT /api/org-einstellungen` (Body wie `EinstellungenUpdate`, validiert) → aktualisierte Anzeige.

- [ ] **Step 1 (Test, rot):** Integrationstest `tests/org_einstellungen.rs` (Muster `tests/modul_override.rs`/`tests/einsatz.rs`): GET als fuehrungskraft → 200; PUT als fuehrungskraft → **403**; PUT als admin gültig → 200 + persistiert; PUT als admin ungültig (z. B. `retention_dauer_tage=0`) → **400**; GET als nicht-eingeloggt → 401.
- [ ] **Step 2:** cargo test → FAIL.
- [ ] **Step 3:** Handler implementieren: Lesen erfordert `darf_admin_bereich` (admin|fuehrungskraft), Schreiben erfordert `system_rolle=admin` (sonst `AppError::Forbidden`). Validierung je Feld mit den wiederverwendeten Validatoren (sonst 400). `org_id` aus dem eingeloggten Benutzer (`benutzer.org_id`), nie aus dem Body. Routen in `app.rs` registrieren.
- [ ] **Step 4:** Tests grün. Commit.

## Task 5: Routen `GET/PUT /api/org-modul-einstellungen`

**Files:**
- Modify: `src/routes/org_einstellungen.rs`, `src/app.rs`

**Interfaces:**
- Produces: `GET /api/org-modul-einstellungen` → `{ <modul_key>: <benoetigte_rolle|null> }`; `PUT /api/org-modul-einstellungen/:modul_key` Body `{ benoetigte_rolle: string|null }`.

- [ ] **Step 1 (Test, rot):** GET als fuehrungskraft → 200 (Map); PUT als fuehrungskraft → 403; PUT als admin gültig (`modul_key='etb'`, `rolle='fuehrungskraft'`) → 200; PUT ungültiger `modul_key` → 400; PUT ungültige Rolle (`'quatsch'`) → 400; `modul_key` aus NICHT_AUSBLENDBAR ist erlaubt (Rollen-Default ≠ Sichtbarkeit) — bewusst kein Sonderfall.
- [ ] **Step 2:** cargo test → FAIL.
- [ ] **Step 3:** Handler: Validierung `ist_gueltiger_modul_key` + `ist_gueltige_benoetigte_rolle` (oder None), `setzen` aufrufen. Gating wie Task 4 (Lesen admin|fuehrungskraft, Schreiben admin).
- [ ] **Step 4:** Tests grün. Commit.

## Task 6: Einsatz-`GET /einstellungen` liefert `org_defaults`

**Files:**
- Modify: `src/routes/einsatz.rs` (Handler `einstellungen_laden`)

**Interfaces:**
- Produces: Response-Objekt um Feld `org_defaults: OrgEinstellungenAnzeige` erweitert (die rohen Einsatz-Override-Werte bleiben unverändert).

- [ ] **Step 1 (Test, rot):** Integrationstest: Org-Default `zeitzone='Europe/Berlin'` gesetzt, Einsatz-`zeitzone` NULL → `GET /einstellungen` liefert `einstellungen.zeitzone=null` UND `org_defaults.zeitzone='Europe/Berlin'`.
- [ ] **Step 2:** cargo test → FAIL.
- [ ] **Step 3:** Handler lädt zusätzlich `org::einstellungen::laden_oder_default(pool, einsatz.org_id)` und serialisiert es als `org_defaults`. Response-Struct anpassen.
- [ ] **Step 4:** Tests grün. Commit.

## Task 7: Nummernkreis-Präfix aus Effektivwert (ETB/Meldung/Auftrag)

**Files:**
- Modify: `src/etb/repo.rs`, `src/meldung/repo.rs`, `src/auftrag/repo.rs` und/oder deren Routen-Aufrufer (`src/routes/etb.rs`, `meldung.rs`, `auftrag.rs`, `lagebericht.rs`)

**Hinweis:** Präfix ist display-only (LFH-133) und wird heute NUR persistiert, noch nicht beim Rendern konsumiert. **Wenn im Code aktuell keine Stelle das Präfix liest**, ist dieser Task eine reine Resolver-Vorbereitung: ändere die Stelle, die das Einsatz-Präfix zur Anzeige/Ausgabe heranzieht (falls vorhanden) auf den Effektivwert; existiert keine solche Stelle, dokumentiere das und überspringe die Code-Änderung (nur Test, dass der Resolver bei späterem Konsum greift). **Startwert bleibt unverändert** (rein Einsatz).

- [ ] **Step 1:** Prüfen (`grep -rn "nummer_praefix" src/`), ob/wo das Präfix konsumiert wird.
- [ ] **Step 2 (Test, rot):** falls Konsum existiert: Test, dass bei Einsatz-Präfix NULL + Org-Präfix 'EB-' der Effektivwert 'EB-' verwendet wird. Falls kein Konsum: Resolver-Test (aus Task 3) deckt es ab → Task auf „dokumentiert, kein Konsum" reduzieren.
- [ ] **Step 3:** Konsumstelle auf `effektives_*_praefix(&einsatz_einst, &org_einst)` umstellen (Org-Einstellungen im Handler laden).
- [ ] **Step 4:** Tests grün. Commit.

## Task 8: Default-Fristen aus Effektivwert (Meldung/Auftrag)

**Files:**
- Modify: `src/routes/meldung.rs`, `src/routes/auftrag.rs`

**Interfaces:**
- Consumes: `effektive_meldung_frist_min`, `effektive_auftrag_quittierung_frist_min` (Task 3).

- [ ] **Step 1 (Test, rot):** Meldung ohne Request-Frist + Einsatz-Frist NULL + Org-Frist=30 → Bestätigungsfrist aus 30 abgeleitet; Org-Frist NULL → bestehende Konstante; Request-Override schlägt beide. Analog Auftrag.
- [ ] **Step 2:** cargo test → FAIL.
- [ ] **Step 3:** Handler laden zusätzlich `org::einstellungen`, reichen den Effektivwert in die Frist-Ableitung (vorhandene Logik aus LFH-133, nur die Default-Quelle wird `effektiv` statt `einsatz`).
- [ ] **Step 4:** Tests grün. Commit.

## Task 9: Retention-Auto-Befüllung aus Effektivwert

**Files:**
- Modify: `src/einsatz/repo.rs` (`abschliessen`-tx)

- [ ] **Step 1 (Test, rot):** Abschluss mit Einsatz-`retention_dauer_tage` NULL + Org-Default=30 → `retention_bis = abschluss + 30 Tage`; beide NULL → keine Frist; Einsatz-Wert gesetzt → Einsatz-Wert schlägt Org.
- [ ] **Step 2:** cargo test → FAIL.
- [ ] **Step 3:** In `abschliessen` zusätzlich `org::einstellungen::laden_oder_default` laden, `effektive_retention_dauer_tage` für die `berechne_retention_bis`-Eingabe nutzen (statt direkt Einsatz-Dauer).
- [ ] **Step 4:** Tests grün. Commit.

## Task 10: Auto-ETB-Schalter aus Effektivwert

**Files:**
- Modify: `src/routes/meldung.rs`, `src/routes/auftrag.rs` (Auto-ETB-Gate)

- [ ] **Step 1 (Test, rot):** Einsatz-`auto_etb_eintraege` NULL + Org=0 → kein ETB-Folgeeintrag bei Meldung/Auftrag; Org NULL → Default an; Einsatz=1 schlägt Org=0 (Override an).
- [ ] **Step 2:** cargo test → FAIL.
- [ ] **Step 3:** Gate-Bedingung auf `effektiv_auto_etb_aktiv(&einsatz, &org)` umstellen.
- [ ] **Step 4:** Tests grün. Commit.

## Task 11: Modul-Guard nutzt Org-Rollen-Default

**Files:**
- Modify: `src/einsatz/berechtigung.rs` (`fordere_modul_zugriff`), dessen Aufrufer (Override-Map-Laden um Org-Default ergänzen)

**Interfaces:**
- Consumes: `org::modul_einstellung::laden_alle` (Task 2), `effektive_modul_rolle` (Task 3).

- [ ] **Step 1 (Test, rot):** Modul ohne Einsatz-Override + Org-Default `etb→fuehrungskraft` → Mitglied ohne Rolle bekommt 403 auf ETB; Einsatz-Override `etb→admin` schlägt Org-Default; kein Override + kein Org-Default → frei (wie heute). Admin-Mindest-Guard bleibt.
- [ ] **Step 2:** cargo test → FAIL.
- [ ] **Step 3:** `fordere_modul_zugriff` (oder der Lade-Pfad davor) zieht zusätzlich die Org-Modul-Defaults heran; effektive Rolle = Einsatz-Override ?? Org-Default ?? `registry_benoetigte_rolle` (None). Signatur ggf. um `org_defaults: &HashMap<..>` erweitern — alle Aufrufer (die Modul-Handler aus LFH-132) nachziehen.
- [ ] **Step 4:** cargo test (ganze Suite, wegen breiter Aufrufer-Änderung) grün. Commit.

## Task 12: Frontend — Typen + API-Client

**Files:**
- Modify: `frontend/src/api/types.ts`
- Create: `frontend/src/api/orgEinstellungen.ts`

**Interfaces:**
- Produces: `interface OrgEinstellungen` (Felder analog Backend, alle nullable); `type OrgModulEinstellungen = Record<string, 'admin'|'fuehrungskraft'|null>`; `org_defaults?: OrgEinstellungen` in der Einsatz-Einstellungen-Antwort; `ladeOrgEinstellungen()`, `speichereOrgEinstellungen(update)`, `ladeOrgModulEinstellungen()`, `setzeOrgModulEinstellung(modulKey, rolle)`.

- [ ] **Step 1 (Test, rot):** `orgEinstellungen.test.ts` — Mock-fetch: `ladeOrgEinstellungen` GET-URL korrekt, `speichereOrgEinstellungen` PUT mit Body; `setzeOrgModulEinstellung` PUT auf `/:modulKey`.
- [ ] **Step 2:** `rtk proxy pnpm vitest run --no-file-parallelism src/api/orgEinstellungen.test.ts` → FAIL.
- [ ] **Step 3:** Typen + Client implementieren (Muster `frontend/src/api/einsaetze.ts`).
- [ ] **Step 4:** Test grün. Commit.

## Task 13: Frontend — `AdminLayout` + Routing + Header

**Files:**
- Create: `frontend/src/admin/AdminLayout.tsx`
- Modify: `frontend/src/App.tsx`, `frontend/src/components/AppLayout.tsx`

**Interfaces:**
- Produces: Route `/admin` (Redirect index → `/admin/stammdaten`), `/admin/stammdaten` (rendert bestehende `StammdatenPage`), `/admin/einstellungen` (Task 14). Alt-Route `/stammdaten` → `<Navigate to="/admin/stammdaten" replace>`. Gate `admin|fuehrungskraft` (sonst Redirect `/einsaetze`).

- [ ] **Step 1 (Test, rot):** `AdminLayout.test.tsx` (MemoryRouter): als fuehrungskraft → Sub-Nav „Stammdaten"/„Einstellungen" sichtbar; als Nicht-Berechtigter → Redirect; `/stammdaten` rendert Redirect-Ziel. Memory-Hinweis: `App.useApp()`, `MemoryRouter`.
- [ ] **Step 2:** vitest → FAIL.
- [ ] **Step 3:** `AdminLayout` mit antd-Sub-Nav (Tabs/Menu) + `<Outlet/>`; Routen in `App.tsx`; Header-Link in `AppLayout.tsx` von `/stammdaten`(„Stammdaten") auf `/admin`(„Verwaltung") umstellen (Gate `darfStammdaten` wiederverwenden, ggf. zu `darfAdmin` umbenennen).
- [ ] **Step 4:** Test grün. Commit.

## Task 14: Frontend — `GlobalEinstellungenPage`

**Files:**
- Create: `frontend/src/pages/GlobalEinstellungenPage.tsx`
- Modify: `frontend/src/admin/AdminLayout.tsx` (Route einhängen)

**Interfaces:**
- Consumes: `orgEinstellungen.ts` (Task 12), Auth (`system_rolle`).

- [ ] **Step 1 (Test, rot):** `GlobalEinstellungenPage.test.tsx`: rendert vier Sektionen (Anzeige-Konventionen, Aufbewahrung, Verhalten & Automatik, Modul-Rollen-Default); Submit sendet alle Felder (Feldabdeckung, Memory review-eingabemaske-feldabdeckung); als fuehrungskraft sind die Felder `disabled` (read-only), Submit-Button fehlt/disabled; als admin editierbar.
- [ ] **Step 2:** vitest → FAIL.
- [ ] **Step 3:** Page implementieren (Form-Muster aus `EinsatzEinstellungenPage.tsx`); Modul-Rollen-Default als Liste je Modul-Key (aus FE-`modulRegistry`) mit Rollen-Select; `disabled={!istAdmin}`.
- [ ] **Step 4:** Test grün. Commit. `pnpm build` (manuelle Verifikation).

## Task 15: Frontend — Einsatz-Seite mit Org-Standard-Hinweis

**Files:**
- Modify: `frontend/src/pages/EinsatzEinstellungenPage.tsx`

**Interfaces:**
- Consumes: `org_defaults` aus der `GET /einstellungen`-Antwort (Task 6).

- [ ] **Step 1 (Test, rot):** Test: bei leerem Einsatz-Feld zeigt das Eingabefeld den Org-Standard als Hinweis/Placeholder „Standard (Org): Europe/Berlin"; ein gesetzter Einsatz-Wert zeigt den Override; Submit sendet weiterhin nur die Einsatz-Override-Werte (leer = null = Org-Standard nutzen).
- [ ] **Step 2:** vitest → FAIL.
- [ ] **Step 3:** Die vier Gruppen (Anzeige-Konventionen, Aufbewahrung, Verhalten & Automatik, plus benoetigte_rolle im Modul-Override) erhalten je Feld einen Org-Standard-Hinweis aus `org_defaults`; Placeholder/Hilfetext „Standard (Org): …". Bestehende Submit-Semantik unverändert (leer → null).
- [ ] **Step 4:** Test grün. Commit. `pnpm build`.

---

## Self-Review (gegen die Spec)

- **Spec-Abdeckung:** Anzeige/Retention/Nummern-Präfixe+Fristen+Auto-ETB → Tasks 7–10; Modul-Rollen-Default → Tasks 2/5/11; Org-Speicherung+Resolver → Tasks 1/3; Admin-Bereich+Routing+Gating → Tasks 4/5/13/14; Einsatz-Override-Hinweis → Tasks 6/15. Alle Spec-Sektionen haben einen Task.
- **Rückwärtskompatibilität:** durch Resolver-Fallback (Org-Defaults starten NULL) inhärent; Tasks 7–11 testen je „Org NULL → hartkodiert wie heute".
- **Typ-Konsistenz:** Resolver-Namen (`effektives_etb_praefix`, `effektive_meldung_frist_min`, `effektiv_auto_etb_aktiv`, `effektive_retention_dauer_tage`, `effektive_modul_rolle`) konsistent in Tasks 3/7/8/9/10/11 verwendet; API-Funktionsnamen (`ladeOrgEinstellungen`/`speichereOrgEinstellungen`/`setzeOrgModulEinstellung`) konsistent Tasks 12/13/14.
- **Offen/Risiko:** Task 7 (Präfix-Konsum) ist konditional — falls kein Konsument existiert, wird er zu Resolver-Vorbereitung reduziert; explizit so dokumentiert (kein Platzhalter).
