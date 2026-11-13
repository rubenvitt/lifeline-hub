---
id: ADR-0039
titel: Einen Spiegel ohne gekoppelte Führung holt nur ein Mensch zurück
status: akzeptiert
datum: 2026-11-13
gilt_fuer:
  - src/instanz/fuehrung/**
  - src/routes/fuehrung.rs
  - src/einsatz/repo.rs
  - frontend/src/instanz/Fuehrung*
  - frontend/src/instanz/fuehrung*
  - frontend/src/einsatz/spiegel/SpiegelBand.tsx
herleitung:
  - openspec/changes/archive/2026-11-13-cdel60wv-fuehrung-rueckholen-nach-widerruf/design.md
  - LLH-1850 (mit Ruben am 13.11.2026 abgestimmt), LLH-1704
---

# ADR-0039: Einen Spiegel ohne gekoppelte Führung holt nur ein Mensch zurück

## Regeln

- MUST: Nennt die Akte eines Spiegels eine Instanz, zu der die Org keine geltende, aber eine
  widerrufene Zuordnung einer Standardkopplung hat („Führung beendet“), bleibt der Einsatz
  Spiegel, bis die Einsatzleitung oder ein Admin der Einsatz-Org ihn mit Grund zurückholt
  (`POST …/fuehrung/zurueckholen`, `EinsatzFuehrungszugriff`). Kein Start-, Schalter- oder
  Taktpfad gibt ihn frei.
- MUST: „Führung beendet“ steht genau einmal als SQL-Ausdruck (`fuehrung_beendet_sql!` in
  `fuehrung::repo`); Einsatzkopf und Dienst lesen ihn.
- MUST: Zurückholen und das Rückholen beim Widerruf gehen über `repo::zurueckholen`: nächste
  Epoche, Art Notübernahme, Erklärung ohne Beweis gegen die alte Führung. Bruchstelle des
  Zurückholens ist der jüngste Widerruf.
- MUST NOT: Zurückholen, solange die Org der führenden Instanz zugeordnet ist, oder wenn sie nie
  über eine Standardkopplung verbunden war (409).

## Prüfung

```sh
verlange 'fuehrung_beendet_sql!' src/einsatz/repo.rs
verlange 'fuehrung_beendet_sql!\(\)' src/instanz/fuehrung/repo.rs
verbiete 'dienst::zurueckholen\(' 'src/**/*.rs' ':(exclude)src/routes/fuehrung.rs'
verlange '^pub async fn zurueckholen' src/instanz/fuehrung/repo.rs src/instanz/fuehrung/dienst.rs
verlange '/api/einsaetze/\{id\}/fuehrung/zurueckholen' src/app.rs
```

## Kontext

Seit LLH-1704 ändert ein Widerruf bei ausgeschaltetem Schalter keine Akte (ADR-0021: ohne
Schalter ist die Führung eingefroren). Nach dem Einschalten blieb der Einsatz so gesperrter
Spiegel einer beendeten Kopplung, ohne dass ihn jemand übergeben oder zurückholen konnte.
Selbsttätiges Freigeben beim Start war genau der Fehler aus LLH-1704; ein Hinweis mit gespeichertem
Merker hätte nichts gebracht, was der Bestand nicht schon zeigt.

## Konsequenzen

Der Ausweg braucht keine neue Kopplung mehr, aber einen Menschen mit Grund; Verlauf und
Admin-Spur halten ihn fest. Ein Beweis entfällt, weil die alte Führung nichts mehr prüft. Wird
später wieder mit ihr gekoppelt und hat sie weitergeführt, verwirft sie die Akte wie nach jedem
Widerruf und führt dort weiter.
