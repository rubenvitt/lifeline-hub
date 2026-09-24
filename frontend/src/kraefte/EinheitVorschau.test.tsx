import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import type { Einheit, EinheitStatus } from '../api/types';
import EinheitVorschau from './EinheitVorschau';

const S2 = { label: '2 – Frei auf Wache', fms_anker: 2, kategorie: 'verfuegbar', sortier: 2 };
const S4 = { label: '4 – Am Einsatzort', fms_anker: 4, kategorie: 'gebunden', sortier: 4 };

const einheit = (o: Partial<Einheit> = {}): Einheit =>
  ({
    id: 3,
    einsatz_id: 5,
    name: '1. Zug',
    typ_label: 'Löschzug',
    funkrufname: 'Florian Musterstadt 1',
    fuehrer_name: 'Hans Zugführer',
    abschnitt_name: 'EA Nord',
    ist: { fuehrer: 1, unterfuehrer: 2, mannschaft: 12 },
    ist_kumuliert: { fuehrer: 1, unterfuehrer: 2, mannschaft: 12 },
    soll: { fuehrer: 1, unterfuehrer: 3, mannschaft: 18 },
    status: { quelle: 'fahrzeuge', status: S2, verteilung: [] },
    kommunikationsmittel: 'digitalfunk',
    erreichbarkeit: '0171 1234567',
    sprechgruppen: [],
    fahrzeug_mitglieder: [{ ef_id: 1 }, { ef_id: 2 }],
    personal_mitglieder: [{ ep_id: 1 }, { ep_id: 2 }, { ep_id: 3 }],
    material_mitglieder: [],
    bemerkung: 'Bereitstellung Nord',
    sortier: 0,
    ...o,
  }) as unknown as Einheit;

function liefere(liste: Einheit[]) {
  server.use(http.get('/api/einsaetze/5/einheiten', () => HttpResponse.json(liste)));
}

describe('EinheitVorschau (LFH-664)', () => {
  it('zeigt Name, Typ, Funkrufname, Status mit Wort, Stärke, Führer, Abschnitt, Funk, Mittel und Bemerkung', async () => {
    liefere([einheit({ id: 2, name: 'Nachbarzug' }), einheit()]);
    renderMitProviders(<EinheitVorschau einsatzId={5} id={3} />);

    expect(await screen.findByText('1. Zug')).toBeInTheDocument();
    expect(screen.getByText('Löschzug')).toBeInTheDocument();
    expect(screen.getByText('Florian Musterstadt 1')).toBeInTheDocument();
    // Status: FMS-Code und Wort — nicht allein über Farbe.
    expect(screen.getByText('S2 · Frei auf Wache')).toBeInTheDocument();
    expect(screen.getByText('1/2/12//15')).toBeInTheDocument();
    expect(screen.getByText('1/3/18//22')).toBeInTheDocument();
    expect(screen.getByText('Hans Zugführer')).toBeInTheDocument();
    expect(screen.getByText('EA Nord')).toBeInTheDocument();
    expect(screen.getByTestId('funk-erreichbarkeit')).toHaveTextContent('Digitalfunk');
    expect(screen.getByText('2 Fahrzeuge · 3 Personal · 0 Material')).toBeInTheDocument();
    expect(screen.getByText('Bereitstellung Nord')).toBeInTheDocument();
    expect(screen.queryByText('Nachbarzug')).not.toBeInTheDocument();
    // Gleich der eigenen Stärke: keine zweite, gleichlautende Zeile.
    expect(screen.queryByText('Ist inkl. Unterstellte')).not.toBeInTheDocument();
  });

  it('zeigt die Stärke inklusive Unterstellter nur, wenn sie abweicht', async () => {
    liefere([einheit({ ist_kumuliert: { fuehrer: 2, unterfuehrer: 4, mannschaft: 20 } })]);
    renderMitProviders(<EinheitVorschau einsatzId={5} id={3} />);
    expect(await screen.findByText('2/4/20//26')).toBeInTheDocument();
    expect(screen.getByText('Ist inkl. Unterstellte')).toBeInTheDocument();
  });

  /**
   * Design §6: ein HANDstatus trägt die Mandantenfarbe seines Katalogeintrags; `StatusTag`
   * erzwingt dann die Rand-Form. Ein aus Fahrzeugen abgeleiteter Status bleibt Fläche.
   */
  it('gibt die Mandantenfarbe eines Handstatus an den StatusTag (Rand-Form)', async () => {
    const hand = {
      quelle: 'hand',
      status: { ...S2, farbe: '#00aa00' },
      verteilung: [],
    } as unknown as EinheitStatus;
    liefere([einheit({ status: hand })]);
    renderMitProviders(<EinheitVorschau einsatzId={5} id={3} />);
    const tag = (await screen.findByText('S2 · Frei auf Wache')).closest('[data-darstellung]');
    expect(tag).toHaveAttribute('data-darstellung', 'rand');
    expect(tag?.querySelector('[data-lfh="mandantenfarbe"]')).not.toBeNull();
  });

  it('lässt einen aus Fahrzeugen abgeleiteten Status ohne Mandantenfarbe', async () => {
    const abgeleitet = {
      quelle: 'fahrzeuge',
      status: { ...S2, farbe: '#00aa00' },
      verteilung: [],
    } as unknown as EinheitStatus;
    liefere([einheit({ status: abgeleitet })]);
    renderMitProviders(<EinheitVorschau einsatzId={5} id={3} />);
    const tag = (await screen.findByText('S2 · Frei auf Wache')).closest('[data-darstellung]');
    expect(tag).toHaveAttribute('data-darstellung', 'flaeche');
  });

  it('erfindet keine Soll-Stärke und keinen leeren Funk-Eintrag', async () => {
    liefere([
      einheit({
        soll: null,
        kommunikationsmittel: null,
        erreichbarkeit: null,
        sprechgruppen: [],
      }),
    ]);
    renderMitProviders(<EinheitVorschau einsatzId={5} id={3} />);
    await screen.findByText('1. Zug');
    expect(screen.queryByText(/Soll/)).not.toBeInTheDocument();
    expect(screen.queryByText('Funk / Erreichbarkeit')).not.toBeInTheDocument();
  });

  it('nennt „gemischt" mit der Verteilung als Text, statt einen Status zu erfinden', async () => {
    const gemischt: EinheitStatus = {
      quelle: 'gemischt',
      kategorie: null,
      verteilung: [
        { anzahl: 2, status: S4 },
        { anzahl: 1, status: null },
      ],
    } as unknown as EinheitStatus;
    liefere([einheit({ status: gemischt })]);
    renderMitProviders(<EinheitVorschau einsatzId={5} id={3} />);

    expect(await screen.findByText('gemischt')).toBeInTheDocument();
    expect(screen.getByText('2× S4 · 1× ohne Status')).toBeInTheDocument();
  });

  it('sagt „ohne Status" für eine Einheit ohne Status', async () => {
    liefere([einheit({ status: { quelle: 'ohne', verteilung: [] } as EinheitStatus })]);
    renderMitProviders(<EinheitVorschau einsatzId={5} id={3} />);
    expect(await screen.findByText('ohne Status')).toBeInTheDocument();
  });

  it('sagt, dass die Einheit nicht mehr vorhanden ist', async () => {
    liefere([einheit({ id: 2 })]);
    renderMitProviders(<EinheitVorschau einsatzId={5} id={3} />);
    expect(await screen.findByText('Die Einheit ist nicht mehr vorhanden.')).toBeInTheDocument();
  });

  it('liest nur: kein Knopf, kein Auswahlfeld', async () => {
    liefere([einheit()]);
    renderMitProviders(<EinheitVorschau einsatzId={5} id={3} />);
    await screen.findByText('1. Zug');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });
});
