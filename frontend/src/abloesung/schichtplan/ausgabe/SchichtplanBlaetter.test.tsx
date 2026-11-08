import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { meHandler, server } from '../../../test/server';
import { renderMitProviders } from '../../../test/utils';
import { adminFixture } from '../../../test/fixtures';
import type { AusgabePlan, AusgabeSchicht } from './ausgabePlan';
import SchichtplanBlaetter from './SchichtplanBlaetter';

/**
 * Die Druckblätter des Schichtplans (LLH-1557, design D3). Umbruch und Seitenbeginn belegt
 * `e2e/schichtplan-druck.spec.ts`; hier Inhalt und Zuschnitt der Blätter.
 */

const ms = (wire: string) => Date.parse(`${wire.replace(' ', 'T')}Z`);
const schicht = (s: Partial<AusgabeSchicht> & { id: string; posten: string }): AusgabeSchicht => {
  const von = s.von ?? '2026-08-15 12:00:00';
  const bis = s.bis ?? '2026-08-15 15:00:00';
  return {
    von,
    bis,
    vonMs: ms(von),
    bisMs: ms(bis),
    sollAnzahl: 2,
    qualiSoll: [{ label: 'Rettungssanitäter', anzahl: 1 }],
    offen: 0,
    personenAnzahl: 0,
    personen: [],
    ...s,
  };
};

const PLAN: AusgabePlan = {
  posten: [
    { schluessel: 'uhs:9', titel: 'UHS Marktplatz', abschnitt: 'Innenstadt', istPause: false },
    { schluessel: 'einheit:4', titel: 'Fußstreife 1', abschnitt: null, istPause: false },
    { schluessel: 'pause', titel: 'Pause', abschnitt: null, istPause: true },
  ],
  schichten: [
    schicht({ id: '1', posten: 'uhs:9', personen: ['stamm:1', 'helfer:3'], personenAnzahl: 2 }),
    schicht({
      id: '2',
      posten: 'uhs:9',
      von: '2026-08-15 15:00:00',
      bis: '2026-08-15 18:00:00',
      personen: ['stamm:1'],
      personenAnzahl: 1,
      offen: 1,
    }),
    schicht({ id: '3', posten: 'einheit:4', sollAnzahl: null, qualiSoll: [], personen: [] }),
    schicht({
      id: '4',
      posten: 'pause',
      von: '2026-08-15 18:00:00',
      bis: '2026-08-15 18:30:00',
      sollAnzahl: null,
      qualiSoll: [],
      personen: ['stamm:1'],
      personenAnzahl: 1,
    }),
  ],
  personen: [
    {
      schluessel: 'stamm:1',
      name: 'Anna Aushang',
      organisation: null,
      telefon: null,
      qualifikationen: [5],
    },
    {
      schluessel: 'helfer:3',
      name: 'Cora Clausen',
      organisation: 'JUH',
      telefon: '0151 123',
      qualifikationen: [],
    },
  ],
};

const EINSATZ = { bezeichnung: 'Stadtfest Musterstadt' };
const QUALI = new Map([[5, 'Rettungssanitäter']]);

function zeigen(props: Partial<Parameters<typeof SchichtplanBlaetter>[0]> = {}) {
  server.use(
    meHandler(adminFixture()),
    http.get('/api/organisation', () => HttpResponse.json({ id: 1, name: 'DRK Musterstadt' })),
  );
  return renderMitProviders(
    <div data-lfh="druckwurzel">
      <SchichtplanBlaetter
        plan={PLAN}
        sicht="posten"
        auswahl={null}
        einsatz={EINSATZ}
        qualiNamen={QUALI}
        geladenAt="2026-08-15T10:00:00Z"
        {...props}
      />
    </div>,
  );
}

const blaetter = () =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-lfh="druck-kapitel"]'));

describe('SchichtplanBlaetter (LLH-1557)', () => {
  it('Aushang je Posten: ein Kapitel mit Druckkopf je Posten, keine Pause', () => {
    zeigen();
    expect(blaetter().map((b) => b.dataset.blatt)).toEqual(['uhs:9', 'einheit:4']);
    const uhs = within(blaetter()[0]);
    expect(uhs.getByRole('heading', { level: 2 })).toHaveTextContent('Aushang – UHS Marktplatz');
    expect(uhs.getByText('Innenstadt')).toBeInTheDocument();
    expect(uhs.getByText('2, davon 1 × Rettungssanitäter')).toBeInTheDocument();
    expect(uhs.getByText('Cora Clausen (JUH)')).toBeInTheDocument();
    expect(uhs.getByText('1 offen')).toBeInTheDocument();
    // Anna ist in beiden Schichten, ihre Qualifikation steht je Schicht.
    expect(uhs.getAllByText('Rettungssanitäter', { selector: 'td div' })).toHaveLength(2);
    // Ein Tag: keine Spalte „Tag“.
    expect(uhs.queryByRole('columnheader', { name: 'Tag' })).toBeNull();
    expect(uhs.getAllByRole('row')).toHaveLength(3);
  });

  it('Ohne bekannte Qualifikation am Posten keine Spalte Qualifikation', () => {
    zeigen();
    const streife = within(blaetter()[1]);
    expect(streife.queryByRole('columnheader', { name: 'Qualifikation' })).toBeNull();
    expect(
      within(blaetter()[0]).getByRole('columnheader', { name: 'Qualifikation' }),
    ).toBeInTheDocument();
  });

  it('Auswahl zeigt nur dieses Blatt', () => {
    zeigen({ auswahl: 'einheit:4' });
    expect(blaetter().map((b) => b.dataset.blatt)).toEqual(['einheit:4']);
  });

  it('Zettel je Person: Pause als Zeile, Stunden ohne Pause, Telefon nur beim Helfer', () => {
    zeigen({ sicht: 'person' });
    expect(blaetter().map((b) => b.dataset.blatt)).toEqual(['stamm:1', 'helfer:3']);
    const anna = within(blaetter()[0]);
    expect(anna.getByRole('heading', { level: 2 })).toHaveTextContent(
      'Schichtzettel – Anna Aushang',
    );
    expect(anna.getByText('2 Schichten, 6 h')).toBeInTheDocument();
    expect(anna.getAllByText('UHS Marktplatz · Innenstadt', { selector: 'td' })).toHaveLength(2);
    expect(anna.getByText('Pause', { selector: 'td' })).toBeInTheDocument();
    expect(anna.queryByText('Telefon')).toBeNull();
    const cora = within(blaetter()[1]);
    expect(cora.getByText('0151 123')).toBeInTheDocument();
    expect(cora.getByText('Anna Aushang', { selector: 'td' })).toBeInTheDocument();
  });

  it('Ohne Namen: Besetzung als Zahl, keine Spalte Qualifikation', () => {
    zeigen({
      plan: {
        ...PLAN,
        personen: null,
        schichten: PLAN.schichten.map((s) => ({ ...s, personen: null })),
      },
    });
    const uhs = within(blaetter()[0]);
    expect(uhs.getByText('2 von 2 besetzt')).toBeInTheDocument();
    expect(uhs.queryByRole('columnheader', { name: 'Qualifikation' })).toBeNull();
  });

  it('Mehrere Tage: Spalte „Tag“', () => {
    zeigen({
      plan: {
        ...PLAN,
        schichten: [
          ...PLAN.schichten,
          schicht({
            id: '9',
            posten: 'einheit:4',
            von: '2026-08-16 08:00:00',
            bis: '2026-08-16 10:00:00',
          }),
        ],
      },
    });
    expect(within(blaetter()[0]).getByRole('columnheader', { name: 'Tag' })).toBeInTheDocument();
  });

  it('Zeiten in der Darstellung der Konventionen', () => {
    zeigen();
    expect(screen.getAllByText('1400–1700').length).toBeGreaterThan(0);
  });
});
