import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { describe, expect, it } from 'vitest';
import { parseNachforderungVorbelegung, nachforderungenPfad } from '../routing/deeplinks';
import { KEINE_SONDERKOST, zeitfenster } from '../test/verpflegungDaten';
import {
  belegteKostformen,
  nachforderungVorbelegung,
  sonderkostText,
  uhrzeitenText,
  zeitfensterKennung,
  zeitraumText,
} from './verpflegungText';

dayjs.extend(utc);
dayjs.extend(timezone);

const BERLIN = { zeitzone: 'Europe/Berlin' };

describe('Zeitraumtexte (Zeitzone der Anzeige, nicht UTC)', () => {
  it('nennt 10:00–11:30 UTC im Sommer als 12:00–13:30 in Berlin', () => {
    const zf = zeitfenster();
    expect(zeitraumText(zf, BERLIN)).toBe('24.09. 12:00–13:30');
    expect(uhrzeitenText(zf, BERLIN)).toBe('12:00–13:30');
    expect(zeitfensterKennung(zf, BERLIN)).toBe('Mittag 24.09. 12:00–13:30');
  });

  it('beidseits der Sommerzeitgrenzen gegen den absoluten Zeitpunkt', () => {
    // 29.03.2026 01:00 UTC ist die Umstellung, 25.10.2026 01:00 UTC die Rückstellung.
    expect(
      zeitraumText({ von_at: '2026-03-29 00:30:00', bis_at: '2026-03-29 01:30:00' }, BERLIN),
    ).toBe('29.03. 01:30–03:30');
    expect(
      zeitraumText({ von_at: '2026-10-25 00:30:00', bis_at: '2026-10-25 01:30:00' }, BERLIN),
    ).toBe('25.10. 02:30–02:30');
  });

  it('über Mitternacht mit beiden Daten, wie `zeitraum_text` im Backend', () => {
    expect(
      zeitraumText({ von_at: '2026-09-24 20:00:00', bis_at: '2026-09-25 00:30:00' }, BERLIN),
    ).toBe('24.09. 22:00–25.09. 02:30');
  });

  it('ohne Zeitzone gilt die Ortszeit des Browsers (dayjs.utc(…).local())', () => {
    const zf = zeitfenster();
    const erwartet = `${dayjs.utc(zf.von_at).local().format('HH:mm')}–${dayjs
      .utc(zf.bis_at)
      .local()
      .format('HH:mm')}`;
    expect(uhrzeitenText(zf)).toBe(erwartet);
  });
});

describe('Sonderkost', () => {
  it('belegt ist, was im Bedarf ODER in der Ausgabe vorkommt — in fester Reihenfolge', () => {
    expect(
      belegteKostformen({ ...KEINE_SONDERKOST, vegan: 3 }, { ...KEINE_SONDERKOST, vegetarisch: 1 }),
    ).toEqual(['vegetarisch', 'vegan']);
    expect(belegteKostformen(KEINE_SONDERKOST)).toEqual([]);
  });

  it('nennt nur belegte Kostformen', () => {
    expect(sonderkostText({ ...KEINE_SONDERKOST, vegan: 3, ohne_schwein: 2 })).toBe(
      'davon 3 vegan, 2 ohne Schweinefleisch',
    );
    expect(sonderkostText(KEINE_SONDERKOST)).toBe('');
  });
});

describe('nachforderungVorbelegung (design.md D9)', () => {
  it('Art, Bezeichnung mit Zeitraum, Anzahl = Fehlmenge, Begründung mit Bedarf und Ausgabe', () => {
    expect(nachforderungVorbelegung(zeitfenster(), BERLIN)).toStrictEqual({
      art: 'Verpflegung',
      bezeichnung: 'Essensportionen ‚Mittag‘ 12:00–13:30',
      anzahl: 20,
      begruendung: 'Unterdeckung Verpflegung ‚Mittag‘: Bedarf 250, ausgegeben 230.',
    });
  });

  it('überlebt den Weg durch die Adresse unverändert', () => {
    const v = nachforderungVorbelegung(zeitfenster(), BERLIN)!;
    const pfad = nachforderungenPfad(1, { vorbelegung: v });
    const params = new URLSearchParams(pfad.slice(pfad.indexOf('?')));
    expect(parseNachforderungVorbelegung(params)).toStrictEqual(v);
  });

  it('ohne jede Fehlmenge keine Vorbelegung', () => {
    expect(
      nachforderungVorbelegung(
        zeitfenster({ fehlmenge: { gesamt: 0, sonderkost: KEINE_SONDERKOST } }),
      ),
    ).toBeNull();
  });

  it('Fehlmenge nur in einer Kostform: Anzahl ist die fehlende Sonderkost, Begründung nennt sie', () => {
    expect(
      nachforderungVorbelegung(
        zeitfenster({
          ausgegeben: { gesamt: 250, sonderkost: KEINE_SONDERKOST },
          fehlmenge: { gesamt: 0, sonderkost: { ...KEINE_SONDERKOST, vegan: 3 } },
        }),
        BERLIN,
      ),
    ).toStrictEqual({
      art: 'Verpflegung',
      bezeichnung: 'Essensportionen ‚Mittag‘ 12:00–13:30',
      anzahl: 3,
      begruendung:
        'Unterdeckung Verpflegung ‚Mittag‘: Bedarf 250, ausgegeben 250. Es fehlt Sonderkost: 3 vegan.',
    });
  });

  it('Fehlmenge gesamt und in Kostformen: Anzahl ist die Gesamtfehlmenge, Sonderkost in der Begründung', () => {
    const v = nachforderungVorbelegung(
      zeitfenster({
        fehlmenge: { gesamt: 20, sonderkost: { ...KEINE_SONDERKOST, vegan: 3, vegetarisch: 2 } },
      }),
      BERLIN,
    )!;
    expect(v.anzahl).toBe(20);
    expect(v.begruendung).toBe(
      'Unterdeckung Verpflegung ‚Mittag‘: Bedarf 250, ausgegeben 230. Es fehlt Sonderkost: 2 vegetarisch, 3 vegan.',
    );
  });
});
