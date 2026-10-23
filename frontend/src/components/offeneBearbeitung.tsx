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
import { useFormularVerlassenSchutz } from './useFormularVerlassenSchutz';
import VerlassenRueckfrage from './VerlassenRueckfrage';

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

  const wert = useMemo<OffeneBearbeitungContextValue>(
    () => ({
      halter: eintraege[0] ?? null,
      isAngemeldet: (id) => eintraege.some((e) => e.id === id),
      anmelden,
      abmelden,
    }),
    [eintraege, anmelden, abmelden],
  );

  return (
    <OffeneBearbeitungContext.Provider value={wert}>
      {children}
      {eintraege.length > 0 && <VerlassenRueckfrage ungespeichert={ungespeichert} />}
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
  const gesperrt =
    halter && !kontext?.isAngemeldet(id) ? sperrGrundOffeneBearbeitung(halter.etikett) : undefined;
  return { gesperrt, melde };
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
 * Der Sperrgrund der Seite, solange ein Feld einen Entwurf hat, sonst `undefined`: für EINE Zeile
 * am Kopf eines Abschnitts, auf die die gesperrten Felder verweisen (`InlineAngabe`,
 * `gesperrt={{ beschreibungId }}`), statt den Grund an jedem Feld zu wiederholen.
 */
export function useOffeneBearbeitungGrund(): string | undefined {
  const halter = useContext(OffeneBearbeitungContext)?.halter;
  return halter ? sperrGrundOffeneBearbeitung(halter.etikett) : undefined;
}
