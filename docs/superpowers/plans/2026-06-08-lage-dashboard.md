# Lage-Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verdichtete Lageübersicht als Default-Landing-Page von `/einsaetze/:id` bauen (Modul `lage-dashboard`), Layout „Führungs-Cockpit", Kacheln als Deep-Links.

**Architecture:** Rein additives Frontend-Feature. Reine Aggregationsfunktionen (`lageVerdichtung.ts`) verdichten bestehende React-Query-Daten; präsentationsfreie Kacheln rendern das View-Model. Live-Aktualisierung über den bestehenden `useEinsatzLiveStream` (identische Query-Keys). Kein neues Backend.

**Tech Stack:** React 18, TypeScript, Ant Design v5, @tanstack/react-query, react-router-dom, Vitest + Testing Library + MSW.

**Spec:** `docs/superpowers/specs/2026-06-08-lage-dashboard-design.md`

**Konventionen (verifiziert):**
- Test-Command: `cd frontend && pnpm test` (= `vitest run`). Unter Last optional `pnpm test -- --no-file-parallelism` (Projekt-Memory). Einzeldatei: `pnpm test -- src/pfad/datei.test.ts`.
- Pure-Logik liegt neben der Page (Präzedenz: `src/pages/gefahren/gefahrenSchema.ts`). Daher alles unter `src/pages/lage-dashboard/`.
- Query-Keys MÜSSEN exakt den vom Live-Hook invalidierten Keys entsprechen (`src/etb/useEinsatzLiveStream.ts`), sonst keine Live-Aktualisierung.
- Tests mocken Endpunkte via MSW (`server.use(...)`) und `EventSource` via `vi.stubGlobal('EventSource', FakeEventSource)`.

**Datei-Struktur:**
- Create `frontend/src/personen/personMeta.ts` — geteilte SK-/Status-Farb-/Label-Maps (aus `PersonenPage` extrahiert).
- Create `frontend/src/personen/personMeta.test.ts`
- Modify `frontend/src/pages/PersonenPage.tsx` — nutzt `personMeta` statt lokaler Maps.
- Create `frontend/src/pages/lage-dashboard/lageVerdichtung.ts` — reine Aggregationsfunktionen + View-Model-Typen.
- Create `frontend/src/pages/lage-dashboard/lageVerdichtung.test.ts`
- Create `frontend/src/pages/lage-dashboard/KennzahlenLeiste.tsx`
- Create `frontend/src/pages/lage-dashboard/BetroffeneKachel.tsx`
- Create `frontend/src/pages/lage-dashboard/KraefteKachel.tsx`
- Create `frontend/src/pages/lage-dashboard/InfrastrukturKachel.tsx`
- Create `frontend/src/pages/lage-dashboard/LageberichtKachel.tsx`
- Create `frontend/src/pages/lage-dashboard/AuftraegeKachel.tsx`
- Create `frontend/src/pages/lage-dashboard/LageDashboardPage.tsx`
- Create `frontend/src/pages/lage-dashboard/LageDashboardPage.test.tsx`
- Modify `frontend/src/einsatz/modulRegistry.ts` — `lage-dashboard` Status `geplant` → `fertig`.
- Modify `frontend/src/einsatz/modulRegistry.test.ts` — `redirectZiel`-Erwartung an neuen Status anpassen.
- Modify `frontend/src/App.tsx` — `LageDashboardPage` importieren + in `MODUL_ELEMENTE` registrieren.

---

## Task 1: Geteiltes Person-Meta-Modul (SK-/Status-Maps extrahieren)

**Warum zuerst:** `SK_META` und `STATUS_META` sind aktuell lokal in `PersonenPage.tsx:15`/`:45`. Dashboard und PersonenPage sollen dieselbe Quelle nutzen (Spec: Farb-Konsistenz ist im BOS-Kontext eine Korrektheits-, keine Stilfrage).

**Files:**
- Create: `frontend/src/personen/personMeta.ts`
- Create: `frontend/src/personen/personMeta.test.ts`
- Modify: `frontend/src/pages/PersonenPage.tsx:15-51` (lokale Maps durch Import ersetzen)

- [ ] **Step 1: Failing test schreiben**

Create `frontend/src/personen/personMeta.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { SK_META, STATUS_META } from './personMeta';

describe('personMeta', () => {
  it('SK_META deckt alle Sichtungskategorien ab', () => {
    expect(Object.keys(SK_META).sort()).toEqual(
      ['sk1', 'sk2', 'sk3', 'sk4', 'tot', 'unverletzt'].sort(),
    );
    expect(SK_META.sk1).toEqual({ label: 'SK I', color: 'red' });
    expect(SK_META.tot).toEqual({ label: 'tot', color: 'black' });
  });

  it('STATUS_META deckt alle Personenstatus ab', () => {
    expect(Object.keys(STATUS_META).sort()).toEqual(
      ['abgemeldet', 'betroffen', 'erfasst', 'verstorben', 'vermisst'].sort(),
    );
    expect(STATUS_META.vermisst).toEqual({ label: 'vermisst', color: 'orange' });
  });
});
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run: `cd frontend && pnpm test -- src/personen/personMeta.test.ts`
Expected: FAIL — `Cannot find module './personMeta'`.

- [ ] **Step 3: Modul implementieren**

Create `frontend/src/personen/personMeta.ts`:

```typescript
import type { PersonStatus, Sichtungskategorie } from '../api/types';

/** Farbe + Label je Sichtungskategorie (antd-Tag-Farbnamen). Einzige Quelle (DRY). */
export const SK_META: Record<Sichtungskategorie, { label: string; color: string }> = {
  sk1: { label: 'SK I', color: 'red' },
  sk2: { label: 'SK II', color: 'gold' },
  sk3: { label: 'SK III', color: 'green' },
  sk4: { label: 'SK IV', color: 'blue' },
  tot: { label: 'tot', color: 'black' },
  unverletzt: { label: 'unverletzt', color: 'default' },
};

/** Farbe + Label je Personenstatus (antd-Tag-Farbnamen). */
export const STATUS_META: Record<PersonStatus, { label: string; color: string }> = {
  erfasst: { label: 'erfasst', color: 'default' },
  vermisst: { label: 'vermisst', color: 'orange' },
  betroffen: { label: 'betroffen', color: 'blue' },
  verstorben: { label: 'verstorben', color: 'red' },
  abgemeldet: { label: 'abgemeldet', color: 'green' },
};
```

- [ ] **Step 4: Test laufen lassen — muss bestehen**

Run: `cd frontend && pnpm test -- src/personen/personMeta.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: PersonenPage auf das geteilte Modul umstellen**

In `frontend/src/pages/PersonenPage.tsx` die lokalen Konstanten `SK_META` (ab Zeile 15) und `STATUS_META` (ab Zeile 45) **löschen** und stattdessen importieren. Import oben in der Importgruppe ergänzen:

```typescript
import { SK_META, STATUS_META } from '../personen/personMeta';
```

Wichtig: Nur die beiden `const SK_META = {...}` / `const STATUS_META = {...}`-Blöcke entfernen — alle Verwendungen (`SK_META[...]`, `STATUS_META[...]`) bleiben unverändert, da Namen und Form identisch sind. Falls die Maps die einzige Verwendung eines Typ-Imports (`Sichtungskategorie`/`PersonStatus`) in `PersonenPage.tsx` waren und der Linter ungenutzte Importe meldet, diesen Typimport entfernen.

- [ ] **Step 6: PersonenPage-Tests + neues Meta-Modul laufen lassen**

Run: `cd frontend && pnpm test -- src/pages/PersonenPage.test.tsx src/personen/personMeta.test.ts`
Expected: PASS (alle bestehenden PersonenPage-Tests grün, Meta-Tests grün). Kein Verhaltensunterschied erwartet.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/personen/personMeta.ts frontend/src/personen/personMeta.test.ts frontend/src/pages/PersonenPage.tsx
git commit -m "refactor(fe): SK-/Status-Meta in geteiltes Modul extrahieren (LFH-47)"
```

---

## Task 2: `verdichtePersonen` (Betroffene/Patienten/SK/Status)

**Files:**
- Create: `frontend/src/pages/lage-dashboard/lageVerdichtung.ts`
- Create: `frontend/src/pages/lage-dashboard/lageVerdichtung.test.ts`

- [ ] **Step 1: Failing test schreiben**

Create `frontend/src/pages/lage-dashboard/lageVerdichtung.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import type { Person } from '../../api/types';
import { verdichtePersonen } from './lageVerdichtung';

function person(p: Partial<Person>): Person {
  return {
    id: 1, einsatz_id: 1, registrier_nr: 1, status: 'erfasst',
    name: null, vorname: null, geschlecht: null, geburtsdatum: null,
    alter_geschaetzt: null, herkunft_adresse: null, antreff_ort: null,
    melder_kontakt: null, notiz: null, erfasst_at: '2026-06-08 10:00:00',
    erfasst_von: 1, geaendert_at: '2026-06-08 10:00:00', geaendert_von: 1,
    storniert_at: null, aktuelle_sichtung: null, aktuelle_sichtung_at: null,
    aktueller_verbleib: null, aktuelle_uhs_id: null, aktueller_platz_id: null,
    ...p,
  };
}

describe('verdichtePersonen', () => {
  it('leere Liste → alles 0', () => {
    const v = verdichtePersonen([]);
    expect(v.gesamt).toBe(0);
    expect(v.patienten).toBe(0);
    expect(v.vermisst).toBe(0);
    expect(v.sk).toEqual({ sk1: 0, sk2: 0, sk3: 0, sk4: 0, tot: 0, unverletzt: 0, ohne: 0 });
    expect(v.status).toEqual({ erfasst: 0, vermisst: 0, betroffen: 0, verstorben: 0, abgemeldet: 0 });
  });

  it('zählt SK-Verteilung und Patienten (nur SK I–IV)', () => {
    const v = verdichtePersonen([
      person({ aktuelle_sichtung: 'sk1' }),
      person({ aktuelle_sichtung: 'sk1' }),
      person({ aktuelle_sichtung: 'sk3' }),
      person({ aktuelle_sichtung: 'tot' }),
      person({ aktuelle_sichtung: 'unverletzt' }),
      person({ aktuelle_sichtung: null }),
    ]);
    expect(v.sk.sk1).toBe(2);
    expect(v.sk.sk3).toBe(1);
    expect(v.sk.tot).toBe(1);
    expect(v.sk.unverletzt).toBe(1);
    expect(v.sk.ohne).toBe(1);
    expect(v.patienten).toBe(3); // sk1*2 + sk3*1, NICHT tot/unverletzt/ohne
    expect(v.gesamt).toBe(6);
  });

  it('zählt Status-Verteilung und Vermisste', () => {
    const v = verdichtePersonen([
      person({ status: 'vermisst' }),
      person({ status: 'vermisst' }),
      person({ status: 'betroffen' }),
      person({ status: 'verstorben' }),
    ]);
    expect(v.status.vermisst).toBe(2);
    expect(v.status.betroffen).toBe(1);
    expect(v.status.verstorben).toBe(1);
    expect(v.vermisst).toBe(2);
  });
});
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run: `cd frontend && pnpm test -- src/pages/lage-dashboard/lageVerdichtung.test.ts`
Expected: FAIL — `Cannot find module './lageVerdichtung'`.

- [ ] **Step 3: `lageVerdichtung.ts` mit `verdichtePersonen` anlegen**

Create `frontend/src/pages/lage-dashboard/lageVerdichtung.ts`:

```typescript
import type { Person } from '../../api/types';

export interface SkVerteilung {
  sk1: number; sk2: number; sk3: number; sk4: number;
  tot: number; unverletzt: number;
  /** Personen ohne Sichtung (aktuelle_sichtung === null). */
  ohne: number;
}

export interface PersonStatusVerteilung {
  erfasst: number; vermisst: number; betroffen: number;
  verstorben: number; abgemeldet: number;
}

export interface BetroffeneVerdichtung {
  sk: SkVerteilung;
  status: PersonStatusVerteilung;
  /** Personen mit Sichtung SK I–IV (medizinisch/triage-relevant). */
  patienten: number;
  vermisst: number;
  gesamt: number;
}

export function verdichtePersonen(personen: Person[]): BetroffeneVerdichtung {
  const sk: SkVerteilung = { sk1: 0, sk2: 0, sk3: 0, sk4: 0, tot: 0, unverletzt: 0, ohne: 0 };
  const status: PersonStatusVerteilung = {
    erfasst: 0, vermisst: 0, betroffen: 0, verstorben: 0, abgemeldet: 0,
  };
  for (const p of personen) {
    if (p.aktuelle_sichtung === null) sk.ohne += 1;
    else sk[p.aktuelle_sichtung] += 1;
    status[p.status] += 1;
  }
  return {
    sk,
    status,
    patienten: sk.sk1 + sk.sk2 + sk.sk3 + sk.sk4,
    vermisst: status.vermisst,
    gesamt: personen.length,
  };
}
```

- [ ] **Step 4: Test laufen lassen — muss bestehen**

Run: `cd frontend && pnpm test -- src/pages/lage-dashboard/lageVerdichtung.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/lage-dashboard/lageVerdichtung.ts frontend/src/pages/lage-dashboard/lageVerdichtung.test.ts
git commit -m "feat(fe): verdichtePersonen für Lage-Dashboard (LFH-47)"
```

---

## Task 3: Gefahren-Verdichtung (`hoechsteWarnstufe`, `verdichteGefahren`)

**Files:**
- Modify: `frontend/src/pages/lage-dashboard/lageVerdichtung.ts`
- Modify: `frontend/src/pages/lage-dashboard/lageVerdichtung.test.ts`

- [ ] **Step 1: Failing test ergänzen**

In `frontend/src/pages/lage-dashboard/lageVerdichtung.test.ts` den Import erweitern und einen neuen `describe`-Block anhängen:

```typescript
import type { GefahrBewertung } from '../../api/types';
import { hoechsteWarnstufe, verdichteGefahren } from './lageVerdichtung';

function bewertung(warnstufe: GefahrBewertung['warnstufe']): GefahrBewertung {
  return {
    id: 1, einsatz_id: 1, gefahrentyp: 'atemgifte', schutzobjekt: 'menschen',
    warnstufe, beschreibung: null, gemeldet_von: null, aktualisiert_von: 1,
    erstellt_at: '2026-06-08 10:00:00', geaendert_at: '2026-06-08 10:00:00',
  };
}

describe('hoechsteWarnstufe', () => {
  it('leere Liste → keine', () => {
    expect(hoechsteWarnstufe([])).toBe('keine');
  });
  it('liefert ordinales Maximum', () => {
    expect(hoechsteWarnstufe([bewertung('niedrig'), bewertung('hoch'), bewertung('mittel')])).toBe('hoch');
    expect(hoechsteWarnstufe([bewertung('akut'), bewertung('hoch')])).toBe('akut');
  });
  it('nur keine → keine', () => {
    expect(hoechsteWarnstufe([bewertung('keine'), bewertung('keine')])).toBe('keine');
  });
});

describe('verdichteGefahren', () => {
  it('zählt aktive (warnstufe !== keine) und höchste', () => {
    const v = verdichteGefahren([bewertung('keine'), bewertung('mittel'), bewertung('hoch')]);
    expect(v.hoechste).toBe('hoch');
    expect(v.anzahlAktiv).toBe(2);
  });
  it('leere Liste → keine / 0', () => {
    expect(verdichteGefahren([])).toEqual({ hoechste: 'keine', anzahlAktiv: 0 });
  });
});
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run: `cd frontend && pnpm test -- src/pages/lage-dashboard/lageVerdichtung.test.ts`
Expected: FAIL — `hoechsteWarnstufe is not a function` / Import nicht auflösbar.

- [ ] **Step 3: Funktionen in `lageVerdichtung.ts` ergänzen**

Am Ende von `frontend/src/pages/lage-dashboard/lageVerdichtung.ts` anfügen (Import oben um `GefahrBewertung`, `Warnstufe` erweitern):

```typescript
import type { GefahrBewertung, Warnstufe } from '../../api/types';

const WARNSTUFE_RANG: Record<Warnstufe, number> = {
  keine: 0, niedrig: 1, mittel: 2, hoch: 3, akut: 4,
};

/** Ordinales Maximum aller Warnstufen; 'keine' wenn leer. */
export function hoechsteWarnstufe(bewertungen: GefahrBewertung[]): Warnstufe {
  let max: Warnstufe = 'keine';
  for (const b of bewertungen) {
    if (WARNSTUFE_RANG[b.warnstufe] > WARNSTUFE_RANG[max]) max = b.warnstufe;
  }
  return max;
}

export interface GefahrVerdichtung {
  hoechste: Warnstufe;
  /** Anzahl Bewertungen mit Warnstufe !== 'keine'. */
  anzahlAktiv: number;
}

export function verdichteGefahren(bewertungen: GefahrBewertung[]): GefahrVerdichtung {
  return {
    hoechste: hoechsteWarnstufe(bewertungen),
    anzahlAktiv: bewertungen.filter((b) => b.warnstufe !== 'keine').length,
  };
}
```

Hinweis: Die zwei `import type`-Zeilen zu einer zusammenfassen, falls der Linter doppelte Importquellen moniert: `import type { GefahrBewertung, Person, Warnstufe } from '../../api/types';`.

- [ ] **Step 4: Test laufen lassen — muss bestehen**

Run: `cd frontend && pnpm test -- src/pages/lage-dashboard/lageVerdichtung.test.ts`
Expected: PASS (alle bisherigen + 5 neue Tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/lage-dashboard/lageVerdichtung.ts frontend/src/pages/lage-dashboard/lageVerdichtung.test.ts
git commit -m "feat(fe): Gefahren-Verdichtung (höchste Warnstufe) (LFH-47)"
```

---

## Task 4: `neuesterLagebericht`

**Files:**
- Modify: `frontend/src/pages/lage-dashboard/lageVerdichtung.ts`
- Modify: `frontend/src/pages/lage-dashboard/lageVerdichtung.test.ts`

- [ ] **Step 1: Failing test ergänzen**

Import erweitern und `describe`-Block anhängen in `lageVerdichtung.test.ts`:

```typescript
import type { LageberichtAnzeige } from '../../api/types';
import { neuesterLagebericht } from './lageVerdichtung';

function bericht(p: Partial<LageberichtAnzeige>): LageberichtAnzeige {
  return {
    id: 1, einsatz_id: 1, vorlage: 'freitext', titel: 'Bericht', zeitstand: '2026-06-08 10:00:00',
    status: 'entwurf', abschnitte: [], version: 1, vorgaenger_id: null,
    ersteller_id: 1, ersteller_name: 'Müller', erstellt_at: '2026-06-08 10:00:00',
    aktualisiert_at: '2026-06-08 10:00:00', freigegeben_von_id: null,
    freigegeben_von_name: null, freigegeben_at: null, etb_eintrag_id: null,
    ...p,
  };
}

describe('neuesterLagebericht', () => {
  it('leere Liste → null', () => {
    expect(neuesterLagebericht([])).toBeNull();
  });
  it('liefert den Bericht mit dem jüngsten erstellt_at', () => {
    const a = bericht({ id: 1, erstellt_at: '2026-06-08 10:00:00' });
    const b = bericht({ id: 2, erstellt_at: '2026-06-08 14:30:00' });
    const c = bericht({ id: 3, erstellt_at: '2026-06-08 12:00:00' });
    expect(neuesterLagebericht([a, b, c])?.id).toBe(2);
  });
});
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run: `cd frontend && pnpm test -- src/pages/lage-dashboard/lageVerdichtung.test.ts`
Expected: FAIL — `neuesterLagebericht is not a function`.

- [ ] **Step 3: Funktion ergänzen**

Am Ende von `lageVerdichtung.ts` anfügen (Import um `LageberichtAnzeige` erweitern):

```typescript
import type { LageberichtAnzeige } from '../../api/types';

/**
 * Jüngster Lagebericht nach `erstellt_at`. Das Format 'YYYY-MM-DD HH:MM:SS' ist
 * lexikografisch sortierbar. Null bei leerer Liste.
 */
export function neuesterLagebericht(berichte: LageberichtAnzeige[]): LageberichtAnzeige | null {
  if (berichte.length === 0) return null;
  return berichte.reduce((neuester, b) => (b.erstellt_at > neuester.erstellt_at ? b : neuester));
}
```

- [ ] **Step 4: Test laufen lassen — muss bestehen**

Run: `cd frontend && pnpm test -- src/pages/lage-dashboard/lageVerdichtung.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/lage-dashboard/lageVerdichtung.ts frontend/src/pages/lage-dashboard/lageVerdichtung.test.ts
git commit -m "feat(fe): neuesterLagebericht für Lage-Dashboard (LFH-47)"
```

---

## Task 5: `verdichteTiere`, `verdichteUhs`, `verdichteSchaeden`

**Files:**
- Modify: `frontend/src/pages/lage-dashboard/lageVerdichtung.ts`
- Modify: `frontend/src/pages/lage-dashboard/lageVerdichtung.test.ts`

- [ ] **Step 1: Failing test ergänzen**

Import erweitern und `describe`-Block anhängen:

```typescript
import type { Schaden, Tier, Uhs } from '../../api/types';
import { verdichteSchaeden, verdichteTiere, verdichteUhs } from './lageVerdichtung';

describe('einfache Status-Zählungen', () => {
  it('verdichteTiere zählt nach Status', () => {
    const t = (status: Tier['status']): Tier => ({
      id: 1, einsatz_id: 1, registrier_nr: 1, status, spezies: 'hund',
      rasse_beschreibung: null, rufname: null, geschlecht: null, alter_geschaetzt: null,
      farbe_beschreibung: null, kennzeichnung: null, groesse_gewicht: null,
      halter_person_id: null, halter_kontakt: null, antreff_ort: null, notiz: null,
      abschluss_grund: null, abschluss_ziel: null, erfasst_at: '2026-06-08 10:00:00',
      erfasst_von: 1, geaendert_at: '2026-06-08 10:00:00', geaendert_von: 1,
      storniert_at: null, halter_registrier_nr: null, halter_storniert_at: null,
    });
    expect(verdichteTiere([])).toEqual({ aktiv: 0, vermisst: 0, abgeschlossen: 0, gesamt: 0 });
    expect(verdichteTiere([t('aktiv'), t('aktiv'), t('vermisst')]))
      .toEqual({ aktiv: 2, vermisst: 1, abgeschlossen: 0, gesamt: 3 });
  });

  it('verdichteUhs zählt nach Status', () => {
    const u = (status: Uhs['status']): Uhs => ({
      id: 1, einsatz_id: 1, abschnitt_id: null, typ: 'behandlungsplatz',
      bezeichnung: 'BHP', standort: null, notiz: null, lat: null, lon: null, status,
      erfasst_at: '2026-06-08 10:00:00', erfasst_von: 1,
      geaendert_at: '2026-06-08 10:00:00', geaendert_von: 1, storniert_at: null,
    });
    expect(verdichteUhs([])).toEqual({ geplant: 0, aktiv: 0, aufgeloest: 0, gesamt: 0 });
    expect(verdichteUhs([u('aktiv'), u('aktiv'), u('geplant')]))
      .toEqual({ geplant: 1, aktiv: 2, aufgeloest: 0, gesamt: 3 });
  });

  it('verdichteSchaeden zählt nach Status', () => {
    const s = (status: Schaden['status']): Schaden => ({
      id: 1, einsatz_id: 1, registrier_nr: 1, status, typ: 'gebaeude', ausmass: 'mittel',
      ort: 'X', lat: null, lon: null, beschreibung: '', geschaedigt_person_id: null,
      geschaedigt_personal_id: null, geschaedigt_organisation_id: null, geschaedigt_kontakt: null,
      uebergeben_an: null, uebergeben_at: null, abschluss_grund: null, abschluss_at: null,
      erfasst_at: '2026-06-08 10:00:00', erfasst_von: 1, geaendert_at: '2026-06-08 10:00:00',
      geaendert_von: 1, storniert_at: null, storniert_von: null, geschaedigt_registrier_nr: null,
      geschaedigt_storniert_at: null, geschaedigt_personal_name: null, geschaedigt_organisation_name: null,
    });
    expect(verdichteSchaeden([])).toEqual({ offen: 0, uebergeben: 0, abgeschlossen: 0, gesamt: 0 });
    expect(verdichteSchaeden([s('offen'), s('offen'), s('abgeschlossen')]))
      .toEqual({ offen: 2, uebergeben: 0, abgeschlossen: 1, gesamt: 3 });
  });
});
```

Hinweis: `typ: 'gebaeude'` ist ein gültiger `SchadenTyp`-Wert; falls TypeScript hier meckert, einen beliebigen gültigen Wert aus `SchadenTyp` (siehe `frontend/src/api/types.ts`) einsetzen — der Wert ist für die Status-Zählung irrelevant.

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run: `cd frontend && pnpm test -- src/pages/lage-dashboard/lageVerdichtung.test.ts`
Expected: FAIL — Funktionen nicht definiert.

- [ ] **Step 3: Funktionen ergänzen**

Am Ende von `lageVerdichtung.ts` anfügen (Import um `Schaden`, `Tier`, `Uhs` erweitern):

```typescript
import type { Schaden, Tier, Uhs } from '../../api/types';

export interface TierVerdichtung { aktiv: number; vermisst: number; abgeschlossen: number; gesamt: number; }
export function verdichteTiere(tiere: Tier[]): TierVerdichtung {
  const v: TierVerdichtung = { aktiv: 0, vermisst: 0, abgeschlossen: 0, gesamt: tiere.length };
  for (const t of tiere) v[t.status] += 1;
  return v;
}

export interface UhsVerdichtung { geplant: number; aktiv: number; aufgeloest: number; gesamt: number; }
export function verdichteUhs(uhs: Uhs[]): UhsVerdichtung {
  const v: UhsVerdichtung = { geplant: 0, aktiv: 0, aufgeloest: 0, gesamt: uhs.length };
  for (const u of uhs) v[u.status] += 1;
  return v;
}

export interface SchadenVerdichtung { offen: number; uebergeben: number; abgeschlossen: number; gesamt: number; }
export function verdichteSchaeden(schaeden: Schaden[]): SchadenVerdichtung {
  const v: SchadenVerdichtung = { offen: 0, uebergeben: 0, abgeschlossen: 0, gesamt: schaeden.length };
  for (const s of schaeden) v[s.status] += 1;
  return v;
}
```

- [ ] **Step 4: Test laufen lassen — muss bestehen**

Run: `cd frontend && pnpm test -- src/pages/lage-dashboard/lageVerdichtung.test.ts`
Expected: PASS (alle Verdichtungs-Tests grün).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/lage-dashboard/lageVerdichtung.ts frontend/src/pages/lage-dashboard/lageVerdichtung.test.ts
git commit -m "feat(fe): Tier-/UHS-/Schaden-Verdichtung (LFH-47)"
```

---

## Task 6: Präsentations-Kacheln + LageDashboardPage (TDD über Page-Test)

Die Kacheln sind reine Präsentationskomponenten (Props → UI), getestet über den Integrationstest der Page. Reihenfolge: erst Page-Test (rot), dann Kacheln + Page implementieren (grün).

**Files:**
- Create: `frontend/src/pages/lage-dashboard/KennzahlenLeiste.tsx`
- Create: `frontend/src/pages/lage-dashboard/BetroffeneKachel.tsx`
- Create: `frontend/src/pages/lage-dashboard/KraefteKachel.tsx`
- Create: `frontend/src/pages/lage-dashboard/InfrastrukturKachel.tsx`
- Create: `frontend/src/pages/lage-dashboard/LageberichtKachel.tsx`
- Create: `frontend/src/pages/lage-dashboard/AuftraegeKachel.tsx`
- Create: `frontend/src/pages/lage-dashboard/LageDashboardPage.tsx`
- Create: `frontend/src/pages/lage-dashboard/LageDashboardPage.test.tsx`

- [ ] **Step 1: Failing Page-Test schreiben**

Create `frontend/src/pages/lage-dashboard/LageDashboardPage.test.tsx`:

```typescript
import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { server } from '../../test/server';
import { renderMitProviders } from '../../test/utils';
import LageDashboardPage from './LageDashboardPage';

class FakeEventSource {
  url: string; closed = false;
  constructor(url: string) { this.url = url; }
  addEventListener() {} removeEventListener() {} close() { this.closed = true; }
}
beforeEach(() => vi.stubGlobal('EventSource', FakeEventSource));
afterEach(() => vi.unstubAllGlobals());

const einsatz = {
  id: 1, bezeichnung: 'Hochwasser Musterstadt', stichwort: 'TH Hochwasser', status: 'aktiv',
  begonnen_at: '2026-06-08 06:12:00', abgeschlossen_at: null, abgeschlossen_von: null,
  einsatzart: 'realeinsatz', einsatznummer_intern: null, angelegt_at: '2026-06-08 06:12:00',
  leitstellen_nr: null, einsatzort: null, einsatzort_lat: null, einsatzort_lon: null,
  meldende_stelle: null, sachverhalt: null, anzahl_betroffene_initial: null,
  meine_rolle: 'einsatzleitung', org_id: 1, org_name: 'THW Musterstadt',
};

const person = (sichtung: string | null, status = 'betroffen') => ({
  id: Math.floor(Math.random() * 1e9), einsatz_id: 1, registrier_nr: 1, status,
  name: null, vorname: null, geschlecht: null, geburtsdatum: null, alter_geschaetzt: null,
  herkunft_adresse: null, antreff_ort: null, melder_kontakt: null, notiz: null,
  erfasst_at: '2026-06-08 09:00:00', erfasst_von: 1, geaendert_at: '2026-06-08 09:00:00',
  geaendert_von: 1, storniert_at: null, aktuelle_sichtung: sichtung, aktuelle_sichtung_at: null,
  aktueller_verbleib: null, aktuelle_uhs_id: null, aktueller_platz_id: null,
});

interface Daten {
  personen?: unknown[]; uhs?: unknown[]; schaeden?: unknown[]; tiere?: unknown[];
  gefahren?: unknown[]; zonen?: unknown[]; lageberichte?: unknown[];
  einheiten?: unknown[]; personal?: unknown[]; fahrzeuge?: unknown[];
  material?: unknown[]; abschnitte?: unknown[];
  gefahrenStatus?: number; // optionaler HTTP-Fehlercode für die Gefahrenmatrix
}

function mockEndpunkte(d: Daten) {
  const json = (arr?: unknown[]) => HttpResponse.json(arr ?? []);
  server.use(
    http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz)),
    http.get('/api/einsaetze/1/personen', () => json(d.personen)),
    http.get('/api/einsaetze/1/uhs', () => json(d.uhs)),
    http.get('/api/einsaetze/1/schaeden', () => json(d.schaeden)),
    http.get('/api/einsaetze/1/tiere', () => json(d.tiere)),
    http.get('/api/einsaetze/1/gefahrenmatrix', () =>
      d.gefahrenStatus ? new HttpResponse(null, { status: d.gefahrenStatus }) : json(d.gefahren)),
    http.get('/api/einsaetze/1/zonen', () => json(d.zonen)),
    http.get('/api/einsaetze/1/lageberichte', () => json(d.lageberichte)),
    http.get('/api/einsaetze/1/einheiten', () => json(d.einheiten)),
    http.get('/api/einsaetze/1/personal', () => json(d.personal)),
    http.get('/api/einsaetze/1/fahrzeuge', () => json(d.fahrzeuge)),
    http.get('/api/einsaetze/1/material', () => json(d.material)),
    http.get('/api/einsaetze/1/abschnitte', () => json(d.abschnitte)),
  );
}

function render() {
  return renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/lage-dashboard" element={<LageDashboardPage />} />
      <Route path="/einsaetze/:id/personen" element={<div>PERSONEN-MODUL</div>} />
    </Routes>,
    { route: '/einsaetze/1/lage-dashboard' },
  );
}

describe('LageDashboardPage', () => {
  it('zeigt den Einsatz-Kopf und die Leitzahlen', async () => {
    mockEndpunkte({
      personen: [person('sk1'), person('sk1'), person('sk3'), person(null, 'vermisst')],
      schaeden: [{ ...{}, id: 1, einsatz_id: 1, registrier_nr: 1, status: 'offen', typ: 'gebaeude',
        ausmass: 'mittel', ort: 'X', lat: null, lon: null, beschreibung: '',
        geschaedigt_person_id: null, geschaedigt_personal_id: null, geschaedigt_organisation_id: null,
        geschaedigt_kontakt: null, uebergeben_an: null, uebergeben_at: null, abschluss_grund: null,
        abschluss_at: null, erfasst_at: '2026-06-08 10:00:00', erfasst_von: 1,
        geaendert_at: '2026-06-08 10:00:00', geaendert_von: 1, storniert_at: null, storniert_von: null,
        geschaedigt_registrier_nr: null, geschaedigt_storniert_at: null,
        geschaedigt_personal_name: null, geschaedigt_organisation_name: null }],
    });
    render();
    expect(await screen.findByText('Hochwasser Musterstadt')).toBeInTheDocument();
    // Patienten-Leitzahl = sk1*2 + sk3 = 3
    expect(await screen.findByText('Patienten (SK I–IV)')).toBeInTheDocument();
    const patienten = screen.getByText('Patienten (SK I–IV)').closest('.ant-statistic');
    expect(patienten).toHaveTextContent('3');
  });

  it('Leerzustand: null Daten → Dashboard rendert ohne Crash, Aufträge-Platzhalter sichtbar', async () => {
    mockEndpunkte({});
    render();
    expect(await screen.findByText('Hochwasser Musterstadt')).toBeInTheDocument();
    expect(screen.getByText(/Aufträge-Modul/i)).toBeInTheDocument();
  });

  it('Deep-Link: Klick auf Patienten-Leitzahl navigiert ins Personen-Modul', async () => {
    mockEndpunkte({ personen: [person('sk1')] });
    render();
    const patienten = await screen.findByText('Patienten (SK I–IV)');
    await userEvent.click(patienten);
    expect(await screen.findByText('PERSONEN-MODUL')).toBeInTheDocument();
  });

  it('Fehler-Resilienz: Gefahrenmatrix-Fehler → nur diese Kachel zeigt „—", Rest steht', async () => {
    mockEndpunkte({ personen: [person('sk1')], gefahrenStatus: 500 });
    render();
    expect(await screen.findByText('Hochwasser Musterstadt')).toBeInTheDocument();
    // Patienten weiterhin korrekt (1)
    const patienten = screen.getByText('Patienten (SK I–IV)').closest('.ant-statistic');
    expect(patienten).toHaveTextContent('1');
    // Warnstufe-Leitzahl zeigt „—"
    const warnstufe = screen.getByText('Höchste Warnstufe').closest('.ant-statistic');
    expect(warnstufe).toHaveTextContent('—');
  });
});
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run: `cd frontend && pnpm test -- src/pages/lage-dashboard/LageDashboardPage.test.tsx`
Expected: FAIL — `Cannot find module './LageDashboardPage'`.

- [ ] **Step 3: `AuftraegeKachel.tsx` anlegen**

Create `frontend/src/pages/lage-dashboard/AuftraegeKachel.tsx`:

```tsx
import { Card, Empty } from 'antd';

/**
 * Platzhalter: Das Aufträge-Modul (Backend) existiert noch nicht (Status 'geplant').
 * Die Kachel zeigt die geplante Struktur, bis die Daten verfügbar sind.
 */
export default function AuftraegeKachel() {
  return (
    <Card size="small" title="Aufträge / Befehle" style={{ height: '100%' }}>
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="Kommt mit dem Aufträge-Modul"
      />
    </Card>
  );
}
```

- [ ] **Step 4: `KennzahlenLeiste.tsx` anlegen**

Create `frontend/src/pages/lage-dashboard/KennzahlenLeiste.tsx`:

```tsx
import { Card, Space, Statistic } from 'antd';
import type { Warnstufe } from '../../api/types';
import type { Verdichtung } from '../../kraefte/kraeftebild';
import { staerkeText } from '../../kraefte/kraeftebild';

/** Lesbare Textfarbe je Warnstufe (die Matrix nutzt Hintergrundfarben; hier Text). */
const WARNSTUFE_TEXTFARBE: Record<Warnstufe, string | undefined> = {
  keine: undefined, niedrig: '#d4b106', mittel: '#d46b08', hoch: '#cf1322', akut: '#cf1322',
};
const WARNSTUFE_LABEL: Record<Warnstufe, string> = {
  keine: 'keine', niedrig: 'niedrig', mittel: 'mittel', hoch: 'hoch', akut: 'akut',
};

interface Props {
  kraefte: Verdichtung | null;
  patienten: number | null;
  vermisst: number | null;
  warnstufe: Warnstufe | null;
  schaedenOffen: number | null;
  uhsAktiv: number | null;
  onNavigate: (route: string) => void;
}

const STRICH = '—';

function Kennzahl(props: {
  titel: string; value: string | number; farbe?: string; onClick: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={props.onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') props.onClick(); }}
      style={{ cursor: 'pointer' }}
    >
      <Statistic
        title={props.titel}
        value={props.value}
        valueStyle={props.farbe ? { color: props.farbe } : undefined}
      />
    </div>
  );
}

export default function KennzahlenLeiste(props: Props) {
  const { kraefte, patienten, vermisst, warnstufe, schaedenOffen, uhsAktiv, onNavigate } = props;
  return (
    <Card size="small" style={{ marginBottom: 16 }} styles={{ body: { overflowX: 'auto' } }}>
      <Space size="large" align="start" style={{ flexWrap: 'nowrap' }}>
        <Kennzahl
          titel="Kräfte (F/UF/M/Ges)"
          value={kraefte ? staerkeText(kraefte.staerke) : STRICH}
          onClick={() => onNavigate('kraefteuebersicht')}
        />
        <Kennzahl
          titel="Patienten (SK I–IV)"
          value={patienten ?? STRICH}
          onClick={() => onNavigate('personen')}
        />
        <Kennzahl
          titel="Vermisst"
          value={vermisst ?? STRICH}
          onClick={() => onNavigate('personen')}
        />
        <Kennzahl
          titel="Höchste Warnstufe"
          value={warnstufe ? WARNSTUFE_LABEL[warnstufe] : STRICH}
          farbe={warnstufe ? WARNSTUFE_TEXTFARBE[warnstufe] : undefined}
          onClick={() => onNavigate('gefahren')}
        />
        <Kennzahl
          titel="Schäden offen"
          value={schaedenOffen ?? STRICH}
          onClick={() => onNavigate('schaeden')}
        />
        <Kennzahl
          titel="UHS aktiv"
          value={uhsAktiv ?? STRICH}
          onClick={() => onNavigate('unfallhilfsstellen')}
        />
      </Space>
    </Card>
  );
}
```

- [ ] **Step 5: `BetroffeneKachel.tsx` anlegen**

Create `frontend/src/pages/lage-dashboard/BetroffeneKachel.tsx`:

```tsx
import { Card, Empty, Space, Tag, Typography } from 'antd';
import type { Sichtungskategorie } from '../../api/types';
import { SK_META, STATUS_META } from '../../personen/personMeta';
import type { BetroffeneVerdichtung } from './lageVerdichtung';

interface Props {
  betroffene: BetroffeneVerdichtung | null;
  onNavigate: (route: string) => void;
}

const SK_REIHENFOLGE: Sichtungskategorie[] = ['sk1', 'sk2', 'sk3', 'sk4', 'tot', 'unverletzt'];

export default function BetroffeneKachel({ betroffene, onNavigate }: Props) {
  return (
    <Card
      size="small"
      title="Betroffene"
      hoverable
      onClick={() => onNavigate('personen')}
      style={{ height: '100%', cursor: 'pointer' }}
    >
      {betroffene === null ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Daten nicht verfügbar" />
      ) : (
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          <Typography.Text type="secondary">{betroffene.gesamt} Personen erfasst</Typography.Text>
          <Space size={4} wrap>
            {SK_REIHENFOLGE.map((sk) => (
              <Tag key={sk} color={SK_META[sk].color === 'default' ? undefined : SK_META[sk].color}>
                {SK_META[sk].label} {betroffene.sk[sk]}
              </Tag>
            ))}
          </Space>
          <Space size={4} wrap>
            <Tag color={STATUS_META.vermisst.color}>vermisst {betroffene.status.vermisst}</Tag>
            <Tag color={STATUS_META.betroffen.color}>betroffen {betroffene.status.betroffen}</Tag>
            <Tag color={STATUS_META.verstorben.color}>verstorben {betroffene.status.verstorben}</Tag>
          </Space>
        </Space>
      )}
    </Card>
  );
}
```

- [ ] **Step 6: `KraefteKachel.tsx` anlegen**

Create `frontend/src/pages/lage-dashboard/KraefteKachel.tsx`:

```tsx
import { Card, Empty, Space, Statistic, Tag, Typography } from 'antd';
import type { Verdichtung } from '../../kraefte/kraeftebild';
import { staerkeText } from '../../kraefte/kraeftebild';

interface Props {
  kraefte: Verdichtung | null;
  einheiten: number | null;
  abschnitte: number | null;
  onNavigate: (route: string) => void;
}

export default function KraefteKachel({ kraefte, einheiten, abschnitte, onNavigate }: Props) {
  return (
    <Card
      size="small"
      title="Kräfte"
      hoverable
      onClick={() => onNavigate('kraefteuebersicht')}
      style={{ height: '100%', cursor: 'pointer' }}
    >
      {kraefte === null ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Daten nicht verfügbar" />
      ) : (
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          <Statistic title="Gesamtstärke (F/UF/M/Ges)" value={staerkeText(kraefte.staerke)} />
          <Space size={4} wrap>
            <Tag color="green">{kraefte.fahrzeugStatus.verfuegbar} Fzg frei</Tag>
            <Tag color="gold">{kraefte.fahrzeugStatus.gebunden} geb.</Tag>
            <Tag color="red">{kraefte.fahrzeugStatus.nicht_verfuegbar} n.v.</Tag>
          </Space>
          <Typography.Text type="secondary">
            {einheiten ?? 0} Einheiten · {abschnitte ?? 0} Abschnitte
          </Typography.Text>
        </Space>
      )}
    </Card>
  );
}
```

- [ ] **Step 7: `InfrastrukturKachel.tsx` anlegen**

Create `frontend/src/pages/lage-dashboard/InfrastrukturKachel.tsx`:

```tsx
import { Card, Space, Typography } from 'antd';
import type { SchadenVerdichtung, TierVerdichtung, UhsVerdichtung } from './lageVerdichtung';

interface Props {
  uhs: UhsVerdichtung | null;
  schaeden: SchadenVerdichtung | null;
  tiere: TierVerdichtung | null;
  zonen: number | null;
  onNavigate: (route: string) => void;
}

const STRICH = '—';
const zeile = (label: string, wert: string) => (
  <Typography.Text>{label}: {wert}</Typography.Text>
);

export default function InfrastrukturKachel({ uhs, schaeden, tiere, zonen, onNavigate }: Props) {
  return (
    <Card size="small" title="Infrastruktur & Gefahren" style={{ height: '100%' }}>
      <Space direction="vertical" size={6} style={{ width: '100%' }}>
        <div role="button" tabIndex={0} style={{ cursor: 'pointer' }}
          onClick={() => onNavigate('unfallhilfsstellen')}
          onKeyDown={(e) => { if (e.key === 'Enter') onNavigate('unfallhilfsstellen'); }}>
          {uhs ? zeile('UHS', `${uhs.gesamt} (${uhs.aktiv} aktiv)`) : zeile('UHS', STRICH)}
        </div>
        <div role="button" tabIndex={0} style={{ cursor: 'pointer' }}
          onClick={() => onNavigate('schaeden')}
          onKeyDown={(e) => { if (e.key === 'Enter') onNavigate('schaeden'); }}>
          {schaeden
            ? zeile('Schäden', `${schaeden.offen} offen · ${schaeden.uebergeben} überg. · ${schaeden.abgeschlossen} erl.`)
            : zeile('Schäden', STRICH)}
        </div>
        <div role="button" tabIndex={0} style={{ cursor: 'pointer' }}
          onClick={() => onNavigate('tiere')}
          onKeyDown={(e) => { if (e.key === 'Enter') onNavigate('tiere'); }}>
          {tiere ? zeile('Tiere', `${tiere.gesamt} (${tiere.aktiv} aktiv)`) : zeile('Tiere', STRICH)}
        </div>
        <div role="button" tabIndex={0} style={{ cursor: 'pointer' }}
          onClick={() => onNavigate('gefahren')}
          onKeyDown={(e) => { if (e.key === 'Enter') onNavigate('gefahren'); }}>
          {zonen !== null ? zeile('Gefahren-/Absperrzonen', String(zonen)) : zeile('Gefahren-/Absperrzonen', STRICH)}
        </div>
      </Space>
    </Card>
  );
}
```

- [ ] **Step 8: `LageberichtKachel.tsx` anlegen**

Create `frontend/src/pages/lage-dashboard/LageberichtKachel.tsx`:

```tsx
import { Card, Empty, Space, Tag, Typography } from 'antd';
import type { LageberichtAnzeige } from '../../api/types';

interface Props {
  bericht: LageberichtAnzeige | null;
  onNavigate: (route: string) => void;
}

export default function LageberichtKachel({ bericht, onNavigate }: Props) {
  return (
    <Card
      size="small"
      title="Aktueller Lagebericht"
      hoverable
      onClick={() => onNavigate('lageberichte')}
      style={{ height: '100%', cursor: 'pointer' }}
    >
      {bericht === null ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Noch kein Lagebericht" />
      ) : (
        <Space direction="vertical" size={4} style={{ width: '100%' }}>
          <Typography.Text strong>{bericht.titel}</Typography.Text>
          <Space size={6}>
            <Tag color={bericht.status === 'freigegeben' ? 'green' : 'default'}>{bericht.status}</Tag>
            <Typography.Text type="secondary">{bericht.zeitstand}</Typography.Text>
          </Space>
          <Typography.Text type="secondary">von {bericht.ersteller_name}</Typography.Text>
        </Space>
      )}
    </Card>
  );
}
```

- [ ] **Step 9: `LageDashboardPage.tsx` anlegen**

Create `frontend/src/pages/lage-dashboard/LageDashboardPage.tsx`:

```tsx
import { Alert, Breadcrumb, Col, Row, Space, Spin, Tag, Typography } from 'antd';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { ladeEinsatz } from '../../api/einsaetze';
import { listePersonen } from '../../api/einsatzPerson';
import { listeTiere } from '../../api/einsatzTier';
import { listeUhs } from '../../api/einsatzUhs';
import { listeSchaeden } from '../../api/einsatzSchaden';
import { ladeGefahrenmatrix } from '../../api/gefahren';
import { listeZonen } from '../../api/lagezonen';
import { listeLageberichte } from '../../api/lageberichte';
import { listeEinheiten } from '../../api/einheiten';
import { listeEinsatzPersonal } from '../../api/einsatzPersonal';
import { listeEinsatzFahrzeuge } from '../../api/einsatzFahrzeuge';
import { listeEinsatzMaterial } from '../../api/einsatzMaterial';
import { listeAbschnitte } from '../../api/einsatzabschnitte';
import { useEinsatzLiveStream } from '../../etb/useEinsatzLiveStream';
import { baueKraeftebild } from '../../kraefte/kraeftebild';
import {
  neuesterLagebericht, verdichteGefahren, verdichtePersonen,
  verdichteSchaeden, verdichteTiere, verdichteUhs,
} from './lageVerdichtung';
import KennzahlenLeiste from './KennzahlenLeiste';
import BetroffeneKachel from './BetroffeneKachel';
import KraefteKachel from './KraefteKachel';
import InfrastrukturKachel from './InfrastrukturKachel';
import LageberichtKachel from './LageberichtKachel';
import AuftraegeKachel from './AuftraegeKachel';

export default function LageDashboardPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  useEinsatzLiveStream(einsatzId);
  const navigate = useNavigate();
  const gehe = (route: string) => navigate(`/einsaetze/${einsatzId}/${route}`);

  const einsatzQuery = useQuery({ queryKey: ['einsatz', einsatzId], queryFn: () => ladeEinsatz(einsatzId) });
  // Query-Keys IDENTISCH zu den vom Live-Hook (useEinsatzLiveStream) invalidierten Keys.
  const personenQuery = useQuery({ queryKey: ['einsatz-personen', einsatzId], queryFn: () => listePersonen(einsatzId) });
  const tiereQuery = useQuery({ queryKey: ['einsatz-tiere', einsatzId], queryFn: () => listeTiere(einsatzId) });
  const uhsQuery = useQuery({ queryKey: ['einsatz-uhs', einsatzId], queryFn: () => listeUhs(einsatzId) });
  const schaedenQuery = useQuery({ queryKey: ['einsatz-schaeden', einsatzId], queryFn: () => listeSchaeden(einsatzId) });
  const gefahrenQuery = useQuery({ queryKey: ['gefahrenmatrix', einsatzId], queryFn: () => ladeGefahrenmatrix(einsatzId) });
  const zonenQuery = useQuery({ queryKey: ['einsatz-zonen', einsatzId], queryFn: () => listeZonen(einsatzId) });
  const lageberichteQuery = useQuery({ queryKey: ['einsatz-lageberichte', einsatzId], queryFn: () => listeLageberichte(einsatzId) });
  const einheitenQuery = useQuery({ queryKey: ['einsatz-einheiten', einsatzId], queryFn: () => listeEinheiten(einsatzId) });
  const personalQuery = useQuery({ queryKey: ['einsatz-personal', einsatzId], queryFn: () => listeEinsatzPersonal(einsatzId) });
  const fahrzeugeQuery = useQuery({ queryKey: ['einsatz-fahrzeuge', einsatzId], queryFn: () => listeEinsatzFahrzeuge(einsatzId) });
  const materialQuery = useQuery({ queryKey: ['einsatz-material', einsatzId], queryFn: () => listeEinsatzMaterial(einsatzId) });
  const abschnitteQuery = useQuery({ queryKey: ['einsatz-abschnitte', einsatzId], queryFn: () => listeAbschnitte(einsatzId) });

  // Kräfte aus 5 Quellen — Fehler einer Quelle ⇒ Kachel/Leitzahl „—".
  const kraefteFehler = einheitenQuery.isError || personalQuery.isError
    || fahrzeugeQuery.isError || materialQuery.isError || abschnitteQuery.isError;
  const kraefte = useMemo(() => {
    if (kraefteFehler) return null;
    return baueKraeftebild(
      abschnitteQuery.data ?? [], einheitenQuery.data ?? [], personalQuery.data ?? [],
      fahrzeugeQuery.data ?? [], materialQuery.data ?? [],
    ).verdichtung;
  }, [kraefteFehler, abschnitteQuery.data, einheitenQuery.data, personalQuery.data, fahrzeugeQuery.data, materialQuery.data]);

  const betroffene = personenQuery.isError ? null : verdichtePersonen(personenQuery.data ?? []);
  const tiere = tiereQuery.isError ? null : verdichteTiere(tiereQuery.data ?? []);
  const uhs = uhsQuery.isError ? null : verdichteUhs(uhsQuery.data ?? []);
  const schaeden = schaedenQuery.isError ? null : verdichteSchaeden(schaedenQuery.data ?? []);
  const gefahren = gefahrenQuery.isError ? null : verdichteGefahren(gefahrenQuery.data ?? []);
  const zonen = zonenQuery.isError ? null : (zonenQuery.data ?? []).length;
  const bericht = lageberichteQuery.isError ? null : neuesterLagebericht(lageberichteQuery.data ?? []);
  const einheitenAnzahl = einheitenQuery.isError ? null : (einheitenQuery.data ?? []).length;
  const abschnitteAnzahl = abschnitteQuery.isError ? null : (abschnitteQuery.data ?? []).length;

  if (einsatzQuery.isLoading) {
    return <div style={{ textAlign: 'center', paddingTop: 80 }}><Spin size="large" /></div>;
  }
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return <Alert type="error" message="Einsatz nicht gefunden oder kein Zugriff" showIcon />;
  }
  const einsatz = einsatzQuery.data;

  return (
    <div>
      <Breadcrumb
        style={{ marginBottom: 12 }}
        items={[{ title: <Link to="/einsaetze">Einsätze</Link> }, { title: einsatz.bezeichnung }, { title: 'Lage-Dashboard' }]}
      />
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 8 }} align="center">
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>{einsatz.bezeichnung}</Typography.Title>
          <Typography.Text type="secondary">
            {[einsatz.stichwort, `seit ${dayjs(einsatz.begonnen_at).format('DD.MM. HH:mm')}`, einsatz.org_name]
              .filter(Boolean).join(' · ')}
          </Typography.Text>
        </div>
        <Space>
          <Tag color={einsatz.status === 'aktiv' ? 'green' : 'default'}>{einsatz.status}</Tag>
          <Tag color="blue">Live</Tag>
        </Space>
      </Space>

      <KennzahlenLeiste
        kraefte={kraefte}
        patienten={betroffene?.patienten ?? null}
        vermisst={betroffene?.vermisst ?? null}
        warnstufe={gefahren?.hoechste ?? null}
        schaedenOffen={schaeden?.offen ?? null}
        uhsAktiv={uhs?.aktiv ?? null}
        onNavigate={gehe}
      />

      <Row gutter={[16, 16]}>
        <Col xs={24} md={12} xl={8}><BetroffeneKachel betroffene={betroffene} onNavigate={gehe} /></Col>
        <Col xs={24} md={12} xl={8}><KraefteKachel kraefte={kraefte} einheiten={einheitenAnzahl} abschnitte={abschnitteAnzahl} onNavigate={gehe} /></Col>
        <Col xs={24} md={12} xl={8}><InfrastrukturKachel uhs={uhs} schaeden={schaeden} tiere={tiere} zonen={zonen} onNavigate={gehe} /></Col>
        <Col xs={24} md={12} xl={8}><LageberichtKachel bericht={bericht} onNavigate={gehe} /></Col>
        <Col xs={24} md={12} xl={8}><AuftraegeKachel /></Col>
      </Row>
    </div>
  );
}
```

- [ ] **Step 10: Page-Test laufen lassen — muss bestehen**

Run: `cd frontend && pnpm test -- src/pages/lage-dashboard/LageDashboardPage.test.tsx`
Expected: PASS (4 tests). Falls die „Patienten"-Assertion am `.ant-statistic`-Container scheitert (verschachtelte Knoten), stattdessen `within(patienten!).getByText('3')` verwenden (`within` aus `@testing-library/react` importieren).

- [ ] **Step 11: Commit**

```bash
git add frontend/src/pages/lage-dashboard/
git commit -m "feat(fe): Lage-Dashboard Page + Kacheln (LFH-47)"
```

---

## Task 7: Modul aktivieren (Registry, Default-Route, App-Wiring)

Erst den Registry-Test an den neuen Status anpassen (rot), dann Status flippen + Page registrieren (grün).

**Files:**
- Modify: `frontend/src/einsatz/modulRegistry.test.ts:63-72`
- Modify: `frontend/src/einsatz/modulRegistry.ts:71`
- Modify: `frontend/src/App.tsx` (Import + `MODUL_ELEMENTE`)

- [ ] **Step 1: Registry-Test an neue Realität anpassen (failing)**

In `frontend/src/einsatz/modulRegistry.test.ts` die zwei `redirectZiel`-Tests (Zeilen 63–72) ersetzen durch:

```typescript
  it('redirectZiel: Dashboard ist Default sobald fertig', () => {
    expect(redirectZiel(modulRegistry)).toBe('lage-dashboard');
  });

  it('redirectZiel: Fallback ETB solange Dashboard nicht fertig', () => {
    const ohneFertigesDashboard = modulRegistry.map((m) =>
      m.key === 'lage-dashboard' ? { ...m, status: 'geplant' as const } : m,
    );
    expect(redirectZiel(ohneFertigesDashboard)).toBe('etb');
  });
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run: `cd frontend && pnpm test -- src/einsatz/modulRegistry.test.ts`
Expected: FAIL — der erste neue Test erwartet `'lage-dashboard'`, der reale Registry-Status ist aber noch `'geplant'` ⇒ `redirectZiel` liefert `'etb'`.

- [ ] **Step 3: Registry-Status flippen**

In `frontend/src/einsatz/modulRegistry.ts` Zeile 71: `status: 'geplant'` → `status: 'fertig'` für den `lage-dashboard`-Eintrag:

```typescript
  { key: 'lage-dashboard', kategorie: 'lage', label: 'Dashboard', icon: TbLayoutDashboard, route: 'lage-dashboard', status: 'fertig', beschreibung: 'Verdichtete Lageübersicht des Einsatzes.' },
```

- [ ] **Step 4: Page in App.tsx registrieren**

In `frontend/src/App.tsx`:

(a) Nach Zeile 31 (`import { modulRegistry } ...`) bzw. in der Importgruppe ergänzen — eager Import (Default-Landing-Page soll ohne Extra-Chunk sofort rendern):

```typescript
import LageDashboardPage from './pages/lage-dashboard/LageDashboardPage';
```

(b) Im `MODUL_ELEMENTE`-Objekt (ab Zeile 42) einen Eintrag ergänzen, z. B. direkt nach `etb: <EtbPage />,`:

```typescript
  'lage-dashboard': <LageDashboardPage />,
```

- [ ] **Step 5: Tests laufen lassen — muss bestehen**

Run: `cd frontend && pnpm test -- src/einsatz/modulRegistry.test.ts`
Expected: PASS (beide neuen `redirectZiel`-Tests grün, übrige Registry-Tests unverändert grün).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/einsatz/modulRegistry.ts frontend/src/einsatz/modulRegistry.test.ts frontend/src/App.tsx
git commit -m "feat(fe): Lage-Dashboard als Default-Route aktivieren (LFH-47)"
```

---

## Task 8: Vollständige Verifikation

**Files:** keine Änderungen — nur Prüfen.

- [ ] **Step 1: Typecheck + Lint**

Run: `cd frontend && pnpm exec tsc --noEmit && pnpm exec eslint src/pages/lage-dashboard src/personen src/pages/PersonenPage.tsx src/App.tsx src/einsatz/modulRegistry.ts`
Expected: keine Fehler. (Falls `pnpm run` ein Lint-/Typecheck-Script anbietet, dieses verwenden.)

- [ ] **Step 2: Volle Testsuite (stabiles Gate)**

Run: `cd frontend && pnpm test -- --no-file-parallelism`
Expected: PASS — alle Tests grün, inkl. der neuen Verdichtungs-, Page-, Meta- und Registry-Tests, ohne Regression in PersonenPage.

- [ ] **Step 3: Production-Build**

Run: `cd frontend && pnpm build`
Expected: Build erfolgreich (rust-embed-Bundle wird gebaut). Hinweis (Memory): Frontend ist ins Binary eingebettet — zum manuellen Sichten im laufenden Backend braucht es `pnpm build` + Backend-Neustart.

- [ ] **Step 4: Abschluss-Commit (falls Build-Artefakte o. Ä. anfallen — sonst überspringen)**

```bash
git status
```
Erwartung: sauberer Working Tree (Build-Output ist git-ignoriert). Nichts zu committen.

---

## Self-Review (vom Plan-Autor durchlaufen)

**Spec-Abdeckung:**
- Layout Cockpit (Leitzahlen-Leiste + Bereiche) → Task 6 (`KennzahlenLeiste` + Kacheln). ✓
- Leitzahlen Kräfte/Patienten/Vermisst/Warnstufe/Schäden offen/UHS aktiv → Task 6 `KennzahlenLeiste`. ✓
- Patienten = SK I–IV, Vermisst separat → Task 2 `verdichtePersonen.patienten`/`.vermisst`. ✓
- UHS nur Anzahl + Status (kein N+1) → Task 5 `verdichteUhs` (nur Listen-Query). ✓
- Aufträge-Platzhalter → Task 6 `AuftraegeKachel`. ✓
- Deep-Links → `onNavigate` in allen Kacheln + Page `gehe`. ✓ (Test in Task 6.)
- Leerzustand dezent (Nullzahlen) → Verdichtungen liefern 0; Page rendert ohne Sonderlayout. ✓ (Test in Task 6.)
- Fehler-Resilienz pro Kachel + Einsatz-Anker → Page-Logik (`isError ? null`) + Vollseiten-Fehler. ✓ (Test in Task 6.)
- Live-Aktualisierung über identische Query-Keys + `useEinsatzLiveStream` → Task 6 Page. ✓
- Farben/Enums wiederverwenden (SK/Status/Warnstufe) → Task 1 (`personMeta`), `staerkeText`/Verdichtung, Warnstufen-Label/Farbe. ✓
- Default-Route-Aktivierung (Status fertig) → Task 7. ✓
- Tests: Verdichtung-Unit + Page-Integration + Registry → Tasks 2–7. ✓

**Platzhalter-Scan:** keine TBD/TODO; alle Code-Schritte enthalten vollständigen Code und exakte Befehle. ✓

**Typ-Konsistenz:** `verdichtePersonen`→`BetroffeneVerdichtung`, `verdichteGefahren`→`GefahrVerdichtung{hoechste,anzahlAktiv}`, `verdichteUhs/Tiere/Schaeden`→`{...,gesamt}`, `neuesterLagebericht`→`LageberichtAnzeige|null`. Props der Kacheln matchen die Page-Übergaben (`betroffene`, `kraefte: Verdichtung`, `uhs/schaeden/tiere`, `zonen: number|null`, `bericht`). `staerkeText`/`Verdichtung` aus `../../kraefte/kraeftebild`. ✓
