# Design

## Context

Siehe `proposal.md`, Abschnitt „Why“. Pfade relativ zu `frontend/src/`. Ausgangslage am
06.10.2026 (`alpha` 9bf2ba9):

- `offline/lagebildSitzung.ts` abonniert per `persistQueryClientSubscribe` Query- **und**
  Mutation-Cache und dehydriert bei jedem Ereignis. Der Persister
  (`offline/lagebildPersister.ts`) drosselt erst den Schreibvorgang und reiht ihn per
  `laufend = laufend.then(...)` an.
- `offline/lagebildSpeicher.ts` hält genau einen Datensatz `aktuell` mit `benutzer`,
  `bestaetigtAt`, `buster` und `client`. `bestehendenAendern` liest und schreibt ihn ganz, auch
  für die Bestätigung.
- `istLagebildOfflineKey` nimmt jeden Key unter dem Prefix `etb`. Die ETB-Keys tragen den
  Filter als Objekt (`['etb', id, filter]`, `['etb', id, 'zaehler', filter]`), dazu die
  Lesemarke (`['etb', id, 'lesemarke']`). Aufrufer mit Filterobjekt: `EtbPage` (Liste und Zähler,
  `{}` oder mit `q`/`typ`/`von`/`bis`/`einheit_id`), Überblick (`{typ: 'entscheidung', limit:
  50}`), Lage-Dashboard (`{limit: 30}`), Bezugswahl (`{limit: 100}`, Suche `{limit, bezug}`),
  Palette (`{q, limit}`, `{q, anzahl}`, `{before_lfd_nr, limit}`, alle mit 30 s `gcTime`),
  Lageentwicklung (`{lageentwicklung: id}`).
- `queueZaehlerLaden` zählt eigene Zeilen über Schlüssel, ruft aber
  `queueNichtZugeordnetZaehlen()`, das alle vier Stores per `getAll` liest.
- Die Personen-Quittung trägt `person: Person`; die Personenseite nutzt daraus
  `registrier_nr`, `id` und die Person selbst für `merkeFrisch` und `sichtFuerNeuePerson`.
- `anzeige/ortCache.ts`: Store ohne Zeitstempel; geräumt nur beim Ausgang (LFH-767 D6).
- ETB-Entwürfe: Seit LFH-894 sichert die Erfassung einen leeren Entwurf nicht mehr (ein leerer
  Stand wird entfernt, außer er trägt gewählte Dateien, die nur im Speicher des Tabs liegen).
  Liegen bleiben leere Altentwürfe aus der Zeit davor und Aktiv-Merker
  `etb-entwurf-aktiv-<benutzer>-<einsatz>`.

## Goals / Non-Goals

**Goals:**

- Kein Wachstum mit der Laufzeit eines Tabs: höchstens ein laufender und ein wartender
  Speichervorgang, Dehydrieren gedrosselt, der Vorrat schrumpft.
- Auf der Platte nur, was offline wieder aufgerufen wird.
- Zähleraktualisierung ohne Payload und ohne Ereignisflut.
- Datensparsamkeit: Quittung nur mit Kennungen, Ortscache befristet.

**Non-Goals:**

- Räumen beim Abmelden, Sitzungsende und Benutzerwechsel (LFH-767, umgesetzt).
- Die Queue-Stores selbst; sie bleiben Beweissicherung.
- Eine Offline-Suche im ETB (gefiltert aus der Gesamtliste). Ohne Netz zeigt eine Suche
  weiter nichts, wie jede nie geladene Ansicht.

## Decisions

### D1 — Drossel vor dem Dehydrieren, Single-Flight im Persister

`abonnieren` ersetzt `persistQueryClientSubscribe` durch ein eigenes Abo auf den
**Query-Cache**. Ein Ereignis startet, falls keiner läuft, einen Zeitgeber über
`LAGEBILD_DROSSEL_MS`; erst sein Ablauf dehydriert (`dehydrate(qc, lagebildDehydrierOptionen)`),
führt den Vorrat zusammen und übergibt an den Persister. Der Mutation-Cache wird nicht
abonniert: `shouldDehydrateMutation` liefert ohnehin `false`.

Der Persister schreibt **sofort**, wenn nichts läuft, sonst ersetzt er nur `ausstehend`. Nach
dem Ende eines Schreibvorgangs folgt genau ein weiterer mit dem jüngsten `ausstehend`. Es gibt
keine `.then`-Kette mehr. `abbrechen()` setzt `tot`, verwirft `ausstehend`, stoppt den
Zeitgeber des Abos (über `abmelden`) und wartet den laufenden Schreibvorgang ab (D5 aus LFH-723
bleibt).

Die erste Speicherung beim Abonnieren bleibt: `abonnieren` stößt den Zeitgeber einmal selbst an.

*Alternative:* Debounce statt Drossel. Verworfen: Bei Ereignissen im Sekundentakt (Fahrzeugstatus,
SSE) käme ein Debounce nie zum Zug, und der Stand auf der Platte veraltete.

### D2 — Kopf und Stand unter zwei Schlüsseln

`lifeline-lagebild` bleibt auf v1 (D9). Im Store `stand` liegen `kopf` (`benutzer`,
`bestaetigtAt`, `buster`) und `client` (der `PersistedClient`). Der Altdatensatz unter
`aktuell` wird nicht mehr gelesen; `lagebildAnlegen` und `lagebildLoeschenPlatte` löschen ihn
in derselben Transaktion mit. Er trägt den `buster` der Vorversion und würde beim Start ohnehin
verworfen (`startEntscheidung`), danach legt der Start ohnehin neu an.

- `lagebildLesen` liest beide in einer Lesetransaktion und setzt den bisherigen
  `LagebildDatensatz` zusammen; fehlt einer, gibt es keinen Datensatz.
- `lagebildAnlegen` schreibt beide, `lagebildLoeschenPlatte` löscht beide, jeweils in einer
  Transaktion.
- `lagebildClientSchreiben` liest in einer Schreibtransaktion nur `kopf`, prüft die Identität
  und schreibt `client`. `lagebildBestaetigen` liest und schreibt nur `kopf`. Der
  Mehrtab-Schutz bleibt: Löscht ein anderer Tab zwischendurch, fehlt `kopf`, und es wird nichts
  geschrieben.

### D3 — Vorrat nach jeder Speicherung kürzen

Bei jeder Speicherung wird `vorrat` auf die Einträge gekürzt, die zulässig sind
(`lagebildStandZulaessig`) und deren `queryHash` nicht im Live-Stand steht. Ein einmal live
überdeckter Eintrag kommt nie zurück: Der Live-Stand ist jünger, und verlässt die Query den
Cache, ist auch der ältere Vorrat-Stand nicht mehr gewollt (Liegezeit, Sperrmarke,
Räummarke).

### D4 — ETB nur in festen Ansichten offline (Entscheidung Ruben, 06.10.2026)

Eine ETB-Ansicht ist **fest**, wenn ihr Filterobjekt nur die Felder `typ` und `limit` trägt.
Diese Menge ist begrenzt: Gesamtliste, je ein Reiter je Typ, Überblick, Lage-Dashboard,
Bezugswahl ohne Suche. Alles mit `q`, `von`, `bis`, `einheit_id`, `erfasser_id`,
`before_lfd_nr`, `anzahl`, `bezug` oder `lageentwicklung` ist **frei**. Die Lesemarke ist fest.

- `istLagebildOfflineKey` nimmt unter dem Prefix `etb` nur feste Ansichten (Liste, Zähler,
  Lesemarke). Eine Positivliste der Felder statt einer Negativliste: Ein neues Filterfeld landet
  nicht still auf der Platte.
- `gcTime`: freie Varianten bekommen zentral 5 min (`ETB_FREI_GC_MS`), feste behalten 24 h.
  Zentral heißt im selben Schritt, der heute die 24 h setzt (`lagebildLiegezeitSetzen`,
  `api/queryClient.ts`): `setQueryDefaults` matcht nur per Prefix, deshalb ergänzt der Client
  `defaultQueryOptions` um die Regel „freier ETB-Key ohne eigenes `gcTime` → 5 min“. Eine
  ausdrückliche Angabe des Aufrufers (Palette, 30 s) gewinnt.
- Der Kommentar an `LAGEBILD_OFFLINE.einsatz` („ihr kurzes `gcTime` räumt sie ohnehin“) wird
  richtiggestellt.

*Verworfen (Entscheidung 06.10.2026):* nur die Gesamtliste (Typ-Reiter offline leer) oder
alles lassen (Entscheidung aus LFH-723 bleibt).

### D5 — Queue-Zähler

`queueNichtZugeordnetZaehlen` öffnet eine Lesetransaktion über die vier Stores und rechnet je
Store `count()` minus `index('by-benutzer').count()`: Der Index enthält genau die Zeilen mit
`benutzer_id` (v4), der Rest ist Altbestand. Kein Payload wird gelesen.

`useOfflineQueueZaehler` lädt bei einem Ereignis sofort, wenn nichts läuft; Ereignisse während
eines Ladevorgangs oder innerhalb von `ZAEHLER_DROSSEL_MS` (250 ms) danach führen zu genau
einem Nachladen am Ende des Fensters. Gebündelt wird beim Verbraucher, nicht beim Melden: Andere
Hörer (Abgleich, Ausgaben) brauchen jedes Ereignis, und zwischen zwei Zeilen eines Abgleichs
liegt ein HTTP-Roundtrip, den ein Microtask-Bündel nicht überbrückt.

### D6 — Quittung nur mit Kennungen

`PersonErfassungsQuittung` trägt `person_id` und `registrier_nr` statt `person`;
`lifeline-offline` bleibt auf v5 (D9): Nach dem Öffnen kürzt eine Schreibtransaktion per
Cursor jede Bestandsquittung, Fehler darin sind nicht fatal. `personErfassungsQuittungenLaden`
kürzt beim Lesen noch einmal, denn ein Tab mit altem Bundle schreibt bis zu seinem Neuladen
volle Quittungen.
`schreibaktionPersonAbschliessen` gibt weiter die volle Person an den Aufrufer zurück
(`OFFLINE_SCHREIBAKTION_GESENDET_EVENT` trägt sie im Speicher), legt aber nur die Kennungen ab.

Die Personenseite liest beim Laden der Quittungen die Personen aus
`einsatzKeys.personen(einsatzId)`. Gefundene gehen wie bisher an `merkeFrisch` und
`sichtFuerNeuePerson`; fehlt die neueste, bleibt die Sicht stehen, und nur die Hervorhebung
wird per Kennung gesetzt. Der Text „Erfasst als R-…“ kommt aus `registrier_nr`.

### D7 — Ortscache mit Frist und Obergrenze

`lifeline-ortcache` bleibt auf v1 (D9), ohne Index: Der Wert ist `{ name, at }`; ein nackter
Name der Vorversion gilt als `at = 0`, also abgelaufen (reiner Cache, der Server hält
`geocoding_cache`). Beim ersten Öffnen liest eine Schreibtransaktion alle Schlüssel und Werte,
sortiert nach `at` und löscht alles älter als 30 Tage und, falls danach mehr als 5 000 übrig
sind, die ältesten bis zur Grenze. Bei höchstens 5 000 kleinen Werten ist das billig.
`holeOrt` liefert `name`, bei einem nackten Namen aus einem alten Tab diesen. Die Ortsvorschau
wartet `setzeOrt` nicht ab. Ein Treffer frischt `at`
nicht auf: Ortsnamen ändern sich nicht, und Schreiben beim Lesen kostete mehr als ein erneutes
Nachschlagen nach 30 Tagen.

### D8 — Leere Entwürfe und verwaiste Merker (Entscheidung Ruben, 06.10.2026)

`entwuerfeLaden(benutzerId, einsatzId)` löscht nach `vorlaufNachtragen` in einer
Schreibtransaktion über `by-benutzer-einsatz` (alle Einsätze der Person) jeden Entwurf, dessen
Werte leer sind (`istLeer`) und dessen `geaendert_at` (ersatzweise `erstellt_at`) mehr als 24 h
zurückliegt. Gelöscht wird mit derselben Vorlauf-Disziplin wie `entwurfEntfernen` (LFH-521).
Trägt ein Entwurf einen offenen Vorlauf, schreibt ein anderer Tab gerade an ihm; er bleibt
stehen, `vormerken(id, null)` überschriebe sonst dessen Auftrag.
Danach entfernt `aktivMerkerAufraeumen(benutzerId, einsatzeMitEntwurf)` jeden Merker
`etb-entwurf-aktiv-<benutzer>-<einsatz>` ohne verbliebenen Entwurf; die Funktion steht neben
`aktivSchluessel`. Entwürfe mit Text bleiben wie in LFH-767 D4.

Ein leerer Entwurf mit gewählten Dateien in einem anderen, seit über 24 h offenen Tab kann
dabei von der Platte gehen. Dieser Tab hält ihn weiter im Speicher und sichert ihn bei der
nächsten Änderung neu; die Dateien selbst liegen nie auf der Platte.

*Verworfen (Entscheidung 06.10.2026):* 14 Tage Frist für alle Entwürfe (ändert D4 aus
LFH-767) oder nichts ändern.

### D9 — Kein Versionssprung (Review, 06.10.2026)

Der erste Schnitt hob `lifeline-lagebild` auf v2, `lifeline-offline` auf v6 und
`lifeline-ortcache` auf v2. Das Review fand: Ein Tab mit altem Bundle hält die alte Version
offen und bekommt `versionchange` nur, wenn er darauf hört; das tut keine der drei Dateien.
Dann hinge das Öffnen im neuen Tab, und mit ihm der Start im `AuthProvider` (Lagebild),
Queue und Abgleich (Offline-DB) und die Ortsvorschau. Alle drei Änderungen passen in die
bestehenden Stores, also bleibt jede DB auf ihrer Version. Jede der drei trägt dazu einen
`blocking`-Handler, der die eigene Verbindung schließt und vergisst: Ein künftiges Upgrade
wartet dann nicht auf Tabs mit diesem Bundle. Nachweis je DB ein Test, der aus einem zweiten
Öffner hochstuft.

## Risks / Trade-offs

- **Drossel verschiebt den Stand um bis zu 1 s:** wie bisher; die Drossel saß vorher am
  Schreiben, jetzt am Dehydrieren.
- **Neue Version verwirft den Lagebild-Stand:** Ein Ausrollen ohne Netz kostet den
  vorgehaltenen Stand, wie jede neue Version heute über den `buster` auch.
- **Alte und neue Tabs nebeneinander:** Ohne Versionssprung (D9) blockiert nichts. Ein alter
  Tab liest `aktuell`, das der neue nicht mehr schreibt, und hat dann keine Vorhaltung; er
  schreibt volle Quittungen und nackte Ortsnamen, die der neue beim Lesen kürzt bzw. annimmt.
- **Freie ETB-Varianten ohne Netz:** Eine Suche, die vor dem Netzverlust lief, ist nach einem
  Neuladen weg. Gewollt (D4).

## Migration Plan

Reine Frontend-Änderung ohne IndexedDB-Versionssprung (D9). Bestand wird beim Öffnen bzw.
Anlegen umgeschrieben: der Lagebild-Altdatensatz beim nächsten Anlegen oder Löschen, die
Quittungen und der Ortscache beim ersten Öffnen je Seitenaufruf. Kein Rückweg nötig: Eine
ältere Version öffnet dieselben Versionen und kommt mit dem neuen Inhalt aus (ohne
Vorhaltung, Quittung ohne `person` wird nicht angezeigt, Ortsname als Objekt wird nicht
genutzt).
