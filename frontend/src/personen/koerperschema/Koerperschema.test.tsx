import { useMutation } from '@tanstack/react-query';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { VerletzungEingabe } from '../../api/einsatzPerson';
import type { Verletzung } from '../../api/types';
import { ApiError } from '../../api/client';
import { renderMitProviders } from '../../test/utils';
import { setzeViewportBreite } from '../../test/viewport';
import { sternTrefferPx } from './KoerperFigur';
import Koerperschema, { type KoerperschemaProps } from './Koerperschema';

/**
 * Der Baustein „Körperschema“ (LLH-1120, Spec `koerperschema`, design.md D13): lesen, markieren
 * mit zwei Tipps, aufheben am Sternchen, gesperrt mit Grund, Ablehnung am Schema, Tastatur in
 * fester Folge, vorn und hinten ab `md` nebeneinander.
 */

function verletzung(id: number, teil: Partial<Verletzung> = {}): Verletzung {
  return {
    id,
    einsatz_id: 1,
    person_id: 10,
    ansicht: 'vorn',
    region: 'unterarm_l',
    art: 'fraktur_verdacht',
    zeitpunkt_at: '2026-10-18 12:12:00',
    erfasst_at: '2026-10-18 12:12:00',
    erfasst_von: 1,
    ...teil,
  };
}

const DREI: Verletzung[] = [
  verletzung(1, { x: 0.7, y: 0.45 }),
  verletzung(2, { region: 'kopf', art: 'wunde_blutung', x: 0.5, y: 0.04 }),
  verletzung(3, { ansicht: 'hinten', region: 'ruecken', art: 'schmerz', schwere: 'mittel' }),
];

function Huelle({
  markieren,
  aufheben,
  ...props
}: Omit<KoerperschemaProps, 'markierung' | 'aufhebung'> & {
  markieren?: (e: VerletzungEingabe) => Promise<unknown>;
  aufheben?: (id: number) => Promise<unknown>;
}) {
  const markierung = useMutation({ mutationFn: markieren ?? (() => Promise.resolve()) });
  const aufhebung = useMutation({ mutationFn: aufheben ?? (() => Promise.resolve()) });
  return <Koerperschema {...props} markierung={markierung} aufhebung={aufhebung} />;
}

function zeige(props: Partial<Parameters<typeof Huelle>[0]> = {}) {
  return renderMitProviders(
    <Huelle einsatzId={1} verletzungen={DREI} geschlecht={null} modus="markieren" {...props} />,
  );
}

const schema = () => screen.getByRole('region', { name: 'Körperschema' });

describe('Körperschema — lesen', () => {
  it('zeigt Figur vorn und hinten und die nummerierte Liste, ohne jede Bedienung', () => {
    zeige({ modus: 'lesen' });
    expect(within(schema()).getByLabelText(/^Figur vorn/)).toBeInTheDocument();
    expect(within(schema()).getByLabelText(/^Figur hinten/)).toBeInTheDocument();
    expect(within(schema()).queryAllByRole('button')).toHaveLength(0);
    const liste = within(schema()).getByRole('list', { name: 'Verletzungen' });
    expect(
      within(liste)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([
      '1 Unterarm links, vorn · Fraktur-Verdacht · 181412',
      '2 Kopf, vorn · Wunde/Blutung · 181412',
      '3 Rücken, hinten · Schmerz · mittel · 181412',
    ]);
  });

  it('zeichnet je gültige Verletzung ein Sternchen mit ihrer Nummer, Aufgehobene fehlen', () => {
    zeige({
      modus: 'lesen',
      verletzungen: [
        ...DREI.slice(0, 1),
        { ...DREI[1], aufgehoben_at: '2026-10-18 12:20:00' },
        DREI[2],
      ],
    });
    const nummern = [...schema().querySelectorAll('[data-lfh="stern"]')].map((s) =>
      s.getAttribute('data-nummer'),
    );
    expect(nummern).toEqual(['1', '3']);
    expect(within(schema()).getAllByRole('listitem')).toHaveLength(2);
  });

  it('wählt die Figur nach dem Geschlecht, die Sternchen bleiben an ihrer Stelle', () => {
    const { unmount } = zeige({ modus: 'lesen', geschlecht: null });
    const lage = () =>
      schema().querySelector('[data-lfh="stern"][data-nummer="1"]')?.getAttribute('transform');
    const ohne = lage();
    expect(schema().querySelector('[data-figur]')?.getAttribute('data-figur')).toBe('neutral');
    unmount();
    zeige({ modus: 'lesen', geschlecht: 'weiblich' });
    expect(schema().querySelector('[data-figur]')?.getAttribute('data-figur')).toBe('weiblich');
    expect(lage()).toBe(ohne);
  });
});

describe('Körperschema — markieren', () => {
  it('erster Tipp auf die Region öffnet die Wahl der Art, der zweite speichert', async () => {
    const markieren = vi.fn((e: VerletzungEingabe) => {
      void e;
      return Promise.resolve();
    });
    zeige({ markieren, verletzungen: [] });
    await userEvent.click(within(schema()).getByRole('button', { name: 'Kopf, vorn' }));
    const wahl = screen.getByRole('group', { name: 'Verletzung an Kopf, vorn' });
    await userEvent.click(within(wahl).getByRole('radio', { name: 'Wunde/Blutung' }));
    await waitFor(() => expect(markieren).toHaveBeenCalledTimes(1));
    // Ohne Tippstelle (jsdom misst nicht) am Mittelpunkt der Region, normiert.
    expect(markieren.mock.calls[0][0]).toEqual({
      ansicht: 'vorn',
      region: 'kopf',
      art: 'wunde_blutung',
      x: 0.5,
      y: 18 / 440,
    });
    await waitFor(() =>
      expect(screen.queryByRole('group', { name: 'Verletzung an Kopf, vorn' })).toBeNull(),
    );
  });

  it('nimmt die Schwere optional mit, ohne Pflichttipp', async () => {
    const markieren = vi.fn((e: VerletzungEingabe) => {
      void e;
      return Promise.resolve();
    });
    zeige({ markieren, verletzungen: [] });
    await userEvent.click(within(schema()).getByRole('button', { name: 'Hand rechts, vorn' }));
    const wahl = screen.getByRole('group', { name: 'Verletzung an Hand rechts, vorn' });
    await userEvent.click(within(wahl).getByRole('radio', { name: 'schwer' }));
    expect(markieren).not.toHaveBeenCalled();
    await userEvent.click(within(wahl).getByRole('radio', { name: 'Verbrennung' }));
    await waitFor(() => expect(markieren).toHaveBeenCalledTimes(1));
    expect(markieren.mock.calls[0][0]).toMatchObject({
      region: 'hand_r',
      art: 'verbrennung',
      schwere: 'schwer',
    });
  });

  it('übernimmt die Tippstelle, wenn sie in der Figur liegt', async () => {
    const markieren = vi.fn((e: VerletzungEingabe) => {
      void e;
      return Promise.resolve();
    });
    zeige({ markieren, verletzungen: [] });
    const figur = within(schema()).getByLabelText(/^Figur vorn/);
    vi.spyOn(figur, 'getBoundingClientRect').mockReturnValue(
      DOMRect.fromRect({ x: 0, y: 0, width: 300, height: 440 }),
    );
    fireEvent.click(within(schema()).getByRole('button', { name: 'Thorax, vorn' }), {
      clientX: 140,
      clientY: 120,
      detail: 1,
    });
    const wahl = screen.getByRole('group', { name: 'Verletzung an Thorax, vorn' });
    await userEvent.click(within(wahl).getByRole('radio', { name: 'Prellung/Schwellung' }));
    await waitFor(() => expect(markieren).toHaveBeenCalledTimes(1));
    expect(markieren.mock.calls[0][0]).toMatchObject({ x: 140 / 300, y: 120 / 440 });
  });

  it('lässt eine Ablehnung am Schema stehen, die Wahl bleibt offen', async () => {
    zeige({
      verletzungen: [],
      markieren: () =>
        Promise.reject(new ApiError(422, 'Die Region ruecken gibt es in der Ansicht vorn nicht')),
    });
    await userEvent.click(within(schema()).getByRole('button', { name: 'Abdomen, vorn' }));
    const wahl = screen.getByRole('group', { name: 'Verletzung an Abdomen, vorn' });
    await userEvent.click(within(wahl).getByRole('radio', { name: 'Schmerz' }));
    expect(await within(schema()).findByText(/gibt es in der Ansicht vorn nicht/)).toBeVisible();
    expect(screen.getByRole('group', { name: 'Verletzung an Abdomen, vorn' })).toBeInTheDocument();
  });

  it('bietet am Sternchen „Aufheben“ an, der zweite Tipp hebt auf', async () => {
    const aufheben = vi.fn(() => Promise.resolve());
    zeige({ aufheben });
    await userEvent.click(
      within(schema()).getByRole('button', { name: 'Verletzung 2, Kopf, vorn · Wunde/Blutung' }),
    );
    const angebot = screen.getByRole('group', { name: 'Verletzung 2' });
    await userEvent.click(within(angebot).getByRole('button', { name: 'Aufheben' }));
    await waitFor(() => expect(aufheben).toHaveBeenCalledTimes(1));
    expect((aufheben.mock.calls[0] as unknown[])[0]).toBe(2);
  });

  it('sperrt das Markieren mit Grund', () => {
    zeige({ gesperrt: 'Markieren ohne Netz nicht möglich' });
    expect(within(schema()).queryByRole('button', { name: 'Kopf, vorn' })).toBeNull();
    expect(within(schema()).getByRole('status')).toHaveTextContent(
      'Markieren ohne Netz nicht möglich',
    );
    // Lesen bleibt: Liste und Sternchen stehen.
    expect(within(schema()).getAllByRole('listitem')).toHaveLength(3);
  });

  it('durchläuft die Regionen mit den Pfeiltasten in fester Folge', async () => {
    const user = userEvent.setup();
    zeige({ verletzungen: [] });
    const vorn = within(schema()).getByLabelText(/^Figur vorn/);
    const ziele = within(vorn).getAllByRole('button');
    // Ein Tab-Stopp je Figur (Roving-Tabindex).
    expect(ziele.filter((z) => z.getAttribute('tabindex') === '0')).toHaveLength(1);
    expect(ziele.map((z) => z.getAttribute('aria-label')).slice(0, 4)).toEqual([
      'Kopf, vorn',
      'Gesicht, vorn',
      'Hals, vorn',
      'Thorax, vorn',
    ]);
    ziele[0].focus();
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(ziele[1]);
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(document.activeElement).toBe(ziele[ziele.length - 1]);
    await user.keyboard('{Home}{Enter}');
    expect(screen.getByRole('group', { name: 'Verletzung an Kopf, vorn' })).toBeInTheDocument();
  });

  it('steht unter md als eine Figur mit Umschaltung vorn / hinten', async () => {
    setzeViewportBreite(390);
    zeige({ verletzungen: [] });
    expect(within(schema()).queryByLabelText(/^Figur hinten/)).toBeNull();
    const leiste = within(schema()).getByRole('tablist', { name: 'Ansicht' });
    await userEvent.click(within(leiste).getByRole('tab', { name: 'hinten' }));
    expect(within(schema()).getByLabelText(/^Figur hinten/)).toBeInTheDocument();
    expect(within(schema()).queryByLabelText(/^Figur vorn/)).toBeNull();
  });
});

/**
 * Befunde aus dem Review des PAT-Kerns (Change `y18v58dt-pat-kern`): Fokus nach Speichern,
 * Aufheben und Abbrechen, sichtbarer Tastaturfokus am Sternchen, Schwere je Region, sichtbares
 * Etikett der Schwere, geräumte Gründe beim Öffnen und Abbrechen.
 */
describe('Körperschema — Fokus, Schwere und Gründe', () => {
  it('gibt den Fokus nach dem Speichern an die getippte Region zurück', async () => {
    zeige({ verletzungen: [] });
    const zone = within(schema()).getByRole('button', { name: 'Kopf, vorn' });
    await userEvent.click(zone);
    const wahl = screen.getByRole('group', { name: 'Verletzung an Kopf, vorn' });
    await userEvent.click(within(wahl).getByRole('radio', { name: 'Wunde/Blutung' }));
    await waitFor(() =>
      expect(screen.queryByRole('group', { name: 'Verletzung an Kopf, vorn' })).toBeNull(),
    );
    await waitFor(() => expect(document.activeElement).toBe(zone));
  });

  it('gibt den Fokus nach „Abbrechen“ an die Region zurück', async () => {
    zeige({ verletzungen: [] });
    const zone = within(schema()).getByRole('button', { name: 'Thorax, vorn' });
    await userEvent.click(zone);
    const wahl = screen.getByRole('group', { name: 'Verletzung an Thorax, vorn' });
    await userEvent.click(within(wahl).getByRole('button', { name: 'Abbrechen' }));
    await waitFor(() => expect(document.activeElement).toBe(zone));
  });

  it('gibt den Fokus nach dem Aufheben an die Region des Sternchens zurück', async () => {
    zeige();
    await userEvent.click(
      within(schema()).getByRole('button', { name: 'Verletzung 2, Kopf, vorn · Wunde/Blutung' }),
    );
    const angebot = screen.getByRole('group', { name: 'Verletzung 2' });
    await userEvent.click(within(angebot).getByRole('button', { name: 'Aufheben' }));
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Verletzung 2' })).toBeNull());
    await waitFor(() =>
      expect(document.activeElement).toBe(
        within(schema()).getByRole('button', { name: 'Kopf, vorn' }),
      ),
    );
  });

  it('zeichnet den Tastaturfokus am Sternchen in der Bedienfarbe', () => {
    zeige();
    const stern = within(schema()).getByRole('button', {
      name: 'Verletzung 2, Kopf, vorn · Wunde/Blutung',
    });
    const rahmen = () => stern.querySelector('rect')!.getAttribute('stroke');
    expect(rahmen()).toBe('none');
    fireEvent.focus(stern);
    expect(rahmen()).not.toBe('none');
    fireEvent.blur(stern);
    expect(rahmen()).toBe('none');
  });

  it('beginnt jede Region ohne Schwere: Abbrechen und Regionswechsel nehmen sie nicht mit', async () => {
    const markieren = vi.fn((e: VerletzungEingabe) => {
      void e;
      return Promise.resolve();
    });
    zeige({ markieren, verletzungen: [] });
    await userEvent.click(within(schema()).getByRole('button', { name: 'Kopf, vorn' }));
    let wahl = screen.getByRole('group', { name: 'Verletzung an Kopf, vorn' });
    await userEvent.click(within(wahl).getByRole('radio', { name: 'schwer' }));
    await userEvent.click(within(wahl).getByRole('button', { name: 'Abbrechen' }));
    await userEvent.click(within(schema()).getByRole('button', { name: 'Thorax, vorn' }));
    wahl = screen.getByRole('group', { name: 'Verletzung an Thorax, vorn' });
    expect(within(wahl).getByRole('radio', { name: 'schwer' })).not.toBeChecked();
    await userEvent.click(within(wahl).getByRole('radio', { name: 'mittel' }));
    // Ein Tipp auf eine andere Region beginnt ebenso neu.
    await userEvent.click(within(schema()).getByRole('button', { name: 'Abdomen, vorn' }));
    wahl = screen.getByRole('group', { name: 'Verletzung an Abdomen, vorn' });
    expect(within(wahl).getByRole('radio', { name: 'mittel' })).not.toBeChecked();
    await userEvent.click(within(wahl).getByRole('radio', { name: 'Schmerz' }));
    await waitFor(() => expect(markieren).toHaveBeenCalledTimes(1));
    expect(markieren.mock.calls[0][0]).not.toHaveProperty('schwere');
  });

  it('beschriftet die Schwere sichtbar, „keine Angabe“ statt „ohne“', async () => {
    zeige({ verletzungen: [] });
    await userEvent.click(within(schema()).getByRole('button', { name: 'Kopf, vorn' }));
    const wahl = screen.getByRole('group', { name: 'Verletzung an Kopf, vorn' });
    expect(within(wahl).getByText('Schwere (optional)')).toBeVisible();
    expect(within(wahl).getByRole('radio', { name: 'keine Angabe' })).toBeChecked();
    expect(within(wahl).queryByRole('radio', { name: 'ohne' })).toBeNull();
  });

  it('räumt die Ablehnung beim Abbrechen und beim neuen Öffnen', async () => {
    const abgelehnt = () => Promise.reject(new ApiError(422, 'Person ist vermisst'));
    const { unmount } = zeige({ verletzungen: [], markieren: abgelehnt });
    await userEvent.click(within(schema()).getByRole('button', { name: 'Kopf, vorn' }));
    let wahl = screen.getByRole('group', { name: 'Verletzung an Kopf, vorn' });
    await userEvent.click(within(wahl).getByRole('radio', { name: 'Wunde/Blutung' }));
    expect(await within(schema()).findByText(/Person ist vermisst/)).toBeVisible();
    await userEvent.click(within(wahl).getByRole('button', { name: 'Abbrechen' }));
    await waitFor(() => expect(within(schema()).queryByText(/Person ist vermisst/)).toBeNull());
    unmount();

    // Dieselbe Mutation über ein Schließen hinweg (der Patientenkopf hält sie): beim Öffnen räumt
    // das Schema den Grund der letzten Ablehnung.
    function Wechsel() {
      const markierung = useMutation<unknown, Error, VerletzungEingabe>({ mutationFn: abgelehnt });
      const aufhebung = useMutation<unknown, Error, number>({
        mutationFn: () => Promise.resolve(),
      });
      const [offen, setOffen] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setOffen((o) => !o)}>
            umschalten
          </button>
          {offen && (
            <Koerperschema
              einsatzId={1}
              verletzungen={[]}
              geschlecht={null}
              modus="markieren"
              markierung={markierung}
              aufhebung={aufhebung}
            />
          )}
        </>
      );
    }
    renderMitProviders(<Wechsel />);
    await userEvent.click(within(schema()).getByRole('button', { name: 'Kopf, vorn' }));
    wahl = screen.getByRole('group', { name: 'Verletzung an Kopf, vorn' });
    await userEvent.click(within(wahl).getByRole('radio', { name: 'Wunde/Blutung' }));
    expect(await within(schema()).findByText(/Person ist vermisst/)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'umschalten' }));
    await userEvent.click(screen.getByRole('button', { name: 'umschalten' }));
    expect(within(schema()).queryByText(/Person ist vermisst/)).toBeNull();
  });
});

describe('Körperschema — Trefferfläche des Sternchens', () => {
  it('hält in jeder Stufe mindestens die Steuerhöhe, nie unter 40 px', () => {
    expect(sternTrefferPx({ controlHeight: 30 })).toBe(40);
    expect(sternTrefferPx({ controlHeight: 48 })).toBe(48);
    expect(sternTrefferPx({ controlHeight: 72 })).toBe(72);
  });
});
