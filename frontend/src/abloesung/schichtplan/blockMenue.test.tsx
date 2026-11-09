import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { SchichtplanBlock } from '../../api/types';
import { renderMitProviders } from '../../test/utils';
import { blockMenueEintraege, useBlockMenue, type BlockMenueOptionen } from './blockMenue';

/**
 * Einträge und Wahl des Kontextmenüs eines Schichtplan-Blocks (LLH-1600): eine Quelle für den
 * Schichtplan im Einsatz und die Vorplanung. Löschen fragt im Dialog nach, nicht im Menü (Spec
 * `datensatz-aktionsmenue`, „Rückfrage im Dialog“).
 */

describe('blockMenueEintraege', () => {
  it('Bearbeiten, Kopieren, Wechsel und rot das Löschen', () => {
    expect(blockMenueEintraege({ wechsel: true, laeuft: false })).toEqual([
      { key: 'bearbeiten', label: 'Bearbeiten' },
      { key: 'kopieren', label: 'Als nächsten Block kopieren' },
      { key: 'wechsel', label: 'Wechsel vollziehen …' },
      { key: 'loeschen', label: 'Block löschen …', gefahr: true },
    ]);
  });

  it('ohne möglichen Wechsel fehlt der Eintrag', () => {
    expect(blockMenueEintraege({ wechsel: false, laeuft: false }).map((e) => e.key)).toEqual([
      'bearbeiten',
      'kopieren',
      'loeschen',
    ]);
  });

  it('läuft ein Kopieren oder Löschen, sind beide gesperrt; Bearbeiten bleibt', () => {
    const e = blockMenueEintraege({ wechsel: false, laeuft: true });
    expect(e.find((x) => x.key === 'bearbeiten')?.gesperrt).toBeUndefined();
    expect(e.find((x) => x.key === 'kopieren')?.gesperrt).toBe(true);
    expect(e.find((x) => x.key === 'loeschen')?.gesperrt).toBe(true);
  });
});

const block = (id: number, version = 1): SchichtplanBlock =>
  ({ id, version, posten: { art: 'pause' } }) as unknown as SchichtplanBlock;

/** Spielt den Aufrufer: hält die Blöcke und reicht die Wahl durch. */
function Probe({
  optionen,
  start,
}: {
  optionen: Omit<BlockMenueOptionen, 'blockVon'>;
  start: SchichtplanBlock[];
}) {
  const [bloecke, setBloecke] = useState(start);
  const menue = useBlockMenue({
    ...optionen,
    blockVon: (id) => bloecke.find((b) => b.id === id) ?? null,
  });
  return (
    <div>
      {menue.eintraege(1).map((e) => (
        <button key={e.key} type="button" onClick={() => menue.onWahl(1, e.key)}>
          {e.label}
        </button>
      ))}
      <button type="button" onClick={() => setBloecke([block(1, 2)])}>
        neue Version
      </button>
      <button type="button" onClick={() => setBloecke([])}>
        anderswo gelöscht
      </button>
    </div>
  );
}

function zeigeProbe(extra: Partial<BlockMenueOptionen> = {}) {
  const optionen = {
    onBearbeiten: vi.fn(),
    onKopieren: vi.fn(),
    onLoeschen: vi.fn(),
    onWechsel: vi.fn(),
    wechselMoeglich: () => true,
    laeuft: false,
    ...extra,
  };
  renderMitProviders(<Probe optionen={optionen} start={[block(1)]} />);
  return optionen;
}

const rueckfrage = () => screen.queryByRole('dialog', { name: 'Block löschen?' });
/**
 * Ist die Rückfrage zu? jsdom kennt kein `transitionend`: antd beginnt das Ausblenden
 * (`ant-zoom-leave`), beendet es aber nie (wie in `stammdaten/verwaltungstabellen.test.tsx`).
 */
const rueckfrageZu = () =>
  [...document.querySelectorAll('.ant-modal')].every((m) => m.classList.contains('ant-zoom-leave'));

describe('useBlockMenue', () => {
  it('Bearbeiten, Kopieren und Wechsel rufen ihren Weg mit dem Block', async () => {
    const o = zeigeProbe();
    await userEvent.click(screen.getByRole('button', { name: 'Bearbeiten' }));
    expect(o.onBearbeiten).toHaveBeenCalledWith(1);
    await userEvent.click(screen.getByRole('button', { name: 'Als nächsten Block kopieren' }));
    expect(o.onKopieren).toHaveBeenCalledWith(block(1));
    await userEvent.click(screen.getByRole('button', { name: 'Wechsel vollziehen …' }));
    expect(o.onWechsel).toHaveBeenCalledWith(block(1));
  });

  it('ohne `onWechsel` (Vorplanung) gibt es keinen Wechsel', () => {
    zeigeProbe({ onWechsel: undefined, wechselMoeglich: undefined });
    expect(screen.queryByRole('button', { name: 'Wechsel vollziehen …' })).toBeNull();
  });

  it('Löschen fragt im Dialog nach und löscht erst mit „Block löschen“, mit dem aktuellen Stand', async () => {
    const o = zeigeProbe();
    await userEvent.click(screen.getByRole('button', { name: 'Block löschen …' }));
    const dialog = await waitFor(() => rueckfrage()!);
    expect(o.onLoeschen).not.toHaveBeenCalled();
    // Ein anderer Platz ändert den Block, während die Rückfrage offen ist.
    fireEvent.click(screen.getByRole('button', { name: 'neue Version', hidden: true }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Block löschen' }));
    expect(o.onLoeschen).toHaveBeenCalledTimes(1);
    expect(o.onLoeschen).toHaveBeenCalledWith(block(1, 2));
  });

  it('Abbrechen lässt den Block stehen', async () => {
    const o = zeigeProbe();
    await userEvent.click(screen.getByRole('button', { name: 'Block löschen …' }));
    const dialog = await waitFor(() => rueckfrage()!);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Behalten' }));
    await waitFor(() => expect(rueckfrageZu()).toBe(true));
    expect(o.onLoeschen).not.toHaveBeenCalled();
  });

  it('verschwindet der Block während der Rückfrage, schließt sie, ohne zu löschen', async () => {
    const o = zeigeProbe();
    await userEvent.click(screen.getByRole('button', { name: 'Block löschen …' }));
    await waitFor(() => expect(rueckfrage()).not.toBeNull());
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'anderswo gelöscht', hidden: true }));
    });
    await waitFor(() => expect(rueckfrageZu()).toBe(true));
    expect(o.onLoeschen).not.toHaveBeenCalled();
  });
});
