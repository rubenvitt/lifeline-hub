# Proposal

## Why

Stand- und Belegungsmeldungen kommen von Evakuierungstrupps und Betreuungsstellen, also vom
Handschirm und oft ohne stabile Verbindung. Seit LFH-639 gibt es für diese Meldungen keinen
Offline-Weg: Bricht die Verbindung ab, ist die Meldung verloren, oder sie wird nach einem
Timeout, der den Commit schon hinter sich hat, ein zweites Mal gesendet und erzeugt eine
zweite Zeile samt zweitem ETB-Eintrag. LFH-639 hat die `client_id`-Spalte bewusst
weggelassen (design.md, Non-Goals), weil eine Spalte ohne Queue ein ungetesteter Vertrag
wäre. Dieser Nachzug liefert beides zusammen.

## What Changes

- `evakuierung_stand` und `betreuungsstelle_belegung` bekommen per `ADD COLUMN` eine
  nullable `client_id` mit partiellem UNIQUE `(einsatz_id, client_id) WHERE client_id IS NOT NULL`.
  Die Migration hängt an (Nummer größer als jede auf `alpha`, LFH-658).
- `POST …/betreuung/bezirke/{bid}/staende` und `POST …/betreuung/stellen/{sid}/belegungen`
  nehmen ein optionales `client_id` an. Ein Replay mit bekannter `client_id` liefert die
  bestehende Meldung zurück: keine zweite Zeile, kein zweiter ETB-Eintrag, kein zweites
  Live-Ereignis. Der Replay-Lookup läuft vor den Zustandsprüfungen: Eine schon committete
  Meldung kommt auch dann zurück, wenn der Bezirk inzwischen storniert, die Stelle
  geschlossen oder der Einsatz beendet ist.
- Beide Routen prüfen den Offline-Queue-Benutzer-Header wie Personen und Meldungen.
- Frontend: Die Offline-Queue (`offline/queue.ts`, `offline/schreiben.ts`,
  `offline/useOfflineSync.ts`) kennt zwei neue Schreibaktionen, `stand` und `belegung`. Die
  Dialoge „Stand melden“ und „Belegung melden“ senden offline-fähig. Ohne Verbindung wird die
  Meldung mit dem Erfassungszeitpunkt vorgemerkt und beim nächsten Flush gesendet. Abgelehnte
  Meldungen erscheinen im Wiederherstellungs-Drawer als „Standmeldung“ bzw.
  „Belegungsmeldung“.
- Ein Test belegt, dass Replays wegen der absoluten Meldungen unkritisch sind: Dieselbe
  Meldung zweimal ändert keinen Stand, und eine verspätet eintreffende ältere Meldung wird
  als Nachtrag geführt, statt den aktuellen Stand zu überschreiben.

Nicht offline-fähig bleiben Anlegen, Ändern und Stornieren von Bezirken und Stellen, die
Rücknahme einer Meldung und die Leermeldung vor dem Schließen einer Stelle. Letztere ist der
erste von zwei Schritten, deren zweiter (Status-PATCH) keine Queue hat.

## Capabilities

### New Capabilities

_keine_

### Modified Capabilities

- `betreuung-evakuierung`: Neue Anforderung „Offline-Erfassung von Stand- und
  Belegungsmeldungen“ (Idempotenz über `client_id`, Replay vor Zustandsprüfungen, Queue im
  Client). Die Capability liegt noch als Delta in `openspec/changes/lfh-639-fachmodul-betreuung/`
  und ist nicht nach `openspec/specs/` synchronisiert. Diese Änderung ergänzt sie deshalb um
  eine ADDED-Anforderung.

## Impact

- **Datenbank:** neue Migration `0122_betreuung_client_id.sql` (zwei `ADD COLUMN`, zwei
  partielle UNIQUE-Indizes). Keine Rebuild-Migration.
- **Backend:** `src/betreuung/repo.rs` (`stand_melden_tx`, `belegung_melden_tx` mit
  Replay-Zweig), `src/routes/betreuung.rs` (Request-DTOs, Gate `EinsatzSchreibfreigabe`,
  Header-Prüfung, Live-Ereignis nur bei neuer Meldung),
  `src/einsatz/schwaerzung_registry.rs` (`client_id` als `retain`, `G_IDEMPOTENZ`).
- **API/Codegen:** Request-DTOs sind handgepflegt, deshalb kein Response-Schema-Diff.
  `frontend/src/api/types.ts` bekommt `client_id?` an `StandmeldungEingabe` und
  `BelegungsmeldungEingabe`.
- **Frontend:** `api/betreuung.ts`, `offline/queue.ts`, `offline/schreiben.ts`,
  `offline/useOfflineSync.ts`, `offline/OfflineRecoveryDrawer.tsx`, `pages/BetreuungPage.tsx`.
- **Kein** neuer Modulschlüssel, kein neues Live-Ereignis, keine neue Query-Key-Klasse.
