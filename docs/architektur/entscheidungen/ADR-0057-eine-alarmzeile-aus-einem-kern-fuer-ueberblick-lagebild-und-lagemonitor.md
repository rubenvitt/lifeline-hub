---
id: ADR-0057
titel: Eine Alarmzeile aus einem Kern für Überblick, Lagebild und Lagemonitor
status: akzeptiert
datum: 2026-11-16
gilt_fuer:
  - frontend/src/lage/**
  - frontend/src/components/instrument/AlarmZeile.tsx
  - frontend/src/pages/fuehrung/UeberblickPage.tsx
  - frontend/src/pages/lage-dashboard/LageDashboardPage.tsx
  - frontend/src/geraet/LagemonitorPage.tsx
  - src/routes/lagemonitor.rs
  - src/routes/live.rs
  - src/live/mod.rs
herleitung:
  - openspec/changes/archive/2026-11-16-t9jjrajy-alarmzeile-was-brennt/design.md
  - Zunder LLH-1743 (Seitenrollen, Schwelle, Monitor und Form abgestimmt mit Ruben am 16.11.2026)
---

# ADR-0057: Eine Alarmzeile aus einem Kern für Überblick, Lagebild und Lagemonitor

## Regeln

- MUST: Einträge, Folge und Wortlaut der Alarmzeile „Was brennt“ entstehen nur in
  `frontend/src/lage/wasBrennt.ts`. Überblick und Lagebild lesen sie über `useWasBrennt`, der
  Lagemonitor über `alarmAusMonitor`. Regeln dazu: `frontend/AGENTS.md`, „Dashboard-Baukasten“.
- MUST NOT: Eine Seite baut keine eigene Sammlung von Alarmen und zählt keine Alarmzahl aus einer
  Liste (`frontend/AGENTS.md`, „Eine Heimat je Zahl“).
- MUST: Der Block `alarm` der Lagemonitor-Antwort trägt nur Zahlen sowie Namen von Einheiten und
  Abschnitten. Nur der Handler `lagebild` füllt ihn, nie `verdichte`.
- MUST: Präzisiert ADR-0003: Einer Verbindung des gekoppelten Lagemonitors stellt
  `LiveNachricht::fuer_verbindung` das Ereignis `sofortmeldung` ohne das Modul Meldungen zu, mit
  der Nutzlast `{}`. Jedes andere Ereignis filtert weiter `LiveEvent::modul_keys`.
- MUST: Überblick und Lagebild teilen sich keine Kennzahl (`frontend/AGENTS.md`, „Rollen der
  Übersichten“).

## Prüfung

```sh
verlange 'useWasBrennt\(' frontend/src/pages/fuehrung/UeberblickPage.tsx
verlange 'useWasBrennt\(' frontend/src/pages/lage-dashboard/LageDashboardPage.tsx
verlange 'alarmAusMonitor\(' frontend/src/geraet/LagemonitorPage.tsx
verbiete "from '[./]*lage/wasBrennt'" 'frontend/src/pages/**/*.tsx'
verlange 'fuer_verbindung\(' src/routes/live.rs
verlange 'data: "\{\}"\.into\(\)' src/live/mod.rs
verbiete 'alarm: Some' src/routes/lagemonitor.rs
```

## Kontext

Jede Übersicht kannte einen Teil der Lage: das Lagebild Vermisste, der Überblick Rückmeldung
und Ausfall, der Monitor nur die Zahl der Sofortmeldungen. Wer zurückkam, las drei Seiten. Zur
Wahl standen ein Endpunkt `…/alarme` mit einer zweiten Heimat für Rückmeldung und Ausfall im
Server und eine Ableitung im Browser aus den vorhandenen Heimaten; dem Monitor sind die Listen
gesperrt, er bekommt Zahlen vom Server.

## Konsequenzen

Überblick und Lagebild zeigen dieselbe Zeile, weil sie denselben Hook rufen; der Monitor dieselbe
Folge aus Serverzahlen, ohne den Ausfall (LLH-1929). Eine neue Alarmart kommt in `wasBrennt.ts`,
in den Block `alarm` und in `alarmAusMonitor`, an keiner Seite. Der Monitor erfährt eine
Sofortmeldung sofort, ohne Inhalt und ohne Leserecht an Meldungen.
