import { act } from '@testing-library/react';
import { contrastSurface } from '@einsatzzeichen/core';
import { ConfigProvider, theme } from 'antd';
import { describe, expect, it } from 'vitest';
import { renderMitProviders } from '../test/utils';
import { antdToken, farbenDunkel } from '../theme/tokens';
import { ZEICHEN_THEME_DUNKEL } from '../zeichen/zeichenTheme';
import EinheitZeichen, { FahrzeugZeichen } from './EinheitZeichen';

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

  // LLH-1409: die Organisations-Vorgabe der Karte fehlt hier bewusst, also zeichnet die Bibliothek
  // jede Einheit ohne eigene Organisation mit schwarzem Umriss ohne Fläche — nachts sonst schwarz
  // auf schwarz. Nachts hinterlegt das Render-Theme `dark` die Kontur hell, am Tag und im Druck
  // bleibt die Referenzpalette; ein helles Quadrat dahinter gibt es nicht mehr.
  const hinterlegt = () =>
    document
      .querySelector('[data-lfh="einheit-zeichen"] svg')!
      .querySelector(`[stroke="${contrastSurface(ZEICHEN_THEME_DUNKEL)}"]`) != null;
  const ohneOrganisation = { typLabel: 'Zug', fachaufgabe: null, organisation: null };

  it('zeichnet nachts mit dem Theme `dark`, im Druck ohne', () => {
    renderMitProviders(
      <ConfigProvider theme={{ algorithm: theme.darkAlgorithm, token: antdToken(farbenDunkel) }}>
        <EinheitZeichen tz={ohneOrganisation} />
      </ConfigProvider>,
    );
    expect(hinterlegt()).toBe(true);
    expect(
      document.querySelector<SVGElement>('[data-lfh="einheit-zeichen"] svg')!.style.backgroundColor,
    ).toBe('');
    act(() => {
      window.dispatchEvent(new Event('beforeprint'));
    });
    expect(hinterlegt()).toBe(false);
    act(() => {
      window.dispatchEvent(new Event('afterprint'));
    });
    expect(hinterlegt()).toBe(true);
  });

  it('zeichnet am Tag ohne Theme und ohne Fläche dahinter', () => {
    renderMitProviders(<EinheitZeichen tz={ohneOrganisation} />);
    expect(hinterlegt()).toBe(false);
    expect(
      document.querySelector<SVGElement>('[data-lfh="einheit-zeichen"] svg')!.style.backgroundColor,
    ).toBe('');
  });
});

// LLH-1036: die Einheit-Ansicht zeigt das Zeichen groß und mit der Vorgabe der Organisation.
// Ohne beide Props bleibt das Meldebild, wie es ist.
describe('EinheitZeichen · Größe und Vorgabe der Organisation (LLH-1036)', () => {
  const rahmen = () => document.querySelector<HTMLElement>('[data-lfh="einheit-zeichen"]')!;
  const beschreibung = () => rahmen().querySelector('svg desc')?.textContent ?? null;
  const tz = { typLabel: 'Zug', fachaufgabe: null, organisation: null };

  it('ohne Props wie bisher: 26 px, keine Organisation', () => {
    renderMitProviders(<EinheitZeichen tz={tz} />);
    expect(rahmen()).toHaveStyle({ width: '26px', height: '26px' });
    expect(beschreibung()).toBe('Grundzeichen: Taktische Formation. Stärke: Zug.');
  });

  it('mit `groesse` wächst der Rahmen samt Zeichen', () => {
    renderMitProviders(<EinheitZeichen tz={tz} groesse={64} />);
    expect(rahmen()).toHaveStyle({ width: '64px', height: '64px' });
    expect(rahmen().querySelector('svg')!.getAttribute('width')).toBe('60');
  });

  it('mit `orgDefault` trägt das Zeichen die Organisation', () => {
    renderMitProviders(<EinheitZeichen tz={tz} orgDefault="thw" />);
    expect(beschreibung()).toContain('Organisation: Technisches Hilfswerk');
  });

  it('die eigene Organisation geht der Vorgabe vor', () => {
    renderMitProviders(
      <EinheitZeichen tz={{ ...tz, organisation: 'feuerwehr' }} orgDefault="thw" />,
    );
    expect(beschreibung()).toContain('Organisation: Feuerwehr');
  });
});

describe('FahrzeugZeichen', () => {
  const beschreibung = () =>
    document.querySelector('[data-lfh="fahrzeug-zeichen"] svg desc')?.textContent ?? null;
  const tz = {
    fahrzeugtyp: null,
    traegerorganisation: null,
    opta: null,
    fachaufgabe: null,
    organisation: null,
  };

  it('leitet Grundzeichen und Organisation aus Typ und Träger ab, wie die Lagekarte', () => {
    renderMitProviders(
      <FahrzeugZeichen
        tz={{ ...tz, fahrzeugtyp: 'HLF 20', traegerorganisation: 'FF Musterstadt' }}
      />,
    );
    expect(beschreibung()).toMatch(/Organisation: Feuerwehr/);
    expect(beschreibung()).toMatch(/Brandbekämpfung/);
  });

  it('fällt ohne Angaben auf das Grundzeichen Fahrzeug zurück, nie auf ein leeres Zeichen', () => {
    renderMitProviders(<FahrzeugZeichen tz={tz} />);
    expect(beschreibung()).toMatch(/^Grundzeichen: /);
  });
});
