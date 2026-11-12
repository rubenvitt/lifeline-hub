# ETB: Schreiben und Lesen (12.11.2026)

Entwurf zu LLH-1841, entstanden aus der UI/UX-Analyse vom 12.11.2026 (LLH-1714). Ruben: „Das ETB
finde ich eigentlich auch fast unbenutzbar.“ Am Fükw (1440 × 900, kompakt) standen 8 Einträge im
Bild, Absender und Empfänger in 10 px grauer Mono-Schrift; Ereigniszeit und Meldeweg lagen hinter
„+ Feld“, und eine gesetzte Ereigniszeit ging verloren, sobald ein weiteres Feld geöffnet wurde
(LLH-1842).

**Stand dieses Ordners:** die Zeichenflächen des Canvas
https://claude.ai/artifact/DfUn2roXXXbt3mL4wuExU8 (Artifact-Typ „Design“, Design System „Lifeline
Hub“). Die Schriften laden die Dateien aus `ds/lifeline-hub/` des Canvas; im Repo liegen sie nicht,
die Flächen fallen hier auf die Systemschrift zurück. **Von Ruben am 12.11.2026 freigegeben („passt
gut so“), noch nicht umgesetzt.**

| Datei                            | Zeichenfläche                                          | Dichte      |
| -------------------------------- | ------------------------------------------------------ | ----------- |
| `Main.dc.html`                   | Vorschlag, Fükw 1440 × 900 (Tweak „modus“: Nacht, Tag) | kompakt     |
| `Heute-Fuekw.dc.html`            | Heutiger Stand als Bildschirmfoto (`heute-fuekw.png`)  | kompakt     |
| `Schreibzeile-Zustaende.dc.html` | Schreibzeile in fünf Zuständen                         | kompakt     |
| `Handy-Lesen.dc.html`            | Handy 390 × 844, lesen, Schreibzeile eingeklappt       | komfortabel |
| `Handy-Schreiben.dc.html`        | Handy 390 × 844, schreiben über der Bildschirmtastatur | komfortabel |

## Was der Entwurf vorschlägt

1. **Schreibzeile in der Reihenfolge des Papier-ETB.** Typ, Zeit, Von, An und Meldeweg stehen als
   feste, beschriftete Felder über dem Inhalt; nichts davon liegt hinter einem Menü. „+ Feld“
   entfällt, es bleiben „+ Veranlassung“, „+ Anhang“ und „+ weiterer Entwurf“ als Textknöpfe.
2. **Der Typ ist eine erkennbare Auswahl** aus vier Segmenten mit Typfarbe, kein Etikett.
3. **Die Vorgabe für Von und An folgt dem Typ.** Meldung: An = eigene Stelle, Von leer und Pflicht.
   Anordnung: Von = eigene Stelle, An leer und Pflicht. Entscheidung und Lage: beide = eigene
   Stelle, in der Leseansicht als „Vermerk EL“ statt „EL → EL“.
4. **Der Fokus steht im ersten leeren Pflichtfeld.** Enter und Tab nehmen den markierten Vorschlag
   und springen in den Inhalt; Freitext nur über den Eintrag „… als Freitext übernehmen“ (LLH-1753).
5. **Eine abweichende Ereigniszeit bleibt sichtbar:** Feld in Achtungsfarbe, „Nachtrag · Ereignis
   vor 14 min“ in der Hinweiszeile, „Erfassen als 1912“ am Sendeknopf (LLH-1842).
6. **„auch in den Meldungseingang“** ersetzt „Nur protokollieren“: positiv formuliert, bei Meldung
   und Lage sichtbar (LLH-1757).
7. **Leseansicht mit Spalten:** Zeit · Nr. · Typ · Von → An · Inhalt · Vermerk. Von → An steht in
   13 px Textschrift, nichts unter 12 px. 14 Einträge im Bild statt 8.
8. **Verweise und Marken stehen in der Spalte „Vermerk“**, nicht als eigene Zeile: „Meldung #5 ↗“,
   „Nachtrag · erfasst 1926“, „berichtigt durch Nr. 231“, „SOFORT“. Ein Lagebericht steht einzeilig
   mit „mehr“.
9. **Systemeinträge sind in der Vorgabe ausgeblendet;** der Umschalter „System 171“ bleibt, der
   Seitenkopf nennt beide Zahlen (LLH-1845).
10. **Die Bilanz zieht in die Filterleiste:** die Zahl je Typ steht am Segment, der Sendestatus
    („alles übertragen“) im Seitenkopf. Das Paneel rechts entfällt (LLH-1848).
11. **Filterleiste und Spaltenkopf kleben** unter dem Seitenkopf (LLH-1846, mit LLH-1727).
12. **Handy:** einzeiliger Kopf mit Einsatzname, Verbindung und Uhr; je Eintrag eine Kopfzeile
    (Zeit, Typ, Von → An) und darunter der Text in voller Breite (LLH-1796). Die Schreibzeile ist
    eingeklappt eine Zeile; geöffnet stehen Typ, Zeit und Weg, Von, An, Inhalt und „Erfassen“
    über der Tastatur.

## Entscheidungen (Ruben, 12.11.2026)

Der Entwurf ist als Ganzes freigegeben; damit gelten die fünf Punkte, die offen waren:

1. **Vorgabe nach Typ (Punkt 3)** ersetzt den Standard-Rufnamen für beide Seiten (LFH-894,
   `etb/standardRufname.ts`). Der Standard-Rufname bleibt die „eigene Stelle“.
2. **Systemeinträge sind in der Vorgabe aus (Punkt 9)**; die Bündelung (LLH-1106) gilt weiter,
   sobald sie eingeblendet sind.
3. **Das Bilanz-Paneel entfällt (Punkt 10)**; Berichtigungen findet man über den Typfilter.
4. **Entwurfsreiter erst ab dem zweiten Entwurf**, „Vorschau“ nur bei Formatierung im Text. Die
   Kurzbefehle (`/typ`, `/zeit`, `@`) bleiben als Beschleuniger, sind aber nie der einzige Weg.
5. **„auch in den Meldungseingang“** ersetzt „Nur protokollieren“ (Punkt 6).

Die Schriftgrößen (Zeit 15, Inhalt 14, Von → An 13, Typ und Vermerk 12 px) gelten für das ETB wie
gezeichnet; die Skala der übrigen App entscheidet LLH-1773. Die Umsetzung braucht eine Change
(Route `entwurf`), die die Regeln in `frontend/src/etb/AGENTS.md` und die Specs fortschreibt.

## Abweichungen von geltenden Regeln

- **Meldungstext unter 50 % der Contentbreite (mit dem Entwurf freigegeben).** Mit offenem Modulpanel bleiben für die Spalte
  „Inhalt“ rund 550 von 1124 px (49 %); `frontend/src/etb/AGENTS.md` verlangt ≥ 50 %
  (`e2e/etb-chronologie.spec.ts`). Grund: Von → An hat eine eigene Spalte.
- **Das Textfeld füllt die Zeile (≥ 60 %)**, weil die Felder in einer eigenen Reihe darüber stehen;
  die Leiste wird dadurch eine Reihe höher (rund 130 px, weiter unter 50 % der Fensterhöhe).
- **Kopfleiste und Rail sind nur skizziert** (voller Einsatzname, Rail-Etiketten 11 px); die
  Entscheidungen dazu gehören zu LLH-1725 bis LLH-1728, nicht zu diesem Entwurf.
- Die Zeichenflächen nutzen Klassen im `<helmet>` statt Inline-Stile, wie der Entwurf
  „Benutzermenü“; maßgeblich sind die Werte dort.
