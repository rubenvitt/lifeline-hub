import { Button, Collapse, DatePicker, Form, Input, Space } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs, { type Dayjs } from 'dayjs';
import { useState } from 'react';
import { einsatzKeys } from '../api/queryKeys';
import { schliesseLagebesprechungAb } from '../api/stab';
import type { Lagebesprechung, LagebesprechungAbschlussBody, Stab } from '../api/types';
import { ErfassungsModal } from '../components/Erfassung';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import { schnellwahlAuswahl, schnellwahlTermin } from '../components/terminSchnellwahl';
import {
  abschlussBody,
  abschlussVorbelegung,
  eigeneLagebesprechung,
  naechsteNachBesprechung,
  terminBezug,
  type AbschlussFormWerte,
} from './lagebesprechungAbschluss';

/** Teilmenge der geteilten Schnellwahl (Spec 10: +30/+60/+120; die Zahlen sind `[abgeleitet]`). */
const SCHNELLWAHL = schnellwahlAuswahl([30, 60, 120]);
const ZEITFORMAT = 'YYYY-MM-DD HH:mm';
const NAECHSTE_ZU_FRUEH =
  'Die nächste Lagebesprechung muss nach dem Zeitpunkt der Besprechung liegen';

interface LagebesprechungModalProps {
  einsatzId: number;
  /** Stand beim Öffnen — die Seite montiert die Maske erst, wenn er da ist. */
  stab: Stab;
  /** Nach erfolgreichem POST, vor dem Schließen. `undefined` = Antwort trug eine fremde Zeile. */
  onAbgeschlossen: (eigene: Lagebesprechung | undefined) => void;
  onSchliessen: () => void;
}

/**
 * „Lagebesprechung abschließen" (LFH-543, Spec 10) auf `ErfassungsModal`.
 *
 * Zwei sichtbare Felder — Entschluss (Pflicht) und nächster Termin mit Schnellwahl —, der
 * Zeitpunkt der Besprechung unter „Weitere Angaben". `forceRender` am Collapse ist TRAGEND:
 * nur so kommt der Zeitpunkt auch zugeklappt in `onFinish` an, und nur mit ihm lässt sich die
 * POST-Antwort der eigenen Anfrage zuordnen (`eigeneLagebesprechung`).
 *
 * Montiert = offen (die Seite rendert `{offen && …}`). Deshalb friert `useState` Vorbelegung und
 * Vergleichsbasis beim ÖFFNEN ein, obwohl `stab` live invalidiert wird (LFH-303), und jede
 * Öffnung hat eine frische Mutation ohne alten Fehler — ein `reset()` wie im `FreigabeDialog`
 * (der montiert bleibt) ist hier nicht nötig.
 *
 * Fehler des POST stehen IM Modal (LFH-535): die Mutation hat kein `onError`, `mutateAsync`
 * lehnt ab, die Hülle lässt die Felder stehen. Erfolg quittiert der Aufrufer per Toast.
 */
export default function LagebesprechungModal({
  einsatzId,
  stab,
  onAbgeschlossen,
  onSchliessen,
}: LagebesprechungModalProps) {
  const qc = useQueryClient();
  const [vorbelegung] = useState(() =>
    abschlussVorbelegung(stab.naechste_lagebesprechung_at, dayjs()),
  );
  const [form] = Form.useForm<AbschlussFormWerte>();

  const mutation = useMutation({
    mutationFn: (body: LagebesprechungAbschlussBody) => schliesseLagebesprechungAb(einsatzId, body),
    onSuccess: (antwort, body) => {
      // Der Prefix trifft auch die Historie (Sub-Key). `einsatz` ist Hygiene: die
      // Einsatzdaten-Seite zeigt denselben Termin und steht im NICHT_LIVE-Fach (Spec Entsch. 11).
      void qc.invalidateQueries({ queryKey: einsatzKeys.stab(einsatzId) });
      void qc.invalidateQueries({ queryKey: einsatzKeys.einsatz(einsatzId) });
      onAbgeschlossen(eigeneLagebesprechung(antwort, body));
    },
  });

  return (
    <ErfassungsModal<AbschlussFormWerte>
      offen
      titel="Lagebesprechung abschließen"
      form={form}
      initialValues={{ naechste: vorbelegung.naechste, abgehalten: vorbelegung.abgehalten }}
      erfassenText="Abschließen"
      laeuft={mutation.isPending}
      onErfassen={async (werte) => {
        // `stab` ist hier die LIVE-Prop, nicht die eingefrorene Vorbelegung: nur so erkennt
        // `abschlussBody` einen inzwischen fremd gesetzten oder gelöschten Termin (Ruling 10).
        await mutation.mutateAsync(
          abschlussBody(werte, vorbelegung, dayjs(), stab.naechste_lagebesprechung_at),
        );
      }}
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      <Form.Item
        label="Entschluss"
        name="entschluss"
        rules={[{ required: true, whitespace: true, message: 'Entschluss angeben' }]}
      >
        <Input.TextArea rows={3} placeholder="z. B. Lage unverändert, Maßnahmen fortführen" />
      </Form.Item>
      <Form.Item
        label="Nächste Lagebesprechung"
        name="naechste"
        // Clientseitiger Spiegel des 422; hängt am Zeitpunkt, deshalb `dependencies` — ein
        // nachträglich verschobener Zeitpunkt prüft den Termin neu. Ein leeres Feld ist zulässig.
        dependencies={['abgehalten']}
        rules={[
          ({ getFieldValue }) => ({
            validator: (_, wert: Dayjs | null | undefined) =>
              naechsteNachBesprechung(wert, getFieldValue('abgehalten'), dayjs())
                ? Promise.resolve()
                : Promise.reject(new Error(NAECHSTE_ZU_FRUEH)),
          }),
        ]}
        // Die Schnellwahl ist eine Vorbelegung DESSELBEN Wertes, kein eigenes Feld — sie steht
        // im selben `Form.Item`, das Budget bleibt bei zwei. Echte `Button` ohne `size`: sie
        // erben `controlHeight` aus der Dichte-Staffel.
        extra={
          <Space wrap>
            {SCHNELLWAHL.map((s) => (
              <Button
                key={s.label}
                onClick={() =>
                  form.setFieldValue(
                    'naechste',
                    // Ab dem SPÄTEREN von Zeitpunkt der Besprechung und jetzt (Ruling 12): ein
                    // Zeitpunkt in der Zukunft verhindert das 422 (`naechste ≤ abgehalten`), ein
                    // zurückliegender — nachträglich erfasst oder beim Öffnen eingefroren — lässt
                    // „+1 h" nicht in der Vergangenheit landen.
                    schnellwahlTermin(
                      terminBezug(form.getFieldValue('abgehalten'), dayjs()),
                      s.minuten,
                    ),
                  )
                }
              >
                {s.label}
              </Button>
            ))}
            <Button onClick={() => form.setFieldValue('naechste', null)}>kein Termin</Button>
          </Space>
        }
      >
        <DatePicker
          showTime
          format={ZEITFORMAT}
          placeholder="kein Termin"
          style={{ width: '100%' }}
        />
      </Form.Item>
      <Collapse
        ghost
        items={[
          {
            key: 'weitere',
            label: 'Weitere Angaben',
            forceRender: true,
            children: (
              <Form.Item
                label="Zeitpunkt der Besprechung"
                name="abgehalten"
                extra="Leer: Zeitpunkt des Abschließens"
                style={{ marginBottom: 0 }}
              >
                <DatePicker showTime format={ZEITFORMAT} style={{ width: '100%' }} />
              </Form.Item>
            ),
          },
        ]}
      />
      <SpeicherFehler fehler={mutation.error} titel="Abschluss fehlgeschlagen" />
    </ErfassungsModal>
  );
}
