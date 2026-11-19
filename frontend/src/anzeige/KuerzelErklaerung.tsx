import { Fragment, useRef, useState, type ReactNode, type SyntheticEvent } from 'react';
import { Popover } from 'antd';
import { Link } from 'react-router';
import { EINGEFUEHRTE_KUERZEL, type EingefuehrtesKuerzel, type Kuerzel } from './kuerzel';
import { STAERKE_SCHREIBWEISE } from './staerke';
import './KuerzelErklaerung.css';

/** Das Kapitel, in dem jedes eingeführte Kürzel steht (`docs/anwender/kapitel/zeiten-und-kuerzel.md`). */
const KAPITEL_PFAD = '/hilfe/zeiten-und-kuerzel';

/** Klicks und Tasten bleiben am Kürzel: Zeile, Karte oder Tabellenkopf darum lösen nicht aus. */
function halte(e: SyntheticEvent) {
  e.stopPropagation();
}

/**
 * Ein eingeführtes Kürzel, das sich an Ort und Stelle erklärt (LLH-1825, `frontend/AGENTS.md`,
 * „Kürzel sind eingeführt oder erklärt“). Die sichtbare Schreibweise ist ein Knopf ohne Knopfoptik
 * (gepunktet unterstrichen); Tippen, Klick oder Enter öffnet ein Popover mit Bedeutung, Beispiel
 * und dem Weg ins Kapitel „Zeiten und Kürzel“. Ein Tooltip allein trüge auf Touch nicht.
 *
 * Nie in einem Link oder Knopf einsetzen (kein Knopf im Link): dort steht die Schreibweise als Text
 * und der Baustein einmal im Kopf der Fläche.
 */
export default function KuerzelErklaerung({
  kuerzel,
  children,
}: {
  kuerzel: Kuerzel;
  /** Sichtbarer Text, Vorgabe das Kürzel selbst (etwa mit `<wbr>` für schmale Spalten). */
  children?: ReactNode;
}) {
  const eintrag: EingefuehrtesKuerzel = EINGEFUEHRTE_KUERZEL.find((k) => k.kuerzel === kuerzel)!;
  const [offen, setOffen] = useState(false);
  const knopf = useRef<HTMLButtonElement>(null);

  const schliesse = () => {
    setOffen(false);
    knopf.current?.focus();
  };

  const inhalt = (
    // Der Inhalt hängt im Portal, React reicht seine Klicks trotzdem an die Vorfahren weiter.
    <div
      className="lfh-kuerzel-erklaerung"
      onClick={halte}
      onKeyDown={(e) => {
        halte(e);
        if (e.key === 'Escape') schliesse();
      }}
    >
      <p className="lfh-kuerzel-bedeutung">{eintrag.bedeutung}</p>
      {eintrag.beispiel && (
        <p className="lfh-kuerzel-beispiel" data-testid="kuerzel-beispiel">
          {eintrag.beispiel}
        </p>
      )}
      <Link to={KAPITEL_PFAD}>Zeiten und Kürzel</Link>
    </div>
  );

  return (
    <Popover
      trigger="click"
      open={offen}
      onOpenChange={setOffen}
      title={eintrag.kuerzel}
      content={inhalt}
    >
      <button
        ref={knopf}
        type="button"
        className="lfh-kuerzel"
        aria-label={`${eintrag.kuerzel}: ${eintrag.bedeutung}, Erklärung öffnen`}
        aria-expanded={offen}
        onClick={halte}
        onKeyDown={(e) => {
          halte(e);
          if (e.key === 'Escape' && offen) schliesse();
        }}
      >
        {children ?? eintrag.kuerzel}
      </button>
    </Popover>
  );
}

/**
 * Die Schreibweise der Stärke „F/UF/M//Σ“, antippbar erklärt (`STAERKE_SCHREIBWEISE`).
 * `umbruchVorSumme`: in schmalen Spalten bricht sie nur vor der Summe („F/UF/M“ · „//Σ“), nicht an
 * jedem Strich (`e2e/meldebild-druck.spec.ts`, „kein Kopf bricht im Wort“).
 */
export function StaerkeSchreibweise({
  children,
  umbruchVorSumme = false,
}: {
  children?: ReactNode;
  umbruchVorSumme?: boolean;
}) {
  const text = umbruchVorSumme
    ? STAERKE_SCHREIBWEISE.split(/(?=\/\/)/).map((teil, i) => (
        <Fragment key={teil}>
          {i > 0 && <wbr />}
          <span style={{ whiteSpace: 'nowrap' }}>{teil}</span>
        </Fragment>
      ))
    : children;
  return <KuerzelErklaerung kuerzel="F/UF/M//Σ">{text}</KuerzelErklaerung>;
}
