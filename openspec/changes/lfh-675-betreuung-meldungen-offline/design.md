# Design

## Context

Motivation: siehe proposal.md. Der Bestand, auf dem die Änderung aufsetzt:

- `stand_melden_tx` / `belegung_melden_tx` (`src/betreuung/repo.rs`) schreiben in **einer**
  Transaktion zuerst den ETB-Eintrag (`etb::repo::anlegen_tx`), dann die Meldezeile, dann den
  Zeiger. Die Routen rufen sie über `write_retry!`, und das öffnet **`BEGIN IMMEDIATE`**
  (`src/tx.rs`). Schreibende Transaktionen laufen damit seriell.
- Die Routen nutzen `EinsatzSchreibzugriff<Betreuung>`, das den aktiven Einsatz schon im
  Extractor verlangt. Für idempotente POSTs gibt es `EinsatzSchreibfreigabe`, das diese
  Prüfung dem Handler überlässt (`src/einsatz/kontext.rs`, Vorbild `routes/meldung.rs`).
- Fehlt `zeitpunkt_at`, setzt der Server „jetzt“ (`meldezeitpunkt`, Zukunftstoleranz 60 s).
- Die Offline-Queue kennt die Schreibaktionen `person` und `meldung` (`offline/queue.ts`). Sie
  werden je Einsatz in Erfassungsreihenfolge unter einem Cross-Tab-Lock gesendet
  (`useOfflineSync.ts`). Transiente Fehler brechen den Durchlauf ab, fachliche Fehler landen
  im Store `abgelehnt` und damit im Wiederherstellungs-Drawer.
- Schwärzung: `schwaerzung_registry.rs` führt beide Meldetabellen spaltengenau. Die
  `client_id` anderer Tabellen steht dort als `retain(…, G_IDEMPOTENZ)`.

## Goals / Non-Goals

**Goals:**
- Exactly-once je `client_id`, auch bei zwei Tabs, die gleichzeitig flushen, und bei einem
  Timeout nach dem Commit.
- Die Reihenfolge der Meldungen richtet sich nach ihrem Erfassungszeitpunkt, nicht nach dem
  Sendezeitpunkt.

**Non-Goals:**
- Keine Prüfung, ob ein Replay denselben Inhalt trägt wie das Original. Eine `client_id` ist
  eine client-erzeugte UUID, und das ETB-Muster prüft ebenfalls nicht.
- Keine Quittung der Art „vorgemerkte Meldung ist jetzt gesendet“ auf der Betreuungsseite.
  Der globale Queue-Zähler sinkt, und die Seite lädt über Invalidierung bzw. Live-Ereignis
  nach. Die Personen-Quittung aus LFH-334 existiert, weil dort der erzeugte Datensatz
  gezeigt werden muss. Hier gibt es nichts Vergleichbares.
- Offline bleiben weiter ausgeschlossen: Anlegen, Ändern und Stornieren, Rücknahmen und die
  Leermeldung vor dem Schließen (siehe proposal.md).

## Decisions

### D1 — Schema: `client_id` je Meldetabelle, eindeutig je Einsatz

`0121_betreuung_client_id.sql`: `ALTER TABLE … ADD COLUMN client_id TEXT` an beiden
Tabellen, dazu je `CREATE UNIQUE INDEX … ON <tabelle>(einsatz_id, client_id) WHERE client_id
IS NOT NULL`. NULL bleibt für Aufrufe ohne Schlüssel erlaubt, auch für die Leermeldung.

Der Schlüssel ist `(einsatz_id, client_id)` und nicht `(bezirk_id, client_id)`. So halten es
auch ETB, Person und Meldung (0088, 0098). Außerdem braucht die Fehlprüfung aus D3 einen
Treffer über Bezirke hinweg: Mit einem Schlüssel je Bezirk entstünde an Bezirk B still eine
zweite Meldung mit derselben `client_id`. Stand und Belegung sind getrennte Reihen mit
getrennten Indizes. Eine UUID in beiden Reihen gleichzeitig kommt praktisch nicht vor, und
eine Prüfung über beide Tabellen hinweg hätte keinen Nutzen.

### D2 — Replay-Lookup zweimal: vor den Gates und in der Transaktion

Der Ablauf im Handler folgt `routes/meldung.rs`:

1. Extractor `EinsatzSchreibfreigabe<Betreuung>`: Org, Schreibrecht, Modul. Danach die
   Header-Prüfung `fordere_offline_queue_benutzer`.
2. `client_id` normalisieren: trimmen, leer heißt fehlend, mehr als 64 Zeichen ist 400.
3. **Vorab-Lookup** (lesend, Pool): gibt es im Einsatz eine Meldung mit dieser `client_id`,
   dann Pfadprüfung (D3) und Antwort 201 mit dem aktuellen Objekt und der **ursprünglichen**
   `meldung_id`. Kein ETB, kein Live-Ereignis.
4. `ctx.fordere_aktiv()`, dann die Eingabevalidierung, dann `write_retry!`.
5. **In der Transaktion** führt `*_melden_tx` denselben Lookup als ersten Schritt aus. Unter
   `BEGIN IMMEDIATE` ist er gegen das INSERT nicht verschränkbar. Den Fall „zwei Tabs, beide
   am Vorab-Lookup vorbei“ entscheidet damit der zweite Lookup: Die zweite Transaktion sieht
   die committete Zeile und liefert sie zurück, statt sie zu duplizieren.

`Gemeldet` bekommt ein Feld `neu: bool`. Die Route publiziert nur bei `neu`. Der partielle
UNIQUE-Index ist das Netz dahinter. Würde er je greifen, käme über das Sicherheitsnetz aus
LFH-245 eine 409 heraus, nie eine Dublette.

**Verworfen:** das ETB-Muster (`anlegen_idempotent`: Lookup, Insert, UNIQUE-Verletzung
abfangen, erneut suchen). Es gibt es, weil `etb::anlegen` ohne IMMEDIATE-Transaktion läuft.
Hier schriebe die abgefangene Verletzung erst nach dem ETB-Insert derselben Transaktion,
man müsste zurückrollen und außerhalb neu lesen. Das ist mehr Code für einen Fall, den die
Serialisierung schon ausschließt. **Verworfen** ist auch der Lookup nur in der Transaktion:
Dann läge die Aktiv-Prüfung vor ihm, und ein nach Einsatzende eintreffender Replay bekäme 409
statt seiner Meldung. Genau diesen Fall soll `EinsatzSchreibfreigabe` abdecken.

### D3 — Schlüssel eines anderen Objekts ist 422

Liegt die gefundene Meldung an einem anderen Bezirk bzw. einer anderen Stelle als im Pfad,
antwortet die Route mit 422 „client_id gehört zu einer Meldung an einem anderen Bezirk“.
Jedes Feld ist für sich gültig, erst der Zusammenhang mit dem gespeicherten Zustand
verbietet die Aktion. Nach der Statuscode-Konvention ist das 422 und nicht 409 (keine
Nebenläufigkeit, kein Lebenszyklus). Die bestehende Meldung zurückzugeben wäre falsch: Sie
gehört zu einem anderen Objekt, und die Antwort `BezirkMeldungAnzeige` behauptete dann den
Stand eines Bezirks, den der Client nicht adressiert hat.

### D4 — Replay liefert 201, auch für eine zurückgenommene Meldung

Wie bei `routes/meldung.rs` ist die Antwort auf einen Replay 201, weil der Client die Fälle
nicht unterscheidet. Ist die ursprüngliche Meldung inzwischen zurückgenommen, liefert der
Replay sie trotzdem, zusammen mit dem aktuellen Objektzustand. Die Rücknahme war eine
bewusste spätere Handlung. Eine Neuanlage würde sie still aufheben.

### D5 — Kein Live-Ereignis beim Replay

Das Ereignis wird nach dem Commit im selben Prozess gesendet. Verloren geht es nur, wenn der
Prozess zwischen Commit und Senden stirbt. Dann brechen aber alle SSE-Verbindungen ab, und
`useEinsatzLiveStream` holt beim Reconnect alle Registry-Keys neu. Die Marke
`live_published_at` wie bei `meldung` wäre deshalb eine zweite Spalte ohne Nutzen. Dort ist
sie nötig, weil ein Sofortalarm nicht ausfallen darf. Eine Standmeldung löst keinen Alarm
aus.

### D6 — Zeitpunkt der Erfassung geht nur in die vorgemerkte Kopie

`erfasseStandOfflineFaehig` / `erfasseBelegungOfflineFaehig` (`offline/schreiben.ts`) setzen
die `client_id` einmal, bevor irgendetwas gesendet wird. Der Online-Versuch und die
vorgemerkte Kopie tragen also denselben Schlüssel. **Nur die vorgemerkte Kopie** bekommt
einen `zeitpunkt_at`, und zwar die Client-Uhr zum Erfassungszeitpunkt über `alsBackendZeit`.
Das gilt nur, wenn die Person keinen Zeitpunkt eingetragen hat.

Ohne diesen Schritt stempelte der Server beim Flush „jetzt“. Eine um 10:00 erfasste Zahl
stünde dann als 10:40, verdrängte eine inzwischen gemeldete neuere Zahl und nennte sie im
ETB als „vorher“. Das ist genau die Fehlchronologie, gegen die die absoluten Meldungen samt
Nachtragsregel gebaut sind. **Verworfen** ist der Client-Zeitpunkt auch online: Eine um mehr
als 60 s vorgehende Tablet-Uhr machte dann schon Online-Meldungen zu 400. Heute gelingen sie.

Timeout nach Commit: Der Online-Versuch lief ohne Zeitpunkt, der Server nahm „jetzt“. Die
vorgemerkte Kopie trägt den Client-Zeitpunkt, trifft beim Flush aber auf ihre `client_id` und
liefert die gespeicherte Meldung zurück. Es gibt keinen Widerspruch.

### D7 — Queue: zwei neue Schreibaktionen, keine Schema-Version

`OfflineSchreibaktion` wird um
`{ art: 'stand'; bezirk_id; bezeichnung; daten: StandmeldungEingabe }` und
`{ art: 'belegung'; stelle_id; bezeichnung; daten: BelegungsmeldungEingabe }` erweitert.
`bezeichnung` dient nur der Anzeige im Drawer. Ein nacktes `bezirk_id: 7` sagt dort niemandem
etwas. Die Aktion liegt als Wert im bestehenden Store `schreibaktionen`. Neue Indizes gibt es
nicht, die IndexedDB-Version bleibt also gleich.

`useOfflineSync.verarbeiteEinsatz` bekommt statt des heutigen `else` (unausgesprochen
„Meldung“) eine **exhaustive** `if`-Kette über `aktion.art` mit `never`-Zweig. Eine neue
Variante bricht dann den Typcheck und landet nicht still im Meldungszweig. Ein `switch` wäre
falsch: Die Schleife bricht bei Benutzerwechsel und Unmount per `break` ab, und ein `break`
im `switch` verließe nur diesen. Die Abbruch-Riegel liefen dann still ins Leere. Nach dem Senden:
`schreibaktionEntfernen`, dann Invalidierung von `einsatzKeys.betreuung` (der Präfix umfasst
die Kopfzahl) und `einsatzKeys.etb`, also dieselben zwei Keys wie `invalidiere` auf der Seite.
`OfflineRecoveryDrawer.aktionsTitel` benennt die Arten „Standmeldung“ und
„Belegungsmeldung“, ebenfalls exhaustiv.

### D8 — Seite: vorgemerkt ist ein Erfolg ohne Rückweg

`standMut`/`belegungMut` in `BetreuungPage.tsx` rufen die offline-fähigen Funktionen.
`gesendet` verhält sich wie bisher, mit Rückgängig-Toast. `vorgemerkt` zeigt
`message.warning('Offline vorgemerkt — Standmeldung wird bei Verbindung gesendet')`, ohne
Rückgängig, denn es gibt noch keine `meldung_id`. Der Dialog schließt, weil die Zusage erfüllt
ist und der Wortlaut in IndexedDB liegt. Die Leermeldung (`leermeldungMut`) bleibt beim
direkten `meldeBelegung`.

### D9 — Schwärzung

Beide Tabellenregeln bekommen `retain("client_id", G_IDEMPOTENZ)`. Die Spalte ist eine
technische UUID ohne Personenbezug. Die Registry prüft Spaltenvollständigkeit gegen das
Schema, ohne den Eintrag wäre sie rot.

## Risks / Trade-offs

- [Die Geräteuhr geht vor] → Abgelehnt wird nur, wenn der Vorlauf größer ist als die
  Ausfalldauer plus 60 s Toleranz. Betroffen sind also kurze Ausfälle an Geräten, deren Uhr
  deutlich falsch geht. Der Server antwortet dann mit 400, die Meldung steht im Drawer, und
  „Erneut versuchen“ gelingt, sobald genug Zeit vergangen ist. Das ist kein stiller Verlust,
  aber Handarbeit. Wie oft Geräte im Einsatz so weit abweichen, ist nicht gemessen. Eine
  Korrektur über die Serveruhr (Versatz aus dem `Date`-Header) ist LFH-705.
- [Ein Tab mit altem Bundle flusht die gemeinsame Queue] → Er kennt die Arten `stand` und
  `belegung` nicht, und sein `else`-Zweig schickt die Aktion als Meldung. Der Server lehnt sie
  mit 400 ab (`absender`/`inhalt` fehlen), bevor irgendetwas geschrieben ist. Die Aktion liegt
  dann mit irreführendem Grund unter „abgelehnt“, „Erneut versuchen“ im neuen Tab sendet sie
  richtig. Es gibt keine Dublette und keinen Verlust. Eine Schema-Version schlösse das nicht:
  Das alte Bundle öffnete die höhere Version gar nicht erst und verlöre damit die ganze Queue.
- [Die Stelle wird geschlossen, während eine Belegungsmeldung vorgemerkt ist] → Die Meldung
  ist keine Dublette, der Server lehnt sie mit 422 ab, und sie erscheint im Drawer. Das ist
  gewollt: Eine Belegung an einer geschlossenen Stelle verbietet D4 aus LFH-639.
- [Archiv-Reihenfolge] → Die Capability `betreuung-evakuierung` liegt noch als Delta in
  `lfh-639-fachmodul-betreuung`. Diese Änderung wird **nach** LFH-639 archiviert, sonst legte
  das Archiv eine Main-Spec mit Platzhalter-Purpose an.
- [Die Migration kollidiert mit einem parallelen Branch] → `scripts/check-migrationen.sh`
  vor dem PR, bei Bedarf `--umnummerieren`.

## Migration Plan

Nur additive Spalten und Indizes. Bestandszeilen bleiben NULL. Ein Rollback ist nicht
vorgesehen: Die Migration wird nie zurückgespielt, und ein älteres Binary ignoriert die
Spalte. Wer Clients mit neuem Frontend gegen ein altes Backend laufen lässt, schickt eine
unbekannte `client_id`. Serde verwirft unbekannte Felder in `StandMelden` still. Das
entspricht dem heutigen Verhalten ohne Idempotenz und ist kein Fehler.
