# Proposal

## Why

LFH-870 macht aus „Aus S5 übernehmen“ einen allgemeinen Übernahme-Baustein und bindet „Eigene
Lage“ an (Change `lfh-870-eigene-lage-uebernahme`, freigegeben am 04.10.2026). Drei weitere Abschnitte des _Lagevortrags
zur Information_ füllt der Vortragende weiter von Hand, obwohl die Zahlen im System stehen:
Führungsprobleme, Gefahren-/Schadenlage und Lageentwicklung. Heute schreibt er sie aus
Dashboard, Vorbereitung, Funkplan und ETB ab.

## What Changes

Drei neue Quellen für den Baustein aus LFH-870, je eine Unteraufgabe:

- **Besondere (Führungs-)Probleme** (LFH-871): überfällige Aufträge, Meldungen mit überfälliger
  Bestätigung, noch nicht gesichtete Meldungen und die Lücken des Funkplans.
- **Gefahren-/Schadenlage** (LFH-872): Betroffene, Vermisste, Sichtung, offene Schäden,
  höchste Warnstufe, Wetterwarnungen, aktuelle Bedingungen und maßgebliche Pegel.
- **Lageentwicklung** (LFH-873): ETB seit der letzten Lagebesprechung, Abgrenzung nach
  design.md D5.

Dazu:

- **Eine Zusammenstellung des Lagebilds:** Die Liste der Lagebild-Quellen wird aus
  `useLagebild` herausgezogen und von einem Lade-Pfad für den Klick mitbenutzt. Dashboard,
  Vorbereitung und Lagevortrag rechnen dann aus derselben Zusammenstellung.
- **Keine Daten Dritter und kein Freitext** aus Auftrags-, Meldungs- und ETB-Feldern im
  übernommenen Text. Namen eigener Kräfte sind wie in LFH-870 kein Ausschlussgrund; diese drei
  Abschnitte brauchen aber keine.
- **Bewusst von Hand:** Auftrag, Anträge und Vorschläge, Zusammenfassung sowie der ganze
  _Lagevortrag zur Entscheidung_ (Folgeentscheidung).

Die Change setzt auf LFH-870 auf und wird erst umgesetzt, wenn LFH-870 auf `alpha` ist. Es gibt
keine Server-, Daten- oder Typänderung und keine **BREAKING**-Änderung.

## Capabilities

### New Capabilities

(keine)

### Modified Capabilities

- `lagevortrag-uebernahme` (entsteht mit LFH-870): neue Anforderungen für den Inhalt von
  Führungsproblemen, Gefahren-/Schadenlage und Lageentwicklung, für die Zahlengleichheit mit
  Dashboard, Vorbereitung und Funkplan und für den Ausschluss von Freitext.

## Impact

- Frontend: drei Quelldefinitionen in `lageberichte/uebernahmen.ts` (Baustein aus LFH-870) mit
  reinen Textfunktionen. `pages/lage-dashboard/useLagebild.ts` bekommt eine gemeinsame
  Quellbeschreibung und den Lade-Pfad `ladeLagebasis`. `stab/funkplan.ts` stellt die
  Lücken-Zeilen bereit, `stab/vorbereitung.ts` seine Formatierer.
- Regeln: Ergänzung des Abschnitts zum Baustein in `frontend/src/entwurf/AGENTS.md`.
- Keine Migration, kein Endpunkt, keine generierten Typen.
