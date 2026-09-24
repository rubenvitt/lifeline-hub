# Design

## Context

Anlass und Umfang stehen in `proposal.md`, die Anforderungen in `specs/demo-daten/spec.md`.
Hier steht nur der gemessene Stand, der den Weg vorgibt (Scope-Lauf vom 24.09.2026):

- **Config** ist eine clap-derive-Struktur (`src/config.rs`). Ein reines Flag nach dem
  `tls`-Muster (`default_value_t = false`) passt. Getestet wird hermetisch über
  `parse_hermetisch`/`parse_mit_env`. `tests/env_config_guard.rs` erlaubt Env-Lesen nur in
  `src/config.rs`. Die Config erreicht den `AppState` nicht als Ganzes: `main.rs` verteilt
  Einzelwerte in OnceLocks oder in einzelne `AppState`-Felder. Ein neues Pflichtfeld am
  `AppState` bricht rund 41 Konstruktionen in `src/` und `tests/`.
- **404 wie ein unbekannter Pfad** liefert nur der Router-Fallback `static_files::serve`
  (`src/app.rs`, `tests/fehler_vertrag.rs`). Ein registrierter Pfad antwortet bei falscher
  Methode mit 405, und eine Prüfung im Handler kommt erst nach dem `AdminUser`-Extractor
  (401/403). Präzedenz für eine bedingte Registrierung ist `/api/dev/users` hinter
  `#[cfg(feature = "dev-seeds")]`.
- **System-Admin** prüft der Extractor `AdminUser` (`src/auth/session.rs`: 401 ohne Sitzung,
  403 ohne Rolle). Führungskräfte haben `darf_admin_bereich` und sehen die Verwaltung. Im
  Frontend hat `AdminSektion` kein Rollenprädikat. Nur der Sonderfall `adminBenutzer`
  blendet nach `istSystemAdmin` aus und schützt seine Seite selbst.
- Eine **allgemeine Instanz-Abfrage** fürs Frontend gibt es nicht. `/api/karte/config` ist
  öffentlich und kartenbezogen, `/api/auth/me` ist ein Benutzer-DTO. Das Muster „404 heißt
  aus“ hat `/api/dev/users` (`LoginPage.tsx`).
- **Einsatz hart löschen:** `foreign_keys` ist an (`src/db.rs`), und alle 60
  einsatzgebundenen Tabellen hängen direkt oder transitiv per `ON DELETE CASCADE` am
  Einsatz. Anhänge sind BLOBs in der DB. Auf dem ETB liegen nur die FTS-Synchronisations-
  trigger, kein Append-only-Trigger. `purge_scheduler`, `soft_delete_einsatz` und
  `schwaerze_einsatz` löschen nie einen Einsatz. Das ETB echter Einsätze schützt also
  allein die WHERE-Bedingung des neuen Löschwegs.
- **Stammdaten:** `fahrzeug`, `personal` und `material` sind org-gebunden. Ihre Kennungen
  sind über partielle UNIQUE-Indizes `WHERE dienststatus = 'in_dienst'` eindeutig
  (Funkrufname, Personalnummer, Bestandsnummer). Der Personalname ist nicht eindeutig. Alle
  Fremdschlüssel **auf** die Stammdaten und Kataloge sind `NO ACTION`, gemessen per
  `pragma_foreign_key_list` über alle Migrationen: `einsatz_fahrzeug`, `einsatz_personal`,
  `einsatz_material`, `einsatz_einheit.typ_id/status_id` und `personal_qualifikation`.
  Keiner kaskadiert in die Stammdaten hinein. Die Kataloge seedet `bootstrap_admin` je
  Organisation.
- **Transaktionsfähigkeit der Fach-Repos:** tx-fähig (`&mut SqliteConnection`) sind ETB,
  Auftrag, Nachforderung, Person samt Sichtung, UHS-Belegung, Lage-Zone/Gefahrengebiet samt
  Bewertung, Betreuung, Fahrzeug-Disposition, Einheit-Zuordnung, Lagezustand und UHS/BR-
  Status. Nur über den Pool erreichbar sind Einsatz (`write_retry!`), Einsatzabschnitt,
  Einheit, Meldung (`pool.begin`), Befehl/Lagebericht (Anlage und Freigabe), UHS, BR,
  Erinnerung, Personal-Disposition und die Stammdaten-Anlage. Unter einer äußeren
  `BEGIN IMMEDIATE` wartet jeder dieser Schreiber `busy_timeout` ab und endet nach rund
  20 s mit 503. Ihre Pool-Lesezugriffe sehen die Zeilen der offenen Transaktion nicht.
  `meldung`/`auftrag` fallen dabei mit `unwrap_or(0)` **still** auf die Einstellungen von
  Org 0 zurück.
- **Einsatz-ID:** `einsatz.id` ist `INTEGER PRIMARY KEY` ohne `AUTOINCREMENT`. Die einzige
  Produktivstelle, die einen Einsatz einfügt, ist `einsatz::repo::anlegen_zum` (gemessen
  per grep, daneben nur Tests und der Dev-Seed).
- **Live:** Der `LiveHub` wirkt nur je Einsatz. Ein org-weiter Kanal fehlt. `lagged` ist das
  einzige ungegatete Kontrollereignis, ein neues Ereignis bräche fünf gepinnte Guards.

## Goals / Non-Goals

**Goals**

- Freischaltung, Rechte und Org-Scope, die sich im Test beide Richtungen belegen lassen
- Ein Import in **einer** Transaktion über dieselben Funktionen, die der Betrieb nutzt
  (Nummernkreise, Snapshots, System-ETB)
- Ein harter Löschweg, der strukturell nur Demo-Daten erreichen kann
- „DB wie vorher“ als prüfbare Aussage mit benannten Ausnahmen
- Keine Wiederverwendung der Einsatz-ID
- Eine Lage ohne Alarmsturm

**Non-Goals**

- **Sichtbare Demo-Marke an Stammdaten** in Katalogen und Auswahllisten. Das Risiko „jemand
  disponiert ein Demo-Fahrzeug in einen echten Einsatz“ fängt D7 ab: Die Zeile bleibt dann
  stehen. Eine Marke in der Anzeige ist eine eigene Entscheidung (Nachzug).
- **Org-weites Live-Ereignis** für die Einsatzliste. Andere Clients sehen den Import nach
  Refetch (Fokus, `staleTime`). Das Ereignis wäre ein neuer Kanal (Nachzug).
- **Pegel:** Eine echte PEGELONLINE-Station braucht Netz und passt nicht zum fiktiven Ort
  (Entscheidung Auftraggeber, 24.09.2026). Der Lageplatz „Pegel“ bleibt leer. Das Fehlen
  wird im Test als Abwesenheit gepinnt.
- **Chat:** Der Modulzähler `chat.ungelesen` ist benutzerbezogen. Demo-Nachrichten brächten
  dem Admin sofort eine hohe Ungelesen-Zahl, und der Chat steht nicht in der Liste des
  Tickets.
- Eintrag in der Sprungpalette, e2e-Lauf mit `--demo-daten`, Verpflegung, Ablösung,
  Nachforderungs-Workflow über die Anlage hinaus.
- **Stammdaten-IDs**: Deren Wiederverwendung hat keine Offline-Queue und kein Live-Replay.
  Sie bleibt hingenommen.

## Decisions

### D1 — Flag reist als Router-Option, Routen werden nur bedingt registriert

`Config.demo_daten: bool` (`#[arg(long, env = "LIFELINE_DEMO_DATEN", default_value_t =
false)]`). `src/app.rs` bekommt

```rust
pub struct RouterOptionen { pub demo_daten: bool }
pub fn build_router(state: AppState) -> Router { build_router_mit(state, RouterOptionen::default()) }
pub fn build_router_mit(state: AppState, opt: RouterOptionen) -> Router { … }
```

Die vier Demo-Routen werden nur bei `opt.demo_daten` registriert, nach dem Muster des
`dev-seeds`-Blocks. `main.rs` ruft `build_router_mit` und schreibt bei gesetztem Schalter
`tracing::warn!`, wie bei `download_allow_loopback`.

**Verworfen:** Ein **OnceLock** ist prozessweit nicht rücksetzbar, damit lassen sich „aus →
404“ und „an → Import“ nicht im selben Test-Binary prüfen. Ein **`AppState`-Feld** bräche
rund 41 Konstruktionen für einen Wert, den nur das Routing braucht. Ein
**Guard-Extractor** verriete den Pfad über 405 und käme hinter `AdminUser`. Die Handler
sehen das Flag nie: Existiert die Route, ist es an.

`bool` ohne `ArgAction::Set` nimmt in der Env nur `true`/`false`. `LIFELINE_DEMO_DATEN=1`
bricht den Start laut ab, statt still ignoriert zu werden. Gepinnt über `parse_mit_env`,
dasselbe Verhalten wie `LIFELINE_TLS`.

### D2 — Der Status-Endpunkt ist die eine Quelle fürs Frontend

Das Ticket unterstellt eine „vorhandene Instanz-/Config-Abfrage“, die es nicht gibt. Die
Freischaltung erfährt das Frontend deshalb aus `GET /api/demo-daten` selbst: 404 heißt
aus, 200 liefert den Status. Das ist **eine** Quelle, keine zweite neben einem Flag, und
folgt der Präzedenz `/api/dev/users`. Ein Feld am öffentlichen `/api/karte/config` machte
ein Merkmal, das nur den Admin angeht, anonym sichtbar und zwänge die Einsatzliste, die
Kartenkonfiguration zu laden. Ein Feld an `/api/auth/me` vermischte Benutzer und Instanz.

Die Abfrage läuft im Frontend nur für den System-Admin (`enabled`) und mit `retry: false`,
damit ein 404 kein Fehlerbild und keine drei Wiederholungen auslöst.

### D3 — Endpunkte und Statuscodes

| Methode | Pfad | Erfolg | Fehler |
|---|---|---|---|
| GET | `/api/demo-daten` | 200 `DemoDatenStatus` | 401 · 403 |
| POST | `/api/demo-daten` | 201 `DemoDatenStatus` | 401 · 403 · 409 aktiv · 422 Katalog fehlt |
| POST | `/api/demo-daten/neu` | 200 `DemoDatenStatus` | 401 · 403 · 422 |
| DELETE | `/api/demo-daten` | 200 `DemoDatenStatus` | 401 · 403 · 409 nichts aktiv |

Nach `src/error.rs` ist 409 der Lebenszyklus. „Schon importiert“ und „nichts importiert“
sind Zustände des Imports, keine Nebenläufigkeit. Ein fehlender Katalogeintrag ist 422:
Die Anfrage ist in Ordnung, der Zustand der Organisation verbietet sie. Alle Antworten
tragen den neuen Status, damit das Frontend ohne zweiten Abruf weiß, wo es steht.

`DemoDatenStatus { importiert: bool, import?: { id, importiert_at, einsatz_id,
einsatz_bezeichnung }, bericht?: DemoBericht }`. `DemoBericht { vorgang:
importiert|entfernt, zeitpunkt, je_art: [{ art: fahrzeug|personal|material, angelegt,
mitbenutzt, entfernt, behalten }] }`. Optionale Felder tragen `skip_serializing_if`
(LFH-265). Die Enums bekommen Pins in `tests/enum_wire_kontrakt.rs`.

### D4 — Schema: Kopf plus Stammdaten-Marke, Migration `0121_demo_daten.sql`

```sql
CREATE TABLE demo_import (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id         INTEGER NOT NULL REFERENCES organisation(id),
  einsatz_id     INTEGER NOT NULL,          -- bewusst OHNE FK: bleibt als ID-Sperre (D6)
  importiert_von INTEGER REFERENCES benutzer(id) ON DELETE SET NULL,
  importiert_at  TEXT NOT NULL DEFAULT (datetime('now')),
  entfernt_at    TEXT,
  bericht        TEXT NOT NULL              -- JSON, letzter Vorgang (D3)
);
CREATE UNIQUE INDEX idx_demo_import_aktiv ON demo_import(org_id) WHERE entfernt_at IS NULL;

CREATE TABLE demo_herkunft (
  import_id    INTEGER NOT NULL REFERENCES demo_import(id) ON DELETE CASCADE,
  tabelle      TEXT NOT NULL CHECK (tabelle IN ('fahrzeug','personal','material')),
  datensatz_id INTEGER NOT NULL,
  PRIMARY KEY (tabelle, datensatz_id)
);
```

- **Nur Stammdaten tragen eine Zeilenmarke.** Alles im Einsatz fällt über die Kaskade.
  Eine Marke je ETB- oder Personenzeile wäre eine zweite Wahrheit ohne Nutzen.
- Der **partielle UNIQUE-Index** ist die 409-Regel „ein aktiver Import je Org“. Der
  Precheck liefert die präzise Meldung, der Index hält das Rennen zweier gleichzeitiger
  Importe.
- `demo_herkunft` ist polymorph ohne FK. `tabelle` ist per CHECK auf drei Werte beschränkt,
  und das Löschen nutzt je Wert ein festes SQL-Literal (`&'static str`, sqlx 0.9), nie einen
  interpolierten Tabellennamen.
- `demo_import.einsatz_id` trägt einen Einsatzbezug. Die Tabelle wird deshalb in
  `src/einsatz/schwaerzung_registry.rs` klassifiziert (alle Spalten `retain`, keine PII).
  Der Guard wird nicht über einen anderen Spaltennamen umgangen. Die Klassifizierung ist
  mit dem Guard-Lauf in 2.x zu bestätigen. Falls die Entdeckung eine Tabelle ohne FK anders
  behandelt als erwartet, gilt, was der Guard verlangt.

### D5 — Eine Verbindung für den ganzen Vorgang: mechanischer `_tx`-Split

Import, Entfernen und Neu-Import laufen je in **einem** `write_retry!`-Block auf einer
Verbindung. Jede Repo-Funktion, die der Import braucht und die heute nur den Pool nimmt,
wird **mechanisch** geteilt: Der Rumpf wandert in `…_tx(conn: &mut SqliteConnection, …)`,
die Pool-Variante bleibt als dünne Hülle (`write_retry!`/`begin` → `_tx` → `commit`) mit
unverändertem Verhalten. Validierungen, die heute über den Pool lesen (Abschnitt-Parent,
Einheit-Abschnitt, Typ-Org, Auftrags-Empfänger, Org-Einstellungen), wandern mit auf die
Verbindung. Nur so sehen sie die Zeilen, die derselbe Import gerade angelegt hat, und
`meldung`/`auftrag` laden die Einstellungen der richtigen Organisation.

Betroffen: `einsatz::repo::anlegen_zum` → `anlegen_tx`, `einsatzabschnitt::repo::anlegen`,
`einheit::repo::anlegen`, `meldung::repo::anlegen`, `befehl::repo::{anlegen, freigeben}`,
`lagebericht::repo::{anlegen, freigeben}`, `uhs::repo::anlegen`,
`bereitstellungsraum::repo::anlegen`, `erinnerung::repo::anlegen`,
`personal::disposition_repo::disponiere_stamm` und die Stammdaten-Anlage `fahrzeug`,
`personal` (öffnet heute selbst `pool.begin()`) und `material`.

**Verworfen:** **Rohes SQL** in einem Demo-Modul. Es umginge Einsatznummer (LFH-617),
ETB-Startwert, Funktions-Snapshot und System-ETB, und es driftete beim nächsten Umbau still
vom Betrieb weg. Der Schema-Test fängt nur Spalten, keine Semantik.

**Nebenwirkungen in den Handlern.** Ein Teil dessen, was ein Vorgang im Betrieb schreibt,
liegt nicht im Repo, sondern im Handler. Gemessen in `src/routes/`: Die System-ETB-Texte
werden dort inline formatiert und über `etb::system_audit_tx` bzw. `etb_system_degradiert`
(außerhalb der Transaktion) geschrieben. Die Regel dafür lautet: Übernommen wird, was im ETB
eines echten Einsatzes stünde. Dazu wird der Textbaustein aus dem Handler als reine Funktion
in das Fachmodul gezogen, **Handler und Import rufen dieselbe Funktion**, und der Import
schreibt über `system_audit_tx` auf seiner Verbindung. Degradiert wird im Import nichts:
Scheitert ein ETB-Eintrag, scheitert der Import.

| Vorgang (Handler) | ETB im Betrieb | Import |
|---|---|---|
| Einsatz anlegen (`einsatz.rs`) | keins | — |
| Abschnitt anlegen (`einsatzabschnitt.rs`, degradiert) | System „Abschnitt … angelegt (Lage: …)“ | übernehmen |
| Einheit bilden (`einsatz_einheit.rs`, degradiert) | System | übernehmen |
| Fahrzeug an Einheit (`einsatz_einheit.rs`) | System | übernehmen |
| Fahrzeug/Personal/Material disponieren (`einsatz_fahrzeug.rs`, `einsatz_personal.rs` degradiert, `einsatz_material.rs`) | System | übernehmen |
| FMS-Status setzen (`einsatz_fahrzeug.rs` aktualisieren) | System | übernehmen |
| Lage-Zone anlegen (`lage_zone.rs`, `etb_text`) | System „… eingerichtet“ | übernehmen |
| Gefahr bewerten (`gefahr.rs`) | System | übernehmen |
| Person anlegen + Sichtung + UHS-Eintritt (`einsatz_person.rs`) | bis zu drei System-Einträge | übernehmen |
| UHS/BR Status → aktiv (`einsatz_uhs.rs`, `einsatz_bereitstellungsraum.rs`) | System | übernehmen |
| Meldung, Auftrag, Nachforderung, Befehl/Lagebericht-Freigabe, Betreuung | im Repo | kommt mit dem Split |
| Auto-Frist-Erinnerung (Auftrag, Sofortmeldung) | Erinnerung | **weggelassen**: Das Szenario hat keine offene Pflichtfrist (D10), eine Auto-Frist wäre ein Alarm auf Vorrat |
| Live-Events je Vorgang | SSE | **weggelassen**: Ein neuer Einsatz hat keine Abonnenten, die Invalidierung läuft nach D13 |

Die Geometrie-Validierung der Lage-Zone (`validiere_neu`) ist rein und wird vom Import mit
aufgerufen, damit ein Szenariofehler als Testfehler auffällt und nicht erst auf der Karte.
Die Sofortmeldungs-Pflicht aus `routes/meldung.rs` übernimmt der Import nicht. Die eine
Sofortmeldung des Szenarios wird bestätigt angelegt.

**Risiko:** Jeder Split fasst produktiven Code an. Absicherung: Die bestehenden Tests der
Pool-Variante bleiben unverändert grün. Ein Split ohne Verhaltensänderung braucht keinen
neuen Test, der Import-Test deckt die `_tx`-Seite.

### D6 — Einsatz-ID über die Historie gesperrt

`einsatz::repo::anlegen_tx` vergibt die ID ausdrücklich:

```sql
INSERT INTO einsatz (id, …) VALUES (
  (SELECT MAX(COALESCE((SELECT MAX(id) FROM einsatz), 0),
              COALESCE((SELECT MAX(einsatz_id) FROM demo_import), 0)) + 1), …)
```

Das gilt für **jede** Einsatzanlage, nicht nur für den Demo-Import, denn der gefährliche
Fall ist ein echter Einsatz auf der ID des entfernten Demo-Einsatzes. Die Rechnung läuft
unter `BEGIN IMMEDIATE` und ist damit rennfrei. Ohne Demo-Historie ist das Ergebnis
dasselbe wie SQLites eigene Vergabe (`MAX(rowid)+1`), das Verhalten für Bestandsinstanzen
ändert sich also nicht.

**Verworfen:** Ein `AUTOINCREMENT`-Rebuild von `einsatz` ist die grundsätzliche Lösung,
aber ein Rebuild der meistreferenzierten Tabelle (60 FKs) mit entsprechendem
Migrationsrisiko für ein Problem, das nur der Demo-Löschweg erzeugt. Hinnehmen ließe
Offline-Queues anderer Geräte ungeschützt (Entscheidung Auftraggeber, 24.09.2026).

### D7 — Entfernen: Einsatz über die Marke, Stammdaten per Savepoint

In einem `write_retry!`:

1. Den aktiven Kopf der eigenen Organisation laden (`org_id = admin.org_id AND entfernt_at
   IS NULL`), sonst 409.
2. `DELETE FROM einsatz WHERE id = (SELECT einsatz_id FROM demo_import WHERE id = ? AND
   org_id = ? AND entfernt_at IS NULL) AND org_id = ?`. Die ID kommt **aus der Marke**,
   nie aus der Anfrage. Die Kaskade räumt alles darunter, auch einen soft-gelöschten oder
   geschwärzten Demo-Einsatz.
3. Je Zeile aus `demo_herkunft`, in der Reihenfolge Personal (mit `personal_qualifikation`
   dieser Person), Fahrzeug, Material: `SAVEPOINT` → `DELETE` → `RELEASE`. Scheitert das
   Löschen an einem Fremdschlüssel (`NO ACTION`, SQLite-Code 787), folgt `ROLLBACK TO`: Die
   Zeile bleibt, ihre Marke wird gelöscht, und der Bericht zählt sie als „behalten“. Andere
   Fehler brechen den ganzen Vorgang ab.
4. Kopf `entfernt_at = now`, Bericht setzen. `demo_herkunft` fällt per CASCADE nicht, weil
   der Kopf bleibt: Die Zeilen werden in Schritt 3 einzeln gelöscht.

Der Savepoint erkennt „wird noch referenziert“ über die Datenbank selbst und nicht über
eine handgepflegte Liste von Verweistabellen. Eine künftige Migration mit einem neuen
Verweis auf `fahrzeug` ist damit ohne Nachtrag abgedeckt. Die Kehrseite: Ein künftiger
Verweis mit `ON DELETE CASCADE`, `SET NULL` oder `SET DEFAULT` auf eine Stammdatentabelle
ließe das Löschen gelingen und räumte dabei fremde Zeilen still mit ab oder änderte sie.
Ein aufgeschobener Fremdschlüssel meldete den Fehler erst beim COMMIT, der Savepoint griffe
dann nicht. Ein Guard-Test (`pragma_foreign_key_list` über alle Tabellen) pinnt deshalb:
kein Fremdschlüssel auf `fahrzeug`/`personal`/`material` mit einer anderen ON-DELETE-Aktion
als `NO ACTION`/`RESTRICT` und kein `DEFERRABLE`. Die heutige Messung: vier eingehende
Fremdschlüssel, alle `NO ACTION`.

Nach dem Commit geht `lagged` auf den Kanal des entfernten Einsatzes. Das ist das
vorhandene Kontrollereignis, es braucht keine neue Variante. Offene Tabs laden neu und
landen in der 404-Sackgasse. Der Endlos-Reconnect bei 404 (`useEinsatzLiveStream` kennt nur
401) ist ein Bestandsfehler, der auch den Purge trifft, und wird als Nachzug erfasst, nicht
hier gebaut.

### D8 — Stammdaten: Konfliktregel und Kataloge

- Abgleich jeweils in der Organisation des Admins und nur gegen `dienststatus =
  'in_dienst'`, also dasselbe Prädikat wie die partiellen UNIQUE-Indizes und die
  Disposition. Ein außer Dienst gestellter Namensvetter wird nicht mitbenutzt: Die
  Disposition verlangt `in_dienst`, und der Index erlaubt die neue aktive Zeile.
- Fahrzeug: Funkrufname. Personal: Personalnummer (fest `DEMO-P-001` …), nie der Name.
  Material: Bestandsnummer (fest `DEMO-M-001` …).
- Die Funkrufnamen sind fiktiv und an den Ort gebunden („Musterstadt …“). Sie ahmen keine
  reale Organisation nach. Ein Zusammenstoß mit echten Daten ist damit unwahrscheinlich,
  bleibt aber abgedeckt.
- Kataloge nur mitbenutzen, und nur aktive Einträge. FMS-Status über `fms_anker` (stabil),
  Einheitstyp, Qualifikation und Materialkategorie über das Label, sonst über die
  Kategorie (`erster_der_kategorie_tx`). Fehlt ein Eintrag, antwortet das System mit 422
  „Katalogeintrag fehlt: Einheitstyp «Sanitätsgruppe»“. Neu angelegte Katalogzeilen würden
  per `NO ACTION` von echten Einsätzen festgehalten und machten das Entfernen unsauber
  (Entscheidung Auftraggeber, 24.09.2026). Welche Einträge das Szenario braucht, wird beim
  Bau aus `src/auth/bootstrap.rs` abgeleitet, damit eine frisch gebootstrappte Organisation
  sie immer hat. Ein Test belegt das.
- Keine Zuordnung `personal.benutzer_id`: `idx_personal_benutzer` ist eindeutig, und der
  Admin kann schon verknüpft sein.

### D9 — Das Drehbuch: ein chronologischer Ablauf mit Szenariouhr

`src/demo/szenario.rs` ist **Daten**: eine Liste von Schritten mit Versatz
(`T-5h`, `T-4h40m` …) und Inhalt. `src/demo/import.rs` spielt sie in Zeitfolge ab, weil
die laufende ETB-Nummer der Einfügereihenfolge folgt und viele Module ETB als Nebenwirkung
schreiben. Eine Schleife je Modul ergäbe Nr. 1 um 14:30 und Nr. 40 um 08:00.

Nach jedem Schritt setzt der Import für alle neuen ETB-Zeilen des Demo-Einsatzes
(`id > letzte_gesehene`) `received_at` auf die Schrittzeit, bei `typ = 'system'` zusätzlich
`ereigniszeit`. Systemeinträge haben keine eigene Ereigniszeit (`etb::system_daten`). So
steht jeder Eintrag auf seiner Zeit, und ⧖ fällt weg (Entscheidung Auftraggeber,
24.09.2026). Das `UPDATE` ist an `einsatz_id = <Demo-Einsatz>` gebunden und berührt keine
FTS-Spalte (`inhalt`/`von`/`an`/`veranlassung`). Der External-Content-Index bleibt also
synchron, weil es für ihn keinen `AFTER UPDATE`-Trigger gibt. Gemessen am 24.09.2026: Kein
Guard verbietet `UPDATE etb_eintrag` außerhalb bestimmter Dateien, die Fach-Repos setzen
dort bereits Backlinks. Über `received_at` liegen weder Prüfsumme noch Signatur. Ein
optionaler Parameter in `etb::anlegen_tx` reichte nicht, weil die Systemeinträge in fremden
`_tx`-Funktionen entstehen.

Die übrigen Zeitstempel, die der Server mit `datetime('now')` schreibt (`status_seit`,
`gesichtet_at`, `erfasst_at`, `erstellt_at`, `freigegeben_at`), bleiben auf der Importzeit.
Setzbar sind nur die fachlichen Felder (`ereigniszeit`, `eingang_at`, `erteilt_at`,
`frist_at`, `faellig_at`, `zeitpunkt_at`, `zeitstand`, `begonnen_at`). Mehr zu fälschen
hieße, Spalten mit „jetzt“-Semantik nachträglich umzuschreiben. Die sichtbare Folge ist
„Status seit 0 min“ im Meldebild. Das ist hingenommen und hier benannt, damit es
nicht als versteckte Ungenauigkeit durchgeht.

**Szenario „ÜBUNG – Starkregen Musterstadt“** (Stichwort aus dem Bootstrap-Katalog,
Unwetter), Beginn T−5 h, Einsatzart `uebung`:

- **Abschnitte:** EA 1 Sanitätsdienst (angespannt), EA 2 Betreuung (planmäßig), EA 3
  Logistik (planmäßig), EA 1.1 UHS Turnhalle (kritisch, Unterabschnitt). Fortschritt teils
  gesetzt, teils leer.
- **Einheiten und Fahrzeuge:** rund acht Stamm-Fahrzeuge, verteilt auf fünf Einheiten, FMS
  gemischt (2 · 3 · 4 · 6), Personal disponiert. Rückmeldungen als Meldungen mit
  `einheit_id`: vier frisch, eine überfällig (> 60 min).
- **UHS** „Turnhalle Musterstadt“ aktiv, Plätze angelegt. **Betroffene** zwölf mit fiktiven
  Namen („Erika Mustermann“ …), Sichtung SK I ×1, II ×3, III ×6, IV ×1, eine Person ohne
  Sichtung, einige im UHS-Eintritt.
- **BR** „Parkplatz Stadion Nord“ aktiv mit Belegung.
- **Betreuung:** Betreuungsstelle „Gesamtschule“ in Betrieb mit zwei Belegungsmeldungen.
  Evakuierungsbezirk „Mühlbachweg 1–40“ mit Plangröße und zwei Standmeldungen. Er belegt
  den Lageplatz „Evakuiert“.
- **Lagekarte:** zwei Gefahrengebiete (Überflutung Unterstadt: Warnstufe hoch · Hangrutsch
  Kirchberg: mittel) mit validierter Polygon-Geometrie um fiktive Koordinaten (Mitte
  Deutschlands, kein realer Ortsbezug), Abschnitte und UHS verortet.
- **Kommunikation:** acht Meldungen (Lage, Rückmeldung, eine Sofortmeldung **bestätigt**),
  fünf Aufträge (drei erledigt, zwei offen **ohne** abgelaufene Frist), ein freigegebener
  Befehl, ein freigegebener Lagebericht (`zeitstand` T−1 h), drei Erinnerungen: zwei
  vergangene **erledigt**, eine in +20 min (Vorführ-Alarm).
- **ETB:** dazwischen Einträge vom Typ Lage und Entscheidung (Pflicht-Typen aus der Spec).

Die Aufzählung ist die Vorgabe für den Bau, keine Behauptung über fertige Daten. Die Zahlen
sind in `szenario.rs` die einzige Quelle, und der Bericht leitet sich daraus ab.

### D10 — Alarmbudget

Nach EEMUA 191 (CLAUDE.md: Live-Updates) darf der Import beim ersten Scheduler-Takt nichts
auslösen. Vergangene Erinnerungen werden als erledigt angelegt (oder mit
`zuletzt_ausgeloest_at >= faellig_at`, je nachdem, was `erinnerung/repo.rs` als
„nicht mehr fällig“ liest). Die eine Sofortmeldung ist bestätigt, und kein offener Auftrag
hat eine abgelaufene Frist. Belegt wird das durch den Spec-Test, der nach dem Import
den Takt des Erinnerungs-Schedulers einmal direkt ruft und null Auslösungen zählt. Von den
Hintergrundschleifen in `main.rs` (Erinnerung, Purge, Backup, KRITIS) alarmiert nur der
Erinnerungs-Scheduler. Er trägt auch Eskalation und Ablösung. Ob die überfällige
Rückmeldung einen Alarm auslöst oder nur als Zustand im Meldebild steht, wird beim Bau
gemessen. Löst sie einen aus, bekommt sie eine Frist, die knapp nicht abgelaufen ist.

### D11 — Neu importieren

Ein `write_retry!` mit `entfernen_tx` gefolgt von `importieren_tx`. Scheitert der Import,
rollt auch das Entfernen zurück, und der alte Stand bleibt. Die Schreibsperre wird länger
gehalten, was bei Demogröße im Bereich unter einer Sekunde liegt. Das wird im Test
gemessen und im Bericht des Tasks notiert. Ohne aktiven Import läuft nur `importieren_tx`.

### D12 — „DB wie vorher“ als Zeilenmengen-Vergleich

Der Test `import_entfernen_stellt_den_stand_wieder_her` liest vor dem Import alle Tabellen
aus `sqlite_master` (`type = 'table'`) als sortierte Zeilenmenge (`SELECT * … ORDER BY
rowid`), außer: `sqlite_*`, `_sqlx_migrations`, `etb_eintrag_fts*`, `session`,
`auth_audit`, `benutzer_einstellungen` und `demo_import`. Nach Import und Entfernen muss
jede dieser Mengen gleich sein. Die Tabellenliste wird aus dem Schema **entdeckt**, nicht
aufgezählt: Eine künftige Tabelle ist damit ohne Nachtrag geprüft, und der AK „gegen das
aktuelle Schema“ ist strukturell erfüllt.

### D13 — Frontend

- **Sektion als Sonderfall neben `adminBenutzer`** (`admin/adminNav.tsx`), sichtbar nur bei
  `istSystemAdmin` **und** Status 200. Die Seite schützt sich selbst mit derselben
  Umleitung wie `BenutzerPage`. Die Registry-Zähltests werden bewusst nachgezogen. Ein
  allgemeines Rollenprädikat an `AdminSektion` beträfe alle 16 Sektionen und ist nicht
  nötig.
- `api/demoDaten.ts` über `apiGet`/`apiSend` mit generierten Typen, `GLOBAL_KEYS.demoDaten
  = 'demo-daten'` samt Byte-Pin (Zählung 23 → 24).
- **Seite** `admin/DemoDatenPage.tsx`: `AdminPage` mit genau einer Primäraktion im Kopf
  („Importieren“, ohne aktiven Import). Bei aktivem Import stehen „Neu importieren“ und
  „Entfernen“ im Inhalt beim Status, beide `danger`, beide über ein `Modal` mit
  `okButtonProps={{ danger: true }}` (LFH-363, unumkehrbar). Der Bericht als
  `Datenraster`, Fehler über `SeitenHinweise`/`SpeicherFehler`, Erfolg als Toast, ein
  Riegel `sendetRef` in der Absende-Funktion.
- `onSuccess`: `globalKeys.einsaetze()`, `demoDaten()`, die Stammdaten-Prefixe (`fahrzeuge`,
  `personal`, `material` samt Vorschlägen) und per Prädikat alle `einsatzKeys` der
  betroffenen Demo-Einsatz-ID invalidieren. Kein `removeQueries` (das löste die
  XOR-Auflage in `queryKeys.ts` aus).
- **Einsatzliste:** Ein `Alert type="info"` über dem Raster, nur bei `istSystemAdmin`,
  Status 200 und `importiert = false`, mit Link auf `/admin/demo-daten`, also Sprung und
  kein Direktimport. Das Ticket schlägt den Leerzustand vor. Der ist aber seit LFH-331/AK3
  aktionslos gepinnt und rechnet je Benutzer. „Nicht importiert“ ist eine Aussage über
  die Organisation. Der Hinweis steht deshalb daneben und nicht im Leerknoten. Das ist eine
  **benannte Abweichung** vom Ticketwortlaut.
- **MSW-Default-Handler** in `test/server.ts`: `GET /api/demo-daten` → 404, also der echte
  Serverzustand ohne Freischaltung. Ohne ihn fallen rund 30 Tests der `EinsaetzePage` an
  `onUnhandledRequest: 'error'`.

### D14 — Prüfliste und e2e

Die e2e-Suite startet ihr Backend für alle Specs mit einer Kommandozeile
(`playwright.config.ts`). `--demo-daten` dort zu setzen, zeigte den Hinweis in jedem Spec,
der die Einsatzliste als Admin öffnet. Die Abdeckung läuft deshalb über Rust-
Integrationstests und Vitest. Die Prüfliste (15 Kriterien) wird im Browser gegen einen
Dev-Stack mit `--demo-daten` gemessen und liegt als `pruefliste.md` in diesem
Change-Verzeichnis. `docs/superpowers/` ist eingefrorenes Archiv.

## Risks / Trade-offs

- **[Split fasst produktive Repos an]** → mechanisch, Pool-Varianten unverändert, deren
  Bestandstests als Netz. Ein Split je Commit, damit ein Bruch zuzuordnen ist.
- **[Löschweg auf Knopfdruck]** → ID ausschließlich aus der Marke, Org im WHERE,
  Negativtest „Entfernen mit echtem Nachbar-Einsatz lässt ihn zeilengleich stehen“, Guard
  gegen kaskadierende Stammdaten-FKs, Warnung beim Start.
- **[ID-Sperre ändert jede Einsatzanlage]** → ohne Historie identisch mit SQLites Vergabe.
  Ein Test zeigt „Sperre greift“ und einer „ohne Historie keine Lücke“.
- **[Einsatznummer]** → Der Demo-Einsatz verbraucht eine Nummer aus dem Kreis der
  Organisation. Nach dem Entfernen entsteht eine Lücke, falls inzwischen ein echter
  Einsatz angelegt wurde, sonst wird sie wiederverwendet. Hingenommen: Die Nummer ist
  menschenlesbar und kein Schlüssel. Der Vergabeweg bleibt der des Betriebs (LFH-617).
- **[Nicht setzbare Zeitstempel]** → „seit 0 min“ im Meldebild, siehe D9. Hingenommen.
- **[Demo-Stammdaten in echten Auswahllisten]** → D7 fängt den Fall beim Entfernen ab. Eine
  Anzeigemarke ist ein Nachzug.
- **[Andere Clients sehen den Import verzögert]** → kein org-weiter Kanal, Nachzug.
- **[Szenario veraltet mit dem Schema]** → D12 entdeckt Tabellen, und der
  Import→Entfernen→Import-Test läuft in jedem `cargo test`.
- **[Migrationsnummer]** → `0121` ist beim Planen frei. Direkt vor dem PR laufen
  `git fetch` und `scripts/check-migrationen.sh`, bei Bedarf `--umnummerieren`.

## Migration Plan

Eine angehängte Migration mit zwei neuen Tabellen, ohne Rebuild und ohne Änderung an
Bestandstabellen. Rückweg: Die Tabellen stehen leer, solange niemand importiert. Ohne
Schalter sind sie unerreichbar. Die ID-Vergabe in `anlegen_tx` ist ohne Einträge in
`demo_import` wertgleich zur bisherigen.

## Open Questions

Keine, die den Bau blockiert. Beim Bau zu messen und hier nachzutragen: (a) wie
`schwaerzung_registry` eine Tabelle mit `einsatz_id` ohne FK entdeckt (D4), (b) welches
Feld `erinnerung/repo.rs` als „nicht mehr fällig“ liest (D10), (c) die Dauer des
Neu-Imports (D11).

**Ergebnis (a), gemessen in Block 2 (Task 2.2):** `entdecke_einsatz_scoped` im Testmodul
von `src/einsatz/schwaerzung_registry.rs` nimmt jede Tabelle mit einer **Spalte** namens
`einsatz_id` in die Menge S auf; ob die Spalte ein Fremdschlüssel ist, prüft sie nicht.
`demo_import` wird dadurch trotz fehlendem FK entdeckt. Danach zieht die CASCADE-Hülle eine
zweite Tabelle nach, die der Plan nicht nannte: `demo_herkunft` hängt über
`import_id … ON DELETE CASCADE` an `demo_import` und liegt damit ebenfalls in S. Der rote
Lauf nach dem Anlegen von `0121` nannte beide Tabellen (`nur entdeckt: ["demo_herkunft",
"demo_import"]`). Beide stehen jetzt in der Registry, alle Spalten `retain`:
`demo_import` mit `Scoping::EinsatzId`, `demo_herkunft` mit
`Scoping::UeberParent { fk: "import_id", parent: "demo_import" }`. Da keine Spalte `Scrub`
trägt, erzeugt `scrubbe_aus_registry` für die beiden Tabellen kein Statement. Der Guard
`stammdaten_teilbaum_nie_einsatz_scoped` bleibt grün, weil `demo_herkunft` keinen FK auf
`fahrzeug`/`personal`/`material` hat.

**Ergebnis (b), gemessen in Block 3b (Task 3.5):** Der Scheduler-Takt
(`erinnerung::scheduler::tick_einmal`, `src/erinnerung/scheduler.rs:33`) liest ausschließlich
`erinnerung::repo::faellige_zum_ausloesen` (`src/erinnerung/repo.rs:199`). Ausgelöst wird eine
Zeile nur, wenn **alle drei** Bedingungen gelten: `status = 'offen'`, `faellig_at <= jetzt` und
`zuletzt_ausgeloest_at IS NULL OR zuletzt_ausgeloest_at < faellig_at`. Jede der beiden
Varianten aus D10 genügt also: `status` erledigt/quittiert oder `zuletzt_ausgeloest_at >=
faellig_at`. Einfacher ist erledigt. Es ist der Zustand, den auch `schliesse_offene_auto_tx`
beim Bestätigen einer Meldung schreibt. **Lücke für den Import:** `anlegen_tx` legt immer
`offen` an, und `status_setzen` (`:141`) sowie `markiere_ausgeloest` (`:219`) nehmen nur den
Pool. Der Import braucht für eine vergangene Erinnerung also ein `status_setzen_tx` (oder einen
eigenen `_tx`-Split). Das ist nicht Teil von 3.5.

Die übrigen Alarme hängen am selben Takt und an derselben Tabelle. Einen eigenen Timer gibt es
nicht, Quelle ist immer eine `erinnerung`-Zeile:
- **Eskalation einer Sofortmeldung:** nur über eine Auto-Frist mit `bezug_typ='meldung'`
  (`scheduler.rs:52`) und danach `meldung::repo::setze_eskaliert` (`src/meldung/repo.rs:475`),
  das zusätzlich `bestaetigung_pflicht = 1`, `eskaliert = 0`, abgelaufene
  `bestaetigung_frist_at` und fehlende Quittung verlangt. Die Auto-Frist entsteht nur im
  Handler (`routes/meldung.rs:180`, `stelle_meldung_auto_frist_sicher`, ebenfalls mit
  Quittungs-Guard) und nicht in `meldung::repo::anlegen_tx`. Eine bestätigt angelegte
  Sofortmeldung erzeugt im Import also weder Erinnerung noch Eskalation.
- **Auftrags-Quittierfrist:** ebenfalls nur im Handler (`routes/auftrag.rs:124`,
  `anlegen_aus_frist`), nicht in `auftrag::repo::anlegen_tx`.
- **Ablösung (LFH-635):** `abloesung::repo::setze_fristen_tx` (`src/abloesung/repo.rs:280`)
  setzt die Frist „Ablösung fällig“ **unbedingt** auf `faellig_at = beginn + rhythmus`. Nur die
  Vorwarnung wird geschlossen, wenn sie schon hinter `jetzt` liegt. Eine Schicht, deren
  Fälligkeit beim Import in der Vergangenheit liegt, löst beim ersten Takt aus (`scheduler.rs:89`,
  Event `abloesung`). Das Szenario braucht deshalb Schichten, deren Fälligkeit nach „jetzt“ liegt.
- **Überfällige Rückmeldung (LFH-610):** kein Scheduler-Pfad. `faellig_at` wird beim Lesen in
  `GET …/meldungen/rueckmeldungen` berechnet (`routes/meldung.rs:547`,
  `effektive_rueckmeldung_frist_min`) und steht nur als Zustand im Meldebild. Die in D10
  vorgesehene „knapp nicht abgelaufene“ Frist ist dafür nicht nötig.
