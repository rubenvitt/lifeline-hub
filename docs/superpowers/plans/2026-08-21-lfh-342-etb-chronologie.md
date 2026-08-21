# LFH-342 · C7 — Einsatztagebuch: lesbare Chronologie, Serienerfassung und sichere Bedienung

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Das Einsatztagebuch wird auf schmalem Schirm lesbar, die Serienerfassung
verliert ihr Bedienungsgerüst, gepufferte Einträge stehen in der Chronologie statt nur im
Banner, und der Befehlsentwurf überlebt einen Seitenwechsel.

**Architecture:** Die Chronologie wandert vom direkten `KatalogTabelle`-Aufruf auf das
B2-Primitiv `components/Datensicht.tsx` (`form="auto"`, Kartenzweig als Eigenbau). Die
Filterachse bekommt eine Zeitkonversion in beide Richtungen und zieht in die URL, gebaut
ausschließlich über `routing/deeplinks.ts`. Offline gepufferte Einträge werden über ein
diskriminiertes Union in dieselbe Zeilenmenge eingespeist. `BefehlDetailPage` bekommt
Autosave, Verlassen-Schutz und einen Riegel gegen das Überschreiben berührter Felder.

**Tech Stack:** React 19, antd 6, TanStack Query 5, react-router 7, dayjs (+utc),
Vitest 4 / jsdom 29, Playwright.

**Spec:** ClickUp LFH-342 (C7) · `docs/superpowers/specs/2026-07-25-bedien-leitlinie-einsatzkontexte.md`
· `docs/superpowers/specs/2026-07-30-etb-pruefliste.md` (Vorgänger-Prüfliste aus B5e)
· `docs/superpowers/specs/2026-07-28-datensicht-primitiv-api.md`

---

## Global Constraints

- **Kein neues punktuelles `size` auf interaktiven Elementen.** Trefflächen kommen aus
  `controlHeight` (Staffel 30 / 48 / 72 px). Erzwungen von `components/dichte.guard.test.ts`.
- **Handgebaute Bedienziele brauchen ZWEI Angaben:** `minHeight: token.controlHeight`
  **plus** `padding` aus `token.paddingSM`/`token.padding`, aus aufgelösten Tokens
  (`theme.useToken()`), nie aus `var(--lfh-*)`. Geprüft wird als **reine, exportierte**
  Stilfunktion nach dem Muster `bedienzielStil` (`pages/lagekarte/Sidebar.tsx`).
- **Farbwerte ausschließlich aus `theme/tokens.ts` / `theme/statusFarben.ts` /
  `theme/rollen.css`.** Statusfarbe nur als Punkt/Rand/Beistrich, nie als Textfläche.
  Jede Farbaussage braucht einen zweiten Kanal (WCAG 1.4.1).
- **Query-Keys nur über `frontend/src/api/queryKeys.ts`** — kein Inline-String-Array
  (`queryKeys.guard.test.ts`).
- **Einsatz-URLs nur über `frontend/src/routing/deeplinks.ts`** — keine
  Inline-Template-Literals (LFH-25).
- **`pnpm lint` läuft mit `--max-warnings 0`.** `eslint-disable` nur zeilengenau an der
  gemeldeten Zeile und mit Begründung.
- **Erfassungsmasken nehmen `components/Erfassung.tsx`** (`ErfassungsModal` /
  `ErfassungsFormular`), kein handgebautes `<Modal onOk>` + `<Form>`.
- **Ab drei Aktionen an einer Zeile: ein `Dropdown`** mit `menu={{ items }}`,
  `trigger={['click']}`, `autoFocus`, icon-only `<Button type="text">`; der zugängliche
  Name trägt die Zeilenkennung. Gezählt wird **nach** der Rechteprüfung.
- **Rot bedient nichts.** Eine `<Space>`-Aktionsreihe mit `danger`-Knopf und mindestens
  einer weiteren Aktion trägt `size="middle"` (`aktionsabstand.guard.test.ts`).
- **Jede Zahl im Prüflisten-Dokument trägt Quelle und Abschnittsnummer**, Gerechnetes ist
  `[abgeleitet]`.
- **Gate:** `./scripts/check-all.sh` muss am Ende grün sein. Kein `| tail` um
  Gate-Kommandos.

### Frontend-Kommandos (mise, absolute Pfade)

```bash
FE=/Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/feat+lfh-342-etb-chronologie-serienerfassung/frontend
mise exec pnpm@11.10.0 -- pnpm -C $FE vitest run src/pfad/zur/Datei.test.tsx
mise exec pnpm@11.10.0 -- pnpm -C $FE lint
mise exec pnpm@11.10.0 -- pnpm -C $FE tsc --noEmit
```

---

## AK-Korrekturen (gemessen, nicht umgedeutet)

Drei Akzeptanzkriterien des Tickets sind durch spätere, getestete Entscheidungen überholt.
Sie werden **benannt und korrigiert**, nicht stillschweigend anders gelesen — dieselbe
Praxis wie in C4/C5/C6.

1. **„≥44×44 px" ist durch die Dichte-Staffel abgelöst.** Seit LFH-333/B5 misst ein
   korrekter Knopf in der Vorgabestufe `kompakt` **30 px**; 48 px gilt für `komfortabel`,
   72 px für `Handschuh` (MIL-STD-1472F Fig. 12). Ein e2e gegen 44 px wäre rot ohne Fehler
   im Code. **Korrigiert zu:** die Trefffläche ist gleich `controlHeight` der aktiven Stufe.
2. **„`grep -rn 'size=\"small\"' frontend/src/etb/` liefert 0 Treffer" ist wörtlich
   unerfüllbar** und substanziell schon erfüllt: der einzige verbleibende Treffer
   (`etb/MetaChip.tsx:76`) ist **Prosa in einem Blockkommentar**, die genau erklärt, warum
   die Angabe weg ist. `dichte.guard.test.ts` zählt über JSX-Tags mit Klammertiefe und
   meldet für `etb/` **0** Verstöße. **Korrigiert zu:** der Dichte-Guard meldet für `etb/`
   und `pages/EtbPage.tsx` null interaktive Klein-Angaben.
3. **`erfasst_lokal_at` existiert nicht.** Der Zeitstempel eines gepufferten Eintrags
   heißt `erstellt_at` (`offline/queue.ts:59`, `AusstehenderEintrag`).

Zusätzlich **überholt und beim Bestandscheck als erledigt gemessen** (B5e/LFH-365,
B3/LFH-331, B4/LFH-332, B7/LFH-335 haben sie eingelöst, bevor C7 lief):

| Ticket-Punkt | Stand |
| --- | --- |
| Zeilenaktionen ins Überlaufmenü (M83, H59) | erledigt — `EtbTabelle.tsx`, Dropdown mit Zeilenkennung im Namen |
| ⧖ sichtbar beschriften (M83) | erledigt — `<Tag>Nachtrag</Tag>`, `aria-label` bewusst gelöscht |
| Trefferflächen Schnellerfassung / SlashMenu / BuchstabierHilfe (M83) | erledigt — 0 Klein-Angaben, `minHeight: token.controlHeight` in `SlashMenu.tsx` |
| Lade-/Leer-/Fehlerzustand (M81) | erledigt — `ladend`/`fehler`/`leerText` an `EtbTabelle`, vier Zustände in `EtbPage.tsx` |
| Wertübernahme-Schalter „Werte behalten" (H61, Kern) | erledigt — `nurUebernahme()`, Zustand in `EtbPage`, Vorgabe AUS |
| Tastaturvertrag sichtbar + Cmd/Strg+Enter (M84) | erledigt — `ENTER_HINWEIS` in der Steuerzeile, Platzhalter entdoppelt |
| `BausteinPlatzhalterModal` als `<Form onFinish>` mit `autoFocus` (M84) | erledigt |

**Offen und Gegenstand dieses Plans:** H59/H64 (Chronologie), M80 (Debounce + URL),
M82 (Offline-Zeilen), N22 (Wiedervorlage), N18 (Befehlsentwurf) und der H61-Rest
(`an` aus dem Kontext vorbelegen).

---

## File Structure

| Datei | Verantwortung | Task |
| --- | --- | --- |
| `frontend/src/etb/filterZeit.ts` **(neu)** | Reine Zeitkonversion Filter ↔ Wire, beide Richtungen | T1 |
| `frontend/src/etb/filterZeit.test.ts` **(neu)** | Round-Trip inkl. DST-Grenze | T1 |
| `frontend/src/routing/deeplinks.ts` | `etbPfad` um `q`/`typ`/`von`/`bis`; `parseEtbFilter` | T1 |
| `frontend/src/routing/deeplinks.test.ts` | Pin auf beide Richtungen | T1 |
| `frontend/src/etb/EtbFilterleiste.tsx` | Entprellte Volltextsuche, Hydrierung aus Startwerten | T2 |
| `frontend/src/pages/EtbPage.tsx` | Filter ↔ URL, Offline-Zeilen einspeisen, Datensicht-Aufruf | T2, T5, T6 |
| `frontend/src/etb/WiedervorlageModal.tsx` | Default +30 min, Schnellwahl-Chips | T3 |
| `frontend/src/etb/Schnellerfassung.tsx` | `an`-Vorbelegung aus dem Kontext | T4 |
| `frontend/src/etb/etbZeile.ts` **(neu)** | Diskriminiertes Union `EtbZeile`, Zusammenführung + Schlüssel | T5 |
| `frontend/src/etb/EtbTabelle.tsx` | Umbau auf `Datensicht`, Kartenzweig als Eigenbau | T6 |
| `frontend/src/components/datensicht.guard.test.ts` | `KARTEN_EIGENBAU` + Längenpin | T6 |
| `frontend/src/components/katalogTabelle.guard.test.ts` | Kommentar fortschreiben (ETB läuft jetzt über `Datensicht`) | T6 |
| `frontend/src/pages/BefehlDetailPage.tsx` | Autosave, „zuletzt gespeichert", Router-Blocker, Überschreib-Riegel | T7 |
| `frontend/e2e/etb-chronologie.spec.ts` **(neu)** | 390-px-Body-Scroll, ≥50 % Contentbreite bei 1366 | T8 |
| `docs/superpowers/specs/2026-08-21-lfh-342-pruefliste.md` **(neu)** | Prüfliste Einsatztauglichkeit, 15 Kriterien | T9 |
| `CLAUDE.md` | Festlegungen aus C7 | T9 |

---

### Task 1: Zeitachse in beide Richtungen + `etbPfad`-Erweiterung

Der Dateikopf von `EtbFilterleiste.tsx` nennt die Vorbedingung wörtlich: wer die Leiste
kontrolliert oder ihren Stand aus der URL zurückliest, braucht **zuerst** einen Test über
die Zeitachse. Der Fehlermodus der Umkehr von `alsBackendZeit` ist eine **stille**
Verschiebung um den Zonenversatz — kein roter Test, kein Fehlerbild, nur ein falscher
Zeitraum in der Führungsunterlage.

**Files:**
- Create: `frontend/src/etb/filterZeit.ts`
- Create: `frontend/src/etb/filterZeit.test.ts`
- Modify: `frontend/src/routing/deeplinks.ts:169-177`
- Test: `frontend/src/routing/deeplinks.test.ts`

**Interfaces:**
- Produces: `alsBackendZeit(d: dayjs.Dayjs): string` (UTC, `YYYY-MM-DD HH:mm:ss`),
  `alsOrtszeit(s: string | undefined): dayjs.Dayjs | undefined`,
  `etbPfad(einsatzId: number, opts: { eintrag?, neu?, q?, typ?, von?, bis? }): string`,
  `parseEtbFilter(params: URLSearchParams): EtbFilterWerte`.
- Consumes: `EtbFilterWerte` aus `api/etb.ts`, `EtbTyp` aus `api/types.ts`.

- [ ] **Step 1: Failing test für die Zeitkonversion**

```ts
// frontend/src/etb/filterZeit.test.ts
import dayjs from 'dayjs';
import { describe, expect, it } from 'vitest';
import { alsBackendZeit, alsOrtszeit } from './filterZeit';

describe('filterZeit', () => {
  it('Round-Trip erhält den Zeitpunkt — auch über die Sommerzeit-Grenze', () => {
    // Beide Seiten der mitteleuropäischen Umstellung 2026: 29.03. und 25.10.
    for (const wire of ['2026-03-29T00:30:00Z', '2026-03-29T01:30:00Z',
                        '2026-10-25T00:30:00Z', '2026-10-25T01:30:00Z']) {
      const s = dayjs(wire).utc().format('YYYY-MM-DD HH:mm:ss');
      const zurueck = alsOrtszeit(s);
      expect(zurueck).toBeDefined();
      expect(alsBackendZeit(zurueck!)).toBe(s);
      // Die ANGEZEIGTE Ortszeit ist die zweite Hälfte: ein Round-Trip, der
      // beide Richtungen um denselben Betrag verschiebt, wäre sonst grün.
      expect(zurueck!.valueOf()).toBe(dayjs(wire).valueOf());
    }
  });

  it('leere und unbrauchbare Eingaben ergeben undefined, nicht Invalid Date', () => {
    expect(alsOrtszeit(undefined)).toBeUndefined();
    expect(alsOrtszeit('')).toBeUndefined();
    expect(alsOrtszeit('kein-datum')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Test laufen lassen, FAIL erwarten**

Run: `mise exec pnpm@11.10.0 -- pnpm -C $FE vitest run src/etb/filterZeit.test.ts`
Expected: FAIL — `Failed to resolve import "./filterZeit"`.

- [ ] **Step 3: `filterZeit.ts` schreiben**

```ts
// frontend/src/etb/filterZeit.ts
import dayjs from 'dayjs';

/**
 * Zeitachse der ETB-Filterleiste, beide Richtungen an EINER Stelle.
 *
 * Die Hinrichtung stand bis LFH-342 als lokale Funktion in `EtbFilterleiste.tsx`; die
 * Rückrichtung gab es nicht, und ihr Fehlen war der benannte Grund, die Leiste
 * unkontrolliert zu lassen. Ihr Fehlermodus ist eine STILLE Verschiebung um den
 * Zonenversatz — deshalb liegt sie hier als reines Modul mit eigenem Test über die
 * Sommerzeit-Grenze, nicht als Einzeiler an der Aufrufstelle.
 */

/** Wandelt einen dayjs-Zeitpunkt ins SQLite-/Backend-Format (UTC). */
export function alsBackendZeit(d: dayjs.Dayjs): string {
  return d.utc().format('YYYY-MM-DD HH:mm:ss');
}

/**
 * Umkehr: der Wire-String ist UTC OHNE Zonenkennung. `dayjs(s)` läse ihn als Ortszeit
 * und verschöbe den Zeitpunkt um den Versatz — deshalb `dayjs.utc(s)` und erst danach
 * `.local()` für die Anzeige.
 */
export function alsOrtszeit(s: string | undefined): dayjs.Dayjs | undefined {
  if (!s) return undefined;
  const d = dayjs.utc(s, 'YYYY-MM-DD HH:mm:ss', true);
  return d.isValid() ? d.local() : undefined;
}
```

- [ ] **Step 4: Test laufen lassen, PASS erwarten**

Run: `mise exec pnpm@11.10.0 -- pnpm -C $FE vitest run src/etb/filterZeit.test.ts`
Expected: PASS (2 Tests). Falls `dayjs.utc` fehlt: das Plugin wird in `main.tsx` global
geladen; im Test `dayjs.extend(utc)` + `dayjs.extend(customParseFormat)` im Modul selbst
sicherstellen und die Erweiterung dort einmalig vornehmen.

- [ ] **Step 5: Failing test für `etbPfad` und `parseEtbFilter`**

```ts
// in frontend/src/routing/deeplinks.test.ts ergänzen
import { etbPfad, parseEtbFilter } from './deeplinks';

describe('etbPfad mit Filterachse (LFH-342 · C7)', () => {
  it('baut alle vier Filterwerte in die Query', () => {
    expect(etbPfad(7, { q: 'brand', typ: 'meldung', von: '2026-08-21 06:00:00' }))
      .toBe('/einsaetze/7/etb?q=brand&typ=meldung&von=2026-08-21%2006%3A00%3A00');
  });

  it('lässt leere Werte weg statt leere Parameter zu schreiben', () => {
    expect(etbPfad(7, { q: '', typ: undefined })).toBe('/einsaetze/7/etb');
  });

  it('verträgt sich mit den Bestandsparametern', () => {
    expect(etbPfad(7, { neu: true })).toBe('/einsaetze/7/etb?neu=1');
    expect(etbPfad(7, { eintrag: 12 })).toBe('/einsaetze/7/etb?eintrag=12');
  });

  it('parseEtbFilter liest zurück, was etbPfad geschrieben hat', () => {
    const pfad = etbPfad(7, { q: 'br and', typ: 'meldung', von: '2026-08-21 06:00:00' });
    const params = new URLSearchParams(pfad.split('?')[1]);
    expect(parseEtbFilter(params)).toEqual({
      q: 'br and', typ: 'meldung', von: '2026-08-21 06:00:00',
    });
  });

  it('parseEtbFilter verwirft einen unbekannten Typ GANZ statt halb zu füllen', () => {
    const params = new URLSearchParams('q=x&typ=quatsch');
    expect(parseEtbFilter(params)).toEqual({ q: 'x' });
  });
});
```

- [ ] **Step 6: Test laufen lassen, FAIL erwarten**

Run: `mise exec pnpm@11.10.0 -- pnpm -C $FE vitest run src/routing/deeplinks.test.ts`
Expected: FAIL — `parseEtbFilter is not a function` bzw. Query fehlt.

- [ ] **Step 7: `deeplinks.ts` erweitern**

`mitQuery` kodiert heute **nicht** (`${k}=${v}`). Ein Suchbegriff mit `&`, `=` oder
Leerzeichen zerlegte die Query. Deshalb bekommt `mitQuery` `encodeURIComponent` auf den
Wert — das ist eine Verhaltensänderung für alle Builder und wird eigens gepinnt: für die
Bestandsparameter (Zahlen, `1`) ist die Kodierung die Identität, ein Bestandstest ändert
sich also nicht.

```ts
function mitQuery(pfad: string, params: Record<string, string | number | undefined>): string {
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    // Kodiert seit LFH-342: der ETB-Suchbegriff ist Freitext und darf `&`/`=`/Leerzeichen
    // tragen. Für die Bestandswerte (Zahlen, `1`) ist die Kodierung die Identität.
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');
  return qs ? `${pfad}?${qs}` : pfad;
}

/** Die Typwerte, die `parseEtbFilter` durchlässt. Quelle ist `etbTyp` aus `theme/statusFarben`. */
const ETB_TYPEN = Object.keys(etbTyp) as EtbTyp[];

export function etbPfad(
  einsatzId: number,
  opts: {
    eintrag?: number; neu?: boolean;
    q?: string; typ?: EtbTyp; von?: string; bis?: string;
  } = {},
): string {
  return mitQuery(einsatzModulPfad(einsatzId, 'etb'), {
    eintrag: opts.eintrag,
    neu: opts.neu ? 1 : undefined,
    q: opts.q,
    typ: opts.typ,
    von: opts.von,
    bis: opts.bis,
  });
}

/**
 * Umkehr von {@link etbPfad} für die Filterachse. Verwirft Unbrauchbares GANZ statt halb
 * zu füllen — dieselbe Regel wie bei `parsePlatzierenAuftrag` (LFH-340 · C5): ein
 * unbekannter Typ ergibt keinen Filter auf diesen Typ, sondern gar keinen.
 */
export function parseEtbFilter(params: URLSearchParams): EtbFilterWerte {
  const werte: EtbFilterWerte = {};
  const q = params.get('q');
  if (q) werte.q = q;
  const typ = params.get('typ');
  if (typ && (ETB_TYPEN as string[]).includes(typ)) werte.typ = typ as EtbTyp;
  const von = params.get('von');
  if (von) werte.von = von;
  const bis = params.get('bis');
  if (bis) werte.bis = bis;
  return werte;
}
```

- [ ] **Step 8: Beide Suiten laufen lassen, PASS erwarten**

Run: `mise exec pnpm@11.10.0 -- pnpm -C $FE vitest run src/routing/deeplinks.test.ts src/etb/filterZeit.test.ts`
Expected: PASS. Danach die volle Suite, weil `mitQuery` alle Builder trägt:
`mise exec pnpm@11.10.0 -- pnpm -C $FE vitest run src/routing`

- [ ] **Step 9: `EtbFilterleiste` auf das neue Modul umstellen (reiner Import-Tausch)**

Die lokale `alsBackendZeit` in `EtbFilterleiste.tsx:41-43` löschen und aus
`./filterZeit` importieren. Der Dateikopf-Absatz „Warum nicht kontrolliert" wird in T2
fortgeschrieben, hier bleibt er unangetastet.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/etb/filterZeit.ts frontend/src/etb/filterZeit.test.ts \
        frontend/src/routing/deeplinks.ts frontend/src/routing/deeplinks.test.ts \
        frontend/src/etb/EtbFilterleiste.tsx
git commit -m "feat(lfh-342): traegt die ETB-Filterachse in beide Richtungen"
```

---

### Task 2: Volltextsuche entprellen und den Filter in die URL heben (M80)

Zwölf Zeichen im Volltextfeld erzeugen heute zwölf Query-Keys, weil `onChange` direkt
`aktualisiere` ruft. Typ, von und bis dürfen sofort greifen — sie ändern sich nicht
zeichenweise.

**Files:**
- Modify: `frontend/src/etb/EtbFilterleiste.tsx`
- Modify: `frontend/src/pages/EtbPage.tsx:30-50`
- Test: `frontend/src/etb/EtbFilterleiste.test.tsx`, `frontend/src/pages/EtbPage.test.tsx`

**Interfaces:**
- Consumes: `parseEtbFilter`, `etbPfad` aus T1.
- Produces: `EtbFilterleiste` nimmt zusätzlich `startWerte?: EtbFilterWerte`.

- [ ] **Step 1: Failing test für die Entprellung**

```tsx
// frontend/src/etb/EtbFilterleiste.test.tsx
it('entprellt die Volltextsuche — 12 Zeichen ergeben höchstens 2 Meldungen', async () => {
  vi.useFakeTimers();
  const onChange = vi.fn();
  render(<EtbFilterleiste onChange={onChange} />);
  const feld = screen.getByPlaceholderText('Volltextsuche');
  for (const z of 'brandausbruch') {
    fireEvent.change(feld, { target: { value: feld.getAttribute('value') + z } });
  }
  expect(onChange).not.toHaveBeenCalled();     // vor Ablauf: gar nichts
  await act(async () => { vi.advanceTimersByTime(300); });
  expect(onChange.mock.calls.length).toBeLessThanOrEqual(2);
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'brandausbruch' }));
  vi.useRealTimers();
});

it('Typ greift SOFORT, ohne auf die Entprellung zu warten', async () => {
  vi.useFakeTimers();
  const onChange = vi.fn();
  render(<EtbFilterleiste onChange={onChange} />);
  await waehleSelectOption('Typ', 'Meldung');   // Projekt-Helfer aus test/utils
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ typ: 'meldung' }));
  vi.useRealTimers();
});
```

- [ ] **Step 2: Test laufen lassen, FAIL erwarten**

Expected: FAIL — `onChange` feuert 13-mal statt ≤ 2, weil es keine Entprellung gibt.

- [ ] **Step 3: Entprellung und Hydrierung in `EtbFilterleiste.tsx`**

Der Timer hängt an einem `useRef`, wird bei jedem Tastendruck neu gesetzt und im
Cleanup gelöscht. **`q` wird im lokalen Zustand sofort geführt** (das Feld bleibt
reaktionsschnell) und nur die Meldung nach außen verzögert — sonst hinge der sichtbare
Text an der Entprellung. Die Hydrierung nimmt `startWerte` als `defaultValue`:

```tsx
const ENTPRELLUNG_MS = 300;

export default function EtbFilterleiste({ onChange, startWerte }: Props) {
  const [werte, setWerte] = useState<EtbFilterWerte>(startWerte ?? {});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function aktualisiere(teil: Partial<EtbFilterWerte>, verzoegert = false) {
    const neu = { ...werte, ...teil };
    (Object.keys(neu) as (keyof EtbFilterWerte)[]).forEach((k) => {
      if (neu[k] === undefined || neu[k] === '') delete neu[k];
    });
    setWerte(neu);
    if (timer.current) clearTimeout(timer.current);
    if (verzoegert) timer.current = setTimeout(() => onChange(neu), ENTPRELLUNG_MS);
    else onChange(neu);
  }
  // …
  <Input.Search
    defaultValue={startWerte?.q}
    onChange={(e) => aktualisiere({ q: e.target.value }, true)}
  />
  <Select defaultValue={startWerte?.typ} onChange={(v?: EtbTyp) => aktualisiere({ typ: v })} />
  <DatePicker defaultValue={alsOrtszeit(startWerte?.von)}
    onChange={(d) => aktualisiere({ von: d ? alsBackendZeit(d) : undefined })} />
  <DatePicker defaultValue={alsOrtszeit(startWerte?.bis)}
    onChange={(d) => aktualisiere({ bis: d ? alsBackendZeit(d) : undefined })} />
```

Der Dateikopf-Absatz „Warum nicht kontrolliert" wird um einen Satz ergänzt: die Umkehr
existiert jetzt (`etb/filterZeit.ts`, mit DST-Test), die Leiste bleibt trotzdem
unkontrolliert und hydriert **einmalig** über `defaultValue` — das ist die billigere
Hälfte ohne laufende Zwei-Wege-Synchronisation und ohne Drift.

- [ ] **Step 4: Test laufen lassen, PASS erwarten**

- [ ] **Step 5: Failing test für den URL-Durchstich in `EtbPage`**

```tsx
it('hebt den Filter in die URL und liest ihn beim Kaltstart zurück', async () => {
  const { router } = rendereMitRoute('/einsaetze/1/etb?typ=meldung&q=brand');
  // Kaltstart: die Query-Funktion sieht den Filter, ohne dass jemand tippt.
  await waitFor(() => expect(listeEtbSpy).toHaveBeenCalledWith(1,
    expect.objectContaining({ typ: 'meldung', q: 'brand' })));
  // Und die Leiste zeigt ihn (Hydrierung, nicht nur der Query-Key).
  expect(screen.getByPlaceholderText('Volltextsuche')).toHaveValue('brand');
});

it('Filter zurücksetzen räumt auch die URL', async () => {
  const { router } = rendereMitRoute('/einsaetze/1/etb?typ=meldung');
  await klick('Filter zurücksetzen');
  expect(router.state.location.search).toBe('');
});
```

- [ ] **Step 6: Test laufen lassen, FAIL erwarten**

- [ ] **Step 7: `EtbPage` an die URL hängen**

`useState<EtbFilterWerte>({})` wird durch eine Ableitung aus `searchParams` ersetzt; der
Filterwechsel schreibt über `navigate(etbPfad(einsatzId, {...}), { replace: true })`.
`replace`, damit eine Suche nicht dreißig History-Einträge hinterlässt.

Zwei Riegel, beide notwendig:
- **Der `?neu=1`- und der `?eintrag=`-Effekt räumen ihren Parameter** (`searchParams.delete`)
  und dürfen den Filter dabei nicht mitnehmen — sie arbeiten weiter auf `searchParams`,
  nicht auf einem frisch gebauten Pfad.
- **`filterAktiv`** bleibt `Object.keys(filter).length > 0`, damit der leer-mit-Filter-Zweig
  aus B3 unverändert greift.

- [ ] **Step 8: Test laufen lassen, PASS erwarten; danach die ETB-Suiten**

Run: `mise exec pnpm@11.10.0 -- pnpm -C $FE vitest run src/etb src/pages/EtbPage.test.tsx`

- [ ] **Step 9: Commit**

```bash
git commit -am "feat(lfh-342): entprellt die ETB-Suche und haengt den Filter an die URL"
```

---

### Task 3: Wiedervorlage sinnvoll vorbelegen (N22)

`faellig: dayjs()` ist der einzige nie gemeinte Wert — eine Wiedervorlage auf „jetzt" ist
sofort fällig.

**Files:**
- Modify: `frontend/src/etb/WiedervorlageModal.tsx:71,78`
- Test: `frontend/src/etb/WiedervorlageModal.test.tsx` **(neu)**

- [ ] **Step 1: Failing test**

```tsx
it('belegt die Fälligkeit mit +30 min vor, nicht mit jetzt', () => {
  vi.setSystemTime(new Date('2026-08-21T10:00:00Z'));
  render(<WiedervorlageModal einsatzId={1} eintrag={EINTRAG} onClose={vi.fn()} />);
  expect(screen.getByLabelText('Fällig am')).toHaveValue(
    dayjs('2026-08-21T10:30:00Z').format('YYYY-MM-DD HH:mm'));
});

it('die Schnellwahl setzt die Fälligkeit, ohne den DatePicker zu ersetzen', async () => {
  vi.setSystemTime(new Date('2026-08-21T10:00:00Z'));
  render(<WiedervorlageModal einsatzId={1} eintrag={EINTRAG} onClose={vi.fn()} />);
  await userEvent.click(screen.getByRole('button', { name: '+2 h' }));
  expect(screen.getByLabelText('Fällig am')).toHaveValue(
    dayjs('2026-08-21T12:00:00Z').format('YYYY-MM-DD HH:mm'));
  // Der freie Fall bleibt: das Feld ist weiterhin da und bedienbar.
  expect(screen.getByLabelText('Fällig am')).toBeEnabled();
});
```

- [ ] **Step 2: FAIL erwarten** — heute steht dort die aktuelle Zeit.

- [ ] **Step 3: Implementierung**

```tsx
const SCHNELLWAHL = [
  { label: '+15 min', minuten: 15 },
  { label: '+30 min', minuten: 30 },
  { label: '+1 h', minuten: 60 },
  { label: '+2 h', minuten: 120 },
] as const;

// initialValues: { titel: …, faellig: dayjs().add(30, 'minute') }
```

Die Schnellwahl steht als eigene Zeile **über** dem `DatePicker` innerhalb desselben
`Form.Item`-Blocks und setzt `form.setFieldValue('faellig', dayjs().add(m, 'minute'))`.
Es sind **echte antd-`Button`** (`size` nicht gesetzt, Trefffläche aus `controlHeight`) —
kein gestyltes `<span onClick>`, das die zwei Angaben aus LFH-365 schuldete. Das Feldbudget
bleibt bei **drei** Feldern (LFH-19): die Schnellwahl ist eine Vorbelegung desselben
Feldes, kein viertes.

„Nächste Lagebesprechung" aus dem Ticket entfällt **mit Begründung**: es gibt im Frontend
keine Quelle für den nächsten Besprechungstermin (`grep -rn "lagebesprechung" frontend/src`
= 0 Treffer). Ein Chip, der raten müsste, wäre eine falsche Tatsachenbehauptung in einer
beweissichernden Anwendung. Das wird als Nachzugsticket erfasst (T9).

- [ ] **Step 4: PASS erwarten**
- [ ] **Step 5: Commit**

```bash
git commit -am "feat(lfh-342): belegt die Wiedervorlage mit +30 min und Schnellwahl vor"
```

---

### Task 4: `an` aus dem Einsatz-/Benutzerkontext vorbelegen (H61-Rest)

**Files:**
- Modify: `frontend/src/etb/Schnellerfassung.tsx`
- Test: `frontend/src/etb/Schnellerfassung.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
it('belegt „an" beim ersten Öffnen mit der eigenen Führungsstelle vor', () => {
  rendereSchnellerfassung({ benutzer: { name: 'ELtr', fuehrungsstelle: 'ELW 1' } });
  expect(screen.getByText(/An:/)).toHaveTextContent('ELW 1');
});

it('die Vorbelegung ist löschbar und kommt nicht zurück', async () => {
  rendereSchnellerfassung({ benutzer: { fuehrungsstelle: 'ELW 1' } });
  await entferneChip('An');
  expect(screen.queryByText(/An:/)).not.toBeInTheDocument();
  // Kein Wiederauftauchen beim nächsten Render — die Vorbelegung ist eine
  // Anfangsbelegung, kein laufender Zwang.
  await userEvent.type(screen.getByRole('textbox'), 'x');
  expect(screen.queryByText(/An:/)).not.toBeInTheDocument();
});

it('ein vorhandener Entwurfswert schlägt die Vorbelegung', () => {
  rendereSchnellerfassung({
    benutzer: { fuehrungsstelle: 'ELW 1' },
    initialWerte: { inhalt: '', typ: 'meldung', metadaten: { an: 'Abschnitt Nord' } },
  });
  expect(screen.getByText(/An:/)).toHaveTextContent('Abschnitt Nord');
});
```

- [ ] **Step 2: FAIL erwarten**

- [ ] **Step 3: Quelle bestimmen und implementieren**

Zuerst messen, was der Kontext überhaupt hergibt:
`grep -n "fuehrungsstelle\|dienststelle\|einheit" frontend/src/api/types.ts | head`.
Trägt weder `BenutzerAnzeige` noch `EinsatzAnzeige` eine Führungsstelle, ist die
Vorbelegung **nicht baubar** — dann wird der Punkt als Backend-Nachzug erfasst (T9) und
hier nichts erfunden. Trägt sie einer, gilt:

```tsx
const [metadaten, setMetadaten] = useState<MetadatenWerte>(
  // Anfangsbelegung, kein laufender Zwang: der Entwurfswert schlägt sie, und ein
  // entfernter Chip bleibt entfernt (der Zustand wird nach dem Mount nicht mehr
  // aus dem Kontext nachgezogen).
  initialWerte?.metadaten ?? (eigeneStelle ? { an: eigeneStelle } : {}),
);
```

Die Zusicherung „bleibt entfernt" ist die Hälfte, die den Fehler fängt: eine Vorbelegung
in einem Effekt mit `[einsatz, benutzer]` in den Deps setzte den Chip bei jedem
Kontext-Re-Render zurück.

- [ ] **Step 4: PASS erwarten**
- [ ] **Step 5: Commit**

```bash
git commit -am "feat(lfh-342): belegt den An-Chip aus dem Einsatzkontext vor"
```

---

### Task 5: Zeilentyp der Chronologie — diskriminiertes Union

Die Chronologie trägt ab T6 zwei Sorten Zeilen. Der Typ kommt **vor** dem Rendern, sonst
wächst in jeder der sieben Spalten ein `if`.

**Files:**
- Create: `frontend/src/etb/etbZeile.ts`
- Create: `frontend/src/etb/etbZeile.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type EtbZeile =
    | { art: 'eintrag'; schluessel: string; eintrag: EtbEintragAnzeige }
    | { art: 'ausstehend'; schluessel: string; puffer: AusstehenderEintrag }
    | { art: 'abgelehnt'; schluessel: string; puffer: AbgelehnterEintrag };
  export function baueZeilen(args: {
    eintraege: readonly EtbEintragAnzeige[];
    ausstehend: readonly AusstehenderEintrag[];
    abgelehnt: readonly AbgelehnterEintrag[];
  }): EtbZeile[];
  ```

- [ ] **Step 1: Failing test**

```ts
it('stellt abgelehnte vor ausstehende vor die gesendeten Einträge', () => {
  const zeilen = baueZeilen({ eintraege: [E1, E2], ausstehend: [A1], abgelehnt: [X1] });
  expect(zeilen.map((z) => z.art)).toEqual(['abgelehnt', 'ausstehend', 'eintrag', 'eintrag']);
});

it('vergibt gepufferten Zeilen einen eigenen Schlüsselraum', () => {
  // Die DB-`id` eines gepufferten Eintrags ist die Queue-id und kollidiert mit der
  // `id` eines echten Eintrags — das `data-row-key`-Highlight träfe sonst die falsche Zeile.
  const zeilen = baueZeilen({ eintraege: [{ ...E1, id: 3 }], ausstehend: [{ ...A1, id: 3 }],
                              abgelehnt: [] });
  expect(new Set(zeilen.map((z) => z.schluessel)).size).toBe(2);
  expect(zeilen.find((z) => z.art === 'ausstehend')!.schluessel).toBe('ausstehend-3');
});

it('kommt ohne id aus — die Queue vergibt sie erst beim Schreiben', () => {
  const zeilen = baueZeilen({ eintraege: [], ausstehend: [{ ...A1, id: undefined }],
                              abgelehnt: [] });
  expect(zeilen[0].schluessel).toBeTruthy();
});
```

- [ ] **Step 2: FAIL erwarten**
- [ ] **Step 3: `etbZeile.ts` schreiben** (Schlüssel: `ausstehend-${id ?? erstellt_at}`,
      `abgelehnt-${id ?? abgelehnt_at}`, `eintrag-${id}`)
- [ ] **Step 4: PASS erwarten**
- [ ] **Step 5: Commit**

```bash
git commit -am "feat(lfh-342): fuehrt den Zeilentyp der ETB-Chronologie ein"
```

---

### Task 6: Chronologie auf `Datensicht` (H59, H64) und Offline-Zeilen einspeisen (M82)

Der größte Posten. Der Meldungstext bekommt im Fükw ≥50 % der Contentbreite, und unter
`md` löst sich die Tabelle in Ereigniszeilen-Karten auf.

**Files:**
- Modify: `frontend/src/etb/EtbTabelle.tsx` (Vollumbau)
- Modify: `frontend/src/pages/EtbPage.tsx` (Zeilen einspeisen, Banner bleibt)
- Modify: `frontend/src/components/datensicht.guard.test.ts:179,792`
- Modify: `frontend/src/components/katalogTabelle.guard.test.ts:88-90` (Kommentar)
- Test: `frontend/src/etb/EtbTabelle.test.tsx`

**Interfaces:**
- Consumes: `EtbZeile`, `baueZeilen` aus T5; `Datensicht`, `spaltenFuer`,
  `Kartenplan` aus `components/Datensicht.tsx`.
- Produces: `EtbTabelle` nimmt `zeilen: readonly EtbZeile[]` statt
  `eintraege: EtbEintragAnzeige[]`, zusätzlich `onErneutSenden`/`onVerwerfen`.

**Entscheidungen, die vor dem Code feststehen:**

1. **`form="auto"`, Umbruch bei `md`, nicht bei `lg`.** Die Formachse der `Datensicht`
   kennt genau einen Umbruchpunkt (`Datensicht.tsx:1049`). Das Ticket sagt „ab lg" — der
   Bereich zwischen `md` und `lg` ist von keinem Akzeptanzkriterium adressiert (die
   Zusicherungen liegen bei 390 px und 1366 px), und eine zweite Umbruchachse im Primitiv
   wäre eine Änderung an allen zehn Konsumenten für einen ungeprüften Zwischenbereich.
   **AK-Korrektur, in der Prüfliste vermerkt.**
2. **Der Kartenzweig ist ein Eigenbau** (`art: 'eigen'`, erster Eintrag in
   `KARTEN_EIGENBAU`). Begründung, die der Guard verlangt: der Plan-Modus trägt Titel +
   Status + **höchstens drei** Sekundärfelder + **genau eine** Primäraktion. Die
   Ereigniszeile braucht fünf Kopffelder (Nr. · Zeit · Typ · Von→An · Erfasser), einen
   Markdown-Block über die volle Breite und **drei** Zeilenaktionen. Im Plan-Modus fielen
   Berichtigen/Wiedervorlage/Auftrag unter `md` ersatzlos weg — an einer beweissichernden
   Fläche ist das kein hinnehmbarer Funktionsverlust, und die Sekundärfelder rendern als
   nebeneinanderliegende Etikett/Wert-Paare (`Datensicht.tsx:1391-1405`), also gerade
   nicht als Volltextblock.
3. **`suche` der `Datensicht` bleibt AUS.** Die Volltextsuche des ETB ist serverseitig und
   arbeitet über den ganzen Bestand; die clientseitige Suche des Primitivs sähe nur das
   geladene 100-Zeilen-Fenster und behauptete Vollständigkeit, die sie nicht hat.
4. **`standardSortierung={null}`** — Serverordnung (neueste zuerst) unangetastet.
5. **`gruppen`** nach Tag/Stunde aus `ereigniszeit`. Im Kartenzweig echte Gruppenköpfe, im
   Tabellenzweig Zählstreifen in der Werkzeugzeile — das ist die dokumentierte
   Zweigdifferenz des Primitivs, kein Mangel.
6. **`zufluss`** bleibt beim Default `'sammelbanner'` (Kriterium 12, WCAG 3.2.5).
7. **Spaltenbudget für die ≥50-%-Zusicherung.** Contentbreite bei 1366 px mit geöffnetem
   ModulPanel: **1033 px** (Ticket-Messung). Spalten heute: Nr. 64 + Zeit 180 + Typ 130 +
   Von→An 160 + Inhalt (Rest) + Erfasser 120 + Aktion 96. `Von → An` und `Erfasser`
   bekommen `abBreite: 'xxl'` (antd xxl = 1600 px), sind bei 1366 also aus und über den
   Spaltenschalter einblendbar — der Zähler zeigt sie als ausgeblendet, weil `abBreite`
   und Handauswahl durch **dieselbe** Funktion laufen. Rest für den Inhalt:
   1033 − (64 + 180 + 130 + 96) = **563 px = 54,5 %** `[abgeleitet]`.

- [ ] **Step 1: Failing test — die vier Zusicherungen des Umbaus**

```tsx
it('rendert unter md Karten statt einer Tabelle', () => {
  setzeViewport(390);
  render(<EtbTabelle zeilen={ZEILEN} einsatzId={1} />);
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(screen.getAllByTestId('etb-ereigniszeile').length).toBe(ZEILEN.length);
});

it('blendet Von→An und Erfasser bei 1366 px aus und zählt sie', () => {
  setzeViewport(1366);
  render(<EtbTabelle zeilen={ZEILEN} einsatzId={1} />);
  expect(screen.queryByText('Von → An')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Spalten/ })).toHaveTextContent('2');
});

it('zeigt eine ausstehende Zeile in der Chronologie, nicht nur im Banner', () => {
  render(<EtbTabelle zeilen={[AUSSTEHEND, ...ZEILEN]} einsatzId={1} />);
  const zeile = screen.getByTestId('etb-zeile-ausstehend-1');
  expect(zeile).toHaveTextContent('wird gesendet');
  // Die Negativhälfte: keine laufende Nummer, denn sie gibt es noch nicht.
  expect(zeile).not.toHaveTextContent(/^#\d/);
});

it('bietet an einer abgelehnten Zeile beide Auswege an', async () => {
  const onErneut = vi.fn(); const onVerwerfen = vi.fn();
  render(<EtbTabelle zeilen={[ABGELEHNT]} einsatzId={1}
                     onErneutSenden={onErneut} onVerwerfen={onVerwerfen} />);
  await userEvent.click(screen.getByRole('button', { name: /Erneut senden/ }));
  expect(onErneut).toHaveBeenCalledWith(ABGELEHNT.puffer);
});
```

- [ ] **Step 2: FAIL erwarten** (heute rendert die Komponente immer eine Tabelle und kennt
      `zeilen` nicht)

- [ ] **Step 3: Spalten über `spaltenFuer<EtbZeile>()` definieren**

Die Marke `spaltenFuer` ist Pflicht (`datensicht.guard.test.ts`) — eine annotierte
Spaltenliste weitete `K` auf `string`, und der Kartenplan nähme danach jeden Tippfehler
ohne Meldung an. Jede Spalte bekommt `etikett` (Kartenzweig) und, wo sinnvoll,
`sortWert`. Der Diskriminator `art` wird in jeder `render`-Funktion abgefragt — eine
gepufferte Zeile hat keine `lfd_nr`, keinen `erfasser_name` und keine Backlinks.

- [ ] **Step 4: Kartenzweig als `art: 'eigen'` bauen**

Aufbau je Eintrag: eine `<div>`-Kopfzeile (`display: flex`, `flexWrap`, `gap:
token.marginXS`) mit Nr./Zeit/`StatusTag`/Von→An/Erfasser, darunter der `Markdown`-Block
über die volle Breite, darunter die Aktionszeile mit **demselben** Dropdown wie im
Tabellenzweig — die Aktionsliste wird als gemeinsame Funktion `zeilenAktionen(zeile)`
gezogen, damit beide Zweige nicht auseinanderlaufen. Das Wurzelelement trägt
`data-testid="etb-ereigniszeile"`, gepufferte Zeilen zusätzlich
`data-testid={"etb-zeile-" + zeile.schluessel}`.

Die Klasse für gepufferte Zeilen kommt über `zeilenKlasse` und gilt damit in **beiden**
Zweigen. Gestrichelter Rahmen und Farbe stehen in `index.css` neben
`.etb-berichtigung` (`index.css:13-30`) und nehmen Rollen aus `theme/rollen.css`, keine
Hexwerte — `.etb-erfassung-sticky` hat vier hartkodierte Werte, das ist der Bestandsbefund
LFH-375 und wird hier nicht vermehrt.

- [ ] **Step 5: `EtbPage` speist die Zeilen ein, das Banner bleibt Zusammenfassung**

`baueZeilen({ eintraege, ausstehend, abgelehnt })` statt `eintraege`. Die beiden Alerts
bleiben stehen — sie sind die **Zusammenfassung**, die Zeilen sind der Ort. Beides
zusammen ist die Zusicherung; ein Test, der nur die Zeile prüft, ließe das Entfernen des
Banners unbemerkt durch:

```tsx
it('das Banner fasst weiter zusammen, während die Zeile in der Chronologie steht', () => {
  rendereEtbPageMitPuffer([A1, A2]);
  expect(screen.getByText(/2 Eintrag\/Einträge werden gesendet/)).toBeInTheDocument();
  expect(screen.getAllByTestId(/etb-zeile-ausstehend-/).length).toBe(2);
});
```

- [ ] **Step 6: Guards nachziehen**

```ts
// components/datensicht.guard.test.ts
const KARTEN_EIGENBAU: string[] = ['/src/etb/EtbTabelle.tsx'];
// … und der Längenpin:
expect(KARTEN_EIGENBAU).toHaveLength(1);
```
Der Kommentar über `KARTEN_EIGENBAU` bekommt die Begründung aus Entscheidung 2 —
der Guard verlangt sie ausdrücklich („Wer den ersten einträgt, muss begründen, warum der
Plan-Modus nicht reicht"). `KONSUMENTEN` bekommt `/src/etb/EtbTabelle.tsx`.

In `katalogTabelle.guard.test.ts:88-90` wird der Absatz über die „neunzehnte Konsumentin"
fortgeschrieben: das ETB ist **nach oben** herausgefallen wie `SchaedenPage` in C5 — es
bindet `KatalogTabelle` nicht mehr selbst ein, sondern läuft über `Datensicht`. Der
Restposten LFH-330 · AP8 ist damit erledigt, nicht offen.

- [ ] **Step 7: Volle Frontend-Suite laufen lassen**

Run: `mise exec pnpm@11.10.0 -- pnpm -C $FE test`
Expected: alles grün. `EtbTabelle.test.tsx` trägt acht Bestandsfälle — sie ziehen auf den
neuen Zeilentyp um, werden aber **nicht** in ihrer Aussage verändert.

- [ ] **Step 8: Commit**

```bash
git commit -am "feat(lfh-342): baut die ETB-Chronologie auf das Datensicht-Primitiv um"
```

---

### Task 7: Befehlsentwurf gegen Verlust sichern (N18)

**Vorprüfung:** Das Ticket verbietet Parallelbetrieb auf `BefehlDetailPage.tsx` (auch
C8 · M73). C8 ist **LFH-343** und steht auf `backlog`; `git log --all --grep 'LFH-343'`
liefert nichts. Kein Konflikt — die Datei wird angefasst.

**Files:**
- Modify: `frontend/src/pages/BefehlDetailPage.tsx:44-50,61,137,179,201-203`
- Test: `frontend/src/pages/BefehlDetailPage.test.tsx`

- [ ] **Step 1: Failing test — der SSE-Refetch darf berührte Felder nicht überschreiben**

```tsx
it('der Refetch überschreibt ein berührtes Feld NICHT', async () => {
  const { rerender } = rendereBefehl({ titel: 'Alt', abschnitte: [] });
  await userEvent.clear(screen.getByLabelText('Titel'));
  await userEvent.type(screen.getByLabelText('Titel'), 'Meine Fassung');
  // SSE-Invalidierung liefert den Serverstand nach.
  liefereBefehl({ titel: 'Fremde Fassung', abschnitte: [] });
  await waitFor(() => expect(screen.getByLabelText('Titel')).toHaveValue('Meine Fassung'));
});

it('ein UNBERÜHRTES Formular übernimmt den Serverstand weiterhin', async () => {
  rendereBefehl({ titel: 'Alt', abschnitte: [] });
  liefereBefehl({ titel: 'Neu vom Server', abschnitte: [] });
  await waitFor(() => expect(screen.getByLabelText('Titel')).toHaveValue('Neu vom Server'));
});
```

Die zweite Hälfte ist die, die den Fehler fängt: ein Riegel, der **immer** blockiert,
machte die Seite still veraltet und wäre mit dem ersten Test allein nicht zu unterscheiden.

- [ ] **Step 2: FAIL erwarten** — der Effekt in `:44-50` ruft `setFieldsValue`
      bedingungslos.

- [ ] **Step 3: Riegel, Autosave und Anzeige**

```tsx
useEffect(() => {
  if (!befehlQuery.data) return;
  // Der Refetch (SSE-Invalidierung) darf eine begonnene Fassung nicht wegräumen.
  // `isFieldsTouched()` ist die Grenze: unberührt = die Seite zeigt den Serverstand.
  if (form.isFieldsTouched()) return;
  const werte: Record<string, string> = { titel: befehlQuery.data.titel };
  for (const a of befehlQuery.data.abschnitte) werte[a.schluessel] = a.text;
  form.setFieldsValue(werte);
}, [befehlQuery.data, form]);
```

Autosave: ein Intervall von 30 s **und** `onBlur` am Formular, beide über dieselbe
`speichern`-Funktion, beide nur bei `istEntwurf && darfSchreiben && form.isFieldsTouched()`.
Der Zeitstempel („zuletzt gespeichert 14:32") steht neben dem Speichern-Knopf und kommt aus
`ZeitAnzeige`, nicht aus einem eigenen Format — die Zeitachse hat im Repo eine Wahrheit.

Verlassen-Schutz: `useBlocker` von react-router bei `form.isFieldsTouched()`, mit einem
`<Modal>` („Ungespeicherte Änderungen — Speichern / Verwerfen / Bleiben"). Kein
`window.confirm`.

- [ ] **Step 4: PASS erwarten**
- [ ] **Step 5: Commit**

```bash
git commit -am "feat(lfh-342): sichert den Befehlsentwurf gegen Verlust"
```

---

### Task 8: Browser-Gates (AK#1)

Beide Hälften von AK#1 sind **Layoutmessungen** und in Vitest nicht belegbar — jsdom
rechnet kein Layout.

**Files:**
- Create: `frontend/e2e/etb-chronologie.spec.ts`

- [ ] **Step 1: Spec schreiben**

```ts
test('bei 390 px scrollt der Body nicht seitlich', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await oeffneEtb(page);
  const mass = await page.evaluate(() => ({
    scroll: document.body.scrollWidth, innen: window.innerWidth }));
  expect(mass.scroll).toBeLessThanOrEqual(mass.innen);
});

test('bei 1366 px bekommt der Meldungstext mindestens die halbe Contentbreite', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await oeffneEtb(page);
  const inhalt = await page.locator('th:has-text("Inhalt")').boundingBox();
  const flaeche = await page.locator('[data-lfh="datensicht"]').boundingBox();
  expect(inhalt!.width / flaeche!.width).toBeGreaterThanOrEqual(0.5);
});
```

- [ ] **Step 2: Laufen lassen**

Run: `mise exec pnpm@11.10.0 -- pnpm -C $FE e2e etb-chronologie`
Vorbedingung: `target/debug/lifeline-hub` existiert (`cargo build`), sonst überspringt
Schritt 7 des Sammel-Gates mit Hinweis.

- [ ] **Step 3: Commit**

```bash
git commit -am "test(lfh-342): misst Chronologie-Breiten im Browser"
```

---

### Task 9: Prüfliste, Doku und Nachzüge

- [ ] **Step 1: Prüfliste Einsatztauglichkeit schreiben**

`docs/superpowers/specs/2026-08-21-lfh-342-pruefliste.md`, Muster
`2026-08-18-lfh-340-pruefliste.md`. **Alle 15 Kriterien**, je Zeile ein Verdikt
(erfüllt / offen → Zielticket / nicht anwendbar); „nicht geprüft" ist keins. Sie verweist
auf die Vorgängerin aus B5e (`2026-07-30-etb-pruefliste.md`) und schreibt fort, was C7
bewegt hat. Die drei AK-Korrekturen oben stehen darin mit ihrer Messung.

- [ ] **Step 2: CLAUDE.md fortschreiben**

Aufzunehmen, jeweils mit dem Grund, nicht nur der Regel:
- Die ETB-Chronologie ist der **erste Karten-Eigenbau** der `Datensicht` — mit der
  Begründung, warum der Plan-Modus nicht reicht (fünf Kopffelder, Volltextblock, drei
  Aktionen gegen Titel + Status + drei Felder + eine Aktion).
- Die Filterachse des ETB liegt in der URL, gebaut über `etbPfad`, zurückgelesen über
  `parseEtbFilter`, mit der Zeitkonversion in `etb/filterZeit.ts` — und der Grund, warum
  die Umkehr ein eigenes Modul mit DST-Test ist.
- Der Restposten LFH-330 · AP8 ist erledigt: das ETB läuft über `Datensicht`.

- [ ] **Step 3: Nachzüge auf dem Board anlegen** (`clickup-task-anlegen`)

- „Nächste Lagebesprechung" als Wiedervorlage-Schnellwahl — braucht eine Quelle für den
  Termin, die es im Frontend nicht gibt.
- Falls in T4 gemessen: Führungsstelle am Benutzer/Einsatz als Backend-Feld.
- Der Bereich zwischen `md` und `lg`: eine zweite Umbruchachse an der `Datensicht`, falls
  das Führungs-Tablet quer die Karten und nicht die Tabelle braucht (heute ungeprüft).

- [ ] **Step 4: Volles Gate**

Run: `./scripts/check-all.sh`
Expected: alle sieben Schritte grün.

- [ ] **Step 5: Commit**

```bash
git commit -am "docs(lfh-342): legt die Pruefliste an und schreibt CLAUDE.md fort"
```

---

## Self-Review

**Spec-Abdeckung.** Elf Ticket-Punkte: sieben waren beim Bestandscheck gemessen erledigt
(Tabelle oben, mit Beleg je Zeile), die verbleibenden vier plus die zwei Teilreste sind
T1–T8 zugeordnet. Alle sechs Akzeptanzkriterien haben einen Träger: AK1 → T8, AK2 →
AK-Korrektur 1+2 (substanziell erfüllt, gemessen), AK3 → T5/T6, AK4 → T1/T2, AK5 → T4
(Bestand aus B4 plus die Vorbelegung), AK6 → T9.

**Platzhalter.** Kein „TBD"/„später". Zwei Stellen sind bewusst als **Messung vor
Entscheidung** formuliert und nicht als offener Rest: T4 Step 3 (trägt der Kontext
überhaupt eine Führungsstelle) und T3 („nächste Lagebesprechung"). Beide nennen die
Messung, die Konsequenz beider Ausgänge und das Nachzugsticket.

**Typkonsistenz.** `EtbZeile`/`baueZeilen` (T5) werden in T6 unter denselben Namen
konsumiert; `alsBackendZeit`/`alsOrtszeit` (T1) in T2; `etbPfad`/`parseEtbFilter` (T1)
in T2. `AusstehenderEintrag.erstellt_at` ist der gemessene Feldname, nicht das
`erfasst_lokal_at` des Tickets.
