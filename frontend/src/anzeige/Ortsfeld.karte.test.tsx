import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrtSucheAntwort } from '../api/karteOrtSuche';
import { einsatzKeys } from '../api/queryKeys';
import { server } from '../test/server';
import { renderMitProviders, setzeOnline } from '../test/utils';
import { formatiere, type LatLon } from './koordinaten';
import { holeOrt, ortCacheRaeumen, ortKeyVon } from './ortCache';
import { EIGENPOSITION_SPERRGRUND } from '../pages/lagekarte/useEigenposition';
import {
  EIGENE_POSITION_VERWEIGERT,
  nachKartenpunkt,
  nachTextaenderung,
  Ortsfeld,
  type OrtsfeldKarte,
  type OrtsfeldWert,
} from './Ortsfeld';

/**
 * Ortsfeld mit Koordinate im Feld, Kartenvorschau und ohne Suche (LLH-1108, Spec `ortsfeld`).
 * Karte und Kartendialog sind Nachbauten: sie zeigen, was sie bekommen, und melden Punkte über
 * Knöpfe. Die Karten selbst prüfen `Kartenausschnitt.test.tsx` und `KarteWaehlen.test.tsx`.
 *
 * Mutationsproben (von Hand, je rot gesehen, dann zurückgedreht):
 * - `nachTextaenderung` behält den Kartenpunkt nicht: rot in „erkennt eine Koordinate …“ und
 *   „Nadel ziehen ändert die Koordinate …“.
 * - Erkennung der Koordinate entfernt: rot in „übernimmt eine getippte Koordinate …“ und „nimmt
 *   die Koordinate auch ohne Netz“.
 * - Vorschlag ohne Abgleich mit dem Text: rot in „schlägt den Ortsnamen nicht vor, wenn …“.
 * - `ohneSuche` rendert das Feld mit Suche: rot in „ist reiner Text …“.
 * - `nachTextaenderung` behält den Kartenpunkt auch bei leerem Text (LLH-1534): rot in
 *   „ein geleerter Text leert auch einen Kartenpunkt“ und „ein Kartenpunkt ins leere Feld …“.
 * - `nachKartenpunkt` lässt einen leeren Text leer: rot in „nachKartenpunkt“ und „ein Kartenpunkt
 *   ins leere Feld …“.
 * - Gleichheit über festen Abstand (1e-4°) statt über das Format: rot in „eine Koordinate im Text,
 *   die der Kartenpunkt ist …“ (52.50009) und „… im Format dms“.
 * - Nur die Rückrechnung zählt, nicht der Text selbst: rot in „… an der UTM-Zonengrenze …“.
 */

const karte = vi.hoisted(() => ({
  ausschnitte: [] as { punkt: LatLon | null; etikett: string }[],
  dialog: null as null | { punkt: LatLon | null; umgebung?: LatLon | null },
}));

vi.mock('./Kartenausschnitt', () => ({
  Kartenausschnitt: ({
    punkt,
    etikett,
    onVerschieben,
  }: {
    punkt: LatLon | null;
    etikett: string;
    onVerschieben?: (p: LatLon) => void;
  }) => {
    karte.ausschnitte.push({ punkt, etikett });
    return (
      <div role="group" aria-label={`Karte: ${etikett}`}>
        {punkt && `${punkt.lat},${punkt.lon}`}
        {onVerschieben && (
          <button type="button" onClick={() => onVerschieben({ lat: 52.5, lon: 13.4 })}>
            Nadel ziehen
          </button>
        )}
      </div>
    );
  },
}));

vi.mock('./KarteWaehlen', () => ({
  KarteWaehlen: ({
    offen,
    punkt,
    umgebung,
    onUebernehmen,
    onAbbrechen,
  }: {
    offen: boolean;
    punkt: LatLon | null;
    umgebung?: LatLon | null;
    onUebernehmen: (p: LatLon) => void;
    onAbbrechen: () => void;
  }) => {
    if (!offen) return null;
    karte.dialog = { punkt, umgebung };
    return (
      <div role="dialog" aria-label="Karte wählen">
        <button type="button" onClick={() => onUebernehmen({ lat: 53.1, lon: 8.8 })}>
          Punkt übernehmen
        </button>
        <button type="button" onClick={onAbbrechen}>
          Abbrechen
        </button>
      </div>
    );
  },
}));

const TREFFER: OrtSucheAntwort = {
  zustand: 'ok',
  treffer: [
    {
      lat: 51.1,
      lon: 10.4,
      name: 'Bahnhofstraße 1, Musterstadt',
      kurz: 'Bahnhofstraße 1',
      quelle: 'geocoder',
    },
  ],
};

function Aufbau({
  start = { text: '', koordinate: null },
  kartenProp,
  suchen = vi.fn().mockResolvedValue(TREFFER),
  onSubmit,
}: {
  start?: OrtsfeldWert;
  kartenProp?: OrtsfeldKarte;
  suchen?: (b: string) => Promise<OrtSucheAntwort>;
  onSubmit?: () => void;
}) {
  const [wert, setWert] = useState<OrtsfeldWert>(start);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit?.();
      }}
    >
      <Ortsfeld
        aria-label="Ort"
        value={wert}
        onChange={setWert}
        suchen={suchen}
        suchSchluessel={(b) => einsatzKeys.einsatzortSuche(7, b)}
        karte={kartenProp}
      />
      <output data-testid="wert">{JSON.stringify(wert)}</output>
    </form>
  );
}

function wert(): OrtsfeldWert {
  return JSON.parse(screen.getByTestId('wert').textContent!) as OrtsfeldWert;
}

/** Ort-Vorschau des Einsatzes 7: Ortsname und Peilung, mit Mitschnitt der Abfragen. */
function ortVorschau(ortsname = 'Marktplatz 3, 12345 Musterstadt') {
  const abfragen: URL[] = [];
  server.use(
    http.get('/api/einsaetze/7/ort-vorschau', ({ request }) => {
      abfragen.push(new URL(request.url));
      return HttpResponse.json({
        ortsname,
        peilung: { distanz_m: 1200, richtung: 'NO', bezug_label: 'UHS 1' },
      });
    }),
  );
  return abfragen;
}

beforeEach(() => {
  karte.ausschnitte.length = 0;
  karte.dialog = null;
});
afterEach(() => {
  setzeOnline(true);
  ortCacheRaeumen();
});

describe('nachTextaenderung', () => {
  const fmt = (lat: number, lon: number) => formatiere(lat, lon, 'wgs84');

  it('erkennt eine Koordinate, lässt eine Treffer-Koordinate fallen, behält einen Kartenpunkt', () => {
    const leer: OrtsfeldWert = { text: '', koordinate: null };
    expect(nachTextaenderung(leer, '51.16040, 10.45140', fmt)).toEqual({
      text: '51.16040, 10.45140',
      koordinate: { lat: 51.1604, lon: 10.4514 },
      quelle: 'koordinate',
    });
    const treffer: OrtsfeldWert = { text: 'A', koordinate: { lat: 1, lon: 2 }, quelle: 'adresse' };
    expect(nachTextaenderung(treffer, 'AB', fmt)).toEqual({ text: 'AB', koordinate: null });
    const getippt: OrtsfeldWert = {
      text: '51.16040, 10.45140',
      koordinate: { lat: 51.1604, lon: 10.4514 },
      quelle: 'koordinate',
    };
    expect(nachTextaenderung(getippt, '51.16040, 10.45', fmt)).toEqual({
      text: '51.16040, 10.45',
      koordinate: null,
    });
    const gesetzt: OrtsfeldWert = { text: 'A', koordinate: { lat: 1, lon: 2 }, quelle: 'karte' };
    expect(nachTextaenderung(gesetzt, 'Hinterhof', fmt)).toEqual({
      text: 'Hinterhof',
      koordinate: { lat: 1, lon: 2 },
      quelle: 'karte',
    });
    // „12 34“ ist eine Hausnummer, keine Koordinate.
    expect(nachTextaenderung(leer, '12 34', fmt)).toEqual({ text: '12 34', koordinate: null });
  });

  it('eine Koordinate im Text, die der Kartenpunkt ist, lässt ihn stehen; eine andere ersetzt ihn', () => {
    const gesetzt: OrtsfeldWert = {
      text: '52.50000, 13.40000',
      koordinate: { lat: 52.5, lon: 13.4 },
      quelle: 'karte',
    };
    // Zeichen anhängen und wieder löschen: der Punkt bleibt über alle Zwischenstände.
    const l = nachTextaenderung(gesetzt, '52.50000, 13.40000 l', fmt);
    expect(l).toEqual({ ...gesetzt, text: '52.50000, 13.40000 l' });
    expect(nachTextaenderung(l, '52.50000, 13.40000', fmt)).toEqual(gesetzt);
    // Gerundet wie in der Anzeige ist es derselbe Punkt.
    const fein: OrtsfeldWert = { ...gesetzt, koordinate: { lat: 52.500003, lon: 13.399998 } };
    expect(nachTextaenderung(fein, '52.50000, 13.40000', fmt).koordinate).toEqual(fein.koordinate);
    // Eine Änderung in der Genauigkeit des Formats ist eine andere Stelle, kein Rundungsrest.
    expect(nachTextaenderung(gesetzt, '52.50009, 13.40000', fmt)).toEqual({
      text: '52.50009, 13.40000',
      koordinate: { lat: 52.50009, lon: 13.4 },
      quelle: 'koordinate',
    });
    // Eine andere getippte Koordinate ersetzt ihn.
    expect(nachTextaenderung(gesetzt, '52.50000, 13.41000', fmt)).toEqual({
      text: '52.50000, 13.41000',
      koordinate: { lat: 52.5, lon: 13.41 },
      quelle: 'koordinate',
    });
  });

  it('ein geleerter Text leert auch einen Kartenpunkt (LLH-1534)', () => {
    const gesetzt: OrtsfeldWert = { text: 'A', koordinate: { lat: 1, lon: 2 }, quelle: 'karte' };
    expect(nachTextaenderung(gesetzt, '', fmt)).toEqual({ text: '', koordinate: null });
    expect(nachTextaenderung(gesetzt, '  ', fmt)).toEqual({ text: '  ', koordinate: null });
  });

  it.each(['wgs84', 'dms', 'utm', 'mgrs', 'gk'] as const)(
    'ein Kartenpunkt übersteht das Nachtippen seines Textes im Format %s',
    (format) => {
      const fmtF = (lat: number, lon: number) => formatiere(lat, lon, format);
      const punkt = { lat: 52.517234, lon: 13.389876 };
      const gesetzt = nachKartenpunkt({ text: '', koordinate: null }, punkt, fmtF);
      const mitLeerzeichen = nachTextaenderung(gesetzt, `${gesetzt.text} `, fmtF);
      expect(mitLeerzeichen.koordinate).toEqual(punkt);
      expect(nachTextaenderung(mitLeerzeichen, gesetzt.text, fmtF)).toEqual(gesetzt);
    },
  );

  it('ein Kartenpunkt an der UTM-Zonengrenze übersteht das Nachtippen seines Textes', () => {
    const fmtUtm = (lat: number, lon: number) => formatiere(lat, lon, 'utm');
    const punkt = { lat: 48, lon: 12 };
    const gesetzt = nachKartenpunkt({ text: '', koordinate: null }, punkt, fmtUtm);
    const mitLeerzeichen = nachTextaenderung(gesetzt, `${gesetzt.text} `, fmtUtm);
    expect(mitLeerzeichen).toEqual({ ...gesetzt, text: `${gesetzt.text} ` });
    expect(nachTextaenderung(mitLeerzeichen, `${gesetzt.text} x`, fmtUtm).koordinate).toEqual(
      punkt,
    );
  });
});

describe('nachKartenpunkt', () => {
  const fmt = (lat: number, lon: number) => `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  const p = { lat: 52.5, lon: 13.4 };

  it('setzt in ein leeres Feld die Koordinate als Text', () => {
    expect(nachKartenpunkt({ text: '', koordinate: null }, p, fmt)).toEqual({
      text: '52.50000, 13.40000',
      koordinate: p,
      quelle: 'karte',
    });
    expect(nachKartenpunkt({ text: ' ', koordinate: null }, p, fmt).text).toBe(
      '52.50000, 13.40000',
    );
  });

  it('lässt einen Text stehen, der keine Koordinate ist', () => {
    const vorher: OrtsfeldWert = {
      text: 'Waldweg',
      koordinate: { lat: 1, lon: 2 },
      quelle: 'adresse',
    };
    expect(nachKartenpunkt(vorher, p, fmt)).toEqual({
      text: 'Waldweg',
      koordinate: p,
      quelle: 'karte',
    });
  });

  it('zieht eine Koordinate im Text mit, eingetragen oder getippt', () => {
    const eingetragen: OrtsfeldWert = {
      text: '51.16040, 10.45140',
      koordinate: { lat: 51.1604, lon: 10.4514 },
      quelle: 'karte',
    };
    expect(nachKartenpunkt(eingetragen, p, fmt).text).toBe('52.50000, 13.40000');
    // Getippt, auch in einem anderen Format: sonst nennte der Text einen anderen Ort als die Nadel.
    expect(
      nachKartenpunkt({ ...eingetragen, text: '32U MB 12345 67890', quelle: 'koordinate' }, p, fmt)
        .text,
    ).toBe('52.50000, 13.40000');
  });
});

describe('Ortsfeld — Koordinate im Feld', () => {
  it('übernimmt eine getippte Koordinate ohne Server; „Ort suchen“ bleibt gesperrt', async () => {
    const suchen = vi.fn().mockResolvedValue(TREFFER);
    renderMitProviders(<Aufbau suchen={suchen} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Ort' }), '32U MB 12345 67890{Enter}');
    const w = wert();
    expect(w.quelle).toBe('koordinate');
    expect(w.koordinate).not.toBeNull();
    expect(w.text).toBe('32U MB 12345 67890');
    expect(screen.getByRole('button', { name: 'Ort suchen' })).toBeDisabled();
    expect(suchen).not.toHaveBeenCalled();
  });

  it('nimmt die Koordinate auch ohne Netz', async () => {
    renderMitProviders(<Aufbau />);
    act(() => setzeOnline(false));
    await userEvent.type(screen.getByRole('textbox', { name: 'Ort' }), '51.16040, 10.45140');
    expect(wert().koordinate).toEqual({ lat: 51.1604, lon: 10.4514 });
    expect(screen.getByText('Adresssuche ohne Netz nicht verfügbar')).toBeInTheDocument();
  });
});

describe('Ortsfeld — Kartenvorschau', () => {
  it('ohne Prop `karte` keine Vorschau und kein „Auf Karte wählen“', async () => {
    renderMitProviders(<Aufbau start={{ text: 'A', koordinate: { lat: 1, lon: 2 } }} />);
    expect(screen.queryByRole('button', { name: 'Auf Karte wählen' })).not.toBeInTheDocument();
    expect(karte.ausschnitte).toHaveLength(0);
  });

  it('ohne Koordinate „Nicht verortet“ und „Auf Karte wählen“, keine Karte', () => {
    renderMitProviders(<Aufbau kartenProp={{ etikett: 'Einsatzort' }} />);
    expect(screen.getByText('Nicht verortet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Auf Karte wählen' })).toBeInTheDocument();
    expect(karte.ausschnitte).toHaveLength(0);
  });

  it('Treffer wählen zeigt Vorschau und Ort-Zeile, schlägt keinen Text vor', async () => {
    const abfragen = ortVorschau();
    renderMitProviders(
      <Aufbau kartenProp={{ etikett: 'Einsatzort', einsatzId: 7, exclude: 'einsatzort:7' }} />,
    );
    await userEvent.type(screen.getByRole('textbox', { name: 'Ort' }), 'Bahnhofstraße 1{Enter}');
    await userEvent.click(await screen.findByRole('button', { name: /Bahnhofstraße 1/ }));
    expect(screen.getByRole('group', { name: 'Karte: Einsatzort' })).toHaveTextContent('51.1,10.4');
    expect(
      await screen.findByText(/^Marktplatz 3, 12345 Musterstadt · .+ NO von UHS 1$/),
    ).toBeInTheDocument();
    expect(abfragen[0].searchParams.get('exclude')).toBe('einsatzort:7');
    // Der Text stammt aus dem Treffer: kein Vorschlag.
    expect(
      screen.queryByRole('button', { name: 'Als Adresse übernehmen' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Nicht verortet')).not.toBeInTheDocument();
  });

  it('Nadel ziehen ändert die Koordinate, nicht den Text; der Ortsname kommt als Vorschlag', async () => {
    ortVorschau();
    renderMitProviders(
      <Aufbau
        start={{
          text: 'Hinter der Halle',
          koordinate: { lat: 51.1, lon: 10.4 },
          quelle: 'adresse',
        }}
        kartenProp={{ etikett: 'Einsatzort', einsatzId: 7 }}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Nadel ziehen' }));
    expect(wert()).toEqual({
      text: 'Hinter der Halle',
      koordinate: { lat: 52.5, lon: 13.4 },
      quelle: 'karte',
    });
    const uebernehmen = await screen.findByRole('button', { name: 'Als Adresse übernehmen' });
    // Weitertippen behält den Kartenpunkt.
    await userEvent.type(screen.getByRole('textbox', { name: 'Ort' }), ' links');
    expect(wert().koordinate).toEqual({ lat: 52.5, lon: 13.4 });

    await userEvent.click(uebernehmen);
    expect(wert()).toEqual({
      text: 'Marktplatz 3, 12345 Musterstadt',
      koordinate: { lat: 52.5, lon: 13.4 },
      quelle: 'karte',
    });
    expect(
      screen.queryByRole('button', { name: 'Als Adresse übernehmen' }),
    ).not.toBeInTheDocument();
  });

  it('schlägt den Ortsnamen nicht vor, wenn er schon der Text ist', async () => {
    ortVorschau('Marktplatz 3');
    renderMitProviders(
      <Aufbau
        start={{ text: 'Marktplatz 3 ', koordinate: { lat: 51.1, lon: 10.4 }, quelle: 'karte' }}
        kartenProp={{ etikett: 'Einsatzort', einsatzId: 7 }}
      />,
    );
    expect(await screen.findByText(/^Marktplatz 3 · .+ NO von UHS 1$/)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Als Adresse übernehmen' }),
    ).not.toBeInTheDocument();
  });

  it('ohne Einsatz: Nadel ziehen fragt die Ort-Vorschau der Organisation und schlägt den Ortsnamen vor', async () => {
    const abfragen: URL[] = [];
    server.use(
      http.get('/api/ort-vorschau', ({ request }) => {
        abfragen.push(new URL(request.url));
        return HttpResponse.json({ ortsname: 'Lindenweg 2, 12345 Musterdorf' });
      }),
    );
    renderMitProviders(
      <Aufbau
        start={{ text: 'Feldweg', koordinate: { lat: 51.1, lon: 10.4 }, quelle: 'adresse' }}
        kartenProp={{ etikett: 'Einsatzort' }}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Nadel ziehen' }));
    expect(await screen.findByText('Lindenweg 2, 12345 Musterdorf')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Als Adresse übernehmen' }));
    expect(wert()).toEqual({
      text: 'Lindenweg 2, 12345 Musterdorf',
      koordinate: { lat: 52.5, lon: 13.4 },
      quelle: 'karte',
    });
    expect(abfragen).toHaveLength(1);
    expect(abfragen[0].searchParams.get('lat')).toBe('52.5');
    expect(abfragen[0].searchParams.get('lon')).toBe('13.4');
    expect(abfragen[0].searchParams.has('exclude')).toBe(false);
  });

  it('ohne Einsatz: ein gewählter Treffer fragt die Ort-Vorschau nicht', async () => {
    const anfragen: string[] = [];
    const merken = ({ request }: { request: Request }) => anfragen.push(request.url);
    server.events.on('request:start', merken);
    try {
      renderMitProviders(
        <Aufbau
          start={{ text: 'X', koordinate: { lat: 51.1, lon: 10.4 }, quelle: 'adresse' }}
          kartenProp={{ etikett: 'Einsatzort' }}
        />,
      );
      expect(screen.getByRole('group', { name: 'Karte: Einsatzort' })).toBeInTheDocument();
      await new Promise((r) => setTimeout(r, 800));
      expect(anfragen.filter((u) => u.includes('ort-vorschau'))).toEqual([]);
    } finally {
      server.events.removeListener('request:start', merken);
    }
  });

  it('„Auf Karte wählen“ setzt den Punkt aus dem Dialog, der Text bleibt', async () => {
    renderMitProviders(
      <Aufbau
        start={{ text: 'Waldweg', koordinate: null }}
        kartenProp={{ etikett: 'Einsatzort', umgebung: { lat: 50, lon: 9 } }}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Auf Karte wählen' }));
    expect(karte.dialog).toEqual({ punkt: null, umgebung: { lat: 50, lon: 9 } });
    await userEvent.click(screen.getByRole('button', { name: 'Punkt übernehmen' }));
    expect(wert()).toEqual({
      text: 'Waldweg',
      koordinate: { lat: 53.1, lon: 8.8 },
      quelle: 'karte',
    });
    expect(screen.queryByRole('dialog', { name: 'Karte wählen' })).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Karte: Einsatzort' })).toBeInTheDocument();
  });

  it('ein Kartenpunkt ins leere Feld setzt die Koordinate als Text, ein geleerter Text nimmt ihn weg (LLH-1534)', async () => {
    ortVorschau();
    renderMitProviders(<Aufbau kartenProp={{ etikett: 'Einsatzort', einsatzId: 7 }} />);
    await userEvent.click(screen.getByRole('button', { name: 'Auf Karte wählen' }));
    await userEvent.click(screen.getByRole('button', { name: 'Punkt übernehmen' }));
    expect(wert()).toEqual({
      text: '53.10000, 8.80000',
      koordinate: { lat: 53.1, lon: 8.8 },
      quelle: 'karte',
    });
    // Der Ortsname bleibt ein Vorschlag.
    expect(
      await screen.findByRole('button', { name: 'Als Adresse übernehmen' }),
    ).toBeInTheDocument();

    // Die Koordinate als Text zieht mit der Nadel mit.
    await userEvent.click(screen.getByRole('button', { name: 'Nadel ziehen' }));
    expect(wert()).toEqual({
      text: '52.50000, 13.40000',
      koordinate: { lat: 52.5, lon: 13.4 },
      quelle: 'karte',
    });

    await userEvent.clear(screen.getByRole('textbox', { name: 'Ort' }));
    expect(wert()).toEqual({ text: '', koordinate: null });
    expect(screen.getByText('Nicht verortet')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Karte: Einsatzort' })).not.toBeInTheDocument();
  });

  it('„Auf Karte wählen“ geht auch ohne Netz; Abbrechen lässt den Wert', async () => {
    renderMitProviders(<Aufbau kartenProp={{ etikett: 'Einsatzort' }} />);
    act(() => setzeOnline(false));
    await userEvent.click(screen.getByRole('button', { name: 'Auf Karte wählen' }));
    await userEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(wert()).toEqual({ text: '', koordinate: null });
    await userEvent.click(screen.getByRole('button', { name: 'Auf Karte wählen' }));
    await userEvent.click(screen.getByRole('button', { name: 'Punkt übernehmen' }));
    expect(wert().koordinate).toEqual({ lat: 53.1, lon: 8.8 });
  });
});

describe('Ortsfeld — ohne Suche', () => {
  function OhneSuche({ onSubmit }: { onSubmit: () => void }) {
    const [w, setW] = useState<OrtsfeldWert>({ text: '', koordinate: null });
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <Ortsfeld aria-label="Adresse" ohneSuche="personenbezogen" value={w} onChange={setW} />
        <output data-testid="wert">{JSON.stringify(w)}</output>
      </form>
    );
  }

  it('ist reiner Text: kein Knopf, keine Erkennung, Enter wie in jedem Feld, keine Anfrage', async () => {
    const anfragen: string[] = [];
    const merken = ({ request }: { request: Request }) => anfragen.push(request.url);
    server.events.on('request:start', merken);
    try {
      const onSubmit = vi.fn();
      renderMitProviders(<OhneSuche onSubmit={onSubmit} />);
      expect(screen.queryByRole('button', { name: 'Ort suchen' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Auf Karte wählen' })).not.toBeInTheDocument();
      const feld = screen.getByRole('textbox', { name: 'Adresse' });
      await userEvent.type(feld, 'Hauptstraße 12, Musterstadt{Enter}');
      expect(onSubmit).toHaveBeenCalledTimes(1);
      await userEvent.clear(feld);
      await userEvent.type(feld, '51.16040, 10.45140');
      expect(wert()).toEqual({ text: '51.16040, 10.45140', koordinate: null });
      await new Promise((r) => setTimeout(r, 800));
      expect(anfragen.filter((u) => /ort-suche|ort-vorschau|nominatim/.test(u))).toEqual([]);
    } finally {
      server.events.removeListener('request:start', merken);
    }
  });
});

/**
 * „Eigene Position“ (LLH-1567, design.md D7): ein einmaliger Standort wirkt wie ein Kartenpunkt;
 * ohne sicheren Kontext oder Standort gesperrt mit Grund.
 */
describe('Ortsfeld — Eigene Position', () => {
  const ursprung = {
    sicher: Object.getOwnPropertyDescriptor(window, 'isSecureContext'),
    geo: Object.getOwnPropertyDescriptor(navigator, 'geolocation'),
  };
  function stelle(sicher: boolean, geo: unknown) {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: sicher });
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: geo });
  }
  afterEach(() => {
    if (ursprung.sicher) Object.defineProperty(window, 'isSecureContext', ursprung.sicher);
    else delete (window as { isSecureContext?: boolean }).isSecureContext;
    if (ursprung.geo) Object.defineProperty(navigator, 'geolocation', ursprung.geo);
    else delete (navigator as { geolocation?: unknown }).geolocation;
  });
  const MIT_POSITION: OrtsfeldKarte = { etikett: 'Fundort', eigenePosition: true };

  it('setzt den Standort als Kartenpunkt, die Koordinate steht im leeren Text', async () => {
    const getCurrentPosition = vi.fn((ok: PositionCallback) =>
      ok({ coords: { latitude: 53.07, longitude: 8.81, accuracy: 12 } } as GeolocationPosition),
    );
    stelle(true, { getCurrentPosition });
    renderMitProviders(<Aufbau kartenProp={MIT_POSITION} />);
    await userEvent.click(screen.getByRole('button', { name: 'Eigene Position' }));
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(wert()).toEqual({
      text: expect.stringMatching(/53[.,]07/),
      koordinate: { lat: 53.07, lon: 8.81 },
      quelle: 'karte',
    });
  });

  it('zeigt zur eigenen Position den Ortsnamen, merkt ihn sich aber nicht; ein gezogener Punkt schon', async () => {
    ortVorschau();
    stelle(true, {
      getCurrentPosition: (ok: PositionCallback) =>
        ok({ coords: { latitude: 53.07, longitude: 8.81, accuracy: 12 } } as GeolocationPosition),
    });
    renderMitProviders(<Aufbau kartenProp={{ ...MIT_POSITION, einsatzId: 7 }} />);
    await userEvent.click(screen.getByRole('button', { name: 'Eigene Position' }));
    await screen.findByRole('button', { name: 'Als Adresse übernehmen' });
    // Der Local-Store schreibt ohne Abwarten: kurz Zeit lassen, damit ein Schreiben sichtbar wäre.
    await new Promise((r) => setTimeout(r, 50));
    expect(await holeOrt(ortKeyVon(53.07, 8.81))).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Nadel ziehen' }));
    expect(wert().koordinate).toEqual({ lat: 52.5, lon: 13.4 });
    await vi.waitFor(
      async () =>
        expect(await holeOrt(ortKeyVon(52.5, 13.4))).toBe('Marktplatz 3, 12345 Musterstadt'),
      { timeout: 3000 },
    );
  });

  it('lässt einen getippten Text stehen', async () => {
    stelle(true, {
      getCurrentPosition: (ok: PositionCallback) =>
        ok({ coords: { latitude: 53.07, longitude: 8.81, accuracy: 12 } } as GeolocationPosition),
    });
    renderMitProviders(
      <Aufbau start={{ text: 'Hinter der Bühne', koordinate: null }} kartenProp={MIT_POSITION} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Eigene Position' }));
    expect(wert()).toEqual({
      text: 'Hinter der Bühne',
      koordinate: { lat: 53.07, lon: 8.81 },
      quelle: 'karte',
    });
  });

  it('nennt den Grund, wenn der Standort verweigert wird, und lässt den Wert', async () => {
    stelle(true, {
      getCurrentPosition: (_ok: PositionCallback, fehler: PositionErrorCallback) =>
        fehler({ code: 1, PERMISSION_DENIED: 1 } as GeolocationPositionError),
    });
    renderMitProviders(<Aufbau kartenProp={MIT_POSITION} />);
    await userEvent.click(screen.getByRole('button', { name: 'Eigene Position' }));
    expect(screen.getByRole('button', { name: 'Eigene Position' })).toHaveAccessibleDescription(
      EIGENE_POSITION_VERWEIGERT,
    );
    expect(screen.getByText(EIGENE_POSITION_VERWEIGERT)).toBeVisible();
    expect(wert()).toEqual({ text: '', koordinate: null });
  });

  it('steht ohne sicheren Kontext gesperrt mit Grund und fragt keinen Standort ab', async () => {
    const getCurrentPosition = vi.fn();
    stelle(false, { getCurrentPosition });
    renderMitProviders(<Aufbau kartenProp={MIT_POSITION} />);
    const knopf = screen.getByRole('button', { name: 'Eigene Position' });
    expect(knopf).toHaveAttribute('aria-disabled', 'true');
    expect(knopf).toHaveAccessibleDescription(EIGENPOSITION_SPERRGRUND.unsicher);
    await userEvent.click(knopf);
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it('fehlt ohne `eigenePosition`', () => {
    stelle(true, { getCurrentPosition: vi.fn() });
    renderMitProviders(<Aufbau kartenProp={{ etikett: 'Einsatzort' }} />);
    expect(screen.queryByRole('button', { name: 'Eigene Position' })).toBeNull();
  });
});
