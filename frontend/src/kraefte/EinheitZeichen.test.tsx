import { describe, expect, it } from 'vitest';
import { renderMitProviders } from '../test/utils';
import { ZEICHEN_UNTERLAGE_KLASSE } from '../zeichen/EinsatzZeichen';
import EinheitZeichen from './EinheitZeichen';

// Die Spalte „TZ“ im Meldebild (LFH-835): @einsatzzeichen, und ein gespeicherter Unsinnswert
// bringt die Zeile nicht zum Absturz (vorher warf die Altkomponente ohne try/catch). Belegt über
// die Beschreibung, die die Bibliothek aus der wirksamen Spec ins SVG schreibt (`<desc>`).
describe('EinheitZeichen', () => {
  const beschreibung = () =>
    document.querySelector('[data-lfh="einheit-zeichen"] svg desc')?.textContent ?? null;

  it('zeichnet Organisation und Stärke der Einheit', () => {
    renderMitProviders(
      <EinheitZeichen tz={{ typLabel: 'Zug', fachaufgabe: null, organisation: 'feuerwehr' }} />,
    );
    expect(beschreibung()).toBe(
      'Grundzeichen: Taktische Formation. Organisation: Feuerwehr. Stärke: Zug.',
    );
  });

  it('übersetzt eine alte Organisationskennung', () => {
    renderMitProviders(
      <EinheitZeichen tz={{ typLabel: 'Trupp', fachaufgabe: null, organisation: 'zivil' }} />,
    );
    expect(beschreibung()).toContain('Organisation: Zivile Einheiten');
  });

  it('übersteht unbekannte gespeicherte Werte und zeichnet den Rest', () => {
    renderMitProviders(
      <EinheitZeichen
        tz={{ typLabel: 'Zug', fachaufgabe: 'gibt-es-nicht', organisation: 'quatsch' }}
      />,
    );
    expect(beschreibung()).toBe('Grundzeichen: Taktische Formation. Stärke: Zug.');
  });

  it('bleibt ohne Zeichendaten ein leerer Rahmen', () => {
    renderMitProviders(<EinheitZeichen tz={null} />);
    expect(document.querySelector('[data-lfh="einheit-zeichen"] svg')).toBeNull();
  });

  // LFH-1120: die Organisations-Vorgabe der Karte fehlt hier bewusst, also zeichnet die Bibliothek
  // jede Einheit ohne eigene Organisation mit schwarzem Umriss ohne Fläche — im Nachtbetrieb ohne
  // Unterlage schwarz auf schwarz.
  it('legt das Zeichen auf die helle Unterlage', () => {
    renderMitProviders(
      <EinheitZeichen tz={{ typLabel: 'Zug', fachaufgabe: null, organisation: null }} />,
    );
    expect(document.querySelector('[data-lfh="einheit-zeichen"] svg')).toHaveClass(
      ZEICHEN_UNTERLAGE_KLASSE,
    );
  });
});
