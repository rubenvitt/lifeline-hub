import { InputNumber, Space, Typography } from 'antd';
import { useEffect, useState } from 'react';
import type { Staerke } from '../api/types';

type Feld = number | null;

interface Props {
  value?: Staerke | null;
  onChange?: (wert: Staerke | null) => void;
  disabled?: boolean;
}

/**
 * Koerziert die drei Felder zur Stärke: ist mindestens eines gesetzt, zählen leere als 0
 * (vollständige Stärke); sind alle leer, gibt es keine Stärke (`null`). Entspricht der
 * Backend-Regel `Staerke::aus_optionen` ("alle drei oder keiner").
 */
function koerziere(f: Feld, uf: Feld, m: Feld): Staerke | null {
  if (f == null && uf == null && m == null) return null;
  return { fuehrer: f ?? 0, unterfuehrer: uf ?? 0, mannschaft: m ?? 0 };
}

function gleich(a: Staerke | null, b: Staerke | null): boolean {
  if (a == null || b == null) return a == null && b == null;
  return a.fuehrer === b.fuehrer && a.unterfuehrer === b.unterfuehrer && a.mannschaft === b.mannschaft;
}

const SPALTE: React.CSSProperties = { display: 'inline-flex', flexDirection: 'column' };

/**
 * Kontrollierte Eingabe einer taktischen Stärke (F/UF/M) mit Live-Gesamtanzeige. In antd-Forms
 * als `<Form.Item name="…"><StaerkeEingabe /></Form.Item>` einhängbar (value/onChange).
 *
 * Die Regel "alle drei oder keiner" wird über {@link koerziere} im onChange durchgesetzt; die
 * einzelnen Felder bleiben während der Eingabe frei leerbar. Der Echo-Guard im useEffect
 * verhindert, dass die value-Rückspeisung (das eigene onChange-Echo) die noch leeren Felder
 * auf 0 zieht — nur eine wirklich externe value-Änderung wird in die Felder gespiegelt.
 */
export default function StaerkeEingabe({ value, onChange, disabled }: Props) {
  const [f, setF] = useState<Feld>(value?.fuehrer ?? null);
  const [uf, setUf] = useState<Feld>(value?.unterfuehrer ?? null);
  const [m, setM] = useState<Feld>(value?.mannschaft ?? null);

  useEffect(() => {
    if (gleich(koerziere(f, uf, m), value ?? null)) return; // eigenes Echo → ignorieren
    setF(value?.fuehrer ?? null);
    setUf(value?.unterfuehrer ?? null);
    setM(value?.mannschaft ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function melde(nf: Feld, nuf: Feld, nm: Feld) {
    setF(nf);
    setUf(nuf);
    setM(nm);
    onChange?.(koerziere(nf, nuf, nm));
  }

  const begonnen = f != null || uf != null || m != null;
  const gesamt = (f ?? 0) + (uf ?? 0) + (m ?? 0);

  return (
    <Space align="end" wrap>
      <span style={SPALTE}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>Führer</Typography.Text>
        <InputNumber min={0} value={f} disabled={disabled} aria-label="Führer" placeholder="F"
          onChange={(v) => melde(v, uf, m)} style={{ width: 88 }} />
      </span>
      <span style={SPALTE}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>Unterführer</Typography.Text>
        <InputNumber min={0} value={uf} disabled={disabled} aria-label="Unterführer" placeholder="UF"
          onChange={(v) => melde(f, v, m)} style={{ width: 88 }} />
      </span>
      <span style={SPALTE}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>Mannschaft</Typography.Text>
        <InputNumber min={0} value={m} disabled={disabled} aria-label="Mannschaft" placeholder="M"
          onChange={(v) => melde(f, uf, v)} style={{ width: 88 }} />
      </span>
      <Typography.Text type="secondary" style={{ paddingBottom: 4 }}>= {begonnen ? gesamt : '—'}</Typography.Text>
    </Space>
  );
}
