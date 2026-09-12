import { useMemo } from 'react';
import { theme } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { einsatzKeys, globalKeys } from '../../api/queryKeys';
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
import { ladeLageSnapshot } from '../../api/lageSnapshot';
import type { Warnstufe } from '../../api/types';
import {
  baueMarker,
  baueTaktischeMarker,
  baueLageMeldungMarker,
  baueFreieZeichenMarker,
  type KarteMarker,
} from './marker';
import { parsePolygon, parseGeometry, polygonZentroid } from './geo';
import { baueTzProps } from './taktischesZeichen';
import { zoneStil, gefahrengebietStil } from './zonenStil';
import type { ZoneFeature } from './kartenLayer';
import type { SnapshotDaten, Standquelle } from './snapshotDaten';

interface LagekarteDatenArgs {
  einsatzId: number;
  /** Zonen-Layer sichtbar (layer.zone, UI-State) → als Parameter, um die Grenze sauber zu halten. */
  zeigeZonen: boolean;
  /** Aktive Ansicht (B/LFH-320): filtert die ansichtsgebundenen Objekte (Zonen, freie Zeichen)
   *  client-seitig auf die der Ansicht PLUS die ansichtslosen. `undefined` = alles zeigen. */
  aktiveAnsichtId?: number;
  /** Datenquelle (C/LFH-321): Live-Zustand (Default) oder ein eingefrorener Snapshot
   *  (Historien-Modus). Im Snapshot-Modus kommen ALLE Objekte + der Org-TZ-Default + die
   *  Gefahrengebiet-Warnstufen aus dem Dokument, und `darfSchreiben` ist hart `false`. */
  quelle?: Standquelle;
}

/**
 * Daten-Leg der Lagekarte: alle Domänen-Queries (SSE-Live via EinsatzLayout, deshalb keine
 * eigene EventSource hier) plus die reinen Marker-/Flächen-/Zonen-Ableitungen. `zonenFeatures`
 * hängt bewusst nur an `zeigeZonen` (nicht am ganzen Layer-State), damit die Grenze sauber bleibt.
 *
 * **Standquelle (C/LFH-321):** Alle Live-Queries sind im Snapshot-Modus abgeschaltet
 * (`enabled: liveAn`); stattdessen liefert `snapQuery` das eingefrorene Dokument, aus dem die
 * ROHEN DTO-Listen in dieselben Ableiter (`baueMarker` etc.) fließen — die Rückgabeform bleibt
 * identisch, die Konsumenten bleiben unverändert.
 */
export function useLagekarteDaten({
  einsatzId,
  zeigeZonen,
  aktiveAnsichtId,
  quelle = { typ: 'live' },
}: LagekarteDatenArgs) {
  const { benutzer } = useAuth();
  // Kartenstil-Module (`marker.ts`, `zonenStil.ts`) erzeugen MapLibre-`paint`-Werte und haben
  // deshalb keinen eigenen `useToken()`-Zugang (LFH-328/A2). Diese Ebene kennt den aktiven
  // Modus und reicht den Token durch — der Modus wird NICHT über `document.documentElement`
  // geraten (globaler Seiteneffekt, in Tests nicht gesetzt).
  const { token } = theme.useToken();
  const istSnapshot = quelle.typ === 'snapshot';
  const liveAn = !istSnapshot;
  const snapshotId = quelle.typ === 'snapshot' ? quelle.id : undefined;

  const snapQuery = useQuery({
    queryKey: einsatzKeys.lageSnapshotDokument(einsatzId, snapshotId as number),
    queryFn: () => ladeLageSnapshot(einsatzId, snapshotId as number),
    enabled: snapshotId != null,
  });

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
    enabled: liveAn,
  });
  const uhsQuery = useQuery({
    queryKey: einsatzKeys.uhs(einsatzId),
    queryFn: () => listeUhs(einsatzId),
    enabled: liveAn,
  });
  const schaedenQuery = useQuery({
    queryKey: einsatzKeys.schaeden(einsatzId),
    queryFn: () => listeSchaeden(einsatzId),
    enabled: liveAn,
  });
  const einheitenQuery = useQuery({
    queryKey: einsatzKeys.einheiten(einsatzId),
    queryFn: () => listeEinheiten(einsatzId),
    enabled: liveAn,
  });
  const fahrzeugeQuery = useQuery({
    queryKey: einsatzKeys.fahrzeuge(einsatzId),
    queryFn: () => listeEinsatzFahrzeuge(einsatzId),
    enabled: liveAn,
  });
  const abschnitteQuery = useQuery({
    queryKey: einsatzKeys.abschnitte(einsatzId),
    queryFn: () => listeAbschnitte(einsatzId),
    enabled: liveAn,
  });
  const zonenQuery = useQuery({
    queryKey: einsatzKeys.zonen(einsatzId),
    queryFn: () => listeZonen(einsatzId),
    enabled: liveAn,
  });
  const freieZeichenQuery = useQuery({
    queryKey: einsatzKeys.freieZeichen(einsatzId),
    queryFn: () => listeFreieZeichen(einsatzId),
    enabled: liveAn,
  });
  const gebieteQuery = useQuery({
    queryKey: einsatzKeys.gefahrengebiete(einsatzId),
    queryFn: () => ladeGefahrengebiete(einsatzId),
    enabled: liveAn,
  });
  const lageMeldungenQuery = useQuery({
    queryKey: einsatzKeys.lagemeldungen(einsatzId),
    queryFn: () => listeLageMeldungen(einsatzId),
    enabled: liveAn,
  });
  const fkQuery = useQuery({
    queryKey: einsatzKeys.fuehrungskraefte(einsatzId),
    queryFn: () => listeFuehrungskraefte(einsatzId),
    enabled: liveAn,
  });
  const orgQuery = useQuery({
    queryKey: globalKeys.organisation(),
    queryFn: ladeOrganisation,
    enabled: liveAn,
  });
  // Config + Einstellungen sind reiner Render-Kontext (Style-Katalog, Basemap-Defaults), kein Teil
  // des eingefrorenen Lagebilds → auch im Historien-Modus live.
  const configQuery = useQuery({ queryKey: globalKeys.karteConfig(), queryFn: ladeKarteConfig });
  const einstellungenQuery = useQuery({
    queryKey: einsatzKeys.einstellungen(einsatzId),
    queryFn: () => ladeEinstellungen(einsatzId),
  });

  // Effektive Rohquellen: im Snapshot-Modus die eingefrorenen DTO-Listen aus dem Dokument, sonst
  // die Live-Query-Daten. Beide Seiten haben dieselbe Form → dieselben Ableiter darunter.
  const snap = istSnapshot ? (snapQuery.data?.daten as SnapshotDaten | undefined) : undefined;
  const einsatz = istSnapshot ? snap?.einsatz : einsatzQuery.data;
  const uhsRoh = istSnapshot ? snap?.uhs : uhsQuery.data;
  const schaedenRoh = istSnapshot ? snap?.schaeden : schaedenQuery.data;
  const einheitenRoh = istSnapshot ? snap?.einheiten : einheitenQuery.data;
  const fahrzeugeRoh = istSnapshot ? snap?.fahrzeuge : fahrzeugeQuery.data;
  const abschnitteRoh = istSnapshot ? snap?.abschnitte : abschnitteQuery.data;
  const zonenRoh = istSnapshot ? snap?.zonen : zonenQuery.data;
  const freieZeichenRoh = istSnapshot ? snap?.freie_zeichen : freieZeichenQuery.data;
  const gebieteRoh = istSnapshot ? snap?.gefahrengebiete : gebieteQuery.data;
  const lageMeldungenRoh = istSnapshot ? snap?.lagemeldungen : lageMeldungenQuery.data;
  const fkRoh = istSnapshot ? snap?.fuehrungskraefte : fkQuery.data;
  // Global-Scope-Freeze (Advisor): Org-TZ-Default aus dem Dokument, NICHT der Live-Query — sonst
  // schriebe eine Org-Umbenennung den historischen Stand um.
  const orgDefault = (istSnapshot ? snap?.org_default : orgQuery.data?.tz_organisation) ?? null;

  // Schreibsperre im Historien-Modus: hart `false` → alle UI-Schreibpfade (prop-gegatet) fallen weg.
  const darfSchreiben = istSnapshot ? false : darfImEinsatzSchreiben(einsatz, benutzer);

  // Ansichts-Filter (B/LFH-320, client-seitig): Objekte der aktiven Ansicht PLUS die
  // ansichtslosen (`ansicht_id == null`). `== null` fängt sowohl `null` als auch das per
  // skip_serializing_if weggelassene Feld (`undefined`).
  const zonen = useMemo(
    () => (zonenRoh ?? []).filter((z) => z.ansicht_id == null || z.ansicht_id === aktiveAnsichtId),
    [zonenRoh, aktiveAnsichtId],
  );
  const freieZeichen = useMemo(
    () =>
      (freieZeichenRoh ?? []).filter(
        (z) => z.ansicht_id == null || z.ansicht_id === aktiveAnsichtId,
      ),
    [freieZeichenRoh, aktiveAnsichtId],
  );

  const { verortet, nichtVerortet } = useMemo(
    () => baueMarker(einsatz, uhsRoh ?? [], schaedenRoh ?? [], token),
    [einsatz, uhsRoh, schaedenRoh, token],
  );

  const taktisch = useMemo(
    () =>
      baueTaktischeMarker({
        einheiten: einheitenRoh ?? [],
        fahrzeuge: fahrzeugeRoh ?? [],
        fuehrungskraefte: fkRoh ?? [],
        orgDefault,
      }),
    [einheitenRoh, fahrzeugeRoh, fkRoh, orgDefault],
  );

  const flaechen = useMemo(
    () =>
      (abschnitteRoh ?? []).flatMap((a) => {
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
    [abschnitteRoh, orgDefault],
  );

  const gebietWarnstufe = useMemo(() => {
    const m = new Map<number, Warnstufe>();
    (gebieteRoh ?? []).forEach((g) => m.set(g.id, g.hoechste_warnstufe));
    return m;
  }, [gebieteRoh]);

  const zonenFeatures = useMemo<ZoneFeature[]>(
    () =>
      (zeigeZonen ? zonen : []).flatMap((z) => {
        const g = parseGeometry(z.geometrie);
        if (!g) return [];
        const stil =
          z.typ === 'gefahrengebiet' && z.gefahrengebiet_id != null
            ? gefahrengebietStil(gebietWarnstufe.get(z.gefahrengebiet_id) ?? 'keine', token)
            : zoneStil(z.typ, z.farbe);
        return [{ id: z.id, geometrie: g, label: z.label ?? null, stil }];
      }),
    [zonen, zeigeZonen, gebietWarnstufe, token],
  );

  // Benannter Quellenkatalog (LFH-331 · B3): Query-Zustand → der Name, unter dem eine
  // Einsatzkraft die Quelle kennt. Er wird IM Callback gebaut, nicht daneben — ein außen
  // gebautes Array hätte pro Render neue Identität, die Memoisierung liefe leer und die
  // Abhängigkeitsprüfung verlangte es trotzdem in der Liste. Verglichen werden deshalb die
  // `isError`-BOOLEANS.
  //
  // NICHT im Katalog: `organisation`, `karte/config` und `einstellungen`. Sie sind
  // Render-Kontext, kein Lagebild — ihr Ausfall lässt kein Objekt von der Karte
  // verschwinden. `karte/config` hat mit dem Basemap-Fallback bereits einen eigenen
  // sichtbaren Ausfallpfad („Keine Basemap konfiguriert …" in der Sidebar); ein zweiter,
  // widersprechender Text daneben verwirrt mehr, als er meldet. `organisation` liefert nur
  // den TZ-Vorgabewert — sein Ausfall zeichnet ein taktisches Zeichen mit der
  // Vorgabe-Organisation statt mit der eigenen, aber es fehlt nichts. Und `einstellungen`
  // trägt Anzeigekonventionen (Koordinatenformat, Zeitzone), keinen Kartengegenstand.
  //
  // Die live/snapshot-Weiche spiegelt `ladt`: im Historien-Modus sind alle elf Live-Queries
  // abgeschaltet, die EINE Quelle ist das eingefrorene Dokument.
  const fehlerhafteQuellen = useMemo<string[]>(() => {
    if (istSnapshot) return snapQuery.isError ? ['Gesicherter Stand'] : [];
    const katalog: [string, boolean][] = [
      ['Einsatzdaten', einsatzQuery.isError],
      ['Unfallhilfsstellen', uhsQuery.isError],
      ['Schäden', schaedenQuery.isError],
      ['Einheiten', einheitenQuery.isError],
      ['Fahrzeuge', fahrzeugeQuery.isError],
      ['Einsatzabschnitte', abschnitteQuery.isError],
      ['Zonen', zonenQuery.isError],
      ['Taktische Zeichen', freieZeichenQuery.isError],
      ['Gefahrengebiete', gebieteQuery.isError],
      ['Lagemeldungen', lageMeldungenQuery.isError],
      ['Personal', fkQuery.isError],
    ];
    return katalog.filter(([, kaputt]) => kaputt).map(([name]) => name);
  }, [
    istSnapshot,
    snapQuery.isError,
    einsatzQuery.isError,
    uhsQuery.isError,
    schaedenQuery.isError,
    einheitenQuery.isError,
    fahrzeugeQuery.isError,
    abschnitteQuery.isError,
    zonenQuery.isError,
    freieZeichenQuery.isError,
    gebieteQuery.isError,
    lageMeldungenQuery.isError,
    fkQuery.isError,
  ]);

  // Erneuter Abruf: gezielt nur die GESCHEITERTEN Quellen. Ein pauschales Invalidieren träfe
  // auch die elf gesunden Listen und liefe im Historien-Modus gegen abgeschaltete Queries.
  // Bewusst KEIN Namenskatalog hier — die Namen leben genau einmal, oben.
  const neuLaden = () => {
    for (const q of [
      snapQuery,
      einsatzQuery,
      uhsQuery,
      schaedenQuery,
      einheitenQuery,
      fahrzeugeQuery,
      abschnitteQuery,
      zonenQuery,
      freieZeichenQuery,
      gebieteQuery,
      lageMeldungenQuery,
      fkQuery,
    ]) {
      if (q.isError) void q.refetch();
    }
  };

  const lageMeldungMarker = useMemo(
    () => baueLageMeldungMarker(lageMeldungenRoh ?? []),
    [lageMeldungenRoh],
  );

  const freieZeichenMarker = useMemo(() => baueFreieZeichenMarker(freieZeichen), [freieZeichen]);

  const alleVerortet = useMemo(
    () => [
      ...verortet,
      ...taktisch.verortet,
      ...flaechen.map((f) => f.tzMarker),
      ...lageMeldungMarker,
      ...freieZeichenMarker,
    ],
    [verortet, taktisch.verortet, flaechen, lageMeldungMarker, freieZeichenMarker],
  );

  const nichtVerortetAlle = useMemo(
    () => [
      ...nichtVerortet,
      ...taktisch.nichtVerortet,
      ...(abschnitteRoh ?? [])
        .filter((a) => !a.flaeche_geojson)
        .map((a) => ({ typ: 'abschnitt' as const, id: a.id, label: a.name })),
    ],
    [nichtVerortet, taktisch.nichtVerortet, abschnitteRoh],
  );

  return {
    // Rohdaten-/Status-Durchreichungen (für Ladegate, Basemap/Fachebenen-Hooks, Panels).
    einsatz,
    darfSchreiben,
    // Ladegate spiegelt die aktive Quelle: im Snapshot-Modus die Dokument-Query (eine disabled
    // Live-Query meldet isLoading=false → sonst „fertig geladen" bei leerem Dokument, Marker-Pop-in).
    ladt: istSnapshot ? snapQuery.isLoading : einsatzQuery.isLoading || configQuery.isLoading,
    // Namen der Lagebild-Quellen, deren Abruf scheiterte (LFH-331 · B3) — leer = vollständig.
    // Die Kürzung für die Anzeige liegt bewusst NICHT hier: sie ist Darstellung, und ein Hook,
    // der schon kürzt, nähme der Seite die Wahl (und dem Test die Zählbarkeit).
    fehlerhafteQuellen,
    /** Erneuter Abruf genau der gescheiterten Quellen. */
    neuLaden,
    config: configQuery.data,
    einstellungen: einstellungenQuery.data,
    einstellungenLaedt: einstellungenQuery.isLoading,
    // Ansichts-gefiltert (B/LFH-320): nur Objekte der aktiven Ansicht + ansichtslose.
    zonen,
    gebiete: gebieteRoh ?? [],
    // Ansichts-gefilterte freie Zeichen für den Inspector-Lookup (Etappe 4, LFH-170).
    freieZeichen,
    // Abgeleitete Marker/Flächen/Zonen.
    verortet,
    flaechen,
    zonenFeatures,
    alleVerortet,
    nichtVerortetAlle,
  };
}
