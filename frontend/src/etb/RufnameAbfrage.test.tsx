import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../test/utils';
import RufnameAbfrage from './RufnameAbfrage';

/** Die Abfrage des Standard-Rufnamens (LFH-894, design.md D4). */

function uebernehmen() {
  return vi.fn<(wert: string) => Promise<void>>().mockResolvedValue(undefined);
}

describe('RufnameAbfrage', () => {
  it('fragt beim ersten Mal mit dem Vorschlag und schreibt An = Von', async () => {
    const onUebernehmen = uebernehmen();
    renderMitProviders(
      <RufnameAbfrage
        optionen={[]}
        standard={null}
        vorschlag="Florian Leitung"
        onUebernehmen={onUebernehmen}
      />,
    );
    expect(
      screen.getByRole('group', { name: 'Mit welchem Rufnamen schreibst du ins ETB?' }),
    ).toBeInTheDocument();
    const feld = screen.getByRole('combobox', { name: 'Rufname für Von und An' });
    expect(feld).toHaveValue('Florian Leitung');
    expect(screen.getByRole('checkbox', { name: 'Empfänger wie Absender' })).toBeChecked();
    // Die erste Abfrage hat keinen Ausweg ohne Wert.
    expect(screen.queryByRole('button', { name: 'Abbrechen' })).toBeNull();

    await userEvent.clear(feld);
    await userEvent.type(feld, 'ELW 1');
    await userEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));
    expect(onUebernehmen).toHaveBeenCalledWith('{"von":"ELW 1","an":"ELW 1"}');
  });

  it('nimmt Freitext und übernimmt mit Enter', async () => {
    const onUebernehmen = uebernehmen();
    renderMitProviders(
      <RufnameAbfrage optionen={['Florian 1']} standard={null} onUebernehmen={onUebernehmen} />,
    );
    await userEvent.type(
      screen.getByRole('combobox', { name: 'Rufname für Von und An' }),
      'Kater 12{Enter}',
    );
    expect(onUebernehmen).toHaveBeenCalledWith('{"von":"Kater 12","an":"Kater 12"}');
  });

  it('schreibt getrennte Seiten, wenn „Empfänger wie Absender“ aus ist', async () => {
    const onUebernehmen = uebernehmen();
    renderMitProviders(
      <RufnameAbfrage optionen={[]} standard={null} onUebernehmen={onUebernehmen} />,
    );
    await userEvent.type(screen.getByRole('combobox', { name: 'Rufname für Von und An' }), 'ELW 1');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Empfänger wie Absender' }));
    // Ohne zweiten Wert geht nichts raus.
    await userEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));
    expect(await screen.findByText('Empfänger fehlt.')).toBeInTheDocument();
    expect(onUebernehmen).not.toHaveBeenCalled();

    await userEvent.type(
      screen.getByRole('combobox', { name: 'Rufname für An' }),
      'Einsatzleitung',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));
    expect(onUebernehmen).toHaveBeenCalledWith('{"von":"ELW 1","an":"Einsatzleitung"}');
  });

  it('verweigert einen leeren Rufnamen', async () => {
    const onUebernehmen = uebernehmen();
    renderMitProviders(
      <RufnameAbfrage optionen={[]} standard={null} onUebernehmen={onUebernehmen} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));
    expect(await screen.findByText('Rufname fehlt.')).toBeInTheDocument();
    expect(onUebernehmen).not.toHaveBeenCalled();
  });

  it('zeigt einen abgelehnten Wert als Fehler und lässt die Eingabe stehen', async () => {
    const onUebernehmen = vi
      .fn<(wert: string) => Promise<void>>()
      .mockRejectedValue(new Error('Server nicht erreichbar'));
    renderMitProviders(
      <RufnameAbfrage optionen={[]} standard={null} onUebernehmen={onUebernehmen} />,
    );
    const feld = screen.getByRole('combobox', { name: 'Rufname für Von und An' });
    await userEvent.type(feld, 'ELW 1');
    await userEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));
    expect(
      await screen.findByText('Nicht gespeichert: Server nicht erreichbar'),
    ).toBeInTheDocument();
    expect(feld).toHaveValue('ELW 1');
  });

  it('beim Ändern: getrennter Standard öffnet mit zwei Feldern, Escape bricht ab', async () => {
    const onAbbrechen = vi.fn();
    renderMitProviders(
      <RufnameAbfrage
        optionen={[]}
        standard={{ von: 'ELW 1', an: 'Einsatzleitung' }}
        vorschlag="Florian Leitung"
        onUebernehmen={uebernehmen()}
        onAbbrechen={onAbbrechen}
      />,
    );
    expect(screen.getByRole('group', { name: 'Dein Rufname für Von und An' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Empfänger wie Absender' })).not.toBeChecked();
    expect(screen.getByRole('combobox', { name: 'Rufname für Von' })).toHaveValue('ELW 1');
    expect(screen.getByRole('combobox', { name: 'Rufname für An' })).toHaveValue('Einsatzleitung');

    await userEvent.type(screen.getByRole('combobox', { name: 'Rufname für Von' }), '{Escape}');
    await waitFor(() => expect(onAbbrechen).toHaveBeenCalled());
  });
});
