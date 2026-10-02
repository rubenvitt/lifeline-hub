import { http, HttpResponse } from 'msw';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { server } from '../../test/server';
import { renderMitProviders } from '../../test/utils';
import UhsAnhaenge, { UHS_ABLAGE_HINWEIS } from './UhsAnhaenge';

// LFH-758, Spec `uhs-anhaenge`: Reiter „Dateien“ samt Zugriffsprotokoll der Einsatzleitung.
const LISTE = '/api/einsaetze/1/uhs/9/anhaenge';
const ZUGRIFFE = '/api/einsaetze/1/uhs/9/anhaenge/zugriffe';
const anhang = {
  id: 4,
  uhs_id: 9,
  dateiname: 'grundriss_halle.pdf',
  mime: 'application/pdf',
  groesse: 4096,
  abgelegt_von_id: 1,
  abgelegt_von_name: 'Leitung',
  abgelegt_at: '2026-10-02 10:00:00',
};
const zugriff = {
  id: 1,
  anhang_id: 4,
  dateiname: 'grundriss_halle.pdf',
  benutzer_id: 2,
  benutzer_name: 'Frieda',
  fassung: 'bereinigt',
  zugriff_at: '2026-10-02 10:05:00',
};

function rendere(
  props: { zeigeZugriffe?: boolean; darfSchreiben?: boolean; storniert?: boolean } = {},
  zugriffe: 'fehler' | unknown[] = [zugriff],
) {
  let abrufe = 0;
  server.use(
    http.get(LISTE, () => HttpResponse.json([anhang])),
    http.get(ZUGRIFFE, () => {
      abrufe += 1;
      return zugriffe === 'fehler'
        ? HttpResponse.json({ error: 'kaputt' }, { status: 500 })
        : HttpResponse.json(zugriffe);
    }),
  );
  renderMitProviders(
    <UhsAnhaenge
      einsatzId={1}
      uhs={{
        id: 9,
        bezeichnung: 'BHP 50',
        storniert_at: props.storniert ? '2026-10-02 11:00:00' : null,
      }}
      darfSchreiben={props.darfSchreiben ?? true}
      zeigeZugriffe={props.zeigeZugriffe ?? true}
    />,
  );
  return { abrufe: () => abrufe };
}

describe('UhsAnhaenge (LFH-758)', () => {
  it('listet Dateien mit Anker auf die UHS-Route und benennt die UHS', async () => {
    rendere();
    const anker = await screen.findByRole('link', {
      name: /grundriss_halle\.pdf, .*Datei von UHS BHP 50 herunterladen/,
    });
    expect(anker).toHaveAttribute('href', '/api/einsaetze/1/uhs/9/anhaenge/4/datei');
  });

  it('der Ablegen-Dialog weist auf das Zugriffsprotokoll hin', async () => {
    rendere();
    await userEvent.click(await screen.findByRole('button', { name: 'Datei ablegen' }));
    const d = (await screen.findAllByRole('dialog'))[0];
    expect(within(d).getByText('Datei ablegen · UHS BHP 50')).toBeInTheDocument();
    expect(within(d).getByText(UHS_ABLAGE_HINWEIS)).toBeInTheDocument();
  });

  it('an einer stornierten UHS: lesbar, ohne Aktionen', async () => {
    rendere({ storniert: true });
    expect(await screen.findByRole('link', { name: /herunterladen/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Datei ablegen' })).toBeNull();
    expect(screen.queryByRole('button', { name: /entfernen/ })).toBeNull();
  });

  it('ohne Einsatzleitung kein Bereich „Zugriffe“ und kein Abruf', async () => {
    const r = rendere({ zeigeZugriffe: false });
    await screen.findByRole('link', { name: /herunterladen/ });
    expect(screen.queryByText('Zugriffe')).toBeNull();
    expect(r.abrufe()).toBe(0);
  });

  it('Einsatzleitung: lädt das Protokoll erst beim Aufklappen und zeigt Wer, Datei, Fassung', async () => {
    const r = rendere();
    await screen.findByRole('link', { name: /herunterladen/ });
    expect(r.abrufe(), 'vor dem Aufklappen kein Abruf').toBe(0);

    await userEvent.click(screen.getByText('Zugriffe'));
    const bereich = (await screen.findByText('Frieda')).closest<HTMLElement>('.ant-collapse')!;
    expect(within(bereich).getByText('grundriss_halle.pdf')).toBeInTheDocument();
    expect(within(bereich).getByText('bereinigt')).toBeInTheDocument();
    expect(r.abrufe()).toBe(1);
  });

  it('Einsatzleitung: leeres Protokoll und Fehler werden benannt', async () => {
    rendere({}, []);
    await userEvent.click(await screen.findByText('Zugriffe'));
    expect(await screen.findByText('Noch keine Zugriffe')).toBeInTheDocument();
  });

  it('Einsatzleitung: ein Fehler ist ein Fehler, nicht leer', async () => {
    const r = rendere({}, 'fehler');
    await userEvent.click(await screen.findByText('Zugriffe'));
    expect(await screen.findByText('Zugriffe konnten nicht geladen werden')).toBeInTheDocument();
    expect(r.abrufe(), 'keine Wiederholung').toBe(1);
  });
});
