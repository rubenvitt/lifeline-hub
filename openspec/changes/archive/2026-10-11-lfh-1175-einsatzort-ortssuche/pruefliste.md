# Prüfliste Einsatztauglichkeit — LFH-1175

Bezug: `frontend/AGENTS.md`, Bedien-Leitlinie (15 Kriterien,
`docs/superpowers/specs/2026-07-25-bedien-leitlinie-einsatzkontexte.md`, Festlegung 7).
Geprüft: Paneel „Einsatzort“ auf der Seite Einsatzdaten (`EinsatzortPaneel`, `Ortsfeld`,
`Kartenausschnitt`) und das fünfte Feld „Einsatzort“ im Dialog „Neuen Einsatz anlegen“.

| # | Kriterium | Verdikt | Beleg |
| --- | --- | --- | --- |
| 1 | Treffläche | erfüllt | Treffer-Knöpfe `minHeight: controlHeight`; „Ort suchen“, „Erneut suchen“ als antd-Knöpfe; „Auf Lagekarte zeigen ↗“ als Link in Knopfgestalt (kein nacktes `<a>`); die Nadel ist kein Ziel (`pointerEvents: none`). |
| 2 | Handschuh-Modus | erfüllt | Alle Ziele hängen am Dichte-Token (`controlHeight` 30/48/72), kein neues `size="small"` (`dichte.guard.test.ts` grün). |
| 3 | Rückmeldung vor der Serverantwort | erfüllt | „Sucht …“ sofort nach Enter bzw. „Ort suchen“; Speichern über `InlineAngabe` mit Ladezustand; Suche gibt nach spätestens ~2,5 s (1 s Takt + 1,5 s Zeitlimit) einen Zustand. |
| 4 | Kritische Aktion mit zweiter Handlung | nicht anwendbar | Keine unumkehrbare Aktion: Adresse und Koordinate lassen sich jederzeit neu setzen. |
| 5 | Kontrast in beiden Modi | erfüllt | Nur Rollenwerte des Themes (`text2`, `linie`, `marke`/`grund` wie die Einsatzort-Nadel des Lagemonitors), keine neuen Farben; Bildlauf hell und dunkel (`einsatzort.png`, `einsatzort.dunkel.png`). |
| 6 | Kein Status allein über Farbe | erfüllt | Jeder Zustand in Worten: „Sucht …“, „Keine Adresse zu …“, „Adresssuche ausgelastet“, „… nicht erreichbar“, „… ohne Netz nicht verfügbar“, „Nicht verortet“. |
| 7 | Eine Farbe = eine Bedeutung | erfüllt | Nadel in `marke` wie der Einsatzort auf dem Lagemonitor; keine gesättigte Farbe für Normalzustände. |
| 8 | Helligkeits-/Kontrastregler | nicht anwendbar | Regler ist global (Kopfleiste), unverändert. |
| 9 | Kritische Anzeigen im Blickfeld | nicht anwendbar | Keine kritische Anzeige; der Einsatzort steht zusätzlich in der Kopfleiste. |
| 10 | Alarmbudget | nicht anwendbar | Keine Alarme. |
| 11 | Warnverhalten | nicht anwendbar | Keine Warnung, kein Blinken, kein Ton. |
| 12 | Kein Sprung unter dem Cursor | erfüllt | Trefferliste erscheint nur auf Handlung; Kartenausschnitt hat feste Höhe (200 px, im Dialog 120 px), auch als „Nicht verortet“; der Sprung zur Lagekarte steht unter der Karte am Paneelende. |
| 13 | Fokus nie verdeckt | erfüllt | Keine neuen fixierten Elemente; nach der Wahl eines Treffers und vor „Erneut suchen“ geht der Fokus ins Feld (`Ortsfeld.test.tsx`). |
| 14 | Tabellenseite vollständig | nicht anwendbar | Keine Tabelle. |
| 15 | Erfassungsmaske vollständig | erfüllt | Feld optional und leer vorbelegt, Label über dem Feld (`Form.Item`), volle Tastaturbedienung (Enter sucht, Tab erreicht die Treffer, Enter wählt, Escape schließt die Liste); „Speichern und nächsten“ entfällt beim Einsatzanlegen wie bisher. |

Kontext mobil: e2e `einsatzort-ortssuche.spec.ts` misst 390 px ohne Querlauf als Admin und als
Führungspersonal, mit offener Trefferliste und mit der Koordinaten-Zeile in Bearbeitung.
