# Prüfliste Einsatztauglichkeit: Objektsuche und Zeichen-Picker der Lagekarte (LFH-716)

Gate 7 der Bedien-Leitlinie verlangt diese Liste an jeder neuen oder umgebauten Seite.
Umgebaut ist die Lagekarte (`/einsaetze/:id/lagekarte`), und zwar nur die rechte Leiste und
der Inspector eines freien Zeichens: Paneel „Verortet“ (jetzt `MarkerSuche`), Zeichen-Picker
im Paneel „Zeichnen“ und der schreibende `FreiesZeichenInspector`. Alle übrigen Flächen der
Seite sind unverändert.

| Angabe | Wert |
| --- | --- |
| Fläche | Leiste der Lagekarte (300 px ab `lg`, Drawer darunter): „Verortet“, „Zeichnen › Taktisches Zeichen platzieren“, „Ausgewählt“ bei einem freien Zeichen |
| Zielkontext | Fükw (1366 px), Führungs-Tablet in `komfortabel`/`handschuh`, mobil 390 px |
| Stand | Branch `feat/lfh-716-lagekarte-markersuche-zeichenpicker` |

**Verdikte:** **erfüllt** (mit Beleg) · **offen → Zielticket** · **nicht anwendbar** (mit
Begründung). Aus Quelltext Geschlossenes trägt **[abgeleitet]**.

## Nachweise im Browser

BROWSER_NACHWEISE

## Tabelle

| Nr. | Kriterium | Verdikt | Beleg / Begründung | Zielticket |
| --- | --- | --- | --- | --- |
| 1 | **Trefffläche** ≥ 24 × 24 px; zeitkritisch ≥ 48 px mit ≥ 8 px Abstand | **erfüllt** | Treffer der Suche tragen `bedienzielStil` (Höhe `controlHeight` plus Polsterung): „trägt den Trefflächenboden am Eintrag“. Kacheln tragen `kachelStil` mit `controlHeight` in Höhe **und** Breite, geprüft über kompakt und Handschuh: „gibt der Kachel den Trefflächenboden der Dichte-Staffel, in jeder Stufe“. Suchfelder und Knöpfe sind antd-Elemente und erben die Staffel | — |
| 2 | **Handschuh-Modus**: Ziel ≥ 72 px, Abstand ≥ 16 px | **erfüllt, mit Einschränkung beim Abstand** | Kacheln und Treffer haben im Handschuh ≥ 72 px. Das Raster setzt die Spaltenbreite auf mindestens `controlHeight + 2·paddingXS`, in der 300-px-Leiste also zwei Spalten. Der Abstand zwischen Kacheln ist `marginXXS`, weniger als 16 px. Das ist hinnehmbar, weil ein Fehlgriff nur die Auswahl ändert (umkehrbar, nichts geschrieben bis „Platzieren“ bzw. bis die Frist des Inspectors abläuft) [abgeleitet] | — |
| 3 | **Rückmeldung** ≤ 100 ms | **erfüllt** | Suche und Rasterfilter laufen lokal ohne Abfrage, die Auswahl ist sofort als `aria-checked` und Rand sichtbar. Der Inspector sendet nach 600 ms Ruhe, die Auswahl selbst steht sofort da [abgeleitet] | — |
| 4 | **Kritische Aktion hat eine zweite Handlung** | **erfüllt** | Enter startet nur den Platzier-Modus; gespeichert wird erst mit dem Kartenklick, und „Abbrechen“ bleibt davor stehen. Löschen im Inspector ist unverändert | — |
| 5 | **Kontrast in beiden Modi** | **offen** | Keine eigenen Farbwerte: Kacheln aus Rollen (`bedien`, `flaeche3`, `paneel`, `steuerRahmen`, `text`), geprüft in „färbt die gewählte Kachel …“. Der Ruhe-Rand ist bewusst `steuerRahmen` statt des dekorativen `linie` (WCAG 1.4.11). Eine Kontrastmessung im Browser für die Leiste der Lagekarte gibt es nicht | LFH-677 |
| 6 | **Kein Status allein über Farbe** | **erfüllt** | Die gewählte Kachel trägt `aria-checked` und den Namen im Text, die Farbe ist zweiter Kanal: „macht die Auswahl maschinenlesbar, nicht nur farblich“. Jede Kachel trägt Bild **und** Namen: „trägt auf jeder Kachel BEIDES“. Im Fehlerfall steht „—“ statt einer Zahl | — |
| 7 | **Eine Farbe = eine Bedeutung** | **erfüllt** | Blau nur als Bedienrand der Auswahl. Kein Rot in den neuen Flächen [abgeleitet] | — |
| 8 | **Helligkeits-/Kontrastregler** | **offen** | App-weite Lücke | LFH-397 |
| 9 | **Kritische Anzeigen im Blickfeld** | **nicht anwendbar** | Suche und Picker sind Werkzeuge auf Anforderung, keine Lageanzeige | — |
| 10 | **Alarmbudget** | **erfüllt** | Keine neue Meldung. Der bestehende Erfolgstoast beim Anlegen bleibt; der Inspector meldet sich nicht je Schreibvorgang [abgeleitet] | — |
| 11 | **Warnverhalten** | **nicht anwendbar** | Keine Warnung, kein Blinken | — |
| 12 | **Kein Sprung unter dem Cursor** | **erfüllt, als begründete Abweichung** | Die Trefferliste folgt Live-Änderungen der Marker ohne Sammelbanner: ein neues Objekt erscheint in seiner Gruppe. Das ist dieselbe Lage wie in der bisherigen UHS-/Schadensliste. Die Liste ist ein Suchergebnis, das man gerade liest, und die Gruppen sind nach Anzahl sortiert. Eine neue Zeile kann eine Gruppe über eine andere heben. Nicht gemessen; wird es bemerkt, ist eine feste Gruppenreihenfolge der kleine Schritt. Im Inspector folgt die Auswahl fremden Änderungen nur, solange nichts Eigenes offen ist: „übernimmt eine fremde Änderung, solange nichts Eigenes offen ist …“ | — |
| 13 | **Fokus nie verdeckt** | **offen** | Nicht gemessen. Die Leiste scrollt selbst; der Picker setzt den Fokus beim Öffnen ins Suchfeld, der Inspector nicht („lässt den Fokus in Ruhe …“, „nimmt dem Kartenklick nicht den Fokus“) | LFH-100 |
| 14 | **Tabellenseite vollständig** | **nicht anwendbar** | Keine Tabelle. Die Suche ist eine Liste, weil gesucht und angesprungen wird, nicht verglichen | — |
| 15 | **Erfassungsmaske vollständig** | **erfüllt** | Der Picker ist ein Werteditor ohne `<form>`; die Leiste hält den Platzier-Knopf. Feldbudget: offen liegen zwei Suchfelder, der Rest unter „Details“ mit `forceRender` („lässt offen nur die zwei Suchfelder stehen …“, Paar mit Zählung im Detail). Enter-Vertrag belegt je Weg (Kachel, Suchfeld, Bezeichnung, kein Absenden beim Verlassen). Fokus beim Öffnen im ersten Feld | — |
