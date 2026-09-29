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

Handprobe am lokalen Dev-Stack (Backend mit `--demo-daten`, Übungseinsatz „ÜBUNG – Starkregen
Musterstadt“, drei Objekte zusätzlich verortet), Vite-Dev-Server, Chromium im Browser-Pane.

| Nachweis | Ergebnis |
| --- | --- |
| Objektsuche, 1366 × 900, kompakt | „Verortet“ zeigt Einheit (2), Unfallhilfsstelle (1), Betreuungsstelle (1), Taktisches Zeichen (1). Die Reihenfolge ist nach Anzahl, dann fest. „schule“ lässt nur „Gesamtschule“ stehen, ein Klick zentriert die Karte darauf und füllt „Ausgewählt“ mit dem Inspector der Betreuungsstelle |
| Picker öffnen, Enter | Fokus nach dem Öffnen im Feld „Grundzeichen suchen“. „pers“ filtert auf „Person“, Enter startet den Platzier-Modus mit „Person“, ein Kartenklick legt das Zeichen an. Danach zeigt „Zuletzt verwendet“ genau „Person“ |
| Inspector, Pfeiltasten | Die gewählte Kachel im Inspector ist fokussiert, dann viermal →. Genau **ein** `PATCH …/freie-zeichen/1` mit dem vierten Zeichen („Kraftfahrzeug geländegängig“). Auch nach dem Echo des Servers und 3 s Nachlauf bleibt es bei einem |
| Handschuh, 1366 px | Raster in 247 px Breite mit **2** Spalten, Kacheln mindestens **122 × 72** px, Suchtreffer **72** px hoch, kein Querlauf im Raster |
| 375 px, komfortabel | Die Leiste steht unter der Karte („Leiste einblenden“). Kein Querlauf der Seite (`scrollWidth − clientWidth = 0`), Suchtreffer **48** px hoch, rechte Kante bei 357 px |
| Befund aus der Probe | Ein Zeichen ohne Bezeichnung heißt in der Suche „(freies Zeichen)“, und „takt“ findet es nicht: gesucht wird nur die Beschriftung, nicht die Objektart. Siehe Nr. 15 |

## Tabelle

| Nr. | Kriterium | Verdikt | Beleg / Begründung | Zielticket |
| --- | --- | --- | --- | --- |
| 1 | **Trefffläche** ≥ 24 × 24 px; zeitkritisch ≥ 48 px mit ≥ 8 px Abstand | **erfüllt** | Treffer der Suche tragen `bedienzielStil` (Höhe `controlHeight` plus Polsterung): „trägt den Trefflächenboden am Eintrag“. Kacheln tragen `kachelStil` mit `controlHeight` in Höhe **und** Breite, geprüft über kompakt und Handschuh: „gibt der Kachel den Trefflächenboden der Dichte-Staffel, in jeder Stufe“. Suchfelder und Knöpfe sind antd-Elemente und erben die Staffel | — |
| 2 | **Handschuh-Modus**: Ziel ≥ 72 px, Abstand ≥ 16 px | **erfüllt, mit Einschränkung beim Abstand** | Kacheln und Treffer haben im Handschuh ≥ 72 px. Das Raster setzt die Spaltenbreite auf mindestens `controlHeight + 2·paddingXS`, in der 300-px-Leiste also zwei Spalten. Der Abstand zwischen Kacheln ist `marginXXS`, weniger als 16 px. Das ist hinnehmbar, weil ein Fehlgriff nur die Auswahl ändert (umkehrbar, nichts geschrieben bis „Platzieren“ bzw. bis die Frist des Inspectors abläuft) [abgeleitet] | — |
| 3 | **Rückmeldung** ≤ 100 ms | **erfüllt** | Suche und Rasterfilter laufen lokal ohne Abfrage, die Auswahl ist sofort als `aria-checked` und Rand sichtbar. Der Inspector sendet nach 600 ms Ruhe, die Auswahl selbst steht sofort da [abgeleitet] | — |
| 4 | **Kritische Aktion hat eine zweite Handlung** | **erfüllt** | Enter startet nur den Platzier-Modus; gespeichert wird erst mit dem Kartenklick, und „Abbrechen“ bleibt davor stehen. Löschen im Inspector ist unverändert | — |
| 5 | **Kontrast in beiden Modi** | **erfüllt [abgeleitet]** | Keine eigenen Farbwerte, die Kacheln nehmen Rollen („färbt die gewählte Kachel …“). Aus den Rollenwerten gerechnet, nicht an zusammengesetzten Paaren im Browser gemessen: Text auf `paneel` 16,93 (Tag) / 16,37 (Nacht), Text auf `flaeche3` 14,48 / 14,74, also über 7 : 1 bzw. 5 : 1. Rand `steuerRahmen` auf `paneel` 3,62 / 3,57 und `bedien` auf `flaeche3` 5,16 / 5,48, also über 3 : 1 (WCAG 1.4.11). Deshalb ist der Ruhe-Rand `steuerRahmen` und nicht `linie` | — |
| 6 | **Kein Status allein über Farbe** | **erfüllt** | Die gewählte Kachel trägt `aria-checked` und den Namen im Text, die Farbe ist zweiter Kanal: „macht die Auswahl maschinenlesbar, nicht nur farblich“. Jede Kachel trägt Bild **und** Namen: „trägt auf jeder Kachel BEIDES“. Im Fehlerfall steht „—“ statt einer Zahl | — |
| 7 | **Eine Farbe = eine Bedeutung** | **erfüllt** | Blau nur als Bedienrand der Auswahl. Kein Rot in den neuen Flächen [abgeleitet] | — |
| 8 | **Helligkeits-/Kontrastregler** | **offen** | App-weite Lücke | LFH-397 |
| 9 | **Kritische Anzeigen im Blickfeld** | **nicht anwendbar** | Suche und Picker sind Werkzeuge auf Anforderung, keine Lageanzeige | — |
| 10 | **Alarmbudget** | **erfüllt** | Keine neue Meldung. Der bestehende Erfolgstoast beim Anlegen bleibt; der Inspector meldet sich nicht je Schreibvorgang [abgeleitet] | — |
| 11 | **Warnverhalten** | **nicht anwendbar** | Keine Warnung, kein Blinken | — |
| 12 | **Kein Sprung unter dem Cursor** | **erfüllt, als begründete Abweichung** | Die Trefferliste folgt Live-Änderungen der Marker ohne Sammelbanner: ein neues Objekt erscheint in seiner Gruppe. Das ist dieselbe Lage wie in der bisherigen UHS-/Schadensliste. Die Liste ist ein Suchergebnis, das man gerade liest, und die Gruppen sind nach Anzahl sortiert. Eine neue Zeile kann eine Gruppe über eine andere heben. Nicht gemessen; wird es bemerkt, ist eine feste Gruppenreihenfolge der kleine Schritt. Im Inspector folgt die Auswahl fremden Änderungen nur, solange nichts Eigenes offen ist: „übernimmt eine fremde Änderung, solange nichts Eigenes offen ist …“ | — |
| 13 | **Fokus nie verdeckt** | **erfüllt [abgeleitet]** | Die Leiste hat keine stehende Kopfzeile über den neuen Zielen, und die Paneelköpfe scrollen mit. Ein Tab-Durchlauf ist nicht maschinell gemessen. Der Picker setzt den Fokus beim Öffnen ins Suchfeld (im Browser gesehen). Der Inspector tut das nicht und nimmt der Karte die Tastatur nicht („nimmt dem Kartenklick nicht den Fokus“) | — |
| 14 | **Tabellenseite vollständig** | **nicht anwendbar** | Keine Tabelle. Die Suche ist eine Liste, weil gesucht und angesprungen wird, nicht verglichen | — |
| 15 | **Erfassungsmaske vollständig** | **erfüllt** | Der Picker ist ein Werteditor ohne `<form>`; die Leiste hält den Platzier-Knopf. Feldbudget: offen liegen zwei Suchfelder, der Rest unter „Details“ mit `forceRender` („lässt offen nur die zwei Suchfelder stehen …“, Paar mit Zählung im Detail). Enter-Vertrag belegt je Weg (Kachel mit echter Tastatur, Suchfeld, Bezeichnung, kein Absenden beim Verlassen). Fokus beim Öffnen im ersten Feld. Der Befund aus der Browserprobe (unbenanntes Zeichen unter „takt“ nicht auffindbar) ist behoben: die Suche nimmt die Objektart mit („findet auch über die Objektart …“) | — |
