import { describe, expect, it } from 'vitest';
import { renderMitProviders } from '../test/utils';
import EinheitZeichen from './EinheitZeichen';

// Die Spalte „TZ“ im Meldebild (LFH-835): @einsatzzeichen, und ein gespeicherter Unsinnswert
// bringt die Zeile nicht zum Absturz (vorher warf die Altkomponente ohne try/catch).
describe('EinheitZeichen', () => {
  const zeichen = () => document.querySelector('[data-lfh="einheit-zeichen"]')!;

  it('zeigt das Zeichen der Einheit', () => {
    renderMitProviders(
      <EinheitZeichen tz={{ typLabel: 'Gruppe', fachaufgabe: null, organisation: 'feuerwehr' }} />,
    );
    expect(zeichen().querySelectorAll('svg')).toHaveLength(1);
  });

  it('übersteht eine unbekannte gespeicherte Fachaufgabe', () => {
    renderMitProviders(
      <EinheitZeichen
        tz={{ typLabel: 'Zug', fachaufgabe: 'gibt-es-nicht', organisation: 'quatsch' }}
      />,
    );
    expect(zeichen().querySelectorAll('svg')).toHaveLength(1);
  });

  it('bleibt ohne Zeichendaten ein leerer Rahmen', () => {
    renderMitProviders(<EinheitZeichen tz={null} />);
    expect(zeichen().querySelector('svg')).toBeNull();
  });
});
