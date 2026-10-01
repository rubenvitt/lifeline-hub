# Proposal

## Why

Ausgaben an einer Verpflegungsstelle werden oft am Deich erfasst, und dort ist das Netz nicht
verlässlich. Seit LFH-634 gibt es für die Erfassung einer Ausgabe keinen Offline-Weg. Bricht die
Verbindung ab, ist die Ausgabe verloren. Dann fehlt sie in der Deckung, und das Modul meldet eine
Unterdeckung, die es nicht gibt. Ein Timeout nach dem Commit mit anschließendem zweiten Senden
erzeugt dagegen eine zweite Zeile, und die Deckung steht zu hoch. LFH-634 hat die Offline-Queue
für v1 bewusst ausgeklammert (Entscheidung des Auftraggebers vom 24.09.2026,
`design.md`, Non-Goals). Diese Änderung holt sie nach. Vorbild ist LFH-675 (Stand- und
Belegungsmeldungen offline).

## What Changes

- `verpflegung_ausgabe` bekommt per `ADD COLUMN` eine nullable `client_id` mit partiellem UNIQUE
  `(einsatz_id, client_id) WHERE client_id IS NOT NULL`. Die Migration hängt an, ihre Nummer ist
  größer als jede auf `alpha` (LFH-658).
- `POST …/verpflegung/zeitfenster/{zid}/ausgaben` nimmt ein optionales `client_id` an. Ein Replay
  mit bekannter `client_id` liefert die bestehende Ausgabe samt aktuellem Zeitfenster zurück. Es
  entsteht keine zweite Zeile und kein zweites Live-Ereignis. Der Replay-Lookup läuft vor der
  Aktiv-Prüfung. Eine schon gespeicherte Ausgabe kommt deshalb auch nach dem Einsatzende zurück.
- Die Route prüft den Offline-Queue-Benutzer-Header wie Personen, Meldungen und
  Betreuungsmeldungen.
- Frontend: Die Offline-Queue kennt die neue Schreibaktion `ausgabe`. Der Dialog „Ausgabe
  erfassen“ sendet offline-fähig. Ohne Verbindung wird die Ausgabe mit dem Erfassungszeitpunkt
  vorgemerkt und beim nächsten Flush gesendet. Eine vorgemerkte Ausgabe bekommt einen
  Warnhinweis **ohne** „Rückgängig“, denn auf dem Server gibt es sie noch nicht.
- Die Zeitfensterkarte zeigt vorgemerkte Ausgaben dieses Geräts als „ausstehend“. Sie zählen
  nicht in Ausgegeben, Fehlmenge und Einstufung, bis der Server sie bestätigt hat.
- Abgelehnte Ausgaben erscheinen im Wiederherstellungs-Drawer als „Abgelehnte
  Verpflegungsausgabe: ‹Zeitfenster›“.

Nicht offline-fähig bleiben Anlegen, Ändern und Löschen von Zeitfenstern und die Rücknahme einer
Ausgabe.

## Capabilities

### New Capabilities

_keine_

### Modified Capabilities

- `kraefte-verpflegung`: Neue Anforderung „Offline-Erfassung von Ausgaben“. Sie regelt die
  Idempotenz über `client_id`, den Replay vor der Aktiv-Prüfung, die Queue im Client und die
  Kennzeichnung „ausstehend“ außerhalb der Deckung.

## Impact

- **Datenbank:** neue Migration `0132_verpflegung_ausgabe_client_id.sql` (Stand Entwurf; die
  Nummer bestätigt `scripts/check-migrationen.sh`). Sie enthält ein `ADD COLUMN` und einen
  partiellen UNIQUE-Index, aber keinen Rebuild.
- **Backend:** `src/verpflegung/repo.rs` (`AusgabeEingabe.client_id`, `laden_nach_client_id`,
  Replay-Zweig in `ausgabe_erfassen_tx`, `AusgabeGeschrieben.neu`), `src/routes/verpflegung.rs`
  (Request-DTO, Gate `EinsatzSchreibfreigabe<Verpflegung>`, Header-Prüfung, Live-Ereignis nur
  bei neuer Ausgabe), `src/einsatz/schwaerzung_registry.rs` (`client_id` als `retain`,
  `G_IDEMPOTENZ`), `src/einsatz/purge_scheduler.rs` (Testaufrufer übergibt `None`).
- **API/Codegen:** Der Request-DTO ist handgepflegt, ein Response-Schema-Diff entsteht nicht.
  `frontend/src/api/types.ts` bekommt `client_id?` an `AusgabeEingabe`.
- **Frontend:** `api/verpflegung.ts`, `offline/queue.ts`, `offline/schreiben.ts`,
  `offline/useOfflineSync.ts`, `offline/OfflineRecoveryDrawer.tsx`, ein neuer Hook für
  vorgemerkte Ausgaben in `offline/`, `verpflegung/ZeitfensterKarte.tsx`,
  `pages/VerpflegungPage.tsx`.
- **Doku:** `frontend/src/betreuung/AGENTS.md` (Zeile Verpflegung), Verweis im Non-Goal von
  `openspec/changes/archive/2026-09-29-lfh-634-fachmodul-verpflegung/design.md`.
- **Nicht betroffen:** Modulschlüssel, Live-Ereignisse, Query-Key-Klassen und die
  IndexedDB-Version bleiben, wie sie sind.
