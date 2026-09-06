import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ConfigProvider } from 'antd';
import { renderMitProviders } from '../test/utils';
import StatusTag from './StatusTag';
import type { StatusDarstellung } from '../theme/statusFarben';

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
    expect(stilVon(a).color).toBe(stilVon(n).color);
    expect(stilVon(a).borderColor).not.toBe(stilVon(n).borderColor);
  });

  it('setzt keinen hartkodierten Farbwert — der Wert kommt aus dem aktiven Token', () => {
    renderMitProviders(
      <ConfigProvider theme={{ token: { colorText: '#123456', colorError: '#654321' } }}>
        <StatusTag darstellung={{ ...alarm, form: 'dreieck' }} />
      </ConfigProvider>,
    );
    const tag = screen.getByText('nicht verfügbar').closest('.ant-tag') as HTMLElement;
    // Kein Preset-Name als Klasse (antd würde sonst eigene Farben mitbringen), und der
    // Die absichtlich abweichenden Provider-Werte belegen beide getrennten Kanäle.
    expect(tag.className).not.toMatch(/ant-tag-(red|green|gold|orange|blue|cyan|purple)\b/);
    expect(stilVon(tag).color).toBe('rgb(18, 52, 86)');
    expect(stilVon(tag).borderColor).toBe('rgb(101, 67, 33)');
    expect(tag.querySelector<HTMLElement>('[aria-hidden="true"]')?.style.color).toBe('rgb(101, 67, 33)');
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
    renderMitProviders(<>
      <StatusTag darstellung={{ ...normal, label: 'Rollenfarbe' }} />
      <StatusTag darstellung={{ ...normal, label: 'Mandantenfarbe' }} farbe="transparent" />
    </>);
    const rolle = screen.getByText('Rollenfarbe').closest('.ant-tag') as HTMLElement;
    const mandant = screen.getByText('Mandantenfarbe').closest('.ant-tag') as HTMLElement;
    expect(stilVon(rolle).color).toBeTruthy();
    expect(stilVon(rolle).borderColor).toBeTruthy();
    expect(stilVon(mandant)).toEqual(stilVon(rolle));
    expect(mandant.querySelector<HTMLElement>('[aria-hidden="true"]')?.style.backgroundColor).toBe('transparent');
  });

  it('setzt keine Klein-Variante (Gate 4) — die Höhe kommt aus der Dichte-Staffel', () => {
    renderMitProviders(<StatusTag darstellung={normal} />);
    const tag = screen.getByText('verfügbar').closest('.ant-tag') as HTMLElement;
    expect(tag.className).not.toMatch(/-sm\b/);
  });
});
