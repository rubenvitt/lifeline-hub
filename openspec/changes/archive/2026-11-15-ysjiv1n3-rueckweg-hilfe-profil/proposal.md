# Proposal

Zunder: https://zunder.rubeen.dev/#/aufgabe/ysjiv1n3wulbeedd3g9n5y0w (LLH-1731, Teil von
LLH-1715 „Rahmen: Einsatz-Identität, fester Rahmen, Navigation“)

## Why

Wer im Einsatz das Benutzermenü nutzt, verlässt den Einsatzrahmen: Rail und Einsatzname
verschwinden. Profil und Benachrichtigungen führen schon „Zurück zu <Einsatz>“ (LFH-954), die
Neuigkeiten nicht, und die Hilfe bietet nur „Zur App“, das fest auf die Einsatzliste führt, obwohl
sie weiß, aus welchem Modul sie geöffnet wurde. Am Fükw-Rechner liest man die Hilfe außerdem gern
neben dem laufenden Einsatz; heute nimmt sie ihm den Tab und mit ihm die Live-Alarme.

## What Changes

- Ein Rückweg für alle Seiten, die das Benutzermenü außerhalb des Einsatzes öffnet: Profil,
  Benachrichtigungen, Neuigkeiten und Hilfe tragen „Zurück zu <Einsatz>“ an die zuletzt geöffnete
  Stelle des Einsatzes, unter derselben Bedingung wie bisher auf Profil (gemerkter Einsatz aktiv
  und in der Liste der Person).
- Neuigkeiten bekommt den Seitenkopf der Ebene 1 mit Ortspfad „Einsätze › Neuigkeiten“.
- Die Hilfe ersetzt „Zur App“: mit Rückweg „Zurück zu <Einsatz>“, sonst „Zu den Einsätzen“.
  „Zum Gerät“ und „Zur Anmeldung“ bleiben.
- Aus dem Benutzermenü im Einsatz öffnet die Hilfe ab breitem Schirm (`lg`) in einem neuen Tab
  bzw. im Nebenfenster der Desktop-App; der Einsatz bleibt im ersten Tab offen. Darunter und
  außerhalb des Einsatzes öffnet sie wie bisher im selben Tab.
- Die Herkunft für den Rückmeldeweg (LLH-1642) geht im neuen Tab nicht verloren.

Keine Überlagerung (Drawer/Modal) und keine Seiten im Einsatzrahmen: beides wurde am 15.11.2026
verworfen (design.md, „Verworfen“).

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `seiten-orientierung`: Die Anforderung „Rückweg von Profil und Verwaltung“ gilt auch für
  Benachrichtigungen, Neuigkeiten und Hilfe; die Hilfe nennt ihre Rückwege.
- `benutzermenue`: Die Hilfe öffnet aus dem Einsatz ab breitem Schirm in einem neuen Tab; der
  Rückmeldeweg behält dort die Herkunft.

## Impact

- Frontend: `components/AppLayout.tsx`, `components/ebene1Seite.ts`, `components/BenutzerMenu.tsx`,
  `hilfe/HilfePage.tsx`, `neuigkeiten/NeuigkeitenPage.tsx`, ein neuer geteilter Hook in `einsatz/`.
- Desktop-Hülle: keine Änderung; `window.open` mit eigener Origin öffnet dort schon ein
  Nebenfenster (`src-tauri/src/links.rs`).
- Anwenderdoku: `docs/anwender/kapitel/einsatz-oberflaeche.md`, `docs/anwender/kapitel/rueckmeldung.md`.
- Kein Backend, keine Migration, kein Wire-Feld.
