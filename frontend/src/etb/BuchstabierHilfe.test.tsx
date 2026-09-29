import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../test/utils';
import BuchstabierHilfe from './BuchstabierHilfe';

describe('BuchstabierHilfe', () => {
  it('zeigt die klassische Buchstabierung erst nach Klick auf den Trigger', async () => {
    renderMitProviders(<BuchstabierHilfe text="Florian" />);
    // Vor dem Klick ist der Popover-Inhalt nicht sichtbar.
    expect(screen.queryByText('Friedrich')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Buchstabierhilfe' }));
    expect(await screen.findByText('Friedrich')).toBeInTheDocument();
    expect(screen.getByText('Ludwig')).toBeInTheDocument();
  });

  it('schaltet auf NATO um', async () => {
    renderMitProviders(<BuchstabierHilfe text="AB" />);
    await userEvent.click(screen.getByRole('button', { name: 'Buchstabierhilfe' }));
    expect(await screen.findByText('Anton')).toBeInTheDocument();
    await userEvent.click(screen.getByText('NATO'));
    expect(await screen.findByText('Alfa')).toBeInTheDocument();
    expect(screen.queryByText('Anton')).not.toBeInTheDocument();
  });

  /**
   * Der icon-only Auslöser erklärt sich per Tooltip, BEVOR man ihn drückt (LFH-365).
   *
   * Die drei Fälle daneben liefern das NICHT mit: sie greifen den Knopf über
   * `name: 'Buchstabierhilfe'`, also über das `aria-label`, und wären mit und ohne Tooltip grün.
   *
   * Der Wortlaut ist mit dem `aria-label` identisch — Absicht: ein sichtbarer Hinweis, der
   * anders lautet als der zugängliche Name, verletzt WCAG 2.5.3 (Label in Name).
   */
  it('erklärt den Auslöser per Tooltip, bevor er gedrückt wird', async () => {
    renderMitProviders(<BuchstabierHilfe text="Florian" />);
    await userEvent.hover(screen.getByRole('button', { name: 'Buchstabierhilfe' }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Buchstabierhilfe');
  });

  /**
   * Der Tooltip weicht, sobald die Tafel steht.
   *
   * Tooltip (Zeigereintritt) und Popover (Klick) hängen am selben Knopf, ihre OVERLAYS liegen
   * nach Zeigen-und-Klicken aber gleichzeitig im DOM. Sie teilen Anker und `placement: 'top'`,
   * und der Tooltip liegt oben (`zIndexPopupBase + 70` gegen `+ 30`) — er verdeckte die erste
   * Zeile der Tafel. Auf Touch ist das der Normalfall: rc-trigger ergänzt einem Hover-Auslöser
   * `touch`, ein Tipp öffnet beides.
   *
   * Geprüft wird die antd-KLASSE, nicht `role="tooltip"`: antd gibt dem Popover dieselbe Rolle.
   */
  it('räumt den Tooltip weg, sobald die Tafel offen ist', async () => {
    renderMitProviders(<BuchstabierHilfe text="Florian" />);
    const knopf = screen.getByRole('button', { name: 'Buchstabierhilfe' });
    await userEvent.hover(knopf);
    expect(await screen.findByRole('tooltip')).toBeInTheDocument();

    await userEvent.click(knopf);
    expect(await screen.findByText('Friedrich')).toBeInTheDocument();
    await waitFor(() =>
      expect(document.querySelectorAll('.ant-tooltip:not(.ant-tooltip-hidden)')).toHaveLength(0),
    );
  });

  it('weist bei leerem Text auf die Eingabe hin', async () => {
    renderMitProviders(<BuchstabierHilfe text="" />);
    await userEvent.click(screen.getByRole('button', { name: 'Buchstabierhilfe' }));
    expect(await screen.findByText(/Text im Feld eingeben/)).toBeInTheDocument();
  });
});
