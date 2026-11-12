# Proposal

## Why

Fremdsysteme haben heute keinen Zugang zu Lifeline Hub, der an eine Org und an Rechte gebunden
ist. Gemeint sind Alarm-Adapter, Lagemonitor, Rechner und das Einsatzbuch der iuk-suite. Es gibt
nur zwei Bearer-Lesewege ohne Drosselung (R33) und die Instanzkopplung, deren Widerruf Spiegel,
Stammdaten und Führung mitreißt. Das Konzept zur öffentlichen API
(`docs/konzepte/2026-11-11-oeffentliche-api.md`, D1/D2) und ADR-0022 legen den Weg fest. Diese
Change baut den Unterbau. Erst danach können LLH-1638, LLH-1655, LLH-1524 und LLH-1192 Routen
unter `/api/v1/` anbieten.

## What Changes

- **Maschinenzugang:** Ein Zugang gehört genau einer Org. Er hat einen Namen, feste Scopes, ein
  optionales „gültig bis“ und einen gebundenen Ed25519-Schlüssel. Zugänge, Codes, `jti` und das
  Abrufprotokoll stehen in eigenen Tabellen. Ein Widerruf wirkt sofort und berührt keine
  Instanzkopplung.
- **Einstieg per Einmal-Code:**
  - Ein System-Admin legt einen Zugang an und bekommt einen Code: 16 Zeichen, 15 Minuten gültig,
    einmal einlösbar.
  - Das Fremdsystem löst ihn mit `POST /api/v1/zugang/redeem` ein. Es schickt dabei seinen
    öffentlichen Schlüssel und einen aus dem Code abgeleiteten Prüfwert. Der Code selbst geht nie
    über die Leitung.
  - Die Antwort enthält die Zugangs-ID, die Instanz-UUID und den Instanzschlüssel mit Prüfwert.
  - Ein neuer Code für denselben Zugang wechselt den Schlüssel. Der alte gilt, bis der neue zum
    ersten Mal signiert.
- **Signierte Anfragen:**
  - Kopf `Authorization: Machine <jws>`, `typ` `lifeline-machine+jwt`.
  - Claims `iss aud iat exp jti htm htu bh`.
  - Der Extractor `MachineClient` in `src/public_api/` prüft Signatur, Widerruf und Ablauf, Scope
    und Org.
  - Eine gescheiterte Anmeldung antwortet immer 401 ohne Grund. Der Grund steht am Zugang.
  - Erfolgreiche Antworten tragen eine Signatur der Instanz.
- **Neue Routen:**
  - `GET /api/v1/me`: Zugang, Org, Scopes, Serverzeit und Uhrabweichung.
  - `GET /api/v1/instanz/jwks.json`: öffentlicher Instanzschlüssel.
- **Drosselung:**
  - Je Zugang ein Token-Bucket: Vorrat 60, eine je Sekunde nach. Leer: 429 mit `Retry-After`.
  - Je IP ein eigener Zähler für Maschinen. Er zählt nur unbekannte Zugänge und gescheiterte
    Einlösungen und ist nie die Anmeldesperre.
- **Nachweis:**
  - Neue Aktionen in `admin_audit` für Anlegen, Code ausstellen, Schlüssel gebunden, Ändern und
    Widerruf.
  - Abrufprotokoll je Zugang, Route und Tag, 365 Tage aufbewahrt.
- **Admin-Seite „Anbindungen“:** anlegen, Code zeigen, Fingerabdruck, Scopes, ändern, widerrufen,
  Schlüssel wechseln. Dazu der letzte Ablehnungsgrund, zum Beispiel „Uhr weicht 7 min ab“, und
  „zuletzt genutzt“.
- **Zugänglichkeit:**
  - Kommando `lifeline-hub zugang redeem <url> <code>`.
  - Rust-Referenz-Client als Crate `crates/lifeline-machine-client`.
  - TypeScript-Modul und Python-Beispiel unter `docs/api/clients/`.
  - Testvektoren unter `docs/api/`, gegen die alle drei Clients und der Server geprüft werden.
- **Geteilte Signaturprüfung:** `src/instanz/signatur.rs` und `src/instanz/code.rs` bekommen ein
  Profil mit `typ`, Kopf, Salz und Claims mit oder ohne `pv`. Die Instanzkopplung verhält sich
  danach unverändert.
- **ADR-0022 wird akzeptiert.** R33 wird fortgeschrieben: Die Maschinenwege sind gedrosselt. Der
  Lagemonitor-Bearer und die ungedrosselten Instanzrouten bleiben, bis LLH-1638 folgt.

**Nicht in dieser Change:**

- Einsatzfreigabe für Lese-Scopes mit Einsatzbezug. Sie kommt mit `GET /api/v1/lage` in LLH-1638.
- Fachrouten (`lage`, `einsaetze`, `events`, `alarmmeldungen`, `positionen`, `rechner`).
- Einwurf-Zugang (LLH-1654).
- Webhooks (LLH-1656).
- Das v1-Gerüst selbst: Router, Dokument, `ApiError` mit `code`, Body-Grenze und `no-store`
  kommen aus LLH-1653 (Change `h5zpb97t-oeffentliche-api-vertrag`). Diese Change setzt darauf
  auf.

## Capabilities

### New Capabilities

- `maschinenzugang`: Anmeldung von Fremdsystemen an der öffentlichen API. Dazu gehören Zugang je
  Org mit Scopes, Einstieg per Einmal-Code, signierte Anfragen und Antworten, Widerruf und
  Schlüsselwechsel, Drosselung, Ablehnungsgrund am Zugang, Admin-Spur und Abrufprotokoll, die
  Prüfroute `me`, der Instanzschlüssel als JWKS sowie Kommando, Referenz-Clients und Testvektoren.

### Modified Capabilities

Keine. Die Instanzkopplung (`instanz-kopplung`) ändert nur ihre Implementierung, nicht ihre
Anforderungen. Die Anmeldesperre (`passwort-anmeldung`) bleibt unberührt; die Trennung von ihr
steht als Anforderung in `maschinenzugang`.

## Impact

- **Backend:**
  - neu: `src/public_api/` mit `machine.rs` (Extractor), `zugang.rs` (Repo und Admin-Routen),
    Handlern für `redeem`, `me` und `jwks.json`;
  - Umbau: `src/instanz/{signatur,code}.rs` (Profil) und `src/auth/rate_limit.rs` (Sperrtabelle
    mit Parametern, zweite Instanz für Maschinen);
  - testbarer Token-Bucket (Muster `geocoding::TokenBucket`);
  - Aufräumen in `src/einsatz/purge_scheduler.rs`;
  - `src/auth/admin_audit.rs`;
  - `src/config.rs` und `src/main.rs` (Kommando);
  - `src/app.rs` (Admin-Routen `/api/admin/anbindungen…`);
  - `src/api_doc.rs` (Admin-DTOs).
- **Migrationen:** vier neue Tabellen und der neu gebaute CHECK von `admin_audit`. Die Nummern
  liegen über allen auf `alpha`.
- **Workspace:** neues Mitglied `crates/lifeline-machine-client`. Das Binary hängt für das
  Kommando davon ab.
- **Frontend:**
  - neue Sektion `anbindungen` in `frontend/src/admin/adminNav.tsx`;
  - Seite, API-Modul, Query-Key, erzeugte Typen;
  - Test für die Testvektoren des TypeScript-Moduls.
- **Doku:**
  - `docs/api/` mit Testvektoren, Clients und Anleitung;
  - Anwender-Kapitel `anbindungen.md` (Reihenfolge 795);
  - Architektur Kapitel 3, 5, 6, 8 und 11;
  - ADR-0022 auf `akzeptiert`.
- **Abhängigkeit:** LLH-1653 muss vor `/opsx:apply` auf `alpha` liegen, oder die Umsetzung baut
  auf dessen Stand auf und rebast nach dessen Merge.
