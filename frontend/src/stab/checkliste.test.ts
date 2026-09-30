import { describe, expect, it } from 'vitest';
import type { ChecklistenEintrag, ChecklistenPunkt } from '../api/types';
import { dichten } from '../theme/tokens';
import { CHECKLISTE, checklistenZeileStil, eintragFuer, erledigtAnzahl } from './checkliste';

/**
 * Die Wire-Werte in `ALLE`-Reihenfolge (`src/stab/checkliste.rs`), hier als LITERAL: die Vorlage
 * ist gegen den Vertrag zu prüfen, nicht gegen sich selbst. Der `Record` zwingt beim Kompilieren
 * jede Variante des generierten Typs herein.
 */
const WIRE: Record<ChecklistenPunkt, number> = {
  aufstellort: 0,
  einweisung: 1,
  lageskizze: 2,
  funkarbeitsplaetze: 3,
  sprechgruppen: 4,
  etb_eroeffnet: 5,
  leitstelle_gemeldet: 6,
};

function eintrag(punkt: ChecklistenPunkt, erledigt: boolean): ChecklistenEintrag {
  return {
    punkt,
    erledigt,
    ...(erledigt ? { erledigt_at: '2026-09-30 12:32:00', erledigt_von_id: 1 } : {}),
    geaendert_von_id: 1,
    geaendert_at: '2026-09-30 12:32:00',
  };
}

describe('CHECKLISTE', () => {
  it('führt genau die sieben Wire-Werte in Vertragsreihenfolge', () => {
    expect(CHECKLISTE.map((v) => v.punkt)).toEqual(
      (Object.keys(WIRE) as ChecklistenPunkt[]).sort((a, b) => WIRE[a] - WIRE[b]),
    );
  });

  it('trägt je Punkt einen Text und eine Quelle', () => {
    for (const v of CHECKLISTE) {
      expect(v.text.trim(), v.punkt).not.toBe('');
      expect(v.quelle.trim(), v.punkt).not.toBe('');
    }
  });

  it('belegt die zwei Punkte, die die FwDV 100 dokumentiert sehen will, mit Anlage 5', () => {
    for (const p of ['etb_eroeffnet', 'leitstelle_gemeldet'] as const) {
      expect(CHECKLISTE.find((v) => v.punkt === p)?.quelle).toContain('FwDV 100');
    }
  });
});

describe('eintragFuer / erledigtAnzahl', () => {
  const liste = [eintrag('lageskizze', true), eintrag('aufstellort', false)];

  it('findet den gespeicherten Eintrag, sonst undefined (= offen)', () => {
    expect(eintragFuer(liste, 'lageskizze')?.erledigt).toBe(true);
    expect(eintragFuer(liste, 'einweisung')).toBeUndefined();
    expect(eintragFuer(undefined, 'lageskizze')).toBeUndefined();
  });

  it('zählt nur Haken, keine Zeilen', () => {
    expect(erledigtAnzahl(liste)).toBe(1);
    expect(erledigtAnzahl([])).toBe(0);
  });
});

/**
 * Das Zeilen-Label ist ein handgebautes Bedienziel (LFH-365): die antd-Box selbst ist nur
 * `controlInteractiveSize` groß und erbt keine Steuerhöhe. Böden als LITERALE.
 */
describe('checklistenZeileStil', () => {
  const tokenFuer = (stufe: keyof typeof dichten) => ({
    controlHeight: dichten[stufe].zeilenhoehe,
    paddingXS: dichten[stufe].abstand.xs,
    paddingSM: dichten[stufe].abstand.sm,
  });

  it('trägt den Boden aus controlHeight — 30 / 48 / 72 px', () => {
    expect(checklistenZeileStil(tokenFuer('kompakt')).minHeight).toBe(30);
    expect(checklistenZeileStil(tokenFuer('komfortabel')).minHeight).toBe(48);
    expect(checklistenZeileStil(tokenFuer('handschuh')).minHeight).toBe(72);
  });

  it('trägt die ZWEITE Angabe (Polsterung) dichteabhängig mit', () => {
    const k = checklistenZeileStil(tokenFuer('kompakt'));
    const h = checklistenZeileStil(tokenFuer('handschuh'));
    expect([k.paddingBlock, k.paddingInline]).toEqual([3, 7]);
    expect([h.paddingBlock, h.paddingInline]).toEqual([7, 16]);
  });

  it('ist ein Flex-Block, damit die ganze Zeilenbreite trifft', () => {
    const s = checklistenZeileStil(tokenFuer('kompakt'));
    expect(s.display).toBe('flex');
    expect(s.cursor).toBe('pointer');
  });
});
