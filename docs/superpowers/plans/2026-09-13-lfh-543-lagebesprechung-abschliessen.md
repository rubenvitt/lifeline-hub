# LFH-543 · Stab ST5 — „Lagebesprechung abschließen" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Stab-Seite bekommt die Lagebesprechung: eine Maske „Lagebesprechung abschließen" (Entschluss, nächster Termin mit Schnellwahl, Zeitpunkt eingeklappt), eine Sektion mit Countdown, letzter Besprechung, Anzahl und Historie, die Kopfaktion samt Kommandopaletten-Weg und eine Schnellaktion `?neu=1`.

**Architecture:** Reine, exportierte Funktionen tragen die Logik und sind ohne Render geprüft: `components/terminSchnellwahl.ts` (aus der ETB-Wiedervorlage gehoben), `stab/lagebesprechungZustand.ts` (Countdown), `stab/lagebesprechungAbschluss.ts` (Vorbelegung, Tri-State-Body, Zuordnung der POST-Antwort). Die Maske `stab/LagebesprechungModal.tsx` sitzt auf `ErfassungsModal`, der Toast in `stab/abschlussToast.tsx` nach der Bauform von `kommunikation/rueckgaengig.tsx`. `stab/LagebesprechungStand.tsx` (Descriptions + 30-s-Uhr) und `stab/LagebesprechungHistorie.tsx` (Liste) werden in `pages/StabPage.tsx` zusammengesetzt; dort stehen auch Kopfaktion, `neueZeile` und der `?neu=1`-Leser.

**Tech Stack:** React 19, antd 6.5, TanStack Query 5, react-router 8, dayjs (utc), Vitest 4 + Testing Library + MSW.

**Spec:** `docs/superpowers/specs/2026-09-12-lfh-46-stab-s1-s6-design.md` (Abschnitte 4 — Entscheidungen 8–11, 16 —, 9, 10, 11). Ticket: LFH-543. Vorgänger-Plan (Format, Bestand): `docs/superpowers/plans/2026-09-13-lfh-542-stab-grundseite.md`. Aufsetzpunkt: `c8c56666` auf `feat/lfh-46-stab-frontend`.

## Global Constraints

- `FE=/Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/clickup-forgejo-exe-9430ca/frontend`. pnpm immer als `mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/clickup-forgejo-exe-9430ca/frontend …` — **ohne `rtk`, ohne Pipe** (der Exit-Code muss durchkommen).
- Branch `feat/lfh-46-stab-frontend`. Commits referenzieren `LFH-543` und enden mit `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Keine Tabelle, kein `Datensicht`, kein Drawer (Spec Entscheidung 16). Kein `size="small"` auf Interaktivem (`Descriptions` ist nicht interaktiv und darf es), kein Emoji.
- Schreibrecht nur über `darfImEinsatzSchreiben(einsatz, benutzer)` (`einsatz/schreibrecht.ts:62`, nimmt optionale Argumente und liefert für `undefined` `false`).
- Farben nur über `StatusTag`/Tokens; kein `Record<…, StatusDarstellung>` außerhalb `theme/statusFarben.ts`. Eine **Funktion**, die eine `StatusDarstellung` baut, ist zulässig (benannter blinder Fleck, `theme/statusVertrag.guard.test.ts:91-95`) und wird **nicht** nach `statusFarben.ts` gelegt (dort zählt der Abdeckungstest die Vertragskarten aus den Exporten).
- Handgebaute Bedienziele (Links) tragen `stabZeilenzielStil(token)` aus `stab/zeilenziel.ts` (ST4).
- Deeplinks nur über `routing/deeplinks.ts` (`etbPfad` `:218`, `stabPfad` `:190`); Query-Keys nur über `api/queryKeys.ts` (Inline-Arrays per Guard verboten).
- **Backend-Vertrag** `POST /api/einsaetze/{id}/stab/lagebesprechungen` (`src/routes/stab.rs:185-275`): Body `{ entschluss: string (Pflicht, getrimmt), abgehalten_at?: string, naechste_at?: string | null }`. `naechste_at` ist dreiwertig: **Schlüssel fehlt = Termin unverändert** (Snapshot übernimmt den geltenden Termin) · **`null` = löschen** · **Wert = setzen**; **`""` löscht still** (`support::trimme_tri`) → das Frontend schickt nie `""`. Zeiten als UTC `'YYYY-MM-DD HH:mm:ss'` (Rückgabe immer so). Antwort **201** mit `StabAnzeige`, nach dem Commit in einer **zweiten** Lesetransaktion geladen; die ETB-id steht **nur** in `letzte_lagebesprechung.etb_eintrag_id` und kann bei gleichzeitigem Abschluss eine fremde Zeile sein. **422** bei `naechste_at ≤ abgehalten_at` (nur geprüft, wenn der Request einen Wert trägt), **409** im abgeschlossenen Einsatz, **400** bei leerem `entschluss`. `GET …/stab/lagebesprechungen` → `LagebesprechungAnzeige[]` absteigend nach `lfd_nr`.
- `StabAnzeige` (`api/types.generated.ts:2059-2065`): `naechste_lagebesprechung_at?` und `letzte_lagebesprechung?` sind im Leerfall **absent**. `LagebesprechungAnzeige` (`:1366-1381`): `id, einsatz_id, lfd_nr, abgehalten_at, entschluss, naechste_at?, etb_eintrag_id, erfasst_von_id, erfasst_at`.
- Live: `EINSATZ_STREAM_EVENTS.stab` invalidiert den Prefix `einsatz-stab` (Bestand, `api/queryKeys.ts:139-143`); die Historie hängt als Sub-Key darunter und wird mit invalidiert. `einsatz` bleibt `NICHT_LIVE`.
- Wire-Zeiten: `dayjs.utc(s)`, nie `dayjs(s)`. Vitest setzt **kein** `TZ` (`frontend/vite.config.ts`, test-Block) — ein Zeitzonen-Test trägt nur über den Vergleich mit dem **absoluten** Zeitpunkt (`.valueOf()`), Muster `etb/filterZeit.test.ts:17-37`.
- Tests: Böden/Literale nie aus der Quelle zurückgelesen; jede „keine/nie"-Aussage steht neben einem Gegenfall. Offen/zu eines Dialogs, der **montiert bleibt**, über `ant-zoom-leave`, nie über `toBeVisible()`. MSW läuft mit `onUnhandledRequest: 'error'`.
- Die Maske friert Vorbelegung und Vergleichsbasis beim **Öffnen** ein (`useState`) — `stab` wird live invalidiert (LFH-303, ST4-Abschlussreview). Öffnen = Montieren: die Seite rendert `{offen && <LagebesprechungModal …/>}`.

## Abweichungen vom Ticket (bewusst, mit Grund)

1. **Schnellwahl-Beschriftungen „+30 min" / „+1 h" / „+2 h" statt „+30/+60/+120 min".** Die Beschriftungen sind Bestand der Wiedervorlage und hängen an Tests (`etb/WiedervorlageModal.test.tsx:109,123`, `pages/EtbPage.test.tsx:186`). Die Stab-Maske nimmt die Teilmenge aus derselben Tabelle; `WiedervorlageModal` behält alle vier Einträge.
2. **Die Schnellwahl rechnet vom eingetragenen Zeitpunkt der Besprechung, nicht von der Wanduhr** (Controller-Entscheidung 1). Ab `dayjs()` erzeugte ein lange offener Dialog oder ein vorverlegter Zeitpunkt genau den Server-422 `naechste_at ≤ abgehalten_at`.
3. **Vorbelegung „Nächste Lagebesprechung" = bestehender Termin, wenn zukünftig, sonst leer** (Nutzerentscheidung). Unverändert abgeschickt → Schlüssel weggelassen; „kein Termin" oder leeres Feld → `null`. Die Kollision mit „ohne Vorbelegung, leer gelassen" steht unter „Offene Punkte" (Punkt 1).
4. **`abgehalten_at` wird immer mitgeschickt** (leer → Zeitpunkt des Absendens), statt bei leerem Feld wegzulassen. Nur so lässt sich prüfen, ob `letzte_lagebesprechung` zur eigenen Anfrage gehört (gleiche `entschluss` nach Trim **und** gleiche `abgehalten_at`). `forceRender` am Collapse garantiert, dass der Wert auch zugeklappt in `onFinish` ankommt.
5. **Erfolgs-Toast verlinkt auf `etbPfad(einsatzId, { eintrag })` nur bei passender Zeile**, sonst auf das ETB ohne Eintrag („Zum ETB") — die Antwort kann eine fremde Zeile tragen (Controller-Vorgabe).
6. **Kein `mutation.reset()` beim Öffnen.** Die `FreigabeDialog`-Bauform braucht ihn, weil ihr Dialog montiert bleibt. Hier ist Öffnen = Montieren; jede Öffnung hat eine frische `useMutation`-Instanz ohne alten Fehler. Belegt durch den Seiten-Test „öffnet nach einem Fehler ohne den Grund des vorigen Versuchs".
7. **Kopfaktion und `neueZeile` sind zusätzlich gesperrt, solange der Stand (`GET …/stab`) nicht da ist.** Ohne ihn fehlte der bestehende Termin zur Vorbelegung, und ein unverändertes Absenden schickte `naechste_at: null` — es löschte einen Termin, den die Person nie gesehen hat. Der `?neu=1`-Leser wartet deshalb auf Einsatz **und** Stand.
8. **Countdown-Wortlaut ab 60 min** „in 2 h 05 min" / „seit 1 h 10 min überfällig", ganze Minuten abgerundet, `termin ≤ jetzt` = überfällig (Controller-Entscheidung 2). Ein unlesbarer Wire-String heißt „Termin unlesbar", nicht „kein Termin".
9. **Der Rechte-Hinweis nennt beide gesperrten Wege.** `besetzungRechteText` (`stab/besetzung.ts`) sagt künftig „… können die Besetzung ändern und Lagebesprechungen abschließen." Der Name bleibt (ST4-Tests und Aufrufer), die Regex-Pins in `besetzung.test.ts:176-181` und `StabPage.test.tsx` halten.
10. **Nach Erfolg wird zusätzlich `einsatzKeys.einsatz` invalidiert** — Hygiene nach Spec Entscheidung 11 (die Einsatzdaten-Seite zeigt denselben Termin), keine Korrektheitsvoraussetzung: der Countdown liest `StabAnzeige.naechste_lagebesprechung_at`.
11. **Korrektur an der Kontextdatei:** „kein Bestandsbeispiel kombiniert `forceRender` mit einem Collapse-Feldbudget" trifft nicht zu. `pages/MaterialPage.tsx:616-630` tut genau das, `pages/MaterialPage.test.tsx:480-560` ist die Messung (CSSMotion legt `display: none` **direkt** ans eingeklappte Element, deshalb hält die Rollen-Zählung in jsdom). Controller-Entscheidung 4 ist damit gemessen; der Plan übernimmt die Zählhilfe wörtlich und prüft zusätzlich als Vorbedingung, dass die `DatePicker`-Eingabe von der Rollenliste überhaupt erfasst wird.

## Dateistruktur

| Datei | Verantwortung |
|---|---|
| `frontend/src/components/terminSchnellwahl.ts` (Create) | geteilte Schnellwahl-Tabelle, Teilmenge, Terminrechnung ab Bezug |
| `frontend/src/etb/WiedervorlageModal.tsx` (Modify) | nutzt die geteilte Tabelle und Rechnung |
| `frontend/src/stab/lagebesprechungZustand.ts` (Create) | `terminZeitpunkt`, `dauerText`, `lagebesprechungZustand` |
| `frontend/src/stab/lagebesprechungAbschluss.ts` (Create) | Formwerte-Typ, Vorbelegung, Tri-State-Body, Zuordnung der Antwort, Kürzung |
| `frontend/src/api/types.ts` (Modify) | FE-lokaler Body `LagebesprechungAbschlussBody` |
| `frontend/src/api/stab.ts` (Modify) | `ladeLagebesprechungen`, `schliesseLagebesprechungAb` |
| `frontend/src/api/queryKeys.ts` (Modify) | `einsatzKeys.stabLagebesprechungen` |
| `frontend/src/stab/abschlussToast.tsx` (Create) | Erfolgs-Toast mit ETB-Deeplink |
| `frontend/src/stab/LagebesprechungModal.tsx` (Create) | Maske „Lagebesprechung abschließen" |
| `frontend/src/stab/LagebesprechungStand.tsx` (Create) | Descriptions Nächste/Letzte/Anzahl, 30-s-Uhr |
| `frontend/src/stab/LagebesprechungHistorie.tsx` (Create) | Liste der abgeschlossenen Besprechungen |
| `frontend/src/stab/besetzung.ts` (Modify) | Rechte-Text nennt beide Wege |
| `frontend/src/pages/StabPage.tsx` (Modify) | Sektion, Kopfaktion, `neueZeile`, `?neu=1`-Leser, Modal-Mount, Toast |
| `frontend/src/command-palette/befehle.ts` (Modify) | `SCHNELLAKTIONEN`-Eintrag `stab` |

Basenamen geprüft gegen `test/dateinamen.guard.test.ts` und die case-insensitive Beschattung (CLAUDE.md, LFH-347): keine `.ts` teilt ihren Basenamen mit einer `.tsx`.

---

### Task 1: Geteilte Schnellwahl aus der Wiedervorlage heben

**Files:**
- Create: `frontend/src/components/terminSchnellwahl.ts`
- Test: `frontend/src/components/terminSchnellwahl.test.ts`
- Modify: `frontend/src/etb/WiedervorlageModal.tsx:36-52` (Konstante) und `:150-156` (Rechnung im `onClick`)

**Interfaces:**
- Consumes: `Dayjs` aus `dayjs`.
- Produces:
  - `interface SchnellwahlEintrag { readonly label: string; readonly minuten: number }`
  - `const SCHNELLWAHL_TERMIN: readonly SchnellwahlEintrag[]` (15/30/60/120 mit „+15 min"/„+30 min"/„+1 h"/„+2 h")
  - `schnellwahlAuswahl(minuten: readonly number[]): SchnellwahlEintrag[]`
  - `schnellwahlTermin(bezug: Dayjs, minuten: number): Dayjs`

- [ ] **Step 1: Failing test schreiben**

`frontend/src/components/terminSchnellwahl.test.ts`:

```ts
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { describe, expect, it } from 'vitest';
import { SCHNELLWAHL_TERMIN, schnellwahlAuswahl, schnellwahlTermin } from './terminSchnellwahl';

dayjs.extend(utc);

describe('SCHNELLWAHL_TERMIN', () => {
  /**
   * Die Beschriftungen sind Bestand der ETB-Wiedervorlage und hängen dort an Tests
   * (`WiedervorlageModal.test.tsx`, `EtbPage.test.tsx`). Als LITERALE gepinnt, nicht aus der
   * Tabelle zurückgelesen — sonst prüfte der Test die Tabelle gegen sich selbst.
   */
  it('trägt genau die vier Bestandseinträge', () => {
    expect(SCHNELLWAHL_TERMIN.map((e) => [e.label, e.minuten])).toEqual([
      ['+15 min', 15],
      ['+30 min', 30],
      ['+1 h', 60],
      ['+2 h', 120],
    ]);
  });
});

describe('schnellwahlAuswahl', () => {
  it('liefert die Teilmenge in Tabellenreihenfolge, unabhängig von der Aufrufreihenfolge', () => {
    expect(schnellwahlAuswahl([120, 30, 60]).map((e) => e.label)).toEqual([
      '+30 min',
      '+1 h',
      '+2 h',
    ]);
  });

  it('wirft bei einer unbekannten Minutenzahl, statt einen Knopf still wegzulassen', () => {
    expect(() => schnellwahlAuswahl([30, 45])).toThrow('45');
  });
});

describe('schnellwahlTermin', () => {
  it('rechnet vom übergebenen Bezug, nicht von der Wanduhr', () => {
    const bezug = dayjs('2026-09-13T08:00:00Z');
    expect(schnellwahlTermin(bezug, 60).valueOf()).toBe(dayjs('2026-09-13T09:00:00Z').valueOf());
  });

  it('rechnet über die Sommerzeitgrenze in echten Minuten', () => {
    // 00:30Z = 01:30 MEZ; zwei echte Stunden später ist 02:30Z = 04:30 MESZ.
    const bezug = dayjs('2026-03-29T00:30:00Z');
    expect(schnellwahlTermin(bezug, 120).valueOf()).toBe(
      dayjs('2026-03-29T02:30:00Z').valueOf(),
    );
  });
});
```

- [ ] **Step 2: Test rot sehen**

Run: `mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/clickup-forgejo-exe-9430ca/frontend exec vitest run src/components/terminSchnellwahl.test.ts`
Expected: FAIL — Modul `./terminSchnellwahl` nicht gefunden.

- [ ] **Step 3: Modul implementieren**

`frontend/src/components/terminSchnellwahl.ts`:

```ts
import type { Dayjs } from 'dayjs';

/**
 * Schnellwahl relativer Termine — geteilt von der ETB-Wiedervorlage (LFH-342 · C7) und dem
 * Abschluss der Lagebesprechung (LFH-543). Gehoben, nicht kopiert: zwei Tabellen mit denselben
 * Beschriftungen liefen auseinander, ohne dass ein Test es bemerkt.
 *
 * Die Beschriftungen sind Bestand und hängen an Tests („+1 h", nicht „+60 min").
 * `components/`, nicht `etb/` oder `stab/`: beide Module konsumieren sie, keines besitzt sie.
 */
export interface SchnellwahlEintrag {
  readonly label: string;
  readonly minuten: number;
}

export const SCHNELLWAHL_TERMIN: readonly SchnellwahlEintrag[] = [
  { label: '+15 min', minuten: 15 },
  { label: '+30 min', minuten: 30 },
  { label: '+1 h', minuten: 60 },
  { label: '+2 h', minuten: 120 },
];

/**
 * Die Einträge zu den genannten Minuten, in Tabellenreihenfolge.
 *
 * Eine unbekannte Minutenzahl ist ein Programmierfehler und wirft: still weggelassen fehlte ein
 * Knopf, ohne dass es jemand bemerkt.
 */
export function schnellwahlAuswahl(minuten: readonly number[]): SchnellwahlEintrag[] {
  const unbekannt = minuten.filter((m) => !SCHNELLWAHL_TERMIN.some((e) => e.minuten === m));
  if (unbekannt.length > 0) {
    throw new Error(`Keine Schnellwahl für ${unbekannt.join(', ')} min`);
  }
  return SCHNELLWAHL_TERMIN.filter((e) => minuten.includes(e.minuten));
}

/**
 * Termin = Bezug + Minuten. Der Bezug ist Sache des Aufrufers: die Wiedervorlage rechnet ab
 * jetzt, der Abschluss der Lagebesprechung ab dem Zeitpunkt der Besprechung — sonst lehnte das
 * Backend `naechste_at ≤ abgehalten_at` mit 422 ab (`src/routes/stab.rs:240-246`).
 */
export function schnellwahlTermin(bezug: Dayjs, minuten: number): Dayjs {
  return bezug.add(minuten, 'minute');
}
```

- [ ] **Step 4: Wiedervorlage auf das geteilte Modul umstellen**

In `frontend/src/etb/WiedervorlageModal.tsx` nach `import { ErfassungsModal } from '../components/Erfassung';` einfügen:

```ts
import { SCHNELLWAHL_TERMIN, schnellwahlTermin } from '../components/terminSchnellwahl';
```

Den Block

```ts
const SCHNELLWAHL = [
  { label: '+15 min', minuten: 15 },
  { label: '+30 min', minuten: 30 },
  { label: '+1 h', minuten: 60 },
  { label: '+2 h', minuten: 120 },
] as const;
```

ersetzen durch (der Doc-Kommentar darüber bleibt stehen):

```ts
// Die Tabelle ist seit LFH-543 geteilt (`components/terminSchnellwahl.ts`); die Wiedervorlage
// nimmt alle vier Einträge und rechnet weiterhin ab jetzt.
const SCHNELLWAHL = SCHNELLWAHL_TERMIN;
```

Im `onClick` der Schnellwahl-Knöpfe

```tsx
              onClick={() => form.setFieldValue('faellig', dayjs().add(s.minuten, 'minute'))}
```

ersetzen durch

```tsx
              onClick={() => form.setFieldValue('faellig', schnellwahlTermin(dayjs(), s.minuten))}
```

- [ ] **Step 5: Tests grün — neu und Bestand**

Run: `mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/clickup-forgejo-exe-9430ca/frontend exec vitest run src/components/terminSchnellwahl.test.ts src/etb/WiedervorlageModal.test.tsx src/pages/EtbPage.test.tsx`
Expected: PASS, die Bestandstests der Wiedervorlage und der ETB-Seite **unverändert**.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/terminSchnellwahl.ts frontend/src/components/terminSchnellwahl.test.ts frontend/src/etb/WiedervorlageModal.tsx
git commit -m "refactor(etb): Termin-Schnellwahl als geteiltes Modul (LFH-543)" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Countdown und Abschluss-Logik (reine Funktionen)

**Files:**
- Modify: `frontend/src/api/types.ts` (direkt nach `export interface BesetzungBody { … }`, Stab-Block ab `:329`)
- Create: `frontend/src/stab/lagebesprechungZustand.ts`, `frontend/src/stab/lagebesprechungZustand.test.ts`
- Create: `frontend/src/stab/lagebesprechungAbschluss.ts`, `frontend/src/stab/lagebesprechungAbschluss.test.ts`

Der Body-Typ steht hier und nicht in Task 3, weil `abschlussBody` ihn liefert — die reinen Funktionen sollen mit ihrem eigenen Typcheck freigegeben werden.

**Interfaces:**
- Consumes: `Stab`, `Lagebesprechung` aus `api/types` (Bestand `:330-332`); `StatusDarstellung` aus `theme/statusFarben` (`:94`); `alsBackendZeit(d: Dayjs): string` aus `etb/filterZeit` (`:22`).
- Produces:
  - `interface LagebesprechungAbschlussBody { entschluss: string; abgehalten_at?: string; naechste_at?: string | null }` aus `api/types`
  - `terminZeitpunkt(wire: string | null | undefined): Dayjs | null`
  - `dauerText(minuten: number): string`
  - `lagebesprechungZustand(terminWire: string | null | undefined, jetzt: Dayjs): StatusDarstellung`
  - `interface AbschlussFormWerte { entschluss: string; naechste?: Dayjs | null; abgehalten?: Dayjs | null }`
  - `interface AbschlussVorbelegung { naechste: Dayjs | null; abgehalten: Dayjs }`
  - `abschlussVorbelegung(terminWire: string | null | undefined, jetzt: Dayjs): AbschlussVorbelegung`
  - `abschlussBody(werte: AbschlussFormWerte, vorbelegung: AbschlussVorbelegung, jetzt: Dayjs): LagebesprechungAbschlussBody`
  - `eigeneLagebesprechung(antwort: Stab, gesendet: LagebesprechungAbschlussBody): Lagebesprechung | undefined`
  - `kuerzeEntschluss(text: string, max?: number): string`

- [ ] **Step 1: Body-Typ anlegen**

In `frontend/src/api/types.ts` direkt nach dem Interface `BesetzungBody`:

```ts
/**
 * LFH-120: kein Backend-Schema — Eingabe-Body von `POST …/stab/lagebesprechungen`, FE-lokal.
 *
 * `naechste_at` ist DREIWERTIG (`src/routes/stab.rs:193-194, 233-237`): Schlüssel fehlt =
 * Termin unverändert · `null` = löschen · Wert = setzen. Ein leerer String löscht STILL
 * (`support::trimme_tri`) — Aufrufer schicken nie `''`. Zeiten als UTC 'YYYY-MM-DD HH:mm:ss'.
 */
export interface LagebesprechungAbschlussBody {
  entschluss: string;
  abgehalten_at?: string;
  naechste_at?: string | null;
}
```

- [ ] **Step 2: Failing tests schreiben**

`frontend/src/stab/lagebesprechungZustand.test.ts`:

```ts
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { describe, expect, it } from 'vitest';
import { dauerText, lagebesprechungZustand, terminZeitpunkt } from './lagebesprechungZustand';

dayjs.extend(utc);

/** Wire-Form eines absoluten Zeitpunkts — so, wie das Backend ihn schickt (UTC ohne Zone). */
const wire = (iso: string) => dayjs(iso).utc().format('YYYY-MM-DD HH:mm:ss');

describe('dauerText', () => {
  it.each([
    [0, '0 min'],
    [23, '23 min'],
    [59, '59 min'],
    [60, '1 h 00 min'],
    [70, '1 h 10 min'],
    [125, '2 h 05 min'],
  ])('%i Minuten → „%s"', (minuten, text) => {
    expect(dauerText(minuten)).toBe(text);
  });
});

describe('lagebesprechungZustand', () => {
  const jetzt = dayjs('2026-09-13T10:00:00Z');

  it('ohne Termin: „kein Termin", neutral', () => {
    for (const leer of [undefined, null, '']) {
      expect(lagebesprechungZustand(leer, jetzt)).toEqual({ rolle: 'neutral', label: 'kein Termin' });
    }
  });

  it('ein unlesbarer Termin behauptet NICHT „kein Termin"', () => {
    expect(lagebesprechungZustand('kaputt', jetzt)).toEqual({
      rolle: 'neutral',
      label: 'Termin unlesbar',
    });
  });

  it('zukünftig: „in 23 min", neutral — auf ganze Minuten abgerundet', () => {
    expect(lagebesprechungZustand(wire('2026-09-13T10:23:59Z'), jetzt)).toEqual({
      rolle: 'neutral',
      label: 'in 23 min',
    });
  });

  it('zukünftig ab 60 min mit Stunden', () => {
    expect(lagebesprechungZustand(wire('2026-09-13T12:05:00Z'), jetzt).label).toBe(
      'in 2 h 05 min',
    );
  });

  it('vergangen: „seit 5 min überfällig", achtung', () => {
    expect(lagebesprechungZustand(wire('2026-09-13T09:54:30Z'), jetzt)).toEqual({
      rolle: 'achtung',
      label: 'seit 5 min überfällig',
    });
  });

  it('überfällig ab 60 min mit Stunden', () => {
    expect(lagebesprechungZustand(wire('2026-09-13T08:50:00Z'), jetzt).label).toBe(
      'seit 1 h 10 min überfällig',
    );
  });

  it('genau am Termin gilt als überfällig — eine Sekunde davor noch nicht (Grenze ≤)', () => {
    expect(lagebesprechungZustand(wire('2026-09-13T10:00:00Z'), jetzt)).toEqual({
      rolle: 'achtung',
      label: 'seit 0 min überfällig',
    });
    expect(lagebesprechungZustand(wire('2026-09-13T10:00:01Z'), jetzt)).toEqual({
      rolle: 'neutral',
      label: 'in 0 min',
    });
  });
});

/**
 * Beidseits beider Sommerzeitgrenzen (29.03.2026 und 25.10.2026, je 01:00Z).
 *
 * Vitest setzt KEIN `TZ` (`vite.config.ts`, test-Block): in einer UTC-Umgebung ist ein lokaler
 * Parse (`dayjs(s)` statt `dayjs.utc(s)`) vom richtigen nicht zu unterscheiden. Die tragende
 * Zeile ist deshalb der Vergleich gegen den ABSOLUTEN Zeitpunkt (Muster `etb/filterZeit.test.ts`);
 * auf einer Maschine in Europe/Berlin wird ein lokaler Parse hier rot.
 */
describe('lagebesprechungZustand an den Sommerzeitgrenzen', () => {
  it.each([
    '2026-03-29T00:30:00Z',
    '2026-03-29T01:30:00Z',
    '2026-10-25T00:30:00Z',
    '2026-10-25T01:30:00Z',
  ])('liest %s als UTC-Zeitpunkt', (iso) => {
    expect(terminZeitpunkt(wire(iso))!.valueOf()).toBe(dayjs(iso).valueOf());
  });

  it('März: rechnet in echten Minuten, nicht in Wanduhrzeit', () => {
    // 00:30Z = 01:30 MEZ, 01:30Z = 03:30 MESZ — auf der Wanduhr 2 h, tatsächlich 1 h.
    expect(
      lagebesprechungZustand(wire('2026-03-29T01:30:00Z'), dayjs('2026-03-29T00:30:00Z')).label,
    ).toBe('in 1 h 00 min');
    expect(
      lagebesprechungZustand(wire('2026-03-29T00:30:00Z'), dayjs('2026-03-29T01:30:00Z')).label,
    ).toBe('seit 1 h 00 min überfällig');
  });

  it('Oktober: rechnet in echten Minuten, nicht in Wanduhrzeit', () => {
    // 00:30Z = 02:30 MESZ, 01:30Z = 02:30 MEZ — auf der Wanduhr 0 h, tatsächlich 1 h.
    expect(
      lagebesprechungZustand(wire('2026-10-25T01:30:00Z'), dayjs('2026-10-25T00:30:00Z')).label,
    ).toBe('in 1 h 00 min');
    expect(
      lagebesprechungZustand(wire('2026-10-25T00:30:00Z'), dayjs('2026-10-25T01:30:00Z')).label,
    ).toBe('seit 1 h 00 min überfällig');
  });
});
```

`frontend/src/stab/lagebesprechungAbschluss.test.ts`:

```ts
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { describe, expect, it } from 'vitest';
import type { Lagebesprechung, LagebesprechungAbschlussBody, Stab } from '../api/types';
import {
  abschlussBody,
  abschlussVorbelegung,
  eigeneLagebesprechung,
  kuerzeEntschluss,
} from './lagebesprechungAbschluss';

dayjs.extend(utc);

const JETZT = dayjs('2026-09-13T10:00:00Z');
const wire = (iso: string) => dayjs(iso).utc().format('YYYY-MM-DD HH:mm:ss');

describe('abschlussVorbelegung', () => {
  it('belegt mit dem bestehenden Termin vor, wenn er in der Zukunft liegt', () => {
    const v = abschlussVorbelegung(wire('2026-09-13T10:45:00Z'), JETZT);
    expect(v.naechste!.valueOf()).toBe(dayjs('2026-09-13T10:45:00Z').valueOf());
    expect(v.abgehalten.valueOf()).toBe(JETZT.valueOf());
  });

  it('lässt das Feld leer bei vergangenem, genau jetzigem oder fehlendem Termin', () => {
    expect(abschlussVorbelegung(wire('2026-09-13T09:55:00Z'), JETZT).naechste).toBeNull();
    expect(abschlussVorbelegung(wire('2026-09-13T10:00:00Z'), JETZT).naechste).toBeNull();
    expect(abschlussVorbelegung(undefined, JETZT).naechste).toBeNull();
  });
});

describe('abschlussBody — Tri-State von naechste_at', () => {
  const mitTermin = abschlussVorbelegung(wire('2026-09-13T10:45:00Z'), JETZT);
  const ohneTermin = abschlussVorbelegung(undefined, JETZT);

  it('unverändert vorbelegter Termin → Schlüssel FEHLT', () => {
    const body = abschlussBody(
      { entschluss: 'Lage unverändert', naechste: mitTermin.naechste, abgehalten: JETZT },
      mitTermin,
      JETZT,
    );
    expect(Object.keys(body)).not.toContain('naechste_at');
  });

  it('geänderter Termin → Wert (Gegenfall zum fehlenden Schlüssel)', () => {
    const body = abschlussBody(
      {
        entschluss: 'Lage unverändert',
        naechste: dayjs('2026-09-13T11:00:00Z'),
        abgehalten: JETZT,
      },
      mitTermin,
      JETZT,
    );
    expect(body.naechste_at).toBe('2026-09-13 11:00:00');
  });

  it('geleertes Feld trotz Vorbelegung → null, nie ""', () => {
    const body = abschlussBody(
      { entschluss: 'Lage unverändert', naechste: null, abgehalten: JETZT },
      mitTermin,
      JETZT,
    );
    expect(body).toHaveProperty('naechste_at', null);
  });

  it('ohne Vorbelegung und leer gelassen → null, nicht weggelassen (Offener Punkt 1)', () => {
    const body = abschlussBody({ entschluss: 'x', naechste: undefined, abgehalten: JETZT }, ohneTermin, JETZT);
    expect(body).toHaveProperty('naechste_at', null);
  });

  it('trimmt den Entschluss und schickt den Zeitpunkt immer mit', () => {
    const body = abschlussBody(
      { entschluss: '  Räumung fortsetzen \n', naechste: null, abgehalten: dayjs('2026-09-13T09:40:00Z') },
      ohneTermin,
      JETZT,
    );
    expect(body.entschluss).toBe('Räumung fortsetzen');
    expect(body.abgehalten_at).toBe('2026-09-13 09:40:00');
  });

  it('leerer Zeitpunkt → Zeitpunkt des Absendens, ausdrücklich mitgeschickt', () => {
    const absenden = dayjs('2026-09-13T10:07:00Z');
    const body = abschlussBody({ entschluss: 'x', naechste: null, abgehalten: null }, ohneTermin, absenden);
    expect(body.abgehalten_at).toBe('2026-09-13 10:07:00');
  });
});

describe('eigeneLagebesprechung', () => {
  const gesendet: LagebesprechungAbschlussBody = {
    entschluss: 'Lage unverändert',
    abgehalten_at: '2026-09-13 10:00:00',
    naechste_at: null,
  };
  const zeile = (over: Partial<Lagebesprechung> = {}): Lagebesprechung => ({
    id: 9,
    einsatz_id: 1,
    lfd_nr: 4,
    abgehalten_at: '2026-09-13 10:00:00',
    entschluss: 'Lage unverändert',
    etb_eintrag_id: 77,
    erfasst_von_id: 1,
    erfasst_at: '2026-09-13 10:00:01',
    ...over,
  });
  const stab = (letzte?: Lagebesprechung): Stab => ({
    anzahl_lagebesprechungen: 4,
    besetzung: [],
    ...(letzte ? { letzte_lagebesprechung: letzte } : {}),
  });

  it('ordnet die Zeile zu, wenn Entschluss und Zeitpunkt passen', () => {
    expect(eigeneLagebesprechung(stab(zeile()), gesendet)?.etb_eintrag_id).toBe(77);
  });

  it('verwirft eine fremde Zeile — anderer Entschluss', () => {
    expect(eigeneLagebesprechung(stab(zeile({ entschluss: 'Fremd' })), gesendet)).toBeUndefined();
  });

  it('verwirft eine fremde Zeile — gleicher Entschluss, anderer Zeitpunkt', () => {
    expect(
      eigeneLagebesprechung(stab(zeile({ abgehalten_at: '2026-09-13 10:00:30' })), gesendet),
    ).toBeUndefined();
  });

  it('ohne letzte Lagebesprechung gibt es nichts zuzuordnen', () => {
    expect(eigeneLagebesprechung(stab(), gesendet)).toBeUndefined();
  });
});

describe('kuerzeEntschluss', () => {
  it('lässt kurze Texte stehen und fasst Leerraum zusammen', () => {
    expect(kuerzeEntschluss('Lage\n  unverändert')).toBe('Lage unverändert');
  });

  it('kürzt lange Texte auf 80 Zeichen mit Auslassungszeichen', () => {
    const lang = 'a'.repeat(120);
    const kurz = kuerzeEntschluss(lang);
    expect(kurz).toHaveLength(80);
    expect(kurz.endsWith('…')).toBe(true);
  });
});
```

- [ ] **Step 3: Tests rot sehen**

Run: `mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/clickup-forgejo-exe-9430ca/frontend exec vitest run src/stab/lagebesprechungZustand.test.ts src/stab/lagebesprechungAbschluss.test.ts`
Expected: FAIL — beide Module fehlen.

- [ ] **Step 4: `lagebesprechungZustand.ts` implementieren**

`frontend/src/stab/lagebesprechungZustand.ts`:

```ts
import dayjs, { type Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc';
import type { StatusDarstellung } from '../theme/statusFarben';

dayjs.extend(utc);

/**
 * Wire-Zeit → Zeitpunkt. Der Wire-String ist UTC OHNE Zonenkennung ('YYYY-MM-DD HH:mm:ss');
 * `dayjs(s)` läse ihn als Ortszeit und verschöbe ihn still um den Zonenversatz. `null` bei
 * fehlendem oder unlesbarem Wert — ein `Invalid Date` ist von außen nicht von einem Termin
 * zu unterscheiden.
 */
export function terminZeitpunkt(wire: string | null | undefined): Dayjs | null {
  if (!wire) return null;
  const d = dayjs.utc(wire);
  return d.isValid() ? d.local() : null;
}

/** „23 min" · „2 h 05 min" — ganze Minuten. */
export function dauerText(minuten: number): string {
  if (minuten < 60) return `${minuten} min`;
  const stunden = Math.floor(minuten / 60);
  return `${stunden} h ${String(minuten % 60).padStart(2, '0')} min`;
}

/**
 * Stand der nächsten Lagebesprechung (LFH-543, Spec 10): „in 23 min" neutral, „seit 5 min
 * überfällig" `achtung`, „kein Termin" neutral. Das Wort ist der zweite Kanal (WCAG 1.4.1).
 *
 * Rein und mit `jetzt` als Argument: die Seite tickt alle 30 s, der Test braucht keine Uhr.
 * Gerechnet wird in absoluten Millisekunden, nie in Wanduhrzeit — an der Sommerzeitgrenze
 * lägen sonst eine Stunde daneben. `termin ≤ jetzt` gilt als überfällig; abgerundet.
 *
 * Eine FUNKTION, keine Karte: `statusVertrag.guard` verbietet `Record<…, StatusDarstellung>`
 * außerhalb `theme/statusFarben.ts`, und dort zählt der Abdeckungstest die Vertragskarten.
 */
export function lagebesprechungZustand(
  terminWire: string | null | undefined,
  jetzt: Dayjs,
): StatusDarstellung {
  if (!terminWire) return { rolle: 'neutral', label: 'kein Termin' };
  const termin = terminZeitpunkt(terminWire);
  if (!termin) return { rolle: 'neutral', label: 'Termin unlesbar' };
  const abstandMs = termin.valueOf() - jetzt.valueOf();
  const minuten = Math.floor(Math.abs(abstandMs) / 60_000);
  if (abstandMs > 0) return { rolle: 'neutral', label: `in ${dauerText(minuten)}` };
  return { rolle: 'achtung', label: `seit ${dauerText(minuten)} überfällig` };
}
```

- [ ] **Step 5: `lagebesprechungAbschluss.ts` implementieren**

`frontend/src/stab/lagebesprechungAbschluss.ts`:

```ts
import type { Dayjs } from 'dayjs';
import type { Lagebesprechung, LagebesprechungAbschlussBody, Stab } from '../api/types';
import { alsBackendZeit } from '../etb/filterZeit';
import { terminZeitpunkt } from './lagebesprechungZustand';

/** Werte der Maske „Lagebesprechung abschließen". */
export interface AbschlussFormWerte {
  entschluss: string;
  /** `null`/`undefined` = kein Termin. */
  naechste?: Dayjs | null;
  /** Zeitpunkt der Besprechung; leer = Zeitpunkt des Absendens. */
  abgehalten?: Dayjs | null;
}

/** Beim ÖFFNEN eingefroren — Vorbelegung der Felder und Vergleichsbasis für „unverändert". */
export interface AbschlussVorbelegung {
  naechste: Dayjs | null;
  abgehalten: Dayjs;
}

/**
 * Vorbelegung (Nutzerentscheidung LFH-543): der bestehende Termin, wenn er in der Zukunft liegt,
 * sonst leer; der Zeitpunkt ist jetzt. Ein vergangener Termin wird nicht vorbelegt — er ist
 * gerade die Besprechung, die abgeschlossen wird.
 */
export function abschlussVorbelegung(
  terminWire: string | null | undefined,
  jetzt: Dayjs,
): AbschlussVorbelegung {
  const termin = terminZeitpunkt(terminWire);
  return { naechste: termin && termin.isAfter(jetzt) ? termin : null, abgehalten: jetzt };
}

/**
 * Formwerte → POST-Body. `naechste_at` ist dreiwertig (`api/types.ts`, `LagebesprechungAbschlussBody`):
 *
 * - vorbelegter Termin UNVERÄNDERT → Schlüssel fehlt (der Server lässt ihn stehen);
 * - leeres Feld → `null` (löschen), auch ohne Vorbelegung — siehe Offener Punkt 1 im Plan;
 * - sonst der gewählte Wert. Nie `''`: der löschte serverseitig still.
 *
 * `abgehalten_at` geht IMMER mit, leer als Zeitpunkt des Absendens. Nur dann lässt sich die
 * Antwort der eigenen Anfrage zuordnen (`eigeneLagebesprechung`).
 */
export function abschlussBody(
  werte: AbschlussFormWerte,
  vorbelegung: AbschlussVorbelegung,
  jetzt: Dayjs,
): LagebesprechungAbschlussBody {
  const body: LagebesprechungAbschlussBody = {
    entschluss: werte.entschluss.trim(),
    abgehalten_at: alsBackendZeit(werte.abgehalten ?? jetzt),
  };
  if (werte.naechste == null) return { ...body, naechste_at: null };
  const gewaehlt = alsBackendZeit(werte.naechste);
  if (vorbelegung.naechste != null && gewaehlt === alsBackendZeit(vorbelegung.naechste)) {
    return body;
  }
  return { ...body, naechste_at: gewaehlt };
}

/**
 * Die eigene Zeile aus der POST-Antwort — oder `undefined`.
 *
 * Die Route lädt die Antwort NACH dem Commit in einer zweiten Lesetransaktion
 * (`src/routes/stab.rs:248-264`). Schließt zeitgleich jemand anderes ab, trägt
 * `letzte_lagebesprechung` dessen Zeile; ein Deeplink darauf zeigte einen fremden Beleg.
 */
export function eigeneLagebesprechung(
  antwort: Stab,
  gesendet: LagebesprechungAbschlussBody,
): Lagebesprechung | undefined {
  const letzte = antwort.letzte_lagebesprechung;
  if (!letzte) return undefined;
  const passt =
    letzte.entschluss.trim() === gesendet.entschluss &&
    letzte.abgehalten_at === gesendet.abgehalten_at;
  return passt ? letzte : undefined;
}

/** Einzeilig und auf `max` Zeichen gekürzt (Zeile „Letzte"). */
export function kuerzeEntschluss(text: string, max = 80): string {
  const eineZeile = text.replace(/\s+/g, ' ').trim();
  return eineZeile.length > max ? `${eineZeile.slice(0, max - 1)}…` : eineZeile;
}
```

- [ ] **Step 6: Tests grün, Typen sauber**

Run: `mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/clickup-forgejo-exe-9430ca/frontend exec vitest run src/stab/lagebesprechungZustand.test.ts src/stab/lagebesprechungAbschluss.test.ts`
Expected: PASS.
Run: `mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/clickup-forgejo-exe-9430ca/frontend typecheck`
Expected: keine Fehler.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/api/types.ts frontend/src/stab/lagebesprechungZustand.ts frontend/src/stab/lagebesprechungZustand.test.ts frontend/src/stab/lagebesprechungAbschluss.ts frontend/src/stab/lagebesprechungAbschluss.test.ts
git commit -m "feat(stab): Countdown und Abschluss-Logik der Lagebesprechung (LFH-543)" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: API-Client und Query-Sub-Key

**Files:**
- Modify: `frontend/src/api/stab.ts`
- Test: `frontend/src/api/stab.test.ts` (Create)
- Modify: `frontend/src/api/queryKeys.ts:249-250` (nach `stab:`)
- Test: `frontend/src/api/queryKeys.test.ts` (nach dem `schaedenGeschaedigt`-Pin, `:163-168`)

**Interfaces:**
- Consumes: `Lagebesprechung`, `LagebesprechungAbschlussBody`, `Stab` aus `api/types` (Task 2); `apiGet`, `apiSend` aus `api/client` (`:79`, `:110`).
- Produces:
  - `ladeLagebesprechungen(einsatzId: number): Promise<Lagebesprechung[]>`
  - `schliesseLagebesprechungAb(einsatzId: number, daten: LagebesprechungAbschlussBody): Promise<Stab>`
  - `einsatzKeys.stabLagebesprechungen(einsatzId: number): readonly ['einsatz-stab', number, 'lagebesprechungen']`

- [ ] **Step 1: Failing tests schreiben**

In `frontend/src/api/queryKeys.test.ts` direkt nach dem Block `expect(einsatzKeys.schaedenGeschaedigt(1, 2)).toEqual([ … ]);` einfügen:

```ts
    // LFH-543: Sub-Key UNTER dem Stab-Prefix — das `stab`-Ereignis invalidiert ihn mit.
    // Als Literal gepinnt: ein geänderter Key bricht nichts, er trifft still ein anderes Fach.
    expect(einsatzKeys.stabLagebesprechungen(1)).toEqual(['einsatz-stab', 1, 'lagebesprechungen']);
```

Neue Datei `frontend/src/api/stab.test.ts`:

```ts
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { ladeLagebesprechungen, schliesseLagebesprechungAb } from './stab';

const antwort = { anzahl_lagebesprechungen: 1, besetzung: [] };

/**
 * Der Tri-State von `naechste_at` muss den DRAHT erreichen: `JSON.stringify` lässt einen
 * fehlenden Schlüssel weg und schreibt `null` aus. Geprüft wird, was der Server bekommt.
 */
describe('schliesseLagebesprechungAb', () => {
  function faengeBody() {
    const bodies: Record<string, unknown>[] = [];
    server.use(
      http.post('/api/einsaetze/1/stab/lagebesprechungen', async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(antwort, { status: 201 });
      }),
    );
    return bodies;
  }

  it('ohne Schlüssel kommt kein naechste_at an', async () => {
    const bodies = faengeBody();
    await schliesseLagebesprechungAb(1, { entschluss: 'x', abgehalten_at: '2026-09-13 10:00:00' });
    expect(Object.keys(bodies[0])).not.toContain('naechste_at');
  });

  it('null kommt als null an (Gegenfall)', async () => {
    const bodies = faengeBody();
    await schliesseLagebesprechungAb(1, { entschluss: 'x', naechste_at: null });
    expect(bodies[0]).toHaveProperty('naechste_at', null);
  });

  it('liefert die StabAnzeige der 201-Antwort', async () => {
    faengeBody();
    await expect(schliesseLagebesprechungAb(1, { entschluss: 'x' })).resolves.toEqual(antwort);
  });
});

describe('ladeLagebesprechungen', () => {
  it('liest die Historie', async () => {
    server.use(
      http.get('/api/einsaetze/1/stab/lagebesprechungen', () => HttpResponse.json([{ id: 3 }])),
    );
    await expect(ladeLagebesprechungen(1)).resolves.toEqual([{ id: 3 }]);
  });
});
```

- [ ] **Step 2: Tests rot sehen**

Run: `mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/clickup-forgejo-exe-9430ca/frontend exec vitest run src/api/stab.test.ts src/api/queryKeys.test.ts`
Expected: FAIL — `schliesseLagebesprechungAb`/`ladeLagebesprechungen` sind keine Exporte, `einsatzKeys.stabLagebesprechungen` ist keine Funktion.

- [ ] **Step 3: Implementieren**

`frontend/src/api/stab.ts` — Import-Zeile ersetzen durch

```ts
import type { BesetzungBody, Lagebesprechung, LagebesprechungAbschlussBody, Sachgebiet, Stab } from './types';
```

und am Dateiende anfügen:

```ts
/** Historie absteigend nach `lfd_nr`, ohne Cursor (Spec 9). */
export function ladeLagebesprechungen(einsatzId: number): Promise<Lagebesprechung[]> {
  return apiGet<Lagebesprechung[]>(`/api/einsaetze/${einsatzId}/stab/lagebesprechungen`);
}

/**
 * 201 mit `StabAnzeige`, nach dem Commit frisch geladen. Die ETB-id steht NUR in
 * `letzte_lagebesprechung.etb_eintrag_id` und kann bei gleichzeitigem Abschluss eine fremde
 * Zeile sein — Zuordnung über `stab/lagebesprechungAbschluss.ts:eigeneLagebesprechung`.
 */
export function schliesseLagebesprechungAb(
  einsatzId: number,
  daten: LagebesprechungAbschlussBody,
): Promise<Stab> {
  return apiSend<Stab>(`/api/einsaetze/${einsatzId}/stab/lagebesprechungen`, 'POST', daten);
}
```

`frontend/src/api/queryKeys.ts` — direkt nach

```ts
  stab: (einsatzId: number) => [EINSATZ_KEYS.stab, einsatzId] as const,
```

einfügen:

```ts
  /** Historie der Lagebesprechungen als Sub-Key unter DEMSELBEN Prefix (Spec 9.3). */
  stabLagebesprechungen: (einsatzId: number) =>
    [EINSATZ_KEYS.stab, einsatzId, 'lagebesprechungen'] as const,
```

- [ ] **Step 4: Tests grün**

Run: `mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/clickup-forgejo-exe-9430ca/frontend exec vitest run src/api/stab.test.ts src/api/queryKeys.test.ts src/api/queryKeys.guard.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/stab.ts frontend/src/api/stab.test.ts frontend/src/api/queryKeys.ts frontend/src/api/queryKeys.test.ts
git commit -m "feat(stab): Lagebesprechungs-API und Query-Sub-Key (LFH-543)" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Maske „Lagebesprechung abschließen" und Erfolgs-Toast

**Files:**
- Create: `frontend/src/stab/abschlussToast.tsx`
- Create: `frontend/src/stab/LagebesprechungModal.tsx`
- Test: `frontend/src/stab/LagebesprechungModal.test.tsx`

**Interfaces:**
- Consumes: `schnellwahlAuswahl`, `schnellwahlTermin` (Task 1); `abschlussVorbelegung`, `abschlussBody`, `eigeneLagebesprechung`, `AbschlussFormWerte` (Task 2); `schliesseLagebesprechungAb`, `einsatzKeys.stab`, `einsatzKeys.einsatz` (Task 3/Bestand); `ErfassungsModal` (`components/Erfassung.tsx:447`, Props `offen, titel, form, onErfassen, onFertig, onAbbrechen, laeuft, erfassenText, initialValues, children`); `SpeicherFehler({ fehler, titel? })` (`components/SpeicherHinweis.tsx:39`); `etbPfad` (`routing/deeplinks.ts:218`).
- Produces:
  - `zeigeAbschlussToast(api: MessageInstance, opts: { einsatzId: number; eigene: Lagebesprechung | undefined; navigate: (pfad: string) => void }): void` aus `stab/abschlussToast`
  - `default LagebesprechungModal(props: { einsatzId: number; stab: Stab; onAbgeschlossen: (eigene: Lagebesprechung | undefined) => void; onSchliessen: () => void })` aus `stab/LagebesprechungModal`

Die Maske wird **nur montiert, solange sie offen ist** (Task 6); deshalb `offen` fest und keine `reset()`-Logik. Der Toast ruft ein `navigate`, das der **Aufrufer** mitgibt: `<AntApp>` liegt außerhalb des Routers (`main.tsx`, ebenso `test/utils.tsx`), ein `<Link>` im Toast hätte keinen Router-Kontext.

- [ ] **Step 1: Failing test schreiben**

`frontend/src/stab/LagebesprechungModal.test.tsx`:

```tsx
import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import { Route, Routes, useLocation, useNavigate } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Lagebesprechung, Stab } from '../api/types';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import LagebesprechungModal from './LagebesprechungModal';
import { zeigeAbschlussToast } from './abschlussToast';

/**
 * Nur `Date` steht still (`toFake`): `userEvent`, MSW und antds Animationen laufen auf echten
 * Timern weiter. Mit voll gefälschten Timern hinge `findBy*` (CLAUDE.md, Deeplink-Abschnitt).
 * Rückfallweg, falls `toFake` in dieser Vitest-Version nicht greift: das Muster aus
 * `etb/WiedervorlageModal.test.tsx` (`shouldAdvanceTime` + `userEvent.setup({ advanceTimers })`)
 * — dann vergleichen die Zeit-Pins auf Minuten statt Sekunden.
 */
const JETZT = new Date('2026-09-13T10:00:00Z');
const wireAb = (minuten: number) =>
  dayjs(JETZT).add(minuten, 'minute').utc().format('YYYY-MM-DD HH:mm:ss');
const ZEITFORMAT = 'YYYY-MM-DD HH:mm';
const GRUND = 'Die nächste Lagebesprechung muss nach dem Zeitpunkt liegen';

const stab = (over: Partial<Stab> = {}): Stab => ({
  anzahl_lagebesprechungen: 3,
  besetzung: [],
  ...over,
});
const antwort = (letzte: Partial<Lagebesprechung> = {}) => ({
  anzahl_lagebesprechungen: 4,
  besetzung: [],
  letzte_lagebesprechung: {
    id: 9,
    einsatz_id: 1,
    lfd_nr: 4,
    abgehalten_at: wireAb(0),
    entschluss: 'Lage unverändert',
    etb_eintrag_id: 77,
    erfasst_von_id: 1,
    erfasst_at: wireAb(0),
    ...letzte,
  },
});

let gesendet: Record<string, unknown>[];
let postAntwort: () => Response;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(JETZT);
  gesendet = [];
  postAntwort = () => HttpResponse.json(antwort(), { status: 201 });
  server.use(
    http.post('/api/einsaetze/1/stab/lagebesprechungen', async ({ request }) => {
      gesendet.push((await request.json()) as Record<string, unknown>);
      return postAntwort();
    }),
  );
});
afterEach(() => vi.useRealTimers());

function Ort() {
  const ort = useLocation();
  return <output aria-label="Ort">{ort.pathname + ort.search}</output>;
}

/** Wie die Seite: montiert = offen, Toast mit dem `navigate` des Aufrufers. */
function Harness({ daten }: { daten: Stab }) {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [offen, setOffen] = useState(true);
  return (
    <>
      {offen && (
        <LagebesprechungModal
          einsatzId={1}
          stab={daten}
          onAbgeschlossen={(eigene) => zeigeAbschlussToast(message, { einsatzId: 1, eigene, navigate })}
          onSchliessen={() => setOffen(false)}
        />
      )}
      <Ort />
    </>
  );
}

function zeige(daten: Stab = stab()) {
  renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/stab" element={<Harness daten={daten} />} />
      <Route path="/einsaetze/:id/etb" element={<Ort />} />
    </Routes>,
    { route: '/einsaetze/1/stab' },
  );
  return screen.findByRole('dialog', { name: 'Lagebesprechung abschließen' });
}

/** Eingabe eines Feldes über seine Beschriftung — unabhängig vom `for`-Weg des DatePickers. */
function feld(dialog: HTMLElement, label: string): HTMLInputElement {
  const item = [...dialog.querySelectorAll('.ant-form-item')].find(
    (i) => i.querySelector('.ant-form-item-label')?.textContent === label,
  );
  const eingabe = item?.querySelector<HTMLInputElement>('input, textarea');
  if (!eingabe) throw new Error(`Feld „${label}" nicht gefunden`);
  return eingabe;
}

/**
 * Zählt die BEDIENBAREN Felder — wörtlich aus `pages/MaterialPage.test.tsx`. Die Rollen-Abfrage
 * blendet aus, was im Barrierefreiheitsbaum nicht steht, und genau das ist der eingeklappte
 * Bereich: `forceRender` lässt sein Feld im Baum, `CSSMotion` legt `display: none` DIREKT ans
 * Element. Deshalb hält die Zählung in jsdom.
 */
function sichtbareFelder(dialog: HTMLElement): number {
  const rollen = ['textbox', 'spinbutton', 'combobox', 'checkbox', 'radio', 'switch'] as const;
  const felder = new Set<Element>();
  for (const rolle of rollen) {
    for (const el of within(dialog).queryAllByRole(rolle)) {
      const item = el.closest('.ant-form-item');
      if (item) felder.add(item);
    }
  }
  return felder.size;
}

/** Siehe `pages/LageberichtDetailPage.test.tsx` — gezählt wird die Message-Queue selbst. */
function toastsMit(wortlaut: string) {
  return [...document.querySelectorAll<HTMLElement>('.ant-message')].filter((n) =>
    n.textContent?.includes(wortlaut),
  );
}

async function absenden(dialog: HTMLElement, entschluss = 'Lage unverändert') {
  const u = userEvent.setup();
  await u.type(feld(dialog, 'Entschluss'), entschluss);
  await u.click(within(dialog).getByRole('button', { name: 'Abschließen' }));
  await waitFor(() => expect(gesendet).toHaveLength(1));
  return u;
}

describe('LagebesprechungModal · Erfassungs-Norm', () => {
  /** Das erste Feld ist eine TextArea — dort bleibt Enter ein Zeilenumbruch. Geprüft wird die
   *  Struktur, aus der „Enter sendet" folgt (Muster `components/Erfassung.test.tsx`). */
  it('keine Modal-Fusszeile, Absende-Knopf im <form>, Fokus im Entschluss', async () => {
    const dialog = await zeige();
    expect(dialog.querySelector('.ant-modal-footer')).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Abschließen' }).closest('form')).not.toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(feld(dialog, 'Entschluss')));
  });
});

describe('LagebesprechungModal · Feldbudget', () => {
  it('zeigt zwei Felder; der Zeitpunkt liegt eingeklappt IM Baum', async () => {
    const dialog = await zeige();
    // Vorbedingung: die DatePicker-Eingabe wird von der Rollenliste erfasst — sonst wäre die
    // Zahl unten aus dem falschen Grund richtig.
    expect(within(dialog).getAllByRole('textbox')).toContain(feld(dialog, 'Nächste Lagebesprechung'));
    // GENAU zwei, nicht „höchstens drei": eine Obergrenze deckte eine Zählung, die ein Feld verliert.
    expect(sichtbareFelder(dialog)).toBe(2);
    // Im Baum (forceRender → der Zeitpunkt geht zugeklappt mit), aber nicht sichtbar.
    expect(feld(dialog, 'Zeitpunkt der Besprechung')).not.toBeVisible();
  });

  it('Aufklappen erhöht die Zahl der sichtbaren Felder', async () => {
    const dialog = await zeige();
    const vorher = sichtbareFelder(dialog);
    await userEvent.click(within(dialog).getByRole('button', { name: /Weitere Angaben/ }));
    await waitFor(() => expect(sichtbareFelder(dialog)).toBe(vorher + 1));
  });
});

describe('LagebesprechungModal · Vorbelegung und Tri-State', () => {
  it('belegt einen zukünftigen Termin vor — einen vergangenen nicht', async () => {
    const dialog = await zeige(stab({ naechste_lagebesprechung_at: wireAb(45) }));
    expect(feld(dialog, 'Nächste Lagebesprechung').value).toBe(
      dayjs(JETZT).add(45, 'minute').format(ZEITFORMAT),
    );
  });

  it('lässt das Feld bei vergangenem Termin leer (Gegenfall)', async () => {
    const dialog = await zeige(stab({ naechste_lagebesprechung_at: wireAb(-5) }));
    expect(feld(dialog, 'Nächste Lagebesprechung').value).toBe('');
  });

  it('unverändert abgeschickt → der Schlüssel naechste_at FEHLT', async () => {
    const dialog = await zeige(stab({ naechste_lagebesprechung_at: wireAb(45) }));
    await absenden(dialog);
    expect(gesendet[0]).toEqual({ entschluss: 'Lage unverändert', abgehalten_at: wireAb(0) });
  });

  it('„kein Termin" → naechste_at ist null', async () => {
    const dialog = await zeige(stab({ naechste_lagebesprechung_at: wireAb(45) }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'kein Termin' }));
    await absenden(dialog);
    expect(gesendet[0]).toHaveProperty('naechste_at', null);
  });

  it('ohne Vorbelegung leer gelassen → null, nicht weggelassen', async () => {
    const dialog = await zeige(stab({ naechste_lagebesprechung_at: wireAb(-5) }));
    await absenden(dialog);
    expect(gesendet[0]).toHaveProperty('naechste_at', null);
  });

  it('bietet genau +30 min / +1 h / +2 h an', async () => {
    const dialog = await zeige();
    for (const label of ['+30 min', '+1 h', '+2 h']) {
      expect(within(dialog).getByRole('button', { name: label })).toBeInTheDocument();
    }
    expect(within(dialog).queryByRole('button', { name: '+15 min' })).toBeNull();
  });

  it('die Schnellwahl rechnet vom Zeitpunkt der Besprechung, nicht von der Wanduhr', async () => {
    const dialog = await zeige();
    // Die Wanduhr läuft zehn Minuten weiter, der eingefrorene Zeitpunkt nicht. Ab der Wanduhr
    // gerechnet käme wireAb(70) an.
    vi.setSystemTime(new Date(JETZT.getTime() + 10 * 60_000));
    await userEvent.click(within(dialog).getByRole('button', { name: '+1 h' }));
    await absenden(dialog);
    expect(gesendet[0]).toMatchObject({ abgehalten_at: wireAb(0), naechste_at: wireAb(60) });
  });
});

describe('LagebesprechungModal · Fehler im Modal, Erfolg im Toast', () => {
  it('zeigt den Grund eines abgelehnten POST IM Dialog und nicht im Toast', async () => {
    postAntwort = () => HttpResponse.json({ error: GRUND }, { status: 422 });
    const dialog = await zeige();
    await absenden(dialog);

    const treffer = await within(dialog).findByText(GRUND);
    expect(treffer.closest('.ant-message')).toBeNull();
    expect(toastsMit(GRUND)).toHaveLength(0);
    expect(within(dialog).getByText('Abschluss fehlgeschlagen')).toBeInTheDocument();
    // Offen und mit stehendem Wortlaut — die Hülle leert nur bei Erfolg.
    expect(dialog).not.toHaveClass('ant-zoom-leave');
    expect(feld(dialog, 'Entschluss')).toHaveValue('Lage unverändert');
  });

  /**
   * Gegenaussage zur Zählung oben (die Queue IST zählbar) und Messauftrag aus
   * Controller-Entscheidung 3: der Klick im Toast wechselt die Route wirklich.
   * Rückfallweg, falls die Route hier NICHT wechselt: der Toast bleibt Text ohne Knopf, und der
   * Beleg-Link der Zeile „Letzte" (Task 5) trägt den Deeplink allein — kein `window.location`.
   */
  it('quittiert per Toast und führt über ihn zum eigenen ETB-Eintrag', async () => {
    const dialog = await zeige();
    const u = await absenden(dialog);

    await waitFor(() => expect(toastsMit('Lagebesprechung Nr. 4 abgeschlossen')).toHaveLength(1));
    const [toast] = toastsMit('Lagebesprechung Nr. 4 abgeschlossen');
    await u.click(within(toast).getByRole('button', { name: 'Zum ETB-Eintrag' }));
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'Ort' })).toHaveTextContent('/einsaetze/1/etb?eintrag=77'),
    );
  });

  it('verlinkt bei einer fremden Zeile in der Antwort nur auf das ETB', async () => {
    postAntwort = () =>
      HttpResponse.json(antwort({ lfd_nr: 5, entschluss: 'Fremder Entschluss', etb_eintrag_id: 88 }), {
        status: 201,
      });
    const dialog = await zeige();
    const u = await absenden(dialog);

    await waitFor(() => expect(toastsMit('Lagebesprechung abgeschlossen')).toHaveLength(1));
    expect(toastsMit('Nr. 5')).toHaveLength(0);
    const [toast] = toastsMit('Lagebesprechung abgeschlossen');
    await u.click(within(toast).getByRole('button', { name: 'Zum ETB' }));
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'Ort' })).toHaveTextContent(/^\/einsaetze\/1\/etb$/),
    );
  });
});
```

- [ ] **Step 2: Test rot sehen**

Run: `mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/clickup-forgejo-exe-9430ca/frontend exec vitest run src/stab/LagebesprechungModal.test.tsx`
Expected: FAIL — `./LagebesprechungModal` und `./abschlussToast` fehlen.

- [ ] **Step 3: Toast implementieren**

`frontend/src/stab/abschlussToast.tsx`:

```tsx
import { Button, Space } from 'antd';
import type { MessageInstance } from 'antd/es/message/interface';
import type { Lagebesprechung } from '../api/types';
import { etbPfad } from '../routing/deeplinks';

/** Fester Schlüssel: ein zweiter Abschluss ersetzt den stehenden Toast (Bauform `rueckgaengig.tsx`). */
const SCHLUESSEL = 'lfh-lagebesprechung-abgeschlossen';
/** Wie der Rückgängig-Toast: hier steht eine Entscheidung an (hinspringen oder nicht). */
const DAUER_S = 6;

/**
 * Erfolgs-Quittung des Abschlusses mit Deeplink auf den ETB-Beleg (Spec 10).
 *
 * Der Link zeigt nur dann auf `?eintrag=`, wenn die Antwort der eigenen Anfrage zugeordnet
 * werden konnte (`eigeneLagebesprechung`); sonst auf das ETB — ein fremder Beleg wäre schlimmer
 * als keiner. `navigate` kommt vom Aufrufer: `<AntApp>` liegt außerhalb des Routers
 * (`main.tsx`), ein `<Link>` im Toast hätte keinen Router-Kontext.
 *
 * Der Fehlerfall hat hier nichts verloren — er steht IM Modal (LFH-535).
 */
export function zeigeAbschlussToast(
  api: MessageInstance,
  {
    einsatzId,
    eigene,
    navigate,
  }: { einsatzId: number; eigene: Lagebesprechung | undefined; navigate: (pfad: string) => void },
) {
  const ziel = eigene ? etbPfad(einsatzId, { eintrag: eigene.etb_eintrag_id }) : etbPfad(einsatzId);
  api.open({
    key: SCHLUESSEL,
    type: 'success',
    duration: DAUER_S,
    content: (
      <Space>
        <span>
          {eigene ? `Lagebesprechung Nr. ${eigene.lfd_nr} abgeschlossen` : 'Lagebesprechung abgeschlossen'}
        </span>
        <Button
          type="link"
          onClick={() => {
            api.destroy(SCHLUESSEL);
            navigate(ziel);
          }}
        >
          {eigene ? 'Zum ETB-Eintrag' : 'Zum ETB'}
        </Button>
      </Space>
    ),
  });
}
```

- [ ] **Step 4: Maske implementieren**

`frontend/src/stab/LagebesprechungModal.tsx`:

```tsx
import { Button, Collapse, DatePicker, Form, Input, Space } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useState } from 'react';
import { einsatzKeys } from '../api/queryKeys';
import { schliesseLagebesprechungAb } from '../api/stab';
import type { Lagebesprechung, LagebesprechungAbschlussBody, Stab } from '../api/types';
import { ErfassungsModal } from '../components/Erfassung';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import { schnellwahlAuswahl, schnellwahlTermin } from '../components/terminSchnellwahl';
import {
  abschlussBody,
  abschlussVorbelegung,
  eigeneLagebesprechung,
  type AbschlussFormWerte,
} from './lagebesprechungAbschluss';

/** Teilmenge der geteilten Schnellwahl (Spec 10: +30/+60/+120; die Zahlen sind `[abgeleitet]`). */
const SCHNELLWAHL = schnellwahlAuswahl([30, 60, 120]);
const ZEITFORMAT = 'YYYY-MM-DD HH:mm';

interface LagebesprechungModalProps {
  einsatzId: number;
  /** Stand beim Öffnen — die Seite montiert die Maske erst, wenn er da ist. */
  stab: Stab;
  /** Nach erfolgreichem POST, vor dem Schließen. `undefined` = Antwort trug eine fremde Zeile. */
  onAbgeschlossen: (eigene: Lagebesprechung | undefined) => void;
  onSchliessen: () => void;
}

/**
 * „Lagebesprechung abschließen" (LFH-543, Spec 10) auf `ErfassungsModal`.
 *
 * Zwei sichtbare Felder — Entschluss (Pflicht) und nächster Termin mit Schnellwahl —, der
 * Zeitpunkt der Besprechung unter „Weitere Angaben". `forceRender` am Collapse ist TRAGEND:
 * nur so kommt der Zeitpunkt auch zugeklappt in `onFinish` an, und nur mit ihm lässt sich die
 * POST-Antwort der eigenen Anfrage zuordnen (`eigeneLagebesprechung`).
 *
 * Montiert = offen (die Seite rendert `{offen && …}`). Deshalb friert `useState` Vorbelegung und
 * Vergleichsbasis beim ÖFFNEN ein, obwohl `stab` live invalidiert wird (LFH-303), und jede
 * Öffnung hat eine frische Mutation ohne alten Fehler — ein `reset()` wie im `FreigabeDialog`
 * (der montiert bleibt) ist hier nicht nötig.
 *
 * Fehler des POST stehen IM Modal (LFH-535): die Mutation hat kein `onError`, `mutateAsync`
 * lehnt ab, die Hülle lässt die Felder stehen. Erfolg quittiert der Aufrufer per Toast.
 */
export default function LagebesprechungModal({
  einsatzId,
  stab,
  onAbgeschlossen,
  onSchliessen,
}: LagebesprechungModalProps) {
  const qc = useQueryClient();
  const [vorbelegung] = useState(() =>
    abschlussVorbelegung(stab.naechste_lagebesprechung_at, dayjs()),
  );
  const [form] = Form.useForm<AbschlussFormWerte>();

  const mutation = useMutation({
    mutationFn: (body: LagebesprechungAbschlussBody) => schliesseLagebesprechungAb(einsatzId, body),
    onSuccess: (antwort, body) => {
      // Der Prefix trifft auch die Historie (Sub-Key). `einsatz` ist Hygiene: die
      // Einsatzdaten-Seite zeigt denselben Termin und steht im NICHT_LIVE-Fach (Spec Entsch. 11).
      void qc.invalidateQueries({ queryKey: einsatzKeys.stab(einsatzId) });
      void qc.invalidateQueries({ queryKey: einsatzKeys.einsatz(einsatzId) });
      onAbgeschlossen(eigeneLagebesprechung(antwort, body));
    },
  });

  return (
    <ErfassungsModal<AbschlussFormWerte>
      offen
      titel="Lagebesprechung abschließen"
      form={form}
      initialValues={{ naechste: vorbelegung.naechste, abgehalten: vorbelegung.abgehalten }}
      erfassenText="Abschließen"
      laeuft={mutation.isPending}
      onErfassen={async (werte) => {
        await mutation.mutateAsync(abschlussBody(werte, vorbelegung, dayjs()));
      }}
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      <Form.Item
        label="Entschluss"
        name="entschluss"
        rules={[{ required: true, whitespace: true, message: 'Entschluss angeben' }]}
      >
        <Input.TextArea rows={3} placeholder="z. B. Lage unverändert, Maßnahmen fortführen" />
      </Form.Item>
      <Form.Item
        label="Nächste Lagebesprechung"
        name="naechste"
        // Die Schnellwahl ist eine Vorbelegung DESSELBEN Wertes, kein eigenes Feld — sie steht
        // im selben `Form.Item`, das Budget bleibt bei zwei. Echte `Button` ohne `size`: sie
        // erben `controlHeight` aus der Dichte-Staffel.
        extra={
          <Space wrap>
            {SCHNELLWAHL.map((s) => (
              <Button
                key={s.label}
                onClick={() =>
                  form.setFieldValue(
                    'naechste',
                    // Ab dem ZEITPUNKT der Besprechung, nicht ab jetzt (Controller-Entscheidung 1).
                    schnellwahlTermin(form.getFieldValue('abgehalten') ?? dayjs(), s.minuten),
                  )
                }
              >
                {s.label}
              </Button>
            ))}
            <Button onClick={() => form.setFieldValue('naechste', null)}>kein Termin</Button>
          </Space>
        }
      >
        <DatePicker showTime format={ZEITFORMAT} placeholder="kein Termin" style={{ width: '100%' }} />
      </Form.Item>
      <Collapse
        ghost
        items={[
          {
            key: 'weitere',
            label: 'Weitere Angaben',
            forceRender: true,
            children: (
              <Form.Item
                label="Zeitpunkt der Besprechung"
                name="abgehalten"
                extra="Leer: Zeitpunkt des Abschließens"
                style={{ marginBottom: 0 }}
              >
                <DatePicker showTime format={ZEITFORMAT} style={{ width: '100%' }} />
              </Form.Item>
            ),
          },
        ]}
      />
      <SpeicherFehler fehler={mutation.error} titel="Abschluss fehlgeschlagen" />
    </ErfassungsModal>
  );
}
```

- [ ] **Step 5: Tests grün**

Run: `mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/clickup-forgejo-exe-9430ca/frontend exec vitest run src/stab/LagebesprechungModal.test.tsx`
Expected: PASS.

Wenn „zeigt zwei Felder" an der **Vorbedingung** scheitert (DatePicker-Eingabe trägt keine `textbox`-Rolle): Rollenliste um die tatsächliche Rolle ergänzen, **nicht** die Zahl anpassen. Wenn der Toast-Test an der Route scheitert: Rückfallweg aus dem Test-Kommentar umsetzen und im Commit nennen.

- [ ] **Step 6: Mutationsprobe `forceRender`**

`forceRender: true` in `LagebesprechungModal.tsx` vorübergehend entfernen, Test laufen lassen.
Run: `mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/clickup-forgejo-exe-9430ca/frontend exec vitest run src/stab/LagebesprechungModal.test.tsx`
Expected: FAIL mindestens in „zeigt zwei Felder; der Zeitpunkt liegt eingeklappt IM Baum" (`feld(…, 'Zeitpunkt der Besprechung')` findet nichts). Prop wieder einsetzen, Test erneut grün.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/stab/abschlussToast.tsx frontend/src/stab/LagebesprechungModal.tsx frontend/src/stab/LagebesprechungModal.test.tsx
git commit -m "feat(stab): Maske Lagebesprechung abschließen mit Toast-Deeplink (LFH-543)" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Stand (Countdown) und Historie

**Files:**
- Create: `frontend/src/stab/LagebesprechungStand.tsx`, `frontend/src/stab/LagebesprechungStand.test.tsx`
- Create: `frontend/src/stab/LagebesprechungHistorie.tsx`, `frontend/src/stab/LagebesprechungHistorie.test.tsx`

**Interfaces:**
- Consumes: `lagebesprechungZustand` (Task 2), `kuerzeEntschluss` (Task 2), `ladeLagebesprechungen`, `einsatzKeys.stabLagebesprechungen` (Task 3); `StatusTag({ darstellung })` (`components/StatusTag.tsx`, setzt `data-rolle`); `ZeitAnzeige({ wert, format? })` (`anzeige/ZeitAnzeige.tsx:32`, ohne Provider mit Default-Konventionen); `Liste`, `ListenEintrag`, `ListenEintragMeta` (`components/Liste.tsx:55,165,249`; `emptyText` wird während `loading` unterdrückt); `SeitenFehler({ text, ursache, onWiederholen })`, `SeitenStandVeraltet({ onWiederholen })` (`components/SeitenZustand.tsx`); `stabZeilenzielStil(token)` (`stab/zeilenziel.ts`).
- Produces:
  - `default LagebesprechungStand(props: { einsatzId: number; stab: Stab })`
  - `default LagebesprechungHistorie(props: { einsatzId: number })`

- [ ] **Step 1: Failing tests schreiben**

`frontend/src/stab/LagebesprechungStand.test.tsx`:

```tsx
import { act, screen, within } from '@testing-library/react';
import dayjs from 'dayjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Lagebesprechung, Stab } from '../api/types';
import { renderMitProviders } from '../test/utils';
import LagebesprechungStand from './LagebesprechungStand';

/**
 * Hier werden die TIMER gefälscht, weil die 30-s-Uhr das Prüfobjekt ist. `shouldAdvanceTime`
 * wie in `etb/WiedervorlageModal.test.tsx`: die echte Zeit läuft mit. Die Termine liegen
 * deshalb eine halbe Minute neben der Minutengrenze, damit ein paar echte Millisekunden die
 * abgerundete Zahl nicht kippen. Kein `findBy*` — alles rendert synchron.
 */
const JETZT = new Date('2026-09-13T10:00:00Z');
const wireAb = (sekunden: number) =>
  dayjs(JETZT).add(sekunden, 'second').utc().format('YYYY-MM-DD HH:mm:ss');

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(JETZT);
});
afterEach(() => vi.useRealTimers());

const letzte = (over: Partial<Lagebesprechung> = {}): Lagebesprechung => ({
  id: 9,
  einsatz_id: 1,
  lfd_nr: 3,
  abgehalten_at: '2026-09-13 09:00:00',
  entschluss: 'Lage unverändert',
  etb_eintrag_id: 77,
  erfasst_von_id: 1,
  erfasst_at: '2026-09-13 09:00:01',
  ...over,
});
const stab = (over: Partial<Stab> = {}): Stab => ({ anzahl_lagebesprechungen: 3, besetzung: [], ...over });

function zeige(daten: Stab) {
  return renderMitProviders(<LagebesprechungStand einsatzId={1} stab={daten} />);
}
/**
 * Zeile einer bordered `Descriptions` (horizontal): Label und Inhalt stehen in EINEM `<tr>`
 * (gelesen an antd 6.5.2, `es/descriptions/Row.js:132`). Liefert `closest('tr')` nach einem
 * antd-Sprung `null`, wirft `within` laut — dann über `.ant-descriptions-row` greifen.
 */
const zeile = (label: string) => screen.getByText(label).closest('tr')!;

describe('LagebesprechungStand · Nächste', () => {
  it('zukünftig: „in 23 min", neutral', () => {
    zeige(stab({ naechste_lagebesprechung_at: wireAb(23 * 60 + 30) }));
    // `closest`: ob antds `Tag` den Wortlaut in eine innere Hülle legt, ist nicht Teil der Aussage.
    expect(within(zeile('Nächste')).getByText('in 23 min').closest('[data-rolle]')).toHaveAttribute(
      'data-rolle',
      'neutral',
    );
  });

  it('vergangen: „seit 5 min überfällig", achtung', () => {
    zeige(stab({ naechste_lagebesprechung_at: wireAb(-(5 * 60 + 30)) }));
    expect(
      within(zeile('Nächste')).getByText('seit 5 min überfällig').closest('[data-rolle]'),
    ).toHaveAttribute('data-rolle', 'achtung');
  });

  it('ohne Termin: „kein Termin", neutral', () => {
    zeige(stab());
    expect(within(zeile('Nächste')).getByText('kein Termin').closest('[data-rolle]')).toHaveAttribute(
      'data-rolle',
      'neutral',
    );
  });

  it('aktualisiert im 30-s-Takt — nicht früher, ohne Remount und ohne Toast', async () => {
    zeige(stab({ naechste_lagebesprechung_at: wireAb(23 * 60 + 30) }));
    const tabelle = document.querySelector('.ant-descriptions');
    expect(screen.getByText('in 23 min')).toBeInTheDocument();

    // Gegenfall zum Takt: nach 29 s steht noch der alte Wert — ein kürzerer Takt zeigte „in 22 min".
    await act(() => vi.advanceTimersByTimeAsync(29_000));
    expect(screen.getByText('in 23 min')).toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(1_000));
    expect(screen.getByText('in 22 min')).toBeInTheDocument();
    // Kein Blinken: derselbe Knoten, nur der Wortlaut ändert sich.
    expect(document.querySelector('.ant-descriptions')).toBe(tabelle);
    // Kein Toast. Dass die Queue zählbar ist, belegt `LagebesprechungModal.test.tsx`.
    expect(document.querySelectorAll('.ant-message')).toHaveLength(0);
  });

  it('räumt die Uhr beim Aushängen weg', () => {
    const { unmount } = zeige(stab({ naechste_lagebesprechung_at: wireAb(23 * 60 + 30) }));
    const vorher = vi.getTimerCount();
    unmount();
    expect(vi.getTimerCount()).toBeLessThan(vorher);
  });
});

describe('LagebesprechungStand · Letzte und Anzahl', () => {
  it('nennt Nummer, gekürzten Entschluss und verlinkt den ETB-Beleg', () => {
    zeige(stab({ letzte_lagebesprechung: letzte({ entschluss: 'b'.repeat(120) }) }));
    const z = zeile('Letzte');
    expect(within(z).getByText('Nr. 3')).toBeInTheDocument();
    expect(within(z).getByText(`${'b'.repeat(79)}…`)).toBeInTheDocument();
    expect(
      within(z).getByRole('link', { name: 'ETB-Eintrag zu Lagebesprechung Nr. 3' }),
    ).toHaveAttribute('href', '/einsaetze/1/etb?eintrag=77');
  });

  it('ohne letzte Lagebesprechung: „noch keine", kein Link (Gegenfall oben)', () => {
    zeige(stab({ anzahl_lagebesprechungen: 0 }));
    expect(within(zeile('Letzte')).getByText('noch keine')).toBeInTheDocument();
    expect(within(zeile('Letzte')).queryByRole('link')).toBeNull();
  });

  it('zeigt die Anzahl', () => {
    zeige(stab({ anzahl_lagebesprechungen: 7 }));
    expect(within(zeile('Anzahl')).getByText('7')).toBeInTheDocument();
  });
});
```

`frontend/src/stab/LagebesprechungHistorie.test.tsx`:

```tsx
import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import LagebesprechungHistorie from './LagebesprechungHistorie';

const eintrag = (lfd_nr: number, over: object = {}) => ({
  id: lfd_nr,
  einsatz_id: 1,
  lfd_nr,
  abgehalten_at: `2026-09-13 0${lfd_nr}:00:00`,
  entschluss: `Entschluss ${lfd_nr}`,
  etb_eintrag_id: 70 + lfd_nr,
  erfasst_von_id: 1,
  erfasst_at: `2026-09-13 0${lfd_nr}:00:01`,
  ...over,
});
const LEER = 'Noch keine Lagebesprechung abgeschlossen';

function zeige(antwort: () => Response | Promise<Response>) {
  server.use(http.get('/api/einsaetze/1/stab/lagebesprechungen', antwort));
  renderMitProviders(<LagebesprechungHistorie einsatzId={1} />);
}

describe('LagebesprechungHistorie', () => {
  it('zeigt die Einträge in Serverreihenfolge mit Beleg-Link und Termin-Snapshot', async () => {
    zeige(() =>
      HttpResponse.json([eintrag(2, { naechste_at: '2026-09-13 04:00:00' }), eintrag(1)]),
    );
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2));
    const [zwei, eins] = screen.getAllByRole('listitem');
    expect(within(zwei).getByRole('heading', { level: 4 })).toHaveTextContent(/^Nr\. 2 · /);
    expect(within(eins).getByRole('heading', { level: 4 })).toHaveTextContent(/^Nr\. 1 · /);
    expect(
      within(zwei).getByRole('link', { name: 'ETB-Eintrag zu Lagebesprechung Nr. 2' }),
    ).toHaveAttribute('href', '/einsaetze/1/etb?eintrag=72');
    // Snapshot: Nr. 2 trug einen Termin, Nr. 1 keinen.
    expect(within(zwei).queryByText(/kein Termin/)).toBeNull();
    expect(within(eins).getByText(/kein Termin/)).toBeInTheDocument();
  });

  it('leer: sagt es beim Wort, ohne Fehler zu behaupten', async () => {
    zeige(() => HttpResponse.json([]));
    expect(await screen.findByText(LEER)).toBeInTheDocument();
    expect(screen.queryByText(/konnten nicht geladen werden/)).toBeNull();
  });

  it('Fehler ist nicht leer', async () => {
    zeige(() => HttpResponse.json({ error: 'kaputt' }, { status: 500 }));
    expect(
      await screen.findByText('Frühere Lagebesprechungen konnten nicht geladen werden'),
    ).toBeInTheDocument();
    expect(screen.queryByText(LEER)).toBeNull();
  });

  it('behauptet während des Ladens weder leer noch Fehler', async () => {
    zeige(() => new Promise<never>(() => {}));
    // Positiv abwarten, dass die Liste steht (Spinner), sonst wäre das `null` unten trivial.
    await waitFor(() => expect(document.querySelector('.ant-spin-spinning')).not.toBeNull());
    expect(screen.queryByText(LEER)).toBeNull();
    expect(screen.queryByText(/konnten nicht geladen werden/)).toBeNull();
  });
});
```

- [ ] **Step 2: Tests rot sehen**

Run: `mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/clickup-forgejo-exe-9430ca/frontend exec vitest run src/stab/LagebesprechungStand.test.tsx src/stab/LagebesprechungHistorie.test.tsx`
Expected: FAIL — beide Komponenten fehlen.

- [ ] **Step 3: `LagebesprechungStand.tsx` implementieren**

```tsx
import { Descriptions, Space, theme } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import type { Stab } from '../api/types';
import StatusTag from '../components/StatusTag';
import { etbPfad } from '../routing/deeplinks';
import { kuerzeEntschluss } from './lagebesprechungAbschluss';
import { lagebesprechungZustand } from './lagebesprechungZustand';
import { stabZeilenzielStil } from './zeilenziel';

/**
 * „Jetzt" im 30-s-Takt. Kein geteilter Uhr-Hook im Repo (einziges `setInterval` außerhalb der
 * Tests ist der Autosave in `entwurf/useEntwurfVerlustschutz.ts`), und eine Anzeige braucht
 * keinen — nur `jetzt` ist State, die Rechnung bleibt rein.
 */
function useJetzt(taktMs: number): Dayjs {
  const [jetzt, setJetzt] = useState(() => dayjs());
  useEffect(() => {
    const uhr = setInterval(() => setJetzt(dayjs()), taktMs);
    return () => clearInterval(uhr);
  }, [taktMs]);
  return jetzt;
}

/**
 * Kopfblock der Sektion „Lagebesprechung" (Spec 10): Nächste · Letzte · Anzahl.
 *
 * Der Countdown tickt alle 30 s OHNE Toast und ohne Blinken (EEMUA-191-Budget): es ändert sich
 * nur der Wortlaut im `StatusTag`, die Tabelle wird nicht neu aufgebaut. Der Termin kommt aus
 * `StabAnzeige`, nicht aus dem Einsatzkopf — der steht im NICHT_LIVE-Fach (Spec Entsch. 11).
 *
 * `column={1}` fest wie auf allen Detail-Vollseiten des Bestands; `size="small"` ist an einer
 * nicht-interaktiven Fläche ein Abstandsmaß, keine Treffläche.
 */
export default function LagebesprechungStand({ einsatzId, stab }: { einsatzId: number; stab: Stab }) {
  const { token } = theme.useToken();
  const jetzt = useJetzt(30_000);
  const termin = stab.naechste_lagebesprechung_at;
  const letzte = stab.letzte_lagebesprechung;

  return (
    <Descriptions column={1} size="small" bordered>
      <Descriptions.Item label="Nächste">
        <Space wrap>
          {termin && <ZeitAnzeige wert={termin} />}
          <StatusTag darstellung={lagebesprechungZustand(termin, jetzt)} />
        </Space>
      </Descriptions.Item>
      <Descriptions.Item label="Letzte">
        {letzte ? (
          <Space wrap>
            <span>Nr. {letzte.lfd_nr}</span>
            <ZeitAnzeige wert={letzte.abgehalten_at} />
            <span title={letzte.entschluss}>{kuerzeEntschluss(letzte.entschluss)}</span>
            {/* Handgebautes Bedienziel: ein `<a>` erbt keine Steuerhöhe (LFH-396). */}
            <Link
              to={etbPfad(einsatzId, { eintrag: letzte.etb_eintrag_id })}
              style={stabZeilenzielStil(token)}
              aria-label={`ETB-Eintrag zu Lagebesprechung Nr. ${letzte.lfd_nr}`}
            >
              ETB-Eintrag
            </Link>
          </Space>
        ) : (
          'noch keine'
        )}
      </Descriptions.Item>
      <Descriptions.Item label="Anzahl">{stab.anzahl_lagebesprechungen}</Descriptions.Item>
    </Descriptions>
  );
}
```

- [ ] **Step 4: `LagebesprechungHistorie.tsx` implementieren**

```tsx
import { Flex, theme } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { einsatzKeys } from '../api/queryKeys';
import { ladeLagebesprechungen } from '../api/stab';
import { Liste, ListenEintrag, ListenEintragMeta } from '../components/Liste';
import { SeitenFehler, SeitenStandVeraltet } from '../components/SeitenZustand';
import { etbPfad } from '../routing/deeplinks';
import { stabZeilenzielStil } from './zeilenziel';

/**
 * Historie der Lagebesprechungen (Spec 10): gelesen, nicht verglichen — also `Liste`, keine
 * Tabelle (LFH-330/B2). Je Eintrag Titel „Nr. 3 · <Zeit>", drei Sekundärangaben, keine Aktion.
 *
 * „Nächste Lagebesprechung" ist der SNAPSHOT beim Abschluss: wurde der Termin damals nicht
 * angefasst, übernahm der Server den geltenden Termin — die Zeile zeigt dann einen, obwohl die
 * Maske keinen geschickt hat (`src/stab/repo.rs:203-214`).
 *
 * Live: das `stab`-Ereignis invalidiert den Prefix, der Sub-Key zieht mit. Neue Einträge
 * erscheinen OBEN (absteigend), unter dem Cursor springt nichts, weil die Liste ganz unten auf
 * der Sektion steht und nur liest.
 */
export default function LagebesprechungHistorie({ einsatzId }: { einsatzId: number }) {
  const { token } = theme.useToken();
  const query = useQuery({
    queryKey: einsatzKeys.stabLagebesprechungen(einsatzId),
    queryFn: () => ladeLagebesprechungen(einsatzId),
  });

  // Fehler ≠ leer (LFH-331 · B3).
  if (query.isError && !query.data) {
    return (
      <SeitenFehler
        text="Frühere Lagebesprechungen konnten nicht geladen werden"
        ursache={query.error}
        onWiederholen={() => void query.refetch()}
      />
    );
  }

  return (
    <>
      {query.isError && query.data && (
        <SeitenStandVeraltet onWiederholen={() => void query.refetch()} />
      )}
      <Liste
        dataSource={query.data}
        rowKey={(l) => l.id}
        loading={query.isLoading}
        emptyText="Noch keine Lagebesprechung abgeschlossen"
        renderItem={(l) => (
          <ListenEintrag>
            <ListenEintragMeta
              title={
                <>
                  Nr. {l.lfd_nr} · <ZeitAnzeige wert={l.abgehalten_at} format="kurz" />
                </>
              }
              description={
                <Flex vertical gap={token.marginXXS}>
                  <span style={{ whiteSpace: 'pre-wrap' }}>{l.entschluss}</span>
                  <span>
                    Nächste Lagebesprechung:{' '}
                    {l.naechste_at ? <ZeitAnzeige wert={l.naechste_at} /> : 'kein Termin'}
                  </span>
                  <Link
                    to={etbPfad(einsatzId, { eintrag: l.etb_eintrag_id })}
                    style={stabZeilenzielStil(token)}
                    aria-label={`ETB-Eintrag zu Lagebesprechung Nr. ${l.lfd_nr}`}
                  >
                    ETB-Eintrag
                  </Link>
                </Flex>
              }
            />
          </ListenEintrag>
        )}
      />
    </>
  );
}
```

- [ ] **Step 5: Tests grün**

Run: `mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/clickup-forgejo-exe-9430ca/frontend exec vitest run src/stab/LagebesprechungStand.test.tsx src/stab/LagebesprechungHistorie.test.tsx`
Expected: PASS.

- [ ] **Step 6: Mutationsprobe Takt**

In `LagebesprechungStand.tsx` `useJetzt(30_000)` vorübergehend auf `useJetzt(10_000)` setzen.
Run: `mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/clickup-forgejo-exe-9430ca/frontend exec vitest run src/stab/LagebesprechungStand.test.tsx`
Expected: FAIL in „aktualisiert im 30-s-Takt" (nach 29 s steht bereits „in 22 min"). Wert zurücksetzen, Test grün.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/stab/LagebesprechungStand.tsx frontend/src/stab/LagebesprechungStand.test.tsx frontend/src/stab/LagebesprechungHistorie.tsx frontend/src/stab/LagebesprechungHistorie.test.tsx
git commit -m "feat(stab): Stand und Historie der Lagebesprechung (LFH-543)" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Stab-Seite — Sektion, Kopfaktion, `neueZeile`, `?neu=1`

**Files:**
- Modify: `frontend/src/pages/StabPage.tsx` (vollständig ersetzt, Bestand aus ST4 bleibt inhaltlich)
- Modify: `frontend/src/pages/StabPage.test.tsx` (vollständig ersetzt, alle ST4-Tests bleiben)
- Create: `frontend/src/pages/StabPage.palette.test.tsx`
- Modify: `frontend/src/stab/besetzung.ts` (`besetzungRechteText`), `frontend/src/stab/besetzung.test.ts:176-181`

**Interfaces:**
- Consumes: `LagebesprechungModal`, `zeigeAbschlussToast` (Task 4); `LagebesprechungStand`, `LagebesprechungHistorie` (Task 5); `EinsatzSeite` Props `aktionen`, `neueZeile`, `hinweis` (`components/EinsatzSeite.tsx:13-51`, Marke `data-lfh="seitenkopf-aktionen"`); `CommandPaletteProvider` (`command-palette/CommandPaletteProvider.tsx`, Strg+K global).
- Produces: der `?neu=1`-Leser als Literal `searchParams.get('neu')` in `pages/StabPage.tsx` — Voraussetzung für Task 7.

**Reihenfolge-Zwang:** Der Leser muss **vor oder mit** dem Palette-Eintrag landen. Der Leser allein ist grün (`schnellaktionen.guard.test.ts` ordnet ihn über den Dateinamen `stab` zu, die Deckung iteriert nur über `SCHNELLAKTIONEN`); der Eintrag allein wäre rot.

- [ ] **Step 1: Rechte-Text erweitern (Test zuerst)**

In `frontend/src/stab/besetzung.test.ts` den Block `describe('besetzungRechteText', …)` ersetzen durch:

```ts
describe('besetzungRechteText', () => {
  it('unterscheidet abgeschlossenen Einsatz und fehlende Rolle', () => {
    expect(besetzungRechteText('abgeschlossen')).toMatch(/abgeschlossen/);
    expect(besetzungRechteText('aktiv')).toMatch(/Einsatzleitung und Führungspersonal/);
  });

  /** Seit LFH-543 sperrt der Hinweis ZWEI Wege — Zeilenaktion und Kopfaktion. */
  it('nennt beide gesperrten Wege', () => {
    expect(besetzungRechteText('aktiv')).toMatch(/Besetzung ändern/);
    expect(besetzungRechteText('aktiv')).toMatch(/Lagebesprechungen abschließen/);
    expect(besetzungRechteText('abgeschlossen')).toMatch(/Lagebesprechungen/);
  });
});
```

Run: `mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/clickup-forgejo-exe-9430ca/frontend exec vitest run src/stab/besetzung.test.ts`
Expected: FAIL in „nennt beide gesperrten Wege".

In `frontend/src/stab/besetzung.ts` die Funktion ersetzen durch:

```ts
/**
 * Grund der fehlenden Schreibberechtigung als ganzer Satz (CLAUDE.md, LFH-345 · C10/M16).
 * Nennt seit LFH-543 beide gesperrten Wege der Seite: Besetzung und Lagebesprechung.
 */
export function besetzungRechteText(einsatzStatus: EinsatzStatus): string {
  return einsatzStatus !== 'aktiv'
    ? 'Der Einsatz ist abgeschlossen — Führungsorganisation und Lagebesprechungen sind nur noch lesbar.'
    : 'Nur Einsatzleitung und Führungspersonal können die Besetzung ändern und Lagebesprechungen abschließen.';
}
```

Run: `mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/clickup-forgejo-exe-9430ca/frontend exec vitest run src/stab/besetzung.test.ts`
Expected: PASS.

- [ ] **Step 2: Failing Seiten-Tests schreiben**

`frontend/src/pages/StabPage.test.tsx` vollständig ersetzen durch:

```tsx
import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes, useLocation } from 'react-router';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { modulRegistry } from '../einsatz/modulRegistry';
import StabPage from './StabPage';

class FakeEventSource {
  addEventListener() {}
  removeEventListener() {}
  close() {}
}
/** Zählt die Antworten des Overrides-Handlers — Anker gegen das Rennen im Werkzeug-Link-Test. */
let overrideAufrufe = 0;
beforeEach(() => {
  overrideAufrufe = 0;
  vi.stubGlobal('EventSource', FakeEventSource);
});
afterEach(() => vi.unstubAllGlobals());

const nutzer = {
  id: 1,
  anzeigename: 'Nutzer',
  system_rolle: 'keiner',
  org_rolle: 'fuehrungskraft',
};
const einsatz = (over: object = {}) => ({
  id: 1,
  bezeichnung: 'Lage',
  status: 'aktiv',
  meine_rolle: 'einsatzleitung',
  meine_sachgebiete: [],
  org_id: 5,
  ...over,
});
const leererStab = { anzahl_lagebesprechungen: 0, besetzung: [] };
const label = (key: string) => modulRegistry.find((m) => m.key === key)!.label;
const GRUND = 'Einsatz ist abgeschlossen und schreibgeschützt';

function Ort() {
  const ort = useLocation();
  return <output aria-label="Ort">{ort.pathname + ort.search}</output>;
}

function rendere({
  einsatzObj = einsatz(),
  stab = leererStab as object,
  stabStatus = 200,
  overrides = {} as object,
  route = '/einsaetze/1/stab',
  post = () => HttpResponse.json(leererStab, { status: 201 }) as Response,
} = {}) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(nutzer)),
    http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzObj)),
    http.get('/api/einsaetze/1/stab', () =>
      stabStatus === 200
        ? HttpResponse.json(stab)
        : HttpResponse.json({ error: 'kaputt' }, { status: stabStatus }),
    ),
    http.get('/api/einsaetze/1/stab/lagebesprechungen', () => HttpResponse.json([])),
    http.post('/api/einsaetze/1/stab/lagebesprechungen', () => post()),
    http.get('/api/einsaetze/1/modul-overrides', () => {
      overrideAufrufe += 1;
      return HttpResponse.json(overrides);
    }),
    http.get('/api/einsaetze/1/personal', () => HttpResponse.json([])),
  );
  return renderMitProviders(
    <Routes>
      <Route
        path="/einsaetze/:id/stab"
        element={
          <>
            <StabPage />
            <Ort />
          </>
        }
      />
    </Routes>,
    { route },
  );
}

async function besetzungsSektion() {
  return screen.findByRole('region', { name: 'Besetzung S1–S6' });
}
async function lagebesprechungSektion() {
  return screen.findByRole('region', { name: 'Lagebesprechung' });
}
const kopfaktion = () => screen.findByRole('button', { name: 'Lagebesprechung abschließen' });
/** Primäraktionen IM Kopf — derselbe Zuschnitt wie die Dev-Warnung von `EinsatzSeite`. */
function primaerImKopf(): number {
  const kopf = document.querySelector<HTMLElement>('[data-lfh="seitenkopf-aktionen"]');
  return [...(kopf?.querySelectorAll('button') ?? [])].filter((b) =>
    [...b.classList].some((k) => k.endsWith('-btn-primary')),
  ).length;
}

describe('StabPage', () => {
  it('zeigt sechs feste Zeilen auch ohne jede Besetzung', async () => {
    rendere();
    const sektion = await besetzungsSektion();
    await waitFor(() =>
      expect(
        within(sektion)
          .getAllByRole('heading', { level: 4 })
          .map((h) => h.textContent),
      ).toEqual([
        expect.stringContaining('S1 · Personal'),
        expect.stringContaining('S2 · Lage'),
        expect.stringContaining('S3 · Einsatz'),
        expect.stringContaining('S4 · Versorgung'),
        expect.stringContaining('S5 · Presse- und Medienarbeit'),
        expect.stringContaining('S6 · Information und Kommunikation'),
      ]),
    );
    expect(within(sektion).getAllByText('nicht vergeben')).toHaveLength(6);
  });

  it('nennt die Besetzung beim Wort', async () => {
    rendere({
      stab: {
        anzahl_lagebesprechungen: 0,
        besetzung: [
          {
            sachgebiet: 's2',
            besetzung_art: 'personal',
            personal_id: 99,
            name: 'Müller',
            personal_noch_disponiert: true,
            gesetzt_at: '2026-09-13 10:00:00',
            gesetzt_von_id: 1,
          },
        ],
      },
    });
    const sektion = await besetzungsSektion();
    expect(await within(sektion).findByText('Müller')).toBeInTheDocument();
    expect(within(sektion).getAllByText('nicht vergeben')).toHaveLength(5);
  });

  describe('Rechte-Paar', () => {
    it('mit Schreibrecht: je Zeile „Besetzung ändern", kein Rechte-Hinweis', async () => {
      rendere();
      const sektion = await besetzungsSektion();
      await waitFor(() =>
        expect(
          within(sektion).getAllByRole('button', { name: /^Besetzung ändern – S\d/ }),
        ).toHaveLength(6),
      );
      expect(screen.queryByText(/können die Besetzung ändern/)).toBeNull();
    });

    it('als Beobachter: keine Zeilenaktion, der Grund steht auf der Seite', async () => {
      rendere({ einsatzObj: einsatz({ meine_rolle: 'beobachter' }) });
      const sektion = await besetzungsSektion();
      expect(
        await screen.findByText(/Nur Einsatzleitung und Führungspersonal/),
      ).toBeInTheDocument();
      expect(within(sektion).queryAllByRole('button', { name: /^Besetzung ändern/ })).toHaveLength(
        0,
      );
    });

    it('im abgeschlossenen Einsatz: keine Zeilenaktion, Hinweis nennt den Abschluss', async () => {
      rendere({ einsatzObj: einsatz({ status: 'abgeschlossen' }) });
      await besetzungsSektion();
      expect(await screen.findByText(/Der Einsatz ist abgeschlossen/)).toBeInTheDocument();
      expect(screen.queryAllByRole('button', { name: /^Besetzung ändern/ })).toHaveLength(0);
    });
  });

  it('behauptet während des Ladens keine Besetzung und keinen Termin, sperrt die Kopfaktion', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(nutzer)),
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz())),
      // Antwort bleibt aus: der Abruf steht dauerhaft auf „lädt".
      http.get('/api/einsaetze/1/stab', () => new Promise<never>(() => {})),
      http.get('/api/einsaetze/1/stab/lagebesprechungen', () => HttpResponse.json([])),
      http.get('/api/einsaetze/1/modul-overrides', () => HttpResponse.json({})),
    );
    renderMitProviders(
      <Routes>
        <Route path="/einsaetze/:id/stab" element={<StabPage />} />
      </Routes>,
      { route: '/einsaetze/1/stab' },
    );
    const sektion = await besetzungsSektion();
    expect(within(sektion).getAllByRole('heading', { level: 4 })).toHaveLength(6);
    expect(within(sektion).queryByText('nicht vergeben')).toBeNull();
    expect(within(sektion).queryAllByRole('button', { name: /^Besetzung ändern/ })).toHaveLength(0);
    // Ohne Stand fehlte der Termin zur Vorbelegung — gesperrt (Gegenfall: Kopfaktion-Test unten).
    expect(await kopfaktion()).toBeDisabled();
    expect(within(await lagebesprechungSektion()).queryByText('kein Termin')).toBeNull();
  });

  it('Fehler ist nicht leer: ein gescheiterter Abruf behauptet keine sechs leeren Zeilen', async () => {
    rendere({ stabStatus: 500 });
    expect(
      await screen.findByText('Führungsorganisation konnte nicht geladen werden'),
    ).toBeInTheDocument();
    expect(screen.queryByText('nicht vergeben')).toBeNull();
  });

  it('Werkzeug-Links zeigen nur freigegebene Module', async () => {
    rendere({ overrides: { chat: { sichtbar: false } } });
    await besetzungsSektion();
    const s4 = await screen.findByRole('group', { name: 'Werkzeuge S4' });
    expect(within(s4).getByRole('link', { name: label('nachforderungen') })).toHaveAttribute(
      'href',
      '/einsaetze/1/nachforderungen',
    );
    const s6 = screen.getByRole('group', { name: 'Werkzeuge S6' });
    // Die Gruppen stehen schon vor der Override-Antwort da (Ruling 2). Erst positiv auf die
    // Antwort warten — ein `waitFor` auf `null` wäre sonst sofort und trivial grün.
    await waitFor(() => expect(overrideAufrufe).toBe(1));
    await waitFor(() => expect(within(s6).queryByRole('link', { name: label('chat') })).toBeNull());
    expect(within(s6).getByRole('link', { name: label('einsatzabschnitte') })).toBeInTheDocument();
  });

  it('„Besetzung ändern" öffnet die Maske der Zeile', async () => {
    rendere();
    const sektion = await besetzungsSektion();
    const knopf = await within(sektion).findByRole('button', {
      name: 'Besetzung ändern – S4 Versorgung',
    });
    await userEvent.click(knopf);
    expect(await screen.findByText('Besetzung S4 · Versorgung')).toBeInTheDocument();
  });
});

describe('StabPage · Sektion Lagebesprechung', () => {
  it('zeigt den Stand und die leere Historie', async () => {
    rendere();
    const sektion = await lagebesprechungSektion();
    expect(await within(sektion).findByText('kein Termin')).toBeInTheDocument();
    expect(
      await within(sektion).findByText('Noch keine Lagebesprechung abgeschlossen'),
    ).toBeInTheDocument();
  });

  it('Fehler ist nicht leer: ohne Stand kein „kein Termin"', async () => {
    rendere({ stabStatus: 500 });
    const sektion = await lagebesprechungSektion();
    expect(
      await within(sektion).findByText('Stand der Lagebesprechung konnte nicht geladen werden'),
    ).toBeInTheDocument();
    expect(within(sektion).queryByText('kein Termin')).toBeNull();
  });
});

describe('StabPage · Kopfaktion „Lagebesprechung abschließen"', () => {
  it('ist mit Schreibrecht die eine Primäraktion und öffnet die Maske', async () => {
    rendere();
    const knopf = await kopfaktion();
    await waitFor(() => expect(knopf).toBeEnabled());
    expect(primaerImKopf()).toBe(1);
    await userEvent.click(knopf);
    expect(
      await screen.findByRole('dialog', { name: 'Lagebesprechung abschließen' }),
    ).toBeInTheDocument();
  });

  it('ist als Beobachter gesperrt statt versteckt, der Hinweis nennt den Grund', async () => {
    rendere({ einsatzObj: einsatz({ meine_rolle: 'beobachter' }) });
    expect(await screen.findByText(/Lagebesprechungen abschließen/)).toBeInTheDocument();
    expect(await kopfaktion()).toBeDisabled();
    expect(primaerImKopf()).toBe(1);
  });

  it('ist im abgeschlossenen Einsatz gesperrt', async () => {
    rendere({ einsatzObj: einsatz({ status: 'abgeschlossen' }) });
    await screen.findByText(/Der Einsatz ist abgeschlossen/);
    expect(await kopfaktion()).toBeDisabled();
  });

  /**
   * Belegt Abweichung 6: Öffnen = Montieren, jede Öffnung hat eine frische Mutation. Die Maske
   * wird beim Schliessen AUSGEHÄNGT (nicht `open=false`) — deshalb darf hier auf das Verschwinden
   * des Dialogs gewartet werden. Bleibt dieser `waitFor` rot, steht der Dialog noch in der
   * Verlassen-Bewegung: dann auf `ant-zoom-leave` umstellen (Muster `LageberichtDetailPage.test.tsx`).
   */
  it('öffnet nach einem Fehler ohne den Grund des vorigen Versuchs', async () => {
    rendere({ post: () => HttpResponse.json({ error: GRUND }, { status: 409 }) as Response });
    const u = userEvent.setup();
    const knopf = await kopfaktion();
    await waitFor(() => expect(knopf).toBeEnabled());

    await u.click(knopf);
    const erster = await screen.findByRole('dialog', { name: 'Lagebesprechung abschließen' });
    await u.type(within(erster).getByLabelText('Entschluss'), 'Lage unverändert');
    await u.click(within(erster).getByRole('button', { name: 'Abschließen' }));
    expect(await within(erster).findByText(GRUND)).toBeInTheDocument();

    await u.click(within(erster).getByRole('button', { name: 'Abbrechen' }));
    await waitFor(() => expect(screen.queryAllByRole('dialog')).toHaveLength(0));

    await u.click(knopf);
    const zweiter = await screen.findByRole('dialog', { name: 'Lagebesprechung abschließen' });
    expect(within(zweiter).queryByText(GRUND)).toBeNull();
  });
});

describe('StabPage · ?neu=1 (Schnellaktion)', () => {
  const ort = () => screen.getByRole('status', { name: 'Ort' });

  it('öffnet die Maske mit Schreibrecht und räumt den Parameter', async () => {
    rendere({ route: '/einsaetze/1/stab?neu=1' });
    expect(
      await screen.findByRole('dialog', { name: 'Lagebesprechung abschließen' }),
    ).toBeInTheDocument();
    await waitFor(() => expect(ort()).toHaveTextContent(/^\/einsaetze\/1\/stab$/));
  });

  it('öffnet als Beobachter keine Maske, räumt den Parameter aber trotzdem', async () => {
    rendere({ einsatzObj: einsatz({ meine_rolle: 'beobachter' }), route: '/einsaetze/1/stab?neu=1' });
    // Positiv zuerst: der Leser ist gelaufen. Sonst wäre das `null` unten trivial.
    await waitFor(() => expect(ort()).toHaveTextContent(/^\/einsaetze\/1\/stab$/));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
```

`frontend/src/pages/StabPage.palette.test.tsx`:

```tsx
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import { CommandPaletteProvider } from '../command-palette/CommandPaletteProvider';
import type { TastaturAktionen } from '../command-palette/typen';
import StabPage from './StabPage';

/**
 * „Neue Zeile" der Stab-Seite (LFH-543) mit DEMSELBEN Rechte-Riegel wie die Kopfaktion.
 * Eigene Datei aus denselben Gründen wie `SchaedenPage.palette.test.tsx`: `vi.mock` hoistet
 * dateiweit, und das echte `useBefehle` fordert `/api/einsaetze` an.
 */
vi.mock('../command-palette/useBefehle', () => ({
  useBefehle: (aktionen: TastaturAktionen = {}) =>
    Object.entries(aktionen).map(([id, ausfuehren]) => ({
      id: `tastatur:${id}`,
      gruppe: 'aktionen',
      label: id,
      ausfuehren,
    })),
}));

class FakeEventSource {
  addEventListener() {}
  removeEventListener() {}
  close() {}
}
beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource);
  sessionStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

const nutzer = { id: 1, anzeigename: 'Nutzer', system_rolle: 'keiner', org_rolle: 'fuehrungskraft' };
const einsatzAktiv = {
  id: 1,
  bezeichnung: 'Lage',
  status: 'aktiv',
  meine_rolle: 'einsatzleitung',
  meine_sachgebiete: [],
  org_id: 5,
};

function render(einsatzObj: object) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(nutzer)),
    http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzObj)),
    http.get('/api/einsaetze/1/stab', () =>
      HttpResponse.json({ anzahl_lagebesprechungen: 0, besetzung: [] }),
    ),
    http.get('/api/einsaetze/1/stab/lagebesprechungen', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/modul-overrides', () => HttpResponse.json({})),
  );
  return renderMitProviders(
    <AuthProvider>
      <CommandPaletteProvider>
        <Routes>
          <Route path="/einsaetze/:id/stab" element={<StabPage />} />
        </Routes>
      </CommandPaletteProvider>
    </AuthProvider>,
    { route: '/einsaetze/1/stab' },
  );
}

/** Der Stand muss da sein — ohne ihn ist `neueZeile` absichtlich nicht registriert. */
async function standGeladen() {
  const sektion = await screen.findByRole('region', { name: 'Lagebesprechung' });
  await waitFor(() => expect(sektion).toHaveTextContent('kein Termin'));
}

describe('StabPage · „Neue Zeile" in der Kommandopalette', () => {
  it('bietet „Neue Zeile" mit Schreibrecht an und öffnet damit den Abschluss', async () => {
    const u = userEvent.setup();
    render(einsatzAktiv);
    await standGeladen();
    await u.keyboard('{Control>}k{/Control}');
    await waitFor(() => expect(document.getElementById('cmd-tastatur:neue-zeile')).not.toBeNull());

    await u.click(document.getElementById('cmd-tastatur:neue-zeile')!);
    expect(
      await screen.findByRole('dialog', { name: 'Lagebesprechung abschließen' }),
    ).toBeInTheDocument();
  });

  it('bietet sie dem Beobachter NICHT an', async () => {
    const u = userEvent.setup();
    render({ ...einsatzAktiv, meine_rolle: 'beobachter' });
    await standGeladen();
    await u.keyboard('{Control>}k{/Control}');
    // Positivhälfte: die Palette IST offen (ihr Eingabefeld trägt `role="combobox"`,
    // `CommandPalette.tsx:299`) — sonst belegte das `null` unten nur eine geschlossene Palette.
    expect(await screen.findByRole('combobox')).toBeInTheDocument();
    expect(document.getElementById('cmd-tastatur:neue-zeile')).toBeNull();
  });
});
```

- [ ] **Step 3: Tests rot sehen**

Run: `mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/clickup-forgejo-exe-9430ca/frontend exec vitest run src/pages/StabPage.test.tsx src/pages/StabPage.palette.test.tsx`
Expected: FAIL — keine Region „Lagebesprechung", keine Kopfaktion, kein Leser.

- [ ] **Step 4: `StabPage.tsx` implementieren**

`frontend/src/pages/StabPage.tsx` vollständig ersetzen durch:

```tsx
import { App, Breadcrumb, Button, Flex, Skeleton, Space, Typography, theme } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { ladeEinsatz, ladeModulOverrides } from '../api/einsaetze';
import { einsatzKeys } from '../api/queryKeys';
import { ladeStab } from '../api/stab';
import type { Sachgebiet } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import EinsatzSeite from '../components/EinsatzSeite';
import { Liste, ListenEintrag, ListenEintragMeta } from '../components/Liste';
import SektionHeader from '../components/SektionHeader';
import { RechteHinweis } from '../components/SpeicherHinweis';
import { SeitenFehler, SeitenSkeleton, SeitenStandVeraltet } from '../components/SeitenZustand';
import StatusTag from '../components/StatusTag';
import { modulZielRoute } from '../einsatz/modulRegistry';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { einsatzModulPfad } from '../routing/deeplinks';
import BesetzungModal from '../stab/BesetzungModal';
import LagebesprechungHistorie from '../stab/LagebesprechungHistorie';
import LagebesprechungModal from '../stab/LagebesprechungModal';
import LagebesprechungStand from '../stab/LagebesprechungStand';
import { zeigeAbschlussToast } from '../stab/abschlussToast';
import { besetzungDarstellung, besetzungRechteText, zeileFuer } from '../stab/besetzung';
import { SACHGEBIETE } from '../stab/sachgebiete';
import { werkzeugeFuer } from '../stab/werkzeuge';
import { stabZeilenzielStil } from '../stab/zeilenziel';
import { einsatzStatus } from '../theme/statusFarben';

/**
 * Modul „Stab" (LFH-46): Lagebesprechung und Führungsorganisation S1–S6.
 *
 * UI-Form (Spec Entscheidung 16): eine Vollseite, zwei Sektionen, zwei Masken. Die Besetzung ist
 * eine `Liste` mit sechs festen Zeilen — hier wird nichts verglichen (LFH-330/B2). Die Zeile ist
 * kein Klickziel; genau eine Aktion „Besetzung ändern" je Zeile, ohne Schreibrecht entfällt sie
 * und ein Satz nennt den Grund (LFH-346 · C11).
 *
 * Der Kopf trägt genau eine Primäraktion „Lagebesprechung abschließen" (LFH-543). Sie ÖFFNET ein
 * Modal und gehört deshalb in den Kopf; ohne Schreibrecht steht sie gesperrt da (C10/M16), und
 * `neueZeile` der Kommandopalette trägt denselben Riegel. Die Lücken-Kennzahlen folgen in ST6.
 *
 * Live: das `stab`-Ereignis invalidiert `einsatz-stab` samt Historie (Bestand).
 */
export default function StabPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [offenFuer, setOffenFuer] = useState<Sachgebiet | null>(null);
  const [abschlussOffen, setAbschlussOffen] = useState(false);

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const stabQuery = useQuery({
    queryKey: einsatzKeys.stab(einsatzId),
    queryFn: () => ladeStab(einsatzId),
  });
  const overridesQuery = useQuery({
    queryKey: einsatzKeys.modulOverrides(einsatzId),
    queryFn: () => ladeModulOverrides(einsatzId),
  });

  // VOR den frühen Returns (Hook-Reihenfolge): der `?neu=1`-Leser darunter braucht das Recht,
  // bevor der Einsatz sicher geladen ist. `darfImEinsatzSchreiben` liefert für `undefined` false
  // (Muster `SchaedenPage.tsx:210`).
  const darfSchreiben = darfImEinsatzSchreiben(einsatzQuery.data, benutzer);
  const stabDa = stabQuery.data != null;
  // Ohne Stand fehlte der bestehende Termin zur Vorbelegung — ein unverändertes Absenden
  // schickte `naechste_at: null` und löschte ihn (Plan-Abweichung 7).
  const abschlussErlaubt = darfSchreiben && stabDa;
  const oeffneAbschluss = useCallback(() => setAbschlussOffen(true), []);

  // Schnellaktion: ?neu=1 öffnet den Abschluss der Lagebesprechung (Kommandopalette, LFH-543).
  // Das LITERAL `searchParams.get('neu')` muss in DIESER Datei stehen:
  // `schnellaktionen.guard.test.ts` ordnet den Leser über den Dateinamen dem Modul zu.
  // Warten, bis Einsatz UND Stand geladen sind; Parameter immer räumen (apply-then-clean),
  // die Maske nur mit Schreibrecht und Stand öffnen.
  useEffect(() => {
    if (searchParams.get('neu') !== '1') return;
    if (einsatzQuery.isLoading || stabQuery.isLoading) return;
    if (darfSchreiben && stabDa) setAbschlussOffen(true);
    searchParams.delete('neu');
    setSearchParams(searchParams, { replace: true });
  }, [
    searchParams,
    setSearchParams,
    einsatzQuery.isLoading,
    stabQuery.isLoading,
    darfSchreiben,
    stabDa,
  ]);

  if (einsatzQuery.isLoading) return <SeitenSkeleton />;
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return (
      <SeitenFehler
        text="Einsatz nicht gefunden oder kein Zugriff"
        ursache={einsatzQuery.error}
        onWiederholen={() => void einsatzQuery.refetch()}
      />
    );
  }
  const einsatz = einsatzQuery.data;

  // Fehler ≠ leer (LFH-331 · B3): ohne Daten tritt der Fehler an die Stelle der Liste — sechs
  // „nicht vergeben" wären sonst eine Aussage über eine Menge, die nie ankam.
  const stabGescheitert = stabQuery.isError && !stabQuery.data;
  const standVeraltet = stabQuery.isError && stabQuery.data != null;
  const offenerEintrag = SACHGEBIETE.find((s) => s.sachgebiet === offenFuer);

  return (
    <EinsatzSeite
      dataUpdatedAt={stabQuery.dataUpdatedAt}
      titel={
        <Space>
          Stab
          <StatusTag darstellung={einsatzStatus[einsatz.status]} />
        </Space>
      }
      beschreibung="Führungsorganisation (S1–S6) und Lagebesprechungen der Einsatzleitung"
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz.bezeichnung },
            { title: 'Stab' },
          ]}
        />
      }
      // Gesperrt statt versteckt (C10/M16): der Hinweis darunter nennt den Grund.
      aktionen={
        <Button type="primary" disabled={!abschlussErlaubt} onClick={oeffneAbschluss}>
          Lagebesprechung abschließen
        </Button>
      }
      // Derselbe Riegel wie am Knopf — die Palette ist ein zweiter Weg auf dieselbe Aktion.
      neueZeile={abschlussErlaubt ? oeffneAbschluss : undefined}
      // Bedingt übergeben, nicht über `sichtbar` allein: `EinsatzSeite` rendert den Slot, sobald
      // er truthy ist — ein JSX-Element ist das immer, auch wenn es `null` zurückgibt, und
      // hinterliesse mit Schreibrecht ein leeres `div` mit Aussenabstand (Muster `SchaedenPage`).
      hinweis={
        !darfSchreiben && <RechteHinweis sichtbar text={besetzungRechteText(einsatz.status)} />
      }
    >
      <SektionHeader titel="Lagebesprechung" />
      <section aria-label="Lagebesprechung" style={{ marginBottom: token.marginLG }}>
        <Flex vertical gap={token.margin}>
          {stabGescheitert ? (
            <SeitenFehler
              text="Stand der Lagebesprechung konnte nicht geladen werden"
              ursache={stabQuery.error}
              onWiederholen={() => void stabQuery.refetch()}
            />
          ) : stabQuery.data ? (
            <LagebesprechungStand einsatzId={einsatzId} stab={stabQuery.data} />
          ) : (
            // Vor dem Laden wird kein Termin behauptet (Ruling 1).
            <Skeleton title={false} paragraph={{ rows: 3 }} />
          )}
          <LagebesprechungHistorie einsatzId={einsatzId} />
        </Flex>
      </section>

      <SektionHeader titel="Besetzung S1–S6" />
      <section aria-label="Besetzung S1–S6">
        {stabGescheitert ? (
          <SeitenFehler
            text="Führungsorganisation konnte nicht geladen werden"
            ursache={stabQuery.error}
            onWiederholen={() => void stabQuery.refetch()}
          />
        ) : (
          <>
            {standVeraltet && (
              <SeitenStandVeraltet onWiederholen={() => void stabQuery.refetch()} />
            )}
            <Liste
              dataSource={SACHGEBIETE}
              rowKey={(s) => s.sachgebiet}
              loading={stabQuery.isLoading}
              renderItem={(s) => {
                const zeile = zeileFuer(stabQuery.data, s.sachgebiet);
                const werkzeuge = werkzeugeFuer(s.werkzeuge, benutzer, overridesQuery.data);
                return (
                  <ListenEintrag
                    actions={
                      // Erst mit Daten: vor dem Laden belegte die Maske „nicht vergeben" vor —
                      // dieselbe Mengenaussage, die der Tag unterdrückt (Ruling 1). Die Tastatur
                      // erreicht den Knopf auch unter dem Ladeindikator.
                      darfSchreiben && stabQuery.data
                        ? [
                            <Button
                              key="aendern"
                              aria-label={`Besetzung ändern – ${s.kuerzel} ${s.label}`}
                              onClick={() => setOffenFuer(s.sachgebiet)}
                            >
                              Besetzung ändern
                            </Button>,
                          ]
                        : undefined
                    }
                  >
                    <ListenEintragMeta
                      title={
                        <Space wrap>
                          {`${s.kuerzel} · ${s.label}`}
                          {/* Solange nichts angekommen ist, wird nichts über die Besetzung
                              behauptet (LFH-331 · B3/D4) — „nicht vergeben" vor dem Laden wäre
                              eine Aussage über eine Menge, die noch gar nicht da ist. */}
                          {stabQuery.data && (
                            <StatusTag darstellung={besetzungDarstellung(zeile)} />
                          )}
                        </Space>
                      }
                      description={
                        <Flex vertical gap={token.marginXXS}>
                          <span>
                            {s.aufgaben}{' '}
                            <Typography.Text type="secondary">
                              (FwDV 100 Anl. 2, S. {s.seite})
                            </Typography.Text>
                          </span>
                          {werkzeuge.length > 0 && (
                            <Flex wrap role="group" aria-label={`Werkzeuge ${s.kuerzel}`}>
                              {werkzeuge.map((m) => (
                                <Link
                                  key={m.key}
                                  to={einsatzModulPfad(einsatzId, modulZielRoute(m))}
                                  style={stabZeilenzielStil(token)}
                                >
                                  {m.label}
                                </Link>
                              ))}
                            </Flex>
                          )}
                        </Flex>
                      }
                    />
                  </ListenEintrag>
                );
              }}
            />
          </>
        )}
      </section>
      {offenerEintrag && darfSchreiben && (
        <BesetzungModal
          key={offenerEintrag.sachgebiet}
          einsatzId={einsatzId}
          eintrag={offenerEintrag}
          zeile={zeileFuer(stabQuery.data, offenerEintrag.sachgebiet)}
          onSchliessen={() => setOffenFuer(null)}
        />
      )}
      {/* Montiert = offen: die Maske friert Vorbelegung und Basis beim Montieren ein, und jede
          Öffnung hat eine frische Mutation ohne alten Fehler. Der Toast nimmt das `navigate`
          DIESER Seite — `<AntApp>` liegt außerhalb des Routers. */}
      {abschlussOffen && darfSchreiben && stabQuery.data && (
        <LagebesprechungModal
          einsatzId={einsatzId}
          stab={stabQuery.data}
          onAbgeschlossen={(eigene) => zeigeAbschlussToast(message, { einsatzId, eigene, navigate })}
          onSchliessen={() => setAbschlussOffen(false)}
        />
      )}
    </EinsatzSeite>
  );
}
```

- [ ] **Step 5: Tests grün**

Run: `mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/clickup-forgejo-exe-9430ca/frontend exec vitest run src/pages/StabPage.test.tsx src/pages/StabPage.palette.test.tsx src/stab src/command-palette/schnellaktionen.guard.test.ts src/components/EinsatzSeite.test.tsx`
Expected: PASS — der Guard bleibt grün, weil der neue Leser über den Dateinamen `stab` zugeordnet wird und noch kein Eintrag Deckung verlangt.

- [ ] **Step 6: Mutationsprobe Rechte-Riegel an `neueZeile`**

`neueZeile={abschlussErlaubt ? oeffneAbschluss : undefined}` vorübergehend auf `neueZeile={oeffneAbschluss}` setzen.
Run: `mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/clickup-forgejo-exe-9430ca/frontend exec vitest run src/pages/StabPage.palette.test.tsx`
Expected: FAIL in „bietet sie dem Beobachter NICHT an". Riegel zurücksetzen, Test grün.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/StabPage.tsx frontend/src/pages/StabPage.test.tsx frontend/src/pages/StabPage.palette.test.tsx frontend/src/stab/besetzung.ts frontend/src/stab/besetzung.test.ts
git commit -m "feat(stab): Lagebesprechung auf der Stab-Seite, Kopfaktion und ?neu=1 (LFH-543)" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Schnellaktion in der Kommandopalette und volle Gates

**Files:**
- Modify: `frontend/src/command-palette/befehle.ts:20-28` (Import), `:57-87` (Tabelle), Kopfkommentar `:40-42`
- Modify: `frontend/src/command-palette/befehle.test.ts:156-186`
- Modify: `frontend/src/command-palette/befehle.modulstatus.test.ts:88-97`
- Modify: `frontend/src/command-palette/schnellaktionen.guard.test.ts:9` (nur Kopfkommentar)

**Interfaces:**
- Consumes: `stabPfad(einsatzId, { neu?: boolean })` (`routing/deeplinks.ts:190`); der `?neu=1`-Leser in `pages/StabPage.tsx` (Task 6 — **muss vorher gemergt sein**); Registry-Eintrag `stab` mit `status: 'fertig'` (`einsatz/modulRegistry.ts:97-104`, ST4).
- Produces: `SCHNELLAKTIONEN`-Eintrag `{ modulKey: 'stab', label: 'Lagebesprechung abschließen' }` → Befehl `aktion:stab` mit Ziel `/einsaetze/<id>/stab?neu=1`.

Drei Pins hängen an der Tabelle, nicht zwei: `befehle.test.ts` (IDs und Literal-Ziele) und `befehle.modulstatus.test.ts:96`.

- [ ] **Step 1: Pins erweitern (Test zuerst)**

In `frontend/src/command-palette/befehle.test.ts` den Test

```ts
  it('verdrahtet die Top-4-Aktionen mit ?neu=1 für Berechtigte', () => {
```

umbenennen in

```ts
  it('verdrahtet die Schnellaktionen mit ?neu=1 für Berechtigte', () => {
```

und dessen `toEqual`-Liste ersetzen durch:

```ts
    expect(b.map((x) => x.id).filter((id) => id.startsWith('aktion:'))).toEqual([
      'aktion:personen',
      'aktion:etb',
      'aktion:unfallhilfsstellen',
      'aktion:schaeden',
      'aktion:stab',
    ]);
```

Im folgenden Test die Liste der Literal-Ziele ergänzen um die letzte Zeile:

```ts
      ['aktion:schaeden', '/einsaetze/5/schaeden?neu=1'],
      ['aktion:stab', '/einsaetze/5/stab?neu=1'],
```

und im Doc-Kommentar darüber „Die vier Ziele" durch „Die Ziele" ersetzen.

In `frontend/src/command-palette/befehle.modulstatus.test.ts` die Erwartung ersetzen durch:

```ts
    ).toEqual(['aktion:etb', 'aktion:unfallhilfsstellen', 'aktion:schaeden', 'aktion:stab']);
```

und im Kommentar darüber „die Reihenfolge der übrigen drei bleibt" durch „die Reihenfolge der übrigen bleibt" ersetzen.

Run: `mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/clickup-forgejo-exe-9430ca/frontend exec vitest run src/command-palette/befehle.test.ts src/command-palette/befehle.modulstatus.test.ts`
Expected: FAIL — `aktion:stab` fehlt in beiden Listen, `find(… 'aktion:stab')` liefert `undefined`.

- [ ] **Step 2: Eintrag anlegen**

In `frontend/src/command-palette/befehle.ts` den Import aus `'../routing/deeplinks'` um `stabPfad` ergänzen (alphabetisch nach `schaedenPfad`):

```ts
import {
  einsaetzePfad,
  einsatzModulPfad,
  einsatzPfad,
  etbPfad,
  personenPfad,
  schaedenPfad,
  stabPfad,
  unfallhilfsstellenListePfad,
} from '../routing/deeplinks';
```

Am Ende der Tabelle `SCHNELLAKTIONEN` nach dem Eintrag `schaeden` anfügen:

```ts
  {
    // LFH-543: ans ENDE — die Tabelle ordnet nach Erfassungshäufigkeit, eine Lagebesprechung
    // fällt seltener an als Person, ETB-Eintrag, UHS oder Schaden. Leser: `pages/StabPage.tsx`.
    modulKey: 'stab',
    pfad: (id) => stabPfad(id, { neu: true }),
    label: 'Lagebesprechung abschließen',
    schlagworte: ['lagebesprechung', 'entschluss', 'stab', 'führungsvorgang'],
  },
```

Im Kopfkommentar über der Tabelle „deshalb tragen alle vier Zeilen den Builder" durch „deshalb tragen alle Zeilen den Builder" ersetzen. In `frontend/src/command-palette/schnellaktionen.guard.test.ts:9` „die vier Schnellaktionen" durch „die Schnellaktionen" ersetzen (reine Prosa, der Guard zählt nicht).

- [ ] **Step 3: Tests grün**

Run: `mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/clickup-forgejo-exe-9430ca/frontend exec vitest run src/command-palette`
Expected: PASS, insbesondere `schnellaktionen.guard.test.ts` („nennt je Eintrag ein FERTIGES Modul", „liegt unter dem Modulpfad seines EIGENEN Trägers und trägt neu=1", „hat je Eintrag eine Seite seines Trägermoduls, die ?neu=1 wirklich liest").

- [ ] **Step 4: Mutationsprobe Deckung**

In `pages/StabPage.tsx` vorübergehend `searchParams.get('neu')` durch `searchParams.get(NEU)` mit `const NEU = 'neu';` ersetzen.
Run: `mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/clickup-forgejo-exe-9430ca/frontend exec vitest run src/command-palette/schnellaktionen.guard.test.ts`
Expected: FAIL in „hat je Eintrag eine Seite seines Trägermoduls, die ?neu=1 wirklich liest" (Eintrag `stab`). Literal zurücksetzen, Test grün.

- [ ] **Step 5: Volle Frontend-Gates**

Run: `mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/clickup-forgejo-exe-9430ca/frontend typecheck`
Expected: keine Fehler.
Run: `mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/clickup-forgejo-exe-9430ca/frontend lint`
Expected: 0 Fehler, 0 Warnungen.
Run: `mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/clickup-forgejo-exe-9430ca/frontend exec prettier --check src`
Expected: sauber. Sonst `… exec prettier --write <Dateien dieses Tickets>` **zweimal** laufen lassen (Prettier ist nicht idempotent) und erneut prüfen.
Run: `mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/clickup-forgejo-exe-9430ca/frontend exec vitest run`
Expected: alle grün, insbesondere `dichte.guard.test.ts`, `statusVertrag.guard.test.ts`, `queryKeys.guard.test.ts`, `dateinamen.guard.test.ts`, `schreibrecht.guard.test.ts`, `aktionsabstand.guard.test.ts`, `etb/WiedervorlageModal.test.tsx`, `pages/EtbPage.test.tsx`. Ein einzelner Timeout, der beim Wiederholen wandert, ist Last (Memory „Testsuite-Flakiness unter Last"), keine Regression — dann die betroffene Datei einzeln wiederholen und das Ergebnis im Commit-Text nicht verschweigen.

- [ ] **Step 6: Commit**

Formatierungsänderungen aus Step 5 gehören in diesen Commit.

```bash
git add frontend/src/command-palette/befehle.ts frontend/src/command-palette/befehle.test.ts frontend/src/command-palette/befehle.modulstatus.test.ts frontend/src/command-palette/schnellaktionen.guard.test.ts
git status --short
git commit -m "feat(stab): Schnellaktion Lagebesprechung abschließen in der Kommandopalette (LFH-543)" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

(`git status --short` vor dem Commit: nur Dateien dieses Tickets dürfen gestaged sein; von Prettier nachformatierte Dateien aus Task 1–6 werden mit `git add` ergänzt.)

---

## Self-Review (erledigt beim Schreiben)

**AK-Abgleich LFH-543:**
- *`lagebesprechungZustand` beidseits beider Sommerzeitgrenzen getestet* → Task 2, `lagebesprechungZustand.test.ts`: vier UTC-Zeitpunkte gegen den absoluten Zeitpunkt (`.valueOf()`) plus je eine Rechnung über die März- und die Oktober-Umstellung in beide Richtungen. Die Signatur nimmt den **Wire-String**, sonst prüfte der Test den Parse gar nicht. Blindheit in UTC-Umgebungen: Offener Punkt 2.
- *Message-Queue-Zähler: Fehlergrund im Modal, nicht (auch) im Toast* → Task 4: `closest('.ant-message') === null` **und** `toastsMit(GRUND)` Länge 0, Dialog ohne `ant-zoom-leave`; Gegenaussage im selben File: der Erfolgs-Toast steht in `.ant-message` (Länge 1).
- *Feldbudget ≤ 3 sichtbar; Aufklappen erhöht die Zahl (Paar-Test)* → Task 4: genau 2 sichtbar mit Vorbedingung „DatePicker wird gezählt", Zeitpunkt im Baum und `not.toBeVisible()`; Aufklappen → `vorher + 1`; Mutationsprobe `forceRender`.

**Ticket-Wortlaut:**
- `ErfassungsModal`, 2 sichtbare Felder, Entschluss Pflicht, DatePicker `showTime` + Schnellwahl + „kein Termin", Zeitpunkt unter „Weitere Angaben" mit `forceRender` (Default jetzt) → Task 4.
- `onErfassen` mit `mutateAsync` → Task 4. Fehler im Modal (FreigabeDialog-Bauform, ohne `reset()` wegen Montieren = Öffnen) → Task 4, Abweichung 6, Seiten-Test Task 6.
- Erfolgs-Toast mit Deeplink `etbPfad(einsatzId, { eintrag })` → Task 4, mit Zuordnungsregel (Abweichung 5) und gemessener Route.
- Schnellwahl gehoben statt kopiert → Task 1; Wiedervorlage behält vier Einträge, Bestandstests laufen unverändert mit.
- Sektion: Descriptions Nächste (StatusTag „in 23 min" neutral / „seit 5 min überfällig" achtung / „kein Termin"; 30 s ohne Blinken/Toast, Takt per Mutationsprobe), Letzte (Nr., DTG, Entschluss gekürzt, ETB-Link), Anzahl; darunter Historie → Task 5 + Task 6.
- `SCHNELLAKTIONEN`-Eintrag → `stabPfad(id, { neu: true })`, apply-then-clean, Guard deckt → Task 6 (Leser) + Task 7 (Eintrag, drei Pins, Mutationsprobe Deckung).
- Aus ST4 verschoben: Kopf-Slot als genau eine Primäraktion, gesperrt mit `RechteHinweis` → Task 6; `neueZeile` mit demselben Riegel + Mutationsprobe → Task 6; Sub-Key mit Literal-Pin → Task 3; Lagebesprechungs-API → Task 3.

**Verbindliche Entscheidungen:** Vorbelegung/Tri-State → Task 2 + 4; Schnellwahl ab Zeitpunkt, Teilmenge, Bestandslabels → Task 1 + 4; Countdown-Wortlaut → Task 2; Einfrieren per `useState` → Task 4; Leser-Literal in `pages/StabPage.tsx`, apply-then-clean, nur mit Recht, wartet auf Einsatz → Task 6; `Descriptions column={1}` → Task 5; Toast- und `forceRender`-Messaufträge mit Rückfallweg → Task 4; Toast nur bei passender Zeile → Task 2 + 4; Hinweis-Slot bleibt bedingt übergeben → Task 6.

**Placeholder-Scan:** keine „TBD"/„später"/„analog Task N"; jede Code-Stufe vollständig; jede „kein/nie"-Aussage hat ihren Gegenfall im selben Test oder im Nachbartest derselben Datei (Ausnahme mit Verweis: „ohne Toast" im Stand-Test, Gegenfall in `LagebesprechungModal.test.tsx`).

**Typkonsistenz:** `LagebesprechungAbschlussBody` (Task 2) → `abschlussBody` (Task 2) → `schliesseLagebesprechungAb` (Task 3) → `mutationFn` (Task 4). `AbschlussVorbelegung.naechste` in Task 2 und Task 4 identisch. `eigeneLagebesprechung(antwort, body)` → `onAbgeschlossen(eigene)` → `zeigeAbschlussToast(api, { einsatzId, eigene, navigate })` in Task 4 und Task 6 identisch. `einsatzKeys.stabLagebesprechungen` in Task 3 und Task 5 identisch. `besetzungRechteText` behält Name und Signatur.

**Nicht in ST5:** Lücken-Kennzahlen und S2-Kennzahl (ST6/LFH-544, nutzt `lagebesprechungZustand` mit), Vorschläge (ST7), Prüfliste Einsatztauglichkeit, e2e und Gate-3 inklusive Klick auf den Toast unter dem Daten-Router (ST9/LFH-547).

## Offene Punkte für den Controller

1. **Leeres Feld ohne Vorbelegung:** Die Nutzerentscheidung „unverändert → Schlüssel weglassen" kollidiert mit dem Fall „bestehender Termin liegt in der Vergangenheit, wird deshalb nicht vorbelegt, Feld bleibt leer" — weggelassen bliebe der vergangene Termin stehen, erschiene sofort als „überfällig" und landete im Historien-Snapshot; der Plan schickt dort `null` (leeres Feld = kein Termin, „unverändert" gilt nur für einen vorbelegten Wert), und das ist per Test gepinnt (`lagebesprechungAbschluss.test.ts`, `LagebesprechungModal.test.tsx`).
2. **Sommerzeit-Test in UTC-Umgebungen blind:** Vitest setzt kein `TZ`, der DST-Test fängt einen lokalen Parse also nur auf einer Maschine außerhalb von UTC (lokal Europe/Berlin, nicht in der CI); ein `TZ`-Pin für die Suite wäre eine eigene Entscheidung und ist nicht Teil dieses Plans.
3. **Toast-Navigation nur unter `MemoryRouter` gemessen:** Produktion läuft unter `createBrowserRouter` (anderer `useNavigate`-Pfad); der Klick im Toast gehört deshalb in den e2e-Nachweis von LFH-547.
