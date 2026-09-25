import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/server';
import { neuerQueryClient, renderMitProviders } from '../../test/utils';
import { EinsatzAnzeigeProvider } from '../../anzeige/AnzeigeKonventionenContext';
import { einsatzKeys } from '../../api/queryKeys';
import Druckkopf from './Druckkopf';

/**
 * Der gemeinsame Druckkopf (LFH-22, design.md D2). Er macht ein Blatt ohne Bildschirm
 * zuordenbar: Organisation, Dokument, Einsatz, Stand/Auswahl, Ersteller, Druckzeitpunkt.
 */

const BENUTZER = {
  id: 1,
  anzeigename: 'Erika Einsatzleiterin',
  benutzername: 'erika',
  system_rolle: 'admin',
  org_rolle: 'keine',
  aktiv: true,
  erstellt_at: '2026-05-23 10:00:00',
};

function mitOrganisation(name = 'DRK Kreisverband Musterstadt') {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(BENUTZER)),
    http.get('/api/organisation', () => HttpResponse.json({ id: 1, name, tz_organisation: null })),
  );
}

afterEach(() => {
  vi.useRealTimers();
});

function kopf(): HTMLElement {
  return document.querySelector('[data-lfh="druckkopf"]') as HTMLElement;
}

describe('Druckkopf', () => {
  it('nennt Organisation, Dokument als h1, Einsatz mit Nummer, Zeilen und Ersteller', async () => {
    mitOrganisation();
    renderMitProviders(
      <Druckkopf
        dokumentart="Befehl"
        titel="Räumung Nord"
        einsatz={{ bezeichnung: 'Hochwasser Nord', einsatznummer_intern: 'E-2026-0007' }}
        zeilen={[
          { etikett: 'Stand', wert: 'freigegeben, Version 2' },
          { etikett: 'Auswahl', wert: 'Abschnitt: Nord' },
        ]}
        sichtbarkeit="druck"
      />,
    );
    expect(await screen.findByText('DRK Kreisverband Musterstadt')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, hidden: true })).toHaveTextContent(
      'Befehl – Räumung Nord',
    );
    const k = within(kopf());
    expect(k.getByText('Hochwasser Nord (E-2026-0007)')).toBeInTheDocument();
    expect(k.getByText('freigegeben, Version 2')).toBeInTheDocument();
    expect(k.getByText('Abschnitt: Nord')).toBeInTheDocument();
    expect(await k.findByText('Erika Einsatzleiterin')).toBeInTheDocument();
    expect(k.getByText('Gedruckt')).toBeInTheDocument();
  });

  it('setzt ohne Einsatznummer keine leere Klammer', async () => {
    mitOrganisation();
    renderMitProviders(
      <Druckkopf
        dokumentart="Meldebild"
        einsatz={{ bezeichnung: 'Übung', einsatznummer_intern: null }}
        sichtbarkeit="druck"
      />,
    );
    await screen.findByText('DRK Kreisverband Musterstadt');
    const einsatz = within(kopf()).getByText(/^Übung/);
    expect(einsatz.textContent).toBe('Übung');
    // Ohne Titel steht nur die Dokumentart, ohne Gedankenstrich.
    expect(screen.getByRole('heading', { level: 1, hidden: true }).textContent).toBe('Meldebild');
  });

  it('nennt den Druckzeitpunkt in der Anzeigezone, nicht in UTC oder Ortszeit der Maschine', async () => {
    mitOrganisation();
    // Nur `Date` fälschen: `findBy*` hängt an echten Timern.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-16T12:30:00Z'));
    const client = neuerQueryClient();
    client.setQueryData(einsatzKeys.einstellungen(1), {
      einsatz_id: 1,
      zeitzone: 'Asia/Tokyo',
      org_defaults: { org_id: 1 },
    });
    server.use(
      http.get('/api/einsaetze/1/einstellungen', () =>
        HttpResponse.json({ einsatz_id: 1, zeitzone: 'Asia/Tokyo', org_defaults: { org_id: 1 } }),
      ),
    );
    renderMitProviders(
      <EinsatzAnzeigeProvider einsatzId={1}>
        <Druckkopf
          dokumentart="Lagebericht"
          einsatz={{ bezeichnung: 'Übung', einsatznummer_intern: null }}
          sichtbarkeit="druck"
        />
      </EinsatzAnzeigeProvider>,
      { client },
    );
    await screen.findByText('DRK Kreisverband Musterstadt');
    // 12:30 UTC = 21:30 in Tokio. Weder 1230 (UTC) noch die Zone der Testmaschine.
    expect(within(kopf()).getByText('162130JUL2026')).toBeInTheDocument();
  });

  it('ist bei sichtbarkeit="druck" am Bildschirm per Klasse verborgen, bei "immer" nicht', async () => {
    mitOrganisation();
    const { unmount } = renderMitProviders(
      <Druckkopf dokumentart="Befehl" einsatz={{ bezeichnung: 'Übung' }} sichtbarkeit="druck" />,
    );
    await screen.findByText('DRK Kreisverband Musterstadt');
    expect(kopf()).toHaveClass('druckkopf--nur-druck');
    // Dieselbe Aussage für den Zugänglichkeitsbaum: am Schirm ist der Kopf `display: none`,
    // also für Vorlesende nicht da — jsdom lädt kein CSS und bräuchte sonst zwei `h1`.
    expect(kopf()).toHaveAttribute('aria-hidden', 'true');
    unmount();

    renderMitProviders(
      <Druckkopf
        dokumentart="Einsatztagebuch"
        einsatz={{ bezeichnung: 'Übung' }}
        sichtbarkeit="immer"
      />,
    );
    await screen.findByText('DRK Kreisverband Musterstadt');
    expect(kopf()).not.toHaveClass('druckkopf--nur-druck');
    expect(kopf()).not.toHaveAttribute('aria-hidden');
  });

  it('trägt die Bildschirmregel für die Klasse in druck.css', async () => {
    const { readFileSync } = await import('node:fs');
    const { dirname, join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'druck', 'druck.css'),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).toMatch(
      /@media screen\s*\{\s*\.druckkopf--nur-druck\s*\{\s*display:\s*none\s*;?\s*\}/,
    );
  });

  it('zeigt ohne Logo kein Bild und keinen Rahmen', async () => {
    mitOrganisation();
    renderMitProviders(
      <Druckkopf dokumentart="Befehl" einsatz={{ bezeichnung: 'Übung' }} sichtbarkeit="druck" />,
    );
    await screen.findByText('DRK Kreisverband Musterstadt');
    expect(kopf().querySelector('img')).toBeNull();
    expect(kopf().querySelector('.druckkopf__logo')).toBeNull();
  });

  it('zeigt ein hinterlegtes Logo mit dem sha256 als Cache-Brecher', async () => {
    server.use(
      http.get('/api/organisation', () =>
        HttpResponse.json({
          id: 1,
          name: 'DRK Kreisverband Musterstadt',
          tz_organisation: null,
          logo: {
            mime: 'image/png',
            groesse: 10,
            sha256: 'f00d',
            geaendert_at: '2026-09-25 08:00:00',
          },
        }),
      ),
    );
    renderMitProviders(
      <Druckkopf dokumentart="Befehl" einsatz={{ bezeichnung: 'Übung' }} sichtbarkeit="druck" />,
    );
    await screen.findByText('DRK Kreisverband Musterstadt');
    const bild = kopf().querySelector('img');
    expect(bild).not.toBeNull();
    expect(bild).toHaveAttribute('src', '/api/organisation/logo?v=f00d');
    expect(bild).toHaveClass('druckkopf__logo');
  });

  it('nimmt ein Logo, das nicht lädt, weg — kein leerer Bildrahmen auf dem Blatt', async () => {
    server.use(
      http.get('/api/organisation', () =>
        HttpResponse.json({
          id: 1,
          name: 'DRK Kreisverband Musterstadt',
          tz_organisation: null,
          logo: {
            mime: 'image/png',
            groesse: 10,
            sha256: 'f00d',
            geaendert_at: '2026-09-25 08:00:00',
          },
        }),
      ),
    );
    renderMitProviders(
      <Druckkopf dokumentart="Befehl" einsatz={{ bezeichnung: 'Übung' }} sichtbarkeit="druck" />,
    );
    await screen.findByText('DRK Kreisverband Musterstadt');
    fireEvent.error(kopf().querySelector('img')!);
    await waitFor(() => expect(kopf().querySelector('img')).toBeNull());
  });

  it('setzt die Dokumentüberschrift auf Wunsch als h2 (ETB-Druckansicht unter dem Seitenkopf)', async () => {
    mitOrganisation();
    renderMitProviders(
      <Druckkopf
        dokumentart="Einsatztagebuch"
        einsatz={{ bezeichnung: 'Übung' }}
        sichtbarkeit="immer"
        ebene={2}
      />,
    );
    await screen.findByText('DRK Kreisverband Musterstadt');
    expect(screen.getByRole('heading', { level: 2, name: 'Einsatztagebuch' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });
});
