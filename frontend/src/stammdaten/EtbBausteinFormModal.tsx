import { App, Collapse, Form, Input, InputNumber, Typography } from 'antd';
import { Select } from '../components/Select';
import { useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { ErfassungsModal } from '../components/Erfassung';
import { aktualisiereBaustein, legeBausteinAn, type BausteinEingabe } from '../api/etbBaustein';
import type { EtbBaustein, EtbTyp, MeldeWeg } from '../api/types';
import { ERFASSBARE_TYPEN } from '../etb/typFarben';
import { etbTyp } from '../theme/statusFarben';
import { AUTO_PLATZHALTER } from '../etb/bausteinEinsetzen';
import { MELDEWEG_OPTIONEN } from '../etb/schnellerfassungModell';
import { globalKeys } from '../api/queryKeys';
import { leerZuNull } from '../api/patchTriState';

interface FormWerte {
  label: string;
  typ: EtbTyp;
  inhalt: string;
  meldeweg?: MeldeWeg;
  veranlassung?: string;
  sortier: number;
}

export default function EtbBausteinFormModal({
  offen,
  baustein,
  onClose,
}: {
  offen: boolean;
  baustein: EtbBaustein | null;
  onClose: () => void;
}) {
  const [form] = Form.useForm<FormWerte>();
  const qc = useQueryClient();
  const { message } = App.useApp();

  // VORBELEGUNG, kein Zurücksetzen — Begründung in `FahrzeugFormModal`. Die Vorgabewerte stehen
  // als `initialValues` an der Hülle.
  useEffect(() => {
    if (!offen || !baustein) return;
    form.setFieldsValue({
      label: baustein.label,
      typ: baustein.typ,
      inhalt: baustein.inhalt,
      meldeweg: baustein.meldeweg ?? undefined,
      veranlassung: baustein.veranlassung ?? undefined,
      sortier: baustein.sortier,
    });
  }, [offen, baustein, form]);

  const mutation = useMutation({
    mutationFn: (werte: FormWerte) => {
      const daten: BausteinEingabe = {
        label: werte.label.trim(),
        typ: werte.typ,
        inhalt: werte.inhalt.trim(),
        meldeweg: werte.meldeweg ?? null,
        veranlassung: leerZuNull(werte.veranlassung),
        sortier: werte.sortier ?? 0,
      };
      return baustein ? aktualisiereBaustein(baustein.id, daten) : legeBausteinAn(daten);
    },
    // Kein `onClose()`: das Schließen macht `onFertig`, das Leeren die Hülle.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: globalKeys.etbBausteine() });
    },
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Speichern fehlgeschlagen'),
  });

  return (
    <ErfassungsModal<FormWerte>
      offen={offen}
      titel={baustein ? 'Baustein bearbeiten' : 'Baustein anlegen'}
      form={form}
      erfassenText="Speichern"
      laeuft={mutation.isPending}
      initialValues={{ typ: 'meldung', sortier: 0 }}
      // `mutateAsync`: bei Ablehnung muss die Zusage brechen.
      //
      // Der Formularspeicher statt der `onFinish`-Werte: ohne `forceRender` sind Meldeweg,
      // Veranlassung und Sortierung nicht montiert, und `onFinish` liefert nur montierte Felder.
      // `BausteinEingabe` ist Vollersatz — ein bearbeiteter Baustein verlöre Meldeweg und
      // Reihenfolge bei jedem Speichern ohne Aufklappen. Ein Rückfall auf `baustein?.meldeweg` wäre
      // die falsche Reparatur: er kann „nie montiert" nicht von „bewusst geleert" unterscheiden, und
      // der Meldeweg-Select trägt `allowClear`.
      //
      // `getFieldsValue(true)` ist bei antd `any`-typisiert — die Feldnamen prüft der Parametertyp
      // von `mutationFn`.
      onErfassen={() => mutation.mutateAsync(form.getFieldsValue(true))}
      onFertig={onClose}
      onAbbrechen={onClose}
    >
      <Form.Item label="Label" name="label" rules={[{ required: true, whitespace: true }]}>
        <Input placeholder="z. B. Lage unverändert" />
      </Form.Item>
      <Form.Item label="Typ" name="typ" rules={[{ required: true }]}>
        <Select options={ERFASSBARE_TYPEN.map((t) => ({ value: t, label: etbTyp[t].label }))} />
      </Form.Item>
      <Form.Item
        label="Inhalt (Platzhalter wie {einheit} erlaubt)"
        name="inhalt"
        rules={[{ required: true, whitespace: true }]}
        extra={
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Vorkonfigurierte Platzhalter werden beim Einsetzen automatisch befüllt:{' '}
            {AUTO_PLATZHALTER.map((p) => (
              <span key={p.name}>
                <code>{`{${p.name}}`}</code> ({p.beschreibung}){' '}
              </span>
            ))}
            . Beliebige weitere Platzhalter wie <code>{'{einheit}'}</code> werden beim Einsetzen
            abgefragt. Gilt auch für die Veranlassung.
          </Typography.Text>
        }
      >
        <Input.TextArea rows={2} placeholder="Vorlagentext mit {platzhalter}" />
      </Form.Item>
      {/* FELDBUDGET: drei sichtbare Felder, drei eingeklappt. Label, Typ und Inhalt sind die
         Pflichtwerte und bleiben oben; Meldeweg und Veranlassung sind optional, die Sortierung hat
         mit 0 einen brauchbaren Vorgabewert (LFH-343).

         Bewusst OHNE `forceRender` (wie `AuftragFormular`) — sonst wäre „im Ausgangszustand drei
         Felder" nicht prüfbar. Gegenmittel am `onErfassen` oben. */}
      <Collapse
        ghost
        style={{ marginInline: -8 }}
        items={[
          {
            key: 'weitere',
            label: 'Weitere Angaben',
            children: (
              <>
                <Form.Item label="Meldeweg (optional)" name="meldeweg">
                  <Select allowClear options={MELDEWEG_OPTIONEN} />
                </Form.Item>
                <Form.Item label="Veranlassung (optional)" name="veranlassung">
                  <Input />
                </Form.Item>
                <Form.Item label="Sortierung" name="sortier">
                  <InputNumber min={0} style={{ width: '100%', maxWidth: 120 }} />
                </Form.Item>
              </>
            ),
          },
        ]}
      />
    </ErfassungsModal>
  );
}
