import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import type { Nachforderung } from '../api/types';
import { renderMitProviders } from '../test/utils';
import { freigabenFixture } from '../test/fixtures';
import StelleBedarf, { bedarfDerStelle } from './StelleBedarf';

const api = vi.hoisted(() => ({ listeNachforderungen: vi.fn() }));
vi.mock('../api/nachforderungen', () => api);

const nf = (over: Partial<Nachforderung> & { id: number }): Nachforderung => ({
  einsatz_id: 1,
  art: 'Feldbetten',
  bezeichnung: 'Feldbetten für die Nacht',
  anzahl: 40,
  adressat_kategorie: 'leitstelle',
  adressat_bezeichnung: null,
  begruendung: 'Für Betreuungsstelle Turnhalle Ost',
  prioritaet: 'normal',
  status: 'angefordert',
  zugesagt_at: null,
  unterwegs_at: null,
  eingetroffen_at: null,
  abgelehnt_at: null,
  abgelehnt_grund: null,
  angefordert_at: '2026-10-20 08:00:00',
  etb_nachforderung_id: 7,
  erstellt_von_id: 1,
  erstellt_at: '2026-10-20 08:00:00',
  erstellt_von_name: null,
  ist_offen: true,
  material_ids: [],
  einheit_ids: [],
  zusage_rufnamen: [],
  betreuungsstelle_id: 8,
  ...over,
});

const FELDBETTEN = nf({ id: 1 });
const DOLMETSCHER = nf({
  id: 2,
  art: 'Dolmetscher',
  bezeichnung: 'Ukrainisch',
  anzahl: null,
  prioritaet: 'dringend',
  status: 'unterwegs',
  angefordert_at: '2026-10-20 07:00:00',
});
const DECKEN_DA = nf({ id: 3, art: 'Decken', status: 'eingetroffen', ist_offen: false });
const ANDERE_STELLE = nf({ id: 4, art: 'Hygieneartikel', betreuungsstelle_id: 9 });
const EINSATZWEIT = nf({ id: 5, art: 'RTW', betreuungsstelle_id: undefined });

function zeige(
  props: Partial<{ freigaben: ReturnType<typeof freigabenFixture>; darfSchreiben: boolean }> = {},
) {
  return renderMitProviders(
    <StelleBedarf
      einsatzId={1}
      stelleId={8}
      freigaben={'freigaben' in props ? props.freigaben : freigabenFixture()}
      darfSchreiben={props.darfSchreiben ?? true}
    />,
  );
}

describe('bedarfDerStelle (LLH-1082)', () => {
  it('nur Nachforderungen dieser Stelle; offen nach Priorität, dann neueste; gesamt mit abgeschlossenen', () => {
    const { offene, gesamt } = bedarfDerStelle(
      [FELDBETTEN, DOLMETSCHER, DECKEN_DA, ANDERE_STELLE, EINSATZWEIT],
      8,
    );
    expect(offene.map((n) => n.id)).toEqual([2, 1]);
    expect(gesamt).toBe(3);
  });
});

describe('StelleBedarf — Paneel „Bedarf“ der Detailseite (LLH-1082)', () => {
  beforeEach(() => {
    api.listeNachforderungen.mockReset();
    api.listeNachforderungen.mockResolvedValue([
      FELDBETTEN,
      DOLMETSCHER,
      DECKEN_DA,
      ANDERE_STELLE,
      EINSATZWEIT,
    ]);
  });

  it('listet die offenen Nachforderungen der Stelle mit Status und Sprung in die Nachforderung', async () => {
    zeige();
    const paneel = await screen.findByRole('region', { name: 'Bedarf' });
    const dolmetscher = await within(paneel).findByRole('link', { name: 'Dolmetscher' });
    expect(dolmetscher).toHaveAttribute('href', '/einsaetze/1/nachforderungen?nachforderung=2');
    expect(within(paneel).getByRole('link', { name: '40× Feldbetten' })).toHaveAttribute(
      'href',
      '/einsaetze/1/nachforderungen?nachforderung=1',
    );
    // Status als Wort (zweiter Kanal neben dem Ton).
    expect(within(paneel).getByText('Unterwegs')).toBeInTheDocument();
    expect(within(paneel).getByText('Angefordert')).toBeInTheDocument();
    expect(within(paneel).getByText('2 offen')).toBeInTheDocument();
    // Eingetroffen, fremde Stelle und einsatzweit stehen nicht im Paneel.
    expect(within(paneel).queryByText(/Decken/)).toBeNull();
    expect(within(paneel).queryByText(/Hygieneartikel/)).toBeNull();
    expect(within(paneel).queryByText(/RTW/)).toBeNull();
    // Der Fuß führt auf alle Nachforderungen der Stelle, gefiltert.
    expect(
      within(paneel).getByRole('link', { name: /Alle Nachforderungen der Stelle/ }),
    ).toHaveAttribute('href', '/einsaetze/1/nachforderungen?stelle=8');
  });

  it('„Bedarf anfordern“ führt in die Erfassung mit Stellenbezug und Filter', async () => {
    zeige();
    const paneel = await screen.findByRole('region', { name: 'Bedarf' });
    const sprung = within(paneel).getByRole('link', { name: /Bedarf anfordern/ });
    expect(sprung).toHaveAttribute(
      'href',
      '/einsaetze/1/nachforderungen?neu=1&betreuungsstelle=8&stelle=8',
    );
  });

  it('ohne Schreibrecht kein „Bedarf anfordern“, die Liste bleibt', async () => {
    zeige({ darfSchreiben: false });
    const paneel = await screen.findByRole('region', { name: 'Bedarf' });
    await within(paneel).findByRole('link', { name: 'Dolmetscher' });
    expect(within(paneel).queryByRole('link', { name: /Bedarf anfordern/ })).toBeNull();
  });

  it('ohne offenen Bedarf: benannter Leerzustand, der Fuß bleibt bei abgeschlossenen', async () => {
    api.listeNachforderungen.mockResolvedValue([DECKEN_DA, ANDERE_STELLE]);
    zeige();
    const paneel = await screen.findByRole('region', { name: 'Bedarf' });
    expect(await within(paneel).findByText('Kein offener Bedarf angefordert')).toBeInTheDocument();
    expect(
      within(paneel).getByRole('link', { name: /Alle Nachforderungen der Stelle/ }),
    ).toBeInTheDocument();
  });

  it('ganz ohne Nachforderungen der Stelle kein Fuß', async () => {
    api.listeNachforderungen.mockResolvedValue([EINSATZWEIT]);
    zeige();
    const paneel = await screen.findByRole('region', { name: 'Bedarf' });
    await within(paneel).findByText('Kein offener Bedarf angefordert');
    expect(within(paneel).queryByRole('link', { name: /Alle Nachforderungen/ })).toBeNull();
  });

  it('ohne Freigabe Nachforderungen: kein Paneel, keine Abfrage, der Grund steht als Zeile', async () => {
    zeige({ freigaben: freigabenFixture({ nachforderungen: { zugriff: false } }) });
    expect(await screen.findByText('Bedarf · Keine Berechtigung')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Bedarf' })).toBeNull();
    expect(api.listeNachforderungen).not.toHaveBeenCalled();
  });

  it('solange die Freigaben laden, steht das Paneel im Ladezustand und fragt nicht ab', async () => {
    zeige({ freigaben: undefined });
    const paneel = await screen.findByRole('region', { name: 'Bedarf' });
    expect(within(paneel).getByLabelText('Bedarf wird geladen')).toBeInTheDocument();
    await waitFor(() => expect(api.listeNachforderungen).not.toHaveBeenCalled());
  });
});
