import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { WetterAktuell, WetterAnzeige } from '../api/types';
import { AktuellPaneel } from './WetterPaneele';

const BERLIN = { zeitzone: 'Europe/Berlin' };
/** 2026-10-01 06:10:00 UTC = 08:10 Berlin. */
const JETZT = Date.UTC(2026, 9, 1, 6, 10, 0);
const MIN = 60_000;
const vor = (ms: number) => new Date(JETZT - ms).toISOString();

const messung = (over: Partial<WetterAktuell> = {}): WetterAktuell => ({
  gemessen_at: vor(10 * MIN),
  station: { name: 'Ottenstein', entfernung_m: 9034 },
  symbol: 'bewoelkt',
  temperatur_c: 14.8,
  taupunkt_c: -0.4,
  luftfeuchte_prozent: 80,
  luftdruck_hpa: 1020.8,
  sicht_m: 53235,
  bewoelkung_prozent: 100,
  wind_kmh: 11.1,
  windrichtung_grad: 140,
  boeen_kmh: 34,
  niederschlag_mm: 1.2,
  ergaenzt: [],
  ...over,
});

const wetter = (aktuell: WetterAnzeige['aktuell']): WetterAnzeige => ({
  warnungen: { zustand: 'ok', abgerufen_at: vor(MIN), daten: [] },
  vorhersage: { zustand: 'ausfall' },
  aktuell,
});

function zeige(aktuell: WetterAnzeige['aktuell']) {
  return render(
    <AktuellPaneel
      zustand="daten"
      wetter={wetter(aktuell)}
      jetzt={JETZT}
      konv={BERLIN}
      onNeuladen={vi.fn()}
    />,
  );
}

const ok = (daten: WetterAktuell) => ({ zustand: 'ok' as const, abgerufen_at: vor(0), daten });
const paneel = () => document.querySelector('[data-lfh="wetter-aktuell"]') as HTMLElement;
/** Wert einer Kennzahl über ihre Augenbraue. */
const kennzahl = (titel: string) =>
  screen.getByText(titel, { selector: '[data-lfh="kennzahlenband"] *' }).closest('.lfh-kennzahl');
/** `<dd>` eines Datenfelds über seine Augenbraue. */
const feld = (label: string) =>
  screen
    .getByText(label, { selector: 'dt' })
    .closest('[data-lfh="datenfeld"]')!
    .querySelector('dd')!;

describe('AktuellPaneel (LFH-864)', () => {
  it('zeigt die Messung mit Station, Messzeit und Quellenvermerk', () => {
    zeige(ok(messung()));
    expect(screen.getByText('Aktuelle Bedingungen')).toBeInTheDocument();
    expect(paneel()).toHaveTextContent('Station Ottenstein, 9,0 km · Messung 08:00');
    expect(paneel()).toHaveTextContent('Datenbasis: Deutscher Wetterdienst');
    expect(paneel()).toHaveTextContent('SYNOP');

    expect(kennzahl('Temperatur')).toHaveTextContent('14,8°C');
    expect(kennzahl('Wind')).toHaveTextContent('11km/h');
    expect(kennzahl('Wind')).toHaveTextContent('aus SO');
    expect(kennzahl('Böen')).toHaveTextContent('34km/h');
    expect(kennzahl('Böen')).toHaveTextContent('stärkste der letzten Stunde');
    expect(kennzahl('Niederschlag')).toHaveTextContent('1,2mm');
    expect(kennzahl('Niederschlag')).toHaveTextContent('letzte Stunde');

    expect(feld('Wetterlage')).toHaveTextContent('bewölkt');
    expect(feld('Sicht')).toHaveTextContent('53,2 km');
    expect(feld('Bewölkung')).toHaveTextContent('100 %');
    expect(feld('Luftfeuchte')).toHaveTextContent('80 %');
    expect(feld('Taupunkt')).toHaveTextContent('−0,4 °C');
    expect(feld('Luftdruck')).toHaveTextContent('1021 hPa');
  });

  it('vier Kennzahlen stehen 2 × 2 — drei plus eins ließe eine leere Zelle', () => {
    zeige(ok(messung()));
    const band = paneel().querySelector('[data-lfh="kennzahlenband"]') as HTMLElement;
    expect(band.style.gridTemplateColumns).toBe('repeat(2, minmax(0, 1fr))');
    expect(band.querySelectorAll('[data-lfh="kennzahl"]')).toHaveLength(4);
  });

  it('die Wetterlage zeigt Wort und Ikone; keine Ikone ist ein eigenes Vorleseziel', () => {
    zeige(ok(messung({ symbol: 'nebel_nacht' })));
    expect(feld('Wetterlage')).toHaveTextContent('Nebel');
    expect(feld('Wetterlage').querySelector('[data-ikone="nebel-nacht"]')).not.toBeNull();
    expect(within(paneel()).queryByRole('img')).toBeNull();
  });

  it('ein fehlender Wert ist ein Strich, nie 0 — auch ohne Einheit dahinter', () => {
    zeige(
      ok(
        messung({
          sicht_m: undefined,
          temperatur_c: undefined,
          symbol: undefined,
          boeen_kmh: null,
        }),
      ),
    );
    expect(feld('Sicht')).toHaveTextContent(/^—$/);
    expect(feld('Wetterlage')).toHaveTextContent(/^—$/);
    expect(feld('Wetterlage').querySelector('[data-ikone]')).toBeNull();
    expect(kennzahl('Temperatur')).not.toHaveTextContent('°C');
    expect(kennzahl('Temperatur')).toHaveTextContent('—');
    expect(kennzahl('Böen')).not.toHaveTextContent('km/h');
  });

  it('ein ergänzter Wert nennt seine Station, ein Wert der Hauptstation nicht', () => {
    zeige(
      ok(
        messung({
          ergaenzt: [
            { station: { name: 'Hameln', entfernung_m: 12094 }, groessen: ['wind', 'boeen'] },
            { station: { name: 'Alfeld', entfernung_m: 21432 }, groessen: ['sicht'] },
          ],
        }),
      ),
    );
    expect(kennzahl('Wind')).toHaveTextContent('Station Hameln, 12,1 km');
    expect(kennzahl('Böen')).toHaveTextContent('Station Hameln, 12,1 km');
    expect(feld('Sicht')).toHaveTextContent('Station Alfeld, 21,4 km');
    expect(kennzahl('Temperatur')).not.toHaveTextContent('Station');
    expect(feld('Luftdruck')).not.toHaveTextContent('Station');
  });

  it('eine alte Messung zeigt „veraltet" mit der Messzeit', () => {
    zeige(ok(messung({ gemessen_at: vor(2 * 60 * MIN) })));
    expect(paneel()).toHaveTextContent('Messung 06:10 · veraltet');
    expect(kennzahl('Temperatur')).toHaveTextContent('14,8');
  });

  it('Stand unbekannt (Ausfall oder zu alte Messung) zeigt keinen Wert', () => {
    const { unmount } = zeige({ zustand: 'ausfall' });
    expect(paneel()).toHaveTextContent('Stand unbekannt');
    expect(paneel().querySelector('[data-lfh="kennzahlenband"]')).toBeNull();
    unmount();
    zeige(ok(messung({ gemessen_at: vor(4 * 60 * MIN) })));
    expect(paneel()).toHaveTextContent('Stand unbekannt');
    expect(paneel()).not.toHaveTextContent('14,8');
  });

  it('ohne Einsatzort erklärt das Paneel, was fehlt — ohne eigenen Knopf', () => {
    zeige({ zustand: 'kein_ort' });
    expect(paneel()).toHaveTextContent('verorteten Einsatzort');
    expect(within(paneel()).queryByRole('button')).toBeNull();
    expect(paneel().querySelector('[data-lfh="kennzahlenband"]')).toBeNull();
  });
});
