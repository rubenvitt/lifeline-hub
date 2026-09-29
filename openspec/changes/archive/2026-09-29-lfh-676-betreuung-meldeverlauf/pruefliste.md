# Prüfliste Einsatztauglichkeit — Meldeverlauf der Betreuung (LFH-676)

Gate 7 der Bedien-Leitlinie verlangt diese Liste an jeder neuen oder umgebauten Seite.
Umgebaut ist hier die Betreuungsseite (`/einsaetze/:id/betreuung`). Die Liste bewertet nur
das, was LFH-676 hinzufügt, nämlich den Aufklappbereich „Verlauf“ an Karte und Zeile und die
Rücknahme aus dem Verlauf. Die übrigen Zeilen der Seite gelten unverändert wie in
`docs/superpowers/specs/2026-09-23-lfh-639-pruefliste.md`.

| Angabe | Wert |
| --- | --- |
| Fläche | Aufklappbereich „Verlauf“ (`components/Datensicht.tsx`, Prop `aufklappen`), Inhalt `betreuung/MeldeVerlauf.tsx`, Rückfrage-Modal darin |
| Zielkontext | Fükw (1366 px), Führungs-Tablet in `komfortabel`/`handschuh`, mobil 390 px lesend |
| Stand | Branch `feat/lfh-676-betreuung-meldeverlauf` |

**Verdikte:** **erfüllt** (mit Beleg) · **offen → Zielticket** · **nicht anwendbar** (mit
Begründung). Aus Quelltext Geschlossenes trägt **[abgeleitet]**.

## Nachweise im Browser

| Nachweis | Ergebnis |
| --- | --- |
| Gate 3, `e2e/gate3-trefflaeche.spec.ts` „Betreuung: …“, Abschnitt LFH-676 | „Verlauf“ an der Bezirkskarte **30 / 48 / 72** px (2 Knoten) · „Verlauf“ in der Stellenzeile **30 / 48 / 72** px (3 Knoten, eine Stelle geschlossen) · „Zurücknehmen“ im aufgeklappten Verlauf **30 / 48 / 72** px. Die Bestandsziele der Seite unverändert 30 / 48 / 72 px, Abstand Karte 15 / 23 / 33 px, Abstand Zeile 11 / 18 / 26 px. Lauf allein mit einem Worker, 1366 px, grün |
| Gate 1, `e2e/gate1-ueberlauf.spec.ts`, zweite Betreuungsroute mit aufgeklapptem Verlauf an Karte und Zeile | `/betreuung` mit offenem Verlauf **0 px** auf 1366 / 1024 / 390 px, alle übrigen Routen unverändert 0 px. Der erste Lauf war **rot** bei 390 px: die damals eigene Aufklappspalte hinter der fixierten Kennung glitt beim Scrollen unter sie (siehe Nr. 14) |
| Handprobe, temporäres Playwright-Skript über den e2e-Harness (nicht committet), zwei Browser-Kontexte | Bezirk mit 212, 480 und nachgetragener 300. Browser A nimmt die 300 aus dem Verlauf zurück, das ETB schreibt „Meldung zurückgenommen, Stand Bezirk ‚Uferstraße 12–40‘ bleibt 480.“, die Karte bleibt bei 480. Browser B sieht „zurückgenommen … von Administrator“ im offenen Verlauf, ohne neu zu laden. Aufnahmen bei 1366 und 390 px durchgesehen |

## Tabelle

| Nr. | Kriterium | Verdikt | Beleg / Begründung | Zielticket |
| --- | --- | --- | --- | --- |
| 1 | **Trefffläche** ≥ 24 × 24 px; zeitkritisch ≥ 48 px mit ≥ 8 px Abstand | **erfüllt** | Beide Auslöser („Verlauf“, „Zurücknehmen“) sind antd-`Button` und erben `controlHeight`. Gate 3 misst sie in allen drei Stufen (siehe Nachweise). In der Tabelle ersetzt der beschriftete Knopf antds 16-px-Aufklappsymbol, das die Staffel nie hielt | — |
| 2 | **Handschuh-Modus** — Ziel ≥ 72 px, Abstand ≥ 16 px | **erfüllt** | Gate 3 `handschuh`. „Zurücknehmen“ steht allein in der Aktionsspalte des `Zeitachseneintrag`, ohne Nachbarziel in derselben Zeile | — |
| 3 | **Rückmeldung** ≤ 100 ms | **erfüllt** | Laden in Worten („Verlauf wird geladen …“) plus Skelett, der OK-Knopf der Rückfrage läuft mit `loading`. Ein Fehler bleibt im Dialog. `MeldeVerlauf.test.tsx`: „der Ladezustand steht in Worten da, nicht nur als Skelett“, „ein Fehler bleibt IM offenen Dialog und erscheint nicht als Toast“ | — |
| 4 | **Kritische Aktion hat eine zweite Handlung** | **erfüllt** | Die Rücknahme ist unumkehrbar, deshalb gibt es eine Rückfrage mit rotem OK-Knopf (LFH-363). Solange sie läuft, lässt sich der Dialog nicht schließen, damit ein Fehlschlag nicht still verloren geht: „Abbrechen der Rückfrage sendet nichts“, „Bestätigen sendet genau EINE Rücknahme …“, „solange die Rücknahme läuft, lässt sich die Rückfrage nicht schließen“ | — |
| 5 | **Kontrast in beiden Modi** | **offen** | Keine eigenen Farbwerte: Typkante und Typwort aus `etbTypFarbe`, Zeilentönung `berichtigungZeile`, Text über Rollen. Gemessen ist das nicht, der Browser-Nachweis für die Betreuungsseite steht schon in LFH-677 | LFH-677 |
| 6 | **Kein Status allein über Farbe** | **erfüllt** | „aktueller Stand“/„aktuelle Belegung“, „⧖ nachgetragen um …“ und „zurückgenommen … von …“ stehen je als Wort. Die Tönung der zurückgenommenen Zeile ist der zweite Kanal, nicht der erste: „aktuell, nachgetragen und zurückgenommen stehen je als WORT an der richtigen Meldung“ (Mutationsprobe „Nachtrag immer falsch“ → rot) | — |
| 7 | **Eine Farbe = eine Bedeutung** | **erfüllt** | Die Kanten sind die ETB-Typfarben der zugehörigen Einträge (Meldung, Berichtigung). Rot gibt es nur am Auslöser „Zurücknehmen“ und am OK-Knopf der Rückfrage, beide destruktiv. Der Aufklapp-Auslöser ist ein blauer Link-Knopf, also Bedienung [abgeleitet] | — |
| 8 | **Helligkeits-/Kontrastregler** | **offen** | App-weite Lücke | LFH-397 |
| 9 | **Kritische Anzeigen im Blickfeld** | **nicht anwendbar** | Der Verlauf ist Zusatzinhalt auf Anforderung. Die kritische Anzeige (aktueller Stand) steht unverändert auf der Karte bzw. in der Zeile | — |
| 10 | **Alarmbudget** | **erfüllt** | Keine neue Meldung ohne Anlass. Der einzige Toast („Meldung zurückgenommen“) folgt auf eine eigene Handlung [abgeleitet] | — |
| 11 | **Warnverhalten** | **erfüllt** | Kein Blinken, kein Ton. Das ⧖ ist ein erlaubtes Textzeichen (`aria-hidden`) neben dem Wort [abgeleitet] | — |
| 12 | **Kein Sprung unter dem Cursor** | **erfüllt, als begründete Abweichung** | Ein offener Verlauf lädt bei jedem Live-Ereignis `betreuung` neu, eine neue Meldung erscheint oben in der Reihe. Das verschiebt den Inhalt unter der Karte. Die Begründung steht in design.md unter „Risks“: Der Verlauf öffnet sich nur auf ausdrücklichen Klick für genau ein Objekt, und die neue Meldung ist das, was die lesende Person sehen will. Ein Sammelbanner in einem Aufklappbereich mit einer Handvoll Einträgen wäre eine Alarmquelle ohne Gewinn. Zeilenmenge und Reihenfolge der Blöcke selbst bleiben unter der Zeilenschleuse der `Datensicht`, weil der Fokus beim Aufklappen in der Sicht liegt | — |
| 13 | **Fokus nie verdeckt** | **offen** | Nicht gemessen. Nach einer Rücknahme liegt der Fokus im Verlauf statt auf `<body>`: „nach der Rücknahme liegt der Fokus im Verlauf, nicht auf <body>“. Eine Verdeckung durch die stehende Kopfzeile der Tabelle deckt LFH-677 mit ab | LFH-677 |
| 14 | **Tabellenseite vollständig** | **erfüllt** | Der Auslöser steht in der fixierten Kennungszelle, eine eigene Aufklappspalte gibt es nicht: „tabelle: der Auslöser sitzt in der angehefteten Kennungszelle, ohne eigene Aufklappspalte“. Der erste Anlauf mit einer Spalte hinter der Kennung war in Gate 1 bei 390 px **rot**: die Spalte glitt beim Scrollen unter die Kennung, der Klick landete auf deren `<strong>`. Der Verlauf selbst ist eine Zeitachse, keine Vergleichstabelle | — |
| 15 | **Erfassungsmaske vollständig** | **nicht anwendbar** | Keine Erfassung. Die Rückfrage ist eine Bestätigung ohne Felder | — |

**Bilanz:** 10 erfüllt (eines davon als begründete Abweichung) · 3 offen · 2 nicht anwendbar.
