import { App, Button, Form, Input, Space, Typography } from 'antd';
import { useEffect, useReducer } from 'react';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ZeitpunktEingabe } from '../anzeige/ZeitpunktEingabe';
import { alsBackendZeit, alsZeitpunkt } from '../anzeige/zeitEingabe';
import { legeErinnerungAn } from '../api/erinnerungen';
import { fehlerText } from '../api/client';
import { einsatzKeys } from '../api/queryKeys';
import { ErfassungsModal } from '../components/Erfassung';
import { SCHNELLWAHL_TERMIN, schnellwahlTermin } from '../components/terminSchnellwahl';
import { abstand } from '../theme/tokens';
import type { EtbEintragAnzeige } from '../api/types';

const { TextArea } = Input;
dayjs.extend(utc);

/** Kürzt den ETB-Eintragstext zu einem brauchbaren Erinnerungs-Titel. */
function titelAusEintrag(inhalt: string): string {
  const eineZeile = inhalt.replace(/\s+/g, ' ').trim();
  const kurz = eineZeile.length > 80 ? `${eineZeile.slice(0, 77)}…` : eineZeile;
  return `Wiedervorlage: ${kurz}`;
}

interface FormWerte {
  titel: string;
  faellig: dayjs.Dayjs;
  beschreibung?: string;
}

/**
 * Vorgabe der Fälligkeit: `dayjs()` meint niemand, eine Wiedervorlage auf „jetzt" ist beim
 * Anlegen schon fällig. Die Schnellwahl darüber deckt den Rest des üblichen Bandes ab.
 */
const VORGABE_MINUTEN = 30;

/**
 * Schnellwahl der Fälligkeit. Echte antd-`Button` ohne `size`: so erben sie `controlHeight`
 * aus der Dichte-Staffel, ein gestyltes `<span onClick>` schuldete die zwei Angaben aus LFH-365.
 *
 * Unten steht zusätzlich der Einsatztermin, sofern er bekannt und zukünftig ist (LFH-463) —
 * ein absoluter Zeitpunkt neben den vier relativen Vorbelegungen.
 */
// Die Tabelle ist geteilt (`components/terminSchnellwahl.ts`); die Wiedervorlage nimmt alle
// vier Einträge und rechnet ab jetzt.
const SCHNELLWAHL = SCHNELLWAHL_TERMIN;

/**
 * Legt aus einem ETB-Eintrag eine terminierte Erinnerung/Wiedervorlage an (LFH-106).
 * Hält den Bezug auf den Quell-Eintrag fest (bezug_typ='etb'/bezug_id); die
 * Erinnerungsliste verweist darüber zurück. Läuft über `components/Erfassung.tsx`
 * (Erfassungs-Norm).
 */
export default function WiedervorlageModal({
  einsatzId,
  eintrag,
  onClose,
  naechsteLagebesprechungAt,
}: {
  einsatzId: number;
  eintrag: EtbEintragAnzeige | null;
  onClose: () => void;
  naechsteLagebesprechungAt?: string | null;
}) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [form] = Form.useForm<FormWerte>();
  const [zeitPruefung, pruefeZeit] = useReducer((wert: number) => wert + 1, 0);
  // Der Wirestring ist UTC ohne Offset. Lokal parsen würde den Instant verschieben. Der
  // Formularwert ist ein Zeitpunkt; in die Anzeigezone wandelt erst das Feld (LFH-692).
  const lagebesprechung = alsZeitpunkt(naechsteLagebesprechungAt) ?? null;
  const terminBekannt = lagebesprechung?.isAfter(dayjs()) ?? false;
  const offen = eintrag !== null;

  useEffect(() => {
    if (!offen || !naechsteLagebesprechungAt) return;
    const rest = dayjs.utc(naechsteLagebesprechungAt).valueOf() - Date.now();
    if (!(rest > 0)) return;
    // Auch ein lange geöffneter Dialog verliert den Chip am Termin. Sehr ferne
    // Termine brauchen mehrere Timer, weil Browser maximal 2^31-1 ms zulassen.
    const timer = window.setTimeout(pruefeZeit, Math.min(rest, 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [offen, naechsteLagebesprechungAt, zeitPruefung]);

  const mutation = useMutation({
    mutationFn: (werte: FormWerte) =>
      legeErinnerungAn(einsatzId, {
        titel: werte.titel.trim(),
        faellig_at: alsBackendZeit(werte.faellig),
        beschreibung: werte.beschreibung?.trim() || undefined,
        bezug_typ: 'etb',
        bezug_id: eintrag!.id,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: einsatzKeys.erinnerungen(einsatzId) });
      message.success('Wiedervorlage angelegt');
    },
    onError: (e) => message.error(fehlerText(e, 'Anlegen fehlgeschlagen')),
  });

  return (
    <ErfassungsModal<FormWerte>
      offen={eintrag !== null}
      titel="Wiedervorlage anlegen"
      form={form}
      erfassenText="Anlegen"
      laeuft={mutation.isPending}
      // `mutateAsync`, nicht `mutate`: bei Ablehnung muss die Zusage brechen, sonst räumt die Hülle
      // die Felder trotz Fehler-Toast.
      onErfassen={(werte) => mutation.mutateAsync(werte)}
      onFertig={onClose}
      onAbbrechen={onClose}
      initialValues={
        eintrag
          ? {
              titel: titelAusEintrag(eintrag.inhalt),
              faellig: dayjs().add(VORGABE_MINUTEN, 'minute'),
            }
          : undefined
      }
    >
      <Form.Item
        label="Titel"
        name="titel"
        rules={[{ required: true, message: 'Titel ist erforderlich' }]}
      >
        <Input />
      </Form.Item>
      <Form.Item label="Fällig am" required style={{ marginBottom: abstand.md }}>
        {/*
          Die Schnellwahl steht ÜBER dem Feld, in demselben `Form.Item`: sie ist eine
          Vorbelegung desselben Wertes, kein eigenes Feld — das Budget bleibt bei drei
          (LFH-19). Das Zeitfeld darunter trägt weiter den freien Fall.
        */}
        <Space wrap style={{ marginBottom: abstand.sm }}>
          <Typography.Text type="secondary">Schnellwahl</Typography.Text>
          {SCHNELLWAHL.map((s) => (
            <Button
              key={s.label}
              onClick={() => form.setFieldValue('faellig', schnellwahlTermin(dayjs(), s.minuten))}
            >
              {s.label}
            </Button>
          ))}
          {terminBekannt && (
            <Button
              onClick={() => {
                // Ein Systemzeitsprung kann dem Timer zuvorkommen.
                if (!lagebesprechung?.isAfter(dayjs())) {
                  pruefeZeit();
                  return;
                }
                form.setFieldValue('faellig', lagebesprechung);
              }}
            >
              Nächste Lagebesprechung
            </Button>
          )}
        </Space>
        <Form.Item
          name="faellig"
          noStyle
          rules={[{ required: true, message: 'Fälligkeit ist erforderlich' }]}
        >
          <ZeitpunktEingabe style={{ width: '100%' }} format="YYYY-MM-DD HH:mm" />
        </Form.Item>
      </Form.Item>
      <Form.Item label="Beschreibung (optional)" name="beschreibung">
        <TextArea rows={2} />
      </Form.Item>
    </ErfassungsModal>
  );
}
