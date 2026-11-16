/**
 * Die gemessene Höhe dessen, was oben klebt (LFH-952, D2). jsdom rechnet kein Layout: die Höhe
 * kommt hier aus `offsetHeight`, das der Test setzt; das gerenderte Kleben misst
 * `e2e/rahmen-stehen-bleiben.spec.ts`.
 */
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCallback, useRef } from 'react';
import {
  KOPF_OBEN_VAR,
  RAHMEN_OBEN_VAR,
  readKopfOben,
  readRahmenOben,
  useKopfOben,
  useRahmenOben,
  useRahmenObenFuer,
  useRahmenObenQuelle,
  useRahmenObenStapel,
} from './rahmenOben';

function Quelle({ hoehe, aktiv, name }: { hoehe: number; aktiv: boolean; name: string }) {
  const ref = useRahmenObenQuelle<HTMLDivElement>(aktiv);
  return (
    <div
      data-testid={name}
      ref={(el) => {
        if (el) Object.defineProperty(el, 'offsetHeight', { configurable: true, value: hoehe });
        ref(el);
      }}
    />
  );
}

/** Dieselbe Quelle (ein Hook), aber React tauscht das Element: so hängt der Rahmen nach einer Sackgasse neu ein. */
function Tausch({ variante }: { variante: 'alt' | 'neu' }) {
  const ref = useRahmenObenQuelle<HTMLElement>(true);
  const mit = (hoehe: number) => (el: HTMLElement | null) => {
    if (el) Object.defineProperty(el, 'offsetHeight', { configurable: true, value: hoehe });
    ref(el);
  };
  return variante === 'alt' ? <div key="alt" ref={mit(52)} /> : <header key="neu" ref={mit(73)} />;
}

function Anzeige() {
  return <span data-testid="anzeige">{useRahmenOben()}</span>;
}

function variable() {
  return document.documentElement.style.getPropertyValue(RAHMEN_OBEN_VAR);
}

afterEach(() => {
  document.documentElement.style.removeProperty(RAHMEN_OBEN_VAR);
});

describe('rahmenOben', () => {
  it('ohne klebendes Element ist die Höhe 0', () => {
    render(<Anzeige />);
    expect(readRahmenOben()).toBe(0);
    expect(screen.getByTestId('anzeige').textContent).toBe('0');
  });

  it('eine aktive Quelle schreibt ihre Höhe als Zahl und als CSS-Variable', () => {
    render(
      <>
        <Quelle hoehe={52} aktiv name="kopf" />
        <Anzeige />
      </>,
    );
    expect(readRahmenOben()).toBe(52);
    expect(variable()).toBe('52px');
    expect(screen.getByTestId('anzeige').textContent).toBe('52');
  });

  it('eine inaktive Quelle zählt nicht (Gegenprobe zur aktiven)', () => {
    render(<Quelle hoehe={52} aktiv={false} name="kopf" />);
    expect(readRahmenOben()).toBe(0);
  });

  it('zwei aktive Quellen addieren sich, das Aushängen nimmt den Anteil wieder weg', () => {
    const { rerender } = render(
      <>
        <Quelle hoehe={52} aktiv name="kopf" />
        <Quelle hoehe={40} aktiv name="zeile" />
      </>,
    );
    expect(readRahmenOben()).toBe(92);
    rerender(<Quelle hoehe={52} aktiv name="kopf" />);
    expect(readRahmenOben()).toBe(52);
    rerender(<></>);
    expect(readRahmenOben()).toBe(0);
    expect(variable()).toBe('0px');
  });

  it('ein getauschtes Element unter derselben Quelle wird neu gemessen (Fehlerausstieg)', () => {
    const { rerender } = render(<Tausch variante="alt" />);
    expect(readRahmenOben()).toBe(52);
    rerender(<Tausch variante="neu" />);
    expect(readRahmenOben()).toBe(73);
  });

  it('wird eine Quelle inaktiv, fällt ihr Anteil weg, und die Anzeige folgt', () => {
    const { rerender } = render(
      <>
        <Quelle hoehe={52} aktiv name="kopf" />
        <Anzeige />
      </>,
    );
    act(() => {
      rerender(
        <>
          <Quelle hoehe={52} aktiv={false} name="kopf" />
          <Anzeige />
        </>,
      );
    });
    expect(screen.getByTestId('anzeige').textContent).toBe('0');
  });

  it('in Drawer und Modal ist der Versatz 0, im Dokument die Rahmenhöhe', () => {
    function Abnehmer({ name }: { name: string }) {
      const ref = useRef<HTMLSpanElement>(null);
      const versatz = useRahmenObenFuer(useCallback(() => ref.current, []));
      return (
        <span ref={ref} data-testid={name}>
          {versatz}
        </span>
      );
    }
    render(
      <>
        <Quelle hoehe={52} aktiv name="kopf" />
        <Abnehmer name="dokument" />
        <div className="ant-drawer-body">
          <Abnehmer name="drawer" />
        </div>
        <div className="ant-modal-wrap">
          <Abnehmer name="modal" />
        </div>
      </>,
    );
    expect(screen.getByTestId('dokument').textContent).toBe('52');
    expect(screen.getByTestId('drawer').textContent).toBe('0');
    expect(screen.getByTestId('modal').textContent).toBe('0');
  });

  /**
   * Zwei Höhen (zjt7c073 D2): der klebende Seitenkopf zählt zum Rahmen über dem Inhalt, nicht aber
   * zur Kopfhöhe, an der Rail, Modulpanel und Verwaltungsmenü hängen.
   */
  describe('Ebene Seitenkopf', () => {
    function SeitenkopfQuelle({ hoehe, aktiv }: { hoehe: number; aktiv: boolean }) {
      const ref = useRahmenObenQuelle<HTMLDivElement>(aktiv, 'seitenkopf');
      return (
        <div
          ref={(el) => {
            if (el) Object.defineProperty(el, 'offsetHeight', { configurable: true, value: hoehe });
            ref(el);
          }}
        />
      );
    }
    function KopfAnzeige() {
      return <span data-testid="kopf-anzeige">{useKopfOben()}</span>;
    }
    afterEach(() => {
      document.documentElement.style.removeProperty(KOPF_OBEN_VAR);
    });

    it('der Seitenkopf zählt zum Rahmen, nicht zum Kopf', () => {
      render(
        <>
          <Quelle hoehe={52} aktiv name="kopf" />
          <SeitenkopfQuelle hoehe={45} aktiv />
          <KopfAnzeige />
          <Anzeige />
        </>,
      );
      expect(readRahmenOben()).toBe(97);
      expect(variable()).toBe('97px');
      expect(readKopfOben()).toBe(52);
      expect(document.documentElement.style.getPropertyValue(KOPF_OBEN_VAR)).toBe('52px');
      expect(screen.getByTestId('kopf-anzeige').textContent).toBe('52');
      expect(screen.getByTestId('anzeige').textContent).toBe('97');
    });

    it('rollt der Seitenkopf mit (inaktiv), sind Rahmen und Kopf gleich hoch', () => {
      const { rerender } = render(
        <>
          <Quelle hoehe={52} aktiv name="kopf" />
          <SeitenkopfQuelle hoehe={45} aktiv />
        </>,
      );
      rerender(
        <>
          <Quelle hoehe={52} aktiv name="kopf" />
          <SeitenkopfQuelle hoehe={45} aktiv={false} />
        </>,
      );
      expect(readRahmenOben()).toBe(52);
      expect(readKopfOben()).toBe(52);
      rerender(<></>);
      expect(readRahmenOben()).toBe(0);
      expect(readKopfOben()).toBe(0);
      expect(document.documentElement.style.getPropertyValue(KOPF_OBEN_VAR)).toBe('0px');
    });
  });

  /**
   * LLH-1335: Die Variable verändert, was an ihr hängt (die Höhe der IconRail). Schriebe der
   * Beobachter sie in seiner Auslieferungsrunde, wüchsen beobachtete Vorfahren noch in derselben
   * Runde, und der Browser meldete beim Dichtewechsel „ResizeObserver loop completed with
   * undelivered notifications“ (`e2e/uhs-hoehe.spec.ts`).
   */
  it('eine gemeldete Größenänderung schreibt erst im nächsten Bild, gebündelt', () => {
    const rueckrufe: ResizeObserverCallback[] = [];
    const bilder: FrameRequestCallback[] = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(rueckruf: ResizeObserverCallback) {
          rueckrufe.push(rueckruf);
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.stubGlobal('requestAnimationFrame', (rueckruf: FrameRequestCallback) => {
      bilder.push(rueckruf);
      return bilder.length;
    });
    try {
      let hoehe = 145;
      function Wechselnd() {
        const ref = useRahmenObenQuelle<HTMLDivElement>(true);
        return (
          <div
            ref={(el) => {
              if (el)
                Object.defineProperty(el, 'offsetHeight', { configurable: true, get: () => hoehe });
              ref(el);
            }}
          />
        );
      }
      render(<Wechselnd />);
      expect(variable()).toBe('145px');
      // Dichtewechsel: der Kopf schrumpft, der Beobachter meldet es (zweimal in einem Bild).
      hoehe = 53;
      const melden = rueckrufe[rueckrufe.length - 1];
      melden([], {} as ResizeObserver);
      melden([], {} as ResizeObserver);
      expect(variable()).toBe('145px');
      expect(bilder).toHaveLength(1);
      act(() => bilder[0](0));
      expect(variable()).toBe('53px');
      expect(readRahmenOben()).toBe(53);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

/** Eine Quelle, die selbst unter den übrigen klebt (Übungsband, LLH-1725, design.md D4). */
function Stapel({
  hoehe,
  aktiv = true,
  rang,
  testId = 'stapel',
}: {
  hoehe: number;
  aktiv?: boolean;
  rang?: number;
  testId?: string;
}) {
  const { ref, oben } = useRahmenObenStapel<HTMLDivElement>(aktiv, rang);
  return (
    <div
      data-testid={testId}
      data-oben={oben}
      ref={(el) => {
        if (el) Object.defineProperty(el, 'offsetHeight', { configurable: true, value: hoehe });
        ref(el);
      }}
    />
  );
}

describe('useRahmenObenStapel (Übungsband, LLH-1725)', () => {
  it('klebt unter den übrigen Quellen und zählt selbst mit', () => {
    render(
      <>
        <Quelle hoehe={52} aktiv name="kopf" />
        <Stapel hoehe={24} />
      </>,
    );
    expect(screen.getByTestId('stapel').dataset.oben).toBe('52');
    expect(readRahmenOben()).toBe(76);
    expect(variable()).toBe('76px');
  });

  /**
   * zjt7c073 D2: Das Band gehört zur Kopfhöhe (Rail, Modulpanel und Seitenkopf hängen sich darunter);
   * ein klebender Seitenkopf darunter verschiebt es nicht.
   */
  it('zählt zur Kopfhöhe und steht über einem klebenden Seitenkopf', () => {
    function SeitenkopfQuelle() {
      const ref = useRahmenObenQuelle<HTMLDivElement>(true, 'seitenkopf');
      return (
        <div
          ref={(el) => {
            if (el) Object.defineProperty(el, 'offsetHeight', { configurable: true, value: 45 });
            ref(el);
          }}
        />
      );
    }
    render(
      <>
        <Quelle hoehe={52} aktiv name="kopf" />
        <Stapel hoehe={24} />
        <SeitenkopfQuelle />
      </>,
    );
    expect(screen.getByTestId('stapel').dataset.oben).toBe('52');
    expect(readKopfOben()).toBe(76);
    expect(readRahmenOben()).toBe(121);
  });

  it('ohne andere Quelle klebt es an der Fensterkante (Handy, Kopf rollt)', () => {
    render(<Stapel hoehe={24} />);
    expect(screen.getByTestId('stapel').dataset.oben).toBe('0');
    expect(readRahmenOben()).toBe(24);
  });

  it('folgt einer anderen Quelle, die dazukommt oder geht, ohne sich selbst zu zählen', () => {
    const { rerender } = render(
      <>
        <Quelle hoehe={40} aktiv={false} name="zeile" />
        <Stapel hoehe={24} />
      </>,
    );
    expect(screen.getByTestId('stapel').dataset.oben).toBe('0');
    rerender(
      <>
        <Quelle hoehe={40} aktiv name="zeile" />
        <Stapel hoehe={24} />
      </>,
    );
    expect(screen.getByTestId('stapel').dataset.oben).toBe('40');
    expect(readRahmenOben()).toBe(64);
  });

  it('inaktiv zählt es nicht und klebt unter dem Rest', () => {
    render(
      <>
        <Quelle hoehe={52} aktiv name="kopf" />
        <Stapel hoehe={24} aktiv={false} />
      </>,
    );
    expect(screen.getByTestId('stapel').dataset.oben).toBe('52');
    expect(readRahmenOben()).toBe(52);
  });
});

describe('useRahmenObenStapel mit Rang (Alarmzone unter dem Übungsband, LLH-1735)', () => {
  it('stapelt nach Rang: die Zone klebt unter dem Band, das Band nicht unter der Zone', () => {
    render(
      <>
        <Quelle hoehe={52} aktiv name="kopf" />
        <Stapel hoehe={24} rang={1} testId="band" />
        <Stapel hoehe={40} rang={2} testId="zone" />
      </>,
    );
    expect(screen.getByTestId('band').dataset.oben).toBe('52');
    expect(screen.getByTestId('zone').dataset.oben).toBe('76');
    expect(readRahmenOben()).toBe(116);
  });

  it('ohne Band klebt die Zone direkt unter dem Kopf', () => {
    render(
      <>
        <Quelle hoehe={52} aktiv name="kopf" />
        <Stapel hoehe={24} rang={1} aktiv={false} testId="band" />
        <Stapel hoehe={40} rang={2} testId="zone" />
      </>,
    );
    expect(screen.getByTestId('zone').dataset.oben).toBe('52');
    expect(screen.getByTestId('band').dataset.oben).toBe('52');
    expect(readRahmenOben()).toBe(92);
  });

  it('Band und Zone zählen zur Kopfebene; ein klebender Seitenkopf zählt für ihr `top` nicht', () => {
    function SeitenkopfQuelle() {
      const ref = useRahmenObenQuelle<HTMLDivElement>(true, 'seitenkopf');
      return (
        <div
          ref={(el) => {
            if (el) Object.defineProperty(el, 'offsetHeight', { configurable: true, value: 45 });
            ref(el);
          }}
        />
      );
    }
    render(
      <>
        <Quelle hoehe={52} aktiv name="kopf" />
        <Stapel hoehe={24} rang={1} testId="band" />
        <Stapel hoehe={40} rang={2} testId="zone" />
        <SeitenkopfQuelle />
      </>,
    );
    expect(screen.getByTestId('band').dataset.oben).toBe('52');
    expect(screen.getByTestId('zone').dataset.oben).toBe('76');
    // Rail, Modulpanel und Seitenkopf hängen an der Kopfhöhe: unter der Zone.
    expect(readKopfOben()).toBe(116);
    expect(readRahmenOben()).toBe(161);
  });
});
