import type { KarteMarker } from './marker';
import { tzIconKey } from './markerIcons';

export interface MarkerProps {
  schluessel: string;
  typ: string;
  label: string;
  farbe: string;
  icon?: string;
  statusFarbe?: string;
}

export type MarkerFeature = {
  type: 'Feature';
  properties: MarkerProps;
  geometry: { type: 'Point'; coordinates: [number, number] };
};

export type MarkerFeatureCollection = {
  type: 'FeatureCollection';
  features: MarkerFeature[];
};

function toFeature(mk: KarteMarker): MarkerFeature {
  const properties: MarkerProps = {
    schluessel: mk.schluessel, typ: mk.typ, label: mk.label, farbe: mk.farbe,
  };
  if (mk.tz) properties.icon = tzIconKey(mk.tz);
  if (mk.statusFarbe) properties.statusFarbe = mk.statusFarbe;
  return { type: 'Feature', properties, geometry: { type: 'Point', coordinates: [mk.lon, mk.lat] } };
}

/** Clusterbare Marker (alle außer dem Einsatzort) als FeatureCollection. */
export function baueMarkerFc(markers: KarteMarker[]): MarkerFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: markers.filter((m) => m.typ !== 'einsatzort').map(toFeature),
  };
}

/** Der Einsatzort-Marker (0 oder 1 Feature) für die eigene, ungeclusterte Source. */
export function baueEinsatzortFc(markers: KarteMarker[]): MarkerFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: markers.filter((m) => m.typ === 'einsatzort').map(toFeature),
  };
}
