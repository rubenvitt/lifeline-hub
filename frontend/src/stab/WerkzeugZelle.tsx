import { Button } from 'antd';
import type { CSSProperties } from 'react';
import { Link } from 'react-router';
import { kennzahlZielStil, type KennzahlTon } from '../components/instrument/Kennzahl';
import { monoStil, useRollen } from '../components/instrument/rollenwerte';
import { sprungGesperrtText } from '../components/Sprung';
import { KEINE_BERECHTIGUNG } from '../einsatz/modulRegistry';
import type { Farbrollen } from '../theme/tokens';
import type { WerkzeugZahl } from './werkzeugZahlen';
import type { SichtbaresWerkzeug } from './werkzeuge';

/**
 * Stile der Werkzeugzelle — rein und exportiert („Handgebautes Bedienziel“, `frontend/AGENTS.md`).
 * Zelle, Ziel und Eskalationskante wie die klickbare Kennzahl (`kennzahlZielStil`): derselbe Boden
 * je Dichtestufe, derselbe Einzug zwischen zwei Zielen im Fugenraster (LFH-630), dieselbe Kante bei
 * Achtung. Nur die Lücke zwischen den Zeilen ist enger, weil der Name statt der Zahl führt.
 */
export function werkzeugZelleStil(
  rollen: Pick<Farbrollen, 'text' | 'achtung' | 'alarm'>,
  token: { controlHeight: number; padding: number; paddingLG: number; marginXS: number },
  ton: KennzahlTon,
  zustand: WerkzeugZahl['zustand'],
): { zelle: CSSProperties; ziel: CSSProperties; kante: CSSProperties | null } {
  const stil = kennzahlZielStil(rollen, token, ton, zustand);
  return { ...stil, ziel: { ...stil.ziel, gap: 2, justifyContent: 'center' } };
}

const EINZEILIG: CSSProperties = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

/**
 * Ein Werkzeug einer Kachel der Stab-Seite (LLH-1124, `openspec/changes/o5nxgqbl-stab-uebersicht/
 * design.md`, D3): der Name führt, die Zahl steht rechts daneben in Mono, darunter die Notiz
 * (Bedeutung oder Grund, einzeilig, voller Text im `title` und im zugänglichen Namen).
 *
 * Gesperrt (D2) ist es ein gesperrter Knopf mit dem Grund im sichtbaren Text, ohne Zahl — wie
 * `GesperrterSprung`, aber in der Breite der Zelle. Ohne Zahl bleibt die Zellform gleich, damit
 * alle Werkzeuge einer Kachel gleich große Ziele sind.
 */
export default function WerkzeugZelle({
  einsatzId,
  werkzeug,
  zahl,
}: {
  einsatzId: number;
  werkzeug: SichtbaresWerkzeug;
  zahl: WerkzeugZahl | null;
}) {
  const { token, rollen } = useRollen();
  const zustand = zahl?.zustand ?? 'daten';
  const ton: KennzahlTon = zahl?.zustand === 'daten' ? zahl.ton : 'neutral';
  const { zelle, ziel, kante } = werkzeugZelleStil(rollen, token, ton, zustand);

  if (werkzeug.zustand === 'gesperrt') {
    return (
      <div className="lfh-kennzahl" data-lfh="werkzeug-zelle" style={zelle}>
        <Button
          disabled
          block
          title={KEINE_BERECHTIGUNG}
          style={{ height: 'auto', minHeight: token.controlHeight, whiteSpace: 'normal' }}
        >
          {sprungGesperrtText(werkzeug.label)}
        </Button>
      </div>
    );
  }

  const wert =
    zahl == null ? null : zahl.zustand === 'daten' ? (
      <b style={{ font: 'inherit' }}>{zahl.wert}</b>
    ) : zahl.zustand === 'laden' ? (
      <b aria-busy="true" style={{ font: 'inherit' }}>
        ····
      </b>
    ) : (
      <b title="Stand unbekannt" style={{ font: 'inherit' }}>
        ?
      </b>
    );
  const notiz = zahl?.notiz;
  const name = [werkzeug.label, zahl != null && zahl.zustand === 'daten' ? zahl.wert : null, notiz]
    .filter((teil) => teil != null)
    .join(', ');

  return (
    <div className="lfh-kennzahl" data-lfh="werkzeug-zelle" style={zelle}>
      <Link
        to={werkzeug.pfad(einsatzId)}
        aria-label={name}
        title={zahl?.zustand === 'daten' ? zahl.beschreibung : undefined}
        className="lfh-kennzahl__ziel"
        data-lfh="werkzeug"
        data-ton={ton}
        style={ziel}
      >
        <span style={{ display: 'flex', alignItems: 'baseline', gap: token.marginXS }}>
          <span
            style={{
              ...EINZEILIG,
              flex: '1 1 auto',
              fontSize: 14,
              fontWeight: 500,
              color: rollen.bedienText,
            }}
          >
            {werkzeug.label}
          </span>
          {wert != null && (
            <span
              data-lfh="werkzeug-wert"
              style={{
                ...monoStil(22, 500),
                lineHeight: 1,
                flex: 'none',
                color: zustand === 'daten' && ton === 'achtung' ? rollen.achtungText : rollen.text,
              }}
            >
              {wert}
            </span>
          )}
        </span>
        {notiz != null && (
          <span
            data-lfh="werkzeug-notiz"
            title={notiz}
            style={{ ...EINZEILIG, fontSize: 11, lineHeight: 1.4, color: rollen.gedaempft }}
          >
            {notiz}
          </span>
        )}
      </Link>
      {kante != null && <span aria-hidden="true" data-lfh="werkzeug-kante" style={kante} />}
    </div>
  );
}
