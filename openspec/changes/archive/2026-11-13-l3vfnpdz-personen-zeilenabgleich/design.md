# Design

## Context

Motivation und Messung: `proposal.md`, „Why“.

Der Zeilenabgleich (`frontend/src/live/zeilenAbgleich.ts`, LFH-931, Herleitung
`openspec/changes/archive/2026-10-06-lfh-931-listen-gezielt-nachladen/design.md`) kennt ein Ziel,
`schaeden`. Ein Ziel besteht aus einem Abruf je Kennung (`laden`), den Listen, in die die Zeile
einsortiert wird, und den Prefixen, die der Sammler abgleicht, wenn der Zeilenweg nicht trägt
(verdeckter Tab, Grenze von 10 Kennungen je Fenster, gescheiterter Abruf, laufender Listenabruf).
`EINSATZ_STREAM_ZIELE` in `frontend/src/api/queryKeys.ts` übersetzt ein Ereignis in Abgleiche;
liefert der Eintrag etwas, ersetzt das die Prefixe aus `EINSATZ_STREAM_EVENTS` für dieses
Ereignis vollständig.

Für Personen gibt es zwei Lesewege: die Liste (`GET …/personen`, nicht protokolliert, mit
Stellenbindung und Einheitengerät ohne Personalien) und das Detail (`GET …/personen/{pid}`,
schreibt je Abruf eine `detail`-Zeile ins Zugriffsprotokoll und lädt den ganzen Verlauf).

Das Ereignis `person` kommt mit `person_id` aus allen Schreibwegen an Personen
(`sse_person`, Auto-Austritt, Registrierung je Person samt nachgerückter Bezugsperson), ohne
Kennung nur aus der Nachforderung (`routes/nachforderung.rs`, `sse_mit_person`) und aus dem
Purge.

Unter dem Prefix `personen(e)` liegen zwei Abfragen: die Vollliste `[personen, e]` (Modulseite,
UHS, Überblick, Grundriss) und die Betroffenen einer Stelle `[personen, e, 'stelle', sid]`
(Server filtert auf jüngsten Verbleib `notunterkunft` an dieser, nicht stornierten Stelle).
Daneben `personenAuswahl(e)` (Picker, Sprungpalette, Chat).

## Goals / Non-Goals

**Goals:**

- Ein `person`-Ereignis mit Kennung kostet je Tab einen Abruf von rund 1,6 KB statt der Liste.
- Kein neuer Eintrag im Zugriffsprotokoll durch den Live-Abgleich.
- Dieselbe Sichtbarkeit wie die Liste, auch an gekoppelten Geräten.

**Non-Goals:**

- Die Liste selbst blättern oder nach Phase trennen (eigene Aufgabe, falls die Erstlast stört).
- Den Prefix `personen` anderen Ereignissen hinzufügen. Heute zieht ihn nur `person`; `uhs`,
  `einheit`, `abschnitt` und `nachforderung` gleichen nur eigene Keys ab (`personenUhs`,
  `personenEinheiten` usw.). Join-Felder halten D5 und das Ereignis `person` aktuell.
- Den Zeilenabgleich auf Sammelabrufe umbauen.

## Decisions

### D1 Eigene Zeilen-Route statt Detail oder `?ids=`

`GET /api/einsaetze/{id}/personen/{pid}/zeile` liefert genau die Zeile, die die Liste dieser
Sitzung zeigen würde: `PersonAnzeige` aus `repo::laden`, hinter `EinsatzLesezugriff<Personen>`,
ohne Audit. Stornierte Personen sind 404, wie die Liste sie nicht führt; Stellenbindung über
`stelle::fordere_person` (404, wie das Detail), Einheitengerät über
`PersonAnzeige::ohne_personalien`, wie die Liste.

- *Stornierte mitliefern* (erster Entwurf): verworfen nach dem Review. Die Route hätte die
  Personalien stornierter Personen unprotokolliert lesbar gemacht, die bisher nur das
  auditierte Detail zeigt; zum Entfernen genügt dem Tab der 404 (D4).

- *Detail-Route*: verworfen. Jeder Tab schriebe bei jedem Ereignis eine Protokollzeile, und die
  Antwort trägt den ganzen Verlauf.
- *Liste mit `?ids=`*: ein Abruf je Fenster für bis zu 10 Personen, fehlende fliegen raus.
  Verworfen, weil der Zeilenabgleich dafür vom Abruf je Kennung auf Sammelabruf umgebaut werden
  müsste, auch für Schäden; bei höchstens 10 Kennungen je Fenster spart das wenig.
- Eigener Pfad statt Query-Parameter am Detail: Die Art des Zugriffs hängt an der Route, kein
  Aufrufer kann das Detail-Audit per Parameter umgehen (Muster `…/personen/{pid}/druck`).

Die Route kommt in jede Routenliste der Geräte, die `GET …/personen` führt (`src/geraet/mod.rs`),
sonst bekäme ein UHS- oder Betreuungsgerät 403 und fiele bei jedem Ereignis auf die Vollliste
zurück.

### D2 Ziel `personen` mit drei Listen

Im Frontend ein neues `ZeilenZiel` `personen`:

- `laden`: neuer Abruf der Zeilen-Route (`api/einsatzPerson.ts`).
- `sammeln`: `[personen(e), personenAuswahl(e)]`; der Prefix `personen(e)` erfasst die
  Stellenlisten mit.
- Listen:
  - Vollliste `personen(e)`, exakter Key: stornierte heraus, Ordnung `registrier_nr`
    aufsteigend wie `ORDER BY registrier_nr` im Server.
  - `personenAuswahl(e)`: Projektion auf `id`, `registrier_nr`, `status`, `name`, `vorname`,
    `pat_nummer` (Felder von `PersonAuswahl`), stornierte heraus, gleiche Ordnung.
  - Betroffene je Stelle, Prefix `[personen, e, 'stelle']`, Stelle aus dem letzten Key-Glied:
    gehört dazu, wenn nicht storniert, `aktuelle_verbleib_art === 'notunterkunft'` und
    `aktuelle_verbleib_betreuungsstelle_id === sid`.

Dafür braucht `zeilenAbgleich.ts` eine flache Liste unter Prefix, deren `form` den Cache-Key
sieht; heute gibt es flach nur mit exaktem Key (`liste`) und unter Prefix nur Seitenketten
(`fenster`) und Einzelabrufe (`einzeln`).

`EINSATZ_STREAM_ZIELE.person` liefert mit Kennung die Zeile `personen` und daneben die
Key-Abgleiche, die das Ereignis heute schon auslöst: `modulZaehler(e)`, `betreuung(e)`,
`registrierliste`-Prefix, `personenTransportmittel(e)`, und `personAnhaenge(e, pid)` nur für
diese Person. Ohne Kennung `null`, also alle Prefixe wie bisher.

- *Stellenliste weiter per Prefix*: verworfen (Abstimmung 13.11.2026). Eine Evakuierung mit
  2 000 Personen in einer Halle trüge dieselbe Last.

### D3 Nachforderung schickt `person_id`

`sse_mit_person` ruft `publiziere_objekt(…, LiveEvent::Person, "person_id", pid)` statt
`publiziere_einsatz`. Die Nutzlast bleibt eine Kennung (ADR-0003). Wire-Name und Rechtefilter
ändern sich nicht.

### D4 404 heißt „gehört nicht hinein“, andere Fehler gehen an den Sammler

Ein 404 der Zeilen-Route heißt: Diese Person steht in keiner Liste dieser Sitzung (storniert,
fremder Einsatz, am Gerät einer fremden Stelle). Er trägt dafür im Umschlag zusätzlich
`grund: "nicht_in_liste"` (`AppError::NichtInListe`, additiv wie `AppError::Zeilen`). Der
Zeilenabgleich setzt dann für sie `null` ein, nimmt sie also aus allen Listen, ohne Listenabruf.
Andere Fehler (Netz, 403, 5xx, ein 404 ohne `grund`) geben die Listen wie bei Schäden an den
Sammler. Die übrigen Zeilen desselben Fensters gehen weiter ein.

Der `grund` ist nötig, weil eine unbekannte Route denselben 404 liefert (`static_files::serve`):
Ein Tab mit neuem Bundle an einem zurückgerollten Server nähme sonst jede geänderte Person still
heraus (Nachreview, Entscheidung 13.11.2026).

Am Gerät ist der 404 der Normalfall: Der Strom filtert `person` nur nach Modul, nicht nach
Stelle (`routes/live.rs`), fast jedes Ereignis einer großen Lage betrifft eine fremde Person.

- *404 wie jeder Fehler an den Sammler* (erster Entwurf): verworfen nach dem Review. Ein Gerät
  hätte je fremdem Ereignis einen Zeilenabruf **und** die Vollliste geladen, mehr als vorher.
  Die Unterscheidung ist eindeutig: die Sichtbarkeit einer UHS oder Betreuungsstelle wächst nur,
  am Einheitengerät heißt 404, die Zeile fällt aus der Liste.

### D5 Einheit und Abschnitt melden ihre versorgten Personen

Die Zeile trägt `versorgende_einheit_name` und `versorgende_einheit_abschnitt_*` per Join.
Bisher frischte jedes `person`-Ereignis sie nebenbei auf, weil es die ganze Liste lud. Künftig
sendet der Server nach dem Commit `person` mit `person_id` je Person mit dieser
`versorgende_einheit_id`:

- `PATCH …/einheiten/{eid}`, wenn sich Name oder Abschnitt ändern, gleich nach dem Speichern
  (ein späterer Schritt desselben PATCH kann noch mit 422 scheitern);
- Umbenennen und Auflösen eines Abschnitts: `NamensTraeger` (`einsatzabschnitt::repo`) führt
  schon jedes Objekt, das den Abschnittsnamen per Join trägt (LLH-1291), und bekommt die
  versorgten Personen der Einheiten im Abschnitt dazu;
- Abruf aus dem Bereitstellungsraum mit Ziel-Abschnitt und Übernahme einer unangemeldeten
  Einheit mit Abschnitt (sie kann schon Personen versorgen);
- Vollzug und Rücknahme einer Ablösung mit Abschnittsübergabe (`VollzugWirkung.abschnitt_gewechselt`).

Über zehn Personen (`PERSONEN_EINZELN_MAX`, gleich `ZEILEN_GRENZE`) sendet der Server ein
einziges `person` ohne Kennung: Ab dieser Zahl lädt der Tab die Liste ohnehin ganz, und hunderte
Einzelereignisse liefen über Kanal und Replay-Ring (je 256 Plätze) und lösten `lagged` aus.

- *`einheit` und `abschnitt` ziehen den Prefix `personen`*: verworfen (Abstimmung 13.11.2026).
  `einheit` kommt bei jedem Statuswechsel einer Einheit, im MANV wäre die Volllast nur
  verschoben.
- *Hinnehmen*: verworfen. Ein dauerhaft offener Leitstellen-Tab zeigte den alten Namen bis zum
  Neuladen.

### D6 Eine Zeile, die sich während ihres Abrufs geändert hat, wartet aufs nächste Fenster

Der Zeilenabruf ist kein Query, `cancelQueries` in einem `onMutate` erreicht ihn nicht. Schreibt
eine optimistische Änderung (Grundriss, Status) während des Abrufs in die Liste, überschriebe die
Zeile vom Stand davor sie. Der Zeilenabgleich merkt sich deshalb je Liste die Referenz jeder
abgerufenen Zeile vor dem Abruf. Ist sie danach eine andere, setzt er diese Zeile nicht ein und
legt ihre Kennung ins nächste Fenster; die übrigen Zeilen gehen ein. Structural Sharing von
TanStack lässt unveränderte Zeilen dabei gleich. Eine Liste, die erst während des Abrufs geladen
wurde, hat keinen Schnappschuss und geht an den Sammler. Das gilt für Schäden genauso.

Geschützt ist der eine Abruf. Läuft die Mutation hinter der optimistischen Änderung länger als
das nächste Fenster, kann der erneute Abruf noch den alten Stand lesen, bis `onSuccess` oder das
eigene Ereignis der Mutation ihn ersetzt; so war es vor dieser Change bei jedem Ereignis. Auf
laufende Mutationen zu warten (`isMutating`) ist verworfen: die Offline-Warteschlange hielte den
Zeilenabgleich dann beliebig lange an.

- *Ganze Liste an den Sammler, wenn sich `dataUpdatedAt` geändert hat* (erste Behebung):
  verworfen im Nachreview. Eine optimistische Änderung an einer anderen Zeile hätte einen
  Listenabruf ausgelöst, der sie vor dem Speichern zurückspringen lassen kann.

### D7 Bezeichner

Neue Namen folgen der Bezeichner-Sprache (LLH-1312): `loadPersonZeile`, `loadPersonZeileOrNull`,
`comparePersonen`, `toPersonAuswahl`, `snapshotRows`, `rowOf`, `changedIds`. `gefiltert` bleibt in der Familie `liste`/`fenster`/`einzeln` derselben Datei,
die diese Change nicht umstellt.

## Risks / Trade-offs

- [Clientregel der Stellenliste weicht vom Serverfilter ab] → Die Regel prüft dieselben
  Spalten. Abweichen kann sie nur bei einer stornierten Stelle; deren Seite zeigt ohnehin keine
  Betroffenen mehr, und der nächste volle Abruf heilt es. Test mit Wechsel hin und weg.
- [Ordnung im Client weicht ab] → `registrier_nr` ist je Einsatz eindeutig (UNIQUE), also eine
  totale Ordnung ohne Gleichstand.
- [Ein Schreibweg ändert die Zeile einer anderen Person ohne eigenes Ereignis] → Bekannt und
  abgedeckt: Haushaltswechsel meldet die nachgerückte Bezugsperson mit, die Nachforderung ihre
  Person (D3), Einheit, Abschnitt, Abruf und Ablösung die versorgten Personen (D5). Ein künftiger Join in
  `SELECT_ALLE` braucht dasselbe; sonst bleibt das Feld bis zum Neuladen, Fokuswechsel oder
  `lagged` stehen.
- [Ältere Tabs mit altem Frontend] → Frontend und Server kommen aus demselben Binary; ein alter
  Tab kennt die Route nicht und gleicht wie bisher ganz ab.
- [Neuer Tab nach einem Server-Rollback] → Der alte Server kennt die Zeilen-Route nicht und
  antwortet mit 404 ohne `grund`; der Tab gleicht dann wie bisher ganz ab (D4).

## Migration Plan

Keine Migration, kein neues DTO. Rückweg: Revert; ohne Eintrag in `EINSATZ_STREAM_ZIELE`
gelten wieder die Prefixe.
