# Prüfliste Einsatztauglichkeit – LFH-648 (Lagekarte, Ebene „Betroffene“)

Grundlage ist Festlegung 7 in `docs/superpowers/specs/2026-07-25-bedien-leitlinie-einsatzkontexte.md`.

Geprüft sind nur die Teile der Lagekarte, die sich geändert haben:

- die Ebenen-Zeile „Betroffene“ (schaltbar oder gesperrt),
- die Sichtungslegende,
- die Personen-Marker mit ihrer Cluster-Quelle,
- der Inspector-Zweig für Personen.

Die übrige Seite hat ihre Prüfliste aus LFH-318/LFH-622. Dieser Change ändert sie nicht.

| # | Kriterium | Verdikt | Beleg / Begründung |
|---|---|---|---|
| 1 | Treffläche | **erfüllt** | Die schaltbare und die gesperrte Zeile verwenden `ebenenZeileStil`, also `minHeight: controlHeight` plus Polsterung. Das sind die zwei Angaben aus LFH-365, dieselben wie bei den zehn Bestandszeilen. Die Staffel 30/48/72 prüft `Sidebar.test.tsx` am Stil. Die Legende ist Satz und kein Bedienziel. Im Inspector ist „Verortung löschen“ ein antd-`Button block` und erbt `controlHeight`. |
| 2 | Handschuh-Modus | **erfüllt** | Siehe 1. Die Zeile folgt der Dichteachse am `ConfigProvider` und hat keine eigene Größenangabe. `dichte.guard.test.ts` ist grün, es gibt kein neues `size="small"`. |
| 3 | Rückmeldung vor der Serverantwort | **erfüllt** | Der Schalter der Ebene ist rein lokal und zeichnet sofort, ohne Serverweg. „Verortung löschen“ hebt die Auswahl sofort auf. Der Marker verschwindet, sobald der PATCH invalidiert. Das ist derselbe Weg wie bei den übrigen Markertypen (Bestand). |
| 4 | Kritische Aktion mit zweiter Handlung | **nicht anwendbar** | „Verortung löschen“ lässt sich umkehren: Die Detailseite bietet „Auf Lagekarte verorten“ an (LFH-613, D8). Nach CLAUDE.md (LFH-363/378) steht deshalb Abstand plus `danger` davor, aber keine Rückfrage. Die Person selbst bleibt bestehen. |
| 5 | Kontrast in beiden Modi | **erfüllt** (neue Elemente), **Bestand offen → LFH-671** | Legende und Grund der gesperrten Zeile verwenden `text2` auf `paneel`, gerechnet aus `tokens.ts`: Nacht 12,1 : 1, Tag 12,0 : 1. Das Schloss ist Dekoration (`schwach`) in `aria-hidden`-Hülle. Das Marker-Kürzel ist schwarz mit weißem Hof auf Sichtungsfarbe, übernommen aus LFH-613. **Bestand:** Ausgeschaltete Ebenen-Zeilen, alle elf und nicht erst seit LFH-648, setzen ihren Namen in `schwach`. Das ergibt im Tagmodus 5,8 : 1 und damit weniger als 7 : 1. |
| 6 | Kein Status allein über Farbe | **erfüllt** | Die Sichtung steht dreifach am Marker: Farbe, Kürzel im Kreis (ohne Mindestzoom) und Plakette „R-042 · SK II“. Die Legende nennt je Kategorie Kürzel und Wort. Die gesperrte Zeile trägt Schloss und Wort, nicht nur eine gedämpfte Farbe. Test: `Sidebar.test.tsx` (Grund im Text und im zugänglichen Namen). |
| 7 | Eine Farbe = eine Bedeutung | **erfüllt** | Sichtungsfarben kommen ausschließlich aus `tokens.ts` (`sichtungsfarben`). SK IV/blau ist die benannte Ausnahme aus LFH-455. Das Farbfeld der Zeile ist bewusst `text2`, nicht `bedien`: Blau bedient. Der Donut-Ton `person` stammt aus LFH-613 (`clusterDonut.ts`) und zeigt die Objektart, nicht die Kategorie. |
| 8 | Helligkeits-/Kontrastregler | **nicht anwendbar** | Der Regler ist in der Leitlinie ausdrücklich an einen eigenen Folge-Task verwiesen („Was diese Leitlinie nicht entscheidet“). Diese Ebene berührt ihn nicht. |
| 9 | Kritische Anzeigen im Blickfeld | **nicht anwendbar** | Die Ebene ist eine Overlay-Wahl in der Leiste und keine kritische Anzeige. Die Marker liegen auf der Karte selbst, im Blickfeld. |
| 10 | Alarmbudget | **nicht anwendbar** | Die Ebene erzeugt keine Alarme. Ein 403 oder ein Ausfall erscheint höchstens im bestehenden Ausfallhinweis, und ein 403 ausdrücklich nicht. |
| 11 | Warnverhalten | **erfüllt** | Nichts blinkt. Kein Ton. |
| 12 | Kein Sprung unter dem Cursor | **erfüllt** | Personen verschieben den Startausschnitt nicht (D3; `useLagekarteDaten.test.tsx`: `alleVerortet` ohne `person`), und die Kopfzahl bleibt gleich (`LagekartePage.test.tsx`). Die Legende erscheint nur auf die eigene Handlung „Ebene einschalten“, nie durch Live-Daten. Neue Personen kommen per Live-Invalidierung als Marker auf die Karte. Auf der Karte ist das kein Listensprung. |
| 13 | Fokus nie verdeckt | **erfüllt** | Es gibt keinen neuen fixierten Kopf und keinen Drawer. Die Zeile steht im Fluss der Leiste. Die gesperrte Zeile ist `disabled` und damit kein Tab-Ziel. |
| 14 | Tabellenseite vollständig | **nicht anwendbar** | Karte, keine Tabelle. |
| 15 | Erfassungsmaske vollständig | **nicht anwendbar** | Keine Erfassung. Verortet wird über den bestehenden Platzier-Auftrag (LFH-613). |

**Browser-Beleg:**

- `e2e/lagekarte-betroffene.spec.ts` prüft als Nicht-Admin:
  - Personen liegen in eigener Quelle und clustern.
  - Die Einheit bleibt ein Einzel-Feature.
  - Der Personen-Donut fächert auf.
  - Mit ausgeblendetem Modul erscheinen kein Feature, keine Zeile und keine Legende.
- `e2e/betroffene-karte.spec.ts` prüft, dass die Kartenansicht der Betroffenen-Seite auf der
  neuen Quelle läuft.
