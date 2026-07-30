import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../../test/utils';
import GefahrenMatrix, { type GefahrenMatrixProps } from './GefahrenMatrix';
import type { GefahrBewertung } from '../../api/types';

const zelle = (over: Partial<GefahrBewertung>): GefahrBewertung => ({
  id: 1, gefahrengebiet_id: 7, gefahrentyp: 'brand', schutzobjekt: 'menschen', warnstufe: 'hoch',
  beschreibung: null, gemeldet_von: null, aktualisiert_von: 1, erstellt_at: '', geaendert_at: '', ...over,
});

/** Der Eintrag wird IMMER über das geöffnete Menü gegriffen: antd lässt die Portale
 *  geschlossener Dropdowns im Baum stehen, ein globales getByText träfe auch sie.
 *  Muster aus `etb/EtbTabelle.test.tsx` (LFH-365 · B5e); in einer Matrix mit 58
 *  Auslösern liegt je bereits geöffneter Zelle ein eigenes totes Portal herum. */
function imMenue() {
  const menue = document.querySelector('.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]');
  if (!menue) throw new Error('kein offenes Menü im Baum');
  return within(menue as HTMLElement);
}

/** Ein Ort für die Pflichtprops. Ohne den trägt jeder der sieben Fälle vier Zeilen
 *  Gerüst, und eine neue Prop hieße sieben Änderungen. */
function rendereMatrix(over: Partial<GefahrenMatrixProps> = {}) {
  return renderMitProviders(
    <GefahrenMatrix
      matrix={[]}
      darfSchreiben
      laufendeZelle={null}
      onSetzen={() => {}}
      onDetailsSpeichern={async () => {}}
      {...over}
    />,
  );
}

describe('GefahrenMatrix', () => {
  it('rendert 13 Zeilen × 5 Spalten', () => {
    rendereMatrix();
    expect(screen.getAllByText('Brand')[0]).toBeInTheDocument();
    expect(screen.getAllByText('Ertrinken')[0]).toBeInTheDocument();
    // Zeuge der fünften SPALTE. Vorher stand hier „Einsatzkräfte" — das volle Wort
    // steht seit dem Kopfumbau nur noch im Tooltip, und den hängt antd erst beim
    // Zeigen ein. Die Kurzform ist der Text, der im Baum steht.
    expect(screen.getAllByText('Kraft')[0]).toBeInTheDocument();
  });

  it('setzt eine Warnstufe über das Zellmenü und ruft onSetzen mit vollem Zell-Zustand', async () => {
    const onSetzen = vi.fn();
    rendereMatrix({ onSetzen });
    await userEvent.click(screen.getByRole('button', { name: 'Bewertung Brand × Menschen: keine' }));
    // Regex mit `i`: der Eintrag heißt „H · Hoch", der Vorgabe-Normalisierer von
    // Testing Library trimmt und faltet Leerraum, aber er kleinschreibt nicht.
    await userEvent.click(imMenue().getByRole('menuitem', { name: /hoch/i }));
    await waitFor(() => expect(onSetzen).toHaveBeenCalledWith({
      gefahrentyp: 'brand', schutzobjekt: 'menschen', warnstufe: 'hoch',
      beschreibung: null, gemeldet_von: null,
    }));
  });

  it('gibt jeder Zelle einen eigenen Namen — 65 gleichnamige Knöpfe wären keine Bedienung', () => {
    rendereMatrix();
    const namen = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    const bewertungen = namen.filter((n) => n?.startsWith('Bewertung '));
    expect(bewertungen).toHaveLength(58); // 65 − 7 ungültige Kombinationen
    expect(new Set(bewertungen).size).toBe(bewertungen.length);
  });

  it('macht die 7 ungültigen Kombinationen ohne Farbe erkennbar — und unbedienbar', () => {
    rendereMatrix();
    // Zweiter Kanal ist TEXT: die Zelle sagt „nicht anwendbar", statt nur blass zu sein.
    expect(screen.getAllByText('n. a.')).toHaveLength(7);
    expect(
      screen.queryByRole('button', { name: /Bewertung Atemgifte × Sachwerte/ }),
    ).not.toBeInTheDocument();
  });

  it('behält beschreibung/gemeldet_von bei Warnstufen-Wechsel', async () => {
    const onSetzen = vi.fn();
    const matrix = [zelle({ warnstufe: 'hoch', beschreibung: 'Dachstuhl', gemeldet_von: 'KdoW' })];
    rendereMatrix({ matrix, onSetzen });
    await userEvent.click(screen.getByRole('button', { name: 'Bewertung Brand × Menschen: hoch' }));
    await userEvent.click(imMenue().getByRole('menuitem', { name: /akut/i }));
    await waitFor(() => expect(onSetzen).toHaveBeenCalledWith({
      gefahrentyp: 'brand', schutzobjekt: 'menschen', warnstufe: 'akut',
      beschreibung: 'Dachstuhl', gemeldet_von: 'KdoW',
    }));
  });

  it('sperrt beim laufenden PUT NUR die betroffene Zelle, nicht die anderen 57', () => {
    rendereMatrix({ laufendeZelle: 'brand×menschen' });
    // antd klont den Auslöser mit `disabled` (`antd/es/dropdown/dropdown.js:125`:
    // `disabled: child.props.disabled ?? disabled`) — die Prop am Dropdown erreicht
    // also wirklich den Knopf, nicht nur das Popup.
    expect(screen.getByRole('button', { name: 'Bewertung Brand × Menschen: keine' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Bewertung Brand × Tiere: keine' })).toBeEnabled();
  });

  it('zeigt die Stufe als Kürzel — die Fläche allein wäre der einzige Kanal', () => {
    rendereMatrix({ matrix: [zelle({ warnstufe: 'akut' })] });
    const knopf = screen.getByRole('button', { name: 'Bewertung Brand × Menschen: akut' });
    expect(knopf).toHaveTextContent('A');
  });

  it('hält den Detail-Wortlaut, wenn das Speichern abgelehnt wird', async () => {
    const onDetailsSpeichern = vi.fn().mockRejectedValue(new Error('422'));
    rendereMatrix({ matrix: [zelle({ warnstufe: 'hoch' })], onDetailsSpeichern });
    await userEvent.click(screen.getByRole('button', { name: 'Bewertung Brand × Menschen: hoch' }));
    await userEvent.click(imMenue().getByRole('menuitem', { name: 'Details …' }));
    const feld = await screen.findByLabelText('Beschreibung');
    await userEvent.type(feld, 'Dachstuhl brennt');
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(onDetailsSpeichern).toHaveBeenCalled());
    // Nicht geleert, nicht geschlossen — der Wortlaut ist teurer als der Klick.
    expect(await screen.findByLabelText('Beschreibung')).toHaveValue('Dachstuhl brennt');
  });
});
