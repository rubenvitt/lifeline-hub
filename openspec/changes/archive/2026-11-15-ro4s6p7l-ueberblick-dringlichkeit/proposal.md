# Proposal

Zunder: https://zunder.rubeen.dev/#/aufgabe/w744ma23f71t72uhd5ebm86z (LLH-1740) und
https://zunder.rubeen.dev/#/aufgabe/vy3t2c4kbypb6kyclajwfmy5 (LLH-1749), beide Teil von LLH-1717
„Was brennt“, Welle 1. Gemeinsame Change, weil beide die Fähigkeit `ueberblick-offene-vorgaenge`
ändern.

## Why

- **LLH-1740:** Eine frische Sofortmeldung („zwei Personen eingeschlossen“) erhöht im Überblick nur
  den Zähler. Die Liste „Meldungen“ zeigt weiter die drei ältesten; erst nach Ablauf der
  Bestätigungsfrist (5 min) steht die Sofortmeldung rot oben. Die Priorität steht nie in der Zeile.
  Die Sortierung kennt nur „Bestätigung überfällig → neu → älteste zuerst“. Das Modul Meldungen
  ordnet dagegen nach Priorität.
- **LLH-1749:** Dieselbe Erinnerung heißt auf derselben Seite „fällig“ (gelb, Offene Vorgänge) und
  „überfällig“ (rot, Nächste Marken). Wort und Ton haben keine gemeinsame Quelle.

## What Changes

- Der Abschnitt „Meldungen“ der Offenen Vorgänge ordnet nach Dringlichkeit: **Bestätigung
  überfällig → Sofort → Dringend → übrige**. Sofort und Dringend stehen ab Eingang dort, jeweils die
  neueste zuerst; die übrigen bleiben „neu vor gelesen, älteste zuerst“.
- Eine Sofort- bzw. dringende Meldung trägt in ihrer Zeile das Wort **„SOFORT“** (Alarmrolle) bzw.
  **„DRINGEND“** (Achtungsrolle). „Bestätigung überfällig“ geht als Wort vor. Die Alarmkante links
  bleibt den alarmierten Einträgen vorbehalten.
- Eine fällige Erinnerung heißt im Überblick an beiden Stellen **„fällig“** in der **Achtungsrolle**:
  im Abschnitt „Erinnerungen“ und in den „Nächsten Marken“. „überfällig“ in Rot bleibt Fristen mit
  Soll-Charakter (Aufträge, Nachforderungen, Ablösungen). Wort und Ton kommen aus einer Funktion.
- Unverändert: Zähler (Modulzähler), Deeplinks, die Folge der übrigen Abschnitte, die Ansicht im
  Modul Meldungen und die Erinnerungskarte im Modul Erinnerungen (siehe design.md, Entscheidung 4).

## Capabilities

### New Capabilities

(keine)

### Modified Capabilities

- `ueberblick-offene-vorgaenge`: Requirement „Einträge nach Dringlichkeit mit Deeplink“ bekommt die
  Prioritätsstufe der Meldungen und die Etiketten SOFORT/DRINGEND; neues Requirement für den
  einheitlichen Zustand einer fälligen Erinnerung in Abschnitt und Marke.

## Impact

- Frontend: `pages/fuehrung/offeneVorgaenge.ts` (`vorgangsMeldungen`),
  `pages/fuehrung/OffeneVorgaengePaneel.tsx` (Wort der Meldungszeile, Erinnerungszeile),
  `pages/fuehrung/ueberblickDaten.ts` (`markenBewertung`), neue reine Funktion unter
  `erinnerung/`; Tests `offeneVorgaenge.test.ts`, `ueberblickDaten.test.ts`,
  `OffeneVorgaengePaneel`/`UeberblickPage`-Tests.
- Anwenderdoku `docs/anwender/kapitel/ueberblick.md` (Offene Vorgänge, Nächste Marken).
- Kein Backend, keine API, keine Migration.
