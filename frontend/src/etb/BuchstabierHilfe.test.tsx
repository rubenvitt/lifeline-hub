import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
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

  it('weist bei leerem Text auf die Eingabe hin', async () => {
    renderMitProviders(<BuchstabierHilfe text="" />);
    await userEvent.click(screen.getByRole('button', { name: 'Buchstabierhilfe' }));
    expect(await screen.findByText(/Text im Feld eingeben/)).toBeInTheDocument();
  });
});
