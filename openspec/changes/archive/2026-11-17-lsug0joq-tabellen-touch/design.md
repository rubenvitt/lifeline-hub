# Design

## Context

Alle Listen mit Vergleichsfrage laufen über `Datensicht` (Tabellenzweig) oder direkt über
`KatalogTabelle`. Was diese Change braucht, liegt dort:

- `KatalogTabelle` fixiert immer Spalte 0 links (`fixierteSpalten`). Die Spalte bekommt eine
  Fließspalte über `fliessBreite`, und `tableLayout="auto"` gilt, weil eine Zahl in `scroll.x`
  das Layout sonst still auf `fixed` kippte (Kommentar am `tableLayout`). Im Auto-Layout sind
  Spaltenbreiten Wünsche. Jede Zelle wächst auf ihre Min-Content-Breite, und der Rest geht von
  der Fließspalte ab.
- `Datensicht` verbietet `fixed` an ihren Spalten (`AntdErbe`). Eine Aktionsspalte steht deshalb
  am Ende des Scrollinhalts. Evakuierung (`BezirkTabelle`) und Betreuung (`StellenBlock`) nehmen
  unter `md` je für sich die Meldeaktion in die Kennung (`meldenInKennung`, `KENNUNG_MAX_PX`).
  Das ⋮ bleibt rechts.
- `SpaltenSchalter.sichtbareSpalten` zählt jede verborgene Spalte, ob verborgen von Hand, per
  Voreinstellung oder per `abBreite`. Der Name folgt allein aus `anzahlVerborgen`.
- `InlineAngabe` setzt beim Öffnen die Anzeige durch ein `<form>` mit Eingabe und „Speichern“ /
  „Abbrechen“ in `<Space wrap>` im Fluss. In einer Zelle mit Zahlbreite sprengt das ihre
  Min-Content-Breite.
- Die Einheitenliste ist per `NUR_TABELLE` (`datensicht.guard.test.ts`) und Dateikopf
  (LLH-1029) auf Tabelle festgelegt. Ihr Kartenplan steht schon da. Der Baum-Kartenzweig der
  `Datensicht` (`baumEintrag`) hat noch keinen produktiven Nutzer.

LLH-1788 (Kopf und Körper der klebenden Kopfzeile verschieden breit) wird im selben Branch vorher
behoben und ist hier Voraussetzung, keine Aufgabe: eine rechts fixierte Spalte über einem
falsch breiten Kopf wäre nicht prüfbar.

## Goals / Non-Goals

**Goals:**

- Jede der vier Lösungen lebt im Primitiv, die Seiten setzen nur ein Opt-in oder eine Spalte.
- Messbare Nachweise im Browser je Stufe (Lage der Aktion, Spaltenbreiten vor und nach dem
  Bearbeiten, Name des Schalters, Kartenform am Handy).

**Non-Goals:**

- Kein Wechsel auf `tableLayout: fixed` (Risiko angeschnittener Knöpfe, Kommentar in
  `KatalogTabelle`).
- Der Seitenkopf (LLH-1786), die Treffziele der Restziele (LLH-1798) und die Schriftgröße der
  Spaltenköpfe kommen in der nächsten Welle.
- `BemerkungZelle` (mehrzeiliger Freitext) behält die Bearbeitung in der Zelle.

## Decisions

### D1 Aktionsspalte: ein Baustein, zwei Formen nach Breite (`cq38dy2l`)

Ein neuer Spaltenbauer `aktionsSpalte({ aktion, weitere, dichte })` in `components/` liefert eine
`DatensichtSpalte` mit Schlüssel `aktionen`, `immerSichtbar` und der Marke `amEnde`. `aktion`
(Primäraktion, optional) und `weitere` (⋮) sind die Kartenplan-Paare, die Karte und Kontextmenü
schon lesen. So entsteht keine zweite Aktionsliste.

- **Ab `md`:** `Datensicht` setzt an einer Spalte mit `amEnde` `fixed: 'right'` (dort liegt die
  Übersetzung ihrer Spalten; direkte `KatalogTabelle`-Nutzer fixieren selbst). Die Schatten
  für `fix-end` stehen in `theme/sprache.css` schon. Die Breite ist fest: `menueSpaltenBreite`
  (⋮) plus, bei Primäraktion, die Breite ihres Knopfs. Diese wird aus der Beschriftung über
  `canvas.measureText` in der Schrift der Stufe gemessen, zuzüglich Knopfpolster und Fuge. Die
  Messung ist rein und je Beschriftung und Stufe zwischengespeichert. Sie hängt nicht am DOM,
  deshalb springt nichts beim Laden.
- **Unter `md`:** Eine Tabelle, die unter `md` Tabelle bleibt (`form="tabelle"`), lässt die
  Aktionsspalte weg. Die Kennungsspalte rendert hinter der Kennung Primäraktion und ⋮
  (`KennungMitAktion`). Das ist das heutige Muster aus `BezirkTabelle`/`StellenBlock`, ins
  Primitiv gehoben, und beide Seiten verlieren ihren Eigenbau samt `KENNUNG_MAX_PX`. Tabellen mit
  `form="auto"` stehen unter `md` ohnehin als Karten, ihre Karten tragen die Aktionen schon.
- **Zeilen nur mit ⋮** (Fahrzeuge, Material, Betroffene) bekommen dieselbe fixierte Spalte in
  der Breite von `menueSpaltenBreite`.

Verworfen: Immer rechts fixiert. Am Handy kostet das in `handschuh` dauerhaft 124 px und mehr von
390 px. Ebenso verworfen: Immer in der Kennung. Dort würde die Kennung am Fükw zweizeilig, und
die Zeilen wüchsen. Beides hat der Mensch am Phase-1-Checkpoint so entschieden.

### D2 Bearbeiten in der Zelle: schwebend über einen Kontext (`j10okn8m`)

`KatalogTabelle` legt um ihren Tabellenkörper einen Kontext `angabeForm = 'schwebend'`. Um den
Inhalt aufgeklappter Zeilen (`expandedRowRender`, „Details“) setzt sie ihn zurück auf `'fluss'`,
weil das eine Ansicht ist und keine Zelle. Ist `InlineAngabe` schwebend, behält sie Anzeige und
Wertknopf in der Zelle. Die Bearbeitung (Eingabe, Fehler, Sperrgrund, Knöpfe) steht in einem
kontrollierten antd-`Popover` am Wertknopf (`trigger` leer, `placement="bottomLeft"`, Portal an
`body`). Muster ist `personen/ZeilenSichtung.tsx`.

- Fokus, Escape-Reihenfolge (`popup.onOpenChange`), Fokusrückgabe (`useFokusRueckgabe`),
  Entwurfsmerker und `OFFEN_LASSEN` bleiben unverändert im Primitiv, nur der Behälter wechselt.
- Ein Klick außerhalb schließt nicht. Das entspricht der Regel „kein Speichern beim Verlassen“,
  und ein Entwurf geht nicht still verloren. Schließen geht über Escape oder „Abbrechen“.
- Eine Tabelle hält höchstens eine schwebende Bearbeitung offen. Öffnet jemand eine zweite,
  während die erste unverändert ist, schließt die erste. Ist die erste geändert, bekommt sie den
  Fokus zurück, und die zweite öffnet nicht.
- Die Zeilenschleuse hält die Folge: `checkVerlassen` (`useZuflussSchleuse`) prüft das
  Fokusziel am DOM und nimmt `.ant-popover` wie die Menü-Overlays als „in der Sicht“ (im
  Review vor dem PR nachgetragen; vorher taute der Fokus im Popover die Schleuse). Ohne Fokus
  (Tipp ins Freie am Tablet) hält die offene Bearbeitung selbst: `AngabeFormProvider` meldet sie
  über `onOffen`, `KatalogTabelle` reicht das als `onBearbeitungOffen` an die `Datensicht`, die es
  in `halten` nimmt (Fix-Review).
- Tab aus dem Popover geht zum nächsten Ziel nach der Zelle, Shift+Tab vom ersten Ziel zurück
  auf die Anzeige; sonst liefe der Fokus ans Ende des Dokuments. Eine unveränderte Bearbeitung
  schließt dabei, offen stünde das Popover über den nächsten Zielen. Eine geänderte hält den
  Fokus: Tab läuft im Popover im Kreis, Shift+Tab geht auf die Anzeige, und Enter dort führt in
  die offene Bearbeitung zurück (Fix-Review).
- Die Fokusrückgabe nach dem Schließen gilt eine Frist (1,5 s) statt einer Zahl von Renders und
  endet mit einem Zeigerdruck anderswo; ein späterer Render (neuer FMS-Status) holt den Fokus
  sonst noch Minuten danach zurück (Fix-Review).
- `BemerkungZelle` liest den Kontext nicht.

Verworfen: eine Zelle fester Größe mit ✓/✕. Zwei 72-px-Knöpfe sprengen in `handschuh` eine
150-px-Spalte. Ebenso verworfen: `tableLayout: fixed`, siehe Non-Goals.

### D3 Zähler erst nach eigener Wahl (`i7lwykpt`)

`sichtbareSpalten` bekommt die Voreinstellung (`voreinstellungAus`, Vorgabe leer) und liefert
neben `anzahlVerborgen` die Angabe `weichtAb = aus ≠ voreinstellungAus (als Mengen) ∨ an ≠ ∅`.
Die Breite gehört dabei zur Vorgabe, weil `an` genau die von Hand gegen die Breite
eingeblendeten Spalten hält. Der Name ist „Spalten“, solange `!weichtAb`, sonst
„Spalten · n ausgeblendet“ mit allen Verborgenen. `Datensicht` reicht `spaltenAusVoreinstellung`
weiter, `useSpaltenSchalterZustand` (Meldebild) nimmt sie als Parameter, und `KatalogTabelle`
übergibt die leere Menge. Das Gedächtnis (`useListenGedaechtnis`) bleibt unverändert.

Verworfen: nach eigener Wahl nur die Abweichung zählen. Dann verschwiegen die Zahlen die nach
Breite fehlenden Spalten, und der Zähler log wieder.

### D4 Typ unter dem Funkrufnamen (`i7lwykpt`)

Ein kleiner Baustein `KennungMitZusatz` (Kennung, darunter gedämpft ein Zusatz in der Rolle
`text2`, 12 px) kommt in die `render` der Spalte `funkrufname` und in den Kartentitel. Er zeigt
den Typ, solange die Spalte „Typ“ nicht in der Tabelle steht, nach Breite und Handwahl: die
`Datensicht` reicht die wirklich gezeigten Spalten als Kontext (`SichtbareSpaltenKontext`), so
steht der Typ nie doppelt und nie ganz verborgen (Befund aus dem Review vor dem PR). Der Baustein ist so geschnitten, dass
LLH-1791 (Funktion unter dem Namen) ihn mitnutzen kann.

### D5 Einheiten am Handy: Baum als Karten (`i5c54naq`)

`EinheitenPage` wechselt auf `form="auto"`. Der Kartenplan bekommt `titel` = `KraeftebaumZelle`
(Zeichen, Name, Marke „nicht übernommen“), `status` = Urteil der Stärke (`StatusDarstellung`
mit Label, etwa „unterbesetzt“) und `sekundaer` = Ist, Soll und Einheitsführer. Der
Baum-Kartenzweig (`baumEintrag`) wird erstmals produktiv genutzt. Zu prüfen sind dabei der Einzug
unter `md` (`BAUM_EINZUG_SCHMAL_PX`), der Knopf „n Untereinträge“ als Ziel der Stufe und die
Vorgabe aufgeklappt. Der Name nimmt in beiden Zweigen einen Wortumbruch an Silbengrenzen statt
`overflowWrap: 'anywhere'` (`overflowWrap: 'break-word'`, `hyphens: 'auto'`; `lang="de"` steht in
`index.html`). Die Datei fällt aus `NUR_TABELLE`, Dateikopf und Kommentar in `Datensicht`
(Trennlinie der Formen) begründen die Ausnahme.

## Risks / Trade-offs

- [Viele Unit- und e2e-Tests suchen „Speichern“ per `within(zeile)`, das Popover steht im Portal]
  → Ein Testhelfer `inAngabe(name)` sucht die offene Bearbeitung über ihren zugänglichen Namen. Die
  Umstellung läuft als eigene Aufgabe, und betroffene Tests werden gesammelt angepasst, nicht
  einzeln abgeschwächt.
- [Rechts fixierte Spalte und `scroll.x = 'max-content'`] → rc-table wählt bei fixierten Spalten
  und `max-content` selbst `auto`. Das bleibt, eine Zahlbreite ändert sich nicht. Ein e2e-Lauf
  misst die Lage der Aktion bei 1440 mit Panel, 1024 und 390 in allen drei Stufen.
- [Gemessene Knopfbreite weicht von der gerenderten ab (Schrift noch nicht geladen)] → Das erste
  Bild steht in den Bildschirm-Schriften (Requirement „Das erste Bild steht in den
  Bildschirm-Schriften“). Die Messung nimmt dieselbe Schriftfamilie und einen Puffer von 2 px.
- [Einheiten-Karten verlieren den Ist/Soll-Vergleich in Spalten] → Ist/Soll steht in jeder Karte
  an derselben Stelle, das Urteil als Statusslot. Am Handy ist das vergleichbar genug, und ab `md`
  bleibt die Tabelle.
- [Popover über einer rollenden Tabelle] → antd hält das Popover am Anker. Rollt der Anker aus
  dem Bild, bleibt die Bearbeitung offen, und Escape schließt sie.

## Migration Plan

Keine Daten und keine API. Die Spaltenwahl im Gerätespeicher bleibt gültig, denn der Schlüssel
`aktionen` war schon `immerSichtbar` und nie wählbar.
