# Design

## Context

Motivation und Umfang: proposal.md. Anforderungen: `specs/ereignis-abruf/spec.md`.

Was im Code steht und den Weg bestimmt (Stand `origin/alpha` vom 12.11.2026, `3d74eba3`):

- **Gerüst der API v1** ist da (LLH-1652, LLH-1653): `src/public_api/` mit dem Extractor
  `MachineClient`, `ScopeAnforderung` je Route, `ApiError` mit `ErrorCode::CursorExpired` (410),
  den Scopes `events:read` und `einsaetze:read`, Drosselung und Abrufprotokoll im Extractor,
  Antwortsignatur über `client.antwort(..)`. Regeln: `src/AGENTS.md`, „Backend — Öffentliche API
  v1“.
- **Die Einsatzfreigabe für Maschinenzugänge fehlt.** Sie entsteht in LLH-1638 und liegt noch
  nicht auf `alpha`.
- **`einsatz` wird auf mehreren Wegen geschrieben, die sich nicht treffen:**
  - `einsatz::repo::anlegen_tx`, `patche_kopf` (ein UPDATE direkt auf dem Pool, ohne
    Transaktion) und `abschliessen`;
  - die Spiegel-Übernahme `instanz::spiegel::uebernehmen::kopf_uebernehmen` mit generischem
    INSERT und UPDATE;
  - die Verwahrung in `instanz::spiegel::lebensende`;
  - hartes Löschen in `demo::entfernen`, `einsatz::skelett_loeschung` und `einsatz::abraeumen`.

  Am Hub sind gespiegelte Einsätze der Hauptfall für Fremdsysteme, weil ein gekoppelter ELW keine
  Fremdsysteme annimmt (`public_api::zugang::hub_fuer_org`).
- **Die Lage hat keine zentrale Schreibstelle.** `routes::lagemonitor::verdichte` und
  `routes::lagemonitor_v1` lesen aus elf Tabellen, die zusammen über 100 Schreibstellen in rund 25
  Modulen haben.
- **Ein Änderungslog gibt es schon:** `einsatz_aenderung` (Migration 0314). Die Trigger
  `<tabelle>_spiegellog_i/_u/_d` jeder gespiegelten Einsatztabelle schreiben bei jeder Änderung
  eine Zeile hinein, in der Transaktion der Änderung, auch während einer Spiegel-Übernahme (die
  Log-Trigger tragen keine Bedingung auf `spiegel_uebernahme`). Alle elf Lage-Tabellen stehen in
  `instanz::spiegel::art::GESPIEGELT`.
- **Der Abschluss löscht Freigaben in seiner Transaktion** (`einsatz::repo::abschliessen` ruft
  `lagemonitor_zugang::freigaben_loeschen_tx`). LLH-1638 folgt diesem Muster.
- **SQLite-Betrieb:** ein Pool mit fünf Verbindungen, WAL, ein Schreiber zur Zeit (`src/db.rs`).
  Der Schreiber hält die Sperre vom ersten Schreiben bis zum Commit. Nummern aus `AUTOINCREMENT`
  werden deshalb in Commit-Reihenfolge sichtbar.
- **`write_retry!` verbietet Seiteneffekte im Body** (`src/tx.rs`, Reinheits-Kontrakt). Einen
  Haken „nach dem Commit“ gibt es nicht.
- **Zulassung:** `REQUEST_BUDGET` 60 s, `MAX_GLEICHZEITIGE_REQUESTS` 256 (`src/zulassung.rs`).
  Ein Abruf, der 25 s wartet, liegt darunter und hält so lange einen Platz.

Der Entwurf der Trigger ist am 12.11.2026 in einer Wegwerf-SQLite (3.53) durchgespielt: Trigger
in Triggern feuern ohne `recursive_triggers`, die Verdichtung, der Abschluss ohne doppeltes
`einsatz.closed`, das harte Löschen und das Löschen eines Zugangs verhalten sich wie unten
beschrieben.

## Goals / Non-Goals

**Goals:**

- Kein Schreibweg kann ein Ereignis vergessen, auch ein künftiger nicht.
- Ein Zugang liest nur eigene Zeilen. Der Abruf braucht keine Sichtbarkeitsprüfung gegen den
  Einsatz.
- Derselbe Bestand trägt später die Webhooks (LLH-1656): je Abo ein Cursor über die Zeilen seines
  Zugangs.
- Ein wartender Abruf hält keine Datenbankverbindung.

**Non-Goals:**

- Die Freigabe selbst und `GET /api/v1/lage` (LLH-1638).
- `alarmmeldung.*` (LLH-1192) und Webhooks (LLH-1656).
- Ein Wecken wartender Abrufe im Augenblick des Commits (D9).
- Ein Schutz davor, dass ein Client nach dem Zurückspielen einer Sicherung einen Cursor behält,
  der wieder gültig aussieht (Risiken).

## Decisions

### D1: Die Freigabe aus LLH-1638 ist Voraussetzung

Diese Change legt keine Freigabe-Tabelle an. Sie braucht von LLH-1638:

- eine Tabelle mit je einer Zeile je (Zugang, Einsatz), Zugang als `TEXT` gegen
  `maschinenzugang(id)`, Einsatz gegen `einsatz(id)` mit `ON DELETE CASCADE`;
- dass die Freigabe als gelöschte Zeile endet, beim Abschluss wie beim Zurücknehmen;
- dass sie mit `INSERT` beginnt und mit `DELETE` endet, nicht mit `INSERT OR REPLACE` oder einem
  UPDATE von `einsatz_id`. `REPLACE` löscht ohne DELETE-Trigger (geprüft); das ergäbe ein zweites
  `einsatz.created` und kein `einsatz.closed`.

Im Folgenden heißt sie `maschinenzugang_freigabe` mit `zugang_id` und `einsatz_id`
(Arbeitsname). Der Bedarf steht seit 12.11.2026 als Kommentar an LLH-1638. Aufgabe 1 prüft die
drei Punkte am gemergten Stand; weicht er ab, läuft vor dem Bauen `/opsx:update`.

Alternativen: die Tabelle hier bauen (LLH-1638 läuft schon, doppelter Bau) oder ohne Freigabe
beginnen (verstößt gegen ADR-0022).

### D2: Die Outbox wird per Trigger geschrieben

Alle Zeilen in `maschine_ereignis` entstehen in Triggern. Kein Rust-Schreibweg schreibt hinein;
Rust liest und löscht nur (Abruf, Purge).

Begründung:

- „Dieselbe Transaktion“ (ADR-0022) gilt so von selbst, auf jedem Weg aus dem Context.
- `patche_kopf` und `abschliessen` bleiben, wie sie sind. In Rust bräuchte `patche_kopf` zuerst
  eine Transaktion.
- `lage.changed` ist nur so vollständig zu haben (D6).

Alternativen:

- **In den `_tx`-Funktionen der Repos** (Wortlaut des Konzepts): greifbar im Code. Aber
  Spiegel-Übernahme und Verwahrung brauchen eigene Stellen, jeder neue Schreibweg kann das
  Ereignis vergessen, und die Lage hätte über 100 Stellen.
- **Gemischt** (`einsatz.*` in Rust, `lage.changed` per Trigger): zwei Mechanismen für eine
  Tabelle, und der erste Einwand bleibt.

Preis: Die Logik steht in SQL, und eine Änderung an ihr braucht eine neue Migration (D6, D7
halten das mit Tests zusammen).

### D3: Eine Zeile je Zugang, Sichtbarkeit beim Schreiben

Jeder Trigger schreibt je Freigabe des Einsatzes eine Zeile mit deren `zugang_id`. Der Abruf
liest `WHERE zugang_id = ?`.

Begründung:

- Der Abschluss löscht die Freigabe in derselben Transaktion. Ein Filter beim Lesen gegen die
  aktuelle Freigabe verbärge `einsatz.closed`.
- Eine später erteilte Freigabe muss sich melden. Beim Schreiben ist das ein Ereignis für genau
  diesen Zugang (`einsatz.created`).
- `alarmmeldung.*` „nur für den meldenden Zugang“ (LLH-1192) und der Cursor je Abo (LLH-1656)
  passen ohne weiteres Feld.
- Der Abruf ist ein Bereichslesen über einen Index, ohne Join.

Alternative: eine Zeile je Ereignis und Filter beim Lesen (Wortlaut des Konzepts). Dafür müsste
die Freigabe den Abschluss überdauern, und der Client müsste die Einsatzliste regelmäßig neu
lesen, um neue Freigaben zu bemerken.

Preis: Bei n Zugängen mit Freigabe entstehen n Zeilen je Änderung. In der Praxis sind das
wenige Zugänge je Einsatz, und `lage.changed` ist verdichtet (D6).

Die Scopes werden beim Lesen geprüft, nicht beim Schreiben: Ein Admin kann sie ändern, und die
Zeilen sind nach sieben Tagen fort.

### D4: Datenmodell

Eine Migration, Nummer über allen auf `alpha` (also hinter LLH-1638), ohne `-- no-transaction`
(kein Tabellenumbau).

```sql
CREATE TABLE maschine_ereignis (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    zugang_id   TEXT    NOT NULL REFERENCES maschinenzugang(id) ON DELETE CASCADE,
    type        TEXT    NOT NULL CHECK (type IN
                    ('einsatz.created', 'einsatz.updated', 'einsatz.closed', 'lage.changed')),
    einsatz_id  INTEGER NOT NULL,
    occurred_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_maschine_ereignis_zugang ON maschine_ereignis (zugang_id, id);
CREATE INDEX idx_maschine_ereignis_einsatz ON maschine_ereignis (einsatz_id, type, zugang_id);

-- Eine Zeile: bis zu welcher Nummer der Purge gelöscht hat.
CREATE TABLE maschine_ereignis_stand (
    id           INTEGER PRIMARY KEY CHECK (id = 1),
    purged_until INTEGER NOT NULL DEFAULT 0
);
INSERT INTO maschine_ereignis_stand (id) VALUES (1);
```

- `AUTOINCREMENT`, damit eine Nummer nie neu vergeben wird, auch wenn die höchste Zeile gelöscht
  ist. Der Höchststand steht in `sqlite_sequence`.
- `einsatz_id` ohne Fremdschlüssel, wie in `einsatz_aenderung`: Das `einsatz.closed` eines hart
  gelöschten laufenden Einsatzes überlebt ihn (D5).
- `type` und `occurred_at` heißen wie auf dem Wire (Wurzel-`AGENTS.md`, „Bezeichner-Sprache“:
  Technik englisch). `occurred_at` steht in `zeit::FORMAT`; `datetime('now')` liefert es.
- Eine neue Ereignisart baut den CHECK neu (Muster 0334); bei sieben Tagen Bestand ist das
  billig.

### D5: Die Trigger

| Trigger | Auslöser | Bedingung | Wirkung |
| --- | --- | --- | --- |
| `maschinenzugang_freigabe_ereignis_i` | `AFTER INSERT` auf der Freigabe | Einsatz ist `aktiv` | `einsatz.created` und `lage.changed` für `NEW.zugang_id` |
| `maschinenzugang_freigabe_ereignis_d` | `AFTER DELETE` auf der Freigabe | Einsatz besteht und ist `aktiv`, Zugang besteht | `einsatz.closed` und `lage.changed` für `OLD.zugang_id` |
| `einsatz_ereignis_kopf` | `AFTER UPDATE OF <Kopfspalten>` auf `einsatz` | `NEW.status = 'aktiv'` und eine Kopfspalte `IS NOT` ihrem alten Wert | `einsatz.updated` je Freigabe |
| `einsatz_ereignis_lage` | `AFTER UPDATE OF <Lagespalten>` auf `einsatz` | wie oben, für die Lagespalten | `lage.changed` je Freigabe |
| `einsatz_ereignis_ende` | `AFTER UPDATE OF status` auf `einsatz` | `OLD.status = 'aktiv'` und `NEW.status <> 'aktiv'` | `einsatz.closed` und `lage.changed` je Freigabe |
| `einsatz_ereignis_d` | `BEFORE DELETE` auf `einsatz` | – | löscht alle Zeilen des Einsatzes; war er `aktiv`, danach `einsatz.closed` je Freigabe |
| `einsatz_aenderung_ereignis_i` | `AFTER INSERT` auf `einsatz_aenderung` | `NEW.art` ist eine Lage-Tabelle (D6) | `lage.changed` je Freigabe |

Jedes `lage.changed` ersetzt das vorherige: zuerst
`DELETE … WHERE type = 'lage.changed' AND einsatz_id = ? AND zugang_id = ?`, dann `INSERT`
(Index `idx_maschine_ereignis_einsatz`).

Warum genau ein `einsatz.closed`:

- **Abschluss:** `abschliessen` setzt zuerst den Status. `einsatz_ereignis_ende` schreibt je
  Freigabe, die noch da ist. Danach löscht die Transaktion die Freigaben;
  `…_freigabe_ereignis_d` sieht einen nicht mehr aktiven Einsatz und schreibt nichts.
- **Abschluss über den Spiegel:** Die Übernahme setzt nur den Status. Die Freigabe bleibt
  vielleicht stehen, das Ereignis entsteht trotzdem.
- **Freigabe zurückgenommen:** Der Einsatz ist aktiv, `…_freigabe_ereignis_d` schreibt für
  diesen einen Zugang.
- **Hartes Löschen eines laufenden Einsatzes** (`demo::entfernen`, `abraeumen`):
  `einsatz_ereignis_d` läuft vor der Kaskade und sieht die Freigaben noch. Die Kaskade löscht sie
  danach; ihr Trigger findet den Einsatz nicht mehr und schreibt nichts.
- **Löschen eines abgeschlossenen Einsatzes** (`skelett_loeschung`): `einsatz_ereignis_d` löscht
  nur. Es bleibt keine Zeile mit dieser `einsatz_id` (Wächter `reste()` dort).
- **Löschen eines Zugangs** (Kaskade aus `organisation`): Die Bedingung „Zugang besteht“
  verhindert, dass der Freigabe-Trigger eine Zeile mit totem Fremdschlüssel schreibt.

Soft-Delete (`geloescht_at`) betrifft nur abgeschlossene Einsätze (`soft_delete_einsatz` prüft
den Status) und braucht keinen Trigger. Einen Weg zurück nach `aktiv` gibt es nicht.

### D6: lage.changed kommt aus dem Änderungslog

`einsatz_aenderung_ereignis_i` hängt am Änderungslog statt an jeder Lage-Tabelle. Die Arten:

`einsatz_person`, `einsatz_lagekennzahl_wahl`, `einsatz_einheit`, `einsatz_personal`, `uhs`,
`uhs_platz`, `lage_zone`, `einsatzabschnitt`, `freies_zeichen`, `lagebericht`, `meldung`.

Das sind die Tabellen, aus denen `verdichte`, `baue_karte` und `lagemeldung` lesen. Der Kopf
kommt über `einsatz_ereignis_lage`: `bezeichnung`, `stichwort`, `einsatzart`, `begonnen_at`,
`einsatzort_lat`, `einsatzort_lon`.

- Die Liste steht in Rust als `public_api::events::LAGE_ARTEN`. Ein Test liest den Trigger aus
  `sqlite_master` und vergleicht. Ein zweiter Test prüft, dass jede Art in `GESPIEGELT` steht
  (sonst schriebe niemand ins Log).
- Der Trigger meldet zu oft, nie zu selten: Ein geänderter Name einer Person löst `lage.changed`
  aus, obwohl sich keine Zahl ändert. Das Ereignis sagt „kann sich geändert haben“.
- `GET /api/v1/lage` (LLH-1638) liefert „inhaltlich wie `LagemonitorLage`“. Liest es aus weiteren
  Tabellen, kommt die Art in einer neuen Migration dazu. Die Regel steht danach in
  `src/AGENTS.md`.

Alternativen: ein Trigger je Lage-Tabelle (33 Trigger, und jeder Neubau einer Tabelle müsste sie
wieder anlegen) oder `lage.changed` weglassen, bis LLH-1638 fertig ist (dann fehlt dem
Lagemonitor das Signal, und die Outbox bekäme später einen zweiten Mechanismus).

### D7: Die Kopfspalten sind die Felder der Leseroute

`einsatz_ereignis_kopf` hört auf: `einsatznummer_intern`, `bezeichnung`, `stichwort`,
`einsatzart`, `leitstellen_nr`, `einsatzort`, `einsatzort_lat`, `einsatzort_lon`, `begonnen_at`.

Die Liste steht in Rust als `public_api::einsaetze::KOPF_SPALTEN`, und die Leseroute baut ihr
`SELECT` aus ihr. Ein Test vergleicht sie mit dem Trigger in `sqlite_master`. Ein neues Feld im
Schema `Einsatz` ohne Trigger macht den Test rot.

`UPDATE OF` feuert schon, wenn die Spalte im `SET` steht (die Spiegel-Übernahme setzt alle).
Deshalb vergleicht die Bedingung jede Spalte mit `IS NOT`.

### D8: Cursor, Stand und 410

- **Höchststand** `head`: `SELECT seq FROM sqlite_sequence WHERE name = 'maschine_ereignis'`,
  ohne Zeile 0.
- **Löschgrenze** `purged_until` aus `maschine_ereignis_stand`.
- **Ablauf eines Abrufs**, alles ohne Transaktion, in dieser Reihenfolge:
  1. `head` und `purged_until` lesen.
  2. Ohne `after`: Antwort `{cursor: head, events: []}`.
  3. `after < purged_until` oder `after > head`: `410 cursor_expired`.
  4. Zeilen lesen: `zugang_id = ? AND id > after AND id <= head AND type IN (…)`, aufsteigend,
     `LIMIT 500`. Die Arten folgen aus den Scopes des Zugangs.
  5. `cursor` ist die `id` der letzten Zeile, wenn die Seite voll ist, sonst `head`.
- `head` wird vor den Zeilen gelesen. Alles bis `head` ist dann festgeschrieben und sichtbar;
  was später kommt, liegt über dem gelieferten Cursor. So rückt der Cursor auch ohne eigene
  Ereignisse vor, und ein ruhiger Zugang läuft nicht in die Löschgrenze.
- Die Verdichtung (D6) löscht Zeilen unterhalb von `head`. Das ist kein Verlust: Die ersetzende
  Zeile trägt eine höhere Nummer als alles, was ein Leser schon hat.
- `after` und `wait` kommen als Text und werden im Handler geprüft, damit ein Fehler den Code
  `invalid_field` bekommt (`ApiError::new`), nicht die Ablehnung des Query-Extractors.

### D9: Der Long-Poll fragt im Sekundentakt nach, statt geweckt zu werden

Liefert Schritt 4 nichts und ist `wait > 0`, schläft der Handler eine Sekunde und wiederholt die
Schritte 1 und 4 (ohne 2 und 3), bis Zeilen da sind oder `wait` abgelaufen ist. Zwischen den
Versuchen hält er keine Verbindung.

Begründung:

- Die Zeilen entstehen in Triggern auf jedem Schreibweg. Einen Punkt „nach dem Commit“, an dem
  alle vorbeikommen, gibt es nicht, und `write_retry!` verbietet Sends im Body.
- Die Last ist klein und gedeckelt: höchstens 32 Wartende (D10), also höchstens 32 Lesezugriffe
  über einen Index je Sekunde.
- Eine Sekunde Verzug genügt für ein Signal, nach dem der Client ohnehin erst nachliest. Die Spec
  verlangt zwei Sekunden.

Alternativen:

- **Wecken aus `LiveHub`** (alle Live-Sendungen laufen nach dem Commit durch zwei Funktionen):
  kürzerer Verzug, aber es koppelt die Outbox an die Live-Ströme, weckt bei jedem ETB-Eintrag
  alle Wartenden und braucht für Wege ohne Live-Sendung trotzdem ein Nachfragen.
- **Ein gemeinsamer Wächter-Task**, der `head` liest und über `watch` verteilt: ein Zugriff je
  Sekunde statt 32, dafür ein Task mit eigenem Lebenslauf in `main.rs` und in jedem Test. Lohnt
  sich erst, wenn die Wartegrenze steigt.

Das Intervall ist eine Konstante; Tests setzen es über eine `#[cfg(test)]`-Stellschraube kürzer
(Muster `auth::provider::password::Schranken`).

Die Antwortsignatur entsteht beim Antworten. Die Anmeldung ist beim Eintritt geprüft; dass das
JWS der Anfrage (`exp` höchstens 60 s) während des Wartens abläuft, spielt keine Rolle.

### D10: Wartegrenzen als static, die Route bleibt unter der Zulassung

`public_api::events` hält prozessweit:

- `static` `Semaphore` mit 32 Plätzen (`MAX_WARTENDE`), belegt mit `try_acquire_owned`;
- `static` `Mutex<HashSet<String>>` der wartenden Zugangs-IDs. Ein Wächter-Objekt trägt beides
  und gibt beim `Drop` frei, auch wenn der Client abbricht.

Bekommt ein Abruf keinen Platz, antwortet er sofort mit 200. Ist die Liste leer, hängt der
Handler `Retry-After: 10` an die Antwort aus `client.antwort(..)` (`ApiError` setzt den Kopf nur
an 429).

Kein `AppState`-Feld (Kommentar in `src/app.rs`: jedes neue Feld bräche vier Konstruktionen).
Die Route kommt nicht in `OHNE_ZULASSUNGSGRENZE`: Ein wartender Abruf soll einen der 256 Plätze
halten, und `tests/zulassung_guard.rs` fände eine v1-Route dort nicht. Verlangt der Wächter dort
einen Eintrag in `OHNE_EIGENE_GRENZE`, bekommt die Route ihn mit Verweis auf diese Grenzen.

Die Drosselung des Zugangs (60 je Minute) gilt wie überall: Ein Abruf kostet einen Platz, egal
wie lange er wartet.

### D11: Leserouten und Schema

- `GET /api/v1/einsaetze` → `{cursor, einsaetze: [Einsatz]}`. `head` wird vor der Liste gelesen
  (D8), damit kein Ereignis zwischen Liste und Cursor fällt.
- `GET /api/v1/einsaetze/{id}` → `Einsatz` oder `404 not_found`. `{id}` ist `i64`; ein Wert, der
  keine Zahl ist, ergibt dieselbe 404. So besteht der Inventartest
  `jede_route_mit_maschinenanmeldung_traegt_eine_scope_angabe`, der `{id}` durch `id` ersetzt.
- Lesbar ist ein Einsatz mit Zeile in der Freigabe für diesen Zugang, `status = 'aktiv'`,
  `geloescht_at IS NULL` und der Org des Zugangs. Die Org wird mitgeprüft, obwohl die Freigabe
  sie schon bindet (wie in `lagemonitor_v1::lage`).
- Schema `Einsatz` (eigener Typ in `public_api`, `Serialize + ToSchema`):

  | Feld | Typ | Quelle |
  | --- | --- | --- |
  | `id` | Zahl | `einsatz.id` |
  | `einsatznummer` | Text, optional | `einsatznummer_intern` |
  | `bezeichnung` | Text | `bezeichnung` |
  | `stichwort` | Text, optional | `stichwort` |
  | `einsatzart` | Text | `einsatzart` |
  | `leitstellen_nr` | Text, optional | `leitstellen_nr` |
  | `einsatzort` | Text, optional | `einsatzort` |
  | `koordinate` | `{lat, lon}`, optional | `einsatzort_lat`, `einsatzort_lon` |
  | `begonnen_at` | Text | `begonnen_at` |

  Optionale Felder fehlen, wenn sie leer sind (`skip_serializing_if`).
- `einsatzart` ist auf dem Wire Text mit den heutigen Werten in der Beschreibung, kein Verweis
  auf `einsatz::Einsatzart`: v1 teilt keine Typen mit `api_doc.rs`, und ein neuer Wert ist nach
  dem Vertrag erlaubt.
- `einsatz_id` und `id` sind die Kennung des Einsatzes an dieser Instanz. Sie bleibt über
  Verwahrung und Sicherung gleich und wird nie neu vergeben (`einsatz::repo::naechste_id`). Die
  Kennung über Instanzen hinweg (`einsatz.kennung`) braucht ein Fremdsystem nicht, weil es mit
  genau einer Instanz spricht.
- Die Ereignisart ist ein `wire_enum!` `EventType` in `public_api::events` mit Eintrag in
  `tests/enum_wire_kontrakt.rs`. Ein Test vergleicht seine Werte mit dem CHECK der Tabelle.

### D12: Aufbewahrung

`public_api::events::purge(pool, jetzt)` in Phase C des Purge-Laufs, neben dem Maschinenzugang
(`einsatz::purge_scheduler`), in einer Transaktion:

1. `grenze` = höchste `id` mit `occurred_at < datetime(jetzt, '-7 days')`.
2. `purged_until = MAX(purged_until, grenze)`.
3. `DELETE … WHERE id <= purged_until`.

Gelöscht wird nach Nummer, nicht nach Zeit, damit Löschgrenze und Bestand auch nach einem
Uhrensprung zusammenpassen. Ein Ereignis lebt so sieben Tage plus höchstens einen Lauf (zehn
Minuten).

### D13: Einordnung der Tabelle

- `einsatz::schwaerzung_registry::TABELLEN`: `maschine_ereignis` mit `Scoping::EinsatzId`, alle
  Spalten `retain` (Kennungen, Katalogwert, Zeitstempel). `maschine_ereignis_stand` hat keinen
  Einsatzbezug.
- `instanz::spiegel::art::AUSGENOMMEN`: „Ausgang an Fremdsysteme gilt an der Instanz, die ihn
  ausgibt“. Die Tabelle hat keinen Log-Trigger; sonst liefe `lage.changed` im Kreis.
- `tests/demo_daten.rs`: ohne Freigabe entsteht beim Import und Entfernen keine Zeile. Der Test
  „DB wie vorher“ bleibt unverändert und grün.

### D14: Regeln und Entscheidung festhalten

- **Neue ADR** (nächste freie Nummer, heute 0029): „Ausgangsereignisse für Fremdsysteme entstehen
  per Trigger und je Zugang“. Regeln: Zeilen in `maschine_ereignis` schreibt nur ein Trigger; der
  Abruf liest nur Zeilen des eigenen Zugangs; ein Ereignis trägt nur Art, Zeit und Einsatz-ID.
  Prüfung: `verbiete 'INSERT INTO maschine_ereignis' 'src/**'` (Tests fügen über die Trigger
  ein, nicht direkt). ADR-0022 bleibt unberührt; die neue ADR führt deren Outbox-Regel aus.
- **`src/AGENTS.md`**, neuer Abschnitt „Ausgangsereignisse für Fremdsysteme (LLH-1655)“ mit drei
  Regeln:
  - Kein Rust-Schreibweg schreibt in `maschine_ereignis`.
  - Ein neues Feld im v1-Schema `Einsatz` kommt mit Spalte in `KOPF_SPALTEN` und neu gebautem
    Trigger.
  - Liest die Lage für Fremdsysteme aus einer weiteren Tabelle, kommt ihre Art in `LAGE_ARTEN` und
    in den Trigger.
- **Architektur:** Kapitel 6 (Ablauf vom Schreiben bis zum Abruf, als Mermaid), Kapitel 8
  (Konzept Outbox mit Verweis auf Spec und ADR), Kapitel 11 (Risiken unten). Kapitel 5 nur, wenn
  der Wächter die neuen Dateien verlangt.
- **Test-Helfer:** Die Helfer für signierte Anfragen liegen heute in `tests/maschinenzugang.rs`.
  Hat LLH-1638 sie schon nach `tests/common/` gehoben, werden sie von dort genutzt. Sonst hebt
  ein eigener `refactor`-Commit sie dorthin, bevor die neuen Tests entstehen.

## Risks / Trade-offs

- **Cursor nach dem Zurückspielen einer Sicherung** → Liegt der Cursor über dem Höchststand,
  kommt 410. Ist der Höchststand bis zum nächsten Abruf wieder darüber gewachsen, bemerkt der
  Client nichts und hat einen Stand, den es am Server nicht mehr gibt. Die Anleitung empfiehlt
  deshalb, die Einsatzliste regelmäßig (etwa stündlich) neu zu lesen. Kommt in Kapitel 11.
- **Die Liste der Lage-Tabellen altert** → Test gegen `GESPIEGELT` und Regel in `src/AGENTS.md`.
  Ein Test, der eine neue Quelle von `GET /api/v1/lage` von selbst bemerkt, ist nicht möglich.
  Kommt in Kapitel 11.
- **Stammdaten wirken in die Lage** (`personal.staerke_position` in `verdichte`) → Eine Änderung
  dort meldet kein `lage.changed`. Selten und ohne Einsatzbezug; hingenommen und in der Anleitung
  genannt.
- **`lage.changed` in einem lebhaften Einsatz** → Jede Schreibtransaktion an einer Lage-Tabelle
  beendet den wartenden Abruf. Liest der Client danach jedes Mal die Lage, läuft er in seine
  Drosselung (60 je Minute) und bekommt 429 mit `Retry-After`. Die Anleitung empfiehlt, nach
  einem `lage.changed` höchstens alle paar Sekunden nachzulesen.
- **Schreiblast** → Je Zeile im Änderungslog ein Indexzugriff auf die Freigabe, bei Freigabe je
  Zugang ein DELETE und ein INSERT. Ohne Freigabe (der Normalfall beim Demo-Import und an jedem
  ELW) bleibt es beim Indexzugriff. Aufgabe 2 misst den Demo-Import vorher und nachher.
- **Die Freigabe aus LLH-1638 sieht anders aus als angenommen** → Aufgabe 1 prüft das zuerst
  (D1).
- **Trigger sind schwerer zu finden als Rust-Code** → ADR, Abschnitt in `src/AGENTS.md` und ein
  Modulkommentar in `public_api::events`, der die Trigger beim Namen nennt.
- **Ein Verzug bis zu einer Sekunde im Long-Poll** → hingenommen (D9).

## Migration Plan

- Die Migration ist rein additiv. Bestehende Datenbanken bekommen zwei leere Tabellen und sieben
  Trigger; ohne Freigabe schreibt keiner etwas.
- Reihenfolge: zuerst LLH-1638 auf `alpha`, dann diese Change. Der Stau-Wächter und der Autofix
  für Migrationsnummern greifen wie sonst.
- Zurück: Revert des PRs vor dem nächsten Release. Danach bräuchte es eine Migration, die
  Trigger und Tabellen entfernt; die Daten darin sind höchstens sieben Tage alt und entbehrlich.

## Open Questions

- Name und Spalten der Freigabe-Tabelle (LLH-1638). Ändert nur die Namen in der Migration und in
  zwei Abfragen.
- Nummer der ADR. Entscheidet sich am Tag des Bauens (`scripts/adr-fuer.sh --alle`, offene PRs).
