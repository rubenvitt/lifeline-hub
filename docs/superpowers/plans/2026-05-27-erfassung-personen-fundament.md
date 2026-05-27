# E‑1 Personen-Fundament + Erfassung Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Den einsatz-scoped Personen-Stamm mit administrativer Status-Maschine, Lese-Audit und pseudonymer ETB-Spur als Fundament für das Teilprojekt „Erfassung" (E‑1…E‑5) bauen.

**Architecture:** Ein neues Backend-Modul `src/person/` (Repo + Audit-Repo + Status-Maschine) hinter den bestehenden Einsatz-Routen, montiert unter `/api/einsaetze/:id/personen`. Es wiederverwendet das Rollen-/Nachlauf-Gate (`src/einsatz/berechtigung.rs`) und den ETB-Schreibpfad (`src/etb/`). Neu: ein **Lese-Audit** auf Detail-/Export-Zugriffe und eine **pseudonyme** ETB-Spur (nur Registriernummer + Status, keine Identität). Der `LiveHub` wird auf getaggte Events erweitert, damit Personen-Änderungen ein dediziertes `person`-SSE-Event ohne sensible Payload broadcasten. Das Frontend ersetzt den `ModulStub` durch ein „Personen"-Modul (Liste mit Status-Sichten, Anlege-Flows, Detail-Drawer).

**Tech Stack:** Rust (axum 0.8, sqlx 0.8/SQLite, tokio), React + TypeScript + Ant Design + TanStack Query, Vitest + MSW (Frontend-Tests), `tower::ServiceExt::oneshot` (HTTP-Integrationstests).

---

## Konventionen & Begriffe (verbindlich für alle Tasks)

- **Backend-Modul:** `src/person/` (`mod.rs`, `repo.rs`, `audit_repo.rs`). In `src/lib.rs` als `pub mod person;` registriert (Task 5).
- **Route-Modul:** `src/routes/einsatz_person.rs`, in `src/routes/mod.rs` als `pub mod einsatz_person;` registriert (Task 8).
- **Tabellen:** `einsatz_person`, `person_zugriff_audit`.
- **URL-Präfix:** `/api/einsaetze/{id}/personen` (Plural in der URL).
- **Status-Werte:** `erfasst`, `vermisst`, `betroffen`, `verstorben`, `abgemeldet`.
- **Geschlecht-Werte:** `maennlich`, `weiblich`, `divers`, `unbekannt`.
- **Audit-Arten:** `detail`, `export`.
- **Registriernummer-Anzeige:** `R-{nr:03}` (z. B. `R-042`). Backend formatiert für ETB-Texte, Frontend für die Liste.
- **ETB-Texte (pseudonym, `typ=system`):** Anlegen → `Person R-042 erfasst`; Status-Wechsel → `Person R-042: vermisst → betroffen`; Stornieren → `Person R-042 storniert`. **Nie** `name`/`vorname`/medizinische Details.
- **Frontend:** API-Client `src/api/einsatzPerson.ts`; Hook `src/etb/usePersonenStream.ts`; Seite `src/pages/PersonenPage.tsx`; Modul-Key `personen` (existiert bereits in `modulRegistry.ts`).

### File Structure

| Datei | Verantwortung | Task |
|---|---|---|
| `src/error.rs` | `AppError::UnprocessableEntity` (422) ergänzen | 1 |
| `src/live/mod.rs` | `LiveNachricht`-Typ + `publiziere_event` | 2 |
| `src/routes/etb.rs` | Stream-Route auf getaggte Nachrichten anpassen | 2 |
| `migrations/0020_einsatz_person.sql` | Personen-Tabelle | 3 |
| `migrations/0021_person_zugriff_audit.sql` | Audit-Tabelle (append-only) | 4 |
| `src/person/mod.rs` | Status-Enum, Geschlecht-Enum, `darf_uebergehen`, `PersonAnzeige`, `registrier_anzeige` | 5 |
| `src/person/repo.rs` | CRUD, `registrier_nr` (MAX+1), Soft-Delete-Filter | 6 |
| `src/person/audit_repo.rs` | Audit anlegen + je Person auflisten (append-only, keine UPDATE/DELETE) | 7 |
| `src/routes/einsatz_person.rs` | HTTP-Handler aller Personen-Routen | 8–11 |
| `src/app.rs` | Routen registrieren | 8–11 |
| `tests/einsatz_person.rs` | HTTP-Integrationstests | 8–12 |
| `frontend/src/api/types.ts` | `Person`, `PersonStatus`, `Geschlecht`, `PersonZugriff` | 13 |
| `frontend/src/api/einsatzPerson.ts` | API-Client | 13 |
| `frontend/src/etb/usePersonenStream.ts` | SSE-Hook (invalidiert nur die Liste) | 14 |
| `frontend/src/pages/PersonenPage.tsx` | Liste + Tabs + Anlege-Flows + Detail-Drawer | 15–17 |
| `frontend/src/App.tsx` | `MODUL_ELEMENTE.personen` | 18 |
| `frontend/src/einsatz/modulRegistry.ts` | Status `geplant` → `fertig` | 18 |

---

## Task 1: `AppError::UnprocessableEntity` (422)

Die Spec verlangt für ungültige Status-Übergänge **422**. Der bestehende `AppError` kennt nur 400 (`Validation`) und 409 (`Conflict`). Neue Variante mit semantisch korrektem 422.

**Files:**
- Modify: `src/error.rs`

- [ ] **Step 1: Failing test für 422 schreiben**

In `src/error.rs` im `#[cfg(test)] mod tests` ergänzen:

```rust
    #[test]
    fn unprocessable_maps_to_422() {
        assert_eq!(
            AppError::UnprocessableEntity("Übergang nicht erlaubt".into()).status(),
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }
```

- [ ] **Step 2: Test ausführen — muss fehlschlagen**

Run: `cargo test --lib error::tests::unprocessable_maps_to_422`
Expected: FAIL (Compile-Fehler: `no variant named UnprocessableEntity`)

- [ ] **Step 3: Variante hinzufügen**

In `src/error.rs` die Enum-Variante (nach `Conflict`):

```rust
    /// Konflikt mit dem aktuellen Zustand (409), z.B. doppelter Benutzername.
    Conflict(String),
    /// Anfrage verstanden, aber der aktuelle Zustand verbietet sie (422),
    /// z.B. ein nicht erlaubter Status-Übergang.
    UnprocessableEntity(String),
```

Im `Display`-`match` (nach `Conflict`):

```rust
            AppError::Conflict(m) => write!(f, "{m}"),
            AppError::UnprocessableEntity(m) => write!(f, "{m}"),
```

Im `status()`-`match` (nach `Conflict`):

```rust
            AppError::Conflict(_) => StatusCode::CONFLICT,
            AppError::UnprocessableEntity(_) => StatusCode::UNPROCESSABLE_ENTITY,
```

- [ ] **Step 4: Test ausführen — muss bestehen**

Run: `cargo test --lib error::tests`
Expected: PASS (alle Error-Tests grün)

- [ ] **Step 5: Commit**

```bash
git add src/error.rs
git commit -m "feat(error): AppError::UnprocessableEntity (422) für ungültige Übergänge"
```

---

## Task 2: `LiveHub` auf getaggte Events erweitern

Der `LiveHub` broadcastet aktuell rohe Strings, die die ETB-Stream-Route pauschal als `event("etb")` taggt. Für ein dediziertes Personen-Event braucht der Kanal einen Event-Typ. Wir stellen den Nachrichtentyp auf `LiveNachricht { event, data }` um. **Das bestehende `publiziere(id, json)` bleibt erhalten** (wrapt intern zu `event="etb"`), sodass alle bestehenden Aufrufer (Material/Fahrzeug/Personal/Einheit/Abschnitt/ETB) unverändert grün bleiben.

**Files:**
- Modify: `src/live/mod.rs`
- Modify: `src/routes/etb.rs:226-233` (Stream-Mapping)

- [ ] **Step 1: Failing test für `publiziere_event` schreiben**

In `src/live/mod.rs` im `#[cfg(test)] mod tests` ergänzen:

```rust
    #[tokio::test]
    async fn publiziere_event_traegt_event_typ() {
        let hub = LiveHub::new();
        let mut rx = hub.abonniere(1);
        hub.publiziere_event(1, "person", r#"{"einsatz_id":1,"person_id":5}"#.into());
        let n = rx.recv().await.unwrap();
        assert_eq!(n.event, "person");
        assert_eq!(n.data, r#"{"einsatz_id":1,"person_id":5}"#);
    }

    #[tokio::test]
    async fn publiziere_wrapt_als_etb_event() {
        let hub = LiveHub::new();
        let mut rx = hub.abonniere(1);
        hub.publiziere(1, "hallo".into());
        let n = rx.recv().await.unwrap();
        assert_eq!(n.event, "etb");
        assert_eq!(n.data, "hallo");
    }
```

- [ ] **Step 2: Test ausführen — muss fehlschlagen**

Run: `cargo test --lib live::tests`
Expected: FAIL (Compile-Fehler: `no method publiziere_event`, `n.event`/`n.data` auf String)

- [ ] **Step 3: `LiveNachricht` einführen und Hub umstellen**

In `src/live/mod.rs` oben (nach den `use`-Zeilen) den Nachrichtentyp definieren:

```rust
/// Eine Live-Nachricht im Einsatz-Kanal: ein SSE-Event-Name plus serialisierte
/// Daten. Clients abonnieren denselben Kanal und filtern per Event-Name
/// (`etb`, `person`, …) — sensible Payload gehört NICHT in `data`.
#[derive(Clone, Debug)]
pub struct LiveNachricht {
    pub event: String,
    pub data: String,
}
```

Das Feld `kanaele` auf den neuen Typ umstellen:

```rust
#[derive(Clone, Default)]
pub struct LiveHub {
    kanaele: Arc<RwLock<HashMap<i64, broadcast::Sender<LiveNachricht>>>>,
}
```

`abonniere` liefert jetzt `LiveNachricht`:

```rust
    pub fn abonniere(&self, einsatz_id: i64) -> broadcast::Receiver<LiveNachricht> {
        let mut kanaele = self.kanaele.write().expect("LiveHub-Lock");
        let sender = kanaele
            .entry(einsatz_id)
            .or_insert_with(|| broadcast::channel(KANAL_KAPAZITAET).0);
        sender.subscribe()
    }
```

`publiziere` als Rückwärts-kompatibler Wrapper (ETB), `publiziere_event` als Kern. Die bestehende Cleanup-Logik wandert in `publiziere_event`:

```rust
    /// Sendet einen ETB-Eintrag (JSON) an alle Abonnenten. Bequemer Wrapper für
    /// den häufigsten Fall — entspricht `publiziere_event(id, "etb", json)`.
    pub fn publiziere(&self, einsatz_id: i64, json: String) {
        self.publiziere_event(einsatz_id, "etb", json);
    }

    /// Sendet ein getaggtes Event an alle Abonnenten eines Einsatzes.
    /// Ohne Kanal/Abonnenten passiert nichts. Ein Kanal ohne Empfänger wird
    /// opportunistisch entfernt, damit der Hub nicht über abgeschlossene
    /// Einsätze hinweg leakt.
    pub fn publiziere_event(&self, einsatz_id: i64, event: &str, data: String) {
        let nachricht = LiveNachricht { event: event.to_string(), data };
        // Häufiger Fall (Kanal existiert): nur Lese-Lock.
        let keine_empfaenger = {
            let kanaele = self.kanaele.read().expect("LiveHub-Lock");
            match kanaele.get(&einsatz_id) {
                Some(sender) => sender.send(nachricht).is_err(),
                None => false,
            }
        };

        if keine_empfaenger {
            let mut kanaele = self.kanaele.write().expect("LiveHub-Lock");
            // Soundness-Invariante: abonniere() hält ebenfalls einen Write-Lock,
            // während es den Kanal anlegt und subscribt. Daher kann zwischen dem
            // Freigeben des Read-Locks oben und diesem Write-Lock kein Abonnent
            // dazukommen — receiver_count() == 0 garantiert hier einen wirklich
            // verwaisten Kanal. NICHT abonniere() auf einen Read-Lock-Fastpath
            // optimieren, sonst greift diese Garantie nicht mehr.
            if let Some(sender) = kanaele.get(&einsatz_id) {
                if sender.receiver_count() == 0 {
                    kanaele.remove(&einsatz_id);
                }
            }
        }
    }
```

Die bestehenden Tests in `live/mod.rs` lesen `rx.recv()` und vergleichen mit Strings — diese auf `.data` umstellen. Konkret die Asserts in `abonnent_empfaengt_publizierte_nachricht`, `nachricht_geht_nur_an_passenden_einsatz` und `mehrere_abonnenten_erhalten_dieselbe_nachricht`:

```rust
    #[tokio::test]
    async fn abonnent_empfaengt_publizierte_nachricht() {
        let hub = LiveHub::new();
        let mut rx = hub.abonniere(1);
        hub.publiziere(1, "hallo".into());
        assert_eq!(rx.recv().await.unwrap().data, "hallo");
    }

    #[tokio::test]
    async fn nachricht_geht_nur_an_passenden_einsatz() {
        let hub = LiveHub::new();
        let mut rx1 = hub.abonniere(1);
        let mut rx2 = hub.abonniere(2);
        hub.publiziere(1, "fuer-eins".into());

        assert_eq!(rx1.recv().await.unwrap().data, "fuer-eins");
        assert!(rx2.try_recv().is_err());
    }

    #[tokio::test]
    async fn mehrere_abonnenten_erhalten_dieselbe_nachricht() {
        let hub = LiveHub::new();
        let mut a = hub.abonniere(1);
        let mut b = hub.abonniere(1);
        hub.publiziere(1, "broadcast".into());
        assert_eq!(a.recv().await.unwrap().data, "broadcast");
        assert_eq!(b.recv().await.unwrap().data, "broadcast");
    }
```

- [ ] **Step 4: ETB-Stream-Route an `LiveNachricht` anpassen**

In `src/routes/etb.rs` das Stream-Mapping (aktuell Zeilen 226–233) ersetzen:

```rust
    let rx = state.live.abonniere(einsatz_id);
    let stream = BroadcastStream::new(rx).map(|res| {
        let event = match res {
            Ok(n) => Event::default().event(n.event).data(n.data),
            // Empfänger ist hinterhergehinkt: Client zum Resync auffordern.
            Err(_) => Event::default().event("lagged").data("resync"),
        };
        Ok::<Event, Infallible>(event)
    });
```

- [ ] **Step 5: Tests ausführen — alles grün**

Run: `cargo test --lib live::tests && cargo test --test etb`
Expected: PASS (Live-Unit-Tests grün; ETB-HTTP-Tests weiterhin grün, da `event="etb"` erhalten bleibt)

- [ ] **Step 6: Voller Build/Test als Regressionscheck**

Run: `cargo test`
Expected: PASS (kein bestehender `publiziere`-Aufrufer bricht)

- [ ] **Step 7: Commit**

```bash
git add src/live/mod.rs src/routes/etb.rs
git commit -m "feat(live): getaggte LiveNachricht + publiziere_event für dedizierte SSE-Events"
```

---

## Task 3: Migration `einsatz_person`

Migrationen werden über `sqlx::migrate!("./migrations")` zur Compile-Zeit eingebettet; eine neue `.sql`-Datei genügt und wird von `db::test_pool()` automatisch eingespielt.

**Files:**
- Create: `migrations/0020_einsatz_person.sql`

- [ ] **Step 1: Migration schreiben**

`migrations/0020_einsatz_person.sql`:

```sql
-- Einsatz-scoped Personen-Stamm (Vermisste, Betroffene, Verstorbene, …).
-- Kein globaler Stamm, keine Disposition. Identität optional; die
-- server-vergebene registrier_nr ist die stabile Kennung. Soft-Delete via
-- storniert_at (kein Hard-Delete).
CREATE TABLE einsatz_person (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    einsatz_id      INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    registrier_nr   INTEGER NOT NULL,           -- fortlaufend je Einsatz (server-autoritativ)
    status          TEXT    NOT NULL DEFAULT 'erfasst'
                    CHECK (status IN ('erfasst','vermisst','betroffen','verstorben','abgemeldet')),

    -- Identität (alle optional — unbekannte Personen erstklassig)
    name            TEXT,
    vorname         TEXT,
    geschlecht      TEXT CHECK (geschlecht IN ('maennlich','weiblich','divers','unbekannt')),
    geburtsdatum    TEXT,                        -- YYYY-MM-DD, falls bekannt
    alter_geschaetzt INTEGER,                    -- geschätztes Alter in Jahren, falls geburtsdatum NULL
    herkunft_adresse TEXT,

    -- Erfassungskontext
    antreff_ort     TEXT,                        -- Freitext (strukturierte Unfallhilfsstelle → E‑3)
    melder_kontakt  TEXT,                        -- bei vermisst: wer meldet (Angehöriger/Kontakt)
    notiz           TEXT,

    -- Meta / Audit
    erfasst_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
    erfasst_von     INTEGER NOT NULL REFERENCES benutzer(id),
    geaendert_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
    geaendert_von   INTEGER NOT NULL REFERENCES benutzer(id),
    storniert_at    TEXT,                        -- Soft-Delete (Fehleingabe); kein Hard-Delete

    UNIQUE (einsatz_id, registrier_nr)
);

CREATE INDEX idx_einsatz_person_einsatz ON einsatz_person (einsatz_id, status);
```

- [ ] **Step 2: Migration einspielen lassen (Smoke-Test)**

Run: `cargo test --lib db::tests`
Expected: PASS (alle bestehenden `db`-Tests laufen über `test_pool()`, das jetzt auch `0020` einspielt — bestätigt, dass die Migration syntaktisch lädt)

- [ ] **Step 3: Commit**

```bash
git add migrations/0020_einsatz_person.sql
git commit -m "feat(db): Migration einsatz_person (einsatz-scoped Personen-Stamm)"
```

---

## Task 4: Migration `person_zugriff_audit`

Append-only-Tabelle für Lese-/Export-Zugriffe. SQLite kann „append-only" nicht erzwingen — die Disziplin liegt im Repo (Task 7: keine UPDATE/DELETE-Funktionen).

**Files:**
- Create: `migrations/0021_person_zugriff_audit.sql`

- [ ] **Step 1: Migration schreiben**

`migrations/0021_person_zugriff_audit.sql`:

```sql
-- Lese-Audit auf Personen-Detailzugriffe und Exporte (append-only — das Repo
-- bietet bewusst KEIN UPDATE/DELETE). person_id ist NULL beim Export der
-- gesamten Liste. Listen-Reads werden NICHT auditiert (SSE-Refetch-Lärm).
CREATE TABLE person_zugriff_audit (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    einsatz_id  INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    person_id   INTEGER REFERENCES einsatz_person(id),  -- NULL bei Export gesamter Liste
    benutzer_id INTEGER NOT NULL REFERENCES benutzer(id),
    art         TEXT    NOT NULL CHECK (art IN ('detail','export')),
    zugriff_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now'))
);

CREATE INDEX idx_person_audit_einsatz ON person_zugriff_audit (einsatz_id, zugriff_at);
```

- [ ] **Step 2: Migration einspielen lassen (Smoke-Test)**

Run: `cargo test --lib db::tests`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add migrations/0021_person_zugriff_audit.sql
git commit -m "feat(db): Migration person_zugriff_audit (append-only Lese-Audit)"
```

---

## Task 5: `src/person/mod.rs` — Status-Maschine, Typen, Helfer

Reine Logik (Status-Übergänge, Geschlecht-Validierung, Anzeige-Struct) ohne DB. Die Status-Übergangsmatrix ist eine reine Funktion `darf_uebergehen`, isoliert getestet, bevor sie die Route nutzt.

**Übergangsmatrix (gerichtet):**
- `erfasst → {vermisst, betroffen, verstorben, abgemeldet}`
- `vermisst → {betroffen, verstorben, abgemeldet}`
- `betroffen → {vermisst, verstorben, abgemeldet}`
- `verstorben → {erfasst, vermisst, betroffen}` (nur als **Korrektur** einer Fehleingabe; Schreibrecht ist durch das Route-Gate ohnehin verlangt)
- `abgemeldet → {erfasst, vermisst, betroffen}` (Korrektur)
- Gleicher Status → gleicher Status ist **kein** gültiger Übergang (422).

**Files:**
- Create: `src/person/mod.rs`
- Modify: `src/lib.rs` (`pub mod person;`)

- [ ] **Step 1: Modul registrieren**

In `src/lib.rs` alphabetisch (zwischen `personal` und `routes`):

```rust
pub mod personal;
pub mod person;
pub mod routes;
```

- [ ] **Step 2: Failing test für `darf_uebergehen` und `Geschlecht` schreiben**

`src/person/mod.rs` zunächst nur mit Tests + leeren Signaturen — wir schreiben den Test zuerst. Lege die Datei mit folgendem `#[cfg(test)]`-Block an (der `super`-Code folgt in Step 4):

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_roundtrip() {
        for s in ["erfasst", "vermisst", "betroffen", "verstorben", "abgemeldet"] {
            assert_eq!(PersonStatus::parse(s).unwrap().as_str(), s);
        }
        assert!(PersonStatus::parse("unsinn").is_none());
    }

    #[test]
    fn geschlecht_roundtrip() {
        for g in ["maennlich", "weiblich", "divers", "unbekannt"] {
            assert_eq!(Geschlecht::parse(g).unwrap().as_str(), g);
        }
        assert!(Geschlecht::parse("x").is_none());
    }

    #[test]
    fn erlaubte_uebergaenge() {
        assert!(darf_uebergehen("erfasst", "vermisst"));
        assert!(darf_uebergehen("erfasst", "betroffen"));
        assert!(darf_uebergehen("erfasst", "verstorben"));
        assert!(darf_uebergehen("erfasst", "abgemeldet"));
        assert!(darf_uebergehen("vermisst", "betroffen"));
        assert!(darf_uebergehen("betroffen", "vermisst"));
        assert!(darf_uebergehen("vermisst", "verstorben"));
        assert!(darf_uebergehen("betroffen", "verstorben"));
        assert!(darf_uebergehen("vermisst", "abgemeldet"));
        // Korrektur aus terminalen Zuständen zurück in aktive:
        assert!(darf_uebergehen("verstorben", "betroffen"));
        assert!(darf_uebergehen("abgemeldet", "erfasst"));
    }

    #[test]
    fn verbotene_uebergaenge() {
        // Gleichbleibender Status ist kein Übergang.
        assert!(!darf_uebergehen("erfasst", "erfasst"));
        assert!(!darf_uebergehen("betroffen", "betroffen"));
        // Niemand darf direkt nach 'erfasst' (außer als Korrektur aus terminalen):
        assert!(!darf_uebergehen("vermisst", "erfasst"));
        assert!(!darf_uebergehen("betroffen", "erfasst"));
        // Terminal → terminal nicht erlaubt:
        assert!(!darf_uebergehen("verstorben", "abgemeldet"));
        assert!(!darf_uebergehen("abgemeldet", "verstorben"));
        // Unbekannte Werte:
        assert!(!darf_uebergehen("erfasst", "quatsch"));
        assert!(!darf_uebergehen("quatsch", "betroffen"));
    }

    #[test]
    fn registrier_anzeige_formatiert_mit_fuehrenden_nullen() {
        assert_eq!(registrier_anzeige(42), "R-042");
        assert_eq!(registrier_anzeige(7), "R-007");
        assert_eq!(registrier_anzeige(1234), "R-1234");
    }
}
```

- [ ] **Step 3: Test ausführen — muss fehlschlagen**

Run: `cargo test --lib person::mod`
Expected: FAIL (Compile-Fehler: `PersonStatus`, `Geschlecht`, `darf_uebergehen`, `registrier_anzeige` fehlen)

- [ ] **Step 4: Implementierung schreiben**

Den folgenden Code **vor** den `#[cfg(test)]`-Block in `src/person/mod.rs` setzen:

```rust
pub mod audit_repo;
pub mod repo;

use serde::Serialize;

/// Administrative Status-Maschine einer Person (E‑1). E‑2 ergänzt die
/// medizinische Sichtungskategorie SK I–IV als separates Attribut auf
/// `betroffen` — diese Maschine bleibt unangetastet.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum PersonStatus {
    Erfasst,
    Vermisst,
    Betroffen,
    Verstorben,
    Abgemeldet,
}

impl PersonStatus {
    /// DB-/API-Stringrepräsentation. **Muss exakt dem CHECK-Constraint in
    /// `migrations/0020_einsatz_person.sql` entsprechen.**
    pub fn as_str(&self) -> &'static str {
        match self {
            PersonStatus::Erfasst => "erfasst",
            PersonStatus::Vermisst => "vermisst",
            PersonStatus::Betroffen => "betroffen",
            PersonStatus::Verstorben => "verstorben",
            PersonStatus::Abgemeldet => "abgemeldet",
        }
    }

    pub fn parse(s: &str) -> Option<PersonStatus> {
        match s {
            "erfasst" => Some(PersonStatus::Erfasst),
            "vermisst" => Some(PersonStatus::Vermisst),
            "betroffen" => Some(PersonStatus::Betroffen),
            "verstorben" => Some(PersonStatus::Verstorben),
            "abgemeldet" => Some(PersonStatus::Abgemeldet),
            _ => None,
        }
    }
}

/// Optionale Geschlechtsangabe. `unbekannt` ist ein erstklassiger Wert.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum Geschlecht {
    Maennlich,
    Weiblich,
    Divers,
    Unbekannt,
}

impl Geschlecht {
    pub fn as_str(&self) -> &'static str {
        match self {
            Geschlecht::Maennlich => "maennlich",
            Geschlecht::Weiblich => "weiblich",
            Geschlecht::Divers => "divers",
            Geschlecht::Unbekannt => "unbekannt",
        }
    }

    pub fn parse(s: &str) -> Option<Geschlecht> {
        match s {
            "maennlich" => Some(Geschlecht::Maennlich),
            "weiblich" => Some(Geschlecht::Weiblich),
            "divers" => Some(Geschlecht::Divers),
            "unbekannt" => Some(Geschlecht::Unbekannt),
            _ => None,
        }
    }
}

/// Ob ein Status-Übergang `von → nach` erlaubt ist. Unbekannte Werte und
/// gleichbleibender Status sind nie erlaubt. Übergänge aus terminalen Zuständen
/// (`verstorben`/`abgemeldet`) zurück in aktive sind erlaubt — als Korrektur
/// einer Fehleingabe; das Schreibrecht prüft die Route.
pub fn darf_uebergehen(von: &str, nach: &str) -> bool {
    use PersonStatus::*;
    let (Some(von), Some(nach)) = (PersonStatus::parse(von), PersonStatus::parse(nach)) else {
        return false;
    };
    if von == nach {
        return false;
    }
    match von {
        Erfasst => matches!(nach, Vermisst | Betroffen | Verstorben | Abgemeldet),
        Vermisst => matches!(nach, Betroffen | Verstorben | Abgemeldet),
        Betroffen => matches!(nach, Vermisst | Verstorben | Abgemeldet),
        // Terminal: nur Korrektur zurück in aktive Zustände.
        Verstorben | Abgemeldet => matches!(nach, Erfasst | Vermisst | Betroffen),
    }
}

/// Stabile, nicht-identifizierende Anzeige der Registriernummer (z. B. `R-042`).
pub fn registrier_anzeige(nr: i64) -> String {
    format!("R-{nr:03}")
}

/// Serialisierbarer Personen-Datensatz (1:1 zur Tabelle `einsatz_person`; kein
/// `org_id`, da einsatz-scoped). Direkt aus der Zeile lesbar — kein Stamm-Join,
/// kein Snapshot wie bei Material.
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct PersonAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub registrier_nr: i64,
    pub status: String,
    pub name: Option<String>,
    pub vorname: Option<String>,
    pub geschlecht: Option<String>,
    pub geburtsdatum: Option<String>,
    pub alter_geschaetzt: Option<i64>,
    pub herkunft_adresse: Option<String>,
    pub antreff_ort: Option<String>,
    pub melder_kontakt: Option<String>,
    pub notiz: Option<String>,
    pub erfasst_at: String,
    pub erfasst_von: i64,
    pub geaendert_at: String,
    pub geaendert_von: i64,
    pub storniert_at: Option<String>,
}
```

> **Hinweis:** Die `pub mod audit_repo;` / `pub mod repo;` Zeilen verweisen auf Dateien, die Task 6 und 7 anlegen. Damit `cargo test` in diesem Task kompiliert, lege **leere** Platzhalter an: `src/person/repo.rs` und `src/person/audit_repo.rs` mit je einem Kommentar `// implementiert in Task 6 bzw. 7`.

- [ ] **Step 5: Test ausführen — muss bestehen**

Run: `cargo test --lib person::mod::tests`
Expected: PASS (alle Status-/Geschlecht-/Übergangs-Tests grün)

- [ ] **Step 6: Commit**

```bash
git add src/lib.rs src/person/mod.rs src/person/repo.rs src/person/audit_repo.rs
git commit -m "feat(person): Status-Maschine, Geschlecht, Anzeige-Typ und Übergangsregeln"
```

---

## Task 6: `src/person/repo.rs` — CRUD, Registriernummer, Soft-Delete

`registrier_nr` wird wie ETB-`lfd_nr` in **einem** atomaren Statement vergeben (`COALESCE(MAX(registrier_nr),0)+1` je `einsatz_id`) — zählt **stornierte mit**, damit Soft-Delete keine Nummern recycelt. Die Liste filtert `storniert_at IS NULL`; das Detail liefert auch stornierte.

**Files:**
- Create: `src/person/repo.rs` (ersetzt den Platzhalter aus Task 5)

- [ ] **Step 1: Failing tests schreiben**

`src/person/repo.rs` — zuerst der Test-Block (Implementierung folgt in Step 3). Wir brauchen ein Einsatz + Benutzer in der Test-DB; dafür legen wir per rohem SQL eine minimale Org/Benutzer/Einsatz-Zeile an (kein HTTP nötig):

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_pool;
    use sqlx::SqlitePool;

    /// Minimal-Setup: eine Org, ein Benutzer, ein aktiver Einsatz. Liefert (benutzer_id, einsatz_id).
    async fn setup(pool: &SqlitePool) -> (i64, i64) {
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Test-Orga')")
            .execute(pool).await.unwrap();
        let benutzer_id: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, system_rolle, org_rolle, aktiv) \
             VALUES (1, 'A', 'a', 'h', 'keiner', 'keine', 1) RETURNING id")
            .fetch_one(pool).await.unwrap();
        let einsatz_id: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung, status, begonnen_at, einsatzart, angelegt_at) \
             VALUES (1, 'Lage', 'aktiv', '2026-05-27', 'realeinsatz', '2026-05-27') RETURNING id")
            .fetch_one(pool).await.unwrap();
        (benutzer_id, einsatz_id)
    }

    fn leere_daten<'a>() -> NeueDaten<'a> {
        NeueDaten {
            name: None, vorname: None, geschlecht: None, geburtsdatum: None,
            alter_geschaetzt: None, herkunft_adresse: None, antreff_ort: None,
            melder_kontakt: None, notiz: None,
        }
    }

    #[tokio::test]
    async fn registrier_nr_ist_fortlaufend_und_zaehlt_stornierte_mit() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let p1 = anlegen(&pool, e, b, leere_daten()).await.unwrap();
        assert_eq!(p1.registrier_nr, 1);
        assert_eq!(p1.status, "erfasst");
        storniere(&pool, e, p1.id, b).await.unwrap();
        let p2 = anlegen(&pool, e, b, leere_daten()).await.unwrap();
        assert_eq!(p2.registrier_nr, 2, "Soft-Delete recycelt keine Nummern");
    }

    #[tokio::test]
    async fn liste_blendet_stornierte_aus_detail_zeigt_sie() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let p1 = anlegen(&pool, e, b, leere_daten()).await.unwrap();
        storniere(&pool, e, p1.id, b).await.unwrap();
        let liste = liste(&pool, e, None).await.unwrap();
        assert!(liste.is_empty(), "stornierte Person nicht in der Liste");
        let detail = laden(&pool, e, p1.id).await.unwrap();
        assert!(detail.storniert_at.is_some(), "Detail liefert stornierte Person mit Zeitstempel");
    }

    #[tokio::test]
    async fn liste_filtert_nach_status() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let p1 = anlegen(&pool, e, b, leere_daten()).await.unwrap();
        setze_status(&pool, e, p1.id, "vermisst", b).await.unwrap();
        let _p2 = anlegen(&pool, e, b, leere_daten()).await.unwrap();
        let vermisste = liste(&pool, e, Some("vermisst")).await.unwrap();
        assert_eq!(vermisste.len(), 1);
        assert_eq!(vermisste[0].status, "vermisst");
        let erfasste = liste(&pool, e, Some("erfasst")).await.unwrap();
        assert_eq!(erfasste.len(), 1);
    }

    #[tokio::test]
    async fn anlegen_und_aktualisieren_setzt_felder() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let p = anlegen(&pool, e, b, NeueDaten {
            name: Some("Mustermann"), vorname: Some("Max"), geschlecht: Some("maennlich"),
            antreff_ort: Some("Brücke"), ..leere_daten()
        }).await.unwrap();
        assert_eq!(p.name.as_deref(), Some("Mustermann"));
        let aktualisiert = aktualisiere(&pool, e, p.id, b, PatchDaten {
            notiz: Some("blutet"), ..PatchDaten::default()
        }).await.unwrap();
        assert_eq!(aktualisiert.notiz.as_deref(), Some("blutet"));
        assert_eq!(aktualisiert.name.as_deref(), Some("Mustermann"), "ungesetzte Felder bleiben");
    }

    #[tokio::test]
    async fn laden_fremder_einsatz_ist_notfound() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let p = anlegen(&pool, e, b, leere_daten()).await.unwrap();
        let err = laden(&pool, 999, p.id).await.unwrap_err();
        assert!(matches!(err, crate::error::AppError::NotFound));
    }
}
```

- [ ] **Step 2: Test ausführen — muss fehlschlagen**

Run: `cargo test --lib person::repo`
Expected: FAIL (Compile-Fehler: `NeueDaten`, `PatchDaten`, `anlegen`, `liste`, `laden`, `setze_status`, `storniere`, `aktualisiere` fehlen)

- [ ] **Step 3: Implementierung schreiben**

Den folgenden Code **vor** den Test-Block in `src/person/repo.rs`:

```rust
use super::PersonAnzeige;
use crate::error::AppError;
use sqlx::SqlitePool;

const SELECT_ALLE: &str = "\
    SELECT id, einsatz_id, registrier_nr, status, name, vorname, geschlecht, \
           geburtsdatum, alter_geschaetzt, herkunft_adresse, antreff_ort, \
           melder_kontakt, notiz, erfasst_at, erfasst_von, geaendert_at, \
           geaendert_von, storniert_at \
    FROM einsatz_person";

/// Eingabedaten beim Anlegen. Strings bereits getrimmt (Handler-Aufgabe);
/// leere Werte sollten als `None` ankommen. Status ist immer `erfasst`.
#[derive(Debug)]
pub struct NeueDaten<'a> {
    pub name: Option<&'a str>,
    pub vorname: Option<&'a str>,
    pub geschlecht: Option<&'a str>,
    pub geburtsdatum: Option<&'a str>,
    pub alter_geschaetzt: Option<i64>,
    pub herkunft_adresse: Option<&'a str>,
    pub antreff_ort: Option<&'a str>,
    pub melder_kontakt: Option<&'a str>,
    pub notiz: Option<&'a str>,
}

/// Patch-Daten: gesetzte Felder werden übernommen, `None` bleibt unverändert
/// (COALESCE-Semantik). Das Löschen eines Feldes auf NULL ist in E‑1 nicht
/// vorgesehen.
#[derive(Debug, Default)]
pub struct PatchDaten<'a> {
    pub name: Option<&'a str>,
    pub vorname: Option<&'a str>,
    pub geschlecht: Option<&'a str>,
    pub geburtsdatum: Option<&'a str>,
    pub alter_geschaetzt: Option<i64>,
    pub herkunft_adresse: Option<&'a str>,
    pub antreff_ort: Option<&'a str>,
    pub melder_kontakt: Option<&'a str>,
    pub notiz: Option<&'a str>,
}

/// Personen eines Einsatzes (ohne stornierte), optional nach Status gefiltert.
/// Sortierung: registrier_nr aufsteigend.
pub async fn liste(
    pool: &SqlitePool,
    einsatz_id: i64,
    status: Option<&str>,
) -> Result<Vec<PersonAnzeige>, AppError> {
    let sql = format!(
        "{SELECT_ALLE} WHERE einsatz_id = ?1 AND storniert_at IS NULL \
         AND (?2 IS NULL OR status = ?2) ORDER BY registrier_nr"
    );
    Ok(sqlx::query_as::<_, PersonAnzeige>(&sql)
        .bind(einsatz_id)
        .bind(status)
        .fetch_all(pool)
        .await?)
}

/// Lädt eine Person (auch stornierte) eines Einsatzes; `NotFound`, falls sie
/// nicht zu diesem Einsatz gehört.
pub async fn laden(
    pool: &SqlitePool,
    einsatz_id: i64,
    person_id: i64,
) -> Result<PersonAnzeige, AppError> {
    sqlx::query_as::<_, PersonAnzeige>(&format!(
        "{SELECT_ALLE} WHERE id = ? AND einsatz_id = ?"
    ))
    .bind(person_id)
    .bind(einsatz_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

/// Legt eine Person an (Status `erfasst`), vergibt `registrier_nr` atomar als
/// `COALESCE(MAX(registrier_nr),0)+1` je Einsatz — zählt stornierte mit, damit
/// keine Nummern recycelt werden. `UNIQUE(einsatz_id, registrier_nr)` sichert ab.
pub async fn anlegen(
    pool: &SqlitePool,
    einsatz_id: i64,
    erfasser_id: i64,
    daten: NeueDaten<'_>,
) -> Result<PersonAnzeige, AppError> {
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz_person \
            (einsatz_id, registrier_nr, status, name, vorname, geschlecht, \
             geburtsdatum, alter_geschaetzt, herkunft_adresse, antreff_ort, \
             melder_kontakt, notiz, erfasst_von, geaendert_von) \
         SELECT ?1, COALESCE(MAX(registrier_nr), 0) + 1, 'erfasst', ?2, ?3, ?4, \
                ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11 \
         FROM einsatz_person WHERE einsatz_id = ?1 \
         RETURNING id",
    )
    .bind(einsatz_id)
    .bind(daten.name)
    .bind(daten.vorname)
    .bind(daten.geschlecht)
    .bind(daten.geburtsdatum)
    .bind(daten.alter_geschaetzt)
    .bind(daten.herkunft_adresse)
    .bind(daten.antreff_ort)
    .bind(daten.melder_kontakt)
    .bind(daten.notiz)
    .bind(erfasser_id)
    .fetch_one(pool)
    .await?;

    laden(pool, einsatz_id, id).await
}

/// Aktualisiert Identitäts-/Kontextfelder (COALESCE: nur gesetzte Felder).
/// Setzt `geaendert_at`/`geaendert_von`. `NotFound`, falls nicht zum Einsatz.
pub async fn aktualisiere(
    pool: &SqlitePool,
    einsatz_id: i64,
    person_id: i64,
    geaendert_von: i64,
    daten: PatchDaten<'_>,
) -> Result<PersonAnzeige, AppError> {
    let betroffen = sqlx::query(
        "UPDATE einsatz_person SET \
            name = COALESCE(?, name), \
            vorname = COALESCE(?, vorname), \
            geschlecht = COALESCE(?, geschlecht), \
            geburtsdatum = COALESCE(?, geburtsdatum), \
            alter_geschaetzt = COALESCE(?, alter_geschaetzt), \
            herkunft_adresse = COALESCE(?, herkunft_adresse), \
            antreff_ort = COALESCE(?, antreff_ort), \
            melder_kontakt = COALESCE(?, melder_kontakt), \
            notiz = COALESCE(?, notiz), \
            geaendert_at = strftime('%Y-%m-%d %H:%M:%S','now'), \
            geaendert_von = ? \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(daten.name)
    .bind(daten.vorname)
    .bind(daten.geschlecht)
    .bind(daten.geburtsdatum)
    .bind(daten.alter_geschaetzt)
    .bind(daten.herkunft_adresse)
    .bind(daten.antreff_ort)
    .bind(daten.melder_kontakt)
    .bind(daten.notiz)
    .bind(geaendert_von)
    .bind(person_id)
    .bind(einsatz_id)
    .execute(pool)
    .await?
    .rows_affected();
    if betroffen == 0 {
        return Err(AppError::NotFound);
    }
    laden(pool, einsatz_id, person_id).await
}

/// Setzt den Status (Übergangsvalidierung ist Handler-Aufgabe via
/// `darf_uebergehen`). Setzt `geaendert_at`/`geaendert_von`. `NotFound`, falls
/// nicht zum Einsatz.
pub async fn setze_status(
    pool: &SqlitePool,
    einsatz_id: i64,
    person_id: i64,
    neuer_status: &str,
    geaendert_von: i64,
) -> Result<(), AppError> {
    let betroffen = sqlx::query(
        "UPDATE einsatz_person SET status = ?, \
            geaendert_at = strftime('%Y-%m-%d %H:%M:%S','now'), geaendert_von = ? \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(neuer_status)
    .bind(geaendert_von)
    .bind(person_id)
    .bind(einsatz_id)
    .execute(pool)
    .await?
    .rows_affected();
    if betroffen == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

/// Soft-Delete (Fehleingabe): setzt `storniert_at`. Bleibt referenzierbar (Audit).
/// `NotFound`, falls nicht zum Einsatz.
pub async fn storniere(
    pool: &SqlitePool,
    einsatz_id: i64,
    person_id: i64,
    geaendert_von: i64,
) -> Result<(), AppError> {
    let betroffen = sqlx::query(
        "UPDATE einsatz_person SET storniert_at = strftime('%Y-%m-%d %H:%M:%S','now'), \
            geaendert_at = strftime('%Y-%m-%d %H:%M:%S','now'), geaendert_von = ? \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(geaendert_von)
    .bind(person_id)
    .bind(einsatz_id)
    .execute(pool)
    .await?
    .rows_affected();
    if betroffen == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}
```

> **Hinweis zum Test-Setup:** Verifiziere die Spaltennamen von `organisation`/`benutzer`/`einsatz` gegen die frühen Migrationen (`0002_auth.sql`, `0003_einsatz.sql`), falls ein INSERT fehlschlägt — passe die `setup`-INSERTs an die echten NOT-NULL-Spalten an.

- [ ] **Step 4: Test ausführen — muss bestehen**

Run: `cargo test --lib person::repo`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/person/repo.rs
git commit -m "feat(person): Repo mit CRUD, fortlaufender Registriernummer und Soft-Delete"
```

---

## Task 7: `src/person/audit_repo.rs` — Lese-Audit (append-only)

Append-only: bewusst **nur** `anlegen` und `liste_je_person` — keine UPDATE/DELETE-Funktion. Diese Disziplin ist der einzige Schutz, den SQLite nicht erzwingen kann.

**Files:**
- Create: `src/person/audit_repo.rs` (ersetzt den Platzhalter aus Task 5)

- [ ] **Step 1: Failing tests schreiben**

`src/person/audit_repo.rs` — Test-Block (Implementierung folgt):

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_pool;
    use sqlx::SqlitePool;

    async fn setup(pool: &SqlitePool) -> (i64, i64, i64) {
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Test-Orga')")
            .execute(pool).await.unwrap();
        let benutzer_id: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, system_rolle, org_rolle, aktiv) \
             VALUES (1, 'A', 'a', 'h', 'keiner', 'keine', 1) RETURNING id")
            .fetch_one(pool).await.unwrap();
        let einsatz_id: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung, status, begonnen_at, einsatzart, angelegt_at) \
             VALUES (1, 'Lage', 'aktiv', '2026-05-27', 'realeinsatz', '2026-05-27') RETURNING id")
            .fetch_one(pool).await.unwrap();
        let person_id: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_person (einsatz_id, registrier_nr, erfasst_von, geaendert_von) \
             VALUES (?, 1, ?, ?) RETURNING id")
            .bind(einsatz_id).bind(benutzer_id).bind(benutzer_id)
            .fetch_one(pool).await.unwrap();
        (benutzer_id, einsatz_id, person_id)
    }

    #[tokio::test]
    async fn anlegen_und_liste_je_person() {
        let pool = test_pool().await;
        let (b, e, p) = setup(&pool).await;
        anlegen(&pool, e, Some(p), b, "detail").await.unwrap();
        anlegen(&pool, e, Some(p), b, "detail").await.unwrap();
        let eintraege = liste_je_person(&pool, e, p).await.unwrap();
        assert_eq!(eintraege.len(), 2);
        assert_eq!(eintraege[0].art, "detail");
        assert_eq!(eintraege[0].benutzer_name, "A");
    }

    #[tokio::test]
    async fn export_eintrag_ohne_person() {
        let pool = test_pool().await;
        let (b, e, _p) = setup(&pool).await;
        anlegen(&pool, e, None, b, "export").await.unwrap();
        // Export ist nicht an eine Person gebunden — taucht in liste_je_person nicht auf.
        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM person_zugriff_audit WHERE einsatz_id = ? AND art = 'export'")
            .bind(e).fetch_one(&pool).await.unwrap();
        assert_eq!(count, 1);
    }
}
```

- [ ] **Step 2: Test ausführen — muss fehlschlagen**

Run: `cargo test --lib person::audit_repo`
Expected: FAIL (Compile-Fehler: `anlegen`, `liste_je_person`, `ZugriffAnzeige` fehlen)

- [ ] **Step 3: Implementierung schreiben**

Den folgenden Code **vor** den Test-Block:

```rust
use crate::error::AppError;
use serde::Serialize;
use sqlx::SqlitePool;

/// Ein Audit-Eintrag mit aufgelöstem Benutzernamen (für die Audit-Einsicht).
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct ZugriffAnzeige {
    pub id: i64,
    pub person_id: Option<i64>,
    pub benutzer_id: i64,
    pub benutzer_name: String,
    pub art: String,
    pub zugriff_at: String,
}

/// Schreibt einen append-only Audit-Eintrag. `person_id = None` beim Export der
/// gesamten Liste. `art` ist 'detail' oder 'export'.
pub async fn anlegen(
    pool: &SqlitePool,
    einsatz_id: i64,
    person_id: Option<i64>,
    benutzer_id: i64,
    art: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO person_zugriff_audit (einsatz_id, person_id, benutzer_id, art) \
         VALUES (?, ?, ?, ?)",
    )
    .bind(einsatz_id)
    .bind(person_id)
    .bind(benutzer_id)
    .bind(art)
    .execute(pool)
    .await?;
    Ok(())
}

/// Audit-Einträge einer Person (neueste zuerst), mit Benutzername.
pub async fn liste_je_person(
    pool: &SqlitePool,
    einsatz_id: i64,
    person_id: i64,
) -> Result<Vec<ZugriffAnzeige>, AppError> {
    Ok(sqlx::query_as::<_, ZugriffAnzeige>(
        "SELECT a.id, a.person_id, a.benutzer_id, b.anzeigename AS benutzer_name, \
                a.art, a.zugriff_at \
         FROM person_zugriff_audit a JOIN benutzer b ON b.id = a.benutzer_id \
         WHERE a.einsatz_id = ? AND a.person_id = ? \
         ORDER BY a.zugriff_at DESC, a.id DESC",
    )
    .bind(einsatz_id)
    .bind(person_id)
    .fetch_all(pool)
    .await?)
}
```

- [ ] **Step 4: Test ausführen — muss bestehen**

Run: `cargo test --lib person::audit_repo`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/person/audit_repo.rs
git commit -m "feat(person): append-only Lese-Audit-Repo (anlegen + liste_je_person)"
```

---

## Task 8: Routen Teil 1 — Liste, Anlegen, Stream

Route-Modul mit gemeinsamen Helfern (pseudonymer ETB-Eintrag + `person`-SSE-Event), GET-Liste (nicht auditiert), POST-Anlegen und der SSE-Stream-Route. Routen werden sofort in `app.rs` registriert.

**Files:**
- Create: `src/routes/einsatz_person.rs`
- Modify: `src/routes/mod.rs` (`pub mod einsatz_person;`)
- Modify: `src/app.rs` (drei Routen)
- Create: `tests/einsatz_person.rs`

- [ ] **Step 1: Route-Modul registrieren**

In `src/routes/mod.rs` alphabetisch (nach `einsatz_material`, vor `einsatz_personal`):

```rust
pub mod einsatz_material;
pub mod einsatz_person;
pub mod einsatz_personal;
```

- [ ] **Step 2: HTTP-Test-Harness + erste Tests schreiben**

`tests/einsatz_person.rs` — Harness identisch zu `tests/einsatz_material.rs`, plus erste Tests:

```rust
use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use lifeline_hub::app::{build_router, AppState};
use lifeline_hub::auth::bootstrap::bootstrap_admin;
use lifeline_hub::db;
use lifeline_hub::live::LiveHub;
use serde_json::Value;
use tower::ServiceExt;

async fn setup() -> axum::Router {
    let pool = db::test_pool().await;
    bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12"))
        .await
        .unwrap();
    build_router(AppState { pool, live: LiveHub::new() })
}

async fn login_cookie(app: &axum::Router, benutzername: &str, passwort: &str) -> String {
    let body = format!(r#"{{"benutzername":"{benutzername}","passwort":"{passwort}"}}"#);
    let resp = app.clone().oneshot(
        Request::builder().method("POST").uri("/api/auth/login")
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(body)).unwrap(),
    ).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    resp.headers().get(header::SET_COOKIE).unwrap().to_str().unwrap()
        .split(';').next().unwrap().to_string()
}

async fn benutzer_anlegen(app: &axum::Router, admin_cookie: &str, name: &str, org_rolle: &str) -> i64 {
    let body = format!(
        r#"{{"anzeigename":"{name}","benutzername":"{name}","passwort":"{name}pw1","org_rolle":"{org_rolle}"}}"#
    );
    let resp = app.clone().oneshot(
        Request::builder().method("POST").uri("/api/benutzer")
            .header(header::CONTENT_TYPE, "application/json")
            .header(header::COOKIE, admin_cookie.to_string())
            .body(Body::from(body)).unwrap(),
    ).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice::<Value>(&bytes).unwrap()["id"].as_i64().unwrap()
}

async fn anfrage(
    app: &axum::Router, methode: &str, uri: &str, cookie: &str, body: Option<&str>,
) -> (StatusCode, Value) {
    let mut req = Request::builder().method(methode).uri(uri).header(header::COOKIE, cookie.to_string());
    let body = match body {
        Some(b) => { req = req.header(header::CONTENT_TYPE, "application/json"); Body::from(b.to_string()) }
        None => Body::empty(),
    };
    let resp = app.clone().oneshot(req.body(body).unwrap()).await.unwrap();
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
}

async fn einsatz_anlegen(app: &axum::Router, cookie: &str) -> i64 {
    let (status, json) = anfrage(app, "POST", "/api/einsaetze", cookie, Some(r#"{"bezeichnung":"Lage"}"#)).await;
    assert_eq!(status, StatusCode::CREATED);
    json["id"].as_i64().unwrap()
}

async fn rolle_setzen(app: &axum::Router, leit_cookie: &str, einsatz: i64, benutzer_id: i64, rolle: &str) {
    let (status, _) = anfrage(
        app, "PUT", &format!("/api/einsaetze/{einsatz}/mitglieder/{benutzer_id}"), leit_cookie,
        Some(&format!(r#"{{"einsatz_rolle":"{rolle}"}}"#)),
    ).await;
    assert_eq!(status, StatusCode::OK);
}

/// Liefert die ETB-Einträge mit typ='system' als Vec der Inhalte.
async fn system_etb_inhalte(app: &axum::Router, cookie: &str, einsatz: i64) -> Vec<String> {
    let (_, json) = anfrage(app, "GET", &format!("/api/einsaetze/{einsatz}/etb"), cookie, None).await;
    json.as_array().unwrap().iter()
        .filter(|e| e["typ"] == "system")
        .map(|e| e["inhalt"].as_str().unwrap().to_string())
        .collect()
}

// ---------- Tests ----------

#[tokio::test]
async fn anlegen_vergibt_registriernummer_und_status_erfasst() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (status, json) = anfrage(
        &app, "POST", &format!("/api/einsaetze/{e}/personen"), &admin,
        Some(r#"{"geschlecht":"maennlich","alter_geschaetzt":40,"antreff_ort":"Brücke"}"#),
    ).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(json["registrier_nr"], 1);
    assert_eq!(json["status"], "erfasst");
    assert_eq!(json["geschlecht"], "maennlich");
}

#[tokio::test]
async fn anlegen_mit_ungueltigem_geschlecht_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (status, _) = anfrage(
        &app, "POST", &format!("/api/einsaetze/{e}/personen"), &admin,
        Some(r#"{"geschlecht":"alien"}"#),
    ).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn anlegen_schreibt_pseudonymen_etb_eintrag_ohne_identitaet() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (_, _json) = anfrage(
        &app, "POST", &format!("/api/einsaetze/{e}/personen"), &admin,
        Some(r#"{"name":"Mustermann","vorname":"Max"}"#),
    ).await;
    let inhalte = system_etb_inhalte(&app, &admin, e).await;
    assert_eq!(inhalte.len(), 1);
    assert!(inhalte[0].contains("R-001"), "ETB nennt die Registriernummer");
    assert!(inhalte[0].contains("erfasst"));
    // Leak-Test: keine Identität im ETB.
    assert!(!inhalte[0].contains("Mustermann"), "ETB darf den Namen NICHT enthalten");
    assert!(!inhalte[0].contains("Max"), "ETB darf den Vornamen NICHT enthalten");
}

#[tokio::test]
async fn liste_filtert_nach_status() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    anfrage(&app, "POST", &format!("/api/einsaetze/{e}/personen"), &admin, Some(r#"{}"#)).await;
    anfrage(&app, "POST", &format!("/api/einsaetze/{e}/personen"), &admin, Some(r#"{}"#)).await;
    let (status, json) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/personen?status=erfasst"), &admin, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json.as_array().unwrap().len(), 2);
    let (_, leer) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/personen?status=vermisst"), &admin, None).await;
    assert_eq!(leer.as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn beobachter_kann_nicht_anlegen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let beob_id = benutzer_anlegen(&app, &admin, "beob", "keine").await;
    let e = einsatz_anlegen(&app, &admin).await;
    rolle_setzen(&app, &admin, e, beob_id, "beobachter").await;
    let beob = login_cookie(&app, "beob", "beobpw1").await;
    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/personen"), &beob, Some(r#"{}"#)).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}
```

- [ ] **Step 3: Test ausführen — muss fehlschlagen**

Run: `cargo test --test einsatz_person`
Expected: FAIL (404, da Routen nicht registriert / Modul leer)

- [ ] **Step 4: Route-Modul implementieren**

`src/routes/einsatz_person.rs`:

```rust
use crate::app::AppState;
use crate::auth::session::CurrentUser;
use crate::einsatz::berechtigung::{fordere_aktiv, fordere_lesezugriff, fordere_schreibrecht};
use crate::einsatz::repo as einsatz_repo;
use crate::error::AppError;
use crate::etb::{self, repo as etb_repo};
use crate::person::{registrier_anzeige, repo, Geschlecht, PersonAnzeige, PersonStatus};
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::Json;
use serde::Deserialize;
use std::convert::Infallible;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::{Stream, StreamExt};

/// Schreibt einen pseudonymen System-ETB-Eintrag (nur Registriernummer + Status)
/// und publiziert ihn als `etb`-SSE-Event.
async fn etb_system(state: &AppState, einsatz_id: i64, benutzer_id: i64, inhalt: &str) -> Result<(), AppError> {
    let anzeige = etb_repo::anlegen(
        &state.pool, einsatz_id, benutzer_id,
        etb_repo::EintragDaten {
            typ: etb::TYP_SYSTEM, inhalt, von: None, an: None, meldeweg: None,
            veranlassung: None, ereigniszeit: None, erfasst_lokal_at: None,
            berichtigt_eintrag_id: None,
        },
    ).await?;
    if let Ok(json) = serde_json::to_string(&anzeige) {
        state.live.publiziere(einsatz_id, json);
    }
    Ok(())
}

/// Broadcastet ein dediziertes `person`-SSE-Event OHNE sensible Payload
/// (nur einsatz_id + person_id); Clients refetchen die Liste.
fn sse_person(state: &AppState, einsatz_id: i64, person_id: i64) {
    let data = serde_json::json!({ "einsatz_id": einsatz_id, "person_id": person_id }).to_string();
    state.live.publiziere_event(einsatz_id, "person", data);
}

fn trimme(s: Option<String>) -> Option<String> {
    s.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

/// Validiert ein optionales Geschlecht; `Validation`, falls gesetzt und unbekannt.
fn pruefe_geschlecht(g: &Option<String>) -> Result<(), AppError> {
    if let Some(g) = g {
        if Geschlecht::parse(g).is_none() {
            return Err(AppError::Validation("Unbekanntes Geschlecht".into()));
        }
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
pub struct ListeParams {
    pub status: Option<String>,
}

/// GET /api/einsaetze/{id}/personen — Liste (optional `?status=`). NICHT auditiert.
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
    Query(params): Query<ListeParams>,
) -> Result<Json<Vec<PersonAnzeige>>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;

    if let Some(s) = &params.status {
        if PersonStatus::parse(s).is_none() {
            return Err(AppError::Validation("Unbekannter Status im Filter".into()));
        }
    }
    Ok(Json(repo::liste(&state.pool, einsatz_id, params.status.as_deref()).await?))
}

#[derive(Debug, Deserialize)]
pub struct AnlegenBody {
    pub name: Option<String>,
    pub vorname: Option<String>,
    pub geschlecht: Option<String>,
    pub geburtsdatum: Option<String>,
    pub alter_geschaetzt: Option<i64>,
    pub herkunft_adresse: Option<String>,
    pub antreff_ort: Option<String>,
    pub melder_kontakt: Option<String>,
    pub notiz: Option<String>,
}

/// POST /api/einsaetze/{id}/personen — Person anlegen (Status `erfasst`).
/// Schreibberechtigt + aktiver Einsatz. Schreibt pseudonymen ETB-Eintrag + SSE.
pub async fn anlegen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
    Json(body): Json<AnlegenBody>,
) -> Result<(StatusCode, Json<PersonAnzeige>), AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;
    pruefe_geschlecht(&body.geschlecht)?;

    let name = trimme(body.name);
    let vorname = trimme(body.vorname);
    let geburtsdatum = trimme(body.geburtsdatum);
    let herkunft = trimme(body.herkunft_adresse);
    let antreff = trimme(body.antreff_ort);
    let melder = trimme(body.melder_kontakt);
    let notiz = trimme(body.notiz);

    let person = repo::anlegen(
        &state.pool, einsatz_id, benutzer.id,
        repo::NeueDaten {
            name: name.as_deref(), vorname: vorname.as_deref(),
            geschlecht: body.geschlecht.as_deref(), geburtsdatum: geburtsdatum.as_deref(),
            alter_geschaetzt: body.alter_geschaetzt, herkunft_adresse: herkunft.as_deref(),
            antreff_ort: antreff.as_deref(), melder_kontakt: melder.as_deref(),
            notiz: notiz.as_deref(),
        },
    ).await?;

    etb_system(
        &state, einsatz_id, benutzer.id,
        &format!("Person {} erfasst", registrier_anzeige(person.registrier_nr)),
    ).await?;
    sse_person(&state, einsatz_id, person.id);
    Ok((StatusCode::CREATED, Json(person)))
}

/// GET /api/einsaetze/{id}/personen/stream — SSE-Stream des Einsatz-Kanals.
/// Der Client filtert clientseitig auf `person`-Events. Nur Lesezugriff.
pub async fn stream(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;

    let rx = state.live.abonniere(einsatz_id);
    let stream = BroadcastStream::new(rx).map(|res| {
        let event = match res {
            Ok(n) => Event::default().event(n.event).data(n.data),
            Err(_) => Event::default().event("lagged").data("resync"),
        };
        Ok::<Event, Infallible>(event)
    });
    Ok(Sse::new(stream).keep_alive(KeepAlive::default()))
}
```

> **Hinweis:** Verifiziere den exakten Namen der ETB-System-Typ-Konstante in `src/etb/mod.rs` (im Material-Handler `etb::TYP_SYSTEM`). Falls abweichend, anpassen.

- [ ] **Step 5: Routen in `app.rs` registrieren**

In `src/app.rs` nach dem `material`-Block (Zeile ~76) einfügen:

```rust
        .route("/api/einsaetze/{id}/personen", get(routes::einsatz_person::liste))
        .route("/api/einsaetze/{id}/personen", post(routes::einsatz_person::anlegen))
        .route("/api/einsaetze/{id}/personen/stream", get(routes::einsatz_person::stream))
```

- [ ] **Step 6: Tests ausführen — müssen bestehen**

Run: `cargo test --test einsatz_person`
Expected: PASS (alle 5 Tests aus Step 2 grün, inkl. Leak-Test)

- [ ] **Step 7: Commit**

```bash
git add src/routes/einsatz_person.rs src/routes/mod.rs src/app.rs tests/einsatz_person.rs
git commit -m "feat(person): Routen Liste/Anlegen/Stream mit pseudonymer ETB-Spur und person-SSE"
```

---

## Task 9: Routen Teil 2 — Detail (+Audit) und Bearbeiten

GET-Detail schreibt **vor** der Response genau einen `detail`-Audit-Eintrag (auch wenn die Serialisierung später fehlschlüge). PATCH bearbeitet Identitäts-/Kontextfelder.

**Files:**
- Modify: `src/routes/einsatz_person.rs`
- Modify: `src/app.rs` (zwei Routen)
- Modify: `tests/einsatz_person.rs`

- [ ] **Step 1: Failing tests schreiben**

In `tests/einsatz_person.rs` ergänzen. Helfer + Tests. **Hinweis:** Die Audit-Korrektheit (genau ein Eintrag pro Detail-Öffnung, kein Eintrag für die Liste) wird **erst in Task 11** geprüft — zusammen mit der Audit-Einsichts-Route, die dafür nötig ist. Dieser Task testet Detail-GET und PATCH eigenständig.

```rust
/// Legt eine Person an und liefert ihre id.
async fn person_anlegen(app: &axum::Router, cookie: &str, einsatz: i64, body: &str) -> i64 {
    let (status, json) = anfrage(app, "POST", &format!("/api/einsaetze/{einsatz}/personen"), cookie, Some(body)).await;
    assert_eq!(status, StatusCode::CREATED);
    json["id"].as_i64().unwrap()
}

#[tokio::test]
async fn detail_liefert_person_mit_feldern() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, r#"{"name":"Test","antreff_ort":"Brücke"}"#).await;
    let (status, json) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/personen/{p}"), &admin, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["id"], p);
    assert_eq!(json["name"], "Test");
    assert_eq!(json["antreff_ort"], "Brücke");
    assert_eq!(json["registrier_nr"], 1);
}

#[tokio::test]
async fn patch_bearbeitet_felder() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, r#"{"name":"Alt"}"#).await;
    let (status, json) = anfrage(
        &app, "PATCH", &format!("/api/einsaetze/{e}/personen/{p}"), &admin,
        Some(r#"{"name":"Neu","notiz":"verletzt"}"#),
    ).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["name"], "Neu");
    assert_eq!(json["notiz"], "verletzt");
}

#[tokio::test]
async fn detail_fremder_einsatz_ist_404() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, r#"{}"#).await;
    let anderer = einsatz_anlegen(&app, &admin).await;
    let (status, _) = anfrage(&app, "GET", &format!("/api/einsaetze/{anderer}/personen/{p}"), &admin, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}
```

- [ ] **Step 2: Test ausführen — muss fehlschlagen**

Run: `cargo test --test einsatz_person patch_bearbeitet_felder`
Expected: FAIL (404 — Route fehlt)

- [ ] **Step 3: Handler implementieren**

In `src/routes/einsatz_person.rs` ergänzen — Detail mit Audit-vor-Response und PATCH:

```rust
use crate::person::audit_repo;

/// GET /api/einsaetze/{id}/personen/{pid} — Detail. **Schreibt einen
/// `detail`-Audit-Eintrag VOR der Response** (auch wenn der Client abbricht).
pub async fn detail(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, person_id)): Path<(i64, i64)>,
) -> Result<Json<PersonAnzeige>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;

    // Existenz/Zugehörigkeit prüfen, BEVOR auditiert wird (kein Audit für 404).
    let person = repo::laden(&state.pool, einsatz_id, person_id).await?;
    audit_repo::anlegen(&state.pool, einsatz_id, Some(person_id), benutzer.id, "detail").await?;
    Ok(Json(person))
}

#[derive(Debug, Deserialize)]
pub struct PatchBody {
    pub name: Option<String>,
    pub vorname: Option<String>,
    pub geschlecht: Option<String>,
    pub geburtsdatum: Option<String>,
    pub alter_geschaetzt: Option<i64>,
    pub herkunft_adresse: Option<String>,
    pub antreff_ort: Option<String>,
    pub melder_kontakt: Option<String>,
    pub notiz: Option<String>,
}

/// PATCH /api/einsaetze/{id}/personen/{pid} — Identitäts-/Kontextfelder bearbeiten.
/// Schreibberechtigt + aktiver Einsatz. Kein ETB-Eintrag (E‑1-Felder sind keine
/// besondere Kategorie; aktueller Datensatz genügt).
pub async fn aktualisieren(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, person_id)): Path<(i64, i64)>,
    Json(body): Json<PatchBody>,
) -> Result<Json<PersonAnzeige>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;
    pruefe_geschlecht(&body.geschlecht)?;

    let name = trimme(body.name);
    let vorname = trimme(body.vorname);
    let geburtsdatum = trimme(body.geburtsdatum);
    let herkunft = trimme(body.herkunft_adresse);
    let antreff = trimme(body.antreff_ort);
    let melder = trimme(body.melder_kontakt);
    let notiz = trimme(body.notiz);

    let person = repo::aktualisiere(
        &state.pool, einsatz_id, person_id, benutzer.id,
        repo::PatchDaten {
            name: name.as_deref(), vorname: vorname.as_deref(),
            geschlecht: body.geschlecht.as_deref(), geburtsdatum: geburtsdatum.as_deref(),
            alter_geschaetzt: body.alter_geschaetzt, herkunft_adresse: herkunft.as_deref(),
            antreff_ort: antreff.as_deref(), melder_kontakt: melder.as_deref(),
            notiz: notiz.as_deref(),
        },
    ).await?;
    sse_person(&state, einsatz_id, person.id);
    Ok(Json(person))
}
```

- [ ] **Step 4: Routen in `app.rs` registrieren**

Im Personen-Block ergänzen:

```rust
        .route("/api/einsaetze/{id}/personen/{pid}", get(routes::einsatz_person::detail))
        .route("/api/einsaetze/{id}/personen/{pid}", patch(routes::einsatz_person::aktualisieren))
```

- [ ] **Step 5: Detail/PATCH-Tests ausführen**

Run: `cargo test --test einsatz_person detail_liefert_person_mit_feldern patch_bearbeitet_felder detail_fremder_einsatz_ist_404`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/routes/einsatz_person.rs src/app.rs tests/einsatz_person.rs
git commit -m "feat(person): Detail-Route mit Lese-Audit und PATCH-Bearbeitung"
```

---

## Task 10: Routen Teil 3 — Status-Wechsel und Stornieren

Status-Wechsel validiert über `darf_uebergehen` (ungültig → **422**), schreibt pseudonyme ETB-Spur + SSE. Stornieren = Soft-Delete, schreibt ETB + SSE.

**Files:**
- Modify: `src/routes/einsatz_person.rs`
- Modify: `src/app.rs` (zwei Routen)
- Modify: `tests/einsatz_person.rs`

- [ ] **Step 1: Failing tests schreiben**

In `tests/einsatz_person.rs` ergänzen:

```rust
#[tokio::test]
async fn gueltiger_status_wechsel_schreibt_etb() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, r#"{}"#).await;
    let (status, json) = anfrage(
        &app, "POST", &format!("/api/einsaetze/{e}/personen/{p}/status"), &admin,
        Some(r#"{"status":"vermisst"}"#),
    ).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["status"], "vermisst");
    let inhalte = system_etb_inhalte(&app, &admin, e).await;
    // Anlegen + Status-Wechsel = 2 Einträge; der letzte nennt den Übergang.
    assert!(inhalte.iter().any(|i| i.contains("R-001") && i.contains("erfasst") && i.contains("vermisst")));
}

#[tokio::test]
async fn ungueltiger_status_wechsel_ist_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, r#"{}"#).await;
    // erfasst → erfasst ist kein gültiger Übergang.
    let (status, _) = anfrage(
        &app, "POST", &format!("/api/einsaetze/{e}/personen/{p}/status"), &admin,
        Some(r#"{"status":"erfasst"}"#),
    ).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn unbekannter_zielstatus_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, r#"{}"#).await;
    let (status, _) = anfrage(
        &app, "POST", &format!("/api/einsaetze/{e}/personen/{p}/status"), &admin,
        Some(r#"{"status":"quatsch"}"#),
    ).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn stornieren_blendet_aus_liste_und_schreibt_etb() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, r#"{}"#).await;
    let (status, _) = anfrage(&app, "DELETE", &format!("/api/einsaetze/{e}/personen/{p}"), &admin, None).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (_, liste) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/personen"), &admin, None).await;
    assert_eq!(liste.as_array().unwrap().len(), 0);
    let inhalte = system_etb_inhalte(&app, &admin, e).await;
    assert!(inhalte.iter().any(|i| i.contains("R-001") && i.contains("storniert")));
}
```

- [ ] **Step 2: Test ausführen — muss fehlschlagen**

Run: `cargo test --test einsatz_person ungueltiger_status_wechsel_ist_422`
Expected: FAIL (404 — Route fehlt)

- [ ] **Step 3: Handler implementieren**

In `src/routes/einsatz_person.rs` ergänzen (`use crate::person::darf_uebergehen;` zur `person`-Import-Zeile hinzufügen):

```rust
#[derive(Debug, Deserialize)]
pub struct StatusBody {
    pub status: String,
}

/// POST /api/einsaetze/{id}/personen/{pid}/status — validierter Status-Wechsel.
/// Unbekannter Zielstatus → 400; nicht erlaubter Übergang → 422. Schreibt
/// pseudonyme ETB-Spur + SSE.
pub async fn status_wechsel(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, person_id)): Path<(i64, i64)>,
    Json(body): Json<StatusBody>,
) -> Result<Json<PersonAnzeige>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    if PersonStatus::parse(&body.status).is_none() {
        return Err(AppError::Validation("Unbekannter Status".into()));
    }
    let vorher = repo::laden(&state.pool, einsatz_id, person_id).await?;
    if !darf_uebergehen(&vorher.status, &body.status) {
        return Err(AppError::UnprocessableEntity(format!(
            "Status-Übergang {} → {} ist nicht erlaubt",
            vorher.status, body.status
        )));
    }
    repo::setze_status(&state.pool, einsatz_id, person_id, &body.status, benutzer.id).await?;

    etb_system(
        &state, einsatz_id, benutzer.id,
        &format!(
            "Person {}: {} → {}",
            registrier_anzeige(vorher.registrier_nr), vorher.status, body.status
        ),
    ).await?;
    sse_person(&state, einsatz_id, person_id);
    Ok(Json(repo::laden(&state.pool, einsatz_id, person_id).await?))
}

/// DELETE /api/einsaetze/{id}/personen/{pid} — Stornieren (Soft-Delete).
/// Schreibberechtigt + aktiver Einsatz. Schreibt pseudonyme ETB-Spur + SSE.
pub async fn stornieren(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, person_id)): Path<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    let person = repo::laden(&state.pool, einsatz_id, person_id).await?;
    repo::storniere(&state.pool, einsatz_id, person_id, benutzer.id).await?;
    etb_system(
        &state, einsatz_id, benutzer.id,
        &format!("Person {} storniert", registrier_anzeige(person.registrier_nr)),
    ).await?;
    sse_person(&state, einsatz_id, person_id);
    Ok(StatusCode::NO_CONTENT)
}
```

- [ ] **Step 4: Routen in `app.rs` registrieren**

```rust
        .route("/api/einsaetze/{id}/personen/{pid}/status", post(routes::einsatz_person::status_wechsel))
        .route("/api/einsaetze/{id}/personen/{pid}", delete(routes::einsatz_person::stornieren))
```

- [ ] **Step 5: Tests ausführen — müssen bestehen**

Run: `cargo test --test einsatz_person gueltiger_status_wechsel_schreibt_etb ungueltiger_status_wechsel_ist_422 unbekannter_zielstatus_ist_400 stornieren_blendet_aus_liste_und_schreibt_etb`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/routes/einsatz_person.rs src/app.rs tests/einsatz_person.rs
git commit -m "feat(person): Status-Wechsel (422 bei ungültig) und Stornieren mit ETB-Spur"
```

---

## Task 11: Routen Teil 4 — Audit-Einsicht und CSV-Export

Audit-Einsicht nur für die Einsatzleitung (`fordere_einsatzleitung`). Export liefert CSV (kein JSON) und schreibt einen `export`-Audit-Eintrag (person_id = NULL).

**Files:**
- Modify: `src/routes/einsatz_person.rs`
- Modify: `src/app.rs` (zwei Routen)
- Modify: `tests/einsatz_person.rs`

- [ ] **Step 1: Failing tests schreiben**

In `tests/einsatz_person.rs` ergänzen. Hier kommt auch der in Task 9 zurückgestellte Audit-Korrektheits-Test hinzu (er braucht die Audit-Route):

```rust
/// Zählt Audit-Einträge einer Person (über die Audit-Einsicht der Leitung).
async fn audit_anzahl(app: &axum::Router, leit_cookie: &str, einsatz: i64, person: i64) -> usize {
    let (status, json) = anfrage(app, "GET", &format!("/api/einsaetze/{einsatz}/personen/{person}/audit"), leit_cookie, None).await;
    assert_eq!(status, StatusCode::OK);
    json.as_array().unwrap().len()
}

#[tokio::test]
async fn detail_oeffnen_schreibt_genau_einen_audit_liste_keinen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await; // admin = Einsatzleitung → darf Audit sehen
    let p = person_anlegen(&app, &admin, e, r#"{"name":"Test"}"#).await;
    // Liste schreibt keinen Audit:
    anfrage(&app, "GET", &format!("/api/einsaetze/{e}/personen"), &admin, None).await;
    assert_eq!(audit_anzahl(&app, &admin, e, p).await, 0);
    // Eine Detail-Öffnung → genau ein Eintrag (die Audit-Einsicht selbst schreibt keinen):
    let (status, _) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/personen/{p}"), &admin, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(audit_anzahl(&app, &admin, e, p).await, 1);
    // Zweite Öffnung → zwei Einträge:
    anfrage(&app, "GET", &format!("/api/einsaetze/{e}/personen/{p}"), &admin, None).await;
    assert_eq!(audit_anzahl(&app, &admin, e, p).await, 2);
}

#[tokio::test]
async fn audit_einsicht_nur_fuer_einsatzleitung() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    // Admin ist System-Admin, aber NICHT automatisch Einsatzleitung dieses Einsatzes.
    // Daher Einsatz vom Admin anlegen (er wird Einsatzleitung) und einen Führungs-User hinzufügen.
    let fueh_id = benutzer_anlegen(&app, &admin, "fueh", "keine").await;
    let e = einsatz_anlegen(&app, &admin).await; // admin = Einsatzleitung
    rolle_setzen(&app, &admin, e, fueh_id, "fuehrungspersonal").await;
    let fueh = login_cookie(&app, "fueh", "fuehpw1").await;
    let p = person_anlegen(&app, &admin, e, r#"{}"#).await;
    // Führungspersonal darf NICHT in die Audit-Einsicht:
    let (status, _) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/personen/{p}/audit"), &fueh, None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    // Einsatzleitung (admin) darf:
    let (status, _) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/personen/{p}/audit"), &admin, None).await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn export_schreibt_export_audit() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    person_anlegen(&app, &admin, e, r#"{"name":"Test"}"#).await;
    // Export-Route liefert CSV (text/csv), kein JSON — daher roher Request:
    let resp = app.clone().oneshot(
        Request::builder().method("GET").uri(format!("/api/einsaetze/{e}/personen/export"))
            .header(header::COOKIE, admin.clone()).body(Body::empty()).unwrap(),
    ).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let ct = resp.headers().get(header::CONTENT_TYPE).unwrap().to_str().unwrap().to_string();
    assert!(ct.starts_with("text/csv"), "Content-Type ist CSV, war: {ct}");
}
```

> **Hinweis:** Der HTTP-Test prüft den Vertrag der Export-Route (200 + `text/csv`). Dass der Export einen `export`-Audit-Eintrag schreibt, ist bereits durch den Unit-Test `person::audit_repo::tests::export_eintrag_ohne_person` (Task 7) abgedeckt — ein direkter DB-Zugriff aus dem HTTP-Test ist hier nicht nötig.

- [ ] **Step 2: Test ausführen — muss fehlschlagen**

Run: `cargo test --test einsatz_person audit_einsicht_nur_fuer_einsatzleitung`
Expected: FAIL (404 — Route fehlt)

- [ ] **Step 3: Handler implementieren**

In `src/routes/einsatz_person.rs` ergänzen. Import erweitern um `fordere_einsatzleitung`:

```rust
use crate::einsatz::berechtigung::{fordere_aktiv, fordere_einsatzleitung, fordere_lesezugriff, fordere_schreibrecht};
use crate::person::audit_repo::ZugriffAnzeige;
use axum::response::{IntoResponse, Response};
```

Handler:

```rust
/// GET /api/einsaetze/{id}/personen/{pid}/audit — Lese-Audit der Person.
/// Nur Einsatzleitung. Selbst NICHT auditiert (kein detail-Eintrag).
pub async fn audit(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, person_id)): Path<(i64, i64)>,
) -> Result<Json<Vec<ZugriffAnzeige>>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;
    fordere_einsatzleitung(rolle)?;
    // Existenz der Person sicherstellen (404 statt leerer Liste bei Tippfehler).
    repo::laden(&state.pool, einsatz_id, person_id).await?;
    Ok(Json(audit_repo::liste_je_person(&state.pool, einsatz_id, person_id).await?))
}

/// Einfaches CSV-Feld-Quoting (RFC 4180): in Anführungszeichen, innere `"` verdoppelt.
fn csv_feld(s: &str) -> String {
    format!("\"{}\"", s.replace('"', "\"\""))
}

/// GET /api/einsaetze/{id}/personen/export — CSV aller (nicht-stornierten)
/// Personen. **Schreibt einen `export`-Audit-Eintrag** (person_id = NULL).
pub async fn export(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
) -> Result<Response, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;

    let personen = repo::liste(&state.pool, einsatz_id, None).await?;
    audit_repo::anlegen(&state.pool, einsatz_id, None, benutzer.id, "export").await?;

    let mut csv = String::from("registrier_nr;status;name;vorname;geschlecht;alter;antreff_ort\n");
    for p in &personen {
        let alter = p.alter_geschaetzt.map(|a| a.to_string()).unwrap_or_default();
        csv.push_str(&format!(
            "{};{};{};{};{};{};{}\n",
            registrier_anzeige(p.registrier_nr),
            csv_feld(&p.status),
            csv_feld(p.name.as_deref().unwrap_or("")),
            csv_feld(p.vorname.as_deref().unwrap_or("")),
            csv_feld(p.geschlecht.as_deref().unwrap_or("")),
            alter,
            csv_feld(p.antreff_ort.as_deref().unwrap_or("")),
        ));
    }
    Ok((
        [(axum::http::header::CONTENT_TYPE, "text/csv; charset=utf-8")],
        csv,
    ).into_response())
}
```

> **Wichtig zur Routen-Reihenfolge:** `/personen/export` muss in `app.rs` **vor** `/personen/{pid}` stehen wäre bei einem Tree-Router nötig — axum 0.8 matcht statische Segmente jedoch vor Parametern, sodass `export` korrekt greift. Verifiziere mit dem Export-Test; falls `export` als `{pid}` interpretiert wird (NotFound/Parse-Fehler), registriere die `export`-Route vor der `{pid}`-Route.

- [ ] **Step 4: Routen in `app.rs` registrieren**

```rust
        .route("/api/einsaetze/{id}/personen/{pid}/audit", get(routes::einsatz_person::audit))
        .route("/api/einsaetze/{id}/personen/export", get(routes::einsatz_person::export))
```

- [ ] **Step 5: Tests ausführen — müssen bestehen**

Run: `cargo test --test einsatz_person`
Expected: PASS (inkl. der in Task 9 hinzugefügten Audit-Tests, die nun grün werden)

- [ ] **Step 6: Commit**

```bash
git add src/routes/einsatz_person.rs src/app.rs tests/einsatz_person.rs
git commit -m "feat(person): Audit-Einsicht (nur Leitung) und CSV-Export mit Export-Audit"
```

---

## Task 12: HTTP-Tests — Rechte-Matrix, Nachlauffrist, Org-Isolation

Abschließende Rechte-/Isolations-Tests, die den Spec-Test-Abschnitt „Berechtigung" vollständig abdecken.

**Files:**
- Modify: `tests/einsatz_person.rs`

- [ ] **Step 1: Tests schreiben**

In `tests/einsatz_person.rs` ergänzen:

```rust
#[tokio::test]
async fn fremder_einsatz_anlegen_ist_403() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    // Ein Nicht-Mitglied (keine Einsatz-Rolle), kein System-Admin.
    let aussen_id = benutzer_anlegen(&app, &admin, "aussen", "keine").await;
    let _ = aussen_id;
    let e = einsatz_anlegen(&app, &admin).await;
    let aussen = login_cookie(&app, "aussen", "aussenpw1").await;
    // Lesen ohne Mitgliedschaft: 403 (darf_lesen = false).
    let (status, _) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/personen"), &aussen, None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    // Schreiben ohne Mitgliedschaft: 403.
    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/personen"), &aussen, Some(r#"{}"#)).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn abgeschlossener_einsatz_ist_readonly() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, r#"{}"#).await;
    // Einsatz abschließen:
    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/abschliessen"), &admin, None).await;
    assert_eq!(status, StatusCode::OK);
    // Lesen weiterhin erlaubt (in der Nachlauffrist):
    let (status, _) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/personen"), &admin, None).await;
    assert_eq!(status, StatusCode::OK);
    // Schreiben blockiert (409 Conflict via fordere_aktiv):
    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/personen"), &admin, Some(r#"{}"#)).await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/personen/{p}/status"), &admin, Some(r#"{"status":"vermisst"}"#)).await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (status, _) = anfrage(&app, "DELETE", &format!("/api/einsaetze/{e}/personen/{p}"), &admin, None).await;
    assert_eq!(status, StatusCode::CONFLICT);
}

#[tokio::test]
async fn beobachter_liest_aber_schreibt_nicht() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let beob_id = benutzer_anlegen(&app, &admin, "beob2", "keine").await;
    let e = einsatz_anlegen(&app, &admin).await;
    rolle_setzen(&app, &admin, e, beob_id, "beobachter").await;
    let p = person_anlegen(&app, &admin, e, r#"{}"#).await;
    let beob = login_cookie(&app, "beob2", "beob2pw1").await;
    // Lesen erlaubt:
    let (status, _) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/personen"), &beob, None).await;
    assert_eq!(status, StatusCode::OK);
    // Detail lesen erlaubt (und auditiert):
    let (status, _) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/personen/{p}"), &beob, None).await;
    assert_eq!(status, StatusCode::OK);
    // Status-Wechsel verboten:
    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/personen/{p}/status"), &beob, Some(r#"{"status":"vermisst"}"#)).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}
```

> **Hinweis:** Verifiziere den Abschließen-Endpunkt-Vertrag gegen `tests/einsatz.rs` (`POST /api/einsaetze/{id}/abschliessen`, erwarteter Status). Passe an, falls dort ein Body/anderer Statuscode erwartet wird.

- [ ] **Step 2: Tests ausführen — müssen bestehen**

Run: `cargo test --test einsatz_person`
Expected: PASS (gesamte Personen-HTTP-Suite grün)

- [ ] **Step 3: Voller Backend-Regressionslauf**

Run: `cargo test`
Expected: PASS (keine bestehende Suite gebrochen)

- [ ] **Step 4: Commit**

```bash
git add tests/einsatz_person.rs
git commit -m "test(person): Rechte-Matrix, Nachlauf-/Read-only- und Org-Isolations-Tests"
```

---

## Task 13: Frontend — Typen und API-Client

**Files:**
- Modify: `frontend/src/api/types.ts`
- Create: `frontend/src/api/einsatzPerson.ts`

- [ ] **Step 1: Typen ergänzen**

In `frontend/src/api/types.ts` am Ende ergänzen:

```typescript
export type PersonStatus = 'erfasst' | 'vermisst' | 'betroffen' | 'verstorben' | 'abgemeldet';
export type Geschlecht = 'maennlich' | 'weiblich' | 'divers' | 'unbekannt';

export interface Person {
  id: number;
  einsatz_id: number;
  registrier_nr: number;
  status: PersonStatus;
  name: string | null;
  vorname: string | null;
  geschlecht: Geschlecht | null;
  geburtsdatum: string | null;
  alter_geschaetzt: number | null;
  herkunft_adresse: string | null;
  antreff_ort: string | null;
  melder_kontakt: string | null;
  notiz: string | null;
  erfasst_at: string;
  erfasst_von: number;
  geaendert_at: string;
  geaendert_von: number;
  storniert_at: string | null;
}

export interface PersonZugriff {
  id: number;
  person_id: number | null;
  benutzer_id: number;
  benutzer_name: string;
  art: 'detail' | 'export';
  zugriff_at: string;
}
```

- [ ] **Step 2: API-Client schreiben**

`frontend/src/api/einsatzPerson.ts`:

```typescript
import type { Person, PersonStatus, PersonZugriff } from './types';
import { apiGet, apiSend } from './client';

/** Felder, die beim Anlegen/Bearbeiten gesetzt werden können (alle optional). */
export interface PersonEingabe {
  name?: string | null;
  vorname?: string | null;
  geschlecht?: string | null;
  geburtsdatum?: string | null;
  alter_geschaetzt?: number | null;
  herkunft_adresse?: string | null;
  antreff_ort?: string | null;
  melder_kontakt?: string | null;
  notiz?: string | null;
}

export function listePersonen(einsatzId: number, status?: PersonStatus): Promise<Person[]> {
  const q = status ? `?status=${status}` : '';
  return apiGet<Person[]>(`/api/einsaetze/${einsatzId}/personen${q}`);
}

export function ladePerson(einsatzId: number, personId: number): Promise<Person> {
  // Schreibt serverseitig einen detail-Audit-Eintrag.
  return apiGet<Person>(`/api/einsaetze/${einsatzId}/personen/${personId}`);
}

export function legePersonAn(einsatzId: number, daten: PersonEingabe): Promise<Person> {
  return apiSend<Person>(`/api/einsaetze/${einsatzId}/personen`, 'POST', daten);
}

export function aktualisierePerson(einsatzId: number, personId: number, daten: PersonEingabe): Promise<Person> {
  return apiSend<Person>(`/api/einsaetze/${einsatzId}/personen/${personId}`, 'PATCH', daten);
}

export function setzePersonStatus(einsatzId: number, personId: number, status: PersonStatus): Promise<Person> {
  return apiSend<Person>(`/api/einsaetze/${einsatzId}/personen/${personId}/status`, 'POST', { status });
}

export function stornierePerson(einsatzId: number, personId: number): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/personen/${personId}`, 'DELETE');
}

export function ladePersonAudit(einsatzId: number, personId: number): Promise<PersonZugriff[]> {
  return apiGet<PersonZugriff[]>(`/api/einsaetze/${einsatzId}/personen/${personId}/audit`);
}

/** Registriernummer-Anzeige wie im Backend (R-042). */
export function registrierAnzeige(nr: number): string {
  return `R-${String(nr).padStart(3, '0')}`;
}
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && pnpm exec tsc --noEmit`
Expected: PASS (keine Typfehler)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api/types.ts frontend/src/api/einsatzPerson.ts
git commit -m "feat(fe): Personen-API-Client und Typen"
```

---

## Task 14: Frontend — `usePersonenStream`-Hook

Analog `useEtbStream`, aber lauscht auf `person`-Events und invalidiert **nur** die Personen-Listen-Query (`['einsatz-personen', einsatzId]`) — **nicht** die Detail-Query, damit ein fremdes Schreiben keinen Audit-getriggerten Detail-Refetch auslöst.

**Files:**
- Create: `frontend/src/etb/usePersonenStream.ts`
- Create: `frontend/src/etb/usePersonenStream.test.tsx`

- [ ] **Step 1: Failing test schreiben**

`frontend/src/etb/usePersonenStream.test.tsx` (FakeEventSource wie im `useEtbStream`-Test):

```tsx
import { render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClientProvider } from '@tanstack/react-query';
import { neuerQueryClient } from '../test/utils';
import { usePersonenStream } from './usePersonenStream';

class FakeEventSource {
  static letzte: FakeEventSource | null = null;
  url: string;
  closed = false;
  private listeners: Record<string, ((e: MessageEvent) => void)[]> = {};
  constructor(url: string) { this.url = url; FakeEventSource.letzte = this; }
  addEventListener(typ: string, cb: (e: MessageEvent) => void) { (this.listeners[typ] ??= []).push(cb); }
  removeEventListener(typ: string, cb: (e: MessageEvent) => void) {
    this.listeners[typ] = (this.listeners[typ] ?? []).filter((l) => l !== cb);
  }
  close() { this.closed = true; }
  emit(typ: string, data = '') { (this.listeners[typ] ?? []).forEach((cb) => cb(new MessageEvent(typ, { data }))); }
}

afterEach(() => vi.unstubAllGlobals());

function Probe({ id }: { id: number }) { usePersonenStream(id); return <div>aktiv</div>; }

describe('usePersonenStream', () => {
  it('öffnet den Personen-Stream und invalidiert nur die Liste bei person-Event', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const client = neuerQueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    render(
      <QueryClientProvider client={client}>
        <Probe id={7} />
      </QueryClientProvider>,
    );
    expect(FakeEventSource.letzte?.url).toBe('/api/einsaetze/7/personen/stream');
    FakeEventSource.letzte?.emit('person', '{"einsatz_id":7,"person_id":3}');
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ['einsatz-personen', 7] }));
    // Detail-Query darf NICHT invalidiert werden:
    expect(spy).not.toHaveBeenCalledWith({ queryKey: ['einsatz-person', 7, 3] });
  });

  it('schließt die Verbindung beim Unmount', () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const client = neuerQueryClient();
    const { unmount } = render(
      <QueryClientProvider client={client}>
        <Probe id={3} />
      </QueryClientProvider>,
    );
    const es = FakeEventSource.letzte!;
    unmount();
    expect(es.closed).toBe(true);
  });
});
```

- [ ] **Step 2: Test ausführen — muss fehlschlagen**

Run: `cd frontend && pnpm exec vitest run src/etb/usePersonenStream.test.tsx`
Expected: FAIL (Modul `usePersonenStream` existiert nicht)

- [ ] **Step 3: Hook implementieren**

`frontend/src/etb/usePersonenStream.ts`:

```typescript
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

/** Abonniert den Einsatz-SSE-Stream und invalidiert bei jedem `person`- oder
 *  `lagged`-Event NUR die Personen-Listen-Query. Bewusst NICHT die Detail-Query:
 *  ein fremdes Schreiben soll keinen Detail-Refetch (und damit keinen Lese-Audit)
 *  auslösen. Der Stream trägt keine sensible Payload (nur einsatz_id + person_id).
 *
 *  Liegt hier neben `useEtbStream` als Bündel der SSE-Hooks — kein ETB-Bezug. */
export function usePersonenStream(einsatzId: number): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (!Number.isFinite(einsatzId)) return;
    const quelle = new EventSource(`/api/einsaetze/${einsatzId}/personen/stream`);
    const resync = () => qc.invalidateQueries({ queryKey: ['einsatz-personen', einsatzId] });
    quelle.addEventListener('person', resync);
    quelle.addEventListener('lagged', resync);
    return () => {
      quelle.removeEventListener('person', resync);
      quelle.removeEventListener('lagged', resync);
      quelle.close();
    };
  }, [einsatzId, qc]);
}
```

- [ ] **Step 4: Test ausführen — muss bestehen**

Run: `cd frontend && pnpm exec vitest run src/etb/usePersonenStream.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/etb/usePersonenStream.ts frontend/src/etb/usePersonenStream.test.tsx
git commit -m "feat(fe): usePersonenStream-Hook (invalidiert nur die Liste)"
```

---

## Task 15: Frontend — `PersonenPage` Liste mit Status-Sichten

Grundgerüst der Seite: Tabs/Filter (Neu / Vermisst / Betroffen / Verstorben / Alle), Tabelle (Registriernr, Status-Badge, Name/„unbekannt", Geschlecht/Alter, Antreffort), Live-Refetch über `usePersonenStream`. Anlege-Flows und Detail-Drawer folgen in Task 16/17.

**Files:**
- Create: `frontend/src/pages/PersonenPage.tsx`

- [ ] **Step 1: Seite mit Liste + Tabs implementieren**

`frontend/src/pages/PersonenPage.tsx`:

```tsx
import { Alert, Breadcrumb, Space, Spin, Table, Tabs, Tag, Typography, type TableColumnsType } from 'antd';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ladeEinsatz } from '../api/einsaetze';
import { listePersonen, registrierAnzeige } from '../api/einsatzPerson';
import { usePersonenStream } from '../etb/usePersonenStream';
import type { Person, PersonStatus } from '../api/types';

const STATUS_META: Record<PersonStatus, { label: string; color: string }> = {
  erfasst: { label: 'erfasst', color: 'default' },
  vermisst: { label: 'vermisst', color: 'orange' },
  betroffen: { label: 'betroffen', color: 'blue' },
  verstorben: { label: 'verstorben', color: 'red' },
  abgemeldet: { label: 'abgemeldet', color: 'green' },
};

/** Sicht-Tabs: 'alle' = kein Filter; sonst Status-Filter. */
type Sicht = 'erfasst' | 'vermisst' | 'betroffen' | 'verstorben' | 'alle';
const SICHTEN: { key: Sicht; label: string }[] = [
  { key: 'erfasst', label: 'Neu' },
  { key: 'vermisst', label: 'Vermisst' },
  { key: 'betroffen', label: 'Betroffen' },
  { key: 'verstorben', label: 'Verstorben' },
  { key: 'alle', label: 'Alle' },
];

function alterAnzeige(p: Person): string {
  if (p.geburtsdatum) return p.geburtsdatum;
  if (p.alter_geschaetzt != null) return `~${p.alter_geschaetzt} J.`;
  return '—';
}

export default function PersonenPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const [sicht, setSicht] = useState<Sicht>('erfasst');

  usePersonenStream(einsatzId);

  const einsatzQuery = useQuery({ queryKey: ['einsatz', einsatzId], queryFn: () => ladeEinsatz(einsatzId) });
  const personenQuery = useQuery({
    queryKey: ['einsatz-personen', einsatzId],
    queryFn: () => listePersonen(einsatzId),
  });

  if (einsatzQuery.isLoading) {
    return <div style={{ textAlign: 'center', paddingTop: 80 }}><Spin size="large" /></div>;
  }
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return <Alert type="error" message="Einsatz nicht gefunden oder kein Zugriff" showIcon />;
  }
  const einsatz = einsatzQuery.data;

  const alle = personenQuery.data ?? [];
  const personen = sicht === 'alle' ? alle : alle.filter((p) => p.status === sicht);

  const spalten: TableColumnsType<Person> = [
    {
      title: 'Reg.-Nr.', key: 'reg', width: 100,
      render: (_, p) => <Typography.Text strong>{registrierAnzeige(p.registrier_nr)}</Typography.Text>,
    },
    {
      title: 'Status', key: 'status', width: 130,
      render: (_, p) => <Tag color={STATUS_META[p.status].color}>{STATUS_META[p.status].label}</Tag>,
    },
    {
      title: 'Name', key: 'name',
      render: (_, p) =>
        p.name || p.vorname
          ? `${p.name ?? ''}${p.vorname ? `, ${p.vorname}` : ''}`
          : <Typography.Text type="secondary">unbekannt</Typography.Text>,
    },
    { title: 'Geschlecht', dataIndex: 'geschlecht', key: 'geschlecht', render: (g) => g ?? '—' },
    { title: 'Alter', key: 'alter', render: (_, p) => alterAnzeige(p) },
    { title: 'Antreffort', dataIndex: 'antreff_ort', key: 'antreff_ort', render: (t) => t ?? '—' },
  ];

  return (
    <div>
      <Breadcrumb
        style={{ marginBottom: 12 }}
        items={[{ title: <Link to="/einsaetze">Einsätze</Link> }, { title: einsatz.bezeichnung }, { title: 'Personen' }]}
      />
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <Space>
          <Typography.Title level={3} style={{ margin: 0 }}>Personen</Typography.Title>
          <Tag color={einsatz.status === 'aktiv' ? 'green' : 'default'}>{einsatz.status}</Tag>
        </Space>
      </Space>

      <Tabs
        activeKey={sicht}
        onChange={(k) => setSicht(k as Sicht)}
        items={SICHTEN.map((s) => ({ key: s.key, label: s.label }))}
      />

      <Table
        rowKey="id"
        loading={personenQuery.isLoading}
        dataSource={personen}
        columns={spalten}
        pagination={false}
        locale={{ emptyText: 'Keine Personen in dieser Sicht' }}
      />
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && pnpm exec tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/PersonenPage.tsx
git commit -m "feat(fe): PersonenPage mit Status-Sichten und Live-Liste"
```

---

## Task 16: Frontend — Anlege-Flows (Schnellerfassung / Vermisst / Betroffen)

Drei Buttons (nur bei Schreibrecht + aktivem Einsatz) mit je einem Modal. Schnellerfassung → POST (bleibt `erfasst`). „Vermisst melden" und „Betroffene/n erfassen" → POST, danach `setzePersonStatus`.

**Files:**
- Modify: `frontend/src/pages/PersonenPage.tsx`

- [ ] **Step 1: Schreibrecht-Ableitung + Mutationen + Modals ergänzen**

In `frontend/src/pages/PersonenPage.tsx` die Imports erweitern:

```tsx
import { Alert, App, Breadcrumb, Button, Form, Input, InputNumber, Modal, Select, Space, Spin, Table, Tabs, Tag, Typography, type TableColumnsType } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { legePersonAn, listePersonen, registrierAnzeige, setzePersonStatus, type PersonEingabe } from '../api/einsatzPerson';
import { ApiError } from '../api/client';
```

Innerhalb der Komponente (nach den Queries) ergänzen:

```tsx
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [modus, setModus] = useState<null | 'schnell' | 'vermisst' | 'betroffen'>(null);
  const [form] = Form.useForm<PersonEingabe>();

  const darfSchreiben =
    einsatz.status === 'aktiv' &&
    (einsatz.meine_rolle === 'einsatzleitung' || einsatz.meine_rolle === 'fuehrungspersonal');

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['einsatz-personen', einsatzId] });
    qc.invalidateQueries({ queryKey: ['etb', einsatzId] });
  }
  const fehler = (e: unknown) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');

  const anlegenMutation = useMutation({
    mutationFn: async (v: { daten: PersonEingabe; folgeStatus?: 'vermisst' | 'betroffen' }) => {
      const person = await legePersonAn(einsatzId, v.daten);
      if (v.folgeStatus) await setzePersonStatus(einsatzId, person.id, v.folgeStatus);
      return person;
    },
    onSuccess: () => { invalidate(); setModus(null); form.resetFields(); },
    onError: fehler,
  });
```

> **Hinweis:** Die in Task 15 separat deklarierten `einsatzId`/`einsatzQuery`/`personenQuery` bleiben; hier kommen nur die neuen Zeilen hinzu. Achte darauf, dass `darfSchreiben` **nach** dem `einsatz`-Guard steht (er nutzt `einsatz`).

- [ ] **Step 2: Aktions-Buttons in den Header einfügen**

Den `<Space style={{ width: '100%' …}}>`-Block (rechte Seite) so erweitern, dass bei `darfSchreiben` drei Buttons erscheinen:

```tsx
        {darfSchreiben && (
          <Space>
            <Button type="primary" onClick={() => setModus('schnell')}>Schnellerfassung</Button>
            <Button onClick={() => setModus('vermisst')}>Vermisst melden</Button>
            <Button onClick={() => setModus('betroffen')}>Betroffene/n erfassen</Button>
          </Space>
        )}
```

Und unter der Tabelle den Read-only-Hinweis wie in MaterialPage:

```tsx
      {!darfSchreiben && einsatz.status !== 'aktiv' && (
        <Alert style={{ marginBottom: 12 }} type="info" showIcon message="Einsatz ist abgeschlossen — nur Ansicht." />
      )}
```

- [ ] **Step 3: Anlege-Modal ergänzen (am Ende des JSX, vor `</div>`)**

```tsx
      <Modal
        open={modus !== null}
        title={modus === 'vermisst' ? 'Vermisst melden' : modus === 'betroffen' ? 'Betroffene/n erfassen' : 'Schnellerfassung'}
        okText="Erfassen"
        confirmLoading={anlegenMutation.isPending}
        onOk={() => form.submit()}
        onCancel={() => { setModus(null); form.resetFields(); }}
        destroyOnClose
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={(daten) =>
            anlegenMutation.mutate({
              daten,
              folgeStatus: modus === 'vermisst' ? 'vermisst' : modus === 'betroffen' ? 'betroffen' : undefined,
            })
          }
        >
          {/* Schnellerfassung: Geschlecht + geschätztes Alter + Antreffort genügen */}
          <Form.Item label="Geschlecht" name="geschlecht">
            <Select
              allowClear
              placeholder="unbekannt"
              options={[
                { value: 'maennlich', label: 'männlich' },
                { value: 'weiblich', label: 'weiblich' },
                { value: 'divers', label: 'divers' },
                { value: 'unbekannt', label: 'unbekannt' },
              ]}
            />
          </Form.Item>
          <Form.Item label="Geschätztes Alter (Jahre)" name="alter_geschaetzt">
            <InputNumber min={0} max={120} style={{ width: 140 }} />
          </Form.Item>
          <Form.Item label="Antreffort" name="antreff_ort"><Input placeholder="z. B. Brücke, Sammelstelle" /></Form.Item>
          <Form.Item label="Name" name="name"><Input /></Form.Item>
          <Form.Item label="Vorname" name="vorname"><Input /></Form.Item>
          {modus === 'vermisst' && (
            <Form.Item label="Melder / Kontakt" name="melder_kontakt">
              <Input placeholder="Angehöriger, Kontaktdaten" />
            </Form.Item>
          )}
          <Form.Item label="Notiz" name="notiz"><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>
```

- [ ] **Step 4: Typecheck**

Run: `cd frontend && pnpm exec tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/PersonenPage.tsx
git commit -m "feat(fe): Anlege-Flows Schnellerfassung/Vermisst/Betroffen"
```

---

## Task 17: Frontend — Detail-Drawer (Status, Bearbeiten, Stornieren, Audit)

Klick auf eine Tabellenzeile öffnet einen Drawer; das Laden via `ladePerson` schreibt serverseitig den Lese-Audit. Der Drawer zeigt den vollen Datensatz, Status-Aktionen, Bearbeiten, Stornieren und — nur für die Einsatzleitung — die Audit-Einsicht.

**Files:**
- Modify: `frontend/src/pages/PersonenPage.tsx`

- [ ] **Step 1: Detail-Query, Status-/Storno-Mutationen und Drawer ergänzen**

Imports erweitern:

```tsx
import { Descriptions, Drawer, Popconfirm } from 'antd';
import { aktualisierePerson, ladePerson, ladePersonAudit, stornierePerson } from '../api/einsatzPerson';
import type { PersonStatus } from '../api/types';
```

State + Queries + Mutationen (innerhalb der Komponente):

```tsx
  const [offenePersonId, setOffenePersonId] = useState<number | null>(null);
  const [bearbeiten, setBearbeiten] = useState(false);
  const [editForm] = Form.useForm<PersonEingabe>();

  const detailQuery = useQuery({
    queryKey: ['einsatz-person', einsatzId, offenePersonId],
    queryFn: () => ladePerson(einsatzId, offenePersonId!),
    enabled: offenePersonId != null,
  });
  const auditQuery = useQuery({
    queryKey: ['einsatz-person-audit', einsatzId, offenePersonId],
    queryFn: () => ladePersonAudit(einsatzId, offenePersonId!),
    enabled: offenePersonId != null && einsatz.meine_rolle === 'einsatzleitung',
  });

  function invalidateDetail() {
    invalidate();
    qc.invalidateQueries({ queryKey: ['einsatz-person', einsatzId, offenePersonId] });
  }
  const statusMutation = useMutation({
    mutationFn: (v: { personId: number; status: PersonStatus }) => setzePersonStatus(einsatzId, v.personId, v.status),
    onSuccess: invalidateDetail, onError: fehler,
  });
  const editMutation = useMutation({
    mutationFn: (daten: PersonEingabe) => aktualisierePerson(einsatzId, offenePersonId!, daten),
    onSuccess: () => { invalidateDetail(); setBearbeiten(false); }, onError: fehler,
  });
  const stornoMutation = useMutation({
    mutationFn: (personId: number) => stornierePerson(einsatzId, personId),
    onSuccess: () => { invalidate(); setOffenePersonId(null); }, onError: fehler,
  });

  /** Erlaubte Folge-Status (Spiegel von darf_uebergehen im Backend). */
  function naechsteStatus(aktuell: PersonStatus): PersonStatus[] {
    switch (aktuell) {
      case 'erfasst': return ['vermisst', 'betroffen', 'verstorben', 'abgemeldet'];
      case 'vermisst': return ['betroffen', 'verstorben', 'abgemeldet'];
      case 'betroffen': return ['vermisst', 'verstorben', 'abgemeldet'];
      case 'verstorben':
      case 'abgemeldet': return ['erfasst', 'vermisst', 'betroffen'];
    }
  }
```

In der `spalten`-Definition die Zeile klickbar machen — `onRow` an der `<Table>` ergänzen:

```tsx
        onRow={(p) => ({ onClick: () => { setOffenePersonId(p.id); setBearbeiten(false); }, style: { cursor: 'pointer' } })}
```

- [ ] **Step 2: Drawer-JSX am Ende ergänzen (vor `</div>`)**

```tsx
      <Drawer
        open={offenePersonId != null}
        width={520}
        title={detailQuery.data ? `Person ${registrierAnzeige(detailQuery.data.registrier_nr)}` : 'Person'}
        onClose={() => { setOffenePersonId(null); setBearbeiten(false); }}
      >
        {detailQuery.isLoading && <Spin />}
        {detailQuery.data && (() => {
          const p = detailQuery.data;
          return (
            <Space direction="vertical" style={{ width: '100%' }} size="large">
              <Space>
                <Tag color={STATUS_META[p.status].color}>{STATUS_META[p.status].label}</Tag>
                {p.storniert_at && <Tag color="default">storniert</Tag>}
              </Space>

              {darfSchreiben && !p.storniert_at && (
                <Space wrap>
                  {naechsteStatus(p.status).map((s) => (
                    <Button key={s} size="small"
                      onClick={() => statusMutation.mutate({ personId: p.id, status: s })}>
                      → {STATUS_META[s].label}
                    </Button>
                  ))}
                </Space>
              )}

              {bearbeiten ? (
                <Form form={editForm} layout="vertical" initialValues={p}
                  onFinish={(daten) => editMutation.mutate(daten)}>
                  <Form.Item label="Name" name="name"><Input /></Form.Item>
                  <Form.Item label="Vorname" name="vorname"><Input /></Form.Item>
                  <Form.Item label="Geschlecht" name="geschlecht">
                    <Select allowClear options={[
                      { value: 'maennlich', label: 'männlich' }, { value: 'weiblich', label: 'weiblich' },
                      { value: 'divers', label: 'divers' }, { value: 'unbekannt', label: 'unbekannt' },
                    ]} />
                  </Form.Item>
                  <Form.Item label="Geburtsdatum (YYYY-MM-DD)" name="geburtsdatum"><Input /></Form.Item>
                  <Form.Item label="Geschätztes Alter" name="alter_geschaetzt"><InputNumber min={0} max={120} /></Form.Item>
                  <Form.Item label="Herkunft / Adresse" name="herkunft_adresse"><Input /></Form.Item>
                  <Form.Item label="Antreffort" name="antreff_ort"><Input /></Form.Item>
                  <Form.Item label="Melder / Kontakt" name="melder_kontakt"><Input /></Form.Item>
                  <Form.Item label="Notiz" name="notiz"><Input.TextArea rows={2} /></Form.Item>
                  <Space>
                    <Button type="primary" htmlType="submit" loading={editMutation.isPending}>Speichern</Button>
                    <Button onClick={() => setBearbeiten(false)}>Abbrechen</Button>
                  </Space>
                </Form>
              ) : (
                <Descriptions column={1} size="small" bordered>
                  <Descriptions.Item label="Name">{p.name ?? '—'}</Descriptions.Item>
                  <Descriptions.Item label="Vorname">{p.vorname ?? '—'}</Descriptions.Item>
                  <Descriptions.Item label="Geschlecht">{p.geschlecht ?? '—'}</Descriptions.Item>
                  <Descriptions.Item label="Geburtsdatum">{p.geburtsdatum ?? '—'}</Descriptions.Item>
                  <Descriptions.Item label="Alter (geschätzt)">{p.alter_geschaetzt ?? '—'}</Descriptions.Item>
                  <Descriptions.Item label="Herkunft / Adresse">{p.herkunft_adresse ?? '—'}</Descriptions.Item>
                  <Descriptions.Item label="Antreffort">{p.antreff_ort ?? '—'}</Descriptions.Item>
                  <Descriptions.Item label="Melder / Kontakt">{p.melder_kontakt ?? '—'}</Descriptions.Item>
                  <Descriptions.Item label="Notiz">{p.notiz ?? '—'}</Descriptions.Item>
                </Descriptions>
              )}

              {darfSchreiben && !p.storniert_at && !bearbeiten && (
                <Space>
                  <Button onClick={() => { setBearbeiten(true); editForm.setFieldsValue(p); }}>Bearbeiten</Button>
                  <Popconfirm title="Person stornieren (Soft-Delete)?" onConfirm={() => stornoMutation.mutate(p.id)}>
                    <Button danger>Stornieren</Button>
                  </Popconfirm>
                </Space>
              )}

              {einsatz.meine_rolle === 'einsatzleitung' && (
                <div>
                  <Typography.Text type="secondary" style={{ fontSize: 12, textTransform: 'uppercase' }}>
                    Zugriffs-Audit
                  </Typography.Text>
                  <Table
                    rowKey="id" size="small" pagination={false}
                    loading={auditQuery.isLoading}
                    dataSource={auditQuery.data ?? []}
                    columns={[
                      { title: 'Wann', dataIndex: 'zugriff_at', key: 'zugriff_at' },
                      { title: 'Wer', dataIndex: 'benutzer_name', key: 'benutzer_name' },
                      { title: 'Art', dataIndex: 'art', key: 'art' },
                    ]}
                    locale={{ emptyText: 'Noch keine Zugriffe' }}
                  />
                </div>
              )}
            </Space>
          );
        })()}
      </Drawer>
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && pnpm exec tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/PersonenPage.tsx
git commit -m "feat(fe): Personen-Detail-Drawer mit Status, Bearbeiten, Stornieren und Audit-Einsicht"
```

---

## Task 18: Frontend — Verkabelung, Modul-Status, Komponententests

Modul aktivieren (`App.tsx`, `modulRegistry`), Komponententests analog `MaterialPage.test.tsx`, und PROGRESS-Vermerk.

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/einsatz/modulRegistry.ts:59`
- Create: `frontend/src/pages/PersonenPage.test.tsx`
- Modify: `docs/superpowers/PROGRESS.md`

- [ ] **Step 1: Modul verkabeln**

In `frontend/src/App.tsx` Import + Eintrag ergänzen:

```tsx
import PersonenPage from './pages/PersonenPage';
```

```tsx
const MODUL_ELEMENTE: Record<string, ReactElement> = {
  etb: <EtbPage />,
  einsatzdaten: <EinsatzdatenPage />,
  fahrzeuge: <FahrzeugePage />,
  material: <MaterialPage />,
  personal: <PersonalPage />,
  personen: <PersonenPage />,
  einheiten: <EinheitenPage />,
  einsatzabschnitte: <EinsatzabschnittePage />,
};
```

In `frontend/src/einsatz/modulRegistry.ts` Zeile 59 den `personen`-Eintrag von `status: 'geplant'` auf `status: 'fertig'` setzen:

```ts
  { key: 'personen', kategorie: 'erfassung', label: 'Personen', icon: TbUsers, route: 'personen', status: 'fertig', beschreibung: 'Ein Personenstamm mit Status-Lebenszyklus (vermisst → betroffen → Patient → verstorben).' },
```

- [ ] **Step 2: Failing Komponententests schreiben**

`frontend/src/pages/PersonenPage.test.tsx` (Muster wie `MaterialPage.test.tsx`; `EventSource` stubben, da `usePersonenStream` läuft):

```tsx
import { http, HttpResponse } from 'msw';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import PersonenPage from './PersonenPage';

class FakeEventSource {
  url: string; closed = false;
  constructor(url: string) { this.url = url; }
  addEventListener() {} removeEventListener() {} close() { this.closed = true; }
}
beforeEach(() => vi.stubGlobal('EventSource', FakeEventSource));
afterEach(() => vi.unstubAllGlobals());

const admin = {
  id: 1, anzeigename: 'Admin', benutzername: 'admin', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-27 10:00:00',
};
const einsatzAktiv = {
  id: 1, bezeichnung: 'Hochwasser', stichwort: null, status: 'aktiv',
  begonnen_at: '2026-05-27 08:00:00', abgeschlossen_at: null, abgeschlossen_von: null,
  einsatzart: 'realeinsatz', einsatznummer_intern: null, angelegt_at: '2026-05-27 08:00:00',
  leitstellen_nr: null, einsatzort: null, einsatzort_lat: null, einsatzort_lon: null,
  meldende_stelle: null, sachverhalt: null, anzahl_betroffene_initial: null,
  meine_rolle: 'einsatzleitung',
};
const einsatzBeobachter = { ...einsatzAktiv, meine_rolle: 'beobachter' };

const person = {
  id: 10, einsatz_id: 1, registrier_nr: 1, status: 'erfasst',
  name: 'Mustermann', vorname: 'Max', geschlecht: 'maennlich', geburtsdatum: null,
  alter_geschaetzt: 40, herkunft_adresse: null, antreff_ort: 'Brücke', melder_kontakt: null,
  notiz: null, erfasst_at: '2026-05-27 09:00:00', erfasst_von: 1,
  geaendert_at: '2026-05-27 09:00:00', geaendert_von: 1, storniert_at: null,
};
const unbekannt = { ...person, id: 11, registrier_nr: 2, name: null, vorname: null, status: 'vermisst' };

function render(einsatzObj: typeof einsatzAktiv, personen: unknown[]) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(admin)),
    http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzObj)),
    http.get('/api/einsaetze/1/personen', () => HttpResponse.json(personen)),
  );
  return renderMitProviders(
    <AuthProvider>
      <Routes>
        <Route path="/einsaetze/:id/personen" element={<PersonenPage />} />
      </Routes>
    </AuthProvider>,
    { route: '/einsaetze/1/personen' },
  );
}

describe('PersonenPage', () => {
  it('zeigt Personen der Sicht „Neu" mit Registriernummer und Status', async () => {
    render(einsatzAktiv, [person, unbekannt]);
    expect(await screen.findByText('R-001')).toBeInTheDocument();
    expect(screen.getByText('Mustermann, Max')).toBeInTheDocument();
    // unbekannt (vermisst) ist in der Default-Sicht „Neu" (erfasst) NICHT sichtbar:
    expect(screen.queryByText('R-002')).not.toBeInTheDocument();
  });

  it('filtert per Tab auf Vermisst und zeigt „unbekannt"', async () => {
    render(einsatzAktiv, [person, unbekannt]);
    await screen.findByText('R-001');
    await userEvent.click(screen.getByRole('tab', { name: 'Vermisst' }));
    expect(await screen.findByText('R-002')).toBeInTheDocument();
    expect(screen.getByText('unbekannt')).toBeInTheDocument();
  });

  it('Einsatzleitung sieht die Anlege-Buttons', async () => {
    render(einsatzAktiv, []);
    await screen.findByRole('heading', { name: 'Personen' });
    expect(screen.getByRole('button', { name: 'Schnellerfassung' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vermisst melden' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Betroffene/n erfassen' })).toBeInTheDocument();
  });

  it('Beobachter sieht keine Schreibaktionen', async () => {
    render(einsatzBeobachter, [person]);
    await screen.findByText('R-001');
    expect(screen.queryByRole('button', { name: 'Schnellerfassung' })).not.toBeInTheDocument();
  });

  it('öffnet den Detail-Drawer beim Klick auf eine Zeile', async () => {
    server.use(http.get('/api/einsaetze/1/personen/10', () => HttpResponse.json(person)));
    render(einsatzAktiv, [person]);
    await userEvent.click(await screen.findByText('Mustermann, Max'));
    // Drawer-Titel trägt die Registriernummer.
    expect(await screen.findByText('Person R-001')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Tests ausführen — müssen bestehen**

Run: `cd frontend && pnpm exec vitest run src/pages/PersonenPage.test.tsx`
Expected: PASS

> Falls der Zeilen-Klick-Test wackelt (mehrere Elemente mit „Mustermann"), den Klick auf die spezifische Tabellenzelle mit `within(screen.getByRole('row', …))` eingrenzen.

- [ ] **Step 4: Voller Frontend-Lauf (Regression)**

Run: `cd frontend && pnpm exec vitest run && pnpm exec tsc --noEmit`
Expected: PASS (keine bestehende Suite gebrochen; insbesondere `useEtbStream`-Tests grün)

- [ ] **Step 5: PROGRESS-Vermerk ergänzen**

In `docs/superpowers/PROGRESS.md` im Abschnitt „Teilprojekt 3 — Erfassung" die Spec **E‑1** als umgesetzt markieren (Stil an die vorhandenen Einträge anpassen; Verweis auf diesen Plan).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/App.tsx frontend/src/einsatz/modulRegistry.ts frontend/src/pages/PersonenPage.test.tsx docs/superpowers/PROGRESS.md
git commit -m "feat(fe): Personen-Modul aktivieren + Komponententests; PROGRESS E-1 erledigt"
```

---

## Abschluss-Checks (nach Task 18)

- [ ] `cargo test` — gesamte Backend-Suite grün.
- [ ] `cd frontend && pnpm exec vitest run && pnpm exec tsc --noEmit` — Frontend grün + typsicher.
- [ ] Manuelle Stichprobe (optional): Einsatz öffnen → Personen-Modul → Schnellerfassung → Person erscheint in „Neu" → Detail-Drawer öffnen (Audit-Eintrag entsteht) → Status auf „vermisst" → erscheint im Tab „Vermisst" → ETB zeigt zwei pseudonyme `system`-Einträge (R-001) ohne Namen.

---

## Self-Review (vom Plan-Autor durchgeführt)

**Spec-Coverage:**
- Personen-Entity einsatz-scoped, Soft-Delete, Registriernummer → Tasks 3, 6.
- Status-Maschine `{erfasst, vermisst, betroffen, verstorben, abgemeldet}` + Übergänge → Task 5 (`darf_uebergehen`), Task 10 (Route, 422).
- CRUD + Status + Stornieren + Org-Isolation + Rollen-/Nachlauf-Gate → Tasks 8–12.
- Lese-Audit (`person_zugriff_audit`, append-only) auf Detail + Export; Audit-Einsicht nur Leitung → Tasks 4, 7, 9, 11.
- Pseudonyme ETB-Spur bei Anlegen/Status/Stornieren + Leak-Test → Tasks 8, 10.
- SSE ohne sensible Payload (`person`-Event, einsatz_id+person_id) → Tasks 2, 8, 14.
- Frontend-Modul: Liste mit Status-Sichten, Schnellerfassung, Anlege-Flows, Detail-Drawer, disabled-Zustände → Tasks 15–18.
- Tests (Repo, Berechtigung, Audit, ETB, HTTP, Frontend) → über alle Tasks verteilt.

**Implizite Constraints (vom Advisor benannt) abgedeckt:**
- `registrier_nr` via `MAX+1` zählt stornierte mit → Task 6 Test `registrier_nr_ist_fortlaufend_und_zaehlt_stornierte_mit`.
- Liste filtert `storniert_at IS NULL`; Detail liefert stornierte → Task 6 Test `liste_blendet_stornierte_aus_detail_zeigt_sie`.
- ETB-Leak-Test (kein `name`/`vorname`) → Task 8 Test `anlegen_schreibt_pseudonymen_etb_eintrag_ohne_identitaet`.
- Audit append-only (keine UPDATE/DELETE im Repo) → Task 7 (dokumentiert, nur `anlegen`/`liste_je_person`).
- `darf_uebergehen` als reine Funktion mit Matrix-Test vor Route-Nutzung → Task 5.
- Audit vor der Response (Existenzprüfung → Audit → Response) → Task 9 Handler.
- Detail-Drawer triggert kein SSE-Refetch der Detail-Query → Task 14 (`usePersonenStream` invalidiert nur Liste; Test prüft, dass Detail-Query nicht invalidiert wird).

**Typ-/Namens-Konsistenz geprüft:** Repo-Funktionen (`liste`, `laden`, `anlegen`, `aktualisiere`, `setze_status`, `storniere`), `NeueDaten`/`PatchDaten`, `PersonStatus`/`Geschlecht`/`darf_uebergehen`/`registrier_anzeige`, Audit (`anlegen`/`liste_je_person`/`ZugriffAnzeige`), Query-Keys (`['einsatz-personen', id]`, `['einsatz-person', id, pid]`, `['einsatz-person-audit', id, pid]`) sind über Backend/Frontend hinweg einheitlich verwendet.
