# Prüfliste Einsatztauglichkeit — LFH-552 Kräfte-Zeitachse

Die Kriterien stammen aus Festlegung 7 in
`docs/superpowers/specs/2026-07-25-bedien-leitlinie-einsatzkontexte.md`. Geprüft wurden drei
umgebaute Flächen:

- das **Meldebild** mit der Spalte „Im Einsatz“ (`pages/KraefteuebersichtPage.tsx`),
- die **Einheit-Detailseite** mit dem Paneel „Zeitachse“ (`pages/EinheitDetailPage.tsx`),
- die **Personal-Seite** mit den Spalten „Einsatzdauer“ und „Ruhe“ und der aufklappbaren Zeitachse
  (`pages/PersonalPage.tsx`).

Das gemeinsame Bauteil ist `kraefte/KraftZeitachse.tsx`. Dazu kommt die Katalogspalte und das
Feld „Zeitachse“ im Fahrzeug- und im Personal-Status-Katalog.

| # | Kriterium | Verdikt | Beleg / Begründung |
|---|---|---|---|
| 1 | Treffläche | erfüllt | „Nachtragen“ und „Streichen“ sind antd-`Button` ohne `size="small"` und erben `controlHeight` aus der Dichte-Staffel (`dichte.guard.test.ts`). Der Aufklapp-Auslöser der Personalzeile ist der bestehende von `Datensicht`. |
| 2 | Handschuh-Modus | erfüllt | Kein eigenes Maß: Knöpfe, Dialogfelder und Zeitachseneinträge beziehen Höhe und Polster aus den Tokens (`controlHeight`, `paddingSM`/`padding`). Damit wachsen sie in `handschuh` auf 72 px mit. |
| 3 | Rückmeldung vor der Serverantwort | erfüllt | Die Dialog-Knöpfe zeigen während des Sendens sofort `loading` (`ErfassungsModal.laeuft`). Die Dauerspalten rechnen ohne Abruf aus der Client-Uhr weiter (Minutentakt). |
| 4 | Kritische Aktion mit zweiter Handlung | erfüllt | „Streichen“ ist unumkehrbar und öffnet deshalb eine Rückfrage mit Pflichtgrund; sie nennt die Folgen, bei Einheiten auch den Fan-out. Ein Nachtrag ist nicht kritisch, weil er sich streichen lässt. Test: `KraftZeitachse.test.tsx` „Streichen verlangt einen Grund“. |
| 5 | Kontrast in beiden Modi | erfüllt | Es gibt keine neue Farbe. Text, `text2` und `gedaempft` sowie die Zeilentönung `berichtigung` kommen aus `theme/tokens.ts` und sind dort in beiden Modi vermessen (`rollen.guard.test.ts`, `e2e/hellmodus-kontrast.spec.ts`). |
| 6 | Kein Status allein über Farbe | erfüllt | Eine gestrichene Zeile trägt neben der Tönung auch den Durchstrich und das Wort „gestrichen: <Grund>“. Die Herkunft steht als Wort da („aus Status“, „über Einheit «…»“, „nachgetragen“). Dauern sind neutral, eine Einstufung gibt es nicht. |
| 7 | Eine Farbe = eine Bedeutung | erfüllt | Die Tönung `berichtigung` bedeutet wie im ETB „nicht mehr gültig, lesbar“. Es wird keine gesättigte Farbe für Normalzustände verwendet. |
| 8 | Helligkeits-/Kontrastregler | erfüllt | Global über `ThemeModeProvider` (LFH-397); die neuen Flächen setzen keine eigene Helligkeit. |
| 9 | Kritische Anzeigen im Blickfeld | erfüllt | „Im Einsatz“ steht im Meldebild direkt neben „Seit“ im Hauptblick der Zeile. Das Paneel „Zeitachse“ folgt auf der Einheit-Detailseite direkt auf die Kopfdaten. |
| 10 | Alarmbudget | nicht anwendbar | Die Zeitachse erzeugt keine Alarme: keine Grenzwerte, keine Hinweise in der AlarmZentrale. Grenzwerte samt Alarmbudget kommen in LFH-860. |
| 11 | Warnverhalten | erfüllt | Nichts blinkt. Die Dauer ändert nur ihren Wert, und Fehler stehen als Text im Dialog. |
| 12 | Kein Sprung unter dem Cursor | offen → **LFH-861** | Die Dauerzellen haben eine feste Breite (96/104/88 px), dort springt nichts. Die Ereignisliste der Zeitachse schiebt aber einen fremden Zufluss nach einer Live-Invalidierung direkt ein, ohne Sammelbanner. |
| 13 | Fokus nie verdeckt | erfüllt | Es gibt keine neue fixierte Fläche. Die Dialoge sind modal (antd-Fokusfalle), das Paneel und der Expander liegen im Fluss. |
| 14 | Tabellenseite vollständig | erfüllt | Die neuen Spalten laufen in `Datensicht`/`KatalogTabelle` mit stehender Kopfzeile, fixierter Namensspalte und Spaltenschalter mit Zähler. „Im Einsatz“ trägt kein `abBreite` und geht deshalb auch aufs Meldeblatt (Test „bleibt auch am schmalen Schirm stehen“). |
| 15 | Erfassungsmaske vollständig | erfüllt | Der Nachtrag läuft über `ErfassungsModal`: drei Felder mit Beschriftung über dem Feld, der Zeitpunkt ist mit „jetzt“ vorbelegt und überschreibbar, Enter sendet (Test „Enter im Textfeld sendet“). Einen Serienmodus gibt es bewusst nicht, weil ein Nachtrag genau eine Kraft betrifft. Die Sammelliste mit Streichen je Zeile ist die Zeitachse selbst. |
