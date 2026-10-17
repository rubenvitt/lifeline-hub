import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import type { Abloesung } from '../api/types';
import { renderMitProviders } from '../test/utils';
import { farbenHell } from '../theme/tokens';
import AbloesungKarte from './AbloesungKarte';
import type { AbloeserStand } from './abloeserStand';

dayjs.extend(utc);

const jetzt = dayjs.utc('2026-10-17 12:00:00');

const schicht = (over: Partial<Abloesung> = {}): Abloesung => ({
  id: 1,
  einsatz_id: 1,
  einheit_id: 11,
  einheit_name: 'Zug 1',
  abschnitt_id: 7,
  abschnitt_name: 'Deich',
  beginn_at: '2026-10-17 06:00:00',
  rhythmus_minuten: 360,
  vorwarnung_minuten: 30,
  rhythmus_quelle: 'einsatz',
  faellig_at: '2026-10-17 15:00:00',
  status: 'laufend',
  ruecknehmbar: false,
  erbende_einheiten: [],
  abloeser: [],
  folgeschichten: [],
  uebernommen_bei_vollzug: false,
  abschnitt_uebergeben: false,
  planung_warnungen: [],
  angelegt_at: '2026-10-17 06:00:00',
  ...over,
});

const zeige = (s: Abloesung, darfSchreiben = true) =>
  renderMitProviders(
    <AbloesungKarte
      schicht={s}
      jetzt={jetzt}
      darfSchreiben={darfSchreiben}
      onVollziehen={() => {}}
      onZuruecknehmen={() => {}}
    />,
  );

const zeitspalte = () => {
  const zeit = document.querySelector<HTMLElement>('[data-lfh="abloesung-zeit"]')!;
  return { zeit: zeit.textContent, wort: zeit.nextElementSibling?.textContent };
};

describe('AbloesungKarte — Ende und Vererbung (LLH-1128)', () => {
  it('eine mit der Entlassung beendete Schicht heißt „beendet · entlassen“ mit Uhrzeit, nicht „abgelöst“', () => {
    zeige(
      schicht({
        status: 'beendet',
        beendet_grund: 'entlassung',
        beendet_at: '2026-10-17 10:12:00',
      }),
    );
    const karte = screen.getByRole('article', { name: 'Schicht Zug 1' });
    expect(zeitspalte().wort).toBe('beendet');
    const ende = karte.querySelector<HTMLElement>('[data-lfh="abloesung-ende"]');
    expect(ende).toHaveTextContent(/^beendet · entlassen \d{4}$/);
    expect(within(karte).queryByText(/abgelöst/i)).toBeNull();
    // Beendet ist nicht laufend: keine Fälligkeit, keine Aktionen, keine Rücknahme.
    expect(karte.querySelector('[data-lfh="abloesung-abstand"]')).toBeNull();
    expect(within(karte).queryByRole('button')).toBeNull();
  });

  it('eine beim Auflösen beendete Schicht heißt „beendet · aufgelöst“', () => {
    zeige(
      schicht({
        status: 'beendet',
        beendet_grund: 'aufloesung',
        beendet_at: '2026-10-17 10:12:00',
      }),
    );
    expect(document.querySelector('[data-lfh="abloesung-ende"]')).toHaveTextContent(
      /^beendet · aufgelöst$/,
    );
  });

  it('die Zeitspalte einer beendeten Schicht zeigt das Ende, die einer abgelösten den Vollzug', () => {
    const { unmount } = zeige(
      schicht({
        status: 'beendet',
        beendet_grund: 'entlassung',
        beendet_at: '2026-10-17 10:12:00',
      }),
    );
    const beendet = zeitspalte().zeit;
    unmount();
    zeige(schicht({ status: 'abgeloest', vollzogen_at: '2026-10-17 10:12:00' }));
    expect(zeitspalte()).toEqual({ zeit: beendet, wort: 'abgelöst' });
    expect(document.querySelector('[data-lfh="abloesung-ende"]')).toBeNull();
  });

  it('die tragende Schicht nennt ihre erbenden Untereinheiten in einer Zeile', () => {
    zeige(
      schicht({
        erbende_einheiten: [
          { einheit_id: 12, einheit_name: '1. Trupp' },
          { einheit_id: 13, einheit_name: '2. Trupp' },
        ],
      }),
    );
    const erben = document.querySelector<HTMLElement>('[data-lfh="abloesung-erben"]');
    expect(erben).toHaveTextContent(/^gilt auch für: 1\. Trupp, 2\. Trupp$/);
    // Einzeilig, der ganze Text im Titel: ein neuer Erbe ändert die Kartenhöhe nicht.
    expect(erben).toHaveAttribute('title', 'gilt auch für: 1. Trupp, 2. Trupp');
    expect(erben!.style.whiteSpace).toBe('nowrap');
  });

  it('ohne Erben keine Zeile', () => {
    zeige(schicht());
    expect(document.querySelector('[data-lfh="abloesung-erben"]')).toBeNull();
  });
});

/** Ein Wert so, wie jsdom ihn im `style` ablegt (Muster `kommunikation/KommKarte.test.tsx`). */
function wieGesetzt(eigenschaft: 'boxShadow' | 'background' | 'color', wert: string) {
  const probe = document.createElement('div');
  probe.style[eigenschaft] = wert;
  return probe.style[eigenschaft];
}

const geplant = schicht({ abloeser: [{ einheit_id: 21, einheit_name: '2. Rettungsstaffel' }] });

const stand = (over: Partial<AbloeserStand> = {}): AbloeserStand => ({
  einheit_id: 21,
  einheit_name: '2. Rettungsstaffel',
  alarmiert_at: '2026-10-17 11:40:00',
  eingetroffen_at: '2026-10-17 12:12:00',
  br_name: 'BR Sportplatz',
  ...over,
});

const abloeserZeile = () => document.querySelector<HTMLElement>('[data-lfh="abloesung-abloeser"]')!;

describe('AbloesungKarte — Stand der ablösenden Einheit (LLH-1131 Teil II)', () => {
  it('ohne Stand bleibt „Ablösung geplant durch …“', () => {
    renderMitProviders(<AbloesungKarte schicht={geplant} jetzt={jetzt} darfSchreiben={false} />);
    expect(abloeserZeile()).toHaveTextContent(/^Ablösung geplant durch 2\. Rettungsstaffel$/);
  });

  it('mit Stand nennt dieselbe Zeile Alarmierung, Eintreffen und Raum, Zeiten in Mono', () => {
    renderMitProviders(
      <AbloesungKarte
        schicht={geplant}
        jetzt={jetzt}
        darfSchreiben={false}
        abloeserStand={[stand()]}
      />,
    );
    const zeile = abloeserZeile();
    expect(zeile).toHaveTextContent(
      /^Ablösung: 2\. Rettungsstaffel · alarmiert \d{4} · eingetroffen \d{4} \(BR Sportplatz\)$/,
    );
    expect(zeile.title).toBe(zeile.textContent);
    // Einzeilig: ein neues Ereignis ändert die Kartenhöhe nicht (LFH-708).
    expect(zeile.style.whiteSpace).toBe('nowrap');
    expect(zeile.style.textOverflow).toBe('ellipsis');
    const zeiten = zeile.querySelectorAll<HTMLElement>('[data-lfh="abloesung-abloeser-zeit"]');
    expect(zeiten).toHaveLength(2);
    for (const z of zeiten) expect(z.style.fontVariantNumeric).toBe('tabular-nums');
    // Eine Zeile, nicht zwei: „geplant durch“ fällt weg.
    expect(document.body).not.toHaveTextContent(/geplant durch/);
  });

  it('mehrere Ablöser bleiben in einer Zeile, der volle Text steht im Titel', () => {
    renderMitProviders(
      <AbloesungKarte
        schicht={schicht({
          abloeser: [
            { einheit_id: 21, einheit_name: '2. Rettungsstaffel' },
            { einheit_id: 22, einheit_name: 'Florian 3' },
          ],
        })}
        jetzt={jetzt}
        darfSchreiben={false}
        abloeserStand={[
          stand({ br_name: null, eingetroffen_at: null }),
          stand({
            einheit_id: 22,
            einheit_name: 'Florian 3',
            alarmiert_at: null,
            eingetroffen_at: null,
            br_name: null,
          }),
        ]}
      />,
    );
    const zeile = abloeserZeile();
    expect(zeile).toHaveTextContent(/^Ablösung: 2\. Rettungsstaffel · alarmiert \d{4}; Florian 3$/);
    expect(zeile.title).toBe(zeile.textContent);
    expect(zeile.style.whiteSpace).toBe('nowrap');
  });

  it('eine abgelöste Schicht zeigt keinen Stand, sondern „Abgelöst durch …“', () => {
    renderMitProviders(
      <AbloesungKarte
        schicht={schicht({
          status: 'abgeloest',
          vollzogen_at: '2026-10-17 11:00:00',
          abloeser: [{ einheit_id: 21, einheit_name: '2. Rettungsstaffel' }],
        })}
        jetzt={jetzt}
        darfSchreiben={false}
        abloeserStand={[stand()]}
      />,
    );
    expect(abloeserZeile()).toHaveTextContent(/^Abgelöst durch 2\. Rettungsstaffel$/);
  });
});

describe('AbloesungKarte — Warnungen zur Planung (LLH-1131 Teil II)', () => {
  const mitWarnungen = schicht({
    abloeser: [{ einheit_id: 21, einheit_name: '2. Rettungsstaffel' }],
    planung_warnungen: [
      {
        art: 'schon_geplant',
        einheit_id: 21,
        einheit_name: '2. Rettungsstaffel',
        abloesung_id: 9,
        abloesung_einheit_name: 'Florian 1',
      },
      {
        art: 'im_einsatz',
        einheit_id: 21,
        einheit_name: '2. Rettungsstaffel',
        seit_at: '2026-10-17 06:40:00',
      },
    ],
  });

  it('stehen im Wortlaut der Meldung in einer Zeile in der Rolle Achtung, nicht in Rot', () => {
    renderMitProviders(
      <AbloesungKarte schicht={mitWarnungen} jetzt={jetzt} darfSchreiben={false} />,
    );
    const zeile = document.querySelector<HTMLElement>('[data-lfh="abloesung-planung-warnung"]')!;
    expect(zeile).toHaveTextContent(
      /^2\. Rettungsstaffel schon für Schicht Florian 1 geplant · 2\. Rettungsstaffel steht selbst im Einsatz seit \d{4}$/,
    );
    expect(zeile.title).toBe(zeile.textContent);
    expect(zeile.style.whiteSpace).toBe('nowrap');
    expect(zeile.style.color).toBe(wieGesetzt('color', farbenHell.achtungText));
    expect(zeile.style.color).not.toBe(wieGesetzt('color', farbenHell.alarmText));
    // Die Warnung ist keine Einstufung: die Kante bleibt neutral, nichts wird alarmiert.
    const karte = screen.getByRole('article', { name: 'Schicht Zug 1' });
    expect(karte).toHaveAttribute('data-einstufung', 'planmaessig');
    expect(karte).not.toHaveAttribute('data-alarm');
  });

  it('ohne Warnung keine Zeile', () => {
    renderMitProviders(<AbloesungKarte schicht={geplant} jetzt={jetzt} darfSchreiben={false} />);
    expect(document.querySelector('[data-lfh="abloesung-planung-warnung"]')).toBeNull();
  });

  it('eine abgelöste Schicht zeigt keine Warnung', () => {
    renderMitProviders(
      <AbloesungKarte
        schicht={{ ...mitWarnungen, status: 'abgeloest', vollzogen_at: '2026-10-17 11:00:00' }}
        jetzt={jetzt}
        darfSchreiben={false}
      />,
    );
    expect(document.querySelector('[data-lfh="abloesung-planung-warnung"]')).toBeNull();
  });
});

describe('AbloesungKarte — Deeplink-Hervorhebung (LLH-1131 Teil II, Spec `deeplink-hervorhebung`)', () => {
  const LINIEN = `inset 0 2px 0 ${farbenHell.bedien}, inset 0 -2px 0 ${farbenHell.bedien}`;
  const karte = () => screen.getByRole('article', { name: 'Schicht Zug 1' });

  it('trägt angesprungen Bedienfläche und Ober-/Unterlinie, keinen Ring, und ihre Kennung', () => {
    renderMitProviders(
      <AbloesungKarte schicht={schicht()} jetzt={jetzt} darfSchreiben={false} hervorgehoben />,
    );
    expect(karte()).toHaveAttribute('data-hervorgehoben', 'true');
    expect(karte()).toHaveAttribute('data-schicht-id', '1');
    expect(karte().style.boxShadow).toBe(wieGesetzt('boxShadow', LINIEN));
    expect(karte().style.background).toBe(wieGesetzt('background', farbenHell.bedienFlaeche));
  });

  it('eine überfällige Karte behält angesprungen die Alarmfläche (Gefahr gewinnt)', () => {
    renderMitProviders(
      <AbloesungKarte
        schicht={schicht({ faellig_at: '2026-10-17 11:00:00' })}
        jetzt={jetzt}
        darfSchreiben={false}
        hervorgehoben
      />,
    );
    expect(karte()).toHaveAttribute('data-alarm', 'true');
    expect(karte().style.background).toBe(wieGesetzt('background', farbenHell.alarmFlaeche));
    expect(karte().style.boxShadow).toBe(wieGesetzt('boxShadow', LINIEN));
  });

  it('ohne Sprung keine Linie', () => {
    renderMitProviders(<AbloesungKarte schicht={schicht()} jetzt={jetzt} darfSchreiben={false} />);
    expect(karte()).not.toHaveAttribute('data-hervorgehoben');
    expect(karte().style.boxShadow).toBe('');
  });
});
