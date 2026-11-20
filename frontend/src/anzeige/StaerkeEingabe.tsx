import { InputNumber, Typography, theme } from 'antd';
import { useEffect, useState } from 'react';
import type { Staerke } from '../api/types';
import { Stapel, Textstufe } from '../components/instrument';
import { useZahlSperre } from '../components/zahlRegel';

type Feld = number | null;

interface Props {
  value?: Staerke | null;
  onChange?: (wert: Staerke | null) => void;
  disabled?: boolean;
  /** Fokus ins erste Feld beim Einhängen — für die Zeile der Einheit-Ansicht (LLH-1036). */
  autoFocus?: boolean;
}

/**
 * Koerziert die drei Felder zur Stärke: ist mindestens eines gesetzt, zählen leere als 0; sind
 * alle leer, `null` — wie `Staerke::from_options` im Backend („alle drei oder keiner").
 */
function koerziere(f: Feld, uf: Feld, m: Feld): Staerke | null {
  if (f == null && uf == null && m == null) return null;
  return { fuehrer: f ?? 0, unterfuehrer: uf ?? 0, mannschaft: m ?? 0 };
}

function gleich(a: Staerke | null, b: Staerke | null): boolean {
  if (a == null || b == null) return a == null && b == null;
  return (
    a.fuehrer === b.fuehrer && a.unterfuehrer === b.unterfuehrer && a.mannschaft === b.mannschaft
  );
}

/** Ist dieser Teil ungültig (negativ oder kein Ganzes)? */
function pruefeTeil(wert: Feld): boolean {
  return wert != null && (wert < 0 || !Number.isInteger(wert));
}

/** Grenzen eines Teils der Stärke. */
const GRENZEN = { min: 0, ganz: true };

const SPALTE: React.CSSProperties = { display: 'inline-flex', flexDirection: 'column' };

/**
 * Kontrollierte Eingabe einer taktischen Stärke (F/UF/M) mit Live-Gesamtanzeige, einhängbar als
 * `<Feld name="…"><StaerkeEingabe /></Feld>`.
 *
 * Die Felder bleiben während der Eingabe frei leerbar; {@link koerziere} setzt die Regel im
 * onChange durch. Der Echo-Guard im useEffect spiegelt nur eine wirklich externe
 * value-Änderung in die Felder, nicht das eigene onChange-Echo.
 */
export default function StaerkeEingabe({ value, onChange, disabled, autoFocus }: Props) {
  const { token } = theme.useToken();
  const [f, setF] = useState<Feld>(value?.fuehrer ?? null);
  const [uf, setUf] = useState<Feld>(value?.unterfuehrer ?? null);
  const [m, setM] = useState<Feld>(value?.mannschaft ?? null);

  // Geprüft statt gekappt (LLH-1768): ein negativer Teil bleibt stehen, sperrt und geht nicht hinaus.
  const { grund, pruefe } = useZahlSperre();

  useEffect(() => {
    if (gleich(koerziere(f, uf, m), value ?? null)) return; // eigenes Echo → ignorieren
    setF(value?.fuehrer ?? null);
    setUf(value?.unterfuehrer ?? null);
    setM(value?.mannschaft ?? null);
    // Ein Wert von außen ersetzt die Eingabe: ein alter Grund bleibt nicht hängen (LLH-1768).
    if (grund) {
      pruefe(value?.fuehrer, GRENZEN, 'f');
      pruefe(value?.unterfuehrer, GRENZEN, 'uf');
      pruefe(value?.mannschaft, GRENZEN, 'm');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function melde(nf: Feld, nuf: Feld, nm: Feld) {
    setF(nf);
    setUf(nuf);
    setM(nm);
    const fehler = [
      pruefe(nf, GRENZEN, 'f'),
      pruefe(nuf, GRENZEN, 'uf'),
      pruefe(nm, GRENZEN, 'm'),
    ].some(Boolean);
    if (!fehler) onChange?.(koerziere(nf, nuf, nm));
  }

  const begonnen = f != null || uf != null || m != null;
  const gesamt = (f ?? 0) + (uf ?? 0) + (m ?? 0);

  return (
    <Stapel richtung="zeile" abstand="sm" ausrichten="ende" umbruch>
      <span style={SPALTE}>
        <Textstufe stufe="textKlein" ton="gedaempft">
          Führer
        </Textstufe>
        <InputNumber
          value={f}
          status={grund && pruefeTeil(f) ? 'error' : undefined}
          disabled={disabled}
          aria-label="Führer"
          autoFocus={autoFocus}
          placeholder="F"
          onChange={(v) => melde(v, uf, m)}
          style={{ width: 88 }}
        />
      </span>
      <span style={SPALTE}>
        <Textstufe stufe="textKlein" ton="gedaempft">
          Unterführer
        </Textstufe>
        <InputNumber
          value={uf}
          status={grund && pruefeTeil(uf) ? 'error' : undefined}
          disabled={disabled}
          aria-label="Unterführer"
          placeholder="UF"
          onChange={(v) => melde(f, v, m)}
          style={{ width: 88 }}
        />
      </span>
      <span style={SPALTE}>
        <Textstufe stufe="textKlein" ton="gedaempft">
          Mannschaft
        </Textstufe>
        <InputNumber
          value={m}
          status={grund && pruefeTeil(m) ? 'error' : undefined}
          disabled={disabled}
          aria-label="Mannschaft"
          placeholder="M"
          onChange={(v) => melde(f, uf, v)}
          style={{ width: 88 }}
        />
      </span>
      <Typography.Text type="secondary" style={{ paddingBottom: token.paddingXS }}>
        = {begonnen ? gesamt : '—'}
      </Typography.Text>
    </Stapel>
  );
}
