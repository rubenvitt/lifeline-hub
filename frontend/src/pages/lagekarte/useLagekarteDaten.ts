import { useMemo } from 'react';
import { theme } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { einsatzKeys, globalKeys } from '../../api/queryKeys';
import { ladeEinsatz, ladeEinstellungen, ladeModulOverrides } from '../../api/einsaetze';
import { ApiError } from '../../api/client';
import { listePersonen } from '../../api/einsatzPerson';
import { ladeBetreuung } from '../../api/betreuung';
import { modulRegistry } from '../../einsatz/modulRegistry';
import { personenMarker } from '../../personen/personenKarte';
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
import { holeRueckmeldungen, listeLageMeldungen } from '../../api/meldungen';
import { ladeOrganisation } from '../../api/organisation';
import { ladeLageSnapshot } from '../../api/lageSnapshot';
import type { Warnstufe } from '../../api/types';
import {
  baueMarker,
  baueTaktischeMarker,
  baueLageMeldungMarker,
  baueFreieZeichenMarker,
  baueBetreuungMarker,
  baueAbschnittMarker,
} from './marker';
import { parsePolygon, parseGeometry, polygonZentroid } from './geo';
import { zoneStil, gefahrengebietStil, zonenBeschriftung, bezirkBeschriftung } from './zonenStil';
import { zonenPlakette, type ZoneFeature } from './kartenLayer';
import { rollenwerte } from '../../components/instrument';
import type { SnapshotDaten, Standquelle } from './snapshotDaten';
import { personenZugriffVon } from './personenEbene';
import { betreuungZugriffVon } from './betreuungEbene';

/**
 * Name der Personen-Quelle im Ausfallhinweis — die Seite filtert sie für Kopfzahl und „Nicht
 * verortet" heraus, die Personen nie enthalten.
 */
export const QUELLE_BETROFFENE = 'Betroffene';

/** Registry-Eintrag des Moduls „Personen" — die Frage „darf diese Ebene laden" hängt daran. */
const PERSONEN_MODUL = modulRegistry.find((m) => m.key === 'personen');
/** Registry-Eintrag des Moduls „Betreuung" — Grenze der Ebene „Betreuungsstellen". */
const BETREUUNG_MODUL = modulRegistry.find((m) => m.key === 'betreuung');

interface LagekarteDatenArgs {
  einsatzId: number;
  /** Zonen-Layer sichtbar (layer.zone, UI-State) → als Parameter, um die Grenze sauber zu halten. */
  zeigeZonen: boolean;
  /**
   * Aktive Ansicht: filtert die ansichtsgebundenen Objekte (Zonen, freie Zeichen) client-seitig auf
   * die der Ansicht plus die ansichtslosen. `undefined` = alles zeigen.
   */
  aktiveAnsichtId?: number;
  /**
   * Datenquelle: Live-Zustand (Default) oder ein eingefrorener Snapshot. Im Snapshot-Modus kommen
   * alle Objekte, der Org-TZ-Default und die Gefahrengebiet-Warnstufen aus dem Dokument, und
   * `darfSchreiben` ist hart `false`.
   */
  quelle?: Standquelle;
}

/**
 * Daten-Leg der Lagekarte: alle Domänen-Queries (live über EinsatzLayout, keine eigene EventSource)
 * plus die reinen Marker-/Flächen-/Zonen-Ableitungen. `zonenFeatures` hängt nur an `zeigeZonen`,
 * nicht am ganzen Layer-State.
 *
 * **Standquelle:** im Snapshot-Modus sind alle Live-Queries abgeschaltet (`enabled: liveAn`);
 * `snapQuery` liefert das Dokument, dessen rohe DTO-Listen in dieselben Ableiter fließen — die
 * Rückgabeform bleibt identisch.
 */
export function useLagekarteDaten({
  einsatzId,
  zeigeZonen,
  aktiveAnsichtId,
  quelle = { typ: 'live' },
}: LagekarteDatenArgs) {
  const { benutzer } = useAuth();
  // Kartenstil-Module (`marker.ts`, `zonenStil.ts`) erzeugen MapLibre-`paint`-Werte und haben
  // keinen `useToken()`-Zugang; diese Ebene reicht den Token des aktiven Modus durch, statt ihn aus
  // `document.documentElement` zu raten.
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
  // Letzte Rückmeldung je Einheit für das Paneel „Ausgewählt". Nur live: der gesicherte Stand trägt
  // keine Rückmeldungen, eine heutige Meldung neben einem eingefrorenen Lagebild wäre falsch.
  const rueckmeldungenQuery = useQuery({
    queryKey: einsatzKeys.meldungenRueckmeldungen(einsatzId),
    queryFn: () => holeRueckmeldungen(einsatzId),
    enabled: liveAn,
  });
  const fkQuery = useQuery({
    queryKey: einsatzKeys.fuehrungskraefte(einsatzId),
    queryFn: () => listeFuehrungskraefte(einsatzId),
    enabled: liveAn,
  });
  // Ebene „Betroffene": die Zugriffsgrenze ist diese Query, nicht der Schalter
  // (`personenEbene.ts`). Sie läuft erst, wenn die Overrides feststehen und das Modul „Personen" im
  // Client frei ist; ein 403 kippt danach auf „gesperrt". Der Key ist der argumentlose
  // Bestands-Accessor, dasselbe Fach wie Personenseite, Dashboard, Chat und Palette, live
  // invalidiert vom `person`-Event (nur an Leser mit „Personen", `src/live/mod.rs`). Overrides sind
  // Render-Kontext und laden auch im Historien-Modus.
  const overridesQuery = useQuery({
    queryKey: einsatzKeys.modulOverrides(einsatzId),
    queryFn: () => ladeModulOverrides(einsatzId),
  });
  const personenVorab = personenZugriffVon({
    istSnapshot,
    rechteBekannt: overridesQuery.isFetched,
    modul: PERSONEN_MODUL,
    benutzer,
    overrides: overridesQuery.data,
    abgelehnt: false,
  });
  const personenQuery = useQuery({
    queryKey: einsatzKeys.personen(einsatzId),
    queryFn: () => listePersonen(einsatzId),
    enabled: personenVorab === 'frei',
  });
  const personenZugriff = personenZugriffVon({
    istSnapshot,
    rechteBekannt: overridesQuery.isFetched,
    modul: PERSONEN_MODUL,
    benutzer,
    overrides: overridesQuery.data,
    abgelehnt: personenQuery.error instanceof ApiError && personenQuery.error.status === 403,
  });
  // Nur bei freiem Modul: ein 403 ist „gesperrt" (Zustand der Zeile), kein Ausfall.
  const personenFehler = personenZugriff === 'frei' && personenQuery.isError;
  // Ebene „Betreuungsstellen": dieselbe Grenze wie bei „Betroffene"; ein 403 kippt auf „gesperrt",
  // nie auf einen Quellenfehler. Das Fach ist die Übersicht der Modulseite
  // (`einsatzKeys.betreuung`), live invalidiert vom `betreuung`-Event, das nur Leser mit Modulrecht
  // bekommen. Im Historien-Modus kommen die Stellen aus dem Dokument.
  const betreuungVorab = betreuungZugriffVon({
    rechteBekannt: overridesQuery.isFetched,
    modul: BETREUUNG_MODUL,
    benutzer,
    overrides: overridesQuery.data,
    abgelehnt: false,
  });
  const betreuungQuery = useQuery({
    queryKey: einsatzKeys.betreuung(einsatzId),
    queryFn: () => ladeBetreuung(einsatzId),
    enabled: liveAn && betreuungVorab === 'frei',
  });
  const betreuungZugriff = betreuungZugriffVon({
    rechteBekannt: overridesQuery.isFetched,
    modul: BETREUUNG_MODUL,
    benutzer,
    overrides: overridesQuery.data,
    abgelehnt: betreuungQuery.error instanceof ApiError && betreuungQuery.error.status === 403,
  });
  // Nur bei freiem Modul: ein 403 ist „gesperrt", kein Ausfall.
  const betreuungFehler = liveAn && betreuungZugriff === 'frei' && betreuungQuery.isError;
  const orgQuery = useQuery({
    queryKey: globalKeys.organisation(),
    queryFn: ladeOrganisation,
    enabled: liveAn,
  });
  // Config + Einstellungen sind Render-Kontext (Style-Katalog, Basemap-Defaults), kein Teil des
  // Lagebilds → auch im Historien-Modus live.
  const configQuery = useQuery({ queryKey: globalKeys.karteConfig(), queryFn: ladeKarteConfig });
  const einstellungenQuery = useQuery({
    queryKey: einsatzKeys.einstellungen(einsatzId),
    queryFn: () => ladeEinstellungen(einsatzId),
  });

  // Effektive Rohquellen: im Snapshot-Modus die DTO-Listen aus dem Dokument, sonst die Live-Daten —
  // dieselbe Form, dieselben Ableiter.
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
  // Ohne Modulrecht leer, auch wenn ein früherer Abruf im Cache steht; nach einem Fehler ebenso
  // (react-query lässt `data` stehen).
  const stellenRoh =
    betreuungZugriff !== 'frei'
      ? undefined
      : istSnapshot
        ? snap?.betreuungsstellen
        : betreuungQuery.isError
          ? undefined
          : betreuungQuery.data?.stellen;
  // Bezirke hinter derselben Grenze: Bezeichnung und Räumungszustand beschriften die
  // Bezirksflächen, die jeder Karten-Leser sieht.
  const bezirkeRoh =
    betreuungZugriff !== 'frei'
      ? undefined
      : istSnapshot
        ? snap?.evakuierungsbezirke
        : betreuungQuery.isError
          ? undefined
          : betreuungQuery.data?.bezirke;
  // Org-TZ-Default aus dem Dokument, nicht aus der Live-Query — sonst schriebe eine Org-Umbenennung
  // den historischen Stand um.
  const orgDefault = (istSnapshot ? snap?.org_default : orgQuery.data?.tz_organisation) ?? null;

  // Schreibsperre im Historien-Modus: hart `false` → alle UI-Schreibpfade (prop-gegatet) fallen weg.
  const darfSchreiben = istSnapshot ? false : darfImEinsatzSchreiben(einsatz, benutzer);

  // Ansichts-Filter (client-seitig): Objekte der aktiven Ansicht plus die ansichtslosen. `== null`
  // fängt `null` und das per skip_serializing_if weggelassene Feld.
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

  const { verortet: basisVerortet, nichtVerortet: basisNichtVerortet } = useMemo(
    () => baueMarker(einsatz, uhsRoh ?? [], schaedenRoh ?? [], token),
    [einsatz, uhsRoh, schaedenRoh, token],
  );
  const stellen = useMemo(() => baueBetreuungMarker(stellenRoh ?? [], token), [stellenRoh, token]);
  const verortet = useMemo(
    () => [...basisVerortet, ...stellen.verortet],
    [basisVerortet, stellen.verortet],
  );
  const nichtVerortet = useMemo(
    () => [...basisNichtVerortet, ...stellen.nichtVerortet],
    [basisNichtVerortet, stellen.nichtVerortet],
  );

  const taktisch = useMemo(
    () =>
      baueTaktischeMarker(
        {
          einheiten: einheitenRoh ?? [],
          fahrzeuge: fahrzeugeRoh ?? [],
          fuehrungskraefte: fkRoh ?? [],
          orgDefault,
        },
        token,
      ),
    [einheitenRoh, fahrzeugeRoh, fkRoh, orgDefault, token],
  );

  const flaechen = useMemo(
    () =>
      (abschnitteRoh ?? []).flatMap((a) => {
        const poly = parsePolygon(a.flaeche_geojson);
        if (!poly) return [];
        const z = polygonZentroid(poly);
        if (!z) return [];
        return [
          {
            id: a.id,
            label: a.name,
            polygon: poly,
            tzMarker: baueAbschnittMarker(a, poly, z, orgDefault, token),
          },
        ];
      }),
    [abschnitteRoh, orgDefault, token],
  );

  const gebietWarnstufe = useMemo(() => {
    const m = new Map<number, Warnstufe>();
    (gebieteRoh ?? []).forEach((g) => m.set(g.id, g.hoechste_warnstufe));
    return m;
  }, [gebieteRoh]);

  const bezirkNachId = useMemo(() => {
    const m = new Map<number, NonNullable<typeof bezirkeRoh>[number]>();
    (bezirkeRoh ?? []).forEach((b) => m.set(b.id, b));
    return m;
  }, [bezirkeRoh]);

  // Beschriftungsplakette aus den Rollen des aktiven Modus.
  const plakette = useMemo(() => zonenPlakette(rollenwerte(token)), [token]);

  const zonenFeatures = useMemo<ZoneFeature[]>(
    () =>
      (zeigeZonen ? zonen : []).flatMap((z) => {
        const g = parseGeometry(z.geometrie);
        if (!g) return [];
        // Eine Ableitung der Stufe für beide Kanäle, damit Farbe und Beschriftung nicht
        // auseinanderlaufen (LFH-357). Den fehlenden Nachschlag behandeln sie absichtlich
        // verschieden: `ladt` hängt nicht an der Gebiets-Query, die Zone wird also auch ohne
        // Nachschlag gezeichnet. Die Farbe rundet dann vorsichtshalber auf `keine` (Alarm), der
        // Text nicht — „keine" wäre eine Behauptung über fehlende Daten.
        const gebietId = z.typ === 'gefahrengebiet' ? z.gefahrengebiet_id : null;
        const warnstufe = gebietId != null ? gebietWarnstufe.get(gebietId) : undefined;
        const stil =
          gebietId != null
            ? gefahrengebietStil(warnstufe ?? 'keine', token)
            : zoneStil(z.typ, z.farbe);
        // Bezirksfläche: Name und Räumungszustand nur, wenn der Bezirk lesbar ist.
        const beschriftung =
          z.typ === 'evakuierungsbezirk'
            ? bezirkBeschriftung(
                z.label,
                z.evakuierungsbezirk_id != null
                  ? (bezirkNachId.get(z.evakuierungsbezirk_id) ?? null)
                  : null,
              )
            : zonenBeschriftung(z.label, gebietId != null ? (warnstufe ?? 'unbekannt') : null);
        return [
          {
            id: z.id,
            geometrie: g,
            label: beschriftung,
            stil,
            // Gefahrenzonen gestrichelt — reine Darstellung am Zonentyp.
            gestrichelt: z.typ === 'gefahrengebiet',
            plakette,
          },
        ];
      }),
    [zonen, zeigeZonen, gebietWarnstufe, bezirkNachId, token, plakette],
  );

  // Benannter Quellenkatalog (LFH-331): Query-Zustand → der Name, unter dem eine Einsatzkraft die
  // Quelle kennt. Im Callback gebaut, damit die Memoisierung an den `isError`-Booleans hängt statt
  // an einem Array mit neuer Identität.
  //
  // Nicht im Katalog: `organisation`, `karte/config`, `einstellungen` und die Rückmeldungen —
  // Render-Kontext, ihr Ausfall lässt kein Objekt verschwinden. `karte/config` hat mit dem
  // Basemap-Fallback schon einen eigenen sichtbaren Ausfallpfad in der Sidebar; `organisation`
  // liefert nur den TZ-Vorgabewert; `einstellungen` trägt Anzeigekonventionen. Die Rückmeldungen
  // hängen am Leserecht auf „Meldungen": ein 403 ist für Rollen ohne das Modul normal und stünde
  // sonst dauerhaft im Banner.
  //
  // Die live/snapshot-Weiche spiegelt `ladt`: im Historien-Modus ist das Dokument die eine Quelle.
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
      // Betreuungsstellen stehen in Kopfzahl und „Nicht verortet" wie die UHS, ihr Ausfall ist ein
      // Ausfall des Lagebilds. Ein 403 ist es nicht (`betreuungFehler`).
      ['Betreuungsstellen', betreuungFehler],
      [QUELLE_BETROFFENE, personenFehler],
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
    betreuungFehler,
    personenFehler,
  ]);

  // Erneuter Abruf nur der gescheiterten Quellen. Pauschales Invalidieren träfe die gesunden Listen
  // und liefe im Historien-Modus gegen abgeschaltete Queries. Die Namen leben genau einmal, oben.
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
    // Personen und Betreuung nur bei freiem Modul — ein 403 ist kein Ausfall und wird nicht
    // wiederholt.
    if (personenFehler) void personenQuery.refetch();
    if (betreuungFehler) void betreuungQuery.refetch();
  };

  const lageMeldungMarker = useMemo(
    () => baueLageMeldungMarker(lageMeldungenRoh ?? [], token),
    [lageMeldungenRoh, token],
  );

  const freieZeichenMarker = useMemo(
    () => baueFreieZeichenMarker(freieZeichen, token),
    [freieZeichen, token],
  );

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

  // Betroffene als eigene Liste, nie in `alleVerortet`: das speist Startausschnitt und Kopfzahl
  // „verortet", die weder vom Schalter noch vom Modulrecht abhängen sollen. Nach einem Fehler `[]`
  // statt der stehengebliebenen Altdaten.
  const personenDaten =
    personenZugriff === 'frei' && !personenQuery.isError ? personenQuery.data : undefined;
  const personenVerortet = useMemo(
    () => (personenDaten ? personenMarker(personenDaten, token).marker : []),
    [personenDaten, token],
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
    // Ladegate spiegelt die aktive Quelle: im Snapshot-Modus die Dokument-Query (eine abgeschaltete
    // Live-Query meldet isLoading=false → sonst „fertig" bei leerem Dokument, Marker-Pop-in).
    ladt: istSnapshot ? snapQuery.isLoading : einsatzQuery.isLoading || configQuery.isLoading,
    // Stehen alle Quellen der Marker fest (geladen oder gescheitert)? Die Startansicht
    // (`startAnsicht.ts`) braucht das vollständige Bild; `ladt` hängt nur an Einsatz und Config.
    markerLaden: istSnapshot
      ? snapQuery.isLoading
      : einsatzQuery.isLoading ||
        uhsQuery.isLoading ||
        schaedenQuery.isLoading ||
        einheitenQuery.isLoading ||
        fahrzeugeQuery.isLoading ||
        abschnitteQuery.isLoading ||
        freieZeichenQuery.isLoading ||
        lageMeldungenQuery.isLoading ||
        fkQuery.isLoading ||
        // Vor feststehenden Rechten weiß niemand, ob Stellen kommen; sie speisen den
        // Startausschnitt wie die UHS.
        !overridesQuery.isFetched ||
        betreuungQuery.isLoading,
    // Namen der Lagebild-Quellen, deren Abruf scheiterte (leer = vollständig). Die Kürzung für die
    // Anzeige ist Darstellung und liegt bei der Seite.
    fehlerhafteQuellen,
    /** Erneuter Abruf genau der gescheiterten Quellen. */
    neuLaden,
    config: configQuery.data,
    einstellungen: einstellungenQuery.data,
    einstellungenLaedt: einstellungenQuery.isLoading,
    // Ansichts-gefiltert: nur Objekte der aktiven Ansicht + ansichtslose.
    zonen,
    // Ungefiltert und ob die Liste feststeht: ein Deeplink auf eine Bezirksfläche muss sie auch in
    // einer anderen Ansicht finden und einen Auftrag ohne Treffer räumen können.
    zonenAlle: zonenRoh ?? [],
    zonenGeladen: istSnapshot ? !snapQuery.isLoading : zonenQuery.isFetched,
    // Stehen die Modulrechte fest? Der Platzier-Auftrag für eine Stelle wartet darauf.
    rechteBekannt: overridesQuery.isFetched,
    gebiete: gebieteRoh ?? [],
    // Evakuierungsbezirke für den Zonen-Inspector — leer ohne Modulrecht.
    bezirke: bezirkeRoh ?? [],
    // Ansichts-gefilterte freie Zeichen für den Inspector-Lookup.
    freieZeichen,
    // Rohlisten für das Datenraster im Paneel „Ausgewählt": die Marker tragen nur Name/Ort/Zeichen,
    // Stärke, Abschnitt oder Status stehen allein im DTO. Im Historien-Modus der eingefrorene
    // Stand.
    rohdaten: {
      einheiten: einheitenRoh ?? [],
      fahrzeuge: fahrzeugeRoh ?? [],
      fuehrungskraefte: fkRoh ?? [],
      uhs: uhsRoh ?? [],
      schaeden: schaedenRoh ?? [],
      abschnitte: abschnitteRoh ?? [],
      betreuungsstellen: stellenRoh ?? [],
      // Nur ein erfolgreicher Live-Abruf; nach Fehler bliebe `data` als stiller Altstand stehen.
      rueckmeldungen:
        istSnapshot || rueckmeldungenQuery.isError ? undefined : rueckmeldungenQuery.data,
    },
    // Abgeleitete Marker/Flächen/Zonen.
    verortet,
    flaechen,
    zonenFeatures,
    alleVerortet,
    nichtVerortetAlle,
    // Ebene „Betreuungsstellen": Zugriffszustand für die Zeile; die Marker stehen in
    // `verortet`/`alleVerortet`/`nichtVerortetAlle` wie die UHS.
    betreuungZugriff,
    // Ebene „Betroffene": Zugriffszustand für Zeile/Legende, Marker getrennt.
    personenZugriff,
    personenVerortet,
    /**
     * Die Personenliste scheiterte bei freiem Modul (kein 403). Steht zugleich als
     * `QUELLE_BETROFFENE` in `fehlerhafteQuellen`; die Seite trennt beides, weil Personen weder
     * Kopfzahl noch „Nicht verortet" speisen.
     */
    personenFehler,
  };
}
