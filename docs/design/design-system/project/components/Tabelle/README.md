# Tabelle: KatalogTabelle mit Suche, Spalten, Filtern und Zeilenmenü

Geteiltes Tabellen-Primitiv der Katalog-/Verwaltungsseiten: Gate 2 der
Bedien-Leitlinie an EINER Stelle. Drei Merkmale setzt das Primitiv unbedingt:

1. **Waagerechter Scrollcontainer über die Spaltenbreite.** Auf schmalem Schirm wird die
   Tabelle angepasst, nicht in Karten aufgelöst; sie scrollt in sich.
2. **Stehende Kopfzeile.** antd zieht Kopf und Körper dafür in zwei `<table>` auseinander und
   schiebt eine verborgene Messzeile als erste Körperzeile ein; Tests verengen deshalb auf
   `tr.ant-table-row`.
3. **Fixierte Identifierspalte.** Die erste Spalte bleibt stehen, und sie ist die
   MENSCHENLESBARE Kennung, nie die DB-Kennung (DEV-Warnung unten).

Zeilenschlüssel, Ladezustand und Leertext setzt der Aufrufer; ihre VERSCHRÄNKUNG gehört hierher
(siehe unten).

**Suche: opt-in.** Ohne `suche` gibt es weder Feld noch Werkzeugzeile (manche Seiten haben eine
eigene Suche, `Datensicht` bringt seine mit). Der Platzhalter nennt die durchsuchten Felder und
steht deshalb ganz im Feld (`suchfeldStil`). Gesucht wird über `zellenWert`, also nur in
Spalten mit auflösbarem Datenbezug; render-only-Spalten tragen NICHT bei, außer mit einem
`KatalogSpalte.suchText`-Haken (dieselbe Signatur wie `DatensichtSpalte.suchText`).
**`suchText` gewinnt**: trägt eine Spalte beides, wird nur der Haken bewertet, ein Haken kann
also auch verengen.

**Blätterung ab `BLAETTER_SCHWELLE` Zeilen.** Gerechnet gegen `dataSource.length`, nicht
gegen die gefilterte Menge, sonst verschwände die Leiste beim Tippen (Kriterium 12). Ein
übergebenes `pagination` gewinnt (`??`, damit ein gesetztes `false` hält).

**Spaltenschalter: opt-in** (Kriterium 14).
· Mit `spaltenSchalter` steht er in der Werkzeugzeile; Zählung und Menü aus
  `SpaltenSchalter.tsx`, derselben Quelle wie in `Datensicht`.
· Ohne Opt-in bleiben alle Spalten sichtbar: `abBreite` wirkt nicht (DEV-Meldung), antds
  `responsive`/`hidden` sind am Typ und per Guard gesperrt.
· `Datensicht` setzt das Prop NIE, es rendert seinen eigenen Schalter.
· Eine Spalte, die immer im Bild stehen muss (Status, Aktionen), trägt `immerSichtbar` und
  `fixed: 'right'`; die Fixierung der ersten Spalte bleibt davon unberührt.
· Was man nicht sieht, wirkt nicht: antd hält Filter- und Sortierzustand nur für übergebene
  Spalten, eine ausgeblendete gefilterte Spalte siebt nicht (gepinnt in
  `OnlineQuellenVerwaltung.test.tsx`).

**Kopfwerkzeuge folgen der Dichte** (Kriterium 2). Die Werkzeugzeile hält zwischen
Suche und Spaltenschalter `paddingSM` (8 / 12 / 16 px, `werkzeugAbstand`). antds
Spaltenfilter-Auslöser ist ein `span` mit `tabIndex=-1` in Schriftgröße (20 × 23 px in jeder
Stufe): er bekommt den Boden `controlHeightSM` über `filterKopfStil` und `sprache.css`,
und `useFilterTastatur` nimmt ihn in die Tab-Folge (Enter/Leertaste öffnen, Escape
schließt und gibt den Fokus zurück, das trägt antds Dropdown).

**Sortieren und Filtern wie in `Datensicht`**.
Filter- und Sortierzustand einer Spalte mit `filters` bzw. `sorter` liegen KONTROLLIERT hier
(vorbelegt aus `defaultFilteredValue`/`defaultSortOrder` oder aus `gedaechtnis`); antd zeichnet
Trichter, Menü und Pfeil und filtert über das `onFilter` der Spalte; im Menü trägt jeder Wert
seinen Zähler („Aktiv (3)“), solange alle wirkenden Filter ein `onFilter` haben. Bei
Suche oder Filter steht der `Filterhinweis` (Treffer von Gesamt) samt Chips je Wert, „Filter
zurücksetzen“ leert beides.
Was man nicht sieht, wirkt nicht und steht nicht als Chip da. Eine Spalte mit EIGENEM
`filteredValue`/`sortOrder` bleibt beim Aufrufer — so `Datensicht`, die Hinweis und Chips selbst
zeigt. `onChange` des Aufrufers hört weiter mit. Solange ein Filtermenü offen ist, bekommt antd
die Spaltenliste vom Öffnen, damit der angehakte Entwurf einen Neuaufbau übersteht („EIN OFFENES FILTERMENÜ BEHÄLT SEINEN ENTWURF“ unten).

── DREI ZUSTÄNDE, DIE LADEUNTERDRÜCKUNG LEBT HIER ──

**ladend**, **leer** und **gefüllt**; **Fehler** tauscht die Seite gegen `SeitenFehler`, bevor
die Tabelle montiert (ein `fehler`-Prop wirkte im Kartenzweig von `Datensicht` nicht).

**Ladend und leer schließen sich aus, entschieden an EINER Stelle: hier.** Solange geladen
wird, wird der Leertext unterdrückt (`locale.emptyText` auf `null`), wie in `Liste.tsx`. Sonst
behauptete jede Seite beim ersten Rendern „Noch keine …“. Deshalb fallen `loading` und `locale`
NICHT durch `...rest` an antd. (Bei ganz fehlender `dataSource` unterdrückt antd selbst; diese
Stelle deckt `[]`.)

· `loading` ist `boolean | SpinProps`; ein OBJEKT ohne `spinning` lädt ebenfalls.
· `emptyText: null` unterdrückt wirklich (antd prüft `typeof … !== 'undefined'`); gemessenes
  Verhalten, deshalb als Pin in `KatalogTabelle.test.tsx`.

Aus `frontend/src/components/tabellenFilter.tsx`:

Bausteine des gemeinsamen Bedienmusters „Sortieren und Filtern“ der beiden Tabellenträger
(LLH-1086, Spec `tabellen-sortieren-filtern`, `frontend/AGENTS.md`, „Tabelle und Dichte“):
`Datensicht` baut es, `KatalogTabelle` übernimmt es. Hier wohnt, was beide gleich zeigen:
die Leiste der aktiven Filter und die Marke einer gefilterten Kopfzelle. Den Hinweis über der
Liste trägt `instrument/Filterhinweis` (LLH-1071), kein zweiter Baustein.

Quelle: `frontend/src/components/KatalogTabelle.tsx` im Repo `rubenvitt/lifeline-hub`. Die Vorschau ist aus
dem echten Baustein gerendert, mit dem antd-Theme der App, Nacht und Tag, Dichte `kompakt`.
