# Design: Dev-Seeds & Dev-Login-Picker

**Datum:** 2026-05-25
**Status:** Entwurf, zur Umsetzung freigegeben

## Ziel

Im Entwicklungsmodus soll der Server reproduzierbare Testdaten (Benutzer mit
allen Rollen, Einsätze, Mitgliedschaften, ETB-Einträge) anlegen, und die
Login-Seite soll die verfügbaren Dev-Benutzer anzeigen und bei Auswahl
Benutzername und Passwort ins Formular füllen. Beides darf **niemals** im
Production-Binary landen.

## Nicht-Ziele

- Kein Konfigurations-UI für Seeds, keine wählbaren Datensätze zur Laufzeit.
- Kein „Klick = sofort einloggen" (bewusst verworfen zugunsten von Transparenz).
- Kein Reset-/Teardown-Subkommando (Seeds sind idempotent beim Start).

## Grundprinzip — zwei unabhängige Gates

Das Feature ist doppelt abgesichert; Backend und Frontend trennen Dev von
Production unabhängig voneinander:

| Schicht        | Gate                       | Wirkung |
|----------------|----------------------------|---------|
| Backend (Rust) | Cargo-Feature `dev-seeds`  | Seed-Code und `/api/dev/users`-Route existieren physisch **nicht** im Release-Binary. |
| Frontend (Vite)| `import.meta.env.DEV`      | Picker-UI und der Fetch werden im Production-Build per Dead-Code-Elimination entfernt. |

`scripts/build-release.sh` baut das Frontend mit `vite build` (DEV=false) und das
Backend ohne `--features dev-seeds`. Im eingebetteten Binary (rust-embed) kann
dadurch weder ein Klartext-Passwort noch Dev-UI enthalten sein. Beide Gates
müssen aktiv sein, damit überhaupt etwas erscheint.

Dev-Start (Beispiel):

```bash
# Backend
cargo run --features dev-seeds
# Frontend (separat, proxyt /api auf das Backend)
cd frontend && npm run dev
```

## Source of Truth — Backend-Endpoint statt Frontend-Liste

Das Backend ist die einzige Quelle der Dev-Benutzer. Mit `--features dev-seeds`
wird `GET /api/dev/users` registriert und liefert die Seed-Benutzer inklusive
ihres bekannten Dev-Passworts:

```json
[
  { "benutzername": "admin",   "passwort": "dev", "anzeigename": "Administrator",      "rolle": "Admin" },
  { "benutzername": "leitung", "passwort": "dev", "anzeigename": "Führungskraft",      "rolle": "Führungskraft" },
  { "benutzername": "mitglied","passwort": "dev", "anzeigename": "Einsatzkraft",       "rolle": "Benutzer" }
]
```

Ohne das Feature ist die Route nicht registriert (404). Die Liste und die
Passwörter stammen aus derselben Konstante, aus der auch geseedet wird — kein
zweiter Pflegeort. Der Endpoint erfordert keine Authentifizierung (er existiert
nur im Dev-Build) und gibt **keine** Passwort-Hashes aus, sondern die bekannten
Klartext-Dev-Passwörter aus der Seed-Konstante.

*Verworfene Alternative:* eine fest im Frontend hinterlegte Benutzerliste.
Abgelehnt, weil Passwörter dann an zwei Stellen gepflegt würden und Seed-Daten
und Anzeige auseinanderdriften könnten.

## Backend — Seeding

Neues Modul `src/dev/seed.rs`, vollständig hinter `#[cfg(feature = "dev-seeds")]`.
In `src/main.rs` wird `dev_seed(&pool)` in `run_server` **vor** `bootstrap_admin`
aufgerufen (ebenfalls feature-gegated). Dadurch sieht der bestehende
`bootstrap_admin` bereits Benutzer und ist no-op — kein Konflikt um den
`admin`-Benutzernamen, keine Änderung an `bootstrap.rs` nötig.

`Cargo.toml` bekommt:

```toml
[features]
dev-seeds = []
```

### Idempotenz

`dev_seed` läuft bei jedem Start und darf keine Duplikate erzeugen. Idempotenz
über natürliche Schlüssel:

- **Benutzer:** `INSERT ... ON CONFLICT(benutzername) DO NOTHING` (Spalte ist
  bereits `UNIQUE`).
- **Einsätze:** vor dem Anlegen prüfen, ob ein Einsatz mit der jeweiligen
  festen `bezeichnung` existiert; nur fehlende anlegen.
- **Mitgliedschaften:** Primärschlüssel `(einsatz_id, benutzer_id)` →
  `INSERT ... ON CONFLICT DO NOTHING`.
- **ETB-Einträge:** nur anlegen, wenn der Ziel-Einsatz noch keine Einträge hat
  (Prüfung auf `COUNT` pro Einsatz), damit `lfd_nr` lückenlos bleibt.

Bestehende Daten (z. B. von Hand geänderte Testeinträge) bleiben unberührt.

### Seed-Daten

Einheitliches Dev-Passwort **`dev`** für alle Benutzer.

**Benutzer:**

| benutzername | anzeigename       | system_rolle | org_rolle      | aktiv |
|--------------|-------------------|--------------|----------------|-------|
| `admin`      | Administrator     | `admin`      | `keine`        | 1     |
| `leitung`    | Führungskraft     | `keiner`     | `fuehrungskraft`| 1    |
| `mitglied`   | Einsatzkraft      | `keiner`     | `keine`        | 1     |
| `inaktiv`    | Gesperrtes Konto  | `keiner`     | `keine`        | 0     |

`inaktiv` dient dem Test der Sperre (Login verweigert bei `aktiv=0`). Der
`/api/dev/users`-Endpoint liefert **nur aktive** Benutzer, daher erscheint
`inaktiv` nicht im Picker; das gesperrte Konto wird zum Testen manuell
eingegeben (Login schlägt erwartungsgemäß fehl).

**Einsätze** (alle in der einzigen Organisation):

| bezeichnung           | stichwort   | status        |
|-----------------------|-------------|---------------|
| Übung Hochwasser      | THW-Übung   | aktiv         |
| Verkehrsunfall B27    | VU/Person   | aktiv         |
| Sturmtief Abschluss   | Unwetter    | abgeschlossen |

**Mitgliedschaften:** Dev-Benutzer in die Einsätze mit den Einsatz-Rollen
*Einsatzleitung*, *Führungspersonal*, *Beobachter* — so, dass die
einsatzbezogene Berechtigung durchgetestet werden kann (z. B. `leitung` als
Einsatzleitung in „Übung Hochwasser", `mitglied` als Beobachter).

**ETB-Einträge:** einige Beispiel-Einträge je aktivem Einsatz mit verschiedenen
Typen (`meldung`, `lage`, `anordnung`), erfasst von einem der Seed-Benutzer,
mit `lfd_nr` lückenlos ab 1.

## Backend — Dev-Endpoint

Neuer Handler `src/routes/dev.rs` (feature-gegated) für `GET /api/dev/users`.
In `src/app.rs` wird die Route nur unter `#[cfg(feature = "dev-seeds")]`
registriert:

```rust
let router = Router::new()
    /* ... bestehende Routen ... */;

#[cfg(feature = "dev-seeds")]
let router = router.route("/api/dev/users", get(routes::dev::users));

router.fallback(crate::static_files::serve).with_state(state)
```

Der Handler gibt die Seed-Benutzer-Konstante als JSON zurück (dieselbe Quelle
wie `dev_seed`).

## Frontend — Login-UI

`frontend/src/pages/LoginPage.tsx`:

- Bei `import.meta.env.DEV` einmalig (in `useEffect`) `GET /api/dev/users`
  laden. Der gesamte Block steht hinter `if (import.meta.env.DEV)`, sodass er im
  Production-Build per DCE entfällt.
- Bei Erfolg mit nicht-leerer Liste: über dem Formular ein dezenter Block
  „Dev-Schnellanmeldung" mit den Benutzern (Anzeigename + Rolle als Tag).
  Auswahl ruft `form.setFieldsValue({ benutzername, passwort })` auf; der
  Nutzer drückt selbst **Anmelden**.
- Bei 404 oder Netzwerkfehler (Feature aus): nichts rendern — normales Login.

Dafür wird das antd-`Form` mit einer `Form.useForm()`-Instanz versehen (aktuell
ohne Instanz), damit `setFieldsValue` möglich ist.

Optional kleiner Helfer `frontend/src/api/dev.ts` mit der Fetch-Funktion und
dem Antworttyp; Aufruf nur aus dem DEV-Zweig.

## Fehlerbehandlung

- Dev-Endpoint-Fetch schlägt fehl → still ignorieren, kein Picker, normales
  Login bleibt voll funktionsfähig.
- Login mit `inaktiv` → bestehender Pfad liefert `Unauthorized` (durch
  `aktiv = 1`-Filter in der Login-Query). Kein Sonderfall nötig.

## Tests

**Backend** (Lauf mit `--features dev-seeds`):

- `dev_seed` zweimal hintereinander ausführen → Benutzer-, Einsatz-,
  Mitgliedschafts- und ETB-Zahlen bleiben gleich (Idempotenz).
- Nach `dev_seed` enthält `GET /api/dev/users` die erwarteten Benutzer mit
  Passwort `dev`.
- Sicherstellen, dass der Build **ohne** das Feature kompiliert und die Route
  dann fehlt (keine `dev`-Symbole referenziert).

**Frontend:**

- LoginPage-Test mit gemocktem `/api/dev/users` (MSW): Picker rendert, Auswahl
  füllt `benutzername` und `passwort`.
- LoginPage-Test ohne/mit fehlschlagendem Endpoint: kein Picker, Formular
  unverändert.

## Betroffene Dateien

- `Cargo.toml` — Feature `dev-seeds`.
- `src/dev/seed.rs` (neu), `src/dev/mod.rs` (neu) — Seed-Logik + Benutzer-Konstante.
- `src/routes/dev.rs` (neu), `src/routes/mod.rs` — Dev-Endpoint.
- `src/app.rs` — gegate Route-Registrierung.
- `src/main.rs` — gegater `dev_seed`-Aufruf vor `bootstrap_admin`.
- `frontend/src/pages/LoginPage.tsx` — Picker + Form-Instanz.
- `frontend/src/api/dev.ts` (neu, optional) — Fetch-Helfer.
- Tests entsprechend.
