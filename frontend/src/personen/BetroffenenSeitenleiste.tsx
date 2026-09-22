import { Button } from 'antd';
import type { CSSProperties } from 'react';
import type { Person } from '../api/types';
import {
  Aufgliederung,
  Paneel,
  PaneelZeile,
  monoStil,
  useRollen,
  type Segment,
} from '../components/instrument';
import { sichtung } from '../theme/statusFarben';
import { sichtungsfarben } from '../theme/tokens';
import { SK_WORT } from './personMeta';
import {
  offeneFelder,
  sichtungsbild,
  SICHTUNGSBILD_REIHE,
  verbleibZaehlung,
  type SichtungsbildSchluessel,
} from './personenBilanz';

/**
 * Rechte Seitenleiste der Betroffenen-Seite (Neuentwurf S7): „Sichtungsbild", „Verbleib",
 * „Offene Felder". Alle Zahlen kommen aus `personen/personenBilanz.ts` über DIESELBE Menge
 * wie die Liste — über einem Ladefehler steht sie deshalb nicht (die Seite rendert sie im
 * Datenzweig), sonst meldete sie Nullen, die niemand erhoben hat.
 *
 * ── SICHTUNG IN BBK-FARBEN, NICHT IN DESIGNFARBEN ───────────────────────────────────────
 *
 * Der Entwurf färbt SK II orange, SK III gelb, SK IV grau — das ist ausdrücklich NICHT
 * übernommen (umsetzung.md, Entscheidung 2). Die Farbfelder lesen `sichtungsfarben` über
 * `sichtung[k].farbe` wie `SichtungsTag`; „unverletzt" und „ohne Sichtung" haben keine
 * Fachfarbe und stehen als leeres Feld bzw. neutrale Spur.
 *
 * DER BALKEN IST DER BAUSTEIN `Aufgliederung` mit Umrandung je Segment (seit 22.09.2026;
 * vorher ein lokaler Nachbau): das schwarze Feld für „tot" verschwände sonst auf dem
 * Nachtgrund, Gelb auf hellem — dieselbe Begründung wie am Farbfeld des `SichtungsTag`.
 * Zugänglich ist er als EIN Bild mit ausgeschriebenem Wortlaut über ALLE Kategorien, auch
 * die leeren; die Liste darunter ist der zweite Kanal.
 */

interface Props {
  alle: readonly Person[];
  uhsName: (id: number) => string | undefined;
  nurLuecken: boolean;
  onNurLuecken: (an: boolean) => void;
}

function farbe(k: SichtungsbildSchluessel): string | null {
  if (k === 'ohne') return null;
  const f = sichtung[k].farbe;
  return f ? sichtungsfarben[f] : null;
}

function kuerzel(k: SichtungsbildSchluessel): string {
  return k === 'ohne' ? '—' : sichtung[k].label;
}

function Farbfeld({ k, groesse }: { k: SichtungsbildSchluessel; groesse: number }) {
  const { token } = useRollen();
  const f = farbe(k);
  return (
    <span
      aria-hidden="true"
      data-sichtung-feld={k}
      style={{
        display: 'inline-block',
        width: groesse,
        height: groesse,
        flex: `0 0 ${groesse}px`,
        background: f ?? 'transparent',
        border: `1px solid ${k === 'ohne' ? token.colorTextTertiary : token.colorText}`,
      }}
    />
  );
}

export default function BetroffenenSeitenleiste({
  alle,
  uhsName,
  nurLuecken,
  onNurLuecken,
}: Props) {
  const { token, rollen } = useRollen();
  const bild = sichtungsbild(alle);
  const verbleib = verbleibZaehlung(alle, uhsName);
  const offen = offeneFelder(alle);
  // Alle Kategorien, auch die leeren: der zugängliche Name zählt sie vollständig auf, die
  // Fläche zeichnet der Baustein ohnehin nur für positive Werte.
  const segmente: Segment[] = SICHTUNGSBILD_REIHE.map((k) => ({
    label: k === 'ohne' ? 'ohne Sichtung' : kuerzel(k),
    wert: bild.je[k],
    farbe: farbe(k) ?? rollen.flaeche3,
    umrandung: token.colorTextTertiary,
  }));

  const zeile: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: token.marginSM,
    paddingBlock: token.paddingXXS,
  };

  return (
    <>
      <Paneel titel="Sichtungsbild">
        <div
          style={{
            padding: token.padding,
            display: 'flex',
            flexDirection: 'column',
            gap: token.margin,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', gap: token.marginSM }}>
            <span data-lfh="summe" style={{ ...monoStil(40, 500), lineHeight: 1 }}>
              {bild.gesamt}
            </span>
            <span style={{ fontSize: 11, color: rollen.schwach }}>erfasst</span>
          </div>
          <Aufgliederung
            segmente={segmente}
            titel="Betroffene nach Sichtung"
            hoehe={8}
            legende={false}
          />
          <ul
            aria-label="Sichtungskategorien"
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              display: 'grid',
              gap: token.marginXS,
            }}
          >
            {SICHTUNGSBILD_REIHE.map((k) => (
              <li key={k} data-sichtung-zeile={k} style={zeile}>
                <Farbfeld k={k} groesse={8} />
                <span style={{ ...monoStil(12), color: rollen.text2, width: 72 }}>
                  {kuerzel(k)}
                </span>
                <span style={{ flex: 1, fontSize: 11, color: rollen.schwach }}>{SK_WORT[k]}</span>
                <span style={{ ...monoStil(15), color: rollen.text }}>{bild.je[k]}</span>
              </li>
            ))}
          </ul>
        </div>
      </Paneel>

      <Paneel titel="Verbleib">
        <ul aria-label="Verbleib" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {verbleib.map((v) => (
            <li key={v.schluessel} data-verbleib={v.schluessel}>
              <PaneelZeile
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  gap: token.marginSM,
                }}
              >
                <span
                  style={{ fontSize: 12, color: v.offen ? rollen.achtungText : rollen.gedaempft }}
                >
                  {v.label}
                </span>
                <span
                  style={{
                    ...monoStil(14),
                    color: v.offen && v.wert > 0 ? rollen.achtungText : rollen.text,
                  }}
                >
                  {v.wert}
                </span>
              </PaneelZeile>
            </li>
          ))}
        </ul>
      </Paneel>

      <Paneel titel="Offene Felder">
        <div
          style={{
            padding: token.padding,
            display: 'flex',
            flexDirection: 'column',
            gap: token.marginSM,
          }}
        >
          <p
            data-lfh="offene-felder"
            style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: rollen.gedaempft }}
          >
            {offen.datensaetze === 0
              ? 'Keine offenen Felder bei angetroffenen Personen.'
              : `${offen.ohneVerbleib} ohne Verbleib, ${offen.ohneFundort} ohne Fundort — ${offen.datensaetze} ${
                  offen.datensaetze === 1 ? 'Datensatz' : 'Datensätze'
                }. Die Zeilen sind markiert („offen") und über die Detailseite ergänzbar.`}
          </p>
          <Button
            // Umschalter: der Name bleibt stehen, der Zustand steht in `aria-pressed` und in
            // der Füllung — ein wechselnder Name UND ein Zustand wären zwei Wahrheiten.
            aria-pressed={nurLuecken}
            type={nurLuecken ? 'primary' : 'default'}
            onClick={() => onNurLuecken(!nurLuecken)}
            disabled={!nurLuecken && offen.datensaetze === 0}
            block
          >
            Nur Lücken zeigen
          </Button>
        </div>
      </Paneel>
    </>
  );
}
