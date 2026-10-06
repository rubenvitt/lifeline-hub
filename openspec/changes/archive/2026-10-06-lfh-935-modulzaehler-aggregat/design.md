# Design

## Context

`zaehler::berechne` (`src/einsatz/zaehler.rs`) zählt ETB, Betroffene, Einheiten, Abschnitte und
Dokumente schon per `COUNT(*)`. Die vier Kommunikationsmodule zählt es absichtlich über die
Listenfunktionen, damit „offen“, „überfällig“, „fällig“ und „ungelesen“ nicht ein zweites Mal
formuliert werden (Modulkopf, LFH-612):

- Meldungen: `meldung::repo::liste` lädt alle Zeilen samt `inhalt`, drei LEFT JOINs und je Zeile
  eine Subquery auf `lage_meldung`.
- Aufträge: `auftrag::repo::liste` lädt alle Aufträge und, seit der N+1-Bereinigung, alle
  Empfänger in einem zweiten Statement. Gezählt werden davon nur `bearbeitungsstatus` und
  `ist_ueberfaellig`.
- Erinnerungen: `erinnerung::repo::liste` mit `nur_offen = false`; gefiltert wird in Rust.
- Chat: `chat::repo::kanaele_lesen` gruppiert alle Nachrichten je Kanal.

Die Zählregeln über den Zeilen stehen als reine Funktionen (`zaehle_meldungen`,
`zaehle_auftraege`). Das Fixture `tests/fixtures/verdichtung/regeln.json` bindet sie an die
Client-Regeln (`tests/verdichtung_fixture.rs`, `frontend/src/lage/verdichtungFixture.test.ts`).

Im Client hängt `modulZaehler` an zwölf Live-Ereignissen. Seit der Bündelung im Live-Strom
(Sammler `live/liveInvalidierung.ts`, festes Fenster von 300 ms, Spec `live-abgleich`) ruft ein
Tab je Fenster höchstens einmal ab; ein Burst über 500 ms sind damit noch zwei Abrufe.

## Goals / Non-Goals

**Goals**
- Je Kommunikationsmodul eine Abfrage, deren Zahl und Ergebnisgröße nicht vom Bestand abhängen.
- Die Prädikate stehen je einmal; Liste und Zählung können nicht auseinanderlaufen.
- Die Zählregeln bleiben die fixture-gebundenen reinen Funktionen.
- Ein Burst von Live-Ereignissen kostet je Tab einen Zählerabruf.

**Non-Goals**
- Ein Server-Cache für die Zähler. Mit Aggregaten kostet ein Abruf wenige Indexzugriffe; ein
  Cache bräuchte eine eigene Invalidierung je Schreibpfad und je Benutzer (Chat).
- Die Infotelefon-Zählung auf dasselbe Muster umstellen (eigenes Ticket).
- Den Abruf auf geöffnete Modulpanels beschränken. Der Zähler speist auch die Warnsperre des
  Helligkeitsreglers (`bestaetigung_ueberfaellig`) und muss deshalb immer laufen.

## Decisions

### D1 Prädikate als SQL-Fragmente im Repo des Moduls

Jedes Prädikat steht genau einmal als `macro_rules!`-Fragment im Repo seines Moduls, nach dem
Muster `bearbeitungsstatus_sql!()` in `auftrag/repo.rs`. Makros statt `const &str`, weil
`concat!` nur Literale verbindet und die SELECTs `&'static str` bleiben sollen.

| Modul | Fragmente | Gebrauch |
|---|---|---|
| Meldung | `ist_offen_sql!`, `ist_bestaetigt_sql!`, `ist_ueberfaellig_sql!` | `ANZEIGE_SELECT`, Zählung |
| Auftrag | `bearbeitungsstatus_sql!` (besteht), `ist_ueberfaellig_sql!` | `ANZEIGE_SELECT`, Status-Filter, Zählung |
| Erinnerung | `ist_faellig_sql!` | `ANZEIGE_SELECT`, Zählung |
| Chat | `ungelesen_sql!` | `kanaele_lesen`, Zählung |

Die Zählfunktion liegt im selben Repo wie ihr Fragment (`meldung::repo::zaehlen`,
`auftrag::repo::zaehlen`, `erinnerung::repo::faellige_offene`, `chat::repo::ungelesen_gesamt`),
damit die Makros modulintern bleiben. Die Fragmente tragen ihr `?` für `jetzt` bzw. den Benutzer
selbst; die Bind-Reihenfolge steht an jeder Zählfunktion.

### D2 Gruppieren nach Merkmalen statt `SUM(CASE …)` je Zählfeld

Meldungen und Aufträge zählt je eine Abfrage `GROUP BY` über die Merkmale, die die Zählregel
braucht:

- Meldung: `status`, `ist_offen`, `bestaetigung_pflicht`, `ist_bestaetigt`, `ist_ueberfaellig`,
  `eskaliert`, dazu `COUNT(*)`. Nur `LEFT JOIN kommunikation_status`, ohne `inhalt`, ohne
  Benutzer-Joins, ohne `lage_meldung`.
- Auftrag: `bearbeitungsstatus`, `ist_ueberfaellig`, dazu `COUNT(*)`. Die Subquery `EXISTS` auf
  `auftrag_empfaenger` bleibt, Empfängerzeilen werden nicht geladen.

Die Ergebnismenge ist durch die Zahl der Merkmalskombinationen begrenzt (Meldung höchstens 4 × 2⁵,
Auftrag höchstens 4 × 2), nicht durch den Bestand. Gezählt wird darüber mit den bestehenden
reinen Funktionen, erweitert um ein Gewicht: `zaehle_meldungen_gewichtet` und
`zaehle_auftraege_gewichtet` nehmen `(Merkmale, Anzahl)`. `zaehle_meldungen` und
`zaehle_auftraege` behalten ihre Signatur und rufen die gewichtete Fassung mit Gewicht 1. So
prüft das Fixture weiter genau die Regel, mit der der Server zählt.

Verworfen: `SUM(CASE …)` je Zählfeld, wie im Ticket skizziert. Das schriebe die Zählregeln
(„davon ungesehen“ nur unter den offenen, „Bestätigung überfällig“ über alle) ein zweites Mal in
SQL, neben die fixture-gebundenen Funktionen. Genau dieses Auseinanderlaufen wollte LFH-612
vermeiden.

Erinnerungen und Chat haben keine Zählregel über Merkmale, nur ein Prädikat:

- Erinnerung: `COUNT(*) WHERE einsatz_id = ? AND status = 'offen' AND ist_faellig_sql!()`; läuft
  über `idx_erinnerung_einsatz_status`.
- Chat: `COUNT(*)` über `chat_kanal ⋈ chat_nachricht ⟕ kommunikation_zustellung` mit
  `ungelesen_sql!()`, ohne `GROUP BY` je Kanal. Rein lesend wie bisher, ohne Standardkanal.

### D3 `berechne` ruft keine Listenfunktion

`berechne` ruft für die vier Module nur noch die Zählfunktionen aus D1. Der Modulkopf erklärt
statt „zählt über die Listen“: dieselben Fragmente, darüber dieselben reinen Zählregeln.

### D4 Nachweis der Abfragezahl über die Statement-Protokollierung

Neuer Test in einer eigenen Testdatei `tests/modul_zaehler_abfragen.rs`: Ein Tracing-Layer zählt
die Ereignisse mit Target `sqlx::query`, die sqlx je ausgeführtem Statement auf DEBUG schreibt.
sqlite führt die Statements auf einem eigenen Thread aus, deshalb ein globaler Subscriber, und
deshalb eine eigene Testdatei mit genau einem Test, damit kein paralleler Test mitzählt.

Der Test ruft `berechne` für alle Module einmal auf einem leeren Einsatz und einmal nach dem
Anlegen von 200 Aufträgen mit je drei Empfängern, 300 Meldungen, Erinnerungen und Chat-Nachrichten.
Erwartung: gleich viele Statements, höchstens neun. Mutationsprobe: `berechne` ruft für Aufträge
wieder `auftrag::repo::liste` → zwei Statements statt einem, Test rot.

Verworfen: eine feste Laufzeitgrenze. Sie wäre auf CI-Maschinen unzuverlässig.

### D5 Eigenes Sammelfenster von 1 s für den Modulzähler

`erzeugeLiveSammler(qc, fensterMs)` bekommt das Fenster als Parameter, Vorgabe bleibt
`LIVE_SAMMELFENSTER_MS` (300 ms). Neu `ZAEHLER_SAMMELFENSTER_MS = 1000`. `useEinsatzLiveStream`
legt je Verbindung zwei Sammler an und merkt `modulZaehler` beim zweiten vor, alle anderen Keys
beim ersten. Beide räumt der Effekt-Cleanup; alle übrigen Regeln des Sammlers (laufender Abruf
ins nächste Fenster, verdeckter Tab markiert nur) gelten unverändert.

- **1 s:** untere Grenze aus dem Ticket (1 bis 2 s). Zehn Ereignisse in 500 ms ergeben einen
  Abruf; der Zähler hängt der Liste höchstens 1 s nach.
- **Fest ab dem ersten Ereignis**, nicht nachlaufend, wie beim Listenfenster: Ein Dauerstrom
  hält den Zähler nicht beliebig an.
- `fahrzeug` bleibt in der Zählerliste (`ZAEHLER_LISTEN_KEYS`, `queryKeys.test.ts`:
  `fahrzeug` invalidiert `einheiten`).
- Das Markieren eines Kanals als gelesen (`ChatPage`) invalidiert den Zähler weiter sofort; es
  ist eine eigene Handlung, kein Live-Ereignis.

Verworfen: ein Key-abhängiges Fenster in einem Sammler. Zwei Instanzen mit je einem Timer sind
einfacher und lassen den getesteten Sammler unverändert.

### D6 Regeln

- `frontend/AGENTS.md`, „Query-Key-Registry“: die Ausnahme für `modulZaehler` (1 s).
- `frontend/src/etb/AGENTS.md`, „Modulzähler“: der Server zählt per Aggregat über dieselben
  Fragmente wie die Listen.

## Risks / Trade-offs

- **Zähler bis zu 1 s hinter der Liste.** Für eine Navigationszahl unerheblich; Alarme und
  Toasts kommen weiter sofort.
- **Fragmente mit eigenem `?`:** Wer ein Fragment ändert und einen Parameter hinzufügt, muss
  jede Bind-Reihenfolge nachziehen. Die Paritätstests (`tests/modul_zaehler.rs`) und die
  Listentests decken beide Seiten.
- **Testdatei mit globalem Subscriber:** zusätzlicher Link-Schritt; dafür belastbar ohne
  Zeitgrenze.

## Migration Plan

Keine Datenmigration, keine API-Änderung. Frontend und Server werden zusammen ausgeliefert.

## Open Questions

Keine.
