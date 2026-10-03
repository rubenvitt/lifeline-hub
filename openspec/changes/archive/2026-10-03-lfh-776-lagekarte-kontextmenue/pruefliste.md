# Prüfliste Einsatztauglichkeit — Kontextmenü an der Kartenstelle (LFH-776)

Angelegt an die geänderte Fläche: Lagekarte. Neu sind das Kontextmenü an der Kartenstelle
(Rechtsklick, langer Druck) und der Dialog „Zeichen hier setzen“. Die Kriterien folgen
Festlegung 7 in `docs/superpowers/specs/2026-07-25-bedien-leitlinie-einsatzkontexte.md`.

Geprüft am 03.10.2026:
- in Vitest: `PunktankerMenue.test.tsx`, `kontextmenue.test.ts`, `nachklickRiegel.test.ts`,
  `ZeichenHierDialog.test.tsx`, `useKartenInteraktion.test.tsx`, `messZeichnung.test.ts`,
  `klickziel.test.ts` und `LagekartePage.test.tsx`
- im Browser: `e2e/lagekarte-touch.spec.ts` mit fünf Fällen. Der lange Druck läuft per CDP bei
  1024 px in der Handschuh-Stufe und bei 390 px, der Rechtsklick mit Zwischenablage bei 1440 px.
- Kontraste: aus den Palettenwerten in `theme/tokens.ts` gerechnet

| # | Kriterium | Verdikt | Beleg / Begründung |
|---|---|---|---|
| 1 | Treffläche | erfüllt | Jeder Eintrag trägt `minHeight: controlHeight` plus Polster (`punktmenueEintragStil`). Die Böden 30/48/72 stehen als Literale in `PunktankerMenue.test.tsx`. Im Browser ist jeder `menuitem` ≥ Steuerhöhe der Stufe, gemessen bei 1024 und 390 px. Die Dialog-Knöpfe sind antd-`Button` ohne `size` und erben die Staffel. |
| 2 | Handschuh-Modus | erfüllt | e2e bei 1024 px in `handschuh`: jeder Eintrag ≥ 72 px, Auswahl einer Kachel und „Setzen“ per Tipp. Der Abstand zwischen den Einträgen ist der Menüabstand von antd. Die Einträge liegen untereinander und überlappen nicht. |
| 3 | Rückmeldung vor der Serverantwort | erfüllt | Das Menü erscheint beim langen Druck, solange der Finger noch liegt (Timer von maplibre, 500 ms), ohne Server. „Setzen“ zeigt sofort `loading`, und der Dialog bleibt bis zur Antwort stehen. Kopieren quittiert lokal. Messen läuft ohne Server. |
| 4 | Kritische Aktion mit zweiter Handlung | nicht anwendbar | Keine kritische Aktion. Kopieren und Messen ändern nichts. Ein Zeichen anzulegen lässt sich im Inspector löschen. Der Dialog selbst ist schon die zweite Handlung vor dem Anlegen. |
| 5 | Kontrast in beiden Modi | erfüllt | Der Kopf (Koordinate) steht in voller Textfarbe auf `flaeche2`: 15,02 : 1 (Nacht) und 17,08 : 1 (Tag). Gedämpft wären es nur 6,96 : 1, das hält bei Nachtbetrieb am Tag die 7 : 1 nicht, deshalb volle Farbe. Die Einträge folgen dem antd-Menü der Palette, unverändert gegenüber dem Flächen-Auswahlmenü (LFH-812). |
| 6 | Kein Status allein über Farbe | nicht anwendbar | Das Menü trägt keinen Status, nur Handlungen in Textform. |
| 7 | Eine Farbe = eine Bedeutung | erfüllt | Keine neue Farbe. Kein Eintrag ist rot (alle umkehrbar, `kontextmenue.test.ts`). |
| 8 | Helligkeits-/Kontrastregler | nicht anwendbar | App-weit, nicht berührt. |
| 9 | Kritische Anzeigen im Blickfeld | erfüllt | Das Menü erscheint an der Druckstelle, also dort, wohin der Blick gerade geht. Der Anker liegt im e2e auf ±2 px an der Druckstelle. |
| 10 | Alarmbudget | erfüllt | 0 Alarme. Quittungen sind kurze Meldungen auf eigene Handlung („Koordinate kopiert“, „Taktisches Zeichen angelegt“). |
| 11 | Warnverhalten | erfüllt | Kein Blinken, kein Ton. |
| 12 | Kein Sprung unter dem Cursor | erfüllt | Nach dem langen Druck steht die Karte still: Mitte, Zoom, Neigung und Drehung sind im e2e unverändert. Das Abheben löst keinen Tipp aus (Nachklick-Riegel). Gegenprobe „Riegel aus“: das Menü ist nach dem Abheben zu, e2e rot. Das Menü schließt bei jeder Kartenbewegung, statt mitzuwandern. |
| 13 | Fokus nie verdeckt | erfüllt | Das Menü fokussiert den ersten Eintrag (`autoFocus`, Hülle reicht weiter). Esc schließt und gibt den Fokus an den Canvas zurück (e2e Maus, `toBeFocused`). Der Dialog ist modal und nimmt den Fokus. Am Touchschirm bekommt die Suche bewusst keinen Fokus, damit keine Bildschirmtastatur über das Raster klappt. |
| 14 | Tabellenseite vollständig | nicht anwendbar | Keine Tabelle. |
| 15 | Erfassungsmaske vollständig | erfüllt (eingeschränkt anwendbar) | Der Dialog ist die Zeichenwahl der Leiste. Vorbelegt ist „taktische Formation“, „Zuletzt verwendet“ steht vorn, Enter setzt. Die Bezeichnung ist ein Detailfeld mit Label darüber. Eine Serie bietet der Dialog bewusst nicht: er gehört zu einer Stelle. Für eine Serie bleibt „Taktisches Zeichen platzieren“ in der Leiste. |

## Gegenproben (Mutationen, 03.10.2026)

Je Probe ein Eingriff, danach die 1024-px-Fälle von `lagekarte-touch.spec.ts` (`-g "1024 px (LFH-776)"`)
und zurückgedreht:

| Eingriff | Erwartung | Ergebnis |
|---|---|---|
| Riegel schärft nie (`nachklickRiegel.ts`: `scharf = true` entfernt) | Menü nach dem Abheben zu | rot an „Menü steht nach 500 ms noch“ |
| Sperre im Modus aus (`LagekartePage.tsx`: `kontextmenue` immer gesetzt) | Menü im Messmodus | rot an „kein Menü im Messmodus“ |
| `istOrtsziel` immer wahr (`Kartenflaeche.tsx`) | Menü auf dem Marker | rot an „kein Menü auf dem Marker“ |
| DOM-Marker-Riegel aus (`Kartenflaeche.tsx`) | Menü auf dem Kräfte-Cluster | rot an „kein Menü auf dem Donut“ |

## Offen

- **Natives `contextmenu` von Android-Chrome:** Das CDP-Touch von Playwright erzeugt es nicht.
  Belegt ist der Fall nur in jsdom (`nachklickRiegel.test.ts`: geschärft wird ein natives
  `contextmenu` geschluckt und `preventDefault` gesetzt). Abnahme am echten Android-Tablet bei
  der nächsten Testrunde (Board-Status `testing`).
