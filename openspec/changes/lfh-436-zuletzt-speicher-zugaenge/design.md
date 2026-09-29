# Design

## Context

Siehe `proposal.md`, Abschnitt Why. Bestand: `frontend/src/einsatz/zuletztModule.ts` speichert
eine String-Liste unter `lfh:nav:zuletzt:<einsatzId>`. Geschrieben wird von drei Stellen:
`EinsatzLayout.onModulKlick` (Panel und Drawer) sowie `useBefehle.merkeBesuch`, das als
`k.merkeModulBesuch` an `baueBefehle` geht (Gruppen „Zuletzt" und „Module"). Gelesen wird nur
von `useBefehle`, bei jedem Render. `modulAusPfad(pathname)` in `modulRegistry.ts` löst einen
Pfad zu seinem Modul auf. Die Gegenaussage zum Rail-Sprung gibt es schon:
`EinsatzLayout.test.tsx`, „merkt den Rail-Sprung NICHT, obwohl er navigiert".

Warum welche Zugänge aufzeichnen (Abnahmekriterium 1):

| Zugang | Aufzeichnen? | Warum |
|---|---|---|
| Panel, Drawer, Palette „Module"/„Zuletzt" | ja (Bestand) | Jemand wählt genau dieses Modul. |
| Führung · Überblick | ja, neu | Startseite (`redirectZiel`). Jede Kennzahl, jede Zeile und jeder Knopf ist eine Wahl mit Ziel, und das ist im Betrieb der häufigste Weg in ein Modul. |
| Lage-Dashboard | ja, neu | Gleiche Bauart wie der Überblick (Kennzahlen, Paneel-Links), eine Wahl mit Ziel. |
| Palette-Schnellaktionen | ja, neu | Ein Griff führt in genau ein Modul. Gemerkt wird das Modul, nicht die Aktion; die Aktion steht schon im Befehls-Gedächtnis (`ausgefuehrt:`). Die beiden Zeilen haben verschiedene ids und Bezeichnungen, es entsteht also keine Dublette. |
| Rail-Sprung | nein | Leitet in das erste Modul einer Kategorie. Drei Rail-Klicks überschrieben sonst die ganze Liste (LFH-337). |
| Einsatz-Switcher / Standardmodul | nein | Eine Ankunft: das Ziel bestimmt `standard_modul`, nicht die Person. Sonst stünde das Startmodul bei jedem Einstieg vorn. |
| Deep-Link von außen, neuer Tab | nein | Es gibt keinen Klick in der App. Ein Routen-Effekt brächte die Rail-Erosion zurück. |
| Querverweise in Modulinhalten | nein (User, 29.09.2026) | Der Sprung folgt einem Datensatz, nicht einer Modulwahl. Ein seitenweiter Klickfänger wäre zudem schwer abzugrenzen. |

## Goals / Non-Goals

**Goals:**

- Eine Aufzeichnungsstelle je Seite, die sich nicht still umgehen lässt: Links **und**
  `navigate()`-Knöpfe laufen über denselben Helfer.
- Die Frist und die Benutzertrennung stecken im Speichermodul, nicht bei den Aufrufern.

**Non-Goals:**

- Kein Server-Speicher (verworfen: Whitelist-Eintrag plus Codegen für drei Einträge).
- Keine Kennzeichnung des Alters in der Palettenzeile. Die Frist macht das überflüssig.
- Kein Aufräumen verwaister Schlüssel im alten Format (je Einsatz ein paar Byte).

## Decisions

**D1 Speicherformat.** Neuer Schlüssel `lfh:nav:zuletzt:<benutzerId>:<einsatzId>`, der Wert
ist `[{ "key": string, "at": number }]` (Millisekunden seit Epoch), jüngstes zuerst, höchstens 3.
Die Signaturen lauten `merkeModulBesuch(benutzerId, einsatzId, modulKey, jetzt = Date.now())` und
`leseZuletztModule(benutzerId, einsatzId, jetzt = Date.now())`. Das Lesen filtert Einträge mit
`jetzt - at > ZULETZT_FRIST_MS` (12 h) heraus, ebenso Einträge mit falscher Form. `jetzt` als
Parameter macht die Frist ohne Fake-Timer testbar.
*Alternative:* Zeitstempel für die ganze Liste statt je Eintrag. Verworfen, weil dann eine
einzige frische Wahl zwölf Stunden alte Einträge mit am Leben hielte.
*Alternative:* das alte Format migrieren. Verworfen: es trägt keinen Benutzer, jede Zuordnung
wäre geraten. Ein String im Array fällt durch die Formprüfung, also bleibt die Liste leer.

**D2 Ohne Benutzer kein Speicher.** Ist `benutzer` null (Sitzung lädt noch), schreibt und liest
nichts. Das ist kein Fehlerfall, denn zu diesem Zeitpunkt ist der Einsatz-Rahmen noch nicht
bedienbar.

**D3 Ein Helfer je Seite: `useModulWahl()`** in `einsatz/useModulWahl.ts`. Er liest
`benutzer` aus `useAuth`; den Einsatz nimmt er aus dem ZIEL (`einsatzIdAusPfad`), nicht aus der
aktuellen Route, denn gemerkt wird in dem Einsatz, in den die Wahl führt. Er liefert:

- `merkeZiel(pfad)` löst den Pfad ohne Query über `modulAusPfad` auf. Liefert das kein Modul
  (etwa die Brotkrume `/einsaetze`), passiert nichts.
- `waehle(pfad)` ruft `merkeZiel(pfad)` und danach `navigate(pfad)`. Es ersetzt `navigate` an
  den Knöpfen von Überblick und Lage-Dashboard (Kopfknöpfe, Leer-Aktionen, Paneel-Links).
- `beiLinkKlick` ist ein `onClickCapture` für die Seitenwurzel. Er sucht
  `event.target.closest('a[href]')`, nimmt die `pathname` des `href` und ruft `merkeZiel`.
  Damit sind alle `<Link>`-Ziele der Seite abgedeckt (Kennzahl `ziel`, Zeilenziele,
  Abschnittszeilen), ohne jede Komponente einzeln zu verdrahten. Auch Strg/⌘-Klick in einen
  neuen Tab zählt, denn die Wahl ist dieselbe.

*Alternative:* ein `onKlick`-Prop an `Kennzahl` und an jedem Zeilenziel. Verworfen, weil ein
künftig ergänzter `<Link>` dann still nicht aufzeichnete. Der Fänger ist auf die zwei Seiten
beschränkt und nicht layoutweit (die Querverweise in Modulinhalten bleiben draußen, s. Context).
*Alternative:* aufzeichnen beim Bauen der Pfade in `routing/deeplinks.ts`. Verworfen, weil das
schon beim Rendern des `href` feuerte und nicht beim Klick.

**D4 Schnellaktionen:** `sprungZu(ziel, k.navigate, () => k.merkeModulBesuch?.(a.modulKey))`
in `befehle.ts`, wie bei den Gruppen „Module" und „Zuletzt".

**D5 Bestehende Schreiber** (`EinsatzLayout.onModulKlick`, `useBefehle.merkeBesuch`) reichen
`benutzer.id` mit durch. Das Lesen in `useBefehle` bleibt beim Render, der Memo-Schlüssel wird
um den Benutzer erweitert. Der Hinweis in `ModulPanel.tsx` („der Speicher bleibt für die
Kommandopalette") stimmt weiter und bleibt.

**D6 Hülle mit `display: contents`.** Der Fänger sitzt an einem `<div>` um `EinsatzSeite`. Mit
`display: contents` erzeugt die Hülle keine Box und ändert das Layout nicht; ein Prop an
`EinsatzSeite` hätte die geteilte Seitenhülle für zwei Aufrufer erweitert.

## Risks / Trade-offs

- [Die Frist greift nur beim Lesen: eine Palette, die über die 12-h-Grenze offen bleibt, zeigt
  den Eintrag bis zum nächsten Render] → hinnehmbar, der nächste Tastendruck rendert neu.
- [Anker in Portalen (Dropdown-Menüs im `body`) liegen außerhalb des DOM-Teilbaums der Seite]
  → React-Events blubbern durch den React-Baum, auch aus Portalen; der Fänger sieht sie. Das
  `closest('a[href]')` läuft auf dem DOM-Ziel und findet den Anker auch dort.
- [Nach dem Update ist die Liste leer] → eine Abkürzungsliste, kein Datenverlust.

## Migration Plan

Keine: das alte Format wird still ignoriert (D1). Rückbau durch Revert, die alten Schlüssel
liegen dann wieder unangetastet vor.
