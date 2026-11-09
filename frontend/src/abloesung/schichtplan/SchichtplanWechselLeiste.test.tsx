import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { SchichtplanBlock, SchichtplanWechselpunkt } from '../../api/types';
import { renderMitProviders } from '../../test/utils';
import SchichtplanWechselLeiste from './SchichtplanWechselLeiste';

/**
 * Wechsel-Leiste des Schichtplans (LLH-1555 Welle 3): je Zeitpunkt ein Knopf mit der Zahl der
 * Wechsel, der gewählte zeigt seine Wechsel mit Griff. Stand und Einträge kommen vom Server; die
 * Leiste ordnet nur an.
 */

const block = (b: Partial<SchichtplanBlock>): SchichtplanBlock => ({
  id: 1,
  von: '2026-11-09 08:00:00',
  bis: '2026-11-09 14:00:00',
  posten: { art: 'einheit', einheit_id: 11, bezeichnung: 'RTW 1', aufgeloest: false },
  befunde: [],
  offene_anforderungen: [],
  offene_plaetze: 0,
  personen: [],
  personen_anzahl: 0,
  soll_anzahl: null,
  version: 1,
  ...b,
});

const BLOECKE: SchichtplanBlock[] = [
  block({ id: 2, von: '2026-11-09 14:00:00', bis: '2026-11-09 20:00:00' }),
  block({
    id: 3,
    posten: { art: 'einheit', einheit_id: 12, bezeichnung: 'KTW 2', aufgeloest: false },
  }),
  block({
    id: 4,
    von: '2026-11-09 14:00:00',
    bis: '2026-11-09 18:00:00',
    posten: { art: 'uhs', uhs_id: 5, bezeichnung: 'UHS Nord', aufgeloest: false },
  }),
  block({
    id: 6,
    von: '2026-11-09 09:00:00',
    bis: '2026-11-09 09:30:00',
    posten: { art: 'pause', aufgeloest: false },
  }),
];

const minute = (s: string) => Date.parse(s.replace(' ', 'T') + 'Z') / 60_000;

const WECHSEL: SchichtplanWechselpunkt[] = [
  {
    zeitpunkt: '2026-11-09 09:00:00',
    minute: minute('2026-11-09 09:00:00'),
    eintraege: [{ art: 'pause_beginn', stand: 'offen', block_id: 6 }],
  },
  {
    zeitpunkt: '2026-11-09 14:00:00',
    minute: minute('2026-11-09 14:00:00'),
    eintraege: [
      { art: 'einheit', stand: 'offen', block_id: 2, abloesung_id: 40 },
      { art: 'einheit', stand: 'ohne_schicht', block_id: 3 },
      { art: 'uhs', stand: 'vollzogen', block_id: 4 },
    ],
  },
];

const JETZT = Date.parse('2026-11-09T10:00:00Z');
const formatZeit = (ms: number) => new Date(ms).toISOString().slice(11, 16);

function zeige(extra: { gewaehlt?: number | null } = {}) {
  const onVollziehen = vi.fn();
  const wechselOeffnen = vi.fn();
  function Huelle() {
    const [gewaehlt, setGewaehlt] = useState<number | null>(extra.gewaehlt ?? null);
    return (
      <SchichtplanWechselLeiste
        wechsel={WECHSEL}
        bloecke={BLOECKE}
        jetzt={JETZT}
        formatZeit={formatZeit}
        gewaehlt={gewaehlt}
        onWaehlen={setGewaehlt}
        wechselGriff={(id) => (id === 3 ? undefined : () => wechselOeffnen(id))}
        onVollziehen={onVollziehen}
      />
    );
  }
  renderMitProviders(<Huelle />);
  return { onVollziehen, wechselOeffnen };
}

describe('SchichtplanWechselLeiste', () => {
  it('zeigt je Zeitpunkt einen Knopf mit der Zahl der Wechsel; ein vergangener offener ist überfällig', () => {
    zeige();
    const gruppe = screen.getByRole('group', { name: 'Wechsel laut Plan' });
    const knoepfe = within(gruppe).getAllByRole('button');
    expect(knoepfe.map((k) => k.textContent)).toEqual([
      '09:00·1 Wechselüberfällig',
      '14:00·3 Wechsel(1 offen)',
    ]);
    expect(knoepfe[0]).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('der gewählte Zeitpunkt zeigt seine Wechsel mit Griff; ein zweiter Klick schließt', async () => {
    const { onVollziehen, wechselOeffnen } = zeige();
    const knopf = screen.getByRole('button', { name: /14:00/ });
    await userEvent.click(knopf);
    expect(knopf).toHaveAttribute('aria-pressed', 'true');
    const liste = screen.getByRole('list', { name: 'Wechsel um 14:00' });
    const zeilen = within(liste).getAllByRole('listitem');
    expect(zeilen.map((z) => z.textContent)).toEqual([
      'RTW 1 · SchichtwechseloffenAblösung vollziehen',
      'KTW 2 · Posten endetkeine Schicht',
      'UHS Nord · Wechsel an der UHSvollzogenWechsel ansehen',
    ]);
    await userEvent.click(within(zeilen[0]).getByRole('button', { name: 'Ablösung vollziehen' }));
    expect(onVollziehen).toHaveBeenCalledWith(40);
    await userEvent.click(within(zeilen[2]).getByRole('button', { name: 'Wechsel ansehen' }));
    expect(wechselOeffnen).toHaveBeenCalledWith(4);

    await userEvent.click(knopf);
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('ein Sprung wählt seinen Zeitpunkt vor', () => {
    zeige({ gewaehlt: minute('2026-11-09 09:00:00') });
    const liste = screen.getByRole('list', { name: 'Wechsel um 09:00' });
    expect(within(liste).getByRole('button', { name: 'Wechsel vollziehen' })).toBeInTheDocument();
    expect(within(liste).getByRole('listitem')).toHaveTextContent('Pause · Pause beginnt');
  });

  it('ohne Wechsel zeigt sie nichts', () => {
    renderMitProviders(
      <SchichtplanWechselLeiste
        wechsel={[]}
        bloecke={BLOECKE}
        jetzt={JETZT}
        formatZeit={formatZeit}
        gewaehlt={null}
        onWaehlen={() => {}}
        wechselGriff={() => undefined}
      />,
    );
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
  });
});
