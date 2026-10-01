import { delay, http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router';
import { meHandler, server } from '../test/server';
import { neuerQueryClient, renderMitProviders } from '../test/utils';
import { einsatzKeys } from '../api/queryKeys';
import { EinsatzAnzeigeProvider } from '../anzeige/AnzeigeKonventionenContext';
import { benutzerFixture, freigabenFixture } from '../test/fixtures';
import type { EinsatzberichtRoh } from '../druck/einsatzbericht/abruf';
import { BETROFFENEN_MERKMALE, rohBericht } from '../druck/einsatzbericht/testdaten';
import EinsatzberichtDruckPage from './EinsatzberichtDruckPage';

/**
 * Einsatzbericht (LFH-726): die Druckansicht zeigt den Bericht vollständig oder gar nicht, nennt
 * fehlende Rechte, kennzeichnet den laufenden Einsatz als vorläufig und lässt keinen Namen
 * Betroffener auf das Blatt.
 */

const E = 5;
const kraft = benutzerFixture({ system_rolle: 'keiner', org_rolle: 'keine' });

function wert<T>(roh: EinsatzberichtRoh, k: keyof EinsatzberichtRoh['quellen']): T {
  const q = roh.quellen[k];
  if (q.zustand !== 'daten') throw new Error(`Testdaten ${k}`);
  return q.daten as T;
}

/** Bedient jede Quelle aus den Testdaten; zählt die Aufrufe je Pfad. */
function quellen(roh: EinsatzberichtRoh = rohBericht()) {
  const aufrufe = new Map<string, number>();
  const zaehle = (pfad: string) => aufrufe.set(pfad, (aufrufe.get(pfad) ?? 0) + 1);
  const json = (pfad: string, k: keyof EinsatzberichtRoh['quellen']) =>
    http.get(`/api/einsaetze/${E}${pfad}`, () => {
      zaehle(pfad);
      return HttpResponse.json(wert(roh, k));
    });
  const etb = wert<{ eintraege: unknown[] }>(roh, 'etbEntscheidungen');
  server.use(
    meHandler(kraft),
    json('', 'einsatz'),
    json('/mitglieder', 'mitglieder'),
    json('/stab', 'stab'),
    json('/stab/lagebesprechungen', 'lagebesprechungen'),
    json('/einheiten', 'einheiten'),
    json('/einheiten/zeitachse', 'einheitenPerioden'),
    json('/personal', 'personal'),
    json('/personal/zeitachse', 'personalPerioden'),
    json('/fahrzeuge', 'fahrzeuge'),
    json('/lageberichte', 'lageberichte'),
    json('/personen', 'personen'),
    json('/schaeden', 'schaeden'),
    json('/betreuung', 'betreuung'),
    json('/verpflegung', 'verpflegung'),
    json('/etb/zaehler', 'etbZaehler'),
    http.get(`/api/einsaetze/${E}/etb`, ({ request }) => {
      zaehle('/etb');
      const typ = new URL(request.url).searchParams.get('typ');
      return HttpResponse.json(typ === 'entscheidung' ? etb.eintraege : []);
    }),
    http.get(`/api/einsaetze/${E}/modul-freigaben`, () => HttpResponse.json(freigabenFixture())),
  );
  return aufrufe;
}

/** Modulfreigaben, wie der Server sie für den Benutzer ausrechnet (LFH-669). */
function freigaben(abweichend: Parameters<typeof freigabenFixture>[0]) {
  server.use(
    http.get(`/api/einsaetze/${E}/modul-freigaben`, () =>
      HttpResponse.json(freigabenFixture(abweichend)),
    ),
  );
}

function rendere() {
  const client = neuerQueryClient();
  client.setQueryData(einsatzKeys.einstellungen(E), {
    einsatz_id: E,
    zeitzone: 'Europe/Berlin',
    org_defaults: { org_id: 1 },
  });
  return renderMitProviders(
    <EinsatzAnzeigeProvider einsatzId={E}>
      <Routes>
        <Route path="/einsaetze/:id/einsatzdaten/bericht" element={<EinsatzberichtDruckPage />} />
      </Routes>
    </EinsatzAnzeigeProvider>,
    { route: `/einsaetze/${E}/einsatzdaten/bericht`, client },
  );
}

const druckKnopf = () => screen.queryByRole('button', { name: 'Drucken / als PDF' });

async function fertig() {
  await waitFor(() => expect(druckKnopf()).toBeEnabled());
}

describe('EinsatzberichtDruckPage', () => {
  it('zeigt die sieben Blöcke in einer Druckwurzel, laufender Einsatz vorläufig', async () => {
    quellen();
    rendere();
    await fertig();
    const wurzeln = document.querySelectorAll('[data-lfh="druckwurzel"]');
    expect(wurzeln).toHaveLength(1);
    const titel = within(wurzeln[0] as HTMLElement)
      .getAllByRole('heading', { level: 3 })
      .map((h) => h.textContent);
    expect(titel).toEqual([
      'Stammdaten',
      'Zeiten',
      'Führung',
      'Kräfte',
      'Lage',
      'Bilanz',
      'ETB-Auszug',
    ]);
    const kopf = document.querySelector('[data-lfh="druckkopf"]') as HTMLElement;
    expect(within(kopf).getByRole('heading', { level: 2 })).toHaveTextContent('Einsatzbericht');
    expect(kopf).toHaveTextContent('Vorläufig – Einsatz läuft');
    expect(kopf).toHaveTextContent('Stand');
  });

  it('lässt keinen Namen, kein Geburtsdatum und keine Registriernummer Betroffener auf das Blatt', async () => {
    quellen();
    rendere();
    await fertig();
    const text = document.body.textContent ?? '';
    for (const merkmal of BETROFFENEN_MERKMALE) expect(text).not.toContain(merkmal);
  });

  it('abgeschlossener Einsatz trägt keinen Vorläufig-Vermerk', async () => {
    const roh = rohBericht();
    const einsatz = wert<object>(roh, 'einsatz');
    quellen(
      rohBericht({
        einsatz: {
          zustand: 'daten',
          daten: { ...einsatz, status: 'abgeschlossen', abgeschlossen_at: '2026-03-29T01:10:00' },
        } as never,
      }),
    );
    rendere();
    await fertig();
    expect(document.querySelector('[data-lfh="druckkopf"]')).not.toHaveTextContent('Vorläufig');
  });

  it('Rollensperre: nennt die fehlenden Module, ruft sie nicht ab und bietet kein Drucken an', async () => {
    const aufrufe = quellen();
    freigaben({ personen: { zugriff: false } });
    rendere();
    expect(
      await screen.findByText('Für den Einsatzbericht fehlen Rechte an: Personen.'),
    ).toBeInTheDocument();
    expect(druckKnopf()).not.toBeInTheDocument();
    expect(aufrufe.get('/personen')).toBeUndefined();
    expect(document.querySelector('[data-lfh="druckwurzel"]')).toBeNull();
  });

  it('im Einsatz ausgeblendete Betreuung: druckbar, Vermerk, kein Abruf', async () => {
    const aufrufe = quellen();
    freigaben({ betreuung: { sichtbar: false } });
    rendere();
    await fertig();
    const bilanz = document.querySelector(
      '[data-lfh="einsatzbericht-block-bilanz"]',
    ) as HTMLElement;
    expect(within(bilanz).getAllByText('In diesem Einsatz nicht genutzt')).toHaveLength(1);
    expect(aufrufe.get('/betreuung')).toBeUndefined();
  });

  it('ein gescheiterter Abruf sperrt das Drucken und bietet einen neuen Versuch an', async () => {
    quellen();
    let versuche = 0;
    server.use(
      http.get(`/api/einsaetze/${E}/lageberichte`, () => {
        versuche += 1;
        return versuche === 1
          ? HttpResponse.json({ error: 'kaputt' }, { status: 500 })
          : HttpResponse.json([]);
      }),
    );
    rendere();
    expect(
      await screen.findByText('Der Einsatzbericht konnte nicht vollständig geladen werden'),
    ).toBeInTheDocument();
    expect(druckKnopf()).toBeDisabled();
    expect(document.querySelector('[data-lfh="druckwurzel"]')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Erneut laden' }));
    await fertig();
  });

  it('ein 403 trotz Freigabe: kein Zugriff, kein Drucken', async () => {
    quellen();
    server.use(
      http.get(`/api/einsaetze/${E}/schaeden`, () =>
        HttpResponse.json({ error: 'verboten' }, { status: 403 }),
      ),
    );
    rendere();
    expect(await screen.findByText('Kein Zugriff auf den Einsatzbericht')).toBeInTheDocument();
    expect(screen.getByText(/Schäden/)).toBeInTheDocument();
    expect(druckKnopf()).not.toBeInTheDocument();
  });

  it('abgelaufene Aufbewahrungsfrist: der Server sperrt schon den Einsatz, Sackgasse ohne Neuversuch', async () => {
    quellen();
    // So antwortet der Server nach Ablauf der Frist (`berechtigung.rs`, `darf_lesen`).
    server.use(
      http.get(`/api/einsaetze/${E}`, () =>
        HttpResponse.json({ error: 'verboten' }, { status: 403 }),
      ),
    );
    rendere();
    expect(await screen.findByText(/die Aufbewahrungsfrist ist abgelaufen/)).toBeInTheDocument();
    expect(druckKnopf()).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Erneut abrufen' })).not.toBeInTheDocument();
  });

  it('ist ein Schnappschuss: Live-Änderungen ändern ihn nicht, „Neu laden“ holt den neuen Stand', async () => {
    quellen();
    const { client } = rendere();
    await fertig();
    const gesamt = () => {
      const block = document.querySelector('[data-lfh="einsatzbericht-block-etb"]') as HTMLElement;
      return within(block).getByText('Gesamt').nextElementSibling?.textContent;
    };
    const kopf = () => document.querySelector('[data-lfh="druckkopf"]') as HTMLElement;
    expect(gesamt()).toBe('3');
    expect(kopf()).toHaveTextContent('Großbrand Halle 3');

    // Der Server hat Neues; die Live-Ereignisse invalidieren Einsatzkopf und ETB.
    const roh = rohBericht();
    server.use(
      http.get(`/api/einsaetze/${E}`, () =>
        HttpResponse.json({ ...wert<object>(roh, 'einsatz'), bezeichnung: 'Umbenannt' }),
      ),
      http.get(`/api/einsaetze/${E}/etb/zaehler`, () =>
        HttpResponse.json({
          gesamt: 4,
          je_typ: {
            meldung: 3,
            anordnung: 0,
            entscheidung: 1,
            lage: 0,
            berichtigung: 0,
            system: 0,
          },
        }),
      ),
    );
    await client.invalidateQueries({ queryKey: einsatzKeys.einsatz(E) });
    await client.invalidateQueries({ queryKey: einsatzKeys.etbZaehler(E, {}) });
    await waitFor(() => expect(screen.getByText('Umbenannt')).toBeInTheDocument());
    expect(gesamt()).toBe('3');
    expect(kopf()).toHaveTextContent('Großbrand Halle 3');

    await userEvent.click(screen.getByRole('button', { name: 'Neu laden' }));
    await waitFor(() => expect(gesamt()).toBe('4'));
    expect(kopf()).toHaveTextContent('Umbenannt');
  });

  it('sperrt das Drucken, solange geladen wird', async () => {
    quellen();
    server.use(
      http.get(`/api/einsaetze/${E}/verpflegung`, async () => {
        await delay(200);
        return HttpResponse.json({ zeitfenster: [] });
      }),
    );
    rendere();
    expect(await screen.findByText('Einsatzbericht wird geladen …')).toBeInTheDocument();
    expect(druckKnopf()).toBeDisabled();
    await fertig();
  });
});
