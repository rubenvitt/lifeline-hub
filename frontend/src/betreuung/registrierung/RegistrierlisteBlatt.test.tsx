import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { RegistrierListe } from '../../api/types';
import RegistrierlisteBlatt from './RegistrierlisteBlatt';

/**
 * Blatt der Registrierliste (LLH-1616, Spec `betreuung-registrierung`, „Registrierliste drucken“,
 * „Gesundheitsangaben nur auf Wunsch“): Summen je Kostform, je Haushalt die Personen mit leerer
 * Abhakspalte, Personen ohne Haushalt als eigener Block.
 */

const LISTE: RegistrierListe = {
  stelle_id: 8,
  haushalte: [
    {
      id: 3,
      nummer: 1,
      bezugsperson_id: 21,
      bezugsperson_name: 'Weber, Anna',
      personen: [
        {
          id: 21,
          registrier_nr: 12,
          name: 'Weber',
          vorname: 'Anna',
          geburtsdatum: '1985-04-03',
          kostform: 'vegetarisch',
          unvertraeglichkeiten: 'Erdnüsse',
          erfasst_at: '2026-11-09 08:00:00',
        },
        {
          id: 22,
          registrier_nr: 13,
          name: 'Weber',
          vorname: 'Tom',
          kostform: 'normal',
          erfasst_at: '2026-11-09 08:00:00',
        },
        {
          id: 23,
          registrier_nr: 14,
          name: 'Weber',
          vorname: 'Lea',
          alter_geschaetzt: 1,
          kostform: 'saeugling_kleinkind',
          erfasst_at: '2026-11-09 08:00:00',
        },
      ],
    },
  ],
  ohne_haushalt: [
    {
      id: 30,
      registrier_nr: 20,
      name: 'Muster',
      vorname: 'Max',
      erfasst_at: '2026-11-09 07:00:00',
    },
  ],
};

const HEUTE = '2026-11-09';

describe('RegistrierlisteBlatt (LLH-1616)', () => {
  it('summiert je Kostform samt „ohne Angabe“ und gesamt', () => {
    render(<RegistrierlisteBlatt liste={LISTE} heute={HEUTE} mitUnvertraeglichkeiten={false} />);
    const summen = screen.getByRole('table', { name: 'Kostformen' });
    const zeile = (wort: string) =>
      within(summen).getByRole('row', { name: new RegExp(`^${wort} `) });
    expect(within(zeile('Normalkost')).getByText('1')).toBeInTheDocument();
    expect(within(zeile('vegetarisch')).getByText('1')).toBeInTheDocument();
    expect(within(zeile('vegan')).getByText('0')).toBeInTheDocument();
    expect(within(zeile('Säugling/Kleinkind')).getByText('1')).toBeInTheDocument();
    expect(within(zeile('ohne Angabe')).getByText('1')).toBeInTheDocument();
    expect(within(zeile('gesamt')).getByText('4')).toBeInTheDocument();
  });

  it('gruppiert je Haushalt mit Kopf und leerer Abhakspalte', () => {
    render(<RegistrierlisteBlatt liste={LISTE} heute={HEUTE} mitUnvertraeglichkeiten={false} />);
    const tabelle = screen.getByRole('table', { name: 'Registrierte Personen' });
    expect(within(tabelle).getByRole('columnheader', { name: 'abgehakt' })).toBeInTheDocument();
    const kopf = within(tabelle).getByRole('rowheader', { name: /H-1/ });
    expect(kopf).toHaveTextContent('H-1 · Weber, Anna · 3 Personen');

    const anna = within(tabelle).getByRole('row', { name: /R-012/ });
    expect(anna).toHaveTextContent('Weber, Anna');
    expect(anna).toHaveTextContent('03.04.1985 (41)');
    expect(anna).toHaveTextContent('vegetarisch');
    const zellen = within(anna).getAllByRole('cell');
    expect(zellen[zellen.length - 1]).toBeEmptyDOMElement();

    const lea = within(tabelle).getByRole('row', { name: /R-014/ });
    expect(lea).toHaveTextContent('ca. 1 J.');
    expect(lea).toHaveTextContent('Säugling/Kleinkind');
  });

  it('stellt Personen ohne Haushalt in einen eigenen Block, Kostform ohne Angabe', () => {
    render(<RegistrierlisteBlatt liste={LISTE} heute={HEUTE} mitUnvertraeglichkeiten={false} />);
    const tabelle = screen.getByRole('table', { name: 'Registrierte Personen' });
    expect(within(tabelle).getByRole('rowheader', { name: /ohne Haushalt/ })).toHaveTextContent(
      'ohne Haushalt · 1 Person',
    );
    expect(within(tabelle).getByRole('row', { name: /R-020/ })).toHaveTextContent('ohne Angabe');
  });

  it('zeigt Unverträglichkeiten nur mit Wahl', () => {
    const { rerender } = render(
      <RegistrierlisteBlatt liste={LISTE} heute={HEUTE} mitUnvertraeglichkeiten={false} />,
    );
    expect(
      screen.queryByRole('columnheader', { name: 'Unverträglichkeiten' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Erdnüsse')).not.toBeInTheDocument();

    rerender(<RegistrierlisteBlatt liste={LISTE} heute={HEUTE} mitUnvertraeglichkeiten />);
    expect(screen.getByRole('columnheader', { name: 'Unverträglichkeiten' })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /R-012/ })).toHaveTextContent('Erdnüsse');
  });
});
