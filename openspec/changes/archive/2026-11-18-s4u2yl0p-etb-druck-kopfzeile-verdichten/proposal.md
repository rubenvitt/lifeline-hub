# Proposal

Zunder: https://zunder.rubeen.dev/#/aufgabe/s4u2yl0p5icigp4lx42mgu4e (LLH-1837)

## Why

Ein ETB-Ausdruck mit 220 Einträgen, davon 165 Systemeinträge, braucht 18 Seiten. Ab Seite 2 steht
außer „Seite 2 von 18“ nichts, was das Blatt einem Einsatz oder Stand zuordnet: ein loses Blatt aus
dem Stapel ist nicht mehr zuordenbar, und das ETB ist eine Beweisunterlage. Die vielen kurzen
Systemeinträge („Einheit alarmiert“, „Dokument abgelegt“) nehmen je eine volle Tabellenzeile ein und
blähen den Ausdruck auf.

## What Changes

- Jede Druckseite des ETB trägt über den Spaltenköpfen eine Laufzeile mit Dokumentart, Einsatz
  (Bezeichnung und interne Nummer, wie im Druckkopf) und Stand (Zeitpunkt und höchste laufende
  Nummer). Sie wiederholt sich wie der Tabellenkopf, also in Chromium und Firefox; WebKit wiederholt keinen
  Tabellenkopf im Druck (LFH-1110) und zeigt sie nur auf Seite 1.
- Systemeinträge stehen im Druck immer verdichtet: eine einzeilige, kleiner gesetzte Zeile an ihrer
  Nummer mit Nr., Zeit und danach „System · Inhalt · Erfasser“ über die übrigen Spalten. Die
  Nummernfolge bleibt lückenlos, Hinweise zu Berichtigung und Nachtrag bleiben.
- Kein Schalter für eine ausführliche Form; der Ausschluss der Systemeinträge (`system=aus`) bleibt
  unverändert.
- Der Druckkopf der ersten Seite, die Seitenzählung im Randfeld und die Regel „kein freier Text im
  `@page`“ bleiben unverändert.

## Capabilities

### New Capabilities

_keine_

### Modified Capabilities

- `etb-druck`: neue Anforderungen „Einsatz und Stand auf jeder Seite“ und „Systemeinträge
  verdichtet“; „Inhalt je Eintrag“ nimmt die verdichtete Form eines Systemeintrags auf.

## Impact

- Frontend: `frontend/src/etb/EtbDruckTabelle.tsx`, `frontend/src/pages/EtbDruckPage.tsx`,
  ggf. `frontend/src/druck/druckansichtSchmal.css` (schmaler Schirm), Tests daneben und
  `frontend/e2e/etb-druck.spec.ts`.
- Regeln: `frontend/src/druck/AGENTS.md`, Abschnitt „ETB-Druck“.
- Anwenderdoku: `docs/anwender/kapitel/drucken-export.md`, Abschnitt zur ETB-Druckansicht.
- Kein Backend, keine API, keine Migration.
