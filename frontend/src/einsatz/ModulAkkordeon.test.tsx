import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../test/utils';
import ModulAkkordeon from './ModulAkkordeon';
import { kategorien } from './modulRegistry';
import type { BenutzerAnzeige, ModulOverrides } from '../api/types';

const ohne: BenutzerAnzeige = {
  id: 1,
  anzeigename: 'E',
  benutzername: 'e',
  system_rolle: 'keiner',
  org_rolle: 'keine',
  aktiv: true,
  erstellt_at: '2026-05-23 10:00:00',
  totp_aktiviert: false,
};

const ueberschreibung = (
  modulKey: string,
  sichtbar: boolean,
  benoetigteRolle: 'admin' | 'fuehrungskraft' | null = null,
): ModulOverrides => ({
  [modulKey]: {
    einsatz_id: 7,
    modul_key: modulKey,
    sichtbar,
    benoetigte_rolle: benoetigteRolle,
    geaendert_at: null,
    geaendert_von: null,
  },
});

function zeige(props: Partial<React.ComponentProps<typeof ModulAkkordeon>> = {}) {
  return renderMitProviders(
    <ModulAkkordeon
      kategorien={kategorien}
      offeneKategorie="erfassung"
      aktiverModulKey="etb"
      benutzer={ohne}
      onKategorieKlick={() => {}}
      onModulKlick={() => {}}
      {...props}
    />,
  );
}

describe('ModulAkkordeon', () => {
  it('reicht Navigationszähler an die gemeinsame Modulliste durch', async () => {
    zeige({
      offeneKategorie: 'kommunikation',
      zaehler: { chat: { wert: 3, beschreibung: '3 ungelesene Chat-Nachrichten' } },
    });
    expect(
      screen.getByRole('button', { name: 'Chat, 3 ungelesene Chat-Nachrichten' }),
    ).toBeInTheDocument();
  });

  it('listet Kategorie-Kopfzeilen mit aria-expanded und nur unter der offenen die Module', () => {
    zeige();
    // Genau EINE Navigation, und sie heißt NICHT „Kategorien" — sonst wird
    // `getByRole('navigation', { name: 'Kategorien' })` mehrdeutig, sobald
    // Rail und Akkordeon in einem Zwischenzustand gleichzeitig im Baum stehen.
    expect(screen.getByRole('navigation', { name: 'Einsatz-Navigation' })).toBeInTheDocument();
    expect(screen.getAllByRole('navigation')).toHaveLength(1);

    // Je Kategorie eine Kopfzeile, genau eine davon aufgeklappt.
    const kopfzeilen = kategorien.map((k) => screen.getByRole('button', { name: k.label }));
    expect(kopfzeilen).toHaveLength(kategorien.length);
    expect(screen.getAllByRole('button', { expanded: true })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Erfassung' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );

    // Module stehen nur unter der offenen Kategorie.
    expect(screen.getByRole('button', { name: 'ETB' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Lagekarte' })).not.toBeInTheDocument();
  });

  it('meldet den Klick auf eine Kopfzeile mit ihrem Kategorie-Schlüssel', async () => {
    const onKategorieKlick = vi.fn();
    zeige({ onKategorieKlick });
    await userEvent.click(screen.getByRole('button', { name: 'Lage' }));
    expect(onKategorieKlick).toHaveBeenCalledWith('lage');
  });

  it('meldet den Klick auf ein Modul mit dem Registry-Eintrag', async () => {
    const onModulKlick = vi.fn();
    zeige({ onModulKlick });
    await userEvent.click(screen.getByRole('button', { name: 'Personen' }));
    expect(onModulKlick).toHaveBeenCalledWith(expect.objectContaining({ key: 'personen' }));
  });

  it('zeigt ohne offene Kategorie nur die Kopfzeilen', () => {
    zeige({ offeneKategorie: null });
    expect(screen.queryAllByRole('button', { expanded: true })).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'ETB' })).not.toBeInTheDocument();
  });

  it('reicht Sperre und Ausblendung der Modulliste durch (LFH-132)', () => {
    zeige({
      overrides: {
        ...ueberschreibung('etb', true, 'fuehrungskraft'),
        ...ueberschreibung('tiere', false),
      },
    });
    expect(screen.getByRole('button', { name: 'ETB' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Tiere' })).not.toBeInTheDocument();
  });

  it('hält die Trefffläche der Kopfzeilen auf dem A1-Maß', () => {
    // A1 Festlegung 4: 48 px ist die Untergrenze einer Trefffläche. Der
    // Drawer ist der Berührungsfall — hier darf sie nicht unterschritten werden.
    zeige();
    for (const k of kategorien) {
      const knopf = screen.getByRole('button', { name: k.label });
      expect(knopf.style.minHeight, k.label).toBe('48px');
    }
  });

  it('bleibt in der Breite fluide — der Drawer gibt sie vor, nicht das Akkordeon', () => {
    // Eine feste Pixelbreite hier machte den Drawer-Token wirkungslos und
    // erzeugte auf dem Handschirm einen waagerechten Überlauf.
    const nav = zeige().container.querySelector('nav')!;
    expect(['', '100%']).toContain(nav.style.width);
  });
});
