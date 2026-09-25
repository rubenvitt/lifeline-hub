import { MoreOutlined } from '@ant-design/icons';
import { Button, Dropdown, Space } from 'antd';
import {
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type ReactNode,
} from 'react';
import { Link } from 'react-router';
import type { EtbEintragAnzeige, MeldeWeg } from '../api/types';
import { HERVORGEHOBEN } from '../components/Datensicht';
import Markdown from '../components/Markdown';
import { SeitenSkeleton } from '../components/SeitenZustand';
import {
  Augenbraue,
  Sammelbanner,
  StatusChip,
  useRollen,
  Zeitachseneintrag,
} from '../components/instrument';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { formatUhrzeit, inZone } from '../anzeige/format';
import type { AbgelehnterEintrag } from '../offline/queue';
import { etbPfad } from '../routing/deeplinks';
import { etbTyp } from '../theme/statusFarben';
import EtbAnhaenge from './EtbAnhaenge';
import EtbBacklinkBadges from './EtbBacklinkBadges';
import type { EtbZeile } from './etbZeile';
import { MELDEWEG_OPTIONEN } from './schnellerfassungModell';
import { istNachgetragen } from './typFarben';
import { verfasserText } from './verfasser';
import {
  berichtigungsindex,
  einfrieren,
  type Einfrierstand,
  gruppiereNachStunde,
  teileZufluss,
  hatVerknuepfung,
  verweisStil,
  zuflussText,
} from './zeitachseModell';

interface Props {
  /** Gesendete und gepufferte Einträge als EINE Chronologie (`etb/etbZeile.ts`). */
  zeilen: readonly EtbZeile[];
  /** Einsatz-id für Rückverweise und Sprünge innerhalb des Tagebuchs. */
  einsatzId: number;
  /** Per ?eintrag=<id> adressierter Eintrag — wird hervorgehoben (LFH-25). */
  highlightId?: number | null;
  /**
   * Zählt je Sprung über `?eintrag=` hoch (auch auf denselben Eintrag). Ein Sprung hebt das
   * Einfrieren auf: das Ziel könnte sonst hinter dem Sammelbanner stehen.
   */
  sprungMarke?: number;
  /** Die angemeldete Person — ihre eigenen Einträge werden nie zurückgehalten. */
  eigeneBenutzerId?: number | null;
  /** Wenn gesetzt, bietet jeder Eintrag „Berichtigen" an (nicht an einer Berichtigung). */
  onBerichtigen?: (eintrag: EtbEintragAnzeige) => void;
  /** Wenn gesetzt, bietet jeder Eintrag „Wiedervorlage" an (ETB→Erinnerung, LFH-106). */
  onWiedervorlage?: (eintrag: EtbEintragAnzeige) => void;
  /** Wenn gesetzt, bietet jeder Eintrag „Auftrag erteilen" an (ETB→Auftrag, LFH-112). */
  onAuftragErteilen?: (eintrag: EtbEintragAnzeige) => void;
  /** Abgelehnten Eintrag erneut in die Warteschlange geben (LFH-342 · C7). */
  onErneutSenden?: (puffer: AbgelehnterEintrag) => void;
  /** Abgelehnten Eintrag endgültig verwerfen. */
  onVerwerfen?: (puffer: AbgelehnterEintrag) => void;
  /** Der Abruf läuft noch — über die Menge wird dann nichts behauptet (LFH-331 · B3). */
  ladend?: boolean;
  /** Der Abruf ist gescheitert. Die Meldung gehört der Seite; hier nur die Unterdrückung. */
  fehler?: boolean;
  /** Was anstelle der Zeilen steht, wenn keine da sind (die Seite kennt Filter und Rechte). */
  leerText?: ReactNode;
}

/** Anzeigewort je Meldeweg — auch die Palettenvorschau liest es von hier (LFH-664). */
export const MELDEWEG_LABEL = Object.fromEntries(
  MELDEWEG_OPTIONEN.map((o) => [o.value, o.label]),
) as Record<MeldeWeg, string>;

function vonAn(von?: string | null, an?: string | null): string | null {
  if (!von && !an) return null;
  return `${von || '—'} → ${an || '—'}`;
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
 * Das Einsatztagebuch als ZEITACHSE auf allen Breiten (Neuentwurf S4, Entscheidung 3 des
 * Auftraggebers, 21.09.2026).
 *
 * ── WARUM KEINE `Datensicht` MEHR ────────────────────────────────────────────────────
 *
 * Seit LFH-342 · C7 lief die Chronologie über `Datensicht` — Tabelle ab `xl` (LFH-464, ein
 * eigener Umbruchpunkt, den das Primitiv seither nicht mehr kennt), darunter ein
 * Karten-EIGENBAU, der erste und einzige Eintrag in `KARTEN_EIGENBAU`. Beides war die Antwort auf die Frage „welche Form trägt ein
 * Tagebuch?", und die Antwort des Neuentwurfs ist eindeutiger als die der Vorgänger: ein
 * Tagebuch wird GELESEN, in Zeitfolge, auf jedem Schirm. Es gibt keine Sortierung, keinen
 * Spaltenfilter, keine Spaltenauswahl — die Ordnung ist die Zeit und serverseitig
 * festgelegt. Was `Datensicht` darüber hinaus trug (Stundengruppen, Zeilenschleuse,
 * Sammelbanner, Lade-/Leerweiche), steht jetzt als reine Funktion in `zeitachseModell.ts`
 * und ist dort ohne Render geprüft. Damit ist die Datei aus dem Konsumenteninventar
 * gefallen, und `KARTEN_EIGENBAU` ist wieder leer — wie am Tag 1 des Guards.
 *
 * ── WAS JEDE ZEILE SELBST TRÄGT ──────────────────────────────────────────────────────
 *
 * `data-lfh="datensicht-karte"` und die Zeilenklasse ({@link HERVORGEHOBEN}): daran findet
 * `scrolleZurZeile` die Zeile, und daran hängt die Hervorhebung des Deeplinks `?eintrag=`
 * (`index.css`, e2e `palette-datensaetze`). Der Markenname stammt aus der Datensicht; er
 * bleibt, weil das Primitiv ihn für den Sprung abfragt und ein zweiter Selektor dort eine
 * zweite Wahrheit wäre.
 *
 * ── LIVE-ZUFLUSS SPRINGT NICHT UNTER DEM CURSOR ─────────────────────────────────────
 *
 * Solange der Fokus in der Zeitachse liegt (Aktionsmenü, Verweis), ist die Menge der
 * gesendeten Einträge eingefroren; NEUES fremder Erfasser (über der Wassermarke, s.
 * `teileZufluss`) wird als Sammelbanner gezählt und erst auf „anzeigen" eingefügt —
 * nachgeladene ältere und eigene Einträge stehen sofort, ein Sprung taut auf (Bedien-Leitlinie Festlegung 6, WCAG 3.2.5). Das Banner liegt als
 * Überlagerung über der Liste, nicht in ihrem Fluss — ein Banner, das beim Eintreffen
 * Platz nähme, schöbe genau die Zeilen weg, die es schützen soll. Gepufferte Einträge
 * stehen immer: sie sind die eigenen.
 */
export default function EtbZeitachse({
  zeilen,
  einsatzId,
  highlightId,
  sprungMarke,
  eigeneBenutzerId,
  onBerichtigen,
  onWiedervorlage,
  onAuftragErteilen,
  onErneutSenden,
  onVerwerfen,
  ladend,
  fehler,
  leerText,
}: Props) {
  const { token, rollen } = useRollen();
  const { konventionen } = useAnzeigeKonventionen();
  const wurzel = useRef<HTMLDivElement>(null);
  const kopfIdBasis = useId();
  const [gefroren, setGefroren] = useState<Einfrierstand | null>(null);
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

  const eintraege = useMemo(
    () => zeilen.flatMap((z) => (z.art === 'eintrag' ? [z.eintrag] : [])),
    [zeilen],
  );
  const index = useMemo(() => berichtigungsindex(eintraege), [eintraege]);
  const { sichtbar, zurueckgehalten } = teileZufluss(zeilen, gefroren, eigeneBenutzerId);
  const gruppen = gruppiereNachStunde(sichtbar, (utc) =>
    inZone(utc, konventionen).format('YYYY-MM-DD HH'),
  );

  const betreten = useCallback(() => {
    setGefroren((vorher) => vorher ?? einfrieren(zeilen));
  }, [zeilen]);

  const verlassen = useCallback((e: FocusEvent<HTMLDivElement>) => {
    const ziel = e.relatedTarget as Node | null;
    if (ziel != null && wurzel.current?.contains(ziel)) return;
    // Ein Menü im Portal ist kein Verlassen (LFH-339 · C4): antds `autoFocus` schiebt den
    // Fokus an `document.body`, und die Zeile unter dem offenen Menü soll stehen bleiben.
    if (ziel instanceof Element && ziel.closest('.ant-dropdown')) return;
    setGefroren(null);
  }, []);

  function aktionen(z: EtbZeile): ReactNode {
    if (z.art === 'abgelehnt') {
      // Eine Entscheidung, kein Menü: das Verwerfen ist unumkehrbar, das erneute Senden
      // der wahrscheinlichere Griff — beide stehen offen da, mit Abstand zum Roten.
      return (
        <Space size="middle" wrap style={{ justifyContent: 'flex-end' }}>
          <Button onClick={() => onErneutSenden?.(z.puffer)}>Erneut senden</Button>
          <Button danger onClick={() => onVerwerfen?.(z.puffer)}>
            Verwerfen
          </Button>
        </Space>
      );
    }
    // Ausstehend: noch nicht im Tagebuch — nichts zu berichtigen, nichts zu beauftragen.
    if (z.art === 'ausstehend') return null;
    const e = z.eintrag;
    const items = [
      ...(onBerichtigen && e.typ !== 'berichtigung'
        ? [{ key: 'berichtigen', label: 'Berichtigen' }]
        : []),
      ...(onWiedervorlage ? [{ key: 'wiedervorlage', label: 'Wiedervorlage' }] : []),
      ...(onAuftragErteilen ? [{ key: 'auftrag', label: 'Auftrag erteilen' }] : []),
    ];
    // Kein Auslöser statt eines leeren oder deaktivierten Menüs.
    if (items.length === 0) return null;
    return (
      <Dropdown
        trigger={['click']}
        autoFocus
        menu={{
          items,
          // Zuordnung am Menü, nicht je Eintrag (Muster `AnsichtSwitcher.tsx`).
          onClick: ({ key }) => {
            if (key === 'berichtigen') onBerichtigen?.(e);
            if (key === 'wiedervorlage') onWiedervorlage?.(e);
            if (key === 'auftrag') onAuftragErteilen?.(e);
          },
        }}
      >
        {/* Der Name trägt die laufende Nummer: n gleichnamige Knöpfe wären per Rolle nicht
            auseinanderzuhalten (LFH-364). Kein `size` — die Höhe kommt aus `controlHeight`. */}
        <Button
          type="text"
          aria-label={`Aktionen zu Eintrag ${e.lfd_nr}`}
          icon={
            <span aria-hidden="true" style={{ display: 'inline-flex' }}>
              <MoreOutlined />
            </span>
          }
        />
      </Dropdown>
    );
  }

  function eintragsHinweis(e: EtbEintragAnzeige): ReactNode {
    const grund = index.grundeintrag(e);
    const durch = index.berichtigtDurch(e);
    const stil = verweisStil(token);
    return hinweisZeile(
      [
        istNachgetragen(e.ereigniszeit, e.received_at) && (
          <span key="nachtrag">
            <span aria-hidden="true">⧖ </span>nachgetragen um{' '}
            {formatUhrzeit(e.received_at, konventionen)}
          </span>
        ),
        /*
         * Der Verweis ist blau, nicht rot, obwohl der Entwurf ihn in `alarm` zeichnet:
         * Rot bedient nichts (LFH-315, Entscheidung 2 lässt die Regel ausdrücklich stehen).
         * Das Signal „Berichtigung" tragen Kante, Typwort und Zeilentönung.
         *
         * Der Sprung führt über `?eintrag=` OHNE den aktiven Filter: der Grundeintrag passt
         * selten zu dem Filter, unter dem man seine Berichtigung gefunden hat, und die Seite
         * lädt ältere Seiten nach, bis er da ist (LFH-25).
         */
        grund && (
          <span key="grund">
            berichtigt {grund.lfd_nr != null ? `Nr. ${grund.lfd_nr}` : 'einen älteren Eintrag'} —{' '}
            <Link to={etbPfad(einsatzId, { eintrag: grund.id })} style={stil}>
              Grundeintrag anzeigen<span aria-hidden="true"> ↗</span>
            </Link>
          </span>
        ),
        ...durch.map((b) => (
          <Link key={`durch-${b.id}`} to={etbPfad(einsatzId, { eintrag: b.id })} style={stil}>
            berichtigt durch Nr. {b.lfd_nr}
            <span aria-hidden="true"> ↗</span>
          </Link>
        )),
        hatVerknuepfung(e) && <EtbBacklinkBadges key="rueck" eintrag={e} einsatzId={einsatzId} />,
        // Anhänge (LFH-117) sind KEINE Kopplung: eigene Bedingung, nicht über
        // `hatVerknuepfung` — die steuert die Rückverweise (Falle aus LFH-636).
        e.anhaenge.length > 0 && <EtbAnhaenge key="anhaenge" eintrag={e} einsatzId={einsatzId} />,
      ],
      token.marginXS,
    );
  }

  function zeile(z: EtbZeile): ReactNode {
    const hervorgehoben = z.art === 'eintrag' && z.eintrag.id === highlightId;
    // Die `etb-*`-Klassen tragen keine Regel mehr (die Tönung macht der Baustein über
    // `toenung`); sie bleiben als Sortenmarke für Tests und Sichtprüfung im DOM.
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
      aktionen: aktionen(z),
      // Die Hervorhebung als Rollenfläche: der Baustein setzt seinen Grund inline, eine
      // Klassenregel käme dagegen nicht an.
      style: hervorgehoben ? { background: rollen.bedienFlaeche } : undefined,
    };

    if (z.art !== 'eintrag') {
      const p = z.puffer;
      return (
        <Zeitachseneintrag
          key={z.schluessel}
          {...gemeinsam}
          zeit={formatUhrzeit(p.erstellt_at, konventionen)}
          // Keine Nummer, und das ist die Aussage: die vergibt erst der Server. Der
          // Sendezustand steht als Chip in der Meta-Zeile, NICHT in der Nummernspalte —
          // die ist inhaltsbreit, und ein `nowrap`-Chip dort machte die Zeitspalte
          // dieser einen Zeile dreimal so breit wie die der Nachbarn.
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
                <StatusChip ton="achtung" wort="wird gesendet …" />
              ) : (
                <StatusChip ton="alarm" wort="abgelehnt" />
              )}
              {vonAn(p.eintrag.von, p.eintrag.an)}
            </span>
          }
          toenung={z.art === 'abgelehnt' ? 'problem' : undefined}
          hinweis={hinweisZeile(
            [
              z.art === 'abgelehnt'
                ? `Vom Server abgelehnt: ${z.puffer.grund}`
                : 'Wird gesendet, sobald wieder Verbindung besteht.',
              // Die Dateien liegen schon auf dem Server und gehen per `anhang_ids` mit
              // (LFH-117, design.md D10) — die Zahl macht sichtbar, DASS sie mitgehen.
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
        key={z.schluessel}
        {...gemeinsam}
        zeit={formatUhrzeit(e.ereigniszeit, konventionen)}
        nr={`Nr. ${e.lfd_nr}`}
        typ={e.typ}
        typwort={etbTyp[e.typ].label}
        meta={vonAn(e.von, e.an)}
        toenung={e.typ === 'berichtigung' ? 'berichtigung' : undefined}
        hinweis={eintragsHinweis(e)}
        verfasser={verfasserText(e)}
        weg={e.meldeweg ? MELDEWEG_LABEL[e.meldeweg] : undefined}
      >
        {/* Unter dem Stundenkopf (h2, s. u.) — `#` im Eintrag wird h3 (LFH-621). */}
        <Markdown variante="kompakt" unterEbene={2}>
          {e.inhalt}
        </Markdown>
      </Zeitachseneintrag>
    );
  }

  /**
   * Laden und Fehler behaupten nichts über die Menge (LFH-331 · B3): ohne die Weiche
   * blitzte „Noch keine Einträge." hinter dem Ladebalken auf. Im Fehlerfall bleibt die
   * Liste montiert — bereits geladene Einträge bleiben lesbar (Spec-Festlegung D4).
   */
  let inhalt: ReactNode;
  if (sichtbar.length === 0) {
    inhalt = ladend ? <SeitenSkeleton /> : fehler ? null : leerText;
  } else {
    inhalt = gruppen.map((g, i) => (
      <div
        key={`${g.schluessel}-${g.zeilen[0].schluessel}`}
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
        <ol style={{ margin: 0, padding: 0 }}>{g.zeilen.map(zeile)}</ol>
      </div>
    ));
  }

  return (
    <div
      ref={wurzel}
      // Eine benannte Region: Vorleser springen hinein, und die e2e-Messungen greifen
      // die Sicht darüber (vorher lieferte die Datensicht diese Region).
      role="region"
      aria-label="Einsatztagebuch"
      data-lfh="etb-zeitachse"
      onFocus={betreten}
      onBlur={verlassen}
      style={{ position: 'relative' }}
    >
      {/* Überlagerung mit Nullhöhe: das Banner nimmt keinen Platz im Fluss. */}
      <div style={{ position: 'sticky', top: 0, height: 0, zIndex: 5 }}>
        {zurueckgehalten > 0 && (
          <Sammelbanner
            aktion={{
              label: 'anzeigen',
              onKlick: () => setGefroren(einfrieren(zeilen)),
            }}
            style={{ position: 'absolute', insetInline: 0, top: 0 }}
          >
            {zuflussText(zurueckgehalten)} — oben einsortiert
          </Sammelbanner>
        )}
      </div>
      {inhalt}
    </div>
  );
}
