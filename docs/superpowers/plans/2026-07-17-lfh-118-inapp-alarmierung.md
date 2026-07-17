# LFH-118 In-App-Alarmierung — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fällige Erinnerungen und zeitkritische Fristen/Eskalationen (Auftrag/Meldung) lösen einsatzweit eine In-App-Benachrichtigung + abgestuften Alarmton (+ optional Desktop-Notification) aus — auch modulfremd.

**Architecture:** Reuse der bestehenden Scheduler+SSE-Infrastruktur. Das `erinnerung`-SSE-Event wird um einen `bezug_typ`-Diskriminator + IDs angereichert (Achse). Aufträge werden über den vorhandenen `anlegen_aus_frist`/`schliesse_offene_auto`-Pfad verdrahtet (wie Meldungen). Im Frontend ein zweiter SSE-Side-Effect-Listener neben der Registry-Invalidierung, abgestufte Töne über ein generalisiertes `alarmTon`-Modul mit **einem** globalen Mute, und eine `AlarmZentrale` (aus `SofortAlarm`) für Toasts + Desktop-Notification.

**Tech Stack:** Rust (axum, sqlx/SQLite, tokio), React 19 + TanStack Query + antd 6, Vitest 4.

## Global Constraints

- **Worktree-Root (WT):** `/Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/feat+lfh-118-inapp-alarmierung-erinnerungen`. Alle Kommandos von hier ausführen; nur Worktree-Pfade editieren.
- **Frontend-Gate via mise/pnpm:** `mise exec pnpm@11.10.0 -- pnpm -C <WT>/frontend <script>` (absolute `-C`-Pfade, mise im non-interactive Shell inaktiv). Sauberes Gate: `test -- --no-file-parallelism`.
- **`pnpm lint` läuft mit `--max-warnings 0`** — Warnings brechen wie Errors; an der Wurzel beheben, keine pauschalen eslint-disables.
- **Backend-Gate = `cargo test`** (Repo ist rustfmt-clean, `cargo fmt --all` pflegen). Kein CI. Für die **volle Suite** alle Dev-Vars `env -u`en (SSRF/Loopback-Leak-Falle), z. B. `env -u LIFELINE_DOWNLOAD_ALLOW_LOOPBACK cargo test`. Pro-Task genügen die **scoped** Kommandos unten.
- **`sqlx 0.9`:** `query`/`query_as` nehmen nur `&'static str` — SQL als Literal, kein `format!`.
- **Kein neuer Timer, keine zweite EventSource.** Registry-Ableitung in `useEinsatzLiveStream` NICHT ersetzen — nur einen Side-Effect-Listener daneben.
- **Kein `titel` im SSE-`erinnerung`-Payload** (Konvention „keine sensible Payload in `data`").
- Commits referenzieren `LFH-118`; Commit-Trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File Structure

**Backend**
- `src/erinnerung/scheduler.rs` — `erinnerung`-Payload anreichern (Task 1).
- `src/routes/auftrag.rs` — Frist-Erinnerung bei `anlegen` erzeugen, bei `quittieren` schließen (Task 2).
- `tests/auftrag.rs` — Integrationstests für die Verdrahtung (Task 2).

**Frontend**
- `frontend/src/einsatz/alarmTon.ts` (+ `.test.ts`) — aus `sofortTon.ts`: zwei Ton-Stufen + globaler Mute (Task 3).
- `frontend/src/routing/deeplinks.ts` (+ `.test.ts`) — `erinnerungenPfad` (Task 4).
- `frontend/src/einsatz/desktopAlarm.ts` (+ `.test.ts`) — Browser-Notification-Helper (Task 5).
- `frontend/src/etb/useEinsatzLiveStream.ts` (+ `.test.tsx`) — zweiter `erinnerung`-Side-Effect (Task 6).
- `frontend/src/einsatz/AlarmZentrale.tsx` (+ `.test.tsx`) — aus `SofortAlarm.tsx`: beide Events, Toasts, Desktop, ein Mute-Toggle (Task 7).
- `frontend/src/einsatz/EinsatzLayout.tsx` — Import/Nutzung `SofortAlarm` → `AlarmZentrale` (Task 7).

---

## Task 1: Backend — `erinnerung`-SSE-Payload anreichern

**Files:**
- Modify: `src/erinnerung/scheduler.rs:71-75` (Publish) + Tests im selben File.

**Interfaces:**
- Produces: SSE-Event `erinnerung` mit Payload `{ einsatz_id, erinnerung_id, bezug_typ, bezug_id }` (`bezug_typ`: `"auftrag"|"meldung"|null`).

- [ ] **Step 1: Bestehenden Payload-Test erweitern (failing)**

In `src/erinnerung/scheduler.rs`, Test `faellige_publiziert_sse_event_erinnerung` (aktuell ~Zeile 228): den `repo::anlegen`-Aufruf an `let r = repo::anlegen(...)` binden und nach `rx.recv()` den Payload prüfen:

```rust
        let nachricht = rx.recv().await.unwrap();
        assert_eq!(nachricht.event, "erinnerung");
        let v: serde_json::Value = serde_json::from_str(&nachricht.data).unwrap();
        assert_eq!(v["einsatz_id"], e);
        assert_eq!(v["erinnerung_id"], r.id);
        assert_eq!(v["bezug_typ"], serde_json::Value::Null);
        assert_eq!(v["bezug_id"], serde_json::Value::Null);
```

- [ ] **Step 2: Neuen Test für den Auftrags-Diskriminator ergänzen (failing)**

Am Ende des `mod tests` in `src/erinnerung/scheduler.rs`:

```rust
    /// LFH-118: eine Auto-Frist-Erinnerung mit bezug_typ='auftrag' publiziert `erinnerung` mit
    /// Diskriminator + IDs im Payload — und KEIN zweites (sofortmeldung-)Event (Nicht-Meldung).
    #[tokio::test]
    async fn auftrag_frist_erinnerung_traegt_bezug_typ_und_id_im_payload() {
        use crate::kommunikation::OBJEKT_AUFTRAG;
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let live = LiveHub::new();
        let mut rx = live.abonniere(e);
        // bezug_id ist ein generischer Sachbezug ohne FK (migration 0044) → beliebige ID genügt;
        // der Scheduler dereferenziert sie nur für bezug_typ='meldung'.
        let r = repo::anlegen_aus_frist(
            &pool, e, b, OBJEKT_AUFTRAG, 42, "Auftrag #1 Quittierfrist",
            "2026-06-11 10:00:00", "2026-06-11 09:00:00",
        )
        .await
        .unwrap();

        assert_eq!(tick_einmal(&pool, &live, t("2026-06-11 10:01:00")).await, 1);
        let n = rx.recv().await.unwrap();
        assert_eq!(n.event, "erinnerung");
        let v: serde_json::Value = serde_json::from_str(&n.data).unwrap();
        assert_eq!(v["erinnerung_id"], r.id);
        assert_eq!(v["bezug_typ"], "auftrag");
        assert_eq!(v["bezug_id"], 42);
        assert!(rx.try_recv().is_err(), "kein sofortmeldung-Event für Nicht-Meldungs-Bezug");
    }
```

- [ ] **Step 3: Tests laufen lassen — erwartet FAIL**

Run: `cargo test --lib erinnerung::scheduler`
Expected: FAIL (Payload trägt nur `einsatz_id`; `erinnerung_id`/`bezug_typ` sind Null).

- [ ] **Step 4: Payload anreichern**

`src/erinnerung/scheduler.rs`, den `live.publiziere_event(...)`-Aufruf für `"erinnerung"` (Zeile 71-75) ersetzen durch:

```rust
        live.publiziere_event(
            f.einsatz_id,
            "erinnerung",
            serde_json::json!({
                "einsatz_id": f.einsatz_id,
                "erinnerung_id": f.id,
                "bezug_typ": f.bezug_typ,
                "bezug_id": f.bezug_id,
            })
            .to_string(),
        );
```

Die Meldungs-Sonderlogik darunter (`setze_eskaliert` + separates `sofortmeldung`-Event) bleibt unverändert.

- [ ] **Step 5: Tests laufen lassen — erwartet PASS**

Run: `cargo test --lib erinnerung::scheduler`
Expected: PASS (inkl. der beiden angepassten/neuen Tests).

- [ ] **Step 6: fmt + Commit**

```bash
cargo fmt --all
git add src/erinnerung/scheduler.rs
git commit -m "feat(lfh-118): erinnerung-SSE-Payload um bezug_typ-Diskriminator + IDs anreichern

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Backend — Auftrag-Frist verdrahten (anlegen + quittieren)

**Files:**
- Modify: `src/routes/auftrag.rs` (`anlegen` ~Zeile 109-127, `quittieren` ~Zeile 147-160).
- Test: `tests/auftrag.rs`.

**Interfaces:**
- Consumes: `erinnerung::repo::anlegen_aus_frist(pool, einsatz_id, ersteller_id, bezug_typ, bezug_id, titel, faellig_at, jetzt)`, `erinnerung::repo::schliesse_offene_auto(pool, bezug_typ, bezug_id, jetzt)`, `crate::kommunikation::OBJEKT_AUFTRAG`.
- Reuse: `AuftragDetail.auftrag` trägt `frist_at: Option<String>`, `lfd_nr: Option<i64>`, `empfaenger_anzahl: i64`, `quittiert_anzahl: i64` → „alle quittiert" = `empfaenger_anzahl > 0 && empfaenger_anzahl == quittiert_anzahl` (kein neuer Repo-Helper).

- [ ] **Step 1: Integrationstest-Helfer + „anlegen erzeugt Erinnerung"-Test (failing)**

In `tests/auftrag.rs` die `use common::{…}`-Zeile um `setup_mit_pool` erweitern und diesen Helfer + Test ergänzen:

```rust
async fn offene_auftrag_frist_erinnerungen(pool: &sqlx::SqlitePool, auftrag_id: i64) -> i64 {
    sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM erinnerung \
         WHERE quelle = 'auto_frist' AND status = 'offen' AND bezug_typ = 'auftrag' AND bezug_id = ?",
    )
    .bind(auftrag_id)
    .fetch_one(pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn anlegen_mit_frist_legt_auftrag_frist_erinnerung_an() {
    let (app, pool) = common::setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let body = serde_json::json!({
        "auftrag_text": "Deich sichern",
        "frist_at": "2099-12-31 00:00:00",
        "empfaenger": [{ "empfaenger_typ": "funktion", "funktion_text": "Abschnitt Nord" }]
    })
    .to_string();
    let (status, json) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/auftraege"),
        &admin,
        Some(&body),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let auftrag_id = json["id"].as_i64().unwrap();
    assert_eq!(
        offene_auftrag_frist_erinnerungen(&pool, auftrag_id).await,
        1,
        "Auftrag mit Frist erzeugt genau eine offene Auto-Frist-Erinnerung"
    );
}
```

- [ ] **Step 2: „quittieren schließt erst beim letzten Empfänger"-Test (failing)**

Ebenfalls in `tests/auftrag.rs`:

```rust
#[tokio::test]
async fn quittieren_schliesst_frist_erinnerung_erst_beim_letzten_empfaenger() {
    let (app, pool) = common::setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let body = serde_json::json!({
        "auftrag_text": "Deich sichern",
        "frist_at": "2099-12-31 00:00:00",
        "empfaenger": [
            { "empfaenger_typ": "funktion", "funktion_text": "Abschnitt Nord" },
            { "empfaenger_typ": "funktion", "funktion_text": "Abschnitt Süd" }
        ]
    })
    .to_string();
    let (status, json) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/auftraege"),
        &admin,
        Some(&body),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let auftrag_id = json["id"].as_i64().unwrap();
    let empf0 = json["empfaenger"][0]["id"].as_i64().unwrap();
    let empf1 = json["empfaenger"][1]["id"].as_i64().unwrap();
    assert_eq!(offene_auftrag_frist_erinnerungen(&pool, auftrag_id).await, 1);

    // Ersten Empfänger quittieren → Erinnerung bleibt offen (noch ein Empfänger offen).
    let (s1, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/auftraege/{auftrag_id}/empfaenger/{empf0}/quittieren"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s1, StatusCode::OK);
    assert_eq!(
        offene_auftrag_frist_erinnerungen(&pool, auftrag_id).await,
        1,
        "solange ein Empfänger offen ist, bleibt die Frist-Erinnerung offen"
    );

    // Letzten Empfänger quittieren → Erinnerung geschlossen.
    let (s2, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/auftraege/{auftrag_id}/empfaenger/{empf1}/quittieren"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s2, StatusCode::OK);
    assert_eq!(
        offene_auftrag_frist_erinnerungen(&pool, auftrag_id).await,
        0,
        "nach dem letzten Quittieren ist die Frist-Erinnerung erledigt"
    );
}
```

- [ ] **Step 3: Tests laufen lassen — erwartet FAIL**

Run: `cargo test --test auftrag anlegen_mit_frist_legt_auftrag_frist_erinnerung_an quittieren_schliesst_frist_erinnerung_erst_beim_letzten_empfaenger`
Expected: FAIL (`anlegen`-Test: 0 statt 1 Erinnerung; `quittieren`-Test: bleibt 1 statt 0).

- [ ] **Step 4: `anlegen` verdrahten**

In `src/routes/auftrag.rs::anlegen`, direkt **nach** dem `repo::anlegen`-Block (nach `let d = repo::anlegen(...).await?;`, vor dem ETB-Live-Block) einfügen:

```rust
    // Nachfass/Eskalation (LFH-118): bei gesetzter Quittierfrist eine Auto-Frist-Erinnerung
    // anlegen (idempotent, quelle='auto_frist', bezug_typ='auftrag'). Der Scheduler-Tick feuert
    // bei Fristablauf `erinnerung` mit Diskriminator → In-App-Alarm; Quittieren aller Empfänger
    // schließt sie wieder (siehe quittieren). Reuse des Meldungs-Pfads (routes/meldung.rs).
    if let Some(frist) = d.auftrag.frist_at.as_deref() {
        let titel = match d.auftrag.lfd_nr {
            Some(nr) => format!("Auftrag #{nr} Quittierfrist"),
            None => "Auftrag Quittierfrist".to_string(),
        };
        crate::erinnerung::repo::anlegen_aus_frist(
            &state.pool,
            einsatz_id,
            ctx.benutzer.id,
            crate::kommunikation::OBJEKT_AUFTRAG,
            d.auftrag.id,
            &titel,
            frist,
            &now,
        )
        .await?;
    }
```

- [ ] **Step 5: `quittieren` verdrahten**

In `src/routes/auftrag.rs::quittieren`, nach `let d = repo::laden(&state.pool, auftrag_id, &jetzt()).await?;` und **vor** `sse(&state, einsatz_id);`:

```rust
    // LFH-118: sobald ALLE Empfänger quittiert haben, ist der Auftrag nicht mehr überfällig →
    // die Auto-Frist-Erinnerung schließen (verstummt den Nachfass). Solange ein Empfänger offen
    // ist, bleibt sie offen.
    if d.auftrag.empfaenger_anzahl > 0 && d.auftrag.empfaenger_anzahl == d.auftrag.quittiert_anzahl {
        crate::erinnerung::repo::schliesse_offene_auto(
            &state.pool,
            crate::kommunikation::OBJEKT_AUFTRAG,
            auftrag_id,
            &jetzt(),
        )
        .await?;
    }
```

- [ ] **Step 6: Tests laufen lassen — erwartet PASS**

Run: `cargo test --test auftrag`
Expected: PASS (neue Tests grün, bestehende Auftrags-Tests weiterhin grün).

- [ ] **Step 7: fmt + Commit**

```bash
cargo fmt --all
git add src/routes/auftrag.rs tests/auftrag.rs
git commit -m "feat(lfh-118): Auftrags-Quittierfrist über anlegen_aus_frist/schliesse_offene_auto verdrahten

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Frontend — `alarmTon.ts` (zwei Stufen + globaler Mute)

**Files:**
- Create: `frontend/src/einsatz/alarmTon.ts`, `frontend/src/einsatz/alarmTon.test.ts`
- Delete: `frontend/src/einsatz/sofortTon.ts`, `frontend/src/einsatz/sofortTon.test.ts`
- Modify: `frontend/src/etb/useEinsatzLiveStream.ts` (Import + Aufruf), `frontend/src/einsatz/SofortAlarm.tsx` (Import + Aufrufe), `frontend/src/einsatz/SofortAlarm.test.tsx` (Import).

**Interfaces:**
- Produces: `spieleAlarmTon(stufe: 'dezent' | 'alarm'): void`, `istAlarmGemutet(): boolean`, `setzeAlarmMute(gemutet: boolean): void`, `type AlarmStufe`.

- [ ] **Step 1: Test schreiben (failing)**

Create `frontend/src/einsatz/alarmTon.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setzeAlarmMute, spieleAlarmTon } from './alarmTon';

/** Minimaler AudioContext-Mock: zählt, ob ein Oszillator erzeugt/gestartet wurde. */
function mockAudio() {
  const start = vi.fn();
  const ctx = {
    state: 'running',
    currentTime: 0,
    resume: vi.fn(),
    createOscillator: vi.fn(() => ({ type: '', frequency: { value: 0 }, connect: vi.fn(), start, stop: vi.fn() })),
    createGain: vi.fn(() => ({ gain: { value: 0, setValueAtTime: vi.fn() }, connect: vi.fn() })),
  };
  // Seit Vitest 4 wirft `new` auf einem vi.fn() mit Arrow — daher reguläre Funktion.
  const AC = vi.fn(function () {
    return ctx;
  });
  vi.stubGlobal('AudioContext', AC);
  return { AC, start };
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('spieleAlarmTon', () => {
  it('spielt den Alarm-Ton, wenn nicht gemutet', () => {
    const { AC, start } = mockAudio();
    setzeAlarmMute(false);
    spieleAlarmTon('alarm');
    expect(AC).toHaveBeenCalled();
    expect(start).toHaveBeenCalled();
  });

  it('spielt auch den dezenten Ton, wenn nicht gemutet', () => {
    const { AC, start } = mockAudio();
    setzeAlarmMute(false);
    spieleAlarmTon('dezent');
    expect(AC).toHaveBeenCalled();
    expect(start).toHaveBeenCalled();
  });

  it('unterdrückt jeden Ton, wenn global gemutet (Early-Return, kein AudioContext)', () => {
    const { AC } = mockAudio();
    setzeAlarmMute(true);
    spieleAlarmTon('alarm');
    spieleAlarmTon('dezent');
    expect(AC).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Test laufen lassen — erwartet FAIL**

Run: `mise exec pnpm@11.10.0 -- pnpm -C <WT>/frontend test src/einsatz/alarmTon.test.ts`
Expected: FAIL (`alarmTon` existiert nicht).

- [ ] **Step 3: `alarmTon.ts` erstellen**

Create `frontend/src/einsatz/alarmTon.ts`:

```ts
/**
 * Akustische Alarmtöne (LFH-97/118). EIN Per-User-Mute via localStorage für ALLE Alarmtöne;
 * abgestufte Dringlichkeit: 'alarm' (Sofortmeldung/Eskalation) vs. 'dezent' (fällige Erinnerung).
 *
 * Web-Audio statt Audiodatei: kein Asset, kein Netz. Der AudioContext startet wegen der
 * Autoplay-Policy ggf. erst nach der ersten User-Geste — schlägt das Abspielen fehl, bleibt es
 * still (die visuelle Spur trägt).
 */
export type AlarmStufe = 'dezent' | 'alarm';

const MUTE_KEY = 'lfh:alarm:mute';
// LFH-118: alter Sofort-Mute-Key als einmaliger Fallback, damit eine bestehende Stummschaltung
// beim Umstieg auf den globalen Mute nicht verlorengeht.
const ALT_MUTE_KEY = 'lfh:sofortmeldung:mute';

export function istAlarmGemutet(): boolean {
  try {
    const aktuell = localStorage.getItem(MUTE_KEY);
    if (aktuell !== null) return aktuell === '1';
    return localStorage.getItem(ALT_MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setzeAlarmMute(gemutet: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, gemutet ? '1' : '0');
  } catch {
    /* localStorage nicht verfügbar → nicht persistierbar, kein harter Fehler */
  }
}

let ctx: AudioContext | null = null;

/** Spielt den Alarmton der gegebenen Stufe, sofern nicht gemutet. Fehler werden geschluckt. */
export function spieleAlarmTon(stufe: AlarmStufe): void {
  if (istAlarmGemutet()) return;
  try {
    const AC: typeof AudioContext | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx ??= new AC();
    if (ctx.state === 'suspended') void ctx.resume();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.connect(gain);
    gain.connect(ctx.destination);

    const t = ctx.currentTime;
    if (stufe === 'alarm') {
      // Zwei kurze, höhere Beeps (unübersehbar) — wie der bisherige Sofort-Alarm.
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.07, t);
      gain.gain.setValueAtTime(0, t + 0.15);
      gain.gain.setValueAtTime(0.07, t + 0.3);
      gain.gain.setValueAtTime(0, t + 0.45);
      osc.start(t);
      osc.stop(t + 0.5);
    } else {
      // Dezent: ein kurzer, tieferer Einzelton.
      osc.frequency.value = 440;
      gain.gain.setValueAtTime(0.04, t);
      gain.gain.setValueAtTime(0, t + 0.18);
      osc.start(t);
      osc.stop(t + 0.2);
    }
  } catch {
    /* Audio nicht verfügbar oder Autoplay blockiert → still, visuelle Spur trägt */
  }
}
```

- [ ] **Step 4: Test laufen lassen — erwartet PASS**

Run: `mise exec pnpm@11.10.0 -- pnpm -C <WT>/frontend test src/einsatz/alarmTon.test.ts`
Expected: PASS.

- [ ] **Step 5: Konsumenten migrieren + alte Datei löschen**

1. `frontend/src/etb/useEinsatzLiveStream.ts`: Import `import { spieleSofortAlarm } from '../einsatz/sofortTon';` → `import { spieleAlarmTon } from '../einsatz/alarmTon';`. Im `onSofort`-Handler `spieleSofortAlarm();` → `spieleAlarmTon('alarm');`.
2. `frontend/src/einsatz/SofortAlarm.tsx`: Import `import { istSofortGemutet, setzeSofortMute } from './sofortTon';` → `import { istAlarmGemutet, setzeAlarmMute } from './alarmTon';`. Vorkommen `istSofortGemutet()` → `istAlarmGemutet()`, `setzeSofortMute(` → `setzeAlarmMute(`. (aria-Labels/Text bleiben in dieser Task unverändert; generalisiert Task 7.)
3. `frontend/src/einsatz/SofortAlarm.test.tsx`: Import `import { istSofortGemutet } from './sofortTon';` → `import { istAlarmGemutet } from './alarmTon';`; im Test `istSofortGemutet()` → `istAlarmGemutet()`.
4. Löschen: `git rm frontend/src/einsatz/sofortTon.ts frontend/src/einsatz/sofortTon.test.ts`.

- [ ] **Step 6: Betroffene Tests + Typecheck grün**

Run: `mise exec pnpm@11.10.0 -- pnpm -C <WT>/frontend test src/einsatz/alarmTon.test.ts src/einsatz/SofortAlarm.test.tsx src/etb/useEinsatzLiveStream.test.tsx`
Run: `mise exec pnpm@11.10.0 -- pnpm -C <WT>/frontend typecheck`
Expected: beide PASS (keine offenen `sofortTon`-Referenzen mehr).

- [ ] **Step 7: Commit**

```bash
git add -A frontend/src/einsatz/alarmTon.ts frontend/src/einsatz/alarmTon.test.ts frontend/src/einsatz/SofortAlarm.tsx frontend/src/einsatz/SofortAlarm.test.tsx frontend/src/etb/useEinsatzLiveStream.ts
git commit -m "refactor(lfh-118): sofortTon → alarmTon mit zwei Stufen + globalem Mute

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Frontend — `erinnerungenPfad`-Deeplink

**Files:**
- Modify: `frontend/src/routing/deeplinks.ts`, `frontend/src/routing/deeplinks.test.ts`

**Interfaces:**
- Produces: `erinnerungenPfad(einsatzId: number): string` → `/einsaetze/<id>/erinnerungen`.

- [ ] **Step 1: Test schreiben (failing)**

In `frontend/src/routing/deeplinks.test.ts` ergänzen (Import um `erinnerungenPfad` erweitern):

```ts
  it('erinnerungenPfad zeigt auf die Erinnerungen-Liste', () => {
    expect(erinnerungenPfad(7)).toBe('/einsaetze/7/erinnerungen');
  });
```

- [ ] **Step 2: Test laufen lassen — erwartet FAIL**

Run: `mise exec pnpm@11.10.0 -- pnpm -C <WT>/frontend test src/routing/deeplinks.test.ts`
Expected: FAIL (`erinnerungenPfad` existiert nicht).

- [ ] **Step 3: Builder ergänzen**

In `frontend/src/routing/deeplinks.ts` im Abschnitt „Listen-Routes" ergänzen:

```ts
export function erinnerungenPfad(einsatzId: number): string {
  return einsatzModulPfad(einsatzId, 'erinnerungen');
}
```

- [ ] **Step 4: Test laufen lassen — erwartet PASS**

Run: `mise exec pnpm@11.10.0 -- pnpm -C <WT>/frontend test src/routing/deeplinks.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/routing/deeplinks.ts frontend/src/routing/deeplinks.test.ts
git commit -m "feat(lfh-118): erinnerungenPfad-Deeplink-Builder

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Frontend — `desktopAlarm.ts` (Browser-Notification-Helper)

**Files:**
- Create: `frontend/src/einsatz/desktopAlarm.ts`, `frontend/src/einsatz/desktopAlarm.test.ts`

**Interfaces:**
- Produces: `desktopPermission(): NotificationPermission | 'unsupported'`, `fordereDesktopPermission(beiErgebnis?: (p: NotificationPermission) => void): void`, `zeigeDesktopAlarm(titel: string, opts?: { koerper?: string; beiKlick?: () => void }): void`.

- [ ] **Step 1: Test schreiben (failing)**

Create `frontend/src/einsatz/desktopAlarm.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fordereDesktopPermission, zeigeDesktopAlarm } from './desktopAlarm';

function stubNotification(permission: NotificationPermission) {
  const instances: Array<{ title: string; onclick: (() => void) | null; close: () => void }> = [];
  const Ctor = vi.fn(function (this: Record<string, unknown>, title: string) {
    const inst = { title, onclick: null as (() => void) | null, close: vi.fn() };
    instances.push(inst);
    return inst;
  }) as unknown as typeof Notification & { permission: NotificationPermission; requestPermission: ReturnType<typeof vi.fn> };
  Ctor.permission = permission;
  Ctor.requestPermission = vi.fn(() => Promise.resolve('granted' as NotificationPermission));
  vi.stubGlobal('Notification', Ctor);
  return { Ctor, instances };
}

function setzeHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
}

afterEach(() => {
  vi.unstubAllGlobals();
  setzeHidden(false);
});

describe('zeigeDesktopAlarm', () => {
  it('zeigt keine Notification, wenn der Tab sichtbar ist', () => {
    const { Ctor } = stubNotification('granted');
    setzeHidden(false);
    zeigeDesktopAlarm('Titel');
    expect(Ctor).not.toHaveBeenCalled();
  });

  it('zeigt keine Notification ohne granted-Permission', () => {
    const { Ctor } = stubNotification('denied');
    setzeHidden(true);
    zeigeDesktopAlarm('Titel');
    expect(Ctor).not.toHaveBeenCalled();
  });

  it('zeigt eine Notification bei Hintergrund-Tab + granted', () => {
    const { Ctor } = stubNotification('granted');
    setzeHidden(true);
    zeigeDesktopAlarm('Titel', { koerper: 'Text' });
    expect(Ctor).toHaveBeenCalledWith('Titel', { body: 'Text' });
  });
});

describe('fordereDesktopPermission', () => {
  it('fragt die Permission an, wenn Status default ist', () => {
    const { Ctor } = stubNotification('default');
    fordereDesktopPermission();
    expect(Ctor.requestPermission).toHaveBeenCalled();
  });

  it('fragt NICHT erneut, wenn bereits entschieden (granted)', () => {
    const { Ctor } = stubNotification('granted');
    fordereDesktopPermission();
    expect(Ctor.requestPermission).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Test laufen lassen — erwartet FAIL**

Run: `mise exec pnpm@11.10.0 -- pnpm -C <WT>/frontend test src/einsatz/desktopAlarm.test.ts`
Expected: FAIL (`desktopAlarm` existiert nicht).

- [ ] **Step 3: `desktopAlarm.ts` erstellen**

Create `frontend/src/einsatz/desktopAlarm.ts`:

```ts
/**
 * Desktop-Benachrichtigung (LFH-118) via Browser-Notification-API — NUR wenn der Tab im
 * Hintergrund ist (`document.hidden`) und die Permission erteilt wurde. Defensiv: API fehlt oder
 * Permission verweigert → No-op (der In-App-Toast trägt in jedem Fall).
 */
function verfuegbar(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function desktopPermission(): NotificationPermission | 'unsupported' {
  return verfuegbar() ? Notification.permission : 'unsupported';
}

/** Fragt die Permission an (nur sinnvoll aus einer User-Geste). Callback erhält das Ergebnis. */
export function fordereDesktopPermission(beiErgebnis?: (p: NotificationPermission) => void): void {
  if (verfuegbar() && Notification.permission === 'default') {
    void Notification.requestPermission().then((p) => beiErgebnis?.(p));
  }
}

/** Zeigt eine Desktop-Notification, wenn Tab im Hintergrund + Permission granted. */
export function zeigeDesktopAlarm(
  titel: string,
  opts: { koerper?: string; beiKlick?: () => void } = {},
): void {
  try {
    if (!verfuegbar()) return;
    if (!document.hidden) return;
    if (Notification.permission !== 'granted') return;
    const n = new Notification(titel, { body: opts.koerper });
    n.onclick = () => {
      window.focus();
      opts.beiKlick?.();
      n.close();
    };
  } catch {
    /* Notification-API blockiert/unavailable → still */
  }
}
```

- [ ] **Step 4: Test + Typecheck grün**

Run: `mise exec pnpm@11.10.0 -- pnpm -C <WT>/frontend test src/einsatz/desktopAlarm.test.ts`
Run: `mise exec pnpm@11.10.0 -- pnpm -C <WT>/frontend typecheck`
Expected: beide PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/einsatz/desktopAlarm.ts frontend/src/einsatz/desktopAlarm.test.ts
git commit -m "feat(lfh-118): Desktop-Notification-Helper (Hintergrund-Tab + Permission-Gate)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Frontend — `useEinsatzLiveStream` zweiter `erinnerung`-Side-Effect

**Files:**
- Modify: `frontend/src/etb/useEinsatzLiveStream.ts`, `frontend/src/etb/useEinsatzLiveStream.test.tsx`

**Interfaces:**
- Consumes: `spieleAlarmTon` (Task 3), `EINSATZ_KEYS` (aus `../api/queryKeys`).
- Produces: window-CustomEvent `lfh:erinnerung-alarm` mit `detail = { einsatz_id, erinnerung_id, bezug_typ, bezug_id }`; zusätzliche Invalidierung von `einsatz-auftraege` bei `bezug_typ='auftrag'`.

- [ ] **Step 1: Tests schreiben (failing)**

In `frontend/src/etb/useEinsatzLiveStream.test.tsx` (nutzt vorhandenen `FakeEventSource`) am Ende des `describe` ergänzen:

```ts
  it('feuert lfh:erinnerung-alarm bei erinnerung-Event ohne Bezug (reine Erinnerung)', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const client = neuerQueryClient();
    const alarm = vi.fn();
    window.addEventListener('lfh:erinnerung-alarm', alarm);
    render(
      <QueryClientProvider client={client}>
        <Probe id={9} />
      </QueryClientProvider>,
    );
    FakeEventSource.letzte?.emit('erinnerung', JSON.stringify({ einsatz_id: 9, erinnerung_id: 5, bezug_typ: null, bezug_id: null }));
    await waitFor(() => expect(alarm).toHaveBeenCalled());
    window.removeEventListener('lfh:erinnerung-alarm', alarm);
  });

  it('invalidiert einsatz-auftraege und feuert Alarm bei erinnerung-Event mit bezug_typ=auftrag', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const client = neuerQueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    const alarm = vi.fn();
    window.addEventListener('lfh:erinnerung-alarm', alarm);
    render(
      <QueryClientProvider client={client}>
        <Probe id={9} />
      </QueryClientProvider>,
    );
    FakeEventSource.letzte?.emit('erinnerung', JSON.stringify({ einsatz_id: 9, erinnerung_id: 6, bezug_typ: 'auftrag', bezug_id: 12 }));
    await waitFor(() => {
      const calls = spy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey);
      expect(calls).toContainEqual(['einsatz-auftraege', 9]);
      expect(alarm).toHaveBeenCalled();
    });
    window.removeEventListener('lfh:erinnerung-alarm', alarm);
  });

  it('feuert KEINEN erinnerung-Alarm bei bezug_typ=meldung (Doppel-Alarm-Guard, sofortmeldung trägt)', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const client = neuerQueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    const alarm = vi.fn();
    window.addEventListener('lfh:erinnerung-alarm', alarm);
    render(
      <QueryClientProvider client={client}>
        <Probe id={9} />
      </QueryClientProvider>,
    );
    FakeEventSource.letzte?.emit('erinnerung', JSON.stringify({ einsatz_id: 9, erinnerung_id: 7, bezug_typ: 'meldung', bezug_id: 3 }));
    // Registry-Invalidierung von einsatz-erinnerungen läuft trotzdem.
    await waitFor(() => {
      const calls = spy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey);
      expect(calls).toContainEqual(['einsatz-erinnerungen', 9]);
    });
    expect(alarm).not.toHaveBeenCalled();
    window.removeEventListener('lfh:erinnerung-alarm', alarm);
  });
```

- [ ] **Step 2: Tests laufen lassen — erwartet FAIL**

Run: `mise exec pnpm@11.10.0 -- pnpm -C <WT>/frontend test src/etb/useEinsatzLiveStream.test.tsx`
Expected: FAIL (kein `lfh:erinnerung-alarm`, keine `einsatz-auftraege`-Invalidierung).

- [ ] **Step 3: Side-Effect-Listener ergänzen**

`frontend/src/etb/useEinsatzLiveStream.ts`:

1. Import erweitern: `import { EINSATZ_STREAM_EVENTS } from '../api/queryKeys';` → `import { EINSATZ_KEYS, EINSATZ_STREAM_EVENTS } from '../api/queryKeys';`.
2. Import ergänzen: `import { spieleAlarmTon } from '../einsatz/alarmTon';` (neben `spieleSofortAlarm`-Import, der in Task 3 bereits auf `spieleAlarmTon` umgestellt wurde — nur EIN `alarmTon`-Import).
3. Direkt **nach** dem `sofortmeldung`-Listener-Push (`listeners.push(['sofortmeldung', onSofort as EventListener]);`) einfügen:

```ts
    // Erinnerung-Side-Effect (LFH-118): NEBEN der Registry-Invalidierung (deckt 'erinnerung'
    // bereits ab) alarmiert dieser zweite Listener abgestuft und modulübergreifend. bezug_typ
    // ist der Diskriminator: 'meldung' wird übersprungen (der sofortmeldung-Pfad alarmiert diese
    // Meldung schon → kein Doppel-Alarm), 'auftrag' → Alarmton + auftraege-Invalidierung, sonst
    // dezenter Ton. Der Toast wird einsatzweit über ein window-CustomEvent aufgelöst (AlarmZentrale
    // lauscht) — der Hook bleibt render-state-frei und EINE EventSource.
    const onErinnerung = (ev: MessageEvent) => {
      let detail: {
        einsatz_id?: number;
        erinnerung_id?: number;
        bezug_typ?: 'auftrag' | 'meldung' | null;
        bezug_id?: number | null;
      } = {};
      try { detail = JSON.parse(ev.data); } catch { /* Payload optional */ }
      if (detail.bezug_typ === 'meldung') return; // Doppel-Alarm-Guard
      if (detail.bezug_typ === 'auftrag') {
        spieleAlarmTon('alarm');
        inval(EINSATZ_KEYS.auftraege);
      } else {
        spieleAlarmTon('dezent');
      }
      window.dispatchEvent(new CustomEvent('lfh:erinnerung-alarm', { detail }));
    };
    listeners.push(['erinnerung', onErinnerung as EventListener]);
```

- [ ] **Step 4: Tests laufen lassen — erwartet PASS**

Run: `mise exec pnpm@11.10.0 -- pnpm -C <WT>/frontend test src/etb/useEinsatzLiveStream.test.tsx`
Expected: PASS (inkl. der bestehenden Tests — der zweite `erinnerung`-Listener koexistiert mit der Registry-Invalidierung).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/etb/useEinsatzLiveStream.ts frontend/src/etb/useEinsatzLiveStream.test.tsx
git commit -m "feat(lfh-118): erinnerung-SSE-Side-Effect — abgestufter Alarm + auftraege-Invalidierung, Meldungs-Doppel-Alarm-Guard

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Frontend — `AlarmZentrale` (Toasts, Desktop, ein Mute-Toggle)

**Files:**
- Create: `frontend/src/einsatz/AlarmZentrale.tsx`, `frontend/src/einsatz/AlarmZentrale.test.tsx`
- Delete: `frontend/src/einsatz/SofortAlarm.tsx`, `frontend/src/einsatz/SofortAlarm.test.tsx`
- Modify: `frontend/src/einsatz/EinsatzLayout.tsx` (Import + Nutzung).

**Interfaces:**
- Consumes: `istAlarmGemutet`/`setzeAlarmMute` (Task 3), `desktopPermission`/`fordereDesktopPermission`/`zeigeDesktopAlarm` (Task 5), `auftraegePfad`/`erinnerungenPfad`/`meldungenPfad` (Task 4 + bestehend), window-Events `lfh:sofortmeldung` + `lfh:erinnerung-alarm`.
- Produces: Default-Export `AlarmZentrale` (React-Komponente für den Layout-Header).

- [ ] **Step 1: Test schreiben (failing)**

Create `frontend/src/einsatz/AlarmZentrale.test.tsx`:

```tsx
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { App as AntApp } from 'antd';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import AlarmZentrale from './AlarmZentrale';
import { istAlarmGemutet } from './alarmTon';

function renderAlarm() {
  return render(
    <AntApp>
      <MemoryRouter initialEntries={['/einsaetze/1/meldungen']}>
        <Routes><Route path="/einsaetze/:id/meldungen" element={<AlarmZentrale />} /></Routes>
      </MemoryRouter>
    </AntApp>,
  );
}

afterEach(() => localStorage.clear());

describe('AlarmZentrale', () => {
  it('zeigt einen Toast bei window-Event lfh:sofortmeldung', async () => {
    renderAlarm();
    act(() => { window.dispatchEvent(new CustomEvent('lfh:sofortmeldung', { detail: { meldung_id: 3 } })); });
    await waitFor(() => expect(screen.getByText('Sofortmeldung eingegangen')).toBeInTheDocument());
  });

  it('zeigt einen Erinnerungs-Toast bei lfh:erinnerung-alarm ohne Bezug', async () => {
    renderAlarm();
    act(() => { window.dispatchEvent(new CustomEvent('lfh:erinnerung-alarm', { detail: { erinnerung_id: 5, bezug_typ: null, bezug_id: null } })); });
    await waitFor(() => expect(screen.getByText('Erinnerung fällig')).toBeInTheDocument());
  });

  it('zeigt einen Auftrags-Toast bei lfh:erinnerung-alarm mit bezug_typ=auftrag', async () => {
    renderAlarm();
    act(() => { window.dispatchEvent(new CustomEvent('lfh:erinnerung-alarm', { detail: { erinnerung_id: 6, bezug_typ: 'auftrag', bezug_id: 12 } })); });
    await waitFor(() => expect(screen.getByText('Auftrag überfällig')).toBeInTheDocument());
  });

  it('globaler Mute-Toggle persistiert in localStorage', async () => {
    renderAlarm();
    expect(istAlarmGemutet()).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Alarm-Ton stummschalten' }));
    expect(istAlarmGemutet()).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Alarm-Ton einschalten' }));
    expect(istAlarmGemutet()).toBe(false);
  });
});
```

- [ ] **Step 2: Test laufen lassen — erwartet FAIL**

Run: `mise exec pnpm@11.10.0 -- pnpm -C <WT>/frontend test src/einsatz/AlarmZentrale.test.tsx`
Expected: FAIL (`AlarmZentrale` existiert nicht).

- [ ] **Step 3: `AlarmZentrale.tsx` erstellen**

Create `frontend/src/einsatz/AlarmZentrale.tsx`:

```tsx
import { App, Badge, Button, Tooltip } from 'antd';
import { BellOutlined, DesktopOutlined, NotificationOutlined } from '@ant-design/icons';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { istAlarmGemutet, setzeAlarmMute } from './alarmTon';
import { desktopPermission, fordereDesktopPermission, zeigeDesktopAlarm } from './desktopAlarm';
import { auftraegePfad, erinnerungenPfad, meldungenPfad } from '../routing/deeplinks';

type ErinnerungDetail = {
  erinnerung_id?: number;
  bezug_typ?: 'auftrag' | 'meldung' | null;
  bezug_id?: number | null;
};

/**
 * Einsatzweite Alarm-Zentrale (LFH-97/118): lauscht auf die window-CustomEvents
 * `lfh:sofortmeldung` und `lfh:erinnerung-alarm` (von useEinsatzLiveStream ausgelöst) und zeigt
 * unübersehbare, NICHT selbst-schließende Toasts mit Deeplink zur Quelle — plus optional eine
 * Desktop-Benachrichtigung bei Hintergrund-Tab. EIN globaler Mute-Toggle (Per-User, localStorage)
 * schaltet ALLE Alarmtöne. Im Layout-Header montiert → wirkt seitenunabhängig.
 * Toasts über App.useApp().notification (kein statischer Import — sonst Kontext-Leak in Tests).
 */
export default function AlarmZentrale() {
  const { notification } = App.useApp();
  const navigate = useNavigate();
  const { id } = useParams();
  const einsatzId = Number(id);
  const [gemutet, setGemutet] = useState(istAlarmGemutet());
  const [permission, setPermission] = useState(desktopPermission());
  // Fallback-Zähler für Toast-Keys ohne stabile ID (z. B. lagged-Sofortmeldung).
  const zaehler = useRef(0);

  // Sofortmeldung (LFH-97).
  useEffect(() => {
    const onSofort = (ev: Event) => {
      const detail = (ev as CustomEvent<{ meldung_id?: number }>).detail ?? {};
      const key = detail.meldung_id != null ? `sofort-${detail.meldung_id}` : `sofort-${++zaehler.current}`;
      const oeffnen = () => { navigate(meldungenPfad(einsatzId)); notification.destroy(key); };
      notification.warning({
        key,
        title: 'Sofortmeldung eingegangen',
        description: 'Eine Sofortmeldung erfordert Aufmerksamkeit — bitte sichten und bestätigen.',
        duration: 0,
        actions: (<Button type="primary" size="small" onClick={oeffnen}>Öffnen</Button>),
      });
      zeigeDesktopAlarm('Sofortmeldung eingegangen', {
        koerper: 'Bitte sichten und bestätigen.',
        beiKlick: () => navigate(meldungenPfad(einsatzId)),
      });
    };
    window.addEventListener('lfh:sofortmeldung', onSofort);
    return () => window.removeEventListener('lfh:sofortmeldung', onSofort);
  }, [notification, navigate, einsatzId]);

  // Fällige Erinnerung / Auftrags-Eskalation (LFH-118).
  useEffect(() => {
    const onErinnerung = (ev: Event) => {
      const detail = (ev as CustomEvent<ErinnerungDetail>).detail ?? {};
      const istAuftrag = detail.bezug_typ === 'auftrag';
      const key = istAuftrag ? `auftrag-${detail.bezug_id}` : `erinnerung-${detail.erinnerung_id}`;
      const titel = istAuftrag ? 'Auftrag überfällig' : 'Erinnerung fällig';
      const beschreibung = istAuftrag
        ? 'Ein Auftrag ist über seine Quittierfrist — bitte prüfen und quittieren.'
        : 'Eine Erinnerung ist fällig — bitte sichten.';
      const ziel = istAuftrag && detail.bezug_id != null
        ? auftraegePfad(einsatzId, { auftrag: detail.bezug_id })
        : erinnerungenPfad(einsatzId);
      const oeffnen = () => { navigate(ziel); notification.destroy(key); };
      const config = {
        key,
        title: titel,
        description: beschreibung,
        duration: 0,
        actions: (<Button type="primary" size="small" onClick={oeffnen}>Öffnen</Button>),
      };
      if (istAuftrag) notification.warning(config);
      else notification.info(config);
      zeigeDesktopAlarm(titel, { koerper: beschreibung, beiKlick: () => navigate(ziel) });
    };
    window.addEventListener('lfh:erinnerung-alarm', onErinnerung);
    return () => window.removeEventListener('lfh:erinnerung-alarm', onErinnerung);
  }, [notification, navigate, einsatzId]);

  const umschalten = () => {
    const neu = !gemutet;
    setzeAlarmMute(neu);
    setGemutet(neu);
  };

  const desktopAktivieren = () => {
    fordereDesktopPermission((p) => setPermission(p));
  };

  return (
    <>
      {permission === 'default' && (
        <Tooltip title="Desktop-Benachrichtigungen aktivieren">
          <Button
            type="text"
            aria-label="Desktop-Benachrichtigungen aktivieren"
            onClick={desktopAktivieren}
            icon={<DesktopOutlined style={{ color: '#fff' }} />}
          />
        </Tooltip>
      )}
      <Tooltip title={gemutet ? 'Alarm-Ton stummgeschaltet' : 'Alarm-Ton aktiv'}>
        <Button
          type="text"
          aria-label={gemutet ? 'Alarm-Ton einschalten' : 'Alarm-Ton stummschalten'}
          aria-pressed={gemutet}
          onClick={umschalten}
          icon={
            // Header ist in beiden Modi dunkel → Icon immer weiß; Farbe MUSS am Icon selbst sitzen
            // (der Badge-Wrapper setzt via resetComponent ein eigenes color).
            gemutet ? (
              <BellOutlined style={{ color: '#fff', opacity: 0.45 }} />
            ) : (
              <Badge dot status="error">
                <NotificationOutlined style={{ color: '#fff' }} />
              </Badge>
            )
          }
        />
      </Tooltip>
    </>
  );
}
```

- [ ] **Step 4: Test laufen lassen — erwartet PASS**

Run: `mise exec pnpm@11.10.0 -- pnpm -C <WT>/frontend test src/einsatz/AlarmZentrale.test.tsx`
Expected: PASS.

- [ ] **Step 5: `EinsatzLayout` umstellen + alte Komponente löschen**

1. `frontend/src/einsatz/EinsatzLayout.tsx`: `import SofortAlarm from './SofortAlarm';` → `import AlarmZentrale from './AlarmZentrale';`; im JSX `<SofortAlarm />` → `<AlarmZentrale />`.
2. Löschen: `git rm frontend/src/einsatz/SofortAlarm.tsx frontend/src/einsatz/SofortAlarm.test.tsx`.

- [ ] **Step 6: Gates grün (Test + Typecheck + Lint)**

Run: `mise exec pnpm@11.10.0 -- pnpm -C <WT>/frontend test src/einsatz/AlarmZentrale.test.tsx src/einsatz/EinsatzLayout.test.tsx`
Run: `mise exec pnpm@11.10.0 -- pnpm -C <WT>/frontend typecheck`
Run: `mise exec pnpm@11.10.0 -- pnpm -C <WT>/frontend lint`
Expected: alle PASS (keine offenen `SofortAlarm`-Referenzen mehr).

- [ ] **Step 7: Commit**

```bash
git add -A frontend/src/einsatz/AlarmZentrale.tsx frontend/src/einsatz/AlarmZentrale.test.tsx frontend/src/einsatz/EinsatzLayout.tsx
git commit -m "feat(lfh-118): AlarmZentrale — Erinnerungs-/Auftrags-Toasts, Desktop-Notification, globaler Mute

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Abschluss-Gate (nach allen Tasks, vor Merge)

- [ ] **Backend-Vollsuite** (Dev-Vars ge-`env -u`-t): `env -u LIFELINE_DOWNLOAD_ALLOW_LOOPBACK cargo test` → alle grün. Falls weitere Dev-Vars aus mise/.env gesetzt sind, ebenfalls `-u`en (SSRF/Loopback-Test sonst falsch-rot).
- [ ] **rustfmt-clean:** `cargo fmt --all --check`.
- [ ] **Frontend-Vollsuite (sauberes Gate):** `mise exec pnpm@11.10.0 -- pnpm -C <WT>/frontend test -- --no-file-parallelism` + `typecheck` + `lint`.
- [ ] **Manuelle Verifikation** (superpowers:verification-before-completion): Backend mit `--admin-password` starten, eine Erinnerung fällig werden lassen bzw. einen Auftrag mit kurzer Frist anlegen → In-App-Toast + Ton in einem anderen Modul beobachten; Meldungs-Eskalation löst genau EINEN Alarm aus (kein Doppel).
- [ ] **Kein Typ-Codegen betroffen:** Es wurden keine `#[derive(ToSchema)]`-Response-Structs geändert (nur SSE-`data`-JSON + interne Verdrahtung) → `scripts/check-typ-codegen.sh` nicht erforderlich. Falls doch ein Response-DTO angefasst wurde, Skript laufen lassen und generierte Artefakte mitcommitten.

## Self-Review (gegen die Spec)

- **AK1 (Erinnerung fällig → Benachrichtigung + Sprung, modulfremd):** Task 1 (Payload) + Task 6 (Side-Effect) + Task 7 (Info-Toast + `erinnerungenPfad`). ✓
- **AK2 (Frist/Eskalation Auftrag+Meldung → Benachrichtigung + abgestufter Ton):** Meldung = bestehender `sofortmeldung`-Pfad (Alarmton); Auftrag = Task 2 (Verdrahtung) + Task 6 (Alarmton + `auftraege`-Invalidierung) + Task 7 (Warning-Toast + `auftraegePfad`). Abgestufte Töne = Task 3 (`spieleAlarmTon('dezent'|'alarm')`). ✓
- **AK3 (quittier-/stummschaltbar, nicht endlos):** Task 3 (globaler Mute) + Task 7 (Toast-`destroy` + Dedup-Keys `erinnerung-<R>`/`auftrag-<A>`/`sofort-<mid>`) + Backend-One-Shot (`markiere_ausgeloest`/`schliesse_offene_auto`, Task 1/2). ✓
- **Doppel-Alarm-Guard (Meldungs-Frist feuert erinnerung+sofortmeldung):** Task 6 überspringt `bezug_typ='meldung'`; fixiert durch Test in Task 6. ✓
- **Desktop-Notification (opt-in-Scope):** Task 5 (Helper) + Task 7 (Aktivieren-Button + `zeigeDesktopAlarm`). ✓
- **Reconnect/Multi-Tab:** `lagged` löst den Side-Effect nicht aus (nur `erinnerung`/`sofortmeldung`); Backend-One-Shot deckt Reconnect. Cross-Tab-Dedup bewusst out-of-scope (Spec). ✓
