import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { http, HttpResponse } from 'msw';
import { meHandler, server } from '../test/server';
import { benutzerFixture } from '../test/fixtures';
import { merkeRouten } from '../rueckmeldung/adresse';
import { merkeGeraet } from '../geraet/geraetMarke';
import { merkeLetztenOrt } from '../einsatz/letzterOrt';
import { waehle } from '../test/auswahlListe';
import { renderMitProviders } from '../test/utils';
import HilfePage from './HilfePage';
import { KAPITEL, kapitelDerGruppe } from './kapitel';

/**
 * Hilfe (LFH-1096, Spec `anwenderdoku`): ohne Anmeldung lesbar, Mappe je Gruppe, einzelnes
 * Kapitel, Rückweg nach Sitzung, Druck ohne Organisation.
 */

function Ort() {
  const ort = useLocation();
  return <output data-testid="ort">{ort.pathname + ort.search}</output>;
}

function zeige(route: string) {
  return renderMitProviders(
    <>
      <Routes>
        <Route path="/hilfe" element={<HilfePage />} />
        <Route path="/hilfe/:kapitel" element={<HilfePage />} />
        <Route path="*" element={null} />
      </Routes>
      <Ort />
    </>,
    { route },
  );
}

const inhalt = () => document.querySelector<HTMLElement>('[data-lfh="druckwurzel"]')!;
const titel = () =>
  within(inhalt())
    .queryAllByRole('heading', { level: 2 })
    .map((h) => h.textContent);

let drucke: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  drucke = vi.spyOn(window, 'print').mockImplementation(() => {});
});
afterEach(() => drucke.mockRestore());

describe('HilfePage', () => {
  it('zeigt ohne Kapitel alle Kapitel der Gruppe „Alle“ in ihrer Reihenfolge', async () => {
    zeige('/hilfe');
    await waitFor(() => expect(titel()).toEqual(kapitelDerGruppe('alle').map((k) => k.titel)));
    expect(screen.getByRole('button', { name: 'Zur Anmeldung' })).toBeInTheDocument();
  });

  it('zeigt mit Kapitel nur dieses', async () => {
    const k = KAPITEL[KAPITEL.length - 1];
    zeige(`/hilfe/${k.slug}`);
    await waitFor(() => expect(titel()).toEqual([k.titel]));
  });

  it('filtert nach der Gruppe aus der Adresse', async () => {
    zeige('/hilfe?gruppe=administration');
    await waitFor(() =>
      expect(titel()).toEqual(kapitelDerGruppe('administration').map((k) => k.titel)),
    );
    const navi = screen.getByRole('navigation', { name: 'Kapitel' });
    for (const k of KAPITEL.filter((k) => !k.gruppen.includes('administration'))) {
      expect(within(navi).queryByText(k.titel)).toBeNull();
    }
  });

  it('wechselt über die Kapitelliste und behält die Gruppe', async () => {
    const k = kapitelDerGruppe('administration')[0];
    zeige('/hilfe?gruppe=administration');
    await userEvent.click(
      within(screen.getByRole('navigation', { name: 'Kapitel' })).getByText(k.titel),
    );
    expect(screen.getByTestId('ort')).toHaveTextContent(`/hilfe/${k.slug}?gruppe=administration`);
  });

  it('folgt einem Kapitel-Link im Text in der Seite und behält die Gruppe', async () => {
    zeige('/hilfe/geraet-verloren?gruppe=administration');
    const link = await within(inhalt()).findByRole('link', { name: 'Arbeiten ohne Netz' });
    expect(link).toHaveAttribute('href', '/hilfe/ohne-netz?gruppe=administration');
    await userEvent.click(link);
    expect(screen.getByTestId('ort')).toHaveTextContent('/hilfe/ohne-netz?gruppe=administration');
  });

  it('zeigt die Bilder eines Kapitels aus dem Bundle, verzögert geladen (LFH-1128)', async () => {
    const k = KAPITEL.find((k) => /!\[[^\]]+\]\(\.\.\/bilder\//.test(k.text));
    expect(k, 'kein Kapitel mit Bild (Muster „Anmelden und Abmelden“)').toBeDefined();
    const verweise = [...k!.text.matchAll(/!\[([^\]]+)\]\(([^)]+)\)/g)];
    zeige(`/hilfe/${k!.slug}`);
    const bilder = await within(inhalt()).findAllByRole('img');
    expect(bilder.map((b) => b.getAttribute('alt'))).toEqual(verweise.map((v) => v[1]));
    for (const b of bilder) {
      expect(b.getAttribute('src'), 'gebaute Adresse statt des Pfads aus dem Kapitel').not.toMatch(
        /^\.\.\/bilder\//,
      );
      expect(b).toHaveAttribute('loading', 'lazy');
      expect(b).toHaveClass('hilfe-bild');
    }
  });

  it('nennt ein unbekanntes Kapitel und führt zurück zur Mappe', async () => {
    zeige('/hilfe/gibt-es-nicht');
    expect(await screen.findByText('Kapitel nicht gefunden')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Drucken/ })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Alle Kapitel' }));
    expect(screen.getByTestId('ort')).toHaveTextContent(/^\/hilfe$/);
  });

  it('druckt ohne Anmeldung, ohne die Organisation zu laden', async () => {
    let abgefragt = false;
    server.use(
      http.get('/api/organisation', () => {
        abgefragt = true;
        return HttpResponse.json({}, { status: 401 });
      }),
    );
    zeige('/hilfe');
    await userEvent.click(await screen.findByRole('button', { name: /Drucken/ }));
    await waitFor(() => expect(drucke).toHaveBeenCalledTimes(1));
    expect(abgefragt).toBe(false);
  });

  /** Angemeldete Person (id 1) und ihre Einsatzliste. */
  function angemeldet(einsaetze: unknown[] = []) {
    server.use(
      http.get('/api/auth/me', () =>
        HttpResponse.json({
          id: 1,
          benutzername: 'admin',
          anzeigename: 'Admin',
          system_rolle: 'admin',
          org_rolle: 'keine',
          org_id: 1,
        }),
      ),
      http.get('/api/einsaetze', () => HttpResponse.json(einsaetze)),
    );
  }
  const aktiv = { id: 5, bezeichnung: 'Starkregen Nord', status: 'aktiv' };

  describe('Rückweg angemeldeter Personen (LLH-1731)', () => {
    beforeEach(() => localStorage.clear());

    it('ohne gemerkten Einsatz „Zu den Einsätzen“ zur Einsatzliste', async () => {
      angemeldet([aktiv]);
      zeige('/hilfe');
      await userEvent.click(await screen.findByRole('button', { name: 'Zu den Einsätzen' }));
      expect(screen.getByTestId('ort')).toHaveTextContent('/einsaetze');
      expect(screen.queryByRole('button', { name: 'Zur App' })).toBeNull();
    });

    it('bei abgeschlossenem Einsatz „Zu den Einsätzen“', async () => {
      merkeLetztenOrt(1, { einsatzId: 5, pfad: '/einsaetze/5/etb' });
      angemeldet([{ ...aktiv, status: 'abgeschlossen' }]);
      zeige('/hilfe');
      expect(await screen.findByRole('button', { name: 'Zu den Einsätzen' })).toBeInTheDocument();
      await new Promise((r) => setTimeout(r, 50));
      expect(screen.queryByRole('button', { name: /^Zurück zu/ })).toBeNull();
    });

    it('„Zurück zu <Einsatz>“ an die gemerkte Stelle, auch nach einem Kapitelwechsel', async () => {
      merkeLetztenOrt(1, { einsatzId: 5, pfad: '/einsaetze/5/etb' });
      angemeldet([aktiv]);
      zeige('/hilfe');
      await screen.findByRole('button', { name: 'Zurück zu Starkregen Nord' });
      const navi = screen.getByRole('navigation', { name: 'Kapitel' });
      await userEvent.click(within(navi).getByRole('link', { name: KAPITEL[1].titel }));
      await waitFor(() =>
        expect(screen.getByTestId('ort')).toHaveTextContent(`/hilfe/${KAPITEL[1].slug}`),
      );
      await userEvent.click(screen.getByRole('button', { name: 'Zurück zu Starkregen Nord' }));
      expect(screen.getByTestId('ort')).toHaveTextContent('/einsaetze/5/etb');
    });

    // Review B5 (Entscheidung 15.11.2026): der Rückweg ist je Besuch der Hilfe fest. Arbeitet die
    // Person im ersten Tab weiter, ändert ein Kapitelwechsel in der Hilfe ihn nicht.
    it('bleibt je Besuch fest, auch wenn ein anderer Tab inzwischen einen Ort merkt', async () => {
      merkeLetztenOrt(1, { einsatzId: 5, pfad: '/einsaetze/5/etb' });
      angemeldet([aktiv, { id: 6, bezeichnung: 'Sturm Süd', status: 'aktiv' }]);
      zeige('/hilfe');
      await screen.findByRole('button', { name: 'Zurück zu Starkregen Nord' });
      // Der erste Tab wechselt in einen anderen Einsatz.
      merkeLetztenOrt(1, { einsatzId: 6, pfad: '/einsaetze/6/lagekarte' });
      const navi = screen.getByRole('navigation', { name: 'Kapitel' });
      await userEvent.click(within(navi).getByRole('link', { name: KAPITEL[1].titel }));
      await waitFor(() =>
        expect(screen.getByTestId('ort')).toHaveTextContent(`/hilfe/${KAPITEL[1].slug}`),
      );
      await userEvent.click(within(navi).getByRole('link', { name: KAPITEL[2].titel }));
      await waitFor(() =>
        expect(screen.getByTestId('ort')).toHaveTextContent(`/hilfe/${KAPITEL[2].slug}`),
      );
      await new Promise((r) => setTimeout(r, 50));
      expect(screen.queryByRole('button', { name: 'Zurück zu Sturm Süd' })).toBeNull();
      await userEvent.click(screen.getByRole('button', { name: 'Zurück zu Starkregen Nord' }));
      expect(screen.getByTestId('ort')).toHaveTextContent('/einsaetze/5/etb');
    });
  });
});

/**
 * Rückmeldung und Lizenzen (LLH-1642, Spec `benutzermenue`): seit dem Entschlacken des
 * Benutzermenüs stehen beide in der Übersicht der Hilfe. Der Rückmeldeweg gibt den Bereich mit,
 * aus dem die Hilfe geöffnet wurde (Router-State `von`), wie bisher nur als Routenmuster.
 */
describe('HilfePage — Rückmeldung und Lizenzen (LLH-1642)', () => {
  let oeffnen: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    oeffnen = vi.spyOn(window, 'open').mockReturnValue(null);
    merkeRouten([{ path: '/einsatz/:id/etb' }, { path: '/hilfe' }, { path: '/hilfe/:kapitel' }]);
  });
  afterEach(() => {
    oeffnen.mockRestore();
    merkeRouten([]);
    merkeGeraet(false);
  });

  function geraeteSitzung() {
    server.use(
      meHandler({
        ...benutzerFixture({ anzeigename: 'Betreuungsstelle Halle · Tablet 1' }),
        geraet: {
          kopplung_id: 4,
          einsatz_id: 7,
          ansicht: 'betreuungsstelle',
          uhs_id: null,
          stelle_id: 2,
          stelle: 'Halle',
          bezeichnung: 'Tablet 1',
          laeuft_ab_at: '2026-10-08 12:00:00',
        },
      }),
    );
  }

  function seiteVonAdresse(): string | null {
    const [ziel] = oeffnen.mock.calls[0]!;
    return new URL(String(ziel)).searchParams.get('seite');
  }

  it('die Übersicht trägt „Rückmeldung geben“ und „Lizenzen“', async () => {
    zeige('/hilfe');
    const abschnitt = await screen.findByRole('region', { name: 'Rückmeldung und Lizenzen' });
    // Erst nach dem Laden der Sitzung: bis dahin ist offen, ob das ein gekoppeltes Gerät ist.
    expect(
      await within(abschnitt).findByRole('button', { name: /Rückmeldung geben/ }),
    ).toBeInTheDocument();
    expect(within(abschnitt).getByRole('link', { name: /Lizenzen/ })).toHaveAttribute(
      'href',
      '/lizenzen/HEIC-DECODER.txt',
    );
    expect(within(abschnitt).getByText(`Version ${__APP_VERSION__}`)).toBeInTheDocument();
    // Nicht im Druck: der Abschnitt liegt außerhalb der Druckwurzel.
    expect(inhalt().contains(abschnitt)).toBe(false);
  });

  it('mit Kapitel in der Adresse fehlt der Abschnitt', async () => {
    const k = KAPITEL[0]!;
    zeige(`/hilfe/${k.slug}`);
    await waitFor(() => expect(titel()).toEqual([k.titel]));
    expect(screen.queryByRole('region', { name: 'Rückmeldung und Lizenzen' })).toBeNull();
  });

  it('„Rückmeldung geben“ trägt den Bereich, aus dem die Hilfe geöffnet wurde', async () => {
    renderMitProviders(
      <Routes>
        <Route
          path="/start"
          element={<Navigate to="/hilfe" state={{ von: '/einsatz/42/etb' }} />}
        />
        <Route path="/hilfe" element={<HilfePage />} />
      </Routes>,
      { route: '/start' },
    );
    await userEvent.click(await screen.findByRole('button', { name: /Rückmeldung geben/ }));
    expect(oeffnen).toHaveBeenCalledTimes(1);
    const [ziel, fenster, merkmale] = oeffnen.mock.calls[0]!;
    expect(fenster).toBe('_blank');
    expect(merkmale).toBe('noopener,noreferrer');
    const adresse = new URL(String(ziel));
    expect(adresse.origin + adresse.pathname).toBe(
      'https://github.com/rubenvitt/lifeline-hub/issues/new',
    );
    expect(adresse.searchParams.get('version')).toBe(__APP_VERSION__);
    // Das Muster, nie die Kennung.
    expect(seiteVonAdresse()).toBe('/einsatz/:id/etb');
    expect(String(ziel)).not.toContain('42');
  });

  it('die Herkunft bleibt über einen Wechsel der Lesergruppe erhalten', async () => {
    renderMitProviders(
      <Routes>
        <Route
          path="/start"
          element={<Navigate to="/hilfe" state={{ von: '/einsatz/42/etb' }} />}
        />
        <Route path="/hilfe" element={<HilfePage />} />
      </Routes>,
      { route: '/start' },
    );
    await screen.findByRole('region', { name: 'Rückmeldung und Lizenzen' });
    await waehle('Lesergruppe', 'Administration');
    await waitFor(() =>
      expect(titel()).toEqual(kapitelDerGruppe('administration').map((k) => k.titel)),
    );
    await userEvent.click(screen.getByRole('button', { name: /Rückmeldung geben/ }));
    expect(seiteVonAdresse()).toBe('/einsatz/:id/etb');
  });

  // LLH-1731 D5: im neuen Tab reist die Herkunft als `von` in der Adresse.
  it('übernimmt `von` aus der Adresse, entfernt ihn und behält die Gruppe', async () => {
    zeige(`/hilfe?gruppe=administration&von=${encodeURIComponent('/einsatz/42/etb')}`);
    await waitFor(() =>
      expect(screen.getByTestId('ort')).toHaveTextContent(/^\/hilfe\?gruppe=administration$/),
    );
    await waehle('Lesergruppe', 'Alle');
    await waitFor(() => expect(screen.getByTestId('ort')).toHaveTextContent(/^\/hilfe$/));
    await userEvent.click(await screen.findByRole('button', { name: /Rückmeldung geben/ }));
    expect(seiteVonAdresse()).toBe('/einsatz/:id/etb');
    expect(String(oeffnen.mock.calls[0]![0])).not.toContain('42');
  });

  it('verwirft einen `von`, der keine Adresse der App ist', async () => {
    zeige(`/hilfe?von=${encodeURIComponent('//fremd.example/einsatz/42/etb')}`);
    await waitFor(() => expect(screen.getByTestId('ort')).toHaveTextContent(/^\/hilfe$/));
    await userEvent.click(await screen.findByRole('button', { name: /Rückmeldung geben/ }));
    expect(seiteVonAdresse()).toBe('/hilfe');
  });

  it('nach einer widerrufenen Kopplung (Browser lief als Gerät) fehlt „Rückmeldung geben“', async () => {
    merkeGeraet(true);
    let beantwortet = false;
    server.use(
      http.get('/api/auth/me', () => {
        beantwortet = true;
        return HttpResponse.json({ error: 'abgemeldet' }, { status: 401 });
      }),
    );
    zeige('/hilfe');
    // Erst nach der Antwort zur Sitzung prüfen: davor fehlt der Knopf ohnehin (`laedt`).
    await waitFor(() => expect(beantwortet).toBe(true));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Zur Anmeldung' })).toBeInTheDocument(),
    );
    await new Promise((r) => setTimeout(r, 50));
    // Positive Gegenprobe: der Abschnitt steht, nur ohne Knopf.
    const abschnitt = await screen.findByRole('region', { name: 'Rückmeldung und Lizenzen' });
    expect(within(abschnitt).getByRole('link', { name: /Lizenzen/ })).toBeInTheDocument();
    expect(within(abschnitt).queryByRole('button', { name: /Rückmeldung geben/ })).toBeNull();
  });

  it('ohne Suchtreffer bleiben „Rückmeldung geben“ und „Lizenzen“ erreichbar', async () => {
    zeige('/hilfe');
    await userEvent.type(
      screen.getByRole('searchbox', { name: 'Kapitel durchsuchen' }),
      'xyzkeinkapitelpasst',
    );
    // Vorbedingung: die Suche hat wirklich keinen Treffer.
    expect(await screen.findByText('Kein Kapitel passt zur Suche.')).toBeInTheDocument();
    const abschnitt = screen.getByRole('region', { name: 'Rückmeldung und Lizenzen' });
    expect(
      await within(abschnitt).findByRole('button', { name: /Rückmeldung geben/ }),
    ).toBeInTheDocument();
    expect(within(abschnitt).getByRole('link', { name: /Lizenzen/ })).toBeInTheDocument();
  });

  it('ohne Herkunft trägt die Rückmeldung das Muster der Hilfe', async () => {
    zeige('/hilfe');
    await userEvent.click(await screen.findByRole('button', { name: /Rückmeldung geben/ }));
    expect(seiteVonAdresse()).toBe('/hilfe');
  });

  it('in der Sitzung eines gekoppelten Geräts fehlt „Rückmeldung geben“, „Lizenzen“ bleibt', async () => {
    geraeteSitzung();
    zeige('/hilfe');
    // Positive Gegenprobe: die Sitzung ist geladen, der Rückweg führt zum Gerät.
    expect(await screen.findByRole('button', { name: 'Zum Gerät' })).toBeInTheDocument();
    const abschnitt = screen.getByRole('region', { name: 'Rückmeldung und Lizenzen' });
    expect(within(abschnitt).getByRole('link', { name: /Lizenzen/ })).toBeInTheDocument();
    expect(within(abschnitt).queryByRole('button', { name: /Rückmeldung geben/ })).toBeNull();
  });
});
