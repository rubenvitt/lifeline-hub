import { Collapse, Form, Input, type FormInstance } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useRef } from 'react';
import { ladeModulFreigaben } from '../api/einsaetze';
import { ladeBetreuung } from '../api/betreuung';
import { ApiError } from '../api/client';
import { useAuthOptional } from '../auth/AuthContext';
import type { VerbleibEingabe } from '../api/einsatzPerson';
import { einsatzKeys } from '../api/queryKeys';
import type { Betreuungsstelle, VerbleibArt } from '../api/types';
import { ErfassungsModal } from '../components/Erfassung';
import { Select } from '../components/Select';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import { modulRegistry } from '../einsatz/modulRegistry';
import BestaetigtVonFeld from '../geraet/BestaetigtVonFeld';
import { betreuungZugriffVon } from '../pages/lagekarte/betreuungEbene';
import {
  VERBLEIB_ART_OPTIONEN,
  sichtbareVerbleibFelder,
  stellenOptionen,
  verbleibBody,
  zielNachArtwechsel,
  zielNachStellenwahl,
  type VerbleibFormWerte,
} from './verbleibErfassungKern';
import { useSavePersonEintrag, type PersonZiel } from './personEintragSpeichern';
import RettungsmittelFeld from './RettungsmittelFeld';

/** Registry-Eintrag des Moduls „Betreuung" — Grenze der Stellen-Auswahl. */
const BETREUUNG_MODUL = modulRegistry.find((m) => m.key === 'betreuung');

interface VerbleibErfassungProps {
  einsatzId: number;
  person: PersonZiel;
  /** Nach erfolgreichem POST (Invalidierung der Person); der Dialog schließt danach selbst. */
  onErfasst: () => void;
  /** Ohne Netz vorgemerkt (LLH-1138): kein Serverstand; die Zeile quittiert. */
  onVorgemerkt?: () => void;
  onSchliessen: () => void;
  /** Titel; Vorgabe „Verbleib erfassen“ (der Grundriss nennt die Person). */
  titel?: string;
  /** Startwerte, etwa die Art Transport beim Abwurf auf „Unterwegs“ im Grundriss. */
  vorbelegung?: Partial<VerbleibFormWerte>;
}

/**
 * Felder und Body-Bau einer Verbleib-Erfassung, ohne Hülle: für den Dialog unten und das Paneel
 * im Patientenkopf (LLH-1094). Der Aufrufer hält das `<Form>`; `body` baut aus den Werten den
 * Request (die Stellen-Frage kennt nur dieser Hook).
 */
export function useVerbleibFelder(
  einsatzId: number,
  form: FormInstance<VerbleibFormWerte>,
  /**
   * Die Art steht schon fest (Grundriss): ihre Felder stehen ab dem ersten Bild, und die Eingabe
   * beginnt am Rettungsmittel. `useWatch` liefert die Startwerte erst einen Takt später; ohne
   * diesen Rückfall fokussierte die Hülle beim Öffnen die Art.
   */
  vorbelegteArt?: VerbleibArt,
) {
  const art = Form.useWatch('art', form) ?? vorbelegteArt;
  const artVorbelegt = vorbelegteArt != null;
  // Das Gerät einer Betreuungsstelle bringt nur in die eigene Stelle (LFH-1041); ohne Stelle
  // lehnt der Server die Notunterkunft ab.
  const stellePflicht = useAuthOptional()?.geraet?.ansicht === 'betreuungsstelle';

  // Freigaben des Servers (LFH-669): solange sie fehlen, gilt die Betreuung als nicht frei.
  const freigabenQuery = useQuery({
    queryKey: einsatzKeys.modulFreigaben(einsatzId),
    queryFn: () => ladeModulFreigaben(einsatzId),
  });
  const vorab = betreuungZugriffVon({
    modul: BETREUUNG_MODUL,
    freigaben: freigabenQuery.data,
    abgelehnt: false,
  });
  const betreuungQuery = useQuery({
    queryKey: einsatzKeys.betreuung(einsatzId),
    queryFn: () => ladeBetreuung(einsatzId),
    enabled: vorab === 'frei',
  });
  const zugriff = betreuungZugriffVon({
    modul: BETREUUNG_MODUL,
    freigaben: freigabenQuery.data,
    abgelehnt: betreuungQuery.error instanceof ApiError && betreuungQuery.error.status === 403,
  });
  const stellen = betreuungQuery.data?.stellen ?? [];
  const felder = sichtbareVerbleibFelder(art, zugriff === 'frei');

  // Die zuletzt gewählte Stelle — nur so erkennt die Vorbelegung, ob „Ziel" noch ihren Namen
  // trägt oder eigener Text ist.
  const gewaehlt = useRef<Betreuungsstelle | undefined>(undefined);

  // `art` ist Pflicht (Regel am Feld) — ohne sie läuft `onFinish` nicht.
  const body = (werte: VerbleibFormWerte): VerbleibEingabe =>
    verbleibBody({ ...werte, art: werte.art! }, felder.stelle);

  const elemente = (
    <>
      <Form.Item label="Art" name="art" rules={[{ required: true, message: 'Art wählen' }]}>
        <Select
          options={VERBLEIB_ART_OPTIONEN}
          onChange={(neueArt: VerbleibFormWerte['art']) => {
            const ziel = zielNachArtwechsel({
              art: neueArt,
              ziel: form.getFieldValue('ziel'),
              gewaehlt: gewaehlt.current,
            });
            if (neueArt !== 'notunterkunft' && gewaehlt.current) {
              form.setFieldsValue({ ziel, betreuungsstelle_id: undefined });
              gewaehlt.current = undefined;
            }
          }}
        />
      </Form.Item>
      {felder.stelle && (
        <Form.Item
          label={stellePflicht ? 'Betreuungsstelle' : 'Betreuungsstelle (optional)'}
          name="betreuungsstelle_id"
          rules={stellePflicht ? [{ required: true, message: 'Stelle wählen' }] : undefined}
          // Nur ein 403 heißt „keine Auswahl" (dann fehlt das Feld). Jeder andere Fehler ist ein Ausfall
          // der Quelle und sagt sich.
          extra={
            betreuungQuery.isError
              ? 'Stellen konnten nicht geladen werden — Ziel als Freitext eintragen.'
              : undefined
          }
        >
          <Select
            allowClear={!stellePflicht}
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
      {/* Wer fährt (LLH-1332): Wahl aus „Im Einsatz“ heißt Eigentransport, sonst fremd. */}
      {felder.transportmittel && (
        <RettungsmittelFeld einsatzId={einsatzId} form={form} fokus={artVorbelegt} />
      )}
      <Collapse
        ghost
        items={[
          {
            key: 'weitere',
            label: 'Weitere Angaben',
            children: (
              <>
                {/* Am UHS-Gerät (LFH-1046); hier, weil Art, Ziel und Transportmittel das Budget
                    schon füllen. */}
                <BestaetigtVonFeld einsatzId={einsatzId} />
                <Form.Item label="Notiz" name="notiz" style={{ marginBottom: 0 }}>
                  <Input.TextArea rows={2} />
                </Form.Item>
              </>
            ),
          },
        ]}
      />
    </>
  );
  return { elemente, body };
}

/**
 * „Verbleib erfassen" auf `ErfassungsModal`.
 *
 * Montiert = offen, jede Öffnung hat eine frische Mutation. Fehler stehen IM Dialog; die
 * Mutation hat kein `onError`, `mutateAsync` lehnt ab, die Hülle lässt die Felder stehen.
 *
 * Felder je Art halten das Budget (≤ 3): Transportmittel nur beim Transport, die
 * Betreuungsstelle nur bei der Notunterkunft UND mit Lesezugriff auf das Modul Betreuung — die
 * Grenze sitzt an der Datenquelle (ohne Zugriff kein Abruf, ein 403 heißt „keine Auswahl").
 * Die Notiz liegt unter „Weitere Angaben", OHNE `forceRender` (sie hat keine Vorbelegung, und
 * nur so bleibt „≤ 3 sichtbar" widerlegbar); am UHS-Gerät dort auch „Bestätigt von“ (LFH-1046).
 *
 * Die Stellenwahl belegt „Ziel" sichtbar und änderbar mit dem Namen vor; gespeichert wird, was
 * dort steht.
 */
export default function VerbleibErfassung({
  einsatzId,
  person,
  onErfasst,
  onVorgemerkt,
  onSchliessen,
  titel = 'Verbleib erfassen',
  vorbelegung,
}: VerbleibErfassungProps) {
  const [form] = Form.useForm<VerbleibFormWerte>();
  const { elemente, body } = useVerbleibFelder(einsatzId, form, vorbelegung?.art);
  const save = useSavePersonEintrag();
  const mutation = useMutation({
    // Merkt ohne Netz vor (LLH-1138, design.md D8; `frontend/src/offline/AGENTS.md`).
    networkMode: 'always',
    mutationFn: (eingabe: VerbleibEingabe) => save(einsatzId, person, 'verbleib', eingabe),
    onSuccess: (ergebnis) => (ergebnis.zustand === 'gesendet' ? onErfasst() : onVorgemerkt?.()),
  });

  return (
    <ErfassungsModal<VerbleibFormWerte>
      offen
      titel={titel}
      form={form}
      initialValues={vorbelegung}
      laeuft={mutation.isPending}
      onErfassen={(werte) => mutation.mutateAsync(body(werte))}
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      {elemente}
      <SpeicherFehler fehler={mutation.error} titel="Verbleib nicht erfasst" />
    </ErfassungsModal>
  );
}
