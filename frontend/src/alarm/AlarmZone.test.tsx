import { act, render, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RAHMEN_EBENE } from '../components/rahmenOben';
import { setzeViewportBreite, VIEWPORT_STANDARD } from '../test/viewport';
import AlarmZone from './AlarmZone';
import { zoneSetzen, type ZonenEintrag } from './alarmZoneSpeicher';

/** Spec `benachrichtigungen`, „Alarmzone verdeckt nichts“, „Gemeinsames Budget und Bündelung“. */

const BESITZER = Symbol('test');

function eintrag(schluessel: string, extra: Partial<ZonenEintrag> = {}): ZonenEintrag {
  return {
    schluessel,
    stufe: 'alarm',
    titel: 'Auftrag überfällig',
    beschreibung: 'Auftrag #12 an S2 · 1912',
    name: 'Auftrag überfällig',
    oeffnen: vi.fn(),
    gelesen: vi.fn(),
    ausblenden: vi.fn(),
    ...extra,
  };
}

function setze(...eintraege: ZonenEintrag[]) {
  act(() => zoneSetzen(BESITZER, eintraege));
}

function zone(): HTMLElement {
  const el = document.querySelector<HTMLElement>('[data-lfh="alarmzone"]');
  if (!el) throw new Error('keine Alarmzone');
  return el;
}

afterEach(() => setzeViewportBreite(VIEWPORT_STANDARD));

describe('AlarmZone (LLH-1735)', () => {
  it('Ruhe: ohne Eintrag steht keine Zone', () => {
    render(<AlarmZone />);
    expect(document.querySelector('[data-lfh="alarmzone"]')).toBeNull();
  });

  it('ein Alarm ist eine Zeile mit Wort, Titel, Gegenstand, „Öffnen“, „Gelesen“ und ✕', async () => {
    const e = eintrag('b-40');
    render(<AlarmZone />);
    setze(e);
    const z = zone();
    expect(within(z).getByText('ALARM')).toBeInTheDocument();
    expect(within(z).getByText('Auftrag überfällig')).toBeInTheDocument();
    expect(within(z).getByText('Auftrag #12 an S2 · 1912')).toBeInTheDocument();
    await userEvent.click(within(z).getByRole('button', { name: 'Öffnen' }));
    expect(e.oeffnen).toHaveBeenCalledOnce();
    await userEvent.click(within(z).getByRole('button', { name: 'Gelesen' }));
    expect(e.gelesen).toHaveBeenCalledOnce();
    await userEvent.click(
      within(z).getByRole('button', { name: 'Ausblenden, ohne zu quittieren' }),
    );
    expect(e.ausblenden).toHaveBeenCalledOnce();
  });

  it('klebt im Rahmen unter Drawer und Dialogen', () => {
    render(<AlarmZone />);
    setze(eintrag('b-40'));
    expect(zone().style.position).toBe('sticky');
    expect(Number(zone().style.zIndex)).toBe(RAHMEN_EBENE);
  });

  it('ein Hinweis der Organisation heißt „HINWEIS“', () => {
    render(<AlarmZone />);
    setze(eintrag('b-41', { stufe: 'hinweis', titel: 'Neuer Einsatz', name: 'Neuer Einsatz' }));
    expect(within(zone()).getByText('HINWEIS')).toBeInTheDocument();
  });

  it('Unwetter: kein „Gelesen“, wo keine Benachrichtigung dahinter steht', () => {
    render(<AlarmZone />);
    setze(eintrag('unwetter-x-1', { titel: 'Unwetterwarnung', gelesen: undefined }));
    expect(within(zone()).queryByRole('button', { name: 'Gelesen' })).toBeNull();
    expect(within(zone()).getByRole('button', { name: 'Öffnen' })).toBeInTheDocument();
  });

  it('ab zwei gebündelt: zu der jüngste mit „+ n weitere“, auf Kopfzeile mit Zahl und Arten', async () => {
    const a = eintrag('b-1');
    const b = eintrag('b-2', { beschreibung: 'Auftrag #11 an Florian 3' });
    const c = eintrag('b-3', {
      titel: 'Bestätigung ausstehend · RTW 2',
      name: 'Bestätigung ausstehend',
      beschreibung: 'Patient ansprechbar',
    });
    render(<AlarmZone />);
    setze(a, b, c);
    const z = zone();
    // Zu: nur der jüngste steht, mit seinen Knöpfen.
    expect(within(z).getByText('Bestätigung ausstehend · RTW 2')).toBeInTheDocument();
    expect(within(z).queryByText('Auftrag #11 an Florian 3')).toBeNull();
    expect(within(z).getAllByRole('button', { name: 'Gelesen' })).toHaveLength(1);
    await userEvent.click(within(z).getByRole('button', { name: '+ 2 weitere' }));
    // Auf: Kopfzeile, je Art die Zahl, darunter je Eintrag eine Zeile.
    expect(within(zone()).getByText('3 Alarme')).toBeInTheDocument();
    expect(
      within(zone()).getByText('2 × Auftrag überfällig · 1 × Bestätigung ausstehend'),
    ).toBeInTheDocument();
    const zeilen = zone().querySelectorAll('[data-lfh="alarm-eintrag"]');
    expect(zeilen).toHaveLength(3);
    // „Gelesen“ an einer Zeile quittiert nur diese.
    await userEvent.click(
      within(zeilen[1] as HTMLElement).getByRole('button', { name: 'Gelesen' }),
    );
    expect(b.gelesen).toHaveBeenCalledOnce();
    expect(a.gelesen).not.toHaveBeenCalled();
    expect(c.gelesen).not.toHaveBeenCalled();
    await userEvent.click(within(zone()).getByRole('button', { name: 'Zuklappen' }));
    expect(zone().querySelectorAll('[data-lfh="alarm-eintrag"]')).toHaveLength(1);
  });

  it('✕ an der gebündelten Kopfzeile blendet alle aus, ohne zu quittieren', async () => {
    const a = eintrag('b-1');
    const b = eintrag('b-2');
    render(<AlarmZone />);
    setze(a, b);
    await userEvent.click(within(zone()).getByRole('button', { name: '+ 1 weitere' }));
    await userEvent.click(
      within(zone()).getByRole('button', { name: 'Alle ausblenden, ohne zu quittieren' }),
    );
    expect(a.ausblenden).toHaveBeenCalledOnce();
    expect(b.ausblenden).toHaveBeenCalledOnce();
    expect(a.gelesen).not.toHaveBeenCalled();
  });

  it('nurAbMd: unter md trägt die Leiste am Handschirm die Alarme, die Zone steht nicht', () => {
    setzeViewportBreite(390);
    render(<AlarmZone nurAbMd />);
    setze(eintrag('b-40'));
    expect(document.querySelector('[data-lfh="alarmzone"]')).toBeNull();
  });

  it('ohne nurAbMd steht sie auch am Handschirm (Org-Rahmen)', () => {
    setzeViewportBreite(390);
    render(<AlarmZone />);
    setze(eintrag('b-40'));
    expect(zone()).toBeInTheDocument();
  });
});
