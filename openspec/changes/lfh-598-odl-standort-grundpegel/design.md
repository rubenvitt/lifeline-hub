# Design

## Context

Motivation siehe `proposal.md`. Stand aus LFH-78: `fetch_odl` (`src/karte/quellen.rs`)
holt `odlinfo_odl_1h_latest` per `liefere_mit_swr` (TTL 600 s) und schreibt die
normalisierte Antwort unter `odl` in `fachebenen_cache`; `normalisiere_odl`
(`src/karte/normalisierung.rs`) setzt dabei die Stufe aus absoluten Bändern (`odl_stufe`).
Das Frontend färbt über `odlStil.ts` + Vertragskarte `odlStufe` und zeigt Details in
`OdlInhalt` (`FachebenenInspector.tsx`).

**Kein Abruf läuft von selbst.** Die Fachebenen haben keinen Scheduler; `liefere_mit_swr`
erneuert nur, wenn ein Client die Route ruft. Eine „eigene Historie aus den ohnehin
laufenden 10-min-Abrufen", wie das Ticket sie vorschlägt, hätte also genau dann Lücken,
wenn niemand die Ebene offen hat — und wäre nach einem ruhigen Wochenende leer.

**Gemessen am 21.09.2026 (BfS-WFS, `opendata:odlinfo_timeseries_odl_1h`):**

| Befund | Wert |
|---|---|
| Inhalt ohne Filter | 263 687 Stundenwerte aller Sonden, ältester `2026-09-14T15:00Z` (≈ 167 h, Aufbewahrung der Quelle) |
| `resultType=hits`, `CQL_FILTER=id='DEZ3354'` | 167 Werte — eine Sonde, volle sieben Tage |
| Bereichsfilter `end_measure >= …` (24 h) | 39 342 Werte — Filter wirken serverseitig |
| `CQL_FILTER=end_measure IN (…)`, 28 Zeitpunkte à 6 h, `propertyName=id,end_measure,value` | HTTP 200, 42 600 Werte, **8,65 MB, ~10 s**; `name` kommt trotz `propertyName` mit, `geometry` ist `null` |
| Abdeckung dieser Stichprobe | 1 585 Sonden (≈ 1 584 „in Betrieb" aus `_latest`); 27 Zeitpunkte belegt (der 28. lag in der Zukunft); 1 468 Sonden mit 27 Werten, 100 mit 26, 17 mit 10–25; keine `null`-Werte |
| Streuung ohne Lage (je Sonde, Wert ÷ Median) | p50 1,08 · p99 1,67 · max 2,27; ≥ 1,5 × bei 23 von 42 559 Werten (0,05 %), ≥ 2 × bei 2 |
| Median ÷ unteres Quartil je Sonde | p50 1,015 · max 1,056 |
| Median der Mediane / Spanne | 0,108 µSv/h · 0,045–0,234 |

## Goals / Non-Goals

**Goals:**
- Grundpegel je Sonde aus **einem** Abruf je Tag, ohne neuen Mechanismus (kein Scheduler,
  keine Migration).
- Die ODL-Route antwortet so schnell wie heute; der Grundpegel kommt nie in ihren
  Antwortpfad.

**Non-Goals:**
- Zeitreihen- oder Verlaufsanzeige je Sonde.
- Niederschlags-Korrektur. Der BfS führt dafür `opendata:odlinfo_timeseries_precipitation_15min`
  — Regen ist der bekannte Störfaktor, eine Verrechnung ist aber eine eigene Entscheidung.
- gzip für den gemeinsamen `reqwest`-Client (LFH-599) — käme dem Grundpegel-Abruf stark
  zugute, ändert aber die Vorgabe aller Clients.
- Ein Hintergrund-Scheduler, der Fachebenen ohne Nachfrage abruft.

## Decisions

### 1. Quelle: `odlinfo_timeseries_odl_1h` mit 28-Zeitpunkte-Stichprobe, ein Abruf je Tag
Ein Abruf mit `CQL_FILTER=end_measure IN (…)` über 28 Zeitpunkte (volle UTC-Stunden im
Sechs-Stunden-Raster rückwärts ab der letzten vollen Stunde, soweit sie im
Sieben-Tage-Fenster liegen) und `propertyName=id,end_measure,value,unit`.
**Verworfen:**
- *Eigene Historie aus den 10-min-Abrufen* — Lücken ohne Nachfrage (Context), Kaltstart von
  Tagen, und eine Tabelle, die mitwächst.
- *Voller Sieben-Tage-Bereich* — ~263 000 Werte, hochgerechnet ~50 MB je Abruf.
- *`odlinfo_timeseries_odl_24h`* — eine Sonde je Abruf (LFH-78, gemessen).
- *Zeitpunkte nur nachts* — spart Volumen, aber vier Zeitpunkte je Tag verteilen sich über
  Tageszeiten und damit über Wetterlagen; die Stichprobe von 27 Werten macht das Quartil
  belastbar (Decision 2).

Der Zeitpunkt-Filter verliert Stunden **absichtlich**: er ist die Stichprobe, nicht ein
Versehen. Ein Zeitpunkt, den die Quelle (noch) nicht hat, fehlt einfach — die
Mindestzahl (Decision 2) fängt das ab.

### 2. Grundpegel = unteres Quartil, Mindestzahl 20 Werte
Je Sonde das untere Quartil (25-%-Quantil, nächstgelegener Rang) ihrer Stichprobe.
**Warum nicht der Median** (Ticket-Vorschlag): ohne Lage liegen beide gemessen innerhalb
von 1,5 % (p50 1,015), in einer Lage aber nicht — über 27 Werte hebt eine dreitägige
Verdreifachung den Median noch nicht, eine viereinhalbtägige hebt ihn voll auf das
Lageniveau, das untere Quartil erst nach über fünf Tagen. Der Grundpegel folgt einer Lage
damit später, ohne ohne Lage anders zu sein.
**Mindestzahl 20** (≈ fünf von sieben Tagen): 1 568 von 1 585 Sonden haben 26–27 Werte;
darunter liegen frisch in Betrieb genommene oder zeitweise ausgefallene Sonden, deren
Grundpegel auf zu wenigen Tagen stünde. Sie werden absolut bewertet.
Nur Werte in `µSv/h` zählen (dieselbe Einheitenregel wie LFH-78, Decision 1); ein
Grundpegel ≤ 0 wird verworfen (Division).

### 3. Sperrklinke gegen das Mitwandern: Anstieg ≥ 1,5 × wird verworfen
Das Quartil verzögert das Mitwandern, verhindert es aber nicht. Bei jeder Neuberechnung
wird je Sonde gegen den **gespeicherten** Grundpegel verglichen: ergäbe sie das 1,5-Fache
oder mehr (dieselbe Schwelle wie `erhoeht`), bleibt der alte Wert **samt seinem Stand**
stehen. Sinken und leichtes Steigen werden übernommen (Schneeschmelze, Sondentausch).
Der sichtbare Stand im Inspector zeigt dann, dass ein Grundpegel älter ist als üblich.
**Verworfen:** *festes Einfrieren* auf Knopfdruck/Einsatzbeginn — braucht eine Bedienung und
eine Instanz-weite Frage „wer friert ein?"; *Fenster ohne die letzten 24 h* — verschiebt
das Problem um einen Tag.
**Höchstens 14 Tage** (Nachtrag aus dem Review): ohne Grenze hielte die Sperrklinke einen
Pegel für immer — der Eintrag wird täglich neu geschrieben und altert nie, ein Sondentausch
mit +50 % stünde dauerhaft auf `erhoeht`. Nach 14 Tagen über seinen Stand hinaus wird die
Neuberechnung übernommen; eine längere Lage zieht den Maßstab ab dann mit, der Stand im
Inspector zeigt, seit wann er gilt. **Schleichender Anstieg** knapp unter 1,5 × je Tag kommt
durch, das Quartil bremst ihn nur — bewusst hingenommen.
**Grenze:** die Sperrklinke kennt nur den zuletzt gespeicherten Stand; der Eintrag ist
deshalb vom Prune ausgenommen (Decision 4).

### 4. Ablage: eigener Schlüssel `odl:grundpegel` im bestehenden Cache, TTL 24 h
Ein JSON-Objekt `{ kennung → { pegel, n, stand } }` (~1 600 Einträge, ~100 KB) unter
eigenem Schlüssel in `fachebenen_cache`. `FachebeneAntwort` ist dafür der falsche Umschlag;
`cache.rs` bekommt ein generisches Lese-/Schreibpaar für serialisierbare Werte auf derselben
Tabelle (die Spalte ist ohnehin JSON-Text). **Keine Migration.**
**Vom Prune ausgenommen** (Nachtrag aus dem Review): das Prune-on-Write räumt alles über
2 Tage, und der `odl`-Eintrag wird alle zehn Minuten geschrieben. Wäre die Zeitreihe länger
als zwei Tage gestört, während `_latest` antwortet, verschwände der Grundpegel samt
Sperrklinken-Gedächtnis — gegen die Spec („früher berechneten Grundpegel weiterverwenden").
Ein Eintrag, ~100 KB, er wächst nicht.
**Nichts schreiben** bei Formatbruch, bei keinem einzigen Pegel und bei weniger als der
Hälfte der bisher bekannten Sonden (etwa ein serverseitiges Feature-Limit) — reiner Kern
`odl_grundpegel::neue_karte`.
**Verworfen:** eigene Tabelle `odl_grundpegel` — mehr Bau für dieselbe Aussage, und LFH-78
war ausdrücklich „ohne neuen Mechanismus".

### 5. Abruf: immer im Hintergrund, eigener Timeout, Abkühlung — Muster Autobahn
`fetch_odl` stösst die Erneuerung des Grundpegels an, wenn er fehlt oder älter als 24 h
ist, und **wartet nie darauf** — auch nicht im kalten Fall (hier weicht es bewusst vom
kalten Zweig von `liefere_mit_swr` ab, der blockiert). Bauform wie `fetch_autobahn`:
`inflight`-Schlüssel gegen parallele Läufe, Abkühlung von einer Stunde nach einem
Fehlschlag, damit ein gestörter GeoServer nicht bei jedem 10-min-Poll 8,6 MB anfragt.
Eigener Timeout **90 s** per `.timeout()` am Request (Muster `KRITIS_TIMEOUT`): die 8 s des
gemeinsamen Clients reichen gemessen nicht (10 s bei guter Leitung), und bei ~1 Mbit/s auf
einem Fükw braucht der Abruf ~70 s. Da er niemanden blockiert, kostet der lange Timeout
nur einen gebundenen Hintergrund-Task.
Eine Antwort ohne `features`-Liste ist ein Formatbruch → `None`, nichts wird geschrieben,
der alte Grundpegel bleibt (Muster `odl_antwort`).

### 6. Bewertung bei Auslieferung, nicht beim Normalisieren
`normalisiere_odl` bleibt wie es ist und setzt weiter die absolute Stufe — der
`odl`-Cacheeintrag ist damit auch ohne Grundpegel vollständig. `fetch_odl` liest nach
`liefere_mit_swr` den Grundpegel-Eintrag und wendet eine **reine** Funktion
`bewerte_odl(features, grundpegel)` an, die je Sonde mit Wert, Einheit `µSv/h` und
Grundpegel `stufe` überschreibt und `bewertung`, `grundpegel`, `faktor`,
`grundpegel_stand` setzt; alle anderen bekommen `bewertung: "absolut"` und keines der drei
Felder. **Warum bei Auslieferung:** ein neuer Grundpegel wirkt beim nächsten Poll, statt bis
zu zehn Minuten hinter einer schon gecachten ODL-Antwort zu warten; und der Kaltstart löst
sich ohne Sonderpfad auf. Kosten: ein ~100-KB-JSON parsen je Request — die Clients pollen
im Zehn-Minuten-Takt.

**Grenzen als Multiplikation, nicht als Division:** `wert <= 1.5 * pegel` bzw.
`wert <= 3.0 * pegel`. Das hält die Grenzen inklusiv nach unten wie in LFH-78 und
überlebt die Gleitkommadarstellung (0,3 ÷ 0,1 ergibt 2,9999…, 3 × 0,1 ergibt 0,30000…04 —
beide Fehler fallen so in dieselbe, spezifizierte Richtung). Der ausgelieferte `faktor` ist
auf zwei Nachkommastellen gerundet und nur Anzeige.

**Schwellen 1,5 × / 3 ×** (Ticket-Vorschlag, als Projekt-Einteilung benannt): 3 × ist der
vom BfS genannte Faktor („Anlass zur Besorgnis … über einen Faktor 3"), jetzt so gemeint,
wie das BfS ihn meint — standortbezogen. 1,5 × liegt gemessen oberhalb der normalen Streuung
(≥ 1,5 × bei 0,05 % der Werte einer ruhigen Woche), fängt aber Regen ein — das ist
`achtung`, nicht `alarm`, und der Inspector sagt es.
**Kein absoluter Boden neben dem Faktor:** der höchste gemessene Grundpegel ist 0,234
µSv/h, 3 × davon 0,70 µSv/h — ab dort wäre auch das alte Band `stark_erhoeht`. Eine Sonde
über 0,6 µSv/h, die relativ nur `erhoeht` trägt, braucht also einen Grundpegel über 0,2;
das ist genau der Fall, den das AK entschärfen will.

### 7. Wire-Wörter
Die Stufenwörter bleiben (`keine_messung` · `normal` · `erhoeht` · `stark_erhoeht`),
beidseitig gepinnt wie bisher. Neu ist `bewertung` mit `standort` · `absolut`, gepinnt in
`odl_tests` und `fachebenen.test.ts`; Typ `OdlBewertung` in `api/fachebenen.ts`. Ein
unbekanntes Wort liest das Frontend als `absolut` und zeigt dann weder Grundpegel noch
Faktor — es erfindet keine Grundlage. `grundpegel_stand` ist ISO-8601 UTC mit `Z`
(Muster `messende`).

### 8. Beschriftungen grundlagenneutral, Grundlage im Inspector
Die Labels der Vertragskarte `odlStufe` nennen heute den natürlichen Bereich — unter
relativer Bewertung wäre „im natürlichen Bereich" für eine Sonde mit 0,19 µSv/h und
Faktor 3,2 falsch. Neu: `normal` „unauffällig", `erhoeht` „erhöht", `stark_erhoeht`
„stark erhöht" (`keine_messung` bleibt „keine Messung"). Rollen unverändert. Der Maßstab
wandert in den Inspector:
- **standort:** Zeilen „Grundpegel" (drei Nachkommastellen, µSv/h, „Stand <Datum>") und
  „Faktor" („1,82 ×", zwei Nachkommastellen — mit einer stünde „1,5 ×" neben beiden Stufen).
  Hinweis: Einteilung des Lifeline Hub — über 1,5 × Grundpegel erhöht, über 3 × stark erhöht (Faktor 3 nennt das BfS als Anlass zur
  Besorgnis), kein amtlicher Schwellenwert; Grundpegel = unteres Quartil der letzten sieben
  Tage; Regen kann Werte kurzzeitig bis zum Dreifachen anheben.
- **absolut:** Satz „Für diese Sonde liegt noch kein Grundpegel vor." plus der bisherige
  Hinweis zu den Bändern am natürlichen Bereich.
Die Zahlen im Hinweis sind **Literale** im Text, nicht aus Konstanten zurückgelesen; der
Test prüft sie gegen den Backend-Pin.

## Risks / Trade-offs

- [~8,6 MB je Tag und Instanz beim BfS; bei schwacher Leitung ~70 s] → im Hintergrund,
  einmal täglich, Abkühlung nach Fehlschlag; LFH-599 (gzip) würde auf ~1 MB senken.
- [BfS kürzt die Aufbewahrung oder ändert den Layer] → Mindestzahl 20 fängt ein kürzeres
  Fenster ab (Sonden fallen auf `absolut`), Formatbruch → alter Grundpegel bleibt, Log.
- [Sperrklinke hält einen legitim gestiegenen Grundpegel fest (z. B. Sondentausch mit
  anderer Empfindlichkeit, +50 %)] → die Sonde steht bis zu 14 Tage auf `erhoeht`; sichtbar
  am alten Stand im Inspector. Akzeptiert: in die falsche Richtung ist „zu empfindlich" die
  sichere Seite.
- [Dauerhaft unbrauchbare Zeitreihe] → stündlich ein Versuch (~8,6 MB, Abkühlung 1 h); der
  alte Grundpegel bleibt stehen. Ein längerer Backoff wäre eine eigene Entscheidung.
- [Zwei Grundlagen nebeneinander auf einer Karte (Kaltstart, junge Sonden)] → Farbe und
  Wort bedeuten in beiden „auffällig oder nicht"; der Maßstab steht je Sonde im Inspector.

## Prüfliste Einsatztauglichkeit — nicht angelegt, mit Begründung

Wie LFH-78: keine Seite wird neu angelegt oder umgebaut. Der Inspector bekommt zwei Zeilen
und einen geänderten Hinweistext in einem bestehenden Block; Form, Bedienweg, Trefflächen
und Farbrollen bleiben. Der zweite Kanal neben der Farbe (Radius + Wort) ist unverändert.

## Migration Plan

Keine Migration. Nach dem Deploy bewertet die Ebene absolut, bis der erste Grundpegel-Abruf
durch ist (Sekunden bis wenige Minuten nach dem ersten ODL-Abruf). Rückbau: `bewerte_odl`
nicht mehr aufrufen und den Grundpegel-Anstoss entfernen; der Eintrag `odl:grundpegel`
altert über das Prune von selbst weg.
