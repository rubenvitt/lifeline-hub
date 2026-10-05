import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Form } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc';
import type { ReactNode } from 'react';
import { mitProzessZone } from '../test/prozessZone';
import { AnzeigeKonventionenProvider } from './AnzeigeKonventionenContext';
import { ZeitpunktEingabe, ZeitraumEingabe, type Zeitraum } from './ZeitpunktEingabe';
import { alsBackendZeit, alsZeitpunkt } from './zeitEingabe';
import { merkeServerzeit, serveruhrVergessenFuerTests } from '../offline/serveruhr';

dayjs.extend(utc);

function mitZone(zone: string | null, kind: ReactNode) {
  return (
    <AnzeigeKonventionenProvider konventionen={{ zeitzone: zone }}>
      {kind}
    </AnzeigeKonventionenProvider>
  );
}

describe('ZeitpunktEingabe — Browser UTC, Anzeigezone Europe/Berlin (LFH-692)', () => {
  mitProzessZone('UTC');

  it('zeigt einen Zeitpunkt mit der Berliner Wanduhr', () => {
    render(
      mitZone(
        'Europe/Berlin',
        <ZeitpunktEingabe
          aria-label="Beginn"
          format="YYYY-MM-DD HH:mm"
          value={alsZeitpunkt('2026-07-14 10:00:00')}
        />,
      ),
    );
    expect(screen.getByRole('textbox', { name: 'Beginn' })).toHaveValue('2026-07-14 12:00');
  });

  it('eine eingetippte 13:00 kommt als Zeitpunkt 11:00 UTC heraus', async () => {
    const onChange = vi.fn<(d: Dayjs | null) => void>();
    const user = userEvent.setup();
    render(
      mitZone(
        'Europe/Berlin',
        <ZeitpunktEingabe aria-label="Beginn" format="YYYY-MM-DD HH:mm" onChange={onChange} />,
      ),
    );
    const feld = screen.getByRole('textbox', { name: 'Beginn' });
    await user.click(feld);
    await user.type(feld, '2026-07-14 13:00');
    fireEvent.keyDown(feld, { key: 'Enter' });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(alsBackendZeit(onChange.mock.lastCall![0]!)).toBe('2026-07-14 11:00:00');
  });

  it('im Formular: Speichern ohne Berührung liefert den gelesenen Zeitpunkt unverändert', async () => {
    const onFinish = vi.fn();
    render(
      mitZone(
        'Europe/Berlin',
        <Form onFinish={onFinish} initialValues={{ t: alsZeitpunkt('2026-10-24 23:30:00') }}>
          <Form.Item name="t" label="Zeit">
            <ZeitpunktEingabe format="YYYY-MM-DD HH:mm" />
          </Form.Item>
          <button type="submit">ok</button>
        </Form>,
      ),
    );
    expect(screen.getByRole('textbox', { name: 'Zeit' })).toHaveValue('2026-10-25 01:30');
    fireEvent.click(screen.getByRole('button', { name: 'ok' }));
    await waitFor(() => expect(onFinish).toHaveBeenCalled());
    expect(alsBackendZeit(onFinish.mock.lastCall![0].t)).toBe('2026-10-24 23:30:00');
  });

  it('„Jetzt“ im Panel setzt den aktuellen Zeitpunkt und zeigt ihn in Berlin', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-14T10:00:00Z'));
    try {
      const onChange = vi.fn<(d: Dayjs | null) => void>();
      const user = userEvent.setup();
      render(
        mitZone(
          'Europe/Berlin',
          <ZeitpunktEingabe aria-label="Beginn" format="YYYY-MM-DD HH:mm" onChange={onChange} />,
        ),
      );
      await user.click(screen.getByRole('textbox', { name: 'Beginn' }));
      await user.click(await screen.findByRole('button', { name: 'Jetzt' }));
      expect(alsBackendZeit(onChange.mock.lastCall![0]!)).toBe('2026-07-14 10:00:00');
      expect(screen.getByRole('textbox', { name: 'Beginn' })).toHaveValue('2026-07-14 12:00');
    } finally {
      vi.useRealTimers();
    }
  });

  it('„Jetzt“ auf einem 5 min vorgehenden Gerät setzt die Serverzeit (LFH-895)', async () => {
    const server = Date.parse('2026-07-14T10:00:00Z');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(server + 5 * 60_000);
    serveruhrVergessenFuerTests();
    merkeServerzeit(new Response(null, { headers: { Date: new Date(server).toUTCString() } }));
    try {
      const onChange = vi.fn<(d: Dayjs | null) => void>();
      const user = userEvent.setup();
      render(
        mitZone(
          'Europe/Berlin',
          <ZeitpunktEingabe aria-label="Beginn" format="YYYY-MM-DD HH:mm" onChange={onChange} />,
        ),
      );
      await user.click(screen.getByRole('textbox', { name: 'Beginn' }));
      await user.click(await screen.findByRole('button', { name: 'Jetzt' }));
      expect(Math.abs(onChange.mock.lastCall![0]!.valueOf() - server)).toBeLessThanOrEqual(1_000);
      expect(screen.getByRole('textbox', { name: 'Beginn' })).toHaveValue('2026-07-14 12:00');
    } finally {
      vi.useRealTimers();
      serveruhrVergessenFuerTests();
    }
  });

  it('nennt die Anzeigezone, weil sie von der Browserzone abweicht', () => {
    render(mitZone('Europe/Berlin', <ZeitpunktEingabe aria-label="Beginn" />));
    expect(screen.getByText('Europe/Berlin')).toBeInTheDocument();
  });

  it('keineZukunftstage: der Kalendertag der Anzeigezone zählt, nicht der des Browsers', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-14T23:30:00Z')); // Berlin: 15.07. 01:30
    try {
      const user = userEvent.setup();
      render(
        mitZone(
          'Europe/Berlin',
          <ZeitpunktEingabe
            aria-label="Beginn"
            keineZukunftstage
            defaultValue={alsZeitpunkt('2026-07-14 10:00:00')}
          />,
        ),
      );
      await user.click(screen.getByRole('textbox', { name: 'Beginn' }));
      const zelle = (tag: string) =>
        document.querySelector(`td[title="${tag}"]`) as HTMLElement | null;
      await waitFor(() => expect(zelle('2026-07-15')).not.toBeNull());
      expect(zelle('2026-07-15')).not.toHaveClass('ant-picker-cell-disabled');
      expect(zelle('2026-07-16')).toHaveClass('ant-picker-cell-disabled');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('ZeitpunktEingabe — gleiche Zone', () => {
  mitProzessZone('Europe/Berlin');

  it('zeigt keinen Zonenhinweis', () => {
    render(mitZone('Europe/Berlin', <ZeitpunktEingabe aria-label="Beginn" />));
    expect(screen.queryByText('Europe/Berlin')).not.toBeInTheDocument();
  });

  it('ohne Anzeigezone (Browserzone) ebenfalls keinen', () => {
    render(mitZone(null, <ZeitpunktEingabe aria-label="Beginn" />));
    expect(screen.queryByText(/Europe\//)).not.toBeInTheDocument();
  });
});

describe('ZeitpunktEingabe — ungültige Zone (Spec-Szenario „Ungültige Zone“)', () => {
  mitProzessZone('Europe/Berlin');

  it('rendert ohne Absturz, zeigt die Browser-Wanduhr und keinen Zonenhinweis', () => {
    render(
      mitZone(
        'Mars/Olympus',
        <ZeitpunktEingabe
          aria-label="Beginn"
          format="YYYY-MM-DD HH:mm"
          value={alsZeitpunkt('2026-07-14 10:00:00')}
        />,
      ),
    );
    expect(screen.getByRole('textbox', { name: 'Beginn' })).toHaveValue('2026-07-14 12:00');
    expect(screen.queryByText('Mars/Olympus')).not.toBeInTheDocument();
  });
});

describe('ZeitraumEingabe — Browser UTC, Anzeigezone Europe/Berlin', () => {
  mitProzessZone('UTC');

  it('zeigt beide Enden mit der Berliner Wanduhr', () => {
    render(
      mitZone(
        'Europe/Berlin',
        <ZeitraumEingabe
          format="YYYY-MM-DD HH:mm"
          placeholder={['Beginn', 'Ende']}
          value={[alsZeitpunkt('2026-07-14 10:00:00')!, alsZeitpunkt('2026-07-14 11:30:00')!]}
        />,
      ),
    );
    expect(screen.getByPlaceholderText('Beginn')).toHaveValue('2026-07-14 12:00');
    expect(screen.getByPlaceholderText('Ende')).toHaveValue('2026-07-14 13:30');
    expect(screen.getByText('Europe/Berlin')).toBeInTheDocument();
  });
});

/**
 * Review LFH-692: ein Re-Render bei offenem Panel darf eine noch nicht bestätigte Wahl nicht
 * verwerfen. rc-picker setzt Kalender- und Übernahmewert zurück, sobald `value` die IDENTITÄT
 * wechselt; der Baustein gibt deshalb nur bei einem anderen Zeitpunkt ein neues Objekt weiter.
 * Auslöser in echt: die Verpflegung rendert alle 30 s (`useUhr`).
 */
describe('ZeitpunktEingabe/ZeitraumEingabe — stabil über Re-Render', () => {
  mitProzessZone('UTC');
  const BERLIN = 'Europe/Berlin';

  it('Einzel: Tag wählen, Elternteil rendert neu, OK — die Wahl kommt an', async () => {
    const onChange = vi.fn<(d: Dayjs | null) => void>();
    const wert = alsZeitpunkt('2026-07-14 10:00:00');
    function Huelle({ takt }: { takt: number }) {
      return mitZone(
        BERLIN,
        <ZeitpunktEingabe
          aria-label="Beginn"
          format="YYYY-MM-DD HH:mm"
          value={wert}
          onChange={onChange}
          data-takt={takt}
        />,
      );
    }
    const user = userEvent.setup();
    const { rerender } = render(<Huelle takt={0} />);
    await user.click(screen.getByRole('textbox', { name: 'Beginn' }));
    const zelle = await waitFor(() => {
      const z = document.querySelector<HTMLElement>('td[title="2026-07-20"]');
      expect(z).not.toBeNull();
      return z!;
    });
    await user.click(zelle);
    rerender(<Huelle takt={1} />);
    await user.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(alsBackendZeit(onChange.mock.lastCall![0]!)).toBe('2026-07-20 10:00:00');
  });

  it('Bereich: Beginn mit OK bestätigt, Elternteil rendert neu, Ende gewählt — beide kommen an', async () => {
    const onChange = vi.fn<(z: Zeitraum | null) => void>();
    const wert: Zeitraum = [
      alsZeitpunkt('2026-07-14 10:00:00')!,
      alsZeitpunkt('2026-07-14 11:30:00')!,
    ];
    function Huelle({ takt }: { takt: number }) {
      return mitZone(
        BERLIN,
        <ZeitraumEingabe
          format="YYYY-MM-DD HH:mm"
          placeholder={['Beginn', 'Ende']}
          value={wert}
          onChange={onChange}
          data-takt={takt}
        />,
      );
    }
    const user = userEvent.setup();
    const { rerender } = render(<Huelle takt={0} />);
    await user.click(screen.getByPlaceholderText('Beginn'));
    const zelle = (tag: string) =>
      waitFor(() => {
        const z = document.querySelector<HTMLElement>(`td[title="${tag}"]`);
        expect(z).not.toBeNull();
        return z!;
      });
    await user.click(await zelle('2026-07-15'));
    await user.click(screen.getByRole('button', { name: 'OK' }));
    rerender(<Huelle takt={1} />);
    await user.click(await zelle('2026-07-16'));
    await user.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const [von, bis] = onChange.mock.lastCall![0]!;
    expect(alsBackendZeit(von!)).toBe('2026-07-15 10:00:00');
    expect(alsBackendZeit(bis!)).toBe('2026-07-16 11:30:00');
  });
});
