# LFH-118 — In-App-Alarmierung für fällige Erinnerungen & zeitkritische Fristen/Eskalationen

**Status:** Design abgenommen (2026-07-17)
**Task:** LFH-118 (Entwicklungsboard), Feature, Priorität hoch
**Referenzen:** LFH-97 (Erinnerungs-Scheduler), LFH-106/112/113 (Kommunikations-UI), LFH-122 (Stream-Registry),
`[[sse-eine-verbindung-pro-einsatz]]`, `[[fristen-eskalation-erinnerungs-scheduler]]`

## Problem

Fällige Erinnerungen und zeitkritische Vorgänge (Fristen, Eskalationen, überfällige Aufträge/Meldungen)
sind heute **nur sichtbar, wenn die jeweilige View offen ist** — sie lösen keine aktive Benachrichtigung
aus. In einer Stabslage geht so leicht etwas unter.

## Vorhandene Infrastruktur (wird wiederverwendet, nicht ersetzt)

- **Eine SSE-Verbindung pro Einsatz** (`useEinsatzLiveStream`), die alle Event-Typen multiplext; zentral im
  `EinsatzLayout` verdrahtet. Listener/Invalidierung werden aus dem Registry `EINSATZ_STREAM_EVENTS`
  (`api/queryKeys.ts`) abgeleitet.
- **Präzedenz „Alarmton"**: `sofortmeldung`-Event → Ton (`spieleSofortAlarm`) + Toast (`SofortAlarm` im
  Layout-Header, lauscht auf Window-CustomEvent `lfh:sofortmeldung`) + Mute-Toggle (`localStorage`).
- **Erinnerungs-Scheduler** (`src/erinnerung/scheduler.rs`): Tokio-`interval` (30 s), `tick_einmal`
  publiziert je fälliger Erinnerung ein `erinnerung`-Event und — für Meldungs-Bestätigungsfristen —
  zusätzlich ein `sofortmeldung`-Event (One-Shot via `setze_eskaliert`).
- **`erinnerung::repo::anlegen_aus_frist`** (idempotent, `quelle='auto_frist'`) + **`schliesse_offene_auto`**
  (schließt die offene Auto-Frist-Erinnerung eines Bezugs). Meldung nutzt beides bereits; der Doc-Kommentar
  sieht `bezug_typ='auftrag'` explizit vor (LFH-52-Groundwork), war aber nie verdrahtet.

## Scope (alle optionalen Punkte eingeschlossen)

| Entscheidung | Wahl |
|---|---|
| Auftrag-Überfälligkeit (AK2) | **Einbeziehen** über den Reuse-Pfad (`anlegen_aus_frist`) |
| Abgestufte Dringlichkeit | **Zwei Ton-Stufen** (dezent vs. Alarm), gekoppelt an den Payload-Diskriminator |
| Browser-Notification-API | **Einbeziehen** (Desktop-Benachrichtigung bei Hintergrund-Tab) |
| Stummschalten | **Ein globaler Mute-Toggle** für alle Alarmtöne |

**Bewusst out-of-scope:** Cross-Tab-Dedup (BroadcastChannel). Verhalten = per-Tab-einmal, konsistent mit
dem heutigen `SofortAlarm`.

## Architektur

### 1 — Backend: `erinnerung`-Payload anreichern *(die Achse)*

`scheduler.rs::tick_einmal` publiziert `erinnerung` heute nur mit `{ einsatz_id }`. Neu:

```json
{ "einsatz_id": E, "erinnerung_id": R, "bezug_typ": "auftrag" | "meldung" | null, "bezug_id": A | null }
```

Alle Werte liegen im Tick bereits vor (`f.id`, `f.einsatz_id`, `f.bezug_typ`, `f.bezug_id`).

- **Kein `titel` im Payload** — konsistent mit der Konvention „keine sensible Payload in SSE-`data`"
  (`live/mod.rs`) und mit dem `sofortmeldung`-Präzedenzfall (nur IDs). Der Toast ist typisiert-generisch;
  Details sieht der Nutzer nach dem Deeplink-Klick.
- `erinnerung_id` dient als Toast-Dedup-Key (`erinnerung-<R>`).
- `bezug_typ` ist der **Diskriminator**, an dem gleichzeitig hängen: Doppel-Alarm-Unterdrückung,
  abgestufte Töne und die Deeplink-Zielwahl.
- Die **Meldungs-Sonderlogik** (`setze_eskaliert` + zusätzliches `sofortmeldung`-Event) bleibt
  **unverändert**.

### 2 — Backend: Auftrag-Frist verdrahten (Reuse-Pfad)

- **`routes/auftrag.rs::anlegen`** (nach `repo::anlegen`, `d: AuftragDetail`): wenn `d.auftrag.frist_at`
  gesetzt → `erinnerung::repo::anlegen_aus_frist(OBJEKT_AUFTRAG, d.auftrag.id, titel, frist, now)`.
  Titel z. B. `format!("Auftrag #{} Quittierfrist", d.auftrag.lfd_nr)` (nur im Reminder-Record, nicht im SSE-Payload).
- **`routes/auftrag.rs::quittieren`** (nach `repo::quittiere_empfaenger`): neuer Repo-Helper
  `alle_empfaenger_quittiert(pool, auftrag_id) -> bool` (`SELECT NOT EXISTS(… quittiert_at IS NULL)`);
  wenn `true` → `erinnerung::repo::schliesse_offene_auto(OBJEKT_AUFTRAG, auftrag_id, now)` — exakt wie
  Meldung bei `bestaetige`. Multi-Empfänger-FSM: schließt erst, wenn **kein** unquittierter Empfänger
  mehr übrig ist.
- **Kein Scheduler-Sonderzweig für Auftrag**: Auftrags-Überfälligkeit (`ist_ueberfaellig`) ist read-time
  berechnet (`frist_at <= now AND EXISTS(unquittierter Empfänger)`). Das angereicherte `erinnerung`-Event
  (bezug_typ=auftrag) ist das Eskalationssignal; das FE invalidiert daraufhin die `auftraege`-Liste.

### 3 — Frontend: SSE-Side-Effect + abgestufte Töne *(kein Doppel-Alarm)*

In `useEinsatzLiveStream` ein **zweiter** `erinnerung`-Listener **neben** der Registry-Ableitung
(die Registry-Invalidierung von `erinnerungen` bleibt bestehen; der zweite Listener ergänzt nur den
Seiteneffekt — EventSource erlaubt mehrere Listener pro Event-Typ). Verzweigung nach `bezug_typ`:

- `'meldung'` → **skip** (der `sofortmeldung`-Pfad alarmiert diese Meldung bereits → verhindert Doppel-Alarm).
- `'auftrag'` → Alarmton + zusätzlich `auftraege`-Key invalidieren + Window-Event `lfh:erinnerung-alarm`.
- sonst (reine Erinnerung, `bezug_typ` null) → **dezenter** Ton + Window-Event `lfh:erinnerung-alarm`.

Doppel-Alarm-Unterdrückung und abgestufte Töne fallen so über **denselben** Diskriminator zusammen.

### 4 — Frontend: Töne + globaler Mute

`sofortTon.ts` → generalisiert zu `alarmTon.ts`:

- `spieleAlarmTon('dezent' | 'alarm')` — `alarm` = bestehender Doppel-Beep (880 Hz); `dezent` = kürzerer,
  tieferer Einzelton.
- **Ein** Mute-Key `lfh:alarm:mute` für alle Töne (`istAlarmGemutet`/`setzeAlarmMute`). Migrations-Nachsicht:
  falls nötig, alten Key `lfh:sofortmeldung:mute` einmalig als Fallback lesen; ansonsten Default „nicht gemutet".
- `useEinsatzLiveStream` ruft `spieleAlarmTon('alarm')` für `sofortmeldung` und `spieleAlarmTon('dezent'|'alarm')`
  für `erinnerung` je nach Diskriminator.

### 5 — Frontend: `AlarmZentrale` (aus `SofortAlarm`)

`SofortAlarm` → `AlarmZentrale` (Header, seitenunabhängig). Lauscht auf **beide** Window-Events und rendert
typisierte, persistente Toasts (`duration: 0`, einzeln quittierbar via `notification.destroy`) mit
Deeplink-Button:

- Erinnerung → `info`-Toast, Deeplink `erinnerungenPfad(einsatzId)` (**neuer** Builder in `deeplinks.ts`).
- Auftrag → `warning`-Toast „Auftrag überfällig", Deeplink `auftraegePfad(einsatzId, { auftrag })` (existiert).
- Sofortmeldung → wie bisher (`warning`, `meldungenPfad`).

**Ein** Mute-Toggle (der bestehende Header-Button), der jetzt den globalen `lfh:alarm:mute` schaltet.
Toast-Keys deduplizieren pro Ereignis (`erinnerung-<R>`, `auftrag-<A>`, `sofort-<meldungId>`).

### 6 — Frontend: Desktop-Notification (Browser-API)

Helper `desktopBenachrichtigung(titel, opts)`:

- Zeigt nur, wenn `document.hidden` **und** `Notification.permission === 'granted'`.
- Permission-Anforderung als **explizite User-Geste** — kleiner Eintrag/Button „Desktop-Alarm aktivieren"
  an der `AlarmZentrale` (Browser verlangen eine Geste für `Notification.requestPermission`).
- Klick auf die Desktop-Notification → `window.focus()` + Navigation via denselben Deeplink.
- Defensiv: API fehlt / `permission === 'denied'` → still; der In-App-Toast trägt in jedem Fall.

### 7 — Idempotenz / Reconnect / Multi-Tab

- **Reconnect:** Backend-One-Shot (`markiere_ausgeloest`, `schliesse_offene_auto`) → jedes Ereignis feuert
  serverseitig genau einmal. `lagged` refetcht nur (der Side-Effect-Listener läuft **nicht** auf `lagged`)
  → kein Replay-Alarm.
- **Multi-Tab:** jeder Tab alarmiert einmal (Arbeitsplatz-Sicht) — konsistent mit dem heutigen `SofortAlarm`.
  Cross-Tab-Dedup ist out-of-scope.

## Akzeptanzkriterien → Abdeckung

1. *Erinnerung fällig/überfällig → In-App-Benachrichtigung mit Sprung, auch modulfremd* → §1 (Payload), §3
   (Side-Effect), §5 (Toast + Deeplink).
2. *Fristüberschreitungen/Eskalationen (Auftrag/Meldung) → Benachrichtigung + abgestufter Alarmton* →
   Meldung: bestehender `sofortmeldung`-Pfad (Alarmton). Auftrag: §2 (Verdrahtung) + §3/§5 (Alarmton + Toast).
3. *Alarm quittier-/stummschaltbar, wiederholt sich nicht endlos* → §4 (globaler Mute), §5 (Toast-`destroy`
   + Dedup-Keys), §7 (Backend-One-Shot).

## Teststrategie

**Backend (`cargo test`, mit `env -u` aller Dev-Vars — SSRF/Loopback-Leak-Falle):**
- Scheduler: `erinnerung`-Payload trägt `bezug_typ` + `erinnerung_id` (bestehende Payload-Tests anpassen).
- Auftrag `anlegen` mit `frist_at` legt eine `auto_frist`-Erinnerung (`bezug_typ='auftrag'`) an.
- Auftrag `quittieren`: schließt die Frist-Erinnerung **erst**, wenn der letzte Empfänger quittiert; bei
  noch offenem Empfänger bleibt sie offen.
- Scheduler-Tick auf eine Auftrags-Frist-Erinnerung publiziert `erinnerung` mit `bezug_typ='auftrag'`.

**Frontend (vitest, `--no-file-parallelism` für das saubere Gate):**
- `erinnerung`-Event mit `bezug_typ='meldung'` löst **keinen** zweiten Alarm aus (nur `sofortmeldung`).
- `bezug_typ='auftrag'` → Alarmton + `auftraege`-Invalidierung + Toast mit Auftrags-Deeplink.
- reine Erinnerung → dezenter Ton + Info-Toast mit Erinnerungs-Deeplink.
- globaler Mute unterdrückt den Ton (Toast/visuell bleibt).
- Deeplink-Builder `erinnerungenPfad` (Unit-Test in `deeplinks.test.ts`).

## Betroffene Dateien (Richtwert)

- `src/erinnerung/scheduler.rs` — Payload-Anreicherung + Tests.
- `src/routes/auftrag.rs` — `anlegen`/`quittieren` verdrahten.
- `src/auftrag/repo.rs` — Helper `alle_empfaenger_quittiert`.
- `frontend/src/einsatz/alarmTon.ts` (aus `sofortTon.ts`) — zwei Stufen + globaler Mute.
- `frontend/src/einsatz/AlarmZentrale.tsx` (aus `SofortAlarm.tsx`) — beide Event-Typen + Desktop-Notification.
- `frontend/src/etb/useEinsatzLiveStream.ts` — zweiter `erinnerung`-Side-Effect-Listener.
- `frontend/src/routing/deeplinks.ts` — `erinnerungenPfad`.
- Tests jeweils daneben.

## Risiken

- **Doppel-Alarm** bei Meldungs-Fristen (Scheduler feuert `erinnerung` + `sofortmeldung`): entschärft durch
  den `bezug_typ='meldung'`-Skip im FE (fixierter Testfall).
- **Auftrags-FSM:** die Frist-Erinnerung darf nur bei „alle Empfänger quittiert" geschlossen werden — sonst
  Fehl-Highlight oder verlorene Eskalation. Explizit getestet.
- **Rename `SofortAlarm` → `AlarmZentrale`** berührt bestehende Tests/Imports — mitziehen.
