import type { Person } from '../api/types';
import { monoStil, useRollen } from '../components/instrument';
import { sichtung } from '../theme/statusFarben';
import { sichtungsfarben } from '../theme/tokens';
import { sichtungsbild, SICHTUNGSBILD_REIHE, type SichtungsbildSchluessel } from './personenBilanz';

/**
 * Das Sichtungsbild als EINE Zeile über der Betroffenenliste (LFH-963, design.md D5): am Handy und
 * am Tablet steht die Seitenleiste unter allen Zeilen, die Lagezahl muss aber im ersten Bildschirm
 * stehen. Die Zahlen kommen aus `sichtungsbild` (eine Heimat je Zahl, dieselbe Menge wie die
 * Seitenleiste).
 *
 * Zahl vor Wort (Klärungsrunde Welle 4, Frage 2): „3 SK I“. SK I–IV und tot stehen immer, auch mit
 * 0 — eine fehlende Kategorie läse sich als „nicht erhoben“; „unverletzt“ und „ohne Sichtung“ nur,
 * wenn es sie gibt. Die Summe heißt „gesamt“, nicht „erfasst“: „erfasst“ ist ein Personenstatus.
 *
 * Bricht um, statt waagerecht zu rollen: eine verdeckte Zahl wäre eine fehlende Lagezahl.
 */

const IMMER: readonly SichtungsbildSchluessel[] = ['sk1', 'sk2', 'sk3', 'sk4', 'tot'];

function wort(k: SichtungsbildSchluessel): string {
  return k === 'ohne' ? 'ohne Sichtung' : sichtung[k].label;
}

export default function Sichtungszeile({ alle }: { alle: readonly Pick<Person, 'aktuelle_sichtung'>[] }) {
  const { token, rollen } = useRollen();
  const bild = sichtungsbild(alle);
  const kategorien = SICHTUNGSBILD_REIHE.filter((k) => IMMER.includes(k) || bild.je[k] > 0);
  return (
    <ul
      aria-label="Sichtungszahlen"
      data-lfh="sichtungszeile"
      style={{
        listStyle: 'none',
        margin: 0,
        marginBottom: token.marginSM,
        padding: 0,
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        columnGap: token.margin,
        rowGap: token.marginXXS,
        fontSize: 12,
        color: rollen.text2,
      }}
    >
      <li data-sichtung-summe="">
        <span style={{ ...monoStil(14, 500), color: rollen.text }}>{bild.gesamt}</span> gesamt
      </li>
      {kategorien.map((k) => {
        const farbe = k === 'ohne' ? null : sichtung[k].farbe;
        return (
          <li
            key={k}
            data-sichtung-zahl={k}
            style={{ display: 'inline-flex', alignItems: 'center', gap: token.marginXXS }}
          >
            {/* Farbfeld wie in der Seitenleiste; die Umrandung macht Gelb am Tag und Schwarz
                nachts sichtbar. Der zweite Kanal ist das Wort. */}
            <span
              aria-hidden="true"
              style={{
                display: 'inline-block',
                width: 8,
                height: 8,
                background: farbe ? sichtungsfarben[farbe] : 'transparent',
                border: `1px solid ${k === 'ohne' ? token.colorTextTertiary : token.colorText}`,
              }}
            />
            <span style={{ ...monoStil(14, 500), color: rollen.text }}>{bild.je[k]}</span>
            <span>{wort(k)}</span>
          </li>
        );
      })}
    </ul>
  );
}
