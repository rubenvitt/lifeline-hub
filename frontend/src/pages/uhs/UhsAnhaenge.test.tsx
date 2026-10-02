import { http, HttpResponse } from 'msw';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { server } from '../../test/server';
import { neuerQueryClient, renderMitProviders } from '../../test/utils';
import { einsatzKeys } from '../../api/queryKeys';
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
  liste: unknown[] = [anhang],
) {
  let abrufe = 0;
  server.use(
    http.get(LISTE, () => HttpResponse.json(liste)),
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

  it('zeigt an Fotos kein Vorschaubild: jeder Abruf gehört ins Protokoll (LFH-759)', async () => {
    rendere({}, [zugriff], [{ ...anhang, dateiname: 'halle.jpg', mime: 'image/jpeg' }]);
    await screen.findByRole('link', { name: /^halle\.jpg, .*Datei von UHS BHP 50 herunterladen/ });
    expect(screen.queryByRole('button', { name: /^Vorschau:/ })).toBeNull();
    expect(document.querySelector('img')).toBeNull();
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

  it('Einsatzleitung: ein leeres Protokoll wird benannt', async () => {
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

// Prüfliste Kriterium 12 (LFH-760, im gemeinsamen Baustein): eine fremde Ablage schiebt sich
// auch an der UHS nicht unter den Cursor, sondern wartet hinter dem Sammelbanner.
describe('UhsAnhaenge — Live-Zufluss', () => {
  it('hält eine fremde Ablage hinter dem Sammelbanner zurück', async () => {
    const client = neuerQueryClient();
    let abruf = 0;
    const neu = { ...anhang, id: 7, dateiname: 'fremd.jpg', mime: 'image/jpeg' };
    server.use(
      http.get(LISTE, () => {
        abruf += 1;
        return HttpResponse.json(abruf === 1 ? [anhang] : [neu, anhang]);
      }),
    );
    renderMitProviders(
      <UhsAnhaenge
        einsatzId={1}
        uhs={{ id: 9, bezeichnung: 'BHP 50', storniert_at: null }}
        darfSchreiben
        zeigeZugriffe={false}
      />,
      { client },
    );
    await screen.findByRole('link', { name: /^grundriss_halle\.pdf, / });

    await client.invalidateQueries({ queryKey: einsatzKeys.uhsAnhaenge(1, 9) });
    const banner = await screen.findByRole('status');
    expect(banner).toHaveTextContent('1 neue Datei');
    expect(screen.queryByRole('link', { name: /^fremd\.jpg, / })).toBeNull();

    await userEvent.click(within(banner).getByRole('button', { name: 'anzeigen' }));
    expect(await screen.findByRole('link', { name: /^fremd\.jpg, / })).toBeInTheDocument();
  });
});
