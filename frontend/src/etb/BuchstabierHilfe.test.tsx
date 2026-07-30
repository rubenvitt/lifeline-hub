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
   * Der Auslöser erklärt sich, BEVOR man ihn drückt (LFH-365 · B5e). Er ist icon-only und
   * hatte bis hierhin nur ein `aria-label` — für eine Maus- oder Touch-Bedienung also
   * keine Erklärung außer dem Ausprobieren.
   *
   * Diese Zusicherung ist nötig, weil die drei Fälle daneben sie NICHT mitliefern: sie
   * greifen den Knopf über `name: 'Buchstabierhilfe'`, und das ist der Wert des
   * `aria-label`, der in der Namensrechnung gegen jeden sichtbaren Text gewinnt (gemessen).
   * Sie wären mit und ohne Tooltip grün.
   *
   * Der Wortlaut ist mit dem `aria-label` identisch — Absicht, nicht Redundanz: ein
   * sichtbarer Hinweis, der anders lautet als der zugängliche Name, verletzt WCAG 2.5.3
   * (Label in Name) und macht Sprachsteuerung unbedienbar.
   */
  it('erklärt den Auslöser per Tooltip, bevor er gedrückt wird', async () => {
    renderMitProviders(<BuchstabierHilfe text="Florian" />);
    await userEvent.hover(screen.getByRole('button', { name: 'Buchstabierhilfe' }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Buchstabierhilfe');
  });

  /**
   * Der Tooltip weicht, sobald die Tafel steht (Review-Nachtrag zu LFH-365).
   *
   * Beide Hüllen hängen am selben Knopf, und der Kommentar „sie beißen sich nicht — der
   * Tooltip hängt am Zeigereintritt, das Popover am Klick" gilt nur für die AUSLÖSER, nicht
   * für die Overlays: gemessen liegen nach Zeigen-und-Klicken beide gleichzeitig im DOM.
   * Sie teilen Anker und Ausrichtungsregel (`placement: 'top'`), fallen also an derselben
   * Kante zusammen, und der Tooltip liegt oben (`zIndexPopupBase + 70` gegen `+ 30`) —
   * er verdeckt die erste Zeile der Buchstabiertafel.
   *
   * Auf Touch ist das der Normalfall, nicht die Ausnahme: rc-trigger ergänzt einem
   * Hover-Auslöser zusätzlich `touch`, ein Tipp öffnet also beides zugleich. Das
   * Führungs-Tablet ist nach der Bedien-Leitlinie ein Primärkontext.
   *
   * Geprüft wird die antd-KLASSE, nicht `role="tooltip"`: antd gibt seinem Popover-Popup
   * dieselbe Rolle, eine Rollenzählung läse sich als Doppeltreffer und belegte nichts.
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
