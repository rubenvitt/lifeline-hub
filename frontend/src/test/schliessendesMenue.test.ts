import { afterEach, describe, expect, it } from 'vitest';

/**
 * Wächter (LLH-2023, `setup.ts`): ein schließendes antd-Menü nimmt keinen Fokus.
 *
 * Der späte `autoFocus` eines Dropdowns (`raf(focusMenu, 3)`) feuert auch, wenn das Menü schon
 * wieder schließt, und zog den Fokus aus dem danach geöffneten Dialog: Getipptes ging verloren
 * (LLH-1390). Im Browser holt die Fokusfalle des Dialogs ihn zurück; in jsdom läuft die
 * Schließbewegung nie zu Ende, das Portal bleibt mit `pointer-events: none` stehen.
 */
function menue({ schliesst }: { schliesst: boolean }) {
  const portal = document.createElement('div');
  portal.className = 'ant-dropdown';
  if (schliesst) portal.style.pointerEvents = 'none';
  const liste = document.createElement('ul');
  liste.setAttribute('role', 'menu');
  liste.tabIndex = -1;
  portal.append(liste);
  document.body.append(portal);
  return liste;
}

function feld() {
  const eingabe = document.createElement('input');
  document.body.append(eingabe);
  eingabe.focus();
  return eingabe;
}

describe('schließendes Menü (LLH-2023)', () => {
  afterEach(() => document.body.replaceChildren());

  it('nimmt dem Dialog den Fokus nicht', () => {
    const eingabe = feld();
    menue({ schliesst: true }).focus();
    expect(document.activeElement).toBe(eingabe);
  });

  it('ein offenes Menü nimmt ihn weiter', () => {
    feld();
    const liste = menue({ schliesst: false });
    liste.focus();
    expect(document.activeElement).toBe(liste);
  });

  it('außerhalb eines Menüs bleibt focus() unverändert', () => {
    feld();
    const knopf = document.createElement('button');
    knopf.style.pointerEvents = 'none';
    document.body.append(knopf);
    knopf.focus();
    expect(document.activeElement).toBe(knopf);
  });
});
