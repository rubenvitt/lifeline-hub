import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../test/utils';
import {
  ABSCHNITT_DEICH,
  GRUPPE_1,
  GRUPPE_2,
  KEINE_EMPFAENGER,
  ZUG,
  ausgabe,
  empfaenger,
  zeitfenster,
} from '../test/verpflegungDaten';
import EmpfaengerStand from './EmpfaengerStand';

const liste = (lfh: string) => document.querySelector<HTMLElement>(`[data-lfh="${lfh}"]`);
const zeilen = (lfh: string) =>
  [...(liste(lfh)?.querySelectorAll<HTMLElement>(':scope > li') ?? [])].map((li) => li.textContent);

describe('EmpfaengerStand (LLH-1055 Teil II)', () => {
  it('„Noch nicht verpflegt“ mit Stärke und Abschnitt, „ohne Eintreffen“ gesondert, „verpflegt“ mit Menge und Zeit', () => {
    renderMitProviders(
      <EmpfaengerStand
        zeitfenster={zeitfenster({
          ausgaben: [ausgabe({ id: 1, menge: 9, einheit_id: GRUPPE_1 })],
        })}
        empfaenger={empfaenger()}
        ueberschrift="h2"
      />,
    );
    expect(
      screen.getByRole('heading', { level: 2, name: 'Noch nicht verpflegt · 2' }),
    ).toBeVisible();
    expect(zeilen('stand-offen')).toEqual([
      '1. Zug · Florian 1 · 1/2/17//20 · Deich',
      '2. Gruppe · Florian 1-2 · 0/1/8//9 · Deich',
    ]);
    expect(screen.getByRole('heading', { level: 3, name: 'ohne Eintreffen · 1' })).toBeVisible();
    expect(zeilen('stand-ohne-eintreffen')).toEqual(['Wasserrettung']);
    expect(screen.getByRole('heading', { level: 2, name: 'Verpflegt · 1' })).toBeVisible();
    // 09:40 UTC = 11:40 in Berlin (Suiten-Zone).
    expect(zeilen('stand-verpflegt')).toEqual(['1. Gruppe · Florian 1-1 · 9 EP 1140 · Deich']);
  });

  it('die Gliederung rückt ein; der Zug nennt seine mitverpflegten Untereinheiten', () => {
    renderMitProviders(
      <EmpfaengerStand
        zeitfenster={zeitfenster({ ausgaben: [ausgabe({ id: 1, menge: 20, einheit_id: ZUG })] })}
        empfaenger={empfaenger()}
        ueberschrift="h3"
      />,
    );
    expect(zeilen('stand-verpflegt')).toEqual([
      '1. Zug · Florian 1 · 20 EP 1140 · mit 2 Untereinheiten · Deich',
    ]);
    expect(
      screen.getByRole('heading', { level: 3, name: 'Noch nicht verpflegt · 0' }),
    ).toBeVisible();
    expect(liste('stand-offen')).toBeNull();
  });

  it('eingerückt nach der Gliederung', () => {
    renderMitProviders(
      <EmpfaengerStand
        zeitfenster={zeitfenster({ ausgaben: [] })}
        empfaenger={empfaenger()}
        ueberschrift="h2"
      />,
    );
    const li = liste('stand-offen')!.querySelectorAll<HTMLElement>(':scope > li');
    expect(li[0].dataset.tiefe).toBe('0');
    expect(li[1].dataset.tiefe).toBe('1');
  });

  it('vorgemerkt: „ausstehend“ an der Zeile, die Einheit bleibt in der Liste (AK)', () => {
    renderMitProviders(
      <EmpfaengerStand
        zeitfenster={zeitfenster({ ausgaben: [] })}
        empfaenger={empfaenger()}
        ausstehend={[{ menge: 9, einheit_id: GRUPPE_2 }]}
        ueberschrift="h2"
      />,
    );
    const zeile = within(liste('stand-offen')!)
      .getByText(/2\. Gruppe/)
      .closest('li')!;
    expect(zeile).toHaveTextContent('ausstehend 9 EP');
    expect(screen.getByRole('heading', { name: 'Noch nicht verpflegt · 3' })).toBeVisible();
  });

  it('Zuführung: eigene Zeile unter „verpflegt“, die Einheiten im Abschnitt nennen sie', () => {
    renderMitProviders(
      <EmpfaengerStand
        zeitfenster={zeitfenster({
          ausgaben: [ausgabe({ id: 1, menge: 40, abschnitt_id: ABSCHNITT_DEICH })],
        })}
        empfaenger={empfaenger()}
        ueberschrift="h2"
      />,
    );
    expect(zeilen('stand-zufuehrung')).toEqual(['Zuführung Deich · 40 EP 1140']);
    expect(zeilen('stand-offen')[0]).toContain('Zuführung an Deich');
    expect(screen.getByRole('heading', { name: 'Verpflegt · 0' })).toBeVisible();
  });

  it('„Wählen“ setzt die Einheit als Empfänger; gesperrt ohne Schreibrecht', async () => {
    const onWaehlen = vi.fn();
    const { rerender } = renderMitProviders(
      <EmpfaengerStand
        zeitfenster={zeitfenster({ ausgaben: [] })}
        empfaenger={empfaenger()}
        ueberschrift="h2"
        onWaehlen={onWaehlen}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Empfänger wählen: 2. Gruppe' }));
    expect(onWaehlen).toHaveBeenCalledWith({ art: 'einheit', id: GRUPPE_2 });
    rerender(
      <EmpfaengerStand
        zeitfenster={zeitfenster({ ausgaben: [] })}
        empfaenger={empfaenger()}
        ueberschrift="h2"
        onWaehlen={onWaehlen}
        gewaehlt={{ art: 'einheit', id: GRUPPE_2 }}
      />,
    );
    expect(screen.getByRole('button', { name: 'Empfänger wählen: 2. Gruppe' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Empfänger wählen: 1. Zug' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('ohne „Wählen“-Weg keine Knöpfe', () => {
    renderMitProviders(
      <EmpfaengerStand
        zeitfenster={zeitfenster({ ausgaben: [] })}
        empfaenger={empfaenger()}
        ueberschrift="h2"
      />,
    );
    expect(screen.queryAllByRole('button')).toEqual([]);
  });

  it('ohne Einheiten im Einsatz nichts', () => {
    const { container } = renderMitProviders(
      <EmpfaengerStand
        zeitfenster={zeitfenster({ ausgaben: [] })}
        empfaenger={KEINE_EMPFAENGER}
        ueberschrift="h2"
      />,
    );
    expect(container.querySelector('[data-lfh="verpflegung-stand"]')).toBeNull();
  });
  it('anderswo verpflegt (LLH-1048): „anderswo verpflegt · n EP“ statt „noch nicht verpflegt“', () => {
    renderMitProviders(
      <EmpfaengerStand
        zeitfenster={zeitfenster({
          ausgaben: [ausgabe({ id: 1, menge: 9, einheit_id: GRUPPE_1 })],
          verpflegt_anderswo: [
            { einheit_id: GRUPPE_2, menge: 40 },
            { einheit_id: GRUPPE_1, menge: 5 },
          ],
        })}
        empfaenger={empfaenger()}
        ueberschrift="h2"
      />,
    );
    expect(zeilen('stand-offen')).toEqual(['1. Zug · Florian 1 · 1/2/17//20 · Deich']);
    expect(zeilen('stand-verpflegt')).toEqual([
      '1. Gruppe · Florian 1-1 · 9 EP 1140 · anderswo verpflegt · 5 EP · Deich',
      '2. Gruppe · Florian 1-2 · anderswo verpflegt · 40 EP · Deich',
    ]);
  });
});
