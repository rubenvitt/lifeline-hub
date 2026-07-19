# LFH-227 (F01): Live-Kanal-Modul-AuthZ — Design

**Stand:** 2026-07-19 · Strang A (LFH-218), Batch 4 · Vorgänger: LFH-298 (LiveEvent-Enum, `d1032f1`)

## Problem

Der `LiveHub` multiplext alle Domänen-Events eines Einsatzes auf EINEN Broadcast-Kanal.
Jede der 9 Stream-Routen prüft beim Subscribe nur das Modul-Recht IHRES Moduls und leitet
danach **jedes** Event verbatim weiter. Wer `/zonen/stream` öffnen darf, liest ETB- und
Chat-Volltexte inkl. PII mit — die Modul-Zugriffssteuerung ist auf dem Live-Pfad wirkungslos.

Drei Angriffsflächen: **(a)** kein Post-Filter pro Event, **(b)** Volltext-Payloads in `data`
(entgegen der eigenen Invariante in `live/mod.rs`), **(c)** 8 ungenutzte, aber offene Routen.

## Entscheidungen

| Frage | Entscheidung | Begründung |
|---|---|---|
| Filter-Anbindung | `LiveNachricht.event: LiveEvent` (statt `String`) | Filter wird exhaustiver `match` → Compiler erzwingt Vollständigkeit; kein Rück-Parsen, kein Drift-Guard als Laufzeitnetz nötig |
| Filter-Ort | Post-Filter im SSE-Builder (`routes/support.rs`) | `live/mod.rs` bleibt auth-/DB-freier Dumb-Transport (1-write-lock/exactly-once aus F14/LFH-263 unangetastet); wirkt identisch auf Replay-Prefix UND Live-Tail |
| Endpoint | `/api/einsaetze/{id}/live`, 8 Legacy-Routen gelöscht | `/etb/stream` war faktisch längst der Gesamtfeed — der Name log, und das Modul-Gate der Route wechselt ohnehin von „etb" auf „Snapshot aller erlaubten Module" |
| Revokation | **Snapshot** per Connection, bei Reconnect neu | Mid-Stream-Entzug wirkt erst beim Reconnect; Restfenster leakt nur METADATA (ID-only), nie Content — der ungecachte GET 403t sofort. Kein Pro-Event-DB-Read (Burst-Kosten), kein TTL |
| Payload | `publiziere()`/chat auf ID-only | FE liest `ev.data` für etb/chat nicht (invalidiert nur); Content gehört hinter den re-gegateten GET |

## Architektur

### 1. Registry als Methode (`src/live/mod.rs`)

```rust
impl LiveEvent {
    /// Modul-Key, gegen den dieses Event gegatet wird.
    /// `None` = bewusst ungated (Kontroll-Event ohne Fachbezug).
    pub fn modul_key(self) -> Option<&'static str> { match self { … } }
}
```

Exhaustiver `match` über alle 23 Varianten. **Eine neue `LiveEvent`-Variante bricht die
Compilierung**, bis sie einen Modul-Key (oder ein bewusstes `None`) bekommt — das ersetzt
den ursprünglich geplanten statischen Literal-Scan-Guard vollständig. Als Rest bleibt ein
Unit-Test „alle Keys ⊆ `MODUL_KEYS`" (iteriert `LiveEvent::ALLE`).

`LiveEvent::Lagged` → `None`: Kontroll-Events (lagged/resync) tragen keinen Fachbezug und
müssen jeden Subscriber erreichen, sonst hängt der Resync.

### 2. Post-Filter (`src/routes/support.rs`)

`sse_event_stream` und `sse_stream_mit_replay` bekommen `erlaubt: impl Fn(LiveEvent) -> bool`.
Der Filter greift auf beiden Wegen — Replay-Prefix und Live-Tail —, sonst wäre der Reconnect
ein Bypass.

### 3. Snapshot (`src/routes/live.rs`)

Beim Subscribe einmalig: `modul_override::laden_alle` + `org::modul_einstellung::laden_alle`
(zwei indizierte Reads, ≤25 Zeilen), dann über `MODUL_KEYS` iterieren und
`fordere_modul_zugriff(...).is_ok()` sammeln → `HashSet<&'static str>`. Danach ist der Filter
eine reine Funktion ohne DB.

Die Route selbst gatet nur noch auf `fordere_lesezugriff` (Einsatz-Ebene) — **kein**
Modul-Gate mehr, denn sie ist nicht mehr die Route eines Moduls.

## Verhaltens-Deltas (bewusst)

1. **`/live` gibt 200 bei verstecktem ETB** (vorher `/etb/stream` → 403). Der Schutz wandert
   vom Verbindungsaufbau in den Event-Filter: die Verbindung steht, etb-Events kommen nicht
   durch. `tests/modul_override.rs` wird entsprechend umgebaut (Gate-Matrix `MODUL_STREAM_PFADE`
   entfällt mit den Routen).
2. **Fan-out `person` → `personen`**: ein Nachbar-Modul-Leser erfährt die Existenz einer
   `person_id`. ID-only, GET re-gegatet — akzeptiert.
3. **`sofortmeldung` → `meldungen`**: Nicht-meldungen-Leser werden nicht mehr alarmiert.
   Konsistent zu LFH-118.
4. **Mid-Stream-Rechteentzug** wirkt erst beim Reconnect (Snapshot). Optionales Hardening
   (Neuberechnung am Keep-Alive-Tick) = Folge-Task.

## Nicht-Ziele

- Pro-Event-Re-Autorisierung (DB-Read je Event bei Erfassungs-Bursts)
- Eigener Broadcast-Kanal je Modul (zerlegt die exactly-once-Replay-Invariante aus F14)
