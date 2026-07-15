import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { aktualisiereEinsatz, type KopfdatenUpdate } from '../../api/einsaetze';
import { aktualisiereUhs } from '../../api/einsatzUhs';
import { aktualisiereSchaden } from '../../api/einsatzSchaden';
import { verorteEinheit } from '../../api/einheiten';
import { verorteFahrzeug } from '../../api/einsatzFahrzeuge';
import { verortePerson } from '../../api/einsatzPersonal';
import { zeichneAbschnitt } from '../../api/einsatzabschnitte';
import { legeZoneAn, aktualisiereZone, loescheZone, type ZonePatch } from '../../api/lagezonen';
import { legeFreiesZeichenAn, aktualisiereFreiesZeichen, loescheFreiesZeichen } from '../../api/freieZeichen';
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

interface KartenInteraktionArgs {
  einsatzId: number;
  einsatz: EinsatzAnzeige | undefined;
  darfSchreiben: boolean;
  alleVerortet: KarteMarker[];
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
export function useKartenInteraktion({ einsatzId, einsatz, darfSchreiben, alleVerortet, fehler }: KartenInteraktionArgs) {
  const qc = useQueryClient();

  const [platzierungZiel, setPlatzierungZiel] =
    useState<{ typ: PlatzierenPunktTyp | 'einsatzort'; id: number } | null>(null);
  const [zeichneAbschnittId, setZeichneAbschnittId] = useState<number | null>(null);
  const [zoneEntwurf, setZoneEntwurf] =
    useState<{ typ: ZoneTyp; modus: ZeichenModus; farbe?: string } | null>(null);
  // Bestätigungs-Phase (LFH-145): gezeichnete Geometrie wird hier zwischengehalten,
  // bevor sie erst nach explizitem „Speichern" persistiert wird (nicht sofort bei Fertig).
  const [zoneBestaetigung, setZoneBestaetigung] =
    useState<{ typ: ZoneTyp; modus: ZeichenModus; farbe?: string; geometrie: GeoJsonGeometry } | null>(null);
  const [zoneSpeichern, setZoneSpeichern] = useState(false);
  // Monoton steigend bei jedem Zonen-Zeichnen-Start (LFH-145 M-A): erzwingt ein Re-Fire
  // des Kartenflaeche-Zonen-Effekts auch bei gleich bleibendem Modus (z. B. Zone→Zone mit
  // Gefahrengebiet→Absperrbereich, beides Polygon), damit starten() einen offenen,
  // unbestätigten Entwurf verwirft statt ihn beim nächsten Zeichnen als Orphan liegen zu lassen.
  const [zoneZeichnenNonce, setZoneZeichnenNonce] = useState(0);
  const [zoneAuswahl, setZoneAuswahl] = useState<number | null>(null);
  const [auswahl, setAuswahl] = useState<string | null>(null);
  const [flyToZiel, setFlyToZiel] = useState<{ lng: number; lat: number } | null>(null);
  // Angeklicktes Fachebenen-Objekt (externe Daten) → Detail-Panel. geometrie = volle,
  // un-geclippte Geometrie aus der geladenen FeatureCollection (LFH-146, Fläche/Umfang).
  const [fachebeneAuswahl, setFachebeneAuswahl] = useState<{
    quelle: FachebeneQuelle;
    properties: Record<string, unknown>;
    geometrie?: { type: string; coordinates: unknown } | null;
  } | null>(null);
  const [bildPlatzierenId, setBildPlatzierenId] = useState<number | null>(null);
  // Aktives freies Zeichen zum Platzieren (LFH-170): die per Picker gewählte DV-102-Spec
  // (ohne lat/lon — die kommt vom Karten-Klick). null = kein Platzier-Modus.
  const [zeichenPlatzieren, setZeichenPlatzieren] = useState<FreiesZeichenUpdate | null>(null);

  // Ein wechselseitig-exklusiver Interaktionsmodus ist aktiv (Platzieren / Bild-Platzieren /
  // Abschnitt- oder Zonen-Zeichnen / Zonen-Bestätigung / freies-Zeichen-Platzieren). Während
  // dessen darf ein Karten-Klick auf ein bestehendes Objekt kein Auswahl-Panel öffnen (LFH-208:
  // sonst Doppel-Panel neben der ZeichnenSteuerung). Billiger abgeleiteter Boolean — bewusst
  // kein useMemo (kein Deps-Churn). zoneBestaetigung ist heute stets mit truthy zoneEntwurf
  // gepaart, wird aber explizit geführt, damit ein künftiger Bestätigung-only-State robust bleibt.
  const exklusiverModusAktiv =
    platzierungZiel != null ||
    bildPlatzierenId != null ||
    zeichneAbschnittId != null ||
    zoneEntwurf != null ||
    zoneBestaetigung != null ||
    zeichenPlatzieren != null;

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
      setPlatzierungZiel(null);
    },
    onError: fehler,
  });

  // Freies Zeichen am Klickpunkt anlegen (LFH-170); Spec kommt aus dem Platzier-Modus.
  const legeZeichenMutation = useMutation({
    mutationFn: async (p: { lat: number; lon: number }) => {
      if (!zeichenPlatzieren) return;
      await legeFreiesZeichenAn(einsatzId, { lat: p.lat, lon: p.lon, ...zeichenPlatzieren });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: einsatzKeys.freieZeichen(einsatzId) });
      setZeichenPlatzieren(null);
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
    setAuswahl(schluessel);
    setZoneAuswahl(null);
    setFachebeneAuswahl(null);
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
    setZoneSpeichern(true);
    legeZoneAn(einsatzId, {
      typ: zoneBestaetigung.typ,
      geometrie_typ: zoneBestaetigung.geometrie.type,
      geometrie: JSON.stringify(zoneBestaetigung.geometrie),
      farbe: zoneBestaetigung.typ === 'freie_skizze' ? zoneBestaetigung.farbe ?? null : null,
    })
      .then(() => qc.invalidateQueries({ queryKey: einsatzKeys.zonen(einsatzId) }))
      .catch(fehler)
      .finally(() => {
        setZoneSpeichern(false);
        setZoneBestaetigung(null);
        setZoneEntwurf(null); // beendet Zeichnen → Kartenflaeche-Effekt ruft stoppen() → clear()
      });
  };
  const bestaetigungVerwerfen = () => {
    setZoneBestaetigung(null);
    setZoneEntwurf(null); // verwirft den Entwurf (stoppen() → clear())
  };

  // --- Start-/Reset-Handler (mutually-exclusive Modi) -------------------------
  const onPlatzierenStart = (z: { typ: PlatzierenPunktTyp; id: number }) => {
    setPlatzierungZiel(z);
    setZeichenPlatzieren(null);
    setZoneEntwurf(null);
    setZoneBestaetigung(null);
    setAuswahl(null);
  };
  const onPlatzierenAbbrechen = () => setPlatzierungZiel(null);
  const onAbschnittZeichnenStart = (id: number) => {
    setZeichneAbschnittId(id);
    setZeichenPlatzieren(null);
    setZoneEntwurf(null);
    setZoneBestaetigung(null);
    setPlatzierungZiel(null);
    setAuswahl(null);
  };
  const onZoneZeichnenStart = (entwurf: { typ: ZoneTyp; modus: ZeichenModus; farbe?: string }) => {
    setZoneEntwurf(entwurf);
    setZeichenPlatzieren(null);
    setZoneBestaetigung(null); // neuer Entwurf beendet eine evtl. hängende Bestätigung
    setZoneZeichnenNonce((n) => n + 1);
    setZoneAuswahl(null);
    setZeichneAbschnittId(null);
    setPlatzierungZiel(null);
    setAuswahl(null);
  };
  const onKoordinateEingeben = (lat: number, lon: number) => {
    if (platzierungZiel && darfSchreiben) verortenMutation.mutate({ lat, lon });
  };
  const onEinsatzortPlatzieren = () => {
    setPlatzierungZiel({ typ: 'einsatzort', id: 0 });
    setZeichenPlatzieren(null);
    setZoneEntwurf(null);
    setZoneBestaetigung(null);
    setAuswahl(null);
  };
  // Freies-Zeichen-Platzieren starten/abbrechen (LFH-170). Start räumt alle anderen exklusiven
  // Modi (Mutual-Exclusion, LFH-145); jeder andere Start räumt umgekehrt zeichenPlatzieren.
  const onZeichenPlatzierenStart = (spec: FreiesZeichenUpdate) => {
    setZeichenPlatzieren(spec);
    setPlatzierungZiel(null);
    setBildPlatzierenId(null);
    setZeichneAbschnittId(null);
    setZoneEntwurf(null);
    setZoneBestaetigung(null);
    setAuswahl(null);
  };
  const onZeichenPlatzierenAbbrechen = () => setZeichenPlatzieren(null);
  const onBildPlatzieren = (id: number) => {
    setBildPlatzierenId(id);
    setZeichenPlatzieren(null);
    setZoneEntwurf(null);
    setZoneBestaetigung(null);
    setZeichneAbschnittId(null);
    setPlatzierungZiel(null);
    setAuswahl(null);
  };
  const onBildPlatzierenFertig = () => setBildPlatzierenId(null);

  // Abschnittsfläche zeichnen fertig → persistieren, dann Zeichenmodus beenden.
  const onFlaecheGezeichnet = (poly: GeoJsonPolygon) => {
    zeichneAbschnitt(einsatzId, zeichneAbschnittId!, { flaeche_geojson: JSON.stringify(poly) })
      .then(() => qc.invalidateQueries({ queryKey: einsatzKeys.abschnitte(einsatzId) }))
      .catch(fehler)
      .finally(() => setZeichneAbschnittId(null));
  };
  const onFlaecheKlick = (fid: number) => {
    if (exklusiverModusAktiv) return; // LFH-208: kein Panel während eines exklusiven Modus
    setAuswahl(`abschnitt-${fid}`);
    setFachebeneAuswahl(null);
  };
  const onZoneKlick = (id: number) => {
    if (exklusiverModusAktiv) return; // LFH-208: kein Panel während eines exklusiven Modus
    setZoneAuswahl(id);
    setAuswahl(null);
    setFachebeneAuswahl(null);
  };
  const onZoneGezeichnet = (g: GeoJsonGeometry) => {
    if (!zoneEntwurf) return;
    // Nicht sofort persistieren: erst Bestätigung (Entwurf bleibt sichtbar). LFH-145.
    setZoneBestaetigung({ ...zoneEntwurf, geometrie: g });
  };
  const onFachebeneKlick = (
    properties: Record<string, unknown>,
    quelle: FachebeneQuelle,
    geometrie?: { type: string; coordinates: unknown } | null,
  ) => {
    if (exklusiverModusAktiv) return; // LFH-208: kein Panel während eines exklusiven Modus (vorher nur Platzieren)
    setFachebeneAuswahl({ quelle, properties, geometrie });
    setAuswahl(null);
    setZoneAuswahl(null);
  };
  // ZeichnenSteuerung „Abbrechen" (Phase zeichnen): Entwurf + Abschnitt-Zeichnen verwerfen.
  const onZeichnenAbbrechen = () => {
    setZoneEntwurf(null);
    setZeichneAbschnittId(null);
  };

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
    onKoordinateEingeben,
    onEinsatzortPlatzieren,
    onBildPlatzieren,
    onBildPlatzierenFertig,
    onZeichenPlatzierenStart,
    onZeichenPlatzierenAbbrechen,
    onFlaecheGezeichnet,
    onFlaecheKlick,
    onZoneKlick,
    onZoneGezeichnet,
    onFachebeneKlick,
    onZeichnenAbbrechen,
    zoneAendern,
    zoneLoeschen,
    zeichenAendern,
    zeichenLoeschen,
  };
}
