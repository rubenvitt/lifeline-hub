import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { BelegungVerlaufEintrag, StandVerlaufEintrag } from '../api/types';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import MeldeVerlauf from './MeldeVerlauf';

/**
 * Meldeverlauf (LFH-676, Spec „Verlauf auf der Betreuungsseite“, „Kennzeichnung im
 * Verlauf“, „Zurücknehmen aus dem Verlauf“).
 *
 * Die Anzeigezone ist hier Asia/Kolkata (UTC+5:30): ein Versatz mit halber Stunde macht eine
 * als Ortszeit gelesene UTC-Zeit sofort sichtbar — 10:30 UTC wird 1600, nie 1030.
 */
vi.mock('../anzeige/AnzeigeKonventionenContext', async () => {
  const format = await import('../anzeige/format');
  const konventionen = {
    ...format.DEFAULT_KONVENTIONEN,
    zeitzone: 'Asia/Kolkata',
  };
  return {
    useAnzeigeKonventionen: () => ({
      konventionen,
      formatZeit: (s?: string | null) => format.formatZeit(s, konventionen),
      formatZeitKurz: (s?: string | null) => format.formatZeitKurz(s, konventionen),
      formatKoordinate: () => '',
      formatDistanz: () => '',
    }),
  };
});

const B = '/api/einsaetze/7/betreuung';

const STAENDE: StandVerlaufEintrag[] = [
  {
    id: 3,
    evakuiert: 480,
    erhebung: 'gezaehlt',
    zeitpunkt_at: '2026-09-23 11:00:00',
    erfasst_at: '2026-09-23 11:00:02',
    erfasst_von: 'Leitung',
    aktuell: true,
  },
  {
    // Nachgetragen: Zeitpunkt 10:30, erfasst 11:05 (UTC).
    id: 4,
    evakuiert: 300,
    erhebung: 'gezaehlt',
    zeitpunkt_at: '2026-09-23 10:30:00',
    erfasst_at: '2026-09-23 11:05:00',
    erfasst_von: 'Stab S1',
    aktuell: false,
  },
  {
    id: 1,
    evakuiert: 212,
    erhebung: 'geschaetzt',
    zeitpunkt_at: '2026-09-23 10:00:00',
    erfasst_at: '2026-09-23 10:00:20',
    erfasst_von: 'Leitung',
    aktuell: false,
    zurueckgenommen_at: '2026-09-23 11:12:00',
    zurueckgenommen_von: 'Stab S1',
  },
];

const BELEGUNGEN: BelegungVerlaufEintrag[] = [
  {
    id: 9,
    belegt: 0,
    zeitpunkt_at: '2026-09-23 12:00:00',
    erfasst_at: '2026-09-23 12:00:00',
    erfasst_von: 'Leitung',
    aktuell: true,
  },
  {
    id: 8,
    belegt: 89,
    zeitpunkt_at: '2026-09-23 11:00:00',
    erfasst_at: '2026-09-23 11:00:00',
    erfasst_von: 'Leitung',
    aktuell: false,
  },
];

function liefere(pfad: string, antwort: unknown, status = 200) {
  const aufrufe = { n: 0 };
  server.use(
    http.get(`${B}${pfad}`, () => {
      aufrufe.n += 1;
      return HttpResponse.json(antwort as object, { status });
    }),
  );
  return aufrufe;
}

function faengeRuecknahme(pfadMuster: string, antwort: () => Response) {
  const ids: string[] = [];
  server.use(
    http.post(`${B}${pfadMuster}`, ({ params }) => {
      ids.push(String(params.id));
      return antwort();
    }),
  );
  return ids;
}

const eintraege = () => screen.getAllByRole('listitem');

describe('MeldeVerlauf · Zustände', () => {
  it('lädt die Reihe des Bezirks und zeigt sie in Serverreihenfolge', async () => {
    const aufrufe = liefere('/bezirke/5/staende', STAENDE);
    renderMitProviders(<MeldeVerlauf einsatzId={7} art="bezirk" objektId={5} darfZuruecknehmen />);
    expect(await screen.findByText('480 evakuiert (gezählt)')).toBeInTheDocument();
    expect(eintraege().map((e) => e.textContent)).toEqual([
      expect.stringContaining('480 evakuiert'),
      expect.stringContaining('300 evakuiert'),
      expect.stringContaining('212 evakuiert'),
    ]);
    expect(aufrufe.n).toBe(1);
  });

  it('nennt den Ladefehler und zeigt NICHT „Noch keine Meldung“', async () => {
    liefere('/bezirke/5/staende', { error: 'kaputt' }, 500);
    renderMitProviders(<MeldeVerlauf einsatzId={7} art="bezirk" objektId={5} darfZuruecknehmen />);
    const alarm = await screen.findByRole('alert');
    expect(alarm).toHaveTextContent('Verlauf konnte nicht geladen werden');
    expect(screen.queryByText('Noch keine Meldung.')).not.toBeInTheDocument();
    expect(within(alarm).getByRole('button', { name: 'Erneut abrufen' })).toBeInTheDocument();
  });

  it('der Ladezustand steht in Worten da, nicht nur als Skelett', async () => {
    server.use(http.get(`${B}/bezirke/5/staende`, () => new Promise<Response>(() => {})));
    renderMitProviders(<MeldeVerlauf einsatzId={7} art="bezirk" objektId={5} darfZuruecknehmen />);
    expect(await screen.findByText('Verlauf wird geladen …')).toBeVisible();
  });

  it('eine leere Reihe sagt „Noch keine Meldung.“', async () => {
    liefere('/stellen/9/belegungen', []);
    renderMitProviders(<MeldeVerlauf einsatzId={7} art="stelle" objektId={9} darfZuruecknehmen />);
    expect(await screen.findByText('Noch keine Meldung.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('MeldeVerlauf · Kennzeichnung', () => {
  it('aktuell, nachgetragen und zurückgenommen stehen je als WORT an der richtigen Meldung', async () => {
    liefere('/bezirke/5/staende', STAENDE);
    renderMitProviders(<MeldeVerlauf einsatzId={7} art="bezirk" objektId={5} darfZuruecknehmen />);
    await screen.findByText('480 evakuiert (gezählt)');
    const [aktuell, nachgetragen, zurueck] = eintraege();

    expect(aktuell).toHaveTextContent('aktueller Stand');
    expect(aktuell).not.toHaveTextContent('nachgetragen');
    expect(aktuell).not.toHaveTextContent('zurückgenommen');

    // Zeitpunkt 10:30 UTC = 1600 in Kolkata; erfasst 11:05 UTC = 1635.
    expect(nachgetragen).toHaveTextContent(/1600/);
    expect(nachgetragen).toHaveTextContent(/nachgetragen um \d*1635/);
    expect(nachgetragen).not.toHaveTextContent('aktueller Stand');

    // 20 s zwischen Zeitpunkt und Erfassung: KEINE Nachtragung.
    expect(zurueck).not.toHaveTextContent('nachgetragen');
    expect(zurueck).toHaveTextContent(/zurückgenommen \d*1642 von Stab S1/);
    expect(zurueck).not.toHaveTextContent('aktueller Stand');
    expect(zurueck).toHaveAttribute('data-toenung', 'berichtigung');
    expect(aktuell).not.toHaveAttribute('data-toenung');
  });

  it('die Stelle nennt ihre aktuelle Meldung „aktuelle Belegung“', async () => {
    liefere('/stellen/9/belegungen', BELEGUNGEN);
    renderMitProviders(<MeldeVerlauf einsatzId={7} art="stelle" objektId={9} darfZuruecknehmen />);
    await screen.findByText('0 untergebracht');
    expect(eintraege()[0]).toHaveTextContent('aktuelle Belegung');
  });
});

describe('MeldeVerlauf · Zurücknehmen', () => {
  it('Auslöser nur an nicht zurückgenommenen Meldungen, mit Anzahl und Uhrzeit im Namen', async () => {
    liefere('/bezirke/5/staende', STAENDE);
    renderMitProviders(<MeldeVerlauf einsatzId={7} art="bezirk" objektId={5} darfZuruecknehmen />);
    await screen.findByText('480 evakuiert (gezählt)');
    const knoepfe = screen.getAllByRole('button', { name: /zurücknehmen$/ });
    expect(knoepfe).toHaveLength(2);
    expect(knoepfe[1]).toHaveAccessibleName(/^Meldung 300 von \d*1600 zurücknehmen$/);
    expect(within(eintraege()[2]).queryByRole('button')).not.toBeInTheDocument();
  });

  it('ohne Schreibrecht gibt es keinen Auslöser und keine eigene Hinweiszeile', async () => {
    liefere('/bezirke/5/staende', STAENDE);
    const { container } = renderMitProviders(
      <MeldeVerlauf einsatzId={7} art="bezirk" objektId={5} darfZuruecknehmen={false} />,
    );
    await screen.findByText('480 evakuiert (gezählt)');
    expect(screen.queryByRole('button', { name: /zurücknehmen$/ })).not.toBeInTheDocument();
    expect(container.querySelector('[data-lfh="verlauf-sperre"]')).toBeNull();
  });

  it('geschlossene Stelle: keine Auslöser, genau eine Hinweiszeile', async () => {
    liefere('/stellen/9/belegungen', BELEGUNGEN);
    const { container } = renderMitProviders(
      <MeldeVerlauf
        einsatzId={7}
        art="stelle"
        objektId={9}
        darfZuruecknehmen={false}
        sperrHinweis="Die Stelle ist geschlossen. Zurücknehmen geht erst, wenn sie wieder in Betrieb ist."
      />,
    );
    await screen.findByText('89 untergebracht');
    expect(screen.queryByRole('button', { name: /zurücknehmen$/ })).not.toBeInTheDocument();
    expect(container.querySelectorAll('[data-lfh="verlauf-sperre"]')).toHaveLength(1);
    expect(screen.getByText(/Die Stelle ist geschlossen/)).toBeInTheDocument();
  });

  it('Abbrechen der Rückfrage sendet nichts', async () => {
    liefere('/bezirke/5/staende', STAENDE);
    const ids = faengeRuecknahme('/staende/:id/zuruecknehmen', () => HttpResponse.json({}));
    renderMitProviders(<MeldeVerlauf einsatzId={7} art="bezirk" objektId={5} darfZuruecknehmen />);
    await screen.findByText('480 evakuiert (gezählt)');
    await userEvent.click(screen.getByRole('button', { name: /^Meldung 300 von/ }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Der aktuelle Stand ändert sich dadurch nicht.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    expect(ids).toEqual([]);
  });

  it('Bestätigen sendet genau EINE Rücknahme an die gewählte Meldung, die Rückfrage nennt „aktuell“', async () => {
    liefere('/bezirke/5/staende', STAENDE);
    const ids = faengeRuecknahme('/staende/:id/zuruecknehmen', () =>
      HttpResponse.json({ meldung_id: 3, bezirk: {} }),
    );
    renderMitProviders(<MeldeVerlauf einsatzId={7} art="bezirk" objektId={5} darfZuruecknehmen />);
    await screen.findByText('480 evakuiert (gezählt)');
    await userEvent.click(screen.getByRole('button', { name: /^Meldung 480 von/ }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(
      'Das ist der aktuelle Stand. Er wird danach aus den übrigen Meldungen bestimmt.',
    );
    const ok = within(dialog).getByRole('button', { name: 'Zurücknehmen' });
    expect(ok).toHaveClass('ant-btn-dangerous');
    await userEvent.click(ok);
    await waitFor(() => expect(ids).toEqual(['3']));
  });

  it('eine Belegungsmeldung geht an die Rücknahme-Route der Belegungen', async () => {
    liefere('/stellen/9/belegungen', BELEGUNGEN);
    const ids = faengeRuecknahme('/belegungen/:id/zuruecknehmen', () =>
      HttpResponse.json({ meldung_id: 8, stelle: {} }),
    );
    renderMitProviders(<MeldeVerlauf einsatzId={7} art="stelle" objektId={9} darfZuruecknehmen />);
    await screen.findByText('89 untergebracht');
    await userEvent.click(screen.getByRole('button', { name: /^Meldung 89 von/ }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Die aktuelle Belegung ändert sich dadurch nicht.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zurücknehmen' }));
    await waitFor(() => expect(ids).toEqual(['8']));
  });

  it('ein Fehler bleibt IM offenen Dialog und erscheint nicht als Toast', async () => {
    liefere('/bezirke/5/staende', STAENDE);
    faengeRuecknahme('/staende/:id/zuruecknehmen', () =>
      HttpResponse.json({ error: 'Die Standmeldung ist bereits zurückgenommen' }, { status: 422 }),
    );
    renderMitProviders(<MeldeVerlauf einsatzId={7} art="bezirk" objektId={5} darfZuruecknehmen />);
    await screen.findByText('480 evakuiert (gezählt)');
    await userEvent.click(screen.getByRole('button', { name: /^Meldung 300 von/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zurücknehmen' }));
    expect(
      await within(dialog).findByText('Die Standmeldung ist bereits zurückgenommen'),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('Rücknahme fehlgeschlagen')).toBeInTheDocument();
    // Gezählt wird die Message-Queue selbst: stünde der Grund zusätzlich im Toast, fände die
    // Abfrage im Dialog ihn trotzdem (CLAUDE.md, LFH-535).
    const toasts = document.querySelector('.ant-message');
    expect(toasts?.textContent ?? '').not.toContain('bereits zurückgenommen');
    expect(dialog.closest('.ant-zoom-leave')).toBeNull();
  });

  it('ein alter Grund wandert nicht in eine neue Rückfrage', async () => {
    liefere('/bezirke/5/staende', STAENDE);
    faengeRuecknahme('/staende/:id/zuruecknehmen', () =>
      HttpResponse.json({ error: 'Alter Grund' }, { status: 422 }),
    );
    renderMitProviders(<MeldeVerlauf einsatzId={7} art="bezirk" objektId={5} darfZuruecknehmen />);
    await screen.findByText('480 evakuiert (gezählt)');
    await userEvent.click(screen.getByRole('button', { name: /^Meldung 300 von/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zurücknehmen' }));
    await within(dialog).findByText('Alter Grund');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    await userEvent.click(screen.getByRole('button', { name: /^Meldung 480 von/ }));
    // Die neue Rückfrage steht (sie nennt 480), der alte Grund ist weg.
    await waitFor(() =>
      expect(screen.getAllByRole('dialog').some((d) => d.textContent?.includes('480'))).toBe(true),
    );
    await waitFor(() => expect(screen.queryByText('Alter Grund')).not.toBeInTheDocument());
  });

  it('solange die Rücknahme läuft, lässt sich die Rückfrage nicht schließen', async () => {
    liefere('/bezirke/5/staende', STAENDE);
    let antworte: (r: Response) => void = () => {};
    server.use(
      http.post(
        `${B}/staende/:id/zuruecknehmen`,
        () => new Promise<Response>((fertig) => (antworte = fertig)),
      ),
    );
    renderMitProviders(<MeldeVerlauf einsatzId={7} art="bezirk" objektId={5} darfZuruecknehmen />);
    await screen.findByText('480 evakuiert (gezählt)');
    await userEvent.click(screen.getByRole('button', { name: /^Meldung 300 von/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zurücknehmen' }));
    // Abbrechen ist gesperrt, Escape wirkt nicht: sonst ginge ein Fehlschlag danach still verloren.
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Abbrechen' })).toBeDisabled(),
    );
    await userEvent.keyboard('{Escape}');
    antworte(HttpResponse.json({ error: 'Stelle ist geschlossen' }, { status: 422 }));
    expect(await within(dialog).findByText('Stelle ist geschlossen')).toBeInTheDocument();
    expect(dialog.closest('.ant-zoom-leave')).toBeNull();
  });

  it('nach der Rücknahme liegt der Fokus im Verlauf, nicht auf <body>', async () => {
    liefere('/bezirke/5/staende', STAENDE);
    faengeRuecknahme('/staende/:id/zuruecknehmen', () =>
      HttpResponse.json({ meldung_id: 4, bezirk: {} }),
    );
    const { container } = renderMitProviders(
      <MeldeVerlauf einsatzId={7} art="bezirk" objektId={5} darfZuruecknehmen />,
    );
    await screen.findByText('480 evakuiert (gezählt)');
    await userEvent.click(screen.getByRole('button', { name: /^Meldung 300 von/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zurücknehmen' }));
    const wurzel = container.querySelector('[data-lfh="melde-verlauf"]');
    await waitFor(() => expect(document.activeElement).toBe(wurzel));
  });
});
