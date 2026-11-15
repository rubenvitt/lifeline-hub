import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { EINTRAEGE } from 'virtual:neuigkeiten';
import { useLocation } from 'react-router';
import { Ebene1OrtProvider } from '../components/Ebene1OrtKontext';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import NeuigkeitenPage from './NeuigkeitenPage';

const LAUFEND = EINTRAEGE[0].version;
const ZULETZT = EINTRAEGE[2].version;

// Der Server antwortet beim Lesen wie beim Markieren mit dem vollen Stand; die Seite ersetzt den
// Cache damit, also muss das Markieren denselben Vorgänger tragen.
function versionsstand(zuletzt?: string) {
  const stand = {
    laufend: LAUFEND,
    gelesen_bis: LAUFEND,
    ...(zuletzt ? { zuletzt_gestartet: zuletzt } : {}),
  };
  return [
    http.get('/api/versionsstand', () => HttpResponse.json(stand)),
    http.post('/api/versionsstand/gelesen', () => HttpResponse.json(stand)),
  ];
}

describe('NeuigkeitenPage', () => {
  it('zeigt das Archiv mit allen Versionen, neueste zuerst', async () => {
    renderMitProviders(<NeuigkeitenPage />);

    expect(await screen.findByRole('heading', { name: 'Neuigkeiten' })).toBeInTheDocument();
    expect(await screen.findByText(LAUFEND)).toBeInTheDocument();
    expect(screen.getByText(EINTRAEGE[EINTRAEGE.length - 1].version)).toBeInTheDocument();
  });

  it('zeigt den Abschnitt „Seit deiner letzten Version“ mit den Versionen seit der letzten', async () => {
    server.use(...versionsstand(ZULETZT));
    renderMitProviders(<NeuigkeitenPage />);

    const abschnitt = (await screen.findByText('Seit deiner letzten Version')).closest('section')!;
    const neu = EINTRAEGE.slice(0, 2).map((e) => e.version);
    for (const version of neu) {
      expect(within(abschnitt).getByText(version)).toBeInTheDocument();
    }
    expect(within(abschnitt).queryByText(ZULETZT)).not.toBeInTheDocument();
  });

  it('blendet den Abschnitt ohne Versionswechsel aus', async () => {
    renderMitProviders(<NeuigkeitenPage />);

    await screen.findByText(LAUFEND);
    expect(screen.queryByText('Seit deiner letzten Version')).not.toBeInTheDocument();
  });

  it('erklärt einen leeren Beta-Kanal statt eine leere Liste zu zeigen', async () => {
    renderMitProviders(<NeuigkeitenPage />);
    await screen.findByText(LAUFEND);

    await userEvent.click(screen.getByText('Beta'));

    expect(await screen.findByText(/Noch keine Beta-Versionen/)).toBeInTheDocument();
  });

  it('markiert die laufende Version beim Öffnen als gelesen', async () => {
    let aufgerufen = false;
    server.use(
      http.get('/api/versionsstand', () =>
        HttpResponse.json({ laufend: LAUFEND, gelesen_bis: ZULETZT }),
      ),
      http.post('/api/versionsstand/gelesen', () => {
        aufgerufen = true;
        return HttpResponse.json({ laufend: LAUFEND, gelesen_bis: LAUFEND });
      }),
    );
    renderMitProviders(<NeuigkeitenPage />);

    await waitFor(() => expect(aufgerufen).toBe(true));
  });

  // Das alte Bundle nach einem Server-Update kennt die Notizen der laufenden Version noch nicht:
  // es darf sie nicht als gelesen markieren, sonst sieht sie nach dem Aktualisieren niemand.
  it('markiert nichts und verweist auf die Aktualisierung, wenn die Notizen der laufenden Version fehlen', async () => {
    let aufgerufen = false;
    server.use(
      http.get('/api/versionsstand', () =>
        HttpResponse.json({ laufend: '99.0.0', gelesen_bis: LAUFEND, zuletzt_gestartet: LAUFEND }),
      ),
      http.post('/api/versionsstand/gelesen', () => {
        aufgerufen = true;
        return HttpResponse.json({ laufend: '99.0.0', gelesen_bis: '99.0.0' });
      }),
    );
    renderMitProviders(<NeuigkeitenPage />);

    expect(await screen.findByText(/Die Notizen zu Version 99\.0\.0/)).toBeInTheDocument();
    // Gelegenheit für einen (falschen) Aufruf geben, bevor das Ausbleiben geprüft wird.
    await new Promise((r) => setTimeout(r, 50));
    expect(aufgerufen).toBe(false);
  });

  // LLH-1731: Neuigkeiten ist eine Seite der Ebene 1 wie Profil, mit Ortspfad und Rückweg.
  it('trägt „Einsätze › Neuigkeiten“ und führt mit dem Rückweg an die Stelle im Einsatz', async () => {
    function PfadSonde() {
      const { pathname } = useLocation();
      return <span data-testid="pfad">{pathname}</span>;
    }
    const { container } = renderMitProviders(
      <>
        <Ebene1OrtProvider
          value={{
            ort: ['Neuigkeiten'],
            rueckweg: { label: 'Zurück zu Starkregen Nord', pfad: '/einsaetze/5/lagekarte' },
          }}
        >
          <NeuigkeitenPage />
        </Ebene1OrtProvider>
        <PfadSonde />
      </>,
      { route: '/neuigkeiten' },
    );

    // Abfragen im Seitenkopf: über das ganze Archiv wäre `getByRole` zu langsam.
    await waitFor(() => expect(container.querySelector('[data-lfh="seitenkopf"]')).not.toBeNull());
    const kopf = container.querySelector('[data-lfh="seitenkopf"]') as HTMLElement;
    expect(within(kopf).getByRole('heading', { level: 1 })).toHaveTextContent('Neuigkeiten');
    const pfad = kopf.querySelector('.lfh-seitenkopf__pfad') as HTMLElement;
    expect(within(pfad).getByRole('link', { name: 'Einsätze' })).toHaveAttribute(
      'href',
      '/einsaetze',
    );
    await userEvent.click(within(kopf).getByRole('link', { name: 'Zurück zu Starkregen Nord' }));
    expect(screen.getByTestId('pfad')).toHaveTextContent('/einsaetze/5/lagekarte');
  });
});
