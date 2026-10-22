import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import type { Nachforderung } from '../api/types';
import { useZuflussSteuerung } from '../components/useZuflussSchleuse';
import { renderMitProviders } from '../test/utils';
import { setzeViewportBreite } from '../test/viewport';
import NachforderungBoard, { useBoardStand, type BoardAnsicht } from './NachforderungBoard';

const JETZT = Date.UTC(2026, 5, 12, 12, 0);

const nf = (over: Partial<Nachforderung> = {}): Nachforderung => ({
  id: 1,
  einsatz_id: 1,
  art: 'RTW',
  bezeichnung: 'RTW',
  anzahl: 1,
  adressat_kategorie: 'leitstelle',
  adressat_bezeichnung: null,
  begruendung: null,
  prioritaet: 'normal',
  status: 'angefordert',
  zugesagt_at: null,
  unterwegs_at: null,
  eingetroffen_at: null,
  abgelehnt_at: null,
  abgelehnt_grund: null,
  angefordert_at: '2026-06-12 09:00:00',
  etb_nachforderung_id: null,
  erstellt_von_id: 1,
  erstellt_at: '2026-06-12 09:00:00',
  erstellt_von_name: null,
  ist_offen: true,
  material_ids: [],
  zusage_rufnamen: [],
  ...over,
});

function Board({ liste }: { liste: Nachforderung[] }) {
  const zufluss = useZuflussSteuerung<Nachforderung>();
  const stand = useBoardStand(liste, JETZT, zufluss);
  const [ansicht, setAnsicht] = useState<BoardAnsicht>({
    stufe: 'angefordert',
    abgelehntOffen: false,
    zurueckgezogenOffen: false,
    aeltereOffen: false,
  });
  return (
    <NachforderungBoard
      stand={stand}
      jetzt={JETZT}
      zufluss={zufluss}
      ansicht={ansicht}
      onAnsicht={setAnsicht}
      karten={{}}
    />
  );
}

describe('NachforderungBoard (LLH-1078)', () => {
  /**
   * Leerzustand über das Leer-Primitiv (LFH-331); die Text-Zusicherung allein wäre auch mit antds
   * Leer-Element grün. Keine Primäraktion: das Anfordern liegt im Seitenkopf.
   */
  it('zeigt den Leertext über das Leer-Primitiv, ohne antds Leer-Element und ohne Knopf', () => {
    const { container } = renderMitProviders(<Board liste={[]} />);
    expect(screen.getByText('Keine Nachforderungen')).toBeInTheDocument();
    expect(container.querySelector('.ant-empty')).toBeNull();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('ab md vier Spalten mit Kopf und Zahl, Abgelehnt und Zurückgezogen eingeklappt daneben', () => {
    renderMitProviders(
      <Board
        liste={[
          nf({ id: 1, bezeichnung: 'Eins' }),
          nf({ id: 2, bezeichnung: 'Zwei' }),
          nf({ id: 3, bezeichnung: 'Drei', status: 'unterwegs' }),
          nf({ id: 4, bezeichnung: 'Vier', status: 'abgelehnt', ist_offen: false }),
          nf({ id: 5, bezeichnung: 'Fünf', status: 'zurueckgezogen', ist_offen: false }),
        ]}
      />,
    );
    const spalten = screen.getAllByRole('region', { name: 'Nachforderungen nach Stufe' });
    expect(spalten).toHaveLength(1);
    const koepfe = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(koepfe).toEqual([
      'Angefordert2',
      'Zugesagt0',
      'Unterwegs1',
      'Eingetroffen · letzte 12 h0',
      'Abgelehnt 1',
      'Zurückgezogen 1',
    ]);
    const zugesagt = document.querySelector<HTMLElement>('[data-stufe="zugesagt"]')!;
    expect(within(zugesagt).getByText('keine')).toBeInTheDocument();
    expect(screen.queryByText('Vier')).toBeNull();
    expect(screen.queryByText('Fünf')).toBeNull();
  });

  it('Zurückgezogen klappt auf, die Karte ohne Alarmrand mit Grund (LLH-1097 D8)', async () => {
    renderMitProviders(
      <Board
        liste={[
          nf({
            id: 5,
            bezeichnung: 'Fünf',
            status: 'zurueckgezogen',
            ist_offen: false,
            zurueckgezogen_grund: 'nicht mehr benötigt',
          }),
        ]}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /^Zurückgezogen/ }));
    expect(screen.getByText('Fünf')).toBeInTheDocument();
    expect(screen.getByText('Zurückgezogen: nicht mehr benötigt')).toBeInTheDocument();
  });

  it('über den Spalten „n überfällig“, nur bei verpasstem Eintreffen (LLH-1097 D7)', () => {
    const { unmount } = renderMitProviders(
      <Board
        liste={[
          nf({ id: 1, status: 'zugesagt', eintreffen_erwartet_at: '2026-06-12 08:00:00' }),
          nf({ id: 2, status: 'unterwegs', eintreffen_erwartet_at: '2026-06-12 08:30:00' }),
          nf({ id: 3, status: 'zugesagt', eintreffen_erwartet_at: '2099-01-01 08:00:00' }),
        ]}
      />,
    );
    const zaehler = document.querySelector<HTMLElement>('[data-lfh="board-ueberfaellig"]')!;
    expect(zaehler).toHaveTextContent('2überfällig');
    expect(within(zaehler).getByText('überfällig').closest('[data-ton]')).toHaveAttribute(
      'data-ton',
      'achtung',
    );
    unmount();
    renderMitProviders(
      <Board
        liste={[nf({ id: 3, status: 'zugesagt', eintreffen_erwartet_at: '2099-01-01 08:00:00' })]}
      />,
    );
    expect(document.querySelector('[data-lfh="board-ueberfaellig"]')).toBeNull();
  });

  it('unter md die Segmentleiste der sechs Stufen mit Zahl, darunter nur die gewählte', () => {
    setzeViewportBreite(390);
    renderMitProviders(
      <Board
        liste={[
          nf({ id: 1, bezeichnung: 'Eins' }),
          nf({ id: 3, bezeichnung: 'Drei', status: 'unterwegs' }),
        ]}
      />,
    );
    const tabs = within(screen.getByRole('tablist', { name: 'Stufe' }))
      .getAllByRole('tab')
      .map((t) => t.textContent);
    expect(tabs).toEqual([
      'Angefordert 1',
      'Zugesagt 0',
      'Unterwegs 1',
      'Eingetroffen 0',
      'Abgelehnt 0',
      'Zurückgezogen 0',
    ]);
    expect(screen.getByRole('tabpanel')).toHaveAttribute('data-stufe', 'angefordert');
    expect(screen.getByText('Eins')).toBeInTheDocument();
    expect(screen.queryByText('Drei')).toBeNull();
  });
});
