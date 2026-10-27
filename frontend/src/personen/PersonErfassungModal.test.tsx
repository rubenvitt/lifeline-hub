import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { tippeZeit } from '../test/zeitEingabe';
import PersonErfassungModal, { type ErfassungsModus } from './PersonErfassungModal';

/**
 * Unit-Netz für die Erfassungsmaske der Betroffenen: was die Hülle zusichert (Fokus, Enter,
 * Serienlauf) plus das Feldbudget. Keine Pixel — `renderMitProviders` hat kein Theme.
 */

/** Modal mit Standard-Zusagen; einzelne Rückrufe überschreibbar. */
function zeige(opts: { modus?: ErfassungsModus; onErfassen?: Mock; einsatzId?: number } = {}) {
  const onErfassen: Mock = opts.onErfassen ?? vi.fn().mockResolvedValue(undefined);
  const onFertig: Mock = vi.fn();
  const onCancel: Mock = vi.fn();
  const ansicht = renderMitProviders(
    <PersonErfassungModal
      einsatzId={opts.einsatzId ?? 1}
      modus={opts.modus ?? 'erfassen'}
      isPending={false}
      onErfassen={onErfassen}
      onFertig={onFertig}
      onCancel={onCancel}
    />,
  );
  return { ...ansicht, onErfassen, onFertig, onCancel };
}

// MapLibre läuft in jsdom nicht; der Ausschnitt hat eigene Tests (`anzeige/Kartenausschnitt.test.tsx`).
vi.mock('../anzeige/Kartenausschnitt', () => ({
  Kartenausschnitt: ({
    punkt,
    etikett,
  }: {
    punkt: { lat: number; lon: number } | null;
    etikett: string;
  }) => (
    <div role="group" aria-label={`Karte: ${etikett}`}>
      {punkt && `${punkt.lat},${punkt.lon}`}
    </div>
  ),
}));

/** Suchanfragen an den Geocoder-Einstieg des Einsatzes, je Test neu. */
let suchen: string[] = [];

beforeEach(() => {
  sessionStorage.clear();
  suchen = [];
  server.use(
    http.get('/api/einsaetze/:eid', ({ params }) =>
      HttpResponse.json({ id: Number(params.eid), einsatzort_lat: 52.1, einsatzort_lon: 8.6 }),
    ),
    http.get('/api/einsaetze/:eid/ort-vorschau', () =>
      HttpResponse.json({ ortsname: null, peilung: null }),
    ),
    http.get('/api/einsaetze/:eid/ort-suche', ({ request }) => {
      suchen.push(new URL(request.url).searchParams.get('q') ?? '');
      return HttpResponse.json({
        zustand: 'ok',
        treffer: [
          { lat: 52.2691, lon: 9.1342, name: 'Deichweg 3, Musterstadt', kurz: 'Deichweg 3' },
        ],
      });
    }),
  );
});

/**
 * Anzahl der Formularfelder IM BAUM — über `.ant-form-item`, nicht über gerechnete
 * Sichtbarkeit (ohne Theme prüfte das nur, ob jsdom das Stylesheet anwendet). Nur wahr, wenn die
 * Zusatzfelder wirklich erst beim Aufklappen entstehen.
 */
function feldZahl(): number {
  return screen.getByRole('dialog').querySelectorAll('.ant-form-item').length;
}

describe('PersonErfassungModal — Tastaturweg', () => {
  it('setzt den Fokus beim Öffnen auf das erste Feld', async () => {
    zeige();
    /**
     * Das erste Feld ist die Sichtung, der Fokus landet auf ihrer ERSTEN Fläche: sie trägt das
     * ausdrückliche Fokusziel der Hülle (`data-erfassung-fokus`, `SichtungsWahl`).
     */
    const flaechen = within(screen.getByRole('radiogroup')).getAllByRole('radio');
    await waitFor(() => expect(document.activeElement).toBe(flaechen[0]));
  });

  it('Enter im letzten sichtbaren Zahlfeld sendet ab', async () => {
    const { onErfassen } = zeige();
    const nutzer = userEvent.setup();

    await nutzer.type(screen.getByLabelText('Fundort'), 'Sammelstelle Süd');
    await nutzer.type(screen.getByLabelText('Geschätztes Alter (Jahre)'), '40{Enter}');

    await waitFor(() => expect(onErfassen).toHaveBeenCalledTimes(1));
    expect(onErfassen.mock.calls[0][0]).toMatchObject({
      antreff_ort: 'Sammelstelle Süd',
      alter_geschaetzt: 40,
    });
  });

  /**
   * Der Fundort ist ein Ortsfeld (LLH-1407): Enter sucht dort und sendet nicht ab. Mutationsprobe:
   * das Ortsfeld durch ein Textfeld ersetzt → Enter sendet ab, `onErfassen` ist gerufen.
   */
  it('Enter im Fundort sucht und sendet nicht ab', async () => {
    const { onErfassen } = zeige();
    const nutzer = userEvent.setup();

    await nutzer.type(screen.getByLabelText('Fundort'), 'Deichweg{Enter}');

    expect(await screen.findByRole('button', { name: /Deichweg 3/ })).toBeInTheDocument();
    expect(suchen).toEqual(['Deichweg']);
    expect(onErfassen).not.toHaveBeenCalled();
  });

  it('Strg + Enter im Fundort speichert und hält offen, ohne zu suchen', async () => {
    const { onErfassen, onFertig } = zeige();
    const nutzer = userEvent.setup();

    await nutzer.type(screen.getByLabelText('Fundort'), 'Deich');
    await nutzer.keyboard('{Control>}{Enter}{/Control}');

    await waitFor(() => expect(onErfassen).toHaveBeenCalledTimes(1));
    expect(onFertig).not.toHaveBeenCalled();
    expect(suchen).toEqual([]);
  });

  it('schickt die gewählte Sichtungskategorie mit', async () => {
    const { onErfassen } = zeige();
    const nutzer = userEvent.setup();

    const skZwei = within(screen.getByRole('radiogroup')).getAllByRole('radio')[1];
    await nutzer.click(skZwei);
    await nutzer.click(screen.getByRole('button', { name: 'Erfassen' }));

    await waitFor(() => expect(onErfassen).toHaveBeenCalledTimes(1));
    // Zweite Fläche = SK II (die Reihenfolge ist die Dringlichkeit, siehe AufnahmeFelder).
    expect(onErfassen.mock.calls[0][0]).toMatchObject({ sichtung: 'sk2' });
  });
});

describe('PersonErfassungModal — Serienmodus', () => {
  it('„Speichern und nächste" hält offen, leert die Felder und fokussiert zurück auf Feld 1', async () => {
    const { onErfassen, onFertig } = zeige();
    const nutzer = userEvent.setup();

    await nutzer.type(screen.getByLabelText('Fundort'), 'Sammelstelle Süd');
    await nutzer.click(screen.getByRole('button', { name: 'Speichern und nächste' }));

    await waitFor(() => expect(onErfassen).toHaveBeenCalledTimes(1));
    // Offen heißt: der Aufrufer wurde NICHT zum Schließen aufgefordert und der Dialog steht.
    expect(onFertig).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Fundort')).toHaveValue(''));
    const flaechen = within(screen.getByRole('radiogroup')).getAllByRole('radio');
    await waitFor(() => expect(document.activeElement).toBe(flaechen[0]));
  });

  it('der Fundort überlebt das Serien-Speichern (Kontext-Default)', async () => {
    // `uebernahme={['antreff_ort']}`: an einer Sammelstelle kommen viele Personen vom selben Ort.
    // „Werte behalten" steht per Vorgabe aus und wird hier eingeschaltet.
    zeige();
    const nutzer = userEvent.setup();

    await nutzer.click(screen.getByRole('checkbox', { name: 'Werte behalten' }));
    await nutzer.type(screen.getByLabelText('Fundort'), 'Sammelstelle Süd');
    await nutzer.type(screen.getByLabelText('Geschätztes Alter (Jahre)'), '40');
    await nutzer.click(screen.getByRole('button', { name: 'Speichern und nächste' }));

    // Das Nebeneinander ist der Beleg: das Einzelfeld ist leer, der Wiederholwert steht.
    await waitFor(() => expect(screen.getByLabelText('Geschätztes Alter (Jahre)')).toHaveValue(''));
    expect(screen.getByLabelText('Fundort')).toHaveValue('Sammelstelle Süd');
    expect(sessionStorage.getItem('lfh:erfassung:1:person:antreff_ort')).toBe('Sammelstelle Süd');
  });

  it('der Primär-Knopf meldet stattdessen fertig', async () => {
    const { onFertig } = zeige();
    const nutzer = userEvent.setup();

    await nutzer.type(screen.getByLabelText('Fundort'), 'Sammelstelle Süd');
    await nutzer.click(screen.getByRole('button', { name: 'Erfassen' }));

    await waitFor(() => expect(onFertig).toHaveBeenCalledTimes(1));
  });
});

describe('PersonErfassungModal — Feldbudget', () => {
  it('zeigt eingeklappt höchstens vier Felder — und nach dem Aufklappen mehr', async () => {
    zeige();
    const nutzer = userEvent.setup();

    expect(feldZahl()).toBeLessThanOrEqual(4);
    // Die Sichtung steht im sichtbaren Budget, der Name unter „Weitere Angaben".
    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
    expect(screen.getByLabelText('Geschlecht')).toBeInTheDocument();
    expect(screen.getByLabelText('Geschätztes Alter (Jahre)')).toBeInTheDocument();
    expect(screen.getByLabelText('Fundort')).toBeInTheDocument();
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Vorname')).not.toBeInTheDocument();

    // Ohne die zweite Hälfte wäre „höchstens vier" auch wahr, wenn es die Zusatzfelder nicht gäbe.
    await nutzer.click(screen.getByRole('button', { name: /Weitere Angaben/ }));

    await waitFor(() => expect(screen.getByLabelText('Vorname')).toBeInTheDocument());
    expect(feldZahl()).toBeGreaterThan(4);
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Notiz')).toBeInTheDocument();
  });

  it('Melder / Kontakt gibt es nur im Vermisst-Modus', async () => {
    const { unmount } = renderMitProviders(
      <PersonErfassungModal
        einsatzId={1}
        modus="vermisst"
        isPending={false}
        onErfassen={vi.fn().mockResolvedValue(undefined)}
        onFertig={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const nutzer = userEvent.setup();
    await nutzer.click(screen.getByRole('button', { name: /Weitere Angaben/ }));
    await waitFor(() => expect(screen.getByLabelText('Melder / Kontakt')).toBeInTheDocument());
    unmount();

    zeige({ modus: 'erfassen' });
    await nutzer.click(screen.getByRole('button', { name: /Weitere Angaben/ }));
    await waitFor(() => expect(screen.getByLabelText('Vorname')).toBeInTheDocument());
    expect(screen.queryByLabelText('Melder / Kontakt')).not.toBeInTheDocument();
  });

  it('ein eingeklappt zurückgelassener Wert geht beim Absenden trotzdem mit', async () => {
    // Der Beleg gegen `forceRender`: ein Zusatzfeld trägt nur einen Wert, wenn es aufgeklappt,
    // getippt und wieder zugeklappt wurde — genau das wird hier gefahren.
    const { onErfassen } = zeige();
    const nutzer = userEvent.setup();

    const kopf = screen.getByRole('button', { name: /Weitere Angaben/ });
    await nutzer.click(kopf);
    await waitFor(() => expect(screen.getByLabelText('Vorname')).toBeInTheDocument());
    // Beide Felder liegen eingeklappt.
    await nutzer.type(screen.getByLabelText('Name'), 'Mustermann');
    await nutzer.type(screen.getByLabelText('Vorname'), 'Max');
    await nutzer.click(kopf);
    // Ohne diese Zeile bewiese der Fall nichts: wäre der zweite Klick wirkungslos, stünde der
    // Bereich offen und „der Wert geht mit" wäre trivial.
    await waitFor(() => expect(kopf).toHaveAttribute('aria-expanded', 'false'));

    await nutzer.type(screen.getByLabelText('Fundort'), 'Sammelstelle Süd');
    await nutzer.click(screen.getByRole('button', { name: 'Erfassen' }));

    await waitFor(() => expect(onErfassen).toHaveBeenCalledTimes(1));
    expect(onErfassen.mock.calls[0][0]).toMatchObject({ name: 'Mustermann', vorname: 'Max' });
  });
});

describe('PersonErfassungModal — Zustand, Koordinate, vermisst seit (LFH-613)', () => {
  /**
   * Text und Koordinate im POST (LLH-1407): ein Treffer der Ortssuche setzt beide. Ein eigenes
   * Koordinatenfeld gibt es neben dem Ortsfeld nicht mehr.
   */
  it('schickt Zustand, Fundort und die Koordinate des Treffers mit', async () => {
    const { onErfassen } = zeige();
    const nutzer = userEvent.setup();
    await nutzer.click(screen.getByRole('button', { name: /Weitere Angaben/ }));
    await nutzer.type(await screen.findByLabelText('Zustand / Verdacht'), 'gehfähig, unterkühlt');
    expect(screen.queryByLabelText('Koordinate')).not.toBeInTheDocument();
    await nutzer.type(screen.getByLabelText('Fundort'), 'Deichweg{Enter}');
    await nutzer.click(await screen.findByRole('button', { name: /Deichweg 3/ }));
    expect(screen.getByRole('group', { name: 'Karte: Fundort' })).toHaveTextContent(
      '52.2691,9.1342',
    );
    await nutzer.click(screen.getByRole('button', { name: 'Erfassen' }));

    await waitFor(() => expect(onErfassen).toHaveBeenCalledTimes(1));
    const daten = onErfassen.mock.calls[0][0];
    expect(daten).toEqual({
      zustand: 'gehfähig, unterkühlt',
      antreff_ort: 'Deichweg 3',
      antreff_lat: 52.2691,
      antreff_lon: 9.1342,
    });
  });

  it('erkennt eine getippte Koordinate im Fundort, ohne zu suchen', async () => {
    const { onErfassen } = zeige();
    const nutzer = userEvent.setup();
    await nutzer.type(screen.getByLabelText('Fundort'), '52,2691/9,1342');
    await nutzer.click(screen.getByRole('button', { name: 'Erfassen' }));

    await waitFor(() => expect(onErfassen).toHaveBeenCalledTimes(1));
    expect(onErfassen.mock.calls[0][0]).toMatchObject({
      antreff_ort: '52,2691/9,1342',
      antreff_lat: 52.2691,
      antreff_lon: 9.1342,
    });
    expect(suchen).toEqual([]);
  });

  it('Vermisst-Modus: „vermisst seit" geht als UTC-Wire-String mit', async () => {
    const onErfassen = vi.fn().mockResolvedValue(undefined);
    zeige({ modus: 'vermisst', onErfassen });
    const nutzer = userEvent.setup();
    await nutzer.click(screen.getByRole('button', { name: /Weitere Angaben/ }));
    const feld = await screen.findByRole('textbox', { name: 'vermisst seit' });
    // Enter übernimmt den getippten Zeitpunkt UND sendet ab — das Feld liegt im `<form>`.
    await tippeZeit(nutzer, feld, '22.09.2026 08:00');

    await waitFor(() => expect(onErfassen).toHaveBeenCalledTimes(1));
    // Ortszeit 08:00 → UTC; gegen den absoluten Zeitpunkt geprüft, nicht gegen sich selbst.
    const erwartet = new Date(2026, 8, 22, 8, 0, 0).toISOString().slice(0, 19).replace('T', ' ');
    expect(onErfassen.mock.calls[0][0]).toMatchObject({ vermisst_seit: erwartet });
  });
});

describe('PersonErfassungModal — Ablehnung', () => {
  it('lässt den Wortlaut stehen, wenn das Speichern fehlschlägt', async () => {
    const onErfassen = vi.fn().mockRejectedValue(new Error('abgelehnt'));
    const { onFertig } = zeige({ onErfassen });
    const nutzer = userEvent.setup();

    await nutzer.type(screen.getByLabelText('Fundort'), 'Sammelstelle Süd');
    await nutzer.click(screen.getByRole('button', { name: 'Erfassen' }));

    await waitFor(() => expect(onErfassen).toHaveBeenCalledTimes(1));
    expect(onFertig).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Fundort')).toHaveValue('Sammelstelle Süd');
  });
});

describe('PersonErfassungModal — sitzungsweiter Fundort', () => {
  it('merkt den Ort erst nach Erfolg und setzt ihn beim Wiederöffnen ein', async () => {
    const ersteAnsicht = zeige();
    const nutzer = userEvent.setup();

    await nutzer.type(screen.getByLabelText('Fundort'), 'Sammelstelle Süd');
    await nutzer.click(screen.getByRole('button', { name: 'Erfassen' }));
    await waitFor(() => expect(ersteAnsicht.onErfassen).toHaveBeenCalledTimes(1));
    ersteAnsicht.unmount();

    zeige();
    await waitFor(() => expect(screen.getByLabelText('Fundort')).toHaveValue('Sammelstelle Süd'));
    expect(screen.getByRole('checkbox', { name: 'Werte behalten' })).not.toBeChecked();
  });

  it('merkt einen Ort nach abgelehntem Speichern nicht', async () => {
    const ersteAnsicht = zeige({
      onErfassen: vi.fn().mockRejectedValue(new Error('abgelehnt')),
    });
    const nutzer = userEvent.setup();

    await nutzer.type(screen.getByLabelText('Fundort'), 'Fehlerort');
    await nutzer.click(screen.getByRole('button', { name: 'Erfassen' }));
    await waitFor(() => expect(ersteAnsicht.onErfassen).toHaveBeenCalledTimes(1));
    ersteAnsicht.unmount();

    zeige();
    expect(screen.getByLabelText('Fundort')).toHaveValue('');
  });

  it('merkt einen Ort nach Abbruch während des Speicherns nicht', async () => {
    let antwortFreigeben!: () => void;
    const antwort = new Promise<void>((resolve) => {
      antwortFreigeben = resolve;
    });
    const ansicht = zeige({ onErfassen: vi.fn(() => antwort) });

    await userEvent.type(screen.getByLabelText('Fundort'), 'Abbruchort Person');
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));
    await waitFor(() => expect(ansicht.onErfassen).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByRole('button', { name: /Close|Schliessen|Schließen/i }));
    await act(async () => {
      antwortFreigeben();
      await antwort;
    });

    expect(ansicht.onCancel).toHaveBeenCalledTimes(1);
    expect(ansicht.onFertig).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('lfh:erfassung:1:person:antreff_ort')).toBeNull();
  });

  it('füllt den Sitzungsort nach ausgeschaltetem Serien-Reset nicht heimlich erneut ein', async () => {
    sessionStorage.setItem('lfh:erfassung:1:person:antreff_ort', 'Sammelstelle Süd');
    const { onErfassen } = zeige();
    const nutzer = userEvent.setup();

    await waitFor(() => expect(screen.getByLabelText('Fundort')).toHaveValue('Sammelstelle Süd'));
    expect(screen.getByRole('checkbox', { name: 'Werte behalten' })).not.toBeChecked();
    await nutzer.type(screen.getByLabelText('Fundort'), 'Sammelstelle Süd');
    await nutzer.click(screen.getByRole('button', { name: 'Speichern und nächste' }));

    await waitFor(() => expect(onErfassen).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText('Fundort')).toHaveValue('');
    expect(screen.getByRole('checkbox', { name: 'Werte behalten' })).not.toBeChecked();
  });
});
