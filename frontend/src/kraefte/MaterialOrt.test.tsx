import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../test/utils';
import { oeffne, optionenVon, waehle } from '../test/auswahlListe';
import { ApiError } from '../api/client';
import type { Einheit, Uhs } from '../api/types';
import MaterialOrt, {
  ortFilter,
  ortText,
  ortVon,
  type MaterialOrtKontext,
  type MaterialOrtProps,
} from './MaterialOrt';
import { buildEinheitOptions } from './einheitAngabeKern';

const einheiten = [
  { id: 1, name: 'Staffel A', ueber_einheit_id: null, abschnitt_id: null },
  { id: 2, name: 'Staffel B', ueber_einheit_id: null, abschnitt_id: null },
  { id: 3, name: 'Rettungsstaffel', ueber_einheit_id: null, abschnitt_id: null },
] as Einheit[];
const uhsListe = [
  { id: 7, bezeichnung: 'Turnhalle', status: 'aktiv' },
  { id: 8, bezeichnung: 'UHS Schule', status: 'geplant' },
  { id: 9, bezeichnung: 'Zelt Nord', status: 'aufgeloest' },
] as Uhs[];

function kontext(
  p: {
    einheit?: Partial<MaterialOrtKontext['einheit']>;
    uhs?: Partial<MaterialOrtKontext['uhs']>;
  } = {},
): MaterialOrtKontext {
  return {
    einsatzId: 1,
    einheit: {
      lesbar: true,
      bedienbar: true,
      optionen: buildEinheitOptions(einheiten, []),
      name: (id) => einheiten.find((e) => e.id === id)?.name,
      ...p.einheit,
    },
    uhs: {
      lesbar: true,
      bedienbar: true,
      liste: uhsListe,
      ...p.uhs,
    },
  };
}

function zeige(p: Partial<MaterialOrtProps> = {}) {
  const onEinheit = p.onEinheit ?? vi.fn().mockResolvedValue(undefined);
  const onUhs = p.onUhs ?? vi.fn().mockResolvedValue(undefined);
  renderMitProviders(
    <MaterialOrt
      kennung="Wolldecke"
      ort={{ einheitId: null, uhsId: null }}
      kontext={kontext()}
      darfSchreiben={false}
      {...p}
      onEinheit={onEinheit}
      onUhs={onUhs}
    />,
  );
  return { onEinheit, onUhs };
}

describe('MaterialOrt (LLH-1093, design.md D1–D3)', () => {
  it('ortVon liest Einheit und UHS des Postens', () => {
    expect(ortVon({ einheit_id: 3, uhs_id: 7 })).toEqual({ einheitId: 3, uhsId: 7 });
    expect(ortVon({ einheit_id: null })).toEqual({ einheitId: null, uhsId: null });
  });

  it('zeigt Einheit und UHS zugleich: „Rettungsstaffel · UHS Turnhalle“', () => {
    zeige({ ort: { einheitId: 3, uhsId: 7 }, darfSchreiben: false });
    expect(screen.getByTestId('material-ort')).toHaveTextContent('Rettungsstaffel·UHS Turnhalle');
    // Lesezweig: die Namen führen in ihr Modul.
    expect(screen.getByRole('link', { name: 'Rettungsstaffel' })).toHaveAttribute(
      'href',
      '/einsaetze/1/einheiten/3',
    );
    expect(screen.getByRole('link', { name: 'UHS Turnhalle' })).toHaveAttribute(
      'href',
      '/einsaetze/1/unfallhilfsstellen/7',
    );
    expect(ortText({ einheitId: 3, uhsId: 7 }, kontext())).toBe('Rettungsstaffel · UHS Turnhalle');
  });

  it('eine UHS, die schon „UHS“ heißt, bekommt das Wort nicht doppelt', () => {
    zeige({ ort: { einheitId: null, uhsId: 8 }, darfSchreiben: false });
    expect(screen.getByTestId('material-ort')).toHaveTextContent(/^UHS Schule$/);
  });

  it('ohne Leserecht auf Einheiten steht „zugeordnet“, nie ein Strich', () => {
    zeige({
      ort: { einheitId: 3, uhsId: null },
      darfSchreiben: true,
      kontext: kontext({
        einheit: { lesbar: false, bedienbar: false, optionen: [], name: () => undefined },
      }),
    });
    const ort = screen.getByTestId('material-ort');
    expect(ort).toHaveTextContent('zugeordnet');
    expect(ort).not.toHaveTextContent('—');
    expect(screen.queryByRole('link')).toBeNull();
    expect(ortText({ einheitId: 3, uhsId: null }, kontext({ einheit: { lesbar: false } }))).toBe(
      'zugeordnet',
    );
  });

  it('ohne Ort und ohne Schreibrecht: „—“', () => {
    zeige({ darfSchreiben: false });
    expect(screen.getByTestId('material-ort')).toHaveTextContent(/^—$/);
  });

  it('leer und bedienbar: je Teil die Aufforderung mit Zeilenkennung', () => {
    zeige({ darfSchreiben: true });
    expect(screen.getByRole('button', { name: 'Einheit zu Wolldecke eintragen' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'UHS zu Wolldecke eintragen' })).toBeVisible();
  });

  it('Einheiten-Modul gesperrt: der Einheit-Teil ist nur lesbar, der UHS-Teil bedienbar', () => {
    zeige({
      ort: { einheitId: 3, uhsId: 7 },
      darfSchreiben: true,
      kontext: kontext({ einheit: { bedienbar: false } }),
    });
    expect(screen.queryByRole('button', { name: /Einheit zu Wolldecke/ })).toBeNull();
    expect(screen.getByRole('link', { name: 'Rettungsstaffel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'UHS zu Wolldecke bearbeiten' })).toBeVisible();
  });

  it('Umhängen: die Einheit übergibt neu und alt erst mit „Speichern“, die UHS bleibt', async () => {
    const { onEinheit, onUhs } = zeige({ ort: { einheitId: 1, uhsId: 7 }, darfSchreiben: true });
    await userEvent.click(screen.getByRole('button', { name: 'Einheit zu Wolldecke bearbeiten' }));
    await waehle('Einheit zu Wolldecke', 'Staffel B');
    expect(onEinheit).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Einheit zu Wolldecke speichern' }));
    await waitFor(() => expect(onEinheit).toHaveBeenCalledWith(2, 1));
    expect(onUhs).not.toHaveBeenCalled();
  });

  it('die UHS-Wahl bietet geplante und aktive UHS und „keine UHS“, keine aufgelöste', async () => {
    const { onUhs } = zeige({ ort: { einheitId: null, uhsId: 7 }, darfSchreiben: true });
    await userEvent.click(screen.getByRole('button', { name: 'UHS zu Wolldecke bearbeiten' }));
    await oeffne('UHS zu Wolldecke');
    expect(optionenVon('UHS zu Wolldecke')).toEqual(['keine UHS', 'UHS Turnhalle', 'UHS Schule']);
    await waehle('UHS zu Wolldecke', 'keine UHS');
    await userEvent.click(screen.getByRole('button', { name: 'UHS zu Wolldecke speichern' }));
    await waitFor(() => expect(onUhs).toHaveBeenCalledWith(null));
  });

  it('eine Ablehnung steht am Teil', async () => {
    const onUhs = vi.fn().mockRejectedValue(new ApiError(422, 'UHS ist aufgelöst'));
    zeige({ ort: { einheitId: null, uhsId: null }, darfSchreiben: true, onUhs });
    await userEvent.click(screen.getByRole('button', { name: 'UHS zu Wolldecke eintragen' }));
    await waehle('UHS zu Wolldecke', 'UHS Turnhalle');
    await userEvent.click(screen.getByRole('button', { name: 'UHS zu Wolldecke speichern' }));
    expect(await screen.findByText(/UHS ist aufgelöst/)).toBeInTheDocument();
  });

  it('der Filter kennt „ohne Ort“, je Einheit und je UHS; Einheit und UHS treffen beide', () => {
    const k = kontext();
    const posten = [
      { einheit_id: 3, uhs_id: 7 },
      { einheit_id: null, uhs_id: null },
      { einheit_id: 1, uhs_id: null },
    ];
    const filter = ortFilter(posten, k);
    expect(filter.werte.map((w) => w.text)).toEqual([
      'ohne Ort',
      'Rettungsstaffel',
      'Staffel A',
      'UHS Turnhalle',
    ]);
    const wert = (text: string) => filter.werte.find((w) => w.text === text)!.value;
    expect(filter.trifft(posten[0], wert('Rettungsstaffel'))).toBe(true);
    expect(filter.trifft(posten[0], wert('UHS Turnhalle'))).toBe(true);
    expect(filter.trifft(posten[0], wert('ohne Ort'))).toBe(false);
    expect(filter.trifft(posten[1], wert('ohne Ort'))).toBe(true);
    expect(filter.trifft(posten[2], wert('UHS Turnhalle'))).toBe(false);
  });
});
