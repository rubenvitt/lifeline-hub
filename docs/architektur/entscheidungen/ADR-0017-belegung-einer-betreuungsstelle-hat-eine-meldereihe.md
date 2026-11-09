---
id: ADR-0017
titel: Die Belegung einer Betreuungsstelle hat eine Meldereihe, auch wenn sie namentlich geführt wird
status: akzeptiert
datum: 2026-11-09
gilt_fuer:
  - src/betreuung/**
  - src/person/verbleib_repo.rs
  - src/routes/betreuung.rs
  - src/routes/betreuung_registrierung.rs
  - migrations/0310_registrierstelle.sql
herleitung:
  - openspec/changes/archive/2026-11-09-hitr91ob-registrierstelle-betreuung/design.md
---

# ADR-0017: Die Belegung einer Betreuungsstelle hat eine Meldereihe, auch wenn sie namentlich geführt wird

## Regeln

- MUST: Registrierte Personen sind Betroffene in `einsatz_person` mit dem Verbleib
  „Notunterkunft“ an der Stelle; ein zweites Personenregister für Betreute gibt es nicht.
- MUST: Die Belegung einer Betreuungsstelle steht nur in der Meldereihe
  `betreuungsstelle_belegung`; Kopfzahl, Verlauf, Übersicht und Verpflegung lesen nur sie.
- MUST: An einer Stelle mit `belegungsart = 'namentlich'` schreibt nur der Server Meldungen,
  mit `quelle = 'registrierung'`, über `betreuung::repo::belegung_nachfuehren_tx`; eine
  Handmeldung oder Rücknahme dort ist 409.
- MUST: Jeder Weg, der den Verbleib-Cache einer Person ändert, führt die Belegung nach:
  `person::verbleib_repo::erfassen_tx` von selbst, der Storno der Person in seiner Route.
  Sammelvorgänge (Registrierung, Abmeldung) setzen `ohne_belegung_nachfuehren` und führen
  einmal je Stelle nach.
- MUST NOT: keine Belegungszahl beim Lesen aus den Personen rechnen.
- SHOULD: Regeln der Oberfläche: `frontend/src/betreuung/AGENTS.md`, „Registrierstelle“.

## Prüfung

```sh
verlange 'belegung_nachfuehren_tx' src/person/verbleib_repo.rs src/routes/einsatz_person.rs
verlange 'fn nicht_namentlich' src/betreuung/repo.rs
verlange "'registrierung'" migrations/0310_registrierstelle.sql
verbiete 'CREATE TABLE (betreute|registrierte|betreuungsperson)' 'migrations/*.sql'
```

## Kontext

Notunterkünfte sollen Betroffene an der Tür namentlich aufnehmen, mit Haushalt und Kostform;
bisher zählte die Stelle nur. Ruben entschied am 09.11.2026, dass die Belegungsart je Stelle
wählbar ist (gezählt oder namentlich geführt), ohne dass es je zwei Zahlen für „in Betreuung“
gibt. Kopfzahl zu einem Zeitpunkt und Belegungslinie brauchen einen Verlauf, den die
Meldereihe schon trägt.

## Konsequenzen

Eine namentlich geführte Stelle bekommt bei jeder Änderung der Registrierten eine Meldung vom
Server samt ETB-Eintrag; Kopfzahl, Stufenlinie und Verpflegung bleiben unverändert. Ein
Verbleibwechsel auf der Personenseite (etwa ein Transport) ändert die Belegung der Stelle mit.
Meldungen aus der Registrierung lassen sich nicht zurücknehmen; berichtigt wird über die
Personen.
