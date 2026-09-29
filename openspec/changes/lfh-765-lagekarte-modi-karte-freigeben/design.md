# Design

## Context

Stand nach LFH-713 (siehe proposal.md, Why):

- `useKartenInteraktion` führt genau einen Modus (`modus.art`: `idle`, `zone`, `abschnitt`,
  `platzieren`, `zeichen`, `bild`, `messen`) und leitet daraus `exklusiverModusAktiv` ab. Das ist
  das einzige Signal „ein Kartenmodus läuft“, und es deckt alle Startwege ab, auch den Deeplink
  `?platzieren=` und den Messknopf der Überlagerung.
- Die Sichtbarkeit der Leiste entscheidet die reine Funktion `leisteSichtbar` in
  `lagekarte/leistenWahl.ts`: Erst kommt `erzwungen`, dann die gemerkte Wahl, dann die Vorgabe.
  `useLeistenWahl` kennt `merke` (gespeichert je Breitenklasse), `zeige` und `verberge` (beide nur
  für die Sitzung).
- `LagekartePage` erzwingt die offene Leiste bei offener Auswahl **und** bei `platzieren`, `bild`
  und `zeichen`, weil deren einziges „Abbrechen“ bzw. „Fertig“ in der Leiste steht.
  `karteFreigeben()` ruft nur beim Start von Zone und Abschnitt aus der Leiste `verberge()` auf.
  Danach bleibt die Leiste für die Sitzung zu.
- Die `<aside>` bleibt beim Ausblenden montiert (`hidden` + `display: none`) und steht auf allen
  Breiten an derselben Stelle im Baum. Suche und Paneelzustand der Sidebar überleben deshalb
  schon heute. Die Rollposition geht unter `display: none` vermutlich verloren; das wird nicht
  zugesichert.
- Zeichnen- und Mess-Steuerung sind Bänder im `KartenFuss` (`bandStil`, Flow statt absolut,
  LFH-355). Ihre Bedienung steht auf jeder Breite dort.

## Goals / Non-Goals

**Goals:**

- Ein Regelwerk für alle Modi, abgeleitet aus dem Modus statt aus einzelnen Startwegen.
- Die Bedienung der Leistenmodi ist unter `lg` ohne Leiste erreichbar, und zwar an genau einer
  Stelle.
- Das e2e belegt je Modus bei 390 und 768 px per Tipp, nicht per Sichtbarkeit.

**Non-Goals:**

- Keine Änderung ab `lg`: Die Leistenmodi behalten dort ihre Bedienung in der Leiste.
- Die Rollposition der Leiste wird nicht wiederhergestellt.
- Keine Verlagerung der Zusatzangaben „Koordinate eingeben“ und „Mittelpunkt numerisch“ in das
  Band. Sie bleiben in der Leiste und sind über „Leiste einblenden“ erreichbar.
- Kein Umbau der Zeichnen- oder Mess-Steuerung.

## Decisions

### D1 · Freigabe aus dem Modus ableiten, nicht beim Start setzen

`leisteSichtbar` bekommt zwei Eingänge: `modusAktiv` (= `exklusiverModusAktiv`) und `imModus`, die
vorläufige Wahl während des Modus. Der Vorrang lautet:

1. `erzwungen` → offen. Dazu zählt die Auswahl immer, die Leistenmodi nur ab `lg`.
2. `!breit && modusAktiv` → `imModus ?? false`.
3. gemerkte Wahl (`vorlaeufig ?? gespeichert`).
4. Vorgabe: offen, außer unter `md`.

`karteFreigeben()` und `verberge()` entfallen. Endet der Modus, fällt Regel 2 weg, und es gilt
wieder Regel 3 oder 4. Das ist die Wiederherstellung, ohne Effekt und ohne Merker für den
vorherigen Zustand.

*Alternative:* bei jedem Start `verberge()` und bei jedem Ende ein Zurücksetzen. Das sind sieben
Startwege und noch mehr Endwege (Esc, Tipp mit Erfolg, Fertig, Abbrechen, Speichern). Der Deeplink
war schon einmal vergessen. Verworfen.

### D2 · Vorläufige Wahl während des Modus endet mit dem Modus

`useLeistenWahl(breit, modusAktiv)` hält `imModus: boolean | null`. Der Kopfknopf unter `lg` ruft
während eines Modus `umschalteImModus()` statt `merke()` auf. Endet der Modus
(`modusAktiv` wechselt auf `false`), wird `imModus` auf `null` gesetzt. Das geschieht per
Vorwert-Vergleich im Render, dem React-Muster „State bei Prop-Wechsel anpassen“, nicht per Effekt.
Beim nächsten Modus startet die Leiste wieder geschlossen.

*Alternative:* `merke()` auch während des Modus. Dann würde ein kurzes Einblenden für die
Koordinateneingabe bei 390 px dauerhaft „offen“ speichern. Das widerspricht der Entscheidung
„vorheriger Zustand“. Verworfen.

*Stift im Modus:* Unter `lg` ruft „Zeichenwerkzeuge“ während eines Modus `umschalteImModus(true)`
statt `zeige()` auf. `zeige()` bliebe dort wirkungslos (Regel 2) und öffnete die Leiste erst nach dem
Modus — gegen „vorheriger Zustand“ (Review-Befund).

*Folge:* `zeige()` („Zeichenwerkzeuge“ über der Karte) setzt außerhalb eines Modus weiterhin `vorlaeufig = true`. Nach
einer so gestarteten Zeichnung ist die Leiste bei 390 px wieder offen, denn das war ihr Zustand
unmittelbar vor dem Modus. Das ist gewollt: Man landet zurück im Paneel „Zeichnen“.

### D3 · Ein Fuß-Band `PlatzierSteuerung` für die drei Leistenmodi, nur unter `lg`

Die neue Komponente `lagekarte/PlatzierSteuerung.tsx` (`data-lfh="platzier-steuerung"`,
`Card` mit `bandStil('mitte')`) folgt dem Muster von `ZeichnenSteuerung`. Sie hat drei Varianten:

- `platzieren`: Titel „Platzieren · <Typ>: <Name>“ (Einsatzort: „Platzieren · Einsatzort“),
  Hinweis „Tipp auf die Karte setzt die Position.“, Knopf „Abbrechen“. Der Name kommt aus
  `nichtVerortetAlle`. Fehlt er (Verschieben eines verorteten Objekts per Deeplink), bleibt der
  Typname stehen.
- `zeichen`: Titel „Taktisches Zeichen“, Schalter „Weitere platzieren“, Zähler „n platziert“,
  primär „Fertig“ ab dem ersten Zeichen, sonst „Abbrechen“. Das ist dieselbe Regel wie in der
  Sidebar.
- `bild`: Titel „Bild einpassen · <Name>“, `Segmentleiste` „Griffe auf der Karte“ und primär
  „Fertig“.

`LagekartePage` hängt das Band nur bei `!breit` in den `KartenFuss`, oberhalb der
Mess-Steuerung. Ab `lg` bleibt der Fuß unverändert.

*Alternative:* das Band auf allen Breiten und die Bedienung aus der Leiste ganz entfernen. Das
ändert das Verhalten ab `lg` und verlängert dort den Fuß, obwohl die Leiste Platz hat. Das liegt
außerhalb des Tickets. Verworfen.

### D4 · Die Sidebar zeigt unter `lg` keine zweite Bedienung

Die Sidebar bekommt die Prop `modusBedienungImFuss` (= `!breit`). Ist sie gesetzt:

- Die aktive Zeile in „Nicht verortet“ und das Paneel „Einsatzort“ zeigen statt des Knopfs
  „Abbrechen“ den Text „wird platziert“.
- Beim Taktischen Zeichen entfallen Schalter, Zähler und „Fertig“/„Abbrechen“. Stattdessen steht
  dort „Bedienung über der Karte.“
- Im Bild-Kasten entfallen Griffwahl und „Fertig“. „Mittelpunkt numerisch“ mit Koordinateneingabe
  und „Mittelpunkt setzen“ bleibt, das ist Leisteninhalt.
- Der Platzier-Hinweis oben mit „Koordinate eingeben“ und „Übernehmen“ bleibt.

So gibt es je Breite genau einen Knopf je Handlung. Das ist die Voraussetzung dafür, dass
Playwright-Locators eindeutig bleiben und ein Vorleser nicht zwei „Abbrechen“ anbietet.

### D5 · Sperre des Kopfknopfs

`leisteSperrGrund` unter `lg`: Nur die offene Auswahl sperrt („Auswahl schließen, um die Leiste
auszublenden“). Ab `lg` bleibt „Platzieren beenden, …“ für die Leistenmodi. Der Knopf im
Knopfblock ab `lg` ist davon nicht betroffen.

### D6 · Nachweis

- **Vitest:** `leistenWahl.test.ts` prüft den Vorrang als Tabelle, bei der jede Zeile eine Regel
  aus D1 kippt. Hinzu kommt `useLeistenWahl` mit Modus-Ende (setzt `imModus` zurück, `merke`
  unberührt, nichts gespeichert). `PlatzierSteuerung.test.tsx` deckt die drei Varianten ab,
  „Fertig“ gegen „Abbrechen“ nach Zähler und die Griffwahl. `Sidebar.test.tsx` prüft, dass mit
  `modusBedienungImFuss` weder „Abbrechen“ noch „Fertig“ noch der Schalter vorhanden ist und der
  Hinweis erscheint. Die Gegenprobe ohne Prop zeigt beide Knöpfe.
- **e2e** `lagekarte-touch.spec.ts`, neues `describe` „Kartenmodi geben die Karte frei“ bei 390
  und 768 px, `hasTouch`, Zeitachse ausgeklappt. Die bestehende Gesten-Schleife 390/1024 bleibt
  unverändert, damit die Gesten nicht dreimal laufen. Je Modus gibt es die Trefferwache
  `aufKarte`, dann den Tipp, dann die Wirkung am Serverstand (Einheitsposition, Freies Zeichen,
  Bildgeometrie) bzw. am Messwert. Die Bänder werden getippt, nicht nur gesehen. Bei 768 px wird
  zusätzlich die Wiederherstellung belegt: Leiste offen mit Suchbegriff, dann Platzieren, dann
  Tipp; danach ist die Leiste offen und der Begriff steht im Feld. Bild: Das Seeding übernimmt der
  Hintergrundbild-Upload aus `e2e/lagekarte-leiste-dichte.spec.ts`. Der Griff „Verschieben“ muss
  per `elementFromPoint` frei liegen, und ein Touch-Zug per CDP ändert die gespeicherten Ecken.

## Risks / Trade-offs

- [Die Rollposition der Leiste geht bei 768 px nach dem Modus verloren] → Das wird als Grenze in
  Non-Goals genannt und nicht zugesichert. Die Suche bleibt; sie trägt den Weg „suchen →
  platzieren“.
- [Das Band plus ausgeklappte Zeitachse bei 390 px ist höher als die freie Karte] → Die Zeitachse
  ist bereits `nachgiebig` (LFH-713) und gibt Höhe ab. Das e2e prüft das Band per Tipp mit
  ausgeklappter Zeitachse.
- [Bild einpassen ist ein Zieh-Modus, kein Tipp-Modus] → „Bedienbar“ heißt hier: Der Griff liegt
  frei, und ein Zug ändert die Geometrie (D6).
- [Die Breite wechselt mitten im Modus über `lg`, etwa beim Drehen eines Tablets] → Regel 1 bzw. 2
  greift sofort für die neue Klasse. `imModus` gilt klassenunabhängig und fällt mit dem Modus. Das
  ist unkritisch, weil die Bedienung je Breite genau einmal da ist (D3/D4).
- [Serienmodus Taktisches Zeichen: Das Band bleibt stehen, bis „Fertig“ getippt wird] → Das ist
  gewollt und identisch mit der Zeichnen-Serie.

## Prüfliste Einsatztauglichkeit (umgebaute Seite: Lagekarte)

| # | Kriterium | Verdikt |
|---|---|---|
| 1 | Treffläche | erfüllt: Das Band nutzt antd-`Button`/`Switch`/`Segmentleiste` in Steuerhöhe (Dichte-Staffel), keine handgebauten Ziele |
| 2 | Handschuh-Modus | erfüllt: Höhen kommen aus dem Dichte-Token; das Band bricht per `wrap` um wie die `ZeichnenSteuerung` |
| 3 | Rückmeldung vor der Serverantwort | erfüllt: Das Schließen der Leiste und das Band erscheinen synchron zum Moduswechsel; die Verortungs-Quittung bleibt |
| 4 | Kritische Aktion mit zweiter Handlung | nicht anwendbar: Platzieren und Abbrechen sind umkehrbar (erneut platzieren), nichts wird gelöscht |
| 5 | Kontrast in beiden Modi | erfüllt: Das Band nutzt dieselbe `Card` und dieselben Rollen wie die Zeichnen- und Mess-Steuerung (bereits gemessen) |
| 6 | Kein Status allein über Farbe | erfüllt: Der Modus steht als Titeltext im Band, „wird platziert“ als Text in der Leiste |
| 7 | Eine Farbe = eine Bedeutung | erfüllt: keine neue Farbe; primär blau nur für „Fertig“ |
| 8 | Helligkeitsregler | nicht anwendbar: seitenübergreifend (LFH-397), nicht berührt |
| 9 | Kritische Anzeigen im Blickfeld | erfüllt: Die Modusbedienung steht über der Karte statt unter ihr in der Leiste |
| 10 | Alarmbudget | nicht anwendbar: keine Alarme |
| 11 | Warnverhalten | nicht anwendbar: keine Warnungen, kein Blinken |
| 12 | Kein Sprung unter dem Cursor | erfüllt: Leiste und Band wechseln nur auf eine Nutzerhandlung (Modusstart oder -ende), nie auf Live-Daten |
| 13 | Fokus nie verdeckt | offen → Folgeticket: Das Band liegt im Fuß-Fluss wie Zeichnen- und Mess-Steuerung, aber kein Fokus-Nachweis betritt unter `lg` einen Kartenmodus (gilt für alle Fuß-Bänder) |
| 14 | Tabellenseite vollständig | nicht anwendbar: keine Tabelle |
| 15 | Erfassungsmaske vollständig | nicht anwendbar: keine Erfassungsmaske; die Koordinateneingabe bleibt unverändert in der Leiste |
