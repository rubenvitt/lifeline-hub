# Proposal

## Why

Storniert A eine Person, zeigt die offene Detailseite bei B weiter „betroffen“ mit allen Knöpfen
(LLH-1832, UI/UX-Analyse vom 12.11.2026). Erst ein Schreibversuch scheitert mit 409. Wer an einem
stornierten Datensatz weiterarbeitet, verliert Zeit und vertraut der Anzeige nicht mehr. Bei Tier,
Schaden und Betreuungsstelle ist es ähnlich: Die Detailseiten von Tier und Schaden sind gar nicht
live. Die Betreuungsstelle wechselt kommentarlos auf „gibt es nicht (mehr)“.

## What Changes

- Eine offene Detailseite von Person, Tier, Schaden und Betreuungsstelle sperrt sich, sobald der
  Datensatz storniert ist. Oben steht ein Banner „Storniert von {Name} um {Zeit}“; alle
  Schreibaktionen verschwinden.
- Ein offenes Feld oder ein Notizentwurf bleibt schreibgeschützt stehen, der Text lässt sich
  kopieren. Speichern ist nicht mehr möglich.
- Person und Tier speichern beim Stornieren, wer storniert hat (neue Spalte `storniert_von`, wie
  beim Schaden). Die Detailantworten von Person, Tier und Schaden tragen den Anzeigenamen
  (`storniert_von_name`). Ältere Stornos ohne Wert zeigen nur „Storniert um {Zeit}“.
- Neue protokollfreie Stand-Abfrage für die Person (`GET …/personen/{pid}/stand`). Die offene
  Detailseite fragt sie bei jedem Live-Ereignis zu dieser Person ab. Das Detail selbst bleibt
  protokolliert und nicht live.
- Die Personen-Detailseite lädt beim Fokuswechsel nicht mehr neu. Bisher schrieb jeder
  Fensterwechsel eine Zeile ins Zugriffsprotokoll.
- Die Detailseiten von Tier und Schaden gleichen sich live ab.
- Neue Stand-Abfrage für die Betreuungsstelle (`GET …/betreuung/stellen/{sid}/stand`). Eine Stelle,
  die während des Ansehens aus der Übersicht fällt, bleibt mit dem Banner gesperrt stehen und
  springt nicht auf „gibt es nicht (mehr)“.

## Capabilities

### New Capabilities
- `storno-sperre`: Wie eine offene Detailseite auf das Stornieren ihres Datensatzes reagiert:
  Sperre, Banner mit Wer und Wann, Umgang mit offener Eingabe. Dazu der Nachweis, wer storniert
  hat, und die protokollfreie Stand-Abfrage.

### Modified Capabilities
- (keine)

## Impact

- **Backend:**
  - Migration: `storniert_von` an `einsatz_person` und `einsatz_tier`
  - `storno::Vermerk::GeaendertUndStorniert` für Person und Tier
  - DTO-Feld `storniert_von_name` an Person, Tier und Schaden
  - zwei neue Lese-Routen (Person-Stand, Betreuungsstelle-Stand)
  - Eintrag in der Schwärzungs-Registry
  - Typ-Codegen
- **Frontend:**
  - gemeinsames Banner `StornoBanner`
  - Sperrlogik in `PersonenDetailPage`, `TiereDetailPage`, `SchaedenDetailPage`,
    `BetreuungsstelleDetailPage`
  - Query-Keys `personStand`, `betreuungsstelleStand`; `tier` und `schaden` raus aus
    `NICHT_LIVE_KEYS`
  - `refetchOnWindowFocus: false` am Person-Detail
- **Doku:** `frontend/src/personen/AGENTS.md` (Detail nicht live, Stand-Abfrage). Kapitel der
  Anwenderdokumentation zu Betroffenen, falls dort Stornieren beschrieben ist.
