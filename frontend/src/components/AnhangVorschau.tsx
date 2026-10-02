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
  type RefObject,
} from 'react';
import { Image } from 'antd';
import { QueryClientContext, useQuery } from '@tanstack/react-query';
import { useRollen } from './instrument/rollenwerte';
import {
  einsatzIdAusPfad,
  grossansichtPfad,
  hatServerVorschau,
  istHeicMime,
  vorschauPfad,
} from '../api/anhangFassung';
import { einsatzKeys } from '../api/queryKeys';

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

/** Dateityp-Kürzel für den Platzhalter (`dach.jpg` → `JPG`). */
function typKuerzel(dateiname: string, mime: string | null | undefined): string {
  const punkt = dateiname.lastIndexOf('.');
  if (punkt > 0 && punkt < dateiname.length - 1) return dateiname.slice(punkt + 1).toUpperCase();
  return (mime?.split('/')[1] ?? 'Datei').toUpperCase();
}

/** Ob es für diesen Anhang überhaupt eine Vorschau gibt (vom Server oder auf dem Gerät). */
function hatVorschau(mime: string | null | undefined): boolean {
  return hatServerVorschau(mime) || istHeicMime(mime);
}

export default function AnhangVorschau(props: Props) {
  const gruppe = useContext(Gruppe);
  if (gruppe == null && hatVorschau(props.mime)) {
    return (
      <AnhangVorschauGruppe>
        <Kachel {...props} />
      </AnhangVorschauGruppe>
    );
  }
  return <Kachel {...props} />;
}

function Kachel(props: Props) {
  const client = useContext(QueryClientContext);
  if (hatServerVorschau(props.mime)) {
    return (
      <KachelAnzeige
        {...props}
        quellen={{ klein: vorschauPfad(props.href), gross: grossansichtPfad(props.href) }}
      />
    );
  }
  // HEIC braucht den Query-Cache (Object-URLs, Freigabe beim Verlassen). Ohne Provider, etwa in
  // einem nackt gerenderten Bauteil, gibt es keine Vorschau, aber auch keinen Fehler.
  if (istHeicMime(props.mime) && client != null) return <HeicKachel {...props} />;
  return null;
}

/** Stil des Quadrats, gemeinsam für Bild, Ladeplatz und Platzhalter. */
function useKachelStil() {
  const { token, rollen } = useRollen();
  return {
    token,
    rollen,
    kachel: {
      ...vorschauKachelStil(token),
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 0,
      border: `1px solid ${rollen.linie}`,
      borderRadius: 0,
      background: rollen.flaeche2,
      overflow: 'hidden',
    } as const,
  };
}

function Platzhalter({ dateiname, mime }: Pick<Props, 'dateiname' | 'mime'>) {
  const { token, rollen, kachel } = useKachelStil();
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

/** Ergebnis der HEIC-Dekodierung im Query-Cache: zwei Object-URLs oder ein stiller Fehler. */
type HeicErgebnis = { klein: string; gross: string } | { fehler: true };

/** Einmal sichtbar, bleibt sichtbar. Ohne `IntersectionObserver` (jsdom) nie: dort gibt es nichts zu sehen. */
function useEinmalSichtbar(ref: RefObject<HTMLElement | null>): boolean {
  const [sichtbar, setSichtbar] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (sichtbar || el == null || typeof IntersectionObserver === 'undefined') return;
    const beobachter = new IntersectionObserver((eintraege) => {
      if (eintraege.some((e) => e.isIntersecting)) {
        setSichtbar(true);
        beobachter.disconnect();
      }
    });
    beobachter.observe(el);
    return () => beobachter.disconnect();
  }, [ref, sichtbar]);
  return sichtbar;
}

/**
 * HEIC/HEIF (design.md D8): die bereinigte Fassung wird erst geladen und auf dem Gerät
 * dekodiert, wenn die Kachel sichtbar wird; der Decoder (Worker + WASM) kommt erst dann per
 * `import()`. Fehler bleiben still (Platzhalter), sie gehen nicht an den globalen Handler.
 */
function HeicKachel(props: Props) {
  const { kachel } = useKachelStil();
  const platz = useRef<HTMLSpanElement>(null);
  const sichtbar = useEinmalSichtbar(platz);
  const abfrage = useQuery({
    queryKey: einsatzKeys.anhangHeicVorschau(einsatzIdAusPfad(props.href) ?? 0, props.href),
    queryFn: async (): Promise<HeicErgebnis> => {
      try {
        const { dekodiereHeic } = await import('../heic/dekodiereHeic');
        const { klein, gross } = await dekodiereHeic(props.href);
        return { klein: URL.createObjectURL(klein), gross: URL.createObjectURL(gross) };
      } catch {
        return { fehler: true };
      }
    },
    enabled: sichtbar,
    // Ein Ergebnis gilt für immer (ein Anhang ändert sich nie), ein Fehler nicht: beim nächsten
    // Einblenden, etwa wieder mit Netz, versucht es die Kachel neu.
    staleTime: (q) => (q.state.data != null && !('fehler' in q.state.data) ? Infinity : 0),
    gcTime: 5 * 60_000,
    retry: false,
  });
  const daten = abfrage.data;
  if (daten == null) {
    return <span ref={platz} data-lfh="anhang-vorschau-laedt" aria-hidden="true" style={kachel} />;
  }
  if ('fehler' in daten) return <Platzhalter dateiname={props.dateiname} mime={props.mime} />;
  return <KachelAnzeige {...props} quellen={daten} />;
}

function KachelAnzeige({ mime, dateiname, kennung, quellen }: Props & { quellen: Quellen }) {
  const gruppe = useContext(Gruppe);
  const { kachel } = useKachelStil();
  const id = useId();
  const [fehler, setFehler] = useState(false);
  const gross = quellen.gross;

  useEffect(() => {
    if (gruppe == null || fehler) return;
    return gruppe.registriere(id, gross);
  }, [gruppe, id, gross, fehler]);

  if (fehler) return <Platzhalter dateiname={dateiname} mime={mime} />;

  const name = kennung ? `${dateiname}, ${kennung}` : dateiname;
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
