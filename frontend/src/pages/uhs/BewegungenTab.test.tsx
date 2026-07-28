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
    { id: 1, person_id: 10, art: 'eintritt', platz_id: null, notiz: null, zeitpunkt_at: '2026-06-23 10:00:00' },
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
     * Auf die Personenzelle VERENGT, nicht dokumentweit: seit LFH-330 steht über der Sicht
     * eine stets gerenderte Werkzeugzeile, und ein unskopiertes `queryByRole('link')` würde
     * an alles koppeln, was künftig dort landet. Gemessen bliebe es heute grün — antds
     * Blätterung rendert Seitenzahlen als Anker OHNE `href` und hat damit keine
     * `link`-Rolle —, aber aus einem Grund, der nichts mit der Aussage zu tun hat.
     */
    const personZelle = await screen.findByText('#10');
    expect(personZelle.closest('a')).toBeNull();
    expect(screen.queryByRole('link', { name: /R-\d{3}/ })).not.toBeInTheDocument();
  });
});

/**
 * Zweite Fixture, ABSICHTLICH verdreht (2, 3, 1 nach Zeit: Mitte, neueste, älteste).
 *
 * Das Backend liefert `ORDER BY zeitpunkt_at DESC, id DESC` (`src/uhs/belegung_repo.rs`),
 * und `daten` ist genau diese Antwort. Ein Test mit absteigend sortierter Fixture wäre
 * deshalb MIT UND OHNE `sortWert` grün und belegte nichts.
 */
const uhsDreiZeilen = {
  einsatz_id: 1,
  plaetze: [],
  belegungen: [
    { id: 2, person_id: 11, art: 'wechsel', platz_id: null, notiz: null, zeitpunkt_at: '2026-06-23 09:00:00' },
    { id: 3, person_id: 12, art: 'austritt', platz_id: null, notiz: 'Transportziel Klinik', zeitpunkt_at: '2026-06-23 11:00:00' },
    { id: 1, person_id: 10, art: 'eintritt', platz_id: null, notiz: null, zeitpunkt_at: '2026-06-23 08:00:00' },
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
   * Das Warten ist tragend, nicht Vorsicht: `suchText`/`render` liefern `#10`, solange die
   * Personenabfrage läuft, und `R-007 · Müller` erst danach. Wer vor dem Auflösen tippt
   * oder filtert, prüft gegen den falschen Text.
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
  // `tr.ant-table-row`, nicht `tr`: `sticky` schiebt eine verborgene Messzeile als erste
  // Körperzeile ein (dokumentiert in `components/KatalogTabelle.tsx`).
  return [...container.querySelectorAll('tr.ant-table-row')].map((r) =>
    r.getAttribute('data-row-key'),
  );
}

describe('BewegungenTab · Datensicht (LFH-330)', () => {
  /**
   * FALLE (F9): `zufluss` bleibt ungesetzt, also `'sammelbanner'` — die Zeilenschleuse
   * friert Menge und Reihenfolge ein, sobald der Fokus INNERHALB der Sicht liegt. Für die
   * Tests hier harmlos (`daten` kommt aus dem Prop und wechselt nie mitten im Test), aber
   * wer künftig ins Suchfeld tippt UND danach `uhs.belegungen` austauscht, sieht
   * eingefrorene Zeilen und liest das als Filterfehler.
   */
  it('unter md steht die Kartenform im Baum, nicht die Tabelle', async () => {
    // `setzeViewportBreite` VOR dem Render (F3): antds Beobachter ruft seinen Zuhörer beim
    // Abonnieren synchron auf und liest nur `matches` — nachträglich gesetzt erreicht ihn
    // die Breite nie, und der Test prüfte bei 1024 px das Gegenteil seiner Aussage.
    setzeViewportBreite(390);
    server.use(
      http.get('/api/einsaetze/1/personen', () =>
        HttpResponse.json([{ id: 10, registrier_nr: 7, name: 'Müller' }]),
      ),
    );
    renderMitProviders(<BewegungenTab uhs={uhs} />, { route: '/einsaetze/1/unfallhilfsstellen/3' });

    // Der Personen-Link muss in BEIDEN Zweigen erhalten bleiben: „0 columnheader" allein
    // wäre auch von einer Komponente erfüllt, die gar nichts rendert.
    expect(await screen.findByRole('link', { name: /Müller/ })).toBeInTheDocument();
    expect(screen.queryAllByRole('columnheader')).toHaveLength(0);
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('am Fükw-Schirm steht die Tabelle im Baum (Gegenprobe)', async () => {
    // 1024 = VIEWPORT_STANDARD, bewusst NICHT gesetzt — das belegt den Default.
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
     * Gemessen wird ausschließlich die Zeilenmenge (F7). Ein `getByText('Austritt')` wäre
     * schon vom Auswahl-Etikett des Filters erfüllt, und ein `trifft`, das immer `true`
     * liefert, käme daran vorbei — die Mutationsprobe (`trifft: () => true`) fällt nur über
     * die Zeilen und ihre Personen-Links.
     */
    expect(zeilenSchluessel(container)).toEqual(['3']);
    expect(screen.getByRole('link', { name: /Weber/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Müller/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Schulz/ })).not.toBeInTheDocument();
  });

  it('zeigt die neueste Bewegung zuerst, auch wenn die Quelle unsortiert liefert', async () => {
    const { container } = await rendereDrei();
    // Die Fixture liefert 2, 3, 1 — die Reihenfolge kommt also aus dem Primitiv, nicht
    // aus dem Server (F4: mit absteigender Fixture wäre der Test nicht fehlschlagbar).
    expect(zeilenSchluessel(container)).toEqual(['3', '2', '1']);
  });

  it('über die Zeitspalte lässt sich auf älteste zuerst drehen', async () => {
    const { container } = await rendereDrei();
    const kopf = screen.getByRole('columnheader', { name: /Zeit/ });

    /**
     * Antds Zyklus ist aufsteigend → absteigend → GAR NICHT, und die Sicht startet auf
     * absteigend. Der erste Klick landet deshalb auf der dritten Stufe: keine Sortierung,
     * also die Lieferreihenfolge (hier gemessen, weil sonst niemand merkt, wenn das
     * Löschen der Sortierung verloren geht — antd meldet dabei `columnKey: undefined`).
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
     * Der wertvollere der beiden Suchtests: ohne ihn wäre eine „alles durchsuchen"-Fassung
     * ebenso grün, und der Auftrag „Suche auf Person/Registriernummer" bliebe unbelegt.
     * Zeile 3 trägt `notiz: 'Transportziel Klinik'`, ist über 'Klinik' aber nicht findbar.
     */
    const { container } = await rendereDrei();
    await userEvent.type(suchfeld(), 'Klinik');
    expect(zeilenSchluessel(container)).toHaveLength(0);
    expect(screen.getByText('Keine Bewegungen erfasst')).toBeInTheDocument();
  });

  it('findet eine nicht aufgelöste Person unter ihrem angezeigten #id', async () => {
    // Gesucht wird, was ANGEZEIGT wird: `render` und `suchText` teilen `personEtikett`.
    // Eine #10-Zeile ist deshalb über '#10' findbar und über 'R-007' nicht.
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
     * §6 der API-Festlegung nennt eine „Schwelle" (5 Spalten liegen darunter), die es im
     * gelieferten Primitiv nicht gibt: der Schalter verschwindet dort, wenn KEINE Spalte
     * abwählbar ist. Genau das ist hier die Aussage — und sie ist auch die richtige: ohne
     * `abBreite` an irgendeiner Spalte wäre der Zähler des Schalters immer 0, und ein
     * Bedienelement für eine Entscheidung, die niemand treffen muss, ist Rauschen.
     */
    await rendereDrei();
    expect(screen.queryByRole('button', { name: /Spalten/ })).not.toBeInTheDocument();
  });

  it('die Karte trägt alle fünf Spalten: Person als Titel, Art als Etikett, drei Felder', async () => {
    /**
     * PIN, kein TDD-Schritt: die Slots waren mit der Migration da. Er hält fest, dass keine
     * der fünf Spalten unter `md` verschwindet — Titel (Person), Statusetikett (Art) und
     * drei Sekundärfelder (Zeit, Platz, Notiz) schöpfen zusammen das ganze Register aus.
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

    // Zweiter Kanal zur Farbe: das Etikett trägt Text (`label` ist am Vertragstyp Pflicht).
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
    // Zusicherung 5 / Lehre aus der Sticky-Reserve (B1): eine Zeile, die erst beim
    // Eintreffen der ersten Bewegung erschiene, verschöbe Inhalt — CLS ≤ 0,1.
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
