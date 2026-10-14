import { http, HttpResponse } from 'msw';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import type { EinsatzFahrzeug, EinsatzPersonal } from '../api/types';
import BesatzungUebernehmenDialog from './BesatzungUebernehmenDialog';
import { besatzungKandidaten, besatzungVorschlag } from './besatzungVorschlag';

const RTW = {
  id: 3,
  funkrufname: 'RTW 1',
  einheit_id: 50,
  soll_besatzung: { fuehrer: 0, unterfuehrer: 1, mannschaft: 1 },
} as EinsatzFahrzeug;

const p = (id: number, name: string, felder: Partial<EinsatzPersonal> = {}) =>
  ({
    id,
    name,
    einheit_id: 50,
    fahrzeug_id: null,
    staerke_position: null,
    einsatzfunktion: null,
    funktion: null,
    ...felder,
  }) as EinsatzPersonal;

/** Spec-Szenario „Vorschlag bis zum Soll“: eine Unterführerin und drei ohne Position. */
const PERSONAL = [
  p(1, 'Zora'),
  p(2, 'Ulla', { staerke_position: 'unterfuehrer', einsatzfunktion: 'Truppführerin' }),
  p(3, 'Ben'),
  p(4, 'Ali'),
  p(5, 'Fremd', { einheit_id: 60 }),
];

let bodies: unknown[];

beforeEach(() => {
  bodies = [];
  server.use(
    http.post('/api/einsaetze/1/fahrzeuge/3/besatzung', async ({ request }) => {
      bodies.push(await request.json());
      return new HttpResponse(null, { status: 204 });
    }),
  );
});

function Harness() {
  const [auftrag, setAuftrag] = useState<{
    fahrzeug: EinsatzFahrzeug;
    vorgewaehlt: number[];
  } | null>(() => ({
    fahrzeug: RTW,
    vorgewaehlt: besatzungVorschlag({
      kandidaten: besatzungKandidaten(PERSONAL, RTW),
      crew: [],
      soll: RTW.soll_besatzung ?? null,
      fuehrerId: null,
    }).vorgewaehlt,
  }));
  return (
    <>
      <span>{auftrag ? 'offen' : 'zu'}</span>
      <BesatzungUebernehmenDialog
        einsatzId={1}
        auftrag={auftrag}
        personal={PERSONAL}
        fuehrerId={null}
        onSchliessen={() => setAuftrag(null)}
      />
    </>
  );
}

const haekchen = (name: string) => screen.getByRole('checkbox', { name: new RegExp(`^${name}`) });

describe('BesatzungUebernehmenDialog — Personal der Einheit übernehmen (LLH-1073, D12)', () => {
  it('trägt die Erfassungs-Norm und ein einziges Feld', async () => {
    renderMitProviders(<Harness />);
    const knopf = await screen.findByRole('button', { name: 'Übernehmen' });
    expect(document.querySelector('.ant-modal-footer')).toBeNull();
    expect(knopf.closest('form')).not.toBeNull();
    expect(screen.getByRole('dialog').querySelectorAll('.ant-form-item')).toHaveLength(1);
  });

  it('listet die freien Kräfte der Einheit mit Position und Funktion, vorgewählt bis zum Soll', async () => {
    renderMitProviders(<Harness />);
    const dialog = await screen.findByRole('dialog');
    const zeilen = within(dialog)
      .getAllByRole('checkbox')
      .map((c) => c.closest('label')?.textContent);
    expect(zeilen).toEqual(['UllaUnterführer · Truppführerin', 'Ali', 'Ben', 'Zora']);
    expect(haekchen('Ulla')).toBeChecked();
    expect(haekchen('Ali')).toBeChecked();
    expect(haekchen('Ben')).not.toBeChecked();
    expect(haekchen('Zora')).not.toBeChecked();
  });

  it('übernimmt die gewählten in einer Anfrage, abwählbar vor dem Absenden', async () => {
    renderMitProviders(<Harness />);
    await screen.findByRole('dialog');
    await userEvent.click(haekchen('Ali'));
    await userEvent.click(haekchen('Zora'));
    await userEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));
    expect(await screen.findByText('zu')).toBeInTheDocument();
    expect(bodies).toEqual([{ ep_ids: [2, 1] }]);
    expect(await screen.findByText('2 Kräfte als Besatzung zugeordnet')).toBeInTheDocument();
  });

  it('nennt den Grund an der abgelehnten Person und bleibt offen', async () => {
    server.use(
      http.post('/api/einsaetze/1/fahrzeuge/3/besatzung', () =>
        HttpResponse.json(
          {
            error: 'Nicht alle Personen lassen sich zuordnen',
            zeilen: [{ art: 'personal', id: 4, grund: 'entlassen' }],
          },
          { status: 422 },
        ),
      ),
    );
    renderMitProviders(<Harness />);
    await userEvent.click(await screen.findByRole('button', { name: 'Übernehmen' }));
    const ali = haekchen('Ali').closest('div')!;
    expect(await within(ali.parentElement!).findByText('entlassen')).toBeInTheDocument();
    expect(screen.getByText('offen')).toBeInTheDocument();
  });

  it('verlangt mindestens eine Person', async () => {
    renderMitProviders(<Harness />);
    await screen.findByRole('dialog');
    await userEvent.click(haekchen('Ulla'));
    await userEvent.click(haekchen('Ali'));
    await userEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));
    expect(await screen.findByText('Mindestens eine Person wählen')).toBeInTheDocument();
    expect(bodies).toEqual([]);
  });
});
