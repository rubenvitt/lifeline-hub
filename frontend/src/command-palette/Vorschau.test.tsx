import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { Vorschau } from './Vorschau';
import type { VorschauZiel } from './typen';

/**
 * Die Zuordnung `art` → Bauteil (LFH-664). Die Bauteile haben je einen eigenen Test mit
 * echtem Inhalt; hier zählt allein, dass jede Sorte auf IHR Bauteil und mit IHREN Kennungen
 * trifft. Deshalb Attrappen: ein vertauschter Zweig (Personal → Fahrzeug) sähe sonst aus wie
 * ein grüner Ladefehler.
 */
vi.mock('../etb/EtbEintragVorschau', () => ({
  default: (p: object) => <div data-testid="bauteil">etb {JSON.stringify(p)}</div>,
}));
vi.mock('../meldungen/MeldungVorschau', () => ({
  default: (p: object) => <div data-testid="bauteil">meldung {JSON.stringify(p)}</div>,
}));
vi.mock('../auftraege/AuftragVorschau', () => ({
  default: (p: object) => <div data-testid="bauteil">auftrag {JSON.stringify(p)}</div>,
}));
vi.mock('../kraefte/FahrzeugVorschau', () => ({
  default: (p: object) => <div data-testid="bauteil">fahrzeug {JSON.stringify(p)}</div>,
}));
vi.mock('../kraefte/PersonalVorschau', () => ({
  default: (p: object) => <div data-testid="bauteil">personal {JSON.stringify(p)}</div>,
}));
vi.mock('../kraefte/EinheitVorschau', () => ({
  default: (p: object) => <div data-testid="bauteil">einheit {JSON.stringify(p)}</div>,
}));
vi.mock('../pages/schaeden/SchadenVorschau', () => ({
  default: (p: object) => <div data-testid="bauteil">schaden {JSON.stringify(p)}</div>,
}));
vi.mock('../pages/uhs/UhsVorschau', () => ({
  default: (p: object) => <div data-testid="bauteil">uhs {JSON.stringify(p)}</div>,
}));
vi.mock('../lageberichte/LageberichtVorschau', () => ({
  default: (p: object) => <div data-testid="bauteil">lagebericht {JSON.stringify(p)}</div>,
}));
vi.mock('../pages/gefahren/GefahrengebietVorschau', () => ({
  default: (p: object) => <div data-testid="bauteil">gefahrengebiet {JSON.stringify(p)}</div>,
}));
vi.mock('../pages/einsatzabschnitte/AbschnittVorschau', () => ({
  default: (p: object) => <div data-testid="bauteil">abschnitt {JSON.stringify(p)}</div>,
}));

describe('Vorschau (LFH-645/664)', () => {
  it('bildet art: person auf die Personenvorschau ab', async () => {
    server.use(
      http.get('/api/einsaetze/5/personen/11', () =>
        HttpResponse.json({
          id: 11,
          einsatz_id: 5,
          registrier_nr: 3,
          status: 'erfasst',
          name: 'Florian',
          vorname: null,
          storniert_at: null,
          aktuelle_sichtung: null,
          aktueller_verbleib: null,
          sichtungen: [],
          notizen: [],
          verbleib: [],
          abgleiche: [],
        }),
      ),
    );
    renderMitProviders(<Vorschau ziel={{ art: 'person', einsatzId: 5, id: 11 }} />);
    expect(await screen.findByText('Florian')).toBeInTheDocument();
  });

  const faelle: [VorschauZiel, string][] = [
    [{ art: 'etb', einsatzId: 5, id: 21, lfdNr: 9 }, 'etb {"einsatzId":5,"id":21,"lfdNr":9}'],
    [{ art: 'meldung', einsatzId: 5, id: 22 }, 'meldung {"einsatzId":5,"id":22}'],
    [{ art: 'auftrag', einsatzId: 5, id: 23 }, 'auftrag {"einsatzId":5,"id":23}'],
    [{ art: 'fahrzeug', einsatzId: 5, id: 24 }, 'fahrzeug {"einsatzId":5,"id":24}'],
    [{ art: 'personal', einsatzId: 5, id: 25 }, 'personal {"einsatzId":5,"id":25}'],
    [{ art: 'einheit', einsatzId: 5, id: 26 }, 'einheit {"einsatzId":5,"id":26}'],
    [{ art: 'schaden', einsatzId: 5, id: 27 }, 'schaden {"einsatzId":5,"id":27}'],
    [{ art: 'uhs', einsatzId: 5, id: 28 }, 'uhs {"einsatzId":5,"id":28}'],
    [{ art: 'lagebericht', einsatzId: 5, id: 29 }, 'lagebericht {"einsatzId":5,"id":29}'],
    [{ art: 'gefahrengebiet', einsatzId: 5, id: 30 }, 'gefahrengebiet {"einsatzId":5,"id":30}'],
    [{ art: 'abschnitt', einsatzId: 5, id: 31 }, 'abschnitt {"einsatzId":5,"id":31}'],
  ];

  it.each(faelle)('bildet %o auf sein Bauteil ab', (ziel, erwartet) => {
    renderMitProviders(<Vorschau ziel={ziel} />);
    expect(screen.getByTestId('bauteil')).toHaveTextContent(erwartet);
  });
});
