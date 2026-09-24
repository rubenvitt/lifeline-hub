import { Collapse, Form, Input } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useRef } from 'react';
import { ladeModulOverrides } from '../api/einsaetze';
import { ladeBetreuung } from '../api/betreuung';
import { ApiError } from '../api/client';
import { erfasseVerbleib, type VerbleibEingabe } from '../api/einsatzPerson';
import { einsatzKeys } from '../api/queryKeys';
import type { Betreuungsstelle } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { ErfassungsModal } from '../components/Erfassung';
import { Select } from '../components/Select';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import { modulRegistry } from '../einsatz/modulRegistry';
import { betreuungZugriffVon } from '../pages/lagekarte/betreuungEbene';
import {
  VERBLEIB_ART_OPTIONEN,
  sichtbareVerbleibFelder,
  stellenOptionen,
  verbleibBody,
  zielNachStellenwahl,
  type VerbleibFormWerte,
} from './verbleibErfassungKern';

/** Registry-Eintrag des Moduls „Betreuung" — Grenze der Stellen-Auswahl (LFH-674). */
const BETREUUNG_MODUL = modulRegistry.find((m) => m.key === 'betreuung');

interface VerbleibErfassungProps {
  einsatzId: number;
  personId: number;
  /** Nach erfolgreichem POST (Invalidierung der Person); der Dialog schließt danach selbst. */
  onErfasst: () => void;
  onSchliessen: () => void;
}

/**
 * „Verbleib erfassen" auf `ErfassungsModal` (Erfassungs-Norm, LFH-674 design.md D6). Vorher
 * ein handgebautes `<Modal onOk={form.submit}>`: der Knopf lag außerhalb des Formulars, Enter
 * sendete nicht ab.
 *
 * Montiert = offen (die Seite rendert `{offen && …}`), dadurch hat jede Öffnung eine frische
 * Mutation ohne alten Fehler. Fehler stehen IM Dialog (`SpeicherFehler`, LFH-535): die Mutation
 * hat kein `onError`, `mutateAsync` lehnt ab, die Hülle lässt die Felder stehen.
 *
 * Felder je Art hält das Budget (≤ 3 sichtbar): Transportmittel nur beim Transport, die
 * Betreuungsstelle nur bei der Notunterkunft UND mit Lesezugriff auf das Modul Betreuung — die
 * Grenze sitzt an der Datenquelle wie auf der Lagekarte (`betreuungZugriffVon`): ohne Zugriff
 * kein Abruf, und ein 403 kippt still auf „keine Auswahl". Die Notiz steht unter „Weitere
 * Angaben". Ohne `forceRender`: sie hat keine Vorbelegung, zugeklappt gibt es also nichts, was
 * verloren ginge, und ein einmal aufgeklapptes Panel bleibt eingehängt (antds Vorgabe). So
 * bleibt das Budget „≤ 3 sichtbar" widerlegbar — mit `forceRender` stünde die Notiz immer im
 * DOM und jede Zählung wäre trivial.
 *
 * Die Stellenwahl belegt „Ziel" sichtbar und änderbar mit dem Namen vor (Entscheidung
 * 24.09.2026); gespeichert wird, was dort steht. Der Server kopiert keinen Namen.
 */
export default function VerbleibErfassung({
  einsatzId,
  personId,
  onErfasst,
  onSchliessen,
}: VerbleibErfassungProps) {
  const [form] = Form.useForm<VerbleibFormWerte>();
  const art = Form.useWatch('art', form);
  const { benutzer } = useAuth();

  const overridesQuery = useQuery({
    queryKey: einsatzKeys.modulOverrides(einsatzId),
    queryFn: () => ladeModulOverrides(einsatzId),
  });
  const vorab = betreuungZugriffVon({
    rechteBekannt: overridesQuery.isFetched,
    modul: BETREUUNG_MODUL,
    benutzer,
    overrides: overridesQuery.data,
    abgelehnt: false,
  });
  const betreuungQuery = useQuery({
    queryKey: einsatzKeys.betreuung(einsatzId),
    queryFn: () => ladeBetreuung(einsatzId),
    enabled: vorab === 'frei',
  });
  const zugriff = betreuungZugriffVon({
    rechteBekannt: overridesQuery.isFetched,
    modul: BETREUUNG_MODUL,
    benutzer,
    overrides: overridesQuery.data,
    abgelehnt: betreuungQuery.error instanceof ApiError && betreuungQuery.error.status === 403,
  });
  const stellen = betreuungQuery.data?.stellen ?? [];
  const felder = sichtbareVerbleibFelder(art, zugriff === 'frei');

  // Die zuletzt gewählte Stelle — nur so erkennt die Vorbelegung, ob „Ziel" noch unverändert
  // ihren Namen trägt (dann darf ein Stellenwechsel es ersetzen) oder eigener Text ist.
  const gewaehlt = useRef<Betreuungsstelle | undefined>(undefined);

  const mutation = useMutation({
    mutationFn: (body: VerbleibEingabe) => erfasseVerbleib(einsatzId, personId, body),
    onSuccess: onErfasst,
  });

  return (
    <ErfassungsModal<VerbleibFormWerte>
      offen
      titel="Verbleib erfassen"
      form={form}
      laeuft={mutation.isPending}
      onErfassen={async (werte) => {
        // `art` ist Pflicht (Regel am Feld) — ohne sie läuft `onFinish` nicht.
        await mutation.mutateAsync(verbleibBody({ ...werte, art: werte.art! }));
      }}
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      <Form.Item label="Art" name="art" rules={[{ required: true, message: 'Art wählen' }]}>
        <Select options={VERBLEIB_ART_OPTIONEN} />
      </Form.Item>
      {felder.stelle && (
        <Form.Item label="Betreuungsstelle (optional)" name="betreuungsstelle_id">
          <Select
            allowClear
            placeholder={betreuungQuery.isPending ? 'Stellen werden geladen …' : 'Stelle wählen'}
            loading={betreuungQuery.isPending}
            options={stellenOptionen(stellen)}
            onChange={(id: number | undefined) => {
              const neu = stellen.find((s) => s.id === id);
              form.setFieldValue(
                'ziel',
                zielNachStellenwahl({
                  ziel: form.getFieldValue('ziel'),
                  vorher: gewaehlt.current,
                  neu,
                }),
              );
              gewaehlt.current = neu;
            }}
          />
        </Form.Item>
      )}
      <Form.Item label="Ziel" name="ziel">
        <Input placeholder={art === 'transport' ? 'z. B. Krankenhaus' : 'Freitext'} />
      </Form.Item>
      {felder.transportmittel && (
        <Form.Item label="Transportmittel (RTW/KTW …)" name="transportmittel">
          <Input />
        </Form.Item>
      )}
      <Collapse
        ghost
        items={[
          {
            key: 'weitere',
            label: 'Weitere Angaben',
            children: (
              <Form.Item label="Notiz" name="notiz" style={{ marginBottom: 0 }}>
                <Input.TextArea rows={2} />
              </Form.Item>
            ),
          },
        ]}
      />
      <SpeicherFehler fehler={mutation.error} titel="Verbleib nicht erfasst" />
    </ErfassungsModal>
  );
}
