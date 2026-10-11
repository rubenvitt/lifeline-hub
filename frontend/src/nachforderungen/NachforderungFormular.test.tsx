import { beforeEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import type { ExterneStelle } from '../api/types';
import NachforderungFormular from './NachforderungFormular';

const adressat = () => screen.getByRole('combobox', { name: 'Adressat-Bezeichnung' });

/** Katalog „Externe Stellen“ ohne zuständige Leitstelle, wenn ein Test nichts anderes setzt. */
function katalog(stellen: ExterneStelle[] = []) {
  server.use(http.get('/api/externe-stellen', () => HttpResponse.json(stellen)));
}

beforeEach(() => katalog());

/** Serienerfassung: Adressat und Dringlichkeit bleiben, Art und Bezeichnung wechseln. */
describe('NachforderungFormular — Serienerfassung', () => {
  it('bleibt nach dem Speichern offen, leert die Art und behält den Adressaten', async () => {
    const onAnlegen = vi.fn().mockResolvedValue({});
    renderMitProviders(<NachforderungFormular card={false} senden={false} onAnlegen={onAnlegen} />);

    await userEvent.click(screen.getByRole('checkbox', { name: /Werte behalten/ }));
    await userEvent.type(screen.getByLabelText('Art'), 'RTW');
    await userEvent.type(screen.getByLabelText('Bezeichnung'), 'Zwei RTW zur Verstärkung');
    await userEvent.type(adressat(), 'Leitstelle Nord');
    await userEvent.click(screen.getByRole('button', { name: /Speichern und n/ }));

    await waitFor(() => expect(onAnlegen).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByLabelText('Art')).toHaveValue(''));
    expect(screen.getByLabelText('Bezeichnung')).toHaveValue('');
    expect(adressat()).toHaveValue('Leitstelle Nord');
  });

  it('lässt die Eingabe stehen, wenn der Server ablehnt', async () => {
    const onAnlegen = vi.fn().mockRejectedValue(new Error('422'));
    renderMitProviders(<NachforderungFormular card={false} senden={false} onAnlegen={onAnlegen} />);

    await userEvent.type(screen.getByLabelText('Art'), 'RTW');
    await userEvent.type(screen.getByLabelText('Bezeichnung'), 'Zwei RTW');
    await userEvent.click(screen.getByRole('button', { name: 'Nachforderung absetzen' }));

    await waitFor(() => expect(onAnlegen).toHaveBeenCalled());
    expect(screen.getByLabelText('Art')).toHaveValue('RTW');
  });
});

describe('NachforderungFormular — Eingabegrenzen (LFH-937)', () => {
  it('begrenzt Art, Bezeichnung und Adressat nativ', () => {
    renderMitProviders(<NachforderungFormular card={false} senden={false} onAnlegen={vi.fn()} />);
    expect(screen.getByLabelText('Bezeichnung')).toHaveAttribute('maxlength', '200');
    expect(adressat()).toHaveAttribute('maxlength', '500');
    expect(screen.getByLabelText('Art')).toHaveAttribute('maxlength', '200');
  });

  it('zählt die Begründung ab 80 %; über 500 Zeichen bleibt sie ganz stehen und sperrt', async () => {
    const onAnlegen = vi.fn().mockResolvedValue({});
    renderMitProviders(<NachforderungFormular card={false} senden={false} onAnlegen={onAnlegen} />);
    const begruendung = screen.getByLabelText('Begründung / Lagebezug');
    expect(begruendung).not.toHaveAttribute('maxlength');
    fireEvent.change(begruendung, { target: { value: 'g'.repeat(400) } });
    expect(screen.getByText('400 / 500')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Art'), 'RTW');
    await userEvent.type(screen.getByLabelText('Bezeichnung'), 'Zwei RTW');
    fireEvent.change(begruendung, { target: { value: 'g'.repeat(501) } });
    expect(begruendung).toHaveValue('g'.repeat(501));
    await userEvent.click(screen.getByRole('button', { name: 'Nachforderung absetzen' }));
    expect(
      await screen.findByText('Begründung darf höchstens 500 Zeichen lang sein'),
    ).toBeInTheDocument();
    expect(onAnlegen).not.toHaveBeenCalled();
  });
});

/** LFH-1194, design.md D8: Vorschläge aus dem Katalog und die zuständige Leitstelle als Vorgabe. */
describe('NachforderungFormular — Adressat aus dem Katalog „Externe Stellen“', () => {
  const KATALOG: ExterneStelle[] = [
    { id: 1, bezeichnung: 'ILS Musterkreis', art: 'leitstelle', aktiv: true, zustaendig: true },
    {
      id: 2,
      bezeichnung: 'Leitstelle Nachbarkreis',
      art: 'leitstelle',
      aktiv: true,
      zustaendig: false,
    },
  ];

  /** Wählt in der Kategorie-Auswahl; „Leitstelle“ steht auch als Gruppenkopf der Vorschläge. */
  async function kategorieWaehlen(label: string) {
    await userEvent.click(screen.getByLabelText('Adressat'));
    await waitFor(() =>
      expect(
        document.querySelector(
          `.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option[title="${label}"]`,
        ),
      ).not.toBeNull(),
    );
    await userEvent.click(
      document.querySelector(
        `.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option[title="${label}"]`,
      ) as HTMLElement,
    );
  }

  it('belegt die Adressat-Bezeichnung mit der zuständigen Leitstelle vor, auch nach dem Absetzen', async () => {
    katalog(KATALOG);
    const onAnlegen = vi.fn().mockResolvedValue({});
    renderMitProviders(<NachforderungFormular card={false} senden={false} onAnlegen={onAnlegen} />);
    await waitFor(() => expect(adressat()).toHaveValue('ILS Musterkreis'));

    await userEvent.type(screen.getByLabelText('Art'), 'RTW');
    await userEvent.type(screen.getByLabelText('Bezeichnung'), 'Zwei RTW');
    await userEvent.click(screen.getByRole('button', { name: 'Nachforderung absetzen' }));
    await waitFor(() =>
      expect(onAnlegen).toHaveBeenCalledWith(
        expect.objectContaining({
          adressat_kategorie: 'leitstelle',
          adressat_bezeichnung: 'ILS Musterkreis',
        }),
      ),
    );
    await waitFor(() => expect(screen.getByLabelText('Art')).toHaveValue(''));
    expect(adressat()).toHaveValue('ILS Musterkreis');
  });

  it('überschreibt eine eigene Eingabe beim Kategoriewechsel nicht', async () => {
    katalog(KATALOG);
    renderMitProviders(<NachforderungFormular card={false} senden={false} onAnlegen={vi.fn()} />);
    await waitFor(() => expect(adressat()).toHaveValue('ILS Musterkreis'));
    await userEvent.clear(adressat());
    await userEvent.type(adressat(), 'Leitstelle Nachbarkreis');

    await kategorieWaehlen('Andere BOS');
    await kategorieWaehlen('Leitstelle');
    expect(adressat()).toHaveValue('Leitstelle Nachbarkreis');
  });

  it('belegt nicht vor, wenn die Kategorie beim Eintreffen der Liste nicht „Leitstelle“ ist', async () => {
    let liefern: () => void = () => {};
    const geliefert = new Promise<void>((r) => (liefern = r));
    server.use(
      http.get('/api/externe-stellen', async () => {
        await geliefert;
        return HttpResponse.json(KATALOG);
      }),
    );
    renderMitProviders(<NachforderungFormular card={false} senden={false} onAnlegen={vi.fn()} />);
    await kategorieWaehlen('Andere BOS');
    liefern();
    await userEvent.click(adressat());
    expect(await screen.findByTitle('ILS Musterkreis · zuständig')).toBeInTheDocument();
    expect(adressat()).toHaveValue('');
  });

  it('eine gelöschte Vorbelegung kommt beim Kategoriewechsel nicht zurück', async () => {
    katalog(KATALOG);
    renderMitProviders(<NachforderungFormular card={false} senden={false} onAnlegen={vi.fn()} />);
    await waitFor(() => expect(adressat()).toHaveValue('ILS Musterkreis'));
    await userEvent.clear(adressat());
    await kategorieWaehlen('Andere BOS');
    await kategorieWaehlen('Leitstelle');
    expect(adressat()).toHaveValue('');
  });

  it('ohne zuständige Leitstelle bleibt das Feld leer, die Vorschläge stehen trotzdem bereit', async () => {
    katalog(KATALOG.map((s) => ({ ...s, zustaendig: false })));
    renderMitProviders(<NachforderungFormular card={false} senden={false} onAnlegen={vi.fn()} />);
    await userEvent.click(adressat());
    expect(await screen.findByTitle('ILS Musterkreis')).toBeInTheDocument();
    expect(adressat()).toHaveValue('');
  });
});
