import { Alert, Button, Form, Input, Space, Spin, Typography } from 'antd';
import { useRef, useState } from 'react';
import { koppeln } from '../api/geraete';
import { ApiError, fehlerText } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { GERAET_START_PFAD } from '../routing/deeplinks';
import { GeraeteKarte } from './GeraeteKarte';
import { merkeGeraet } from './geraetMarke';

/**
 * Einlösen eines Kopplungscodes (LFH-892, Spec `geraete-kopplung`). Der QR der Einsatzleitung
 * trägt den Code im Fragment (`/koppeln#ABCD1234`); die Seite übernimmt ihn ins Feld und nimmt
 * ihn sofort aus der Adresse, damit er nicht in Verlauf oder Lesezeichen stehen bleibt.
 *
 * Ein Browser, in dem eine Person angemeldet ist, koppelt nicht: der Server ersetzte deren
 * Sitzung still, und ihre Daten auf diesem Gerät gehörten dann einem Gerätekonto. Erst abmelden.
 *
 * Nach dem Einlösen lädt die Seite neu, statt den Benutzer im laufenden Baum zu tauschen: eine
 * frühere Gerätesitzung (Gerätetausch) oder Reste einer Person räumt so der Start auf.
 */

interface Props {
  /** Neuladen auf der Gerätehülle. Injizierbar, weil jsdom nicht navigiert. */
  navigiere?: (adresse: string) => void;
}

function codeAusFragment(): string {
  const roh = window.location.hash.replace(/^#/, '');
  if (!roh) return '';
  // Aus der Adresse nehmen, ohne einen Verlaufseintrag anzulegen.
  window.history.replaceState(window.history.state, '', window.location.pathname);
  try {
    return decodeURIComponent(roh);
  } catch {
    return roh;
  }
}

export default function KoppelnPage({ navigiere = (a) => window.location.assign(a) }: Props) {
  const { benutzer, geraet, laedt, logout } = useAuth();
  const [form] = Form.useForm<{ code: string }>();
  // Einmal beim ersten Rendern lesen; danach steht der Code nur noch im Feld.
  const [vorbelegung] = useState(codeAusFragment);
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  /** Riegel gegen zwei Einlösungen bei schnellem Doppeltipp (State greift erst nach dem Rendern). */
  const sendetRef = useRef(false);

  async function einloesen({ code }: { code: string }) {
    if (sendetRef.current) return;
    sendetRef.current = true;
    setLaeuft(true);
    setFehler(null);
    try {
      await koppeln(code.trim());
      merkeGeraet(true);
      navigiere(GERAET_START_PFAD);
    } catch (e) {
      // Der Server antwortet einheitlich 401, ob der Code falsch, verbraucht oder abgelaufen ist.
      setFehler(
        e instanceof ApiError && e.status === 401
          ? 'Dieser Code gilt nicht (mehr). Lass dir bei der Einsatzleitung einen neuen geben.'
          : fehlerText(e, 'Das Koppeln ist fehlgeschlagen.'),
      );
      sendetRef.current = false;
      setLaeuft(false);
    }
  }

  let inhalt;
  if (laedt) {
    inhalt = <Spin />;
  } else if (benutzer && !geraet) {
    inhalt = (
      <>
        <Typography.Paragraph>
          In diesem Browser ist {benutzer.anzeigename} angemeldet. Ein Gerät lässt sich erst
          koppeln, wenn niemand mehr angemeldet ist.
        </Typography.Paragraph>
        <Button size="large" block onClick={() => void logout()}>
          Abmelden
        </Button>
      </>
    );
  } else {
    inhalt = (
      <>
        <Typography.Paragraph type="secondary">
          Gib den Code ein, den dir die Einsatzleitung gezeigt hat. Er gilt zehn Minuten und nur
          einmal.
        </Typography.Paragraph>
        {geraet && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            title={`Dieses Gerät ist schon als ${geraet.bezeichnung} gekoppelt. Ein neuer Code ersetzt die Kopplung.`}
          />
        )}
        {fehler && <Alert type="error" showIcon title={fehler} style={{ marginBottom: 16 }} />}
        <Form
          form={form}
          layout="vertical"
          requiredMark={false}
          initialValues={{ code: vorbelegung }}
          onFinish={einloesen}
        >
          <Form.Item
            name="code"
            label="Kopplungscode"
            rules={[{ required: true, whitespace: true, message: 'Code eingeben' }]}
          >
            <Input
              size="large"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              autoFocus={!vorbelegung}
              placeholder="ABCD-1234"
            />
          </Form.Item>
          <Space orientation="vertical" style={{ width: '100%' }}>
            <Button type="primary" size="large" block htmlType="submit" loading={laeuft}>
              Gerät koppeln
            </Button>
          </Space>
        </Form>
      </>
    );
  }

  return <GeraeteKarte untertitel="Gerät koppeln">{inhalt}</GeraeteKarte>;
}
