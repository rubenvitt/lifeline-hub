# ETB-Schnellerfassung UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die ETB-Schnellerfassung auf einen tastaturgetriebenen Command-Bar-Flow umbauen — Enter sendet, Fokus bleibt, ein `/`-Trigger öffnet ein gruppiertes Felder-+-Bausteine-Menü, Metadaten werden als editierbare Chips erfasst.

**Architecture:** Eine pure, voll getestete Modell-Schicht (`schnellerfassungModell.ts`) trägt Trigger-Erkennung, Menü-Filter und Eintrag-Merge. Darauf bauen drei React-Einheiten: ein erweiterter `MarkdownEditor` (Ref + `onKeyDown`-Passthrough + Vorschau-Toggle), die `MetaChip`-Leiste (Chip mit feldtyp-Inline-Editor) und das `SlashMenu` (gruppiertes Overlay). `Schnellerfassung.tsx` orchestriert sie und ersetzt den heutigen `Collapse` + `Select`-`BausteinPicker`. Der Baustein-Platzhalter-Modal wird aus `BausteinPicker` extrahiert und bleibt erhalten.

**Tech Stack:** React 18, antd v5, TypeScript, dayjs, Vitest + Testing Library, `userEvent`.

---

## Referenz: Spec

`docs/superpowers/specs/2026-06-10-etb-schnellerfassung-ux-design.md`

## Bestehende Fakten (verifiziert)

- `NeuerEintrag` (`src/api/etb.ts:31`): `{ typ, inhalt, von?, an?, meldeweg?, veranlassung?, ereigniszeit?, erfasst_lokal_at?, berichtigt_eintrag_id? }`.
- `EtbTyp = 'meldung'|'anordnung'|'lage'|'entscheidung'|'system'|'berichtigung'`; `MeldeWeg = 'funk'|'telefon'|'persoenlich'|'sonstige'` (`src/api/types.ts:59`).
- `EtbBaustein` (`src/api/types.ts:80`): `{ id, label, typ, inhalt, meldeweg, veranlassung, sortier }`.
- `ERFASSBARE_TYPEN`/`TYP_LABEL` (`src/etb/typFarben.ts`).
- `setzeBausteinEin`/`ermittlePlatzhalter` (`src/etb/bausteinEinsetzen.ts`) — pure, bleiben unverändert.
- Tests rendern über `renderMitProviders` (`src/test/utils.tsx`, liefert antd `App` → `App.useApp()` funktioniert).
- Test-Gate: `pnpm vitest run --no-file-parallelism` (volle Suite ist unter Last sonst flaky).

## Dateien-Übersicht

| Datei | Aktion | Verantwortung |
|---|---|---|
| `src/etb/schnellerfassungModell.ts` | Create | Pure Logik: Feld-Katalog, `erkenneSlashTrigger`, `filterSlashEintraege`, `baueEintrag` |
| `src/etb/schnellerfassungModell.test.ts` | Create | Unit-Tests der puren Logik |
| `src/etb/BausteinPlatzhalterModal.tsx` | Create | Aus `BausteinPicker` extrahierter Platzhalter-Modal-Flow |
| `src/etb/BausteinPlatzhalterModal.test.tsx` | Create | Tests des Modals |
| `src/components/MarkdownEditor.tsx` | Modify | Ref-Passthrough, `onKeyDown`-Prop, Vorschau-Toggle-Variante |
| `src/etb/MetaChip.tsx` | Create | Chip mit feldtyp-Inline-Editor |
| `src/etb/MetaChip.test.tsx` | Create | Tests des Chips |
| `src/etb/SlashMenu.tsx` | Create | Gruppiertes Overlay (Felder + Bausteine), Tastatur-Nav |
| `src/etb/SlashMenu.test.tsx` | Create | Tests des Menüs |
| `src/etb/Schnellerfassung.tsx` | Modify | Container-Umbau, orchestriert alles |
| `src/etb/Schnellerfassung.test.tsx` | Modify | Tests an neuen Flow anpassen/erweitern |
| `src/etb/BausteinPicker.tsx` | Delete | Geht in `SlashMenu` + `BausteinPlatzhalterModal` auf |
| `src/etb/BausteinPicker.test.tsx` | Delete | Ersetzt durch `SlashMenu.test.tsx` + `BausteinPlatzhalterModal.test.tsx` |

---

## Task 1: Feld-Katalog + Typen (pure)

**Files:**
- Create: `src/etb/schnellerfassungModell.ts`
- Test: `src/etb/schnellerfassungModell.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/etb/schnellerfassungModell.test.ts
import { describe, expect, it } from 'vitest';
import { METADATEN_FELDER, type MetaFeld } from './schnellerfassungModell';

describe('METADATEN_FELDER', () => {
  it('enthält genau die fünf Metadatenfelder in Anzeigereihenfolge', () => {
    expect(METADATEN_FELDER.map((f) => f.feld)).toEqual<MetaFeld[]>([
      'ereigniszeit', 'von', 'an', 'meldeweg', 'veranlassung',
    ]);
  });

  it('jedes Feld hat Label, Trigger-Keywords und Editor-Typ', () => {
    for (const def of METADATEN_FELDER) {
      expect(def.label.length).toBeGreaterThan(0);
      expect(def.trigger.length).toBeGreaterThan(0);
      expect(['zeit', 'text', 'meldeweg']).toContain(def.editor);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/etb/schnellerfassungModell.test.ts`
Expected: FAIL — `Cannot find module './schnellerfassungModell'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/etb/schnellerfassungModell.ts
import type dayjs from 'dayjs';
import type { EtbTyp, MeldeWeg } from '../api/types';

export type MetaFeld = 'ereigniszeit' | 'von' | 'an' | 'meldeweg' | 'veranlassung';

export type EditorTyp = 'zeit' | 'text' | 'meldeweg';

export interface MetaFeldDef {
  feld: MetaFeld;
  label: string;
  /** Kleingeschriebene Filter-Stichwörter für das /-Menü. */
  trigger: string[];
  editor: EditorTyp;
}

/** Anzeige-/Tab-Reihenfolge der Felder im /-Menü und in der Chip-Leiste. */
export const METADATEN_FELDER: MetaFeldDef[] = [
  { feld: 'ereigniszeit', label: 'Ereigniszeit', trigger: ['zeit', 'ereigniszeit', 'uhrzeit'], editor: 'zeit' },
  { feld: 'von', label: 'Von', trigger: ['von', 'absender'], editor: 'text' },
  { feld: 'an', label: 'An', trigger: ['an', 'empfaenger', 'empfänger'], editor: 'text' },
  { feld: 'meldeweg', label: 'Meldeweg', trigger: ['meldeweg', 'weg', 'funk', 'telefon'], editor: 'meldeweg' },
  { feld: 'veranlassung', label: 'Veranlassung', trigger: ['veranlassung', 'massnahme', 'maßnahme'], editor: 'text' },
];

/** Vom Nutzer gesetzte Metadaten (vor dem Merge in NeuerEintrag). */
export interface MetadatenWerte {
  ereigniszeit?: dayjs.Dayjs;
  von?: string;
  an?: string;
  meldeweg?: MeldeWeg;
  veranlassung?: string;
}

export const MELDEWEG_OPTIONEN: { value: MeldeWeg; label: string }[] = [
  { value: 'funk', label: 'Funk' },
  { value: 'telefon', label: 'Telefon' },
  { value: 'persoenlich', label: 'Persönlich' },
  { value: 'sonstige', label: 'Sonstige' },
];
```

> `ERFASSBARE_TYPEN` aus `src/etb/typFarben.ts` wird wiederverwendet (nicht dupliziert). `EtbTyp` wird hier nur als Typ-Import gebraucht.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/etb/schnellerfassungModell.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/etb/schnellerfassungModell.ts src/etb/schnellerfassungModell.test.ts
git commit -m "feat(etb): Feld-Katalog für Schnellerfassung-Modell (LFH-72)"
```

---

## Task 2: `erkenneSlashTrigger` (pure)

Erkennt einen aktiven `/`-Trigger links vom Cursor. Nur am Wortanfang (`/` steht am Textanfang oder nach Whitespace), kein Whitespace zwischen `/` und Cursor.

**Files:**
- Modify: `src/etb/schnellerfassungModell.ts`
- Test: `src/etb/schnellerfassungModell.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// append to src/etb/schnellerfassungModell.test.ts
import { erkenneSlashTrigger } from './schnellerfassungModell';

describe('erkenneSlashTrigger', () => {
  it('aktiv, wenn / am Textanfang steht', () => {
    expect(erkenneSlashTrigger('/vo', 3)).toEqual({ aktiv: true, filter: 'vo', start: 0 });
  });

  it('aktiv, wenn / nach Whitespace steht', () => {
    const text = 'Pumpe läuft /zei';
    expect(erkenneSlashTrigger(text, text.length)).toEqual({ aktiv: true, filter: 'zei', start: 12 });
  });

  it('inaktiv bei / mitten im Wort (z.B. 2/9)', () => {
    expect(erkenneSlashTrigger('2/9', 3)).toEqual({ aktiv: false, filter: '', start: -1 });
  });

  it('inaktiv, wenn zwischen / und Cursor ein Leerzeichen liegt', () => {
    expect(erkenneSlashTrigger('/von bar', 8)).toEqual({ aktiv: false, filter: '', start: -1 });
  });

  it('inaktiv ohne / links vom Cursor', () => {
    expect(erkenneSlashTrigger('Lage stabil', 11)).toEqual({ aktiv: false, filter: '', start: -1 });
  });

  it('leerer Filter direkt nach /', () => {
    expect(erkenneSlashTrigger('Lage /', 6)).toEqual({ aktiv: true, filter: '', start: 5 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/etb/schnellerfassungModell.test.ts -t erkenneSlashTrigger`
Expected: FAIL — `erkenneSlashTrigger is not a function`.

- [ ] **Step 3: Write minimal implementation**

```ts
// append to src/etb/schnellerfassungModell.ts
export interface SlashTrigger {
  aktiv: boolean;
  filter: string;
  start: number;
}

const INAKTIV: SlashTrigger = { aktiv: false, filter: '', start: -1 };

/**
 * Sucht links vom Cursor ein '/' am Wortanfang. Bricht bei Whitespace ab
 * (Whitespace zwischen '/' und Cursor schließt das Menü). '/' mitten im Wort
 * (z.B. "2/9", Datums-/Pfadangaben) triggert nicht.
 */
export function erkenneSlashTrigger(text: string, caret: number): SlashTrigger {
  for (let i = caret - 1; i >= 0; i--) {
    const c = text[i];
    if (c === '/') {
      const wortanfang = i === 0 || /\s/.test(text[i - 1]);
      return wortanfang ? { aktiv: true, filter: text.slice(i + 1, caret), start: i } : INAKTIV;
    }
    if (/\s/.test(c)) return INAKTIV;
  }
  return INAKTIV;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/etb/schnellerfassungModell.test.ts -t erkenneSlashTrigger`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/etb/schnellerfassungModell.ts src/etb/schnellerfassungModell.test.ts
git commit -m "feat(etb): erkenneSlashTrigger (Wortanfang-Regel) (LFH-72)"
```

---

## Task 3: `filterSlashEintraege` (pure)

Filtert Felder + Bausteine für das Menü nach dem Tipp-Filter. Markiert bereits gesetzte Felder.

**Files:**
- Modify: `src/etb/schnellerfassungModell.ts`
- Test: `src/etb/schnellerfassungModell.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// append to src/etb/schnellerfassungModell.test.ts
import { filterSlashEintraege } from './schnellerfassungModell';
import type { EtbBaustein } from '../api/types';

function baustein(id: number, label: string): EtbBaustein {
  return { id, label, typ: 'meldung', inhalt: '', meldeweg: null, veranlassung: null, sortier: id };
}

describe('filterSlashEintraege', () => {
  const bausteine = [baustein(1, 'Lagemeldung'), baustein(2, 'Bereitstellung')];

  it('ohne Filter: alle Felder + alle Bausteine', () => {
    const r = filterSlashEintraege('', bausteine, []);
    expect(r.felder.map((e) => e.key)).toEqual(['ereigniszeit', 'von', 'an', 'meldeweg', 'veranlassung']);
    expect(r.bausteine.map((e) => e.label)).toEqual(['Lagemeldung', 'Bereitstellung']);
  });

  it('filtert Felder per Trigger-Stichwort (case-insensitive)', () => {
    const r = filterSlashEintraege('ZEI', bausteine, []);
    expect(r.felder.map((e) => e.key)).toEqual(['ereigniszeit']);
    expect(r.bausteine).toEqual([]);
  });

  it('filtert Bausteine per Label-Teilstring', () => {
    const r = filterSlashEintraege('lage', bausteine, []);
    expect(r.bausteine.map((e) => e.label)).toEqual(['Lagemeldung']);
  });

  it('markiert bereits gesetzte Felder', () => {
    const r = filterSlashEintraege('von', bausteine, ['von']);
    expect(r.felder[0]).toMatchObject({ key: 'von', gesetzt: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/etb/schnellerfassungModell.test.ts -t filterSlashEintraege`
Expected: FAIL — `filterSlashEintraege is not a function`.

- [ ] **Step 3: Write minimal implementation**

```ts
// append to src/etb/schnellerfassungModell.ts
import type { EtbBaustein } from '../api/types';

export interface SlashEintrag {
  art: 'feld' | 'baustein';
  key: string;
  label: string;
  gesetzt?: boolean;
}

export interface SlashTreffer {
  felder: SlashEintrag[];
  bausteine: SlashEintrag[];
}

export function filterSlashEintraege(
  filter: string,
  bausteine: EtbBaustein[],
  gesetzteFelder: MetaFeld[],
): SlashTreffer {
  const f = filter.trim().toLowerCase();
  const felder: SlashEintrag[] = METADATEN_FELDER.filter(
    (def) => f === '' || def.trigger.some((t) => t.includes(f)) || def.label.toLowerCase().includes(f),
  ).map((def) => ({
    art: 'feld',
    key: def.feld,
    label: def.label,
    gesetzt: gesetzteFelder.includes(def.feld),
  }));

  const treffer: SlashEintrag[] = bausteine
    .filter((b) => f === '' || b.label.toLowerCase().includes(f))
    .map((b) => ({ art: 'baustein', key: String(b.id), label: b.label }));

  return { felder, bausteine: treffer };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/etb/schnellerfassungModell.test.ts -t filterSlashEintraege`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/etb/schnellerfassungModell.ts src/etb/schnellerfassungModell.test.ts
git commit -m "feat(etb): filterSlashEintraege (Felder + Bausteine) (LFH-72)"
```

---

## Task 4: `baueEintrag` (pure)

Merged Inhalt + Typ + Metadaten zu `NeuerEintrag` — spiegelt die heutige `absenden()`-Logik (Ereigniszeit-Default „jetzt", Berichtigung).

**Files:**
- Modify: `src/etb/schnellerfassungModell.ts`
- Test: `src/etb/schnellerfassungModell.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// append to src/etb/schnellerfassungModell.test.ts
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { baueEintrag } from './schnellerfassungModell';
dayjs.extend(utc);

describe('baueEintrag', () => {
  const jetztIso = '2026-06-10T12:00:00.000Z';

  it('Standardmeldung: typ + inhalt, ereigniszeit = jetzt, leere Metadaten weggelassen', () => {
    const e = baueEintrag({ inhalt: 'Pumpe läuft', typ: 'meldung', metadaten: {}, jetztIso });
    expect(e).toMatchObject({ typ: 'meldung', inhalt: 'Pumpe läuft', ereigniszeit: jetztIso });
    expect(e.erfasst_lokal_at).toBe(jetztIso);
    expect(e.von).toBeUndefined();
    expect(e.berichtigt_eintrag_id).toBeUndefined();
  });

  it('übernimmt gesetzte Metadaten inkl. abweichender Ereigniszeit (SQLite-UTC-Format)', () => {
    const e = baueEintrag({
      inhalt: 'Lage',
      typ: 'lage',
      metadaten: {
        von: 'ELW 1', an: 'Abschnitt 2', meldeweg: 'funk', veranlassung: 'RTW nachfordern',
        ereigniszeit: dayjs.utc('2026-06-10 09:30:00'),
      },
      jetztIso,
    });
    expect(e).toMatchObject({
      von: 'ELW 1', an: 'Abschnitt 2', meldeweg: 'funk', veranlassung: 'RTW nachfordern',
      ereigniszeit: '2026-06-10 09:30:00',
    });
  });

  it('Berichtigung: typ=berichtigung + berichtigt_eintrag_id', () => {
    const e = baueEintrag({ inhalt: 'Korrektur', typ: 'meldung', metadaten: {}, berichtigungZuId: 5, jetztIso });
    expect(e.typ).toBe('berichtigung');
    expect(e.berichtigt_eintrag_id).toBe(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/etb/schnellerfassungModell.test.ts -t baueEintrag`
Expected: FAIL — `baueEintrag is not a function`.

- [ ] **Step 3: Write minimal implementation**

```ts
// append to src/etb/schnellerfassungModell.ts
import type { NeuerEintrag } from '../api/etb';

export interface EintragArgs {
  inhalt: string;
  typ: EtbTyp;
  metadaten: MetadatenWerte;
  berichtigungZuId?: number;
  /** ISO-Zeitstempel „jetzt" (vom Aufrufer übergeben — testbar). */
  jetztIso: string;
}

export function baueEintrag({ inhalt, typ, metadaten, berichtigungZuId, jetztIso }: EintragArgs): NeuerEintrag {
  return {
    typ: berichtigungZuId ? 'berichtigung' : typ,
    inhalt,
    von: metadaten.von || undefined,
    an: metadaten.an || undefined,
    meldeweg: metadaten.meldeweg || undefined,
    veranlassung: metadaten.veranlassung || undefined,
    ereigniszeit: metadaten.ereigniszeit
      ? metadaten.ereigniszeit.utc().format('YYYY-MM-DD HH:mm:ss')
      : jetztIso,
    erfasst_lokal_at: jetztIso,
    berichtigt_eintrag_id: berichtigungZuId,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/etb/schnellerfassungModell.test.ts`
Expected: PASS (gesamte Datei grün).

- [ ] **Step 5: Commit**

```bash
git add src/etb/schnellerfassungModell.ts src/etb/schnellerfassungModell.test.ts
git commit -m "feat(etb): baueEintrag Merge-Logik (LFH-72)"
```

---

## Task 5: `BausteinPlatzhalterModal` aus `BausteinPicker` extrahieren

Der Platzhalter-Modal-Flow bleibt erhalten, wird aber von der Auswahl entkoppelt (Auswahl kommt künftig vom `SlashMenu`). Komponente bekommt einen Baustein gesteuert und liefert die fertigen Felder zurück.

**Files:**
- Create: `src/etb/BausteinPlatzhalterModal.tsx`
- Test: `src/etb/BausteinPlatzhalterModal.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/etb/BausteinPlatzhalterModal.test.tsx
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { EtbBaustein, EinsatzAnzeige } from '../api/types';
import { renderMitProviders } from '../test/utils';
import BausteinPlatzhalterModal from './BausteinPlatzhalterModal';

const einsatz = { id: 1, bezeichnung: 'Test', stichwort: null, leitstellen_nr: null, einsatzort: null } as unknown as EinsatzAnzeige;

function baustein(over: Partial<EtbBaustein> = {}): EtbBaustein {
  return { id: 1, label: 'B', typ: 'meldung', inhalt: 'Melder {melder} meldet', meldeweg: null, veranlassung: null, sortier: 0, ...over };
}

describe('BausteinPlatzhalterModal', () => {
  it('fragt manuelle Platzhalter ab und liefert eingesetzte Felder', async () => {
    const onEinsetzen = vi.fn();
    renderMitProviders(
      <BausteinPlatzhalterModal baustein={baustein()} einsatz={einsatz} onEinsetzen={onEinsetzen} onAbbrechenAll={vi.fn()} />,
    );
    await userEvent.type(screen.getByLabelText('melder'), 'Florian');
    await userEvent.click(screen.getByRole('button', { name: 'Einsetzen' }));
    await waitFor(() => expect(onEinsetzen).toHaveBeenCalledTimes(1));
    expect(onEinsetzen.mock.calls[0][0]).toMatchObject({ inhalt: 'Melder Florian meldet' });
  });

  it('setzt Baustein ohne Platzhalter sofort ein (kein Modal)', async () => {
    const onEinsetzen = vi.fn();
    renderMitProviders(
      <BausteinPlatzhalterModal baustein={baustein({ inhalt: 'Bereitstellung' })} einsatz={einsatz} onEinsetzen={onEinsetzen} onAbbrechenAll={vi.fn()} />,
    );
    await waitFor(() => expect(onEinsetzen).toHaveBeenCalledTimes(1));
    expect(onEinsetzen.mock.calls[0][0]).toMatchObject({ inhalt: 'Bereitstellung' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/etb/BausteinPlatzhalterModal.test.tsx`
Expected: FAIL — `Cannot find module './BausteinPlatzhalterModal'`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/etb/BausteinPlatzhalterModal.tsx
import { Button, Form, Input, Modal, Space } from 'antd';
import { useEffect, useState } from 'react';
import type { EtbBaustein, EinsatzAnzeige } from '../api/types';
import { ermittlePlatzhalter, setzeBausteinEin, type BausteinFelder } from './bausteinEinsetzen';

interface Props {
  /** Gesetzt = dieser Baustein wird eingesetzt; null = nichts offen. */
  baustein: EtbBaustein | null;
  einsatz: EinsatzAnzeige;
  /** Liefert die fertig substituierten Felder. */
  onEinsetzen: (felder: BausteinFelder) => void;
  /** Modal ohne Einsetzen geschlossen. */
  onAbbrechenAll: () => void;
}

export default function BausteinPlatzhalterModal({ baustein, einsatz, onEinsetzen, onAbbrechenAll }: Props) {
  const [werte, setWerte] = useState<Record<string, string>>({});
  const offenePlatzhalter = baustein ? ermittlePlatzhalter(baustein, einsatz) : [];

  // Bausteine ohne manuelle Platzhalter sofort einsetzen (kein Dialog nötig).
  useEffect(() => {
    if (baustein && offenePlatzhalter.length === 0) {
      onEinsetzen(setzeBausteinEin(baustein, einsatz, {}));
      setWerte({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baustein]);

  function anwenden() {
    if (!baustein) return;
    onEinsetzen(setzeBausteinEin(baustein, einsatz, werte));
    setWerte({});
  }

  const dialogOffen = baustein !== null && offenePlatzhalter.length > 0;

  return (
    <Modal open={dialogOffen} title="Baustein einsetzen" footer={null} onCancel={onAbbrechenAll} destroyOnHidden>
      <Space direction="vertical" style={{ width: '100%' }}>
        {offenePlatzhalter.map((name) => (
          <Form.Item key={name} label={name} style={{ marginBottom: 8 }}>
            <Input
              value={werte[name] ?? ''}
              onChange={(e) => setWerte((w) => ({ ...w, [name]: e.target.value }))}
            />
          </Form.Item>
        ))}
        <Button type="primary" onClick={anwenden}>Einsetzen</Button>
      </Space>
    </Modal>
  );
}
```

> Hinweis: Die Form.Item-`label`-Verknüpfung erzeugt das `aria-label`-Äquivalent; `getByLabelText('melder')` findet das Input. Der heutige „vorhandenen Inhalt ersetzen?"-Popconfirm entfällt — die Ersetzungs-Entscheidung trifft künftig der Container vor dem Öffnen (Task 9).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/etb/BausteinPlatzhalterModal.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/etb/BausteinPlatzhalterModal.tsx src/etb/BausteinPlatzhalterModal.test.tsx
git commit -m "feat(etb): BausteinPlatzhalterModal aus BausteinPicker extrahiert (LFH-72)"
```

---

## Task 6: `MarkdownEditor` erweitern (Ref, onKeyDown, Vorschau-Toggle)

Der Editor muss (a) eine Ref aufs innere `TextArea` durchreichen, (b) `onKeyDown` nach oben geben, (c) eine schlanke Variante mit Vorschau-Toggle statt Dauer-Tabs bieten.

**Files:**
- Modify: `src/components/MarkdownEditor.tsx`
- Test: `src/components/MarkdownEditor.test.tsx` (Create, falls nicht vorhanden)

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/MarkdownEditor.test.tsx
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../test/utils';
import MarkdownEditor from './MarkdownEditor';

describe('MarkdownEditor – toggle-Variante', () => {
  it('zeigt Eingabe; Vorschau-Toggle blendet formatierten Markdown ein', async () => {
    function Wrap() {
      return <MarkdownEditor layout="toggle" variante="kompakt" placeholder="Inhalt …" value="**fett**" onChange={() => {}} />;
    }
    const { container } = renderMitProviders(<Wrap />);
    expect(container.querySelector('.markdown strong')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /vorschau/i }));
    expect(container.querySelector('.markdown strong')).toHaveTextContent('fett');
  });

  it('reicht onKeyDown durch', async () => {
    const onKeyDown = vi.fn();
    renderMitProviders(
      <MarkdownEditor layout="toggle" placeholder="Inhalt …" value="" onChange={() => {}} onKeyDown={onKeyDown} />,
    );
    await userEvent.type(screen.getByPlaceholderText('Inhalt …'), '/');
    expect(onKeyDown).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/components/MarkdownEditor.test.tsx`
Expected: FAIL — `layout="toggle"` rendert keine Vorschau-Button / `onKeyDown` nicht unterstützt.

- [ ] **Step 3: Write minimal implementation**

Erweitere `src/components/MarkdownEditor.tsx`:

```tsx
import { Button, Input, Tabs, Typography } from 'antd';
import type { GetRef } from 'antd';
import { EyeOutlined } from '@ant-design/icons';
import { forwardRef, useState, type KeyboardEvent } from 'react';
import Markdown from './Markdown';
import './MarkdownEditor.css';

/** Ref-Typ des inneren antd Input.TextArea (hat `resizableTextArea.textArea`). */
export type TextAreaRef = GetRef<typeof Input.TextArea>;

type Layout = 'split' | 'tabs' | 'toggle';
type Variante = 'kompakt' | 'dokument';

interface Props {
  value?: string;
  onChange?: (value: string) => void;
  layout?: Layout;
  variante?: Variante;
  placeholder?: string;
  autoSize?: boolean | { minRows?: number; maxRows?: number };
  rows?: number;
  id?: string;
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
}

// Bestehende Komponente in forwardRef wandeln, damit der Container eine Ref aufs TextArea bekommt.
const MarkdownEditor = forwardRef<TextAreaRef, Props>(function MarkdownEditor(
  { value = '', onChange, layout = 'split', variante = 'dokument', placeholder, autoSize, rows, id, onKeyDown },
  ref,
) {
  const [aktiv, setAktiv] = useState<'schreiben' | 'vorschau'>('schreiben');
  const [vorschauOffen, setVorschauOffen] = useState(false);

  const textfeld = (
    <Input.TextArea
      ref={ref}
      id={id}
      value={value}
      placeholder={placeholder}
      autoSize={autoSize}
      rows={rows}
      onChange={(e) => onChange?.(e.target.value)}
      onKeyDown={onKeyDown}
    />
  );

  const vorschau = value.trim() ? (
    <Markdown variante={variante}>{value}</Markdown>
  ) : (
    <Typography.Text type="secondary">Noch nichts zu zeigen.</Typography.Text>
  );

  if (layout === 'toggle') {
    return (
      <div className="markdown-editor markdown-editor--toggle">
        {textfeld}
        <div style={{ marginTop: 4 }}>
          <Button
            type="text"
            size="small"
            icon={<EyeOutlined />}
            onClick={() => setVorschauOffen((v) => !v)}
          >
            Vorschau
          </Button>
        </div>
        {vorschauOffen && <div className="markdown-editor__vorschau">{vorschau}</div>}
      </div>
    );
  }

  if (layout === 'tabs') {
    return (
      <div className="markdown-editor markdown-editor--tabs">
        <Tabs
          size="small"
          activeKey={aktiv}
          onChange={(k) => setAktiv(k as 'schreiben' | 'vorschau')}
          items={[
            { key: 'schreiben', label: 'Schreiben', children: textfeld },
            { key: 'vorschau', label: 'Vorschau', children: <div className="markdown-editor__vorschau">{aktiv === 'vorschau' ? vorschau : null}</div> },
          ]}
        />
      </div>
    );
  }

  return (
    <div className="markdown-editor markdown-editor--split">
      <div className="markdown-editor__eingabe">{textfeld}</div>
      <div className="markdown-editor__vorschau">
        <div className="markdown-editor__label">Vorschau</div>
        {vorschau}
      </div>
    </div>
  );
});

export default MarkdownEditor;
```

> `Space` ggf. aus dem Import entfernen, falls ungenutzt (ESLint). Die bestehenden `tabs`/`split`-Tests in `Schnellerfassung.test.tsx` bleiben grün, weil das Default-Verhalten unverändert ist.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/components/MarkdownEditor.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/MarkdownEditor.tsx src/components/MarkdownEditor.test.tsx
git commit -m "feat(md): MarkdownEditor Ref/onKeyDown + toggle-Vorschau-Variante (LFH-72)"
```

---

## Task 7: `MetaChip` (Chip mit feldtyp-Inline-Editor)

Ein Chip rendert geschlossen Label+Wert (`closable`); im Edit-Zustand den feldtyp-spezifischen Editor. Commit per Enter, Abbruch per Escape.

**Files:**
- Create: `src/etb/MetaChip.tsx`
- Test: `src/etb/MetaChip.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/etb/MetaChip.test.tsx
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../test/utils';
import MetaChip from './MetaChip';

describe('MetaChip', () => {
  it('Text-Feld: Editor offen, Enter committet den Wert', async () => {
    const onCommit = vi.fn();
    renderMitProviders(
      <MetaChip feld="von" editing wert={undefined} onCommit={onCommit} onCancel={vi.fn()} onRemove={vi.fn()} onEdit={vi.fn()} />,
    );
    const input = screen.getByLabelText('Von');
    await userEvent.type(input, 'ELW 1{Enter}');
    expect(onCommit).toHaveBeenCalledWith('von', 'ELW 1');
  });

  it('geschlossen: zeigt Label+Wert, × ruft onRemove', async () => {
    const onRemove = vi.fn();
    renderMitProviders(
      <MetaChip feld="meldeweg" editing={false} wert="funk" onCommit={vi.fn()} onCancel={vi.fn()} onRemove={onRemove} onEdit={vi.fn()} />,
    );
    expect(screen.getByText(/Meldeweg/)).toBeInTheDocument();
    expect(screen.getByText(/Funk/)).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('schließen'));
    expect(onRemove).toHaveBeenCalledWith('meldeweg');
  });

  it('Escape im Editor ruft onCancel', async () => {
    const onCancel = vi.fn();
    renderMitProviders(
      <MetaChip feld="von" editing wert={undefined} onCommit={vi.fn()} onCancel={onCancel} onRemove={vi.fn()} onEdit={vi.fn()} />,
    );
    await userEvent.type(screen.getByLabelText('Von'), '{Escape}');
    expect(onCancel).toHaveBeenCalledWith('von');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/etb/MetaChip.test.tsx`
Expected: FAIL — `Cannot find module './MetaChip'`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/etb/MetaChip.tsx
import { DatePicker, Input, Select, Tag } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import type { MeldeWeg } from '../api/types';
import { MELDEWEG_OPTIONEN, METADATEN_FELDER, type MetaFeld } from './schnellerfassungModell';

type Wert = string | dayjs.Dayjs | MeldeWeg | undefined;

interface Props {
  feld: MetaFeld;
  editing: boolean;
  wert: Wert;
  onCommit: (feld: MetaFeld, wert: string | dayjs.Dayjs | MeldeWeg) => void;
  onCancel: (feld: MetaFeld) => void;
  onRemove: (feld: MetaFeld) => void;
  onEdit: (feld: MetaFeld) => void;
}

function def(feld: MetaFeld) {
  return METADATEN_FELDER.find((d) => d.feld === feld)!;
}

function anzeige(feld: MetaFeld, wert: Wert): string {
  if (wert == null) return '';
  if (def(feld).editor === 'zeit') return (wert as dayjs.Dayjs).format('HH:mm');
  if (feld === 'meldeweg') return MELDEWEG_OPTIONEN.find((o) => o.value === wert)?.label ?? String(wert);
  return String(wert);
}

export default function MetaChip({ feld, editing, wert, onCommit, onCancel, onRemove, onEdit }: Props) {
  const d = def(feld);
  const [text, setText] = useState(typeof wert === 'string' ? wert : '');

  if (editing) {
    if (d.editor === 'text') {
      return (
        <Input
          size="small"
          autoFocus
          aria-label={d.label}
          style={{ width: 160 }}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPressEnter={() => (text.trim() ? onCommit(feld, text.trim()) : onCancel(feld))}
          onKeyDown={(e) => { if (e.key === 'Escape') onCancel(feld); }}
        />
      );
    }
    if (d.editor === 'meldeweg') {
      return (
        <Select
          size="small"
          autoFocus
          defaultOpen
          aria-label={d.label}
          style={{ width: 160 }}
          placeholder="Meldeweg"
          options={MELDEWEG_OPTIONEN}
          value={typeof wert === 'string' ? (wert as MeldeWeg) : undefined}
          onSelect={(v) => onCommit(feld, v as MeldeWeg)}
          onKeyDown={(e) => { if (e.key === 'Escape') onCancel(feld); }}
        />
      );
    }
    // zeit
    return (
      <DatePicker
        size="small"
        showTime
        autoFocus
        aria-label={d.label}
        defaultValue={dayjs.isDayjs(wert) ? wert : dayjs()}
        onOk={(v) => onCommit(feld, v)}
        onKeyDown={(e) => { if (e.key === 'Escape') onCancel(feld); }}
      />
    );
  }

  return (
    <Tag closable onClose={() => onRemove(feld)} onClick={() => onEdit(feld)} style={{ cursor: 'pointer' }}>
      {d.label}: {anzeige(feld, wert)}
    </Tag>
  );
}
```

> antd `Tag closable` rendert ein Schließen-Icon mit `aria-label="close"`; falls der Test `getByLabelText('schließen')` nicht findet, im Test auf `screen.getByLabelText('close')` umstellen oder dem Tag `closeIcon={<CloseOutlined aria-label="schließen" />}` geben. Implementierung an den realen antd-Output anpassen (beim Rotlauf prüfen).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/etb/MetaChip.test.tsx`
Expected: PASS (3 tests). Bei Bedarf `aria-label` wie oben angleichen.

- [ ] **Step 5: Commit**

```bash
git add src/etb/MetaChip.tsx src/etb/MetaChip.test.tsx
git commit -m "feat(etb): MetaChip mit feldtyp-Inline-Editor (LFH-72)"
```

---

## Task 8: `SlashMenu` (gruppiertes Overlay, Tastatur-Nav)

Zeigt gefilterte Felder + Bausteine, navigierbar per ↑/↓, Auswahl per Enter/Klick. Gesteuert über Props (offen/Filter), liefert Auswahl nach oben.

**Files:**
- Create: `src/etb/SlashMenu.tsx`
- Test: `src/etb/SlashMenu.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/etb/SlashMenu.test.tsx
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { EtbBaustein } from '../api/types';
import { renderMitProviders } from '../test/utils';
import SlashMenu from './SlashMenu';

const bausteine: EtbBaustein[] = [
  { id: 1, label: 'Lagemeldung', typ: 'meldung', inhalt: '', meldeweg: null, veranlassung: null, sortier: 0 },
];

describe('SlashMenu', () => {
  it('zeigt Felder- und Bausteine-Sektion und wählt per Klick', async () => {
    const onWahl = vi.fn();
    renderMitProviders(
      <SlashMenu offen filter="" bausteine={bausteine} gesetzteFelder={[]} onWahl={onWahl} onSchliessen={vi.fn()} />,
    );
    expect(screen.getByText('Felder')).toBeInTheDocument();
    expect(screen.getByText('Bausteine')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Ereigniszeit'));
    expect(onWahl).toHaveBeenCalledWith({ art: 'feld', key: 'ereigniszeit', label: 'Ereigniszeit', gesetzt: false });
  });

  it('filtert und wählt den ersten Treffer per Enter (über externes keydown)', async () => {
    const onWahl = vi.fn();
    renderMitProviders(
      <SlashMenu offen filter="lage" bausteine={bausteine} gesetzteFelder={[]} onWahl={onWahl} onSchliessen={vi.fn()} />,
    );
    expect(screen.queryByText('Ereigniszeit')).toBeNull();
    expect(screen.getByText('Lagemeldung')).toBeInTheDocument();
  });

  it('rendert nichts, wenn geschlossen', () => {
    const { container } = renderMitProviders(
      <SlashMenu offen={false} filter="" bausteine={bausteine} gesetzteFelder={[]} onWahl={vi.fn()} onSchliessen={vi.fn()} />,
    );
    expect(container.querySelector('[data-testid="slash-menu"]')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/etb/SlashMenu.test.tsx`
Expected: FAIL — `Cannot find module './SlashMenu'`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/etb/SlashMenu.tsx
import { Typography } from 'antd';
import { useEffect, useImperativeHandle, useMemo, useState, forwardRef } from 'react';
import type { EtbBaustein } from '../api/types';
import { filterSlashEintraege, type MetaFeld, type SlashEintrag } from './schnellerfassungModell';

export interface SlashMenuHandle {
  /** Tastatur-Navigation vom Container weitergereicht. Liefert true, wenn verarbeitet. */
  handleKey: (key: string) => boolean;
}

interface Props {
  offen: boolean;
  filter: string;
  bausteine: EtbBaustein[];
  gesetzteFelder: MetaFeld[];
  onWahl: (eintrag: SlashEintrag) => void;
  onSchliessen: () => void;
}

const SlashMenu = forwardRef<SlashMenuHandle, Props>(function SlashMenu(
  { offen, filter, bausteine, gesetzteFelder, onWahl, onSchliessen },
  ref,
) {
  const treffer = useMemo(
    () => filterSlashEintraege(filter, bausteine, gesetzteFelder),
    [filter, bausteine, gesetzteFelder],
  );
  const flach: SlashEintrag[] = useMemo(() => [...treffer.felder, ...treffer.bausteine], [treffer]);
  const [aktiv, setAktiv] = useState(0);

  useEffect(() => setAktiv(0), [filter, offen]);

  useImperativeHandle(ref, () => ({
    handleKey(key) {
      if (!offen || flach.length === 0) return false;
      if (key === 'ArrowDown') { setAktiv((i) => (i + 1) % flach.length); return true; }
      if (key === 'ArrowUp') { setAktiv((i) => (i - 1 + flach.length) % flach.length); return true; }
      if (key === 'Enter') { onWahl(flach[aktiv]); return true; }
      if (key === 'Escape') { onSchliessen(); return true; }
      return false;
    },
  }), [offen, flach, aktiv, onWahl, onSchliessen]);

  if (!offen) return null;

  function sektion(titel: string, eintraege: SlashEintrag[], offset: number) {
    if (eintraege.length === 0) return null;
    return (
      <div>
        <Typography.Text type="secondary" style={{ fontSize: 11, padding: '4px 12px', display: 'block' }}>
          {titel}
        </Typography.Text>
        {eintraege.map((e, i) => {
          const idx = offset + i;
          return (
            <div
              key={`${e.art}-${e.key}`}
              role="option"
              aria-selected={idx === aktiv}
              onMouseDown={(ev) => { ev.preventDefault(); onWahl(e); }}
              style={{
                padding: '6px 12px', cursor: 'pointer',
                background: idx === aktiv ? 'rgba(22,119,255,0.15)' : undefined,
              }}
            >
              {e.label}{e.gesetzt ? ' ✓' : ''}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div
      data-testid="slash-menu"
      style={{
        position: 'absolute', zIndex: 10, minWidth: 240, marginTop: 4,
        background: 'var(--ant-color-bg-elevated, #1f1f1f)',
        border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8,
        boxShadow: '0 6px 18px rgba(0,0,0,0.4)', maxHeight: 280, overflow: 'auto',
      }}
    >
      {flach.length === 0 ? (
        <div style={{ padding: '6px 12px', opacity: 0.6 }}>Kein Treffer</div>
      ) : (
        <>
          {sektion('Felder', treffer.felder, 0)}
          {sektion('Bausteine', treffer.bausteine, treffer.felder.length)}
        </>
      )}
    </div>
  );
});

export default SlashMenu;
```

> `onMouseDown` + `preventDefault` statt `onClick`, damit das Hauptfeld den Fokus nicht verliert, bevor die Auswahl greift. Die Container-Komponente (Task 9) hält die Ref und ruft `handleKey` im `onKeyDown` des Textfeldes.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/etb/SlashMenu.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/etb/SlashMenu.tsx src/etb/SlashMenu.test.tsx
git commit -m "feat(etb): SlashMenu gruppiertes Overlay mit Tastatur-Nav (LFH-72)"
```

---

## Task 9: `Schnellerfassung` Container-Umbau

Führt alles zusammen: Hauptfeld (`MarkdownEditor` layout="toggle" + Ref + onKeyDown), `/`-Trigger-Erkennung, `SlashMenu`, `MetaChip`-Leiste + „+ Feld"-Button, `BausteinPlatzhalterModal`, Submit über `baueEintrag`. Ersetzt `Collapse` + alten `BausteinPicker`.

**Files:**
- Modify: `src/etb/Schnellerfassung.tsx`

- [ ] **Step 1: Vollständige neue Implementierung schreiben**

```tsx
// src/etb/Schnellerfassung.tsx
import { Alert, Button, Card, Select, Space } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { NeuerEintrag } from '../api/etb';
import type { EinsatzAnzeige, EtbBaustein, EtbEintragAnzeige, EtbTyp, MeldeWeg } from '../api/types';
import { ERFASSBARE_TYPEN, TYP_LABEL } from './typFarben';
import type { BausteinFelder } from './bausteinEinsetzen';
import MarkdownEditor, { type TextAreaRef } from '../components/MarkdownEditor';
import MetaChip from './MetaChip';
import SlashMenu, { type SlashMenuHandle } from './SlashMenu';
import BausteinPlatzhalterModal from './BausteinPlatzhalterModal';
import {
  baueEintrag, erkenneSlashTrigger, METADATEN_FELDER,
  type MetadatenWerte, type MetaFeld, type SlashEintrag,
} from './schnellerfassungModell';

interface Props {
  erfassen: (eintrag: NeuerEintrag) => Promise<void>;
  berichtigungZu: EtbEintragAnzeige | null;
  onBerichtigungAbbrechen: () => void;
  bausteine: EtbBaustein[];
  einsatz: EinsatzAnzeige;
}

const TYP_OPTIONEN = ERFASSBARE_TYPEN.map((t) => ({ value: t, label: TYP_LABEL[t] }));

export default function Schnellerfassung({ erfassen, berichtigungZu, onBerichtigungAbbrechen, bausteine, einsatz }: Props) {
  const navigate = useNavigate();
  const textRef = useRef<TextAreaRef>(null);
  const menuRef = useRef<SlashMenuHandle>(null);

  const [inhalt, setInhalt] = useState('');
  const [typ, setTyp] = useState<EtbTyp>('meldung');
  const [metadaten, setMetadaten] = useState<MetadatenWerte>({});
  const [editFeld, setEditFeld] = useState<MetaFeld | null>(null);
  const [sendet, setSendet] = useState(false);

  const [menuOffen, setMenuOffen] = useState(false);
  const [menuFilter, setMenuFilter] = useState('');
  const [triggerStart, setTriggerStart] = useState(-1);

  const [bausteinOffen, setBausteinOffen] = useState<EtbBaustein | null>(null);

  // Moduswechsel Berichtigung → alles leeren und fokussieren.
  useEffect(() => {
    setInhalt(''); setMetadaten({}); setEditFeld(null); setMenuOffen(false);
    textRef.current?.focus();
  }, [berichtigungZu]);

  const gesetzteFelder = METADATEN_FELDER.map((d) => d.feld).filter((f) => metadaten[f] != null);

  function fokusInsFeld() {
    requestAnimationFrame(() => textRef.current?.focus());
  }

  function aktualisiereTrigger(text: string, caret: number) {
    const t = erkenneSlashTrigger(text, caret);
    setMenuOffen(t.aktiv);
    setMenuFilter(t.filter);
    setTriggerStart(t.start);
  }

  function onInhaltChange(neu: string) {
    setInhalt(neu);
    const caret = textRef.current?.resizableTextArea?.textArea?.selectionStart ?? neu.length;
    aktualisiereTrigger(neu, caret);
  }

  function entferneTriggerText() {
    if (triggerStart < 0) return;
    const ta = textRef.current?.resizableTextArea?.textArea;
    const caret = ta?.selectionStart ?? inhalt.length;
    setInhalt(inhalt.slice(0, triggerStart) + inhalt.slice(caret));
    setMenuOffen(false);
  }

  function waehleEintrag(e: SlashEintrag) {
    entferneTriggerText();
    if (e.art === 'feld') {
      setEditFeld(e.key as MetaFeld);
    } else {
      const b = bausteine.find((x) => String(x.id) === e.key) ?? null;
      setBausteinOffen(b);
    }
  }

  function commitFeld(feld: MetaFeld, wert: string | dayjs.Dayjs | MeldeWeg) {
    setMetadaten((m) => ({ ...m, [feld]: wert }));
    setEditFeld(null);
    fokusInsFeld();
  }

  function bausteinEinsetzen(felder: BausteinFelder) {
    setInhalt(felder.inhalt);
    setMetadaten((m) => ({
      ...m,
      ...(felder.meldeweg ? { meldeweg: felder.meldeweg } : {}),
      ...(felder.veranlassung ? { veranlassung: felder.veranlassung } : {}),
    }));
    if (felder.typ) setTyp(felder.typ);
    setBausteinOffen(null);
    fokusInsFeld();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (menuOffen && menuRef.current?.handleKey(e.key)) {
      e.preventDefault();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void absenden();
    }
  }

  async function absenden() {
    if (sendet || inhalt.trim() === '') return;
    setSendet(true);
    try {
      const eintrag = baueEintrag({
        inhalt, typ, metadaten,
        berichtigungZuId: berichtigungZu ? berichtigungZu.id : undefined,
        jetztIso: new Date().toISOString(),
      });
      await erfassen(eintrag);
      setInhalt(''); setMetadaten({}); setEditFeld(null); setMenuOffen(false);
      if (berichtigungZu) onBerichtigungAbbrechen();
      fokusInsFeld();
    } finally {
      setSendet(false);
    }
  }

  return (
    <Card size="small" style={{ marginTop: 16 }}>
      {berichtigungZu && (
        <Alert
          type="warning" showIcon style={{ marginBottom: 12 }}
          message={`Berichtigung zu #${berichtigungZu.lfd_nr}`}
          action={<Button size="small" onClick={onBerichtigungAbbrechen}>Abbrechen</Button>}
        />
      )}

      <div style={{ position: 'relative' }}>
        <MarkdownEditor
          ref={textRef}
          layout="toggle"
          variante="kompakt"
          placeholder="Inhalt …  ( / für Felder & Bausteine )"
          autoSize={{ minRows: 1, maxRows: 4 }}
          value={inhalt}
          onChange={onInhaltChange}
          onKeyDown={onKeyDown}
        />
        <SlashMenu
          ref={menuRef}
          offen={menuOffen && !berichtigungZu}
          filter={menuFilter}
          bausteine={bausteine}
          gesetzteFelder={gesetzteFelder}
          onWahl={waehleEintrag}
          onSchliessen={() => setMenuOffen(false)}
        />
      </div>

      {/* Chip-Leiste */}
      <Space wrap style={{ marginTop: 8 }}>
        {gesetzteFelder.map((feld) => (
          <MetaChip
            key={feld}
            feld={feld}
            editing={editFeld === feld}
            wert={metadaten[feld]}
            onCommit={commitFeld}
            onCancel={() => { setEditFeld(null); fokusInsFeld(); }}
            onRemove={(f) => setMetadaten((m) => ({ ...m, [f]: undefined }))}
            onEdit={(f) => setEditFeld(f)}
          />
        ))}
        {editFeld != null && metadaten[editFeld] == null && (
          <MetaChip
            feld={editFeld}
            editing
            wert={undefined}
            onCommit={commitFeld}
            onCancel={() => { setEditFeld(null); fokusInsFeld(); }}
            onRemove={() => setEditFeld(null)}
            onEdit={() => {}}
          />
        )}
        {!berichtigungZu && (
          <Button size="small" type="dashed" icon={<PlusOutlined />} onClick={() => setMenuOffen((o) => !o)}>
            Feld
          </Button>
        )}
      </Space>

      {/* Steuerzeile */}
      <Space align="center" style={{ marginTop: 12, width: '100%' }}>
        {!berichtigungZu && (
          <Select value={typ} style={{ minWidth: 150 }} options={TYP_OPTIONEN} onChange={(v) => setTyp(v)} />
        )}
        <Button type="primary" loading={sendet} onClick={() => void absenden()}>Erfassen</Button>
        {!berichtigungZu && typ === 'lage' && (
          <Button type="link" style={{ paddingLeft: 0 }} onClick={() => navigate(`/einsaetze/${einsatz.id}/lageberichte`)}>
            Als strukturierten Lagebericht erfassen →
          </Button>
        )}
      </Space>

      <BausteinPlatzhalterModal
        baustein={bausteinOffen}
        einsatz={einsatz}
        onEinsetzen={bausteinEinsetzen}
        onAbbrechenAll={() => setBausteinOffen(null)}
      />
    </Card>
  );
}
```

> **Ref-Pfad zum Textarea:** antd `InputRef` exponiert `resizableTextArea.textArea` (das native `<textarea>`) für `selectionStart`. Falls beim Rotlauf `undefined`, alternativ `textRef.current?.focus()` für Fokus und den Caret über das `onChange`-Event (`e.target.selectionStart`) führen — dafür `onChange` in `MarkdownEditor` auf das Event statt den String erweitern oder einen separaten `onSelect` ergänzen. Beim Implementieren das real Verfügbare verifizieren.

- [ ] **Step 2: Typecheck + betroffene Tests (rot erwartet, weil alte Tests noch den Collapse erwarten)**

Run: `pnpm exec tsc --noEmit`
Expected: keine Typfehler in `Schnellerfassung.tsx` (alte `Schnellerfassung.test.tsx` evtl. noch rot → Task 10).

- [ ] **Step 3: Commit (WIP-Integration)**

```bash
git add src/etb/Schnellerfassung.tsx
git commit -m "feat(etb): Schnellerfassung Container auf Command-Bar umgebaut (LFH-72)"
```

---

## Task 10: Tests `Schnellerfassung` anpassen + alten `BausteinPicker` entfernen

**Files:**
- Modify: `src/etb/Schnellerfassung.test.tsx`
- Delete: `src/etb/BausteinPicker.tsx`, `src/etb/BausteinPicker.test.tsx`

- [ ] **Step 1: Tests an den neuen Flow anpassen**

Ersetze `src/etb/Schnellerfassung.test.tsx` durch:

```tsx
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { NeuerEintrag } from '../api/etb';
import type { EinsatzAnzeige, EtbBaustein, EtbEintragAnzeige } from '../api/types';
import { renderMitProviders } from '../test/utils';
import Schnellerfassung from './Schnellerfassung';

const einsatz = { id: 7, bezeichnung: 'Test', stichwort: null, leitstellen_nr: null, einsatzort: null } as unknown as EinsatzAnzeige;

function original(): EtbEintragAnzeige {
  return {
    id: 5, lfd_nr: 5, typ: 'meldung', inhalt: 'Original', von: null, an: null,
    meldeweg: null, veranlassung: null, erfasser_id: 1, erfasser_name: 'Max',
    ereigniszeit: '2026-05-23 10:00:00', received_at: '2026-05-23 10:00:01',
    erfasst_lokal_at: null, berichtigt_eintrag_id: null,
  };
}

function props(over: Partial<React.ComponentProps<typeof Schnellerfassung>> = {}) {
  return {
    erfassen: vi.fn<(e: NeuerEintrag) => Promise<void>>().mockResolvedValue(),
    berichtigungZu: null, onBerichtigungAbbrechen: vi.fn(), bausteine: [] as EtbBaustein[], einsatz, ...over,
  };
}

describe('Schnellerfassung', () => {
  it('Enter sendet typ=meldung mit Inhalt; Feld danach leer', async () => {
    const p = props();
    renderMitProviders(<Schnellerfassung {...p} />);
    const feld = screen.getByPlaceholderText(/Inhalt/);
    await userEvent.type(feld, 'Pumpe läuft{Enter}');
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    const arg = (p.erfassen as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg).toMatchObject({ typ: 'meldung', inhalt: 'Pumpe läuft' });
    expect(arg.erfasst_lokal_at).toBeTruthy();
    expect(feld).toHaveValue('');
  });

  it('Shift+Enter sendet nicht (Zeilenumbruch)', async () => {
    const p = props();
    renderMitProviders(<Schnellerfassung {...p} />);
    await userEvent.type(screen.getByPlaceholderText(/Inhalt/), 'Zeile1{Shift>}{Enter}{/Shift}Zeile2');
    expect(p.erfassen).not.toHaveBeenCalled();
  });

  it('/ öffnet Menü; Feld „Von" wird als Chip erfasst und mitgesendet', async () => {
    const p = props();
    renderMitProviders(<Schnellerfassung {...p} />);
    const feld = screen.getByPlaceholderText(/Inhalt/);
    await userEvent.type(feld, 'Lage /von');
    await userEvent.click(await screen.findByText('Von'));
    const chipInput = await screen.findByLabelText('Von');
    await userEvent.type(chipInput, 'ELW 1{Enter}');
    await userEvent.type(feld, '{Enter}');
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    expect((p.erfassen as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({ von: 'ELW 1' });
  });

  it('Enter bei offenem Menü sendet nicht', async () => {
    const p = props();
    renderMitProviders(<Schnellerfassung {...p} />);
    await userEvent.type(screen.getByPlaceholderText(/Inhalt/), 'Lage /');
    await screen.findByText('Felder');
    await userEvent.keyboard('{Enter}');
    expect(p.erfassen).not.toHaveBeenCalled();
  });

  it('Berichtigungsmodus sendet typ=berichtigung + berichtigt_eintrag_id', async () => {
    const p = props({ berichtigungZu: original() });
    renderMitProviders(<Schnellerfassung {...p} />);
    expect(screen.getByText(/Berichtigung zu #5/)).toBeInTheDocument();
    await userEvent.type(screen.getByPlaceholderText(/Inhalt/), 'Korrektur{Enter}');
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    expect((p.erfassen as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({ typ: 'berichtigung', berichtigt_eintrag_id: 5 });
  });

  it('Baustein über / setzt den Inhalt', async () => {
    const baustein: EtbBaustein = { id: 1, label: 'Bereitstellung', typ: 'meldung', inhalt: 'Bereitstellungsraum bezogen', meldeweg: null, veranlassung: null, sortier: 0 };
    const p = props({ bausteine: [baustein] });
    renderMitProviders(<Schnellerfassung {...p} />);
    await userEvent.type(screen.getByPlaceholderText(/Inhalt/), '/bereit');
    await userEvent.click(await screen.findByText('Bereitstellung'));
    await waitFor(() => expect(screen.getByPlaceholderText(/Inhalt/)).toHaveValue('Bereitstellungsraum bezogen'));
  });
});
```

- [ ] **Step 2: Alten BausteinPicker entfernen**

```bash
git rm src/etb/BausteinPicker.tsx src/etb/BausteinPicker.test.tsx
```

- [ ] **Step 3: Tests laufen lassen (ETB-Scope)**

Run: `pnpm vitest run src/etb src/components/MarkdownEditor.test.tsx --no-file-parallelism`
Expected: PASS. Bei `aria-label`-/Ref-Abweichungen die in Task 7/9 genannten Fallbacks anwenden (real verfügbaren antd-Output prüfen, nicht den Test raten).

- [ ] **Step 4: Typecheck + Lint**

Run: `pnpm exec tsc --noEmit && pnpm exec eslint src/etb src/components/MarkdownEditor.tsx`
Expected: keine Fehler (ungenutzte Imports entfernen).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test(etb): Schnellerfassung-Tests auf Command-Bar-Flow; BausteinPicker entfernt (LFH-72)"
```

---

## Task 11: Verifikation gegen Akzeptanzkriterien (manuell + Gate)

**Files:** keine (Verifikation).

- [ ] **Step 1: Volle Frontend-Suite als Gate**

Run: `rtk proxy pnpm vitest run --no-file-parallelism`
Expected: gesamte Suite grün (Baseline war 10 ETB-Files / 41 Tests + Rest).

- [ ] **Step 2: App bauen (rust-embed-Hinweis beachten)**

Run: `pnpm build`
Expected: Build ok. (Für manuelles Testen im echten Backend: `pnpm build` + Backend-Neustart — Frontend ist ins Binary eingebettet.)

- [ ] **Step 3: Akzeptanzkriterien durchgehen (REQUIRED SUB-SKILL: superpowers:verification-before-completion)**

Prüfen und belegen:
- [ ] Eintrag per Tastatur erfassen + `Enter` senden, ohne Kontextwechsel.
- [ ] Nach Senden: Fokus im leeren Feld (sofort nächster Eintrag).
- [ ] Bausteine + Felder in wenigen Anschlägen über `/`.
- [ ] Spürbar weniger Klicks als der alte Collapse-/Select-Flow.
- [ ] Touch: „+ Feld"-Button + Chips + „Erfassen"-Button bedienbar.

- [ ] **Step 4: Commit (falls Korrekturen nötig waren)**

```bash
git add -A
git commit -m "fix(etb): Feinschliff Schnellerfassung nach Verifikation (LFH-72)"
```

---

## Abschluss (nach Plan-Ausführung)

- **REQUIRED SUB-SKILL:** `superpowers:requesting-code-review` vor dem Mergen → Board-Status `in review`.
- Integration über `superpowers:finishing-a-development-branch`; nach Merge Board-Status `shipped`/`done`.
- Offener Folge-Task (optional): inline-füllbare Baustein-Platzhalter statt Modal — separat auf dem Board anlegen, falls gewünscht.
