# Prüfliste Einsatztauglichkeit — Alter der Fachebenen-Stände (LFH-591)

Angelegt an die geänderte Fläche: Lagekarte → Fachebenen-Panel (neue Zeile „Stand …“ je
zugeschalteter Ebene) und Fachebenen-Inspector (neue Zeile „Ebene abgerufen …“). Kriterien nach
Festlegung 7 in `docs/superpowers/specs/2026-07-25-bedien-leitlinie-einsatzkontexte.md`.
Geprüft am 30.09.2026 in Vitest (`FachebeneStand.test.tsx`, `Sidebar.test.tsx`,
`FachebenenInspector.test.tsx`), Kontraste aus den Palettenwerten in `theme/tokens.ts`
gerechnet. Kein Browserlauf mit Live-Quellen: die Umgebung der Umsetzung hatte keinen Zugriff
auf die Fachdienste. Überlauf und Leistendichte belegen die e2e-Gates der CI
(`gate1-ueberlauf.spec.ts`, `lagekarte-leiste-dichte.spec.ts`).

| # | Kriterium | Verdikt | Beleg / Begründung |
|---|---|---|---|
| 1 | Treffläche | nicht anwendbar | Die neue Zeile ist Text, kein Bedienziel. Schalter und Inspector bleiben unverändert. |
| 2 | Handschuh-Modus | nicht anwendbar | Kein neues Bedienelement. Die Zeile folgt der Meta-Stufe (11 px) wie die Geltungszeile darüber und hat keine punktuelle Größe. |
| 3 | Rückmeldung vor der Serverantwort | nicht anwendbar | Anzeige ohne eigene Handlung. Die Einstufung altert im Minutentakt ohne Abruf (`FachebeneStand.test.tsx`, „wird ohne neuen Abruf veraltet …“). |
| 4 | Kritische Aktion mit zweiter Handlung | nicht anwendbar | Read-only. |
| 5 | Kontrast in beiden Modi | erfüllt | Gegen den Grund der Leiste (`paneel`) gerechnet: `text2` 12,04 : 1 (Tag) und 12,10 : 1 (Nacht), `achtungText` 8,46 : 1 (Tag) und 12,25 : 1 (Nacht). Ungünstigster Nachbargrund `flaeche3`: 7,23 und 11,02. Alle Werte ≥ 7 : 1. |
| 6 | Kein Status allein über Farbe | erfüllt | Veraltet trägt das Wort „veraltet“ im zugänglichen Text, ⧖ ist `aria-hidden`. Belegt in `FachebeneStand.test.tsx` und `Sidebar.test.tsx`. Mutationsprobe: ohne Wort werden zwei Tests rot. |
| 7 | Eine Farbe = eine Bedeutung | erfüllt | `achtungText` bedeutet hier dasselbe wie überall: „aufpassen, nicht Gefahr“. Kein Rot, kein Blau. Keine neue Statuskarte (Zweiwert, `design.md`, D5). |
| 8 | Helligkeits-/Kontrastregler | nicht anwendbar | App-weit, nicht berührt. |
| 9 | Kritische Anzeigen im Blickfeld | erfüllt | Das Alter steht in der Zeile der Ebene selbst, direkt unter ihrem Namen. Man muss nichts aufklappen oder anklicken. |
| 10 | Alarmbudget | erfüllt | 0 Meldungen: „veraltet“ ist ein Zustand an der Zeile, kein Toast, keine Notification, kein Ton. |
| 11 | Warnverhalten | erfüllt | Kein Blinken, kein Ton. |
| 12 | Kein Sprung unter dem Cursor | erfüllt | Die Zeile erscheint mit dem Zuschalten der Ebene, also als Folge der eigenen Handlung. Der Übergang zu „veraltet“ verlängert eine Zeile, die `nowrap` trägt, und fügt keine Zeile ein. |
| 13 | Fokus nie verdeckt | nicht anwendbar | Kein fixiertes Element, kein neues Fokusziel. |
| 14 | Tabellenseite vollständig | nicht anwendbar | Keine Tabelle. |
| 15 | Erfassungsmaske vollständig | nicht anwendbar | Keine Erfassung. |
