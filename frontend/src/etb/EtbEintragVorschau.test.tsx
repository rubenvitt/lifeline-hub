import { screen } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { EtbEintragAnzeige } from '../api/types';
import { etbNummerAbfrage } from '../command-palette/datensatzAbfrage';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import EtbEintragVorschau from './EtbEintragVorschau';

function eintrag(over: Partial<EtbEintragAnzeige> = {}): EtbEintragAnzeige {
  return {
    id: 40,
    lfd_nr: 12,
    typ: 'anordnung',
    inhalt: 'Deich an Station 4 sichern',
    von: 'ELW 1',
    an: 'Florian Nord 1',
    meldeweg: 'funk',
    veranlassung: 'Pegelanstieg',
    erfasser_id: 1,
    erfasser_name: 'Vitt',
    erfasser_funktion: 'S2',
    ereigniszeit: '2026-05-23 10:00:00',
    received_at: '2026-05-23 10:00:02',
    erfasst_lokal_at: null,
    berichtigt_eintrag_id: null,
    lagebericht_id: null,
    auftrag_id: null,
    befehl_id: null,
    folgeauftraege: [],
    anhaenge: [],
    ...over,
  };
}

/** Der Nummernzweig fragt `before_lfd_nr = n + 1, limit = 1` — geprüft, nicht nur beantwortet. */
function etbHandler(antwort: EtbEintragAnzeige[], zaehler?: { n: number }) {
  server.use(
    http.get('/api/einsaetze/5/etb', ({ request }) => {
      if (zaehler) zaehler.n += 1;
      const url = new URL(request.url);
      expect(url.searchParams.get('before_lfd_nr')).toBe('13');
      expect(url.searchParams.get('limit')).toBe('1');
      return HttpResponse.json(antwort);
    }),
  );
}

describe('EtbEintragVorschau (LFH-664)', () => {
  it('zeigt Nummer, Zeit, Typ, von → an, Meldeweg, Veranlassung, Verfasser und Inhalt', async () => {
    etbHandler([eintrag()]);
    renderMitProviders(<EtbEintragVorschau einsatzId={5} id={40} lfdNr={12} />);

    expect(await screen.findByText('Deich an Station 4 sichern')).toBeInTheDocument();
    expect(screen.getByText('Nr. 12')).toBeInTheDocument();
    expect(screen.getByText('Anordnung')).toBeInTheDocument();
    expect(screen.getByText('ELW 1 → Florian Nord 1')).toBeInTheDocument();
    expect(screen.getByText('Funk')).toBeInTheDocument();
    expect(screen.getByText('Pegelanstieg')).toBeInTheDocument();
    // Der Verfasser trägt ein geschütztes Leerzeichen vor der Funktion (`verfasser.ts`).
    expect(
      screen.getByText((_, el) => el?.tagName === 'DD' && el.textContent === 'Vitt ·\u00A0S2'),
    ).toBeInTheDocument();
    expect(screen.getByText('Ereigniszeit')).toBeInTheDocument();
    // Pünktlich erfasst: kein Nachtragshinweis.
    expect(screen.queryByText(/nachgetragen/)).not.toBeInTheDocument();
  });

  it('nennt einen nachgetragenen Eintrag mit Wort, das Zeichen ist nur Beiwerk', async () => {
    etbHandler([eintrag({ received_at: '2026-05-23 10:30:00' })]);
    renderMitProviders(<EtbEintragVorschau einsatzId={5} id={40} lfdNr={12} />);

    const hinweis = await screen.findByText(/nachgetragen um/);
    const zeichen = hinweis.querySelector('[aria-hidden="true"]');
    expect(zeichen).toHaveTextContent('⧖');
  });

  it('lässt leere Angaben weg, statt Platzhalter zu zeigen', async () => {
    etbHandler([eintrag({ von: null, an: null, meldeweg: null, veranlassung: null })]);
    renderMitProviders(<EtbEintragVorschau einsatzId={5} id={40} lfdNr={12} />);

    await screen.findByText('Deich an Station 4 sichern');
    expect(screen.queryByText('Von → An')).not.toBeInTheDocument();
    expect(screen.queryByText('Meldeweg')).not.toBeInTheDocument();
    expect(screen.queryByText('Veranlassung')).not.toBeInTheDocument();
  });

  /**
   * `before_lfd_nr` filtert strikt `<`: fehlt Nr. 12, liefert der Cursor Nr. 11. Ohne den
   * Id-Vergleich zeigte die Vorschau still einen fremden Eintrag.
   */
  it('zeigt bei einer Nummernlücke nicht den nächstälteren Eintrag', async () => {
    etbHandler([eintrag({ id: 39, lfd_nr: 11, inhalt: 'Fremder Eintrag' })]);
    renderMitProviders(<EtbEintragVorschau einsatzId={5} id={40} lfdNr={12} />);

    expect(
      await screen.findByText('Der ETB-Eintrag ist nicht mehr vorhanden.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Fremder Eintrag')).not.toBeInTheDocument();
    expect(screen.queryByText('Nr. 11')).not.toBeInTheDocument();
  });

  it('führt die Verweise des Eintrags als Links, nicht als Knöpfe', async () => {
    etbHandler([eintrag({ lagebericht_id: 3, folgeauftraege: [{ id: 8, lfd_nr: 2 }] })]);
    renderMitProviders(<EtbEintragVorschau einsatzId={5} id={40} lfdNr={12} />);

    expect(await screen.findByRole('link', { name: 'Lagebericht' })).toHaveAttribute(
      'href',
      '/einsaetze/5/lageberichte/3',
    );
    expect(screen.getByRole('link', { name: 'Folgeauftrag Nr. 2' })).toHaveAttribute(
      'href',
      '/einsaetze/5/auftraege?auftrag=8',
    );
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('trägt keine Bedienelemente', async () => {
    etbHandler([eintrag()]);
    renderMitProviders(<EtbEintragVorschau einsatzId={5} id={40} lfdNr={12} />);

    await screen.findByText('Deich an Station 4 sichern');
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
  });

  it('liest aus dem warmen Nummernfach der Palette, ohne neu abzurufen', () => {
    const zaehler = { n: 0 };
    etbHandler([], zaehler);
    const client = new QueryClient();
    const abfrage = etbNummerAbfrage(5, 12);
    client.setQueryData(abfrage.queryKey, [eintrag()]);

    renderMitProviders(<EtbEintragVorschau einsatzId={5} id={40} lfdNr={12} />, { client });

    // Synchron: stünde der Inhalt erst nach einem Abruf da, fände `getBy` ihn hier nicht.
    expect(screen.getByText('Deich an Station 4 sichern')).toBeInTheDocument();
    expect(client.isFetching({ queryKey: abfrage.queryKey, exact: true })).toBe(0);
    expect(zaehler.n).toBe(0);
  });

  /**
   * Zwischen den beiden Frischen (Review-Befund): ein Fach, 30 s alt, ist für die Palette
   * (`FRISCH_MS` = 60 s) frisch, für die globale Vorgabe (10 s) nicht. Nur dieser Fall trennt
   * „teilt die Frische der Palette" von „nimmt die Vorgabe" — mit „jetzt" wären beide grün.
   */
  it('holt ein 30 s altes Fach nicht neu — es gilt die Frische der Palette', () => {
    const zaehler = { n: 0 };
    etbHandler([], zaehler);
    const client = new QueryClient();
    const abfrage = etbNummerAbfrage(5, 12);
    client.setQueryData(abfrage.queryKey, [eintrag()], { updatedAt: Date.now() - 30_000 });

    renderMitProviders(<EtbEintragVorschau einsatzId={5} id={40} lfdNr={12} />, { client });

    expect(screen.getByText('Deich an Station 4 sichern')).toBeInTheDocument();
    expect(client.isFetching({ queryKey: abfrage.queryKey, exact: true })).toBe(0);
    expect(zaehler.n).toBe(0);
  });

  /**
   * Eine Berichtigung sagt, WAS sie berichtigt (Review-Befund): sonst liest jemand in der
   * Vorschau einen Eintrag, ohne zu erfahren, dass er einen älteren ersetzt. Die Nummer des
   * Grundeintrags steht am Datensatz nicht — der Verweis führt deshalb über die `id`.
   */
  it('verweist bei einer Berichtigung auf den Grundeintrag', async () => {
    etbHandler([eintrag({ typ: 'berichtigung', berichtigt_eintrag_id: 33 })]);
    renderMitProviders(<EtbEintragVorschau einsatzId={5} id={40} lfdNr={12} />);

    const verweis = await screen.findByRole('link', { name: /Grundeintrag anzeigen/ });
    expect(verweis).toHaveAttribute('href', '/einsaetze/5/etb?eintrag=33');
    expect(screen.getByText(/berichtigt einen älteren Eintrag/)).toBeInTheDocument();
  });

  it('nennt ohne Berichtigung keinen Grundeintrag', async () => {
    etbHandler([eintrag()]);
    renderMitProviders(<EtbEintragVorschau einsatzId={5} id={40} lfdNr={12} />);
    await screen.findByText('Deich an Station 4 sichern');
    expect(screen.queryByText(/Grundeintrag/)).not.toBeInTheDocument();
  });
});
