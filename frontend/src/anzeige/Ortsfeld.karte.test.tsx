import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrtSucheAntwort } from '../api/karteOrtSuche';
import { einsatzKeys } from '../api/queryKeys';
import { server } from '../test/server';
import { renderMitProviders, setzeOnline } from '../test/utils';
import type { LatLon } from './koordinaten';
import { nachTextaenderung, Ortsfeld, type OrtsfeldKarte, type OrtsfeldWert } from './Ortsfeld';

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
    { lat: 51.1, lon: 10.4, name: 'Bahnhofstraße 1, Musterstadt', kurz: 'Bahnhofstraße 1' },
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
afterEach(() => setzeOnline(true));

describe('nachTextaenderung', () => {
  it('erkennt eine Koordinate, lässt eine Treffer-Koordinate fallen, behält einen Kartenpunkt', () => {
    const leer: OrtsfeldWert = { text: '', koordinate: null };
    expect(nachTextaenderung(leer, '51.16040, 10.45140')).toEqual({
      text: '51.16040, 10.45140',
      koordinate: { lat: 51.1604, lon: 10.4514 },
      quelle: 'koordinate',
    });
    const treffer: OrtsfeldWert = { text: 'A', koordinate: { lat: 1, lon: 2 }, quelle: 'adresse' };
    expect(nachTextaenderung(treffer, 'AB')).toEqual({ text: 'AB', koordinate: null });
    const getippt: OrtsfeldWert = {
      text: '51.16040, 10.45140',
      koordinate: { lat: 51.1604, lon: 10.4514 },
      quelle: 'koordinate',
    };
    expect(nachTextaenderung(getippt, '51.16040, 10.45')).toEqual({
      text: '51.16040, 10.45',
      koordinate: null,
    });
    const gesetzt: OrtsfeldWert = { text: 'A', koordinate: { lat: 1, lon: 2 }, quelle: 'karte' };
    expect(nachTextaenderung(gesetzt, 'Hinterhof')).toEqual({
      text: 'Hinterhof',
      koordinate: { lat: 1, lon: 2 },
      quelle: 'karte',
    });
    // „12 34“ ist eine Hausnummer, keine Koordinate.
    expect(nachTextaenderung(leer, '12 34')).toEqual({ text: '12 34', koordinate: null });
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

  it('ohne Einsatz keine Ort-Zeile und keine Anfrage an die Ort-Vorschau', async () => {
    const anfragen: string[] = [];
    const merken = ({ request }: { request: Request }) => anfragen.push(request.url);
    server.events.on('request:start', merken);
    try {
      renderMitProviders(
        <Aufbau
          start={{ text: 'X', koordinate: { lat: 51.1, lon: 10.4 }, quelle: 'karte' }}
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
