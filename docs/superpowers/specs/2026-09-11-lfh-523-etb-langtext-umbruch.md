# LFH-523 — Langer Meldungstext bricht im ETB-Tabellenzweig um

Stand: 11.09.2026. Basis `alpha` (d300070). Löst die in der
LFH-463/464-Prüfliste als „Gemessene Grenze" festgehaltene Restfrage ein.

## Befund

`components/KatalogTabelle.tsx` rendert mit `scroll={{ x: 'max-content' }}`.
Die Tabellenbreite ist damit **inhaltsgetrieben**: eine Spalte ohne `width`
trägt ihre volle `max-content`-Breite bei. Ein normal umbrechbarer
Meldungstext mit 209 Zeichen bleibt deshalb einzeilig und verbreitert die
Tabelle, statt umzubrechen. Der Kartenzweig derselben Daten bricht denselben
Text um — der Tabelle fehlte der Deckel, gegen den sie hätte umbrechen können.

Der Rumpf scrollt dabei **nicht**; der Überlauf steckt im Scrollcontainer der
Tabelle. Ein Test, der nur `document.body.scrollWidth` misst, ist gegen diesen
Befund blind und war auf altem Stand grün.

## Entscheidung

Eine Spalte darf `mindestBreite` tragen — sie **fließt**: sie nimmt den Rest
der Breite und bricht um, statt die Tabelle zu verbreitern. Trägt genau eine
Spalte den Haken und haben alle übrigen eine Zahlbreite, rechnet das Primitiv
`Σ(width) + mindestBreite` und setzt **diese Zahl** als `scroll.x`. Antds
`min-width: 100%` bleibt daneben stehen.

**Opt-in, nicht Vorgabe.** Ohne den Haken bleibt jede der achtzehn
Katalogtabellen inhaltsgetrieben wie bisher. Einzige Belegung heute ist die
Inhaltsspalte der ETB-Chronologie mit 320 px.

**Die C7-Zusicherung ist nicht angefasst, und das folgt aus der Rechnung.**
Liegt die Zahl unter der Containerbreite, ist die *benutzte* Breite in beiden
Fassungen dieselbe (`min-width: 100%` gewinnt gegen beide), und die
`auto`-Layoutrechnung verteilt die Spalten identisch. Auseinander gehen die
Fassungen erst, wenn `max-content` den Container übersteigt — also genau im
Befund und nirgends sonst.

**Die Zahl 320 ist gegen die schmalste Fläche gewählt,** auf der die Tabelle
überhaupt steht: unter `xl` (1200 px) sind es Ereigniszeilen, und bei 1200 px
Viewport bleiben gemessen rund 856 px Contentbreite. Mit den vier festen
Spalten (88 + 180 + 130 + 96 = 494) liegt der Deckel bei 814 px und damit
darunter. Eine größere Zahl holte den Überlauf zurück, den das Ticket entfernt.

## Die gemessene Falle: rc-table wählt das Layout selbst

`@rc-component/table/es/Table.js` entscheidet
`if (fixColumn) return mergedScrollX === 'max-content' ? 'auto' : 'fixed'`.
`KatalogTabelle` fixiert Spalte 0 **immer**, `fixColumn` ist also gesetzt —
eine Zahl statt `'max-content'` kippt das Layout still auf `fixed`. Unter
`fixed` ist eine Spaltenbreite **bindend statt bevorzugt**: die 96 px der
ETB-Aktionsspalte schnitten den 72-px-Knopf der Handschuhstufe an, und die
Mindestinhaltsbreite jeder anderen Spalte gleich mit. Das Primitiv setzt
`tableLayout="auto"` deshalb **nur im Zahlfall** mit; bei `'max-content'`
wählt rc-table ohnehin `auto`, und im Sonderfall einer Spaltengruppe an
Position 0 (dann fixiert das Primitiv nichts, und `sticky` führt auf `fixed`)
wäre ein hartes `auto` eine stille Änderung an einer unbeteiligten Tabelle.

Mutationsprobe: ohne das Prop meldet der Vitest-Fall `fixed` statt `auto`.

## Zwei Abbrüche, beide mit Grund statt still

* **Eine Nachbarspalte ohne Zahlbreite** (auch `width: '20%'`, auch eine
  Spaltengruppe): die Summe wäre geraten, und ein geratener Deckel behauptete
  eine Breite, die die Spalte nicht hält.
* **Zwei Fließspalten**: das sind kein Deckel, sondern zwei Reste — welche den
  Überschuss bekäme, entschiede die Layoutrechnung und nicht der Entwurf.

Beide fallen auf das Bestandsverhalten zurück und melden den Grund als
DEV-Warnung. Ein Opt-in, das still nichts tut, wäre von einem kaputten nicht
zu unterscheiden.

## Prüfspur

| Prüfung | RED | GREEN |
| --- | --- | --- |
| `KatalogTabelle.test.tsx` Fließspalte (6 Fälle) | 4 fehlgeschlagen | 30 der Datei bestanden |
| `EtbTabelle.test.tsx` Fließender Meldungstext (4 Fälle) | 3 fehlgeschlagen | 38 der Datei bestanden |
| `e2e/etb-chronologie.spec.ts` LFH-523 (4 Fälle) | 3 fehlgeschlagen | 10 der Datei bestanden |
| Frontend-Vollsuite | — | 3845 bestanden, 2 umgebungsbedingt rot (s. u.) |

**Der RED-Lauf des Browsertests ist gegen zurückgedrehten Produktionscode bei
unverändertem Test gefahren.** Gemessener innerer Überlauf bei 1200 px:
**974 px** (kompakt), **1134 px** (komfortabel), **1178 px** (handschuh) —
dieselbe Größenordnung wie die 1122 px des Tickets bei 1280/handschuh.

**Der C7-Fall unter Langtextlast ist ein Wächter, kein Befundfänger:** mit
zurückgedrehtem Produktionscode bleibt er grün, weil der ungedeckelte Text die
Spalte aufbläht und die ≥ 50 % damit trivial erfüllt. Rot wird allein der
Überlauf-Fall. Die zwei gehören nicht verwechselt.

Die zwei roten Dateien der Vollsuite sind **umgebungsbedingt und
vorbestehend** — beide fallen auf unverändertem `alpha` gleich aus:
`src/etb/EtbFilterleiste.test.tsx` erwartet Europe/Berlin (unter
`TZ=Europe/Berlin` sind es 7 bestandene Tests) und `src/api/kartenbilder.test.ts`
scheitert in `@mswjs/interceptors` an `object.stream is not a function`.

## Was ausdrücklich nicht behauptet wird

Keine allgemeine Überlauffreiheit langer Tabellentexte. Die Deckelung wirkt
genau dort, wo eine Spalte `mindestBreite` trägt — heute allein im ETB. Andere
Tabellen mit langen Texten bleiben inhaltsgetrieben, bis jemand dieselbe
Entscheidung für sie trifft.
