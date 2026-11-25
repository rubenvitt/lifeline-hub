import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../../test/utils';
import { setzeViewportBreite, setzeViewportZurueck } from '../../test/viewport';
import EinsatzSeite from '../../components/EinsatzSeite';
import type { ExportEingabe } from './geoExport';
import type { KarteMarker } from './marker';
import { useGeoExport } from './useGeoExport';

const speichere = vi.hoisted(() => vi.fn());
const packe = vi.hoisted(() => vi.fn());
vi.mock('../../components/dateiSpeichern', async (orig) => ({
  ...(await orig<typeof import('../../components/dateiSpeichern')>()),
  speichereDatei: speichere,
}));
vi.mock('./kmzPacker', async (orig) => ({
  ...(await orig<typeof import('./kmzPacker')>()),
  packKmz: packe,
}));

const KMZ = 'Exportieren: Google Earth (KMZ)';
const GEOJSON = 'Exportieren: GIS (GeoJSON)';

const einsatzort: KarteMarker = {
  schluessel: 'einsatzort-1',
  typ: 'einsatzort',
  id: 1,
  lat: 54.1,
  lon: 9.9,
  label: 'Einsatzort',
  farbe: '#1677ff',
} as KarteMarker;

const eingabe = (marker: KarteMarker[], stand: Date | null = null): ExportEingabe => ({
  marker,
  flaechen: [],
  zonen: [],
  einsatzName: 'Hochwasser',
  stand,
});

function Seite({
  daten,
  beiFehler,
}: {
  daten: ExportEingabe | null;
  beiFehler?: (e: unknown) => void;
}) {
  const beginne = beiFehler ? () => beiFehler : undefined;
  const { nebenwege } = useGeoExport(daten, 42, beginne);
  return (
    <EinsatzSeite
      titel="Karte"
      weitere={{ name: 'Weitere Aktionen zur Lagekarte', eintraege: nebenwege }}
    >
      <div>Inhalt</div>
    </EinsatzSeite>
  );
}

beforeEach(() => {
  setzeViewportBreite(1180);
  speichere.mockReset();
  packe.mockReset();
});
afterEach(() => setzeViewportZurueck());

describe('useGeoExport', () => {
  it('zwei Einträge mit den Namen der Ausgabeprogramme', () => {
    renderMitProviders(<Seite daten={eingabe([einsatzort])} />);
    expect(screen.getByRole('button', { name: KMZ })).toBeEnabled();
    expect(screen.getByRole('button', { name: GEOJSON })).toBeEnabled();
  });

  it('ohne sichtbare Objekte: beide gesperrt, der Grund steht am Eintrag', () => {
    renderMitProviders(<Seite daten={eingabe([])} />);
    expect(screen.getByRole('button', { name: `${KMZ} (Nichts eingeblendet)` })).toBeDisabled();
    expect(screen.getByRole('button', { name: `${GEOJSON} (Nichts eingeblendet)` })).toBeDisabled();
  });

  it('ohne Eingabe (Daten laden noch): gesperrt mit „lädt“, nicht „Nichts eingeblendet“', () => {
    renderMitProviders(<Seite daten={null} />);
    expect(screen.getByRole('button', { name: `${KMZ} (lädt)` })).toBeDisabled();
    expect(screen.getByRole('button', { name: `${GEOJSON} (lädt)` })).toBeDisabled();
  });

  it('ein gesicherter Stand trägt seine Zeit, nicht die des Klicks', async () => {
    const gesichert = new Date(Date.UTC(2026, 10, 24, 9, 0, 0));
    renderMitProviders(<Seite daten={eingabe([einsatzort], gesichert)} />);
    await userEvent.click(screen.getByRole('button', { name: GEOJSON }));
    await waitFor(() => expect(speichere).toHaveBeenCalledTimes(1));
    const [blob] = speichere.mock.calls[0] as [Blob, string];
    expect(JSON.parse(await blob.text())['lfh:stand']).toBe('2026-11-24 09:00:00');
  });

  it('die Live-Ansicht trägt den Moment des Klicks', async () => {
    renderMitProviders(<Seite daten={eingabe([einsatzort])} />);
    const vorher = Date.now();
    await userEvent.click(screen.getByRole('button', { name: GEOJSON }));
    await waitFor(() => expect(speichere).toHaveBeenCalledTimes(1));
    const [blob] = speichere.mock.calls[0] as [Blob, string];
    const stand = Date.parse(`${JSON.parse(await blob.text())['lfh:stand'].replace(' ', 'T')}Z`);
    expect(stand).toBeGreaterThanOrEqual(Math.floor(vorher / 1000) * 1000);
  });

  it('ein zweiter Klick während des Erzeugens speichert keine zweite Datei', async () => {
    let fertig: (b: Blob) => void = () => {};
    packe.mockReturnValue(new Promise<Blob>((r) => (fertig = r)));
    renderMitProviders(<Seite daten={eingabe([einsatzort])} />);
    const knopf = screen.getByRole('button', { name: KMZ });
    fireEvent.click(knopf);
    fireEvent.click(knopf);
    expect(await screen.findByRole('button', { name: `${KMZ} (läuft)` })).toBeDisabled();
    fertig(new Blob(['x']));
    await waitFor(() => expect(screen.getByRole('button', { name: KMZ })).toBeEnabled());
    expect(packe).toHaveBeenCalledTimes(1);
    expect(speichere).toHaveBeenCalledTimes(1);
  });

  it('GeoJSON: speichert einen Blob vom Typ geo+json unter dem Dateinamen des Einsatzes', async () => {
    renderMitProviders(<Seite daten={eingabe([einsatzort])} />);
    await userEvent.click(screen.getByRole('button', { name: GEOJSON }));
    await waitFor(() => expect(speichere).toHaveBeenCalledTimes(1));
    const [blob, name] = speichere.mock.calls[0] as [Blob, string];
    expect(blob.type).toBe('application/geo+json');
    expect(name).toMatch(/^lagekarte-einsatz-42-\d{4}-\d{2}-\d{2}-\d{4}\.geojson$/);
    expect(JSON.parse(await blob.text()).features).toHaveLength(1);
  });

  it('KMZ: packt und speichert mit Endung kmz', async () => {
    packe.mockResolvedValue(new Blob(['x'], { type: 'application/vnd.google-earth.kmz' }));
    renderMitProviders(<Seite daten={eingabe([einsatzort])} />);
    await userEvent.click(screen.getByRole('button', { name: KMZ }));
    await waitFor(() => expect(speichere).toHaveBeenCalledTimes(1));
    expect((speichere.mock.calls[0] as [Blob, string])[1]).toMatch(
      /^lagekarte-einsatz-42-.*\.kmz$/,
    );
  });

  it('ein Fehler beim Erzeugen geht an die Seite, nichts wird gespeichert', async () => {
    packe.mockRejectedValue(new Error('Schrift fehlt'));
    const beiFehler = vi.fn();
    renderMitProviders(<Seite daten={eingabe([einsatzort])} beiFehler={beiFehler} />);
    await userEvent.click(screen.getByRole('button', { name: KMZ }));
    await waitFor(() => expect(beiFehler).toHaveBeenCalledTimes(1));
    const [fehler] = beiFehler.mock.calls[0] as [Error];
    expect(fehler.message).toBe('Schrift fehlt');
    expect(speichere).not.toHaveBeenCalled();
  });
});
