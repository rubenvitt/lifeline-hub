import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../test/utils';
import MetaChip from './MetaChip';

describe('MetaChip', () => {
  it('Text-Feld: Editor offen, Enter committet den Wert', async () => {
    const onCommit = vi.fn();
    renderMitProviders(
      <MetaChip feld="von" editing wert={undefined} onCommit={onCommit} onCancel={vi.fn()} onRemove={vi.fn()} onEdit={vi.fn()} />,
    );
    const input = screen.getByLabelText('Von');
    await userEvent.type(input, 'ELW 1{Enter}');
    expect(onCommit).toHaveBeenCalledWith('von', 'ELW 1');
  });

  it('geschlossen: zeigt Label+Wert', () => {
    renderMitProviders(
      <MetaChip feld="meldeweg" editing={false} wert="funk" onCommit={vi.fn()} onCancel={vi.fn()} onRemove={vi.fn()} onEdit={vi.fn()} />,
    );
    expect(screen.getByText(/Meldeweg/)).toBeInTheDocument();
    expect(screen.getByText(/Funk/)).toBeInTheDocument();
  });

  /**
   * Der Ersatz für das ~10-px-Kreuz (LFH-365 · B5e). Das `closeIcon` war die einzige
   * tastaturerreichbare Bedienung am geschlossenen Chip — der Tag-Rumpf selbst trägt
   * gemessen weder `role` noch `tabindex` —, und es war mit ~10 px weit unter jedem
   * Trefflächenboden. Es weicht einem benannten Auslöser, der seine Höhe wie jedes
   * andere Steuerelement vom `ConfigProvider` erbt.
   *
   * Der Name trägt das FELD (`Aktionen zu Von`), nicht bloß „Aktionen": die Chip-Leiste
   * zeigt mehrere Chips gleichzeitig (`Schnellerfassung.tsx:286`), und n gleichnamige
   * Knöpfe sind per Rolle nicht unterscheidbar. Dieselbe Festlegung wie in LFH-364 für
   * die Quittier-Knöpfe der Auftragskarte.
   */
  it('geschlossen: das Aktionsmenü trägt das Feld im Namen', () => {
    renderMitProviders(
      <MetaChip feld="von" editing={false} wert="ELW 1" onCommit={vi.fn()} onCancel={vi.fn()} onRemove={vi.fn()} onEdit={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Aktionen zu Von' })).toBeInTheDocument();
    // Das alte Kreuz ist ERSETZT, nicht ergänzt: bliebe es stehen, wäre das 10-px-Ziel
    // weiterhin die schnellste Bedienung und der Umbau folgenlos.
    expect(screen.queryByLabelText('schließen')).not.toBeInTheDocument();
  });

  /**
   * Die Erbin von „× ruft onRemove, nicht onEdit". Der Zusatz `onEdit` NICHT gerufen ist
   * hier kein Beiwerk: das Menü-Overlay ist ein React-Kind des `<Tag onClick={onEdit}>`,
   * und ein React-Synthetic-Event steigt durch den KOMPONENTEN-Baum auf — auch aus einem
   * Portal heraus. Ohne Riegel entfernte ein Klick auf „Entfernen" das Feld und öffnete
   * es im selben Zug wieder zum Bearbeiten.
   */
  it('Menü „Entfernen" ruft onRemove — und NICHT onEdit', async () => {
    const onRemove = vi.fn();
    const onEdit = vi.fn();
    renderMitProviders(
      <MetaChip feld="meldeweg" editing={false} wert="funk" onCommit={vi.fn()} onCancel={vi.fn()} onRemove={onRemove} onEdit={onEdit} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Aktionen zu Meldeweg' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Entfernen' }));
    expect(onRemove).toHaveBeenCalledWith('meldeweg');
    expect(onEdit).not.toHaveBeenCalled();
  });

  /**
   * Ein Fehlgriff darf nichts tun (Review-Nachtrag zu LFH-365). Das Menü-Overlay trägt
   * rings um seine Einträge ein 4-px-Polsterband (`dropdownEdgeChildPadding` →
   * `paddingXXS`, vom Projekt-Theme NICHT überschrieben, also in jeder Dichtestufe gleich
   * schmal). Wer im Handschuh knapp neben „Entfernen" trifft, klickt darauf.
   *
   * Gemessen war das der teuerste Fehlklick des Umbaus: das Menü schloss OHNE die Aktion
   * auszuführen (rc-dropdown ruft dort nur `setTriggerVisible(false)`), und weil das
   * Overlay ein React-Kind des Chips ist, stieg das Synthetic Event weiter zum Chip auf
   * und schaltete ihn in den Editor — der zieht per `autoFocus` den Fokus aus dem
   * Inhaltsfeld. Der Erfasser wollte ein Feld entfernen und tippt stattdessen mitten in
   * einen Editor.
   *
   * Ein Riegel am Menü-`onClick` fängt das nicht: der feuert nur für Einträge.
   */
  it('ein Klick auf die Polsterung des Menüs tut nichts', async () => {
    const onEdit = vi.fn();
    const onRemove = vi.fn();
    renderMitProviders(
      <MetaChip feld="von" editing={false} wert="ELW 1" onCommit={vi.fn()} onCancel={vi.fn()} onRemove={onRemove} onEdit={onEdit} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Aktionen zu Von' }));
    await userEvent.click(await screen.findByRole('menu'));
    expect(onEdit).not.toHaveBeenCalled();
    expect(onRemove).not.toHaveBeenCalled();
  });

  it('Menü „Bearbeiten" ruft onEdit', async () => {
    const onEdit = vi.fn();
    renderMitProviders(
      <MetaChip feld="von" editing={false} wert="ELW 1" onCommit={vi.fn()} onCancel={vi.fn()} onRemove={vi.fn()} onEdit={onEdit} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Aktionen zu Von' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Bearbeiten' }));
    expect(onEdit).toHaveBeenCalledWith('von');
  });

  /**
   * Der Maus-Schnellweg bleibt (Entscheidung in LFH-365): ein Klick auf den Chip-Rumpf
   * öffnet den Editor. Das war bisher NICHT zugesichert — `onEdit` kam in dieser Datei
   * nur als `not.toHaveBeenCalled()` vor, und `Schnellerfassung.test.tsx` übt allein den
   * Weg über das Slash-Menü. Der Test ist deshalb ein Pin auf Bestandsverhalten, kein
   * neues Verhalten: er ist sofort grün und hält den Weg fest, damit der Umbau ihn nicht
   * stillschweigend mitnimmt. Mutationsprobe: `onClick` am `Tag` entfernen → rot.
   */
  it('Klick auf den Chip-Rumpf bleibt der Schnellweg zum Bearbeiten', async () => {
    const onEdit = vi.fn();
    renderMitProviders(
      <MetaChip feld="von" editing={false} wert="ELW 1" onCommit={vi.fn()} onCancel={vi.fn()} onRemove={vi.fn()} onEdit={onEdit} />,
    );
    await userEvent.click(screen.getByText(/ELW 1/));
    expect(onEdit).toHaveBeenCalledWith('von');
  });

  it('Escape im Editor ruft onCancel', async () => {
    const onCancel = vi.fn();
    renderMitProviders(
      <MetaChip feld="von" editing wert={undefined} onCommit={vi.fn()} onCancel={onCancel} onRemove={vi.fn()} onEdit={vi.fn()} />,
    );
    await userEvent.type(screen.getByLabelText('Von'), '{Escape}');
    expect(onCancel).toHaveBeenCalledWith('von');
  });

  it('Text-Feld mit Optionen: AutoComplete, Freitext bleibt per Enter möglich', async () => {
    const onCommit = vi.fn();
    renderMitProviders(
      <MetaChip
        feld="von"
        editing
        wert={undefined}
        optionen={['Florian 1', 'RTW 1']}
        onCommit={onCommit}
        onCancel={vi.fn()}
        onRemove={vi.fn()}
        onEdit={vi.fn()}
      />,
    );
    const input = screen.getByRole('combobox', { name: 'Von' });
    await userEvent.type(input, 'Eigener Text{Enter}');
    expect(onCommit).toHaveBeenCalledWith('von', 'Eigener Text');
  });

  it('Text-Feld mit Optionen: Klick auf Vorschlag committet sofort (onSelect)', async () => {
    const onCommit = vi.fn();
    renderMitProviders(
      <MetaChip
        feld="von"
        editing
        wert={undefined}
        optionen={['Florian 1', 'RTW 1']}
        onCommit={onCommit}
        onCancel={vi.fn()}
        onRemove={vi.fn()}
        onEdit={vi.fn()}
      />,
    );
    const input = screen.getByRole('combobox', { name: 'Von' });
    await userEvent.type(input, 'Florian');
    // Der echte klickbare Eintrag ist `.ant-select-item-option` (der role="option"-Knoten
    // ist nur das a11y-Spiegelelement und reagiert nicht auf Klicks).
    const eintrag = await screen.findByText(
      (_, el) => typeof el?.className === 'string'
        && el.className.includes('ant-select-item-option-content')
        && el.textContent === 'Florian 1',
    );
    await userEvent.click(eintrag);
    expect(onCommit).toHaveBeenCalledWith('von', 'Florian 1');
  });
});
