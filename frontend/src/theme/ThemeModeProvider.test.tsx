/**
 * Der Dichte-Schalter an seinen drei Austritten, weil eine halb verdrahtete Umschaltung nichts
 * bricht: (1) der antd-ConfigProvider, (2) das Dichte-Merkmal am `<html>` (CSS-Seite), (3) der
 * Speicher (die Wahl überlebt den Neustart).
 *
 * Rendert `ThemeModeProvider` DIREKT statt über `renderMitProviders`: jenes hängt einen nackten
 * ConfigProvider ohne Theme-Provider auf.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button, Popconfirm, Switch, theme } from 'antd';
import { ThemeModeProvider, useDichte } from './ThemeModeProvider';
import { dichten, type Dichte } from './tokens';
import { setzeViewportZurueck, setzeZeigerGrob } from '../test/viewport';

const STUFEN: Dichte[] = ['kompakt', 'komfortabel', 'handschuh'];
const SPEICHER_SCHLUESSEL = 'lifeline-hub.dichte';

/** Die antd-Maße, die die Stufe tragen soll. Ausgelesen über eine Sonde IM Provider, weil die
 *  Tokens erst dort abgeleitet sind. */
function masse(token: ReturnType<typeof theme.useToken>['token']) {
  return {
    controlHeight: token.controlHeight,
    // Belegt im Provider, dass die kleine Höhe antds Ableitung (× 0,75) schlägt.
    controlHeightSM: token.controlHeightSM,
    fontSize: token.fontSize,
    padding: token.padding,
    paddingSM: token.paddingSM,
    paddingXS: token.paddingXS,
    paddingLG: token.paddingLG,
    margin: token.margin,
    marginSM: token.marginSM,
    marginXS: token.marginXS,
    marginLG: token.marginLG,
  };
}

function erwartet(stufe: Dichte) {
  const s = dichten[stufe];
  return {
    controlHeight: s.zeilenhoehe,
    controlHeightSM: s.kleineZeilenhoehe,
    fontSize: s.schriftgroesse,
    padding: s.abstand.md,
    paddingSM: s.abstand.sm,
    paddingXS: s.abstand.xs,
    paddingLG: s.abstand.lg,
    margin: s.abstand.md,
    marginSM: s.abstand.sm,
    marginXS: s.abstand.xs,
    marginLG: s.abstand.lg,
  };
}

function Sonde() {
  const { dichte, setDichte } = useDichte();
  const { token } = theme.useToken();
  return (
    <div>
      <span data-testid="stufe">{dichte}</span>
      <span data-testid="masse">{JSON.stringify(masse(token))}</span>
      {STUFEN.map((s) => (
        <button key={s} type="button" onClick={() => setDichte(s)}>
          {s}
        </button>
      ))}
    </div>
  );
}

function zeigeSonde() {
  return render(
    <ThemeModeProvider>
      <Sonde />
    </ThemeModeProvider>,
  );
}

const stufe = () => screen.getByTestId('stufe').textContent;
const gemesseneMasse = () => JSON.parse(screen.getByTestId('masse').textContent!);

// `src/test/setup.ts` räumt den Speicher, aber nicht das Merkmal am `<html>`; ohne diesen
// Aufräumer trüge ein Test seine Stufe in die Nachfolger.
afterEach(() => {
  delete document.documentElement.dataset.dichte;
  delete document.documentElement.dataset.theme;
  // Der Provider liest die Zeigerart; ohne Rückbau trüge ein Test seine Zeigerannahme weiter.
  setzeViewportZurueck();
});

describe('Bediendichte — Zustand und Persistenz (LFH-329 · B1)', () => {
  it('ohne gespeicherten Wert steht die Staffel auf kompakt', () => {
    zeigeSonde();
    expect(stufe()).toBe('kompakt');
  });

  it('die Wahl landet im Speicher', async () => {
    zeigeSonde();
    await userEvent.click(screen.getByRole('button', { name: 'komfortabel' }));
    expect(stufe()).toBe('komfortabel');
    expect(localStorage.getItem(SPEICHER_SCHLUESSEL)).toBe('komfortabel');
  });

  it('ein unbekannter gespeicherter Wert fällt auf kompakt zurück', () => {
    localStorage.setItem(SPEICHER_SCHLUESSEL, 'riesig');
    zeigeSonde();
    expect(stufe()).toBe('kompakt');
  });

  it('Round-Trip: die gewählte Stufe überlebt einen Remount', async () => {
    const ersteSitzung = zeigeSonde();
    await userEvent.click(screen.getByRole('button', { name: 'handschuh' }));
    expect(stufe()).toBe('handschuh');
    ersteSitzung.unmount();

    zeigeSonde();
    expect(stufe()).toBe('handschuh');
  });
});

/**
 * Die Zeigerart belegt die Stufe nur VOR: sie entscheidet, womit jemand anfängt, nie was er
 * gewählt hat. Sonst drehte sich der Umschalter auf einem 2-in-1-Tablet beim Neuladen selbst
 * zurück.
 */
describe('Bediendichte — Ableitung aus der Zeigerart (LFH-361 · B5a)', () => {
  it('grober Zeiger ohne gespeicherte Wahl beginnt bei komfortabel', () => {
    setzeZeigerGrob(true);
    zeigeSonde();
    expect(stufe()).toBe('komfortabel');
  });

  it('die gespeicherte Wahl schlägt das Kontextsignal', () => {
    localStorage.setItem(SPEICHER_SCHLUESSEL, 'kompakt');
    setzeZeigerGrob(true);
    zeigeSonde();
    expect(stufe()).toBe('kompakt');
  });

  // Ohne diesen Fall wäre der erste Test auch grün, wenn die Ableitung pauschal
  // `komfortabel` lieferte.
  it('feiner Zeiger ohne gespeicherte Wahl bleibt bei kompakt', () => {
    setzeZeigerGrob(false);
    zeigeSonde();
    expect(stufe()).toBe('kompakt');
  });

  it('ein unbekannter gespeicherter Wert fällt auf das Kontextsignal zurück, nicht auf kompakt', () => {
    localStorage.setItem(SPEICHER_SCHLUESSEL, 'riesig');
    setzeZeigerGrob(true);
    zeigeSonde();
    expect(stufe()).toBe('komfortabel');
  });
});

describe('Bediendichte — die drei Austritte (LFH-329 · B1)', () => {
  it('der ConfigProvider trägt die Stufe: die Steuermaße entsprechen der Staffel', async () => {
    zeigeSonde();
    expect(gemesseneMasse()).toEqual(erwartet('kompakt'));

    for (const s of ['komfortabel', 'handschuh'] as const) {
      await userEvent.click(screen.getByRole('button', { name: s }));
      expect(gemesseneMasse(), s).toEqual(erwartet(s));
    }
  });

  it('Literal-Gegenprobe: auf handschuh trägt die Trefffläche 72 px', async () => {
    // Der Test oben speist beide Seiten aus `dichten`; diese Zahl steht deshalb als Literal da
    // (72 px ≙ 19,05 mm, MIL-STD-1472F Fig. 12).
    zeigeSonde();
    await userEvent.click(screen.getByRole('button', { name: 'handschuh' }));
    expect(gemesseneMasse().controlHeight).toBe(72);
    expect(gemesseneMasse().fontSize).toBe(15);
  });

  it('<html> trägt die effektive Stufe', async () => {
    zeigeSonde();
    expect(document.documentElement.dataset.dichte).toBe('kompakt');
    await userEvent.click(screen.getByRole('button', { name: 'komfortabel' }));
    expect(document.documentElement.dataset.dichte).toBe('komfortabel');
  });

  it('die Dichte-Achse rührt die Theme-Achse nicht an', () => {
    // Zwei Zustände in EINEM Provider: ein geteilter Speicherschlüssel oder ein Setzer, der beide
    // Felder schreibt, fiele hier auf.
    zeigeSonde();
    // Ohne gespeicherte Wahl gilt der Nachtbetrieb; die Dichte-Achse dreht daran nichts und
    // speichert nichts.
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('lifeline-hub.theme')).toBeNull();
  });
});

describe('Nachtbetrieb als Vorgabe (Neuentwurf „Instrumententafel", 21.09.2026)', () => {
  it('startet ohne gespeicherte Wahl dunkel — unabhängig von der OS-Einstellung', () => {
    // `matchMedia` meldet hier kein dunkles System; die Vorgabe ist trotzdem dunkel.
    expect(window.matchMedia('(prefers-color-scheme: dark)').matches).toBe(false);
    zeigeSonde();
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  it('eine gespeicherte Wahl gewinnt weiterhin — auch „System"', () => {
    localStorage.setItem('lifeline-hub.theme', 'system');
    zeigeSonde();
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('ein unbekannter Speicherwert fällt auf die Vorgabe, nicht auf Hell', () => {
    localStorage.setItem('lifeline-hub.theme', 'kaputt');
    zeigeSonde();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});

/**
 * Die kurze Achse eines beschrifteten Knopfs (LFH-381): Boden am Kontext
 * (`button.style.minWidth`), weil antds Polsterung kleiner Knöpfe ein Literal ohne Dichte ist.
 * Geprüft wird die VERDRAHTUNG im Provider, nicht `antdKnopf()` allein; die Werte stehen als
 * Literale da.
 */
describe('Bediendichte — die kurze Achse beschrifteter Knöpfe (LFH-381)', () => {
  const BODEN = { kompakt: '24px', komfortabel: '48px', handschuh: '72px' } as const;

  for (const s of STUFEN) {
    it(`Stufe ${s}: ein kleiner Knopf mit kurzem Etikett ist mindestens ${BODEN[s]} breit`, () => {
      localStorage.setItem(SPEICHER_SCHLUESSEL, s);
      render(
        <ThemeModeProvider>
          <Button size="small">OK</Button>
        </ThemeModeProvider>,
      );
      expect(screen.getByRole('button', { name: 'OK' }).style.minWidth).toBe(BODEN[s]);
    });
  }

  it('der Boden erreicht auch die Knöpfe, die antd selbst baut (Bestätigungsblase im Portal)', async () => {
    localStorage.setItem(SPEICHER_SCHLUESSEL, 'handschuh');
    render(
      <ThemeModeProvider>
        <Popconfirm title="Wirklich?">
          <Button>Entfernen</Button>
        </Popconfirm>
      </ThemeModeProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Entfernen' }));
    expect((await screen.findByRole('button', { name: 'OK' })).style.minWidth).toBe('72px');
    expect(screen.getByRole('button', { name: 'Abbrechen' }).style.minWidth).toBe('72px');
  });

  // antd führt Kontext- und Knopfstil JE EIGENSCHAFT zusammen (`useMergeSemantic`). Ersetzte eine
  // Bibliotheksversion den Kontextstil ganz, verlören Knöpfe mit eigenem `style` den Boden still.
  it('ein eigener Stil OHNE minWidth behält den Boden', () => {
    localStorage.setItem(SPEICHER_SCHLUESSEL, 'handschuh');
    render(
      <ThemeModeProvider>
        <Button style={{ marginLeft: 8 }}>OK</Button>
      </ThemeModeProvider>,
    );
    const knopf = screen.getByRole('button', { name: 'OK' });
    expect(knopf.style.minWidth).toBe('72px');
    expect(knopf.style.marginLeft).toBe('8px');
  });

  it('ein eigener Stil am Knopf schlägt den Boden (die benannte Ausnahme bleibt möglich)', () => {
    localStorage.setItem(SPEICHER_SCHLUESSEL, 'handschuh');
    render(
      <ThemeModeProvider>
        <Button style={{ minWidth: 0 }}>OK</Button>
      </ThemeModeProvider>,
    );
    expect(screen.getByRole('button', { name: 'OK' }).style.minWidth).toBe('0px');
  });
});

/**
 * Der Kippschalter bekommt seine Maße über die GLOBALE Stelle (LFH-380). `tokens.test.ts` prüft
 * die Rechnung, nicht ob antd die Tokennamen honoriert. Gemessen wird deshalb der von cssinjs
 * erzeugte CSS-Text, verankert an der `css-var-…`-Klasse GENAU dieses Schalters (sonst färbte
 * ein Schalter aus einem früheren Test den Nachweis grün). Drei Werte, weil antd Griff und
 * Mindestbreite aus der Schrift rechnet.
 */
describe('Switch folgt der Staffel bis in den CSS-Text (LFH-380)', () => {
  function regelFuer(schalter: HTMLElement): string {
    const scope = [...schalter.classList].find((k) => k.startsWith('css-var-'));
    expect(scope, 'antd vergibt dem Schalter eine Variablen-Klasse').toBeTruthy();
    // `innerHTML`, NICHT `textContent`: der Testfilter in `test/antdCssVariablen.ts` streicht die
    // Custom-Property-Deklarationen aus dem Text, `textContent` zeigte immer eine leere Regel.
    const css = [...document.querySelectorAll('style')].map((s) => s.innerHTML).join('');
    return css.match(new RegExp(`\\.${scope}\\.ant-switch\\{([^}]*)\\}`))?.[1] ?? '';
  }

  it('auf handschuh trägt der Schalter 72 × 144 mit 68-px-Griff', () => {
    localStorage.setItem(SPEICHER_SCHLUESSEL, 'handschuh');
    render(
      <ThemeModeProvider>
        <Switch aria-label="Probe" />
      </ThemeModeProvider>,
    );
    const regel = regelFuer(screen.getByRole('switch', { name: 'Probe' }));
    expect(regel, 'Spurhöhe').toContain('--ant-switch-track-height:72px');
    expect(regel, 'Griff').toContain('--ant-switch-handle-size:68px');
    expect(regel, 'Mindestbreite').toContain('--ant-switch-track-min-width:144px');
  });
});
