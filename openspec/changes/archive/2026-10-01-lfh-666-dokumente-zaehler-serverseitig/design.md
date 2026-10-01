# Design

## Context

Der Endpunkt `GET /api/einsaetze/{id}/modul-zaehler` (LFH-612, `src/einsatz/zaehler.rs`) zählt
acht Module. Jedes Feld ist an `erlaubte_module` gegatet und fehlt, wenn der Benutzer das Modul
nicht sehen darf. Im Frontend teilt `einsatz/modulRegistry.ts` die Zählerquellen in
`ServerZaehlerQuelle` und `ClientZaehlerQuelle`. `einsatz/useModulZaehler.ts` bildet die
Serverantwort über `ABBILDUNG` ab. Die Browser-Zähler (`dokumente`, `abloesung`, `betreuung`)
laden dafür jeweils ihre eigene Modulliste.

Heute lädt der Rahmen für den Dokumente-Zähler `GET /api/einsaetze/{id}/dokumente`, die volle
Liste mit fünf Joins (Anhang, Abschnitt, Einheit, ETB-Eintrag, Benutzer), und zählt dann nur
`length`.

Befund im Code:

- `dokument::repo::liste` liest `einsatz_dokument d JOIN anhang a … WHERE d.einsatz_id = ? AND
  d.geloescht_at IS NULL`. `anhang_id` ist `NOT NULL UNIQUE REFERENCES anhang(id) ON DELETE
  CASCADE` (Migration 0116). Der innere Join filtert also keine Zeile heraus, die das
  `WHERE` durchlässt.
- Ablegen und Entfernen (`routes/dokument.rs`) publizieren beide `LiveEvent::Dokument`. Der
  Hub sendet an alle Abonnenten des Einsatzes, also auch an den Absender. Das Ereignis ist an
  das Modul `dokumente` gegatet (`live/mod.rs`), dasselbe Gate wie der Zähler.
- `EINSATZ_STREAM_EVENTS.dokument` invalidiert heute nur `EINSATZ_KEYS.dokumente`.
- `DokumentAblegenModal` und `DokumentePage` invalidieren lokal `dokumente` und `etb`, aber
  nicht `modulZaehler`. Für den ETB-Zähler (Serverquelle) verlässt sich der Code also schon
  heute auf den Live-Feed.

## Goals / Non-Goals

**Goals:**

- `dokumente.gesamt` kommt vom Server, mit demselben Prädikat wie die Dokumentliste.
- Der Rahmen lädt die Dokumentliste nicht mehr.
- Wortlaut („n abgelegte Dokumente“, „1 abgelegtes Dokument“) und Gating („fehlt ≠ 0“)
  bleiben unverändert.

**Non-Goals:**

- Ablösung und Betreuung auf den Server ziehen. Die Ablösung hängt an der Uhr (LFH-635). Die
  Betreuung teilt sich eine Abfrage mit Seite und Kennzahl (LFH-639).
- Dokumente nach Kategorie oder Bezug aufschlüsseln.

## Decisions

### D1 — Ein eigenes `COUNT(*)` über `einsatz_dokument`, nicht über die Listenfunktion

`menge(pool, "SELECT COUNT(*) FROM einsatz_dokument WHERE einsatz_id = ? AND geloescht_at IS
NULL", …)`, dasselbe Muster wie ETB, Betroffene, Einheiten und Abschnitte.

- *Alternative: über `dokument::repo::liste` zählen.* So machen es die Kommunikationszähler.
  Dort rechnet die Liste aber Prädikate je Zeile (`ist_offen`, `ist_ueberfaellig`, …), und ein
  zweites Prädikat wiche still ab. Für die Dokumente gibt es kein solches Zeilenprädikat, nur
  den Soft-Delete-Filter. Über die Liste zu zählen hieße, die fünf Joins bei jedem
  `dokument`-Ereignis auszuführen, also genau die Last, die LFH-612 abbauen wollte.
- Der Join auf `anhang` entfällt. `anhang_id` ist `NOT NULL` mit `ON DELETE CASCADE`, eine
  Dokumentzeile ohne Anhang gibt es nicht. Ein Integrationstest sichert die Parität trotzdem
  ab: Er vergleicht `dokumente.gesamt` mit der Länge der Liste, nachdem ein Dokument entfernt
  wurde (Spec-Szenario „Gelöschte Dokumente zählen nicht“).

### D2 — `dokumente` wird Serverquelle, die Typen tragen den Wechsel

`ServerZaehlerQuelle` bekommt `'dokumente'`, `ClientZaehlerQuelle` verliert es. Weil
`ABBILDUNG` und `ZAEHLER_LISTEN_KEYS` `Record`s über `ServerZaehlerQuelle` sind, bricht der
Typcheck, bis beide einen Eintrag haben:

- `ABBILDUNG.dokumente = ({ gesamt }) => ({ wert: gesamt, beschreibung: plural(gesamt,
  'abgelegtes Dokument', 'abgelegte Dokumente') })`. Das ist wortgleich zu
  `berechneDokumentZaehler`, das entfällt.
- `ZAEHLER_LISTEN_KEYS.dokumente = EINSATZ_KEYS.dokumente`. Damit verlangt die
  Vollständigkeitsprüfung in `queryKeys.test.ts`, dass `EINSATZ_STREAM_EVENTS.dokument`
  `EINSATZ_KEYS.modulZaehler` enthält.

`useModulZaehler` verliert die Dokumentabfrage samt `dokumenteAktiv`. Das Anzeige-Gate
(`darfZaehlerZeigen`) läuft für Serverquellen schon über die Schleife über
`ZAEHLER_QUELLEN`.

### D3 — Keine zusätzliche lokale Invalidierung in Ablegen/Entfernen

Ablegen und Entfernen publizieren `LiveEvent::Dokument`. Der Feed erreicht auch den Absender,
und mit D2 invalidiert das Ereignis den Modulzähler. Eine lokale Invalidierung von
`modulZaehler` in `DokumentAblegenModal`/`DokumentePage` wäre doppelt. Der ETB-Zähler, den
dieselben Mutationen berühren, verlässt sich schon so auf den Feed. Der Chat bildet die
Ausnahme (`ChatPage`), weil das Lesen eines Kanals **kein** Live-Ereignis erzeugt. Das trifft
hier nicht zu.

### D4 — Typ-Codegen

`ModulZaehlerAnzeige` ist ein Response-DTO. Nach der Änderung `scripts/check-typ-codegen.sh`
ausführen und beide generierten Dateien mitcommitten (`src/AGENTS.md`). Das Feld ist im
Schema optional (`skip_serializing_if`), also additiv für alte Clients.

## Risks / Trade-offs

- **Prädikat driftet:** Bekäme die Dokumentliste später einen weiteren Filter (etwa nach
  Kategorie oder Berechtigung je Dokument), wiche das eigene `COUNT` ab. → Mildern: Der
  Paritätstest in `tests/modul_zaehler.rs` vergleicht mit dem Listen-Endpunkt, nicht mit einer
  handgesetzten Zahl. Ein Code-Kommentar am `COUNT` verweist auf `dokument::repo::liste`.
- **Zähler aktualisiert sich nur noch über den Feed:** Ohne Live-Verbindung bleibt er bis zum
  nächsten Refetch stehen. Das gilt heute schon für alle Serverquellen und ist kein neues
  Verhalten.

## Migration Plan

Keine Datenmigration. Backend und Frontend gehen im selben Binary aus (`rust-embed`). Ein
alter Client ignoriert das zusätzliche Feld.

## Open Questions

Keine.
