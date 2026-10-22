import { Button, Space } from 'antd';
import {
  Fragment,
  memo,
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type ReactNode,
} from 'react';
import { Link } from 'react-router';
import type { EtbEintragAnzeige, MeldeWeg } from '../api/types';
import { HERVORGEHOBEN } from '../components/Datensicht';
import { funkprotokollFolge } from '../components/useFunkprotokollLauf';
import { MenueAusloeser, type MenueEintrag } from '../components/MenueAusloeser';
import Markdown from '../components/Markdown';
import Fundstellen from '../components/Fundstellen';
import { fundstellen as fundstellenIn, suchphrasen } from '../components/volltextFundstellen';
import { SeitenSkeleton } from '../components/SeitenZustand';
import { ZeilenFehler } from '../components/SpeicherHinweis';
import type { ZeilenGrund } from '../components/useZeilenFehler';
import {
  Augenbraue,
  Sammelbanner,
  StatusChip,
  useRollen,
  Zeitachseneintrag,
} from '../components/instrument';
import { zeitachsenAufbau } from '../components/instrument/Zeitachseneintrag';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { formatUhrzeit, inZone } from '../anzeige/format';
import type { AbgelehnterEintrag } from '../offline/queue';
import { etbPfad } from '../routing/deeplinks';
import { etbTyp } from '../theme/statusFarben';
import { IconPfeilHoch } from '../icons';
import EtbAnhaenge from './EtbAnhaenge';
import EtbBacklinkBadges from './EtbBacklinkBadges';
import EtbDokumente, { type EtbDokument } from './EtbDokumente';
import { scrollNachOben, useWeitGerollt } from './nachOben';
import type { EtbZeile } from './etbZeile';
import { MELDEWEG_OPTIONEN } from './schnellerfassungModell';
import { SYSTEM_RUFNAME } from './systemKennung';
import { istNachgetragen } from './typFarben';
import { verfasserText } from './verfasser';
import {
  type Berichtigungsindex,
  berichtigungsindex,
  buendleSystemfolgen,
  einfrieren,
  type Einfrierstand,
  gruppiereNachStunde,
  teileZufluss,
  hatVerknuepfung,
  nachtragText,
  verweisStil,
  zuflussText,
} from './zeitachseModell';
import { useDarfOriginalLaden } from '../einsatz/useDarfOriginalLaden';
import { KEINE_BERECHTIGUNG } from '../einsatz/modulRegistry';

interface Props {
  /** Gesendete und gepufferte Einträge als EINE Chronologie (`etb/etbZeile.ts`). */
  zeilen: readonly EtbZeile[];
  /** Einsatz-id für Rückverweise und Sprünge innerhalb des Tagebuchs. */
  einsatzId: number;
  /** Per ?eintrag=<id> adressierter Eintrag — wird hervorgehoben (LFH-25). */
  highlightId?: number | null;
  /**
   * Begriff der Volltextsuche (`?q=`): seine Fundstellen in Inhalt, Von, An und Veranlassung
   * gesendeter Einträge werden markiert (LFH-1056). Gepufferte Zeilen hat der Server nicht
   * gefunden, sie bleiben unmarkiert.
   */
  fundstellen?: string;
  /**
   * Folgen von Systemeinträgen bündeln (LLH-1106, `buendleSystemfolgen`)? Vorgabe `true`; die
   * Seite schaltet es unter `typ=system` ab, die Achse selbst unter einer Volltextsuche.
   */
  buendeln?: boolean;
  /**
   * Zählt je Sprung über `?eintrag=` hoch (auch auf denselben Eintrag). Ein Sprung hebt das
   * Einfrieren auf: das Ziel könnte sonst hinter dem Sammelbanner stehen.
   */
  sprungMarke?: number;
  /** Die angemeldete Person — ihre eigenen Einträge werden nie zurückgehalten. */
  eigeneBenutzerId?: number | null;
  /**
   * Steht die Seite am Ende (LLH-1149, `components/useFunkprotokollLauf.ts`)? Wer hochgerollt
   * hat, liest: dann hält die Zeitachse neue fremde Einträge zurück wie bei Fokus darin. Vorgabe
   * `true` (kein Bildlauf bekannt).
   */
  amEnde?: boolean;
  /** „anzeigen“ am Sammelbanner: die Seite rollt ans Ende, wo die neuen Einträge stehen. */
  onZumEnde?: () => void;
  /**
   * Meldet die Ränder der GEZEIGTEN Zeilen (`gezeigteRaender`), nach jedem Commit, in dem sie sich
   * ändern — für `useFunkprotokollLauf`: erst wenn zurückgehaltene Zeilen erscheinen (Auftauen,
   * „anzeigen“), läuft die Seite ihnen nach.
   */
  onGezeigt?: (raender: GezeigteRaender) => void;
  /**
   * Kennung der geladenen Menge (Filter). Wechselt sie, taut die Achse auf: eine Wassermarke aus
   * der alten Menge hielte sonst Treffer der neuen als „neu“ zurück.
   */
  fensterSchluessel?: string;
  /**
   * Lesemarke als Trennlinie (LLH-1149): `knoten` (ein `<li>`) steht direkt unter dem Eintrag mit
   * `nachLfdNr`. Ob sie in der Achse steht oder als Banner darüber, entscheidet die Seite.
   */
  lesemarke?: { nachLfdNr: number; knoten: ReactNode };
  /**
   * Wenn gesetzt, bietet jeder gesendete Eintrag „Berichtigen" an — auch eine Berichtigung
   * (LLH-1099): eine fehlerhafte Berichtigung bliebe sonst unkorrigierbar stehen.
   */
  onBerichtigen?: (eintrag: EtbEintragAnzeige) => void;
  /**
   * Grund, aus dem „Berichtigen" gerade gesperrt ist (ein Entwurf sendet noch). Der Punkt
   * bleibt sichtbar und nennt den Grund — ein fehlender Punkt sagte nicht, warum.
   */
  berichtigenGesperrt?: string;
  /** Wenn gesetzt, bietet jeder Eintrag „Wiedervorlage" an (ETB→Erinnerung, LFH-106). */
  onWiedervorlage?: (eintrag: EtbEintragAnzeige) => void;
  /** Wenn gesetzt, bietet jeder Eintrag „Auftrag erteilen" an (ETB→Auftrag, LFH-112). */
  onAuftragErteilen?: (eintrag: EtbEintragAnzeige) => void;
  /** Aufträge ohne Freigabe (LFH-1051): „Auftrag erteilen“ steht gesperrt mit Grund im Menü. */
  auftragGesperrt?: boolean;
  /** Abgelehnten Eintrag erneut in die Warteschlange geben (LFH-342 · C7). */
  onErneutSenden?: (puffer: AbgelehnterEintrag) => void;
  /** Abgelehnten Eintrag endgültig verwerfen. */
  onVerwerfen?: (puffer: AbgelehnterEintrag) => void;
  /**
   * Abgelehnten Eintrag, der in den Meldungseingang sollte, ohne Meldung erneut senden (LLH-1037,
   * design.md D9): der Weg hinaus, wenn das Modul Meldungen inzwischen gesperrt ist.
   */
  onNurProtokollieren?: (puffer: AbgelehnterEintrag) => void;
  /**
   * Grund, aus dem „Erneut senden“ an dieser Zeile scheiterte, je Zeilenschlüssel (LFH-1077,
   * `components/useZeilenFehler.ts`). Er steht an der Zeile, nicht im Toast.
   */
  zeilenFehler?: (schluessel: string) => ZeilenGrund | null;
  /** Der Abruf läuft noch — über die Menge wird dann nichts behauptet (LFH-331 · B3). */
  ladend?: boolean;
  /** Der Abruf ist gescheitert. Die Meldung gehört der Seite; hier nur die Unterdrückung. */
  fehler?: boolean;
  /** Was anstelle der Zeilen steht, wenn keine da sind (die Seite kennt Filter und Rechte). */
  leerText?: ReactNode;
  /**
   * Dokumente der Ablage je ETB-Eintrag (LFH-743, `dokumenteJeEintrag`). Fehlt ohne
   * Modulrecht `dokumente` — dann steht an keinem Eintrag ein Dokument-Verweis.
   */
  dokumente?: ReadonlyMap<number, readonly EtbDokument[]>;
}

/** Anzeigewort je Meldeweg — auch die Palettenvorschau liest es von hier (LFH-664). */
export const MELDEWEG_LABEL = Object.fromEntries(
  MELDEWEG_OPTIONEN.map((o) => [o.value, o.label]),
) as Record<MeldeWeg, string>;

function vonAn(von?: string | null, an?: string | null, begriff?: string): ReactNode {
  if (!von && !an) return null;
  // „System → System“ sagt nichts (LLH-1106); eine bekannte Seite bleibt stehen.
  if (von === SYSTEM_RUFNAME && an === SYSTEM_RUFNAME) return null;
  return (
    <>
      <Fundstellen text={von || '—'} begriff={begriff} /> →{' '}
      <Fundstellen text={an || '—'} begriff={begriff} />
    </>
  );
}

/** Trifft die Volltextsuche die Veranlassung? Nur dann steht sie in der Hinweiszeile. */
function veranlassungGetroffen(veranlassung: string | null | undefined, begriff?: string): boolean {
  if (!begriff || !veranlassung) return false;
  return fundstellenIn(veranlassung, suchphrasen(begriff)).length > 0;
}

/**
 * Die Berichtigungen eines Eintrags aus dem Wire, jüngste zuerst (LLH-1099). Fehlt das Feld (ein
 * Stand im Gerätespeicher von vor LFH-689), gilt: keine bekannt.
 */
function berichtigtDurch(e: EtbEintragAnzeige): EtbEintragAnzeige['berichtigt_durch'] {
  return [...(e.berichtigt_durch ?? [])].sort((a, b) => b.lfd_nr - a.lfd_nr);
}

/** „1 Anhang" / „n Anhänge" an einer gepufferten Zeile (LFH-117); ohne Anhang nichts. */
function anhangZahl(ids: readonly number[] | undefined): string | null {
  const n = ids?.length ?? 0;
  if (n === 0) return null;
  return n === 1 ? '1 Anhang' : `${n} Anhänge`;
}

/** Teile einer Hinweiszeile mit Mittelpunkt dazwischen — der Punkt ist Satz, kein Inhalt. */
function hinweisZeile(teile: ReactNode[], luft: number): ReactNode {
  const da = teile.filter((t) => t != null && t !== false);
  if (da.length === 0) return undefined;
  return (
    <span
      style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', columnGap: luft }}
    >
      {da.map((t, i) => (
        <span key={i} style={{ display: 'inline-flex', alignItems: 'center', columnGap: luft }}>
          {i > 0 && <span aria-hidden="true">·</span>}
          {t}
        </span>
      ))}
    </span>
  );
}

/**
 * Das Einsatztagebuch als ZEITACHSE auf allen Breiten (Neuentwurf S4).
 *
 * ── WARUM KEINE `Datensicht` ─────────────────────────────────────────────────────────
 *
 * Ein Tagebuch wird GELESEN, in Zeitfolge, auf jedem Schirm. Es gibt keine Sortierung, keinen
 * Spaltenfilter, keine Spaltenauswahl — die Ordnung ist die Zeit und serverseitig festgelegt.
 * Stundengruppen, Zeilenschleuse, Sammelbanner und Lade-/Leerweiche stehen als reine
 * Funktionen in `zeitachseModell.ts` und sind dort ohne Render geprüft.
 *
 * ── WAS JEDE ZEILE SELBST TRÄGT ──────────────────────────────────────────────────────
 *
 * `data-lfh="datensicht-karte"` und die Zeilenklasse ({@link HERVORGEHOBEN}): daran findet
 * `scrolleZurZeile` die Zeile, und daran hängt die Hervorhebung des Deeplinks `?eintrag=`
 * (`index.css`, e2e `palette-datensaetze`). Der Markenname stammt aus der Datensicht; ein
 * zweiter Selektor wäre eine zweite Wahrheit.
 *
 * ── FUNKPROTOKOLL-ORDNUNG (LLH-1149) ────────────────────────────────────────────────
 *
 * Älteste oben, neueste unten direkt über der Erfassung: der eigene Eintrag erscheint dort, wo
 * man tippt. Die Zeilen kommen in Serverordnung und werden erst nach dem Zufluss gekehrt
 * (`funkprotokollFolge`). Den Bildlauf (Öffnen am Ende, Mitlaufen, Anker beim Nachladen oben)
 * trägt die Seite über `components/useFunkprotokollLauf.ts`.
 *
 * ── LIVE-ZUFLUSS SPRINGT NICHT UNTER DEM CURSOR ─────────────────────────────────────
 *
 * Solange der Fokus in der Zeitachse liegt (Aktionsmenü, Verweis) oder die Seite nicht am Ende
 * steht (`amEnde`), ist die Menge der gesendeten Einträge eingefroren; NEUES fremder Erfasser
 * (s. `teileZufluss`) wird als Sammelbanner am unteren Rand gezählt und erst auf „anzeigen"
 * eingefügt — nachgeladene ältere und eigene Einträge stehen sofort, ein Sprung taut auf
 * (Bedien-Leitlinie Festlegung 6, WCAG 3.2.5). Am Ende ohne Fokus steht unter der Lesestelle
 * nichts mehr: dort läuft die Seite neuen Einträgen nach. Das Banner liegt als Überlagerung über
 * der Liste, nicht in ihrem Fluss — sonst schöbe es genau die Zeilen weg, die es schützen soll.
 * Gepufferte Einträge stehen immer.
 */
export default function EtbZeitachse({
  zeilen,
  einsatzId,
  highlightId,
  fundstellen,
  buendeln = true,
  sprungMarke,
  eigeneBenutzerId,
  amEnde = true,
  onZumEnde,
  onGezeigt,
  fensterSchluessel,
  lesemarke,
  onBerichtigen,
  berichtigenGesperrt,
  onWiedervorlage,
  onAuftragErteilen,
  auftragGesperrt = false,
  onErneutSenden,
  onVerwerfen,
  onNurProtokollieren,
  zeilenFehler,
  ladend,
  fehler,
  leerText,
  dokumente,
}: Props) {
  const { token, rollen } = useRollen();
  const { konventionen } = useAnzeigeKonventionen();
  const darfOriginal = useDarfOriginalLaden(einsatzId);
  const wurzel = useRef<HTMLDivElement>(null);
  const kopfIdBasis = useId();
  const [gefroren, setGefroren] = useState<Einfrierstand | null>(null);
  /** Liegt der Fokus in der Zeitachse? Zweiter Grund zum Einfrieren neben „nicht am Ende“. */
  const [fokusDrin, setFokusDrin] = useState(false);
  const weitGerollt = useWeitGerollt();
  /*
   * Hochgerollt friert ein, zurück am Ende taut auf — sofern kein Fokus darin liegt (LLH-1149,
   * design.md D2). Im Render angeglichen wie der Sprung unten: ein Effekt käme einen Commit zu
   * spät, und eine eben eingetroffene Zeile stünde schon unter der Lesestelle.
   */
  const [gesehenAmEnde, setGesehenAmEnde] = useState(amEnde);
  if (amEnde !== gesehenAmEnde) {
    setGesehenAmEnde(amEnde);
    if (!amEnde) setGefroren((vorher) => vorher ?? einfrieren(zeilen));
    else if (!fokusDrin) setGefroren(null);
  }
  /*
   * Ein Sprung taut auf, und zwar IM RENDER (Zustandsangleich an eine Prop), nicht in
   * einem Effekt: der Scroll-Effekt der Seite läuft im selben Commit und fände das Ziel
   * sonst noch hinter dem Banner.
   */
  const [gesehenerSprung, setGesehenerSprung] = useState(sprungMarke);
  if (sprungMarke !== gesehenerSprung) {
    setGesehenerSprung(sprungMarke);
    setGefroren(null);
  }
  const [gesehenesFenster, setGesehenesFenster] = useState(fensterSchluessel);
  if (fensterSchluessel !== gesehenesFenster) {
    setGesehenesFenster(fensterSchluessel);
    setGefroren(null);
  }

  const eintraege = useMemo(
    () => zeilen.flatMap((z) => (z.art === 'eintrag' ? [z.eintrag] : [])),
    [zeilen],
  );
  const index = useMemo(() => berichtigungsindex(eintraege), [eintraege]);
  const { sichtbar, zurueckgehalten } = useMemo(
    () => teileZufluss(zeilen, gefroren, eigeneBenutzerId),
    [zeilen, gefroren, eigeneBenutzerId],
  );
  // Funkprotokoll-Ordnung (LLH-1149): erst nach dem Zufluss gekehrt, damit Einfrieren und
  // Wassermarke weiter auf der Serverordnung rechnen (`funkprotokollFolge`).
  const gruppen = useMemo(
    () =>
      gruppiereNachStunde(funkprotokollFolge(sichtbar), (utc) =>
        inZone(utc, konventionen).format('YYYY-MM-DD HH'),
      ),
    [sichtbar, konventionen],
  );
  // Bündel nach dem Gruppieren, je Stundengruppe (LLH-1106, design.md D8): ein Bündel reicht nie
  // über einen Stundenkopf. Die Lesemarke bricht eine Folge, sonst verschwände die Linie darin.
  const lesemarkeNr = lesemarke?.nachLfdNr;
  const gebuendelt = useMemo(
    () =>
      gruppen.map((g) => ({
        ...g,
        posten: buendleSystemfolgen(g.zeilen, {
          aus: !buendeln || !!fundstellen,
          hatDokument: (id) => (dokumente?.get(id)?.length ?? 0) > 0,
          brichtNach:
            lesemarkeNr == null
              ? undefined
              : (z) => z.art === 'eintrag' && z.eintrag.lfd_nr === lesemarkeNr,
        }),
      })),
    [gruppen, buendeln, fundstellen, dokumente, lesemarkeNr],
  );
  /*
   * Offene Bündel nach Schlüssel (dem ältesten Eintrag): wächst ein offenes Bündel unten, bleibt
   * es offen. Ein Sprung in ein Bündel klappt es IM RENDER auf (wie der Sprung oben), damit der
   * Scroll-Effekt der Seite die Zielzeile im selben Commit findet.
   */
  const [offen, setOffen] = useState<ReadonlySet<string>>(() => new Set());
  const zielBuendel = useMemo(() => {
    if (highlightId == null) return null;
    for (const g of gebuendelt) {
      for (const p of g.posten) {
        if (p.art === 'buendel' && p.zeilen.some((z) => z.eintrag.id === highlightId)) {
          return p.schluessel;
        }
      }
    }
    return null;
  }, [gebuendelt, highlightId]);
  const [gesehenesZiel, setGesehenesZiel] = useState<string | null>(null);
  const zielSchluessel =
    zielBuendel == null ? null : `${zielBuendel}|${highlightId}|${sprungMarke}`;
  if (zielSchluessel !== gesehenesZiel) {
    setGesehenesZiel(zielSchluessel);
    if (zielBuendel != null && !offen.has(zielBuendel)) {
      setOffen((vorher) => new Set(vorher).add(zielBuendel));
    }
  }
  const umschalten = useCallback((schluessel: string) => {
    setOffen((vorher) => {
      const neu = new Set(vorher);
      if (!neu.delete(schluessel)) neu.add(schluessel);
      return neu;
    });
  }, []);

  const raender = gezeigteRaender(sichtbar);
  const meldeGezeigt = useRef(onGezeigt);
  useLayoutEffect(() => {
    meldeGezeigt.current = onGezeigt;
  });
  useLayoutEffect(() => {
    meldeGezeigt.current?.({ juengste: raender.juengste, aelteste: raender.aelteste });
  }, [raender.juengste, raender.aelteste]);

  const betreten = useCallback(() => {
    setFokusDrin(true);
    setGefroren((vorher) => vorher ?? einfrieren(zeilen));
  }, [zeilen]);

  const verlassen = useCallback(
    (e: FocusEvent<HTMLDivElement>) => {
      const ziel = e.relatedTarget as Node | null;
      if (ziel != null && wurzel.current?.contains(ziel)) return;
      // Ein Menü im Portal ist kein Verlassen: antds `autoFocus` schiebt den Fokus an
      // `document.body`, und die Zeile unter dem offenen Menü soll stehen bleiben.
      if (ziel instanceof Element && ziel.closest('.ant-dropdown')) return;
      setFokusDrin(false);
      // Hochgerollt bleibt sie eingefroren: dort liest jemand.
      if (amEnde) setGefroren(null);
    },
    [amEnde],
  );

  /*
   * Die Handler über einen Ref (LFH-947): die Zeile ist gemerkt, und eine neue Handler-Identität
   * des Aufrufers (Pfeilfunktion je Render) renderte sonst jede Zeile neu. Die Zeile ruft über
   * die stabilen Aufrufer immer den aktuellen Handler.
   */
  const handler = useRef({
    onBerichtigen,
    onWiedervorlage,
    onAuftragErteilen,
    onErneutSenden,
    onVerwerfen,
    onNurProtokollieren,
  });
  useLayoutEffect(() => {
    handler.current = {
      onBerichtigen,
      onWiedervorlage,
      onAuftragErteilen,
      onErneutSenden,
      onVerwerfen,
      onNurProtokollieren,
    };
  });
  const aufrufe = useMemo<ZeilenAufrufe>(
    () => ({
      berichtigen: (e) => handler.current.onBerichtigen?.(e),
      wiedervorlage: (e) => handler.current.onWiedervorlage?.(e),
      auftragErteilen: (e) => handler.current.onAuftragErteilen?.(e),
      erneutSenden: (p) => handler.current.onErneutSenden?.(p),
      verwerfen: (p) => handler.current.onVerwerfen?.(p),
      nurProtokollieren: handler.current.onNurProtokollieren
        ? (p) => handler.current.onNurProtokollieren?.(p)
        : undefined,
    }),
    [],
  );
  const zeile = (z: EtbZeile) => (
    <EtbZeitachsenZeile
      key={z.schluessel}
      z={z}
      einsatzId={einsatzId}
      hervorgehoben={z.art === 'eintrag' && z.eintrag.id === highlightId}
      fundstellen={z.art === 'eintrag' ? fundstellen || undefined : undefined}
      index={index}
      dokumente={z.art === 'eintrag' ? dokumente?.get(z.eintrag.id) : undefined}
      darfOriginal={darfOriginal}
      kannBerichtigen={onBerichtigen != null}
      berichtigenGesperrt={berichtigenGesperrt}
      kannWiedervorlage={onWiedervorlage != null}
      kannAuftrag={onAuftragErteilen != null}
      auftragGesperrt={auftragGesperrt}
      aufrufe={aufrufe}
      fehler={z.art === 'abgelehnt' ? (zeilenFehler?.(z.schluessel) ?? null) : null}
    />
  );

  /**
   * Laden und Fehler behaupten nichts über die Menge (LFH-331): sonst blitzte „Noch keine
   * Einträge." hinter dem Ladebalken auf. Im Fehlerfall bleibt die Liste montiert, bereits
   * geladene Einträge bleiben lesbar.
   */
  let inhalt: ReactNode;
  if (sichtbar.length === 0) {
    inhalt = ladend ? <SeitenSkeleton /> : fehler ? null : leerText;
  } else {
    // Schlüssel: Stunde plus wievielte Gruppe dieser Stunde (dieselbe Stunde kann bei Nachträgen
    // zweimal vorkommen). NICHT die erste Zeile: ein neuer Eintrag oben hängte sonst die ganze
    // Gruppe neu ein und parste jeden Text darin neu (LFH-947).
    const vorkommen = new Map<string, number>();
    const mitLesemarke = (z: EtbZeile) =>
      lesemarke && z.art === 'eintrag' && z.eintrag.lfd_nr === lesemarke.nachLfdNr ? (
        <Fragment key={z.schluessel}>
          {zeile(z)}
          {lesemarke.knoten}
        </Fragment>
      ) : (
        zeile(z)
      );
    inhalt = gebuendelt.map((g, i) => {
      const n = vorkommen.get(g.schluessel) ?? 0;
      vorkommen.set(g.schluessel, n + 1);
      return (
        <div
          key={`${g.schluessel}#${n}`}
          className="etb-stundengruppe"
          role="group"
          // Benannt ÜBER den Kopf, nicht per eigenem `aria-label`: sonst sagte der Vorleser die
          // Stunde doppelt an — einmal als Gruppe, einmal als Überschrift (LFH-621).
          aria-labelledby={`${kopfIdBasis}-kopf-${i}`}
        >
          <div
            style={{
              paddingBlock: token.paddingXS,
              paddingInline: token.padding,
              borderBlockEnd: `1px solid ${rollen.linie}`,
              background: rollen.grund,
            }}
          >
            {/* Der Stundenkopf ist eine echte Überschrift (h2): er gliedert die Zeitachse, und
              die Überschriften IN den Einträgen hängen darunter (LFH-621). */}
            <Augenbraue als="h2" id={`${kopfIdBasis}-kopf-${i}`}>
              {g.etikett}
            </Augenbraue>
          </div>
          <ol style={{ margin: 0, padding: 0 }}>
            {g.posten.map((p) => {
              if (p.art !== 'buendel') return mitLesemarke(p);
              const auf = offen.has(p.schluessel);
              const letzte = p.zeilen[p.zeilen.length - 1];
              return (
                <Fragment key={p.schluessel}>
                  <EtbBuendelzeile
                    schluessel={p.schluessel}
                    anzahl={p.zeilen.length}
                    von={formatUhrzeit(p.zeilen[0].eintrag.ereigniszeit, konventionen)}
                    bis={formatUhrzeit(letzte.eintrag.ereigniszeit, konventionen)}
                    offen={auf}
                    onUmschalten={umschalten}
                  />
                  {auf
                    ? p.zeilen.map(mitLesemarke)
                    : lesemarke &&
                      letzte.eintrag.lfd_nr === lesemarke.nachLfdNr && (
                        <Fragment key="lesemarke">{lesemarke.knoten}</Fragment>
                      )}
                </Fragment>
              );
            })}
          </ol>
        </div>
      );
    });
  }

  return (
    <div
      ref={wurzel}
      // Eine benannte Region: Vorleser springen hinein, und die e2e-Messungen greifen die Sicht darüber.
      role="region"
      aria-label="Einsatztagebuch"
      data-lfh="etb-zeitachse"
      onFocus={betreten}
      onBlur={verlassen}
      style={{ position: 'relative' }}
    >
      {inhalt}
      {/* Überlagerung mit Nullhöhe am UNTEREN Rand (LLH-1149): neue Einträge kommen unten an,
          das Banner klebt dort über der angepinnten Erfassung (`--lfh-etb-fokusabstand`, ihre
          gemessene Höhe) und nimmt keinen Platz im Fluss. „Nach oben“ steht rechts darüber,
          gestapelt statt überlagert, damit es das Banner nie verdeckt. Die Schale lässt Zeiger
          durch. */}
      <div
        style={{
          position: 'sticky',
          bottom: 'var(--lfh-etb-fokusabstand, 0px)',
          height: 0,
          zIndex: 5,
        }}
      >
        <div
          style={{
            position: 'absolute',
            insetInline: 0,
            bottom: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            gap: token.marginXS,
            pointerEvents: 'none',
          }}
        >
          {weitGerollt && (
            <Button
              data-lfh="etb-nach-oben"
              icon={<IconPfeilHoch />}
              style={{
                pointerEvents: 'auto',
                marginInlineEnd: token.marginSM,
                // Ohne Banner steht der Knopf mit Luft über der Erfassung, sonst trennt `gap`.
                marginBlockEnd: zurueckgehalten > 0 ? 0 : token.marginSM,
              }}
              onClick={() => {
                // Der Knopf verschwindet oben, und mit ihm der Fokus — ohne Blur-Ereignis (wie
                // beim Banner): stünde `fokusDrin` weiter, bliebe die Achse eingefroren.
                setFokusDrin(false);
                scrollNachOben();
              }}
            >
              Nach oben
            </Button>
          )}
          {zurueckgehalten > 0 && (
            <Sammelbanner
              aktion={{
                label: 'anzeigen',
                onKlick: () => {
                  // Der Knopf verschwindet mit dem Banner, und mit ihm der Fokus — ohne Blur-Ereignis.
                  // Stünde `fokusDrin` weiter, bliebe die Achse am Ende eingefroren.
                  setFokusDrin(false);
                  setGefroren(amEnde ? null : einfrieren(zeilen));
                  onZumEnde?.();
                },
              }}
              style={{ alignSelf: 'stretch', pointerEvents: 'auto' }}
            >
              {zuflussText(zurueckgehalten)}
            </Sammelbanner>
          )}
        </div>
      </div>
    </div>
  );
}

/** Die stabilen Aufrufer einer Zeile — sie lesen den aktuellen Handler der Zeitachse. */
interface ZeilenAufrufe {
  berichtigen: (e: EtbEintragAnzeige) => void;
  wiedervorlage: (e: EtbEintragAnzeige) => void;
  auftragErteilen: (e: EtbEintragAnzeige) => void;
  erneutSenden: (p: AbgelehnterEintrag) => void;
  verwerfen: (p: AbgelehnterEintrag) => void;
  /** Fehlt, wenn die Seite den Weg nicht anbietet. */
  nurProtokollieren?: (p: AbgelehnterEintrag) => void;
}

interface ZeilenProps {
  z: EtbZeile;
  einsatzId: number;
  hervorgehoben: boolean;
  /** Begriff der Volltextsuche, nur an gesendeten Einträgen (s. `EtbZeitachse fundstellen`). */
  fundstellen?: string;
  index: Berichtigungsindex;
  dokumente?: readonly EtbDokument[];
  darfOriginal: boolean;
  kannBerichtigen: boolean;
  berichtigenGesperrt?: string;
  kannWiedervorlage: boolean;
  kannAuftrag: boolean;
  auftragGesperrt: boolean;
  aufrufe: ZeilenAufrufe;
  /** Grund eines gescheiterten „Erneut senden“; derselbe Wert, solange er steht (`memo`). */
  fehler: ZeilenGrund | null;
}

/**
 * Eine Zeile der Zeitachse, gemerkt (LFH-947, Spec `etb-zeitachse-fenster`): sie bekommt nur
 * Werte, die sich je Zeile ändern, und stabile Aufrufer. Ein Rerender der Seite ohne geänderte
 * Einträge (Einsatzkopf, Einheiten, Fokus) rendert keine Zeile und parst kein Markdown.
 */
const EtbZeitachsenZeile = memo(function EtbZeitachsenZeile({
  z,
  einsatzId,
  hervorgehoben,
  fundstellen,
  index,
  dokumente,
  darfOriginal,
  kannBerichtigen,
  berichtigenGesperrt,
  kannWiedervorlage,
  kannAuftrag,
  auftragGesperrt,
  aufrufe,
  fehler,
}: ZeilenProps) {
  const { token, rollen } = useRollen();
  const { konventionen } = useAnzeigeKonventionen();

  function aktionen(): ReactNode {
    if (z.art === 'abgelehnt') {
      // Eine Entscheidung, kein Menü: das Verwerfen ist unumkehrbar, das erneute Senden
      // der wahrscheinlichere Griff — beide stehen offen da, mit Abstand zum Roten.
      return (
        <Space size="middle" wrap style={{ justifyContent: 'flex-end' }}>
          <Button onClick={() => aufrufe.erneutSenden(z.puffer)}>Erneut senden</Button>
          {z.puffer.eintrag.in_meldungseingang === true && aufrufe.nurProtokollieren && (
            <Button onClick={() => aufrufe.nurProtokollieren?.(z.puffer)}>
              Nur protokollieren
            </Button>
          )}
          <Button danger onClick={() => aufrufe.verwerfen(z.puffer)}>
            Verwerfen
          </Button>
        </Space>
      );
    }
    // Ausstehend: noch nicht im Tagebuch — nichts zu berichtigen, nichts zu beauftragen.
    if (z.art === 'ausstehend') return null;
    const e = z.eintrag;
    const eintraege: MenueEintrag<'berichtigen' | 'wiedervorlage' | 'auftrag'>[] = [
      ...(kannBerichtigen
        ? [
            {
              key: 'berichtigen' as const,
              label: berichtigenGesperrt ? `Berichtigen (${berichtigenGesperrt})` : 'Berichtigen',
              ...(berichtigenGesperrt ? { gesperrt: true as const } : {}),
            },
          ]
        : []),
      ...(kannWiedervorlage ? [{ key: 'wiedervorlage' as const, label: 'Wiedervorlage' }] : []),
      ...(kannAuftrag
        ? [
            auftragGesperrt
              ? {
                  key: 'auftrag' as const,
                  label: `Auftrag erteilen (${KEINE_BERECHTIGUNG})`,
                  gesperrt: true as const,
                }
              : { key: 'auftrag' as const, label: 'Auftrag erteilen' },
          ]
        : []),
    ];
    // Auch hier, nicht nur im Baustein: `Zeitachseneintrag` zeigt seine Fußzeile, sobald
    // `aktionen` nicht `null` ist.
    if (eintraege.length === 0) return null;
    // Der Name trägt die laufende Nummer: n gleichnamige Knöpfe wären per Rolle nicht
    // auseinanderzuhalten.
    return (
      <MenueAusloeser
        eintraege={eintraege}
        zugaenglicherName={`Aktionen zu Eintrag ${e.lfd_nr}`}
        onWahl={(key) => {
          if (key === 'berichtigen') aufrufe.berichtigen(e);
          if (key === 'wiedervorlage') aufrufe.wiedervorlage(e);
          if (key === 'auftrag') aufrufe.auftragErteilen(e);
        }}
      />
    );
  }

  function eintragsHinweis(e: EtbEintragAnzeige): ReactNode {
    const grund = index.grundeintrag(e);
    // Die erste (jüngste) Berichtigung steht als Marke in der Kopfzeile (`kopfMeta`), die übrigen
    // hier.
    const weitere = berichtigtDurch(e).slice(1);
    const doks = dokumente;
    const stil = verweisStil(token);
    return hinweisZeile(
      [
        // Die Veranlassung steht sonst nicht in der Zeile; trifft die Suche sie, sagt erst sie, warum
        // der Eintrag dasteht (LFH-1056).
        veranlassungGetroffen(e.veranlassung, fundstellen) && (
          <span key="veranlassung">
            Veranlassung: <Fundstellen text={e.veranlassung!} begriff={fundstellen} />
          </span>
        ),
        istNachgetragen(e.ereigniszeit, e.received_at) && (
          <span key="nachtrag">
            <span aria-hidden="true">⧖ </span>
            {nachtragText(e.ereigniszeit, e.received_at, konventionen)}
          </span>
        ),
        /*
         * Der Verweis ist blau, nicht rot wie im Entwurf: Rot bedient nichts. Das Signal
         * „Berichtigung" tragen Kante, Typwort und Zeilentönung.
         *
         * Der Sprung führt über `?eintrag=` OHNE den aktiven Filter: der Grundeintrag passt selten zu
         * dem Filter, unter dem man seine Berichtigung fand, und die Seite lädt ältere Seiten nach,
         * bis er da ist (LFH-25).
         */
        grund && (
          <span key="grund">
            berichtigt {grund.lfd_nr != null ? `Nr. ${grund.lfd_nr}` : 'einen älteren Eintrag'} —{' '}
            <Link to={etbPfad(einsatzId, { eintrag: grund.id })} style={stil}>
              Grundeintrag anzeigen<span aria-hidden="true"> ↗</span>
            </Link>
          </span>
        ),
        ...weitere.map((b) => (
          <Link key={`durch-${b.id}`} to={etbPfad(einsatzId, { eintrag: b.id })} style={stil}>
            auch berichtigt durch Nr. {b.lfd_nr}
            <span aria-hidden="true"> ↗</span>
          </Link>
        )),
        hatVerknuepfung(e) && <EtbBacklinkBadges key="rueck" eintrag={e} einsatzId={einsatzId} />,
        // Anhänge sind KEINE Kopplung: eigene Bedingung, nicht über `hatVerknuepfung` — die steuert
        // die Rückverweise.
        e.anhaenge.length > 0 && (
          <EtbAnhaenge
            key="anhaenge"
            eintrag={e}
            einsatzId={einsatzId}
            darfOriginal={darfOriginal}
          />
        ),
        // Dokumente der Ablage mit Bezug auf diesen Eintrag (LFH-743) — eigene Datei, eigene Route.
        doks && doks.length > 0 && (
          <EtbDokumente
            key="dokumente"
            einsatzId={einsatzId}
            lfdNr={e.lfd_nr}
            dokumente={doks}
            darfOriginal={darfOriginal}
          />
        ),
      ],
      token.marginXS,
    );
  }

  /*
   * Kopfzeile eines gesendeten Eintrags: Von → An, bei einem berichtigten Eintrag davor die Marke
   * „berichtigt“ und der Sprung auf die jüngste Berichtigung (LLH-1099, Spec
   * `etb-zeitachse-darstellung`, „Berichtigt unabhängig vom Fenster“). Gelesen wird das Wire-Feld
   * `berichtigt_durch` — der Server liefert es unabhängig von Seite und Filter (Spec
   * `etb-berichtigung`); aus dem Fenster gebildet fehlte es genau unter dem Typfilter, unter dem
   * man die falsche Meldung liest. Der Text bleibt, wie er ist: der Eintrag ist ein Beleg.
   */
  function kopfMeta(e: EtbEintragAnzeige): ReactNode {
    const seiten = vonAn(e.von, e.an, fundstellen);
    const juengste = berichtigtDurch(e)[0];
    if (!juengste) return seiten;
    return (
      <span
        style={{
          display: 'inline-flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: token.marginXS,
        }}
      >
        <StatusChip ton="achtung" wort="berichtigt" />
        <Link to={etbPfad(einsatzId, { eintrag: juengste.id })} style={verweisStil(token)}>
          → Nr. {juengste.lfd_nr}
        </Link>
        {seiten}
      </span>
    );
  }

  function inhalt(): ReactNode {
    // Die `etb-*`-Klassen tragen keine Regel (die Tönung macht der Baustein über `toenung`); sie
    // bleiben als Sortenmarke für Tests und Sichtprüfung im DOM.
    const klassen = [
      z.art === 'eintrag' && z.eintrag.typ === 'berichtigung' ? 'etb-berichtigung' : '',
      z.art === 'ausstehend' ? 'etb-ausstehend' : '',
      z.art === 'abgelehnt' ? 'etb-abgelehnt' : '',
      hervorgehoben ? HERVORGEHOBEN : '',
    ]
      .filter(Boolean)
      .join(' ');
    const gemeinsam = {
      als: 'li' as const,
      'data-lfh': 'datensicht-karte',
      'data-testid': 'etb-ereigniszeile',
      'data-zeile': z.schluessel,
      className: klassen || undefined,
      // Das Menü steht in `kompakt` in der Kopfzeile; die Entscheidung einer abgelehnten Zeile
      // bleibt rechts (LFH-958, `Zeitachseneintrag`).
      ...(z.art === 'abgelehnt' ? { aktionen: aktionen() } : { menue: aktionen() }),
      // Die Hervorhebung als Rollenfläche: der Baustein setzt seinen Grund inline, eine
      // Klassenregel käme dagegen nicht an.
      style: hervorgehoben ? { background: rollen.bedienFlaeche } : undefined,
    };

    if (z.art !== 'eintrag') {
      const p = z.puffer;
      return (
        <Zeitachseneintrag
          {...gemeinsam}
          zeit={formatUhrzeit(p.erstellt_at, konventionen)}
          // Keine Nummer, und das ist die Aussage: die vergibt erst der Server. Der Sendezustand steht
          // als Chip in der Meta-Zeile, NICHT in der inhaltsbreiten Nummernspalte — dort machte ein
          // `nowrap`-Chip die Zeitspalte dieser Zeile breiter als die der Nachbarn.
          typ={p.eintrag.typ}
          typwort={etbTyp[p.eintrag.typ].label}
          meta={
            <span
              style={{
                display: 'inline-flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: token.marginXS,
              }}
            >
              {z.art === 'ausstehend' ? (
                <StatusChip ton="achtung" wort="vorgemerkt" />
              ) : (
                <StatusChip ton="alarm" wort="abgelehnt" />
              )}
              {vonAn(p.eintrag.von, p.eintrag.an)}
            </span>
          }
          toenung={z.art === 'abgelehnt' ? 'problem' : undefined}
          hinweis={hinweisZeile(
            [
              // Ausstehend sagt der Chip „vorgemerkt“ in der Meta-Zeile; ein Satz darunter
              // wiederholte ihn (LFH-1078).
              z.art === 'abgelehnt' ? `Vom Server abgelehnt: ${z.puffer.grund}` : null,
              fehler && <ZeilenFehler fehler={fehler.fehler} fallback={fehler.fallback} />,
              // Die Dateien liegen schon auf dem Server und gehen per `anhang_ids` mit — die Zahl macht
              // sichtbar, DASS sie mitgehen.
              anhangZahl(p.eintrag.anhang_ids),
            ],
            token.marginXS,
          )}
          hinweisTon={z.art === 'abgelehnt' ? 'alarm' : 'schwach'}
        >
          <Markdown variante="kompakt" unterEbene={2}>
            {p.eintrag.inhalt}
          </Markdown>
        </Zeitachseneintrag>
      );
    }

    const e = z.eintrag;
    return (
      <Zeitachseneintrag
        {...gemeinsam}
        zeit={formatUhrzeit(e.ereigniszeit, konventionen)}
        nr={`Nr. ${e.lfd_nr}`}
        typ={e.typ}
        typwort={etbTyp[e.typ].label}
        meta={kopfMeta(e)}
        toenung={e.typ === 'berichtigung' ? 'berichtigung' : undefined}
        leise={e.typ === 'system'}
        hinweis={eintragsHinweis(e)}
        verfasser={verfasserText(e)}
        weg={e.meldeweg ? MELDEWEG_LABEL[e.meldeweg] : undefined}
      >
        {/* Unter dem Stundenkopf (h2, s. u.) — `#` im Eintrag wird h3 (LFH-621). */}
        <Markdown variante="kompakt" unterEbene={2} fundstellen={fundstellen}>
          {e.inhalt}
        </Markdown>
      </Zeitachseneintrag>
    );
  }

  return inhalt();
});

interface BuendelzeileProps {
  schluessel: string;
  anzahl: number;
  /** Ereigniszeit des ältesten und des jüngsten Eintrags, in der Anzeigekonvention. */
  von: string;
  bis: string;
  offen: boolean;
  onUmschalten: (schluessel: string) => void;
}

/**
 * Die Bündelzeile einer Folge von Systemeinträgen (LLH-1106, Spec `etb-zeitachse-darstellung`,
 * „Folgen von Systemeinträgen gebündelt“): leise wie ihre Einträge, an deren Platz in der Ordnung,
 * per Tastatur aufklappbar (`aria-expanded`). Aufgeklappt bleibt sie über den Einträgen stehen und
 * klappt sie wieder zu. `data-zeile` trägt den Bündelschlüssel: der Bildlaufanker der Seite
 * (`useFunkprotokollLauf`) hält auch an ihr.
 */
const EtbBuendelzeile = memo(function EtbBuendelzeile({
  schluessel,
  anzahl,
  von,
  bis,
  offen,
  onUmschalten,
}: BuendelzeileProps) {
  const { token } = useRollen();
  // In `kompakt` ragt der Knopf wie das Zeilenmenü in die Polsterung (`Zeitachseneintrag`): die
  // Trefffläche bleibt ganz, die Zeile hält aber die Höhe einer Textzeile (≤ 56 px, e2e
  // `etb-zeilenhoehe`). In den dichteren Stufen wächst sie mit, dort gibt es keine Höhengrenze.
  const ueberstand =
    zeitachsenAufbau(token) === 'zeile' ? Math.max(0, (token.controlHeight - 20) / 2) : 0;
  return (
    <Zeitachseneintrag
      als="li"
      data-lfh="etb-buendel"
      data-testid="etb-buendelzeile"
      data-zeile={schluessel}
      zeit={von}
      typ="system"
      typwort={etbTyp.system.label}
      leise
    >
      <button
        type="button"
        className="lfh-etb-buendel"
        aria-expanded={offen}
        onClick={() => onUmschalten(schluessel)}
        style={{
          ...verweisStil(token),
          marginBlock: -ueberstand,
          font: 'inherit',
          color: 'inherit',
          background: 'none',
          border: 0,
          padding: 0,
          cursor: 'pointer',
          textAlign: 'start',
        }}
      >
        {anzahl} Systemeinträge <span aria-hidden="true">·</span> {von}–{bis}{' '}
        <span aria-hidden="true">·</span> {offen ? 'zuklappen' : 'anzeigen'}
      </button>
    </Zeitachseneintrag>
  );
});

/** Die Ränder der gezeigten Zeilen für den Bildlauf (`useFunkprotokollLauf`). */
export interface GezeigteRaender {
  juengste: string | undefined;
  aelteste: string | undefined;
}

/**
 * Ränder der gezeigten Zeilen in Serverordnung (neueste zuerst, gepufferte am Kopf). Der untere
 * Rand nennt die gepufferten Zeilen UND den jüngsten gesendeten Eintrag: eine stehende abgelehnte
 * Zeile bliebe sonst die „jüngste“, und neue Einträge darüber liefen nicht mehr mit.
 */
export function gezeigteRaender(sichtbar: readonly EtbZeile[]): GezeigteRaender {
  const puffer = sichtbar.filter((z) => z.art !== 'eintrag').map((z) => z.schluessel);
  const ersterEintrag = sichtbar.find((z) => z.art === 'eintrag');
  return {
    juengste:
      sichtbar.length === 0 ? undefined : `${puffer.join(',')}|${ersterEintrag?.schluessel ?? ''}`,
    aelteste: sichtbar[sichtbar.length - 1]?.schluessel,
  };
}
