import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../test/utils';
import ModulAkkordeon, { akkordeonKopfStil } from './ModulAkkordeon';
import { kategorien } from './modulRegistry';
import { freigabenFixture } from '../test/fixtures';
import { dichten, farbenDunkel } from '../theme/tokens';

function zeige(props: Partial<React.ComponentProps<typeof ModulAkkordeon>> = {}) {
  return renderMitProviders(
    <ModulAkkordeon
      kategorien={kategorien}
      offeneKategorie="erfassung"
      aktiverModulKey="etb"
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

  it('reicht Sperre und Ausblendung der Modulliste durch (LFH-132/LFH-669)', () => {
    zeige({
      freigaben: freigabenFixture({
        etb: { zugriff: false },
        tiere: { sichtbar: false, zugriff: false },
      }),
    });
    expect(screen.getByRole('button', { name: 'ETB' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Tiere' })).not.toBeInTheDocument();
  });

  it('bleibt in der Breite fluide — der Drawer gibt sie vor, nicht das Akkordeon', () => {
    // Eine feste Pixelbreite hier machte den Drawer-Token wirkungslos und
    // erzeugte auf dem Handschirm einen waagerechten Überlauf.
    const nav = zeige().container.querySelector('nav')!;
    expect(['', '100%']).toContain(nav.style.width);
  });
});

/**
 * Die Kopfzeile OHNE zu rendern (LFH-537): `test/utils.tsx` montiert ein nacktes
 * `ConfigProvider`, `useToken()` liefert dort den antd-Seed (`controlHeight: 32`). Ein Test am
 * gerenderten Knopf sähe deshalb 48 — mit `Math.max` wie mit einer festen 48 — und belegte die
 * Staffel nicht. Bauform wie `IconRail.test.tsx`; die Böden stehen als LITERALE da, sonst
 * prüfte der Test den Token gegen sich selbst.
 */
describe('ModulAkkordeon · Dichte der Kopfzeile', () => {
  const tokenFuer = (s: keyof typeof dichten) => ({
    controlHeight: dichten[s].zeilenhoehe,
    padding: dichten[s].abstand.md,
    marginSM: dichten[s].abstand.sm,
  });
  const hoehe = (s: keyof typeof dichten) =>
    akkordeonKopfStil(tokenFuer(s), farbenDunkel, { offen: false }).minHeight;

  it('hält den A1-Boden von 48 px und wächst in `handschuh` auf 72', () => {
    // `Math.max`, nicht `??`: mit `??` stände in `kompakt` 30, mit fester 48 in `handschuh` 48.
    // Der Drawer ist der Berührungsfall — genau dort darf die Handschuh-Stufe nicht fehlen.
    expect(hoehe('kompakt')).toBe(48);
    expect(hoehe('komfortabel')).toBe(48);
    expect(hoehe('handschuh')).toBe(72);
  });

  it('trägt ZWEI Angaben, nicht eine (LFH-365)', () => {
    // Konkreter Wert als LITERAL: waagerecht `padding` der Stufe (26 in `handschuh`).
    const stil = akkordeonKopfStil(tokenFuer('handschuh'), farbenDunkel, { offen: false });
    expect(stil.minHeight).toBe(72);
    expect(stil.padding).toBe('0 26px');
  });

  it('zeigt die offene Kategorie mit Fläche und Ortsmarke, die geschlossene gedämpft', () => {
    const offen = akkordeonKopfStil(tokenFuer('kompakt'), farbenDunkel, { offen: true });
    const zu = akkordeonKopfStil(tokenFuer('kompakt'), farbenDunkel, { offen: false });
    expect(offen.background).toBe(farbenDunkel.flaeche3);
    expect(offen.boxShadow).toBe(`inset 2px 0 0 ${farbenDunkel.marke}`);
    expect(offen.color).toBe(farbenDunkel.text);
    expect(zu.background).toBe('transparent');
    expect(zu.boxShadow).toBe('none');
    expect(zu.color).toBe(farbenDunkel.gedaempft);
  });
});
