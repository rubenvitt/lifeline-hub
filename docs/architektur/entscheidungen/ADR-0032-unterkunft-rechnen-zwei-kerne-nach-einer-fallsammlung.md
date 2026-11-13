---
id: ADR-0032
titel: Unterkunft rechnen zwei Kerne nach einer gemeinsamen Fallsammlung, die API prüft streng
status: ersetzt
datum: 2026-11-12
gilt_fuer:
  - src/unterkunft/rechner.rs
  - src/public_api/rechner.rs
  - src/public_api/rechner/**
  - frontend/src/betreuung/unterkunft/rechnerKern.ts
  - frontend/src/betreuung/unterkunft/rechnerFixture.test.ts
  - tests/fixtures/unterkunft/**
ersetzt_durch: ADR-0040
herleitung:
  - openspec/changes/archive/2026-11-12-p4h3v7q9-rechner-api-unterkunft/design.md
  - LLH-1524 (mit Ruben am 12.11.2026 abgestimmt)
---

# ADR-0032: Unterkunft rechnen zwei Kerne nach einer gemeinsamen Fallsammlung, die API prüft streng

## Regeln

- MUST: Die Rechnung Unterkunft und Zelte steht in zwei Kernen: `rechnerKern.ts` für die
  Oberfläche (im Browser, ohne Netz) und `src/unterkunft/rechner.rs` für die Rechner-API. Wer
  einen ändert, ändert im selben PR den anderen und `tests/fixtures/unterkunft/faelle.json`.
- MUST: Beide Kerne bestehen jeden Fall der Fallsammlung. Der Rust-Test schickt jeden Fall durch
  Einlesen, Prüfung, Rechnung und Serialisierung der v1-Route: `eingabe` ist eine gültige Anfrage,
  `erwartet` das Ergebnis, Zahlen Bit für Bit gleich.
- MUST: Die Rechner-API prüft streng, erst jedes Feld für sich (400, der Text nennt das Feld),
  dann den Zusammenhang (422). Unbekannte und doppelte Felder und Listen an Stelle von Objekten
  sind 400. Sie rechnet nie mit einem stillen Ersatzwert; eine leere Gruppe wird mit 0 genannt.
- MUST: Die Feldgrenzen der Rechner-API sind so gewählt, dass die größte Anfrage in üblicher
  Schreibweise in den Body der öffentlichen API passt (`src/AGENTS.md`, „Öffentliche API v1“).
- MUST NOT: Der Kern `src/unterkunft/rechner.rs` trägt serde- oder OpenAPI-Schemas; die
  Wire-Formen stehen in `src/public_api/rechner.rs` und ändern sich nur additiv
  ([ADR-0022](ADR-0022-fremdsysteme-sprechen-signiert-mit-der-oeffentlichen-api-v1.md)).
- MUST NOT: Die Rechner-API liest Werte eines Einsatzes, solange es keine Einsatz-Freigabe für
  den Zugang gibt (ADR-0022). `einsatz_id` kommt mit dieser Freigabe als optionales Feld.
- SHOULD: Die Oberfläche rechnet nicht über die API.

## Prüfung

```sh
verlange 'fixtures/unterkunft/faelle.json' src/public_api/rechner/tests.rs
verlange 'fixtures/unterkunft/faelle.json' frontend/src/betreuung/unterkunft/rechnerFixture.test.ts
verlange 'deny_unknown_fields' src/public_api/rechner.rs
verlange 'der_kern_liest_jeden_schluessel_der_basis' src/unterkunft/rechner.rs
verbiete '^use (serde|utoipa)|derive\(.*(Serialize|Deserialize|ToSchema)' src/unterkunft/rechner.rs
verbiete 'einsatz_werte' src/public_api/rechner.rs
```

## Kontext

Der Unterkunftsrechner rechnet seit LLH-1520 im Browser, damit er ohne Netz geht. Fremdsysteme
sollen dieselbe Rechnung über die öffentliche API bekommen, ohne sie nachzubauen. Eine Maske
zeigt dem Menschen, was sie verstanden hat; ein Fremdsystem sieht nur das Ergebnis und rechnete
mit einem Tippfehler im Feldnamen still mit 0. Eine Einsatz-Freigabe für Maschinenzugänge gab es
am 12.11.2026 nicht.

## Konsequenzen

Die Rechnung steht zweimal, und jede Änderung kostet drei Stellen; dafür bleibt der Rechner der
Oberfläche unberührt, und kein neuer Bauweg (WASM) oder eine JS-Laufzeit im Server ist nötig. Die
Fallsammlung ist zugleich Paritätstest und Beispielsammlung der API. Was die API heute ablehnt,
lässt sich innerhalb von v1 später lockern, eine Annahme nicht zurücknehmen. Einsatz-Werte fehlen
Fremdsystemen bis zur Folgeaufgabe.
