import { describe, expect, it, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import { serializeAnySpec } from '@einsatzzeichen/core';
import type { SymbolSpec } from '@einsatzzeichen/schema';
import { renderMitProviders } from '../../test/utils';
import FreiesZeichenPicker from './FreiesZeichenPicker';
import {
  detailOptionen,
  grundzeichenOptionen,
  mitGrundzeichen,
  symbolOptionen,
} from './zeichenWahl';

// Kosten des Vokabulars (LFH-836, Aufgabe 5.2, design.md D7): `vocabulary()` zeichnet jeden
// Kandidaten probeweise. Gemessen werden das Öffnen des Pickers und ein Grundzeichenwechsel, kalt
// und gemerkt. Die Zahlen stehen in
// openspec/changes/lfh-836-freie-zeichen-einsatzzeichen/messung.md; die Prüfung hier hält nur fest,
// dass ein zweiter Besuch desselben Entwurfs aus dem Merker kommt (keine Zeitgrenze: Zeiten auf
// geteilten CI-Rechnern schwanken).

const ms = (start: number) => Math.round((performance.now() - start) * 10) / 10;

function optionen(spec: SymbolSpec) {
  return { symbole: symbolOptionen(spec), details: detailOptionen(spec) };
}

describe('Kosten des Vokabulars (5.2)', () => {
  it('misst Öffnen und Grundzeichenwechsel; ein zweiter Besuch kommt aus dem Merker', () => {
    const messung: Record<string, number> = {};
    let t = performance.now();
    grundzeichenOptionen();
    const formation = optionen({ kind: 'formation' });
    messung['Öffnen, Optionen (kalt)'] = ms(t);

    t = performance.now();
    const fahrzeug = optionen(mitGrundzeichen({ kind: 'formation' }, 'vehicle-land'));
    messung['Wechsel Formation → Landfahrzeug (kalt)'] = ms(t);

    t = performance.now();
    const fahrzeugWieder = optionen(mitGrundzeichen({ kind: 'formation' }, 'vehicle-land'));
    messung['Wechsel Formation → Landfahrzeug (gemerkt)'] = ms(t);

    t = performance.now();
    optionen({ kind: 'formation', organization: 'thw' });
    messung['Detailwahl Organisation an der Formation (kalt)'] = ms(t);

    console.info('[LFH-836 5.2] Vokabular-Kosten in ms', messung);
    expect(fahrzeugWieder.symbole).toBe(fahrzeug.symbole);
    expect(fahrzeugWieder.details).toBe(fahrzeug.details);
    expect(formation.symbole.length).toBeGreaterThan(0);
  });

  it('misst das Rendern des Pickers beim Öffnen und nach einem Grundzeichenwechsel', () => {
    const wert = (spec: SymbolSpec) => ({ zeichen_spec: serializeAnySpec(spec) });
    let t = performance.now();
    const { rerender } = renderMitProviders(
      <FreiesZeichenPicker wert={wert({ kind: 'person' })} onChange={vi.fn()} />,
    );
    const oeffnen = ms(t);
    t = performance.now();
    act(() => rerender(<FreiesZeichenPicker wert={wert({ kind: 'hazard' })} onChange={vi.fn()} />));
    const wechsel = ms(t);
    console.info('[LFH-836 5.2] Render in ms (jsdom)', { oeffnen, wechsel });
    expect(screen.getByRole('radio', { name: 'Gefahr', checked: true })).toBeInTheDocument();
  });
});
