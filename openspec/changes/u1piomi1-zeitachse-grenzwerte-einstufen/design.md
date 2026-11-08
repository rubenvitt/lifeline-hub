## Context

- **Ist heute:** `frontend/src/kraefte/zeitachse.ts:kraftDauern` rechnet aus den Perioden, die der
  Server bildet (`EinheitPerioden`/`PersonPerioden`), die laufende Dauer, die Gesamtdauer und die
  Ruhe, und zwar gegen die Uhr des Clients (LFH-552 D4). Die Zahl steht neutral da, ausdrücklich
  „keine Grenzwerte“: Spec `kraefte-zeitachse`, „Einsatzdauer und Ruhezeit“ und „Anzeige“, sowie
  `frontend/src/kraefte/AGENTS.md`.
- **Plan heute:** Der Schichtplan (LLH-1552) liest `SchichtplanGrenzwerte`
  (`src/abloesung/schichtplan/mod.rs`). Sie haben immer einen Wert: Ohne Eintrag in
  `einsatz_einstellungen.schichtplan_max_dienst_min`/`…_min_ruhe_min` gelten 12 h bzw. 8 h, und
  `*_eigen` sagt, ob der Einsatz selbst gesetzt hat. Der Befund `dienst`
  (`pruefung.rs:dienststrecken`) fasst Blöcke zu Strecken zusammen. Eine Lücke trennt nur, wenn
  sie `> 0` und `>= Mindestruhe` ist. Ist die Strecke länger als der Höchstwert, gibt es einen
  Befund.
- **Zugriff:** Die Grenzwerte liefert nur `GET …/abloesungen/schichtplan`. Das verlangt das Modul
  Ablösung und lädt den ganzen Plan. Meldebild und Personal-Seite haben das Modul oft nicht.
- **Live:** Das Setzen der Grenzwerte sendet `abloesung` über SSE. Das Ereignis invalidiert den
  Prefix `kraefteZeitachse` (`api/queryKeys.ts`), erreicht aber nur Leser des Moduls Ablösung
  (Modul-Gate in `src/live/mod.rs`, `LiveNachricht::fuer`). Der Prefix steht in
  `LAGEBILD_OFFLINE` und ist ohne Netz lesbar.
- **Abgestimmt mit Ruben am 08.11.2026** (Zunder LLH-730, Kommentare): wirksame Werte samt
  Vorgaben, Dienststrecke wie im Plan, „Ruhe zu kurz“ beim Wiedereinsatz, eigener Lese-GET.

## Goals / Non-Goals

**Goals:**

- Ist und Plan prüfen mit derselben Regel und denselben wirksamen Werten.
- Die Einstufung erscheint dort, wo die Zahl heute schon steht: Meldebild „Im Einsatz“ und
  Personal „Einsatzdauer“, in der Rolle `achtung` mit einem Wort.
- Es werden keine Daten erfunden: ohne Ereignis, ohne offene Periode und ohne geladene
  Grenzwerte gibt es keine Einstufung.

**Non-Goals:**

- Kein Hinweis in der AlarmZentrale, kein Modulzähler, keine Benachrichtigung (Alarmbudget nach
  EEMUA 191).
- Keine eigene Einstellung und keine Migration.
- Keine Einstufung auf der Einsatzkraft-Seite (Kopf), in der Dauerzeile der Zeitachse einer
  Kraft (`KraftZeitachse.tsx`), im Überblick, im Stab und im Einsatzbericht. Das wäre ein eigener
  Task, wenn sich der Bedarf zeigt.
- Die Spalte „Ruhe“ wird nicht eingestuft.
- Keine Stufe `alarm`, nur `achtung`.

## Decisions

**D1 — Wirksame Werte samt Vorgaben (Entscheidung Ruben).** Das Ist liest
`SchichtplanGrenzwerte.max_dienst_minuten`/`min_ruhe_minuten`, also immer einen Wert. Damit fällt
das ursprüngliche Akzeptanzkriterium „ohne gesetzten Wert unverändert“.
*Verworfen:* nur einstufen, wenn `*_eigen` gesetzt ist. Das ergäbe weniger Einfärbung, aber Plan
und Ist würden im selben Einsatz unterschiedlich urteilen.

**D2 — Dienststrecke wie im Plan (Entscheidung Ruben).** Die Strecken werden im Client aus den
Perioden gebildet, mit derselben Trennregel wie `pruefung.rs:dienststrecken` (Lücke `> 0` und
`>= min_ruhe` trennt). Die laufende Strecke ist die mit der offenen Periode, ihre Länge zählt vom
`beginn_at` ihrer ersten Periode bis jetzt. „zu lang“ gilt bei `länge > max_dienst`, streng wie
im Plan. Die angezeigte Zahl bleibt die laufende Einsatzdauer der offenen Periode. Die
Beschreibung (Attribut `title` und Text nur für den Screenreader) nennt die Strecke: „Dienst seit
08:00 ohne 8 h Ruhe: 14 h 30 (Höchstwert 12 h)“.
*Verworfen:* nur die laufende Periode zu vergleichen. Dann setzt eine kurze Pause die Uhr zurück,
und das Ist weicht vom Plan ab.

**D3 — „Ruhe zu kurz“ an der Einsatzdauer, Spalte „Ruhe“ neutral (Entscheidung Ruben).** Wer
ruht, ist kein Fall für `achtung`. Kritisch wird es erst beim Wiedereinsatz. Die Regel lautet:
vor der offenen Periode liegt eine Periode, und `0 < Lücke < min_ruhe`. Eine Lücke von 0 gilt als
durchgehender Dienst und nicht als Ruhe. Sie ist schon über „zu lang“ abgedeckt, weil sie die
Strecke nicht trennt. Treffen beide Wörter zu, gewinnt „zu lang“: ein Wort je Zelle, und die
Beschreibung nennt beides.
*Verworfen:* „noch in Ruhe“ in der Spalte „Ruhe“. Das würde jede frisch entlassene Kraft
einfärben.

**D4 — Der Client rechnet, der Server liefert nur die Werte.** Die Einstufung hängt an der Uhr
(LFH-552 D4: die Dauer läuft ohne neuen Abruf weiter). Deshalb rechnet sie dieselbe reine
Funktion neben `kraftDauern`: `stufeEin(perioden, grenzwerte, jetztMs)` in `kraefte/zeitachse.ts`
gibt `{ wort: 'zu_lang' | 'ruhe_zu_kurz', streckeBeginnAt, streckeMinuten, ruheMinuten? } | null`
zurück. Die Regel steht damit zweimal, in Rust (Plan) und in TypeScript (Ist).
*Gegenmittel:* Die Testfälle der TS-Funktion übernehmen die Zahlen der Rust-Tests und der
Spec-Szenarien wörtlich („Zu lange ohne Ruhe“ 08–14/16–22, „Genug Ruhe“ 06–12/20–02), und ein
Kommentar verweist auf `pruefung.rs:dienststrecken` und umgekehrt.
*Verworfen:* Die Einstufung im Server in die Perioden-Antwort zu schreiben. Sie würde zwischen
zwei Abrufen veralten und bräuchte einen Zeitgeber wie `naechste_pruefung_at`.

**D5 — Eigener Lese-GET je Modul (Entscheidung Ruben).** Es gibt zwei Routen in
`src/routes/zeitachse.rs`: `einheiten_grenzwerte` (`EinsatzLesezugriff<Einheiten>`) und
`personal_grenzwerte` (`EinsatzLesezugriff<Personal>`). Beide geben
`abloesung::schichtplan::repo::grenzwerte(...)` als `Json<SchichtplanGrenzwerte>` zurück. Das
ist der vorhandene Typ, also kommt kein neuer Codegen-Typ dazu, nur zwei neue Pfade in
`api_doc.rs`, falls die Datei Pfade listet. Der Pfad `…/einheiten/zeitachse/grenzwerte` ist
statisch und kollidiert nicht mit `…/einheiten/{eid}/zeitachse`, weil schon
`…/einheiten/zeitachse` danebensteht.
Im Client steht `ladeZeitachseGrenzwerte(einsatzId, modul)` in `api/kraefteZeitachse.ts`, mit den
Keys `einsatzKeys.kraefteZeitachseGrenzwerte(einsatzId, modul)` =
`[kraefteZeitachse, einsatzId, 'einheiten' | 'personal', 'grenzwerte']`. Sie liegen im Unterbereich
des Moduls, damit `einsatz/gesperrteListen.ts` sie beim Modulentzug mit räumt (es prüft `k[2]`),
und unter dem Prefix, damit sie ohne Netz lesbar sind wie die Perioden.
**Live (Befund aus dem Review):** `abloesung` allein erreicht Leser ohne das Modul Ablösung nicht.
`grenzwerte_setzen` sendet deshalb zusätzlich `einheit` und `personal` ohne Nutzlast; beide
Familien invalidieren im Client den Prefix `kraefteZeitachse`. Das ist das Muster aus LLH-1501
(`sse_namens_traeger`: Leser ohne das Recht über ihr eigenes Modul erreichen). Es kostet einen
breiteren Neuabruf, aber Grenzwerte ändern sich selten.
*Verworfen:* eine eigene `LiveEvent`-Variante. Sie bräuchte den Enum-Wire-Kontrakt und
`EINSATZ_STREAM_EVENTS` für ein seltenes Ereignis.
*Verworfen:* die Perioden-Antworten zu `{ grenzwerte, perioden }` umzubauen. Das würde die Form
brechen (Codegen, Druck, Offline-Cache, Überblick, Bereitstellungsraum).
*Verworfen:* der Schichtplan-GET. Er verlangt das Modul Ablösung und lädt den ganzen Plan.

**D6 — Darstellung.** Die Zelle bleibt in Mono mit Tabellenziffern. Neben der Zahl steht das
Wort („zu lang“ bzw. „Ruhe zu kurz“) in `rollen.achtungText`, ohne Fläche und ohne Blinken. Die
Farbe ist nicht der einzige Kanal, das Wort ist der zweite. Sortierung und Lagevortrag bleiben an
der Zahl. Die Darstellung entsteht einmal als kleine Komponente in `kraefte/`, zum Beispiel
`DauerEinstufung.tsx`. Meldebild (`ImEinsatzZelle`) und Personal (`dauerZelle`) nutzen sie, und
der Druck des Meldeblatts übernimmt sie mit der Zelle.

**D7 — Regeln nachziehen.** `frontend/src/kraefte/AGENTS.md` (Absatz Kräfte-Zeitachse, „keine
Grenzwerte (LFH-860)“) wird ersetzt durch: „Einstufung nur über `stufeEin` gegen die wirksamen
Grenzwerte des Schichtplans; Anzeige nur Meldebild ‚Im Einsatz‘ und Personal ‚Einsatzdauer‘“. Die
Kommentare in `src/abloesung/schichtplan/{mod,pruefung}.rs`, die „stuft nicht ein“ sagen, werden
berichtigt. Die Sätze in `kraefte-abloesung`, nach denen die Ablösung keine Ruhezeit rechnet,
stimmen weiter, denn die Ablösung rechnet nicht. Sie bleiben deshalb, nur der Verweis „LFH-860“
im Purpose von `kraefte-zeitachse` wird beim Archivieren angepasst.

## Risks / Trade-offs

- [Die Regel steht in Rust und in TypeScript und kann auseinanderlaufen] → gleiche Testzahlen und
  gegenseitige Verweise in den Kommentaren (D4).
- [Mit den Vorgaben färbt jeder lange Einsatz ab 12 h ein, auch wenn niemand einen Wert gesetzt
  hat] → Das ist gewollt (D1). Es bleibt `achtung` ohne Alarm, und die Grenzwerte lassen sich im
  Schichtplan setzen. Die Beschreibung nennt den Grenzwert, also sieht man auch, woher er kommt.
- [Eine Nachtragslücke in der Zeitachse (fehlende Entlassung) verlängert die Strecke scheinbar]
  → Das Ist ist so gut wie die Zeitachse. Berichtigung und Periodennachtrag gibt es schon
  (LLH-1455, LLH-1538).
- [Perioden einer Einheit sind keine Arbeitszeit einer Person] → Das Meldebild stuft die Einheit
  ein, die Personal-Seite die Person. Beide nutzen dieselbe Regel über ihre eigenen Perioden.
- [Die Uhr läuft, aber die Grenzwerte sind alt] → Der Live-Weg über `abloesung` ist vorhanden. Ohne
  Netz gelten die zuletzt geladenen Werte.

## Migration Plan

Es gibt keine Migration. Die Änderung gilt sofort für alle laufenden Einsätze. Zurückrollen heißt,
den Commit zurückzunehmen. Es werden keine Daten geschrieben.

## Open Questions

Keine. Die Wörter „zu lang“ und „Ruhe zu kurz“ sind gesetzt, ein anderer Wortlaut ginge über
`/opsx:update`.
