# Prüfliste Einsatztauglichkeit: Fachobjekt-Zeichen über @einsatzzeichen (LFH-835)

Geprüft wurden die Flächen, die sich optisch ändern:
- Lagekarte: Marker von Einheit, Fahrzeug, Führungskraft, Abschnitt, Einsatzort, Schaden, UHS und Betreuungsstelle.
- Inspector: Symbolkachel.
- Meldebild: Spalte „TZ“.

Die Kriterien stehen in Festlegung 7 von `docs/superpowers/specs/2026-07-25-bedien-leitlinie-einsatzkontexte.md`. Geprüft am 29.09.2026 in Vitest, in e2e und per Sichtprüfung. Für die Sichtprüfung lief der Dev-Stack mit dem Demo-Einsatz, fotografiert wurde mit Playwright bei Pixeldichte 2 in beiden Modi. Die Bilder liegen unter `sichtpruefung/`.

| # | Kriterium | Verdikt | Beleg / Begründung |
|---|---|---|---|
| 1 | Treffläche | erfüllt | Die Trefferzone der Marker (`trefferDurchmesser = controlHeight`) ist unverändert. Das Zeichen hat einheitlich 34 CSS-px statt der bisher je Grundzeichen normierten Größe. `gate3-trefflaeche.spec.ts` ist grün, auch die Objektmarker (LFH-711, UHS). |
| 2 | Handschuh-Modus | erfüllt | Die Trefferzone folgt der Staffel wie bisher, siehe `gate3`. Die Zeichengröße ist bewusst fest: Der Statusring (radius 20) ist auf 34 px abgestimmt. |
| 3 | Rückmeldung vor der Serverantwort | erfüllt | Kartenbilder entstehen jetzt synchron im `styleimagemissing`-Handler, nicht mehr über `Image.onload`. Eine Komposition kostet etwa 0,04 ms, das Ergebnis wird je Eingang gecacht. |
| 4 | Kritische Aktion mit zweiter Handlung | nicht anwendbar | Reine Darstellung, es gibt keine Aktion. |
| 5 | Kontrast in beiden Modi | **offen → LFH-833** | Tagmodus: Konturen schwarz auf hellem Grund, Körperfarben nach BABZ (`sichtpruefung/karte-light.png`). Nachtmodus: Schwarze Konturen, Räder und das Einsatzort-„V“ verschwinden auf dunklem Grund, ebenso Formationen ohne Organisation (`fill="none"`, Meldebild ohne Org-Vorgabewert). Das war beim Altpaket genauso (Scope 29.09.2026). Die Lösung liegt nach Entscheidung vom 29.09.2026 in der Bibliothek (dunkles Render-Theme), nicht im Hub. |
| 6 | Kein Status allein über Farbe | erfüllt | Das Ausmaß eines Schadens trägt am Zeichen die Füllung. Die Bedeutung „Gefahr“ trägt die Dreiecksform, das Ausmaß steht als Wort im Inspector. Das ist unverändert gegenüber vorher, nur auf Palettentöne gerundet (`fachobjektZeichen.test.ts`, 5 Pins). |
| 7 | Eine Farbe = eine Bedeutung | erfüllt | Die Organisationsfarben und Schadensfüllungen stammen aus der BABZ-Palette der Bibliothek. Blau (`bedien`) kommt im Zeichen nicht vor. Der Abschnitt ist gelb für „Führung und Leitung“, die Fachaufgabe „Führung“ an Einheit oder Fahrzeug färbt bewusst nicht um (design.md D2). |
| 8 | Helligkeits-/Kontrastregler | nicht anwendbar | App-weit und von dieser Änderung nicht berührt (Deckschicht `html::after`). |
| 9 | Kritische Anzeigen im Blickfeld | nicht anwendbar | Es kommt keine neue Anzeige hinzu. |
| 10 | Alarmbudget | erfüllt | Es gibt keine Meldungen. Ein nicht darstellbares Zeichen fällt still zurück, eine Warnung erscheint nur in DEV auf der Konsole. |
| 11 | Warnverhalten | erfüllt | Kein Blinken, kein Ton. |
| 12 | Kein Sprung unter dem Cursor | erfüllt | Die Zeichen haben feste 34 px auf der Karte und 22 px im Meldebild (Rahmen 26 px wie bisher). Ein Wechsel des Zeichens verschiebt nichts. |
| 13 | Fokus nie verdeckt | nicht anwendbar | Es gibt kein neues fixiertes Element. Das Zeichen im Meldebild bleibt `aria-hidden`. |
| 14 | Tabellenseite vollständig | nicht anwendbar | Die Tabelle des Meldebilds bleibt unverändert, nur der Inhalt der Zelle „TZ“ ist neu. |
| 15 | Erfassungsmaske vollständig | nicht anwendbar | Es gibt keine Erfassung. |

## Bundle (Task 5.4)

Gemessen mit `vite build` am 29.09.2026. „Vorher“ ist `origin/alpha` im Wegwerf-Worktree mit denselben `node_modules`.

| | vorher | nachher |
|---|---|---|
| JS gesamt | 4721 KiB (gzip 1388 KiB) | 5296 KiB (gzip 1555 KiB) |
| neuer Chunk `fachobjektZeichen-*.js` | — | 630 KiB (gzip 194 KiB) |
| Precache (`vite-plugin-pwa`) | 22 Einträge, 4827,5 KiB | 21 Einträge, 5402,7 KiB |

Zur Einordnung:
- Der neue Chunk hängt an den Lazy-Routen Lagekarte und Kräfteübersicht und liegt nicht im Einstiegs-Chunk.
- Eine Schrift wird nicht ausgeliefert, denn kein Fachobjekt-Zeichen zeichnet Text. Der Test „zeichnet keinen Text“ pinnt das.
- Das Wachstum um rund 575 KiB im Precache ist befristet: Mit LFH-836 fällt das Altpaket weg.
- `e2e/lagekarte-offline-precache.spec.ts` ist grün.

## Nebenbefund der Sichtprüfung

Der Browser-Bereich der Desktop-App drosselt `requestAnimationFrame`, solange er ausgeblendet ist. MapLibre zeichnet dann nur einen Teil der Marker. Das ist ein Umgebungseffekt und kein Fehler der Anwendung. Belegt ist das so:
- Playwright headless zeichnet alle 16 Marker.
- Der neue e2e „jedes Schadenszeichen ist gezeichnet, auch nach einem Stilwechsel“ zählt die gezeichneten Symbole. Mit einer Mutation, bei der der Handler die Gefahrenzeichen übergeht, wird er rot.
