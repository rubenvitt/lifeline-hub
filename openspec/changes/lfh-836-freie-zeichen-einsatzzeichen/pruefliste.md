# Prüfliste Einsatztauglichkeit: freie Zeichen über @einsatzzeichen (LFH-836)

Geprüft wurden die Flächen, die sich ändern:
- Zeichen-Picker (`FreiesZeichenPicker.tsx`, `zeichenWahl.ts`) in der Leiste, im Dialog „Zeichen
  hier setzen“ und im Inspector.
- Freie Zeichen auf der Lagekarte (Marker über den `ez|`-Weg).
- Inspector eines freien Zeichens: Symbolkachel, Hinweis „vereinfacht dargestellt“.

Die Kriterien stehen in Festlegung 7 von
`docs/superpowers/specs/2026-07-25-bedien-leitlinie-einsatzkontexte.md`. Geprüft am 11.10.2026 in
Vitest, e2e (Chromium) und per Sichtprüfung. Für die Sichtprüfung lief der e2e-Stack (Backend und
Vite) mit eigens angelegten Zeichen, fotografiert mit Playwright bei Pixeldichte 2, Viewport
1440 × 1100, in beiden Modi. Die Bilder liegen unter `screenshots/`. Die Picker-Kosten stehen in
`messung.md`, Abschnitt „Kosten des Pickers im echten Browser“.

| # | Kriterium | Verdikt | Beleg / Begründung |
|---|---|---|---|
| 1 | Treffläche | erfüllt | Kacheln haben die Steuerhöhe der Staffel als Boden in Höhe und Breite (`kachelStil`, Test „gibt der Kachel den Trefflächenboden der Dichte-Staffel, in jeder Stufe“ in `FreiesZeichenPicker.test.tsx`, 30/48/72 px). Die Trefferzone der Marker (`trefferDurchmesser = controlHeight`) ist unverändert; `e2e/gate3-trefflaeche.spec.ts`, `e2e/gate1-ueberlauf.spec.ts` und `e2e/lagekarte-leiste-dichte.spec.ts` (Lagekarten-Fälle, 11 Tests) sind grün. |
| 2 | Handschuh-Modus | erfüllt | Kachel- und Knopfboden folgen der Staffel bis 72 px (`kachelStil`-Test, Stufe `handschuh`); die Raster bleiben je ein Tabstopp mit Pfeiltasten. Die Zeichengröße auf der Karte ist bewusst fest (34 CSS-px, Spec `lagekarte-taktische-zeichen`). |
| 3 | Rückmeldung vor der Serverantwort | **offen → Befund Picker-Kosten** | Karte: das freie Zeichen steht sofort nach dem Platzieren als `ez|`-Bild, ohne weiteres Neu-Layout (`e2e/lagekarte-smoke.spec.ts`, „ein platziertes freies Zeichen steht sofort …“). Picker: Wiederholte Wechsel brauchen rund 20 ms; der **erste** Wechsel auf eine neue Grundzeichenart braucht im Browser rund 0,4–0,6 s, das Öffnen rund 0,8 s (`messung.md`). Das liegt über der 100-ms-Grenze für sichtbare Rückmeldung (die Kachel wird erst danach als gewählt markiert). Entscheidung zum Vorausberechnen je Art steht aus (design.md, Risiko „Picker-Kosten“). |
| 4 | Kritische Aktion mit zweiter Handlung | erfüllt | Löschen eines freien Zeichens fragt mit rotem „Löschen“ nach (unverändert, `FreiesZeichenInspector.test.tsx` „,Löschen' fragt erst nach …“). Platzieren ist umkehrbar und braucht keine Rückfrage. |
| 5 | Kontrast in beiden Modi | **offen → LFH-833** | Tagmodus: Konturen schwarz auf hellem Grund, gut lesbar (`screenshots/karte-freie-zeichen-tag.png`, `picker-*-tag.png`). Nachtmodus: Zeichen ohne Füllung (Formation ohne Organisation, leitergebundene „Sprache“, Einsatzort-„V“, Kachelbilder im Picker) zeichnen schwarz auf dunklem Grund und verschwinden fast (`karte-freie-zeichen-nacht.png`, `picker-mit-grundzeichen-nacht.png`, `inspector-ohne-fuellung-nacht.png`). Die Kachelnamen tragen die Bedeutung; der Rahmen der Inspector-Kachel nimmt ohne Füllung die Textrolle (`FreiesZeichenInspector.test.tsx`, Nachtmodus). Die Lösung liegt nach Entscheidung vom 29.09.2026 in der Bibliothek (dunkles Render-Theme, LFH-833), wie bei LFH-835. |
| 6 | Kein Status allein über Farbe | erfüllt | Jede Kachel trägt Bild und Namen (Test „trägt auf jeder Kachel BEIDES“); die Wahl ist `aria-checked` plus Bedienrand (Test „macht die Auswahl maschinenlesbar“). Die Palettenfarbe steht unter „Details“ als Name mit Farbfeld (Test „zeigt die Palettenfarbe als Feld neben dem Namen“). Varianten unterscheiden sich im Namen („(Funk)“, „(Draht)“, „(zweite Darstellung)“), nicht nur im Bild. |
| 7 | Eine Farbe = eine Bedeutung | erfüllt | Farben nur aus der festen Palette der Bibliothek und nur, wo das Zeichen eine Füllung trägt (`zeichenWahl.test.ts` „bietet die Farbe nur aus der Palette an“, Picker-Test „Farbe aus der Palette“); keine freie Hexfarbe mehr. Alt-Hexfarben fallen deterministisch auf das nächste Token (`freiesZeichen.test.ts`, `#cc0000` → `rot`; e2e „ein Altzeichen im alten Format erscheint“). Blau (`bedien`) bleibt der Bedienung vorbehalten. |
| 8 | Helligkeits-/Kontrastregler | nicht anwendbar | App-weit, von dieser Änderung nicht berührt (Deckschicht `html::after`). |
| 9 | Kritische Anzeigen im Blickfeld | nicht anwendbar | Keine neue kritische Anzeige. Der Hinweis „Symbol wählen“ steht an der Stelle der Vorschau, direkt über dem Raster (`screenshots/picker-ohne-grundzeichen-ohne-symbol-*.png`). |
| 10 | Alarmbudget | erfüllt | Keine neuen Meldungen. Ein nicht darstellbares Altzeichen fällt still auf einen Platzhalter zurück; der Inspector nennt „vereinfacht dargestellt“ mit Alt-Kennung (`screenshots/inspector-vereinfacht-*.png`, `FreiesZeichenInspector.test.tsx`). |
| 11 | Warnverhalten | erfüllt | Kein Blinken, kein Ton. |
| 12 | Kein Sprung unter dem Cursor | erfüllt | Die Vorschau hält ihre Höhe (56 px) auch ohne Zeichen („Symbol wählen“ in derselben Fläche, `minHeight` in `FreiesZeichenPicker.tsx`). Raster haben eine Höchsthöhe und scrollen in sich. Zeichen auf der Karte haben feste 34 px. |
| 13 | Fokus nie verdeckt | erfüllt | `e2e/fokus-verdeckung.spec.ts`, Modus „Taktisches Zeichen“ bei 390 und 768 px (LFH-811), ist grün, ebenso die übrigen Kartenmodi (10 Lagekarten-Fälle). |
| 14 | Tabellenseite vollständig | nicht anwendbar | Keine Tabelle. |
| 15 | Erfassungsmaske vollständig | erfüllt | Feldbudget: offen stehen nur die zwei Suchfelder, Organisation, Fachaufgabe, Einheit, Farbe und Bezeichnung liegen unter „Details“ (Test „lässt offen nur die zwei Suchfelder stehen“). Enter platziert von Kachel, Suchfeld und Bezeichnung (Tests „Enter platziert“); ohne Zeichen („Kein Grundzeichen“ vor der Symbolwahl) sperren „Platzieren“, „Setzen“ und Enter (Tests in `FreiesZeichenPicker.test.tsx`, `Sidebar.test.tsx`, `ZeichenHierDialog.test.tsx`), und der Inspector speichert nichts (`FreiesZeichenInspector.test.tsx`). |

## Nebenbefunde der Sichtprüfung

- Das Raster „Grundzeichen“ schneidet seine vierte Kachelreihe mitten im Namen ab („Fläche“,
  „Maßnahme“, „Gefahr“ halb sichtbar, `picker-ohne-grundzeichen-ohne-symbol-tag.png`); eine
  gewählte Kachel dort ist erst nach dem Scrollen lesbar. Kosmetisch, Bestand aus LFH-716
  (`RASTER_REIHEN`), mit 19 Arten jetzt häufiger sichtbar.
- Die zweite Darstellung von 5.8.1.7 „Gefährliche Stoffe“ ist im Register das Beispiel „Chlor“;
  „(zweite Darstellung)“ sagt das nicht. Ein sprechenderer Name bräuchte eine Zuordnung, die das
  Register nicht trägt.
- Der Platzhalter für ein Altzeichen ohne Nachfolger ist das Grundzeichen „Punkt“; auf der Karte
  ohne Inspector nicht von einem echten Punkt zu unterscheiden (Risiko in design.md benannt).
- Element-Screenshots eines Paneels, das höher als das Fenster ist, zeigen die klebende Kopfleiste
  im Bild (`picker-mit-grundzeichen-nacht.png`); Aufnahme-Artefakt, kein Anwendungsfehler. Unten
  rechts steht im Dev-Stack der Knopf der TanStack-Query-Devtools.
