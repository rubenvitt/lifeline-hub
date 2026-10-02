import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Image } from 'antd';
import { useRollen } from './instrument/rollenwerte';
import { grossansichtPfad, hatServerVorschau, vorschauPfad } from '../api/anhangFassung';

/**
 * Vorschaubild an Bild-Anhängen (LFH-759, Spec `anhang-vorschau`, Herleitung
 * `openspec/changes/lfh-759-bildvorschau-anhaenge/design.md` D7).
 *
 * - Ein quadratisches Bedienziel in der Mindesthöhe der Dichte mit dem Vorschaubild; der Platz
 *   steht vor dem Laden fest, nichts springt.
 * - Klick oder Enter öffnet die Großansicht als Überlagerung in der App (antd `Image`), nie einen
 *   Tab: die Desktop-Hülle machte aus jeder `/api/`-Navigation einen Download.
 * - Kann das Bild nicht laden (ohne Netz, 422, Decoder-Fehler), steht ein stiller Platzhalter da.
 * - Nie `fassung=original`: die Anzeige nimmt die Vorschau-Fassungen bzw. bei HEIC die bereinigte.
 */

/**
 * Stil der Kachel: ein Quadrat mit der Kante `controlHeight` (30 / 48 / 72 px). Rein und
 * exportiert, damit der Boden ohne Render über die Dichtestufen prüfbar ist.
 */
export function vorschauKachelStil(token: { controlHeight: number }) {
  return {
    width: token.controlHeight,
    height: token.controlHeight,
    flexShrink: 0,
    boxSizing: 'border-box',
  } as const;
}

/** Bildquellen einer Vorschau: klein für die Kachel, groß für die Großansicht. */
interface Quellen {
  klein: string;
  gross: string;
}

interface GruppenKontext {
  registriere: (id: string, gross: string) => () => void;
  oeffne: (id: string, ausloeser: HTMLElement) => void;
}

const Gruppe = createContext<GruppenKontext | null>(null);

/**
 * Fasst die Bilder einer Nachricht, eines Eintrags oder eines Schadens zusammen: die
 * Großansicht blättert zwischen ihnen (Pfeiltasten, Knöpfe). Ohne Gruppe öffnet jedes
 * Vorschaubild seine eigene Großansicht.
 */
export function AnhangVorschauGruppe({ children }: { children: ReactNode }) {
  const [eintraege, setEintraege] = useState<{ id: string; gross: string }[]>([]);
  const [offen, setOffen] = useState(false);
  const [aktuell, setAktuell] = useState(0);
  const ausloeserRef = useRef<HTMLElement | null>(null);
  const eintraegeRef = useRef(eintraege);
  eintraegeRef.current = eintraege;

  const registriere = useCallback((id: string, gross: string) => {
    setEintraege((alt) => {
      const i = alt.findIndex((e) => e.id === id);
      if (i < 0) return [...alt, { id, gross }];
      const neu = alt.slice();
      neu[i] = { id, gross };
      return neu;
    });
    return () => setEintraege((alt) => alt.filter((e) => e.id !== id));
  }, []);

  const oeffne = useCallback((id: string, ausloeser: HTMLElement) => {
    const i = eintraegeRef.current.findIndex((e) => e.id === id);
    if (i < 0) return;
    ausloeserRef.current = ausloeser;
    setAktuell(i);
    setOffen(true);
  }, []);

  const kontext = useMemo(() => ({ registriere, oeffne }), [registriere, oeffne]);

  // Fokus zurück auf das auslösende Vorschaubild (Spec: „Großansicht in der App“), sobald die
  // Großansicht zu ist. Nicht erst nach der Ausblend-Animation (`afterOpenChange`): bis dahin
  // stünde der Fokus im Leeren. Der Effekt läuft nach dem Lösen der Fokusfalle der Vorschau.
  const warOffen = useRef(false);
  useEffect(() => {
    if (warOffen.current && !offen) ausloeserRef.current?.focus();
    warOffen.current = offen;
  }, [offen]);

  return (
    <Gruppe.Provider value={kontext}>
      {children}
      {eintraege.length > 0 && (
        <Image.PreviewGroup
          items={eintraege.map((e) => e.gross)}
          preview={{
            open: offen,
            current: aktuell,
            onChange: (c) => setAktuell(c),
            onOpenChange: (o) => setOffen(o),
          }}
        />
      )}
    </Gruppe.Provider>
  );
}

interface Props {
  /** Download-Adresse der bereinigten Fassung (dieselbe wie am Download-Verweis). */
  href: string;
  /** MIME-Typ des Anhangs; nur Bilder bekommen eine Vorschau. */
  mime: string | null | undefined;
  dateiname: string;
  /** Zeilenkennung für den zugänglichen Namen („Nr. 4“, „Schaden S-003“). */
  kennung?: string;
}

/** Quellen vom Server, oder `null`, wenn es für diesen Typ keine Vorschau gibt. */
function useQuellen(href: string, mime: string | null | undefined): Quellen | null {
  return useMemo(
    () =>
      hatServerVorschau(mime) ? { klein: vorschauPfad(href), gross: grossansichtPfad(href) } : null,
    [href, mime],
  );
}

/** Dateityp-Kürzel für den Platzhalter (`dach.jpg` → `JPG`). */
function typKuerzel(dateiname: string, mime: string | null | undefined): string {
  const punkt = dateiname.lastIndexOf('.');
  if (punkt > 0 && punkt < dateiname.length - 1) return dateiname.slice(punkt + 1).toUpperCase();
  return (mime?.split('/')[1] ?? 'Datei').toUpperCase();
}

export default function AnhangVorschau(props: Props) {
  const gruppe = useContext(Gruppe);
  if (gruppe == null && (hatServerVorschau(props.mime) || false)) {
    return (
      <AnhangVorschauGruppe>
        <Kachel {...props} />
      </AnhangVorschauGruppe>
    );
  }
  return <Kachel {...props} />;
}

function Kachel({ href, mime, dateiname, kennung }: Props) {
  const gruppe = useContext(Gruppe);
  const { token, rollen } = useRollen();
  const id = useId();
  const quellen = useQuellen(href, mime);
  const [fehler, setFehler] = useState(false);
  const gross = quellen?.gross;

  useEffect(() => {
    if (gruppe == null || gross == null || fehler) return;
    return gruppe.registriere(id, gross);
  }, [gruppe, id, gross, fehler]);

  if (quellen == null) return null;

  const kachel = {
    ...vorschauKachelStil(token),
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    border: `1px solid ${rollen.linie}`,
    borderRadius: 0,
    background: rollen.flaeche2,
    overflow: 'hidden',
  } as const;
  const name = kennung ? `${dateiname}, ${kennung}` : dateiname;

  if (fehler) {
    return (
      <span
        role="img"
        aria-label={`Keine Vorschau: ${dateiname}`}
        data-lfh="anhang-vorschau-platzhalter"
        style={{
          ...kachel,
          color: rollen.text2,
          fontFamily: token.fontFamilyCode,
          fontSize: token.fontSizeSM,
        }}
      >
        {typKuerzel(dateiname, mime)}
      </span>
    );
  }

  return (
    <button
      type="button"
      aria-label={`Vorschau: ${name}`}
      data-lfh="anhang-vorschau"
      onClick={(e) => gruppe?.oeffne(id, e.currentTarget)}
      style={{ ...kachel, cursor: 'zoom-in' }}
    >
      <img
        src={quellen.klein}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setFehler(true)}
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
      />
    </button>
  );
}
