import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../../test/utils';
import Werkzeugmenue, { werkzeugEintragStil, type WerkzeugmenueProps } from './Werkzeugmenue';
import { FREIE_SKIZZE_VORGABEFARBE, ZONE_TYPEN } from './zonenStil';
import { merkeZuletztVerwendet } from './zuletztVerwendet';
import { START_ZEICHEN_SPEC } from './zeichenWahl';
import { escGehoertOverlay } from './zeichnenEsc';

const SPEICHER = 'lfh:lagekarte:zeichen-zuletzt-v2';

function renderMenue(props: Partial<WerkzeugmenueProps> = {}) {
  const knopf = document.createElement('button');
  knopf.textContent = 'Zeichenwerkzeuge';
  document.body.appendChild(knopf);
  const alle: WerkzeugmenueProps = {
    id: 'werkzeugmenue-test',
    onSchliessen: vi.fn(),
    onZone: vi.fn(),
    onZeichen: vi.fn(),
    onWeitere: vi.fn(),
    zeichenLaeuft: false,
    knopf: () => knopf,
    ...props,
  };
  const r = renderMitProviders(<Werkzeugmenue {...alle} />);
  return { ...r, props: alle, knopf };
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  document.body.innerHTML = '';
});

describe('Werkzeugmenue (LLH-1038)', () => {
  it('trägt die Gruppen „Flächen und Linien“ und „Taktisches Zeichen“, kein Messen', () => {
    renderMenue();
    const menue = screen.getByRole('dialog', { name: 'Zeichenwerkzeuge' });
    expect(within(menue).getByRole('group', { name: 'Flächen und Linien' })).toBeInTheDocument();
    expect(within(menue).getByRole('group', { name: 'Taktisches Zeichen' })).toBeInTheDocument();
    expect(within(menue).queryByRole('button', { name: /Mess|Strecke|Radius/ })).toBeNull();
  });

  it('jeder Zonentyp hat seinen Eintrag, jede Flächenart „als Kreis“', () => {
    renderMenue();
    for (const t of ZONE_TYPEN) {
      expect(screen.getByRole('button', { name: t.label })).toBeInTheDocument();
      const kreis = screen.queryByRole('button', { name: `${t.label} als Kreis` });
      if (t.geometrie === 'LineString') expect(kreis).toBeNull();
      else expect(kreis).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Freie Skizze als Linie' })).toBeInTheDocument();
  });

  it('ein Eintrag startet seine Form, schließt das Menü und gibt den Fokus an den Knopf', async () => {
    const user = userEvent.setup();
    const { props, knopf } = renderMenue();
    await user.click(screen.getByRole('button', { name: 'Absperrbereich' }));
    expect(props.onZone).toHaveBeenCalledWith({ typ: 'absperrbereich', modus: 'polygon' });
    expect(props.onSchliessen).toHaveBeenCalled();
    expect(document.activeElement).toBe(knopf);
  });

  it('die freie Skizze als Linie trägt die Vorgabefarbe', async () => {
    const user = userEvent.setup();
    const { props } = renderMenue();
    await user.click(screen.getByRole('button', { name: 'Freie Skizze als Linie' }));
    expect(props.onZone).toHaveBeenCalledWith({
      typ: 'freie_skizze',
      modus: 'linie',
      farbe: FREIE_SKIZZE_VORGABEFARBE,
    });
  });

  it('der Kreis einer Flächenart startet den Kreis-Modus', async () => {
    const user = userEvent.setup();
    const { props } = renderMenue();
    await user.click(screen.getByRole('button', { name: 'Gefahrengebiet als Kreis' }));
    expect(props.onZone).toHaveBeenCalledWith({ typ: 'gefahrengebiet', modus: 'kreis' });
  });

  it('der Fokus steht beim Öffnen auf dem ersten Eintrag', () => {
    renderMenue();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Gefahrengebiet' }));
  });

  it('zuletzt verwendete Zeichen platzieren mit einem Tipp, ohne Picker', async () => {
    merkeZuletztVerwendet({ zeichen_spec: START_ZEICHEN_SPEC });
    const user = userEvent.setup();
    const { props } = renderMenue();
    const gruppe = screen.getByRole('group', { name: 'Zuletzt verwendet' });
    const kacheln = within(gruppe).getAllByRole('button');
    expect(kacheln).toHaveLength(1);
    await user.click(kacheln[0]);
    expect(props.onZeichen).toHaveBeenCalledWith({ zeichen_spec: expect.any(String) });
    expect(props.onSchliessen).toHaveBeenCalled();
  });

  it('ohne zuletzt verwendete Zeichen bleibt „Weitere …“', () => {
    renderMenue();
    expect(screen.queryByRole('group', { name: 'Zuletzt verwendet' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Weitere …' })).toBeInTheDocument();
  });

  it('kaputter Speicher: keine Kacheln, kein Fehler', () => {
    localStorage.setItem(SPEICHER, '{kaputt');
    renderMenue();
    expect(screen.queryByRole('group', { name: 'Zuletzt verwendet' })).toBeNull();
  });

  it('„Weitere …“ schließt das Menü und öffnet den Picker', async () => {
    const user = userEvent.setup();
    const { props } = renderMenue();
    await user.click(screen.getByRole('button', { name: 'Weitere …' }));
    expect(props.onSchliessen).toHaveBeenCalled();
    expect(props.onWeitere).toHaveBeenCalledWith('maus');
  });

  it('„Weitere …“ per Finger: der Picker fokussiert das Suchfeld nicht', () => {
    const { props } = renderMenue();
    const weitere = screen.getByRole('button', { name: 'Weitere …' });
    fireEvent.pointerDown(weitere, { pointerType: 'touch' });
    fireEvent.click(weitere);
    expect(props.onWeitere).toHaveBeenCalledWith('touch');
  });

  it('ein laufendes Zeichen: die Gruppe zeigt nur den Zustand', () => {
    merkeZuletztVerwendet({ zeichen_spec: START_ZEICHEN_SPEC });
    renderMenue({ zeichenLaeuft: true });
    const gruppe = screen.getByRole('group', { name: 'Taktisches Zeichen' });
    expect(within(gruppe).getByText('wird platziert')).toBeInTheDocument();
    expect(within(gruppe).queryAllByRole('button')).toHaveLength(0);
  });

  it('Esc schließt das Menü, nimmt die Taste und gibt den Fokus an den Knopf', () => {
    const { props, knopf } = renderMenue();
    const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    window.dispatchEvent(e);
    expect(props.onSchliessen).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(knopf);
  });

  it('solange es offen ist, gehört Esc dem Menü (escGehoertOverlay)', () => {
    renderMenue();
    expect(escGehoertOverlay(new KeyboardEvent('keydown', { key: 'Escape' }))).toBe(true);
  });

  it('ein Druck außerhalb schließt es, der Knopf selbst nicht', () => {
    const { props, knopf } = renderMenue();
    fireEvent.pointerDown(knopf);
    expect(props.onSchliessen).not.toHaveBeenCalled();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Sperrgebiet' }));
    expect(props.onSchliessen).not.toHaveBeenCalled();
    fireEvent.pointerDown(document.body);
    expect(props.onSchliessen).toHaveBeenCalledTimes(1);
  });
});

describe('werkzeugEintragStil', () => {
  const token = (controlHeight: number) => ({ controlHeight });
  it('hält die Steuerhöhe jeder Dichtestufe als Boden (30 / 48 / 72)', () => {
    for (const h of [30, 48, 72]) {
      expect(werkzeugEintragStil(token(h)).minHeight).toBeGreaterThanOrEqual(h);
    }
  });
});
