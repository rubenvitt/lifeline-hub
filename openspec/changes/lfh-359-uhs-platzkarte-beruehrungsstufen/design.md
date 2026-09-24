# Design

## Context

`PlatzKarte` in `frontend/src/pages/uhs/Grundriss.tsx` ist ein absolut positionierter Knoten mit
fester Größe (`PLATZ_KARTE_BREITE = 140`, `PLATZ_KARTE_HOEHE = 116`, Rand 2, Polsterung 6).
Die Karte hat damit 124 × 100 px Innenraum. Er ist in vier feste Streifen geteilt: Titel 30,
Tags 24, Belegung 24 und Aktionszeile 24. Am selben Knoten hängen drei Dinge: `useDraggable`
(Layout-Zug, nur im Bearbeiten-Modus), `useDroppable` (Personen annehmen) und ein Wurzel-`onClick`
für die Ein-Klick-Zuweisung aus LFH-367/B5g. Das Platzmenü ist ein antd-`Dropdown` am Knopf
„…“ in der Aktionszeile. Die Aktionszeile riegelt `click` ab, damit Klicks auf Knöpfe und
Menü-Portal nicht in den Wurzel-`onClick` aufsteigen (zwei Regressionstests).

Die Dichte kommt als aufgelöstes Token an: `controlHeight` 30 / 48 / 72 und `controlHeightSM`
24 / 48 / 72 (`theme/tokens.ts`). `marginSM` beträgt in `kompakt` 7. Die Menüeinträge des
antd-Dropdowns haben `paddingBlock = (controlHeight − fontSize × lineHeight) / 2` und messen
damit `controlHeight` (`antd/es/dropdown/style/index.js`). Die Vitest-Hülle `test/utils.tsx`
montiert ein nacktes `ConfigProvider`, dort gilt also antds Vorgabe `controlHeightSM = 24`.

## Goals / Non-Goals

**Goals:**
- Genau eine reine Funktion entscheidet über die Bedienform, aus Tokens und den Kartenkonstanten.
  Sie ist ohne Rendern über alle drei Stufen prüfbar.
- Die Kartenform verliert keine Aktion und keinen Riegel, den die Zeilenform hat (LFH-457, der
  Klick-Riegel aus B5g, Rechte).
- In `kompakt` ändert sich weder Verhalten noch DOM.

**Non-Goals:**
- Kein Umbau der Wartebereichs- und Transportspalten. Deren Knöpfe erben die Stufe bereits.
- Keine Änderung an `raster_position` und keine skalierte Koordinatendarstellung (siehe
  Entscheidung 1).
- Kein Sammelbanner für Belegungen anderer Stellen (LFH-334, Bestand).

## Decisions

### 1. Kartenform statt skalierter Fläche oder Ausnahme

- **Verworfen: skalierte Fläche.** Die Koordinaten würden je Stufe mit einem Faktor
  multipliziert, und die Karten würden so groß, dass vier Knöpfe hineinpassen. Im Handschuh
  bräuchte die Zeile 4 × 72 + Lücken + 16 ≈ 330 px Kartenbreite, also etwa den Faktor 2,2. Der
  Grundriss mit fünf Spalten liefe auf dem Tablet dann waagerecht über. Außerdem müsste jeder
  Layout-Zug zurückgerechnet werden.
- **Verworfen: Ausnahme (Weg 3).** Sie verfehlt AK 2 von LFH-359.
- **Verworfen: Bündeln hinter einen „…“-Knopf.** Der Auslöser bräuchte selbst 72 px. Titel,
  Tags und Belegung belegen schon 78 px, und 78 + 72 übersteigt 100.
- **Gewählt: die Karte ist der Auslöser.** Die Entscheidung des Auftraggebers vom 24.09.2026
  lautet „immer Menü“. Die Primäraktion steht deshalb auch beim unbelegten Platz im Menü und
  wird nicht direkt ausgeführt.

### 2. `platzBedienform(token)`: rein, exportiert, ersetzt `aktionsabstand`

```ts
type Bedienform = { form: 'zeile'; abstand: number } | { form: 'karte' };
export function platzBedienform(token: { controlHeight; controlHeightSM; marginSM }): Bedienform
```

Die Funktion liefert `zeile` genau dann, wenn beide Bedingungen gelten, und sonst `karte`:

- **Höhe:** `controlHeightSM ≤ AKTIONSZEILE_HOEHE`. Die Aktionszeile hat 24 px, der Wert wird
  als neue Konstante aus dem Streifenmaß gezogen.
- **Breite:** `AKTIONEN_MAX × controlHeightSM + (AKTIONEN_MAX − 1) × marginSM ≤
  AKTIONSZEILE_BREITE`. Hier geht die Lücke **ungedeckelt** ein. Die Zeilenform gibt es nur,
  wenn neben „zurückweisen“ der volle `marginSM` steht (LFH-363, AK 4 von LFH-379).

In der Zeilenform ist `abstand = marginSM`. Der Deckel aus LFH-378 wäre dann immer
wirkungslos und entfällt. Das ist die „Entfernung mit Begründung“ aus AK 3 von LFH-379: Er
schützte eine Zeile, die zu breit war, und diese Zeile gibt es nicht mehr. Die Rechnung in
`kompakt` ergibt 4 × 24 + 3 × 7 = 117 ≤ 124. In `komfortabel` ist schon die Höhe verfehlt,
48 > 24.

Die Tests belegen in `kompakt` die Zeilenform mit Breite ≤ 124, in `komfortabel` und im
Handschuh die Kartenform. Das Ergebnis ist über zwei Stufen verschieden (AK 2 von LFH-379).
Dazu kommt die Kartenaussage `PLATZ_KARTE_BREITE ≥ controlHeight` und `PLATZ_KARTE_HOEHE ≥
controlHeight` für alle drei Stufen. Getestet wird mit den Tokens aus `antdToken(…, stufe)`,
nicht mit Literalen, damit ein Staffelwechsel in `tokens.ts` den Test mitzieht. Die
Bodenwerte stehen aber als Literale im Test, nach dem Muster von `bedienzielStil`.

Die Komponente liest das Token über `theme.useToken()`. Einen `useDichte()`-Zweig gibt es
nicht: Die Form folgt aus dem, was gerendert wird, nicht aus einem Etikett.

**Korrektur bei der Umsetzung:** Hier stand ursprünglich, dass Vitest ohne Theme die
Zeilenform ergebe. Das stimmt nicht, gemessen. antds Vorgabe `marginSM = 12` ergibt 4 × 24 +
3 × 12 = 132 > 124, also die Kartenform. Deshalb rendern `Grundriss.test.tsx` und
`GrundrissTabs.test.tsx` jetzt im App-Theme der Stufe `kompakt`. Das ist ohnehin der Zustand,
den die App hat. Die Kartentests reichen `komfortabel` herein. `controlHeight` gehört nicht zur
Signatur von `platzBedienform`, weil die Entscheidung nur an `controlHeightSM` und `marginSM`
hängt.

### 3. Aufbau der Kartenform

- **Auslöser:** antd `Dropdown` mit kontrolliertem `open`, `trigger={['click']}` und
  `menu.autoFocus`, um den Kartenknoten gelegt. Der Knoten trägt `role="button"`,
  `tabIndex={0}`, `aria-haspopup="menu"`, `aria-expanded` und `aria-label={`Aktionen zu
  ${bezeichnung}`}`. Im Bearbeiten-Modus liefert dnd-kit selbst `role`/`tabIndex`. Unsere
  Angaben werden **nach** dem Spread gesetzt, damit Name und Popup-Auszeichnung gewinnen.
- **Tastatur:** Ein eigener `onKeyDown` öffnet das Menü bei Enter, außerhalb des
  Bearbeiten-Modus auch bei der Leertaste, und ruft `preventDefault` auf. Im Bearbeiten-Modus
  wird die Leertaste an dnd-kits `onKeyDown` durchgereicht, denn der `KeyboardSensor` startet
  damit den Layout-Zug. Enter startet diesen Zug ebenfalls, deshalb verzweigt der Handler
  **vor** dem dnd-kit-Listener und reicht Enter im Bearbeiten-Modus nicht weiter. Damit bleibt
  im Bearbeiten-Modus der Tastatur-Zug über die Leertaste erhalten.
- **Klick-Riegel:** In der Kartenform ist er **entfallen**. Das ist eine Korrektur bei der
  Umsetzung. Das `Dropdown` legt sich hier **um** die Karte. rc-trigger rendert das Popup als
  Geschwister des Kindes, nicht als dessen Nachfahre. Der Portal-Klick steigt deshalb nicht in
  die Karte auf, sondern zu ihren Vorfahren, und die tragen keinen `onClick`. Belegt ist das
  durch den Test „löst mit einer Menüwahl weder die Zuweisung aus noch öffnet es das Menü
  erneut“. Er ist grün, ohne dass ein Riegel existiert. Ein Riegel, den kein Test rot machen
  kann, wäre eine Behauptung ohne Beleg. Der Wurzel-`onClick` für die Zuweisung gilt nur in der
  Zeilenform. Deren Riegel an der Aktionszeile bleibt, weil ihr Dropdown **in** der Karte
  hängt.
- **Menüinhalt:** Er wird aus einer reinen Funktion `platzMenueEintraege(...)` abgeleitet, die
  auch die Zeilenform für ihr „…“-Menü nutzt. Beide Formen lesen so dieselbe Liste und dieselben
  Rechte und Sperren. Nur die Kartenform nimmt die Einträge hinzu, die in der Zeilenform Knöpfe
  sind: „Verbleib / Entlassung erfassen“ und „Person öffnen“ oben, „zurückweisen“ als
  `danger` hinter dem Trenner. Reihenfolge und Inhalt stehen in der Spec. „Platz löschen“ steht
  mit „zurückweisen“ im selben Gefahrblock.
- **Menühöhe (bei der Umsetzung gemessen):** Ein belegter Platz trägt im Handschuh acht
  Einträge à 72 px, zusammen rund 600 px. Bei 1024 × 900 ist das mehr, als unter oder über
  der Karte Platz hat. antds Vorgabe für `bottomLeft` klappt nur um (`adjustY`). Passt keine
  Seite, steht das Menü nach oben aus dem Fenster, und gerade die Primäraktion ist dann nicht
  erreichbar (Bildschirmfoto im Verlauf). Deshalb `autoAdjustOverflow={{ adjustY, shiftY }}`,
  dazu am Menü `maxHeight: calc(100dvh − 16px)` mit eigenem Scroll für niedrigere Fenster.
  e2e: „alle Menüeinträge liegen im Fenster“. Die Mutationsprobe ohne `shiftY` ist rot.
- **Nachträge aus dem Review:** Die Personenmarke nimmt in der Kartenform dnd-kits
  `role="button"` und `tabIndex` zurück (`keinZiel`). dnd-kit setzt beides auch bei
  `disabled`, sonst stünde ein fokussierbarer Knopf im Knopf. Der Tastatur-Zug der Person
  entfällt damit in der Kartenform, den Rückweg trägt „Zurück in den Wartebereich“. Solange ein
  Zug läuft (`useDndContext().active`), öffnet Enter das Menü nicht, denn dnd-kit legt mit Enter
  an `document` ab. Das offene Menü gehört zu dem Belegungszustand, in dem es geöffnet wurde,
  und schließt, wenn ein Live-Update ihn ändert (abgeleitet, kein Effekt). Die Zustandsstreifen
  hängen als `aria-describedby` an der Karte.
- **Personenmarke:** In der Kartenform bekommt `PersonenkarteDrag` kein `onOeffnen`. Ein Tipp
  auf die Marke steigt dann zur Karte auf und öffnet das Menü. Der Zug bleibt: dnd-kit
  unterdrückt nach einer Bewegung von 5 px den Klick, ein Zug öffnet also kein Menü.
- **Ohne Schreibrecht:** Belegt öffnet der Tipp direkt den Detail-Drawer. Das ist dieselbe
  Handlung wie heute der Klick auf die Marke, nur auf die ganze Karte vergrößert. Unbelegt
  bleibt ein reiner Anzeigeknoten ohne `role` und ohne `tabIndex`.
- **Laufende Belegung (LFH-457):** Die Sperrlogik bleibt. Sie wandert mit in
  `platzMenueEintraege`, und die gesperrten Einträge stehen mit `disabled` da.

### 4. `size="small"` und die Schuldliste

Die vier `size="small"` werden nur noch in der Zeilenform gerendert, also nur in `kompakt`. Dort
messen sie 24 px, und das ist der Boden dieser Stufe. Der Eintrag in `OFFEN` bleibt, weil der
Scanner Quelltext zählt und keine Dichte kennt. Seine Begründung wird aber neu geschrieben: Aus
„hängt an `raster_position`“ wird „wird nur in `kompakt` gerendert, 24 px = Boden; die
Berührungsstufen tragen die Kartenform (LFH-359)“.

### 5. Doku-Nachzug

Alle Stellen aus dem `SCHRITT_Y`-Grep, die „fällt erst mit einer Änderung an
`raster_position`“ oder Gleichwertiges sagen, werden umgeschrieben: der Dateikopf von
`Grundriss.tsx`, `dichte.guard.test.ts`, `CLAUDE.md:506`, `AGENTS.md:196/582`,
`docs/leitlinien/bedien-leitlinie-herleitungen.md:32/257`, der Kommentar in
`Grundriss.test.tsx:608` und die LFH-359-Zeilen in
`docs/superpowers/specs/2026-07-30-uhs-grundriss-pruefliste.md`. Die Prüfliste gehört zum
eingefrorenen Archiv. Dort steht nur ein Nachtrag mit Verweis, der alte Text bleibt stehen.

## Risks / Trade-offs

- [Zuweisen kostet auf dem Tablet zwei Tipps statt einem] → Das ist entschieden. „Patient
  zuweisen“ steht oben im Menü und bekommt den Fokus. Das Ziehen bleibt als Zusatzweg.
- [antd klont das Kind des `Dropdown` und setzt `onClick` und Ref. dnd-kit braucht seinen
  eigenen Ref am selben Knoten] → Die Ref-Weitergabe über `setRef` bleibt bestehen. Das rc-
  Trigger-Composing wird im Browser geprüft: Das Menü muss an der Karte stehen, und der
  Layout-Zug muss laufen.
- [Enter im Bearbeiten-Modus startet keinen Tastatur-Zug mehr, nur noch die Leertaste] → Das
  gilt nur für die Kartenform. Der Kontext dort ist Berührung, Tastatur ist die Ausnahme, und
  der Weg bleibt erhalten.
- [jsdom sieht weder Trefffläche noch Popup-Position] → Die Trefffläche wird in Playwright per
  `boundingBox()` gemessen, das Öffnen per Tippen. `toBeVisible()` gilt nicht als Beleg.

## Migration Plan

Kein Datenpfad. Das Deployment ist ein normales Frontend-Release. Für einen Rückbau genügt ein
Revert des Frontend-Commits, der Server ist nicht betroffen.
