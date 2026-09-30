import { Input, Space, Typography } from 'antd';
import { Select } from '../components/Select';
import { useCallback, useEffect, useState } from 'react';
import type { Koordinatenformat } from '../api/types';
import { formatiere, parse } from './koordinaten';
import {
  FORMAT_LABEL,
  istLatLon,
  istUngueltigeKoordinate,
  ungueltigText,
  type KoordinatenWert,
} from './koordinatenWert';
import { useAnzeigeKonventionen } from './AnzeigeKonventionenContext';
import { setzeOverride, useKoordinatenSystemOverride } from './koordinatenSystemStore';
import { OrtZeile } from './OrtZeile';

const OPTIONEN = (Object.keys(FORMAT_LABEL) as Koordinatenformat[]).map((value) => ({
  value,
  label: FORMAT_LABEL[value],
}));

interface Props {
  /** Von Form.Item gesetzte ID verbindet dessen Label mit dem Texteingabefeld. */
  id?: string;
  /** Leer `null`, gültig `LatLon`, ungültig mit Wortlaut und Format (LFH-517, `koordinatenWert.ts`). */
  value?: KoordinatenWert;
  onChange?: (wert: KoordinatenWert) => void;
  status?: 'error' | 'warning';
  /**
   * Den Feldfehler zeigt das umgebende `Form.Item` (Regel `koordinatenRegel`), nicht die Eingabe
   * selbst — sonst stünde er doppelt da. Nur über `KoordinatenFeld` setzen.
   */
  fehlerImFormular?: boolean;
  /** Einsatz, dessen Marker die Peilung bezieht. Ohne diese Prop bleibt die Ort-Zeile aus. */
  einsatzId?: number;
  /** `typ:id` der gerade bearbeiteten Entität (Selbst-Ausschluss), z. B. `einsatzort:7`. */
  exclude?: string;
}

export default function KoordinatenEingabe({
  id,
  value,
  onChange,
  status,
  einsatzId,
  exclude,
  fehlerImFormular = false,
}: Props) {
  const override = useKoordinatenSystemOverride();
  const { konventionen } = useAnzeigeKonventionen();
  const system: Koordinatenformat = override ?? konventionen.koordinatenformat ?? 'wgs84';

  const [text, setText] = useState('');
  const [fehler, setFehler] = useState(false);
  const [fokus, setFokus] = useState(false);

  // Leer ist `null`, Unlesbares ist `ungueltig` (LFH-517): nur so kann ein Formular das Speichern
  // sperren, statt eine bestehende Koordinate still zu löschen.
  const melde = useCallback(
    (roh: string, format: Koordinatenformat) => {
      if (roh.trim() === '') {
        setFehler(false);
        onChange?.(null);
        return;
      }
      try {
        onChange?.(parse(roh, format));
        setFehler(false);
      } catch {
        setFehler(true);
        onChange?.({ ungueltig: true, text: roh, format });
      }
    },
    [onChange],
  );

  // Aus der Wahrheit reformatieren bei EXTERNER Änderung (Laden, Kartenklick, Systemwechsel),
  // NICHT während des Tippens — sonst überschreibt die Rückspeisung der Form die laufende
  // Eingabe und der Cursor springt. Ein ungültiger Wert ist seine eigene Wahrheit: der Wortlaut
  // bleibt stehen; nach einem Systemwechsel wird er im neuen Format neu gelesen.
  useEffect(() => {
    if (fokus) return;
    if (istUngueltigeKoordinate(value)) {
      if (value.format !== system) {
        melde(value.text, system);
        return;
      }
      setText(value.text);
      setFehler(true);
      return;
    }
    setText(value ? formatiere(value.lat, value.lon, system) : '');
    setFehler(false);
  }, [value, system, fokus, melde]);

  function bearbeiten(roh: string) {
    setText(roh);
    melde(roh, system);
  }

  const koord = istLatLon(value) ? value : null;

  return (
    <Space orientation="vertical" size={2} style={{ width: '100%' }}>
      <Space.Compact style={{ width: '100%' }}>
        <Input
          id={id}
          value={text}
          onChange={(e) => bearbeiten(e.target.value)}
          onFocus={() => setFokus(true)}
          onBlur={() => setFokus(false)}
          status={fehler ? 'error' : (status ?? undefined)}
          placeholder="Koordinate eingeben"
        />
        <Select<Koordinatenformat>
          aria-label="Koordinatenformat"
          value={system}
          onChange={setzeOverride}
          options={OPTIONEN}
          style={{ width: 150 }}
        />
      </Space.Compact>
      {fehler ? (
        fehlerImFormular ? null : (
          <Typography.Text type="danger">{ungueltigText(system)}</Typography.Text>
        )
      ) : koord ? (
        <Typography.Text type="secondary">
          entspricht {formatiere(koord.lat, koord.lon, 'wgs84')}
        </Typography.Text>
      ) : null}
      {!fehler && koord && einsatzId != null && (
        <OrtZeile einsatzId={einsatzId} koord={koord} exclude={exclude} />
      )}
    </Space>
  );
}
