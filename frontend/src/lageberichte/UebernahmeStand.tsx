import { Typography } from 'antd';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { useRollen } from '../components/instrument';
import { isAusVorfassung } from './standFeld';

/** Wortlaut — exportiert, damit Tests ihn nicht nachschreiben. */
export const STAND_DER_UEBERNAHME = 'Stand der Übernahme';
export const AUS_DER_VORFASSUNG = 'aus der Vorfassung';

/**
 * Marke „Stand der Übernahme <DTG>“ im Kopf eines Abschnitts mit Quelle (LLH-1357, Spec
 * `lagevortrag-uebernahme`). Kind eines `Form.Item` auf `['uebernommen_at', <schlüssel>]` (`noStyle`):
 * so ist das Feld eingehängt und wird mitgespeichert, und nur die Marke rendert, wenn ihr Stand
 * wechselt. Ohne Stand steht nichts.
 *
 * Stammt der Stand aus der Vorfassung (`lageberichte/standFeld.ts:isAusVorfassung`), ist er
 * auffällig: Achtungsfarbe, halbfett, und als zweiter Kanal Zeichen und Wörter „aus der
 * Vorfassung“ (WCAG 1.4.1). Nicht auf Papier: dort trägt der Text seinen Stand selbst.
 */
export default function UebernahmeStand({
  value,
  grenze,
}: {
  /** Vom `Form.Item`: der Stand im Wire-Format. */
  value?: string | null;
  /** `erstellt_at` des fortgeschriebenen Entwurfs, sonst `undefined` (`isAusVorfassung`). */
  grenze: string | undefined;
}) {
  const { token } = useRollen();
  if (!value) return null;
  const alt = isAusVorfassung(value, grenze);
  return (
    <Typography.Text
      className="lagebericht-no-print"
      data-lfh="uebernahme-stand"
      data-aus-vorfassung={alt || undefined}
      type={alt ? 'warning' : 'secondary'}
      strong={alt}
      style={{ display: 'block', marginBottom: token.marginXXS }}
    >
      {alt && <span aria-hidden>⧖ </span>}
      {STAND_DER_UEBERNAHME} <ZeitAnzeige wert={value} />
      {alt && ` · ${AUS_DER_VORFASSUNG}`}
    </Typography.Text>
  );
}
