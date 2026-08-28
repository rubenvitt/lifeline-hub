import { describe, expect, it } from 'vitest';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { imZeitfenster, tagesEtikett, tagesSchluessel } from './zeitachse';

dayjs.extend(utc);

describe('zeitachse', () => {
  it('bildet den Tagesschlüssel in der Anzeigezone, nicht in UTC', () => {
    // 23:30 UTC ist in Berlin (Sommer, +2) schon der 13. — ein `dayjs(s)`-Leser käme auf
    // den 12. und hängte den Eintrag unter den falschen Tageskopf.
    expect(tagesSchluessel('2026-06-12 23:30:00', { zeitzone: 'Europe/Berlin' })).toBe('2026-06-13');
    expect(tagesSchluessel('2026-06-12 23:30:00', { zeitzone: 'UTC' })).toBe('2026-06-12');
  });

  it('etikettiert Heute, Gestern und sonst das Datum', () => {
    const jetzt = dayjs('2026-06-13 10:00:00');
    expect(tagesEtikett('2026-06-13', jetzt)).toBe('Heute');
    expect(tagesEtikett('2026-06-12', jetzt)).toBe('Gestern');
    expect(tagesEtikett('2026-06-01', jetzt)).toBe('01.06.2026');
  });

  it('Zeitfenster: Grenzen einschließend, in der Anzeigezone', () => {
    const jetzt = dayjs.utc('2026-06-13 10:00:00').local();
    expect(imZeitfenster('2026-06-13 09:01:00', 'stunde', jetzt)).toBe(true);
    expect(imZeitfenster('2026-06-13 08:59:00', 'stunde', jetzt)).toBe(false);
    expect(imZeitfenster('2026-06-13 06:01:00', 'vierStunden', jetzt)).toBe(true);
    expect(imZeitfenster('2026-06-13 05:59:00', 'vierStunden', jetzt)).toBe(false);
    // „Heute" kippt an der Tagesgrenze der ZONE: 22:30 UTC am 12. ist in Berlin der 13.
    const berlin = { zeitzone: 'Europe/Berlin' };
    const jetztBerlin = dayjs.utc('2026-06-13 10:00:00').tz('Europe/Berlin');
    expect(imZeitfenster('2026-06-12 22:30:00', 'heute', jetztBerlin, berlin)).toBe(true);
    expect(imZeitfenster('2026-06-12 21:30:00', 'heute', jetztBerlin, berlin)).toBe(false);
  });
});
