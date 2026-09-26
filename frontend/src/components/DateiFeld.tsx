import { Button, Form, Upload, type UploadFile } from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import { UPLOAD_MAX_GROESSE } from '../api/upload';

/** Wortgleich mit der Server-Absage (`src/anhang/mod.rs`, `pruefe_groesse`): eine Absage, ein
 *  Wortlaut — gleich, ob der Dialog sie vorab gibt oder der Server. */
const ZU_GROSS = `Datei ist zu groß (${UPLOAD_MAX_GROESSE / 1024 / 1024} MiB erlaubt)`;

interface Props {
  /** Dateiauswahl vorfiltern (`DOKUMENT_ACCEPT`, `ERFASSUNG_ACCEPT`); der Server prüft ohnehin. */
  accept: string;
  /** Formularfeld, Vorgabe `datei`. */
  name?: string;
  /** Meldet eine neue Dateiwahl — nicht das Entfernen (Titel-Übernahme der Ablage). */
  onDateiWahl?: (datei: UploadFile) => void;
}

/**
 * Dateifeld einer Erfassungsmaske (LFH-21; vorher im `DokumentAblegenModal`, „dieselbe Eingabe
 * wird nicht zweimal gebaut“, M20). Eine Datei, keine Übertragung beim Wählen
 * (`beforeUpload={() => false}`: gesendet wird mit dem Formular), Pflicht, und die Größe wird
 * VORAB geprüft, damit niemand 25 MiB über Mobilfunk schickt, nur um die Absage zu lesen.
 *
 * Fokus: der Knopf trägt `data-erfassung-fokus` — die Erfassungshülle nimmt ihn beim Öffnen
 * UND nach jedem Serien-Speichern statt des ersten `<input>`, das hier rc-uploads
 * `<input type="file">` mit `display: none` wäre (im Browser nicht fokussierbar, jsdom merkt
 * das nicht). Vorher trug ein Mount-Callback-Ref den Fokus; nach „Speichern und nächste“ hing
 * er nur daran, dass der Knopf zufällig neu einhängt (Code-Review C2, e2e-Beleg in
 * `e2e/schaden-anhaenge.spec.ts`).
 */
export default function DateiFeld({ accept, name = 'datei', onDateiWahl }: Props) {
  return (
    <Form.Item
      name={name}
      label="Datei"
      valuePropName="fileList"
      getValueFromEvent={(e: { fileList?: UploadFile[] } | UploadFile[]) =>
        Array.isArray(e) ? e : e?.fileList
      }
      rules={[
        { required: true, message: 'Bitte eine Datei wählen' },
        {
          // Vorab statt nach 25 MiB Upload: der Server lehnt dieselbe Grenze mit `>` ab.
          validator: (_, liste?: UploadFile[]) => {
            const groesse = liste?.[0]?.originFileObj?.size ?? liste?.[0]?.size ?? 0;
            return groesse > UPLOAD_MAX_GROESSE
              ? Promise.reject(new Error(ZU_GROSS))
              : Promise.resolve();
          },
        },
      ]}
    >
      <Upload
        beforeUpload={() => false}
        maxCount={1}
        accept={accept}
        onChange={({ file }) => {
          // Das Entfernen einer Datei ist keine Dateiwahl.
          if (file.status === 'removed') return;
          onDateiWahl?.(file);
        }}
      >
        <Button
          data-erfassung-fokus=""
          icon={
            // `aria-hidden`-Hülle: der Icon-Knoten brächte `role="img"` mit englischem Namen
            // („upload“) in den zugänglichen Namen des Knopfs.
            <span aria-hidden="true">
              <UploadOutlined />
            </span>
          }
        >
          Datei wählen
        </Button>
      </Upload>
    </Form.Item>
  );
}
