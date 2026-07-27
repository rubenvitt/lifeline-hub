import { Button, Result, Typography } from 'antd';
import { useNavigate } from 'react-router';

/** Rückweg aus einer Sackgasse: Zielpfad und Beschriftung des Primärknopfes.
 *  Den Pfad baut der Aufrufer (Einsatz-Deeplinks über `routing/deeplinks.ts`) —
 *  der Platzhalter ist ein Primitiv und kennt keine Einsatz-Routen. */
export interface PlatzhalterRueckweg {
  pfad: string;
  label: string;
}

interface Props {
  titel: string;
  beschreibung?: string;
  /**
   * Optionaler Rückweg (LFH-328/A2, Task 11). Ohne ihn rendert der Platzhalter wie
   * bisher, nur in der neuen Form — der zweite Konsument (`pages/ProfilPage`) steht
   * in keinem Einsatz-Kontext und hat kein Standardmodul, auf das er zurückführen
   * könnte.
   */
  rueckweg?: PlatzhalterRueckweg;
}

/** Erwartungshorizont: sagt, woran man ist. Ein „In Arbeit"-Etikett allein beantwortet
 *  die Frage nicht, die jemand vor einer leeren Seite hat — nämlich ob hier gleich
 *  etwas zu erfassen ist oder anderswo weitergearbeitet werden muss.
 *
 *  Bewusst kontextfrei formuliert („Bereich", kein Einsatz): `pages/ProfilPage` rendert
 *  den Platzhalter unter einer funktionierenden 2FA-Sektion und steht in keinem Einsatz. */
const ERWARTUNGSHORIZONT =
  'Dieser Bereich ist geplant, aber noch nicht bedienbar — hier lässt sich nichts ' +
  'erfassen oder auswerten.';

/** Der Einsatz-Bezug hängt am Rückweg, dem einzigen Signal für „steht in einem Einsatz". */
const ERWARTUNGSHORIZONT_EINSATZ = ' Der Einsatz läuft davon unberührt weiter.';

/**
 * Einheitlicher Platzhalter für noch nicht implementierte Bereiche.
 *
 * `status="info"` und nicht `warning`/`error`: ein geplantes Modul ist kein Fehler und
 * keine Gefahr — Rot bedient nichts (Bedien-Leitlinie, LFH-352/LFH-315). Der zweite
 * Kanal neben der Farbe ist hier der Text selbst, nicht nur das Symbol.
 */
export default function Platzhalter({ titel, beschreibung, rueckweg }: Props) {
  const navigate = useNavigate();
  return (
    <Result
      status="info"
      title={`🚧 ${titel}`}
      subTitle={beschreibung}
      extra={
        rueckweg && (
          <Button type="primary" onClick={() => navigate(rueckweg.pfad)}>
            {rueckweg.label}
          </Button>
        )
      }
    >
      <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
        {rueckweg ? ERWARTUNGSHORIZONT + ERWARTUNGSHORIZONT_EINSATZ : ERWARTUNGSHORIZONT}
      </Typography.Paragraph>
    </Result>
  );
}
