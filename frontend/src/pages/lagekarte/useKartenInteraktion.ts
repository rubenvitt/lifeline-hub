import { useCallback, useReducer, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { aktualisiereEinsatz, type KopfdatenUpdate } from '../../api/einsaetze';
import { aktualisiereUhs } from '../../api/einsatzUhs';
import { aktualisiereSchaden } from '../../api/einsatzSchaden';
import { verorteEinheit } from '../../api/einheiten';
import { verorteFahrzeug } from '../../api/einsatzFahrzeuge';
import { verortePerson } from '../../api/einsatzPersonal';
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
import type { PlatzierenPunktTyp } from './Sidebar';

/** EinsatzAnzeige → KopfdatenUpdate (Vollersatz) mit überschriebener Koordinate. */
function kopfMitKoordinate(e: EinsatzAnzeige, lat: number | null, lon: number | null): KopfdatenUpdate {
  return {
    bezeichnung: e.bezeichnung,
    stichwort: e.stichwort ?? null,
    einsatzart: e.einsatzart,
    einsatznummer_intern: e.einsatznummer_intern ?? null,
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
 * Der aktive Interaktionsmodus der Lagekarte (LFH-243/F15). Die wechselseitige
 * Exklusivität ist hier keine Absprache zwischen Handlern mehr, sondern folgt aus dem
 * Datentyp: es gibt genau EIN Modus-Feld, ein neuer Modus ersetzt den alten. Zuvor waren
 * es sechs separate useState, deren Exklusivität jeder Start-Handler von Hand per
 * Reset-Kaskade erzwingen musste — mit asymmetrischen Subsets, wodurch z. B. ein offenes
 * Bild-Platzieren neben einem frisch gestarteten Marker-Platzieren scharf blieb
 * (Bug-Klasse LFH-145).
 *
 * `zone` trägt ihre Bestätigungs-Phase als Sub-Zustand: der Entwurf bleibt sichtbar,
 * bis explizit gespeichert oder verworfen wird (LFH-145).
 */
type KartenModus =
  | { art: 'idle' }
  | { art: 'platzieren'; ziel: { typ: PlatzierenPunktTyp | 'einsatzort'; id: number } }
  | { art: 'abschnitt'; id: number }
  | { art: 'zone'; entwurf: ZoneEntwurf; bestaetigung: ZoneBestaetigung | null; speichern: boolean }
  | { art: 'bild'; id: number }
  | { art: 'zeichen'; spec: FreiesZeichenUpdate };

type ModusAktion =
  | { t: 'platzieren'; ziel: { typ: PlatzierenPunktTyp | 'einsatzort'; id: number } }
  | { t: 'abschnitt'; id: number }
  | { t: 'zone'; entwurf: ZoneEntwurf }
  | { t: 'bild'; id: number }
  | { t: 'zeichen'; spec: FreiesZeichenUpdate }
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
 * Die aktive Panel-Selektion der Lagekarte (LFH-243/F15). Wie beim Modus ist die
 * Exklusivität hier ein Datentyp, kein Handler-Vertrag: LagekartePage rendert jeden
 * Inspektor unabhängig (kein `else`), sodass zwei gleichzeitig gesetzte Auswahl-States
 * zwei Panels ergäben — was onFlaecheKlick auslöste, weil es zoneAuswahl nicht räumte.
 * `objekt` deckt Marker UND Abschnitt (beide über den `auswahl`-String).
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
    case 'zone':
      return { art: 'zone', entwurf: a.entwurf, bestaetigung: null, speichern: false };
    case 'zoneGezeichnet':
      // Nicht sofort persistieren: erst Bestätigung, Entwurf bleibt sichtbar (LFH-145).
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
  alleVerortet: KarteMarker[];
  /** Aktive Ansicht (B/LFH-320): neu angelegte Objekte werden auf ihr gestempelt. */
  aktiveAnsichtId?: number;
  /** Stabiler Fehler-Handler (useCallback über App.useApp-message). */
  fehler: (e: unknown) => void;
}

/**
 * Interaktions-Leg der Lagekarte: die mutually-exclusive Interaktions-Modi (Platzieren /
 * Abschnitt- & Zonen-Zeichnen / Bild-Platzieren / Selektion) als FSM samt allen Start-/
 * Reset-Handlern, plus die Verortungs- und Zonen-CRUD-Mutationen. Jede Start-Aktion setzt/
 * resettet exakt dieselben States wie zuvor inline auf der Page (LFH-145: sonst bleibt ein
 * Zonen-Entwurf als Orphan liegen — von jsdom-Tests nicht gefangen).
 */
export function useKartenInteraktion({ einsatzId, einsatz, darfSchreiben, alleVerortet, aktiveAnsichtId, fehler }: KartenInteraktionArgs) {
  const qc = useQueryClient();

  const [modus, dispatch] = useReducer(modusReducer, { art: 'idle' } as KartenModus);

  // Monoton steigend bei jedem Zonen-Zeichnen-Start (LFH-145 M-A): erzwingt ein Re-Fire
  // des Kartenflaeche-Zonen-Effekts auch bei gleich bleibendem Modus (z. B. Zone→Zone mit
  // Gefahrengebiet→Absperrbereich, beides Polygon), damit starten() einen offenen,
  // unbestätigten Entwurf verwirft statt ihn beim nächsten Zeichnen als Orphan liegen zu lassen.
  // Bewusst NICHT im Modus: der Zähler muss über Modus-Wechsel hinweg monoton bleiben.
  const [zoneZeichnenNonce, setZoneZeichnenNonce] = useState(0);
  // Serienmodus (LFH-332/M76). Beide Platzier-Modi brachen bisher nach JEDEM gesetzten
  // Objekt ab — für das zweite gleichartige Zeichen kostete das drei Klicks Umweg
  // (Karte → Sidebar → Picker → Platzieren). Vorgabe AN, weil das Setzen einer Folge der
  // Normalfall ist; beendet wird der Modus dann explizit über „Fertig" (Vorbild:
  // onBildPlatzierenFertig). Die Zähler tragen zwei Dinge: die Anzeige „n platziert" und
  // die Beschriftung des Abbruch-Knopfes — solange nichts gesetzt ist, heißt Beenden
  // „Abbrechen"; ab dem ersten gespeicherten Objekt ist es „Fertig", denn abbrechen lässt
  // sich das Gespeicherte nicht mehr.
  const [zeichenSerie, setZeichenSerie] = useState(true);
  const [zeichenSerieAnzahl, setZeichenSerieAnzahl] = useState(0);
  const [zoneSerie, setZoneSerie] = useState(true);
  const [zoneSerieAnzahl, setZoneSerieAnzahl] = useState(0);
  // Panel-Selektion als eine Union (s. KartenSelektion). Die drei bisherigen Setter bleiben
  // als API erhalten, sind aber Wrapper über EIN Feld: ein Setzen verdrängt jede andere
  // Selektion, null räumt (das gerade offene Panel ist per Konstruktion das einzige).
  const [selektion, setSelektion] = useState<KartenSelektion>({ art: 'keine' });
  const [flyToZiel, setFlyToZiel] = useState<{ lng: number; lat: number } | null>(null);

  const auswahl = selektion.art === 'objekt' ? selektion.schluessel : null;
  const zoneAuswahl = selektion.art === 'zone' ? selektion.id : null;
  // Angeklicktes Fachebenen-Objekt (externe Daten) → Detail-Panel. geometrie = volle,
  // un-geclippte Geometrie aus der geladenen FeatureCollection (LFH-146, Fläche/Umfang).
  const fachebeneAuswahl = selektion.art === 'fachebene' ? selektion.wert : null;
  // Stabile Identität (useCallback): diese Setter stehen in Effekt-Deps von LagekartePage
  // (Reverse-Deeplink LFH-155). setSelektion ist selbst stabil, daher leere Deps.
  const setAuswahl = useCallback(
    (s: string | null) => setSelektion(s != null ? { art: 'objekt', schluessel: s } : { art: 'keine' }),
    [],
  );
  const setZoneAuswahl = useCallback(
    (id: number | null) => setSelektion(id != null ? { art: 'zone', id } : { art: 'keine' }),
    [],
  );
  const setFachebeneAuswahl = useCallback(
    (w: FachebeneAuswahl | null) => setSelektion(w != null ? { art: 'fachebene', wert: w } : { art: 'keine' }),
    [],
  );

  // Aus dem Modus abgeleitet — die Hook-API bleibt unverändert, aber die Werte können
  // konstruktionsbedingt nicht mehr gleichzeitig gesetzt sein.
  const platzierungZiel = modus.art === 'platzieren' ? modus.ziel : null;
  const zeichneAbschnittId = modus.art === 'abschnitt' ? modus.id : null;
  const zoneEntwurf = modus.art === 'zone' ? modus.entwurf : null;
  const zoneBestaetigung = modus.art === 'zone' ? modus.bestaetigung : null;
  const zoneSpeichern = modus.art === 'zone' ? modus.speichern : false;
  const bildPlatzierenId = modus.art === 'bild' ? modus.id : null;
  const zeichenPlatzieren = modus.art === 'zeichen' ? modus.spec : null;

  // Ein wechselseitig-exklusiver Interaktionsmodus ist aktiv. Während dessen darf ein
  // Karten-Klick auf ein bestehendes Objekt kein Auswahl-Panel öffnen (LFH-208: sonst
  // Doppel-Panel neben der ZeichnenSteuerung).
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
      } else if (platzierungZiel.typ === 'einsatzort' && einsatz) {
        await aktualisiereEinsatz(einsatzId, kopfMitKoordinate(einsatz, p.lat, p.lon));
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: einsatzKeys.einsatz(einsatzId) });
      qc.invalidateQueries({ queryKey: einsatzKeys.uhs(einsatzId) });
      qc.invalidateQueries({ queryKey: einsatzKeys.schaeden(einsatzId) });
      qc.invalidateQueries({ queryKey: einsatzKeys.einheiten(einsatzId) });
      qc.invalidateQueries({ queryKey: einsatzKeys.fahrzeuge(einsatzId) });
      qc.invalidateQueries({ queryKey: einsatzKeys.fuehrungskraefte(einsatzId) });
      dispatch({ t: 'beenden', arten: ['platzieren'] });
    },
    onError: fehler,
  });

  // Freies Zeichen am Klickpunkt anlegen (LFH-170); Spec kommt aus dem Platzier-Modus.
  const legeZeichenMutation = useMutation({
    mutationFn: async (p: { lat: number; lon: number }) => {
      if (!zeichenPlatzieren) return;
      await legeFreiesZeichenAn(einsatzId, {
        lat: p.lat,
        lon: p.lon,
        ...zeichenPlatzieren,
        ansicht_id: aktiveAnsichtId ?? null,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: einsatzKeys.freieZeichen(einsatzId) });
      // Serienmodus (LFH-332/M76): der Platzier-Modus überlebt den POST, der Entwurf in der
      // Sidebar ohnehin (er wird dort nie zurückgesetzt). Beendet wird nur noch über
      // „Fertig"/„Abbrechen" — oder, bei ausgeschalteter Serie, wie bisher hier.
      if (zeichenSerie) setZeichenSerieAnzahl((n) => n + 1);
      else dispatch({ t: 'beenden', arten: ['zeichen'] });
    },
    onError: fehler,
  });

  function onKarteKlick(lngLat: { lng: number; lat: number }) {
    if (!darfSchreiben) return;
    // Platzieren XOR Verorten — beides sind exklusive Modi, nie gleichzeitig aktiv.
    if (zeichenPlatzieren) {
      // isPending-Guard: ein zweiter (Doppel-)Klick während des laufenden POST würde ein
      // Duplikat anlegen (legeFreiesZeichenAn ist nicht idempotent). zeichenPlatzieren wird
      // erst in onSuccess geleert, daher hier gegen die pendende Mutation gaten.
      if (!legeZeichenMutation.isPending) legeZeichenMutation.mutate({ lat: lngLat.lat, lon: lngLat.lng });
      return;
    }
    if (!platzierungZiel) return;
    verortenMutation.mutate({ lat: lngLat.lat, lon: lngLat.lng });
  }

  function onMarkerWaehlen(schluessel: string) {
    setSelektion({ art: 'objekt', schluessel });
    const m = alleVerortet.find((x) => x.schluessel === schluessel);
    if (m) setFlyToZiel({ lng: m.lon, lat: m.lat });
  }

  function loescheVerortung(marker: KarteMarker) {
    if (marker.typ === 'uhs') {
      aktualisiereUhs(einsatzId, marker.id, { lat: null, lon: null })
        .then(() => qc.invalidateQueries({ queryKey: einsatzKeys.uhs(einsatzId) }))
        .catch(fehler);
    } else if (marker.typ === 'schaden') {
      aktualisiereSchaden(einsatzId, marker.id, { lat: null, lon: null })
        .then(() => qc.invalidateQueries({ queryKey: einsatzKeys.schaeden(einsatzId) }))
        .catch(fehler);
    } else if (marker.typ === 'einheit') {
      verorteEinheit(einsatzId, marker.id, { lat: null, lon: null })
        .then(() => qc.invalidateQueries({ queryKey: einsatzKeys.einheiten(einsatzId) }))
        .catch(fehler);
    } else if (marker.typ === 'fahrzeug') {
      verorteFahrzeug(einsatzId, marker.id, { lat: null, lon: null })
        .then(() => qc.invalidateQueries({ queryKey: einsatzKeys.fahrzeuge(einsatzId) }))
        .catch(fehler);
    } else if (marker.typ === 'fuehrung') {
      verortePerson(einsatzId, marker.id, { lat: null, lon: null })
        .then(() => qc.invalidateQueries({ queryKey: einsatzKeys.fuehrungskraefte(einsatzId) }))
        .catch(fehler);
    } else if (marker.typ === 'abschnitt') {
      zeichneAbschnitt(einsatzId, marker.id, { flaeche_geojson: null })
        .then(() => qc.invalidateQueries({ queryKey: einsatzKeys.abschnitte(einsatzId) }))
        .catch(fehler);
    }
    setAuswahl(null);
  }

  function aendereSymbol(
    marker: KarteMarker,
    patch: { tz_fachaufgabe?: string | null; tz_organisation?: string | null },
  ) {
    if (marker.typ === 'einheit') {
      verorteEinheit(einsatzId, marker.id, patch)
        .then(() => qc.invalidateQueries({ queryKey: einsatzKeys.einheiten(einsatzId) }))
        .catch(fehler);
    } else if (marker.typ === 'fahrzeug') {
      verorteFahrzeug(einsatzId, marker.id, patch)
        .then(() => qc.invalidateQueries({ queryKey: einsatzKeys.fahrzeuge(einsatzId) }))
        .catch(fehler);
    } else if (marker.typ === 'fuehrung') {
      verortePerson(einsatzId, marker.id, patch)
        .then(() => qc.invalidateQueries({ queryKey: einsatzKeys.fuehrungskraefte(einsatzId) }))
        .catch(fehler);
    } else if (marker.typ === 'abschnitt') {
      zeichneAbschnitt(einsatzId, marker.id, patch)
        .then(() => qc.invalidateQueries({ queryKey: einsatzKeys.abschnitte(einsatzId) }))
        .catch(fehler);
    }
  }

  // Bestätigungs-Phase persistieren (LFH-145): erst hier, nicht schon bei onZoneGezeichnet.
  const bestaetigungSpeichern = () => {
    if (!zoneBestaetigung) return;
    const zu = zoneBestaetigung;
    dispatch({ t: 'zoneSpeichernStart' });
    legeZoneAn(einsatzId, {
      typ: zu.typ,
      geometrie_typ: zu.geometrie.type,
      geometrie: JSON.stringify(zu.geometrie),
      farbe: zu.typ === 'freie_skizze' ? zu.farbe ?? null : null,
      ansicht_id: aktiveAnsichtId ?? null,
    })
      .then(() => qc.invalidateQueries({ queryKey: einsatzKeys.zonen(einsatzId) }).then(() => true))
      .catch((e) => {
        fehler(e);
        return false;
      })
      .then((erfolg) => {
        // Serienmodus (LFH-332/M76): nach erfolgreichem Speichern denselben Zonen-Typ erneut
        // scharf schalten statt den Modus zu beenden.
        //
        // Der Nonce MUSS dabei steigen. Der Zonen-Effekt in `Kartenflaeche` hängt an
        // [zoneZeichnen, zoneZeichnenNonce]; `zoneZeichnen` ist der Zeichen-MODUS und bleibt
        // bei Zone→Zone gleich. Ohne den Nonce feuerte der Effekt also nicht neu, `starten()`
        // liefe nicht — und damit weder das `draw.clear()`, das die gerade gespeicherte
        // Geometrie vom Zeichen-Layer räumt (sonst doppelte Kontur neben der frisch
        // invalidierten Zonen-Query), noch das `setMode()`, ohne das der Zeichenmodus tot
        // bliebe. Genau dafür existiert der Zähler (s. Deklaration oben).
        //
        // Nur bei ERFOLG: schlägt der POST fehl, endet der Modus wie bisher — ein Neustart
        // würde die nicht gespeicherte Geometrie stillschweigend verwerfen und so aussehen,
        // als sei nichts passiert.
        if (erfolg && zoneSerie) {
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

  // --- Start-/Reset-Handler (mutually-exclusive Modi) -------------------------
  // Ein Start setzt nur noch SEINEN Modus — der Reducer verdrängt jeden anderen. Die
  // früheren Reset-Kaskaden (je Handler ein anderes, unvollständiges Subset) entfallen.
  const onPlatzierenStart = (z: { typ: PlatzierenPunktTyp; id: number }) => {
    dispatch({ t: 'platzieren', ziel: z });
    setAuswahl(null);
  };
  const onPlatzierenAbbrechen = () => dispatch({ t: 'beenden', arten: ['platzieren'] });
  const onAbschnittZeichnenStart = (id: number) => {
    dispatch({ t: 'abschnitt', id });
    setAuswahl(null);
  };
  const onZoneZeichnenStart = (entwurf: ZoneEntwurf) => {
    dispatch({ t: 'zone', entwurf });
    setZoneZeichnenNonce((n) => n + 1);
    setZoneSerieAnzahl(0); // neue Serie (LFH-332)
    setZoneAuswahl(null);
    setAuswahl(null);
  };
  /** Beendet eine laufende Zonen-Serie (LFH-332) — Vorbild: onBildPlatzierenFertig. */
  const onZoneZeichnenFertig = () => dispatch({ t: 'beenden', arten: ['zone'] });
  const onKoordinateEingeben = (lat: number, lon: number) => {
    if (platzierungZiel && darfSchreiben) verortenMutation.mutate({ lat, lon });
  };
  const onEinsatzortPlatzieren = () => {
    dispatch({ t: 'platzieren', ziel: { typ: 'einsatzort', id: 0 } });
    setAuswahl(null);
  };
  // Freies-Zeichen-Platzieren starten/abbrechen (LFH-170).
  const onZeichenPlatzierenStart = (spec: FreiesZeichenUpdate) => {
    dispatch({ t: 'zeichen', spec });
    setZeichenSerieAnzahl(0); // neue Serie (LFH-332)
    setAuswahl(null);
  };
  const onZeichenPlatzierenAbbrechen = () => dispatch({ t: 'beenden', arten: ['zeichen'] });
  /** Beendet eine laufende Zeichen-Serie (LFH-332) — Vorbild: onBildPlatzierenFertig. */
  const onZeichenPlatzierenFertig = () => dispatch({ t: 'beenden', arten: ['zeichen'] });
  const onBildPlatzieren = (id: number) => {
    dispatch({ t: 'bild', id });
    setAuswahl(null);
  };
  const onBildPlatzierenFertig = () => dispatch({ t: 'beenden', arten: ['bild'] });

  // Abschnittsfläche zeichnen fertig → persistieren, dann Zeichenmodus beenden.
  const onFlaecheGezeichnet = (poly: GeoJsonPolygon) => {
    zeichneAbschnitt(einsatzId, zeichneAbschnittId!, { flaeche_geojson: JSON.stringify(poly) })
      .then(() => qc.invalidateQueries({ queryKey: einsatzKeys.abschnitte(einsatzId) }))
      .catch(fehler)
      .finally(() => dispatch({ t: 'beenden', arten: ['abschnitt'] }));
  };
  const onFlaecheKlick = (fid: number) => {
    if (exklusiverModusAktiv) return; // LFH-208: kein Panel während eines exklusiven Modus
    setSelektion({ art: 'objekt', schluessel: `abschnitt-${fid}` });
  };
  const onZoneKlick = (id: number) => {
    if (exklusiverModusAktiv) return; // LFH-208: kein Panel während eines exklusiven Modus
    setSelektion({ art: 'zone', id });
  };
  const onZoneGezeichnet = (g: GeoJsonGeometry) => dispatch({ t: 'zoneGezeichnet', geometrie: g });
  const onFachebeneKlick = (
    properties: Record<string, unknown>,
    quelle: FachebeneQuelle,
    geometrie?: { type: string; coordinates: unknown } | null,
  ) => {
    if (exklusiverModusAktiv) return; // LFH-208: kein Panel während eines exklusiven Modus (vorher nur Platzieren)
    setSelektion({ art: 'fachebene', wert: { quelle, properties, geometrie } });
  };
  // ZeichnenSteuerung „Abbrechen" (Phase zeichnen): Entwurf + Abschnitt-Zeichnen verwerfen.
  const onZeichnenAbbrechen = () => dispatch({ t: 'beenden', arten: ['zone', 'abschnitt'] });

  // Zonen-Inspector-CRUD.
  const zoneAendern = (zoneId: number, patch: ZonePatch) =>
    aktualisiereZone(einsatzId, zoneId, patch)
      .then(() => {
        qc.invalidateQueries({ queryKey: einsatzKeys.zonen(einsatzId) });
        qc.invalidateQueries({ queryKey: einsatzKeys.gefahrengebiete(einsatzId) });
      })
      .catch(fehler);
  const zoneLoeschen = (zoneId: number) =>
    loescheZone(einsatzId, zoneId)
      .then(() => {
        setZoneAuswahl(null);
        qc.invalidateQueries({ queryKey: einsatzKeys.zonen(einsatzId) });
        return qc.invalidateQueries({ queryKey: einsatzKeys.gefahrengebiete(einsatzId) });
      })
      .catch(fehler);

  // Freies-Zeichen-Inspector-CRUD (LFH-170). Whole-Spec-Update (lat/lon unverändert).
  const zeichenAendern = (id: number, spec: FreiesZeichenUpdate) =>
    aktualisiereFreiesZeichen(einsatzId, id, spec)
      .then(() => qc.invalidateQueries({ queryKey: einsatzKeys.freieZeichen(einsatzId) }))
      .catch(fehler);
  // Verschieben auf eine andere Ansicht bzw. auf alle (`null`) — Teil-Patch (B/LFH-320).
  const zeichenVerschieben = (id: number, ansichtId: number | null) =>
    verschiebeFreiesZeichen(einsatzId, id, ansichtId)
      .then(() => qc.invalidateQueries({ queryKey: einsatzKeys.freieZeichen(einsatzId) }))
      .catch(fehler);
  const zeichenLoeschen = (id: number) =>
    loescheFreiesZeichen(einsatzId, id)
      .then(() => {
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
    exklusiverModusAktiv,
    // Serienmodus (LFH-332/M76).
    zeichenSerie,
    setZeichenSerie,
    zeichenSerieAnzahl,
    zoneSerie,
    setZoneSerie,
    zoneSerieAnzahl,
    // Panel-Schließer (onSchliessen der Inspektoren).
    setAuswahl,
    setZoneAuswahl,
    setFachebeneAuswahl,
    setFlyToZiel, // Reverse-Deeplink (LFH-155): Zone anfliegen

    // Handler.
    onKarteKlick,
    onMarkerWaehlen,
    loescheVerortung,
    aendereSymbol,
    bestaetigungSpeichern,
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
