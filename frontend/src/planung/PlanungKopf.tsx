import { Input } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { aenderePlanung } from '../api/planungen';
import { PLANUNG_BEZEICHNUNG_MAX, PLANUNG_ORT_MAX } from '../api/eingabegrenzen';
import { globalKeys } from '../api/queryKeys';
import type { Einsatzart, Planung, PlanungAendernBody, PlanungKopf as Kopf } from '../api/types';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { ZeitraumEingabe, type Zeitraum } from '../anzeige/ZeitpunktEingabe';
import { tagUndUhrzeit } from '../anzeige/zeitDarstellung';
import { alsBackendZeit, alsZeitpunkt } from '../anzeige/zeitEingabe';
import { dauerFeldText, dauerMinuten, formatDauer } from '../abloesung/dauer';
import BearbeitbaresPaneel, {
  type BearbeitbaresFeld,
} from '../components/instrument/BearbeitbaresPaneel';
import { Select } from '../components/Select';
import { mitVorgabe } from '../components/vorgabeText';
import { EINSATZART_LABELS, EINSATZART_OPTIONEN } from '../einsatz/einsatzart';
import {
  MAX_DIENST_VORGABE,
  maxDienstRegel,
  MIN_RUHE_VORGABE,
  minRuheRegel,
  zeitraumRegel,
} from './planungRegeln';
import { uebernimmPlanung } from './planungCache';

export interface KopfWerte {
  bezeichnung: string;
  einsatzart: Einsatzart;
  ort: string;
  zeitraum: Zeitraum | null;
  max_dienst?: string;
  min_ruhe?: string;
}

export type KopfPatch = Omit<PlanungAendernBody, 'version'>;

export function kopfWerte(k: Kopf): KopfWerte {
  return {
    bezeichnung: k.bezeichnung,
    einsatzart: k.einsatzart,
    ort: k.ort ?? '',
    zeitraum: [alsZeitpunkt(k.von) ?? null, alsZeitpunkt(k.bis) ?? null],
    max_dienst: k.grenzwerte.max_dienst_eigen
      ? dauerFeldText(k.grenzwerte.max_dienst_minuten)
      : undefined,
    min_ruhe: k.grenzwerte.min_ruhe_eigen
      ? dauerFeldText(k.grenzwerte.min_ruhe_minuten)
      : undefined,
  };
}

/** Nur Geändertes; ein geleertes Feld ist `null` (Grenzwerte: wieder die Vorgabe). */
export function kopfPatch(vorher: KopfWerte, nachher: KopfWerte): KopfPatch {
  const patch: KopfPatch = {};
  const bezeichnung = nachher.bezeichnung.trim();
  if (bezeichnung !== vorher.bezeichnung) patch.bezeichnung = bezeichnung;
  if (nachher.einsatzart !== vorher.einsatzart) patch.einsatzart = nachher.einsatzart;
  const ort = nachher.ort?.trim() ?? '';
  if (ort !== vorher.ort) patch.ort = ort || null;
  const [vonAlt, bisAlt] = vorher.zeitraum ?? [null, null];
  const [von, bis] = nachher.zeitraum ?? [null, null];
  if (von && (!vonAlt || alsBackendZeit(von) !== alsBackendZeit(vonAlt)))
    patch.von = alsBackendZeit(von);
  if (bis && (!bisAlt || alsBackendZeit(bis) !== alsBackendZeit(bisAlt)))
    patch.bis = alsBackendZeit(bis);
  const dienst = dauerMinuten(nachher.max_dienst);
  if (dienst !== dauerMinuten(vorher.max_dienst)) patch.max_dienst_minuten = dienst;
  const ruhe = dauerMinuten(nachher.min_ruhe);
  if (ruhe !== dauerMinuten(vorher.min_ruhe)) patch.min_ruhe_minuten = ruhe;
  return patch;
}

/**
 * Kopf einer Planung (LLH-1586), bearbeitet in der Ansicht (`BearbeitbaresPaneel`, LLH-1139):
 * Bezeichnung, Einsatzart, Ort, Zeitraum und die Grenzwerte für die Befunde „zu lange im
 * Dienst“ und Ruhe. Leere Grenzwerte sind die Vorgabe (12 h / 8 h), der Platzhalter nennt sie.
 * CAS über `version` des Kopfs (409 bei einem anderen Stand).
 */
export default function PlanungKopf({
  planung,
  onNeuLaden,
}: {
  planung: Planung;
  onNeuLaden: () => void;
}) {
  const { kopf, kennzahlen } = planung;
  const qc = useQueryClient();
  const { konventionen } = useAnzeigeKonventionen();
  // `BearbeitbaresPaneel` liest als CAS-Basis `geaendert_at`; die Planung zählt `version`.
  const datensatz = useMemo(() => ({ geaendert_at: String(kopf.version) }), [kopf.version]);
  const werte = useMemo(() => kopfWerte(kopf), [kopf]);

  const speichern = async (patch: KopfPatch, basis: string | undefined) => {
    // Ohne Basis („Meine Änderung übernehmen“) gilt der neueste bekannte Stand.
    const neuester = qc.getQueryData<Planung>(globalKeys.planung(kopf.id))?.kopf.version;
    const version = basis !== undefined ? Number(basis) : (neuester ?? kopf.version);
    const p = await aenderePlanung(kopf.id, { version, ...patch });
    uebernimmPlanung(qc, p);
    void qc.invalidateQueries({ queryKey: globalKeys.planungen(), exact: true });
  };

  const g = kopf.grenzwerte;
  const felder: BearbeitbaresFeld<KopfWerte>[] = [
    {
      name: 'bezeichnung',
      label: 'Bezeichnung',
      anzeige: kopf.bezeichnung,
      eingabe: <Input maxLength={PLANUNG_BEZEICHNUNG_MAX} />,
      regeln: [{ required: true, whitespace: true, message: 'Bezeichnung darf nicht leer sein' }],
    },
    {
      name: 'einsatzart',
      label: 'Einsatzart',
      anzeige: EINSATZART_LABELS[kopf.einsatzart],
      eingabe: <Select<Einsatzart> options={EINSATZART_OPTIONEN} />,
    },
    {
      name: 'ort',
      label: 'Ort',
      anzeige: kopf.ort ?? '—',
      eingabe: <Input maxLength={PLANUNG_ORT_MAX} />,
    },
    {
      name: 'zeitraum',
      label: 'Zeitraum',
      anzeige: `${tagUndUhrzeit(kopf.von, konventionen)}–${tagUndUhrzeit(kopf.bis, konventionen)}`,
      eingabe: <ZeitraumEingabe art="frist" />,
      regeln: [zeitraumRegel],
      breit: true,
      mono: true,
    },
    {
      name: 'max_dienst',
      label: 'Höchstens im Dienst',
      anzeige: g.max_dienst_eigen
        ? formatDauer(g.max_dienst_minuten)
        : mitVorgabe(formatDauer(g.max_dienst_minuten)),
      eingabe: (
        <Input placeholder={mitVorgabe(formatDauer(MAX_DIENST_VORGABE))} autoComplete="off" />
      ),
      regeln: [maxDienstRegel],
      mono: true,
    },
    {
      name: 'min_ruhe',
      label: 'Mindestens Ruhe',
      anzeige: g.min_ruhe_eigen
        ? formatDauer(g.min_ruhe_minuten)
        : mitVorgabe(formatDauer(g.min_ruhe_minuten)),
      eingabe: <Input placeholder={mitVorgabe(formatDauer(MIN_RUHE_VORGABE))} autoComplete="off" />,
      regeln: [minRuheRegel],
      mono: true,
    },
  ];

  return (
    <BearbeitbaresPaneel<KopfWerte, KopfPatch>
      titel="Planung"
      meta={
        <span data-lfh="planung-kennzahlen">
          Soll {kennzahlen.soll} · Ist {kennzahlen.ist} · Offen {kennzahlen.offen} · Konflikte{' '}
          {kennzahlen.konflikte}
        </span>
      }
      datensatz={datensatz}
      werte={werte}
      felder={felder}
      patch={kopfPatch}
      onSpeichern={speichern}
      onNeuLaden={onNeuLaden}
      darfSchreiben
    />
  );
}
