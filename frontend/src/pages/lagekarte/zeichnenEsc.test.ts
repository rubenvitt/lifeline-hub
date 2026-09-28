import { afterEach, describe, expect, it } from 'vitest';
import { escGehoertOverlay, escStufe, type EscLage } from './zeichnenEsc';

const basis: EscLage = {
  phase: 'zeichnen',
  speichernLaeuft: false,
  punkte: 0,
  serieGespeichert: 0,
};

describe('escStufe (LFH-712)', () => {
  it('Zeichenphase mit Punkten: Figur verwerfen, Modus bleibt', () => {
    expect(escStufe({ ...basis, punkte: 3 })).toBe('verwerfen');
    expect(escStufe({ ...basis, punkte: 1 })).toBe('verwerfen');
  });

  it('Zeichenphase ohne Punkte: Modus beenden', () => {
    expect(escStufe(basis)).toBe('abbrechen');
  });

  it('ohne Punkte in einer Serie mit Gespeichertem: wie „Fertig"', () => {
    expect(escStufe({ ...basis, serieGespeichert: 2 })).toBe('fertig');
  });

  it('Bestätigungsphase: zurück ins Zeichnen, unabhängig vom Punktstand', () => {
    expect(escStufe({ ...basis, phase: 'bestaetigen', punkte: 0 })).toBe('zurueckZumZeichnen');
    expect(escStufe({ ...basis, phase: 'bestaetigen', punkte: 4, serieGespeichert: 1 })).toBe(
      'zurueckZumZeichnen',
    );
  });

  it('solange gespeichert wird, tut Esc nichts — in jeder Phase', () => {
    expect(escStufe({ ...basis, speichernLaeuft: true, phase: 'bestaetigen' })).toBe('nichts');
    expect(escStufe({ ...basis, speichernLaeuft: true, punkte: 3 })).toBe('nichts');
  });
});

describe('escGehoertOverlay (LFH-712, Review)', () => {
  const taste = (ziel: EventTarget = document.body) => {
    const e = new KeyboardEvent('keydown', { key: 'Escape' });
    Object.defineProperty(e, 'target', { value: ziel });
    return e;
  };
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('ohne Overlay gehört Esc der Karte', () => {
    expect(escGehoertOverlay(taste())).toBe(false);
  });

  it.each([
    ['Menü', 'ant-dropdown'],
    ['Auswahlliste', 'ant-select-dropdown'],
    ['Popover', 'ant-popover'],
    ['Dialog', 'ant-modal-wrap'],
  ])('ein offenes %s nimmt die Taste', (_n, klasse) => {
    const el = document.createElement('div');
    el.className = klasse;
    document.body.appendChild(el);
    expect(escGehoertOverlay(taste())).toBe(true);
  });

  it.each([
    ['Menü', 'ant-dropdown ant-dropdown-hidden'],
    ['Popover', 'ant-popover ant-popover-hidden'],
  ])('ein geschlossenes %s nimmt sie nicht', (_n, klasse) => {
    const el = document.createElement('div');
    el.className = klasse;
    document.body.appendChild(el);
    expect(escGehoertOverlay(taste())).toBe(false);
  });

  it('ein ausgeblendeter Dialog-Rahmen nimmt sie nicht', () => {
    const el = document.createElement('div');
    el.className = 'ant-modal-wrap';
    el.style.display = 'none';
    document.body.appendChild(el);
    expect(escGehoertOverlay(taste())).toBe(false);
  });

  it('Fokus in einem Menü oder Dialog nimmt sie', () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const knopf = document.createElement('button');
    dialog.appendChild(knopf);
    document.body.appendChild(dialog);
    expect(escGehoertOverlay(taste(knopf))).toBe(true);
  });
});
