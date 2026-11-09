/**
 * Kontextmenü der Betreuungstabellen (LLH-1598, `openspec/changes/g11xq51l-kontextmenue-karten/
 * design.md` D5): Primäraktion und ⋮ stehen im Kartenplan der `Datensicht`, die Spalte „Aktionen“
 * speist sich daraus.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Betreuungsstelle, Evakuierungsbezirk } from '../api/types';
import { renderMitProviders } from '../test/utils';
import { offenesMenue, warteAufMenueFokus } from '../test/menue';
import StellenBlock from './StellenBlock';
import BezirkTabelle from './BezirkTabelle';

const stelle = (over: Partial<Betreuungsstelle> & { id: number }): Betreuungsstelle => ({
  einsatz_id: 1,
  belegungsart: 'gezaehlt',
  bezeichnung: `Stelle ${over.id}`,
  art: 'notunterkunft',
  status: 'in_betrieb',
  angelegt_at: '2026-09-23 08:00:00',
  ...over,
});

const bezirk = (over: Partial<Evakuierungsbezirk> & { id: number }): Evakuierungsbezirk => ({
  einsatz_id: 1,
  bezeichnung: `Bezirk ${over.id}`,
  plan_personen: 640,
  plan_erhebung: 'geschaetzt',
  raeumung: 'angeordnet',
  flaechen: 0,
  angelegt_at: '2026-09-23 08:00:00',
  ...over,
});

const rechtsklick = (el: Element) =>
  fireEvent.contextMenu(el, { clientX: 20, clientY: 20, button: 2 });
const zeileVon = (text: string) => screen.getAllByText(text)[0].closest('tr')!;
const punkte = async () => {
  await warteAufMenueFokus();
  const menue = within(offenesMenue()).getByRole('menu');
  return {
    menue,
    texte: within(menue)
      .getAllByRole('menuitem')
      .map((e) => e.textContent),
  };
};

describe('StellenBlock — Kontextmenü (LLH-1598)', () => {
  const zeige = (stellen: Betreuungsstelle[], darfSchreiben = true) => {
    const onBelegungMelden = vi.fn();
    const onAktion = vi.fn();
    renderMitProviders(
      <StellenBlock
        einsatzId={1}
        stellen={stellen}
        ladend={false}
        darfSchreiben={darfSchreiben}
        onBelegungMelden={onBelegungMelden}
        onAktion={onAktion}
      />,
    );
    return { onBelegungMelden, onAktion };
  };

  it('unverortete Stelle: „Belegung melden“, „Auf Karte verorten“, Trenner, rot „Stornieren“', async () => {
    const { onBelegungMelden } = zeige([stelle({ id: 8, bezeichnung: 'Turnhalle Nord' })]);
    // Rechtsklick neben die Bezeichnung (nicht auf ihren Link).
    const zelle = zeileVon('Turnhalle Nord').querySelectorAll('td')[1];
    expect(rechtsklick(zelle)).toBe(false);
    const { menue, texte } = await punkte();
    expect(menue).toHaveAttribute('aria-label', 'Aktionen zu Stelle Turnhalle Nord');
    expect(texte).toEqual(['Belegung melden', 'Auf Karte verorten', 'Stornieren']);
    expect(menue.querySelector('.ant-dropdown-menu-item-divider')).not.toBeNull();
    await userEvent.click(within(menue).getByRole('menuitem', { name: 'Belegung melden' }));
    expect(onBelegungMelden).toHaveBeenCalledWith(expect.objectContaining({ id: 8 }));
  });

  it('namentliche Stelle: ohne „Belegung melden“', async () => {
    zeige([
      stelle({ id: 8, bezeichnung: 'Turnhalle Nord', belegungsart: 'namentlich', lat: 1, lon: 2 }),
    ]);
    rechtsklick(zeileVon('Turnhalle Nord').querySelectorAll('td')[1]);
    expect((await punkte()).texte).toEqual(['Stornieren']);
  });

  it('ohne Schreibrecht bleibt das Browsermenü', () => {
    zeige([stelle({ id: 8, bezeichnung: 'Turnhalle Nord' })], false);
    expect(rechtsklick(zeileVon('Turnhalle Nord').querySelectorAll('td')[1])).toBe(true);
  });
});

describe('BezirkTabelle — Kontextmenü (LLH-1598)', () => {
  const zeige = (bezirke: Evakuierungsbezirk[], darfSchreiben = true) => {
    const onStandMelden = vi.fn();
    const onAktion = vi.fn();
    renderMitProviders(
      <BezirkTabelle
        einsatzId={1}
        bezirke={bezirke}
        ladend={false}
        darfSchreiben={darfSchreiben}
        onStandMelden={onStandMelden}
        onAktion={onAktion}
      />,
    );
    return { onStandMelden, onAktion };
  };

  it('zeigt „Stand melden“ vor den Einträgen des ⋮', async () => {
    const { onAktion } = zeige([bezirk({ id: 3, bezeichnung: 'Uferstraße' })]);
    rechtsklick(zeileVon('Uferstraße').querySelectorAll('td')[1]);
    const { menue, texte } = await punkte();
    expect(menue).toHaveAttribute('aria-label', 'Aktionen zu Bezirk Uferstraße');
    expect(texte[0]).toBe('Stand melden');
    expect(texte.slice(1)).toContain('Räumung setzen');
    expect(texte[texte.length - 1]).toBe('Stornieren');
    await userEvent.click(within(menue).getByRole('menuitem', { name: 'Räumung setzen' }));
    await waitFor(() =>
      expect(onAktion).toHaveBeenCalledWith('raeumung', expect.objectContaining({ id: 3 })),
    );
  });

  it('ohne Schreibrecht und ohne Fläche bleibt das Browsermenü', () => {
    zeige([bezirk({ id: 3, bezeichnung: 'Uferstraße' })], false);
    expect(rechtsklick(zeileVon('Uferstraße').querySelectorAll('td')[1])).toBe(true);
  });
});
