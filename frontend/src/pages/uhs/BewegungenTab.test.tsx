import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { server } from '../../test/server';
import { renderMitProviders } from '../../test/utils';
import { setzeViewportBreite } from '../../test/viewport';
import type { UhsDetail } from '../../api/types';
import BewegungenTab from './BewegungenTab';

const uhs = {
  einsatz_id: 1,
  plaetze: [],
  belegungen: [
    {
      id: 1,
      person_id: 10,
      art: 'eintritt',
      platz_id: null,
      notiz: null,
      zeitpunkt_at: '2026-06-23 10:00:00',
    },
  ],
} as unknown as UhsDetail;

describe('BewegungenTab (LFH-25)', () => {
  it('verlinkt die Person der Belegung auf ihre Detailseite', async () => {
    server.use(
      http.get('/api/einsaetze/1/personen', () =>
        HttpResponse.json([{ id: 10, registrier_nr: 7, name: 'Müller' }]),
      ),
    );
    renderMitProviders(<BewegungenTab uhs={uhs} />, { route: '/einsaetze/1/unfallhilfsstellen/3' });
    const link = await screen.findByRole('link', { name: /Müller/ });
    expect(link).toHaveAttribute('href', '/einsaetze/1/personen/10');
  });

  it('zeigt #id ohne Link, wenn die Person nicht geladen ist (bewusster Fallback)', async () => {
    server.use(http.get('/api/einsaetze/1/personen', () => HttpResponse.json([])));
    renderMitProviders(<BewegungenTab uhs={uhs} />, { route: '/einsaetze/1/unfallhilfsstellen/3' });
    /**
     * Auf die Personenzelle verengt: über der Sicht steht eine Werkzeugzeile, ein dokumentweites
     * `queryByRole('link')` koppelte an alles, was dort landet.
     */
    const personZelle = await screen.findByText('#10');
    expect(personZelle.closest('a')).toBeNull();
    expect(screen.queryByRole('link', { name: /R-\d{3}/ })).not.toBeInTheDocument();
  });

  // Zeiten laufen Mono mit `tabular-nums`; umhüllt wird an der Aufrufstelle, weil `ZeitAnzeige` ein
  // Fragment rendert.
  it('setzt die Zeit in die Zahlenschrift', async () => {
    server.use(http.get('/api/einsaetze/1/personen', () => HttpResponse.json([])));
    renderMitProviders(<BewegungenTab uhs={uhs} />, { route: '/einsaetze/1/unfallhilfsstellen/3' });
    const zeit = await screen.findByText(/JUN2026$/);
    expect(zeit.style.fontFamily).toContain('JetBrains Mono');
    expect(zeit.style.fontVariantNumeric).toBe('tabular-nums');
  });
});

/**
 * Zweite Fixture, absichtlich verdreht (2, 3, 1). Das Backend liefert `ORDER BY zeitpunkt_at DESC,
 * id DESC`; mit absteigender Fixture wäre der Test mit und ohne `sortWert` grün.
 */
const uhsDreiZeilen = {
  einsatz_id: 1,
  plaetze: [],
  belegungen: [
    {
      id: 2,
      person_id: 11,
      art: 'wechsel',
      platz_id: null,
      notiz: null,
      zeitpunkt_at: '2026-06-23 09:00:00',
    },
    {
      id: 3,
      person_id: 12,
      art: 'austritt',
      platz_id: null,
      notiz: 'Transportziel Klinik',
      zeitpunkt_at: '2026-06-23 11:00:00',
    },
    {
      id: 1,
      person_id: 10,
      art: 'eintritt',
      platz_id: null,
      notiz: null,
      zeitpunkt_at: '2026-06-23 08:00:00',
    },
  ],
} as unknown as UhsDetail;

const DREI_PERSONEN = [
  { id: 10, registrier_nr: 7, name: 'Müller' },
  { id: 11, registrier_nr: 8, name: 'Schulz' },
  { id: 12, registrier_nr: 9, name: 'Weber' },
];

/** Rendert die Drei-Zeilen-Fixture und wartet, bis die Personen aufgelöst SIND. */
async function rendereDrei() {
  server.use(http.get('/api/einsaetze/1/personen', () => HttpResponse.json(DREI_PERSONEN)));
  const gerendert = renderMitProviders(<BewegungenTab uhs={uhsDreiZeilen} />, {
    route: '/einsaetze/1/unfallhilfsstellen/3',
  });
  /**
   * Das Warten ist tragend: `suchText`/`render` liefern `#10`, solange die Personenabfrage läuft,
   * und `R-007 · Müller` erst danach.
   */
  await screen.findByRole('link', { name: /Müller/ });
  return gerendert;
}

/** Das Suchfeld der Werkzeugzeile — `aria-label` ist `Suche in <bezeichnung>`. */
function suchfeld(): HTMLElement {
  return screen.getByRole('searchbox', { name: 'Suche in Bewegungen' });
}

/** Die Zeilenmenge des Tabellenzweigs, in Anzeigereihenfolge. */
function zeilenSchluessel(container: HTMLElement): (string | null)[] {
  // `tr.ant-table-row`, nicht `tr`: `sticky` schiebt eine verborgene Messzeile ein.
  return [...container.querySelectorAll('tr.ant-table-row')].map((r) =>
    r.getAttribute('data-row-key'),
  );
}

describe('BewegungenTab · Datensicht (LFH-330)', () => {
  /**
   * Falle: `zufluss` bleibt `'sammelbanner'` — die Zeilenschleuse friert die Zeilen ein, sobald der
   * Fokus in der Sicht liegt. Wer ins Suchfeld tippt und danach `uhs.belegungen` austauscht, sieht
   * eingefrorene Zeilen.
   */
  it('unter md steht die Kartenform im Baum, nicht die Tabelle', async () => {
    // `setzeViewportBreite` vor dem Render: antds Beobachter liest `matches` nur beim Abonnieren.
    setzeViewportBreite(390);
    server.use(
      http.get('/api/einsaetze/1/personen', () =>
        HttpResponse.json([{ id: 10, registrier_nr: 7, name: 'Müller' }]),
      ),
    );
    renderMitProviders(<BewegungenTab uhs={uhs} />, { route: '/einsaetze/1/unfallhilfsstellen/3' });

    // Der Personen-Link muss in beiden Zweigen bleiben: „0 columnheader" allein erfüllte auch eine
    // leere Komponente.
    expect(await screen.findByRole('link', { name: /Müller/ })).toBeInTheDocument();
    expect(screen.queryAllByRole('columnheader')).toHaveLength(0);
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('am Fükw-Schirm steht die Tabelle im Baum (Gegenprobe)', async () => {
    // 1024 = VIEWPORT_STANDARD, bewusst nicht gesetzt — das belegt den Default.
    server.use(
      http.get('/api/einsaetze/1/personen', () =>
        HttpResponse.json([{ id: 10, registrier_nr: 7, name: 'Müller' }]),
      ),
    );
    renderMitProviders(<BewegungenTab uhs={uhs} />, { route: '/einsaetze/1/unfallhilfsstellen/3' });

    expect(await screen.findByRole('link', { name: /Müller/ })).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader').length).toBeGreaterThanOrEqual(5);
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  it('filtert die Bewegungsarten über die Werkzeugzeile auf die ZEILENMENGE', async () => {
    const { container } = await rendereDrei();
    expect(zeilenSchluessel(container)).toHaveLength(3);

    await userEvent.click(screen.getByRole('combobox', { name: 'Art' }));
    await userEvent.click(await screen.findByTitle('Austritt'));

    /**
     * Gemessen wird nur die Zeilenmenge: `getByText('Austritt')` erfüllte schon das Etikett des
     * Filters, und ein `trifft: () => true` fiele nur über die Zeilen auf.
     */
    expect(zeilenSchluessel(container)).toEqual(['3']);
    expect(screen.getByRole('link', { name: /Weber/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Müller/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Schulz/ })).not.toBeInTheDocument();
  });

  it('zeigt die neueste Bewegung zuerst, auch wenn die Quelle unsortiert liefert', async () => {
    const { container } = await rendereDrei();
    // Die Fixture liefert 2, 3, 1 — die Reihenfolge kommt aus dem Primitiv, nicht vom Server.
    expect(zeilenSchluessel(container)).toEqual(['3', '2', '1']);
  });

  it('über die Zeitspalte lässt sich auf älteste zuerst drehen', async () => {
    const { container } = await rendereDrei();
    const kopf = screen.getByRole('columnheader', { name: /Zeit/ });

    /**
     * Antds Zyklus ist auf → ab → keine, die Sicht startet auf ab. Der erste Klick landet also bei
     * „keine Sortierung", der Lieferreihenfolge (antd meldet dabei `columnKey: undefined`).
     */
    await userEvent.click(kopf);
    expect(zeilenSchluessel(container)).toEqual(['2', '3', '1']);

    await userEvent.click(kopf);
    expect(zeilenSchluessel(container)).toEqual(['1', '2', '3']);
  });

  it('sucht über die angezeigte Personenkennung', async () => {
    const { container } = await rendereDrei();
    await userEvent.type(suchfeld(), 'R-007');
    expect(zeilenSchluessel(container)).toEqual(['1']);
    expect(screen.getByRole('link', { name: /Müller/ })).toBeInTheDocument();
  });

  it('sucht NICHT in der Notiz — der Suchraum ist festgelegt, nicht zufällig', async () => {
    /**
     * Ohne diesen Test wäre eine „alles durchsuchen"-Fassung ebenso grün. Zeile 3 trägt `notiz:
     * 'Transportziel Klinik'`, ist über 'Klinik' aber nicht findbar.
     */
    const { container } = await rendereDrei();
    await userEvent.type(suchfeld(), 'Klinik');
    expect(zeilenSchluessel(container)).toHaveLength(0);
    expect(screen.getByText('Keine Bewegungen erfasst')).toBeInTheDocument();
  });

  it('findet eine nicht aufgelöste Person unter ihrem angezeigten #id', async () => {
    // Gesucht wird, was angezeigt wird: `render` und `suchText` teilen `personEtikett`.
    server.use(http.get('/api/einsaetze/1/personen', () => HttpResponse.json([])));
    const { container } = renderMitProviders(<BewegungenTab uhs={uhs} />, {
      route: '/einsaetze/1/unfallhilfsstellen/3',
    });
    await screen.findByText('#10');

    await userEvent.type(suchfeld(), '#10');
    expect(zeilenSchluessel(container)).toEqual(['1']);

    await userEvent.clear(suchfeld());
    await userEvent.type(suchfeld(), 'R-007');
    expect(zeilenSchluessel(container)).toHaveLength(0);
  });

  it('trägt keinen Spaltenschalter — keine der fünf Spalten ist abwählbar', async () => {
    /**
     * Kein Spaltenschalter, wenn keine Spalte abwählbar ist — ohne `abBreite` wäre sein Zähler
     * immer 0, ein Bedienelement ohne Entscheidung.
     */
    await rendereDrei();
    expect(screen.queryByRole('button', { name: /Spalten/ })).not.toBeInTheDocument();
  });

  it('die Karte trägt alle fünf Spalten: Person als Titel, Art als Etikett, drei Felder', async () => {
    /**
     * Pin: keine der fünf Spalten verschwindet unter `md` (Titel, Statusetikett, drei
     * Sekundärfelder).
     */
    setzeViewportBreite(390);
    server.use(
      http.get('/api/einsaetze/1/personen', () =>
        HttpResponse.json([{ id: 10, registrier_nr: 7, name: 'Müller' }]),
      ),
    );
    const { container } = renderMitProviders(<BewegungenTab uhs={uhs} />, {
      route: '/einsaetze/1/unfallhilfsstellen/3',
    });
    await screen.findByRole('link', { name: /Müller/ });

    // Zweiter Kanal zur Farbe: das Etikett trägt Text.
    expect(screen.getByText('Eintritt')).toBeInTheDocument();
    const felder = [...container.querySelectorAll('[data-lfh="datensicht-feld"]')].map(
      (f) => f.textContent,
    );
    expect(felder).toHaveLength(3);
    expect(felder[0]).toContain('Zeit');
    expect(felder[1]).toBe('PlatzInbox');
    expect(felder[2]).toBe('Notiz—');
  });

  it('die Werkzeugzeile steht auch ohne Daten im Baum', async () => {
    // Eine Zeile, die erst mit der ersten Bewegung erschiene, verschöbe Inhalt (CLS ≤ 0,1).
    server.use(http.get('/api/einsaetze/1/personen', () => HttpResponse.json([])));
    const uhsOhneBewegungen = { ...uhs, belegungen: [] } as unknown as UhsDetail;
    renderMitProviders(<BewegungenTab uhs={uhsOhneBewegungen} />, {
      route: '/einsaetze/1/unfallhilfsstellen/3',
    });

    expect(suchfeld()).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Art' })).toBeInTheDocument();
    expect(await screen.findByText('Keine Bewegungen erfasst')).toBeInTheDocument();
    expect(suchfeld()).toBeInTheDocument();
  });
});
