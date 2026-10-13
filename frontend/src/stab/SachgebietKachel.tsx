import { Button } from 'antd';
import type { CSSProperties } from 'react';
import type { ModulFreigaben, Stabsfunktion } from '../api/types';
import { Paneel } from '../components/instrument';
import { fugenrasterGrund } from '../components/instrument/fugenraster';
import { useRollen } from '../components/instrument/rollenwerte';
import StatusTag from '../components/StatusTag';
import { besetzungDarstellung } from './besetzung';
import type { SachgebietEintrag } from './sachgebiete';
import WerkzeugZelle from './WerkzeugZelle';
import { werkzeugZahl, type WerkzeugZahlQuellen } from './werkzeugZahlen';
import { werkzeugZustand, type SichtbaresWerkzeug } from './werkzeuge';

/** Das Raster der Werkzeuge: Fugenraster, zwei Spalten ab rund 300 px Körperbreite. Rein. */
export function werkzeugRasterStil(rollen: Parameters<typeof fugenrasterGrund>[0]): CSSProperties {
  return {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(150px, 100%), 1fr))',
    gridAutoRows: '1fr',
    ...fugenrasterGrund(rollen),
  };
}

/**
 * Eine Kachel der Stab-Seite (LLH-1124, `openspec/changes/o5nxgqbl-stab-uebersicht/design.md`, D1):
 * ein Paneel mit Kennung und wirksamem Label als Überschrift, die Besetzung als Chip im Kopf (erst
 * mit Daten: vorher wird nichts über sie behauptet), „Besetzung ändern“ als Kopfaktion nur mit
 * Schreibrecht. Im Körper die gekürzte Aufgabenzeile mit nie gekürzter Fundstelle (D7) und die
 * Werkzeuge im Fugenraster (D2–D4). Die Kachel selbst ist kein Ziel.
 */
export default function SachgebietKachel({
  einsatzId,
  eintrag,
  zeile,
  hatBesetzung,
  darfSchreiben,
  freigaben,
  zahlQuellen,
  onBesetzungAendern,
}: {
  einsatzId: number;
  eintrag: SachgebietEintrag;
  zeile: Stabsfunktion | undefined;
  /** Ob die Besetzung geladen ist. */
  hatBesetzung: boolean;
  darfSchreiben: boolean;
  freigaben: ModulFreigaben | undefined;
  zahlQuellen: WerkzeugZahlQuellen;
  onBesetzungAendern: () => void;
}) {
  const { token, rollen } = useRollen();
  const titel = `${eintrag.kuerzel} · ${eintrag.label}`;
  const werkzeuge = eintrag.werkzeuge
    .map((w) => werkzeugZustand(eintrag.sachgebiet, w, freigaben))
    .filter((w): w is SichtbaresWerkzeug => w.zustand !== 'fehlt');

  return (
    <Paneel
      titel={titel}
      meta={hatBesetzung ? <StatusTag darstellung={besetzungDarstellung(zeile)} /> : undefined}
      aktion={
        darfSchreiben && hatBesetzung ? (
          <Button
            aria-label={`Besetzung ändern – ${eintrag.kuerzel} ${eintrag.label}`}
            onClick={onBesetzungAendern}
          >
            Besetzung ändern
          </Button>
        ) : undefined
      }
      style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: token.marginXS,
          minWidth: 0,
          paddingBlock: token.paddingSM,
          paddingInline: token.padding,
          color: rollen.text2,
        }}
      >
        {/* Gekürzt auf eine Zeile, voll im DOM und im `title`; den ganzen Text trägt die Hilfe. */}
        <span
          title={eintrag.aufgaben}
          style={{
            flex: '0 1 auto',
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {eintrag.aufgaben}
        </span>
        {/* Fundstelle ist Quelle, keine Bedienerklärung: sichtbar, nie gekürzt. */}
        <span style={{ flex: 'none', color: rollen.gedaempft, fontSize: 12 }}>
          {`FwDV 100 Anl. 2, S. ${eintrag.seite}`}
        </span>
      </div>
      {werkzeuge.length > 0 && (
        <div
          role="group"
          aria-label={`Werkzeuge ${eintrag.kuerzel}`}
          data-fugenraster
          style={{ ...werkzeugRasterStil(rollen), borderInline: 'none', borderBlockEnd: 'none' }}
        >
          {werkzeuge.map((w) => (
            <WerkzeugZelle
              key={w.key}
              einsatzId={einsatzId}
              werkzeug={w}
              zahl={werkzeugZahl(w, zahlQuellen)}
            />
          ))}
        </div>
      )}
    </Paneel>
  );
}
