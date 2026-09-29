# Prüfliste Einsatztauglichkeit: Benutzerkonflikt-Dialog (LFH-387)

Gate 7 der Bedien-Leitlinie (`docs/superpowers/specs/2026-07-25-bedien-leitlinie-einsatzkontexte.md`,
Festlegung 7). Neu ist keine Seite, sondern ein blockierender Dialog über jeder Route
(`auth/BenutzerKonfliktDialog.tsx`, eingehängt im Sitzungs-Layout von `App.tsx`). Er erscheint
nur, wenn sich in einem anderen Tab desselben Browsers ein anderer Benutzer angemeldet hat.
Alle übrigen Flächen sind unverändert; die Anmeldeseite verlässt die Maske nur zusätzlich nach
einer Übernahme aus einem anderen Tab.

**Verdikte:** **erfüllt** (mit Beleg) · **offen → Zielticket** · **nicht anwendbar** (mit
Begründung). Aus Quelltext Geschlossenes trägt **[abgeleitet]**.

| Nr. | Kriterium | Verdikt | Beleg / Begründung |
| --- | --- | --- | --- |
| 1 | Treffläche | erfüllt [abgeleitet] | Einziges Bedienziel ist ein antd-`Button` ohne `size`; seine Höhe kommt aus `controlHeight` des `ConfigProvider` (30/48/72 px), der Boden `minWidth` aus `antdKnopf()`. Kein handgebautes Bedienziel. |
| 2 | Handschuh-Modus | erfüllt [abgeleitet] | Folgt der Dichte-Staffel über den Provider (72 px in `handschuh`); keine punktuelle Größe (`dichte.guard.test.ts` grün). |
| 3 | Rückmeldung vor der Serverantwort | erfüllt | „Als … weiterarbeiten“ ist rein lokal (Cache räumen, Benutzer übernehmen, Navigation) — kein Serverruf, Wirkung sofort (`BenutzerKonfliktDialog.test.tsx`). |
| 4 | Kritische Aktion mit zweiter Handlung | nicht anwendbar | Die Aktion verwirft nur den Anzeigezustand eines Tabs, der ohnehin nichts mehr speichern kann; nichts wird gelöscht oder abgeschlossen. Der Dialog selbst ist die zweite Handlung nach dem Wechsel in einem anderen Tab. |
| 5 | Kontrast in beiden Modi | erfüllt [abgeleitet] | Standard-`Modal` und Primärknopf aus den Theme-Tokens (`theme/tokens.ts`), keine eigenen Farbwerte; die Modal-Flächen sind durch die bestehenden Kontrastmessungen der Rollen gedeckt. |
| 6 | Kein Status allein über Farbe | erfüllt | Der Zustand steht als Titel „Anderer Benutzer angemeldet“ und als Satz mit beiden Anzeigenamen; keine Statusfarbe. |
| 7 | Eine Farbe = eine Bedeutung | erfüllt | Einzige Farbe ist das Bedien-Blau des Primärknopfs; kein Rot, keine Warnfarbe. |
| 8 | Helligkeits-/Kontrastregler | nicht anwendbar | Anwendungsweite Frage, von dieser Änderung nicht berührt (offen am Referenzstand der Leitlinie). |
| 9 | Kritische Anzeigen im Blickfeld | erfüllt [abgeleitet] | antd-Modal zentriert oben im Sichtbereich, über der Maske. |
| 10 | Alarmbudget | erfüllt | Kein Alarm: der Dialog erscheint nur nach einer Handlung in einem anderen Tab und genau einmal je Wechsel (Prüfung zusammengefasst, `AuthContext.pruefen.test.tsx`). |
| 11 | Warnverhalten | erfüllt | Kein Blinken, kein Ton; quittiert wird über die eine Aktion. |
| 12 | Kein Sprung unter dem Cursor | erfüllt [abgeleitet] | Modal über der Maske, verschiebt kein Layout; erscheint nur nach einem Wechsel in einem anderen Tab. |
| 13 | Fokus nie verdeckt | erfüllt [abgeleitet] | antd-Modal hält den Fokus im Dialog (Focus-Trap); einziges Fokusziel ist der Knopf im Fuß. |
| 14 | Tabellenseite vollständig | nicht anwendbar | Keine Tabelle. |
| 15 | Erfassungsmaske vollständig | nicht anwendbar | Keine Erfassung; bewusst nicht `components/Erfassung.tsx`. |

Nachweis im Browser: `e2e/sitzung-mehrere-tabs.spec.ts` (Chromium, zwei Tabs in einem
Kontext) — Dialog erscheint ohne Neuladen, trägt den Anzeigenamen des neuen Benutzers, „Als …
weiterarbeiten“ führt auf `/einsaetze` und lässt die Sitzung des neuen Benutzers bestehen.
