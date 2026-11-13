import { Alert, Button, Flex, Form, Input, Radio, Typography, Upload, type UploadFile } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { spieleArchivEin, type ArchivEinspielenEingabe } from '../api/archivEinspielen';
import { AusgangUnbekannt, NetzFehler, fehlerText } from '../api/client';
import {
  ARCHIV_BLOCK_MAX_BYTES,
  ARCHIV_PASSPHRASE_MAX,
  ARCHIV_PRIVATSCHLUESSEL_MAX,
} from '../api/eingabegrenzen';
import { globalKeys } from '../api/queryKeys';
import type { ArchivEingespielt } from '../api/types';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { ErfassungsModal } from '../components/Erfassung';
import UploadFortschrittAnzeige from '../components/UploadFortschritt';
import { useUploadFortschritt } from '../components/useUploadFortschritt';
import { IconHochladen } from '../icons';
import { einsatzPfad } from '../routing/deeplinks';

/**
 * Archivblock in der Verwaltung einspielen (LLH-1711, Change
 * `yftpw99d-archiv-einspielen-verwaltung`, design.md D8). Ein Dialog mit Block, Schlüssel (Datei
 * oder eingefügt) und optionaler Passphrase; danach ein Ergebnisfeld über der Übersicht.
 *
 * Der Schlüssel bleibt nur im Formular und wird nach dem Einspielen und beim Schließen geleert
 * (`ErfassungsModal` setzt bei jedem Ausgang zurück). Eine Ablehnung (`mutateAsync`) lässt Block
 * und Schlüssel stehen; der Grund steht im Dialog.
 */

const ZU_GROSS =
  'Größer als 256 MiB: diesen Block spielt der Betrieb mit dem Befehl `archiv einspielen` ein';

interface Werte {
  block?: UploadFile[];
  schluesselArt: 'datei' | 'text';
  schluesselDatei?: UploadFile[];
  schluesselText?: string;
  passphrase?: string;
}

/**
 * Überschrift einer Ablehnung nach der Phase (LFH-654): ohne Antwort vor dem letzten Byte ist
 * nichts eingespielt, danach ist der Ausgang unklar (dann erst die Aufbewahrung bzw. die
 * Einsatzliste ansehen, bevor man es noch einmal versucht).
 */
function fehlerKopf(fehler: unknown): { titel: string; fallback?: string } {
  if (fehler instanceof AusgangUnbekannt)
    return { titel: 'Einspielen unklar', fallback: fehlerText(fehler) };
  if (fehler instanceof NetzFehler)
    return { titel: 'Nicht eingespielt', fallback: fehlerText(fehler) };
  return { titel: 'Nicht eingespielt' };
}

/** Der Server zählt Schlüssel und Passphrase in Bytes (UTF-8), nicht in Zeichen. */
const hoechstensBytes = (max: number, meldung: string) => ({
  validator: (_: unknown, wert?: string) =>
    new TextEncoder().encode(wert ?? '').length > max
      ? Promise.reject(new Error(meldung))
      : Promise.resolve(),
});

const dateiAusListe = (e: { fileList?: UploadFile[] } | UploadFile[]) =>
  (Array.isArray(e) ? e : e?.fileList)?.slice(-1);

function eingabe(w: Werte): ArchivEinspielenEingabe {
  const block = w.block?.[0]?.originFileObj as File;
  const schluessel: ArchivEinspielenEingabe['schluessel'] =
    w.schluesselArt === 'datei'
      ? { art: 'datei', datei: w.schluesselDatei?.[0]?.originFileObj as File }
      : { art: 'text', text: (w.schluesselText ?? '').trim() };
  return { block, schluessel, passphrase: w.passphrase };
}

interface DialogProps {
  offen: boolean;
  onSchliessen: () => void;
  onEingespielt: (ergebnis: ArchivEingespielt) => void;
}

export function ArchivEinspielenDialog({ offen, onSchliessen, onEingespielt }: DialogProps) {
  const qc = useQueryClient();
  const [form] = Form.useForm<Werte>();
  const fortschritt = useUploadFortschritt();
  const mutation = useMutation({
    // Die Variablen tragen den privaten Schlüssel: nach dem Lauf nicht im Cache behalten.
    gcTime: 0,
    mutationFn: (w: Werte) =>
      fortschritt.begleite((onFortschritt) => spieleArchivEin(eingabe(w), onFortschritt)),
    onSuccess: (ergebnis) => {
      void qc.invalidateQueries({ queryKey: globalKeys.einsaetze() });
      void qc.invalidateQueries({ queryKey: globalKeys.aufbewahrung() });
      onEingespielt(ergebnis);
    },
  });
  const art = Form.useWatch('schluesselArt', form) ?? 'datei';
  const kopf = fehlerKopf(mutation.error);

  function schliessen() {
    mutation.reset();
    onSchliessen();
  }

  return (
    <ErfassungsModal<Werte>
      offen={offen}
      titel="Archiv einspielen"
      form={form}
      initialValues={{ schluesselArt: 'datei' }}
      erfassenText="Einspielen"
      onErfassen={(w) => mutation.mutateAsync(w)}
      onFertig={schliessen}
      onAbbrechen={schliessen}
      laeuft={mutation.isPending}
      // Abbrechen bleibt gesperrt, bis die Antwort da ist: der Server spielt sonst weiter ein,
      // und eine Ablehnung hätte keinen Ort mehr (LFH-1077).
      speicherung={mutation}
      speicherFehlerTitel={kopf.titel}
      speicherFehlerFallback={kopf.fallback}
    >
      <UploadFortschrittAnzeige
        stand={mutation.isPending ? fortschritt.stand : null}
        pruefenText="Wird eingespielt"
      />
      <Typography.Paragraph type="secondary">
        Hält den Server kurz auf; nicht während eines laufenden Einsatzes.
      </Typography.Paragraph>
      <Form.Item
        name="block"
        label="Archivblock"
        valuePropName="fileList"
        getValueFromEvent={dateiAusListe}
        rules={[
          { required: true, message: 'Archivblock wählen' },
          {
            validator: (_, liste?: UploadFile[]) =>
              (liste?.[0]?.originFileObj?.size ?? 0) > ARCHIV_BLOCK_MAX_BYTES
                ? Promise.reject(new Error(ZU_GROSS))
                : Promise.resolve(),
          },
        ]}
      >
        <Upload beforeUpload={() => false} maxCount={1} accept=".age">
          <Button icon={<IconHochladen />} data-erfassung-fokus>
            Block wählen
          </Button>
        </Upload>
      </Form.Item>
      <Form.Item name="schluesselArt" label="Privater Archiv-Schlüssel">
        <Radio.Group optionType="button">
          <Radio value="datei">Datei</Radio>
          <Radio value="text">Eingefügt</Radio>
        </Radio.Group>
      </Form.Item>
      {art === 'datei' ? (
        <Form.Item
          name="schluesselDatei"
          label="Schlüsseldatei"
          valuePropName="fileList"
          getValueFromEvent={dateiAusListe}
          rules={[
            { required: true, message: 'Schlüsseldatei wählen' },
            {
              validator: (_, liste?: UploadFile[]) =>
                (liste?.[0]?.originFileObj?.size ?? 0) > ARCHIV_PRIVATSCHLUESSEL_MAX
                  ? Promise.reject(new Error('Das ist keine Schlüsseldatei: zu groß'))
                  : Promise.resolve(),
            },
          ]}
        >
          <Upload beforeUpload={() => false} maxCount={1}>
            <Button icon={<IconHochladen />}>Datei wählen</Button>
          </Upload>
        </Form.Item>
      ) : (
        <Form.Item
          name="schluesselText"
          label="Schlüssel"
          rules={[
            { required: true, whitespace: true, message: 'Schlüssel einfügen' },
            hoechstensBytes(ARCHIV_PRIVATSCHLUESSEL_MAX, 'Das ist kein Archiv-Schlüssel: zu lang'),
          ]}
        >
          <Input.Password
            placeholder="AGE-SECRET-KEY-1…"
            autoComplete="off"
            spellCheck={false}
            maxLength={ARCHIV_PRIVATSCHLUESSEL_MAX}
          />
        </Form.Item>
      )}
      <Form.Item
        name="passphrase"
        label="Passphrase der Schlüsseldatei"
        extra="Nur bei Schutz"
        rules={[hoechstensBytes(ARCHIV_PASSPHRASE_MAX, 'Passphrase zu lang')]}
      >
        <Input.Password autoComplete="off" maxLength={ARCHIV_PASSPHRASE_MAX} />
      </Form.Item>
    </ErfassungsModal>
  );
}

interface ErgebnisProps {
  ergebnis: ArchivEingespielt;
  onSchliessen: () => void;
}

/** Was eingespielt wurde, über der Übersicht, bis man es schließt oder hineingeht. */
export function ArchivEingespieltErgebnis({ ergebnis, onSchliessen }: ErgebnisProps) {
  const navigate = useNavigate();
  const frist = ergebnis.frist_endet_at;
  // Den Satz mit der UTC-Zeit des Befehls ersetzt hier die Anzeigezeit.
  const hinweise = ergebnis.hinweise.filter((h) => !(frist && h.includes(frist)));
  return (
    <section aria-label="Eingespielt">
      <Alert
        type="success"
        showIcon
        closable
        onClose={onSchliessen}
        title={`Eingespielt: ${ergebnis.einsatznummer ?? 'ohne Nr.'} · ${ergebnis.bezeichnung}`}
        description={
          <Flex vertical gap="small">
            <Typography.Text>
              Schreibgeschützt bis <ZeitAnzeige wert={ergebnis.loeschen_at} />
              {frist ? ' (Frist des Blocks)' : ''} · {ergebnis.inhalte} Inhalte
            </Typography.Text>
            {hinweise.map((h) => (
              <Typography.Text key={h}>{h}</Typography.Text>
            ))}
            <div>
              <Button onClick={() => navigate(einsatzPfad(ergebnis.einsatz_id))}>
                Einsatz öffnen
              </Button>
            </div>
          </Flex>
        }
      />
    </section>
  );
}
