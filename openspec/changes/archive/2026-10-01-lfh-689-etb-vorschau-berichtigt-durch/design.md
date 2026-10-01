# Design

## Context

Ist-Stand (gelesen 01.10.2026):

- `EtbEintragAnzeige` (`src/etb/mod.rs`) trägt die Vorwärtsrichtung `berichtigt_eintrag_id`.
  Die Rückrichtung gibt es nur im Client: `berichtigungsindex` (`etb/zeitachseModell.ts`)
  über die geladenen Einträge, benutzt von Zeitachse, Druck und Bilanz. Der Druck lädt bei
  aktivem Filter alle Berichtigungen in einem zweiten Durchgang nach (`etb/druckAbruf.ts`).
- Die Palette-Vorschau (`etb/EtbEintragVorschau.tsx`) liest das Nummernfach
  `etbNummerAbfrage` (Liste mit `before_lfd_nr: n+1, limit: 1`) und wählt per `select` den
  Eintrag mit derselben `id`. Datenregel: Listenfach per `select`, kein Detailfach
  (`command-palette/AGENTS.md`).
- Präzedenz für nachgeladene Verweise am Eintrag: `folgeauftraege` (LFH-636) und `anhaenge`
  (LFH-117). Beide sind `#[sqlx(skip)]`, `laden` und `abfrage` füllen sie je Seite mit einer
  gebündelten `IN (…)`-Abfrage nach.
- Das SSE-Ereignis `etb` invalidiert den ganzen Prefix `['etb', einsatzId]`
  (`api/queryKeys.ts`), das Nummernfach eingeschlossen. Eine neue Berichtigung zieht eine
  offene Vorschau also schon heute neu.
- Auf `etb_eintrag.berichtigt_eintrag_id` liegt kein Index (`migrations/0004_etb.sql`).
- Das Offline-Lagebild verwirft gespeicherte Stände einer anderen App-Version
  (`__APP_VERSION__` als Buster, `offline/lagebildSitzung.ts`). Ein alter Stand ohne das neue
  Feld wird also nicht hydriert.

## Goals / Non-Goals

**Goals:**
- Eine Datenquelle für „wer berichtigt diesen Eintrag?“, die ohne die ganze Liste auskommt.
- Die Vorschau zeigt die Rückrichtung ohne zusätzlichen Abruf und ohne neues Fach.
- Konstante Zahl Abfragen je ETB-Seite (kein N+1).

**Non-Goals:**
- Zeitachse, Druck und Bilanz bleiben beim clientseitigen `berichtigungsindex`. Sie auf das
  Wire-Feld umzustellen ändert sichtbares Verhalten der Zeitachse (unter einem Filter
  erschiene „berichtigt durch Nr. m“ auch für Berichtigungen außerhalb der Liste) und spart im
  Druck den zweiten Durchgang. Beides verdient eine eigene Entscheidung, keinen Beifang.
- Die Vorwärtsrichtung der Vorschau bekommt keine Nummer des Grundeintrags („berichtigt einen
  älteren Eintrag“ bleibt). Dafür bräuchte es ein zweites Feld
  (`berichtigt_eintrag_lfd_nr`); der Ticketumfang ist die Rückrichtung.
- Das Archiv-ETB (`aufbewahrung`) bekommt das Feld nicht; es führt seine eigene Projektion
  ohne abgeleitete Verweise.

## Decisions

**D1 — Wire-Feld statt Listenfilter (Option 1 des Tickets).**
`EtbEintragAnzeige` bekommt `berichtigt_durch`, das Backend füllt es.

| | Option 1: Wire-Feld | Option 2: `?berichtigt_eintrag_id=` |
|---|---|---|
| Abrufe je Vorschau | keiner zusätzlich | einer je Öffnung |
| Datenregel der Vorschau | eingehalten (Nummernfach per `select`) | Abweichung: zweites Fach je Vorschau, eigene Frische und Invalidierung |
| Live-Aktualisierung | über den bestehenden `etb`-Prefix | neues Fach muss unter denselben Prefix |
| Kosten | eine Abfrage mehr je ETB-Seite, `[]` je Eintrag auf dem Wire | ein neuer Filter in `filter_bedingung`, Zähl- und Typzählungspfade müssten ihn mittragen |
| Nachnutzung | Zeitachse/Druck können später umstellen | nur Vorschau |

Verworfen außerdem: Die Vorschau lädt alle Berichtigungen des Einsatzes (`?typ=berichtigung`,
wie der Druckdurchgang) und bildet den Index selbst. Das ist ein Abruf ohne Obergrenze je
Vorschau und widerspricht der Datenregel noch deutlicher.

**D2 — Wire-Form `berichtigt_durch: Vec<BerichtigungVerweis { id: i64, lfd_nr: i64 }>`.**
`lfd_nr` ist bei ETB-Einträgen `NOT NULL`, also kein `Option` (anders als beim
`FolgeauftragVerweis`). Das Feld ist immer serialisiert, leer als `[]`; utoipa führt es als
required, die generierte TS-Form ist ein Pflichtfeld. Eigener Typ statt Wiederverwendung von
`FolgeauftragVerweis`: der hat `lfd_nr` optional und meint Aufträge.

**D3 — Gebündelte Nachlade-Abfrage `berichtigungen_nachladen`, wie `folgeauftraege_nachladen`.**
`SELECT b.berichtigt_eintrag_id, b.id, b.lfd_nr FROM etb_eintrag b JOIN etb_eintrag g ON
g.id = b.berichtigt_eintrag_id AND g.einsatz_id = b.einsatz_id WHERE b.typ = 'berichtigung'
AND b.berichtigt_eintrag_id IN (…) ORDER BY b.lfd_nr`, aufgerufen in `laden` und `abfrage`.
Sie läuft ohne Listenfilter und ohne Cursor: das macht das Feld seiten- und filterunabhängig
(Spec `etb-berichtigung`). Die Einsatzgrenze hält die Abfrage selbst (Join über den
Primärschlüssel des Grundeintrags). Die Schreiber prüfen sie heute ebenfalls (Erfassen-Route mit
`gehoert_zu_einsatz`, Betreuung und Ablösung über einsatzgefilterte Zeilen), die Datenbank aber
nicht (nur der FK aus 0004); ohne den Join legte ein künftiger Schreiber ohne Prüfung id und
Nummer eines fremden Einsatzes offen (Review-Befund). `typ = 'berichtigung'` hält das Feld
deckungsgleich mit dem Client-Index.
Alternative korrelierte Subquery mit `json_group_array`: verworfen aus denselben Gründen wie in
LFH-636 D2 (sqlx-JSON, Null-Behandlung, schwerer zu testen).

**D4 — Teilindex `etb_eintrag(berichtigt_eintrag_id) WHERE berichtigt_eintrag_id IS NOT NULL`**
als neue Migration `0131_etb_berichtigt_index.sql`. Ohne ihn ist jede ETB-Seite ein Scan über
alle ETB-Einträge der Instanz. Partiell, weil nur Berichtigungen den Wert tragen. Nummer vor
dem Merge mit `scripts/check-migrationen.sh` gegen `origin/alpha` prüfen.

**D5 — Ein Datenfeld „Berichtigung“ für beide Richtungen in der Vorschau.**
Das bestehende Feld erscheint, wenn `berichtigt_eintrag_id` gesetzt ist **oder**
`berichtigt_durch` nicht leer ist. Es trägt erst die Vorwärtsrichtung (unverändert), dann je
Berichtigung einen Router-`Link` „berichtigt durch Nr. Y“ mit `aria-hidden` ↗ auf
`etbPfad(einsatzId, { eintrag: id })`, `verweisStil`, umbrechend mit `marginXS` Abstand.
Wortlaut, Ziel und Stil sind die der Zeitachse (`eintragsHinweis`). Ein zweites Feld
„Berichtigt durch“ hätte das Wort doppelt getragen („Berichtigt durch: berichtigt durch
Nr. 9“). Den Klick schließt der bestehende Riegel in `CommandPalette.tsx` (`a[href]`).

**D6 — Kopfkommentar der Vorschau** („WAS FEHLT, MIT ABSICHT“) verliert den Absatz zur
Rückrichtung und nennt stattdessen die Quelle (`berichtigt_durch`, LFH-689). Der Kommentar an
`berichtigungsindex` bekommt einen Satz, dass der Server die Rückrichtung inzwischen liefert
und die Bildschirme sie bewusst noch aus der geladenen Liste bilden (Non-Goal oben).

## Risks / Trade-offs

- [Pflichtfeld bricht Test-Fixtures von `EtbEintragAnzeige`] → gewollt, der Typcheck findet
  jede Stelle; Fixtures bekommen `berichtigt_durch: []`.
- [Zwei Quellen für dieselbe Rückrichtung (Server-Feld, Client-Index)] → bewusst bis zur
  Folgeentscheidung (Non-Goals). Beide zeigen auf dieselbe Spalte und filtern auf
  `typ = 'berichtigung'`; der Server-Wert ist eine Obermenge des Index.
- [Migrationsnummer kollidiert beim Merge] → `scripts/check-migrationen.sh` vor dem PR,
  bei Bedarf `--umnummerieren`.
- [Antwortgröße] → ein `"berichtigt_durch":[]` je Eintrag, bei 500 Einträgen rund 12 KB
  unkomprimiert; vernachlässigbar neben `inhalt`.

## Migration Plan

Additive Migration (nur Index) und additives Wire-Feld. Rückbau: Feld entfernen; der Index
kann bleiben. Gespeicherte Offline-Stände älterer Versionen verwirft der Versions-Buster.
