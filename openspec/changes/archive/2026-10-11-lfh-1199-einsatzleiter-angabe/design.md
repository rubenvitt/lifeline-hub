# Design

## Context

Den Anlass beschreibt `proposal.md`, die Anforderungen stehen in den Deltas unter `specs/`. Die
Wahl zwischen A, B und C traf der Mensch am Scope-Checkpoint (11.10.2026), ebenso die Haltung der
Person, den ETB-Wortlaut und den Einsatzbericht. Stand im Code am 11.10.2026:

- **Führungsstelle** (LFH-849, LFH-1106):
  - Code: `src/einsatz/fuehrungsstelle.rs` und `src/routes/einsatz_fuehrungsstelle.rs`.
  - Eine Zeile je Einsatz, lazy angelegt (Migration 0145), die Fahrzeuge in Migration 0171.
  - `GET` mit `EinsatzLesezugriff` ohne Modul. `PATCH` mit `EinsatzVerwaltungszugriff` als
    Tri-State-Teil-Patch: Prüfungen vor dem Schreiben, ein `write_retry!`, danach
    `kopf_geaendert` mit dem Ereignis `einsatz`.
  - Heute kein Aktiv-Check in der Transaktion und kein ETB.
- **Muster „Person oder Freitext mit ETB“** ist die Stab-Besetzung (`src/stab/repo.rs::setzen`).
  In einem `BEGIN IMMEDIATE`:
  1. `fordere_aktiv_in_tx`, dann `vorher_stand` (Rohstand, nicht der Text).
  2. `snap_name_von` (422, wenn die Person nicht in diesem Einsatz ist).
  3. Upsert, dann Vergleich des Fachstands. Bei Gleichheit gibt es kein ETB.
  4. `etb::system_audit_tx`. Nach dem Commit `state.live.publiziere(einsatz_id, etb_id)`.

  Die Person hängt per `personal_id REFERENCES einsatz_personal(id) ON DELETE SET NULL` mit
  eingefrorenem `snap_name`. Die Anzeige trägt `personal_noch_disponiert`.
- **ETB mit eigener Zeit:** `etb::repo::anlegen_tx` mit `EintragDaten { typ, ereigniszeit, … }`.
  `system_audit_tx` setzt die Zeit immer auf jetzt.
- **Leitung heute im Frontend**, an drei Stellen gerechnet:
  - Kopfleiste: Mitglieder mit `einsatz_rolle === 'einsatzleitung'` (`EinsatzdatenPage.tsx:642`).
  - Organigramm und Lagebericht: fest „Leitung nicht erfasst“ (`fuehrungsorganisation.ts:259`,
    `Organigramm.tsx:107`).
  - Einsatzbericht: Rollenmitglieder (`druck/einsatzbericht/verdichtung.ts:197`).

  Dazu kommt der Funkplan: die Zeile `fs` mit `leitung: { art: 'leer' }` (`stab/funkplan.ts:127`).

## Goals / Non-Goals

**Goals:**
- Ein Datum, eine Darstellung. Jede der fünf Anzeigestellen liest den Einsatzleiter aus
  `GET …/fuehrungsstelle` und formt ihn über dieselbe Funktion.
- Die Übergabe ist im ETB nachweisbar, atomar mit der Änderung.

**Non-Goals:**
- Keine Ableitung aus App-Rolle oder Stab. Die Stab-Besetzungsart `einsatzleitung` („Aufgabe
  bleibt bei der Einsatzleitung“) und die Funktion `EL` im Erfasser-Snapshot des ETB bleiben, wie
  sie sind.
- Kein Name in der Fernmeldeskizze (Regel „keine Personennamen“, `frontend/src/stab/AGENTS.md`).
  Kein Einsatzleiter im Kommunikationsplan, in der Vorbereitung der Lagebesprechung, in der
  Einsatzliste und in der Akte der Aufbewahrung. Das bleiben mögliche Nachzüge.
- Keine Historie der Einsatzleiter als eigene Tabelle. Das ETB ist die Historie.
- Kein „Ad-hoc-Person anlegen“ aus der Zeile heraus. Ein externer Einsatzleiter ist Freitext.
- Kein Offline-Lesen: der Key bleibt außerhalb von `LAGEBILD_OFFLINE`, wie bisher.

## Decisions

### D1 · Datenhaltung: vier Spalten an `einsatz_fuehrungsstelle` (Migration 0176)

```sql
ALTER TABLE einsatz_fuehrungsstelle ADD COLUMN einsatzleiter_art TEXT
    CHECK (einsatzleiter_art IN ('personal', 'extern'));
ALTER TABLE einsatz_fuehrungsstelle ADD COLUMN einsatzleiter_personal_id INTEGER
    REFERENCES einsatz_personal(id) ON DELETE SET NULL;
ALTER TABLE einsatz_fuehrungsstelle ADD COLUMN einsatzleiter_name TEXT;
ALTER TABLE einsatz_fuehrungsstelle ADD COLUMN einsatzleiter_seit TEXT;
```

- Die Art ist nötig, weil `personal_id` nach dem Entlassen `NULL` wird. Der Datensatz bleibt
  dann eine Person („nicht mehr disponiert“) und wird kein externer Einsatzleiter.
- `einsatzleiter_name` ist bei `personal` der eingefrorene `einsatz_personal.snap_name`, bei
  `extern` der Freitext. Eine Spalte, eine Schwärzungsregel.
- `einsatzleiter_seit` ist UTC-Text `YYYY-MM-DD HH:MM:SS` wie `status_seit`, normalisiert über
  `etb::normalisiere_zeit` in der Route.
- Die Konsistenz hält der Code: alle vier sind leer, oder Art, Name und Seit sind gesetzt. Die
  Spalten heißen nach der Aufgabe (`einsatzleiter_…`) statt `leiter_…`, weil die Tabelle sonst
  Leiter der Führungsstelle und Einsatzleiter verwechselbar macht.

Verworfen:
- **Zwei Spalten `leiter_personal_id` und `leiter_text` ohne Art** (Vorschlag im Ticket): Nach
  `ON DELETE SET NULL` wäre eine entlassene Person nicht mehr vom externen Einsatzleiter zu
  unterscheiden.
- **FK ohne `ON DELETE`** wie bei `leiter_id`/`fuehrer_id` am Abschnitt: Dann müsste
  `disposition_repo::entferne_tx` vor dem Löschen leeren. Das wäre ein stiller Wechsel der
  Leitung ohne ETB und gegen die gewählte Haltung.
- **Eigene Tabelle mit Historie:** Das ETB trägt die Übergaben schon, eine zweite Historie
  bräuchte eigene Schwärzung und Anzeige.

### D2 · API: Feld `einsatzleiter` im bestehenden PATCH

- Request (`FuehrungsstellePatchBody`), Tri-State über `deserialize_optional_field`:
  `einsatzleiter: null` leert. Gesetzt wird mit
  `{ "art": "personal", "personal_id": 17, "seit"?: "…" }` oder
  `{ "art": "extern", "name": "KBM Weber", "seit"?: "…" }`.
- Das Feld fehlt: der Einsatzleiter bleibt unverändert.
- Prüfungen vor dem Schreiben:
  - 400: unbekannte `art` (`wire_enum!` `EinsatzleiterArt`, Pin in `tests/enum_wire_kontrakt.rs`),
    leerer oder zu langer Name (`EINSATZLEITER_NAME_MAX = 200`, gespiegelt in
    `api/eingabegrenzen.ts`) und ein unlesbares `seit`.
  - 422: `personal_id` bei `extern` oder `name` bei `personal`, und ein `seit` mehr als
    `UHRENTOLERANZ_MINUTEN` in der Zukunft (wie die Zeitachse).
  - 422 in der Transaktion: eine Person, die nicht in diesem Einsatz disponiert ist.
- Response: `FuehrungsstelleAnzeige.einsatzleiter?: EinsatzleiterAnzeige`. Die Anzeige trägt
  `{ art, name, personal_id?, personal_noch_disponiert, seit }`, über den Codegen (beide
  generierten Dateien).

Verworfen: ein eigener Endpunkt `PUT/DELETE …/fuehrungsstelle/einsatzleiter`. Die Spec
verlangt, dass jede Angabe einzeln über den Teil-Patch änderbar ist. Das Paneel hat das Muster
„eine Zeile, ein Feld“ (`feldMutation`) schon, und ein zweiter Weg verdoppelte Rechte, Aktiv-Check
und Ereignis.

### D3 · ETB in derselben Transaktion, Fachstand statt Text

Ist `einsatzleiter` im Patch, läuft im `write_retry!` des PATCH in dieser Reihenfolge:

1. Aktiv-Check in der Transaktion (409). Genutzt wird `stab::repo::fordere_aktiv_in_tx`, dessen
   Sichtbarkeit dafür auf `pub(crate)` erweitert ist (Umsetzung: kein Umzug, der ~30 Aufrufer im
   Stab anfasste).
2. Vorher-Stand lesen: `(art, personal_id, name)`.
3. Bei `personal` den `snap_name` holen (422, wenn fremd).
4. Schreiben.
5. Vergleich des Fachstands: gleiche Art, gleiche `personal_id` bzw. gleicher Name. Bei Gleichheit
   gibt es kein ETB, auch wenn „seit“ abweicht.
6. Sonst `etb::repo::anlegen_tx` mit Typ `system`, `ereigniszeit = seit` (beim Leeren jetzt) und
   `von`/`an` „System“ wie bei `system_audit_tx`. Der Text steht in der Spec. Die Namensform ist
   die der Anzeige: Person mit Namen, extern als „Name (extern)“.

Nach dem Commit kommen `kopf_geaendert` und bei einem Eintrag `state.live.publiziere(einsatz_id,
etb_id)`. Nur `seit` zu ändern ist kein Führungsvorgang, sondern eine Berichtigung der Angabe.
Die Spec schließt dafür einen Eintrag aus.

Verworfen: der Vergleich über den gerenderten Text. Eine Umbenennung im Personal hätte sonst
eine falsche Übergabe erzeugt (Lehre aus der Stab-Besetzung).

### D4 · Schwärzung und Aufbewahrung

- Register `einsatz_fuehrungsstelle`:
  - `einsatzleiter_name` → `scrub(NullSetzen, Z_EINSATZ)`.
  - `einsatzleiter_personal_id` → `retain(G_FK)`.
  - `einsatzleiter_art` → `retain` (Struktur).
  - `einsatzleiter_seit` → `retain(G_ZEIT)`.
- `PERSONENBEZUEGE`: Bezug `ExterneKraft` über `einsatzleiter_personal_id`, mit
  `einsatzleiter_name` als `Mit` und `erreichbarkeit` als `Ohne`. Vorbild ist
  `einsatz_stabsfunktion`.
- `AUSNAHMEN_SYSTEM_ETB` (`tests/aufbewahrung_e2e.rs`): Der Übergabe-Text nennt Einsatzkräfte,
  also `Gruppe::Einsatzkraft`, wie die Stab-Besetzung.

### D5 · Eine Darstellung im Frontend: `stab/einsatzleiter.ts`

```ts
type EinsatzleiterDarstellung =
  | { art: 'erfasst'; name: string; seit: string; hinweis?: 'nicht mehr disponiert' }
  | { art: 'nicht-erfasst' }
  | { art: 'zustand'; grund: string };            // gesperrt · nicht geladen · lädt

function einsatzleiterDarstellung(
  quelle: { zustand: AbrufZustand; daten: Fuehrungsstelle | null },
): EinsatzleiterDarstellung;

function einsatzleiterName(e: Einsatzleiter): string;  // „Anna Schulz“ | „KBM Weber (extern)“
function einsatzleiterKurz(d): string;                  // Name und Vermerk (Kopfleiste, Funkplan)
function einsatzleiterText(d, konv): string;            // dazu „seit“ als kurze DTG
function einsatzleiterMarkdown(d, dtg): string;         // Lagebericht: dtg ist der Formatierer
                                                        // des Dokuments (volle DTG)
```

Die Datei liegt neben `stab/fuehrungsstelle.ts`, denn der Stab-Bereich besitzt die Führungsstelle
als Quelle (`frontend/src/stab/AGENTS.md`). `fuehrungsstelleErfasst` zählt den Einsatzleiter mit.
Abnehmer:

| Stelle | Datei | Form |
|---|---|---|
| Kopfleiste | `pages/EinsatzdatenPage.tsx` | Name, sonst gedämpft „nicht erfasst“; der Abruf der Mitglieder für die Kopfleiste entfällt |
| Organigramm-Wurzel | `Organigramm.tsx` (neue Prop `fuehrungsstelle`) | Name, Zeile „seit DTG“, sonst „Leitung nicht erfasst“ |
| Lagebericht Organigramm | `fuehrungsorganisation.ts:rendereFuehrungsorganisationMarkdown` (Option `einsatzleiter`) | `- Einsatzleiter: Name (seit DTG)` bzw. `- Leitung nicht erfasst` |
| Lagebericht „Aus Meldebild …“ | `lageberichte/eigeneLageUebernahme.ts` | wie oben, Quelle über `ladeListe(qc, einsatzKeys.fuehrungsstelle(id), …)` |
| Funkplan `fs` | `stab/funkplan.ts:fuehrungsstelleZeile` | `leitung: { art: 'name', namen: [Name] }` oder `leer`; Markdown-Etikett „Einsatzleiter“ statt „Führer“ |
| Einsatzbericht | `druck/einsatzbericht/` (Quelle `fuehrungsstelle` ersetzt `mitglieder`, `modul: null`) | Abschnitt „Einsatzleitung“: „Einsatzleiter“ und „Seit“ in der Zeitform des Berichts (`TT.MM.JJJJ HH:mm`), sonst „nicht erfasst“; die Rollenmitglieder entfallen |

Die Kopfleiste zeigt kein „seit“: sie bleibt eine Zeile. Das „seit“ steht im Paneel, im
Organigramm, im Lagebericht und im Bericht.

### D6 · Bedienung: Zeile „Einsatzleiter“ im Paneel

Die sechste `InlineAngabe` steht im Paneel „Eigene Führungsstelle“ als erste Zeile, denn sie ist
die Führungsangabe. Der Editor hat zwei Felder:

1. Eine Auswahl mit Suche. Ihre Optionen sind das disponierte Personal („Name · Funktion“, über
   `listeEinsatzPersonal`, nur mit Freigabe Personal). Ein eingetippter Text, der keiner Person
   entspricht, erscheint als Option „„…“ als externen Einsatzleiter übernehmen“. Das Muster ist
   `fuehrung/EinWertAuswahl.tsx`. Ohne Freigabe Personal bietet die Zeile nur den Freitext an und
   zeigt `RechteHinweis` „Personal nicht freigegeben“.
2. `ZeitpunktEingabe` „seit“, leer heißt jetzt (Platzhalter „jetzt“, `keineZukunftstage`).

Gespeichert wird nur `einsatzleiter`. Der Gleichheitsschutz greift bei unveränderter Wahl und
unverändertem „seit“. Eine neue Wahl setzt „seit“ auf jetzt zurück, außer es wurde eigens eine
Zeit gesetzt. „Einsatzleiter leeren“ im Editor, dann „Speichern“, sendet `null`. Die Zeile liegt
in `pages/EinsatzleiterAngabe.tsx`. Die Leseansicht zeigt den
Namen und „seit DTG“ in Mono, bei einer entlassenen Person „· nicht mehr disponiert“.

Verworfen: ein Erfassungsmodal „Einsatzleiter wechseln“. Es wäre ein zweites Bedienmuster im
Paneel, und zwei Felder passen in die Zeile.

### D7 · Live

- Der PATCH meldet `einsatz` (Kopfleiste, Organigramm, Funkplan, Bericht laden den Key
  `fuehrungsstelle` neu) und bei einem Eintrag das ETB-Ereignis.
- Wird eine Person entlassen, die Einsatzleiter ist, ändert sich nur `personal_noch_disponiert`.
  Das Ereignis des Personals invalidiert `einsatzKeys.fuehrungsstelle` dafür nicht, der Vermerk
  erscheint beim nächsten `einsatz`-Ereignis oder Neuabruf. Das ist dieselbe Trägheit wie bei der
  Stab-Besetzung und wird hingenommen.

### D8 · Herleitungen und Regeln

- LFH-626 D5 („Leitung nicht erfasst“, Kommentar auf LFH-849) und LFH-849 Non-Goals („Kein
  Leiter/Führer in der Zeile der Führungsstelle“, „Kein ETB-Eintrag“, „Keine Übernahme in
  Organigramm, Einsatzbericht“) bekommen im archivierten `design.md` je eine Zeile
  „Aufgehoben durch LFH-1199 (`openspec/changes/archive/<datum>-lfh-1199-einsatzleiter-angabe/`)“.
- Die Code-Kommentare an diesen Stellen bekommen den neuen Verweis
  (`Organigramm.tsx:51,105`, `funkplan.ts:127`, `fuehrungsorganisation.ts:20,259`).
- `frontend/src/stab/AGENTS.md`, Absatz zur sechsten Quelle: Der Einsatzleiter gehört zur
  Führungsstelle, wird in `stab/einsatzleiter.ts` dargestellt, und in der Skizze steht kein Name.

## Risks / Trade-offs

- [Migrationsnummer 0176 vergibt ein paralleler Thread auch] → vor dem Push `git fetch` und
  `scripts/check-migrationen.sh`. Ein reiner Konflikt wird per Autofix auf dem PR-Branch umgelegt.
- [Die Demo zeigt in der Kopfleiste jetzt „nicht erfasst“ statt „Administrator“] → gewollt. Die
  Demo-Daten setzen keinen Einsatzleiter, ein Nachzug ist möglich.
- [Ein System-Admin ohne Mitgliedschaft schreibt per `EinsatzVerwaltungszugriff` einen
  Übergabe-Eintrag] → wie bei jeder anderen Admin-Schreibung am Einsatz (LFH-1066). Der Erfasser
  steht im Eintrag.
- [Organigramm, Lagebericht und Bericht hängen an einer weiteren Quelle] → Die Führungsstelle
  braucht kein Modul. Lädt sie, sind die Übernahmen gesperrt. Scheitert sie, nennt die Anzeige den
  Grund statt „nicht erfasst“.
- [Ein Name im ETB-Text überlebt die Schwärzung der Spalte] → wie bei der Stab-Besetzung (G_ETB),
  in `AUSNAHMEN_SYSTEM_ETB` festgehalten.

## Migration Plan

- Migration 0176 ist nur additiv. Bestehende Zeilen haben keinen Einsatzleiter, und Einsätze ohne
  Zeile bleiben „nicht erfasst“.
- Rollback: Commit zurücknehmen. Die Spalten bleiben ungenutzt stehen, Migrationen werden nie
  gelöscht.
