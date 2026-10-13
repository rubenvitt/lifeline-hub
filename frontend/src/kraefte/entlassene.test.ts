import { describe, expect, it } from 'vitest';
import type { EinsatzPersonal } from '../api/types';
import { baueKraeftebild, rendereMeldebildMarkdown } from './kraeftebild';
import { zuEntlassenen } from './entlassene';

const person = (id: number, name: string, extra: Partial<EinsatzPersonal> = {}) =>
  ({
    id,
    einsatz_id: 1,
    einheit_id: null,
    name,
    funktion: null,
    staerke_position: 'mannschaft',
    status_kategorie: 'verfuegbar',
    ...extra,
  }) as unknown as EinsatzPersonal;

describe('Block „Entlassen“ im Meldebild (LLH-1079)', () => {
  const aktiv = [person(1, 'Anna Aktiv', { staerke_position: 'fuehrer' })];
  const entlassen = [
    person(2, 'Bert Weg', {
      funktion: 'Sanitäter',
      beendet_at: '2026-10-13 10:00:00',
      beendet_als: 'entlassen',
    }),
    person(3, 'Cora Weg', { beendet_at: '2026-10-13 10:05:00', beendet_als: 'entlassen' }),
    // Eine stornierte Kraft erscheint in keinem Nachweis, auch wenn sie hineingerät.
    person(4, 'Dora Fehl', { beendet_at: '2026-10-13 10:06:00', beendet_als: 'storniert' }),
  ];

  it('nennt die Entlassenen als eigenen Block, die Stärke zählt sie nicht', () => {
    const bild = baueKraeftebild([], [], [...aktiv, ...entlassen], [], []);
    const md = rendereMeldebildMarkdown(bild, 'Stand', zuEntlassenen(entlassen));
    expect(md).toContain('## Entlassen\n\n- Bert Weg (Sanitäter)\n- Cora Weg\n');
    expect(md).not.toContain('Dora Fehl');
    expect(md).toContain('1/0/0//1');
  });

  it('lässt den Block ohne Entlassene weg', () => {
    const bild = baueKraeftebild([], [], aktiv, [], []);
    expect(rendereMeldebildMarkdown(bild, 'Stand', [])).not.toContain('## Entlassen');
    expect(rendereMeldebildMarkdown(bild, 'Stand')).not.toContain('## Entlassen');
  });

  it('sagt, wenn die Entlassenen nicht geladen sind, statt sie zu verschweigen', () => {
    const bild = baueKraeftebild([], [], aktiv, [], []);
    expect(rendereMeldebildMarkdown(bild, 'Stand', null)).toContain(
      '## Entlassen\n\n— nicht geladen\n',
    );
  });
});
