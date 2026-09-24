# Prüfliste Einsatztauglichkeit — LFH-607, Kennzahlenband Platz 3 „Evakuiert“

Die Prüfliste bezieht sich auf die Zelle „Evakuiert“ im Kennzahlenband des Lage-Dashboards.
Die übrigen Flächen der Seite sind unverändert. Ihre Verdikte stehen in den Prüflisten zu
LFH-606 und LFH-640.

| # | Kriterium | Verdikt | Beleg |
|---|---|---|---|
| 1 | Treffläche | erfüllt, unverändert | Mit Zugriff ist die Zelle ein Link über die ganze Fläche (`Kennzahl` mit `ziel`, `minHeight: controlHeight`). Ohne Zugriff ist sie kein Bedienziel und schuldet keine Treffläche. |
| 2 | Handschuh-Modus | offen → O4 aus LFH-606 | Die 1-px-Fugen zwischen den Zellen sind Bestand. Diese Änderung bringt kein neues Bedienziel. |
| 3 | Rückmeldung vor Serverantwort | nicht anwendbar | Anzeige ohne eigene Aktion. „übernehmen“ im Banner ist rein lokal (LFH-640). |
| 4 | Kritische Aktion, zweite Handlung | nicht anwendbar | Keine Aktion. |
| 5 | Kontrast | erfüllt, unverändert | Dieselbe `Kennzahl`-Komponente mit Ton `neutral` (Zahl in `text`, Tag 18,47 : 1). |
| 6 | Status nicht allein über Farbe | erfüllt | Kein Ton. Geschätzte Anteile tragen „≈“, fehlende Meldungen stehen als Wort („1 ohne Meldung“), fehlender Zugriff als Satz. |
| 7 | Eine Farbe = eine Bedeutung | erfüllt | Keine Farbe vergeben. Für „Evakuiert“ gibt es keine Schwelle, mehr Evakuierte als geplant ist keine Alarmlage. |
| 8 | Helligkeitsregler | offen → O5 aus LFH-606 | Querschnittlich, eigener Folge-Task. |
| 9 | Kritische Anzeigen im Blickfeld, dieselbe Größe an derselben Stelle | **erfüllt** | „Evakuiert“ steht nur auf Platz 3. `lagebild.test.ts`: Literal-Reihen für `[evakuiert]`, `[pegel, evakuiert]` = `[evakuiert, pegel]` (Reihe aus S3). Für jede Ausgangslage ändert `evakuiert` genau Index 2, für jede Teilmenge bleibt der Kern auf 1/3/4/5. Ohne Zugriff bleibt der Platz „Evakuiert“ und rückt nicht nach (`LageDashboardPage.test.tsx`, „Modul Betreuung ausgeblendet“). |
| 10 | Alarmbudget | erfüllt | Kein Alarmbeitrag. Das Banner erscheint nur bei einer Entscheidung (Bezirk angelegt, aufgehoben, storniert), nie bei einer Standmeldung (Integrationstest `bezirk_schaltet_die_lagekennzahl_am_einsatz`). |
| 11 | Warnverhalten | erfüllt | Kein Blinken, statisches Banner. |
| 12 | Kein Sprung unter dem Cursor | erfüllt | Die sechs Plätze stehen vor dem Einsatz-Abruf (Bestand LFH-640). Ein Wechsel des Zuschnitts ist opt-in über das Banner (`LageDashboardPage.test.tsx`, „fremde Anordnung … gehalten“). Eine neue Standmeldung ändert nur die Zahl, nicht den Platz. Der Ladezustand hält die Zellhöhe („····“). |
| 13 | Fokus nie verdeckt | erfüllt, unverändert | Keine neue Überlagerung. |
| 14 | Tabellenseite | nicht anwendbar | — |
| 15 | Erfassungsmaske | nicht anwendbar | — |
