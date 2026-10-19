import type { CSSProperties, ReactNode } from 'react';
import type { Farbrollen } from '../../theme/tokens';
import { useRollen } from './rollenwerte';

/**
 * FeldFehler — die Fehlerzeile unter einer Eingabe, auch ohne antd-`Form` (LLH-1101; Nutzer
 * außerhalb eines `Form.Item`, etwa die feldweise Bearbeitung der Personendaten, LLH-1103).
 *
 * EINE OPTIK MIT ANTDS FORMULARMELDUNG: Farbe `alarmText` (dieselbe Rolle, die `antdKomponenten`
 * dem `Form`-Token `colorError` gibt, `frontend/AGENTS.md`, „Geerbter Text auf Textrollen“; nie
 * antds Füllfarbe `colorError`), Schrift und Zeilenhöhe aus `fontSize`/`lineHeight` wie
 * `.ant-form-item-explain`. Wer in einem `Form.Item` steht, nimmt antds eigene Meldung
 * (`DatenfeldEingabe`); beide sehen gleich aus.
 *
 * ZUGANG: die Zeile trägt `id`; die Eingabe verweist per `aria-describedby` darauf und setzt
 * `aria-invalid`. Kein eigener Live-Bereich: der Grund erscheint nach dem Absenden, und der Fokus
 * geht ins Feld, dessen Beschreibung der Vorleser dann liest. Die Marke `data-fehler` ist dieselbe
 * wie an `InlineAngabe` und `BemerkungZelle`.
 *
 * Ohne Grund rendert sie nichts — kein leerer Abstand unter dem Feld.
 */
export function feldFehlerStil(
  rollen: Pick<Farbrollen, 'alarmText'>,
  token: { fontSize: number; lineHeight: number },
): CSSProperties {
  return {
    color: rollen.alarmText,
    fontSize: token.fontSize,
    lineHeight: token.lineHeight,
  };
}

interface FeldFehlerProps {
  /** Ziel des `aria-describedby` an der Eingabe. */
  id?: string;
  /** Der Grund in wenigen Wörtern („Ort ist Pflicht“); leer → nichts. */
  children?: ReactNode;
}

export default function FeldFehler({ id, children }: FeldFehlerProps) {
  const { token, rollen } = useRollen();
  if (children == null || children === false || children === '') return null;
  return (
    <div id={id} data-fehler="" style={feldFehlerStil(rollen, token)}>
      {children}
    </div>
  );
}
