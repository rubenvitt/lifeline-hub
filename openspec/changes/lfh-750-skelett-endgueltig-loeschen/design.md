# Design

## Context

Der Purge-Scheduler (`src/einsatz/purge_scheduler.rs`) läuft alle 10 Minuten mit vier
Schritten: Phase A (Vormerkung), Phase B (Schwärzung nach 30 Tagen Karenz), Phase C (Purge
abgelaufener Einträge aus `auth_audit`), dann der WAL-Rückschrieb, wenn Phase B etwas
geschwärzt hat (LFH-725). Jede Mutation der Aufbewahrung schreibt ihren Audit ins ETB des
Einsatzes (`einsatz::repo::system_audit_tx`). Der Akteur kommt aus `ermittle_system_akteur`
(abschließende Person → Einsatzleitung → System-Admin der Org), und ohne Akteur gibt es einen
Fehler und einen Rollback (fail-closed).

Für die endgültige Löschung braucht es diese Fakten:

- **Die Kaskade ist vollständig.** Alle Fremdschlüssel auf `einsatz(id)` sind
  `ON DELETE CASCADE`. `demo_import.einsatz_id` trägt bewusst keinen FK. Einen harten
  Löschweg gibt es schon: `demo::entfernen_tx` löscht einen Demo-Einsatz samt ETB, auch einen
  geschwärzten. GUARD 5 der Registry (`guard5_keine_fk_kante_von_aussen_nach_s`) stellt sicher,
  dass keine Kante von außen auf die einsatzbezogene Menge zeigt.
- **Die physische Entfernung ist vorhanden.** `secure_delete = ON` gilt auf jeder Verbindung,
  und `db::wal_zurueckschreiben` tilgt den Vorzustand aus dem WAL.
- **Die ID-Vergabe ist eine Falle.** `einsatz::repo::anlegen_tx` vergibt
  `MAX(MAX(einsatz.id), MAX(demo_import.einsatz_id)) + 1`. Wird der Einsatz mit der höchsten ID
  gelöscht, bekäme der nächste Einsatz seine ID. Offline-Queues und offene Tabs schrieben dann
  still in einen fremden Einsatz (Begründung in LFH-690 D6).
- **Die Nummernvergabe ist ebenfalls eine Falle.** Die laufende Einsatznummer ist
  `MAX(nummer_lfd) + 1` je Org und Jahr (`einsatz::repo`, Zeile ~96). Ist der gelöschte Einsatz
  der letzte seines Jahres, wäre seine Nummer wieder frei, solange in diesem Jahr noch Einsätze
  angelegt werden.
- **Die Org-Einstellungen sind ein Voll-PUT** (`routes::org_einstellungen::setzen`,
  `OrgEinstellungenUpdate`). Ein fehlendes Feld bedeutet `NULL`. Die Validierung steht in Rust,
  nicht als DB-CHECK.
- **Die Übersicht** (`aufbewahrung::repo::uebersicht`) liest nur `einsatz` und leitet den
  Zustand über `einsatz::retention::zustand` ab. `AufbewahrungEintragAnzeige.bezeichnung` ist
  heute ein `String`, also Pflicht.
- **Die Klassifikations-Registry** entdeckt jede Tabelle mit einer Spalte `einsatz_id`
  (`entdecke_einsatz_scoped`). Eine neue Tabelle mit dieser Spalte braucht deshalb einen
  Registry-Eintrag, sonst wird die Suite rot.

## Goals / Non-Goals

**Goals:**
- Ein geschwärztes Skelett ist nach der Skelett-Frist vollständig und physisch weg (Spec
  `aufbewahrung`).
- Die Löschung bleibt ohne ETB nachweisbar, über das Löschprotokoll.
- ID und Einsatznummer sind auch nach der Löschung gesperrt.
- Ohne gesetzte Org-Einstellung ändert sich kein Verhalten.

**Non-Goals:**
- Eine Skelett-Frist je Einsatz, eine je Datenkategorie oder eine Sofort-Löschung auf Antrag
  (Art. 17). Das bleibt eigenen Tickets vorbehalten.
- Statistische Kennzahlen vor der Löschung retten (am Checkpoint verworfen).
- Das Löschprotokoll selbst befristen. Es trägt keine Personendaten im engeren Sinn, nur
  Nummer, Zeitpunkte und die Benutzer-ID des Akteurs (s. Risiken).
- Sicherungen nachträglich bereinigen. Es gilt dieselbe Haltung wie bei LFH-725: Betreiber
  und Doku sind zuständig.
- Live-Ereignisse. Der gelöschte Einsatz ist seit der Vormerkung gesperrt und steht in keiner
  Einsatzliste. Wie Phase B meldet die Löschung nichts.

## Decisions

### D1. Skelett-Frist als Org-Einstellung `skelett_dauer_tage`, ab Abschluss, opt-in

Die neue Spalte `org_einstellungen.skelett_dauer_tage INTEGER` (NULL bedeutet unbegrenzt)
kommt in `OrgEinstellungen`, `OrgEinstellungenAnzeige`, `OrgEinstellungenUpdate` und
`OrgEinstellungenDaten`. Gültig sind 1 bis 36500 Tage (`ist_gueltige_skelett_dauer`), sonst
400. Fällig ist ein Einsatz bei
`loeschung_am = max(abgeschlossen_at + skelett_dauer_tage, geschwaerzt_at)`. Berechnet wird
das live aus der aktuellen Einstellung und nicht beim Schwärzen eingefroren.

- *Warum ab Abschluss:* Gesetzliche Höchstfristen zählen ab Einsatzende. Ab Schwärzung wäre
  die Gesamtdauer Aufbewahrung + 30 Tage + N, und die ließe sich schwer gegen eine Höchstfrist
  prüfen (Checkpoint-Entscheidung).
- *Warum live statt eingefroren:* Ändert sich die Rechtslage oder die Einstellung, gilt die
  neue Frist für den ganzen Bestand. Das ist auch der Grund, warum ein zurückgespieltes
  Skelett wieder gelöscht wird. *Verworfen: Frist beim Schwärzen in `einsatz` einfrieren.* Das
  braucht eine weitere Spalte, und eine spätere Verkürzung griffe nicht.
- *Verworfen: Einsatz-Override.* Kein Bedarf benannt. Er bräuchte zudem eine Schreibstelle an
  einem gesperrten Einsatz, und gerade die schließt das Archiv aus.
- *Verworfen: Vorgabe 10 Jahre statt NULL.* Bestandsskelette würden mit dem Update ohne
  Zutun fällig (Checkpoint-Entscheidung: opt-in).

### D2. Bestätigung beim Setzen und Verkürzen über `skelett_dauer_bestaetigt`

`OrgEinstellungenUpdate` bekommt `#[serde(default)] skelett_dauer_bestaetigt: bool`. Liest
`setzen` den alten Wert, und ist der neue Wert gesetzt, während der alte `NULL` war oder
größer ist, dann antwortet es ohne Bestätigung mit **409** (`AppError::Conflict`) und
schreibt nichts. Das gleicht dem Muster `ist_fristverkuerzung` + `bestaetigt` der Einsatzfrist
(`routes::einsatz`, Spec `aufbewahrung`, „Manuelle Frist“) und folgt der
Statuscode-Konvention in `src/AGENTS.md`. Gleich lassen, verlängern oder leeren braucht keine
Bestätigung. Das Frontend zeigt den Dialog **vor** dem Absenden, weil es alten und neuen Wert
kennt, und schickt dann `true`. Die 409 ist das Netz für andere Clients.

- *Verworfen: keine Bestätigung.* Ein Tippfehler (365 statt 3650) löschte innerhalb von
  10 Minuten unumkehrbar Jahrgänge. Jede andere unumkehrbare Verkürzung im System verlangt
  eine Bestätigung.
- *Verworfen: Anzahl der sofort fälligen Skelette im Dialog.* Das wäre nützlich, braucht aber
  einen eigenen lesenden Endpunkt. Die Übersicht zeigt nach dem Speichern „Löschung am“ für
  jede Zeile. Bleibt als Nachzug möglich.

### D3. Phase D im Purge-Lauf, nach Phase C, vor dem Rückschrieb

Ein neuer Schritt `--- Phase D: endgültige Löschung geschwärzter Skelette ---` ruft
`skelett_loeschung::faellige(pool, jetzt)` auf und löscht je Kandidat mit
`skelett_loeschung::loeschen(pool, id, jetzt)`. Beides liegt in einem eigenen Modul
`src/einsatz/skelett_loeschung.rs`, weil `repo.rs` schon über 3600 Zeilen hat;
`repo::ermittle_system_akteur` wird dafür `pub(super)`. Der Rückschrieb läuft, wenn
`geschwaerzt + geloescht > 0 || rueckschrieb_ausstehend`. Phase B und C behalten ihre Namen,
Log-Zeilen werden nicht umbenannt.

Die Kandidatenabfrage joint `einsatz` mit `org_einstellungen`:
`status = 'abgeschlossen' AND geschwaerzt_at IS NOT NULL AND skelett_dauer_tage IS NOT NULL`.
Das Fälligkeitsdatum wird in Rust geprüft (`retention::skelett_loeschung_am`,
`skelett_loeschung_faellig`), genau wie die Karenz in Phase B. Ein unparsebarer Zeitstempel
zählt dort defensiv als nicht fällig.

`loeschen` arbeitet in **einer** `BEGIN IMMEDIATE`-Transaktion (`write_retry!`, denn der erste
Zugriff liest):
1. Den Einsatz erneut mit allen Bedingungen laden (geschwärzt, abgeschlossen, Org-Frist
   gesetzt und fällig). Fehlt er, gibt es `Ok(false)` (Race, oder ein Admin hat die Frist
   inzwischen geleert).
2. Den Akteur über `ermittle_system_akteur` bestimmen. Fehlt er, gibt es einen Fehler und
   einen Rollback (fail-closed, Text wie bei `system_audit_tx`, mit Org-ID).
3. Die Protokollzeile einfügen (D4).
4. Die FK-Prüfung sicherstellen: `demo::entfernen::fk_pruefung_sicherstellen` wird dafür nach
   `crate::db` gehoben und bekommt den Zweck als Parameter für die Fehlermeldung. Dann
   `DELETE FROM einsatz WHERE id = ? AND status = 'abgeschlossen' AND geschwaerzt_at IS NOT NULL`. Erwartet
   wird genau 1, sonst Fehler und Rollback.
5. Commit.

Vor jedem Kandidaten steht ein `tracing::warn!` mit dem Hinweis „unumkehrbar“, wie in
Phase B.

- *Verworfen: Löschung als Teil von Phase B.* Die Schwärzung hat ihren eigenen Audit und
  ihre Idempotenz. Ein eigener Schritt bleibt einzeln testbar. Fallen beide Fristen in
  denselben Lauf, löscht Phase D direkt nach Phase B. Das deckt die Spec ab („frühestens in
  dem Lauf, der ihn schwärzt“).
- *Verworfen: `demo::entfernen_tx` wiederverwenden.* Es ist an den Demo-Kopf gebunden und
  räumt Stammdaten-Marken. Übernommen wird nur das Muster (Org in jedem WHERE, FK-Prüfung).

### D4. Löschprotokoll `aufbewahrung_loeschprotokoll`

Migration `0135_aufbewahrung_skelett_loeschung.sql`. Die Nummer bleibt größer als jede auf
`origin/alpha`, vor dem PR prüft das `scripts/check-migrationen.sh`.

```sql
ALTER TABLE org_einstellungen ADD COLUMN skelett_dauer_tage INTEGER;  -- NULL = unbegrenzt

CREATE TABLE aufbewahrung_loeschprotokoll (
    id                   INTEGER PRIMARY KEY,
    org_id               INTEGER NOT NULL REFERENCES organisation(id) ON DELETE CASCADE,
    einsatz_id           INTEGER NOT NULL UNIQUE,   -- bewusst ohne FK: ID-Sperre
    einsatznummer_intern TEXT,
    nummer_jahr          INTEGER,                   -- Nummernsperre (D5)
    nummer_lfd           INTEGER,
    abgeschlossen_at     TEXT,
    geschwaerzt_at       TEXT NOT NULL,
    geloescht_at         TEXT NOT NULL,             -- Zeitpunkt der endgültigen Löschung
    skelett_dauer_tage   INTEGER NOT NULL,          -- angewandte Frist
    akteur_id            INTEGER NOT NULL REFERENCES benutzer(id)
);
CREATE INDEX idx_aufbewahrung_loeschprotokoll_org ON aufbewahrung_loeschprotokoll(org_id);
```

- `einsatz_id UNIQUE`: Ein Restore von vor der Löschung, gefolgt von einer erneuten Löschung,
  findet die alte Zeile nicht vor, weil die Sicherung sie nicht enthält. Eine Doppelzeile
  wäre ein Fehler, und die Transaktion rollt zurück.
- `akteur_id` ohne Kaskade: Benutzer werden im System deaktiviert, nie gelöscht (es gibt kein
  `DELETE FROM benutzer`).
- **Registry-Eintrag** in `schwaerzung_registry.rs`: Die Tabelle hat die Spalte `einsatz_id`
  und wird deshalb entdeckt. Alle Spalten sind Retain, mit Begründung, nach dem Präzedenzfall
  `demo_import`. Zur Schwärzung eines Einsatzes existiert die Zeile nie, denn sie entsteht
  erst bei dessen Löschung.
- *Verworfen: Bezeichnung mitschreiben* (Checkpoint-Entscheidung, sie kann Personenbezug
  tragen).
- *Verworfen: nur `tracing`.* Das ist kein prüfbarer Nachweis für den Admin.

### D5. ID- und Nummernsperre über das Protokoll

`anlegen_tx` nimmt `MAX(einsatz_id)` aus `aufbewahrung_loeschprotokoll` in das bestehende
`MAX(...)` auf. Die Nummernvergabe (`SELECT MAX(nummer_lfd) …`) nimmt das Protokoll derselben
Org und desselben Jahres hinzu (`UNION ALL` bzw. ein zweites `MAX`). Damit gilt die Regel
„Einsatz-IDs werden nie wiederverwendet“ in `src/AGENTS.md` auch über die Löschung hinweg.

- *Verworfen: Mindestfrist von 366 Tagen statt Nummernsperre.* Das deckt die ID nicht ab, und
  die Zeitzonengrenze des Jahres macht die Rechnung brüchig.

### D6. Zustand und Übersicht

`AufbewahrungZustand` bekommt `LoeschungAusstehend` (`loeschung_ausstehend`) und
`EndgueltigGeloescht` (`endgueltig_geloescht`). `retention::zustand` bekommt die Skelett-Frist
der Org als Parameter. Die Rangfolge ist geschwärzt + fällig → `loeschung_ausstehend`, sonst
`geschwaerzt`, dann wie bisher. `EndgueltigGeloescht` leitet `zustand` nie ab. Ihn setzt nur
die Übersicht für Protokollzeilen.

`AufbewahrungEintragAnzeige`:
- `bezeichnung: Option<String>` (**DTO-Änderung**), `None` nur bei Protokollzeilen,
- neu `loeschung_am: Option<String>` (aus D1, nur mit Org-Frist),
- neu `endgueltig_geloescht_at: Option<String>`.

`uebersicht` lädt einmal die Org-Einstellung, dann die Einsatzzeilen wie bisher plus die
Protokollzeilen der Org (`WHERE org_id = ?`). Sortiert wird nach `abgeschlossen_at DESC` über
beide Mengen. Die Archivakte eines gelöschten Einsatzes liefert über `fordere_archivzugriff`
404 (unbekannter Einsatz), daran ändert sich nichts.

Frontend (`AufbewahrungUebersicht.tsx`): Statusetiketten und Filter für die zwei neuen
Zustände, eine Spalte „Löschung am“ (über `filterZeit`, wie die übrigen Zeitspalten), keine
Zeilenaktion und kein Link bei `endgueltig_geloescht`. Anstelle der Bezeichnung steht dort
„endgültig gelöscht“. Die Gestaltungsregeln (Statusetikett mit Wort, Farbrollen) stehen in
`frontend/AGENTS.md`.

### D7. Einstellungsseite

In `EinsatzDefaults.tsx`, Abschnitt „Aufbewahrung“, kommt unter die Aufbewahrungs-Dauer ein
zweites Feld „Skelett endgültig löschen nach (Tage ab Abschluss)“, mit Tooltip „1 bis 36500
Tage. Leer = das pseudonyme Skelett bleibt unbegrenzt erhalten.“ `orgEinstellungenForm.ts`
übernimmt das Feld in den Voll-PUT. Ist der Wert neu gesetzt oder verkürzt, öffnet sich vor
dem Absenden ein Bestätigungsdialog („Skelette, deren Frist danach abgelaufen ist, werden
binnen 10 Minuten unwiderruflich gelöscht.“). Erst dann geht der PUT mit
`skelett_dauer_bestaetigt: true` raus.

## Risks / Trade-offs

- [Tippfehler bei der Frist löscht Jahrgänge] → Bestätigung in UI und Server (D2). „Löschung
  am“ in der Übersicht macht die Wirkung vorher sichtbar, sobald die Frist steht.
- [Ein Voll-PUT eines älteren Clients ohne das neue Feld leert die Skelett-Frist] → Leeren
  ist die sichere Richtung, es wird nichts gelöscht. Das Frontend liefert das Feld immer mit.
- [Die Akteurskette findet nach Jahren nur deaktivierte Benutzer] → `ermittle_system_akteur`
  bevorzugt aktive Admins (`ORDER BY b.aktiv DESC`), nimmt aber auch inaktive. Das ist für
  einen Audit-Akteur ausreichend und entspricht Phase A/B.
- [Ein Admin leert die Frist kurz vor dem Lauf] → `loeschen` prüft die Fälligkeit in
  der Transaktion erneut (D3, Schritt 1).
- [Das Löschprotokoll wächst unbegrenzt] → Eine Zeile je gelöschtem Einsatz, ohne Freitext.
  Mengenmäßig vernachlässigbar. Eine eigene Frist dafür ist ein Non-Goal.
- [Die Benutzer-ID im Protokoll ist ein Personenbezug] → Sie bezeichnet den verantwortlichen
  Admin, nicht einen Betroffenen, und die Rechenschaftspflicht nach Art. 5 Abs. 2 DSGVO
  rechtfertigt sie.
- [Eine Sicherung bringt gelöschte Skelette zurück] → Der nächste Lauf löscht sie erneut
  (D1, live). Ein Test belegt das. Ist die Frist inzwischen geleert, bleiben sie, und das ist
  dann gewollt.
- [Die Löschung eines großen Einsatzes hält die Schreibsperre] → Gleiche Größenordnung wie die
  Schwärzung, die dieselben Zeilen schon angefasst hat. Gelöscht wird je Einsatz in einer
  eigenen Transaktion.

## Migration Plan

1. Die Migration `0135` fügt die Spalte (NULL) und die leere Tabelle hinzu. Ohne Einstellung
   gibt es keine Verhaltensänderung, und es läuft keine Datenmigration.
2. Rollback: Die alte Binary ignoriert Spalte und Tabelle. Schon gelöschte Skelette bleiben
   gelöscht, das ist gewollt und unumkehrbar.
3. `docs/betrieb/backup-restore.md` bekommt einen Satz: Ein Restore bringt gelöschte Skelette
   bis zum nächsten Purge-Lauf zurück.
