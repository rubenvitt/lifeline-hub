import { Button } from 'antd';
import {
  useCallback,
  useId,
  useMemo,
  useRef,
  type CSSProperties,
  type Key,
  type ReactNode,
} from 'react';
import type { Nachforderung, NachforderungStatus } from '../api/types';
import { SeitenLeer } from '../components/SeitenZustand';
import { Sammelbanner, Segmentleiste, monoStil, useRollen } from '../components/instrument';
import { useViewport } from '../components/useViewport';
import { useZuflussSchleuse, type ZuflussSteuerung } from '../components/useZuflussSchleuse';
import type { ZeilenGrund } from '../components/useZeilenFehler';
import NachforderungKarte, {
  type StellenVerweis,
  type UebernahmePosten,
} from './NachforderungKarte';
import type { ZielNamen } from './zielVorschlaege';
import {
  EINGETROFFEN_STUNDEN,
  STUFEN,
  boardGruppe,
  boardSpalten,
  stufeWort,
  vergleicheImBoard,
  type BoardGruppe,
  type BoardSpalte,
} from './nachforderungStufen';

/**
 * Status-Board der Nachforderungen (LLH-1078, Spec `nachforderungen-board`): EIN Überblick nach der
 * Achse „Stufe“ wie das Sichtungsboard (`frontend/AGENTS.md`, „Kein Nutzerschalter Tabelle ↔
 * Karte“), keine zweite Form derselben Liste.
 *
 * - Ab `md` Spalten Angefordert · Zugesagt · Unterwegs · Eingetroffen (letzte 12 h); „Abgelehnt“
 *   steht als schmale eingeklappte Spalte daneben und klappt auf. Unter `md` eine Segmentleiste der
 *   fünf Stufen mit Zahl, darunter die Karten der gewählten Stufe.
 * - Fortgeschaltet wird per Knopf an der Karte, nie per Ziehen (Handschuh, Tastatur).
 * - Die Zuflussschleuse hält Menge, Spalte und Folge, solange Zeiger oder Fokus im Board sind oder
 *   ein Dialog der Seite offen ist (`halten`); Fremdes nennt der Sammelbanner. Die eigene
 *   Fortschaltung gibt die Seite als Benutzeraktion frei (`zufluss.nachBenutzeraktion`).
 * - Spaltenzahlen zählen die Karten der Spalte mit der Regel aus `nachforderungStufen.ts`; die
 *   Kopfzeile der Seite liest den Server-Zähler.
 */

const schluessel = (n: Nachforderung): Key => n.id;

/** Was die Seite am Board umschaltet: Segment am Handy, Abgelehnt und ältere Eingetroffene. */
export interface BoardAnsicht {
  stufe: NachforderungStatus;
  abgelehntOffen: boolean;
  aeltereOffen: boolean;
}

/** Was jede Karte unverändert bekommt; stabil halten (die Karten sind `memo`). */
export interface BoardKartenProps {
  darfSchreiben?: boolean;
  onStatus?: (id: number, status: NachforderungStatus) => void;
  onAblehnen?: (id: number) => void;
  kartenFehler?: (id: number) => ZeilenGrund | null;
  materialJeId?: ReadonlyMap<number, UebernahmePosten> | null;
  materialGesperrt?: boolean;
  onMaterialUebernehmen?: (id: number) => void;
  hervorgehobenId?: number | null;
  /** Die Karte, deren Fortschaltung gerade läuft (Knopf im Ladezustand). */
  laeuftId?: number | null;
  stellenJeId?: ReadonlyMap<number, StellenVerweis> | null;
  zielNamen?: ZielNamen | null;
}

interface NachforderungBoardProps {
  /** Aus {@link useBoardStand} der Seite. */
  stand: BoardStand;
  /** Minutentakt der Seite (ms). */
  jetzt: number;
  zufluss: ZuflussSteuerung<Nachforderung>;
  /** Ein Dialog der Seite ist offen: das Board hält still. */
  halten?: boolean;
  ansicht: BoardAnsicht;
  onAnsicht: (ansicht: BoardAnsicht) => void;
  karten: BoardKartenProps;
}

/** Die Spalten, wie das Board sie zeigt — rein, damit die Seite den Ort einer Karte kennt. */
export function sichtbareKarten(
  spalten: readonly BoardSpalte[],
  ansicht: BoardAnsicht,
  schmal: boolean,
): Nachforderung[] {
  return spalten.flatMap((sp) => {
    if (schmal && sp.stufe !== ansicht.stufe) return [];
    if (!schmal && sp.stufe === 'abgelehnt' && !ansicht.abgelehntOffen) return [];
    return [...sp.karten, ...(ansicht.aeltereOffen ? sp.aeltere : [])];
  });
}

/** „1 neue Nachforderung · 2 umgehängt“; `null` ohne Wartendes. */
function bannerText(neu: number, umgehaengt: number): string | null {
  const teile = [
    neu === 1 ? '1 neue Nachforderung' : neu > 1 ? `${neu} neue Nachforderungen` : null,
    umgehaengt > 0 ? `${umgehaengt} in anderer Stufe` : null,
  ].filter((t): t is string => t !== null);
  return teile.length > 0 ? teile.join(' · ') : null;
}

/** Was das Board zeigt: frisch geordnet, dahinter der Stand der Schleuse. */
export interface BoardStand {
  /** Frisch geordnet, wie ohne Schleuse — die Zeilen, die die Schleuse beobachtet. */
  sortiert: Nachforderung[];
  /** Die gezeigte Folge (gehalten, solange die Schleuse zu ist). */
  geordnet: Nachforderung[];
  spalten: BoardSpalte[];
  /** Die gezeigte Gruppe einer Karte (gehalten oder frisch). */
  gruppeVon: (n: Nachforderung) => BoardGruppe;
  /** Die frische Gruppe — für die Schleuse. */
  frischeGruppe: (n: Nachforderung) => BoardGruppe;
  /** Text des Sammelbanners; `null` ohne Wartendes. */
  banner: string | null;
}

/**
 * Board-Stand hinter der Schleuse: gehaltene Folge und Gruppen, dazu das Wartende. Die Seite ruft
 * ihn auf (sie braucht den Ort einer Karte für Fehler und Deeplink) und reicht ihn dem Board.
 */
export function useBoardStand(
  nachforderungen: readonly Nachforderung[],
  jetzt: number,
  zufluss: ZuflussSteuerung<Nachforderung>,
): BoardStand {
  const sortiert = useMemo(() => [...nachforderungen].sort(vergleicheImBoard), [nachforderungen]);
  const frischeGruppe = useCallback((n: Nachforderung) => boardGruppe(n, jetzt), [jetzt]);
  const stand = zufluss.stand;
  return useMemo(() => {
    if (stand.art !== 'gefroren') {
      return {
        sortiert,
        geordnet: sortiert,
        spalten: boardSpalten(sortiert, frischeGruppe),
        gruppeVon: frischeGruppe,
        frischeGruppe,
        banner: null,
      };
    }
    const nachId = new Map(sortiert.map((n) => [n.id as Key, n]));
    const gehalten = stand.folge
      .map((k) => nachId.get(k))
      .filter((n): n is Nachforderung => n !== undefined);
    const bekannt = new Set(stand.folge);
    const neu = sortiert.filter((n) => !bekannt.has(n.id)).length;
    const gruppeVon = (n: Nachforderung) =>
      (stand.gruppeVon.get(n.id) as BoardGruppe | undefined) ?? frischeGruppe(n);
    const umgehaengt = gehalten.filter((n) => gruppeVon(n) !== frischeGruppe(n)).length;
    return {
      sortiert,
      geordnet: gehalten,
      spalten: boardSpalten(gehalten, gruppeVon),
      gruppeVon,
      frischeGruppe,
      banner: bannerText(neu, umgehaengt),
    };
  }, [sortiert, frischeGruppe, stand]);
}

export default function NachforderungBoard({
  stand,
  jetzt,
  zufluss,
  halten = false,
  ansicht,
  onAnsicht,
  karten,
}: NachforderungBoardProps) {
  const { token, rollen } = useRollen();
  const schmal = !useViewport().abBreite('md');
  const wurzel = useRef<HTMLDivElement | null>(null);
  const panelId = useId();
  const bereich = useZuflussSchleuse(zufluss, {
    zeilen: stand.sortiert,
    schluessel,
    aktiv: true,
    gruppeVon: stand.frischeGruppe,
    mitGerippe: false,
    wurzel,
    halten,
  });
  const { spalten, banner } = stand;

  const kartenListe = (sp: BoardSpalte, liste: readonly Nachforderung[]) => (
    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      {liste.map((n) => (
        <NachforderungKarte
          key={n.id}
          nachforderung={n}
          spaltenStufe={sp.stufe}
          jetzt={jetzt}
          darfSchreiben={karten.darfSchreiben}
          onStatus={karten.onStatus}
          onAblehnen={karten.onAblehnen}
          fehlerGrund={karten.kartenFehler?.(n.id) ?? null}
          materialJeId={karten.materialJeId}
          materialGesperrt={karten.materialGesperrt}
          onMaterialUebernehmen={karten.onMaterialUebernehmen}
          hervorgehoben={n.id === karten.hervorgehobenId}
          laeuft={n.id === karten.laeuftId}
          stellenJeId={karten.stellenJeId}
          zielNamen={karten.zielNamen}
        />
      ))}
    </div>
  );

  /** Inhalt einer Spalte: Karten, bei „Eingetroffen“ darunter die älteren. */
  const inhalt = (sp: BoardSpalte): ReactNode => (
    <>
      {sp.karten.length === 0 && sp.aeltere.length === 0 ? (
        <div
          data-lfh="board-spalte-leer"
          style={{ ...monoStil(token.fontSizeSM), color: rollen.schwach, padding: token.paddingXS }}
        >
          keine
        </div>
      ) : (
        kartenListe(sp, sp.karten)
      )}
      {sp.aeltere.length > 0 && (
        <>
          <Button
            block
            aria-expanded={ansicht.aeltereOffen}
            onClick={() => onAnsicht({ ...ansicht, aeltereOffen: !ansicht.aeltereOffen })}
            style={{ marginBlock: token.marginXS }}
          >
            {ansicht.aeltereOffen
              ? `Ältere eingetroffen ausblenden (${sp.aeltere.length})`
              : `Ältere eingetroffen (${sp.aeltere.length})`}
          </Button>
          {ansicht.aeltereOffen && kartenListe(sp, sp.aeltere)}
        </>
      )}
    </>
  );

  const kopfStil: CSSProperties = {
    margin: 0,
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: token.marginXS,
    paddingInline: token.paddingXS,
    paddingBlock: token.paddingXXS,
    background: rollen.flaeche3,
    color: rollen.text,
    fontSize: token.fontSize,
    fontWeight: 600,
    marginBottom: token.marginXS,
  };
  const spaltenKopf = (sp: BoardSpalte) => (
    <h2 style={kopfStil}>
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {stufeWort(sp.stufe)}
        {sp.stufe === 'eingetroffen' && (
          <span style={{ fontWeight: 400, color: rollen.gedaempft, fontSize: token.fontSizeSM }}>
            {' '}
            · letzte {EINGETROFFEN_STUNDEN} h
          </span>
        )}
      </span>
      <span data-lfh="board-zahl" style={monoStil(14, 500)}>
        {sp.karten.length}
      </span>
    </h2>
  );

  const leer = stand.sortiert.length === 0 && stand.geordnet.length === 0;
  const abgelehnt = spalten.find((sp) => sp.stufe === 'abgelehnt')!;

  return (
    <>
      {banner != null && (
        <Sammelbanner
          style={{ marginBottom: token.marginXS }}
          aktion={{ label: 'anzeigen', onKlick: zufluss.nachBenutzeraktion }}
        >
          {banner}
        </Sammelbanner>
      )}
      {leer && <SeitenLeer titel="Keine Nachforderungen" />}
      {schmal && !leer && (
        <div style={{ marginBottom: token.marginSM }}>
          <Segmentleiste
            beschriftung="Stufe"
            rolle="tablist"
            wert={ansicht.stufe}
            onWechsel={(stufe) => onAnsicht({ ...ansicht, stufe })}
            optionen={spalten.map((sp) => ({
              wert: sp.stufe,
              label: `${stufeWort(sp.stufe)} ${sp.karten.length + sp.aeltere.length}`,
              steuert: panelId,
            }))}
          />
        </div>
      )}
      <div
        ref={wurzel}
        {...bereich}
        role="region"
        aria-label="Nachforderungen nach Stufe"
        data-lfh="nachforderung-board"
        style={
          leer
            ? { display: 'none' }
            : schmal
              ? { display: 'block' }
              : {
                  display: 'grid',
                  gridTemplateColumns: `repeat(4, minmax(0, 1fr)) ${
                    ansicht.abgelehntOffen ? 'minmax(0, 1fr)' : 'auto'
                  }`,
                  gap: token.marginXS,
                  alignItems: 'start',
                }
        }
      >
        {schmal
          ? spalten
              .filter((sp) => sp.stufe === ansicht.stufe)
              .map((sp) => (
                <section
                  key={sp.stufe}
                  id={panelId}
                  role="tabpanel"
                  data-lfh="board-spalte"
                  data-stufe={sp.stufe}
                  aria-label={`${stufeWort(sp.stufe)}, ${sp.karten.length}`}
                  style={{ minWidth: 0 }}
                >
                  {inhalt(sp)}
                </section>
              ))
          : STUFEN.filter((s) => s !== 'abgelehnt').map((stufe) => {
              const sp = spalten.find((x) => x.stufe === stufe)!;
              return (
                <section
                  key={stufe}
                  data-lfh="board-spalte"
                  data-stufe={stufe}
                  aria-label={`${stufeWort(stufe)}, ${sp.karten.length}`}
                  style={{ minWidth: 0 }}
                >
                  {spaltenKopf(sp)}
                  {inhalt(sp)}
                </section>
              );
            })}
        {!schmal && (
          <section
            data-lfh="board-spalte"
            data-stufe="abgelehnt"
            aria-label={`${stufeWort('abgelehnt')}, ${abgelehnt.karten.length}`}
            style={{ minWidth: 0 }}
          >
            {ansicht.abgelehntOffen ? (
              <>
                <h2 style={{ ...kopfStil, padding: 0 }}>
                  <Button
                    type="text"
                    block
                    aria-expanded
                    onClick={() => onAnsicht({ ...ansicht, abgelehntOffen: false })}
                    style={{ justifyContent: 'space-between', fontWeight: 600 }}
                  >
                    <span>{stufeWort('abgelehnt')}</span>
                    <span data-lfh="board-zahl" style={monoStil(14, 500)}>
                      {abgelehnt.karten.length}
                    </span>
                  </Button>
                </h2>
                {inhalt(abgelehnt)}
              </>
            ) : (
              // Eingeklappt: eine schmale Spalte, die nur Wort und Zahl trägt und aufklappt.
              <h2 style={{ margin: 0 }}>
                <Button
                  aria-expanded={false}
                  onClick={() => onAnsicht({ ...ansicht, abgelehntOffen: true })}
                  style={{ fontWeight: 600 }}
                >
                  {stufeWort('abgelehnt')}{' '}
                  <span data-lfh="board-zahl" style={monoStil(14, 500)}>
                    {abgelehnt.karten.length}
                  </span>
                </Button>
              </h2>
            )}
          </section>
        )}
      </div>
    </>
  );
}
