# Design

## Context

Das Warum steht in proposal.md, die Anforderungen in `specs/betroffene-lagedaten/spec.md`.

Ausgangslage im Bestand:

- **`einsatz_person`** (0020 + 0022 + 0029 + 0098) ist eine Nicht-Leaf-Tabelle, auf die
  Sichtung, Verbleib, Notizen, Abgleich, UHS-Belegung, Audit und Schaden-Geschädigt
  verweisen. Neue Spalten kommen deshalb per `ALTER TABLE ADD COLUMN`, ein Rebuild wird
  gebraucht.
- **`person_verbleib`** (0025) hat den CHECK `art IN (4 Werte)`. Auf die Tabelle verweist
  nichts, sie ist also Leaf. Ein CHECK-Rebuild braucht kein FK-Toggle (Präzedenz 0033), sehr
  wohl aber den Nachtrag in `sqlite_sequence`, weil die Tabelle `AUTOINCREMENT` trägt.
- **`aktueller_verbleib`** ist eine Freitext-Kurzform aus `VerbleibArt::kurzform`. Das
  Frontend (`personenBilanz.ts:verbleibArtAus`) gewinnt die Art daraus zurück.
- **Anlage** (`routes/einsatz_person.rs:anlegen`) läuft in einem `write_retry!`-Block mit
  Replay-Lookup über `client_id`, Erst-Sichtung und UHS-Eintritt unter `war_neu`. Der PATCH
  ist Tri-State mit nummerierten Flag/Wert-Paaren (`repo::aktualisiere`) und hat einen Test,
  der die Spaltenzuordnung pinnt.
- **Karte**: `pages/lagekarte/Kartenflaeche.tsx` ist die einzige Stelle, die eine MapLibre-Map
  erzeugt. Alle Props außer `style` sind optional. `useBasemap` liefert den Stil. Im Frontend
  gibt es keine zweite Karte, und `MarkerTyp` kennt keine Person. Tests mocken
  `Kartenflaeche` als Modul (`LagekartePage.test.tsx`).

## Goals / Non-Goals

**Goals:**
- Datenquelle und Frontend-Elemente liefern, wie in der Spec festgelegt, einschließlich der
  Kartenansicht.
- Eine Karte, keine zweite: die Betroffenen-Karte nutzt `Kartenflaeche`.
- Die Offline-Anlage bleibt exactly-once: neue Felder im selben POST, kein Nachschub-Request.

**Non-Goals:**
- **Kein Personen-Layer auf der Lagekarte**, die Personen stehen dort also nicht als
  Fachobjekt. Die Lagekarte bekommt nur den Platzier-Auftrag `person`, damit man eine
  Koordinate per Kartenklick setzen kann. Der Layer ist eine eigene Führungsentscheidung
  (Datenschutz, Dichte) und wird als Folgetask erfasst.
- Keine Aufgliederung des Verbleibs nach einzelnen Kliniken in der Zählung. Das Ziel wird
  gespeichert und angezeigt, aber nicht gezählt.
- Kein serverseitiger Zähler-Endpunkt. Die Zählungen rechnet der Client aus der
  Personenliste, wie bisher (serverseitige Zähler liegen bei LFH-612).
- Keine Historie des Zustands. Der Zustand ist ein aktueller Wert, der Verlauf läuft über
  Verlaufsnotizen.

## Decisions

### D1 Spalten an `einsatz_person` statt einer Nebentabelle
`zustand TEXT`, `antreff_lat REAL`, `antreff_lon REAL`, `vermisst_seit TEXT`,
`aktuelle_verbleib_art TEXT`, `aktuelles_verbleib_ziel TEXT`, `aktueller_verbleib_status TEXT`.
Alle Spalten sind nullable. Die Paarregel für lat/lon prüft der Handler (422), nicht ein
DB-CHECK: ein CHECK auf der Nicht-Leaf-Tabelle hieße Rebuild, und der Handler muss sie für
den PATCH gegen den effektiven Zustand ohnehin selbst prüfen (Memory
`patch-xor-effektivzustand`). Dasselbe Muster wie bei `uhs.lat/lon`.
*Alternative*: den Zustand als Notiz an der Sichtung. Das hat der Nutzer am 22.09. verworfen.

### D2 Verbleib-Cache als drei Spalten neben der Kurzform
Die Art, das Ziel und der Status gehen als eigene Felder heraus. `aktueller_verbleib` bleibt
bestehen, weil Detail, Export und der ETB-Wortlaut daran hängen. Den Status braucht es, weil
„Transportiert“ sonst eine Voranmeldung (`angemeldet`) als erledigten Transport zählen würde.
`verbleib_repo::erfassen` schreibt alle vier Cache-Spalten in derselben Transaktion.
Der Backfill in der Migration nimmt das jüngste Ereignis je Person
(`ORDER BY zeitpunkt_at DESC, id DESC`, dieselbe Ordnung wie `liste_je_person`).
*Alternative*: die Art im Client weiter aus der Kurzform lesen. Das ginge bei einem Ziel mit
„→“ schief und bliebe eine Parser-Kopplung an einen Anzeigetext.

### D3 `notunterkunft` per Leaf-Rebuild von `person_verbleib`
Die neue Migration ist `-- no-transaction`. Sie legt die Tabelle neu an und übernimmt das
vollständige Schema aus 0025 samt neuem CHECK. Dann kopiert sie mit expliziter Spaltenliste,
löscht die alte Tabelle, benennt die neue um, setzt `sqlite_sequence` um und legt den Index
neu an. Weil die Tabelle Leaf ist, entfällt der FK-Toggle. Das `PRAGMA foreign_key_check`
kommt trotzdem ins Verifikationsprotokoll.
Kurzform „Notunterkunft → Ziel“ bzw. „Notunterkunft“, ETB-Sachverhalt „in Notunterkunft →
Ziel“. `notunterkunft` löst wie `transport`/`entlassung` den UHS-Auto-Austritt aus.
`tests/enum_wire_kontrakt.rs` bricht durch den exhaustiven `match` von selbst und bekommt
den Nachtrag.

### D4 „vermisst seit“: Angabe, sonst Serverzeit, gesetzt beim Übergang
- **POST**: `vermisst_seit` ist nur mit `status: vermisst` erlaubt, sonst 422. Das Format ist
  `YYYY-MM-DD HH:MM:SS` in UTC ohne Zone wie alle Zeitstempel. Unparsebar ergibt 400, mehr
  als 5 min in der Zukunft ebenfalls 400. Fehlt die Angabe, setzt der INSERT
  `strftime('now')`. Der Wert geht in `NeueDaten` und ist damit Teil der
  Replay-idempotenten Anlage.
- **Statuswechsel** nach `vermisst` setzt `vermisst_seit = now` im selben UPDATE. Beim
  Verlassen bleibt der Wert stehen, er ist dokumentarisch und nur bei Status `vermisst`
  bedeutsam. Das Frontend zeigt ihn auch nur dann.
- **PATCH**: einen Wert setzen geht nur bei `status == vermisst` (sonst 422). `null` ergibt
  400, denn Leeren nähme der Dashboard-Zählung die Grundlage.
- Die 5-Minuten-Toleranz fängt eine vorgehende Geräteuhr ab. Ohne sie verwürfe die
  Offline-Queue eine Erfassung mit 400.

### D5 Validierungscodes nach LFH-267
| Fall | Code |
|---|---|
| lat ohne lon (POST und effektiver Zustand im PATCH), Wertebereich | 422, wie `einsatz_uhs.rs` |
| `vermisst_seit` unparsebar, in der Zukunft, `null` im PATCH | 400, das Feld isoliert |
| `vermisst_seit` bei Status ≠ vermisst | 422, der Zusammenhang |
| unbekannte Verbleib-Art | 400, wie bisher |

### D6 Parser der Schnellerfassung: `#lat/lon`
`personBefehl.ts` ersetzt die heutige Pauschalablehnung des `#…`-Worts durch einen Teil
`{ art: 'koordinate', lat, lon }`. Gültig sind `#52.2691/9.1342`, `#52,2691/9,1342` und
negative Werte. Das `/` trennt, ein Komma gilt als deutsches Dezimalzeichen. Ein zweites `#`,
ein fehlender Teil oder ein Wert außerhalb des Bereichs ergibt ein Problem, dann wird nicht
gesendet. Die Werte gehen als `antreff_lat/lon` in `eingabe`. Das `@`-Kürzel endet schon
heute am nächsten `#`.
Maske und Detail nutzen **dieselbe** Parse-Funktion in einem einzigen Textfeld
„Koordinate“ (`52.2691/9.1342`), statt zwei Zahlenfelder anzulegen. So gibt es eine
Schreibweise und einen Prüfweg, und das Feldbudget der Maske wächst nur um ein Feld unter
„Weitere Angaben“.

### D7 Kartenansicht über `Kartenflaeche`, neuer `MarkerTyp` `person`
- `pages/personen/BetroffeneKarte.tsx` rendert `Kartenflaeche` mit `style` aus
  `useBasemap`, `markers` und `onMarkerKlick`, Navigation zu `personenPfad` (Detail). Es
  gibt keine Zeichen-, Zonen- oder Fachebenen-Props.
- Eine reine Funktion `personenMarker(personen)` in `personen/personenKarte.ts` erzeugt
  `KarteMarker[]` mit `typ: 'person'`, `schluessel: 'person-<id>'`. Die Beschriftung lautet
  `R-042 · SK II`, das ist der zweite Kanal. Die Farbe kommt aus der Sichtungsachse
  (`tokens.ts`, `sichtungsfarben`), ungesichtet ist neutral. Dazu kommt die Zahl der Personen
  ohne Koordinate.
- Die Startansicht bekommt der Rahmen der Marker über `startAnsicht`. Ohne Marker zeigt die
  Karte den Einsatzort, und ohne Einsatzort gilt der Leerzustand „Keine Person mit
  Koordinate“.
- Der Test mockt `Kartenflaeche` nach dem Muster von `LagekartePage.test.tsx`. Die
  Marker-Logik wird als reine Funktion getestet. Die echte Karte prüft ein e2e-Smoke
  (`e2e/betroffene-karte.spec.ts`: Ansicht umschalten, Marker vorhanden über
  `window.__lfhKarte`).
- Die Segmentleiste bekommt „Karte“. Die Ansicht lädt die Karte nur, wenn sie gewählt ist
  (`React.lazy`), damit MapLibre nicht in das Bundle der Liste wandert.

### D8 Verorten per Lagekarte: Platzier-Auftrag `person`
Die Detailseite bekommt neben dem Koordinatenfeld die Aktion „Auf Lagekarte verorten“, als
Link über `lagekartePfad(id, { platzieren: { typ: 'person', id } })`. Dafür kommt `person`
in `PlatzierenZielTyp`/`PlatzierenPunktTyp`, der Zweig in `useKartenInteraktion` ruft
`aktualisierePerson` mit `antreff_lat/lon`. Der Parser verwirft Unbekanntes ganz, so bleibt
die Regel aus LFH-340. Personen als Layer auf der Lagekarte bleiben ein Non-Goal.

### D9 Anzeige
- **Spalte „Zustand“** in `personenSpalten.tsx` über `BemerkungZelle` (LFH-369: leeres Feld
  mit Aufforderung, Zeilenkennung im zugänglichen Namen). Speichern läuft per PATCH mit
  Wertgleichheits-Riegel.
- **Fundort-Spalte**: der Freitext bleibt, darunter steht die Koordinate in Mono. Die
  Fundort-Lücke gilt erst als geschlossen, wenn Freitext ODER Koordinate da ist.
- **Verbleib-Zählung** (`personenBilanz.ts`) liest `aktuelle_verbleib_art` statt der
  Kurzform. `verbleibArtAus` entfällt, `notunterkunft` wird ein eigener Posten.
- **Dashboard**: „Transportiert / offen“ im Fuß des Sichtungspaneels.
  `transportiert = art transport ∧ status ≠ angemeldet`, `offen` ist dieselbe Lücke wie auf
  der Betroffenen-Seite. Die Notiz der Kennzahl „Vermisste“ zeigt „n seit über 4 h“; die
  Schwelle `VERMISST_LANG_MS` wird als Konstante mit Quelle „Neuentwurf S3“ festgehalten. Die
  Zeit kommt aus dem vorhandenen Uhr-Takt der Seite. Ohne einen Takt fehlt die Notiz,
  statt stehenzubleiben.

## Risks / Trade-offs

- [Der Rebuild von `person_verbleib` verliert Zeilen oder die Sequenz] → Test mit einer
  echten Alt-Schema-DB über `include_str!` der Migration (Memory
  `sqlx-sqlite-no-transaction-check-rebuild`): Zeilen und `sqlite_sequence` bleiben
  erhalten, `foreign_key_check` ist leer, das Schema ist per `pragma_table_info` identisch.
- [Der Backfill wählt ein falsches „jüngstes“ Ereignis bei gleichem `zeitpunkt_at`] →
  Tiebreak über `id DESC`, getestet mit zwei Ereignissen in derselben Sekunde.
- [Die PATCH-Bindekette verschiebt sich um eine Position] → Der Pin-Test
  `aktualisiere_setzt_jede_spalte_an_ihren_platz` wird um die neuen Spalten erweitert.
- [Neue PII-Spalten ohne Schwärzungsregel] → Der Vollständigkeitsguard der
  Schwärzungs-Registry wird dann rot. Die Regel D1/Spec wird eingetragen.
- [MapLibre ist in jsdom nicht lauffähig] → Modul-Mock plus e2e-Smoke. Ein Karten-Test ohne
  e2e belegt nichts (Memory `layout-regression-nur-e2e`).
- [Eine Offline-Erfassung mit altem App-Stand kennt die neuen Felder nicht] → Alle Felder
  sind optional, ältere Clients bleiben unverändert gültig.

## Migration Plan

Zwei Migrationen mit den nächsten freien Nummern, beim Merge gegen `alpha` erneut geprüft
(Memory `migrations-nummernkollision-merge`):
1. `…_person_lagedaten.sql`: `ADD COLUMN` für die sieben Spalten, Backfill der drei
   Verbleib-Cache-Spalten aus dem jüngsten `person_verbleib`, dazu `vermisst_seit` für
   vorhandene Vermisste aus `geaendert_at` (beste verfügbare Näherung, im Kommentar benannt).
2. `…_person_verbleib_notunterkunft.sql` (`-- no-transaction`): Leaf-Rebuild mit neuem CHECK.

Ein Rollback ist nicht vorgesehen, sqlx-Migrationen laufen vorwärts. Die Spalten sind additiv,
ein alter Client ignoriert sie.
