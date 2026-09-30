# Prüfliste Einsatztauglichkeit — Einsatzdaten zeilenweise bearbeiten (LFH-472)

Geprüft wird die umgebaute Leseansicht von `pages/EinsatzdatenPage.tsx` mit den neun
Inline-Zeilen und das neue Primitiv `components/InlineAngabe.tsx`. Die 15 Kriterien stehen in
`docs/superpowers/specs/2026-07-25-bedien-leitlinie-einsatzkontexte.md`, Festlegung 7. Das
Vollformular ist unverändert und hier nicht neu bewertet.

| Nr. | Kriterium | Verdikt | Beleg / Begründung |
|---|---|---|---|
| 1 | Treffläche | erfüllt | Alle Auslöser sind antd-`Button` ohne `size` und erben `controlHeight` (30/48/72) vom Dichte-Token. Der Wertknopf nimmt `wertKnopfStil` (`minHeight: controlHeight`, Böden in `BemerkungZelle.test.tsx` über zwei Stufen gepinnt). Kein neues `size="small"` (`dichte.guard.test.ts` grün). |
| 2 | Handschuh-Modus | erfüllt | Höhen kommen ausschließlich vom `ConfigProvider`. In `handschuh` sind Wertknopf, Platzhalter, Eingaben, „Speichern" und „Abbrechen" 72 px hoch. Zwischen „Speichern" und „Abbrechen" steht der `Space`-Abstand. |
| 3 | Rückmeldung vor der Serverantwort | erfüllt | „Speichern" zeigt sofort `loading`, die Eingabe bleibt bis zur Antwort stehen, ein zweites Absenden sperrt `sendetRef` (Vitest „ein zweites Enter während des Sendens …"). Nach dem Erfolg steht der neue Wert per `setQueryData` in derselben Runde da. |
| 4 | Kritische Aktion mit zweiter Handlung | nicht anwendbar | Eine Kopfangabe zu ändern ist umkehrbar (erneut ändern) und nicht destruktiv. Die Pflichtangabe Alarmzeit lässt sich gar nicht leeren. |
| 5 | Kontrast in beiden Modi | erfüllt | Keine neue Farbe. Wert in der Textfarbe der Zeile (`color: inherit`), Platzhalter in `rollen.bedienText`, Pflichthinweis in `rollen.alarmText`, Fehler über `SpeicherFehler` (antd `Alert`). Alle Rollen sind in `rollen.guard.test.ts`/`hellmodus-kontrast.spec.ts` gemessen. |
| 6 | Kein Status allein über Farbe | erfüllt | Der Pflichthinweis ist ein ganzer Satz, der Speicherfehler trägt Titel und Text. |
| 7 | Eine Farbe = eine Bedeutung | erfüllt | Blau nur für Bedienung (Platzhalter, „Speichern"), Rot nur für die Ablehnung/den Fehler. |
| 8 | Helligkeits-/Kontrastregler | erfüllt | Global über `ThemeModeProvider` (LFH-397). Die Seite fügt keine eigene Helligkeit hinzu. |
| 9 | Kritische Anzeigen im Blickfeld | erfüllt | Kopfleiste (Stichwort, Alarmzeit, Einsatzort, Einsatzleitung) bleibt oben an derselben Stelle. Die Bearbeitung ersetzt nur den Wert in ihrer Zelle, die Seite bleibt stehen (Vitest und e2e: „Lagedaten" sichtbar, kein Vollformular). |
| 10 | Alarmbudget | nicht anwendbar | Die Seite erzeugt keine Alarme. Die Erfolgsmeldung folgt einer Nutzeraktion (EEMUA 191, CLAUDE.md „Rückwege und Fehler"). |
| 11 | Warnverhalten | erfüllt | Kein Blinken; der Pflichthinweis steht ruhig an der Zeile, bis sie wieder geöffnet wird. |
| 12 | Kein Sprung unter dem Cursor | erfüllt | Der Einsatzkopf ist nicht live (`NICHT_LIVE_KEYS`), fremde Änderungen schieben nichts ein. Die Zeile wächst nur durch die eigene Handlung (Öffnen), das zählt nicht als unerwarteter Sprung. |
| 13 | Fokus nie verdeckt | erfüllt | Keine neuen fixierten oder klebenden Elemente. Die Eingabe steht im Fluss, der Fokus geht beim Öffnen in die Eingabe und danach zurück auf den Auslöser (Vitest und e2e `toBeFocused`). Die Route ist nicht in `fokus-verdeckung.spec.ts` aufgenommen, dort gibt es auch keinen Kopf-/Fußbalken, der verdecken könnte. |
| 14 | Tabellenseite vollständig | nicht anwendbar | Keine Tabelle; Datenblatt aus Zeilen (`dl`). |
| 15 | Erfassungsmaske vollständig | erfüllt | Eingabe mit dem bisherigen Wert vorbelegt und einzeln überschreibbar. Das Etikett steht sichtbar neben der Zeile und ist der zugängliche Name der Eingabe. Volle Tastaturbedienung: Tab, Enter (Strg/⌘+Enter im Sachverhalt), Escape. „Speichern und nächsten anlegen" entfällt, weil nichts angelegt wird. |
