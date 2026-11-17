# Proposal

## Why

Im Überblick wiederholen alle drei Zellen des Kennzahlenbands „Führungsstand“ ein Paneel, das
direkt darunter steht. „Offene Aufträge“ und „Meldungen offen“ zeigen dieselben Zahlen aus dem
Modulzähler wie die Abschnitte von „Offene Vorgänge“, „Einsatzabschnitte 4“ dieselbe Zahl wie der
Kopf des Paneels „Einsatzabschnitte“. Das Band ist am Fükw 124 px hoch, am Handy 154 px. Die
Fristen dagegen („Nächste Marken“) stehen in der zweiten Paneelreihe: am Fükw bei y ≈ 1309 bei
900 px Fensterhöhe, am Handy bei y ≈ 2173. Eine überfällige Lagebesprechung oder eine knappe
Auftragsfrist sieht so erst, wer scrollt (LLH-1748, Thema 3 der UI/UX-Analyse vom 12.11.2026).

## What Changes

- Das Kennzahlenband „Führungsstand“ entfällt im Überblick ersatzlos. Aufträge und Meldungen
  (offen, neu, überfällig, Bestätigung überfällig, in Arbeit) zeigt weiter das Paneel „Offene
  Vorgänge“ aus derselben Quelle, die Zahl der Abschnitte der Kopf des Paneels
  „Einsatzabschnitte“. Überfällige Aufträge und Bestätigungen nennt wie bisher die Alarmzeile.
- Die Paneelreihen des Überblicks werden neu geordnet: Reihe 1 „Nächste Marken“ | „Offene
  Vorgänge“, Reihe 2 „Einsatzabschnitte“ | „Entscheidungen der letzten Stunde“. Unter `lg`
  gestapelt folgen die Fristen damit direkt auf Alarmzeile und Startliste.
- Die Beschreibung des Moduls „Überblick“ im Modulmenü lautet „Fristen, Vorgänge,
  Entscheidungen“ statt „Kennzahlen, Fristen, Entscheidungen“, denn eine Kennzahl trägt der
  Überblick danach nicht mehr.
- Unverändert bleiben: das Band „Lage in Zahlen“ im Lagebild samt Einsatzdauer auf Platz 6, der
  Fuß „Einsatzdauer“ des Modulpanels, Inhalt und Zählweise der Paneele und die Alarmzeile. Die
  Einsatzdauer steht seit LLH-1743 nicht mehr dreifach; die Schreibweise („5:00“ gegenüber
  „05:00 h“) klärt LLH-1750.

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `lage-verdichtung`: „Handlungsmengen kommen vom Modulzähler“ nennt die Zahlen des Überblicks
  im Paneel „Offene Vorgänge“ statt in Kennzahlen; „Überblick führt, Lagebild zeigt die Lage“ legt
  fest, dass der Überblick kein Kennzahlenband trägt und die Fristen in der ersten Paneelreihe
  stehen.
- `einsatztauglichkeit-layout`: „Kennzahlenband hält seine Höhe“ gilt nur noch für das Band
  „Lage in Zahlen“.
- `ueberblick-startliste`: das Szenario „Quelle startet mitten in der Sitzung“ nennt die
  Paneelreihen statt des Führungsstands.
- `navigation-zuletzt-besucht`: das Szenario „Kennzahl auf dem Überblick“ wird ein Sprung aus dem
  Paneel „Offene Vorgänge“.
- `modul-benennung`: das Szenario „Lange Beschreibung im Modulpanel“ nennt die neue Beschreibung.

## Impact

- Frontend: `pages/fuehrung/UeberblickPage.tsx` (Band fort, Reihen neu),
  `einsatz/modulRegistry.ts` (Beschreibung), Unit-Tests der Seite.
- e2e: Specs, die das Band „Führungsstand“ oder seine Kennzahl „Offene Aufträge“ ansprechen
  (`kennzahlenband-notizhoehe`, `fugenraster-leerzelle`, `ueberblick-vorgaenge-cls`,
  `ueberblick-startliste`, `lagebesprechung-vorbereitung`, `hellmodus-kontrast`, `pegel-pruefliste`).
- Regeln und Doku: `frontend/AGENTS.md` (Kennzahlenband, Dashboard-Baukasten, Rollen der
  Übersichten), Anwenderkapitel `docs/anwender/kapitel/ueberblick.md` samt Bild, Design System
  (`components/Dashboard/README.md`, `components/Kennzahl/README.md`).
- Kein Backend, keine API, keine Migration, keine gespeicherten Schlüssel.
