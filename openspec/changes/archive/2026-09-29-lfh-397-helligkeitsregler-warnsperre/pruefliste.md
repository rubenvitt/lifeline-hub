# Prüfliste Einsatztauglichkeit — LFH-397, Helligkeitsregler mit Warnsperre

Geprüft wird die neue Umschaltgruppe „Helligkeit“ im Benutzermenü, die fünf
Schnelleinstellungen der Sprungpalette und die app-weite Deckschicht. Die übrigen Einträge des
Benutzermenüs sind unverändert, ihre Verdikte stehen in den Prüflisten zu LFH-329 und LFH-392.

| # | Kriterium | Verdikt | Beleg |
|---|---|---|---|
| 1 | Treffläche | erfüllt, unverändert | Die Einträge sind antd-`Menu`-Einträge, genau wie die Gruppen „Darstellung“ und „Bediendichte“ daneben. Ihre Höhe kommt aus der Steuerhöhe am `ConfigProvider`. Es gibt kein handgebautes Bedienziel. |
| 2 | Handschuh-Modus | erfüllt, unverändert | Menüeinträge folgen der Dichte-Staffel 30/48/72 wie die Nachbargruppen. Diese Änderung bringt keine neue Bauform. |
| 3 | Rückmeldung vor Serverantwort | erfüllt | Die Wahl ist rein lokal (Speicher und Merkmal am `<html>`), ohne Serverweg. Die Abdunklung wirkt im selben Frame. |
| 4 | Kritische Aktion, zweite Handlung | nicht anwendbar | Das Umstellen der Helligkeit ist umkehrbar und keine kritische Aktion. |
| 5 | Kontrast | **erfüllt, mit Boden** | Bei 100 % ist der Kontrast unverändert, weil die Paletten nicht angefasst werden. Unter aktiver Warnung sinkt die Stufe nie unter `HELLIGKEIT_BODEN_WARNUNG` = 80 %. Das ist die kleinste Stufe, bei der `alarmText` auf `grund` in beiden Paletten ≥ 4,5 : 1 hält (nachts 4,81 : 1). Der Guard in `theme/helligkeit.test.ts` rechnet das aus den Tokens nach, die Mutationsprobe mit Boden 60 wird rot. Unter 80 % ohne Warnung ist der WCAG-Kontrast niedriger. Das ist eine bewusste Wahl für den dunkeladaptierten Raum und keine Abweichung, die ohne Nutzereingriff entsteht (design.md, Kontext). |
| 6 | Status nicht allein über Farbe | erfüllt | Die gewählte Stufe trägt „✓“ im Text. Die Sperre steht als Satz in der Überschrift („mind. 80 % (Warnung aktiv)“), die Wirkung an der Wahl („(wirkt 80 %)“). Gesperrte Stufen sind `aria-disabled` (`BenutzerMenu.test.tsx`). |
| 7 | Eine Farbe = eine Bedeutung | erfüllt | Es wird keine Farbe vergeben. Die Deckschicht ist Schwarz mit Deckkraft und ändert keine Rolle. |
| 8 | Helligkeits-/Kontrastregler | **erfüllt** | Es gibt einen Regler (Stufen 100/80/60/40/20, AUS ist keine Stufe) und eine Sperre (`wirksameHelligkeit`, `theme/helligkeit.ts`). Die Sperre ist in beiden Hälften getestet: Wahl 40 mit Warnung ergibt 80, ohne Warnung 40 (`helligkeit.test.ts`, Austritt in `helligkeitProvider.test.tsx`, Quelle im Rahmen in `EinsatzLayout.test.tsx`). Mutationsproben: Die Sperre entfernt oder auf „immer“ gesetzt ergibt je 4 rote Tests, der Boden auf 60 ergibt 6 rote Tests, der Provider auf die Wahl statt die wirksame Stufe ergibt 4 rote Tests. Der Träger für künftige Prüflisten ist `ThemeModeProvider` + `useWarnsperre` (CLAUDE.md, „Helligkeit: ein Regler, eine Sperre“). |
| 9 | Kritische Anzeigen im Blickfeld | nicht anwendbar | Die Änderung führt keine neue Anzeige ein. Die Einstellung liegt bewusst im Menü, nicht im Kopf (LFH-392). |
| 10 | Alarmbudget | erfüllt | Es gibt keinen Alarmbeitrag. Die Sperre erzeugt weder Meldung noch Ton, sie hebt nur die Helligkeit. |
| 11 | Warnverhalten | erfüllt | Beim Beginn einer Warnung gibt es einen einzelnen Helligkeitswechsel, kein Blinken und keinen Übergang in Schleife. |
| 12 | Kein Sprung unter dem Cursor | erfüllt | Die Deckschicht liegt `position: fixed` über der Seite und verschiebt kein Layout. `pointer-events: none` lässt jeden Klick durch (`e2e/helligkeit.spec.ts`, Klick bei 40 %). |
| 13 | Fokus nie verdeckt | erfüllt | Die Schicht ist durchsichtig für Zeiger und Hit-Test und verdeckt kein Fokusziel. Sie dunkelt es nur gleichmäßig ab, einschließlich Fokusring. |
| 14 | Tabellenseite vollständig | nicht anwendbar | Keine Tabelle. |
| 15 | Erfassungsmaske vollständig | nicht anwendbar | Keine Erfassung. |

## Offen

- **DWD-Unwetter (schwer/extrem) als dritte Warnquelle:** → LFH-774. Heute wird es nur
  seitenlokal alle 5 min abgefragt, ohne Stream-Ereignis (design.md, Non-Goals).
