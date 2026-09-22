import { render, screen } from '@testing-library/react';
import { Button, ConfigProvider } from 'antd';
import { afterEach, describe, expect, it } from 'vitest';
import { ohneCustomProperties } from './antdCssVariablen';

function customProperties(el: Element): string[] {
  const cs = getComputedStyle(el);
  const namen: string[] = [];
  for (let i = 0; i < cs.length; i++) if (cs.item(i).startsWith('--')) namen.push(cs.item(i));
  return namen;
}

describe('ohneCustomProperties', () => {
  it('streicht jede Custom-Property-Deklaration, auch die letzte ohne Semikolon', () => {
    expect(ohneCustomProperties('.x{--a:1;--b-c: 2px ;color:red;--d:3}')).toBe('.x{color:red;}');
  });

  it('lässt Werte mit var(), Selektoren mit Doppelstrich und display:none stehen', () => {
    const css = '.a--b:hover{color:var(--ant-color-text);display:none}.c{--x:1}';
    expect(ohneCustomProperties(css)).toBe(
      '.a--b:hover{color:var(--ant-color-text);display:none}.c{}',
    );
  });

  it('trifft Deklarationen auch nach Leerraum hinter der Klammer', () => {
    // Der Leerraum davor bleibt stehen — für den Parser bedeutungslos.
    expect(ohneCustomProperties('.x{\n  --a: 1;\n  top: 0;\n}')).toBe('.x{\n  \n  top: 0;\n}');
  });
});

describe('Filter an antds eingehängten Stilen', () => {
  afterEach(() => {
    document.head.querySelectorAll('style[data-test]').forEach((s) => s.remove());
  });

  it('ein antd-Knopf trägt keine berechneten --ant-Variablen mehr, seine übrigen Regeln greifen', () => {
    render(
      <ConfigProvider>
        <Button>Probe</Button>
      </ConfigProvider>,
    );
    const knopf = screen.getByRole('button', { name: 'Probe' });
    // Die Klasse, an der die Variablen hingen, ist weiter da — gefiltert wird der Stil,
    // nicht das Markup.
    expect(knopf.closest('.css-var-root')).not.toBeNull();
    expect(customProperties(knopf)).toEqual([]);
    // Gegenprobe, dass antds Stile überhaupt ankommen: `.ant-btn` setzt den Zeiger.
    expect(getComputedStyle(knopf).cursor).toBe('pointer');
  });

  it('antds Stilknoten geben den ungefilterten Text zurück (updateCSS vergleicht dagegen)', () => {
    render(
      <ConfigProvider>
        <Button>Probe</Button>
      </ConfigProvider>,
    );
    const antdStile = [...document.querySelectorAll('style[data-rc-order]')];
    const deklaration = /[{;]\s*--ant-/;
    expect(antdStile.some((s) => deklaration.test(s.innerHTML))).toBe(true);
    const geparst = antdStile.flatMap((s) =>
      [...((s as HTMLStyleElement).sheet?.cssRules ?? [])].map((r) => r.cssText),
    );
    // `var(--ant-…)` in Werten bleibt stehen; gesucht wird die DEKLARATION.
    expect(geparst.some((t) => deklaration.test(t))).toBe(false);
  });

  it('ein fremdes <style> ohne data-rc-order bleibt unberührt', () => {
    const stil = document.createElement('style');
    stil.setAttribute('data-test', '');
    stil.innerHTML = '.fremd{--lfh-probe:1px}';
    document.head.appendChild(stil);
    const el = document.createElement('div');
    el.className = 'fremd';
    document.body.appendChild(el);
    expect(stil.innerHTML).toBe('.fremd{--lfh-probe:1px}');
    expect(customProperties(el)).toEqual(['--lfh-probe']);
    el.remove();
  });
});
