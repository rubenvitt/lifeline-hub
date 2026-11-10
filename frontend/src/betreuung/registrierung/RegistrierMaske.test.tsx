import { describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RegistrierungEingabe } from '../../api/types';
import { renderMitProviders } from '../../test/utils';
import { setzeViewportBreite } from '../../test/viewport';
import { verschachtelteZiele } from '../../test/verschachtelteZiele';
import RegistrierMaske from './RegistrierMaske';

/**
 * Maske „Registrieren“ (LLH-1612, Spec `betreuung-registrierung`, „Registrieren in der
 * Oberfläche“, design.md D8): kompakt durch Aufteilung, nichts eingeklappt.
 */

const TURNHALLE = { id: 8, bezeichnung: 'Turnhalle Ost' };

function rendere(props: Partial<Parameters<typeof RegistrierMaske>[0]> = {}) {
  const onErfassen = vi.fn<(body: RegistrierungEingabe) => Promise<unknown>>(() =>
    Promise.resolve({}),
  );
  const onSchliessen = vi.fn();
  renderMitProviders(
    <RegistrierMaske
      stelle={TURNHALLE}
      laeuft={false}
      onErfassen={onErfassen}
      onSchliessen={onSchliessen}
      {...props}
    />,
  );
  const dialog = screen.getByRole('dialog', { name: /Registrieren/ });
  return { onErfassen, onSchliessen, dialog };
}

const feld = (dialog: HTMLElement, name: string) => within(dialog).getByRole('textbox', { name });

describe('RegistrierMaske — Haushaltsangaben einmal', () => {
  it('Adresse „Lindenweg 3“ oben: jede der drei Personen trägt sie', async () => {
    const user = userEvent.setup();
    const { dialog, onErfassen } = rendere();
    await user.type(feld(dialog, 'Herkunft / Adresse des Haushalts'), 'Lindenweg 3');
    await user.type(feld(dialog, 'Nachname Person 1'), 'Weber');
    await user.click(within(dialog).getByRole('button', { name: 'Person hinzufügen' }));
    await user.click(within(dialog).getByRole('button', { name: 'Person hinzufügen' }));
    await user.click(within(dialog).getByRole('button', { name: 'Registrieren' }));

    await waitFor(() => expect(onErfassen).toHaveBeenCalledTimes(1));
    const body = onErfassen.mock.calls[0][0];
    expect(body.personen).toHaveLength(3);
    for (const p of body.personen) {
      expect(p).toMatchObject({
        name: 'Weber',
        herkunft_adresse: 'Lindenweg 3',
        kostform: 'normal',
      });
    }
    expect(body).not.toHaveProperty('haushalt_id');
  });
});

describe('RegistrierMaske — zweite Person übernimmt den Nachnamen', () => {
  it('„Person hinzufügen“ belegt den Nachnamen vor und setzt den Fokus in den Vornamen', async () => {
    const user = userEvent.setup();
    const { dialog } = rendere();
    await user.type(feld(dialog, 'Nachname Person 1'), 'Weber');
    await user.type(feld(dialog, 'Vorname Person 1'), 'Anna');
    await user.click(within(dialog).getByRole('button', { name: 'Person hinzufügen' }));

    expect(feld(dialog, 'Nachname Person 2')).toHaveValue('Weber');
    await waitFor(() => expect(feld(dialog, 'Vorname Person 2')).toHaveFocus());
    // Überschreibbar.
    await user.clear(feld(dialog, 'Nachname Person 2'));
    await user.type(feld(dialog, 'Nachname Person 2'), 'Weber-Lang');
    expect(feld(dialog, 'Nachname Person 2')).toHaveValue('Weber-Lang');
  });

  it('„Entfernen“ nimmt die Zeile weg und setzt den Fokus auf die vorige', async () => {
    const user = userEvent.setup();
    const { dialog } = rendere();
    await user.type(feld(dialog, 'Nachname Person 1'), 'Weber');
    await user.click(within(dialog).getByRole('button', { name: 'Person hinzufügen' }));
    await user.click(within(dialog).getByRole('button', { name: 'Person 2 entfernen' }));

    expect(within(dialog).queryByRole('textbox', { name: 'Nachname Person 2' })).toBeNull();
    await waitFor(() => expect(feld(dialog, 'Nachname Person 1')).toHaveFocus());
    // Die einzige Person lässt sich nicht entfernen.
    expect(within(dialog).queryByRole('button', { name: /entfernen/ })).toBeNull();
  });
});

describe('RegistrierMaske — nichts eingeklappt', () => {
  it('alle Felder sichtbar und per Tabulator Haushalt, dann Person für Person', async () => {
    const user = userEvent.setup();
    const { dialog } = rendere();
    await user.type(feld(dialog, 'Nachname Person 1'), 'Weber');
    await user.click(within(dialog).getByRole('button', { name: 'Person hinzufügen' }));

    // Kein Klappteil, kein Menü, kein zweiter Schritt.
    expect(dialog.querySelector('.ant-collapse, [aria-expanded]')).toBeNull();

    const folge = [
      feld(dialog, 'Herkunft / Adresse des Haushalts'),
      feld(dialog, 'Kontakt des Haushalts'),
    ];
    for (const n of [1, 2]) {
      folge.push(
        feld(dialog, `Nachname Person ${n}`),
        feld(dialog, `Vorname Person ${n}`),
        feld(dialog, `Geburtsdatum Person ${n}`),
        // Die Gruppen sind je EIN Tabulatorhalt (roving tabindex): das erste bzw. gewählte Segment.
        within(
          within(dialog).getByRole('radiogroup', { name: `Geschlecht, Person ${n}` }),
        ).getByRole('radio', { name: 'männlich' }),
        within(within(dialog).getByRole('radiogroup', { name: `Kostform, Person ${n}` })).getByRole(
          'radio',
          { name: 'Normalkost' },
        ),
        feld(dialog, `Unverträglichkeiten Person ${n}`),
        within(dialog).getByRole('button', { name: `Person ${n} entfernen` }),
      );
    }
    folge[0].focus();
    for (const ziel of folge.slice(1)) {
      await user.tab();
      expect(ziel).toHaveFocus();
    }
  });

  it('jedes Feld trägt eine sichtbare Beschriftung, auch im Raster (Spaltenkopf)', () => {
    const { dialog } = rendere();
    const kopf = dialog.querySelector('[data-lfh="registrier-kopf"]');
    expect(kopf).not.toBeNull();
    for (const wort of [
      'Nachname',
      'Vorname',
      'Geburtsdatum',
      'Geschlecht',
      'Kostform',
      'Unverträglichkeiten',
    ]) {
      // Text im Kopf, kein `aria-hidden`: in jsdom steht der Dialog noch in seiner Einblendung
      // (Deckkraft 0), `toBeVisible` sagte dort nichts über das Layout.
      expect(within(kopf as HTMLElement).getByText(wort)).not.toHaveAttribute('aria-hidden');
    }
    expect(verschachtelteZiele(dialog)).toEqual([]);
  });

  it('schmal (390 px): Block je Person mit Beschriftung am Feld, kein Spaltenkopf', () => {
    setzeViewportBreite(390);
    const { dialog } = rendere();
    expect(dialog.querySelector('[data-lfh="registrier-kopf"]')).toBeNull();
    const block = within(dialog).getByRole('group', { name: 'Person 1' });
    expect(within(block).getByText('Nachname')).toBeInTheDocument();
    expect(feld(dialog, 'Nachname Person 1')).toBeInTheDocument();
    expect(verschachtelteZiele(dialog)).toEqual([]);
  });
});

describe('RegistrierMaske — Kostform', () => {
  it('Normalkost vorgewählt, Kurzwort auf der Fläche, volles Wort im Namen, Pfeiltasten wählen', async () => {
    const user = userEvent.setup();
    const { dialog, onErfassen } = rendere();
    const gruppe = within(dialog).getByRole('radiogroup', { name: 'Kostform, Person 1' });
    const normal = within(gruppe).getByRole('radio', { name: 'Normalkost' });
    expect(normal).toHaveAttribute('aria-checked', 'true');
    const veg = within(gruppe).getByRole('radio', { name: 'vegetarisch' });
    expect(veg).toHaveTextContent('Veg.');

    normal.focus();
    await user.keyboard('{ArrowRight}');
    expect(veg).toHaveFocus();
    await user.keyboard(' ');
    expect(veg).toHaveAttribute('aria-checked', 'true');

    await user.type(feld(dialog, 'Nachname Person 1'), 'Weber');
    await user.click(within(dialog).getByRole('button', { name: 'Registrieren' }));
    await waitFor(() => expect(onErfassen).toHaveBeenCalled());
    expect(onErfassen.mock.calls[0][0].personen[0].kostform).toBe('vegetarisch');
  });

  it('Unverträglichkeit bei Normalkost: Hinweis „Diät/allergenarm wählen?“ wählt auf Tipp', async () => {
    const user = userEvent.setup();
    const { dialog } = rendere();
    expect(within(dialog).queryByRole('button', { name: 'Diät/allergenarm wählen?' })).toBeNull();
    await user.type(feld(dialog, 'Unverträglichkeiten Person 1'), 'Erdnüsse');
    await user.click(within(dialog).getByRole('button', { name: 'Diät/allergenarm wählen?' }));
    expect(
      within(within(dialog).getByRole('radiogroup', { name: 'Kostform, Person 1' })).getByRole(
        'radio',
        { name: 'Diät/allergenarm' },
      ),
    ).toHaveAttribute('aria-checked', 'true');
    expect(within(dialog).queryByRole('button', { name: 'Diät/allergenarm wählen?' })).toBeNull();
  });
});

describe('RegistrierMaske — Prüfungen und Abschluss', () => {
  it('ohne Nachname: Grund am Feld, per aria-describedby verknüpft, nichts gesendet', async () => {
    const user = userEvent.setup();
    const { dialog, onErfassen } = rendere();
    await user.click(within(dialog).getByRole('button', { name: 'Registrieren' }));
    const nachname = feld(dialog, 'Nachname Person 1');
    // Ungültig-Marke und Fehlerzeile erscheinen nicht im selben Takt: beides in EINEM waitFor.
    await waitFor(() => {
      expect(nachname).toHaveAttribute('aria-invalid', 'true');
      const ids = (nachname.getAttribute('aria-describedby') ?? '').split(' ');
      const grund = ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
      expect(grund).toContain('Nachname fehlt');
    });
    expect(onErfassen).not.toHaveBeenCalled();
  });

  it('ein unlesbares Geburtsdatum steht als Grund am Feld', async () => {
    const user = userEvent.setup();
    const { dialog, onErfassen } = rendere();
    await user.type(feld(dialog, 'Nachname Person 1'), 'Weber');
    await user.type(feld(dialog, 'Geburtsdatum Person 1'), '31.02.1990');
    await user.click(within(dialog).getByRole('button', { name: 'Registrieren' }));
    await waitFor(() =>
      expect(feld(dialog, 'Geburtsdatum Person 1')).toHaveAttribute('aria-invalid', 'true'),
    );
    expect(onErfassen).not.toHaveBeenCalled();
  });

  it('Geschlecht als Segment m · w · d · ?, mit vollem Wort im Namen', async () => {
    const user = userEvent.setup();
    const { dialog, onErfassen } = rendere();
    const gruppe = within(dialog).getByRole('radiogroup', { name: 'Geschlecht, Person 1' });
    expect(
      within(gruppe)
        .getAllByRole('radio')
        .map((r) => r.textContent),
    ).toEqual(['m', 'w', 'd', '?']);
    await user.click(within(gruppe).getByRole('radio', { name: 'weiblich' }));
    await user.type(feld(dialog, 'Nachname Person 1'), 'Weber');
    await user.click(within(dialog).getByRole('button', { name: 'Registrieren' }));
    await waitFor(() => expect(onErfassen).toHaveBeenCalled());
    expect(onErfassen.mock.calls[0][0].personen[0].geschlecht).toBe('weiblich');
  });

  it('„Speichern und nächste“: danach leer für den nächsten Haushalt, eine Zeile, Normalkost', async () => {
    const user = userEvent.setup();
    const { dialog, onErfassen, onSchliessen } = rendere();
    await user.type(feld(dialog, 'Herkunft / Adresse des Haushalts'), 'Lindenweg 3');
    await user.type(feld(dialog, 'Nachname Person 1'), 'Weber');
    await user.click(within(dialog).getByRole('button', { name: 'Person hinzufügen' }));
    await user.click(within(dialog).getByRole('button', { name: /Speichern und nächste/ }));

    await waitFor(() => expect(onErfassen).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(feld(dialog, 'Nachname Person 1')).toHaveValue(''));
    expect(feld(dialog, 'Herkunft / Adresse des Haushalts')).toHaveValue('');
    expect(within(dialog).queryByRole('textbox', { name: 'Nachname Person 2' })).toBeNull();
    expect(onSchliessen).not.toHaveBeenCalled();
  });

  it('Anhängen an einen Haushalt: Titel nennt ihn, Body trägt haushalt_id, Nachname vorbelegt', async () => {
    const user = userEvent.setup();
    const onErfassen = vi.fn(() => Promise.resolve({}));
    renderMitProviders(
      <RegistrierMaske
        stelle={TURNHALLE}
        haushalt={{ id: 12, nummer: 1, nachname: 'Weber' }}
        laeuft={false}
        onErfassen={onErfassen}
        onSchliessen={() => {}}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: /H-1/ });
    expect(feld(dialog, 'Nachname Person 1')).toHaveValue('Weber');
    await user.type(feld(dialog, 'Vorname Person 1'), 'Max');
    await act(async () => {
      await user.click(within(dialog).getByRole('button', { name: 'Registrieren' }));
    });
    await waitFor(() => expect(onErfassen).toHaveBeenCalled());
    expect(onErfassen).toHaveBeenCalledWith({
      haushalt_id: 12,
      personen: [{ name: 'Weber', vorname: 'Max', kostform: 'normal' }],
    });
  });
});
