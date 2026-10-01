# Design

## Context

Motivation: `proposal.md`, Why. Anforderungen: die beiden Deltas unter `specs/`.

Heutiger Stand:

- `personen/BetroffeneKarte.tsx` rechnet die Marker per `personenMarker(personen, token)` in einem
  `useMemo` über `personen`. `PersonenPage` reicht die gefilterten Zeilen durch. Jedes
  Live-Ereignis `Person` invalidiert `einsatzKeys.personen`, das Nachladen liefert ein neues Array,
  also neue Marker, auch wenn sich nur ein Zustandstext einer Person ohne Koordinate geändert hat.
- Die Personen der Betroffenen-Karte tragen keine `clusterQuelle`. Sie clustern deshalb in
  `marker-cluster` (`clusterRadius: 45`, `clusterMaxZoom: 14`), und ihre Bündel sind DOM-Donuts.
- `pages/lagekarte/Kartenflaeche.tsx`, Marker-Effekt: bei jeder Änderung von `markers` → `setData`,
  alle DOM-Donuts verwerfen, `schliesseSpiderRef.current()`. Der Spider-Controller öffnet über
  `getClusterLeaves` und `baueSpiderFc`. Jedes Blatt ist ein Feature mit den Marker-Eigenschaften
  (darunter `schluessel`) an einer aus dem Bündelmittelpunkt berechneten Lage. Die Hülle des
  offenen Donuts ist durchlässig (`setzeHuelleDurchlaessig`, LFH-650).
- Das Vorbild ist die Zeilenschleuse der `Datensicht` (`components/Datensicht.tsx`, `Zufluss
  'sammelbanner'`). Solange der Fokus in der Sicht liegt, sind Zeilenmenge und Folge eingefroren,
  Zellinhalte kommen frisch, und neue Zeilen zählt ein Knopf in der Werkzeugzeile („n neue Einträge
  — anzeigen“). Verlässt der Fokus die Sicht, gilt der Live-Stand. Ein Overlay im Portal zählt nicht
  als Verlassen.

## Goals / Non-Goals

**Goals:**

- Kein Zielwechsel unter dem Zeiger durch fremde Schreibzugriffe auf der Betroffenen-Karte,
  weder durch Verschmelzen noch durch ein zuklappendes Bündel.
- Dieselbe Bedienlogik wie in der Liste. Wer die Datensicht kennt, erwartet hier nichts anderes.
- Sichtungsänderungen bleiben sofort sichtbar. Die Karte zeigt nie einen älteren Sichtungsstand
  als die Liste.

**Non-Goals:**

- Keine Schleuse auf der Lagekarte. Dort bewegen sich Fahrzeuge live, die Eigenposition läuft
  mit, und ob gehaltene Lagen dort tragbar sind, ist eine eigene Entscheidung. Die Lagekarte
  bekommt nur den Spider-Schutz bei reiner Inhaltsänderung (D5), weil er nichts zurückhält.
- Keine Änderung an `clusterRadius`/`clusterMaxZoom` oder an der Generalisierung.
- Kein Schutz für einen einzelnen Touch-Tipp ohne aufgefächertes Bündel (Risiken).

## Decisions

### D1 Die Schleuse sitzt in der Betroffenen-Karte, ihre Logik ist rein

Neue Datei `personen/kartenSchleuse.ts` mit einer reinen Funktion, sinngemäß
`schleuse(gehalten: readonly KarteMarker[] | null, frisch: readonly KarteMarker[])
→ { gezeigt: KarteMarker[]; wartend: { neu: number; verlegt: number; entfallen: number } }`:

- `gehalten === null` (Schleuse offen) → `gezeigt = frisch`, nichts wartet.
- Sonst läuft sie über `gehalten` in dessen Folge. Gibt es den Schlüssel frisch, nimmt sie den
  frischen Marker mit `lat`/`lon` aus `gehalten`, sonst den gehaltenen Marker mit seinem letzten
  Inhalt (entfallen).
- `neu` = frische Schlüssel, die nicht gehalten sind. `verlegt` = beide vorhanden, aber eine
  andere Lage. `entfallen` = gehaltene Schlüssel, die frisch fehlen.

`BetroffeneKarte` hält `gehalten` im State. Beim Schließen der Schleuse übernimmt es den gerade
gezeigten Stand. Beim Öffnen setzt es `null`, auf „anzeigen“ den frischen Stand, und die Schleuse
bleibt dabei zu, weil der Zeiger noch drin ist (wie der `'neu'`-Auftrag der Datensicht).
`gezeigt` geht als `markers` an `Kartenflaeche`. Bleibt alles gleich, muss es referenziell gleich
bleiben (`useMemo`), sonst liefe der Marker-Effekt ohne Grund.

*Alternative verworfen:* die Schleuse in `Kartenflaeche` als allgemeine Prop. Damit hinge die
Lagekarte an einer Entscheidung, die für sie nicht getroffen ist (Non-Goals), und die Logik wäre
nur noch mit WebGL prüfbar.

### D2 Wann die Schleuse zu ist

Zu, solange mindestens eine der drei Bedingungen gilt. Sie gelten für den ganzen Bereich
`data-lfh="betroffene-karte"` (Kopfzeile und Karte):

1. **Zeiger:** `pointerenter`/`pointerleave` mit `pointerType` `mouse` oder `pen`. Touch zählt
   nicht. Ein Tipp erzeugt Ein- und Austritt um den Tipp herum, und ein haftendes „drin“ nach
   einem Wisch hielte den Stand ohne Grund. Auch die erste `pointermove` im Bereich zählt als
   Betreten: Erscheint die Ansicht unter einem ruhenden Zeiger, meldet Chrome beim nächsten
   Bewegen kein `pointerenter` (Befund aus dem e2e-Lauf bei 390 px).
2. **Fokus von der Tastatur:** `focusin`/`focusout` mit der `contains`-Prüfung der Datensicht
   (Kartenknöpfe, Banner-Aktion). Ein Fokus bis 1 s nach einem `pointerdown` im Bereich zählt
   nicht. MapLibre gibt dem Canvas `tabindex=0`, also fokussiert jeder Klick oder Tipp ihn, und
   sonst bliebe die Karte nach dem Verlassen gehalten (Review). Bei Touch kommt das kompatible
   `mousedown` erst nach `pointerup`, deshalb ein Zeitfenster. `:focus-visible` wäre genauer, ist
   aber in jsdom nicht prüfbar. Entfernt ein Render den fokussierten Knoten (der Knopf
   „anzeigen“), kommt kein `focusout` an. Ein Layout-Effekt räumt die Bedingung deshalb nach
   jedem Render, wenn der Fokus nicht mehr im Bereich liegt. „anzeigen“ setzt den Fokus vorher
   auf die Standzeile (`tabIndex={-1}`, WCAG 2.4.3).
3. **Auffächerung:** `Kartenflaeche` bekommt die optionale Prop `onSpiderOffen(offen: boolean)`.
   Sie meldet `true`, sobald die Blätter stehen, und `false` beim Zuklappen. Das ist der
   Touch-Fall: wer aufgefächert hat, will gleich ein Blatt treffen.

Der Banner liegt im Bereich, also taut der Weg vom Marker zum Banner nicht auf. Filter und
Ansichtswechsel liegen außerhalb, also ist die Schleuse offen, wenn sie bedient werden. Die eine
Ausnahme ist ein aufgefächertes Bündel, denn es hält ohne Zeiger. Ein `pointerdown` außerhalb des
Bereichs (Capture-Phase) klappt es deshalb über `KartenHandle.klappeSpiderEin()` ein und räumt die
Bedingung, bevor der Klick wirkt (Review).

### D3 Gehalten werden Menge, Folge und Lage, nicht der Inhalt

Inhalte fließen (Goals): Sichtungsfarbe, Kurzzeichen und Beschriftung kommen frisch. Die Menge
UND die Folge bleiben gehalten, weil die Cluster-Zuordnung von beiden abhängt. Bei gleicher
Eingabe liefert die Clusterbildung dieselben Bündel und Kennungen, und erst damit greift D5.

**Entfallene bleiben stehen.** Das weicht von der Datensicht ab, in der eine verschwundene Zeile
sofort fehlt. Auf der Karte kann ein Wegfall ein Bündel unter dem Zeiger aufspalten oder seinen
Donut verschwinden lassen, und genau das ist der verbotene Sprung. Der Banner nennt sie als
entfallen, und das Verlassen oder „anzeigen“ räumt sie. Eine stornierte Person steht also für die
Dauer des Zeigens noch da. Die Karte schreibt nicht, und der Banner sagt es.

*Alternative verworfen:* auch den Inhalt einfrieren. Das wäre einfacher, weil `Kartenflaeche`
unberührt bliebe, aber die Karte zeigte beim Zeigen einen alten Sichtungsstand, anders als die
Liste. Für eine Sichtungskarte ist das der falsche Tausch.

### D4 Kopfzeile mit eigener Standzeile fester Höhe

Die Kopfzeile bekommt unter der Hinweiszeile eine **Standzeile**, die immer da ist und eine feste
Höhe hat: `controlHeight` plus der Innenabstand des Sammelbanners. Damit verschiebt ihr Wechsel
die Karte nie. Inhalt:

- Schleuse offen: ruhiger Text „Live“ (`gedaempft`).
- Schleuse zu, nichts wartet: „Live pausiert“ (`gedaempft`). Er sagt, warum gerade nichts
  springt (Wortlaut vom Menschen bei der Freigabe gekürzt).
- Etwas wartet: der `Sammelbanner` mit „2 neu · 1 verlegt · 1 entfallen“ (nur Teile > 0) und
  der Aktion „anzeigen“, einzeilig (`flexWrap: 'nowrap'`, Text mit Ellipse und `title`). Bei
  390 px passt das längste realistische Muster (zwei Ziffern je Teil plus Knopf) in eine Zeile.

Nur der Banner trägt `role="status"`. Die ruhigen Texte wechseln beim bloßen Überfahren und
würden sonst jedes Mal angesagt.

*Alternativen verworfen:* den Banner als Overlay auf der Karte zeigen. Er erschiene dort, wo der
Zeiger gerade ist, und wäre selbst ein Zielwechsel. Den Knopf rechts in die Hinweiszeile setzen
wie in der Werkzeugzeile der Datensicht: bei 390 px bricht der Hinweis dann um, und die Zeile
wächst. Den Banner unter die Karte setzen: auf dem Fükw läge er unterhalb des Bildschirms. Die
Standzeile kostet eine Zeile Höhe, und das ist der Preis für eine Karte, die nie springt.

### D5 Kartenflaeche: der Spider überlebt eine reine Inhaltsänderung

Im Marker-Effekt prüft eine reine Funktion `nurInhaltGeaendert(alt, neu)` die clusterbaren
FeatureCollections (`baueMarkerFc`): gleiche Anzahl, gleiche `schluessel` in gleicher Folge,
gleiche Koordinaten je Stelle. Ist das so und ein Spider offen:

- `setData` wie bisher, die Donuts werden wie bisher verworfen, weil sich die Zusammensetzung der
  Ringe geändert haben kann.
- Der Spider **bleibt offen**. Eine reine Funktion `aktualisiereSpiderBlaetter(blaetter, neu)`
  behält die Geometrie jedes Blatts und übernimmt die Eigenschaften des neuen Features mit
  demselben `schluessel`. Die Beinchen bleiben, `setzeSpiderDaten` schreibt beides.
- Der Donut des offenen Bündels entsteht im `render`-Abgleich neu. Ist seine Kennung die des
  offenen Spiders, wird die Hülle sofort wieder durchlässig, sonst fingen 72 px Hülle im
  Handschuh-Modus den Tipp auf die Blätter ab (LFH-650-Befund).

Verglichen wird im vertagten Zweig von `wendeKartenDatenAn` mit dem zuletzt EINGESPIELTEN Stand
(`markerAngewandtRef`), und die Donuts werden dort ein zweites Mal verworfen. Bis zum vertagten
`setData` baut der `render`-Abgleich sie sonst aus dem alten Quellstand nach. Ein Spider, dessen
`getClusterLeaves` während einer reinen Inhaltsänderung läuft, gleicht seine Blätter vor dem
Malen mit dem aktuellen Stand ab (Review).

Sonst schließt der Spider wie bisher. Das gilt unverändert auch auf der Lagekarte. Dort hält
nichts die Menge, also klappt ein Zugang weiter zu, eine Statusänderung aber nicht mehr.

*Alternative verworfen:* nach dem `setData` per `getClusterLeaves` neu auffächern. Das ist
asynchron, es gäbe einen Bildaufbau ohne Blätter (Flackern unter dem Zeiger), und es hängt an
Kennungen aus dem Worker. Das Umschreiben der Eigenschaften ist synchron und rein.

### D6 Hinweiszeile

`ohneKoordinateText(anzahl, verortet, wartendNeu)`: Bei `anzahl === 0` und `wartendNeu > 0`
heißt es „Keine Person ohne Koordinate“ statt „Alle … stehen auf der Karte“. `anzahl` kommt aus
dem frischen Stand. Die Zahl der Personen ohne Koordinate ist keine Kartengeometrie, also gibt es
keinen Grund, sie zu halten.

### D7 Nachweise

- Vitest: `personen/kartenSchleuse.test.ts` (offen, Zugang, Verlegung, Wegfall, Inhalt fließt,
  Folge bleibt, referenzielle Gleichheit bei gleichem Input), `pages/lagekarte` für
  `nurInhaltGeaendert` und `aktualisiereSpiderBlaetter`. Die Bereichs- und Bannerlogik von
  `BetroffeneKarte` wird über `PersonenPage.test.tsx` oder einen eigenen Test mit gemockter
  `Kartenflaeche` geprüft (Pointer-, Fokus-, Spider-Meldung, „anzeigen“).
- e2e (Muster `e2e/betroffene-layout.spec.ts`, Seeding per `page.request` = fremder Schreibzugriff
  über den Live-Strom):
  1. Die Maus liegt auf Marker A, live kommt Person B wenige Meter daneben. A bleibt am Zeiger
     Einzelmarker, kein Donut, der Banner nennt „1 neu“, ein Klick öffnet A. Nach dem Verlassen
     steht der Donut. Mutationsprobe: mit offener Schleuse rot.
  2. Ein Bündel ist aufgefächert, live wechselt die Sichtung eines Blatts. Der Spider bleibt offen,
     das Blatt zeigt das neue Kurzzeichen, ein Tipp öffnet die Person. Mutationsprobe: ohne D5 rot.
  3. Der Banner erscheint und verschwindet bei 390 und 1366 px: die Oberkante der Karte bleibt
     gleich (Δ 0 px), der CLS-Beitrag ist 0.

## Risks / Trade-offs

- [Touch ohne Auffächerung hat kein Hover] → Ein Zugang genau im Moment eines Tipps kann noch
  verschmelzen. Der Tipp trifft dann den Donut, und der fächert auf. Die Karte schreibt nicht,
  der Schaden ist ein Tipp mehr. In der Prüfliste als Rest benannt.
- [Eine ruhende Maus hält den Stand beliebig lange] → Der Banner sagt, was wartet, und die
  Standzeile sagt, dass gehalten wird. Das entspricht der Datensicht, die ebenso hält, solange der
  Fokus drin ist.
- [Stabile Bündel-Kennungen nach `setData`] → D5 setzt voraus, dass gleiche Eingabe dieselben
  Kennungen liefert (die Clusterbildung ist deterministisch). Hält das nicht, öffnet der nächste
  Klick auf den Donut ein „anderes“ Bündel statt zuzuklappen. Das ist harmlos, und e2e 2 fängt es,
  weil dort nach der Änderung ein Tipp auf das Blatt folgt.
- [Eine stornierte Person steht kurz noch da] → D3, mit Wortlaut „entfallen“ im Banner.
- [Die Standzeile kostet Höhe] → D4, bewusst getauscht gegen null Verschiebung.

## Migration Plan

Reines Frontend ohne gespeicherten Zustand. Ausrollen mit dem nächsten Build, zurück per Revert.
