import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfigProvider, Form } from 'antd';
import deDE from 'antd/locale/de_DE';
import dayjs, { type Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactNode } from 'react';
import { mitProzessZone } from '../test/prozessZone';
import { setzeZeit, tippeZeit, zeitFeld } from '../test/zeitEingabe';
import { AnzeigeKonventionenProvider } from './AnzeigeKonventionenContext';
import {
  ZEIT_BLATT,
  ZeitpunktEingabe,
  ZeitraumEingabe,
  zeitPanelAmFeldAb,
  type Zeitraum,
} from './ZeitpunktEingabe';
import { alsBackendZeit, alsZeitpunkt } from './zeitEingabe';
import { merkeServerzeit, serveruhrVergessenFuerTests } from '../offline/serveruhr';
import { setzeViewportBreite, setzeZeigerGrob } from '../test/viewport';

dayjs.extend(utc);

const BERLIN = 'Europe/Berlin';

function mitZone(zone: string | null, kind: ReactNode) {
  return (
    <ConfigProvider locale={deDE}>
      <AnzeigeKonventionenProvider konventionen={{ zeitzone: zone }}>
        {kind}
      </AnzeigeKonventionenProvider>
    </ConfigProvider>
  );
}

/** Die Uhr steht (nur `Date`; Timer laufen, damit userEvent weiter wartet). */
function uhrSteht(iso: string) {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(iso));
    serveruhrVergessenFuerTests();
  });
  afterEach(() => {
    vi.useRealTimers();
    serveruhrVergessenFuerTests();
  });
}

const wire = (d: Dayjs | null | undefined) => (d ? alsBackendZeit(d) : d);

/** Der offene Kalender (antd hängt ihn an `document.body`). */
const kalender = () => screen.findByRole('dialog', { name: /Tag/ });

describe('ZeitpunktEingabe — Anzeige als DTG in der Anzeigezone (Browser UTC)', () => {
  mitProzessZone('UTC');

  it('zeigt einen Zeitpunkt als volle DTG mit der Berliner Wanduhr', () => {
    render(
      mitZone(
        BERLIN,
        <ZeitpunktEingabe aria-label="Beginn" value={alsZeitpunkt('2026-03-16 13:30:00')} />,
      ),
    );
    expect(zeitFeld('Beginn')).toHaveValue('161430mrz26');
  });

  it('nennt die Anzeigezone, weil sie von der Browserzone abweicht', () => {
    render(mitZone(BERLIN, <ZeitpunktEingabe aria-label="Beginn" />));
    expect(screen.getByText(BERLIN)).toBeInTheDocument();
  });
});

describe('ZeitpunktEingabe — Eingabe als Text (Spec zeiteingabe)', () => {
  mitProzessZone('UTC');
  // 2026-10-17 15:00 Berliner Zeit.
  uhrSteht('2026-10-17T13:00:00Z');

  it('„1430“ + Enter gilt heute 14:30 in der Anzeigezone (Szenario „Tippen und Enter“)', async () => {
    const onChange = vi.fn<(d: Dayjs | null) => void>();
    const onOk = vi.fn<(d: Dayjs | null) => void>();
    const user = userEvent.setup();
    render(
      mitZone(BERLIN, <ZeitpunktEingabe aria-label="Beginn" onChange={onChange} onOk={onOk} />),
    );
    await tippeZeit(user, zeitFeld('Beginn'), '1430');
    expect(wire(onChange.mock.lastCall![0])).toBe('2026-10-17 12:30:00');
    expect(wire(onOk.mock.lastCall![0])).toBe('2026-10-17 12:30:00');
    expect(zeitFeld('Beginn')).toHaveValue('171430okt26');
  });

  it('hängt das Feld beim Tippen nicht neu ein, auch wenn Deutung oder Grund erscheinen', () => {
    const onChange = vi.fn();
    render(
      mitZone(
        // Ohne Zonenhinweis hat das Feld kein Präfix; erst dann baute ein neues Suffix das Gerüst um.
        null,
        <ZeitpunktEingabe
          aria-label="Beginn"
          value={alsZeitpunkt('2026-10-16 12:30:00')}
          onChange={onChange}
        />,
      ),
    );
    const feld = zeitFeld('Beginn');
    fireEvent.focus(feld);
    fireEvent.change(feld, { target: { value: '1430' } });
    // Ein neu eingehängtes Feld bekäme den nächsten Tastendruck nicht mehr (antds Input baut sein
    // Gerüst um, sobald ein Suffix kommt oder geht).
    fireEvent.keyDown(feld, { key: 'Enter' });
    expect(zeitFeld('Beginn')).toBe(feld);
    expect(onChange).toHaveBeenCalled();
  });

  it('zeigt beim Tippen die Deutung daneben, noch ohne zu übernehmen', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(mitZone(BERLIN, <ZeitpunktEingabe aria-label="Beginn" onChange={onChange} />));
    await user.type(zeitFeld('Beginn'), '1430');
    expect(screen.getByText('= 171430okt26')).toBeInTheDocument();
    expect(zeitFeld('Beginn')).toHaveAccessibleDescription(/= 171430okt26/);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('nennt „gestern“, wenn ein Ereignis sonst in der Zukunft läge', async () => {
    const user = userEvent.setup();
    render(mitZone(BERLIN, <ZeitpunktEingabe aria-label="Lage" art="ereignis" />));
    await user.type(zeitFeld('Lage'), '2350');
    expect(screen.getByText(/= 162350okt26/)).toHaveTextContent('· gestern');
  });

  it('im Formular: Verlassen übernimmt, „Speichern“ sendet die getippte Zeit', async () => {
    const onFinish = vi.fn();
    const user = userEvent.setup();
    render(
      mitZone(
        BERLIN,
        <Form onFinish={onFinish} initialValues={{ t: alsZeitpunkt('2026-10-17 06:00:00') }}>
          <Form.Item name="t" label="Zeit">
            <ZeitpunktEingabe />
          </Form.Item>
          <button type="submit">Speichern</button>
        </Form>,
      ),
    );
    await user.clear(zeitFeld('Zeit'));
    await user.type(zeitFeld('Zeit'), '0815');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(onFinish).toHaveBeenCalled());
    expect(wire(onFinish.mock.lastCall![0].t)).toBe('2026-10-17 06:15:00');
  });

  it('im Formular: Enter übernimmt und sendet ab', async () => {
    const onFinish = vi.fn();
    const user = userEvent.setup();
    render(
      mitZone(
        BERLIN,
        <Form onFinish={onFinish}>
          <Form.Item name="t" label="Zeit">
            <ZeitpunktEingabe />
          </Form.Item>
          <button type="submit">Speichern</button>
        </Form>,
      ),
    );
    await tippeZeit(user, zeitFeld('Zeit'), '101430okt26');
    await waitFor(() => expect(onFinish).toHaveBeenCalled());
    expect(wire(onFinish.mock.lastCall![0].t)).toBe('2026-10-10 12:30:00');
  });

  it('im Formular: Speichern ohne Berührung liefert den gelesenen Zeitpunkt unverändert', async () => {
    const onFinish = vi.fn();
    const onChange = vi.fn();
    render(
      mitZone(
        BERLIN,
        <Form onFinish={onFinish} initialValues={{ t: alsZeitpunkt('2026-10-24 23:30:15') }}>
          <Form.Item name="t" label="Zeit">
            <ZeitpunktEingabe onChange={onChange} />
          </Form.Item>
          <button type="submit">ok</button>
        </Form>,
      ),
    );
    expect(zeitFeld('Zeit')).toHaveValue('250130okt26');
    fireEvent.focus(zeitFeld('Zeit'));
    fireEvent.blur(zeitFeld('Zeit'));
    fireEvent.click(screen.getByRole('button', { name: 'ok' }));
    await waitFor(() => expect(onFinish).toHaveBeenCalled());
    // Sekunden bleiben: der Wert wurde nicht neu gebildet.
    expect(wire(onFinish.mock.lastCall![0].t)).toBe('2026-10-24 23:30:15');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('Escape verwirft die Eingabe und zeigt den geltenden Wert', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      mitZone(
        BERLIN,
        <ZeitpunktEingabe
          aria-label="Beginn"
          value={alsZeitpunkt('2026-10-16 12:30:00')}
          onChange={onChange}
        />,
      ),
    );
    await user.clear(zeitFeld('Beginn'));
    await user.type(zeitFeld('Beginn'), '0900');
    await user.keyboard('{Escape}');
    expect(zeitFeld('Beginn')).toHaveValue('161430okt26');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('Unlesbares: Enter sendet nicht, das Feld nennt den Grund', async () => {
    const onFinish = vi.fn();
    const user = userEvent.setup();
    render(
      mitZone(
        BERLIN,
        <Form onFinish={onFinish}>
          <Form.Item name="t" label="Zeit">
            <ZeitpunktEingabe />
          </Form.Item>
          <button type="submit">Speichern</button>
        </Form>,
      ),
    );
    await tippeZeit(user, zeitFeld('Zeit'), '2460');
    expect(screen.getByText('Uhrzeit gibt es nicht')).toBeInTheDocument();
    expect(zeitFeld('Zeit')).toHaveAttribute('aria-invalid', 'true');
    expect(zeitFeld('Zeit')).toHaveValue('2460');
    expect(onFinish).not.toHaveBeenCalled();
  });

  it('Unlesbares und Verlassen: geltender Wert zurück, Grund bleibt, gesendet wird der alte Wert', async () => {
    const onFinish = vi.fn();
    const user = userEvent.setup();
    render(
      mitZone(
        BERLIN,
        <Form onFinish={onFinish} initialValues={{ t: alsZeitpunkt('2026-10-16 12:30:00') }}>
          <Form.Item name="t" label="Zeit">
            <ZeitpunktEingabe />
          </Form.Item>
          <button type="submit">Speichern</button>
        </Form>,
      ),
    );
    await user.clear(zeitFeld('Zeit'));
    await user.type(zeitFeld('Zeit'), '14:3x');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(onFinish).toHaveBeenCalled());
    expect(zeitFeld('Zeit')).toHaveValue('161430okt26');
    expect(screen.getByText('nicht lesbar')).toBeInTheDocument();
    expect(wire(onFinish.mock.lastCall![0].t)).toBe('2026-10-16 12:30:00');
  });

  it('Leeren meldet keinen Zeitpunkt; mit allowClear={false} ist es unlesbar', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const wert = alsZeitpunkt('2026-10-16 12:30:00');
    const { unmount } = render(
      mitZone(BERLIN, <ZeitpunktEingabe aria-label="Beginn" value={wert} onChange={onChange} />),
    );
    await tippeZeit(user, zeitFeld('Beginn'), '');
    expect(onChange).toHaveBeenLastCalledWith(null);
    unmount();

    onChange.mockClear();
    render(
      mitZone(
        BERLIN,
        <ZeitpunktEingabe
          aria-label="Beginn"
          value={wert}
          onChange={onChange}
          allowClear={false}
        />,
      ),
    );
    await tippeZeit(user, zeitFeld('Beginn'), '');
    expect(screen.getByText('Angabe fehlt')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('Enter auf dem unveränderten Vorschlag übernimmt ihn ausdrücklich (onOk)', () => {
    const onOk = vi.fn<(d: Dayjs | null) => void>();
    render(
      mitZone(
        BERLIN,
        <ZeitpunktEingabe
          aria-label="Zeit"
          defaultValue={alsZeitpunkt('2026-10-17 12:00:00')}
          onOk={onOk}
        />,
      ),
    );
    fireEvent.keyDown(zeitFeld('Zeit'), { key: 'Enter' });
    expect(wire(onOk.mock.lastCall![0])).toBe('2026-10-17 12:00:00');
  });

  it('relativ: „-5“ misst an der Serveruhr, nicht an der vorgehenden Geräteuhr', () => {
    const server = Date.parse('2026-10-17T13:00:00Z');
    vi.setSystemTime(server + 5 * 60_000);
    merkeServerzeit(new Response(null, { headers: { Date: new Date(server).toUTCString() } }));
    const onChange = vi.fn<(d: Dayjs | null) => void>();
    render(mitZone(BERLIN, <ZeitpunktEingabe aria-label="Zeit" onChange={onChange} />));
    setzeZeit(zeitFeld('Zeit'), '-5');
    const ms = onChange.mock.lastCall![0]!.valueOf();
    expect(Math.abs(ms - (server - 5 * 60_000))).toBeLessThanOrEqual(1_000);
  });

  it('die Typprüfung kennt kein `format` mehr', () => {
    // @ts-expect-error `format` gibt es nicht (Spec: Anzeige im Feld als Datum-Zeit-Gruppe).
    const element = <ZeitpunktEingabe format="YYYY-MM-DD" />;
    expect(element).toBeTruthy();
  });
});

describe('ZeitpunktEingabe — Kalender als Nebenweg', () => {
  mitProzessZone('UTC');
  uhrSteht('2026-10-17T13:00:00Z');

  it('die Woche beginnt am Montag', async () => {
    const user = userEvent.setup();
    render(mitZone(BERLIN, <ZeitpunktEingabe aria-label="Zeit" />));
    await user.click(screen.getByRole('button', { name: 'Kalender und Uhrzeit' }));
    const kopf = within(await kalender()).getAllByRole('columnheader');
    expect(kopf[0]).toHaveTextContent('Mo');
  });

  it('anderer Tag, andere Uhrzeit: übernommen und geschlossen', async () => {
    const onChange = vi.fn<(d: Dayjs | null) => void>();
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(
      mitZone(
        BERLIN,
        <ZeitpunktEingabe aria-label="Zeit" onChange={onChange} onOpenChange={onOpenChange} />,
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Kalender und Uhrzeit' }));
    const k = await kalender();
    await user.click(
      k.querySelector<HTMLElement>('td[title="20.10.2026"] .ant-picker-cell-inner')!,
    );
    const uhr = within(k).getByRole('textbox', { name: 'Uhrzeit' });
    await user.clear(uhr);
    await user.type(uhr, '0800');
    await user.click(within(k).getByRole('button', { name: 'Übernehmen' }));
    expect(wire(onChange.mock.lastCall![0])).toBe('2026-10-20 06:00:00');
    expect(zeitFeld('Zeit')).toHaveValue('200800okt26');
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it('Enter im Uhrzeitfeld übernimmt; eine falsche Uhrzeit nennt den Grund', async () => {
    const onChange = vi.fn<(d: Dayjs | null) => void>();
    const user = userEvent.setup();
    render(mitZone(BERLIN, <ZeitpunktEingabe aria-label="Zeit" onChange={onChange} />));
    await user.click(screen.getByRole('button', { name: 'Kalender und Uhrzeit' }));
    const uhr = within(await kalender()).getByRole('textbox', { name: 'Uhrzeit' });
    await user.clear(uhr);
    await user.type(uhr, '2575{Enter}');
    expect(screen.getByText('Uhrzeit gibt es nicht')).toBeInTheDocument();
    await user.clear(uhr);
    await user.type(uhr, '0630{Enter}');
    expect(wire(onChange.mock.lastCall![0])).toBe('2026-10-17 04:30:00');
  });

  it('das Uhrzeitfeld nimmt den Fokus nur ohne Fingerbedienung (sonst deckte die Tastatur das Blatt)', async () => {
    const user = userEvent.setup();
    const { unmount } = render(mitZone(BERLIN, <ZeitpunktEingabe aria-label="Zeit" />));
    await user.click(screen.getByRole('button', { name: 'Kalender und Uhrzeit' }));
    const k = await kalender();
    await waitFor(() => expect(within(k).getByRole('textbox', { name: 'Uhrzeit' })).toHaveFocus());
    unmount();

    setzeZeigerGrob(true);
    render(mitZone(BERLIN, <ZeitpunktEingabe aria-label="Zeit" />));
    await user.click(screen.getByRole('button', { name: 'Kalender und Uhrzeit' }));
    const uhr = within(await kalender()).getByRole('textbox', { name: 'Uhrzeit' });
    expect(uhr).not.toHaveFocus();
  });

  it('Escape schließt nur den Kalender', async () => {
    const onOpenChange = vi.fn();
    const aussen = vi.fn();
    const user = userEvent.setup();
    render(
      mitZone(
        BERLIN,
        <div onKeyDown={aussen}>
          <ZeitpunktEingabe aria-label="Zeit" onOpenChange={onOpenChange} />
        </div>,
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Kalender und Uhrzeit' }));
    await kalender();
    await user.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(aussen).not.toHaveBeenCalled();
    // Der Fokus geht ins Feld zurück, nicht auf `<body>`.
    await waitFor(() => expect(zeitFeld('Zeit')).toHaveFocus());
  });

  it('„jetzt“ im Kalender setzt den Zeitpunkt nach Serveruhr', async () => {
    const onChange = vi.fn<(d: Dayjs | null) => void>();
    const user = userEvent.setup();
    render(mitZone(BERLIN, <ZeitpunktEingabe aria-label="Zeit" onChange={onChange} />));
    await user.click(screen.getByRole('button', { name: 'Kalender und Uhrzeit' }));
    await user.click(within(await kalender()).getByRole('button', { name: 'jetzt' }));
    expect(wire(onChange.mock.lastCall![0])).toBe('2026-10-17 13:00:00');
    expect(zeitFeld('Zeit')).toHaveValue('171500okt26');
  });

  it('keine Zukunftstage: der Kalendertag der Anzeigezone zählt', async () => {
    vi.setSystemTime(new Date('2026-07-14T23:30:00Z')); // Berlin: 15.07. 01:30
    const user = userEvent.setup();
    render(
      mitZone(
        BERLIN,
        <ZeitpunktEingabe
          aria-label="Zeit"
          keineZukunftstage
          defaultValue={alsZeitpunkt('2026-07-14 10:00:00')}
        />,
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Kalender und Uhrzeit' }));
    const k = await kalender();
    expect(k.querySelector('td[title="15.07.2026"]')).not.toHaveClass('ant-picker-cell-disabled');
    expect(k.querySelector('td[title="16.07.2026"]')).toHaveClass('ant-picker-cell-disabled');
  });

  it('zeigt die Zone, wenn sie abweicht', async () => {
    const user = userEvent.setup();
    render(mitZone(BERLIN, <ZeitpunktEingabe aria-label="Zeit" />));
    await user.click(screen.getByRole('button', { name: 'Kalender und Uhrzeit' }));
    expect(within(await kalender()).getByText(/Zeiten in/)).toHaveTextContent(
      `Zeiten in ${BERLIN}`,
    );
  });
});

describe('ZeitpunktEingabe — Schnellwahl nach Feldart', () => {
  mitProzessZone('UTC');

  it('„−5 min“ am Feld misst an der Serveruhr', async () => {
    const server = Date.parse('2026-10-17T10:00:00Z');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(server + 5 * 60_000);
    serveruhrVergessenFuerTests();
    merkeServerzeit(new Response(null, { headers: { Date: new Date(server).toUTCString() } }));
    try {
      const onChange = vi.fn<(d: Dayjs | null) => void>();
      const onOk = vi.fn();
      const user = userEvent.setup();
      render(
        mitZone(
          BERLIN,
          <ZeitpunktEingabe
            aria-label="Zeit"
            art="ereignis"
            schnellwahl
            onChange={onChange}
            onOk={onOk}
          />,
        ),
      );
      await user.click(screen.getByRole('button', { name: '−5 min' }));
      const ms = onChange.mock.lastCall![0]!.valueOf();
      expect(Math.abs(ms - (server - 5 * 60_000))).toBeLessThanOrEqual(1_000);
      expect(onOk).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      serveruhrVergessenFuerTests();
    }
  });

  it('Frist zeigt die Vorwärts-Reihe, ohne `schnellwahl` steht sie nur im Kalender', () => {
    const { unmount } = render(
      mitZone(null, <ZeitpunktEingabe aria-label="Frist" art="frist" schnellwahl />),
    );
    expect(
      within(screen.getByRole('group', { name: 'Schnellwahl' }))
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['+15 min', '+30 min', '+1 h', '+2 h']);
    unmount();
    render(mitZone(null, <ZeitpunktEingabe aria-label="Frist" art="frist" />));
    expect(screen.queryByRole('group', { name: 'Schnellwahl' })).not.toBeInTheDocument();
  });
});

describe('ZeitpunktEingabe — gleiche und ungültige Zone', () => {
  mitProzessZone('Europe/Berlin');

  it('zeigt keinen Zonenhinweis bei gleicher Zone und ohne Anzeigezone', () => {
    const { unmount } = render(mitZone(BERLIN, <ZeitpunktEingabe aria-label="Beginn" />));
    expect(screen.queryByText(BERLIN)).not.toBeInTheDocument();
    unmount();
    render(mitZone(null, <ZeitpunktEingabe aria-label="Beginn" />));
    expect(screen.queryByText(/Europe\//)).not.toBeInTheDocument();
  });

  it('ungültige Zone: rendert ohne Absturz, zeigt die Browser-Wanduhr und keinen Hinweis', () => {
    render(
      mitZone(
        'Mars/Olympus',
        <ZeitpunktEingabe aria-label="Beginn" value={alsZeitpunkt('2026-07-14 10:00:00')} />,
      ),
    );
    expect(zeitFeld('Beginn')).toHaveValue('141200jul26');
    expect(screen.queryByText('Mars/Olympus')).not.toBeInTheDocument();
  });

  it('nurTag zeigt und liest einen Kalendertag', () => {
    const onChange = vi.fn<(d: Dayjs | null) => void>();
    render(
      mitZone(
        BERLIN,
        <ZeitpunktEingabe
          aria-label="Tag"
          nurTag
          value={alsZeitpunkt('2026-10-23 22:00:00')}
          onChange={onChange}
        />,
      ),
    );
    expect(zeitFeld('Tag')).toHaveValue('24.10.2026');
    setzeZeit(zeitFeld('Tag'), '25.10.');
    expect(wire(onChange.mock.lastCall![0])).toBe('2026-10-24 22:00:00');
  });
});

describe('ZeitraumEingabe — zwei Felder (Browser UTC, Anzeigezone Berlin)', () => {
  mitProzessZone('UTC');
  uhrSteht('2026-10-17T08:00:00Z');

  it('zeigt beide Enden als DTG und nennt die Zone', () => {
    render(
      mitZone(
        BERLIN,
        <ZeitraumEingabe
          value={[alsZeitpunkt('2026-07-14 10:00:00')!, alsZeitpunkt('2026-07-14 11:30:00')!]}
        />,
      ),
    );
    expect(zeitFeld('Beginn')).toHaveValue('141200jul26');
    expect(zeitFeld('Ende')).toHaveValue('141330jul26');
    expect(screen.getAllByText(BERLIN).length).toBeGreaterThan(0);
  });

  it('Mittag: „1200“ und „1330“ ergeben einen Zeitraum am selben Tag (Screenshot Verpflegung)', async () => {
    const onFinish = vi.fn();
    const user = userEvent.setup();
    render(
      mitZone(
        BERLIN,
        <Form onFinish={onFinish}>
          <Form.Item name="zeitraum" label="Zeitraum">
            <ZeitraumEingabe />
          </Form.Item>
          <button type="submit">Speichern</button>
        </Form>,
      ),
    );
    await tippeZeit(user, zeitFeld('Beginn'), '1200');
    await tippeZeit(user, zeitFeld('Ende'), '1330');
    await waitFor(() => expect(onFinish).toHaveBeenCalled());
    const [von, bis] = onFinish.mock.lastCall![0].zeitraum as Zeitraum;
    expect([wire(von), wire(bis)]).toEqual(['2026-10-17 10:00:00', '2026-10-17 11:30:00']);
  });

  it('über Mitternacht: ein Ende vor dem Beginn liegt am Folgetag', async () => {
    const onChange = vi.fn<(z: Zeitraum | null) => void>();
    render(
      mitZone(
        BERLIN,
        <ZeitraumEingabe
          value={[alsZeitpunkt('2026-10-17 20:00:00')!, null]}
          onChange={onChange}
        />,
      ),
    );
    setzeZeit(zeitFeld('Ende'), '0600');
    expect(wire(onChange.mock.lastCall![0]![1])).toBe('2026-10-18 04:00:00');
    expect(zeitFeld('Ende')).toHaveValue('');
  });
});

describe('ZeitpunktEingabe — stabil über Re-Render', () => {
  mitProzessZone('UTC');

  it('getippter Text bleibt, wenn das Elternteil neu rendert', async () => {
    const onChange = vi.fn<(d: Dayjs | null) => void>();
    const wert = alsZeitpunkt('2026-07-14 10:00:00');
    function Huelle({ takt }: { takt: number }) {
      return mitZone(
        BERLIN,
        <ZeitpunktEingabe aria-label="Beginn" value={wert} onChange={onChange} data-takt={takt} />,
      );
    }
    const user = userEvent.setup();
    const { rerender } = render(<Huelle takt={0} />);
    await user.clear(zeitFeld('Beginn'));
    await user.type(zeitFeld('Beginn'), '201200jul26');
    rerender(<Huelle takt={1} />);
    await user.keyboard('{Enter}');
    expect(wire(onChange.mock.lastCall![0])).toBe('2026-07-20 10:00:00');
  });
});

describe('ZeitpunktEingabe — Ref des Aufrufers', () => {
  it('ruft eine Ref-Funktion nur beim Einhängen, nicht bei jedem Rendern (ETB-Chip fokussiert darüber)', async () => {
    const ref = vi.fn();
    const user = userEvent.setup();
    render(
      mitZone(
        null,
        <>
          <ZeitpunktEingabe aria-label="Zeit" ref={ref} />
          <input aria-label="Inhalt" />
        </>,
      ),
    );
    await user.type(zeitFeld('Zeit'), '14');
    await user.click(screen.getByRole('textbox', { name: 'Inhalt' }));
    expect(ref.mock.calls.filter(([el]) => el !== null)).toHaveLength(1);
    expect(screen.getByRole('textbox', { name: 'Inhalt' })).toHaveFocus();
  });
});

describe('ZeitpunktEingabe — Blatt, wo der Kalender nicht neben das Feld passt (LFH-953, LFH-1076)', () => {
  /** Das offene Popover des Kalenders. */
  const popup = () =>
    waitFor(() => {
      const p = document.querySelector<HTMLElement>('.ant-popover');
      expect(p).not.toBeNull();
      return p!;
    });

  it('öffnet unter md als Blatt', async () => {
    setzeViewportBreite(390);
    render(mitZone(null, <ZeitpunktEingabe aria-label="von" open />));
    expect(await popup()).toHaveClass(ZEIT_BLATT);
  });

  it('lässt den Kalender ab md am Feld', async () => {
    render(mitZone(null, <ZeitpunktEingabe aria-label="von" open />));
    expect(await popup()).not.toHaveClass(ZEIT_BLATT);
  });

  it('die Schwelle wächst mit der Stufe: kompakt ab md, komfortabel ab xxl, Handschuh nie', () => {
    expect(zeitPanelAmFeldAb({ controlHeight: 30 })).toBe('md');
    expect(zeitPanelAmFeldAb({ controlHeight: 48 })).toBe('xxl');
    expect(zeitPanelAmFeldAb({ controlHeight: 72 })).toBeNull();
  });

  /** Stufe über das Dichte-Token, wie der `ConfigProvider` der App sie setzt. */
  const inStufe = (controlHeight: number, kind: ReactNode) => (
    <ConfigProvider theme={{ token: { controlHeight } }}>{mitZone(null, kind)}</ConfigProvider>
  );

  it('öffnet auf dem Führungs-Tablet in komfortabel und Handschuh als Blatt', async () => {
    for (const controlHeight of [48, 72]) {
      const { unmount } = render(
        inStufe(controlHeight, <ZeitpunktEingabe aria-label="von" open />),
      );
      expect(await popup()).toHaveClass(ZEIT_BLATT);
      unmount();
    }
  });

  it('in Handschuh nie am Feld, in komfortabel ab xxl', async () => {
    setzeViewportBreite(1600);
    const { unmount } = render(inStufe(48, <ZeitpunktEingabe aria-label="von" open />));
    expect(await popup()).not.toHaveClass(ZEIT_BLATT);
    unmount();
    setzeViewportBreite(2560);
    render(inStufe(72, <ZeitpunktEingabe aria-label="von" open />));
    expect(await popup()).toHaveClass(ZEIT_BLATT);
  });

  it('das Feld bleibt auch mit Fingerbedienung beschreibbar (getippt wird im Feld)', () => {
    setzeViewportBreite(390);
    setzeZeigerGrob(true);
    render(mitZone(null, <ZeitpunktEingabe aria-label="von" />));
    expect(zeitFeld('von')).not.toHaveAttribute('readonly');
  });

  it('die Regeln des Blatts stehen fest am unteren Rand', () => {
    // jsdom rechnet kein Layout; den Vertrag belegt `e2e/dialoge-handy.spec.ts` im Browser.
    const css = readFileSync(join(process.cwd(), 'src/anzeige/ZeitpunktEingabe.css'), 'utf8');
    expect(css).toMatch(
      new RegExp(`\\.${ZEIT_BLATT}\\.ant-popover \\{[^}]*position: fixed !important;`),
    );
    expect(css).toMatch(/max-height: 85dvh;/);
  });
});
