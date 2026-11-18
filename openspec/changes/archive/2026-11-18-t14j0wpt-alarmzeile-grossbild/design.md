# Design

## Context

Motivation: `proposal.md`. Stand am 17.11.2026:

- **Alarmzeile** (`components/instrument/AlarmZeile.tsx`, LLH-1743, ADR-0057): ein Baustein mit zwei
  Größen. `normal` ist für Überblick und Lagebild gedacht, mit Links und einem Popover hinter „+n“.
  `gross` ist für den Lagemonitor gedacht, mit fest 28 px Text aus `fernsicht`, 40 px hohen
  Einträgen und ohne Links. Was in die Breite passt, misst ein `ResizeObserver` an einer
  unsichtbaren Messreihe (`passend`); er rechnet nicht.
- **Daten:** `LageDashboardPage` ruft schon `useWasBrennt(einsatzId, dayjs(jetzt))` für die eigene
  Alarmzeile auf. Das Großbild ist ein Zweig derselben Seite (LLH-1747, D1 der Change
  `ckl1wbvz-grossbild-lage`), und die Seite reicht alle Werte als Props hinein.
- **Großbild-Skala** (`components/grossbild/grossMass.ts`): `grossMass(px)` ergibt
  `calc(min(vw, vh)-Einheit * px)`, bei 1920 × 1080 also genau `px`. `GROSS_BEZUG.text` ist 28.
  `--lfh-gross-einheit` setzt die Einheit fest, etwa in der Vorschau des Design Systems.
- **Fläche** (`GrossbildFlaeche`): Kopf, darunter die Kinder in einer Spalte mit
  `gap: grossMass(32)`. Im Großbild des Lagebilds folgen das Band (zwei Reihen) und eine untere
  Reihe mit `flex: 1; minHeight: 0`, deren Blöcke `overflow: hidden` tragen.
  `e2e/grossbild.spec.ts` meldet jeden Block, der seinen Inhalt unten abschneidet.
- Regeln: Schriftgrößen außerhalb der sechs Stufen sind nur über `fernsicht` oder `grossMass`
  erlaubt (ADR-0058, Wächter `theme/schriftLiteral.guard.test.ts`). Einträge, Folge und Wortlaut
  der Alarmzeile entstehen nur in `lage/wasBrennt.ts` (ADR-0057).

## Goals / Non-Goals

**Goals:**

- Dieselbe Zeile wie auf der Seite, im Maß des Großbilds und ohne Bedienung.
- Kein zweiter Abruf und keine zweite Sammlung.
- Kein Bildlauf und kein abgeschnittener Block bei 1920 × 1080 und 1280 × 720.

**Non-Goals:**

- Eine Alarmzeile im Großbild der Lagebesprechung (abgestimmt mit Ruben am 17.11.2026, s. D4).
- Der Umzug des Lagemonitors auf `grossMass`. Er bleibt bei `gross` mit festen 28 px, bis seine
  eigene Folgeaufgabe die Bausteine des Großbilds übernimmt.
- Neue Arten, Wörter oder eine andere Folge.

## Decisions

### D1 Die Seite reicht ihr `useWasBrennt`-Ergebnis hinein

`LagebildGrossbild` bekommt ein Prop `alarm: Pick<WasBrennt, 'eintraege' | 'stand' | 'fehlend'>`,
und die Seite übergibt `wasBrenntDaten`. So steht auf Seite und Großbild zur selben Minute
dieselbe Zeile, und es gibt keinen zweiten Satz an Abfragen. Auch die Uhr ist dieselbe, denn die
Seite urteilt mit ihrem `jetzt`.

- *Den Hook im Großbild selbst aufrufen:* Die Query-Keys sind dieselben, einen doppelten Abruf gäbe
  es also nicht. Trotzdem liefe eine zweite Uhr mit, und das Großbild wiche von seiner Regel ab,
  nichts selbst zu rechnen (Kopf von `LagebildGrossbild.tsx`). Verworfen.

### D2 Dritte Größe `grossbild` in `AlarmZeile`, über `grossMass`

`groesse` nimmt `'normal' | 'gross' | 'grossbild'`. Die Werte von `grossbild` hängen alle an
`grossMass`: Text `GROSS_BEZUG.text` (28), Eintragshöhe 56, Abstand 8, Innenabstand der Einträge
16 und Kante 6. Die Zahlen sind Bezugspixel bei 1920 × 1080. Wie bei `gross` gibt es keine Links,
„+n“ steht als `span` ohne Popover, und der Mauszeiger bleibt normal. Für die Breite misst die
Messreihe weiter; `passend` arbeitet mit `offsetWidth`, also mit den gerechneten Pixeln, und
braucht deshalb keine Änderung.

Die Eintragshöhe 56 entspricht der Mindesthöhe der Knöpfe im Kopf der Fläche (`grossMass(56)`). So
steht die Zeile ruhig unter dem Kopf, und 28 px Text haben Luft. Die ganze Zeile ist damit
56 + 2 · 8 = 72 Bezugspixel hoch.

Damit die Zeile ihre Größen nicht doppelt führt, liest `AlarmZeile` je Größe ein Maß-Objekt
(Schrift, Eintragshöhe, Abstand, Innenabstand, Kante) als CSS-Länge. Für `normal` und `gross`
bleiben die heutigen Werte als `px` stehen, sodass sich dort nichts ändert.

- *`gross` übernehmen (feste 28 px):* Bei 1280 × 720 wäre die Zeile im Verhältnis anderthalbmal so
  groß wie alles andere. Das bricht „Lesbar aus der Entfernung“ („im selben Verhältnis“) und nimmt
  den Blöcken darunter Platz weg. Mit Ruben am 17.11.2026 verworfen.
- *Die Zeile in einen Container mit `transform: scale` setzen:* Messung und Layout liefen dann
  auseinander, und die Kanten würden unscharf. Verworfen.

### D3 Platz: erstes Kind der Fläche, vor dem Band

Die Zeile ist das erste Kind von `GrossbildFlaeche`, mit `flexShrink: 0`, und steht damit direkt
unter dem Kopf, wie auf der Seite unter dem Seitenkopf (`lage-alarmzeile`, „Eine Zeile ganz oben“).
Die Höhe holt sie aus der unteren Reihe, die mit `flex: 1` schrumpft: 72 Bezugspixel Zeile und 32
Fuge, zusammen rund 104 px bei 1080. Ob Gefahren, Verlauf, Sichtung und Stand danach noch in ihre
Blöcke passen, zeigt `findOverflow` im e2e bei beiden Fenstern. Reicht der Platz nicht, sinken
zuerst `VERLAUF_ZEILEN` und `GEFAHREN_HOECHSTENS` um eins, weil „+ n weitere“ den Rest schon ehrlich
nennt. Die Schrift wird nicht kleiner. Weicht das vom abgestimmten Weg ab, lege ich es vorher vor.

**Gemessen beim Bauen (17.11.2026):** Gefahren zeigen jetzt 4 statt 5 Typen, denn mit sieben
Typen und einem langen, unbeurteilten Gebiet schnitt der Hinweis unten ab. Der Verlauf zeigt 3
statt 4 Stunden; gerechnet aus der Zeilenhöhe der Sichtung waren es rund 30 px zu viel. Dazu
schnitt die Sichtung bei den üblichen fünf Zeilen (SK I–IV, „ohne Sichtung“) unten ab, 486 > 414 px
bei 1080. Ruben hat am 17.11.2026 entschieden, dass sie schon ab fünf Zeilen in zwei Spaltenpaaren
steht (`SICHTUNG_EINSPALTIG_HOECHSTENS` 4 statt 5). Verworfen ist die Alarmzeile im Kopf der
Fläche: Sie kostet keine Höhe, aber bei 720p passen dort nur etwa zwei Einträge, und die Hülle
bräuchte einen neuen Platz dafür.

### D4 Keine Alarmzeile im Großbild der Lagebesprechung

Das Großbild zeigt, was seine Seite zeigt („Dieselben Zahlen wie die Seite“), und die Seite
Lagebesprechung trägt keine Alarmzeile. Überfällige Aufträge, Meldungen und Nachforderungen
stehen in den Zeilen der Vorbereitung, und akute Alarme nennt der Kopf der Fläche als Zahl. Die
Lagebesprechung trägt einen festen Stand vor; die Lage liest man im Lagebild.

## Risks / Trade-offs

- **Weniger Platz für die untere Reihe:** Bei 720p schrumpft sie um rund 70 px, und Sichtung mit
  sechs Kategorien oder der Verlauf könnten unten anstoßen. Das e2e prüft das bei beiden
  Fenstern, die Gegenmaßnahme steht in D3.
- **Drei Größen in einem Baustein:** Das Maß-Objekt hält die Werte an einer Stelle, und die Tests
  je Größe sichern ab, dass `normal` und `gross` gleich bleiben.
- **Live-Wechsel:** Kommt ein Eintrag hinzu, misst die Zeile neu, ihre Höhe bleibt aber fest. Der
  Inhalt darunter springt also nicht, genau wie auf der Seite.
