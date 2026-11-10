## Why

Seit LLH-1596 öffnet ein Rechtsklick auf eine Zeile der `Datensicht` das Kontextmenü des
Datensatzes. Die Verwaltungstabellen in Stammdaten, Einstellungen und Benutzer und einige Listen
zeichnen ihr ⋮-Menü aber selbst, außerhalb der `Datensicht`; dort erscheint weiter das
Browsermenü. Wer am Fükw-Rechner zwischen Material im Einsatz und Material in den Stammdaten
wechselt, findet dieselbe Geste einmal mit und einmal ohne Wirkung. Diese Change zieht die übrigen
Tabellen und Listen mit eigenem ⋮ nach (Stufe 2 von LLH-1590, abgestimmt mit Ruben am 09.11.2026).

Zunder: https://zunder.rubeen.dev/#/aufgabe/lor2qhepixwgsq9ghfhn5n0i (LLH-1599, Eltern LLH-1590)

## What Changes

- **Kontextmenü an Verwaltungstabellen (`KatalogTabelle`):** Schichtmodelle, Externe Stellen,
  Sprechgruppen, Verpflegungsplan, Benutzer und die Dienststatus-Spalte in Fahrzeuge, Personal und
  Material der Stammdaten. Rechtsklick, langer Druck und die Tasten öffnen dort das Menü mit den
  Aktionen der Zeile.
- **Auf jeder Breite:** Wo die Tabelle breit Knöpfe zeigt (Bearbeiten, Deaktivieren, Außer Dienst
  nehmen …) und nur schmal ein ⋮, zeigt das Kontextmenü auf jeder Breite dieselben Aktionen wie
  Knöpfe bzw. ⋮.
- **Listen und eigene Zeilen:** Pegel, Geräte und Lagemonitor-Zugänge in den Einsatz-Einstellungen,
  Personen in Fahrzeuge/Besatzung einer Einheit.
- **Bild-Hintergründe der Lagekarte:** nur die Kopfzeile (Name und ⋮) trägt das Kontextmenü, nicht
  Schalter, Deckkraft-Regler und Ansichts-Auswahl darunter.
- **Kommunikationsplan:** gepflegte Stellen bekommen das Kontextmenü mit „+ Verbindung“ oben, dann
  den Einträgen des ⋮. Ohne Netz stehen alle Einträge gesperrt, wie der Knopf und das ⋮.
- **Eine Quelle:** Die `KatalogTabelle` bekommt ein optionales `zeilenMenue`, aus dem ⋮-Spalte und
  Kontextmenü gespeist werden. Die Verwaltung des offenen Menüs zieht aus der `Datensicht` in einen
  gemeinsamen Hook, den Tabelle, Listen und `Datensicht` teilen.
- **Personen** (Betroffene im Einsatz) haben das Kontextmenü schon über die `Datensicht`; hier kommt
  nur ein Test dazu.
- **Nicht in dieser Change:** Detailköpfe („Weitere Aktionen zu …“, bewusst ohne Kontextmenü),
  ETB (LLH-1597), Chat und Karten (LLH-1598), Schichtplan-Raster (LLH-1600), Gliederung (LLH-1601).

## Capabilities

### New Capabilities

(keine)

### Modified Capabilities

- `datensatz-aktionsmenue`: Das Kontextmenü zeigt auch dort dieselben Aktionen, wo sie breit als
  Knöpfe statt hinter ⋮ stehen, und eine gesperrte Primäraktion steht darin gesperrt. Ein
  Datensatz, dessen Zeile Regler oder Schalter trägt, nimmt das Kontextmenü nur an seiner Kopfzeile.

## Impact

- Frontend:
  - neu `components/useDatensatzKontextMenue.tsx` (Zustand des offenen Menüs, `KontextMenue`,
    Schließen bei Wegfall), herausgezogen aus `components/Datensicht.tsx`;
  - neu `components/ZeilenMenueAusloeser.tsx` (⋮ aus einem `zeilenMenue`);
  - geändert: `components/KatalogTabelle.tsx` (`zeilenMenue`), `components/Datensicht.tsx`
    (Hook, `PrimaerAktion.gesperrt`), `components/datensichtKontext.ts`;
  - Seiten: `stammdaten/SchichtmodelleTab.tsx`, `ExterneStellenTab.tsx`, `SprechgruppenTab.tsx`,
    `VerpflegungsplanTab.tsx`, `dienststatus.tsx`, `FahrzeugeTab.tsx`, `PersonalTab.tsx`,
    `MaterialTab.tsx`; `pages/einstellungen/EinsatzPegel.tsx`, `EinsatzGeraete.tsx`,
    `LagemonitorZugaenge.tsx`; `pages/BenutzerPage.tsx`; `pages/einheit/FahrzeugeBesatzung.tsx`;
    `pages/lagekarte/BildHintergruende.tsx`; `pages/KommunikationsplanPage.tsx`.
- Regeln: `frontend/AGENTS.md`, „Kontextmenü nur über den Baustein“.
- Doku: Anwenderkapitel, soweit sie Aktionen an Zeilen der betroffenen Seiten beschreiben.
- Kein Backend, keine Migration, kein Vertrag.
