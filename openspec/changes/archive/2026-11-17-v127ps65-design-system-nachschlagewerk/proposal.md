# Proposal

Zunder: https://zunder.rubeen.dev/#/aufgabe/v127ps65v0nmpylnfjtb8fii (LLH-1807, Teil von LLH-1724)

## Why

Wer eine neue Seite entwirft, mit `/design` oder im Code, findet im Design System „Lifeline Hub“ keine Antwort auf die erste Frage: „Welchen Baustein nehme ich?“

- **Fehlende Karten:** Die 29 Karten zeigen Fachbausteine, aber keinen Knopf, kein Eingabefeld, keinen Dialog, keine Zustände, keinen Hinweis, keinen Seitenkopf, kein Formularlayout und keine vollständige Tabelle.
- **README als Regelhistorie:** Sie ist mit 663 Zeilen und 121 Ticketverweisen eine Regelhistorie, kein Nachschlagewerk.

Die Folge: Ein Entwurf baut Grundformen nach, statt sie zu nehmen. Das ist der Kern von LLH-1724: Bausteine sollen das System tragen, nicht Regeltext.

## What Changes

- Ein neuer Abschnitt **„Bausteinwahl“** in `frontend/AGENTS.md` ordnet als kurze Tabelle zu: Bedarf → Baustein → Karte. Er deckt Darstellen, Rahmen, Rückmeldung und Eingabe ab. Die Zeilen zu Umschalten und Bearbeiten trägt `gyidpati-wann-was-umschalten-bearbeiten` im selben Branch nach.
- **README des Design Systems:**
  - Sie beginnt mit der Bausteinwahl, danach folgen nur die Gestaltungsregeln.
  - Spiegelstriche ohne Gestaltungsbezug (Abläufe, Modulstruktur, Datenherkunft) fallen weg.
  - Ticketnummern, Spec- und Herleitungsverweise filtert der Generator beim Erzeugen heraus. In `frontend/AGENTS.md` bleiben sie stehen.
- **Neue Karten aus den echten Bausteinen:** Knopf, Eingabefeld, Dialog (Erfassungsmaske), Zustände (Laden, Leer, Fehler auf Seite und Paneel), Hinweis, Seitenkopf, Formularlayout (Formularpaneel mit Speicherleiste). Die Karte „Tabelle“ wird zur vollständigen Tabelle mit Suche, Spaltenschalter, Zeilen und Zeilenmenü. Die Karte „Navigation“ (Leiste und Modulpaneel) kommt dazu, wenn ihre Vorschau ohne den nachgebauten Einsatzrahmen auskommt; sonst wird sie eine Folgeaufgabe.
- **Kein eigener Drawer:** Die UI-Form-Leitlinie lässt den Drawer nur für die Navigation zu, deshalb bekommt er keine Karte.
- **Abdeckungsprüfung:** Ein Wächter stellt sicher, dass jede Karte in der Bausteinwahl steht und jeder dort genannte Baustein eine Karte hat.

## Capabilities

### New Capabilities

(keine)

### Modified Capabilities

- `design-system-artifact`: Die README gibt die Gestaltungsregeln ohne Ticket- und Herleitungsverweise wieder und beginnt mit der Bausteinwahl. Neu ist die Anforderung, dass die Bausteinwahl und die Karten deckungsgleich sind. Dazu kommt die Mindestmenge der Grundbausteine, die als Karte vorliegen.

## Impact

- `frontend/AGENTS.md`: neuer Abschnitt „Bausteinwahl“.
- Generator `frontend/scripts/design-system/`: `readme.ts` (Reihenfolge, Filter, Auslassungen) und `previews.tsx` (neue Karten, Höhen gemessen in Chromium).
- Tests `frontend/src/designSystem.test.ts` und `designSystem.guard.test.ts`.
- Erzeugt: `docs/design/design-system/project/` (README, neue `components/<Karte>/`).
- Neue ADR. Nach dem Merge wird das Design System neu veröffentlicht.
- Keine Änderung an Bausteinen der App, keine sichtbare Änderung in der App.
