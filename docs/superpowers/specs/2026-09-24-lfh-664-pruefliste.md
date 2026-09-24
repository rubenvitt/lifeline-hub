# Prüfliste Einsatztauglichkeit — Sprungpalette: Vorschau für alle Datensatzsorten (LFH-664)

Gate 7 der Bedien-Leitlinie (`2026-07-25-bedien-leitlinie-einsatzkontexte.md`, Festlegung 7).
Umgebaut ist keine Seite. Neu sind elf Lese-Vorschauen in der Sprungpalette (Taste →):
ETB-Eintrag, Meldung, Auftrag, Fahrzeug, Personal, Einheit, Schaden, Unfallhilfsstelle,
Lagebericht, Gefahrengebiet (mit Matrixauszug) und Einsatzabschnitt. Die Mechanik (Taste,
Rückweg, Fußzeile) stammt aus LFH-645 und ist dort geprüft
(`2026-09-23-lfh-645-pruefliste.md`). Mitgeprüft sind die drei Fachseiten, deren Leseteil
herausgelöst wurde.

| Angabe | Wert |
| --- | --- |
| Fläche | Vorschau-Region in `command-palette/CommandPalette.tsx`; Bauteile `etb/EtbEintragVorschau`, `meldungen/MeldungVorschau`, `auftraege/AuftragVorschau`, `kraefte/{Fahrzeug,Personal,Einheit}Vorschau`, `pages/schaeden/SchadenVorschau`, `pages/uhs/UhsVorschau`, `lageberichte/LageberichtVorschau`, `pages/gefahren/GefahrengebietVorschau` (+ `GefahrenMatrixAuszug`), `pages/einsatzabschnitte/AbschnittVorschau` |
| Mitbetroffen | `SchaedenDetailPage` (→ `SchadenDaten`), `LageberichtDetailPage` (→ `LageberichtText`), `EinsatzabschnittePage` (→ `AbschnittDaten`, jetzt `Datenraster` statt `Descriptions`), `FahrzeugePage`/`PersonalPage` (Statusableitung nach `kraefte/mittelStatus.ts`) |
| Stand | Branch `feat/lfh-664-palette-vorschau-datensatzsorten`, Basis `origin/alpha` |
| Zielkontext | Fükw (Tastatur + Maus). Tablet und mobil erreichen die Vorschau weiter nicht (LFH-665) |

**Verdikte:** erfüllt (mit Beleg) · offen → Zielticket · nicht anwendbar (mit Begründung).
Gerechnetes und aus Quelltext Geschlossenes trägt **[abgeleitet]**.

## Nachweise

| Nachweis | Ergebnis |
| --- | --- |
| Vitest je Bauteil (`*Vorschau.test.tsx`, `GefahrenMatrixAuszug.test.tsx`) | Inhalt, Status mit Wort, „nicht mehr vorhanden“, nur lesen (keine Knöpfe/Auswahl), bei allen Listensorten „warmes Fach → kein Abruf“ |
| `VorschauZustand.test.tsx` | Laden, ohne Verbindung (nicht „nicht mehr vorhanden“), Fehler mit Wiederholen, veralteter Stand mit Hinweis |
| Guard `datensaetze.test.ts` | Jede der 13 Datensatzquellen trägt ihr Ziel mit Sorte, Einsatz und id (ETB mit `lfdNr`), der Sammeltreffer keins. Mutationsprobe: ein entfernter `vorschau`-Baustein (UHS) färbt ihn rot |
| `datensatzAbfrage.test.ts` | Schlüssel byte-gleich gegen Literale, Frische `FRISCH_MS` |
| `CommandPalette.vorschauVerweis.test.tsx` | Verweis schließt die Palette; Text/„Zurück“ nicht; Esc vom fokussierten Verweis führt eine Ebene zurück |
| e2e `palette-oeffnung.spec.ts` (2 neue Fälle) | Meldung: → zeigt Inhalt ohne „Sichten“, Klick auf „↗ Auftrag“ landet auf den Aufträgen, Palette zu. ETB per `#n`: → zeigt Inhalt und „von“, Esc zurück mit Begriff |
| Seitentests | `SchaedenDetailPage`, `LageberichtDetailPage`, `EinsatzabschnittePage`, `FahrzeugePage`, `PersonalPage`, `GefahrenPage` grün; in `EinsatzabschnittePage.test.tsx` nur der Anker einer Abfrage von `tr` auf `datenfeld` umgestellt |

## Kriterien — gemeinsam für alle elf Vorschauen

| Nr. | Kriterium | Verdikt | Beleg / Begründung | Zielticket |
| --- | --- | --- | --- | --- |
| 1 | Treffläche | **erfüllt [abgeleitet]** | Neue Bedienziele gibt es nur als Verweise in Meldung, Auftrag und ETB (Router-`Link`) und den Kopf „Befehlsdetails“ (antd-`Collapse`) der Auftragskarte. Sie sind dieselben Elemente wie auf den Fachseiten. „Zurück“ ist unverändert gemessen (LFH-645) | — |
| 2 | Handschuh-Modus | **offen** | Den Weg in die Vorschau gibt es auf Touch nicht, nur per → | LFH-665 |
| 3 | Rückmeldung vor der Serverantwort | **erfüllt** | Die Vorschau erscheint im selben Tastendruck. Bei warmem Fach steht der Inhalt ohne Abruf da (Tests „kein Abruf“), sonst ein benannter Ladezustand, ohne Netz ein eigener Satz, bei Fehler `SeitenFehler` mit Wiederholen (`VorschauZustand.test.tsx`) | — |
| 4 | Kritische Aktion mit zweiter Handlung | **nicht anwendbar** | Die Vorschauen lesen nur; Aktionsknöpfe der Karten sind abwesend (je Bauteil getestet) | — |
| 5 | Kontrast in beiden Modi | **offen** | Die ETB-Typwörter sind für den Grund `grund` abgestimmt und stehen in der Palette auf `flaeche2`: gerechnet Tag mindestens 7,1 : 1, Nacht mindestens 5,9 : 1, damit über den Böden 7 : 1 / 5 : 1 **[abgeleitet]**. Im Browser gemessen ist das nicht; die gedämpften Fußhinweise der Palette bleiben die bekannte Lücke | LFH-643 |
| 6 | Kein Status allein über Farbe | **erfüllt** | Jeder Status steht mit Wort (`StatusTag`/`StatusChip`/`StatusBadge`), Mandantenfarben nur am Rand. Matrixzellen tragen das Kürzel und einen zugänglichen Namen „Gefahr × Schutzobjekt: Stufe“, ungültige Paare „n. a.“ (`GefahrenMatrixAuszug.test.tsx`) | — |
| 7 | Eine Farbe = eine Bedeutung | **erfüllt [abgeleitet]** | Keine neuen Farbliterale; Flächen und Balken der Matrix kommen aus denselben Helfern wie die volle Matrix (`zellFlaechenStil`) | — |
| 8 | Helligkeits-/Kontrastregler | **offen** | App-weite Lücke | LFH-397 |
| 9 | Kritische Anzeigen im Blickfeld | **erfüllt** | Fehler, „ohne Verbindung“ und „nicht mehr vorhanden“ stehen an der Stelle des Inhalts in der Palette, nicht in einem Toast | — |
| 10 | Alarmbudget | **erfüllt [abgeleitet]** | Kein Toast, keine Meldung aus Live-Ereignissen | — |
| 11 | Warnverhalten | **erfüllt [abgeleitet]** | Keine Animation, kein Ton | — |
| 12 | Kein Sprung unter dem Cursor | **erfüllt** | Die Vorschau folgt Live-Änderungen in ihrem Fach (Test Fahrzeug, Abschnitt „aufgelöst“) ohne Neuaufbau der Region; die gezeigte Sorte wechselt nicht, weil die Palette den Befehl als Objekt hält (LFH-645) | — |
| 13 | Fokus nie verdeckt | **erfüllt [abgeleitet]** | Fokusziele in der Region (Verweise, Collapse-Kopf) liegen im scrollenden Körper derselben Höhe wie die Liste; Esc/← von dort führen zurück (Test). Ein Tab-Durchlauf im Browser ist nicht gemessen | — |
| 14 | Tabellenseite vollständig | **nicht anwendbar** | Der Matrixauszug ist eine Lese-Übersicht, keine Vergleichstabelle mit Spaltenwahl; die volle Matrix bleibt auf der Gefahrenseite | — |
| 15 | Erfassungsmaske vollständig | **nicht anwendbar** | Keine Erfassung | — |

**Bilanz:** 9 erfüllt (davon 6 [abgeleitet]) · 3 offen (LFH-665, LFH-643, LFH-397) · 3 nicht anwendbar.

## Abweichungen je Sorte

Nur die Zeilen, die für eine Sorte anders lauten als oben; alle übrigen gelten unverändert.

| Sorte | Nr. | Verdikt | Beleg / Begründung |
| --- | --- | --- | --- |
| ETB-Eintrag | 5 | **offen → LFH-643** | Typwort auf `flaeche2` gerechnet, siehe oben |
| ETB-Eintrag | 9 | **offen → LFH-689** | Eine Nummernlücke zeigt nicht den nächstälteren Eintrag, sondern „nicht mehr vorhanden“, und eine Berichtigung verweist auf ihren Grundeintrag (`EtbEintragVorschau.test.tsx`). Am berichtigten Grundeintrag fehlt dagegen „berichtigt durch Nr. …“ — ein überholter Eintrag ist in der Vorschau nicht als überholt erkennbar |
| Meldung | 6 | **erfüllt** | Status über `StatusBadge` mit Fachwort, Priorität mit Wort, Alarmzustand der Karte mit „Alarm“ als Text (unveränderte `MeldungKarte`) |
| Auftrag | 1 | **erfüllt [abgeleitet]** | Kopf „Befehlsdetails“ ist antds `Collapse`-Kopf wie auf der Seite; er klappt nur auf, verändert nichts |
| Fahrzeug, Personal, Einheit | 6 | **erfüllt** | Mandantenfarbe erzwingt die Rand-Form, das Wort steht immer daneben; Einheit „gemischt“ mit Verteilung als Text |
| Gefahrengebiet | 3 | **erfüllt** | Die Matrix ist ein eigener Abruf mit eigenem Lade- und Fehlerzustand; das Gebiet bleibt dabei sichtbar |
| Gefahrengebiet | 6 | **erfüllt** | Siehe oben; „keine“ heißt „keine Stufe gesetzt“, nicht „unbewertet“ |
| Einsatzabschnitt | 3 | **erfüllt** | Die Stärke lädt getrennt („wird geladen …“ / „nicht abrufbar“), der Abschnitt steht sofort |
| Einsatzabschnitt (Seite) | 12 | **erfüllt [abgeleitet]** | Der Lesezweig wechselt von `Descriptions` (1 Spalte) auf `Datenraster` (2 Spalten); das ist ein Layoutwechsel beim Deploy, kein Sprung zur Laufzeit. Bewusst umgestellt: „Fortschritt“ steht vor dem breiten „Abschnittsauftrag“, sonst risse er ein Loch in die zweispaltige Zeile |
