# LFH-616 — Prüfliste Einsatztauglichkeit

Stand: 22.09.2026. Prüfliste nach Festlegung 7 der Bedien-Leitlinie
(`2026-07-25-bedien-leitlinie-einsatzkontexte.md`). Sie gilt für die drei Flächen, die
LFH-616 neu gebaut oder umgebaut hat:

- **A · Messwerkzeug.** Das Lineal im Knopfblock der Lagekarte
  (`pages/lagekarte/KartenUeberlagerung.tsx`) und das Mess-Band im Kartenfuß
  (`pages/lagekarte/MessSteuerung.tsx`).
- **B · ETB-Filter „Einheit“.** Die Auswahl in der Filterzeile des Einsatztagebuchs
  (`pages/EtbPage.tsx`, Gast in `etb/EtbFilterleiste.tsx`).
- **C · „ETB ↗“ an der Einheit.** Der zweite Sprung im Paneel „Ausgewählt“ der Lagekarte
  (`pages/lagekarte/Inspector.tsx`).

Der Satellit ist **keine neue Fläche**. Er ist ein Katalogeintrag (`src/config.rs`) und
erscheint nach der Übernahme als weiteres Segment der bestehenden Kartengrundlage-Leiste.
Er erbt deren Verdikte.

## Verdikte

| # | Kriterium | A · Messen | B · Filter | C · ETB-Sprung |
| --- | --- | --- | --- | --- |
| 1 | Treffläche | **erfüllt** [T1] | **erfüllt** [T2] | **erfüllt** [T2] |
| 2 | Handschuh-Modus | **erfüllt** [T1, E1] | **erfüllt** [T2] | **erfüllt** [T2] |
| 3 | Rückmeldung vor Serverantwort | **erfüllt** [E1] | **erfüllt** [T3] | **nicht anwendbar** |
| 4 | Zweite Handlung bei kritischer Aktion | **nicht anwendbar** | **nicht anwendbar** | **nicht anwendbar** |
| 5 | Kontrast in beiden Modi | **erfüllt** [K1] | **erfüllt** [T2] | **erfüllt** [T2] |
| 6 | Kein Status allein über Farbe | **erfüllt** [T4] | **nicht anwendbar** | **nicht anwendbar** |
| 7 | Eine Farbe = eine Bedeutung | **erfüllt** [Q1] | **erfüllt** [Q1] | **erfüllt** [Q1] |
| 8 | Helligkeits-/Kontrastregler | **offen → querschnittlich** | **offen → querschnittlich** | **offen → querschnittlich** |
| 9 | Kritische Anzeigen im Blickfeld | **nicht anwendbar** | **nicht anwendbar** | **nicht anwendbar** |
| 10 | Alarmbudget | **nicht anwendbar** | **nicht anwendbar** | **nicht anwendbar** |
| 11 | Warnverhalten | **erfüllt** [Q1] | **nicht anwendbar** | **nicht anwendbar** |
| 12 | Kein Sprung unter dem Cursor | **erfüllt** [E1] | **erfüllt** [T3] | **erfüllt** [T5] |
| 13 | Fokus nie verdeckt | **erfüllt** [E1] | **erfüllt** [T2] | **erfüllt** [T5] |
| 14 | Tabellenseite vollständig | **nicht anwendbar** | **nicht anwendbar** | **nicht anwendbar** |
| 15 | Erfassungsmaske vollständig | **nicht anwendbar** | **nicht anwendbar** | **nicht anwendbar** |

### Begründungen

- **1/2 · A:** Das Lineal ist ein `Kartenknopf` mit der Kante aus `kartenKnopfKante`, also
  32 / 48 / 72 px in den drei Dichtestufen (Bestandstest in `KartenUeberlagerung.test.tsx`).
  Die Knöpfe im Band sind antd-`Button` ohne `size` und erben die Staffel vom
  `ConfigProvider`. Für die Handschuh-Bedienung gibt es einen ausdrücklichen Abschluss:
  „Abschließen“ ersetzt den Doppelklick, der mit Handschuh keine verlässliche Geste ist.
  Gesperrt bleibt er, bis ein Messwert steht.
- **1/2 · B, C:** Die Auswahl ist der Projekt-`Select`, der Sprung ein antd-`Button` ohne
  `size`. Beide erben die Staffel. `dichte.guard.test.ts` ist grün.
- **3 · A:** Die Messung rechnet rein clientseitig. Der Wert läuft bei jeder
  Zeigerbewegung mit, noch vor dem Abschluss [E1]. Es gibt keinen Serverweg.
- **3 · B:** Die Wahl schreibt sofort in die URL, die Zeitachse lädt über denselben
  Query-Key wie jeder andere Filter [T3].
- **4:** Messen speichert nichts, der Filter ändert nichts, der Sprung navigiert.
- **5 · A:** Der eingerastete Knopf, gerechnet aus den Tokens in `theme/rollen.css` [K1]:
  Ikone `bedien` auf `flaeche-3` erreicht 5,16 : 1 hell und 5,48 : 1 dunkel. Die blaue
  Innenkante auf `flaeche` erreicht 6,59 : 1 bzw. 5,84 : 1. Das liegt über der Schwelle von
  3 : 1 für Nicht-Text. Der Messwert steht in `rollen.text`.
- **6 · A:** „Messen aktiv“ trägt drei Kanäle: `aria-pressed`, die Innenkante als Form und
  das Band im Fuß mit Wortlaut [T4].
- **7:** Es kommt keine neue Farbe hinzu. `bedien` markiert den aktiven Umschalter wie
  überall. In den neuen Dateien steht kein Hex-Literal [Q1].
- **8:** Das betrifft alle Flächen, keine einzelne (siehe Bedien-Leitlinie).
- **11 · A:** Es gibt kein Blinken. Scheitert der Abschluss, meldet ihn ein
  `message.warning` mit Wortlaut („Mindestens 2 verschiedene Punkte …“).
- **12 · A:** Das Band steht im Fluss des `KartenFuss` (LFH-355). Es liegt über dem unteren
  Kartenrand und schiebt die Karte nicht. Es erscheint auf den Knopfdruck hin, nicht unter
  einem laufenden Zeiger. Der Wert ändert beim Messen nur seinen Text; die Zeile hat einen
  festen Platz im Band [E1]. Nicht gemessen ist, ob der Hinweissatz beim Wechsel
  „zeichnen → gemessen“ auf 390 px anders umbricht.
- **12/13 · C:** „ETB ↗“ steht in einer umbrechenden Zeile neben dem Fachmodul-Sprung. Reicht
  die Breite in der Handschuh-Stufe nicht, bricht er darunter um und wird nicht von der
  scrollenden Karte abgeschnitten [T5].

### Belege

- **[T1]** `KartenUeberlagerung.test.tsx`: Knopfkante über drei Dichtestufen (Bestand),
  Lineal als Umschalter ohne Schreibrecht, Reihenfolge wie im Entwurf S5.
- **[T2]** `dichte.guard.test.ts` grün; keine neue `size`-Angabe an interaktiven Elementen.
- **[T3]** `EtbPage.test.tsx` › „LFH-616: filtert nach der Einheit aus der URL …“.
- **[T4]** `MessSteuerung.test.tsx`, `LagekartePage.test.tsx` › „LFH-616: Messen über den
  Kartenknopf …“.
- **[T5]** `Inspector.test.tsx` › „LFH-616: an der Einheit springt „ETB ↗“ …“.
- **[E1]** `e2e/lagekarte-smoke.spec.ts` › „Messwerkzeug misst Strecke und Fläche …“,
  Chromium mit dem echten terra-draw.
- **[K1]** WCAG-Kontrast aus den Token-Werten von `theme/rollen.css` (hell/dunkel).
- **[Q1]** Quelltextdurchsicht der geänderten Dateien.

## Gemessene Grenzen

- **Die Fläche rechnet eben, nicht streng geodätisch.** Wie die Kennzahlen im Inspector
  (`geo.ts`, LFH-146) rechnet sie mit der Shoelace-Formel in einer lokalen Projektion. Bei
  Einsatzgrößen ist der Fehler vernachlässigbar, bei Landkreis-Maßstab nicht mehr.
- **Der ETB-Filter „Einheit“ trifft über zwei Wege:** über den Auftrag an die Einheit
  (Fremdschlüssel) und über ihren **aktuellen** Namen in von/an. Nach einer Umbenennung
  fallen ältere Freitext-Einträge heraus. Funkrufnamen der Fahrzeuge einer Einheit zählen
  nicht mit. Beides steht am Filter (`src/etb/repo.rs`, `EtbFilter::einheit_id`).
- **Satellit (Esri):** Die Übernahme aus dem Katalog ist eine Entscheidung des Betreibers.
  Laut Esri-Nutzungsbedingungen verlangt ein Produktivbetrieb ein ArcGIS-Konto. Der
  Katalogeintrag trägt deshalb einen `hinweis`, das Modal zeigt ihn als Warnung, und die
  Übernahme kommt **inaktiv** an. Ob der serverseitige Kachel-Cache des Proxys mit der
  eigenen Lizenz vereinbar ist, prüft der Betreiber; der Hinweis nennt es. Offline ist
  Satellit begründet ausgenommen (Begründung am Katalog, `src/config.rs`).
- **Stilwechsel während einer Messung:** Die Messung beginnt in derselben Form neu, ein
  schon gesetzter Wert geht dabei verloren (e2e: „Hell“ mitten in einer Strecke).
