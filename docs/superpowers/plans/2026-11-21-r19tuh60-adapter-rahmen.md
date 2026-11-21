# Adapter-Rahmen Teil A (Backend) — Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Geheimnisspeicher (age, Schlüssel aus der Umgebung), Adapter mit persistiertem Zustand, Hintergrundlauf mit Backoff und Zielschutz, Admin-API, ADR-0076 und Architektur — ohne produktive Adapterart.

**Architecture:** Neues Modul `src/adapter/` (`geheimnis`, `zustand`, `art`, `ziel`, `repo`, `lauf`), Routen `src/routes/adapter.rs`, ein Feld `adapter: adapter::Rahmen` im `AppState` (Geheimnisspeicher + Arten-Verzeichnis, Vorgabe: kein Schlüssel, leeres Verzeichnis). Tests bringen eine eigene Art mit, statt `#[cfg(test)]` im Verzeichnis.

**Tech Stack:** Rust (axum, sqlx/SQLite, age 0.12, reqwest), Migrationen, Markdown.

**Spec:** `docs/superpowers/specs/2026-11-21-r19tuh60-adapter-rahmen-design.md`
**Zunder:** LLH-2017 (`tq9eo4k1k9v9cnrulp7s6joh`), Eltern LLH-1632.

## Global Constraints

- Kein Geheimnis im Klartext in Tabelle, Log, Audit, API-Antwort oder `Debug`.
- Keine DB-Verbindung während eines Abrufs; Ergebnis danach in einer Transaktion (`write_retry!`).
- Jede URL vor jeder Anfrage durch `webhook::ziel::check_url` (IP-Literale umgehen den Resolver).
- Fehler als Code (`AdapterFehler`), nie Text des Ziels.
- Statuscodes nach `src/AGENTS.md`: 400 Feld, 422 Zustand, 409 CAS (`Veraltet`) und gekoppelter ELW (`gesperrt_grund`, wie die Webhooks).
- Webhook-Code und ADR-0046 bleiben unberührt.
- Bezeichner nach Wurzel-`AGENTS.md` (Fachbegriffe deutsch, Technik englisch: `load`, `save`, `is_…`).
- Prosa, Kommentare, Testnamen deutsch.

## Präzisierung gegenüber dem Design-Doc

- Der Speicher lehnt Schreiben nur ab, wenn **kein** Schlüssel da ist (422 `geheimnisspeicher_gesperrt`). Bei `passt_nicht` bleibt Schreiben erlaubt: Neu setzen ist genau der Weg aus diesem Zustand. Ein Platz mit fremdem Fingerabdruck führt im Lauf zu `geheimnis_unlesbar` (braucht Eingriff); dafür kommt dieser Code zu `AdapterFehler` dazu.
- Der Zustand des Speichers wird je Anfrage aus den Zeilen abgeleitet, nicht beim Start eingefroren.

## Review Focus

- Org-Isolation aller Adapter-Routen und des Laufs (fremde ID 404, Lauf schreibt nur die eigene Zeile).
- Kein Klartext eines Geheimnisses in Antwort, Audit-Zeile, Log (Wächtertest).
- 401/403 → angehalten statt Endlosschleife; Ersetzen eines Geheimnisses macht wieder fällig.
- Probelauf übernimmt nichts und ändert den Zustand nicht.
- Gekoppelter ELW: weder Schreiben noch Lauf.

---

### Task 1: Migrationen

**Files:** Create `migrations/0360_adapter.sql`, `migrations/0361_admin_audit_adapter.sql`

- [ ] **Step 1:** `0360`: Tabellen `adapter`, `adapter_geheimnis`, `adapter_versuch` wie im Design-Doc (Abschnitt „Adapter und Arten“); `org_id` mit Index; `zustand IN ('aktiv','angehalten')`; `lan_erlaubt IN (0,1)`; `art` ohne CHECK.
- [ ] **Step 2:** `0361`: Rebuild `admin_audit` nach Muster 0350, neue Aktionen `adapter_angelegt`, `adapter_geaendert`, `adapter_geloescht`, `adapter_geheimnis_gesetzt`, `adapter_geheimnis_entfernt`, `adapter_lan_erlaubt`, `adapter_lan_entzogen`, `adapter_angehalten`, `adapter_fortgesetzt`.
- [ ] **Step 3:** `scripts/check-migrationen.sh` grün.

### Task 2: Geheimnisspeicher

**Files:** Create `src/adapter/mod.rs`, `src/adapter/geheimnis.rs`; Modify `src/lib.rs`, `src/config.rs`, `src/app.rs` (Feld), `src/main.rs`, Test-Konstruktionen des `AppState` (`tests/common/mod.rs`, `tests/backup.rs`, `src/app.rs`, `src/routes/karte.rs`, `src/karte/auto_aktualisierung.rs`), `docs/betrieb/env-registry.md`

**Interfaces:**
- Produces: `GeheimnisSchluessel` (clap-Wert, `Debug` maskiert); `Geheimnisspeicher::{neu(Option<Identity>), fingerabdruck() -> Option<String>, encrypt(&SecretString) -> Result<(Vec<u8>, String), _>, decrypt(&[u8], fp) -> Result<SecretString, Unlesbar>}`; `fn fingerabdruck_von(&Recipient) -> String` (16 Hex).

- [ ] **Step 1 (rot):** Unit-Tests: Rundreise; fremder Schlüssel → unlesbar; ohne Schlüssel → `encrypt` Err; Fingerabdruck stabil, 16 Zeichen; `Debug` zeigt keinen Schlüssel; Parser lehnt `age1…` und Müll ab.
- [ ] **Step 2:** Umsetzen; Verschlüsseln/Entschlüsseln per `spawn_blocking` an den Aufrufstellen.
- [ ] **Step 3:** `--geheimnis-schluessel`/`LIFELINE_GEHEIMNIS_SCHLUESSEL`, `main.rs`: Rahmen bauen, Log ohne Wert (warnt, wenn fehlt und Adapter mit Geheimnissen bestehen).
- [ ] **Step 4:** Tests grün; `env-registry.md` Zeile + Liste maskierter Werte.

### Task 3: Zustand, Fehler, Backoff (reine Funktionen)

**Files:** Create `src/adapter/zustand.rs`

**Interfaces:** `wire_enum! AdapterFehler`, `wire_enum! AdapterZustand`, `fn wartezeit_s(intervall_s, fehlversuche) -> i64`, `fn braucht_eingriff(AdapterFehler) -> bool`, `fn nach_fehlschlag(...)`, `fn zustand_von(&Adapter, art_bekannt) -> AdapterZustand`.

- [ ] **Step 1 (rot):** Wartezeit `max(intervall, min(60·2^(n−1), 900))`; Einteilung (abgelehnt, geheimnis_fehlt, geheimnis_unlesbar, geheimnisspeicher_gesperrt, einstellung_ungueltig, ziel_intern, ziel_ungueltig, weiterleitung → Eingriff; übrige vorübergehend); Ableitung aller sechs Zustände.
- [ ] **Step 2:** Umsetzen, Enum-Kontrakt in `tests/enum_wire_kontrakt.rs`.

### Task 4: Art, Verzeichnis, Abrufkontext mit Zielschutz

**Files:** Create `src/adapter/art.rs`, `src/adapter/ziel.rs`; Modify `src/ausgehend.rs` (`Zweck::Adapter`), `src/http_begrenzt.rs` (`DECKEL_ADAPTER`)

**Interfaces:**
- `trait AdapterArt` (Code, Bezeichnung, Plätze, Felder, Intervall min/Vorschlag, `check_einstellungen`, `abrufen(AbrufKontext) -> BoxFuture<Result<Box<dyn Uebernahme>, Fehlschlag>>`); `trait Uebernahme { anzahl(); uebernehmen(self: Box<Self>, &mut SqliteConnection, &Adapter) -> BoxFuture<Result<i64, AppError>> }`; `Verzeichnis` (Arc-Liste, `find(code)`); `Fehlschlag { art, status }`.
- `AbrufKontext { geheimnis(name) -> Option<&SecretString>, einstellung(name), is_probe, get(url) -> Result<RequestBuilder, Fehlschlag>, senden(rb) -> Result<Response, Fehlschlag>, lies_json<T>(resp) }`.

- [ ] **Step 1 (rot):** `get("https://127.0.0.1/")` → `ziel_intern`; `get("http://…")` → `ziel_ungueltig`; Statuszuordnung 3xx→weiterleitung, 401/403→abgelehnt, 5xx→status; Feldprüfung (Pflicht, Länge, URL mit/ohne LAN).
- [ ] **Step 2:** Umsetzen; Client je LAN-Flag als Singleton wie `webhook::ziel::baue_client`, Resolver `WebhookResolver`, `Zweck::Adapter`.
- [ ] **Step 3:** `ausgehend`-Wächter und Kennungstest um `Zweck::Adapter` ergänzen.

### Task 5: Repo

**Files:** Create `src/adapter/repo.rs`

- [ ] **Step 1:** `create`, `load_in_org`, `list_in_org`, `update` (CAS über `geaendert_at`, Stand streng steigend), `delete`, `save_geheimnis`/`delete_geheimnis` (macht `angehalten` mit Geheimnis-/Speichergrund wieder fällig), `plaetze`, `faellige`, `save_erfolg`, `save_fehlschlag`, `set_angehalten`/`fortsetzen`, `save_versuch` (kappt auf 50).
- [ ] **Step 2:** abgedeckt über Task 6/7 (Integration).

### Task 6: Lauf

**Files:** Create `src/adapter/lauf.rs`; Modify `src/main.rs` (`start`, `herunterfahren`); Test `tests/adapter_lauf.rs`

- [ ] **Step 1 (rot):** Mit Test-Art: Erfolg (Anzahl, letzter Erfolg, nächster Abruf = +Intervall); vorübergehender Fehler (Wartezeit, `gestoert`); 401 → `braucht_eingriff`, nicht mehr fällig; Geheimnis ersetzen → fällig; fehlendes Pflicht-Geheimnis → `geheimnis_fehlt`; fremder Fingerabdruck → `geheimnis_unlesbar`; kein Schlüssel → `geheimnisspeicher_gesperrt`; gekoppelter ELW läuft nicht; Fremd-Org bleibt unberührt; unbekannte Art läuft nicht.
- [ ] **Step 2:** `durchgang(pool, rahmen, jetzt)` + `start`; Probe als `probe(pool, rahmen, adapter, jetzt) -> Versuch` ohne Zustandsänderung.

### Task 7: Admin-Routen, Audit, Codegen

**Files:** Create `src/routes/adapter.rs`, `tests/adapter_admin.rs`; Modify `src/routes/mod.rs`, `src/app.rs`, `src/api_doc.rs`, `src/auth/admin_audit.rs`, `tests/admin_audit.rs` (falls Liste), `tests/eingabegrenzen_spiegel.rs`, `frontend/src/api/eingabegrenzen.ts`, `frontend/src/zugangsprotokoll/zugangsprotokollText.ts` (+Test), generierte Typen

- [ ] **Step 1 (rot):** Anlegen/Liste/Ansicht/Ändern/Löschen; unbekannte Art 400, Intervall unter Minimum 400, fehlende Pflichteinstellung 400; Geheimnis setzen 204, Antwort/Ansicht/Audit ohne Klartext, ohne Schlüssel 422; CAS 409 `veraltet`; Führungskraft liest, schreibt 403; Fremd-Org 404; gekoppelter ELW 409; Probelauf ändert nichts; anhalten/fortsetzen; jede Aktion eine Spur-Zeile mit Adapter-ID, Art, Platz, Host.
- [ ] **Step 2:** Umsetzen; `scripts/check-typ-codegen.sh`; Labels im Zugangsprotokoll.

### Task 8: Regeln und Doku

**Files:** Create `docs/architektur/entscheidungen/ADR-0076-…md`; Modify `src/AGENTS.md`, `docs/architektur/05-…`, `06-…`, `07-…`, `08-…`, `11-…`, `docs/betrieb/backup-restore.md`

- [ ] **Step 1:** ADR-0076 (`vorgeschlagen`) mit Prüfung; `scripts/check-architektur.sh` grün.
- [ ] **Step 2:** `src/AGENTS.md` Abschnitt „Adapter (LLH-1632)“; Kapitel 5/6/7/8/11 (R47); Backup-Doku.

### Task 9: Abschluss

- [ ] **Step 1:** `./scripts/check-all.sh --geaendert --ohne-e2e` grün.
- [ ] **Step 2:** Review nach Ermessen (Anlass: Geheimnisse, Eingaben von außen, > 600 Zeilen) als ein Agent.
- [ ] **Step 3:** PR gegen `alpha` mit Design-Doc, Plan und Umsetzung.
