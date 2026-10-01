# Proposal

## Why

Der `LiveHub` kennt nur Kanäle je Einsatz. Für die Organisation gibt es keinen. Andere angemeldete
Schirme sehen deshalb Einsatzliste und Stammdaten-Kataloge erst nach einem Refetch (Fokuswechsel,
`staleTime` 10 s). LFH-690 hat das sichtbar gemacht: Nach dem Entfernen der Demo-Daten steht der
gelöschte Einsatz noch in Liste, Einsatz-Switcher und Sprungpalette, und ein Klick führt in die
404-Sackgasse. Dasselbe gilt für neu angelegte, abgeschlossene oder wiederhergestellte Einsätze und
für jede Änderung an Fahrzeugen, Personal, Material und den übrigen Katalogen.

## What Changes

- **Neue Ereignisfamilie für die Organisation** (`OrgLiveEvent`, getrennt von `LiveEvent`) mit
  genau zwei Wire-Namen, beide ohne Objektkennung in der Nutzlast (`{}`):
  - `einsatzliste`: Die Einsatzliste ist für den Empfänger möglicherweise veraltet.
  - `stammdaten`: Ein Stammdaten-Katalog der eigenen Organisation hat sich geändert.
- **Gates (wer erfährt was):**
  - `stammdaten` erreicht jeden angemeldeten Benutzer der Organisation, deren Katalog sich
    geändert hat. Das ist dieselbe Tür wie die Katalog-GETs (`CurrentUser`, `org_id`).
  - `einsatzliste` zu einem Einsatz erreicht nur, wer diesen Einsatz in der Liste sehen kann:
    die org-weiten Leser seiner Organisation (System-Admin, Führungskraft), System-Admins anderer
    Organisationen (sie lesen org-übergreifend) und die Mitglieder des Einsatzes zum Zeitpunkt des
    Ereignisses, dazu eine gerade hinzugefügte oder entfernte Person. Wer den Einsatz nicht sehen
    darf, erfährt auch nicht, dass sich an ihm etwas geändert hat.
- **Transport ohne zusätzliche Verbindung im Einsatz:** Der bestehende Einsatz-Strom
  (`/api/einsaetze/{id}/live`) trägt die Org-Ereignisse mit. Außerhalb eines Einsatzes öffnet das
  Frontend einen neuen Org-Strom `GET /api/live`. Je Tab bleibt es bei **einer** SSE-Verbindung
  (HTTP/1.1-Grenze von sechs Verbindungen je Origin, LFH-264 offen).
- **Auslöser `einsatzliste`** (jeweils nach dem Commit): jeder Weg, der heute `einsatz` feuert
  (Kopf-PATCH, Abschluss, Aufbewahrungsfrist, Lagebesprechung mit neuem Termin), dazu Anlage,
  Mitglied setzen/entfernen, Wiederherstellen aus der Aufbewahrung, Soft-Delete durch den
  Purge-Scheduler, Demo-Import, Demo-Neuimport, Demo-Entfernen.
- **Auslöser `stammdaten`:** jede erfolgreiche Schreibroute der Kataloge Fahrzeuge,
  Fahrzeug-Status, Personal, Personal-Status, Material, Material-Kategorien, Qualifikationen,
  Einheit-Typen, Sprechgruppen (Org-Katalog), ETB-Bausteine, Stichwort-Vorschläge,
  Führungsfunktionen, Organisation (Name, Logo), dazu Demo-Import, -Neuimport und -Entfernen.
  Die Katalog-Routen bekommen das Ereignis über **eine** Middleware am Router (Präfixabgleich gegen `STAMMDATEN_PFADE`), nicht
  über Aufrufe in jedem Handler. `stammdaten` frischt im Frontend auch die Einsatzliste auf, weil
  sie Organisationsnamen und Führungsfunktions-Labels zeigt.
- **Frontend:** neue Registry `ORG_STREAM_EVENTS` (Ereignis → `globalKeys`-Prefixe) und eine
  XOR-Partition der globalen Keys in live und `NICHT_LIVE_GLOBAL_KEYS`, wie sie der Kommentar an
  `GLOBAL_KEYS` für den ersten Konsumenten verlangt. `lagged` und jeder Wiederaufbau der
  Verbindung frischen auch die Org-Keys auf.
- Wire-Kontrakte (`tests/enum_wire_kontrakt.rs`, neuer FE-Kontrakttest), OpenAPI-Codegen,
  Zulassungsliste (`OHNE_ZULASSUNGSGRENZE`) und die Regelzeilen in `frontend/AGENTS.md` werden
  nachgezogen. Die Gate-Pins von `LiveEvent` bleiben unverändert.

## Capabilities

### New Capabilities

- `org-live`: Welche Änderungen an Einsatzliste und Stammdaten andere Schirme ohne Neuladen
  erreichen, wer davon erfährt, über welche Verbindung, und was bewusst nicht live ist.

### Modified Capabilities

- `einsatzkopf-live`: Die Anforderung „Wer vom Einsatzkopf erfährt" stellt klar, dass die
  Modulbindung für Einsatz-Ereignisse gilt. Org-Ereignisse auf demselben Strom folgen ihren eigenen
  Gates.

## Impact

- Backend: `src/live/` (Org-Kanal, `OrgLiveEvent`, Empfängerfilter), `src/routes/live.rs`
  (Zusammenführen im Einsatz-Strom, neue Route `/api/live`), `src/routes/support.rs`,
  `src/app.rs`, `src/zulassung.rs`, Emitter in `routes/einsatz.rs`, `routes/stab.rs`,
  `routes/aufbewahrung.rs`, `routes/demo_daten.rs`, `einsatz/purge_scheduler.rs` (+ `main.rs`);
  `stammdaten` zentral über die Middleware in `src/routes/live.rs`, die Katalog-Routen selbst
  bleiben unverändert; `src/api_doc.rs`, `tests/enum_wire_kontrakt.rs`, neue Integrationstests
  und `tests/stammdaten_live_guard.rs`.
- Codegen: `frontend/src/api/openapi.json`, `frontend/src/api/types.generated.ts`.
- Frontend: `api/queryKeys.ts` (+ Guard-/Kontrakttests), `live/` (gemeinsamer Verbindungsbau, neuer
  Org-Hook), `App.tsx` (`BetriebsLayout`), `useEinsatzLiveStream.ts`, `frontend/AGENTS.md`.
- Keine Migration, keine Rechteänderung an bestehenden Routen. Eine neue lesende Route
  (`GET /api/live`, nur angemeldet).
