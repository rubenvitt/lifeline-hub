# Design

## Context

Motivation: siehe `proposal.md`, Anforderungen: `specs/fachebene-luftqualitaet/spec.md`.

Der Fachebenen-Aggregator (LFH-69) trägt sechs Quellen nach einem festen Muster:
`routes/karte.rs::fachebenen` verteilt per `match` auf `karte::quellen::fetch_*`, das über
`liefere_mit_swr` gegen den persistenten Cache (`karte::cache`, eigene Cache-DB) arbeitet und
bei Fehlschlag `FachebeneAntwort::offline` liefert. Die Rohdaten normalisiert
`karte::normalisierung` zu einer flachen GeoJSON-`FeatureCollection`. Nächste Vorlage ist die
Hochwasserebene (LFH-77): Punkte mit einer Klasse als Wire-Wort, beidseitig gepinnt, im
Frontend über eine Vertragskarte in `theme/statusFarben.ts` und eine eingebackene
Farbe/Radius (`hochwasserStil.ts`) dargestellt.

**Gemessene Eigenschaften der Quelle** (21.09.2026, alle per `curl` gegen die Live-API):

| Befund | Messung |
|---|---|
| Host | `https://www.umweltbundesamt.de/api/air_data/v2/…` antwortet **301** auf `https://luftdaten.umweltbundesamt.de/api/air-data/v2/…` (Bindestrich statt Unterstrich) |
| `/stations/json` | 2400 Stationen, 1175 ohne `station active to`; ~560 KB; Zeilen als Arrays, Spaltennamen in `indices` |
| `/airquality/json` | **ein** Abruf für alle Stationen (kein N+1): 388 Stationen; ~140 KB für 6 h, ~300 KB für einen Tag; tagesübergreifendes Fenster funktioniert |
| Struktur | `data[station_id][start] = [ende, gesamtindex, unvollstaendig, [komp_id, wert, teilindex, y], …]`; das Ende der letzten Tagesstunde heisst `…-20 24:00:00` |
| Zeitzone | `indices` sagt wörtlich `date start (CET)`; Abruf 11:39 MESZ lieferte als jüngste Stunde Start 08:00 → MEZ fest, **ohne Sommerzeit** |
| Verzug | jüngste Stunde endet ~1,5–2,5 h vor dem Abruf; 5 von 388 Stationen hingen eine weitere Stunde zurück |
| Indexskala | 0-basiert, 0 = „sehr gut": NO₂ 0–20 → 0, 21–40 → 1, 41–54 → 2; O₃ 0–60 → 0, 61–90 → 1 — deckungsgleich mit den UBA-Klassengrenzen |
| Verteilung | Index 0: 274, 1: 106, 2: 8; `data incomplete = 1` bei 209 von 388 |
| `index`-Echo | das `request.index`-Echo meldete bei tagesübergreifenden Fenstern `code`, **auch mit explizitem `index=id`** — die Schlüssel waren trotzdem numerische IDs |
| Komponenten | 12 IDs (`/components/json`), im Index vorkommend: 1 PM10, 3 O₃, 5 NO₂ (gemessen); 9 PM2,5, 4 SO₂, 2 CO laut Katalog möglich |

## Goals / Non-Goals

**Goals:**

- Eine siebte Fachebene nach dem bestehenden Muster, ohne den Umschlag, den Cache oder die
  Layer-Primitive zu verändern.
- Jede gemessene Falle der Quelle (Host, Zeitzone, `index`-Echo) als Test gepinnt statt als
  Kommentar behauptet.

**Non-Goals:**

- **Historie/Zeitreihen** (`/measures`, Tagesverläufe) — die Ebene zeigt den Ist-Stand.
- **Ausbreitungsprognosen** oder eine Aussage über die Luft *am Einsatzort* zwischen den
  Stationen: die Ebene zeigt Messpunkte, keine Fläche. Eine Interpolation behauptete eine
  Messung, die es nicht gibt.
- **Eigener Zustand „veraltet"**: jede Station trägt ihren Messzeitpunkt, der Inspector zeigt
  ihn. Eine Veraltet-Klasse wäre eine Erweiterung des Klassen-Vertrags.
- **Einzelkomponenten-Grenzwerte** (Überschreitungen nach 39. BImSchV) — eigene Fachfrage.

## Decisions

**D1 — Der Indexabruf treibt, die Stationsliste löst auf.** Features entstehen nur aus
`/airquality`. Alternative „alle aktiven Stationen zeichnen, ohne Index grau" verworfen: 787
Punkte ohne Messwert überdecken die 388 mit Aussage und behaupten ein Messnetz, das gerade
nichts meldet.

**D2 — Finaler Host fest in der Konstante.** `https://luftdaten.umweltbundesamt.de/api/air-data/v2`,
nicht der im Ticket genannte, weiterleitende Host. Der Fachebenen-Client folgt Redirects zwar
per reqwest-Default, aber ein Verlass auf die Weiterleitung ist ein zusätzlicher Round-Trip je
Abruf und bricht still, sobald der alte Pfad abgeschaltet wird. Der 301 steht als Befund in
der Doku.

**D3 — `index=id` explizit setzen, dem Echo nicht trauen, über ID *und* Code auflösen.** Die
Schlüssel der Indexantwort werden gegen eine Stationstabelle aufgelöst, die unter ID **und**
unter Stationscode eingetragen ist. Grund: das Echo `request.index` widerspricht den
tatsächlichen Schlüsseln (gemessen), der Default des Parameters ist also nicht verlässlich
dokumentiert. Liefe die Quelle eines Tages wirklich nach Code geschlüsselt aus, bliebe die
Ebene mit einer reinen ID-Tabelle **still leer** — `status: leer`, kein Fehler, kein roter
Test. Der Normalisierer-Test deckt beide Schlüsselformen ab.

**D4 — Abfragefenster: die letzten sechs Stunden in MEZ, rein und exportiert.** Eine reine
Funktion bildet `now (UTC)` auf `date_from/time_from/date_to/time_to` in MEZ (UTC+1 fest)
ab. `time_*` sind Stundenenden 1–24 (gemessen: `time_from=1` → `datetime_from 00:00`).
Sechs Stunden decken den gemessenen Verzug (≤ ~3 h) samt Nachzüglern mit Reserve ab und
kosten ~140 KB statt ~300 KB für einen Tag. Getestet wird kurz nach Mitternacht (Fenster
über den Tageswechsel) und im Sommer (MESZ darf nicht einfließen).

**D5 — Zeitstempel: MEZ fest, Stundenende, RFC 3339 mit `+01:00`.** Der Messzeitpunkt ist
der erste Tupelwert (`date end`), ausgegeben als `2026-09-21T09:00:00+01:00`. Nicht
`Europe/Berlin`: die Quelle führt ausdrücklich CET, eine zonenbewusste Umrechnung verschöbe
jeden Sommerwert still um eine Stunde — dieselbe Fehlerklasse wie in `etb/filterZeit.ts`.
Das Stundenende der letzten Tagesstunde kommt gemessen als `2026-09-20 24:00:00` — kein
gültiger Zeitpunkt für einen Parser — und wird auf 00:00 des Folgetags normalisiert; ein
naiver Parse verwürfe genau die Mitternachtsstunde. `stand` = Maximum der Messzeitpunkte. Test gegen den **absoluten** Zeitpunkt,
nicht als Round-Trip.

**D6 — Leitschadstoff: höchster Teilindex, Gleichstand über `y`.** Der vierte Tupelwert
(`y-value`) ist gemessen der Wert relativ zur Obergrenze der „sehr gut"-Klasse (O₃ 60 → 1,
PM10 12 → 0,6) und damit über Komponenten vergleichbar. Bei gleichem Teilindex gewinnt der
höhere `y`; das bestimmt den Leitschadstoff auch bei Stufe 0 sinnvoll. Kürzel aus einer
kleinen, eingebauten Tabelle (Komponenten-ID → `PM10`/`PM2,5`/`O₃`/`NO₂`/`SO₂`/`CO`), nicht
per drittem Abruf von `/components`: der Katalog ist seit Jahren unverändert, und ein
dritter Aufruf verdoppelte die Ausfallfläche für ein Etikett. Unbekannte ID → Kürzel
`Komponente <id>`, der Wert bleibt erhalten.

**D7 — Feature-Properties flach.** `titel` (Stationsname), `code`, `ort`, `klasse`,
`index` (Zahl oder fehlt), `leitschadstoff`, `zeitpunkt`, `unvollstaendig` (bool),
`umgebung`/`stationstyp` aus der Stationsliste, `kategorie = "luftmessstation"`, und je
Komponente ein Wertepaar `wert_<kuerzel>` + `einheit_<kuerzel>` (MapLibre stringifiziert
Verschachteltes). Die Einheiten stammen aus derselben Tabelle wie D6.

**D8 — Zwei Abrufe, beide im selben Cache-Zyklus, TTL 900 s.** Jede Aktualisierung holt
Stationsliste und Index; scheitert einer, ist der Lauf gescheitert (kein `leer` in den
Cache). Alternative „Stationsliste gesondert 24 h cachen" verworfen: der Cache speichert
`FachebeneAntwort`-Umschläge, ein zweiter Eintragstyp wäre ein neuer Mechanismus für
~560 KB alle 15 Minuten. TTL 900 s statt der im Ticket genannten Analogie zu KRITIS (24 h):
die Werte ändern sich stündlich zu einem unregelmäßigen Importzeitpunkt, eine Stunde TTL
legte eine weitere Stunde auf den ohnehin ~2 h großen Verzug. Frontend-Poll = TTL.
`liefere_mit_swr` genügt (zwei Abrufe < 1 s gemessen) — anders als Autobahn hängt der Lauf
blockierend am ersten Request.

**D9 — Vertragskarte `luftqualitaetIndex` in `theme/statusFarben.ts`, fünf Stufen auf drei
Rollen.** `sehr_gut`/`gut` → `normal`, `maessig` → `achtung`, `schlecht`/`sehr_schlecht` →
`alarm`, `keine_daten` → `neutral`. Begründung der Zuordnung: das UBA beschreibt „mäßig" als
Stufe, ab der Wirkungen bei Langzeit- und Kombinationsexposition nicht auszuschließen sind —
Anlass zur Aufmerksamkeit, kein Alarm; ab „schlecht" empfiehlt das UBA empfindlichen Gruppen,
Aktivität im Freien zu meiden. Die Zählung im Abdeckungstest steigt von 16 auf 17 (bewusste
Vertragsentscheidung, siehe Proposal). Kein Blau: `bedien` ist eine Beziehung, kein Zustand.

**D10 — Zweiter Kanal = Radius, eingebacken wie Hochwasser.** Neues
`pages/lagekarte/luftqualitaetStil.ts` nach dem Muster von `hochwasserStil.ts`: Radius je
Stufe streng monoton (keine_daten 3 · sehr_gut 4 · gut 5 · maessig 6 · schlecht 8 ·
sehr_schlecht 9), Farbe per `rollenFarbe` aus dem aktiven Token, beides in die Properties
geschrieben; der bestehende Circle-Layer liest `['get','farbe']`/`['get','radius']` bereits.
Unbekanntes Wort → `keine_daten`, nie Rohwert.

**D11 — `useFachebenen`: Eintrag hinten anhängen.** Die Queries werden in `combine`
positionsweise abgegriffen; die neue Query kommt als **siebter** Eintrag ans Ende, damit kein
bestehender Index wandert. Ein Test belegt, dass nach dem Einschalten der neuen Ebene die
Autobahn-Daten weiter unter `autobahn` stehen (die stille Verwechslung, vor der der Kommentar
dort warnt). Panel-Reihenfolge (`fachebeneKeys`): hinter `hochwasser`, vor `kritis` —
Umweltmesswerte neben den übrigen Messnetzen.

**D12 — Doku: Lizenz-Vorbehalt statt Behauptung.** Die Einordnung als DL-DE-BY-2.0 stammt aus
Sekundärquellen (GDI-DE-Metadatensatz „Luftdaten Deutschland API" im Suchresümee, Open-Data-
Katalog Oldenburg); die API und die Luftdaten-Seiten nennen keine Lizenz. Die
Pflicht-Attribution „Umweltbundesamt" wird unabhängig davon immer mitgeführt, genau wie beim
Lizenz-Vorbehalt Autobahn. Die bestehende KRITIS-Zeile nennt 3600 s TTL, der Code 24 h — diese
Abweichung wird im selben Zug korrigiert, weil der neue Eintrag sich darauf bezieht.

## Risks / Trade-offs

- [Inoffizielle API, keine Stabilitätszusage (bundesAPI)] → Offline-Pfad wie bei allen
  Quellen; Strukturbruch (fehlendes `data`, keine Arrays) ergibt `offline`, keinen 5xx.
- [Stiller Leerlauf bei Schlüsselwechsel ID ↔ Code] → D3, Test mit beiden Formen.
- [Stille Zeitverschiebung um eine Stunde] → D5, Test gegen absolute Zeitpunkte im Sommer.
- [Verzug ~2 h wirkt wie „keine aktuelle Lage"] → Messzeitpunkt im Inspector sichtbar;
  `stand` im Umschlag; kein Versprechen von Echtzeit in der Oberfläche.
- [Messnetz dünn am Einsatzort] → Non-Goal Interpolation; die Ebene zeigt Punkte, keine
  Fläche. Die Aussage „keine Station in der Nähe" bleibt beim Betrachter sichtbar.
- [209 von 388 Werten „unvollständig"] → als Wort im Inspector, nicht als Farbe und nicht als
  Filter: der Wert ist die amtliche Einstufung, nur mit weniger Komponenten.
- [Rund 0,7 MB je 15 min gegen eine Behörden-API] → unkritisch; ein Abruf je TTL durch
  `inflight`-Sperre, unabhängig von der Nutzerzahl.

## Migration Plan

Keine Migration. Deploy mit dem nächsten Release; ohne Einschalten der Ebene entsteht kein
ausgehender Abruf. Rollback = Revert, gespeicherte Ansichten mit `luftqualitaet: true`
werden von älteren Ständen ignoriert (sie lesen per Aufzählung, nicht per Spread).
