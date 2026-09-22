import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ConfigProvider, theme } from 'antd';
import { renderMitProviders } from '../test/utils';
import StatusTag, { wirksameDarstellungsart } from './StatusTag';
import type { StatusDarstellung } from '../theme/statusFarben';
import { antdToken, farbenHell, farbenDunkel } from '../theme/tokens';

/** Der Vertrag verlangt den zweiten Kanal am Eintrag; die Tests bauen ihn hier von Hand,
 *  damit sie unabhängig von den konkreten Enum-Zuordnungen bleiben. */
const alarm: StatusDarstellung = { rolle: 'alarm', label: 'nicht verfügbar' };
const normal: StatusDarstellung = { rolle: 'normal', label: 'verfügbar' };

/** Die antd-Farbklassen (`.ant-tag-green` &Co.) sind im Test NICHT eindeutig — geprüft
 *  wird deshalb über Textinhalt, `data-rolle` und den Inline-Stil, nie über die Klasse. */
function stilVon(element: HTMLElement) {
  return { color: element.style.color, borderColor: element.style.borderColor };
}

describe('StatusTag', () => {
  it.each(['light', 'dark'] as const)(
    '%s: die Rand-Form legt die Rolle auf den Rand und den Wortlaut auf colorText',
    (modus) => {
      const config = {
        algorithm: modus === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: antdToken(modus === 'dark' ? farbenDunkel : farbenHell),
      };
      const token = theme.getDesignToken(config);
      renderMitProviders(
        <ConfigProvider theme={config}>
          <StatusTag darstellung={{ rolle: 'achtung', label: 'vermisst' }} darstellungsart="rand" />
        </ConfigProvider>,
      );
      const tag = screen.getByText('vermisst').closest('.ant-tag') as HTMLElement;
      expect(tag).toHaveStyle({ color: token.colorText, borderColor: token.colorWarning });
      expect(tag.style.background).toBe('transparent');
      expect(tag.dataset.darstellung).toBe('rand');
    },
  );

  /**
   * Neuentwurf (Entscheidung 2): die Vorgabe ist die getönte FLÄCHE. Die Erwartungen stehen
   * als Rollenwerte aus der Palette des Modus — die Kontrastrechnung dazu liegt in
   * `instrument/statusFlaeche.ts`. Am Tag beschriften `achtung`/`alarm` mit ihren
   * Textrollen (LFH-618) — die Füllfarbe läge als Text unter 7 : 1.
   */
  it.each([
    ['light', 'normal', farbenHell.normalFlaeche, farbenHell.normalText, farbenHell.normal],
    ['light', 'achtung', farbenHell.achtungFlaeche, farbenHell.achtungText, farbenHell.achtung],
    ['light', 'alarm', farbenHell.alarmFlaeche, farbenHell.alarmText, farbenHell.alarm],
    ['light', 'neutral', farbenHell.flaeche3, farbenHell.text2, farbenHell.schwach],
    ['dark', 'achtung', farbenDunkel.achtungFlaeche, farbenDunkel.achtung, farbenDunkel.achtung],
    ['dark', 'alarm', farbenDunkel.alarmFlaeche, farbenDunkel.alarm, farbenDunkel.alarm],
    ['dark', 'bedien', farbenDunkel.bedienFlaeche, farbenDunkel.bedienText, farbenDunkel.bedien],
  ] as const)('%s/%s: Vorgabe ist die getönte Fläche', (modus, rolle, grund, text, rand) => {
    const config = {
      algorithm: modus === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm,
      token: antdToken(modus === 'dark' ? farbenDunkel : farbenHell),
    };
    renderMitProviders(
      <ConfigProvider theme={config}>
        <StatusTag darstellung={{ rolle, label: 'Probe' }} />
      </ConfigProvider>,
    );
    const tag = screen.getByText('Probe').closest('.ant-tag') as HTMLElement;
    expect(tag.dataset.darstellung).toBe('flaeche');
    expect(tag).toHaveStyle({ backgroundColor: grund, color: text, borderColor: rand });
  });

  it('die Regel: Mandantenfarbe und Marke bleiben am Rand, sonst Fläche', () => {
    expect(wirksameDarstellungsart(normal, null)).toBe('flaeche');
    expect(wirksameDarstellungsart(normal, '   ')).toBe('flaeche');
    expect(wirksameDarstellungsart(normal, '#123456')).toBe('rand');
    // Eine gesetzte Mandantenfarbe schlägt auch den ausdrücklichen Wunsch.
    expect(wirksameDarstellungsart(normal, 'red', 'flaeche')).toBe('rand');
    expect(wirksameDarstellungsart({ rolle: 'marke', label: 'm' }, null)).toBe('rand');
    expect(wirksameDarstellungsart(normal, null, 'rand')).toBe('rand');
  });

  it('rendert den Text IMMER — die Farbe allein ist kein Kanal (WCAG 1.4.1)', () => {
    renderMitProviders(<StatusTag darstellung={alarm} />);
    expect(screen.getByText('nicht verfügbar')).toBeInTheDocument();
  });

  it('erzeugt für zwei Rollen unterscheidbare Ausgaben', () => {
    renderMitProviders(
      <div>
        <StatusTag darstellung={alarm} />
        <StatusTag darstellung={normal} />
      </div>,
    );
    const a = screen.getByText('nicht verfügbar').closest('.ant-tag') as HTMLElement;
    const n = screen.getByText('verfügbar').closest('.ant-tag') as HTMLElement;
    expect(a.dataset.rolle).toBe('alarm');
    expect(n.dataset.rolle).toBe('normal');
    expect(stilVon(a).color).toBeTruthy();
    expect(stilVon(a).borderColor).not.toBe(stilVon(n).borderColor);
    expect(a.style.backgroundColor).not.toBe(n.style.backgroundColor);
  });

  it('setzt keinen hartkodierten Farbwert — der Wert kommt aus dem aktiven Token', () => {
    renderMitProviders(
      <ConfigProvider theme={{ token: { colorText: '#123456', colorError: '#654321' } }}>
        <StatusTag darstellung={{ ...alarm, form: 'dreieck' }} darstellungsart="rand" />
      </ConfigProvider>,
    );
    const tag = screen.getByText('nicht verfügbar').closest('.ant-tag') as HTMLElement;
    // Kein Preset-Name als Klasse (antd würde sonst eigene Farben mitbringen), und der
    // Die absichtlich abweichenden Provider-Werte belegen beide getrennten Kanäle.
    expect(tag.className).not.toMatch(/ant-tag-(red|green|gold|orange|blue|cyan|purple)\b/);
    expect(stilVon(tag).color).toBe('rgb(18, 52, 86)');
    expect(stilVon(tag).borderColor).toBe('rgb(101, 67, 33)');
    expect(tag.querySelector<HTMLElement>('[aria-hidden="true"]')?.style.color).toBe(
      'rgb(101, 67, 33)',
    );
  });

  it('rendert das optionale Formzeichen zusätzlich zum Text, ohne ihn zu verdrängen', () => {
    renderMitProviders(
      <StatusTag darstellung={{ rolle: 'achtung', label: 'gebunden', form: 'dreieck' }} />,
    );
    const tag = screen.getByText('gebunden').closest('.ant-tag') as HTMLElement;
    expect(tag).toHaveTextContent('gebunden');
    // Das Zeichen ist ein DRITTER Kanal, kein Ersatz: für Screenreader ausgeblendet.
    expect(tag.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it('reicht `title` als Tooltip-Attribut durch', () => {
    renderMitProviders(<StatusTag darstellung={normal} title="Stand 14:32" />);
    const tag = screen.getByText('verfügbar').closest('.ant-tag') as HTMLElement;
    expect(tag).toHaveAttribute('title', 'Stand 14:32');
  });

  it('eine transparente Mandantenfarbe lässt Wortlaut und tragenden Rahmen unverändert lesbar', () => {
    renderMitProviders(
      <>
        <StatusTag darstellung={{ ...normal, label: 'Rollenfarbe' }} darstellungsart="rand" />
        <StatusTag darstellung={{ ...normal, label: 'Mandantenfarbe' }} farbe="transparent" />
      </>,
    );
    const rolle = screen.getByText('Rollenfarbe').closest('.ant-tag') as HTMLElement;
    const mandant = screen.getByText('Mandantenfarbe').closest('.ant-tag') as HTMLElement;
    expect(stilVon(rolle).color).toBeTruthy();
    expect(stilVon(rolle).borderColor).toBeTruthy();
    expect(stilVon(mandant)).toEqual(stilVon(rolle));
    expect(mandant.querySelector<HTMLElement>('[aria-hidden="true"]')?.style.backgroundColor).toBe(
      'transparent',
    );
  });

  it('setzt keine Klein-Variante (Gate 4) — die Höhe kommt aus der Dichte-Staffel', () => {
    renderMitProviders(<StatusTag darstellung={normal} />);
    const tag = screen.getByText('verfügbar').closest('.ant-tag') as HTMLElement;
    expect(tag.className).not.toMatch(/-sm\b/);
  });
});
