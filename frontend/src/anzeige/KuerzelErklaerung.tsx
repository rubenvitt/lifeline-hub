import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type SyntheticEvent,
} from 'react';
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

/** Tasten, die der Knopf selbst bedient; sie lösen im Tabellenkopf sonst das Sortieren aus. */
const KNOPF_TASTEN = new Set(['Enter', ' ']);

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
  const verweis = useRef<HTMLAnchorElement>(null);

  // Das Fenster hängt im Portal am Ende der Seite; ohne diesen Schritt erreichte Tab den Verweis
  // erst nach der ganzen Seite (Review B8).
  useEffect(() => {
    if (!offen) return;
    const zeit = window.setTimeout(() => verweis.current?.focus());
    return () => window.clearTimeout(zeit);
  }, [offen]);

  const schliesse = () => {
    setOffen(false);
    knopf.current?.focus();
  };

  const inhalt = (
    // Der Inhalt hängt im Portal, React reicht seine Ereignisse trotzdem an die Vorfahren weiter.
    // Tasten bleiben hier (sonst wählte Enter in der Sprungpalette einen Treffer). Ein Klick auf
    // den Verweis geht weiter, damit Umgebungen, die bei Verweisen schließen, ihn sehen
    // (`command-palette/AGENTS.md`, Review B1); das Fenster geht dabei zu.
    <div
      className="lfh-kuerzel-erklaerung"
      onClick={(e: MouseEvent) => {
        if ((e.target as Element).closest('a[href]')) setOffen(false);
        else halte(e);
      }}
      onKeyDown={(e: KeyboardEvent) => {
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
      <Link ref={verweis} to={KAPITEL_PFAD}>
        Zeiten und Kürzel
      </Link>
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
          // Geschlossen gehören Esc und Pfeile der Umgebung (Palette: Esc/← zurück, Review B2).
          if (KNOPF_TASTEN.has(e.key)) halte(e);
          else if (e.key === 'Escape' && offen) {
            halte(e);
            schliesse();
          }
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
