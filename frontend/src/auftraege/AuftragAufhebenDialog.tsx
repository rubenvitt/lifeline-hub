import { Form, Input, Typography } from 'antd';
import { AUFTRAG_AUFHEBUNGSGRUND_MAX } from '../api/eingabegrenzen';
import { ErfassungsModal, type Speicherung } from '../components/Erfassung';
import { zeichenGrenze, zeichenRegel } from '../components/zeichenGrenze';
import { AUFTRAG_HANDLUNG } from '../kommunikation';

interface AufhebenWerte {
  grund: string;
}

/**
 * Rückfrage „Auftrag aufheben“ (LLH-1098, Spec `auftrag-aufheben-berichtigen`): unumkehrbar und ohne
 * serverseitigen Rückweg, deshalb Rückfrage mit Pflichtgrund und rotem Bestätigungsknopf, kein
 * Rückgängig-Toast (`frontend/AGENTS.md`, LFH-343/363). Vorbild „Ereignis streichen“ in
 * `kraefte/KraftZeitachse.tsx`. Steht EINMAL in der Liste, außerhalb der Karten-`map`
 * (LFH-365/683). Eine Ablehnung steht im Dialog, der dabei offen bleibt (LFH-1077).
 */
export default function AuftragAufhebenDialog({
  nummer,
  offen,
  onAufheben,
  onSchliessen,
  speicherung,
}: {
  /** Laufende Nummer für Titel und Satz; ohne Nummer nur „Auftrag“. */
  nummer: number | null | undefined;
  offen: boolean;
  /** Aufheben. **Muss bei Ablehnung ablehnen** (`mutateAsync`), sonst leert die Hülle den Grund. */
  onAufheben: (grund: string) => Promise<unknown>;
  onSchliessen: () => void;
  speicherung: Speicherung;
}) {
  const [form] = Form.useForm<AufhebenWerte>();
  const kennung = nummer != null ? `Auftrag #${nummer}` : 'Auftrag';
  return (
    <ErfassungsModal<AufhebenWerte>
      offen={offen}
      titel={`${kennung} aufheben`}
      form={form}
      erfassenText={AUFTRAG_HANDLUNG.aufgehoben}
      unumkehrbar
      laeuft={speicherung.isPending}
      speicherung={speicherung}
      speicherFehlerTitel="Nicht aufgehoben"
      speicherFehlerFallback="Aufheben fehlgeschlagen"
      onErfassen={(w) => onAufheben(w.grund.trim())}
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      {/* Ein Satz zur Folge vor einem unumkehrbaren Schritt (LFH-1078). */}
      <Typography.Paragraph>
        {kennung} endet endgültig, Quittungen werden nicht mehr erwartet.
      </Typography.Paragraph>
      <Form.Item<AufhebenWerte>
        name="grund"
        label="Grund"
        rules={[
          { required: true, whitespace: true, message: 'Bitte einen Grund angeben' },
          zeichenRegel(AUFTRAG_AUFHEBUNGSGRUND_MAX, 'Grund'),
        ]}
      >
        <Input.TextArea
          aria-label="Grund"
          rows={2}
          placeholder="z. B. Lage hat sich erledigt"
          count={zeichenGrenze(AUFTRAG_AUFHEBUNGSGRUND_MAX)}
        />
      </Form.Item>
    </ErfassungsModal>
  );
}
