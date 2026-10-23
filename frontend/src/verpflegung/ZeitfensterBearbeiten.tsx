import { Form, Input } from 'antd';
import type { Dayjs } from 'dayjs';
import { useState, type RefObject } from 'react';
import { ZeitraumEingabe } from '../anzeige/ZeitpunktEingabe';
import { alsBackendZeit, alsZeitpunkt } from '../anzeige/zeitEingabe';
import { VERPFLEGUNG_ZEITFENSTER_BEZEICHNUNG_MAX } from '../api/eingabegrenzen';
import type {
  Kostform,
  ModulFreigaben,
  Verpflegungsart,
  Verpflegungsstelle,
  VerpflegungZeitfenster,
  ZeitfensterPatch,
} from '../api/types';
import { BearbeitbaresPaneel, type BearbeitbaresFeld } from '../components/instrument';
import { Select } from '../components/Select';
import { zeichenGrenze, zeichenRegel } from '../components/zeichenGrenze';
import { useBedarfsvorschlag } from './useBedarfsvorschlag';
import {
  BEDARF_REGEL,
  VERPFLEGUNGSART_OPTIONEN,
  ZEITRAUM_REGEL,
  anzahlFeld,
  normalisiert,
  vorschlagHilfe,
  zeitfensterPatch,
  zeitfensterStellenOptionen,
  type ZeitfensterWerte,
} from './VerpflegungDialoge';
import { KOSTFORM_LABEL, KOSTFORMEN } from './verpflegungText';

/**
 * „Bedarf bearbeiten“ an der Zeitfensterkarte (LLH-1139, `frontend/AGENTS.md`, „Bearbeiten in der
 * Ansicht“; Spec `kraefte-verpflegung`, „Zeitfenster ändern und löschen“): die Karte ist die
 * Ansicht des Zeitfensters, `BearbeitbaresPaneel` im Modus `ansicht` tauscht ihren Körper gegen
 * dieselben Felder wie früher der Dialog (Bezeichnung, Zeitraum, Bedarf, Sonderkost, Art, Stellen).
 * Kein Modal; die Karte hängt diesen Teil nur ein, solange bearbeitet wird.
 *
 * - **Nur Geändertes** über `zeitfensterPatch` gegen den Stand beim Öffnen (Sonderkost je Kostform,
 *   `verpflegungsart: null` leert, `stelle_ids` ersetzt). Der PATCH des Servers trägt das: ein
 *   fehlender Schlüssel bleibt, wie er ist.
 * - **Kein CAS:** der Verpflegungs-PATCH kennt keinen Basisstand, die Basis geht nicht hinaus und
 *   ein 409 kommt hier nicht vor. Feldweise gesendet, überschreibt eine Änderung nur ihre Felder.
 * - **Vorschläge** wie früher im Dialog: der gespeicherte Bedarf bleibt stehen, die Hilfe nennt
 *   „Aktuell n — Herkunft“ (Spec „Bedarfsvorschläge aus Personal und Betreuung“).
 */

type SonderkostFeld = `sk_${Kostform}`;

/** Flache Formularwerte: der Baustein kennt nur Felder der obersten Ebene. */
type ZeitfensterFormWerte = {
  bezeichnung: string;
  zeitraum: [Dayjs, Dayjs];
  bedarf_kraefte: number;
  bedarf_betreute: number;
  bedarf_weitere: number | null;
  verpflegungsart: Verpflegungsart | null;
  stelle_ids?: number[];
} & Record<SonderkostFeld, number | null>;

const skFeld = (k: Kostform): SonderkostFeld => `sk_${k}`;

function formWerte(zf: VerpflegungZeitfenster, hasStellen: boolean): ZeitfensterFormWerte {
  const sk = Object.fromEntries(
    KOSTFORMEN.map((k) => [skFeld(k), zf.bedarf.sonderkost[k]]),
  ) as Record<SonderkostFeld, number>;
  return {
    bezeichnung: zf.bezeichnung,
    zeitraum: [alsZeitpunkt(zf.von_at)!, alsZeitpunkt(zf.bis_at)!],
    bedarf_kraefte: zf.bedarf.kraefte,
    bedarf_betreute: zf.bedarf.betreute,
    bedarf_weitere: zf.bedarf.weitere,
    verpflegungsart: zf.verpflegungsart ?? null,
    ...(hasStellen ? { stelle_ids: [...zf.stelle_ids] } : {}),
    ...sk,
  };
}

function zuWerte(w: ZeitfensterFormWerte): ZeitfensterWerte {
  return {
    bezeichnung: w.bezeichnung,
    zeitraum: w.zeitraum,
    bedarf_kraefte: w.bedarf_kraefte,
    bedarf_betreute: w.bedarf_betreute,
    bedarf_weitere: w.bedarf_weitere,
    sonderkost: Object.fromEntries(KOSTFORMEN.map((k) => [k, w[skFeld(k)]])),
    verpflegungsart: w.verpflegungsart,
    stelle_ids: w.stelle_ids,
  };
}

export interface ZeitfensterBearbeitenProps {
  zeitfenster: VerpflegungZeitfenster;
  /** `freigabenQuery.data` unverändert (Hook-Vertrag von `useBedarfsvorschlag`). */
  freigaben: ModulFreigaben | undefined;
  jetzt: Dayjs;
  stellen: readonly Verpflegungsstelle[];
  /** Lehnt bei Ablehnung ab (`mutateAsync`); der Grund steht an der Karte. */
  onSpeichern: (patch: ZeitfensterPatch) => Promise<unknown>;
  /** Gespeichert, abgebrochen oder verworfen: die Karte zeigt wieder ihre Ansicht. */
  onSchliessen: () => void;
  /** Wohin der Fokus nach dem Schließen geht („Bedarf bearbeiten“ bzw. das Aktionsmenü). */
  ausloeserRef: RefObject<HTMLElement | null>;
}

export default function ZeitfensterBearbeiten({
  zeitfenster,
  freigaben,
  jetzt,
  stellen,
  onSpeichern,
  onSchliessen,
  ausloeserRef,
}: ZeitfensterBearbeitenProps) {
  // Der Stand beim Öffnen: Vergleichsbasis des Patches, auch wenn Live-Daten nachziehen.
  const [vorher] = useState(zeitfenster);
  const hasStellen = stellen.length > 0;
  const [werte] = useState(() => formWerte(vorher, hasStellen));
  const [form] = Form.useForm<ZeitfensterFormWerte>();

  // Der Beginn geht als Wire-String in den Query-Key der Kopfzahl. Im ersten Render ist `useWatch`
  // noch leer, bis dahin gilt der gespeicherte Beginn (sonst ginge „jetzt“ hinaus).
  const zeitraum = Form.useWatch('zeitraum', form) as [Dayjs | null, Dayjs | null] | undefined;
  const beginn = zeitraum?.[0];
  const vonAt =
    beginn && beginn.isValid()
      ? alsBackendZeit(beginn)
      : zeitraum === undefined
        ? normalisiert(vorher.von_at)
        : undefined;
  const vorschlag = useBedarfsvorschlag({ einsatzId: vorher.einsatz_id, vonAt, freigaben, jetzt });
  const kraefteHilfe = vorschlagHilfe(vorschlag.kraefte, false);

  const felder: BearbeitbaresFeld<ZeitfensterFormWerte>[] = [
    {
      name: 'bezeichnung',
      label: 'Bezeichnung',
      anzeige: vorher.bezeichnung,
      eingabe: <Input count={zeichenGrenze(VERPFLEGUNG_ZEITFENSTER_BEZEICHNUNG_MAX)} />,
      regeln: [
        { required: true, whitespace: true, message: 'Bitte eine Bezeichnung angeben' },
        zeichenRegel(VERPFLEGUNG_ZEITFENSTER_BEZEICHNUNG_MAX, 'Bezeichnung'),
      ],
    },
    {
      name: 'zeitraum',
      label: 'Zeitraum',
      anzeige: null,
      eingabe: <ZeitraumEingabe placeholder={['Beginn', 'Ende']} style={{ width: '100%' }} />,
      regeln: [ZEITRAUM_REGEL],
      breit: true,
    },
    {
      name: 'bedarf_kraefte',
      label: 'Einsatzkräfte (EP)',
      anzeige: vorher.bedarf.kraefte,
      eingabe: anzahlFeld(),
      regeln: [BEDARF_REGEL],
      // Sichtbar statt Tooltip: am Tablet gibt es kein Hover (LFH-948).
      hilfe: (
        <>
          <div>EP = Essensportionen</div>
          {kraefteHilfe && <div>{kraefteHilfe}</div>}
        </>
      ),
    },
    {
      name: 'bedarf_betreute',
      label: 'Betreute (EP)',
      anzeige: vorher.bedarf.betreute,
      eingabe: anzahlFeld(),
      regeln: [BEDARF_REGEL],
      hilfe: vorschlagHilfe(vorschlag.betreute, false),
    },
    {
      name: 'bedarf_weitere',
      label: 'Weitere Personen (EP)',
      anzeige: vorher.bedarf.weitere,
      eingabe: anzahlFeld(),
    },
    // Sonderkost ist eine Teilmenge der Essensportionen („davon“); die Obergrenze prüft der
    // Server (422 an der Karte).
    ...KOSTFORMEN.map((k): BearbeitbaresFeld<ZeitfensterFormWerte> => ({
      name: skFeld(k),
      label: `davon ${KOSTFORM_LABEL[k]}`,
      anzeige: vorher.bedarf.sonderkost[k],
      eingabe: anzahlFeld(),
    })),
    {
      name: 'verpflegungsart',
      label: 'Art',
      anzeige: vorher.verpflegungsart,
      eingabe: <Select allowClear placeholder="ohne Angabe" options={VERPFLEGUNGSART_OPTIONEN} />,
    },
    ...(hasStellen
      ? [
          {
            name: 'stelle_ids' as const,
            label: 'Stellen',
            anzeige: null,
            eingabe: (
              <Select
                mode="multiple"
                placeholder="einsatzweit"
                options={zeitfensterStellenOptionen(stellen, vorher)}
              />
            ),
            breit: true,
          },
        ]
      : []),
  ];

  return (
    <BearbeitbaresPaneel<ZeitfensterFormWerte, ZeitfensterPatch>
      modus="ansicht"
      offen
      onOffenAenderung={(offen) => {
        if (!offen) onSchliessen();
      }}
      titel={vorher.bezeichnung}
      // Ohne Änderung trägt das Zeitfenster noch kein `geaendert_at`: sein Stand ist die Anlage.
      datensatz={{ geaendert_at: vorher.geaendert_at ?? vorher.angelegt_at }}
      werte={werte}
      felder={felder}
      form={form}
      patch={(_, nachher) => zeitfensterPatch(vorher, zuWerte(nachher))}
      onSpeichern={(patch) => onSpeichern(patch)}
      darfSchreiben
      ausloeserRef={ausloeserRef}
      spalten={4}
    />
  );
}
