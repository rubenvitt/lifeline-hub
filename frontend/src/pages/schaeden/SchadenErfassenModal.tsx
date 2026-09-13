import { useEffect, useRef, useState } from 'react';
import { App, Collapse, Form, Input } from 'antd';
import { Select } from '../../components/Select';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../../api/client';
import { einsatzKeys } from '../../api/queryKeys';
import { legeSchadenAn, type SchadenEingabe } from '../../api/einsatzSchaden';
import type { Ausmass, SchadenTyp } from '../../api/types';
import { ErfassungsModal } from '../../components/Erfassung';
import KoordinatenEingabe from '../../anzeige/KoordinatenEingabe';
import type { LatLon } from '../../anzeige/koordinaten';
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
  koordinaten?: LatLon | null;
};

/** Schnellerfassungs-Modal für Schäden. Props-gesteuert: die Seite hält nur den `open`-State
 *  (Trigger-Button, ?neu=1), dieses Modal besitzt Formular, Geschädigt-Auswahl und die
 *  Anlege-Mutation. Vier Kernfelder bleiben sichtbar; Geschädigt und Koordinate liegen
 *  optional unter „Weitere Angaben“.
 *
 *  SERIENMODUS (LFH-332 · B4): an einer Schadenslage werden Schäden am Stück erfasst, deshalb
 *  `serie` — „Speichern und nächste" lässt den Dialog stehen. Der Ort wiederholt sich dabei
 *  fast immer (dieselbe Straße, dasselbe Objekt) und überlebt als `uebernahme` ein
 *  Serien-Speichern. Zusätzlich wird er nach erfolgreicher Mutation sitzungsweit gemerkt und
 *  beim nächsten Öffnen einmal per Formularwert eingesetzt — bewusst nicht als `initialValues`,
 *  damit der ausgeschaltete B4-Schalter einen Serien-Reset leer lässt.
 *
 *  Zurückgesetzt wird NICHT mehr hier: die Hülle leert die Felder auf beiden Wegen (nach dem
 *  Erfassen und beim Abbrechen). Nur „Geschädigt" liegt außerhalb des Formstores in lokalem State
 *  — den muss dieses Modul selbst leeren. */
export default function SchadenErfassenModal({ open, onClose, einsatzId, orgId, orgName }: Props) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [form] = Form.useForm<SchadenFormular>();
  const geladeneOeffnung = useRef<string | null>(null);
  const formularEinsatzId = useRef(einsatzId);
  // Geschädigt liegt außerhalb des Formstores; der Reset erfolgt daher separat.
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
    onError: (e: unknown) =>
      message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen'),
  });

  /**
   * `mutateAsync`, nicht `mutate`: die Hülle darf die Felder nur leeren, wenn der Datensatz
   * wirklich angekommen ist — sie erkennt das an der abgelehnten Zusage. Sitzungsort und
   * lokaler Geschädigt-Wert ändern sich erst in `onErfasst`, also zusätzlich hinter der
   * zentralen Abbruchprüfung. Den Fehlertext meldet weiterhin das `onError` der Mutation.
   *
   * Der Geschädigt-Reset hängt hier und NICHT nur an `onFertig` (Abweichung von der
   * Auftragsformulierung, bewusst): beim Serien-Speichern läuft `onFertig` nie, die Hülle leert
   * aber das Formular — der lokale Geschädigt-Wert würde sonst stillschweigend auf den nächsten
   * Schaden mitwandern. Das wäre ein falscher Datensatz, keine Kosmetik.
   */
  async function onErfassen(daten: SchadenFormular) {
    await anlegenMutation.mutateAsync({
      typ: daten.typ,
      ausmass: daten.ausmass,
      ort: daten.ort,
      beschreibung: daten.beschreibung ?? null,
      lat: daten.koordinaten?.lat ?? null,
      lon: daten.koordinaten?.lon ?? null,
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
      <Collapse
        items={[
          {
            key: 'weitere',
            label: 'Weitere Angaben',
            children: (
              <>
                <Form.Item label="Geschädigt">
                  <GeschaedigtPicker
                    einsatzId={einsatzId}
                    orgName={orgName}
                    value={geschaedigt}
                    onChange={setGeschaedigt}
                  />
                </Form.Item>
                <Form.Item label="Koordinate" name="koordinaten">
                  <KoordinatenEingabe />
                </Form.Item>
              </>
            ),
          },
        ]}
      />
    </ErfassungsModal>
  );
}
