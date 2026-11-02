import { Button, Input, Space, Switch, Typography } from 'antd';
import type { CSSProperties, ReactNode } from 'react';
import { DezimalFeld } from '../../components/DezimalFeld';
import { MengenFeld } from '../../components/MengenFeld';
import { Select } from '../../components/Select';
import { Segmentleiste, useRollen, type SegmentOption } from '../../components/instrument';
import type { Eingabe, Raum, Weg, Zeltbestand } from './rechnerKern';
import { ZELTTYPEN, type ZeltTyp } from './richtwerte';

/** Grenzen der Eingabe (design.md D8): Raumzahl und Maße wie die spätere API. */
export const RAEUME_MAX = 200;
export const MASS_MAX_M = 1000;
export const PERSONEN_MAX = 100_000;

const WEG_OPTIONEN: readonly SegmentOption<Weg>[] = [
  { wert: 'personen', label: 'Personen' },
  { wert: 'raeume', label: 'Räume' },
  { wert: 'flaeche', label: 'Fläche' },
  { wert: 'zelte', label: 'Zelte' },
];

const BELEGUNG_OPTIONEN = [
  { value: 'maenner', label: 'Männer' },
  { value: 'frauen', label: 'Frauen' },
];

const GRUPPEN = [
  { schluessel: 'maenner', label: 'Männer' },
  { schluessel: 'frauen', label: 'Frauen' },
] as const;

/** Leere Eingabe je Weg; ein Raum steht schon da. */
export function leereEingabe(weg: Weg = 'personen', trennung = false): Eingabe {
  return { weg, trennung, personen: {}, flaeche: {}, raeume: [neuerRaum()], zelte: {} };
}

function neuerRaum(): Raum {
  return { bezeichnung: '', laenge_m: 0, breite_m: 0, abzuege: [], belegung: 'maenner' };
}

const zahl = (v: number | null) => (v == null || !Number.isFinite(v) ? 0 : v);

function Zeile({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <label style={{ display: 'grid', gap: 4 }}>
      <Typography.Text type="secondary">{label}</Typography.Text>
      {children}
    </label>
  );
}

const voll: CSSProperties = { width: '100%' };

/**
 * Grundlage des Rechners (LLH-1520, design.md D4): Weg Personen · Räume · Fläche · Zelte und die
 * Trennung nach Männern und Frauen. Gesteuert; jede Änderung rechnet die Seite sofort neu.
 */
export default function GrundlageEingabe({
  eingabe,
  onAendern,
}: {
  eingabe: Eingabe;
  onAendern: (e: Eingabe) => void;
}) {
  const { token } = useRollen();
  const setze = (teil: Partial<Eingabe>) => onAendern({ ...eingabe, ...teil });
  const getrennt = eingabe.trennung;
  const raster: CSSProperties = {
    display: 'grid',
    gap: token.marginSM,
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 140px), 1fr))',
  };

  const personen = eingabe.personen ?? {};
  const flaeche = eingabe.flaeche ?? {};
  const raeume = eingabe.raeume ?? [];
  const zelte = eingabe.zelte ?? {};

  const setzeRaum = (i: number, teil: Partial<Raum>) =>
    setze({ raeume: raeume.map((r, j) => (j === i ? { ...r, ...teil } : r)) });
  const setzeZelte = (gruppe: 'gesamt' | 'maenner' | 'frauen', typ: ZeltTyp, n: number | null) => {
    const bestand: Zeltbestand = { ...(zelte[gruppe] ?? {}), [typ]: zahl(n) };
    setze({ zelte: { ...zelte, [gruppe]: bestand } });
  };

  return (
    <Space orientation="vertical" size="middle" style={voll}>
      <Segmentleiste<Weg>
        beschriftung="Grundlage"
        optionen={WEG_OPTIONEN}
        wert={eingabe.weg}
        onWechsel={(weg) => setze({ weg })}
      />
      <Space size="small">
        <Switch
          checked={getrennt}
          onChange={(trennung) => setze({ trennung })}
          aria-label="Nach Männern und Frauen trennen"
        />
        <Typography.Text>Männer und Frauen getrennt</Typography.Text>
      </Space>

      {eingabe.weg === 'personen' &&
        (getrennt ? (
          <div style={raster}>
            {GRUPPEN.map((g) => (
              <Zeile key={g.schluessel} label={g.label}>
                <MengenFeld
                  beschriftung={`Personen ${g.label}`}
                  min={0}
                  max={PERSONEN_MAX}
                  value={personen[g.schluessel] ?? null}
                  onChange={(v) => setze({ personen: { ...personen, [g.schluessel]: zahl(v) } })}
                  style={voll}
                />
              </Zeile>
            ))}
          </div>
        ) : (
          <Zeile label="Personen">
            <MengenFeld
              beschriftung="Personen"
              min={0}
              max={PERSONEN_MAX}
              value={personen.gesamt ?? null}
              onChange={(v) => setze({ personen: { gesamt: zahl(v) } })}
              style={voll}
            />
          </Zeile>
        ))}

      {eingabe.weg === 'flaeche' &&
        (getrennt ? (
          <div style={raster}>
            {GRUPPEN.map((g) => (
              <Zeile key={g.schluessel} label={`${g.label} (m²)`}>
                <DezimalFeld
                  beschriftung={`Fläche ${g.label} (m²)`}
                  stellen={1}
                  min={0}
                  max={MASS_MAX_M * MASS_MAX_M}
                  value={flaeche[`${g.schluessel}_m2`] ?? null}
                  onChange={(v) =>
                    setze({ flaeche: { ...flaeche, [`${g.schluessel}_m2`]: zahl(v) } })
                  }
                  style={voll}
                />
              </Zeile>
            ))}
          </div>
        ) : (
          <Zeile label="Nutzfläche (m²)">
            <DezimalFeld
              beschriftung="Nutzfläche (m²)"
              stellen={1}
              min={0}
              max={MASS_MAX_M * MASS_MAX_M}
              value={flaeche.gesamt_m2 ?? null}
              onChange={(v) => setze({ flaeche: { gesamt_m2: zahl(v) } })}
              style={voll}
            />
          </Zeile>
        ))}

      {eingabe.weg === 'raeume' && (
        <Space orientation="vertical" size="middle" style={voll}>
          {raeume.map((r, i) => {
            const name = r.bezeichnung?.trim() || `Raum ${i + 1}`;
            return (
              <fieldset
                key={i}
                aria-label={name}
                style={{
                  border: `1px solid ${token.colorBorderSecondary}`,
                  borderRadius: token.borderRadius,
                  padding: token.paddingSM,
                  margin: 0,
                  display: 'grid',
                  gap: token.marginSM,
                }}
              >
                <div style={raster}>
                  <Zeile label="Bezeichnung">
                    <Input
                      aria-label={`Bezeichnung Raum ${i + 1}`}
                      placeholder={`Raum ${i + 1}`}
                      value={r.bezeichnung}
                      maxLength={80}
                      onChange={(ev) => setzeRaum(i, { bezeichnung: ev.target.value })}
                    />
                  </Zeile>
                  <Zeile label="Länge (m)">
                    <DezimalFeld
                      beschriftung={`Länge ${name} (m)`}
                      stellen={2}
                      min={0}
                      max={MASS_MAX_M}
                      value={r.laenge_m || null}
                      onChange={(v) => setzeRaum(i, { laenge_m: zahl(v) })}
                      style={voll}
                    />
                  </Zeile>
                  <Zeile label="Breite (m)">
                    <DezimalFeld
                      beschriftung={`Breite ${name} (m)`}
                      stellen={2}
                      min={0}
                      max={MASS_MAX_M}
                      value={r.breite_m || null}
                      onChange={(v) => setzeRaum(i, { breite_m: zahl(v) })}
                      style={voll}
                    />
                  </Zeile>
                  {getrennt && (
                    <Zeile label="Belegung">
                      <Select
                        aria-label={`Belegung ${name}`}
                        options={BELEGUNG_OPTIONEN}
                        value={r.belegung ?? 'maenner'}
                        onChange={(belegung: 'maenner' | 'frauen') => setzeRaum(i, { belegung })}
                      />
                    </Zeile>
                  )}
                </div>
                {(r.abzuege ?? []).map((a, j) => (
                  <div key={j} style={{ ...raster, alignItems: 'end' }}>
                    <Zeile label={`Abzug ${j + 1} Länge (m)`}>
                      <DezimalFeld
                        beschriftung={`Abzug ${j + 1} Länge ${name} (m)`}
                        stellen={2}
                        min={0}
                        max={MASS_MAX_M}
                        value={a.laenge_m || null}
                        onChange={(v) =>
                          setzeRaum(i, {
                            abzuege: (r.abzuege ?? []).map((x, k) =>
                              k === j ? { ...x, laenge_m: zahl(v) } : x,
                            ),
                          })
                        }
                        style={voll}
                      />
                    </Zeile>
                    <Zeile label={`Abzug ${j + 1} Breite (m)`}>
                      <DezimalFeld
                        beschriftung={`Abzug ${j + 1} Breite ${name} (m)`}
                        stellen={2}
                        min={0}
                        max={MASS_MAX_M}
                        value={a.breite_m || null}
                        onChange={(v) =>
                          setzeRaum(i, {
                            abzuege: (r.abzuege ?? []).map((x, k) =>
                              k === j ? { ...x, breite_m: zahl(v) } : x,
                            ),
                          })
                        }
                        style={voll}
                      />
                    </Zeile>
                    <Button
                      onClick={() =>
                        setzeRaum(i, { abzuege: (r.abzuege ?? []).filter((_, k) => k !== j) })
                      }
                    >
                      Abzug {j + 1} entfernen
                    </Button>
                  </div>
                ))}
                <Space wrap>
                  <Button
                    onClick={() =>
                      setzeRaum(i, {
                        abzuege: [...(r.abzuege ?? []), { laenge_m: 0, breite_m: 0 }],
                      })
                    }
                  >
                    Abzug hinzufügen
                  </Button>
                  {raeume.length > 1 && (
                    <Button
                      danger
                      onClick={() => setze({ raeume: raeume.filter((_, j) => j !== i) })}
                    >
                      {name} entfernen
                    </Button>
                  )}
                </Space>
              </fieldset>
            );
          })}
          <Button
            disabled={raeume.length >= RAEUME_MAX}
            onClick={() => setze({ raeume: [...raeume, neuerRaum()] })}
          >
            Raum hinzufügen
          </Button>
        </Space>
      )}

      {eingabe.weg === 'zelte' &&
        (getrennt ? GRUPPEN.map((g) => g.schluessel) : (['gesamt'] as const)).map((gruppe) => (
          <div key={gruppe} style={{ display: 'grid', gap: token.marginXS }}>
            {getrennt && (
              <Typography.Text strong>{gruppe === 'maenner' ? 'Männer' : 'Frauen'}</Typography.Text>
            )}
            <div style={raster}>
              {ZELTTYPEN.map((t) => {
                const gruppenName =
                  gruppe === 'gesamt' ? '' : gruppe === 'maenner' ? ' Männer' : ' Frauen';
                return (
                  <Zeile key={t.typ} label={t.bezeichnung}>
                    <MengenFeld
                      beschriftung={`Anzahl ${t.bezeichnung}${gruppenName}`}
                      min={0}
                      max={1000}
                      value={zelte[gruppe]?.[t.typ] ?? null}
                      onChange={(v) => setzeZelte(gruppe, t.typ, v)}
                      style={voll}
                    />
                  </Zeile>
                );
              })}
            </div>
          </div>
        ))}
    </Space>
  );
}
