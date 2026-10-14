import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tag } from 'antd';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import { renderMitProviders } from '../test/utils';
import { listeVon, optionenVon, oeffne, waehle } from '../test/auswahlListe';
import EinheitAngabe, { type EinheitAngabeProps } from './EinheitAngabe';
import type { EinheitOption } from './kraeftebaumKern';

const OPTIONEN: EinheitOption[] = [
  { id: 1, name: 'Rettungsstaffel', pfad: 'Rettungsstaffel', tiefe: 0, abschnitt: null },
  { id: 2, name: 'Zug 1', pfad: 'Zug 1', tiefe: 0, abschnitt: null },
  { id: 3, name: 'Staffel A', pfad: 'Zug 1 › Staffel A', tiefe: 1, abschnitt: null },
];

const MIT_ABSCHNITT: EinheitOption[] = [
  {
    id: 1,
    name: 'Rettungsstaffel',
    pfad: 'Rettungsstaffel',
    tiefe: 0,
    abschnitt: { id: 1, name: 'EA Nord' },
  },
  { id: 2, name: 'Zug 1', pfad: 'Zug 1', tiefe: 0, abschnitt: { id: 2, name: 'EA Süd' } },
  {
    id: 3,
    name: 'Staffel A',
    pfad: 'Zug 1 › Staffel A',
    tiefe: 1,
    abschnitt: { id: 2, name: 'EA Süd' },
  },
  { id: 4, name: 'Fremd', pfad: 'Fremd', tiefe: 0, abschnitt: null },
];

function angabe(p: Partial<EinheitAngabeProps> = {}) {
  const onSpeichern = p.onSpeichern ?? vi.fn().mockResolvedValue(undefined);
  renderMitProviders(
    <EinheitAngabe
      kennung="Anna"
      wert={null}
      optionen={OPTIONEN}
      darfSchreiben
      {...p}
      onSpeichern={onSpeichern}
    />,
  );
  return onSpeichern;
}

const FELD = 'Einheit zu Anna';

describe('EinheitAngabe (LLH-1060, LLH-1073 D3)', () => {
  it('leer: Aufforderung mit Zeilenkennung; die Auswahl zeigt die Einheiten mit Pfad', async () => {
    angabe();
    await userEvent.click(screen.getByRole('button', { name: 'Einheit zu Anna eintragen' }));
    await oeffne(FELD);
    expect(optionenVon(FELD)).toEqual(['Rettungsstaffel', 'Zug 1', 'Zug 1 › Staffel A']);
  });

  it('wählen allein schreibt nicht; „Speichern“ übergibt neuen und alten Wert', async () => {
    const onSpeichern = angabe({ wert: 1 });
    await userEvent.click(screen.getByRole('button', { name: 'Einheit zu Anna bearbeiten' }));
    await waehle(FELD, 'Zug 1 › Staffel A');
    expect(onSpeichern).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Einheit zu Anna speichern' }));
    await waitFor(() => expect(onSpeichern).toHaveBeenCalledWith(3, 1));
  });

  it('Escape verwirft die Wahl ohne Senden', async () => {
    const onSpeichern = angabe({ wert: 1 });
    await userEvent.click(screen.getByRole('button', { name: 'Einheit zu Anna bearbeiten' }));
    await waehle(FELD, 'Zug 1');
    // Das erste Escape schließt höchstens die Liste, das zweite verwirft die Zeile.
    await userEvent.keyboard('{Escape}');
    await userEvent.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('combobox', { name: FELD })).not.toBeInTheDocument(),
    );
    expect(onSpeichern).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Einheit zu Anna bearbeiten' })).toHaveTextContent(
      'Rettungsstaffel',
    );
  });

  it('Leeren übergibt null mit der bisherigen Einheit', async () => {
    const onSpeichern = angabe({ wert: 2 });
    await userEvent.click(screen.getByRole('button', { name: 'Einheit zu Anna bearbeiten' }));
    const feld = screen.getByRole('combobox', { name: FELD }).closest('.ant-select')!;
    await userEvent.click(feld.querySelector<HTMLElement>('.ant-select-clear')!);
    await userEvent.click(screen.getByRole('button', { name: 'Einheit zu Anna speichern' }));
    await waitFor(() => expect(onSpeichern).toHaveBeenCalledWith(null, 2));
  });

  it('unverändert gespeichert sendet nichts', async () => {
    const onSpeichern = angabe({ wert: 2 });
    await userEvent.click(screen.getByRole('button', { name: 'Einheit zu Anna bearbeiten' }));
    await userEvent.click(screen.getByRole('button', { name: 'Einheit zu Anna speichern' }));
    await waitFor(() =>
      expect(screen.queryByRole('combobox', { name: FELD })).not.toBeInTheDocument(),
    );
    expect(onSpeichern).not.toHaveBeenCalled();
  });

  it('eine Ablehnung steht an der Angabe, die Auswahl bleibt mit dem gewählten Wert offen', async () => {
    const onSpeichern = vi.fn().mockRejectedValue(new ApiError(422, 'Einheit ist aufgelöst'));
    angabe({ wert: 1, onSpeichern });
    await userEvent.click(screen.getByRole('button', { name: 'Einheit zu Anna bearbeiten' }));
    await waehle(FELD, 'Zug 1');
    await userEvent.click(screen.getByRole('button', { name: 'Einheit zu Anna speichern' }));
    expect(await screen.findByText(/Einheit ist aufgelöst/)).toBeInTheDocument();
    const feld = screen.getByRole('combobox', { name: FELD }).closest('.ant-select')!;
    expect(feld).toHaveTextContent('Zug 1');
  });

  it('ohne Schreibrecht: Name und Marke als Text, ohne Auslöser', () => {
    angabe({ wert: 3, darfSchreiben: false, marke: <Tag>Einheitsführer</Tag> });
    expect(screen.getByText('Staffel A')).toBeVisible();
    expect(screen.getByText('Einheitsführer')).toBeVisible();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('ohne Schreibrecht und ohne Einheit: „—“', () => {
    angabe({ darfSchreiben: false });
    expect(screen.getByText('—')).toBeVisible();
  });

  it('gruppiert die Auswahl nach dem Abschnitt der Einheit, „ohne Abschnitt“ zuletzt', async () => {
    const onSpeichern = angabe({ optionen: MIT_ABSCHNITT });
    await userEvent.click(screen.getByRole('button', { name: 'Einheit zu Anna eintragen' }));
    await oeffne(FELD);
    const liste = listeVon(FELD)!;
    expect([...liste.querySelectorAll('.ant-select-item-group')].map((g) => g.textContent)).toEqual(
      ['EA Nord', 'EA Süd', 'ohne Abschnitt'],
    );
    expect(optionenVon(FELD)).toEqual(['Rettungsstaffel', 'Zug 1', 'Zug 1 › Staffel A', 'Fremd']);
    await waehle(FELD, 'Fremd');
    await userEvent.click(screen.getByRole('button', { name: 'Einheit zu Anna speichern' }));
    await waitFor(() => expect(onSpeichern).toHaveBeenCalledWith(4, null));
  });

  it('ohne jeden Abschnitt bleibt die Auswahl flach', async () => {
    angabe();
    await userEvent.click(screen.getByRole('button', { name: 'Einheit zu Anna eintragen' }));
    await oeffne(FELD);
    expect(listeVon(FELD)!.querySelectorAll('.ant-select-item-group')).toHaveLength(0);
  });
});
