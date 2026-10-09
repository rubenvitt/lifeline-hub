import { Button, Checkbox, Collapse, Flex, Form, Input } from 'antd';
import { INFOTELEFON_KURZ_MAX, INFOTELEFON_NOTIZ_MAX } from '../api/eingabegrenzen';
import { zeichenGrenze, zeichenRegel } from '../components/zeichenGrenze';
import { ZeitpunktEingabe } from '../anzeige/ZeitpunktEingabe';
import type { RefSelectProps } from 'antd';
import type { Dayjs } from 'dayjs';
import { useEffect, useRef, useState } from 'react';
import type { InfotelefonAnliegen } from '../api/types';
import type { AnrufEingabe } from '../api/infotelefon';
import { Schnellerfassungszeile, useRollen } from '../components/instrument';
import { Select } from '../components/Select';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import Tastenkuerzel from '../components/Tastenkuerzel';
import { useViewport } from '../components/useViewport';
import { alsBackendZeit } from '../anzeige/zeitEingabe';
import { ANLIEGEN_LABEL, ANLIEGEN_REIHENFOLGE } from '../presse/labels';

/**
 * Schnellerfassung des Informationstelefons (LFH-554, Spec `stab-infotelefon`): am Fuß der Seite,
 * für Serienbetrieb am Bürgertelefon.
 *
 * - Sichtbar: Anliegen, Notiz, „Rückruf nötig“. Name, Rückrufnummer und Uhrzeit liegen
 *   eingeklappt — außer die Rückrufnummer wird Pflicht: dann steht sie offen da, denn ein
 *   Pflichtfeld gehört nie hinter die Einklappung (Erfassungs-Norm).
 * - Absende-Knopf im `<form>`, deshalb sendet Enter. Nach dem Speichern sind die Felder leer und
 *   der Fokus steht wieder im Anliegen (`requestAnimationFrame`). „Werte behalten“ gibt es nicht:
 *   jeder Anruf ist ein neuer.
 * - Die Taste steht am Knopf, nicht als Satz darunter (LFH-1078): `aria-keyshortcuts` immer, die
 *   ↵-Kappe nur ab `lg` mit feinem Zeiger (Muster `etb/Schnellerfassung.tsx`).
 * - Leere Uhrzeit: der Server setzt jetzt (`routes/infotelefon.rs`), daher der Platzhalter.
 * - Scheitert das Speichern, bleiben die Felder stehen und der Grund steht darüber.
 * - `einklappbar` (unter `md`, solange der Fokus nicht in der Leiste liegt, LFH-1067): bei leerem
 *   Formular und ohne Fehler stehen nur Anliegen und „Erfassen“ da — dasselbe Muster wie die
 *   ETB-Leiste (`etb/AGENTS.md`, Erfassung), sonst verdeckte die Leiste beim Öffnen alle Anrufe.
 *   Eingeklappt wird nur ein leeres Formular, also geht nichts verloren.
 */
interface Werte {
  anliegen?: InfotelefonAnliegen;
  notiz?: string;
  rueckruf_noetig?: boolean;
  anrufer_name?: string;
  rueckruf?: string;
  eingang?: Dayjs;
}

/** Steht nichts im Formular? Leerzeichen zählen nicht als Inhalt. */
export function formularLeer(w: Werte | undefined): boolean {
  if (w == null) return true;
  return (
    w.anliegen == null &&
    !w.notiz?.trim() &&
    w.rueckruf_noetig !== true &&
    !w.anrufer_name?.trim() &&
    !w.rueckruf?.trim() &&
    w.eingang == null
  );
}

export default function AnrufErfassung({
  onErfassen,
  laeuft,
  fehler,
  einklappbar = false,
}: {
  onErfassen: (eingabe: AnrufEingabe) => Promise<unknown>;
  laeuft: boolean;
  fehler: unknown;
  /** Darf die Leiste einklappen (Handschirm, Fokus außerhalb)? Siehe Kopfkommentar. */
  einklappbar?: boolean;
}) {
  const [form] = Form.useForm<Werte>();
  const { token } = useRollen();
  const { istSchmal, istBeruehrung, abBreite } = useViewport();
  const anliegenRef = useRef<RefSelectProps>(null);
  const sendetRef = useRef(false);
  const [gespeichert, setGespeichert] = useState(0);
  const rueckrufNoetig = Form.useWatch('rueckruf_noetig', form) === true;
  const leer = Form.useWatch(formularLeer, form) !== false;
  const eingeklappt = einklappbar && leer && fehler == null;

  /**
   * Nach dem Speichern steht der Fokus wieder im Anliegen. Als Effekt auf den Zähler, nicht per
   * `requestAnimationFrame`: `resetFields` hängt jedes Feld neu ein (rc-field-form wechselt den
   * Schlüssel), und unter Last lief der Frame vor diesem Commit. Der Fokus landete dann im alten,
   * gleich entfernten Select und fiel auf `body`. Der Effekt läuft im selben Commit wie das Neu-
   * Einhängen, der Ref zeigt dort schon auf das neue Feld.
   */
  useEffect(() => {
    if (gespeichert > 0) anliegenRef.current?.focus();
  }, [gespeichert]);

  const absenden = async (w: Werte) => {
    if (sendetRef.current || !w.anliegen) return;
    sendetRef.current = true;
    try {
      await onErfassen({
        anliegen: w.anliegen,
        notiz: w.notiz,
        anrufer_name: w.anrufer_name,
        rueckruf: w.rueckruf,
        rueckruf_noetig: w.rueckruf_noetig === true,
        ...(w.eingang ? { eingang_at: alsBackendZeit(w.eingang) } : {}),
      });
      form.resetFields();
      setGespeichert((n) => n + 1);
    } catch {
      // Der Grund steht als `fehler` über der Zeile; die Felder bleiben stehen.
    } finally {
      sendetRef.current = false;
    }
  };

  const rueckrufFeld = (
    <Form.Item
      label="Rückrufnummer"
      name="rueckruf"
      rules={[
        { required: rueckrufNoetig, whitespace: true, message: 'Für einen Rückruf erforderlich' },
      ]}
      style={{ marginBottom: 0 }}
    >
      <Input placeholder="Telefon" maxLength={INFOTELEFON_KURZ_MAX} />
    </Form.Item>
  );

  return (
    <Form<Werte> form={form} layout="vertical" onFinish={(w) => void absenden(w)}>
      <Flex vertical gap={token.marginXS}>
        {fehler != null && <SpeicherFehler fehler={fehler} titel="Anruf nicht erfasst" />}
        <Schnellerfassungszeile
          gestapelt={istSchmal}
          // Vier Bedienelemente in einer Zelle: jedes Feld mit eigenem Rahmen, sonst stand die
          // Notiz rahmenlos neben dem umrandeten Anliegen (LFH-978).
          felderUmrandet
          hinweis={gespeichert > 0 && !eingeklappt ? `${gespeichert} erfasst` : undefined}
        >
          <Flex wrap gap={token.marginXS} style={{ width: '100%', padding: token.paddingXS }}>
            <Form.Item
              name="anliegen"
              rules={[{ required: true, message: 'Anliegen wählen' }]}
              style={
                eingeklappt
                  ? { marginBottom: 0, minWidth: 0, flex: '1 1 0' }
                  : { marginBottom: 0, minWidth: 180, flex: '0 0 auto' }
              }
            >
              <Select
                ref={anliegenRef}
                aria-label="Anliegen"
                placeholder="Anliegen"
                options={ANLIEGEN_REIHENFOLGE.map((a) => ({ value: a, label: ANLIEGEN_LABEL[a] }))}
              />
            </Form.Item>
            {!eingeklappt && (
              <>
                <Form.Item
                  name="notiz"
                  rules={[zeichenRegel(INFOTELEFON_NOTIZ_MAX, 'Notiz')]}
                  style={{ marginBottom: 0, flex: '1 1 240px', minWidth: 0 }}
                >
                  <Input
                    aria-label="Notiz"
                    placeholder="Notiz zum Anruf"
                    // Zähler ab 80 % im Feld selbst (Suffix), keine weitere Zeile (LFH-937).
                    count={zeichenGrenze(INFOTELEFON_NOTIZ_MAX)}
                  />
                </Form.Item>
                <Form.Item
                  name="rueckruf_noetig"
                  valuePropName="checked"
                  style={{ marginBottom: 0, alignSelf: 'center' }}
                >
                  <Checkbox>Rückruf nötig</Checkbox>
                </Form.Item>
              </>
            )}
            <Button type="primary" htmlType="submit" loading={laeuft} aria-keyshortcuts="Enter">
              Erfassen
              {!istBeruehrung && abBreite('lg') && (
                <Tastenkuerzel aria-hidden style={{ marginInlineStart: token.marginXS }}>
                  ↵
                </Tastenkuerzel>
              )}
            </Button>
          </Flex>
        </Schnellerfassungszeile>
        {rueckrufNoetig && rueckrufFeld}
        {!eingeklappt && (
          <Collapse
            ghost
            items={[
              {
                key: 'weitere',
                label: 'Anrufer und Uhrzeit',
                forceRender: true,
                children: (
                  <Flex wrap gap={token.marginSM}>
                    <Form.Item
                      label="Name"
                      name="anrufer_name"
                      style={{ marginBottom: 0, flex: '1 1 200px' }}
                    >
                      <Input maxLength={INFOTELEFON_KURZ_MAX} />
                    </Form.Item>
                    {!rueckrufNoetig && <div style={{ flex: '1 1 200px' }}>{rueckrufFeld}</div>}
                    <Form.Item
                      label="Uhrzeit"
                      name="eingang"
                      style={{ marginBottom: 0, flex: '1 1 200px' }}
                    >
                      <ZeitpunktEingabe
                        format="DD.MM.YYYY HH:mm"
                        placeholder="jetzt"
                        style={{ width: '100%' }}
                      />
                    </Form.Item>
                  </Flex>
                ),
              },
            ]}
          />
        )}
      </Flex>
    </Form>
  );
}
