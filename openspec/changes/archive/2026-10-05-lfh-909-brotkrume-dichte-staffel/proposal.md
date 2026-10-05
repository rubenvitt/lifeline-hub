# Proposal

## Why

Der Ortspfad im Seitenkopf (die Brotkrume, etwa „Einsätze › Hochwasser › Aufträge/Befehle ›“)
trägt Links, die in jeder Dichtestufe rund 20 px hoch sind. antd setzt den Link auf die
Zeilenhöhe der 12-px-Schrift (`.ant-breadcrumb-item a { height: fontHeight }`), und
`controlHeight` greift dort nicht. In `komfortabel` (48) und `handschuh` (72) liegt der Link
damit weit unter dem Boden, in `kompakt` (30) ebenfalls. Die Spec `einsatztauglichkeit-layout`
nimmt die Brotkrume bisher ausdrücklich aus („Nicht Teil dieser Zusicherung sind die Brotkrume
im Seitenkopf …“), nennt aber keinen Grund. Das Gate 3 lässt sie deshalb aus seinen Locatorn
heraus. Gefunden bei der Messung zu LFH-724.

Mit Handschuh auf dem Tablet ist die Brotkrume der kürzeste Weg zurück: von einer Detailseite
zur Liste, von der Druckansicht zum Modul. Auf dem Handschirm liegt die Rail im Drawer, der
Umweg kostet dort zwei Tipps mehr.

## What Changes

- **Entscheidung: Die Brotkrume folgt der Staffel.** Keine benannte Ausnahme. Jeder Link im
  Ortspfad des Seitenkopfs erreicht die Steuerhöhe der Stufe (30 / 48 / 72 px). Seine Schrift
  bleibt 12 px, sein Ton `schwach`. Die Trefffläche wächst über einen durchsichtigen Rand, nicht über
  größere Schrift.
- **Eine Stelle trägt das für alle Seiten**: der Ortspfad in `EinsatzSeite`. Die rund 45 Seiten,
  die ihre `Breadcrumb` als `ReactNode` hineingeben, bleiben unverändert.
- **Der Hover-Ton bleibt auf der Textzeile.** Die zarte Hinterlegung unter dem Zeiger wächst
  nicht mit dem Rand auf 72 px. Der Fokusring umfährt die ganze Trefffläche.
- **`kompakt` am breiten Schirm bleibt optisch gleich**: der Seitenkopf hält seine 44 px. In
  `komfortabel` und `handschuh` wächst ein Seitenkopf ohne Aktionen auf die Höhe, die er mit
  Aktionen schon heute hat (Knopfhöhe plus Polster der Leiste).
- **Spec**: Die Ausnahme der Brotkrume entfällt, sie kommt in die Liste der Bedienziele.
- **Nachweis**: ein neuer Block im Gate 3 misst die Pfad-Links je Stufe am Fükw und auf dem
  Handschirm. Der Hinweis am Stab-Block („sonst zögen Breadcrumb …“) wird angepasst.
- **Regel**: `frontend/AGENTS.md` nennt den Ortspfad beim handgebauten Bedienziel.

## Capabilities

### New Capabilities
- keine

### Modified Capabilities
- `einsatztauglichkeit-layout`: In der Anforderung „Trefffläche folgt der Dichtestufe“ entfällt
  die Ausnahme der Brotkrume im Seitenkopf. Die Links des Ortspfads gehören zu den genannten
  Zielen, ihre Schrift bleibt 12 px, und der Seitenkopf bleibt in `kompakt` 44 px hoch.

## Impact

- `frontend/src/components/EinsatzSeite.tsx` (`Ortspfad`, neue reine Stilfunktion),
  `frontend/src/components/EinsatzSeite.css`, `frontend/src/components/EinsatzSeite.test.tsx`
- `frontend/e2e/gate3-trefflaeche.spec.ts` (neuer Block, Kommentar am Stab-Block)
- `frontend/AGENTS.md`, Abschnitt „Handgebautes Bedienziel“
- Sichtbar: In `komfortabel` und `handschuh` sind die Pfad-Links großzügig antippbar. Ein
  Seitenkopf ohne Aktionen wird dort etwas höher. Auf dem Handschirm wächst die eigene Zeile des
  Ortspfads mit der Stufe. Kein Backend, keine API, keine Migration.
- **Nicht in diesem Change**: die Brotkrumen über der Verwaltungsseite der Stammdaten
  (Fahrzeug- und Personal-Detail). Sie stehen außerhalb des Seitenkopfs, in einer eigenen Zeile
  über `AdminPage`. Sie sind als eigener Task erfasst (LFH-1047).
