import { http, HttpResponse } from 'msw';
import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Person, UhsDetail } from '../../api/types';
import { server } from '../../test/server';
import { renderMitProviders } from '../../test/utils';
import UhsLagezeile from './UhsLagezeile';

/**
 * Die Zahlzeile der Stelle (LLH-1136): vier Zahlen, die SK-Aufgliederung folgt der Zahl, keine
 * Personennamen. Die Ableitung prüft `uhsLage.test.ts`.
 */
const personen = [
  {
    id: 1,
    registrier_nr: 1,
    name: 'Mustermann',
    aktuelle_uhs_id: 3,
    aktueller_platz_id: 10,
    aktuelle_sichtung: 'sk1',
  },
  {
    id: 2,
    registrier_nr: 2,
    name: 'Beispiel',
    aktuelle_uhs_id: 3,
    aktueller_platz_id: null,
    aktuelle_sichtung: 'sk2',
  },
  {
    id: 3,
    registrier_nr: 3,
    name: 'Fort',
    aktuelle_uhs_id: null,
    aktueller_verbleib: 'Eigentransport 1/83-1 → KH',
    versorgung: 'unterwegs',
  },
].map((p) => ({ einsatz_id: 1, status: 'betroffen', storniert_at: null, ...p })) as Person[];

const uhs = {
  id: 3,
  plaetze: [
    { id: 10, typ: 'behandlungsplatz', verfuegbarkeit: 'frei', storniert_at: null },
    { id: 11, typ: 'behandlungsplatz', verfuegbarkeit: 'frei', storniert_at: null },
    { id: 12, typ: 'behandlungsplatz', verfuegbarkeit: 'aufbereitung', storniert_at: null },
  ],
  belegungen: [
    { id: 1, person_id: 2, art: 'eintritt', platz_id: null, zeitpunkt_at: '2026-10-18 09:00:00' },
    { id: 2, person_id: 3, art: 'austritt', platz_id: null, zeitpunkt_at: '2026-10-18 09:10:00' },
  ],
} as unknown as UhsDetail;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true, now: Date.parse('2026-10-18T09:34:00Z') });
  server.use(http.get('/api/einsaetze/1/personen', () => HttpResponse.json(personen)));
});
afterEach(() => vi.useRealTimers());

describe('UhsLagezeile (LLH-1136)', () => {
  it('als Zeile über dem Grundriss: dieselben vier Zahlen in einer Schriftzeile, ohne Sprung', async () => {
    renderMitProviders(<UhsLagezeile einsatzId={1} uhs={uhs} />);
    const zeile = screen.getByRole('group', { name: 'Lage der Stelle' });
    expect(await within(zeile).findByText('1 / 3')).toBeInTheDocument();
    expect(zeile.textContent).toMatch(/In der Stelle\s*2/);
    expect(zeile.querySelectorAll('[data-sichtung]')).toHaveLength(2);
    expect(within(zeile).getByText('1 in Aufbereitung')).toBeInTheDocument();
    expect(within(zeile).getByText('längste 34 min')).toBeInTheDocument();
    expect(zeile.textContent).toMatch(/Unterwegs\s*1/);
    expect(within(zeile).queryAllByRole('link')).toHaveLength(0);
    expect(zeile.textContent).not.toMatch(/Mustermann|Beispiel|Fort/);
    // Eine Zeile, die live nicht umbricht; der volle Wortlaut steht im Titel.
    expect(zeile.style.whiteSpace).toBe('nowrap');
    expect(zeile).toHaveAttribute(
      'title',
      'In der Stelle 2 SK I 1 · SK II 1 · Plätze frei 1 / 3 1 in Aufbereitung · Wartend 1 längste 34 min · Unterwegs 1',
    );
  });

  it('nennt In der Stelle, Plätze frei, Wartend mit längster Zeit und Unterwegs', async () => {
    renderMitProviders(<UhsLagezeile einsatzId={1} uhs={uhs} form="band" />);
    const zeile = screen.getByRole('group', { name: 'Lage der Stelle' });
    expect(await within(zeile).findByText('In der Stelle')).toBeInTheDocument();
    expect(
      await within(zeile).findByRole('img', {
        name: /^In der Stelle nach Sichtung: SK I 1, SK II 1/,
      }),
    ).toBeInTheDocument();
    expect(within(zeile).getByText('SK I 1 · SK II 1')).toBeInTheDocument();
    expect(within(zeile).getByText('1 / 3')).toBeInTheDocument();
    expect(within(zeile).getByText('1 in Aufbereitung')).toBeInTheDocument();
    expect(within(zeile).getByText('längste 34 min')).toBeInTheDocument();
    expect(within(zeile).getByText('Unterwegs')).toBeInTheDocument();
    // Keine Personennamen in der Zahlzeile.
    expect(zeile.textContent).not.toMatch(/Mustermann|Beispiel|Fort/);
  });

  it('macht die Zahlen zu Sprüngen, wenn die Seite Ziele gibt', async () => {
    renderMitProviders(
      <UhsLagezeile
        einsatzId={1}
        uhs={uhs}
        form="band"
        ziele={{ grundriss: '/geraet/1/uhs/3', patienten: '/geraet/1/patienten' }}
      />,
    );
    const zeile = screen.getByRole('group', { name: 'Lage der Stelle' });
    expect(await within(zeile).findByRole('link', { name: /In der Stelle/ })).toHaveAttribute(
      'href',
      '/geraet/1/patienten',
    );
    expect(within(zeile).getByRole('link', { name: /Plätze frei/ })).toHaveAttribute(
      'href',
      '/geraet/1/uhs/3',
    );
    expect(within(zeile).getByRole('link', { name: /Wartend/ })).toHaveAttribute(
      'href',
      '/geraet/1/uhs/3',
    );
    expect(within(zeile).getByRole('link', { name: /Unterwegs/ })).toHaveAttribute(
      'href',
      '/geraet/1/uhs/3',
    );
  });

  it('meldet über einem Ladefehler keine Nullen', async () => {
    server.use(
      http.get('/api/einsaetze/1/personen', () =>
        HttpResponse.json({ error: 'x' }, { status: 500 }),
      ),
    );
    renderMitProviders(<UhsLagezeile einsatzId={1} uhs={uhs} form="band" />);
    const zeile = screen.getByRole('group', { name: 'Lage der Stelle' });
    expect(await within(zeile).findAllByText('Stand unbekannt')).toHaveLength(4);
    expect(within(zeile).queryByText('0')).toBeNull();
  });

  it('als Zeile meldet sie über einem Ladefehler „Stand unbekannt“ statt Nullen', async () => {
    server.use(
      http.get('/api/einsaetze/1/personen', () =>
        HttpResponse.json({ error: 'x' }, { status: 500 }),
      ),
    );
    renderMitProviders(<UhsLagezeile einsatzId={1} uhs={uhs} />);
    const zeile = screen.getByRole('group', { name: 'Lage der Stelle' });
    expect(await within(zeile).findByText('Stand unbekannt')).toBeInTheDocument();
    expect(zeile.textContent).not.toMatch(/\d/);
  });
});
