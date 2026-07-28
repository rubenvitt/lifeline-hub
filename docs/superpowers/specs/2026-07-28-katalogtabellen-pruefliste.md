# Prüfliste Einsatztauglichkeit — Katalogtabellen (LFH-329 · B1 / N14)

Gate 7 der Bedien-Leitlinie (`2026-07-25-bedien-leitlinie-einsatzkontexte.md`, Festlegung 7)
verlangt diese Liste an **jeder** umgebauten Seite. Sie wird hier **einmal für die Familie**
geführt, nicht dreizehnmal: die dreizehn Seiten sind formgleich — Kopfaktion, flache Tabelle
über `components/KatalogTabelle.tsx`, Formularmodal — und teilen seit diesem Paket dasselbe
Tabellen-Primitiv. Wo eine einzelne Seite abweicht, steht sie in der Zeile namentlich.

**Umfang:** `stammdaten/` (QualifikationenTab, SprechgruppenTab, FahrzeugeTab, PersonalTab,
StichworteTab, StatusKatalogTab, EtbBausteineTab, MaterialTab, PersonalStatusTab,
EinheitTypenTab), `karten/` (OnlineQuellenVerwaltung, OfflineKartenVerwaltung),
`pages/BenutzerPage.tsx`.

**Was N14 an diesen Seiten geändert hat:** waagerechter Scrollcontainer, stehende Kopfzeile
und fixierte menschenlesbare Identifierspalte — alle drei zentral im Primitiv — sowie vierzehn
feste Feldbreiten in acht Formularen auf die fluide Form (volle Breite bis Obergrenze).
Alles Übrige ist Bestand und wird hier bewertet, nicht angefasst.

Die Liste ist **absichtlich nicht durchgehend grün.** Verdikte: erfüllt / teilweise erfüllt /
offen → Zielticket / nicht anwendbar. „Nicht geprüft" ist kein Verdikt und kommt nicht vor.

| #  | Verdikt               | Beleg / Zielticket                                                                                                                                                                                                                                                                    |
| -- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1  | **teilweise erfüllt** | Zeilen und Kopfaktion tragen die antd-Grundmaße (≥ 24 px Boden erfüllt). Gemessen bleiben aber **26** punktuelle `size="small"` auf interaktiven Elementen in diesen dreizehn Dateien — Aktionslinks in der letzten Spalte liegen damit unter 48 px. Bestand, Abbau ist Auftrag → **B5** |
| 2  | **offen**             | Es gibt heute keine Dichte-Staffel; die Seiten laufen einstufig (kompakt). Der Träger ist ein Dichte-Token am `ConfigProvider`, nicht dieses Paket → **B5 / M28**                                                                                                                        |
| 3  | **teilweise erfüllt** | Der Ladezustand ist sofort sichtbar: alle dreizehn Tabellen reichen `loading` durch (gemessen 13/13), antd zeigt den Spinner vor der Serverantwort. Optimistische Updates gibt es in keiner der dreizehn Seiten (Baseline 0) → **B6**                                                     |
| 4  | **erfüllt**           | Jede löschende/deaktivierende Aktion sitzt hinter einem `Popconfirm` — gemessen 12 von 13 Dateien; `StichworteTab` hat als einzige **keine** löschende Aktion und braucht folglich keine zweite Handlung                                                                                  |
| 5  | **erfüllt**           | Farbwerte kommen ausschließlich aus `theme/tokens.ts` / `theme/rollen.css`; N14 führt keinen eigenen Farbwert ein (`theme/gate5.guard.test.ts` deckt das repoweit ab). Die A0-Messungen gelten unverändert                                                                               |
| 6  | **erfüllt**           | Jede Statusplakette trägt Text als zweiten Kanal — gemessen an allen `<Tag>`-Stellen der dreizehn Dateien: „in Dienst"/„außer Dienst", „aktiv"/„deaktiviert", „Admin"/„Führungskraft"/„Benutzer". Keine Plakette ohne Beschriftung                                                        |
| 7  | **erfüllt**           | Palette unverändert aus A0; gesättigte Farbe nur an abnormen Zuständen, die Grundfläche ist weder reines Schwarz noch reines Weiß. N14 vergibt keine Farbe neu                                                                                                                           |
| 8  | **offen**             | Es gibt in der Anwendung keinen Helligkeits-/Kontrastregler. A0 verweist ihn ausdrücklich weiter → **eigener Folge-Task** („Was diese Leitlinie nicht entscheidet")                                                                                                                       |
| 9  | **nicht anwendbar**   | Die Katalogseiten führen keine kritische Anzeige. Sie verwalten Stammdaten im Vorfeld der Lage; das Blickfeld-Kriterium zielt auf Lage- und Alarmflächen                                                                                                                                |
| 10 | **nicht anwendbar**   | Die Katalogseiten erzeugen keine Alarme — sie zeigen und pflegen Katalogeinträge                                                                                                                                                                                                        |
| 11 | **nicht anwendbar**   | Kein Warnverhalten auf diesen Seiten: kein Blinken, kein Ton, keine Eskalation. Fehlerzustände erscheinen als Text (`Alert`, `message`)                                                                                                                                                 |
| 12 | **nicht anwendbar**   | Es gibt hier keine Live-Einschübe: alle dreizehn Seiten laden über `globalKeys` und hängen damit **nicht** am SSE-Fan-out je Einsatz (gemessen). Datensätze erscheinen nur nach eigener Mutation, nie unter dem Cursor eines anderen                                                     |
| 13 | **offen**             | Genau dieses Paket zieht eine **fixierte Kopfzeile und eine fixierte erste Spalte** ein — die Konstrukte, auf die WCAG 2.4.11 zielt. Ein Tab-Durchlauf hinter beiden ist nicht gemessen; die Zusicherung „Fokusziel nie vollständig verdeckt" ist damit offen → **B2**                    |
| 14 | **teilweise erfüllt** | Drei der vier Anforderungen erfüllt und maschinell gepinnt: fixierte Kopfzeile ✓, fixierte **menschenlesbare** Identifierspalte ✓ (gegen die DB-Kennung steht eine DEV-Warnung im Primitiv), keine Auflösung in Karten ✓ (der Scrollcontainer ist der Regelweg aus A1, Festlegung 2). Der **umschaltbare Spaltensatz mit Zähler ausgeblendeter Spalten fehlt** — die dreizehn Tabellen tragen höchstens sieben Spalten, alle sichtbar → **B2 / B5** |
| 15 | **teilweise erfüllt** | Labels stehen über dem Feld (gemessen: 14× `layout="vertical"` in diesen Bereichen) ✓; volle Tastaturbedienung über antd-`Form` ✓; die Felder sind seit N14 fluid statt fest ✓. **„Speichern und nächsten anlegen" mit gehaltenem Kontext fehlt** in allen dreizehn Formularmodalen, und Defaults sind nur teilweise vorbelegt → **B5**                                    |

## Belege

Maschinell gepinnt sind die Zeilen 5, 6 (Text als zweiter Kanal, im Bestand belassen), 12 und 14:

- `frontend/src/components/KatalogTabelle.test.tsx` — Kernvertrag des Primitivs (stehende
  Kopfzeile, genau eine fixierte Kopfzelle, wirkender Scrollcontainer), Durchreiche ohne
  Überschreiben einer gesetzten Fixierung, DEV-Warnung gegen die DB-Kennung in der ersten Spalte.
- `frontend/src/components/katalogTabelle.guard.test.ts` — Inventar: alle dreizehn Seiten laufen
  über das Primitiv, keine bindet antd direkt ein, nur das Primitiv setzt den Scrollcontainer.
- `frontend/src/components/feldbreiten.guard.test.ts` — keine feste Pixelbreite mehr an einem
  Eingabefeld der vier Verwaltungsbereiche; die zwei zugelassenen Nicht-Felder sind benannt.
- `frontend/e2e/katalogtabelle-schmal.spec.ts` — die einzige Ebene, die Layout rechnet: bei
  390 px scrollt die Tabelle in sich, der Tabellenrahmen bleibt im Schirm, Kopfzeile und
  Identifierspalte stehen (`position: sticky`, gegen einen wirklich gescrollten Schirm geprüft).

## Was offen bleibt und wohin es geht

Die Zeilennummern sind hier absichtlich als `Z…` geschrieben: das Gate zählt die Zeilen der
Prüfliste über ihre führende Nummer, und eine Zusammenfassung im selben Format zählte doppelt.

| Zeile   | Offener Punkt                                                 | Zielticket |
| ------- | ------------------------------------------------------------- | ---------- |
| Z1, Z2  | 26 punktuelle `size="small"`, keine Dichte-Staffel             | B5         |
| Z3      | keine optimistischen Updates                                   | B6         |
| Z8      | kein Helligkeits-/Kontrastregler                               | Folge-Task |
| Z13     | Fokus hinter fixiertem Kopf / fixierter Spalte nicht gemessen  | B2         |
| Z14     | Spaltenschalter mit Zähler ausgeblendeter Spalten              | B2 / B5    |
| Z15     | „Speichern und nächsten anlegen", vorbelegte Defaults          | B5         |
