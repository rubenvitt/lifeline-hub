# Design

## Context

Motivation: siehe proposal.md. Die Änderung setzt auf folgenden Bestand auf:

- `ausgabe_erfassen` (`src/routes/verpflegung.rs`) nutzt `EinsatzSchreibzugriff<Verpflegung>`.
  Dieser Extractor verlangt den aktiven Einsatz schon selbst, ein abgeschlossener Einsatz ist
  also 409, bevor der Handler läuft. Die Route normalisiert `zeitpunkt_at` (fehlt = Serveruhr),
  prüft eine `nachforderung_id` gegen den Einsatz (404) und ruft
  `repo::ausgabe_erfassen_tx` über `write_retry!`, also unter `BEGIN IMMEDIATE` (`src/tx.rs`).
  Nach dem Commit sendet sie `LiveEvent::Verpflegung`. Einen ETB-Eintrag schreibt eine Ausgabe
  nicht (LFH-634, D5).
- `ausgabe_erfassen_tx` prüft das Zeitfenster (404), dann die Felder (400), dann die Sonderkost
  als Teilmenge (422). Erst danach fügt es die Zeile ein. Einen Zukunfts-Riegel für
  `zeitpunkt_at` gibt es nicht, nur die Lesbarkeit (`draht_lesen`).
- Für idempotente POSTs gibt es `EinsatzSchreibfreigabe` (`src/einsatz/kontext.rs`). Es prüft
  Org, Schreibrecht und Modul, die Aktiv-Prüfung bleibt dem Handler. Vorbilder sind
  `routes/meldung.rs` (`anlegen`) und `routes/betreuung.rs` (LFH-675).
- Die Offline-Queue (`frontend/src/offline/`) kennt die Arten `person`, `meldung`, `stand` und
  `belegung`. Sie sendet je Einsatz in Erfassungsreihenfolge unter einem Cross-Tab-Lock
  (`useOfflineSync.ts`). Bei einem transienten Fehler bricht der Durchlauf ab. Fachliche Fehler
  (4xx außer 401/408/412/429) landen unter `abgelehnt` im Wiederherstellungs-Drawer.
- Deckung und Fehlmenge rechnet der Server (`src/verpflegung/deckung.rs`). Die Einstufung rechnet
  `verpflegung/deckung.ts` im Client aus diesen Zahlen. Die Seite liest alles aus einer Abfrage
  (`einsatzKeys.verpflegung`).

## Goals / Non-Goals

**Goals:**
- Exactly-once je `client_id`, auch wenn zwei Tabs gleichzeitig flushen und wenn ein Timeout
  erst nach dem Commit eintritt.
- Eine vorgemerkte Ausgabe ist an ihrem Zeitfenster sichtbar, zählt aber erst nach der
  Bestätigung in die Deckung (Akzeptanzkriterium LFH-688).
- Ein Replay gelingt auch nach dem Einsatzende.

**Non-Goals:**
- Der Server prüft nicht, ob ein Replay denselben Inhalt trägt wie das Original. Das hält auch
  LFH-675 so.
- Andere Geräte sehen eine vorgemerkte Ausgabe nicht. Sie liegt nur in der IndexedDB des
  erfassenden Geräts, und der Server weiß noch nichts von ihr.
- Eine noch nicht gesendete Ausgabe lässt sich nicht verwerfen. Das kann bisher keine Art der
  Queue. Verwerfen gibt es nur für abgelehnte Aktionen im Drawer.
- Nach dem Flush gibt es keine Quittung „vorgemerkte Ausgabe ist jetzt gesendet“, denn die
  Ausgabe erscheint ohnehin an ihrem Zeitfenster. Ein „Rückgängig“ für eine nachgesendete Ausgabe
  gibt es ebenfalls nicht, sie wird über die Liste zurückgenommen.
- Offline-fähig werden weder das Anlegen, Ändern oder Löschen von Zeitfenstern noch die Rücknahme
  einer Ausgabe.

## Decisions

### D1 — Schema: `client_id` an `verpflegung_ausgabe`, eindeutig je Einsatz

`0133_verpflegung_ausgabe_client_id.sql` (Nummer laut Entwurf, `check-migrationen.sh`
bestätigt sie): `ALTER TABLE verpflegung_ausgabe ADD COLUMN client_id TEXT`, dazu
`CREATE UNIQUE INDEX idx_verpflegung_ausgabe_client_id ON verpflegung_ausgabe(einsatz_id,
client_id) WHERE client_id IS NOT NULL`. NULL bleibt erlaubt, für Aufrufe ohne Schlüssel und für
alle Bestandszeilen.

Der Schlüssel ist `(einsatz_id, client_id)` und nicht `(zeitfenster_id, client_id)`. So halten
es ETB, Person, Meldung und Betreuung (0088, 0098, 0122). Außerdem braucht die Fehlprüfung aus D3
einen Treffer über Zeitfenster hinweg. Mit einem Schlüssel je Zeitfenster entstünde an
Zeitfenster B still eine zweite Ausgabe mit derselben `client_id`.

### D2 — Replay-Lookup zweimal: vor den Gates und in der Transaktion

Der Handler folgt `routes/meldung.rs:215` und `routes/betreuung.rs`:

1. Extractor `EinsatzSchreibfreigabe<Verpflegung>` (Org, Schreibrecht, Modul), danach die
   Header-Prüfung `fordere_offline_queue_benutzer`.
2. `client_id` normalisieren: trimmen, leer gilt als fehlend, mehr als 64 Zeichen sind 400.
3. **Vorab-Lookup** über den Pool, `repo::laden_nach_client_id(pool, einsatz_id, cid)`. Er liefert
   Ausgabe- und Zeitfensterkennung. Bei einem Treffer folgt die Pfadprüfung (D3), danach die
   Antwort 201 mit `AusgabeErgebnis` (ursprüngliche `ausgabe_id`, aktuelles Zeitfenster). Kein
   Live-Ereignis.
4. `ctx.fordere_aktiv()`, dann wie bisher Zeitpunkt normalisieren, Nachforderung prüfen,
   `write_retry!`.
5. **In der Transaktion** führt `ausgabe_erfassen_tx` denselben Lookup als ersten Schritt aus.
   Unter `BEGIN IMMEDIATE` kann er sich nicht mit dem INSERT verschränken. Kommen zwei Tabs beide
   am Vorab-Lookup vorbei, entscheidet also der zweite Lookup: Die zweite Transaktion sieht die
   committete Zeile und gibt sie zurück, statt sie zu duplizieren.

`AusgabeGeschrieben` bekommt `neu: bool`, und die Route publiziert nur bei `neu`. Dahinter liegt
der partielle UNIQUE-Index als Netz. Griffe er je, käme über das Sicherheitsnetz aus LFH-245 eine
409 heraus, nie eine Dublette.

**Verworfen** wird der Lookup nur in der Transaktion. Dann läge die Aktiv-Prüfung vor ihm, und
ein Replay nach dem Einsatzende bekäme 409 statt seiner Ausgabe. Das widerspricht dem dritten
Akzeptanzkriterium. **Verworfen** wird auch das ETB-Muster mit abgefangener UNIQUE-Verletzung.
Begründung wie in LFH-675, D2: Die Serialisierung schließt den Fall schon aus.

### D3 — Schlüssel eines anderen Zeitfensters ist 422

Liegt die gefundene Ausgabe an einem anderen Zeitfenster als `{zid}` im Pfad, antwortet die Route
mit 422 („client_id gehört zu einer Ausgabe an einem anderen Zeitfenster“). Jedes Feld ist für
sich gültig, erst der Zusammenhang mit dem gespeicherten Zustand verbietet die Aktion. Das ist
nach `src/AGENTS.md`, Statuscode-Konvention, 422. Die bestehende Ausgabe zurückzugeben wäre
falsch: `AusgabeErgebnis.zeitfenster` behauptete dann die Deckung eines Zeitfensters, das der
Client nicht adressiert hat.

### D4 — Replay liefert 201, auch für eine zurückgenommene Ausgabe

Wie bei Meldung und Betreuung ist die Antwort auf einen Replay 201, denn der Client unterscheidet
die beiden Fälle nicht. Ist die ursprüngliche Ausgabe inzwischen zurückgenommen, liefert der
Replay sie trotzdem, mit `zurueckgenommen_at` und dem aktuellen Zeitfenster. Die Rücknahme war
eine bewusste spätere Handlung, eine Neuanlage höbe sie still auf und erhöhte die Deckung.

Ein Zeitfenster lässt sich nur löschen, wenn keine gültige Ausgabe daran hängt. Eine
zurückgenommene Ausgabe verschwindet beim Löschen per CASCADE. Ein Replay danach findet nichts,
und der Weg führt über `fordere_aktiv` in die Zeitfensterprüfung (404). Die vorgemerkte Kopie
landet dann im Drawer, eine Dublette entsteht nicht, weil das Zeitfenster fehlt.

### D5 — Kein Live-Ereignis beim Replay

Begründung wie LFH-675, D5. Das Ereignis geht nach dem Commit im selben Prozess hinaus. Stirbt der
Prozess zwischen Commit und Senden, brechen alle SSE-Verbindungen ab, und `useEinsatzLiveStream`
holt beim Reconnect alle Registry-Keys neu. Eine Marke `live_published_at` wie bei `meldung` hätte
keinen Nutzen, denn eine Ausgabe löst keinen Alarm aus.

### D6 — Erfassungszeitpunkt nur in der vorgemerkten Kopie

`erfasseVerpflegungsausgabeOfflineFaehig` (`offline/schreiben.ts`) setzt die `client_id` einmal,
bevor irgendetwas gesendet wird. Online-Versuch und vorgemerkte Kopie tragen denselben Schlüssel.
**Nur die vorgemerkte Kopie** bekommt `zeitpunkt_at` mit der Client-Uhr zum Erfassungszeitpunkt
(`alsBackendZeit`), und nur wenn die Person keinen Zeitpunkt eingetragen hat. Ohne diesen Schritt
stempelte der Server beim Flush „jetzt“, und eine Frühstücksausgabe um 07:40 stünde als 09:10.

Online gilt weiter die Serveruhr, wie in LFH-675. Für Ausgaben gibt es zwar keinen
Zukunfts-Riegel, die Regel bleibt trotzdem modulübergreifend gleich: Ein Zeitpunkt, den die Person
nicht eingetragen hat, stammt online vom Server. Den gemeinsamen Ablauf aus
`betreuungsmeldungOfflineFaehig` verallgemeinert die Änderung zu einem Helfer für Aufrufe mit
Erfassungszeitpunkt (Name beim Umsetzen), statt ihn zu kopieren.

### D7 — Queue: neue Schreibaktion `ausgabe`, keine Schema-Version

`OfflineSchreibaktion` bekommt die Variante
`{ art: 'ausgabe'; zeitfenster_id: number; bezeichnung: string; daten: AusgabeEingabe }`.
`bezeichnung` ist die Bezeichnung des Zeitfensters und dient nur der Anzeige, gesendet wird sie
nicht. Die Aktion liegt als Wert im bestehenden Store `schreibaktionen`, ohne neue Indizes. Die
IndexedDB-Version bleibt deshalb gleich.

`useOfflineSync.verarbeiteEinsatz` bekommt einen eigenen `else if (aktion.art === 'ausgabe')`
in der exhaustiven Kette, kein `switch` (Begründung LFH-675, D7). Der Zweig sendet mit
`offlineQueueBenutzerId`. Danach gilt diese Reihenfolge:

1. Das zurückgegebene `zeitfenster` ersetzt per `setQueryData` den gleichnamigen Eintrag in
   `einsatzKeys.verpflegung`, aber nur, wenn die Abfrage schon Daten hat.
2. `schreibaktionEntfernen`.
3. `einsatzKeys.verpflegung` invalidieren.

Die Ausgabe steht damit schon bestätigt im Cache, bevor die ausstehende Zeile verschwindet. Es
gibt also keinen Takt, in dem die Ausgabe auf der Karte fehlt. Das ETB wird nicht invalidiert,
eine Ausgabe schreibt keinen Eintrag. `OfflineRecoveryDrawer.aktionsTitel` bekommt
`case 'ausgabe'`: „Abgelehnte Verpflegungsausgabe: ‹bezeichnung›“.

### D8 — „ausstehend“ auf der Karte, außerhalb der Deckung

Ein neuer Hook `useVorgemerkteAusgaben(benutzerId, einsatzId)` (`offline/`) liest
`schreibaktionenLaden(benutzerId, einsatzId)` und filtert auf `art === 'ausgabe'`. Er lädt bei
`OFFLINE_QUEUE_EVENT` neu, nach dem Muster von `useOfflineQueueZaehler` mit Generationszähler und
Scope je Benutzer und Einsatz. `VerpflegungPage` gruppiert nach `zeitfenster_id` und reicht je
Karte die Liste `ausstehend` an `ZeitfensterKarte`.

Die Karte zeigt ausstehende Ausgaben in derselben Liste wie die bestätigten, mit dem Typwort
„ausstehend“, `data-lfh="verpflegung-ausgabe-ausstehend"` und ohne Aktion. Menge, Ort, Sonderkost
und Uhrzeit stehen wie bei einer gewöhnlichen Ausgabe da. Die Uhrzeit ist der vorgemerkte
`zeitpunkt_at`. Die Kennzeichnung trägt das Wort, nicht nur eine Farbe (WCAG 1.4.1). Deckung,
Fehlmenge und Einstufung bleiben unberührt, weil sie ausschließlich aus der Serverantwort kommen.
Die Karte rechnet nichts dazu.

Gezeigt wird nur der Store `schreibaktionen`. Abgelehnte Ausgaben gehören in den Drawer, an der
Karte stünden sie als „ausstehend“ falsch. Eine vorgemerkte Ausgabe, deren Zeitfenster nicht mehr
in der Liste steht, erscheint auf keiner Karte. Sie wird beim Flush abgelehnt (D4) und steht dann
im Drawer.

**Verworfen:** eine Zahl „davon ausstehend“ im Kopf der Karte. Sie lädt dazu ein, sie
mitzurechnen, und das Akzeptanzkriterium verlangt gerade die Trennung. **Verworfen** ist auch,
die vorgemerkte Ausgabe optimistisch in den Query-Cache zu schreiben. Die Deckung käme dann aus dem
Client, und der nächste Refetch nähme die Ausgabe wieder heraus.

### D9 — Seite: vorgemerkt ist ein Erfolg ohne Rückweg

`ausgabeMut` in `VerpflegungPage.tsx` ruft `erfasseVerpflegungsausgabeOfflineFaehig`. Bei
`gesendet` bleibt alles wie bisher: Invalidierung und Rückgängig-Toast mit `ausgabe_id`. Bei
`vorgemerkt` erscheint
`message.warning('Offline vorgemerkt — Ausgabe ‹n› EP zu ‹Zeitfenster› wird bei Verbindung gesendet')`
ohne „Rückgängig“, denn es gibt noch keine `ausgabe_id` und keine Server-Rücknahme. Der Dialog
schließt, weil die Zusage erfüllt ist und der Inhalt in IndexedDB liegt. Fachliche Fehler wirft die
Funktion weiter, sie stehen wie bisher im Dialog.

### D10 — Schwärzung

Die Tabellenregel `verpflegung_ausgabe` bekommt `retain("client_id", G_IDEMPOTENZ)`. Die Spalte
ist eine technische UUID ohne Personenbezug. Die Registry prüft die Spalten gegen das Schema, ohne
den Eintrag wäre sie rot.

### D11 — „ausstehend“ folgt auch einem Flush in einem anderen Tab (Nachtrag aus dem Review)

Das Fenster-Ereignis `OFFLINE_QUEUE_EVENT` erreicht nur den eigenen Tab. Flusht ein anderer Tab
desselben Geräts die Queue, lädt dieser Tab über das Live-Ereignis die bestätigte Ausgabe, behielte
aber die Zeile „ausstehend“, und die Ausgabe stünde doppelt da. Das verletzt das Szenario „Nach
der Bestätigung gezählt“. `queue.ts` sendet deshalb bei jeder Änderung zusätzlich ein datenloses
Signal über den `BroadcastChannel` `lfh:offline-queue`. `beobachteQueueAenderungen` hört auf
beides, und `useVorgemerkteAusgaben` nutzt es. Das Muster stammt aus `offline/ereignisse.ts`.

Das Signal wird **nicht** als Fenster-Ereignis weitergereicht. Darauf hört auch der Flush
(`useOfflineSync`), und jede Änderung eines anderen Tabs stieße sonst einen Flush an. Den Zähler
(`useOfflineQueueZaehler`) lässt diese Änderung unverändert, denn sein Nachlauf über Tabs ist
heute schon so und nicht Gegenstand von LFH-688. Ohne `BroadcastChannel` gilt wie bisher nur das
Fenster-Ereignis.

## Risks / Trade-offs

- [Ein Tab mit altem Bundle flusht die gemeinsame Queue] → Ein Bundle mit der exhaustiven Kette
  aus LFH-675 wirft „Unbekannte Offline-Schreibaktion“, ein älteres schickt die Aktion als
  Meldung, und der Server lehnt sie mit 400 ab. In beiden Fällen liegt die Aktion unter
  „abgelehnt“, mit irreführendem Grund. „Erneut versuchen“ im neuen Tab sendet sie richtig. Eine
  Dublette oder ein Verlust entsteht nicht. Eine Schema-Version schlösse das nicht aus: Das alte
  Bundle öffnete die höhere Version gar nicht erst und verlöre damit die ganze Queue.
- [Die vorgemerkte Ausgabe sieht nur das erfassende Gerät] → Die Führung am Stab sieht während des
  Ausfalls eine zu niedrige Ausgabe und damit womöglich eine Unterdeckung. Das ist die ehrliche
  Lage, denn der Server kennt die Ausgabe noch nicht. Nach dem Flush verteilt das Live-Ereignis die
  Korrektur. Eine Verteilung ohne Netz ist nicht möglich.
- [Das Zeitfenster wird gelöscht, während eine Ausgabe dazu aussteht] → Das Löschen gelingt, weil
  der Server keine gültige Ausgabe sieht. Die vorgemerkte Ausgabe wird beim Flush mit 404
  abgelehnt und steht im Drawer. Das ist kein stiller Verlust, verlangt aber Handarbeit.
- [Die Geräteuhr geht falsch] → Der vorgemerkte Zeitpunkt ist dann falsch. Einen Zukunfts-Riegel
  hat die Ausgabe nicht, sie wird also nicht abgelehnt. Die Einstufung hängt an der Uhr des
  betrachtenden Clients, nicht am Ausgabezeitpunkt, deshalb ändert ein falscher Zeitpunkt die
  Deckung nicht. Die Korrektur über die Serveruhr ist LFH-705.
- [Die Migration kollidiert mit einem parallelen Branch] → `scripts/check-migrationen.sh` vor dem
  PR laufen lassen, bei Bedarf `--umnummerieren`.

## Migration Plan

Die Migration ergänzt nur eine Spalte und einen Index. Bestandszeilen behalten NULL. Ein Rollback
ist nicht vorgesehen: Die Migration wird nie zurückgespielt, und ein älteres Binary ignoriert die
Spalte. Ein neues Frontend gegen ein altes Backend schickt eine unbekannte `client_id`, und Serde
verwirft sie in `AusgabeErfassen` still. Das entspricht dem heutigen Verhalten ohne Idempotenz.
