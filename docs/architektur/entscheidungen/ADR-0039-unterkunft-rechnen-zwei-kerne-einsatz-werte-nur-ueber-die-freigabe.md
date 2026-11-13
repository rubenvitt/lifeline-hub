---
id: ADR-0039
titel: Unterkunft rechnen zwei Kerne nach einer Fallsammlung, Einsatz-Werte nur über die Freigabe
status: akzeptiert
datum: 2026-11-13
gilt_fuer:
  - src/unterkunft/rechner.rs
  - src/public_api/rechner.rs
  - src/public_api/rechner/**
  - frontend/src/betreuung/unterkunft/rechnerKern.ts
  - frontend/src/betreuung/unterkunft/rechnerFixture.test.ts
  - tests/fixtures/unterkunft/**
ersetzt: ADR-0032
herleitung:
  - openspec/changes/archive/2026-11-12-p4h3v7q9-rechner-api-unterkunft/design.md
  - openspec/changes/archive/2026-11-13-q9b4qq0o-rechner-einsatz-richtwerte/design.md
  - LLH-1856 (mit Ruben am 13.11.2026 abgestimmt)
---

# ADR-0039: Unterkunft rechnen zwei Kerne nach einer Fallsammlung, Einsatz-Werte nur über die Freigabe

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
- MUST: Werte eines Einsatzes nimmt die Rechner-API nur für den Einsatz aus `einsatz_id`, den
  `public_api::freigabe::is_lesbar` für den Zugang bestätigt
  ([ADR-0035](ADR-0035-ein-maschinenzugang-liest-einsatzbezogen-nur-was-die-einsatzleitung-freigegeben-hat.md));
  jeder andere Einsatz ergibt dieselbe 404, erst nach der Prüfung der Anfrage.
- MUST: Die Rangfolge Einsatz vor Organisation vor Basis kommt aus
  `unterkunft::zusammenfuehren`; die Rechner-API legt nur die Werte der Anfrage darüber.
- SHOULD: Die Oberfläche rechnet nicht über die API.

## Prüfung

```sh
verlange 'fixtures/unterkunft/faelle.json' src/public_api/rechner/tests.rs
verlange 'fixtures/unterkunft/faelle.json' frontend/src/betreuung/unterkunft/rechnerFixture.test.ts
verlange 'deny_unknown_fields' src/public_api/rechner.rs
verlange 'der_kern_liest_jeden_schluessel_der_basis' src/unterkunft/rechner.rs
verbiete '^use (serde|utoipa)|derive\(.*(Serialize|Deserialize|ToSchema)' src/unterkunft/rechner.rs
verlange 'freigabe::is_lesbar' src/public_api/rechner.rs
verlange 'unterkunft::zusammenfuehren' src/public_api/rechner.rs
```

## Kontext

ADR-0032 hielt die Werte eines Einsatzes aus der Rechner-API heraus, weil es keine
Einsatz-Freigabe für Maschinenzugänge gab. Mit LLH-1638 gibt es sie (ADR-0035). Ein Fremdsystem,
das für einen laufenden Einsatz plant, soll mit denselben Werten rechnen wie die Einsatzleitung.

## Konsequenzen

Ein Zugang mit `rechner:use` und einer Freigabe sieht die Richtwerte dieses Einsatzes, ohne
eigenen Schalter; freigeben lässt er sich weiter nur mit einem Lese-Scope mit Einsatzbezug. Die
Rangfolge der Ebenen steht für Oberfläche, interne API und v1 an einer Stelle.
