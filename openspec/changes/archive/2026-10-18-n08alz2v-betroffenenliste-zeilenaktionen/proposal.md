# Proposal

## Why

Rubens App-Durchgang vom 10.10.2026 (Zunder LLH-1018, Subtask LLH-1130): „Betroffenen-Ansicht:
Es lässt sich nichts bearbeiten.“ In der Liste ist heute genau ein Feld schreibbar, der Zustand.
Nachsichten, Verbleib erfassen und Verorten gehen nur über die Detailseite und deren Kopfmenü.
Im MANV wird aber an der Liste gearbeitet: nachsichten, eine Abtransport-Welle buchen, Fundorte
nachtragen. Jeder Seitenwechsel kostet Zeit und Überblick. Außerdem trägt dasselbe Feld
`antreff_ort` zwei Namen, „Fundort“ und „Antreffort“.

## What Changes

- **Sichtung aus der Zeile:**
  - Die Sichtungszelle ist der Auslöser, nach dem Muster der Statusanzeige (`StatusWahl`).
  - Ein Tipp öffnet ein Popover mit `SichtungsWahl` und „Übernehmen“.
  - Der zugängliche Name trägt die Kennung („Sichtung R-007 ändern“).
  - Ein Fehler steht an der Zeile.
- **Verbleib aus der Zeile:** Bei offenem Verbleib zeigt die Zelle „Verbleib erfassen“.
- **Zeilenmenü** mit „Sichten“, „Verbleib erfassen“ und „Auf Lagekarte verorten“; Letzteres mit
  Rückweg aus `pao1s6uw-verorten-rueckweg`. Öffnen bleibt der Zeilenklick.
- **„Nur Lücken zeigen“** führt zu bedienbaren Lücken: In der leeren Zelle steht der Knopf.
- **Live-Zufluss:** Während ein Popover oder Menü offen ist, hält die Liste Menge und Folge.
- **Ohne Schreibrecht** steht „Nur Ansicht · Grund“ über der Liste, die Bedienelemente fehlen.
- **Ein Wort „Fundort“** für das Feld `antreff_ort` bei Personen und Tieren (Entscheidung Ruben
  18.10.). Das gilt in Maske, Detail, Liste, Druck, Karte, Schnellansicht und den
  Aufbewahrungstexten. Wire-Feld und Spalte bleiben `antreff_ort`.

## Capabilities

### New Capabilities
<!-- keine -->

### Modified Capabilities
- `betroffene-lagedaten`: neue Anforderung „Sichtung und Verbleib aus der Betroffenenliste“.
- `betroffene-erfassung`: Die Tiere-Erfassung nennt das Feld „Fundort“.
- `aufbewahrung-kategorien`: Der Personenstamm nennt „Fundort samt Koordinate“.
- `aufbewahrung`: Die pseudonyme Spur nennt „Fundort“.
- `tier-anhaenge`: Die pseudonyme Spur nennt „Fundort“.

## Impact

- Frontend:
  - `personen/personenSpalten.tsx`; die Datei gilt auch für `geraet/GeraetBetroffenePage.tsx`
    und `GeraetPatientenPage.tsx`, die Gerätevarianten laufen über `useGeraetDarf`.
  - `pages/PersonenPage.tsx`, `personen/VerbleibErfassung.tsx`, `components/MenueAusloeser.tsx`.
  - Wortstellen in `AufnahmeFelder.tsx`, `PersonVorschau.tsx`, `PersonenDetailPage.tsx`,
    `aufbewahrung/kategorieText.ts`, `TierePage.tsx`, `TiereDetailPage.tsx` und
    `tiere/TiereDruckTabelle.tsx`.
- e2e: `betroffene-layout.spec.ts`, `betroffene-handy.spec.ts`, Gate 3 bzw. Trefferflächen.
- Doku: Kapitel `betroffene.md` und `tiere.md`, Bild `betroffene/liste.png`.
- Kein Backend.
- Setzt `knc0jyjd-sichtungswahl-flaechen` und `pao1s6uw-verorten-rueckweg` voraus.
- Zunder: https://zunder.rubeen.dev/#/aufgabe/n08alz2v33b99m2gd6sitr1r
