import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useRollen } from './instrument/rollenwerte';
import { useFormularVerlassenSchutz } from './useFormularVerlassenSchutz';
import VerlassenRueckfrage, { VerlassenDialog } from './VerlassenRueckfrage';

/**
 * Merker „offene Bearbeitung“ einer Ansicht mit feldweiser Bearbeitung (LLH-1103, Change
 * `f8218h1i-personendaten-feldweise`, design.md D4; Specs `formularseiten`, „Rückfrage vor dem
 * Verlassen“, und `personendaten-bearbeiten`, „Eine offene Bearbeitung zur Zeit“).
 *
 * Eine Ansicht ohne Speichern-Leiste, deren Angaben je Feld gespeichert werden (`InlineAngabe`),
 * hält höchstens EINE offene, geänderte Bearbeitung. Solange es sie gibt,
 * - hält `VerlassenRueckfrage` jeden Pfadwechsel an („Bleiben“/„Verwerfen“), und der Merker
 *   `useFormularVerlassenSchutz` warnt beim Schließen oder Neuladen des Tabs;
 * - bekommt jedes andere angemeldete Feld den Sperrgrund „Erst „Name“ speichern oder abbrechen“.
 *
 * ```tsx
 * <OffeneBearbeitungProvider aktiv={darfSchreiben} schluessel={personId}>
 *   …
 *   const bearbeitung = useOffeneBearbeitung('Name');
 *   <InlineAngabe etikett="Name" … gesperrt={ohneNetz ?? bearbeitung.gesperrt}
 *     onEntwurf={bearbeitung.onEntwurf} />
 * </OffeneBearbeitungProvider>
 * ```
 *
 * - **Ein offenes Feld ohne Änderung meldet sich nicht an** (`InlineAngabe` meldet über
 *   `onEntwurf` nur „geändert“); es löst keine Rückfrage aus und sperrt nichts. Bekommt ein
 *   anderes Feld einen Entwurf, schließt es (die Sperre schließt eine unveränderte Bearbeitung).
 * - **Der Halter ist nie gesperrt**, sonst könnte er weder speichern noch abbrechen. Melden sich
 *   doch zwei an (gleichzeitig geändert), hält der erste; beide sind dann frei.
 * - **Braucht einen Data Router** (`useBlocker` in `VerlassenRueckfrage`), in Tests
 *   `renderMitProviders(…, { datenRouter: true })`.
 * - **Ohne Provider** sperrt der Hook nichts und meldet ins Leere: dieselben Felder dürfen in einer
 *   Lesefassung ohne Seitenkontext stehen.
 * - `aktiv` (Schreibrecht) und `schluessel` (Datensatz-ID) gehen an `useFormularVerlassenSchutz`.
 *
 * - **Paneele belegen die Seite schon beim Öffnen** (LLH-1139, `BearbeitbaresPaneel`, Spec
 *   `formularseiten`, „Eine offene Bearbeitung je Ansicht“): `useOffeneBearbeitungBelegung` meldet
 *   `offen` (sperrt die übrigen, keine Rückfrage) und `geaendert` (dazu der Verlassen-Schutz).
 * - Die Rückfrage hängt nur ein, solange etwas angemeldet ist: eine Seite ohne offene Bearbeitung
 *   braucht keinen Data Router.
 * - **Wechsel in der Seite** (LLH-1415): eine Segmentleiste oder ein Reiter ohne Pfadwechsel, der
 *   die offene Bearbeitung aushängt, geht über `useWechselNachRueckfrage` — dieselbe Rückfrage
 *   (`VerlassenDialog`), ohne Änderung still. Der Provider muss dafür auch die Leiste umfassen.
 * - **Eine `InlineAngabe` ohne eigenes `onEntwurf` meldet sich selbst an** (LLH-1468): ein Provider
 *   um die Seite genügt für die Rückfrage (Fahrzeuge, Material).
 * - **Listenseiten sperren über EINE Grundzeile** (LLH-1480): stellt die Seite
 *   `OffeneBearbeitungGrundZeile` auf (Werkzeugzeile der Liste), sperren sich die selbst
 *   angemeldeten Inline-Angaben und die `BemerkungZelle`n der Seite, solange ein anderes Feld einen
 *   Entwurf hat, und verweisen per `aria-describedby` auf diese Zeile. Ohne Grundzeile sperren sie
 *   nicht: in einer Liste stünde der Grund sonst unter jeder Zelle jeder Zeile. Wer selbst
 *   verdrahtet (`useOffeneBearbeitung`, eigene Grundzeile), bleibt dabei (Personendaten).
 */

/** Sperrgrund für die übrigen Felder; wenige Wörter (`frontend/AGENTS.md`, „Texte“). */
export function sperrGrundOffeneBearbeitung(etikett: string): string {
  return `Erst „${etikett}“ speichern oder abbrechen`;
}

interface Eintrag {
  id: string;
  etikett: string;
  /** `false`: offen ohne Änderung (ein Paneel im Bearbeiten-Zustand) — sperrt, fragt nicht. */
  geaendert: boolean;
}

interface OffeneBearbeitungContextValue {
  /** Der Halter: das erste angemeldete Feld mit Entwurf. */
  halter: Eintrag | null;
  isAngemeldet: (id: string) => boolean;
  anmelden: (eintrag: Eintrag) => void;
  abmelden: (id: string) => void;
  /** Führt `wechsel` aus, mit geänderter offener Bearbeitung erst nach „Verwerfen“. */
  nachRueckfrage: (wechsel: () => void) => void;
  /** Kennung der Grundzeile der Seite (`OffeneBearbeitungGrundZeile`), solange sie steht. */
  grundOrt: string | null;
  setzeGrundOrt: (id: string) => void;
  raeumeGrundOrt: (id: string) => void;
}

const OffeneBearbeitungContext = createContext<OffeneBearbeitungContextValue | null>(null);

export function OffeneBearbeitungProvider({
  aktiv = true,
  schluessel,
  children,
}: {
  aktiv?: boolean;
  schluessel?: string | number | null;
  children: ReactNode;
}) {
  const [eintraege, setEintraege] = useState<Eintrag[]>([]);
  const { ungespeichert, geaendert, fassung, gespeichert } = useFormularVerlassenSchutz({
    aktiv,
    schluessel,
  });
  const hatEntwurf = eintraege.some((e) => e.geaendert);
  // Ein Wechsel in der Seite, der auf die Rückfrage wartet (in ein Objekt gepackt: `useState`
  // riefe eine Funktion als Updater auf).
  const [angehalten, setAngehalten] = useState<{ wechsel: () => void } | null>(null);
  const [grundOrt, setGrundOrt] = useState<string | null>(null);
  const raeumeGrundOrt = useCallback(
    (id: string) => setGrundOrt((alt) => (alt === id ? null : alt)),
    [],
  );

  useEffect(() => {
    if (hatEntwurf) geaendert();
    else gespeichert(fassung());
  }, [hatEntwurf, geaendert, gespeichert, fassung]);

  const anmelden = useCallback((eintrag: Eintrag) => {
    setEintraege((alt) => {
      const da = alt.find((e) => e.id === eintrag.id);
      if (!da) return [...alt, eintrag];
      if (da.geaendert === eintrag.geaendert) return alt;
      return alt.map((e) => (e.id === eintrag.id ? eintrag : e));
    });
  }, []);
  const abmelden = useCallback((id: string) => {
    setEintraege((alt) => (alt.some((e) => e.id === id) ? alt.filter((e) => e.id !== id) : alt));
  }, []);

  const nachRueckfrage = useCallback(
    (wechsel: () => void) => {
      if (ungespeichert) setAngehalten({ wechsel });
      else wechsel();
    },
    [ungespeichert],
  );

  useEffect(() => {
    // Wie beim Pfadwechsel: erledigt sich die Änderung, während die Rückfrage steht (die Karte
    // entfällt mit dem Live-Stand), den angehaltenen Wechsel nachholen.
    if (angehalten && !ungespeichert) {
      setAngehalten(null);
      angehalten.wechsel();
    }
  }, [angehalten, ungespeichert]);

  const wert = useMemo<OffeneBearbeitungContextValue>(
    () => ({
      halter: eintraege[0] ?? null,
      isAngemeldet: (id) => eintraege.some((e) => e.id === id),
      anmelden,
      abmelden,
      nachRueckfrage,
      grundOrt,
      setzeGrundOrt: setGrundOrt,
      raeumeGrundOrt,
    }),
    [eintraege, anmelden, abmelden, nachRueckfrage, grundOrt, raeumeGrundOrt],
  );

  return (
    <OffeneBearbeitungContext.Provider value={wert}>
      {children}
      {eintraege.length > 0 && <VerlassenRueckfrage ungespeichert={ungespeichert} />}
      {angehalten && (
        <VerlassenDialog
          offen={ungespeichert}
          onBleiben={() => setAngehalten(null)}
          onVerwerfen={() => {
            setAngehalten(null);
            angehalten.wechsel();
          }}
        />
      )}
    </OffeneBearbeitungContext.Provider>
  );
}

/** Was eine `InlineAngabe` vom Merker bekommt; Namen wie ihre Props, also spreizbar. */
export interface OffeneBearbeitung {
  /** Sperrgrund, solange ein ANDERES Feld einen Entwurf hat. */
  gesperrt: string | undefined;
  onEntwurf: (geaendert: boolean) => void;
}

/** Zustand einer Bearbeitung beim Merker: zu, offen ohne Änderung, offen mit Änderung. */
export type BelegungsZustand = 'zu' | 'offen' | 'geaendert';

function useAnmeldung(etikett: string) {
  const kontext = useContext(OffeneBearbeitungContext);
  const id = useId();
  const anmelden = kontext?.anmelden;
  const abmelden = kontext?.abmelden;

  const melde = useCallback(
    (zustand: BelegungsZustand) => {
      if (zustand === 'zu') abmelden?.(id);
      else anmelden?.({ id, etikett, geaendert: zustand === 'geaendert' });
    },
    [anmelden, abmelden, id, etikett],
  );

  // Ein Feld, das mit Entwurf aushängt (Zeile entfällt, Seite baut um), gibt die Seite frei.
  useEffect(() => () => abmelden?.(id), [abmelden, id]);

  const halter = kontext?.halter ?? null;
  const fremd = halter != null && !kontext?.isAngemeldet(id);
  const gesperrt = fremd ? sperrGrundOffeneBearbeitung(halter.etikett) : undefined;
  const grundOrt = kontext?.grundOrt;
  /** Dieselbe Sperre als Verweis auf die Grundzeile der Seite; ohne Grundzeile keine. */
  const verweis = fremd && grundOrt ? { beschreibungId: grundOrt } : undefined;
  return { gesperrt, verweis, melde };
}

/**
 * Meldet ein Feld beim Merker der Seite an. `etikett` ist das Etikett der Angabe; es steht im
 * Sperrgrund der übrigen Felder.
 */
export function useOffeneBearbeitung(etikett: string): OffeneBearbeitung {
  const { gesperrt, melde } = useAnmeldung(etikett);
  const onEntwurf = useCallback(
    (isGeaendert: boolean) => melde(isGeaendert ? 'geaendert' : 'zu'),
    [melde],
  );
  return { gesperrt, onEntwurf };
}

/**
 * Selbstanmeldung einer `InlineAngabe` ohne eigenes `onEntwurf` (LLH-1468, LLH-1480): meldet den
 * Entwurf wie `useOffeneBearbeitung`; gesperrt ist sie nur, wenn die Seite eine
 * `OffeneBearbeitungGrundZeile` aufstellt, und dann mit Verweis auf diese Zeile.
 */
export function useSelbstanmeldung(etikett: string): {
  gesperrt: { beschreibungId: string } | undefined;
  onEntwurf: (geaendert: boolean) => void;
} {
  const { verweis, melde } = useAnmeldung(etikett);
  const onEntwurf = useCallback(
    (isGeaendert: boolean) => melde(isGeaendert ? 'geaendert' : 'zu'),
    [melde],
  );
  return { gesperrt: verweis, onEntwurf };
}

/**
 * Sperre für ein Feld, das sich nicht anmeldet, weil es beim Verlassen selbst speichert
 * (`BemerkungZelle`, LLH-1480): gesperrt mit Verweis auf die Grundzeile, solange die Seite eine
 * aufstellt und ein Feld einen Entwurf hat; sonst `undefined`.
 */
export function useSeitenSperre(): { beschreibungId: string } | undefined {
  const kontext = useContext(OffeneBearbeitungContext);
  const grundOrt = kontext?.grundOrt;
  return kontext?.halter && grundOrt ? { beschreibungId: grundOrt } : undefined;
}

/**
 * Die EINE Zeile mit dem Sperrgrund einer Listenseite (LLH-1480): „Erst „Einheit zu Florian 1“
 * speichern oder abbrechen“, solange ein Feld einen Entwurf hat, sonst nichts. Solange sie steht,
 * sperren sich die selbst angemeldeten Inline-Angaben und die Bemerkungen der Seite und verweisen
 * per `aria-describedby` hierher; ohne sie sperren sie nicht. Sie gehört in die Werkzeugzeile der
 * Liste (`Datensicht`, `werkzeuge`), nie unter jede Zelle. Dort steht sie HINTER Suche und
 * Schaltern (`order`): erscheint der Grund, rückt kein Bedienziel der Zeile zur Seite. Ohne
 * Provider zeigt sie nichts.
 */
export function OffeneBearbeitungGrundZeile() {
  const kontext = useContext(OffeneBearbeitungContext);
  const { rollen } = useRollen();
  const id = useId();
  const setze = kontext?.setzeGrundOrt;
  const raeume = kontext?.raeumeGrundOrt;
  useEffect(() => {
    if (!setze || !raeume) return;
    setze(id);
    return () => raeume(id);
  }, [setze, raeume, id]);
  const halter = kontext?.halter;
  if (!halter) return null;
  return (
    <div id={id} data-lfh="offene-bearbeitung-grund" style={{ color: rollen.text2, order: 1 }}>
      {sperrGrundOffeneBearbeitung(halter.etikett)}
    </div>
  );
}

/**
 * Belegung durch eine Bearbeitung, die schon OFFEN die Seite hält (Paneel, ganze Ansicht;
 * `components/instrument/BearbeitbaresPaneel.tsx`, LLH-1139): `melde('offen')` beim Öffnen,
 * `melde('geaendert')` bei der ersten Änderung, `melde('zu')` beim Schließen.
 */
export function useOffeneBearbeitungBelegung(etikett: string): {
  gesperrt: string | undefined;
  melde: (zustand: BelegungsZustand) => void;
} {
  return useAnmeldung(etikett);
}

/** Ob ein Merker der Seite da ist; ohne legt `BearbeitbaresPaneel` seinen eigenen an. */
export function useHatOffeneBearbeitung(): boolean {
  return useContext(OffeneBearbeitungContext) != null;
}

/**
 * Wechsel nur nach Rückfrage (LLH-1415): für einen Wechsel IN der Seite (Segmentleiste, Reiter),
 * der die offene Bearbeitung aushängt. Mit geänderter offener Bearbeitung kommt erst die Rückfrage
 * des Pfadwechsels („Bleiben“ lässt alles stehen, „Verwerfen“ führt `wechsel` aus), ohne Änderung
 * oder ohne Merker der Seite wechselt es sofort.
 *
 * ```tsx
 * const nachRueckfrage = useWechselNachRueckfrage();
 * <Segmentleiste wert={ansicht} onWechsel={(w) => nachRueckfrage(() => setAnsicht(w))} … />
 * ```
 *
 * „Verwerfen“ verwirft nur, weil der Wechsel die Bearbeitung aushängt; ein Wechsel, der sie stehen
 * lässt, braucht keine Rückfrage. Der Aufrufer muss unter dem `OffeneBearbeitungProvider` liegen.
 */
export function useWechselNachRueckfrage(): (wechsel: () => void) => void {
  return useContext(OffeneBearbeitungContext)?.nachRueckfrage ?? sofort;
}

const sofort = (wechsel: () => void) => wechsel();

/**
 * Der Sperrgrund der Seite, solange ein Feld einen Entwurf hat, sonst `undefined`: für EINE Zeile
 * am Kopf eines Abschnitts, auf die die gesperrten Felder verweisen (`InlineAngabe`,
 * `gesperrt={{ beschreibungId }}`), statt den Grund an jedem Feld zu wiederholen.
 */
export function useOffeneBearbeitungGrund(): string | undefined {
  const halter = useContext(OffeneBearbeitungContext)?.halter;
  return halter ? sperrGrundOffeneBearbeitung(halter.etikett) : undefined;
}
