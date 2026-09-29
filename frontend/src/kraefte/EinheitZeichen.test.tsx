import { describe, expect, it } from 'vitest';
import { renderMitProviders } from '../test/utils';
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
});
