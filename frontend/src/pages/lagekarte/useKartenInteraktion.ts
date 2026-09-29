import { useCallback, useReducer, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { aktualisiereEinsatz, type KopfdatenUpdate } from '../../api/einsaetze';
import { aktualisiereUhs } from '../../api/einsatzUhs';
import { aktualisiereSchaden } from '../../api/einsatzSchaden';
import { verorteEinheit } from '../../api/einheiten';
import { verorteFahrzeug } from '../../api/einsatzFahrzeuge';
import { verortePerson } from '../../api/einsatzPersonal';
import { aktualisierePerson } from '../../api/einsatzPerson';
import { aendereStelle } from '../../api/betreuung';
import { zeichneAbschnitt } from '../../api/einsatzabschnitte';
import { legeZoneAn, aktualisiereZone, loescheZone, type ZonePatch } from '../../api/lagezonen';
import {
  legeFreiesZeichenAn,
  aktualisiereFreiesZeichen,
  loescheFreiesZeichen,
  verschiebeFreiesZeichen,
} from '../../api/freieZeichen';
import { einsatzKeys } from '../../api/queryKeys';
import type { EinsatzAnzeige, ZoneTyp, FreiesZeichenUpdate } from '../../api/types';
import type { FachebeneQuelle } from '../../api/fachebenen';
import type { KarteMarker } from './marker';
import type { GeoJsonGeometry, GeoJsonPolygon } from './geo';
import type { ZeichenModus } from './zeichnen';
import type { MessForm } from './messung';
import type { PlatzierenPunktTyp } from './Sidebar';
import { merkeZuletztVerwendet } from './zuletztVerwendet';

/** EinsatzAnzeige → KopfdatenUpdate (Vollersatz) mit überschriebener Koordinate. */
function kopfMitKoordinate(
  e: EinsatzAnzeige,
  lat: number | null,
  lon: number | null,
): KopfdatenUpdate {
  return {
    bezeichnung: e.bezeichnung,
    stichwort: e.stichwort ?? null,
    einsatzart: e.einsatzart,
    leitstellen_nr: e.leitstellen_nr ?? null,
    einsatzort: e.einsatzort ?? null,
    einsatzort_lat: lat,
    einsatzort_lon: lon,
    meldende_stelle: e.meldende_stelle ?? null,
    sachverhalt: e.sachverhalt ?? null,
    anzahl_betroffene_initial: e.anzahl_betroffene_initial ?? null,
    begonnen_at: e.begonnen_at,
  };
}

type ZoneEntwurf = { typ: ZoneTyp; modus: ZeichenModus; farbe?: string };
type ZoneBestaetigung = ZoneEntwurf & { geometrie: GeoJsonGeometry };

/**
 * Der aktive Interaktionsmodus der Lagekarte. Die wechselseitige Exklusivität folgt aus dem
 * Datentyp: es gibt genau ein Modus-Feld, ein neuer Modus ersetzt den alten.
 *
 * `zone` trägt ihre Bestätigungs-Phase als Sub-Zustand: der Entwurf bleibt sichtbar, bis
 * gespeichert oder verworfen wird.
 */
type KartenModus =
  | { art: 'idle' }
  | { art: 'platzieren'; ziel: { typ: PlatzierenPunktTyp | 'einsatzort'; id: number } }
  | { art: 'abschnitt'; id: number }
  | { art: 'zone'; entwurf: ZoneEntwurf; bestaetigung: ZoneBestaetigung | null; speichern: boolean }
  | { art: 'bild'; id: number }
  | { art: 'zeichen'; spec: FreiesZeichenUpdate }
  /**
   * Messen ist exklusiv wie die anderen Modi (ein Klick darf weder ein Panel öffnen noch verorten),
   * braucht aber kein Schreibrecht: gespeichert wird nichts.
   */
  | { art: 'messen'; form: MessForm };

type ModusAktion =
  | { t: 'platzieren'; ziel: { typ: PlatzierenPunktTyp | 'einsatzort'; id: number } }
  | { t: 'abschnitt'; id: number }
  | { t: 'zone'; entwurf: ZoneEntwurf }
  | { t: 'bild'; id: number }
  | { t: 'zeichen'; spec: FreiesZeichenUpdate }
  | { t: 'messen'; form: MessForm }
  | { t: 'zoneGezeichnet'; geometrie: GeoJsonGeometry }
  | { t: 'zoneSpeichernStart' }
  /** Beenden nur, wenn der laufende Modus einer der genannten ist (sonst No-op). */
  | { t: 'beenden'; arten: KartenModus['art'][] };

type FachebeneAuswahl = {
  quelle: FachebeneQuelle;
  properties: Record<string, unknown>;
  geometrie?: { type: string; coordinates: unknown } | null;
};

/**
 * Die aktive Panel-Selektion. Auch hier ist die Exklusivität ein Datentyp: LagekartePage rendert
 * jeden Inspektor unabhängig (kein `else`), zwei gesetzte Auswahl-States ergäben zwei Panels.
 * `objekt` deckt Marker und Abschnitt (beide über den `auswahl`-String).
 */
type KartenSelektion =
  | { art: 'keine' }
  | { art: 'objekt'; schluessel: string }
  | { art: 'zone'; id: number }
  | { art: 'fachebene'; wert: FachebeneAuswahl };

function modusReducer(state: KartenModus, a: ModusAktion): KartenModus {
  switch (a.t) {
    case 'platzieren':
      return { art: 'platzieren', ziel: a.ziel };
    case 'abschnitt':
      return { art: 'abschnitt', id: a.id };
    case 'bild':
      return { art: 'bild', id: a.id };
    case 'zeichen':
      return { art: 'zeichen', spec: a.spec };
    case 'messen':
      return { art: 'messen', form: a.form };
    case 'zone':
      return { art: 'zone', entwurf: a.entwurf, bestaetigung: null, speichern: false };
    case 'zoneGezeichnet':
      // Nicht sofort persistieren: erst Bestätigung, der Entwurf bleibt sichtbar.
      return state.art === 'zone'
        ? { ...state, bestaetigung: { ...state.entwurf, geometrie: a.geometrie } }
        : state;
    case 'zoneSpeichernStart':
      return state.art === 'zone' ? { ...state, speichern: true } : state;
    case 'beenden':
      return a.arten.includes(state.art) ? { art: 'idle' } : state;
  }
}

interface KartenInteraktionArgs {
  einsatzId: number;
  einsatz: EinsatzAnzeige | undefined;
  darfSchreiben: boolean;
  /**
   * Alle anwählbaren Marker: `alleVerortet` plus, bei sichtbarer Ebene, die Betroffenen, die
   * bewusst nicht in `alleVerortet` stehen.
   */
  waehlbar: KarteMarker[];
  /** Aktive Ansicht: neu angelegte Objekte werden auf ihr gestempelt. */
  aktiveAnsichtId?: number;
  /** Stabiler Fehler-Handler (useCallback über App.useApp-message). */
  fehler: (e: unknown) => void;
  /** Sichtbare fachliche Quittung nach serverseitig erfolgreicher Aktion. */
  erfolg: (text: string) => void;
}

/**
 * Interaktions-Leg der Lagekarte: die exklusiven Modi (Platzieren, Abschnitt- und Zonen-Zeichnen,
 * Bild-Platzieren, Messen, Selektion) als FSM samt Start-/Reset-Handlern, dazu die Verortungs- und
 * Zonen-CRUD-Mutationen.
 */
export function useKartenInteraktion({
  einsatzId,
  einsatz,
  darfSchreiben,
  waehlbar,
  aktiveAnsichtId,
  fehler,
  erfolg,
}: KartenInteraktionArgs) {
  const qc = useQueryClient();

  const [modus, dispatch] = useReducer(modusReducer, { art: 'idle' } as KartenModus);

  // Steigt bei jedem Zonen-Zeichnen-Start und erzwingt ein Re-Fire des Zonen-Effekts in
  // Kartenflaeche auch bei gleichem Modus (z. B. Polygon → Polygon), damit starten() einen offenen,
  // unbestätigten Entwurf verwirft statt ihn als Orphan liegen zu lassen. Bewusst nicht im Modus:
  // der Zähler muss über Moduswechsel monoton bleiben.
  const [zoneZeichnenNonce, setZoneZeichnenNonce] = useState(0);
  // Serienmodus: der Platzier-Modus bleibt nach jedem gesetzten Objekt stehen (Vorgabe an, eine
  // Folge ist der Normalfall) und endet über „Fertig". Die Zähler tragen die Anzeige „n platziert"
  // und die Beschriftung des Abbruch-Knopfs: ohne gespeichertes Objekt „Abbrechen", danach
  // „Fertig", denn Gespeichertes lässt sich nicht abbrechen.
  const [zeichenSerie, setZeichenSerie] = useState(true);
  const [zeichenSerieAnzahl, setZeichenSerieAnzahl] = useState(0);
  const [zoneSerie, setZoneSerie] = useState(true);
  const [zoneSerieAnzahl, setZoneSerieAnzahl] = useState(0);
  // Läuft das Speichern einer Abschnittsfläche? Esc bleibt dann wirkungslos, wie beim
  // Zonen-Speichern (Marke `speichern` im Modus).
  const [abschnittSpeichern, setAbschnittSpeichern] = useState(false);

  // Spiegel von `modus` und `zoneSerie` für die asynchrone Auflösung des Zonen-Speicherns. Die
  // Zuweisung steht im Renderrumpf, nicht in einem Effekt: der liefe erst nach dem Commit, und
  // dazwischen kann die Promise auflösen. Refs statt Closure-Werten, damit ein während des
  // Speicherns umgelegter Schalter noch wirkt.
  const modusRef = useRef(modus);
  modusRef.current = modus;
  const zoneSerieRef = useRef(zoneSerie);
  zoneSerieRef.current = zoneSerie;
  // Panel-Selektion als eine Union (s. KartenSelektion). Die drei Setter sind Wrapper über ein
  // Feld: ein Setzen verdrängt jede andere Selektion, null räumt.
  const [selektion, setSelektion] = useState<KartenSelektion>({ art: 'keine' });
  const [flyToZiel, setFlyToZiel] = useState<{ lng: number; lat: number } | null>(null);
  const verortenLaeuft = useRef(false);

  const auswahl = selektion.art === 'objekt' ? selektion.schluessel : null;
  const zoneAuswahl = selektion.art === 'zone' ? selektion.id : null;
  // Angeklicktes Fachebenen-Objekt → Detail-Panel. `geometrie` ist die volle, ungeclippte Geometrie
  // aus der FeatureCollection (Fläche/Umfang).
  const fachebeneAuswahl = selektion.art === 'fachebene' ? selektion.wert : null;
  // Stabile Identität: diese Setter stehen in Effekt-Deps von LagekartePage (Reverse-Deeplink).
  // setSelektion ist stabil, daher leere Deps.
  const setAuswahl = useCallback(
    (s: string | null) =>
      setSelektion(s != null ? { art: 'objekt', schluessel: s } : { art: 'keine' }),
    [],
  );
  const setZoneAuswahl = useCallback(
    (id: number | null) => setSelektion(id != null ? { art: 'zone', id } : { art: 'keine' }),
    [],
  );
  const setFachebeneAuswahl = useCallback(
    (w: FachebeneAuswahl | null) =>
      setSelektion(w != null ? { art: 'fachebene', wert: w } : { art: 'keine' }),
    [],
  );

  // Aus dem Modus abgeleitet — die Werte können konstruktionsbedingt nicht gleichzeitig gesetzt
  // sein.
  const platzierungZiel = modus.art === 'platzieren' ? modus.ziel : null;
  const zeichneAbschnittId = modus.art === 'abschnitt' ? modus.id : null;
  const zoneEntwurf = modus.art === 'zone' ? modus.entwurf : null;
  const zoneBestaetigung = modus.art === 'zone' ? modus.bestaetigung : null;
  const zoneSpeichern = modus.art === 'zone' ? modus.speichern : false;
  const bildPlatzierenId = modus.art === 'bild' ? modus.id : null;
  const zeichenPlatzieren = modus.art === 'zeichen' ? modus.spec : null;
  const messForm = modus.art === 'messen' ? modus.form : null;

  // Während eines exklusiven Modus darf ein Karten-Klick auf ein Objekt kein Auswahl-Panel öffnen
  // (sonst Doppel-Panel neben der ZeichnenSteuerung).
  const exklusiverModusAktiv = modus.art !== 'idle';

  // Verorten je nach Ziel-Typ (UHS/Schaden live; Einsatzort über Kopf-PATCH, dann invalidieren).
  const verortenMutation = useMutation({
    mutationFn: async (p: { lat: number | null; lon: number | null }) => {
      if (!platzierungZiel) return;
      if (platzierungZiel.typ === 'uhs') {
        await aktualisiereUhs(einsatzId, platzierungZiel.id, { lat: p.lat, lon: p.lon });
      } else if (platzierungZiel.typ === 'schaden') {
        await aktualisiereSchaden(einsatzId, platzierungZiel.id, { lat: p.lat, lon: p.lon });
      } else if (platzierungZiel.typ === 'einheit') {
        await verorteEinheit(einsatzId, platzierungZiel.id, { lat: p.lat, lon: p.lon });
      } else if (platzierungZiel.typ === 'fahrzeug') {
        await verorteFahrzeug(einsatzId, platzierungZiel.id, { lat: p.lat, lon: p.lon });
      } else if (platzierungZiel.typ === 'fuehrung') {
        await verortePerson(einsatzId, platzierungZiel.id, { lat: p.lat, lon: p.lon });
      } else if (platzierungZiel.typ === 'person') {
        // Betroffene: nur die zwei Koordinatenfelder — `patchBody` liest vorhandene Keys, jeder
        // weitere wäre ein „leeren". `verortePerson` oben ist das Personal.
        await aktualisierePerson(einsatzId, platzierungZiel.id, {
          antreff_lat: p.lat,
          antreff_lon: p.lon,
        });
      } else if (platzierungZiel.typ === 'betreuungsstelle') {
        // Betreuungsstelle: nur das Koordinatenpaar; der PATCH ist tri-state, ein fehlender
        // Schlüssel bleibt unverändert.
        await aendereStelle(einsatzId, platzierungZiel.id, { lat: p.lat, lon: p.lon });
      } else if (platzierungZiel.typ === 'einsatzort' && einsatz) {
        await aktualisiereEinsatz(einsatzId, kopfMitKoordinate(einsatz, p.lat, p.lon));
      }
      // Das Ziel reist als Ergebnis zu `onSuccess`: dort steht fest, wem der PATCH galt, unabhängig
      // vom inzwischen laufenden Modus.
      return platzierungZiel;
    },
    onSuccess: (ziel) => {
      erfolg('Objekt verortet');
      qc.invalidateQueries({ queryKey: einsatzKeys.einsatz(einsatzId) });
      qc.invalidateQueries({ queryKey: einsatzKeys.uhs(einsatzId) });
      qc.invalidateQueries({ queryKey: einsatzKeys.schaeden(einsatzId) });
      qc.invalidateQueries({ queryKey: einsatzKeys.einheiten(einsatzId) });
      qc.invalidateQueries({ queryKey: einsatzKeys.fahrzeuge(einsatzId) });
      qc.invalidateQueries({ queryKey: einsatzKeys.fuehrungskraefte(einsatzId) });
      if (ziel?.typ === 'person') {
        qc.invalidateQueries({ queryKey: einsatzKeys.personen(einsatzId) });
        qc.invalidateQueries({ queryKey: einsatzKeys.person(einsatzId, ziel.id) });
      }
      if (ziel?.typ === 'betreuungsstelle') {
        qc.invalidateQueries({ queryKey: einsatzKeys.betreuung(einsatzId) });
      }
      dispatch({ t: 'beenden', arten: ['platzieren'] });
    },
    onError: fehler,
    onSettled: () => {
      verortenLaeuft.current = false;
    },
  });

  // Freies Zeichen am Klickpunkt anlegen; die Spec kommt aus dem Platzier-Modus.
  const legeZeichenMutation = useMutation({
    mutationFn: async (p: { lat: number; lon: number }) => {
      if (!zeichenPlatzieren) return null;
      await legeFreiesZeichenAn(einsatzId, {
        lat: p.lat,
        lon: p.lon,
        ...zeichenPlatzieren,
        ansicht_id: aktiveAnsichtId ?? null,
      });
      return zeichenPlatzieren;
    },
    onSuccess: (gesendet) => {
      erfolg('Taktisches Zeichen angelegt');
      // „Zuletzt verwendet" erst nach dem gespeicherten Zeichen, nicht beim Wählen im Picker, sonst
      // stünden Zwischenstände in der Leiste. Gemerkt wird, was gesendet wurde: wer vor der Antwort
      // „Fertig" drückt, hat den Modus schon geleert.
      if (gesendet) merkeZuletztVerwendet(gesendet);
      qc.invalidateQueries({ queryKey: einsatzKeys.freieZeichen(einsatzId) });
      // Serienmodus: der Platzier-Modus überlebt den POST; beendet wird er über
      // „Fertig"/„Abbrechen" oder, bei ausgeschalteter Serie, hier.
      if (zeichenSerie) setZeichenSerieAnzahl((n) => n + 1);
      else dispatch({ t: 'beenden', arten: ['zeichen'] });
    },
    onError: fehler,
  });

  function verorten(lat: number, lon: number) {
    if (!platzierungZiel || verortenLaeuft.current) return;
    verortenLaeuft.current = true;
    verortenMutation.mutate({ lat, lon });
  }

  function onKarteKlick(lngLat: { lng: number; lat: number }) {
    if (!darfSchreiben) return;
    // Platzieren XOR Verorten — beides sind exklusive Modi, nie gleichzeitig aktiv.
    if (zeichenPlatzieren) {
      // isPending-Guard: ein Doppelklick während des POST legte ein Duplikat an
      // (legeFreiesZeichenAn ist nicht idempotent); zeichenPlatzieren wird erst in onSuccess
      // geleert.
      if (!legeZeichenMutation.isPending)
        legeZeichenMutation.mutate({ lat: lngLat.lat, lon: lngLat.lng });
      return;
    }
    // Mutation-State erreicht den nächsten Render asynchron. Der Ref schließt auch zwei Klicks im
    // selben Renderfenster aus; sonst entschiede die Serverreihenfolge statt der zuletzt sichtbaren
    // Nutzeraktion über die Position.
    verorten(lngLat.lat, lngLat.lng);
  }

  function onMarkerWaehlen(schluessel: string) {
    setSelektion({ art: 'objekt', schluessel });
    const m = waehlbar.find((x) => x.schluessel === schluessel);
    if (m) setFlyToZiel({ lng: m.lon, lat: m.lat });
  }

  /**
   * Nimmt einem Objekt seine Kartenverortung. Jeder Zweig liefert nur seinen Aufruf und die Fächer,
   * die danach frisch sein müssen; Quittung, Invalidierung und Fehler laufen in einer Kette, damit
   * kein Zweig die Rückmeldung vergisst. Die Rückfrage für den unumkehrbaren Fall
   * (Abschnittsfläche) stellt der Inspector.
   */
  function loescheVerortung(marker: KarteMarker) {
    const vorgang = verortungLoeschenVorgang(marker);
    if (vorgang) {
      vorgang.aufruf
        .then(() => {
          erfolg('Verortung gelöscht');
          return Promise.all(vorgang.faecher.map((queryKey) => qc.invalidateQueries({ queryKey })));
        })
        .catch(fehler);
    }
    setAuswahl(null);
  }

  function verortungLoeschenVorgang(
    marker: KarteMarker,
  ): { aufruf: Promise<unknown>; faecher: readonly (readonly unknown[])[] } | null {
    switch (marker.typ) {
      case 'uhs':
        return {
          aufruf: aktualisiereUhs(einsatzId, marker.id, { lat: null, lon: null }),
          faecher: [einsatzKeys.uhs(einsatzId)],
        };
      case 'schaden':
        return {
          aufruf: aktualisiereSchaden(einsatzId, marker.id, { lat: null, lon: null }),
          faecher: [einsatzKeys.schaeden(einsatzId)],
        };
      case 'einheit':
        return {
          aufruf: verorteEinheit(einsatzId, marker.id, { lat: null, lon: null }),
          faecher: [einsatzKeys.einheiten(einsatzId)],
        };
      case 'fahrzeug':
        return {
          aufruf: verorteFahrzeug(einsatzId, marker.id, { lat: null, lon: null }),
          faecher: [einsatzKeys.fahrzeuge(einsatzId)],
        };
      case 'fuehrung':
        return {
          aufruf: verortePerson(einsatzId, marker.id, { lat: null, lon: null }),
          faecher: [einsatzKeys.fuehrungskraefte(einsatzId)],
        };
      case 'abschnitt':
        return {
          aufruf: zeichneAbschnitt(einsatzId, marker.id, { flaeche_geojson: null }),
          faecher: [einsatzKeys.abschnitte(einsatzId)],
        };
      case 'betreuungsstelle':
        // Nur das Paar; die Stelle bleibt, nur ihr Kartenpunkt geht. Umkehrbar über „Auf Karte
        // verorten" der Betreuungsseite, deshalb ohne Rückfrage.
        return {
          aufruf: aendereStelle(einsatzId, marker.id, { lat: null, lon: null }),
          faecher: [einsatzKeys.betreuung(einsatzId)],
        };
      case 'person':
        // Betroffene: nur die zwei Koordinatenfelder wie im Platzier-Zweig; die Person bleibt, nur
        // ihr Fundort-Punkt geht. Umkehrbar über „Auf Lagekarte verorten", deshalb ohne Rückfrage.
        return {
          aufruf: aktualisierePerson(einsatzId, marker.id, {
            antreff_lat: null,
            antreff_lon: null,
          }),
          faecher: [einsatzKeys.personen(einsatzId), einsatzKeys.person(einsatzId, marker.id)],
        };
      default:
        return null;
    }
  }

  /** Symbol-Override eines taktischen Markers; quittiert erst nach Erfolg. */
  function aendereSymbol(
    marker: KarteMarker,
    patch: { tz_fachaufgabe?: string | null; tz_organisation?: string | null },
  ) {
    let vorgang: { aufruf: Promise<unknown>; fach: readonly unknown[] } | null = null;
    if (marker.typ === 'einheit') {
      vorgang = {
        aufruf: verorteEinheit(einsatzId, marker.id, patch),
        fach: einsatzKeys.einheiten(einsatzId),
      };
    } else if (marker.typ === 'fahrzeug') {
      vorgang = {
        aufruf: verorteFahrzeug(einsatzId, marker.id, patch),
        fach: einsatzKeys.fahrzeuge(einsatzId),
      };
    } else if (marker.typ === 'fuehrung') {
      vorgang = {
        aufruf: verortePerson(einsatzId, marker.id, patch),
        fach: einsatzKeys.fuehrungskraefte(einsatzId),
      };
    } else if (marker.typ === 'abschnitt') {
      vorgang = {
        aufruf: zeichneAbschnitt(einsatzId, marker.id, patch),
        fach: einsatzKeys.abschnitte(einsatzId),
      };
    }
    if (!vorgang) return;
    const { aufruf, fach } = vorgang;
    aufruf
      .then(() => {
        erfolg('Symbol gespeichert');
        return qc.invalidateQueries({ queryKey: fach });
      })
      .catch(fehler);
  }

  // Bestätigungs-Phase persistieren: erst hier, nicht schon bei onZoneGezeichnet.
  const bestaetigungSpeichern = () => {
    if (!zoneBestaetigung) return;
    const zu = zoneBestaetigung;
    dispatch({ t: 'zoneSpeichernStart' });
    legeZoneAn(einsatzId, {
      typ: zu.typ,
      geometrie_typ: zu.geometrie.type,
      geometrie: JSON.stringify(zu.geometrie),
      farbe: zu.typ === 'freie_skizze' ? (zu.farbe ?? null) : null,
      ansicht_id: aktiveAnsichtId ?? null,
    })
      .then(() => {
        erfolg('Zone angelegt');
        // Beide Fächer: das Anlegen einer `gefahrengebiet`-Zone legt serverseitig eine neue Gruppe
        // an. Ohne die zweite Invalidierung kennt die veraltete Gebiets-Liste die
        // `gefahrengebiet_id` der frischen Zone nicht, und die Karte beschriftet „Stufe unbekannt",
        // bis ein fremder Refetch kommt (sichtbar nur bei hängendem Live-Strom).
        return Promise.all([
          qc.invalidateQueries({ queryKey: einsatzKeys.zonen(einsatzId) }),
          qc.invalidateQueries({ queryKey: einsatzKeys.gefahrengebiete(einsatzId) }),
        ]).then(() => true);
      })
      .catch((e) => {
        fehler(e);
        return false;
      })
      .then((erfolg) => {
        // Serienmodus: nach erfolgreichem Speichern denselben Zonen-Typ erneut scharf schalten. Der
        // Nonce muss steigen: der Zonen-Effekt in `Kartenflaeche` hängt an [zoneZeichnen,
        // zoneZeichnenNonce], und `zoneZeichnen` bleibt bei Zone→Zone gleich. Ohne ihn liefe
        // `starten()` nicht — weder `draw.clear()` (sonst doppelte Kontur) noch `setMode()` (sonst
        // toter Zeichenmodus). Nur bei Erfolg: ein Neustart nach Fehlschlag verwürfe die
        // ungespeicherte Geometrie still.
        //
        // Zuerst die Frage, ob dieser Zug noch der laufende ist. Die Kette wartet auf POST und
        // `invalidateQueries`, die Sidebar bleibt dabei bedienbar; wer inzwischen einen anderen
        // Modus startet, bekäme ihn sonst still überschrieben. Der Reducer-Fall 'zone' ist
        // bedingungslos und kann das nicht abfangen, anders als 'beenden' mit `arten`. `speichern`
        // ist die Marke dieses Zuges: 'zoneSpeichernStart' setzt sie, jeder andere Modusstart
        // löscht sie.
        const nochUnserZug = modusRef.current.art === 'zone' && modusRef.current.speichern;
        if (!nochUnserZug) return;
        if (erfolg && zoneSerieRef.current) {
          dispatch({ t: 'zone', entwurf: { typ: zu.typ, modus: zu.modus, farbe: zu.farbe } });
          setZoneZeichnenNonce((n) => n + 1);
          setZoneSerieAnzahl((n) => n + 1);
        } else {
          // Beendet Zeichnen → Kartenflaeche-Effekt ruft stoppen() → clear().
          dispatch({ t: 'beenden', arten: ['zone'] });
        }
      });
  };
  // Verwirft den Entwurf (stoppen() → clear()).
  const bestaetigungVerwerfen = () => dispatch({ t: 'beenden', arten: ['zone'] });
  // Erste Esc-Stufe in der Bestätigungsphase (LFH-712): die ungespeicherte Figur geht, der Modus
  // bleibt — derselbe Weg wie der Serienpfad (Fall `zone` + Nonce, damit die Karte `starten()`
  // ruft). Der Serienzähler bleibt. Während des Speicherns wirkungslos, weil die Promise-Kette
  // ihren Zug an `speichern` erkennt.
  const onBestaetigungZurueck = () => {
    const m = modusRef.current;
    if (m.art !== 'zone' || m.bestaetigung == null || m.speichern) return;
    dispatch({ t: 'zone', entwurf: m.entwurf });
    setZoneZeichnenNonce((n) => n + 1);
  };

  // --- Start-/Reset-Handler (exklusive Modi) ---
  // Ein Start setzt nur seinen Modus, der Reducer verdrängt jeden anderen.
  /**
   * `useCallback`, weil der Handler in den Deps eines Effekts von `LagekartePage` steht
   * (Platzier-Deeplink `?platzieren=<typ>:<id>`). Ohne stabile Identität lief der Effekt bei jedem
   * Render neu, und weil er selbst rendert und die URL räumt, drehte er sich mit noch veraltetem
   * `searchParams` im Kreis. `dispatch` und `setAuswahl` sind stabil, die leeren Deps vollständig.
   */
  const onPlatzierenStart = useCallback(
    (z: { typ: PlatzierenPunktTyp; id: number }) => {
      dispatch({ t: 'platzieren', ziel: z });
      setAuswahl(null);
    },
    [setAuswahl],
  );
  const onPlatzierenAbbrechen = () => dispatch({ t: 'beenden', arten: ['platzieren'] });
  const onAbschnittZeichnenStart = (id: number) => {
    dispatch({ t: 'abschnitt', id });
    setAuswahl(null);
  };
  const onZoneZeichnenStart = (entwurf: ZoneEntwurf) => {
    dispatch({ t: 'zone', entwurf });
    setZoneZeichnenNonce((n) => n + 1);
    setZoneSerieAnzahl(0);
    setZoneAuswahl(null);
    setAuswahl(null);
  };
  /** Beendet eine laufende Zonen-Serie — Vorbild: onBildPlatzierenFertig. */
  const onZoneZeichnenFertig = () => dispatch({ t: 'beenden', arten: ['zone'] });
  const onKoordinateEingeben = (lat: number, lon: number) => {
    if (darfSchreiben) verorten(lat, lon);
  };
  const onEinsatzortPlatzieren = () => {
    dispatch({ t: 'platzieren', ziel: { typ: 'einsatzort', id: 0 } });
    setAuswahl(null);
  };
  // Freies-Zeichen-Platzieren starten/abbrechen.
  const onZeichenPlatzierenStart = (spec: FreiesZeichenUpdate) => {
    dispatch({ t: 'zeichen', spec });
    setZeichenSerieAnzahl(0);
    setAuswahl(null);
  };
  const onZeichenPlatzierenAbbrechen = () => dispatch({ t: 'beenden', arten: ['zeichen'] });
  /** Beendet eine laufende Zeichen-Serie — Vorbild: onBildPlatzierenFertig. */
  const onZeichenPlatzierenFertig = () => dispatch({ t: 'beenden', arten: ['zeichen'] });
  const onBildPlatzieren = (id: number) => {
    dispatch({ t: 'bild', id });
    setAuswahl(null);
  };
  const onBildPlatzierenFertig = () => dispatch({ t: 'beenden', arten: ['bild'] });
  /** Messen starten oder die Form wechseln; eine offene Auswahl schließt wie bei jedem Modus. */
  const onMessenStart = (form: MessForm) => {
    dispatch({ t: 'messen', form });
    setAuswahl(null);
  };
  /**
   * Beendet nur das Messen. `useCallback`, weil ein Escape-Effekt der Seite daran hängt; `dispatch`
   * ist stabil.
   */
  const onMessenBeenden = useCallback(() => dispatch({ t: 'beenden', arten: ['messen'] }), []);

  // Abschnittsfläche fertig → persistieren, quittieren, dann Zeichenmodus beenden.
  const onFlaecheGezeichnet = (poly: GeoJsonPolygon) => {
    setAbschnittSpeichern(true);
    zeichneAbschnitt(einsatzId, zeichneAbschnittId!, { flaeche_geojson: JSON.stringify(poly) })
      .then(() => {
        erfolg('Fläche gespeichert');
        return qc.invalidateQueries({ queryKey: einsatzKeys.abschnitte(einsatzId) });
      })
      .catch(fehler)
      .finally(() => {
        setAbschnittSpeichern(false);
        dispatch({ t: 'beenden', arten: ['abschnitt'] });
      });
  };
  const onFlaecheKlick = (fid: number) => {
    if (exklusiverModusAktiv) return; // kein Panel während eines exklusiven Modus
    setSelektion({ art: 'objekt', schluessel: `abschnitt-${fid}` });
  };
  const onZoneKlick = (id: number) => {
    if (exklusiverModusAktiv) return; // kein Panel während eines exklusiven Modus
    setSelektion({ art: 'zone', id });
  };
  const onZoneGezeichnet = (g: GeoJsonGeometry) => dispatch({ t: 'zoneGezeichnet', geometrie: g });
  const onFachebeneKlick = (
    properties: Record<string, unknown>,
    quelle: FachebeneQuelle,
    geometrie?: { type: string; coordinates: unknown } | null,
  ) => {
    if (exklusiverModusAktiv) return; // kein Panel während eines exklusiven Modus
    setSelektion({ art: 'fachebene', wert: { quelle, properties, geometrie } });
  };
  // ZeichnenSteuerung „Abbrechen" (Phase zeichnen): Entwurf + Abschnitt-Zeichnen verwerfen.
  const onZeichnenAbbrechen = () => dispatch({ t: 'beenden', arten: ['zone', 'abschnitt'] });

  // Zonen-Inspector-CRUD.
  const zoneAendern = async (zoneId: number, patch: ZonePatch) => {
    try {
      await aktualisiereZone(einsatzId, zoneId, patch);
      erfolg('Zone gespeichert');
      await Promise.all([
        qc.invalidateQueries({ queryKey: einsatzKeys.zonen(einsatzId) }),
        qc.invalidateQueries({ queryKey: einsatzKeys.gefahrengebiete(einsatzId) }),
      ]);
    } catch (e) {
      fehler(e);
      // Der Inspector braucht die Ablehnung, damit „speichert …" nicht fälschlich in „gespeichert"
      // umspringt. Die sichtbare Fehlermeldung kommt weiterhin zentral.
      throw e;
    }
  };
  const zoneLoeschen = (zoneId: number) =>
    loescheZone(einsatzId, zoneId)
      .then(() => {
        erfolg('Zone aufgehoben');
        setZoneAuswahl(null);
        qc.invalidateQueries({ queryKey: einsatzKeys.zonen(einsatzId) });
        return qc.invalidateQueries({ queryKey: einsatzKeys.gefahrengebiete(einsatzId) });
      })
      .catch(fehler);

  // Freies-Zeichen-Inspector-CRUD, Whole-Spec-Update (lat/lon unverändert). Jede quittiert erst
  // nach erfolgreicher Antwort.
  const zeichenAendern = (id: number, spec: FreiesZeichenUpdate) =>
    aktualisiereFreiesZeichen(einsatzId, id, spec)
      .then(() => {
        erfolg('Taktisches Zeichen gespeichert');
        return qc.invalidateQueries({ queryKey: einsatzKeys.freieZeichen(einsatzId) });
      })
      .catch(fehler);
  // Verschieben auf eine andere Ansicht bzw. auf alle (`null`) — Teil-Patch.
  const zeichenVerschieben = (id: number, ansichtId: number | null) =>
    verschiebeFreiesZeichen(einsatzId, id, ansichtId)
      .then(() => {
        erfolg('Taktisches Zeichen verschoben');
        return qc.invalidateQueries({ queryKey: einsatzKeys.freieZeichen(einsatzId) });
      })
      .catch(fehler);
  const zeichenLoeschen = (id: number) =>
    loescheFreiesZeichen(einsatzId, id)
      .then(() => {
        erfolg('Taktisches Zeichen gelöscht');
        setAuswahl(null);
        return qc.invalidateQueries({ queryKey: einsatzKeys.freieZeichen(einsatzId) });
      })
      .catch(fehler);

  return {
    // FSM-State (Display/Wiring).
    platzierungZiel,
    zeichneAbschnittId,
    zoneEntwurf,
    zoneBestaetigung,
    zoneSpeichern,
    zoneZeichnenNonce,
    zoneAuswahl,
    auswahl,
    flyToZiel,
    fachebeneAuswahl,
    bildPlatzierenId,
    zeichenPlatzieren,
    messForm,
    exklusiverModusAktiv,
    // Serienmodus.
    zeichenSerie,
    setZeichenSerie,
    zeichenSerieAnzahl,
    zoneSerie,
    setZoneSerie,
    zoneSerieAnzahl,
    abschnittSpeichern,
    // Panel-Schließer (onSchliessen der Inspektoren).
    setAuswahl,
    setZoneAuswahl,
    setFachebeneAuswahl,
    setFlyToZiel, // Reverse-Deeplink: Zone anfliegen

    // Handler.
    onKarteKlick,
    onMarkerWaehlen,
    loescheVerortung,
    aendereSymbol,
    bestaetigungSpeichern,
    onBestaetigungZurueck,
    bestaetigungVerwerfen,
    onPlatzierenStart,
    onPlatzierenAbbrechen,
    onAbschnittZeichnenStart,
    onZoneZeichnenStart,
    onZoneZeichnenFertig,
    onKoordinateEingeben,
    onEinsatzortPlatzieren,
    onBildPlatzieren,
    onBildPlatzierenFertig,
    onZeichenPlatzierenStart,
    onZeichenPlatzierenAbbrechen,
    onZeichenPlatzierenFertig,
    onMessenStart,
    onMessenBeenden,
    onFlaecheGezeichnet,
    onFlaecheKlick,
    onZoneKlick,
    onZoneGezeichnet,
    onFachebeneKlick,
    onZeichnenAbbrechen,
    zoneAendern,
    zoneLoeschen,
    zeichenAendern,
    zeichenVerschieben,
    zeichenLoeschen,
  };
}
