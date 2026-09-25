/**
 * Der Dichte-Schalter (LFH-329 · B1).
 *
 * A2/LFH-328 hat den TRÄGER gebaut: `antdToken(farben, dichte)` nimmt die Stufe
 * als Parameter, `rollen.css` spiegelt sie als `[data-dichte='…']`. Was fehlte,
 * war der Schalter. Dieser Test bewacht ihn an allen drei Austritten, weil eine
 * halb verdrahtete Umschaltung **nichts bricht**: der Provider rendert weiter,
 * kein Test wird rot, die Fläche trägt nur stillschweigend die kompakte Stufe.
 *
 * Die drei Austritte:
 *   1. der antd-ConfigProvider (alle Steuerelemente auf einmal),
 *   2. das Dichte-Merkmal am `<html>` (die `var(--lfh-*)`-CSS-Seite),
 *   3. der Speicher (die Wahl überlebt den Neustart).
 *
 * Diese Datei rendert `ThemeModeProvider` DIREKT statt über `renderMitProviders`
 * — jenes Hilfsmittel hängt einen nackten ConfigProvider ohne Theme-Provider
 * auf, an dem sich über die Stufe nichts belegen ließe.
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

/** Die antd-Maße, die die Stufe tragen soll — je Kennung der erwartete
 *  Staffelwert. Ausgelesen wird über eine Sonde IM Provider, weil die Tokens
 *  erst dort abgeleitet sind. */
function masse(token: ReturnType<typeof theme.useToken>['token']) {
  return {
    controlHeight: token.controlHeight,
    // Der Durchstich-Beweis für LFH-361: `tokens.test.ts` prüft `antdToken()`
    // isoliert, hier steht die Sonde IM Provider und belegt, dass die kleine
    // Höhe die antd-Ableitung (× 0,75) tatsächlich schlägt.
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

// `src/test/setup.ts` räumt den Speicher, aber NICHT das Merkmalsverzeichnis am
// `<html>` — ohne diesen Aufräumer trüge ein Test die zuletzt gesetzte Stufe in
// seine Nachfolger, und die Anfangsbehauptungen wären Attrappen.
afterEach(() => {
  delete document.documentElement.dataset.dichte;
  delete document.documentElement.dataset.theme;
  // Seit LFH-361 liest der Provider die Zeigerart. Ohne diesen Rückbau trüge
  // ein Test seine Zeigerannahme in die Nachfolger.
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
 * Die Ableitung aus dem Einsatzkontext (LFH-361 · B5a).
 *
 * Bewusst NUR als Vorbelegung: das Kontextsignal entscheidet, womit jemand
 * anfängt, nie was er gewählt hat. Eine Ableitung, die die gespeicherte Wahl
 * überstimmt, wäre auf dem 2-in-1-Tablet mit angesteckter Tastatur ein
 * Umschalter, der sich beim Neuladen selbst zurückdreht.
 *
 * Es gibt deshalb KEINE vierte Stufe `automatisch` analog zu `ThemeModus`:
 * die Wahl bleibt die effektive Stufe, und der Provider braucht keinen zweiten
 * Typ, den vier Bedienwege mittragen müssten.
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

  // Ohne diesen Fall wäre der erste Test auch dann grün, wenn die Ableitung
  // pauschal `komfortabel` lieferte, statt den Zeiger zu lesen.
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
    // Der Test oben speist BEIDE Seiten aus `dichten` — bei verbogener Ableitung
    // bliebe er grün. Diese Zahl steht deshalb als Literal da (72 px ≙ 19,05 mm,
    // MIL-STD-1472F Fig. 12) und ist aus keiner Quelle abgeleitet.
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
    // Zwei Zustände in EINEM Provider: ein gemeinsamer useMemo, aber getrennte
    // Setzer. Ein versehentlich geteilter Speicherschlüssel oder ein Setzer, der
    // beide Felder schreibt, fiele hier auf.
    zeigeSonde();
    // Ohne gespeicherte Wahl gilt seit dem Neuentwurf (21.09.2026) der Nachtbetrieb —
    // die Aussage hier ist, dass die Dichte-Achse daran nichts dreht und nichts speichert.
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('lifeline-hub.theme')).toBeNull();
  });
});

describe('Nachtbetrieb als Vorgabe (Neuentwurf „Instrumententafel", 21.09.2026)', () => {
  it('startet ohne gespeicherte Wahl dunkel — unabhängig von der OS-Einstellung', () => {
    // `matchMedia` meldet in der Testumgebung kein dunkles System; vorher (Vorgabe
    // `system`) landete dieser Fall deshalb hell. Genau das dreht die Entscheidung um.
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
 * Die kurze Achse eines beschrifteten Knopfs (LFH-381).
 *
 * Die HÖHE eines kleinen Knopfs folgt der Staffel seit LFH-361 (`controlHeightSM`), seine
 * BREITE hing an antds `paddingInlineSM` — einem Literal (`8 - lineWidth` = 7), das keine
 * Dichte kennt. Ein „OK" blieb damit rund 38 px breit, während es 72 px hoch wurde. Der
 * Träger ist ein Boden am Kontext (`button.style.minWidth`) und nicht die Polsterung: die
 * bände die Breite nicht an die Höhe, ein Ein-Zeichen-Etikett fiele weiter durch, und
 * breite Etiketten wüchsen grundlos mit.
 *
 * Geprüft wird die VERDRAHTUNG im Provider, nicht eine Hilfsfunktion: ein Test nur auf
 * `antdKnopf()` bliebe grün, wenn die `button`-Prop am ConfigProvider fehlte. Die Werte
 * stehen als Literale da — aus `dichten` gelesen prüfte die Zusicherung sich selbst.
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

  // Das Gegenstück zur Ausnahme darunter: antd führt Kontext- und Knopfstil JE EIGENSCHAFT
  // zusammen (`useMergeSemantic`). Ersetzte eine Bibliotheksversion den Kontextstil ganz,
  // verlören alle Knöpfe mit eigenem `style` den Boden still — dieser Fall würde rot.
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
 * Der Kippschalter bekommt seine Maße über die GLOBALE Stelle (LFH-380).
 *
 * `tokens.test.ts` beweist eine RECHNUNG, nicht dass antd die Tokennamen honoriert. Genau
 * daran scheiterte beim Segmented (LFH-370) der naheliegende interne Name, der wirkungslos
 * durchging. Gemessen wird deshalb der von cssinjs erzeugte CSS-Text, verankert an der
 * `css-var-…`-Klasse GENAU dieses Schalters — ohne die Verankerung färbte ein Schalter aus
 * einem früheren Test derselben Datei den Nachweis grün.
 *
 * Drei Werte statt einem: die Spurhöhe allein belegte nicht, dass der abhängige Satz
 * mitkommt (Griff und Mindestbreite rechnet antd aus der Schrift, nicht aus der Spur).
 */
describe('Switch folgt der Staffel bis in den CSS-Text (LFH-380)', () => {
  function regelFuer(schalter: HTMLElement): string {
    const scope = [...schalter.classList].find((k) => k.startsWith('css-var-'));
    expect(scope, 'antd vergibt dem Schalter eine Variablen-Klasse').toBeTruthy();
    // `innerHTML`, NICHT `textContent`: der Testfilter aus LFH-623 (`test/antdCssVariablen.ts`)
    // streicht die Custom-Property-Deklarationen aus antds Stilen, und `textContent` zeigte
    // hier deshalb in JEDEM Fall eine leere Regel — die Zusicherung wäre nie grün geworden,
    // auch nicht mit korrekter Verdrahtung. Der `innerHTML`-Getter gibt den ungefilterten Text
    // zurück (dort als tragend begründet).
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
