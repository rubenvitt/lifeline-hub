# Proposal

## Why

Im _Lagevortrag zur Information_ lässt sich heute nur die Medienlage aus vorhandenen Daten
füllen („Aus S5 übernehmen“, LFH-554). Kräftemeldebild, Funkplan, Führungsorganisation und
Vorbereitung der Lagebesprechung gehen den umgekehrten Weg und legen je einen eigenen
Freitext-Lagebericht an. Wer einen Lagevortrag vorbereitet, hat danach vier Einzeldokumente
statt eines und tippt die Zahlen von Hand ab. Zudem verschwindet „Aus S5 übernehmen“ ohne
Stab-Freigabe kommentarlos; niemand erfährt, warum der Knopf fehlt.

## What Changes

- **Ein Übernahme-Baustein je Abschnitt.** Der Knopf der Medienlage wird zu einem allgemeinen
  Baustein mit einer festen Zuordnung _Abschnitt → Quelle_ im Code. Die Medienlage ist der erste
  Eintrag; ihr Verhalten bleibt, bis auf die Stand-Zeile und den Hinweis bei gesperrter Quelle.
- **Vier weitere Abschnitte** des _Lagevortrags zur Information_ bekommen einen Knopf
  (je eine Unteraufgabe):
  - **Eigene Lage** (LFH-870): Kräfte und Führungsorganisation in Kurzform.
  - **Besondere (Führungs-)Probleme** (LFH-871): überfällige Aufträge, Meldungen mit
    überfälliger Bestätigung, Lücken im Funkplan.
  - **Gefahren-/Schadenlage** (LFH-872): Betroffene, Vermisste, Sichtung, offene Schäden,
    Warnstufen, Wetterwarnungen und maßgebliche Pegel.
  - **Lageentwicklung** (LFH-873): ETB seit der letzten Lagebesprechung, Abgrenzung nach
    design.md D8.
- **Gleiche Regeln für alle:** nur auf Klick, nur im Schreibzweig, kein stilles Ersetzen,
  Rechteweiche je Quelle („—“ mit Grund, nie 0), kein Personenbezug, Stand (DTG) im Text,
  Zahlen aus denselben Funktionen wie Dashboard und Vorbereitung.
- **Fehlender Knopf erklärt sich:** Ist keine Quelle eines Abschnitts freigegeben, steht dort ein
  Hinweis mit dem Grund statt nichts. Das ändert auch die Medienlage.
- **Bewusst von Hand:** Auftrag, Anträge und Vorschläge, Zusammenfassung sowie der ganze
  _Lagevortrag zur Entscheidung_. Ein Vorbefüllen dort ist eine Folgeentscheidung.
- Die bestehenden Freitext-Übernahmen (Kräfteübersicht, Funkplan, Organigramm, Vorbereitung)
  bleiben unverändert.

Kein Server-, Daten- oder Typänderung; die Vorlagen (`src/lagebericht/mod.rs::VORLAGEN`)
bleiben gleich. Keine **BREAKING**-Änderung.

## Capabilities

### New Capabilities

- `lagevortrag-uebernahme`: Füllen einzelner Abschnitte des Lagevortrags zur Information aus
  vorhandenen Lagedaten, mit gemeinsamen Regeln (Klick, Rückfrage, Rechteweiche, Stand,
  Personenbezug, Zahlengleichheit) und dem Inhalt je Abschnitt.

### Modified Capabilities

- `stab-medienlage`: „Medienlage aus S5 übernehmen“ zeigt ohne Stab-Freigabe einen Hinweis statt
  nichts, und der übernommene Text trägt den Stand.

## Impact

- Frontend: neuer Baustein unter `frontend/src/lageberichte/uebernahme/`,
  `pages/LageberichtDetailPage.tsx` (Einhängen je Abschnitt), `stab/MedienlageUebernahme.tsx`
  geht im Baustein auf, Lagebild-Quellen aus `pages/lage-dashboard/useLagebild.ts` werden als
  gemeinsame Beschreibung herausgezogen, neue reine Textfunktionen je Abschnitt.
- Regeln: `frontend/src/entwurf/AGENTS.md` (Abschnitt „Übernahme in den Lagevortrag“),
  Verweis aus `frontend/src/stab/AGENTS.md`.
- Keine Migration, kein Endpunkt, keine generierten Typen.
