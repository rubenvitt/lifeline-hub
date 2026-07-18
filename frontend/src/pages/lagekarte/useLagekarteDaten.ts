import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { einsatzKeys } from '../../api/queryKeys';
import { ladeEinsatz, ladeEinstellungen } from '../../api/einsaetze';
import { darfImEinsatzSchreiben } from '../../einsatz/schreibrecht';
import { useAuth } from '../../auth/AuthContext';
import { listeUhs } from '../../api/einsatzUhs';
import { listeSchaeden } from '../../api/einsatzSchaden';
import { ladeKarteConfig } from '../../api/karte';
import { listeEinheiten } from '../../api/einheiten';
import { listeEinsatzFahrzeuge } from '../../api/einsatzFahrzeuge';
import { listeFuehrungskraefte } from '../../api/einsatzPersonal';
import { listeAbschnitte } from '../../api/einsatzabschnitte';
import { listeZonen } from '../../api/lagezonen';
import { listeFreieZeichen } from '../../api/freieZeichen';
import { ladeGefahrengebiete } from '../../api/gefahren';
import { listeLageMeldungen } from '../../api/meldungen';
import { ladeOrganisation } from '../../api/organisation';
import type { Warnstufe } from '../../api/types';
import { baueMarker, baueTaktischeMarker, baueLageMeldungMarker, baueFreieZeichenMarker, type KarteMarker } from './marker';
import { parsePolygon, parseGeometry, polygonZentroid } from './geo';
import { baueTzProps } from './taktischesZeichen';
import { zoneStil, gefahrengebietStil } from './zonenStil';
import type { ZoneFeature } from './kartenLayer';

interface LagekarteDatenArgs {
  einsatzId: number;
  /** Zonen-Layer sichtbar (layer.zone, UI-State) → als Parameter, um die Grenze sauber zu halten. */
  zeigeZonen: boolean;
}

/**
 * Daten-Leg der Lagekarte: alle Domänen-Queries (SSE-Live via EinsatzLayout, deshalb keine
 * eigene EventSource hier) plus die reinen Marker-/Flächen-/Zonen-Ableitungen. `zonenFeatures`
 * hängt bewusst nur an `zeigeZonen` (nicht am ganzen Layer-State), damit die Grenze sauber bleibt.
 */
export function useLagekarteDaten({ einsatzId, zeigeZonen }: LagekarteDatenArgs) {
  const { benutzer } = useAuth();
  const einsatzQuery = useQuery({ queryKey: einsatzKeys.einsatz(einsatzId), queryFn: () => ladeEinsatz(einsatzId) });
  const uhsQuery = useQuery({ queryKey: einsatzKeys.uhs(einsatzId), queryFn: () => listeUhs(einsatzId) });
  const schaedenQuery = useQuery({
    queryKey: einsatzKeys.schaeden(einsatzId),
    queryFn: () => listeSchaeden(einsatzId),
  });
  const einheitenQuery = useQuery({
    queryKey: einsatzKeys.einheiten(einsatzId),
    queryFn: () => listeEinheiten(einsatzId),
  });
  const fahrzeugeQuery = useQuery({
    queryKey: einsatzKeys.fahrzeuge(einsatzId),
    queryFn: () => listeEinsatzFahrzeuge(einsatzId),
  });
  const abschnitteQuery = useQuery({
    queryKey: einsatzKeys.abschnitte(einsatzId),
    queryFn: () => listeAbschnitte(einsatzId),
  });
  const zonenQuery = useQuery({
    queryKey: einsatzKeys.zonen(einsatzId),
    queryFn: () => listeZonen(einsatzId),
  });
  const freieZeichenQuery = useQuery({
    queryKey: einsatzKeys.freieZeichen(einsatzId),
    queryFn: () => listeFreieZeichen(einsatzId),
  });
  const gebieteQuery = useQuery({ queryKey: einsatzKeys.gefahrengebiete(einsatzId), queryFn: () => ladeGefahrengebiete(einsatzId) });
  const lageMeldungenQuery = useQuery({
    queryKey: einsatzKeys.lagemeldungen(einsatzId),
    queryFn: () => listeLageMeldungen(einsatzId),
  });
  const fkQuery = useQuery({
    queryKey: einsatzKeys.fuehrungskraefte(einsatzId),
    queryFn: () => listeFuehrungskraefte(einsatzId),
  });
  const orgQuery = useQuery({ queryKey: ['organisation'], queryFn: ladeOrganisation });
  const configQuery = useQuery({ queryKey: ['karte-config'], queryFn: ladeKarteConfig });
  // Einsatz-Einstellungen als Karten-Defaults (LFH-131): Basemap-Vorwahl + Lage-Layer.
  // Geteilter queryKey mit Einstellungen-Seite/Redirect → i. d. R. bereits gecacht.
  const einstellungenQuery = useQuery({
    queryKey: einsatzKeys.einstellungen(einsatzId),
    queryFn: () => ladeEinstellungen(einsatzId),
  });

  const einsatz = einsatzQuery.data;
  const darfSchreiben = darfImEinsatzSchreiben(einsatz, benutzer);

  const { verortet, nichtVerortet } = useMemo(
    () => baueMarker(einsatz, uhsQuery.data ?? [], schaedenQuery.data ?? []),
    [einsatz, uhsQuery.data, schaedenQuery.data],
  );

  const orgDefault = orgQuery.data?.tz_organisation ?? null;

  const taktisch = useMemo(
    () =>
      baueTaktischeMarker({
        einheiten: einheitenQuery.data ?? [],
        fahrzeuge: fahrzeugeQuery.data ?? [],
        fuehrungskraefte: fkQuery.data ?? [],
        orgDefault,
      }),
    [einheitenQuery.data, fahrzeugeQuery.data, fkQuery.data, orgDefault],
  );

  const flaechen = useMemo(
    () =>
      (abschnitteQuery.data ?? []).flatMap((a) => {
        const poly = parsePolygon(a.flaeche_geojson);
        if (!poly) return [];
        const z = polygonZentroid(poly);
        if (!z) return [];
        const tz = baueTzProps({
          objekttyp: 'abschnitt',
          fachaufgabe: a.tz_fachaufgabe,
          organisation: a.tz_organisation,
          orgDefault,
        });
        return [
          {
            id: a.id,
            label: a.name,
            polygon: poly,
            tzMarker: {
              schluessel: `abschnitt-${a.id}`,
              typ: 'abschnitt' as const,
              id: a.id,
              lon: z[0],
              lat: z[1],
              label: a.name,
              farbe: '#722ed1',
              tz,
              geometrie: poly, // Kennzahlen (Fläche/Umfang) im Inspector, LFH-146
            } satisfies KarteMarker,
          },
        ];
      }),
    [abschnitteQuery.data, orgDefault],
  );

  const gebietWarnstufe = useMemo(() => {
    const m = new Map<number, Warnstufe>();
    (gebieteQuery.data ?? []).forEach((g) => m.set(g.id, g.hoechste_warnstufe));
    return m;
  }, [gebieteQuery.data]);

  const zonenFeatures = useMemo<ZoneFeature[]>(
    () =>
      (zeigeZonen ? zonenQuery.data ?? [] : []).flatMap((z) => {
        const g = parseGeometry(z.geometrie);
        if (!g) return [];
        const stil =
          z.typ === 'gefahrengebiet' && z.gefahrengebiet_id != null
            ? gefahrengebietStil(gebietWarnstufe.get(z.gefahrengebiet_id) ?? 'keine')
            : zoneStil(z.typ, z.farbe);
        return [{ id: z.id, geometrie: g, label: z.label ?? null, stil }];
      }),
    [zonenQuery.data, zeigeZonen, gebietWarnstufe],
  );

  const lageMeldungMarker = useMemo(
    () => baueLageMeldungMarker(lageMeldungenQuery.data ?? []),
    [lageMeldungenQuery.data],
  );

  const freieZeichenMarker = useMemo(
    () => baueFreieZeichenMarker(freieZeichenQuery.data ?? []),
    [freieZeichenQuery.data],
  );

  const alleVerortet = useMemo(
    () => [
      ...verortet, ...taktisch.verortet, ...flaechen.map((f) => f.tzMarker),
      ...lageMeldungMarker, ...freieZeichenMarker,
    ],
    [verortet, taktisch.verortet, flaechen, lageMeldungMarker, freieZeichenMarker],
  );

  const nichtVerortetAlle = useMemo(
    () => [
      ...nichtVerortet,
      ...taktisch.nichtVerortet,
      ...(abschnitteQuery.data ?? [])
        .filter((a) => !a.flaeche_geojson)
        .map((a) => ({ typ: 'abschnitt' as const, id: a.id, label: a.name })),
    ],
    [nichtVerortet, taktisch.nichtVerortet, abschnitteQuery.data],
  );

  return {
    // Rohdaten-/Status-Durchreichungen (für Ladegate, Basemap/Fachebenen-Hooks, Panels).
    einsatz,
    darfSchreiben,
    ladt: einsatzQuery.isLoading || configQuery.isLoading,
    config: configQuery.data,
    einstellungen: einstellungenQuery.data,
    einstellungenLaedt: einstellungenQuery.isLoading,
    zonen: zonenQuery.data ?? [],
    gebiete: gebieteQuery.data ?? [],
    // Rohliste der freien Zeichen für den Inspector-Lookup (Etappe 4, LFH-170).
    freieZeichen: freieZeichenQuery.data ?? [],
    // Abgeleitete Marker/Flächen/Zonen.
    verortet,
    flaechen,
    zonenFeatures,
    alleVerortet,
    nichtVerortetAlle,
  };
}
