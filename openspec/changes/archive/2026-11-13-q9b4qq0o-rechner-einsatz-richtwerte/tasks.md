# Tasks

Arbeitsweise je Aufgabe: `superpowers:test-driven-development` (erst der rote Test, dann der Code).

## 1. Freigabe: ist dieser Einsatz für den Zugang lesbar? (D2)

- [x] 1.1 `public_api::freigabe`: Funktion, die genau dann wahr ist, wenn der Einsatz unter den
  wirksam freigegebenen des Zugangs steht und zur Org des Zugangs gehört; ein Treffer einer
  fremden Org wird als Fehler protokolliert und ist falsch. Prüfen: Unit-Tests in `freigabe.rs`
  für freigegeben, nicht freigegeben, anderer Einsatz, abgeschlossen, gelöscht, fremde Org,
  unbekannte Kennung.
- [x] 1.2 Spiegel-Sperre: liefert die Freigabestufe eines gespiegelten Einsatzes die Kategorie von
  `einsatz_unterkunft_richtwert` nicht (auch eine unbekannte Stufe), gilt der Einsatz für die
  Rechnung als nicht lesbar. Prüfen: Test mit einer Zeile in `einsatz_spiegel` mit unbekannter
  `freigabestufe`, dazu der Normalfall `alles`.

## 2. Ebenen und Herkunft (D4, D5)

- [x] 2.1 `RichtwertEbene::Einsatz => "einsatz"` und Eintrag im Enum-Wire-Kontrakt
  (`tests/enum_wire_kontrakt.rs`). Prüfen: `cargo test --test enum_wire_kontrakt`.
- [x] 2.2 `wirksame_werte` auf `unterkunft::zusammenfuehren(org, einsatz)` stellen, Anfrage
  darüber, Herkunft per vollständigem `match` abgebildet; `calculate` nimmt die geladenen Ebenen
  herein und bleibt ohne Datenbank. Prüfen: Unit-Tests in `src/public_api/rechner/tests.rs` für
  Anfrage vor Einsatz vor Org vor Basis und Einsatz ohne eigenen Wert; der Paritätstest
  `jeder_fall_der_fallsammlung_ergibt_das_erwartete_ergebnis` bleibt grün.

## 3. Rechnung mit `einsatz_id` (D1, D3, D4)

- [x] 3.1 `einsatz_id: Option<i64>` an `UnterkunftRequest`, von `check_request` mit herausgegeben.
  Prüfen: Einlesetest — Zeichenkette und `7.5` ergeben 400 mit `einsatz_id`, `null` gilt wie
  fehlend; der bisherige Test „unbekanntes Feld `einsatz_id`“ wird auf `einsatz` umgestellt
  (Unit- und Integrationstest).
- [x] 3.2 Handler `calculate_unterkunft`: nach der Prüfung bei `einsatz_id` Freigabe (1.1, 1.2),
  sonst 404 `not_found` mit festem Text; dann `repo::einsatz_werte` und rechnen. Prüfen:
  Integrationstests in `tests/rechner_api.rs` für jedes Szenario der Delta-Spec — Wert des
  Einsatzes mit Herkunft `einsatz`, Anfrage vor Einsatz, Einsatz ohne eigenen Wert, ohne
  `einsatz_id` unverändert, ohne Freigabe, anderer Einsatz, abgeschlossen, unbekannt, nur
  `rechner:use`, ungültige Anfrage mit fremdem Einsatz ergibt 422; die 404-Bodies sind
  byte-gleich.
- [x] 3.3 `#[utoipa::path]`-Beschreibungen beider Routen (404, Ebenen) und `//!`-Kopf von
  `rechner.rs` nachziehen; `docs/api/public-v1.json` neu schreiben. Prüfen:
  `scripts/check-typ-codegen.sh` grün, `frontend/src/api/openapi.json` und
  `types.generated.ts` unverändert.

## 4. Auskunft mit `?einsatz_id` (D4)

- [x] 4.1 `get_unterkunft_richtwerte` liest `einsatz_id` als Text, prüft auf ganze Zahl (400
  `invalid_field` mit `einsatz_id`), dann wie 3.2. OpenAPI-Parameter dazu. Prüfen:
  Integrationstests für Wert des Einsatzes in der Auskunft, `?einsatz_id=abc` ergibt 400,
  Auskunft ohne Freigabe ergibt 404, ohne Parameter unverändert; `public-v1.json` neu
  geschrieben.

## 5. Doku und Regeln

- [x] 5.1 `docs/api/maschinenzugang.md`, Abschnitt „Rechner Unterkunft und Zelte“: Ebenen mit
  Einsatz, `einsatz_id` in Body und Abfrage, Freigabe nötig und `einsaetze:read` empfohlen
  (Kennung über `GET /api/v1/einsaetze`), Tabelle der Codes um 404 ergänzt; Abschnitt „Scopes“
  prüfen. Prüfen: Abschnitt gegen die Delta-Spec gelesen, Prettier grün.
- [x] 5.2 Anwenderkapitel `docs/anwender/kapitel/anbindungen.md` („Rechner nutzen“, Freigabe) und
  `betreuung.md` (Fremdsystem rechnet mit den Werten eines freigegebenen Einsatzes) nach
  `docs/anwender/AGENTS.md`. Prüfen: `anwenderdoku.guard.test.ts` grün.
- [x] 5.3 `frontend/src/betreuung/AGENTS.md` (Rechner-API: Ebenen mit Einsatz über die Freigabe
  statt „ohne Einsatz“) und `docs/architektur/05-bausteinsicht.md` (`src/public_api`, Rechner)
  nach `docs/architektur/AGENTS.md`. Prüfen: Prettier grün, `scripts/check-architektur.sh` grün.

- [x] 5.4 ADR-0040 ersetzt ADR-0032 (design.md D6): übrige Regeln unverändert, Einsatz-Werte nur
  über `freigabe::is_lesbar`, Rangfolge aus `unterkunft::zusammenfuehren`; ADR-0032 auf
  `ersetzt`. Prüfen: `scripts/check-architektur.sh` und `scripts/check-adr-nummern.sh` grün.

## 6. Gesamtprüfung

- [x] 6.1 `./scripts/check-all.sh` grün; ersatzweise in der Cloud-Sitzung die Schritte, die dort
  laufen (mindestens `check-fmt.sh`, `check-typ-codegen.sh`, `check-architektur.sh`,
  `check-schreibweisen.sh`, `cargo test --lib`, Integrationstests `rechner_api`,
  `maschinenzugang`, `public_api`, `public_api_lage`, `public_api_spec_aktuell`,
  `enum_wire_kontrakt`, dazu `anwenderdoku.guard.test.ts`), der Rest über die CI des PRs (mit
  Verweis auf den Lauf abhaken). In der Cloud-Sitzung am 13.11.2026 grün: `check-fmt.sh`,
  `check-typ-codegen.sh` (alle fünf Schritte; Node 22 statt 26 aus `mise.toml`, `mise` fehlt
  dort), `check-architektur.sh`, `check-adr-nummern.sh`, `check-schreibweisen.sh`,
  `check-openspec-archiv.sh`, `check-migrationen.sh`, `cargo test --lib` (4291 Tests), die
  Integrationstests `rechner_api`, `maschinenzugang`, `public_api`, `public_api_lage`,
  `public_api_einsaetze`, `public_api_spec_aktuell`, `enum_wire_kontrakt`, dazu
  `anwenderdoku.guard.test.ts`, `richtwerte.guard.test.ts`, `rechnerFixture.test.ts`. Den Rest
  (übrige Integrationstests, ganze Vitest-Suite, Lint, e2e) belegt die CI des PRs.

## Workflow follow-up

- Review vor dem PR (`dev-zunder-orchestrieren`, Phase 4), Befunde behandeln.
- `/opsx:archive` im selben Branch, dann der PR gegen `alpha` mit dem Abschnitt „Review“.
