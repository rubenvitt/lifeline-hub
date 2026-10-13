import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ModulZaehler, Stabsfunktion } from '../api/types';
import { freigabenFixture } from '../test/fixtures';
import { renderMitProviders } from '../test/utils';
import SachgebietKachel from './SachgebietKachel';
import { SACHGEBIETE } from './sachgebiete';
import type { WerkzeugZahlQuellen } from './werkzeugZahlen';

const S3 = SACHGEBIETE.find((s) => s.sachgebiet === 's3')!;
const S4 = SACHGEBIETE.find((s) => s.sachgebiet === 's4')!;
const ZAEHLER: ModulZaehler = { auftraege: { offen: 2, in_arbeit: 0, ueberfaellig: 1 } };
const quellen: WerkzeugZahlQuellen = {
  zaehler: { data: ZAEHLER, error: null, isError: false, isPending: false },
  presse: { data: undefined, error: null, isError: false, isPending: true },
  funkplan: { zustand: 'laden', anzahl: null },
};
const zeile: Stabsfunktion = {
  sachgebiet: 's4',
  besetzung_art: 'extern',
  name: 'THW OV Nord',
  gesetzt_at: '2026-10-13 10:00:00',
  gesetzt_von_id: 1,
  personal_noch_disponiert: false,
};

function setup(over: Partial<Parameters<typeof SachgebietKachel>[0]> = {}) {
  const onBesetzungAendern = vi.fn();
  renderMitProviders(
    <SachgebietKachel
      einsatzId={7}
      eintrag={S4}
      zeile={zeile}
      hasBesetzung
      darfSchreiben
      freigaben={freigabenFixture()}
      zahlQuellen={quellen}
      onBesetzungAendern={onBesetzungAendern}
      {...over}
    />,
  );
  return { onBesetzungAendern };
}

describe('SachgebietKachel (design.md D1)', () => {
  it('ist ein Paneel mit Überschrift h2 aus Kennung und Label', () => {
    setup();
    expect(screen.getByRole('heading', { level: 2, name: 'S4 · Versorgung' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'S4 · Versorgung' })).toBeInTheDocument();
  });

  it('zeigt Aufgaben und die Fundstelle sichtbar', () => {
    setup();
    expect(screen.getByText(S4.aufgaben)).toBeInTheDocument();
    expect(screen.getByText('FwDV 100 Anl. 2, S. 58')).toBeInTheDocument();
  });

  it('Besetzung ändern mit Kennung und Label im Namen', () => {
    const { onBesetzungAendern } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Besetzung ändern – S4 Versorgung' }));
    expect(onBesetzungAendern).toHaveBeenCalledTimes(1);
  });

  it('ohne Schreibrecht keine Aktion', () => {
    setup({ darfSchreiben: false });
    expect(screen.queryByRole('button', { name: /Besetzung ändern/ })).toBeNull();
  });

  it('ohne geladene Besetzung weder Chip noch Aktion', () => {
    setup({ hasBesetzung: false, zeile: undefined });
    expect(screen.queryByText('nicht vergeben')).toBeNull();
    expect(screen.queryByRole('button', { name: /Besetzung ändern/ })).toBeNull();
  });

  it('führt die Werkzeuge als Gruppe, ausgeblendete fehlen, gesperrte stehen mit Grund', () => {
    setup({
      freigaben: freigabenFixture({
        verpflegung: { sichtbar: false },
        material: { zugriff: false },
      }),
    });
    const gruppe = screen.getByRole('group', { name: 'Werkzeuge S4' });
    expect(within(gruppe).getAllByRole('link')).toHaveLength(1);
    expect(within(gruppe).queryByText(/Verpflegung/)).toBeNull();
    expect(within(gruppe).getByRole('button', { name: /\(Keine Berechtigung\)$/ })).toBeDisabled();
  });

  it('die Zahl der Aufträge steht als Achtung mit Wort', () => {
    setup({ eintrag: S3, zeile: undefined });
    const link = screen.getByRole('link', { name: /^Aufträge\/Befehle, 2, 1 überfällig$/ });
    expect(link).toHaveAttribute('data-ton', 'achtung');
  });
});
