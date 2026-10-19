# Prüfliste Einsatztauglichkeit — LLH-1332, Patientenverbleib mit Übergabe

Die Liste deckt die umgebauten Flächen ab:
- das Sichtungsboard (Ansicht „Sichtungsraster“ der Betroffenenseite);
- die zweizeilige Zeile in „Noch nicht aufgenommen“ und „Wartebereich“ sowie die Spalte „Unterwegs“ im UHS-Grundriss;
- das Feld „Rettungsmittel“ in der Verbleib-Maske;
- die Maske „Übergabe quittieren“.

Alle anderen Flächen bleiben unverändert. Kriterien nach
`docs/superpowers/specs/2026-07-25-bedien-leitlinie-einsatzkontexte.md`, Festlegung 7.

| # | Kriterium | Verdikt | Beleg |
|---|---|---|---|
| 1 | Treffläche | erfüllt | **Board:** Die Karte führt über einen Link mit `minHeight: controlHeight` zur Detailseite. Die Sichtungsmarke ist `ZeilenSichtung`, derselbe Auslöser wie in der Zeile. **Grundriss:** „Verbleib“ und „Übergabe quittieren“ sind antd-`Button` ohne `size` und erben `controlHeight`. Die Zeile ist mindestens 48 px hoch. Die e2e-Datei `trefflaeche-pruefflaechen.spec.ts` deckt alle drei Stufen ab. |
| 2 | Handschuh-Modus | erfüllt | Alle Bedienziele folgen der Dichtestufe (`controlHeight` 32/48/72). Es gibt kein festes `size="small"` (Wächter `dichte.guard.test.ts` grün). |
| 3 | Rückmeldung vor der Serverantwort | erfüllt | Verbleib und Übergabe laufen über `useSavePersonEintrag`. Ohne Netz werden sie vorgemerkt, die Zeile zeigt „Offline vorgemerkt“. Die Maske zeigt beim Speichern den Ladezustand (`laeuft`). |
| 4 | Kritische Aktion mit zweiter Handlung | erfüllt | Die Übergabe nimmt den Patienten aus den Standardansichten. Sie braucht zwei Handlungen: den Knopf, dann die Maske mit Uhrzeit und Ziel. Rückgängig geht sie über einen neuen Verbleib, jederzeit möglich, denn der Verlauf ist append-only. |
| 5 | Kontrast in beiden Modi | erfüllt | Der Spaltenkopf des Boards nutzt `sichtungsflaechen` (Schrift auf BBK-Fläche, gerechnet in `sichtungKontrast.test.ts`). Karten nutzen die Rollen `paneel` und `text`/`text2` (15,46 bzw. 11,00 : 1). Die Marken nutzen `StatusTag` nach dem Vertrag aus `statusFarben.ts`, gerechnet in `statusFarben.test.ts`. |
| 6 | Kein Status allein über Farbe | erfüllt | Jeder Kopf trägt Wort und Zahl („SK I“, 2). Marken mit Wort: „Eigentransport“, „fremdes Rettungsmittel“, „Übergabe offen“. Die Kategorie „ohne Sichtung“ hat keine Farbe. |
| 7 | Eine Farbe = eine Bedeutung | erfüllt | `transportDurch.eigen` und `uebergabeOffen` haben die Rolle `achtung`: Sie bleiben in unserer Verantwortung bzw. die Übergabe ist offen. Fremd ist `neutral`. Es gibt keine neue gesättigte Farbe. |
| 8 | Helligkeitsregler | offen → O5 aus LFH-606 | Querschnittlich, eigener Folge-Task. |
| 9 | Kritische Anzeigen im Blickfeld | erfüllt | Die Board-Spalten stehen in fester Folge, SK I links bzw. oben. „Unterwegs“ steht an der festen Stelle der früheren Transportspalte. |
| 10 | Alarmbudget | erfüllt | „Übergabe offen“ ab 60 min ist eine stehende Marke, kein Alarm, ohne Ton und ohne Banner. |
| 11 | Warnverhalten | erfüllt | Nichts blinkt, die Marken sind statisch. |
| 12 | Kein Sprung unter dem Cursor | erfüllt | Das Board hält Menge, Spalte und Folge per Zuflussschleuse, solange Zeiger oder Fokus darin sind (Vitest „Neue Sichtung unter dem Zeiger“). Alle sieben Spalten stehen immer. Am Handy geht eine Spalte, die später voll wird, auf. Das Board springt dabei nicht seitlich (e2e bei 390 px ohne seitlichen Bildlauf). |
| 13 | Fokus nie verdeckt | erfüllt | Es gibt keine neue fixierte Überlagerung. Die Board-Spalten scrollen je für sich im Fluss. |
| 14 | Tabellenseite | erfüllt / nicht anwendbar | Die Zeilenansicht bleibt die Tabelle, unverändert. Das Board ist ein Überblick nach einer Achse, kein Vergleich (`frontend/AGENTS.md`, „Kein Nutzerschalter Tabelle ↔ Karte“). |
| 15 | Erfassungsmaske | erfüllt | Die Verbleib-Maske im Grundriss ist mit Art Transport vorbelegt, sichtbar und überschreibbar. Das Rettungsmittel hat Vorschläge und Fokus. Die Übergabe-Maske hat die Uhrzeit (Platzhalter „jetzt“) und das bisherige Ziel vorbelegt. Labels stehen über dem Feld, die Bedienung geht ganz über die Tastatur (Enter-Schutz am AutoComplete). |
