import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { ReactElement } from 'react';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { freigabenFixture } from '../test/fixtures';
import { waehle } from '../test/auswahlListe';
import type { Einheit, EinsatzMaterial, UhsDetail } from '../api/types';
import EinheitMaterial from '../pages/einheit/EinheitMaterial';
import { buildEinheitRechte } from '../pages/einheit/einheitAnsichtKern';
import MaterialTab from '../pages/uhs/MaterialTab';
import MaterialAmOrt from './MaterialAmOrt';
import MaterialOrtAngabe, { useMaterialOrtKontext } from './MaterialOrtAngabe';
import { ortVon, type MaterialOrtRef } from './materialPosten';
import { useMaterialOrt } from './useMaterialOrt';

/**
 * Ein Schreibweg (LLH-1225, design.md D2, Aufgabe 6.5): derselbe Ortswechsel ergibt an jeder
 * Stelle denselben PATCH-Körper an `…/material/{em_id}`, ob er in der Materialliste (Ort-Angabe)
 * oder am Ort selbst (Einheit, Fahrzeug, UHS, Bereitstellungsraum) ausgelöst wird. Die
 * Einheiten-Materialrouten bekommen nie einen Aufruf.
 *
 * Einheit und UHS laufen über ihre Hüllen (`EinheitMaterial`, `MaterialTab`), Fahrzeug und
 * Bereitstellungsraum über den Baustein mit den Angaben ihrer Seiten (die Seitentests
 * `FahrzeugePage.test.tsx` und `BrDetailPage.test.tsx` prüfen die Einbindung).
 */

const basis = {
  einsatz_id: 1,
  material_id: null,
  ist_adhoc: true,
  kategorie: null,
  art: 'geraet',
  menge: 1,
  ausgegeben: 0,
  status: 'einsatzbereit',
  einheit_id: null,
  einsatz_fahrzeug_id: null,
  uhs_id: null,
  br_id: null,
  beendet_at: null,
  disponiert_at: '2026-05-26 09:10:00',
};
/** Ohne Ort: wird zugeordnet. */
const FREI = { ...basis, id: 50, bezeichnung: 'Stromerzeuger' } as unknown as EinsatzMaterial;

interface Ort {
  name: string;
  ref: MaterialOrtRef;
  /** Etikett des Orts in der Ort-Angabe der Materialliste. */
  etikett: string;
  /** Wortlaut des Lösen-Knopfs am Ort. */
  loesen: string;
  /** Der Ort als Host, mit `hier` als seinem Posten. */
  host: (hier: EinsatzMaterial) => ReactElement;
}

function amOrt(ref: MaterialOrtRef): EinsatzMaterial {
  const feld = {
    einheit: 'einheit_id',
    fahrzeug: 'einsatz_fahrzeug_id',
    uhs: 'uhs_id',
    bereitstellungsraum: 'br_id',
  }[ref.art];
  return { ...basis, id: 40, bezeichnung: 'Trage', [feld]: ref.id } as unknown as EinsatzMaterial;
}

const angebot = (hier: EinsatzMaterial) => ({ data: [FREI, hier], isError: false });

const ORTE: Ort[] = [
  {
    name: 'Einheit',
    ref: { art: 'einheit', id: 10 },
    etikett: '1. Zug',
    loesen: 'Trage aus Einheit lösen',
    host: (hier) => {
      const rechte = buildEinheitRechte(true, freigabenFixture());
      return (
        <EinheitMaterial
          einsatzId={1}
          einheit={
            {
              id: 10,
              name: '1. Zug',
              material_mitglieder: [{ ...hier, em_id: hier.id }],
            } as unknown as Einheit
          }
          rechte={rechte}
          materialList={{ ...angebot(hier), error: null }}
        />
      );
    },
  },
  {
    name: 'Fahrzeug',
    ref: { art: 'fahrzeug', id: 20 },
    etikett: 'Florian 1',
    loesen: 'Trage vom Fahrzeug lösen',
    host: (hier) => (
      <MaterialAmOrt
        einsatzId={1}
        ort={{ art: 'fahrzeug', id: 20 }}
        posten={[hier]}
        angebot={angebot(hier)}
        darfSchreiben
        materialFrei
        titel="Beladung"
        loesenText="Vom Fahrzeug lösen"
        leerText="Keine Beladung"
      />
    ),
  },
  {
    name: 'UHS',
    ref: { art: 'uhs', id: 3 },
    etikett: 'UHS Turnhalle',
    loesen: 'Trage lösen',
    host: (hier) => (
      <MaterialTab
        einsatzId={1}
        uhs={{ id: 3, status: 'aktiv', material: [hier] } as unknown as UhsDetail}
        schreibgeschuetzt={false}
      />
    ),
  },
  {
    name: 'Bereitstellungsraum',
    ref: { art: 'bereitstellungsraum', id: 4 },
    etikett: 'BR Nord',
    loesen: 'Trage lösen',
    host: (hier) => (
      <MaterialAmOrt
        einsatzId={1}
        ort={{ art: 'bereitstellungsraum', id: 4 }}
        posten={[hier]}
        angebot={angebot(hier)}
        darfSchreiben
        materialFrei
        loesenText="Lösen"
        kopfzahl={false}
      />
    ),
  },
];

/** Die Ort-Zelle der Materialliste, so wie `MaterialPage` sie verdrahtet. */
function ListenZelle({ em }: { em: EinsatzMaterial }) {
  const { kontext } = useMaterialOrtKontext(1, true, [em]);
  const { setOrt } = useMaterialOrt(1);
  return (
    <MaterialOrtAngabe
      kennung={em.bezeichnung}
      ort={ortVon(em)}
      kontext={kontext}
      darfSchreiben
      onSpeichern={(ziel) => setOrt(em, ziel)}
    />
  );
}

function mitschnitt(hier: EinsatzMaterial) {
  const gesendet: { url: string; body: unknown }[] = [];
  const einheitenRouten: string[] = [];
  server.use(
    http.get('/api/einsaetze/1/material', () => HttpResponse.json([FREI, hier])),
    http.get('/api/einsaetze/1/einheiten', () =>
      HttpResponse.json([{ id: 10, name: '1. Zug', ueber_einheit_id: null, abschnitt_id: null }]),
    ),
    http.get('/api/einsaetze/1/abschnitte', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/fahrzeuge', () =>
      HttpResponse.json([{ id: 20, funkrufname: 'Florian 1', beendet_at: null }]),
    ),
    http.get('/api/einsaetze/1/uhs', () =>
      HttpResponse.json([{ id: 3, bezeichnung: 'Turnhalle', status: 'aktiv', storniert_at: null }]),
    ),
    http.get('/api/einsaetze/1/bereitstellungsraeume', () =>
      HttpResponse.json([{ id: 4, bezeichnung: 'BR Nord', status: 'geplant', storniert_at: null }]),
    ),
    http.patch('/api/einsaetze/1/material/:emId', async ({ request }) => {
      gesendet.push({ url: new URL(request.url).pathname, body: await request.json() });
      return HttpResponse.json({});
    }),
    http.all('/api/einsaetze/1/einheiten/:eid/material/:emId', ({ request }) => {
      einheitenRouten.push(`${request.method} ${new URL(request.url).pathname}`);
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return { gesendet, einheitenRouten };
}

/** Ortswechsel in der Materialliste: Angabe öffnen, Ziel wählen, speichern. */
async function inDerListe(em: EinsatzMaterial, etikett: string) {
  const { gesendet, einheitenRouten } = mitschnitt(em);
  renderMitProviders(<ListenZelle em={em} />);
  const name = `Ort zu ${em.bezeichnung}`;
  await userEvent.click(screen.getByRole('button', { name: `${name} bearbeiten` }));
  await waehle(name, etikett);
  await userEvent.click(screen.getByRole('button', { name: `${name} speichern` }));
  await waitFor(() => expect(gesendet).toHaveLength(1));
  cleanup();
  return { gesendet, einheitenRouten };
}

afterEach(() => cleanup());

describe('Ein Schreibweg für den Ort (LLH-1225 D2, 6.5)', () => {
  describe.each(ORTE)('$name', (ort) => {
    it('Zuordnen am Ort sendet denselben Körper wie die Materialliste', async () => {
      const hier = amOrt(ort.ref);
      const liste = await inDerListe(FREI, ort.etikett);

      const amOrtSelbst = mitschnitt(hier);
      renderMitProviders(ort.host(hier));
      await userEvent.click(await screen.findByRole('combobox', { name: 'Material zuordnen' }));
      await userEvent.click(await screen.findByText('Stromerzeuger · 1'));
      await waitFor(() => expect(amOrtSelbst.gesendet).toHaveLength(1));

      expect(amOrtSelbst.gesendet).toEqual(liste.gesendet);
      expect(liste.gesendet[0].url).toBe('/api/einsaetze/1/material/50');
      expect([...liste.einheitenRouten, ...amOrtSelbst.einheitenRouten]).toEqual([]);
    });

    it('Lösen am Ort sendet denselben Körper wie „ohne Ort“ in der Materialliste', async () => {
      const hier = amOrt(ort.ref);
      const liste = await inDerListe(hier, 'ohne Ort');

      const amOrtSelbst = mitschnitt(hier);
      renderMitProviders(ort.host(hier));
      // Der UHS-Reiter bedient erst, wenn `/me` feststeht: auf den Knopf warten.
      const knopf = await screen.findByRole('button', { name: ort.loesen });
      expect(knopf.closest('[data-lfh="material-am-ort-zeile"]')).toHaveTextContent('Trage');
      await userEvent.click(knopf);
      await waitFor(() => expect(amOrtSelbst.gesendet).toHaveLength(1));

      expect(amOrtSelbst.gesendet).toEqual(liste.gesendet);
      expect(liste.gesendet[0].url).toBe('/api/einsaetze/1/material/40');
      expect([...liste.einheitenRouten, ...amOrtSelbst.einheitenRouten]).toEqual([]);
    });
  });
});
