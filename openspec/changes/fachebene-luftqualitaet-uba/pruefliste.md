# Prüfliste Einsatztauglichkeit — Fachebene Luftqualität (LFH-79)

Angelegt an die geänderte Fläche: Lagekarte → Fachebenen-Panel (neue Zeile) + Kartenpunkte der
Ebene + Fachebenen-Inspector (neuer Zweig). Kriterien nach Festlegung 7 in
`docs/superpowers/specs/2026-07-25-bedien-leitlinie-einsatzkontexte.md`. Geprüft im Browser am
21.09.2026 (Test-Backend mit Live-Daten der UBA-API) und in Vitest.

| # | Kriterium | Verdikt | Beleg / Begründung |
|---|---|---|---|
| 1 | Treffläche | **offen → LFH-600** | Panel-Schalter: generisches antd-`Switch` im bestehenden Panel, erbt die Dichte — erfüllt. **Kartenpunkte:** Radius 3–9 px ⇒ Trefffläche ≤ 18 px < 24 px. Gemeinsame Bauform aller Punkt-Fachebenen (Hochwasser, KRITIS, Pegel, Autobahn), nicht neu durch LFH-79. |
| 2 | Handschuh-Modus | **offen → LFH-600** | Panel und Inspector erben die Staffel vom `ConfigProvider` (keine punktuelle Größe). Kartenpunkte: siehe 1. |
| 3 | Rückmeldung vor der Serverantwort | erfüllt | Schalter reagiert sofort (lokaler State). Kaltabruf gemessen 0,40 s (zwei UBA-Abrufe), aus dem Cache 13 ms — weit unter 2 s. |
| 4 | Kritische Aktion mit zweiter Handlung | nicht anwendbar | Die Ebene ist read-only; kein Storno/Löschen/Alarmieren. |
| 5 | Kontrast in beiden Modi | **offen → LFH-600** (Kreise) | Inspector-Text über `StatusTag` (Beschriftung `token.colorText`, Rolle nur am Rand — bestehender Kontrastvertrag). Kreis gegen Basemap nicht gemessen; Farben je Modus aufgelöst (hell `#1c6640`/`#7a5200`, dunkel `#51aa7b`/`#d3a03b`, im Browser gelesen). |
| 6 | Kein Status allein über Farbe | erfüllt | Zweiter Kanal Radius, streng monoton über alle sechs Stufen (`luftqualitaetStil.test.ts`); im Inspector das Wort (`FachebenenInspector.test.tsx`), unbekannt → „keine Daten". |
| 7 | Eine Farbe = eine Bedeutung | erfüllt | Rollen aus dem Vertrag (`luftqualitaetIndex`, 17. Karte), kein Blau (`bedien`); Rückfallton der Ebene von allen anderen verschieden (`fachebenen.test.ts`). |
| 8 | Helligkeits-/Kontrastregler | nicht anwendbar | App-weit, von dieser Änderung nicht berührt. |
| 9 | Kritische Anzeigen im Blickfeld | nicht anwendbar | Die Ebene löst keine kritische Anzeige aus; sie ist Lageaufklärung. |
| 10 | Alarmbudget | erfüllt | 0 Meldungen: weder Daten noch Ausfall erzeugen Toast oder Alarm (Offline-Fall im Browser: keine `.ant-message`/Notification). |
| 11 | Warnverhalten | erfüllt | Kein Blinken, kein Ton. |
| 12 | Kein Sprung unter dem Cursor | erfüllt | Aktualisierung ersetzt die Quelldaten der Karte (`setData`), keine Listeneinfügung; die Panelzeile ist statisch. |
| 13 | Fokus nie verdeckt | nicht anwendbar | Kein neues fixiertes Element; der neue Schalter steht im bestehenden Panelfluss, der Inspector ist die bestehende `KartenDetailCard`. |
| 14 | Tabellenseite vollständig | nicht anwendbar | Keine Tabelle. |
| 15 | Erfassungsmaske vollständig | nicht anwendbar | Keine Erfassung. |

**Nebenbefund, nicht Teil dieser Prüfliste:** das „offline"-Etikett bricht bei Ebenen mit
Geltungszeile um (auch Autobahn, Bestand seit LFH-80) → **LFH-601**.
