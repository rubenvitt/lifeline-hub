# Design

## Context

Alle Punkt-Fachebenen laufen durch `sorgeFuerFachebeneLayer` in
`frontend/src/pages/lagekarte/fachebenenLayer.ts`: ein Circle-Layer `fachebene-<key>-circle`
(`circle-radius: ['coalesce', ['get','radius'], 5]`, weißer Rand 1,5 px), bei KRITIS zusätzlich
`-buendel` und `-buendel-zahl`. Hochwasser, Luftqualität und ODL backen `farbe` und `radius` je
Feature ein (`hochwasserStil.ts`, `luftqualitaetStil.ts`, `odlStil.ts`). Der Radius trägt dort die
Stufe. Ein `circle-sort-key` auf dem Radius legt größere, also schlechtere Stufen nach oben. Das ist
bereits umgesetzt, der Kommentar aus dem LFH-79-Review ist damit erledigt.

Für Marker gibt es das Muster schon (LFH-711): eine unsichtbare Kreisebene `*-treffer` mit dem
Durchmesser `token.controlHeight` (30 / 48 / 72 px). MapLibre prüft beim Klick die Geometrie, nicht
die Deckkraft. `entscheideKlickziel` (`klickziel.ts`) ordnet sie als Rolle `treffer` ein: hinter
jedem gezeichneten Punktziel, vor jeder Fläche, und bei Überlappung gewinnt das nächste Merkmal
(`naechstesMerkmal`). Personen-Marker tragen eine Doppelkante, weiß 2 px innen und schwarz 2 px
außen (`KANTE_PAINT`). Sie hält rechnerisch gegen jeden Grund ≥ √21 ≈ 4,58 : 1, belegt per Pixel
in `e2e/betroffene-kontrast.spec.ts` (`markerKante`).

## Goals / Non-Goals

**Goals:**

- Fachebenen-Punkte nach demselben Vertrag anwählbar machen wie Marker, ohne zweite Mechanik.
- Eine Kontur, die ohne Kenntnis der Basemap hält. Online-Styles sind Fremdstile, die der Betreiber
  frei einträgt.

**Non-Goals:**

- Keine Änderung an Farben, Radien oder Stufenbändern der Ebenen.
- Keine Trefferzone für Fachebenen-Flächen (NINA, DWD). Flächen sind groß genug, und für mehrere
  übereinander gibt es das Auswahlmenü (LFH-812).
- Keine Messung gegen die echten Online-Kacheln (OpenFreeMap, basemap.de …). e2e ist hermetisch,
  die Kontur ist so gebaut, dass sie vom Grund nicht abhängt (D3).

## Decisions

### D1 Trefffläche als eigene unsichtbare Kreisebene je Punkt-Fachebene

`fachebene-<key>-treffer`: ein Circle-Layer auf derselben Source, ohne Filter (er deckt also
Einzelpunkte, Client-Bündel und Server-Sammelpunkte ab), `circle-opacity: 0`, Radius
`controlHeight / 2` als **konstanter Paint-Wert**. Er liegt unter Kante und Kreis der Ebene. Den
Staffelwert bekommt `sorgeFuerFachebeneLayer` als Parameter. Bei einem Wechsel zieht ihn derselbe
Weg nach wie die Ebenenfarbe (`zieheEbenenfarbeNach` → setPaintProperty), weil ein Dichtewechsel
keinen Layer neu anlegt.

Verworfen:

- **Pufferabfrage** (`queryRenderedFeatures` mit Kasten um den Klickpunkt): Sie bräuchte einen
  zweiten Abfrageweg in `klickzielAm` neben dem Marker-Muster. Der Mauszeiger-Hinweis
  (`mouseenter`) hinge weiter am kleinen Kreis, und e2e könnte die Fläche nicht als Merkmal am
  Punkt nachweisen.
- **Dichtestufe als Radiusfaktor**: Das vermischt Trefffläche und Bedeutung. Im Handschuh-Modus
  wären alle Punkte mindestens 36 px groß, die Karte liefe zu, und Stufenunterschiede von 3 px
  gingen unter.

### D2 Eigene Rolle `fachebeneTreffer`, gleichrangig mit der Marker-Trefferzone

`ordneKlickebene` erkennt `^fachebene-.+-treffer$` als `fachebeneTreffer`. In
`entscheideKlickziel` gilt:

- Ein gezeichnetes Markerzeichen oben: wie bisher das nächste aus `marker` und `treffer`. Eine
  Fachebenen-Zone zählt dort **nicht** mit, sonst käme sie als `art: 'marker'` zurück.
- Kein gezeichnetes Punktziel: das nächste Merkmal aus `treffer` und `fachebeneTreffer`. Die Rolle
  des Gewinners bestimmt die Art, also `marker` oder `fachebene`.

`fachebeneClickLayerIds` liefert die Treffer-ID mit. Damit hängen Klick und Mauszeiger an ihr, und
die bestehende Wache `gewinner.merkmal.layer.id !== id` lässt je Tipp genau einen Hörer handeln. Die
Properties des Treffer-Merkmals stammen aus derselben Source, also entscheidet
`entscheideFachebeneKlick` Bündel und Sammelpunkt unverändert, und `werteFachebenenKlickAus` findet
die volle Geometrie.

Verworfen: **Marker-Zone vor Fachebenen-Zone.** Neben einem Fahrzeug wäre ein Pegel dann nur noch
über seinen 6-px-Kreis zu treffen, und genau das soll LFH-600 beheben. „Nächster gewinnt“ ist die
Regel, die LFH-711 für dicht liegende Marker schon festgelegt hat.

### D3 Doppelkante wie bei Personen, unter dem Punkt

Neue Ebene `fachebene-<key>-kante` (und `-buendel-kante` für KRITIS) direkt unter dem Kreis:
schwarz, Radius = Zeichenradius + 4. Der weiße Rand am Kreis wächst von 1,5 auf 2 px. Weiß und
Schwarz nebeneinander halten gegen jeden Grund max(K(weiß, g), K(schwarz, g)) ≥ 4,58 : 1. Das
Auge braucht nur eine der beiden Linien. Die Kantenebenen sind **keine** Klickebenen
(`ordneKlickebene` → `null`), die Trefferzone deckt sie ohnehin ab. Sie übernehmen den
`circle-sort-key` des Kreises.

`'#000'` statt eines Tokens, aus demselben Grund wie bei den Personen: Die Kante ist eine Kontur,
keine Statusaussage.

Verworfen:

- **Randfarbe je Kartentheme** (dunkel auf heller Karte, hell auf dunkler): Das hängt an der
  Annahme, dass der Theme-Schalter die Helligkeit des Grunds trifft. Bei Satellit und
  TopPlusOpen stimmt sie nicht.
- **Nur messen, nichts ändern**: Ein weißer Rand auf `#f5f5f3` liegt bei etwa 1,1 : 1 und ein
  gelber Achtungskreis auf Weiß unter 3 : 1. Die Messung fiele durch.

### D4 Nachweise im Browser, Literale statt Tokens

- **Trefffläche** (`e2e/gate3-trefflaeche.spec.ts`, neuer Block): Die sieben Punkt-Endpunkte
  werden per `page.route` hermetisch beantwortet, mit je einem Punkt an getrennten Koordinaten,
  Hochwasser und Luftqualität mit zwei Stufen. Je Dichtestufe gilt: Vorbedingung „am Versatz nichts
  gezeichnet“, Merkmal der Treffer-Ebene am Versatz, Klick öffnet die Detailansicht der richtigen
  Ebene, und in `kompakt` die Gegenprobe außerhalb. Die Böden stehen als Literale (30 / 48 / 72),
  wie im Kopf der Spec festgelegt.
- **Radius-Kanal**: Am Versatz zwischen kleinem und großem Zeichenradius meldet
  `queryRenderedFeatures` auf `-circle` den großen Punkt und nicht den kleinen, in `kompakt` und in
  `handschuh` gleich.
- **Kontrast** (neue Spec `e2e/fachebenen-kontrast.spec.ts`): Pixelausschnitt um die Kreismitte wie
  bei `markerKante`, über einen Strahl Rand und Kante gegen den Grund. Die Grundlagen sind blind hell
  und dunkel, offline (Fixture-Region, Grund aus dem Offline-Stil) und online (Fixture-Stil mit den
  Extremgründen `#ffffff` und `#000000` sowie dem hellsten und dunkelsten Flächenton der Palette).
  Die Pixel-Dekodierung wandert aus `betroffene-kontrast.spec.ts` in einen geteilten Kern
  (`e2e/karten-pixel-kern.ts`), denn eine Kopie würde still auseinanderdriften (Kopf von
  `kontrast-kern.ts`). Die Füllfarbe gegen den Grund wird mitgeschrieben, als Messwert für die
  Prüfliste, nicht als Schwelle.

### D5 Prüfliste

`pruefliste.md` in dieser Change mit allen 15 Zeilen der Festlegung 7, die Zeilen 1, 2 und 5 mit
den gemessenen Werten aus den e2e-Anmerkungen. In der archivierten LFH-79-Prüfliste bekommen die
Zeilen 1, 2 und 5 einen Nachtrag „erfüllt durch LFH-600“ mit dem Pfad. Der Text des Verdikts bleibt
stehen, damit nachlesbar ist, was damals offen war.

## Risks / Trade-offs

- [Eine 72-px-Zone um jeden Pegel überdeckt Warnflächen] → Gewollt und spec-konform: Eine
  Trefferzone schlägt jede Fläche. Die Warnung bleibt außerhalb der Zonen anwählbar, und bei dichten
  Pegeln hilft das Hineinzoomen. Ein Szenario in `lagekarte-klickziele` hält das fest.
- [Mauszeiger „pointer“ über einer großen unsichtbaren Fläche] → Entspricht den Markern, ein Klick
  dort wählt tatsächlich etwas.
- [Mehr Layer je Ebene (Treffer und Kante)] → `layerIds` räumt sie mit auf. Dass sie nach `setStyle`
  wieder entstehen, sichert der bestehende Weg über `sorgeFuerFachebeneLayer`, ein Unit-Test prüft
  die Idempotenz.
- [Die Kreise werden 2,5 px größer (weißer Rand 2 statt 1,5, Kante 2)] → Das gilt für alle Stufen
  gleich. Die Stufenabstände bleiben, das Szenario „Zwei Hochwasser-Stufen“ prüft es.
- [Kantenglättung verfälscht die Pixelmessung bei DPR 1] → Je 2 px wie bei den Personen. Dort war
  1,5 px nicht messbar.
