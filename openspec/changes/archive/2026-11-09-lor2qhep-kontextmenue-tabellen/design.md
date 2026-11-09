## Context

LLH-1596 hat den Baustein gelegt (archivierte Change `om9oxxiq-kontextmenue-baustein`):
`components/useKontextMenue.ts` meldet Rechtsklick, langen Druck und Tasten, `KontextMenue.tsx`
zeigt `MenueEintrag[]` am Fensterpunkt, und die `Datensicht` bindet beides an Zeilen und Karten
an. Der Zustand des offenen Menüs (welcher Schlüssel, wo, Fokus vorher), das Nachschlagen der
Zeile je Render und das Schließen, wenn die Zeile oder ihre Einträge wegfallen, stehen dort fest
in `Datensicht.tsx` (Abschnitt „Kontextmenü“, rund 30 Zeilen).

Außerhalb der `Datensicht` zeichnen 12 Stellen ihr ⋮ selbst (Scope 09.11.2026, Kommentar an
LLH-1599):

| Gruppe | Stellen | Träger der Zeile |
| --- | --- | --- |
| Tabelle, ⋮ immer | Schichtmodelle, Benutzer | `KatalogTabelle` |
| Tabelle, ⋮ nur schmal, breit Knöpfe | Externe Stellen, Sprechgruppen, Verpflegungsplan, Dienststatus-Spalte (Fahrzeuge, Personal, Material der Stammdaten) | `KatalogTabelle` |
| Liste | Pegel, Geräte, Lagemonitor-Zugänge | `Liste`/`ListenEintrag` |
| eigene Zeile | Person in Fahrzeuge/Besatzung, Bild-Hintergrund | `div` |
| `Datensicht`, ⋮ in eigener Spalte | Kommunikationsplan | `Datensicht` ohne `weitere` |

Personen (`personenSpalten.tsx`) speist `karte.aktion` und `karte.weitere` der `Datensicht` und
hat das Kontextmenü seit LLH-1596.

Abgestimmt mit Ruben am 09.11.2026: Kontextmenü auf jeder Breite, auch wo breit Knöpfe stehen;
Bild-Hintergründe nur am Namensteil; im Kommunikationsplan „+ Verbindung“ als Primäraktion oben;
Anbindung über einen Hook und ein optionales `zeilenMenue` der `KatalogTabelle`.

## Goals / Non-Goals

**Goals:**

- Jede Zeile der genannten Stellen mit Aktionen öffnet per Rechtsklick, langem Druck und Taste ein
  Kontextmenü mit denselben Aktionen wie ⋮ bzw. Knopfreihe.
- Eine Quelle je Stelle: ⋮ und Kontextmenü lesen dieselbe Beschreibung `{ eintraege,
  zugaenglicherName, onWahl, laeuft }`.
- Die Verwaltung des offenen Menüs existiert einmal, für `Datensicht`, `KatalogTabelle` und Listen.

**Non-Goals:**

- Detailköpfe („Weitere Aktionen zu …“) bleiben ohne Kontextmenü.
- Die Knopfreihen am breiten Schirm werden nicht aus den Menüeinträgen erzeugt (D4).
- Zeilen fokussierbar machen: Die Taste wirkt wie in der `Datensicht` vom fokussierten Element in
  der Zeile aus (⋮, Knopf, Link).
- ETB, Chat und Karten, Schichtplan-Raster, Gliederung (LLH-1597, LLH-1598, LLH-1600, LLH-1601).

## Decisions

### D1 Hook `useDatensatzKontextMenue` aus der `Datensicht` herausgezogen

Neu `components/useDatensatzKontextMenue.tsx`:

```ts
useDatensatzKontextMenue<T>({
  finde: (k: Key) => T | undefined,         // Zeile zum Schlüssel, je Render frisch
  schluessel: (zeile: T) => Key,
  eintraege: (zeile: T) => readonly MenueEintrag[],
  zugaenglicherName: (zeile: T) => string,
  onWahl: (key: string, zeile: T) => void,
}) => { ausloeser: (zeile: T) => KontextHandler, menue: ReactNode, offen: boolean }
```

Der Hook hält `{ k, offen: KontextMenueOffen } | null`, fragt `kannOeffnen`/`onOeffnen` über
`eintraege(zeile).length`, sucht die Zeile je Render über `finde`, schließt im Render, wenn sie
fehlt oder keine Einträge mehr hat, und rendert `KontextMenue` als `menue`. Die `Datensicht`
nutzt ihn mit `eintraege = kontextEintraege(zeilenAktionen, …)` und `onWahl =
fuehreKontextWahlAus(…, modal)`; `offen` hält weiter die Zeilenschleuse.

*Alternative:* `KatalogTabelle` und jede Liste bauen den Zustand nach dem Muster der `Datensicht`
selbst. Verworfen: fünf Kopien des Schließens bei Wegfall, und der Fehler „Menü bleibt nach
Rechteentzug offen“ wäre fünfmal zu finden.

### D2 `KatalogTabelle` bekommt `zeilenMenue`

`zeilenMenue?: WeitereAktionen<T>` (der Typ aus `Datensicht.tsx`, dieselbe Form wie `weitere`).
Gesetzt, bindet die Tabelle den Hook aus D1 über `onRow` an jede Zeile, zusammengeführt mit einem
`onRow` des Aufrufers, und rendert `menue` neben der Tabelle. `finde` und `schluessel` kommen aus
`rowKey` und `dataSource`. Einträge aus `zeilenMenue.eintraege`, bei `laeuft(zeile)` alle
gesperrt, wie `kontextEintraege` ohne Primäraktion. Ohne `zeilenMenue` ändert sich nichts.

Die Seiten rendern ihr ⋮ in der Aktionsspalte über einen neuen kleinen Baustein
`ZeilenMenueAusloeser({ menue, zeile })` aus derselben Beschreibung (`gesperrt` und `laeuft` aus
`menue.laeuft`, wie der Kartenfuß der `Datensicht`). Die Beschreibung entsteht einmal je Seite
(`useMemo`) und geht an Spalte und Tabelle.

*Alternative:* die Tabelle erzeugt auch die Aktionsspalte selbst. Verworfen: Breite, Fixierung,
Knopfreihe und „vom Hub“-Sperre sind je Seite verschieden; die Spalte bliebe ein Bündel von
Optionen.

*Alternative:* jede Seite bindet den Hook selbst über `onRow`. Verworfen (Abstimmung): die
Einträge wären je Seite zweimal verdrahtet.

### D3 Listen und eigene Zeilen nutzen den Hook direkt

Pegel, Geräte und Lagemonitor-Zugänge legen um `ListenEintrag` eine Hülle
`<div {...ausloeser(p)}>`, wie der Kartenzweig der `Datensicht` (`ListenEintrag` nimmt keine
Ereignis-Props). Fahrzeuge/Besatzung spreizt die Handler auf `data-lfh="einheit-person"`. Das ⋮
jeder Stelle rendert `ZeilenMenueAusloeser` aus derselben Beschreibung. Die Einträge (etwa „Nach
oben“ gesperrt in der ersten Zeile) brauchen den Index; die Beschreibung bekommt ihn über die
Zeile (`liste.indexOf(p)`) statt über `renderItem`.

### D4 Breite Knopfreihen: Kontextmenü aus der Beschreibung, Knöpfe bleiben

Externe Stellen, Sprechgruppen, Verpflegungsplan und Dienststatus zeigen breit Knöpfe. Das
Kontextmenü liest auf jeder Breite das `zeilenMenue`; schmal rendert die Spalte daraus das ⋮,
breit wie bisher die Knöpfe. Ein Test je Stelle prüft, dass die Etiketten der Knöpfe gleich den
Einträgen des Kontextmenüs sind (Reihenfolge, Gefahr).

*Alternative:* Knöpfe aus `MenueEintrag[]` erzeugen (eine Quelle für alle drei). Verworfen für
diese Change: die Knöpfe tragen je Handlung eigenen Ladezustand (`loading` nur am geschalteten
Knopf, Dienststatus), den `MenueEintrag` nicht kennt; das gehört in eine eigene Abwägung.

### D5 Dienststatus: Beschreibung neben der Spalte

`stammdaten/dienststatus.tsx` exportiert neben `dienststatusSpalten` eine Funktion
`dienststatusMenue(…)` mit denselben Eingaben (Mutation, `onBearbeiten`, `kennung`, `vomHub`).
Vom Hub verwaltete Zeilen liefern keine Einträge (Browsermenü, wie ihr gesperrter Platzhalter).
Fahrzeuge-, Personal- und Material-Tab der Stammdaten geben sie als `zeilenMenue` an die Tabelle;
die Spalte nutzt sie für das schmale ⋮. `laeuft` gilt je Zeile wie heute.

### D6 Bild-Hintergründe: nur der Namensteil

Die Handler hängen am `span` mit Name und ⋮ (`namensteilStil`), nicht an der ganzen Zeile:
Schalter davor, Regler und Ansichts-Auswahl darunter bleiben ohne Kontextmenü. Der bearbeitbare
Name zeigt beim Bearbeiten ein Eingabefeld; dort bleibt das Browsermenü (`browsermenueBleibt`).
Ohne Schreibrecht gibt es kein ⋮ und kein Kontextmenü (ein einzelner Zentrieren-Knopf, keine
gebündelten Aktionen).

### D7 Kommunikationsplan: `karte.aktion` und `karte.weitere`

Die Seite beschreibt Primäraktion („+ Verbindung“) und ⋮ (`menueFuer`) einmal und reicht beide als
`karte.aktion`/`karte.weitere` an die `Datensicht`; die Aktionsspalte rendert Knopf und
`ZeilenMenueAusloeser` daraus. Gruppen- und abgeleitete Zeilen liefern keine Einträge
(`sichtbar` falsch, leere `eintraege`). Der Kartenzweig rendert bei `form="tabelle"` nie; die
Karten bekommen also keinen zweiten Knopf. Ohne Schreibrecht oder im Druck fehlen beide.

Ohne Netz sind Knopf und ⋮ gesperrt. Damit das Kontextmenü dasselbe zeigt:
- `PrimaerAktion` bekommt `gesperrt?: (zeile) => boolean`: Der Knopf der `Datensicht` (Kartenfuß)
  wird `disabled`, `kontextEintraege` setzt den Eintrag `gesperrt`.
- Die `weitere`-Einträge sperrt der Kommunikationsplan selbst (`gesperrt` je Eintrag), nicht über
  `laeuft`, damit das ⋮ keinen Ladekreis zeigt.

### D8 Regel und Wächter

`frontend/AGENTS.md`, „Kontextmenü nur über den Baustein“, bekommt: Tabellen außerhalb der
`Datensicht` binden das Kontextmenü über `KatalogTabelle.zeilenMenue`, Listen und eigene Zeilen
über `useDatensatzKontextMenue`; ⋮ und Kontextmenü lesen dieselbe Beschreibung. Der Wächter
`kontextMenue.guard.test.ts` bleibt unverändert: keine Seite schreibt `onContextMenu`, alle
spreizen die Handler.

## Risks / Trade-offs

- [Breite Knöpfe und Kontextmenü können auseinanderlaufen (D4).] → Test je Stelle vergleicht
  Knopfetiketten und Einträge; die Knöpfe aus der Beschreibung zu erzeugen bleibt als Nachzug.
- [Rechtsklick in Verwaltungstabellen ersetzt das Browsermenü, das Leute dort gewohnt sind.] →
  Auf Link, Text und Feld bleibt es; Zeilen ohne Aktion (ohne Verwaltungsrecht, vom Hub) behalten
  es ganz.
- [`onRow` des Aufrufers und des Hooks könnten dieselben Handler setzen.] → Kein Aufrufer setzt
  heute `onRow`; die Tabelle führt trotzdem zusammen und ruft bei Gleichnamigen beide.
- [Am Touchgerät lässt sich in Zeilen mit Kontextmenü kein Text per langem Druck markieren] (wie
  LLH-1596 D3). → Gilt nur für Zeilen mit Aktion; Links bleiben ausgenommen.

## Migration Plan

Reines Frontend, ohne Datenwechsel. Rücknahme durch Revert des PR.

## Open Questions

(keine)
