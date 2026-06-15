import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../test/utils';
import NachrichtenStrom from './NachrichtenStrom';
import type { ChatNachricht } from '../api/types';

function nachricht(over: Partial<ChatNachricht> = {}): ChatNachricht {
  return {
    id: 1, einsatz_id: 7, kanal_id: 1, autor_id: 1, autor_name: 'Max',
    inhalt: 'Hallo Stab', erstellt_at: '2026-06-10 10:00:00',
    bearbeitet_at: null, geloescht_at: null, etb_eintrag_id: null, auftrag_id: null,
    bezug_typ: null, bezug_id: null, anhaenge: [], ...over,
  };
}

describe('NachrichtenStrom', () => {
  it('zeigt Inhalt und Autor', () => {
    renderMitProviders(
      <NachrichtenStrom nachrichten={[nachricht()]} eigeneBenutzerId={1} darfSchreiben
        onBearbeiten={vi.fn()} onLoeschen={vi.fn()} onHeraufstufen={vi.fn()} onHeraufstufenAuftrag={vi.fn()} />,
    );
    expect(screen.getByText('Hallo Stab')).toBeInTheDocument();
    expect(screen.getByText('Max')).toBeInTheDocument();
  });

  it('zeigt Tombstone für gelöschte Nachrichten ohne Aktionen', () => {
    renderMitProviders(
      <NachrichtenStrom nachrichten={[nachricht({ inhalt: null, geloescht_at: '2026-06-10 10:05:00' })]}
        eigeneBenutzerId={1} darfSchreiben onBearbeiten={vi.fn()} onLoeschen={vi.fn()} onHeraufstufen={vi.fn()} onHeraufstufenAuftrag={vi.fn()} />,
    );
    expect(screen.getByText('Nachricht gelöscht')).toBeInTheDocument();
    // Tombstone hat kein Aktions-Dropdown.
    expect(screen.queryByRole('button', { name: 'Aktionen' })).not.toBeInTheDocument();
  });

  it('zeigt ETB-Badge bei heraufgestufter Nachricht', () => {
    renderMitProviders(
      <NachrichtenStrom nachrichten={[nachricht({ etb_eintrag_id: 42 })]} eigeneBenutzerId={1} darfSchreiben
        onBearbeiten={vi.fn()} onLoeschen={vi.fn()} onHeraufstufen={vi.fn()} onHeraufstufenAuftrag={vi.fn()} />,
    );
    expect(screen.getByText(/heraufgestuft zu ETB/i)).toBeInTheDocument();
  });

  it('zeigt Auftrag-Badge bei zu Auftrag heraufgestufter Nachricht und blendet „Zu Auftrag" aus', async () => {
    renderMitProviders(
      <NachrichtenStrom nachrichten={[nachricht({ auftrag_id: 7 })]} eigeneBenutzerId={1} darfSchreiben
        onBearbeiten={vi.fn()} onLoeschen={vi.fn()} onHeraufstufen={vi.fn()} onHeraufstufenAuftrag={vi.fn()} />,
    );
    expect(screen.getByText(/heraufgestuft zu Auftrag/i)).toBeInTheDocument();
    // Dropdown öffnen und prüfen, dass „Zu Auftrag" fehlt.
    await userEvent.click(screen.getByRole('button', { name: 'Aktionen' }));
    expect(screen.queryByRole('menuitem', { name: 'Zu Auftrag' })).not.toBeInTheDocument();
  });

  it('blendet Bearbeiten/Löschen bei fehlendem Schreibrecht aus (eigene Nachricht)', () => {
    renderMitProviders(
      <NachrichtenStrom nachrichten={[nachricht({ autor_id: 1 })]} eigeneBenutzerId={1} darfSchreiben={false}
        onBearbeiten={vi.fn()} onLoeschen={vi.fn()} onHeraufstufen={vi.fn()} onHeraufstufenAuftrag={vi.fn()} />,
    );
    // Ohne Schreibrecht bleibt die Aktionsliste leer → kein Dropdown-Trigger.
    expect(screen.queryByRole('button', { name: 'Aktionen' })).not.toBeInTheDocument();
  });

  it('Aktionen nur an eigenen Nachrichten; Heraufstufen löst Callback aus', async () => {
    const onHeraufstufen = vi.fn();
    renderMitProviders(
      <NachrichtenStrom
        nachrichten={[nachricht({ id: 1, autor_id: 1 }), nachricht({ id: 2, autor_id: 99, inhalt: 'fremd' })]}
        eigeneBenutzerId={1} darfSchreiben
        onBearbeiten={vi.fn()} onLoeschen={vi.fn()} onHeraufstufen={onHeraufstufen} onHeraufstufenAuftrag={vi.fn()} />,
    );
    // Beide Nachrichten haben ein Dropdown (Zu ETB/Auftrag/Bezug brauchen nur darfSchreiben),
    // aber „Löschen" nur die eigene (id 1, erstes Dropdown).
    const trigger = screen.getAllByRole('button', { name: 'Aktionen' });
    expect(trigger).toHaveLength(2);
    await userEvent.click(trigger[0]);
    expect(screen.getByRole('menuitem', { name: 'Löschen' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Zu ETB' }));
    expect(onHeraufstufen).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
  });

  it('„Zu Auftrag" löst Heraufstufungs-Callback aus', async () => {
    const onHeraufstufenAuftrag = vi.fn();
    renderMitProviders(
      <NachrichtenStrom nachrichten={[nachricht({ id: 5 })]} eigeneBenutzerId={1} darfSchreiben
        onBearbeiten={vi.fn()} onLoeschen={vi.fn()} onHeraufstufen={vi.fn()} onHeraufstufenAuftrag={onHeraufstufenAuftrag} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Aktionen' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Zu Auftrag' }));
    expect(onHeraufstufenAuftrag).toHaveBeenCalledWith(expect.objectContaining({ id: 5 }));
  });

  it('„Löschen" verlangt Bestätigung via Popconfirm, bevor onLoeschen feuert', async () => {
    const onLoeschen = vi.fn();
    renderMitProviders(
      <NachrichtenStrom nachrichten={[nachricht({ id: 5, autor_id: 1 })]} eigeneBenutzerId={1} darfSchreiben
        onBearbeiten={vi.fn()} onLoeschen={onLoeschen} onHeraufstufen={vi.fn()} onHeraufstufenAuftrag={vi.fn()} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Aktionen' }));
    // Popconfirm-Trigger ist der Text im Menüeintrag (stoppt das Auto-Schließen des Menüs).
    await userEvent.click(screen.getByText('Löschen'));
    // Noch nicht gelöscht – erst die Bestätigung.
    expect(onLoeschen).not.toHaveBeenCalled();
    await userEvent.click(await screen.findByRole('button', { name: 'Ja, löschen' }));
    expect(onLoeschen).toHaveBeenCalledWith(expect.objectContaining({ id: 5 }));
  });

  it('zeigt den Sachbezug als Tag mit aufgelöstem Label', () => {
    renderMitProviders(
      <NachrichtenStrom nachrichten={[nachricht({ bezug_typ: 'schaden', bezug_id: 3 })]}
        eigeneBenutzerId={1} darfSchreiben
        bezugLabel={(typ, id) => `${typ} S-00${id}`}
        onBezugSetzen={vi.fn()} onBezugLoeschen={vi.fn()}
        onBearbeiten={vi.fn()} onLoeschen={vi.fn()} onHeraufstufen={vi.fn()} onHeraufstufenAuftrag={vi.fn()} />,
    );
    expect(screen.getByText('schaden S-003')).toBeInTheDocument();
  });

  it('zeigt keinen Bezug-Tag an gelöschten Nachrichten', () => {
    renderMitProviders(
      <NachrichtenStrom
        nachrichten={[nachricht({ inhalt: null, geloescht_at: '2026-06-10 10:05:00', bezug_typ: 'schaden', bezug_id: 3 })]}
        eigeneBenutzerId={1} darfSchreiben
        bezugLabel={() => 'S-003-Label'} onBezugSetzen={vi.fn()} onBezugLoeschen={vi.fn()}
        onBearbeiten={vi.fn()} onLoeschen={vi.fn()} onHeraufstufen={vi.fn()} onHeraufstufenAuftrag={vi.fn()} />,
    );
    expect(screen.getByText('Nachricht gelöscht')).toBeInTheDocument();
    expect(screen.queryByText('S-003-Label')).not.toBeInTheDocument();
  });

  it('„Bezug" löst onBezugSetzen aus; Label wechselt zu „Bezug ändern" wenn gesetzt', async () => {
    const onBezugSetzen = vi.fn();
    const { rerender } = renderMitProviders(
      <NachrichtenStrom nachrichten={[nachricht({ id: 9 })]} eigeneBenutzerId={1} darfSchreiben
        bezugLabel={() => 'x'} onBezugSetzen={onBezugSetzen} onBezugLoeschen={vi.fn()}
        onBearbeiten={vi.fn()} onLoeschen={vi.fn()} onHeraufstufen={vi.fn()} onHeraufstufenAuftrag={vi.fn()} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Aktionen' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Bezug' }));
    expect(onBezugSetzen).toHaveBeenCalledWith(expect.objectContaining({ id: 9 }));

    rerender(
      <NachrichtenStrom nachrichten={[nachricht({ id: 9, bezug_typ: 'meldung', bezug_id: 2 })]} eigeneBenutzerId={1} darfSchreiben
        bezugLabel={() => 'x'} onBezugSetzen={onBezugSetzen} onBezugLoeschen={vi.fn()}
        onBearbeiten={vi.fn()} onLoeschen={vi.fn()} onHeraufstufen={vi.fn()} onHeraufstufenAuftrag={vi.fn()} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Aktionen' }));
    expect(screen.getByRole('menuitem', { name: 'Bezug ändern' })).toBeInTheDocument();
  });

  it('öffnet bei Klick auf den Bezug-Tag ein Popover mit Kurzinfo', async () => {
    renderMitProviders(
      <NachrichtenStrom nachrichten={[nachricht({ bezug_typ: 'schaden', bezug_id: 3 })]}
        eigeneBenutzerId={1} darfSchreiben
        bezugLabel={() => 'S-003 · sachschaden'}
        bezugInfo={() => ({ titel: 'S-003 · sachschaden', zeilen: ['Ausmaß: gering', 'Ort: B5 km12'] })}
        onBezugSetzen={vi.fn()} onBezugLoeschen={vi.fn()}
        onBearbeiten={vi.fn()} onLoeschen={vi.fn()} onHeraufstufen={vi.fn()} onHeraufstufenAuftrag={vi.fn()} />,
    );
    await userEvent.click(screen.getByText('S-003 · sachschaden'));
    expect(await screen.findByText('Ort: B5 km12')).toBeInTheDocument();
  });

  it('Bezug-Tag ist schließbar und löst onBezugLoeschen aus', async () => {
    const onBezugLoeschen = vi.fn();
    const { container } = renderMitProviders(
      <NachrichtenStrom nachrichten={[nachricht({ id: 4, bezug_typ: 'auftrag', bezug_id: 8 })]}
        eigeneBenutzerId={1} darfSchreiben
        bezugLabel={() => 'Auftrag-Label'} onBezugSetzen={vi.fn()} onBezugLoeschen={onBezugLoeschen}
        onBearbeiten={vi.fn()} onLoeschen={vi.fn()} onHeraufstufen={vi.fn()} onHeraufstufenAuftrag={vi.fn()} />,
    );
    // antd Tag-Close ist ein Icon ohne Accessible-Name → über die antd-Klasse greifen.
    const close = container.querySelector('.ant-tag-close-icon') as HTMLElement;
    expect(close).not.toBeNull();
    await userEvent.click(close);
    expect(onBezugLoeschen).toHaveBeenCalledWith(expect.objectContaining({ id: 4 }));
  });

  it('zeigt Anhänge als Download-Link mit Dateiname, href und Größe', () => {
    const anhang = {
      id: 42, einsatz_id: 7, dateiname: 'lage.pdf', mime: 'application/pdf',
      groesse: 2048, hochgeladen_von: 1, erstellt_at: '2026-06-10 10:00:00',
    };
    renderMitProviders(
      <NachrichtenStrom nachrichten={[nachricht({ anhaenge: [anhang] })]} eigeneBenutzerId={1} darfSchreiben
        onBearbeiten={vi.fn()} onLoeschen={vi.fn()} onHeraufstufen={vi.fn()} onHeraufstufenAuftrag={vi.fn()} />,
    );
    const link = screen.getByRole('link', { name: /lage\.pdf/ });
    expect(link).toHaveAttribute('href', '/api/einsaetze/7/anhaenge/42');
    expect(screen.getByText('(2 KB)')).toBeInTheDocument();
  });
});
