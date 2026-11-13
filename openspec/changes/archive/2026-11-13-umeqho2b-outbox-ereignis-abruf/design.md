# Design

## Context

Motivation und Umfang: proposal.md. Anforderungen: `specs/ereignis-abruf/spec.md`.

Was im Code steht und den Weg bestimmt (Stand `origin/alpha` vom 12.11.2026, `3d74eba3`):

- **Gerüst der API v1** ist da (LLH-1652, LLH-1653): `src/public_api/` mit dem Extractor
  `MachineClient`, `ScopeAnforderung` je Route, `ApiError` mit `ErrorCode::CursorExpired` (410),
  den Scopes `events:read` und `einsaetze:read`, Drosselung und Abrufprotokoll im Extractor,
  Antwortsignatur über `client.antwort(..)`. Regeln: `src/AGENTS.md`, „Backend — Öffentliche API
  v1“.
- **Die Einsatzfreigabe für Maschinenzugänge kam mit LLH-1638** (Change
  `f658d8o6-lage-fuer-maschinenzugaenge`, archiviert 12.11.2026, auf `alpha` seit 13.11.2026,
  [ADR-0035](../../../docs/architektur/entscheidungen/ADR-0035-ein-maschinenzugang-liest-einsatzbezogen-nur-was-die-einsatzleitung-freigegeben-hat.md)).
  Bei der Planung lag sie noch nicht auf `alpha`. Dieselbe Change entfernt den alten Lagemonitor-Weg
  (`routes::lagemonitor_v1`, `lagemonitor_zugang`, `lagemonitor_freigabe`) und legt
  `public_api::lage` und `public_api::freigabe` an. Wo dieses Dokument die alten Namen nennt, ist
  der Stand vor LLH-1638 gemeint.
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
  `routes::lagemonitor_v1` lesen aus elf Tabellen (nach LLH-1638 `public_api::lage::QUELLEN`,
  zwölf ohne den Kopf), die zusammen über 100 Schreibstellen in rund 25 Modulen haben.
- **Ein Änderungslog gibt es schon:** `einsatz_aenderung` (Migration 0314). Die Trigger
  `<tabelle>_spiegellog_i/_u/_d` jeder gespiegelten Einsatztabelle schreiben bei jeder Änderung
  eine Zeile hinein, in der Transaktion der Änderung, auch während einer Spiegel-Übernahme (die
  Log-Trigger tragen keine Bedingung auf `spiegel_uebernahme`). Alle Lage-Tabellen stehen in
  `instanz::spiegel::art::GESPIEGELT`.
- **Der Abschluss löscht Freigaben in seiner Transaktion** (`einsatz::repo::abschliessen` ruft
  `lagemonitor_zugang::freigaben_loeschen_tx`). LLH-1638 setzt an dieselbe Stelle das Löschen der
  neuen Freigaben (dort D5).
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

### D1: Die Freigabe aus LLH-1638 ist Voraussetzung für Trigger und Leserouten

Diese Change legt keine Freigabe-Tabelle an. Sie nutzt die aus LLH-1638 (dort D2 bis D5):

```sql
CREATE TABLE maschinenzugang_freigabe (
    zugang_id       TEXT    NOT NULL REFERENCES maschinenzugang(id) ON DELETE CASCADE,
    einsatz_id      INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    freigegeben_von INTEGER REFERENCES benutzer(id) ON DELETE SET NULL,
    freigegeben_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (zugang_id, einsatz_id)
);
CREATE UNIQUE INDEX idx_maschinenzugang_freigabe_zugang ON maschinenzugang_freigabe (zugang_id);
```

Was daraus folgt:

- **Ein Einsatz je Anbindung** (eindeutiger Index, Entscheidung Ruben in LLH-1638). Die Trigger
  und Abfragen hier hängen nicht daran; fällt der Index später, ändert sich nichts.
- **Umstellen ist Löschen und Einfügen** (`public_api::freigabe::freigeben_tx`, Ergebnis
  `Abgeloest { vorher }`; geplant war ein Upsert, am gebauten Stand nachgelesen in Aufgabe 3.1).
  Die Trigger `_d` und `_i` melden es; der Trigger `_u` (D5) bleibt als Netz für einen künftigen
  UPDATE-Weg, ein Test stellt per UPDATE um.
- **`INSERT OR REPLACE` darf es nicht werden.** `REPLACE` löscht ohne DELETE-Trigger (geprüft);
  das ergäbe ein zweites `einsatz.created` und kein `einsatz.closed`. ADR-0036 verbietet es.
- **Die Zeile endet durch Löschen** beim Abschluss, beim Zurücknehmen, beim Widerruf des Zugangs
  und bei jeder Änderung seiner Lese-Scopes mit Einsatzbezug (D16). Kommt der Abschluss über den Spiegel, bleibt
  die Zeile stehen und ist nur unwirksam (LLH-1638 D2); D5 deckt das über den Status ab.
- **Wirksam** ist eine Freigabe nur am aktiven, nicht gelöschten Einsatz. Die Leserouten (D11)
  nutzen dafür die Abfrage aus `public_api::freigabe`, statt den Join zu wiederholen.

Der Bedarf stand seit 12.11.2026 als Kommentar an LLH-1638; der gebaute Stand wich nur beim
Umstellen ab (oben).

Was die Freigabe nicht braucht, entsteht vorher (Entscheidung Ruben, 12.11.2026): die Tabellen
(D4), der Abruf (D8 bis D10) und der Purge (D12).

Alternativen: die Tabelle hier bauen (LLH-1638 läuft schon, doppelter Bau) oder ohne Freigabe
ausliefern (verstößt gegen ADR-0022).

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

Zwei Migrationen, beide ohne `-- no-transaction` (kein Tabellenumbau), beide mit Nummern über
allen auf `alpha`:

1. die Tabellen unten; sie braucht LLH-1638 nicht und entsteht zuerst;
2. die Trigger aus D5; sie liest `maschinenzugang_freigabe` und kommt deshalb hinter die
   Migrationen von LLH-1638 (0341 und 0342). Gebaut: `0344_maschine_ereignis.sql` und
   `0345_maschine_ereignis_trigger.sql`.

Belegt LLH-1638 bis zu seinem Merge die Nummer der ersten, legt der Autofix sie um
(Wurzel-`AGENTS.md`, Migrationsvergabe). Die Reihenfolge der beiden bleibt dabei erhalten, und
die erste hängt von nichts ab.

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
| `maschinenzugang_freigabe_ereignis_u` | `AFTER UPDATE OF einsatz_id, zugang_id` auf der Freigabe | alter und neuer Wert verschieden | für den alten Einsatz, falls `aktiv`: `einsatz.closed` und `lage.changed`; für den neuen, falls `aktiv`: `einsatz.created` und `lage.changed` |
| `einsatz_ereignis_kopf` | `AFTER UPDATE OF <Kopfspalten>` auf `einsatz` | `NEW.status = 'aktiv'` und eine Kopfspalte `IS NOT` ihrem alten Wert | `einsatz.updated` je Freigabe eines gültigen Zugangs |
| `einsatz_ereignis_lage` | `AFTER UPDATE OF <Lagespalten>` auf `einsatz` | wie oben, für die Lagespalten | `lage.changed` je Freigabe eines gültigen Zugangs |
| `einsatz_ereignis_ende` | `AFTER UPDATE OF status` auf `einsatz` | `OLD.status = 'aktiv'` und `NEW.status <> 'aktiv'` | `einsatz.closed` und `lage.changed` je Freigabe |
| `einsatz_ereignis_d` | `BEFORE DELETE` auf `einsatz` | – | löscht die Zeilen über den Inhalt (`einsatz.created`, `einsatz.updated`); ein schon geschriebenes Ende bleibt bis zum Purge; war der Einsatz `aktiv`, danach `einsatz.closed` und `lage.changed` je Freigabe |
| `einsatz_aenderung_ereignis_i` | `AFTER INSERT` auf `einsatz_aenderung` | eine Freigabe besteht, `NEW.art` ist eine Lage-Tabelle (D6) | `lage.changed` je Freigabe eines gültigen Zugangs |
| `einsatz_spiegel_ereignis_u` | `AFTER UPDATE OF beendet_at, freigabestufe` auf `einsatz_spiegel` | ein Wert geändert, Freigabe besteht, Einsatz `aktiv` | `lage.changed` je Freigabe eines gültigen Zugangs |
| `einsatz_spiegel_ereignis_i`, `_d` | `AFTER INSERT`/`DELETE` auf `einsatz_spiegel` (Einsatz wird Spiegel oder hört auf, einer zu sein) | Freigabe besteht, Einsatz `aktiv` | `lage.changed` je Freigabe eines gültigen Zugangs |

**Gültig** heißt: nicht widerrufen und „gültig bis“ nicht verstrichen. Ein abgelaufener Zugang
behält seine Freigabe-Zeile, bis ein Admin ihn ändert (LLH-1638); ohne diese Bedingung sammelte
er Ereignisse zu einem Einsatz, den er in der Zeit nicht lesen durfte, und läse sie nach der
Verlängerung (Review vor dem PR). Das Ende geht trotzdem an jeden Zugang mit Freigabe.

`einsatz_spiegel` liefert `einsatz.spiegel` in `GET /api/v1/lage` und entscheidet über die
Freigabestufe, ob die Lage überhaupt einen Einsatz trägt. `letzter_abgleich_at` ändert sich mit
jedem Abgleich und löst bewusst nichts aus.

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
  diesen einen Zugang. Dasselbe gilt für den Widerruf des Zugangs und jede Änderung seiner
  Lese-Scopes mit Einsatzbezug (D16).
- **Anbindung umgestellt:** `freigeben_tx` löscht und fügt ein; `_d` schließt den alten Einsatz
  für den Zugang, `_i` meldet den neuen. Ein UPDATE ginge über `_u` mit derselben Wirkung. War der alte schon abgeschlossen (Zeile blieb nach einem Abschluss über den
  Spiegel stehen), hat `einsatz_ereignis_ende` ihn längst gemeldet, und der Trigger schreibt für
  ihn nichts.
- **Hartes Löschen eines laufenden Einsatzes** (`demo::entfernen`, `abraeumen`):
  `einsatz_ereignis_d` läuft vor der Kaskade und sieht die Freigaben noch. Die Kaskade löscht sie
  danach; ihr Trigger findet den Einsatz nicht mehr und schreibt nichts. Ein älteres
  `einsatz.closed` eines Zugangs, dessen Freigabe vorher endete, bleibt stehen.
- **Löschen eines abgeschlossenen Einsatzes** (`demo::entfernen`, `abraeumen` binnen sieben Tagen,
  `skelett_loeschung` viel später): `einsatz_ereignis_d` löscht nur die Zeilen über den Inhalt.
  Das Ende aus dem Abschluss bleibt, bis der Purge es nimmt; sonst erführe ein Zugang, der gerade
  nicht abruft, es nie (Review vor dem PR). `einsatz_id` trägt keinen Fremdschlüssel, und
  Einsatz-IDs werden nicht neu vergeben. Der Wächter `reste()` in `skelett_loeschung` legt keine
  Freigabe an und bleibt grün; bei der endgültigen Löschung ist das Ende längst gepurgt.
- **Löschen eines Zugangs** (Kaskade aus `organisation`): Die Bedingung „Zugang besteht“
  verhindert, dass der Freigabe-Trigger eine Zeile mit totem Fremdschlüssel schreibt.

Soft-Delete (`geloescht_at`) betrifft nur abgeschlossene Einsätze (`soft_delete_einsatz` prüft
den Status) und braucht keinen Trigger. Einen Weg zurück nach `aktiv` gibt es nicht.

### D6: lage.changed kommt aus dem Änderungslog

`einsatz_aenderung_ereignis_i` hängt am Änderungslog statt an jeder Lage-Tabelle. Die Arten:

`public_api::lage::QUELLEN` ohne `einsatz`: `einsatz_person`, `einsatz_lagekennzahl_wahl`,
`einsatz_personal`, `einsatz_einheit`, `uhs`, `uhs_platz`, `lagebericht`, `lage_zone`,
`einsatzabschnitt`, `freies_zeichen`, `meldung`, `kommunikation_status` (zwölf; der Entwurf nannte
elf, `kommunikation_status` kam am gebauten Stand von LLH-1638 dazu). Der Kopf
kommt über `einsatz_ereignis_lage`: `bezeichnung`, `stichwort`, `einsatzart`, `begonnen_at`,
`einsatzort_lat`, `einsatzort_lon`.

- Die Liste steht in Rust als `public_api::events::LAGE_ARTEN`. Ein Test vergleicht sie mit
  `lage::QUELLEN` und mit dem Trigger aus `sqlite_master` und prüft, dass jede Art in
  `GESPIEGELT` steht (sonst schriebe niemand ins Log); ein zweiter tut dasselbe für die
  Lage-Spalten des Kopfs (`LAGE_KOPF_SPALTEN`). Beide in `src/public_api/events.rs`.
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
- **Ablauf eines Abrufs**, Schritte 1, 3 und 4 aus einem Schnappschuss (eine Lesetransaktion auf
  einer Verbindung, die danach sofort zurückgeht; `lesen_ab`), in dieser Reihenfolge:
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
- **Ein Schnappschuss, nicht zwei Abfragen.** Geplant war „alles ohne Transaktion“. Läuft dann
  der Purge zwischen Schritt 1 und 4, prüft Schritt 3 gegen die alte Löschgrenze, Schritt 4 liest
  den schon gelöschten Bereich, und statt `410` kommt eine Antwort mit Lücke (Review vor dem PR).
  Die Lesetransaktion beginnt aufgeschoben, hält eine Verbindung und blockiert im WAL keinen
  Schreiber. Deterministisch testen lässt sich das Fenster nicht; den wartenden Abruf prüft ein
  Test (D9).
- `after` und `wait` kommen als Text und werden im Handler geprüft, damit ein Fehler den Code
  `invalid_field` bekommt (`ApiError::new`), nicht die Ablehnung des Query-Extractors.

### D9: Der Long-Poll fragt im Sekundentakt nach, statt geweckt zu werden

Liefert Schritt 4 nichts und ist `wait > 0`, schläft der Handler eine Sekunde und wiederholt die
Schritte 1, 3 und 4 ab dem zuletzt gelieferten Cursor, bis Zeilen da sind, die Löschgrenze über
den Cursor gelaufen ist (`410`) oder `wait` abgelaufen ist. Zwischen den
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
  (D8), damit kein Ereignis zwischen Liste und Cursor fällt. Heute steht höchstens ein Einsatz
  darin (D1); die Form bleibt eine Liste.
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

- **Neue ADR** (gebaut als ADR-0036; 0034 und 0035 belegen LLH-1654 und LLH-1638): „Ausgangsereignisse für Fremdsysteme entstehen
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
- **Architektur:** Kapitel 6 (6.6f, Ablauf vom Schreiben bis zum Abruf, als Mermaid), Kapitel 8
  (8.6, Konzept Outbox mit Verweis auf Spec und ADR), Kapitel 11 (R38 bis R40). Kapitel 5
  verlangte der Wächter nicht.
- **API-Anleitung:** Abschnitte „Einsätze lesen“ und „Ereignisse abrufen“ in
  `docs/api/maschinenzugang.md`, wo auch „Lage lesen“ und der Rechner stehen; eine eigene Datei
  `docs/api/ereignisse.md`, wie geplant, gibt es nicht.
- **Test-Helfer:** LLH-1638 hat die Helfer für signierte Anfragen nach `tests/common/maschine.rs`
  gehoben; die Tests hier nutzen sie von dort.

### D15: Auch `einsaetze:read` macht einen Zugang freigebbar

LLH-1638 (dort D3) führt den Schalter ein (gebaut als `Scope::has_einsatzbezug()`), wahr nur
für `LageRead`, und sieht die Erweiterung hier vor. Diese Change setzt `EinsaetzeRead` auf wahr.

- Das Paneel „Anbindungen“ der Einsatzleitung zeigt dann auch Zugänge, die nur Einsätze lesen.
- Jede Änderung an diesen Scopes löscht die Freigabe (D16) und meldet so `einsatz.closed`.
- `EventsRead` bleibt falsch. Allein öffnet es keine Ereignisart (D8); ein Schalter im Paneel
  hätte keine Folge.
- Der Test aus LLH-1638 (`routen_mit_einsatzbezug_lesen_nur_ueber_die_freigabe`) deckt danach
  auch die beiden Leserouten; dafür nennen sie ihren Scope im Dokument (`security`).
- Texte im Paneel und im Anwenderkapitel, die nur von „Lage“ sprechen, werden mitgezogen.

Alternative: `EventsRead` ebenfalls wahr. Verworfen, weil der Zugang trotz Freigabe nichts sähe.

### D16: Jede Änderung der Rechte mit Einsatzbezug beendet die Freigabe

Seit es zwei Lese-Scopes mit Einsatzbezug gibt, beendete der Stand von LLH-1638 die Freigabe nur
mit dem letzten von ihnen. Ein Admin ohne Rolle im Einsatz konnte so einer freigegebenen
Anbindung ein zweites Recht dazugeben (etwa „Lage lesen“ zu einem Einsatzbuch), und sie las
sofort mehr; ein entzogenes Recht kam ohne neue Entscheidung zurück, solange das andere stand
(Review vor dem PR). Entscheidung Ruben (13.11.2026): **Jede Änderung** an den Lese-Scopes mit
Einsatzbezug beendet die Freigabe, Hinzufügen wie Entzug, mit Eintrag im Einsatztagebuch
(`routes::anbindungen::aendern`). Die Einsatzleitung hat für einen Umfang freigegeben und
entscheidet über einen anderen neu. Ein Scope ohne Einsatzbezug ändert nichts.

Folgen: Das Fremdsystem bekommt `einsatz.closed` (sofern es `einsaetze:read` noch hat) und nach
der neuen Freigabe `einsatz.created`; es verpasst keinen Wechsel. Ein Admin, der nur ein Recht
ergänzt, unterbricht die Anbindung, bis die Einsatzleitung neu freigibt. Spec `maschinenzugang`
ändert sich mit (Delta in dieser Change).

Verworfen: nur das Hinzufügen beendet sie (dann verpasst ein Fremdsystem nach einem Entzug die
Ereignisse des entzogenen Rechts still); die Freigabe gilt je Anbindung für alle, auch spätere
Rechte (dann erweitert der Admin den Umfang ohne die Einsatzleitung).

## Risks / Trade-offs

- **Cursor nach dem Zurückspielen einer Sicherung** → Liegt der Cursor über dem Höchststand,
  kommt 410. Ist der Höchststand bis zum nächsten Abruf wieder darüber gewachsen, bemerkt der
  Client nichts und hat einen Stand, den es am Server nicht mehr gibt. Die Anleitung empfiehlt
  deshalb, den Stand regelmäßig (etwa stündlich) neu aufzubauen. Kapitel 11, R39.
- **Der Cursor ist eine Nummer über alle Zugänge** → Ein Zugang sieht an der Differenz zweier
  Cursor, wie viele Ereignisse anderswo entstehen, auch in anderen Orgs; Inhalte nicht.
  Hingenommen (Entscheidung Ruben, 13.11.2026), Kapitel 11, R40. Ein Cursor je Zugang bräuchte
  eine Löschgrenze je Zugang.
- **Die Liste der Lage-Tabellen altert** → Test gegen `GESPIEGELT` und Regel in `src/AGENTS.md`.
  Ein Test, der eine neue Quelle von `GET /api/v1/lage` von selbst bemerkt, ist nicht möglich.
  Kommt in Kapitel 11.
- **Stammdaten wirken in die Lage** (`personal.staerke_position` in `verdichte`) → Eine Änderung
  dort meldet kein `lage.changed`. Selten und ohne Einsatzbezug; hingenommen und in der Anleitung
  genannt. Ebenso der bloße Takt des Spiegel-Abgleichs (`letzter_abgleich_at`); die Anleitung
  empfiehlt, die Lage eines Spiegels zusätzlich in festem Abstand zu lesen.
- **`lage.changed` in einem lebhaften Einsatz** → Jede Schreibtransaktion an einer Lage-Tabelle
  beendet den wartenden Abruf. Liest der Client danach jedes Mal die Lage, läuft er in seine
  Drosselung (60 je Minute) und bekommt 429 mit `Retry-After`. Die Anleitung empfiehlt, nach
  einem `lage.changed` höchstens alle paar Sekunden nachzulesen.
- **Schreiblast** → Je Zeile im Änderungslog ein Indexzugriff auf die Freigabe, bei Freigabe je
  Zugang ein DELETE und ein INSERT. Ohne Freigabe (der Normalfall beim Demo-Import und an jedem
  ELW) bleibt es beim Indexzugriff. Aufgabe 3.8 misst den Demo-Import vorher und nachher.
- **Der gebaute Stand von LLH-1638 weicht von seinem Plan ab** → Aufgabe 3.1 hat ihn
  nachgelesen; abgewichen ist nur das Umstellen (D1).
- **Zwei Sitzungen ändern dieselben Dateien** (`public_api/mod.rs`, `description.md`,
  `docs/api/public-v1.json`, `tests/enum_wire_kontrakt.rs`, Doku) → Der Merge in Aufgabe 3.1 löst
  Konflikte auf; das erzeugte Dokument wird neu erzeugt, nicht von Hand zusammengeführt.
- **Trigger sind schwerer zu finden als Rust-Code** → ADR, Abschnitt in `src/AGENTS.md` und ein
  Modulkommentar in `public_api::events`, der die Trigger beim Namen nennt.
- **Ein Verzug bis zu einer Sekunde im Long-Poll** → hingenommen (D9).

## Migration Plan

- Die Migrationen sind rein additiv. Bestehende Datenbanken bekommen zwei leere Tabellen und elf
  Trigger; ohne Freigabe schreibt keiner etwas.
- Reihenfolge: LLH-1638 liegt seit 13.11.2026 auf `alpha`; danach der PR dieser Change. Der Stau-Wächter und der
  Autofix für Migrationsnummern greifen wie sonst.
- Zurück: Revert des PRs vor dem nächsten Release. Danach bräuchte es eine Migration, die
  Trigger und Tabellen entfernt; die Daten darin sind höchstens sieben Tage alt und entbehrlich.

## Open Questions

Keine. Migrationen und ADR sind gegen `alpha` vom 13.11.2026 nummeriert (0343, 0344, ADR-0036);
ein späterer Konflikt fängt der Autofix bzw. der Commit-Status `ADR-Nummern`.
