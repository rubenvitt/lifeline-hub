import { useEffect, useRef, useState, type ReactNode } from 'react';
import { App, Collapse, Form, Input } from 'antd';
import { Select } from '../../components/Select';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { fehlerText } from '../../api/client';
import { einsatzKeys } from '../../api/queryKeys';
import { legeSchadenAn, type SchadenEingabe } from '../../api/einsatzSchaden';
import type { Ausmass, SchadenTyp } from '../../api/types';
import { ErfassungsModal } from '../../components/Erfassung';
import KoordinatenFeld from '../../anzeige/KoordinatenFeld';
import {
  alsLatLon,
  istUngueltigeKoordinate,
  type KoordinatenWert,
} from '../../anzeige/koordinatenWert';
import {
  liesErfassungsSitzungswert,
  schreibeErfassungsSitzungswert,
} from '../../components/erfassungsSitzung';
import GeschaedigtPicker, { type GeschaedigtWert } from './GeschaedigtPicker';
import { AUSMASS_META, TYP_LABEL, geschaedigtFelder } from './schadenHelfer';

interface Props {
  open: boolean;
  onClose: () => void;
  einsatzId: number;
  /** Org-ID der eigenen Organisation (für die Geschädigt-XOR-Abbildung). */
  orgId: number;
  /** Anzeigename der eigenen Organisation (Org-Option im GeschaedigtPicker). */
  orgName: string;
}

type SchadenFormular = Omit<SchadenEingabe, 'lat' | 'lon'> & {
  koordinaten?: KoordinatenWert;
};

/**
 * Schnellerfassungs-Modal für Schäden. Die Seite hält nur `open`; Formular, Geschädigt-Auswahl und
 * Mutation liegen hier. Vier Kernfelder sichtbar, Geschädigt und Koordinate unter „Weitere
 * Angaben“.
 *
 * Serienmodus: der Ort überlebt als `uebernahme` ein Serien-Speichern und wird sitzungsweit
 * gemerkt; beim nächsten Öffnen wird er per Formularwert eingesetzt, nicht als `initialValues`,
 * damit ein Serien-Reset bei ausgeschaltetem „Werte behalten" leer bleibt. Die Felder leert die
 * Hülle; nur „Geschädigt" liegt in lokalem State und wird hier geleert.
 */
export default function SchadenErfassenModal({ open, onClose, einsatzId, orgId, orgName }: Props) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [form] = Form.useForm<SchadenFormular>();
  const geladeneOeffnung = useRef<string | null>(null);
  const formularEinsatzId = useRef(einsatzId);
  const [geschaedigt, setGeschaedigt] = useState<GeschaedigtWert>(null);

  useEffect(() => {
    if (formularEinsatzId.current !== einsatzId) {
      formularEinsatzId.current = einsatzId;
      form.resetFields();
      setGeschaedigt(null);
      geladeneOeffnung.current = null;
    }
    const oeffnung = open ? `${einsatzId}:schaden` : null;
    if (oeffnung === null) {
      geladeneOeffnung.current = null;
      return;
    }
    if (geladeneOeffnung.current === oeffnung) return;
    geladeneOeffnung.current = oeffnung;
    const ort = liesErfassungsSitzungswert(einsatzId, 'schaden', 'ort');
    form.setFieldValue('ort', ort);
  }, [einsatzId, form, open]);

  const anlegenMutation = useMutation({
    mutationFn: (v: SchadenEingabe) => legeSchadenAn(einsatzId, v),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: einsatzKeys.schaeden(einsatzId) });
      qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
    },
    onError: (e: unknown) => message.error(fehlerText(e)),
  });

  /**
   * `mutateAsync`, nicht `mutate`: die Hülle leert nur, wenn der Datensatz angekommen ist.
   * Sitzungsort und Geschädigt-Wert ändern sich erst in `onErfasst`.
   *
   * Der Geschädigt-Reset hängt hier und nicht an `onFertig`: beim Serien-Speichern läuft `onFertig`
   * nie, der Wert wanderte sonst still auf den nächsten Schaden.
   */
  async function onErfassen(daten: SchadenFormular) {
    const koord = alsLatLon(daten.koordinaten);
    await anlegenMutation.mutateAsync({
      typ: daten.typ,
      ausmass: daten.ausmass,
      ort: daten.ort,
      beschreibung: daten.beschreibung ?? null,
      lat: koord?.lat ?? null,
      lon: koord?.lon ?? null,
      ...geschaedigtFelder(geschaedigt, orgId),
    });
  }

  function onErfasst(daten: SchadenFormular) {
    schreibeErfassungsSitzungswert(einsatzId, 'schaden', 'ort', daten.ort);
    setGeschaedigt(null);
  }

  return (
    <ErfassungsModal<SchadenFormular>
      offen={open}
      titel="Schaden erfassen"
      form={form}
      onErfassen={onErfassen}
      onErfasst={onErfasst}
      onFertig={onClose}
      onAbbrechen={() => {
        setGeschaedigt(null);
        onClose();
      }}
      laeuft={anlegenMutation.isPending}
      erfassenText="Anlegen"
      serie
      uebernahme={['ort']}
    >
      <Form.Item label="Typ" name="typ" rules={[{ required: true, message: 'Typ ist Pflicht' }]}>
        <Select
          options={(Object.keys(TYP_LABEL) as SchadenTyp[]).map((t) => ({
            value: t,
            label: TYP_LABEL[t],
          }))}
        />
      </Form.Item>
      <Form.Item
        label="Ausmaß"
        name="ausmass"
        rules={[{ required: true, message: 'Ausmaß ist Pflicht' }]}
      >
        <Select
          options={(Object.keys(AUSMASS_META) as Ausmass[]).map((a) => ({
            value: a,
            label: AUSMASS_META[a].label,
          }))}
        />
      </Form.Item>
      <Form.Item label="Ort" name="ort" rules={[{ required: true, message: 'Ort ist Pflicht' }]}>
        <Input placeholder="z. B. Hauptstr. 17 oder L 235 km 12,5" />
      </Form.Item>
      <Form.Item label="Beschreibung" name="beschreibung">
        <Input.TextArea rows={2} />
      </Form.Item>
      <WeitereAngaben>
        <Form.Item label="Geschädigt">
          <GeschaedigtPicker
            einsatzId={einsatzId}
            orgName={orgName}
            value={geschaedigt}
            onChange={setGeschaedigt}
          />
        </Form.Item>
        <KoordinatenFeld label="Koordinate" name="koordinaten" />
      </WeitereAngaben>
    </ErfassungsModal>
  );
}

/**
 * „Weitere Angaben“ unter den Kernfeldern. Eine ungültige Koordinate sperrt das Anlegen
 * (LFH-517); der Abschnitt lässt sich dann nicht zuklappen, sonst schlüge das Anlegen an einem
 * verborgenen Feld fehl (Erfassungs-Norm: was eine Ablehnung auslöst, bleibt sichtbar). Der
 * Zustand liegt hier, im Dialoginhalt, damit er wie zuvor mit dem Dialog neu beginnt.
 */
function WeitereAngaben({ children }: { children: ReactNode }) {
  const form = Form.useFormInstance<SchadenFormular>();
  const [offen, setOffen] = useState<string[]>([]);
  return (
    <Collapse
      activeKey={offen}
      onChange={(keys) => {
        if (keys.length === 0 && istUngueltigeKoordinate(form.getFieldValue('koordinaten'))) return;
        setOffen(keys);
      }}
      items={[{ key: 'weitere', label: 'Weitere Angaben', children }]}
    />
  );
}
