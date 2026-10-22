import { beforeEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import type { EinheitTyp, ExterneStelle } from '../api/types';
import NachforderungFormular from './NachforderungFormular';
import type { ZielAbschnitt, ZielRaum } from './zielVorschlaege';

// Hinter „Weitere Angaben“ (LLH-1089): zugeklappt, aber gerendert (`forceRender`).
const adressat = () => screen.getByRole('combobox', { name: 'Adressat-Bezeichnung', hidden: true });
const was = () => screen.getByRole('combobox', { name: 'Was' });
const wohin = () => screen.getByRole('combobox', { name: 'Wohin' });
const anzahl = () => screen.getByLabelText('Anzahl');
const details = () => screen.getByLabelText('Details / Zweck');
const absetzen = () =>
  userEvent.click(screen.getByRole('button', { name: 'Nachforderung absetzen' }));

/** Katalog „Externe Stellen“ ohne zuständige Leitstelle, wenn ein Test nichts anderes setzt. */
function katalog(stellen: ExterneStelle[] = []) {
  server.use(http.get('/api/externe-stellen', () => HttpResponse.json(stellen)));
}

/** Einheitstypen der Organisation (zweite Vorschlagsgruppe für „Was“). */
function typen(liste: EinheitTyp[] = []) {
  server.use(http.get('/api/einheit-typen', () => HttpResponse.json(liste)));
}

beforeEach(() => {
  katalog();
  typen();
});

/** Serienerfassung: Adressat, Dringlichkeit und Ziel bleiben, Art und Details wechseln. */
describe('NachforderungFormular — Serienerfassung', () => {
  it('bleibt nach dem Speichern offen, leert die Art und behält den Adressaten', async () => {
    const onAnlegen = vi.fn().mockResolvedValue({});
    renderMitProviders(<NachforderungFormular card={false} senden={false} onAnlegen={onAnlegen} />);

    await userEvent.click(screen.getByRole('checkbox', { name: /Werte behalten/ }));
    await userEvent.type(was(), 'RTW');
    await userEvent.type(details(), 'Zwei RTW zur Verstärkung');
    await userEvent.type(adressat(), 'Leitstelle Nord');
    await userEvent.click(screen.getByRole('button', { name: /Speichern und n/ }));

    await waitFor(() => expect(onAnlegen).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(was()).toHaveValue(''));
    expect(details()).toHaveValue('');
    expect(adressat()).toHaveValue('Leitstelle Nord');
  });

  it('lässt die Eingabe stehen, wenn der Server ablehnt', async () => {
    const onAnlegen = vi.fn().mockRejectedValue(new Error('422'));
    renderMitProviders(<NachforderungFormular card={false} senden={false} onAnlegen={onAnlegen} />);

    await userEvent.type(was(), 'RTW');
    await userEvent.type(details(), 'Zwei RTW');
    await userEvent.click(screen.getByRole('button', { name: 'Nachforderung absetzen' }));

    await waitFor(() => expect(onAnlegen).toHaveBeenCalled());
    expect(was()).toHaveValue('RTW');
  });
});

describe('NachforderungFormular — Eingabegrenzen (LFH-937)', () => {
  it('begrenzt Was, Wohin, Details und Adressat nativ', () => {
    renderMitProviders(<NachforderungFormular card={false} senden={false} onAnlegen={vi.fn()} />);
    expect(details()).toHaveAttribute('maxlength', '200');
    expect(adressat()).toHaveAttribute('maxlength', '500');
    expect(was()).toHaveAttribute('maxlength', '200');
    expect(wohin()).toHaveAttribute('maxlength', '200');
  });

  it('zählt die Begründung ab 80 %; über 500 Zeichen bleibt sie ganz stehen und sperrt', async () => {
    const onAnlegen = vi.fn().mockResolvedValue({});
    renderMitProviders(<NachforderungFormular card={false} senden={false} onAnlegen={onAnlegen} />);
    const begruendung = screen.getByLabelText('Begründung / Lagebezug');
    expect(begruendung).not.toHaveAttribute('maxlength');
    fireEvent.change(begruendung, { target: { value: 'g'.repeat(400) } });
    expect(screen.getByText('400 / 500')).toBeInTheDocument();
    await userEvent.type(was(), 'RTW');
    await userEvent.type(details(), 'Zwei RTW');
    fireEvent.change(begruendung, { target: { value: 'g'.repeat(501) } });
    expect(begruendung).toHaveValue('g'.repeat(501));
    await userEvent.click(screen.getByRole('button', { name: 'Nachforderung absetzen' }));
    expect(
      await screen.findByText('Begründung darf höchstens 500 Zeichen lang sein'),
    ).toBeInTheDocument();
    expect(onAnlegen).not.toHaveBeenCalled();
  });
});

/** LFH-1194, design.md D8: Vorschläge aus dem Katalog und die zuständige Leitstelle als Vorgabe. */
describe('NachforderungFormular — Adressat aus dem Katalog „Externe Stellen“', () => {
  const KATALOG: ExterneStelle[] = [
    { id: 1, bezeichnung: 'ILS Musterkreis', art: 'leitstelle', aktiv: true, zustaendig: true },
    {
      id: 2,
      bezeichnung: 'Leitstelle Nachbarkreis',
      art: 'leitstelle',
      aktiv: true,
      zustaendig: false,
    },
  ];

  /** Wählt in der Kategorie-Auswahl; „Leitstelle“ steht auch als Gruppenkopf der Vorschläge. */
  async function kategorieWaehlen(label: string) {
    await userEvent.click(screen.getByLabelText('Adressat'));
    await waitFor(() =>
      expect(
        document.querySelector(
          `.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option[title="${label}"]`,
        ),
      ).not.toBeNull(),
    );
    await userEvent.click(
      document.querySelector(
        `.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option[title="${label}"]`,
      ) as HTMLElement,
    );
  }

  it('belegt die Adressat-Bezeichnung mit der zuständigen Leitstelle vor, auch nach dem Absetzen', async () => {
    katalog(KATALOG);
    const onAnlegen = vi.fn().mockResolvedValue({});
    renderMitProviders(<NachforderungFormular card={false} senden={false} onAnlegen={onAnlegen} />);
    await waitFor(() => expect(adressat()).toHaveValue('ILS Musterkreis'));

    await userEvent.type(was(), 'RTW');
    await userEvent.type(details(), 'Zwei RTW');
    await userEvent.click(screen.getByRole('button', { name: 'Nachforderung absetzen' }));
    await waitFor(() =>
      expect(onAnlegen).toHaveBeenCalledWith(
        expect.objectContaining({
          adressat_kategorie: 'leitstelle',
          adressat_bezeichnung: 'ILS Musterkreis',
        }),
      ),
    );
    await waitFor(() => expect(was()).toHaveValue(''));
    expect(adressat()).toHaveValue('ILS Musterkreis');
  });

  it('überschreibt eine eigene Eingabe beim Kategoriewechsel nicht', async () => {
    katalog(KATALOG);
    renderMitProviders(<NachforderungFormular card={false} senden={false} onAnlegen={vi.fn()} />);
    await waitFor(() => expect(adressat()).toHaveValue('ILS Musterkreis'));
    await userEvent.clear(adressat());
    await userEvent.type(adressat(), 'Leitstelle Nachbarkreis');

    await kategorieWaehlen('Andere BOS');
    await kategorieWaehlen('Leitstelle');
    expect(adressat()).toHaveValue('Leitstelle Nachbarkreis');
  });

  it('belegt nicht vor, wenn die Kategorie beim Eintreffen der Liste nicht „Leitstelle“ ist', async () => {
    let liefern: () => void = () => {};
    const geliefert = new Promise<void>((r) => (liefern = r));
    server.use(
      http.get('/api/externe-stellen', async () => {
        await geliefert;
        return HttpResponse.json(KATALOG);
      }),
    );
    renderMitProviders(<NachforderungFormular card={false} senden={false} onAnlegen={vi.fn()} />);
    await kategorieWaehlen('Andere BOS');
    liefern();
    await userEvent.click(adressat());
    expect(await screen.findByTitle('ILS Musterkreis · zuständig')).toBeInTheDocument();
    expect(adressat()).toHaveValue('');
  });

  it('eine gelöschte Vorbelegung kommt beim Kategoriewechsel nicht zurück', async () => {
    katalog(KATALOG);
    renderMitProviders(<NachforderungFormular card={false} senden={false} onAnlegen={vi.fn()} />);
    await waitFor(() => expect(adressat()).toHaveValue('ILS Musterkreis'));
    await userEvent.clear(adressat());
    await kategorieWaehlen('Andere BOS');
    await kategorieWaehlen('Leitstelle');
    expect(adressat()).toHaveValue('');
  });

  it('ohne zuständige Leitstelle bleibt das Feld leer, die Vorschläge stehen trotzdem bereit', async () => {
    katalog(KATALOG.map((s) => ({ ...s, zustaendig: false })));
    renderMitProviders(<NachforderungFormular card={false} senden={false} onAnlegen={vi.fn()} />);
    await userEvent.click(adressat());
    expect(await screen.findByTitle('ILS Musterkreis')).toBeInTheDocument();
    expect(adressat()).toHaveValue('');
  });
});

/** LLH-1082 (design.md D7): Bedarf einer Betreuungsstelle — Bezug fest, Begründung vorbelegt. */
describe('NachforderungFormular — Stellenbezug (LLH-1082)', () => {
  const BEZUG = {
    betreuungsstelleId: 8,
    name: 'Turnhalle Ost',
    pfad: '/einsaetze/1/betreuung/8',
  };

  it('zeigt den Bezug, belegt die Begründung vor und sendet die Kennung der Stelle', async () => {
    const onAnlegen = vi.fn().mockResolvedValue({});
    renderMitProviders(
      <NachforderungFormular card={false} senden={false} onAnlegen={onAnlegen} bezug={BEZUG} />,
    );
    expect(screen.getByRole('link', { name: /Turnhalle Ost/ })).toHaveAttribute(
      'href',
      '/einsaetze/1/betreuung/8',
    );
    expect(screen.getByLabelText('Begründung / Lagebezug')).toHaveValue(
      'Für Betreuungsstelle Turnhalle Ost',
    );

    await userEvent.type(was(), 'Feldbetten');
    await userEvent.type(details(), 'Feldbetten für die Nacht');
    await userEvent.click(screen.getByRole('button', { name: 'Nachforderung absetzen' }));
    await waitFor(() =>
      expect(onAnlegen).toHaveBeenCalledWith(
        expect.objectContaining({
          art: 'Feldbetten',
          betreuungsstelle_id: 8,
          begruendung: 'Für Betreuungsstelle Turnhalle Ost',
        }),
      ),
    );
    // In der Serie für dieselbe Stelle steht die Begründung wieder da, Art ist leer.
    await waitFor(() => expect(was()).toHaveValue(''));
    expect(screen.getByLabelText('Begründung / Lagebezug')).toHaveValue(
      'Für Betreuungsstelle Turnhalle Ost',
    );
  });

  it('der Name kommt später: vorbelegt, solange die Begründung leer ist; eigene Eingabe bleibt', async () => {
    const { rerender } = renderMitProviders(
      <NachforderungFormular
        card={false}
        senden={false}
        onAnlegen={vi.fn()}
        bezug={{ betreuungsstelleId: 8 }}
      />,
    );
    expect(screen.getByText('Für eine Betreuungsstelle')).toBeInTheDocument();
    expect(screen.getByLabelText('Begründung / Lagebezug')).toHaveValue('');
    rerender(
      <NachforderungFormular card={false} senden={false} onAnlegen={vi.fn()} bezug={BEZUG} />,
    );
    await waitFor(() =>
      expect(screen.getByLabelText('Begründung / Lagebezug')).toHaveValue(
        'Für Betreuungsstelle Turnhalle Ost',
      ),
    );
  });

  it('ohne Bezug keine Zeile und keine Kennung', async () => {
    const onAnlegen = vi.fn().mockResolvedValue({});
    renderMitProviders(<NachforderungFormular card={false} senden={false} onAnlegen={onAnlegen} />);
    expect(screen.queryByText(/Betreuungsstelle/)).toBeNull();
    await userEvent.type(was(), 'RTW');
    await userEvent.type(details(), 'Zwei RTW');
    await userEvent.click(screen.getByRole('button', { name: 'Nachforderung absetzen' }));
    await waitFor(() => expect(onAnlegen).toHaveBeenCalled());
    expect(onAnlegen.mock.calls[0][0].betreuungsstelle_id).toBeUndefined();
  });
});

/** LLH-1089 (design.md D1–D6): schneller erfassen. */
describe('NachforderungFormular — Schnellwahl, Vorschläge, Ziel und Bedarfszeit (LLH-1089)', () => {
  const RAEUME: ZielRaum[] = [
    { id: 4, bezeichnung: 'BR Nord', status: 'aktiv' },
    { id: 5, bezeichnung: 'BR Alt', status: 'aufgeloest' },
  ];
  const ABSCHNITTE: ZielAbschnitt[] = [{ id: 7, name: 'EA Deich' }];

  it('Schnellwahl, Anzahl, Enter: „2× RTW“ an den einzigen aktiven Raum', async () => {
    const onAnlegen = vi.fn().mockResolvedValue({});
    renderMitProviders(
      <NachforderungFormular
        card={false}
        senden={false}
        onAnlegen={onAnlegen}
        raeume={RAEUME}
        abschnitte={ABSCHNITTE}
      />,
    );
    const gruppe = screen.getByRole('group', { name: 'Schnellwahl' });
    // Neuer Einsatz: die feste Liste in ihrer Folge.
    expect(Array.from(gruppe.querySelectorAll('button')).map((b) => b.textContent?.trim())).toEqual(
      ['RTW', 'KTW', 'NEF', 'LF 10', 'HLF 20', 'DLK 23-12'],
    );
    expect(wohin()).toHaveValue('BR Nord');
    expect(anzahl()).toHaveValue('1');

    await userEvent.click(screen.getByRole('button', { name: 'RTW' }));
    expect(was()).toHaveValue('RTW');
    expect(anzahl()).toHaveFocus();
    // Der Inhalt ist markiert: die Ziffer ersetzt die Vorgabe 1.
    await userEvent.keyboard('2{Enter}');

    await waitFor(() => expect(onAnlegen).toHaveBeenCalledTimes(1));
    const d = onAnlegen.mock.calls[0][0];
    expect(d).toMatchObject({ art: 'RTW', anzahl: 2, ziel_br_id: 4 });
    expect(d.bezeichnung).toBeUndefined();
    expect(d.benoetigt_bis).toBeUndefined();
    expect(d.ziel_text).toBeUndefined();
  });

  it('die Schnellwahl beginnt mit den häufigsten Arten des Einsatzes', () => {
    renderMitProviders(
      <NachforderungFormular
        card={false}
        senden={false}
        onAnlegen={vi.fn()}
        fruehereArten={['Sandsäcke', 'RTW']}
      />,
    );
    const gruppe = screen.getByRole('group', { name: 'Schnellwahl' });
    expect(Array.from(gruppe.querySelectorAll('button')).map((b) => b.textContent?.trim())).toEqual(
      ['Sandsäcke', 'RTW', 'KTW', 'NEF', 'LF 10', 'HLF 20'],
    );
  });

  it('die Schnellwahl füllt nach dem Einsatz mit den üblichen Arten der Organisation (LLH-1379)', () => {
    renderMitProviders(
      <NachforderungFormular
        card={false}
        senden={false}
        onAnlegen={vi.fn()}
        fruehereArten={['Feldbetten']}
        orgArten={['Sandsäcke', 'Feldbetten']}
      />,
    );
    const gruppe = screen.getByRole('group', { name: 'Schnellwahl' });
    expect(Array.from(gruppe.querySelectorAll('button')).map((b) => b.textContent?.trim())).toEqual(
      ['Feldbetten', 'Sandsäcke', 'RTW', 'KTW', 'NEF', 'LF 10'],
    );
  });

  it('„Was“ schlägt Arten des Einsatzes, Einheitstypen und die feste Liste vor', async () => {
    typen([{ id: 1, label: 'Wasserrettungszug', sortier: 1 }]);
    renderMitProviders(
      <NachforderungFormular
        card={false}
        senden={false}
        onAnlegen={vi.fn()}
        fruehereArten={['Feldbetten']}
      />,
    );
    await userEvent.click(was());
    expect(await screen.findByTitle('Wasserrettungszug')).toBeInTheDocument();
    expect(screen.getByTitle('Feldbetten')).toBeInTheDocument();
    expect(screen.getByTitle('RTW')).toBeInTheDocument();
    expect(screen.getByText('In diesem Einsatz')).toBeInTheDocument();
    expect(screen.getByText('Einheitstypen')).toBeInTheDocument();
  });

  it('ohne Details ist die Nachforderung gültig; Wohin wird Abschnitt oder Freitext', async () => {
    const onAnlegen = vi.fn().mockResolvedValue({});
    renderMitProviders(
      <NachforderungFormular
        card={false}
        senden={false}
        onAnlegen={onAnlegen}
        raeume={RAEUME}
        abschnitte={ABSCHNITTE}
      />,
    );
    await userEvent.type(was(), 'Sandsäcke');
    await userEvent.clear(wohin());
    await userEvent.type(wohin(), 'EA Deich');
    await absetzen();
    await waitFor(() => expect(onAnlegen).toHaveBeenCalledTimes(1));
    expect(onAnlegen.mock.calls[0][0]).toMatchObject({ art: 'Sandsäcke', ziel_abschnitt_id: 7 });

    // Nach dem Absetzen steht die Vorgabe wieder da; Freitext bleibt Freitext.
    await waitFor(() => expect(was()).toHaveValue(''));
    expect(wohin()).toHaveValue('BR Nord');
    await userEvent.type(was(), 'Tauchpumpe');
    await userEvent.clear(wohin());
    await userEvent.type(wohin(), 'Lotsenpunkt Feuerwache');
    await absetzen();
    await waitFor(() => expect(onAnlegen).toHaveBeenCalledTimes(2));
    expect(onAnlegen.mock.calls[1][0]).toMatchObject({ ziel_text: 'Lotsenpunkt Feuerwache' });
    expect(onAnlegen.mock.calls[1][0].ziel_br_id).toBeUndefined();
  });

  it('ohne aktiven Raum bleibt Wohin leer und geht ohne Ziel', async () => {
    const onAnlegen = vi.fn().mockResolvedValue({});
    renderMitProviders(
      <NachforderungFormular
        card={false}
        senden={false}
        onAnlegen={onAnlegen}
        raeume={[{ id: 4, bezeichnung: 'BR Nord', status: 'geplant' }]}
      />,
    );
    expect(wohin()).toHaveValue('');
    await userEvent.type(was(), 'RTW');
    await absetzen();
    await waitFor(() => expect(onAnlegen).toHaveBeenCalled());
    const d = onAnlegen.mock.calls[0][0];
    expect([d.ziel_br_id, d.ziel_abschnitt_id, d.ziel_text]).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('der Kopf von „Weitere Angaben“ nennt Abweichungen; ohne „Was“ klappt nichts auf', async () => {
    const onAnlegen = vi.fn().mockResolvedValue({});
    renderMitProviders(<NachforderungFormular card={false} senden={false} onAnlegen={onAnlegen} />);
    expect(screen.getByText('Weitere Angaben')).toBeInTheDocument();
    fireEvent.change(details(), { target: { value: 'Transport aus UHS' } });
    expect(await screen.findByText('Weitere Angaben · Details')).toBeInTheDocument();
    await absetzen();
    expect(await screen.findByText('Was ist erforderlich')).toBeInTheDocument();
    expect(onAnlegen).not.toHaveBeenCalled();
  });

  it('eine Teil-Vorbelegung lässt die Anzahl leer', async () => {
    renderMitProviders(
      <NachforderungFormular
        card={false}
        senden={false}
        onAnlegen={vi.fn()}
        vorbelegung={{ art: 'Material', begruendung: 'Fehlmenge UHS «Turnhalle»' }}
      />,
    );
    await waitFor(() => expect(was()).toHaveValue('Material'));
    expect(anzahl()).toHaveValue('');
  });
});
