import { AutoComplete, Button, Dropdown, Input, type InputRef, type RefSelectProps } from 'antd';
import type { Dayjs } from 'dayjs';
import { useState, type ComponentRef, type CSSProperties, type ReactNode, type Ref } from 'react';
import type { EtbTyp, MeldeWeg } from '../api/types';
import { ETB_PARTEI_MAX } from '../api/eingabegrenzen';
import { useZeitEingabe, ZeitpunktEingabe } from '../anzeige/ZeitpunktEingabe';
import { zuWanduhr } from '../anzeige/zeitEingabe';
import StammdatenFeld, { type Vorschlagsquelle } from '../components/StammdatenFeld';
import { Segmentleiste, useRollen } from '../components/instrument';
import { Select } from '../components/Select';
import { useMinutenTakt } from '../components/useMinutenTakt';
import { serverJetzt } from '../offline/serveruhr';
import { etbTyp, etbTypFarbe } from '../theme/statusFarben';
import BuchstabierHilfe from './BuchstabierHilfe';
import { MELDEWEG_OPTIONEN, TYP_BEFEHLE, type MetadatenWerte } from './schnellerfassungModell';

/*
 * Feldzeile der ETB-Erfassung (Change `kwc2yszv-etb-neuentwurf`, design.md D2; Spec
 * `etb-schnellerfassung-tastatur`, „Feste Felder der Erfassung“). Typ, Zeit, Von, An und Meldeweg
 * stehen als feste, beschriftete Felder über dem Inhalt, in der Reihenfolge des Papier-ETB; Tab
 * läuft sie der Reihe nach ab und danach in den Inhalt. Es gibt keinen „offenen Editor“ mehr: jedes
 * Feld schreibt direkt in `metadaten`, ein Wert gilt, sobald das Feld verlassen wird. Enter in einem
 * Feld übernimmt und springt in den Inhalt (`onFertig`), gesendet wird nur aus dem Inhalt.
 */

/** Die Typen der Feldzeile in der Folge des Entwurfs: Meldung, Anordnung, Entscheidung, Lage. */
const TYPEN: readonly EtbTyp[] = TYP_BEFEHLE;

/** Name der Typgruppe (Spec „Typwort statt Slash-Präfix“). */
export const TYP_GRUPPE = 'Typ des Eintrags';

/** Wortlaut der fehlenden Pflichtseite am Feld und in der Fußzeile. */
export const FEHLT: Record<'von' | 'an', string> = {
  von: 'Absender fehlt',
  an: 'Empfänger fehlt',
};

/** Ref eines Vorschlagsfelds (antds `AutoComplete` in `StammdatenFeld`). */
export type ParteiRef = ComponentRef<typeof AutoComplete>;

export interface FeldRefs {
  zeit: Ref<InputRef>;
  von: Ref<ParteiRef>;
  an: Ref<ParteiRef>;
  meldeweg: Ref<RefSelectProps>;
  veranlassung: Ref<InputRef>;
}

/** Ein Typ als Knopf mit Pfeil und Menü (unter `md`, Spec „Typwort statt Slash-Präfix“). */
export function TypKnopf({
  typ,
  gesperrt,
  onTyp,
}: {
  typ: EtbTyp;
  gesperrt: boolean;
  onTyp: (typ: EtbTyp) => void;
}) {
  const { token } = useRollen();
  const farbe = etbTypFarbe(typ, token);
  return (
    <Dropdown
      trigger={['click']}
      autoFocus
      disabled={gesperrt}
      menu={{
        items: TYPEN.map((t) => ({
          key: t,
          label: (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: token.marginXS }}>
              <span
                aria-hidden="true"
                data-lfh="typ-punkt"
                style={{
                  width: 6,
                  height: 6,
                  flex: '0 0 6px',
                  background: etbTypFarbe(t, token).kante,
                }}
              />
              {etbTyp[t].label}
            </span>
          ),
        })),
        selectable: true,
        selectedKeys: [typ],
        onClick: ({ key }) => onTyp(key as EtbTyp),
      }}
    >
      <Button
        disabled={gesperrt}
        aria-label={`${TYP_GRUPPE}: ${etbTyp[typ].label}`}
        style={{ font: 'inherit', color: farbe.wort, boxShadow: `inset 0 -2px 0 ${farbe.kante}` }}
      >
        <span
          aria-hidden="true"
          style={{ width: 6, height: 6, flex: '0 0 6px', background: farbe.kante }}
        />
        {etbTyp[typ].label} ▾
      </Button>
    </Dropdown>
  );
}

/** Beschriftetes Feld: das Wort links, das Feld daneben (ab `md`) oder darin (Handschirm). */
function Beschriftet({
  label,
  children,
  schmal,
  style,
}: {
  label: string;
  children: ReactNode;
  schmal: boolean;
  style?: CSSProperties;
}) {
  const { token, rollen } = useRollen();
  return (
    <span
      data-lfh="etb-feld"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: token.marginXS,
        minWidth: 0,
        ...(schmal ? { width: '100%' } : {}),
        ...style,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          fontSize: 12,
          color: rollen.text2,
          flex: '0 0 auto',
          ...(schmal ? { width: 32 } : {}),
        }}
      >
        {label}
      </span>
      {children}
    </span>
  );
}

interface ParteiFeldProps {
  feld: 'von' | 'an';
  /** Was das Feld zeigt: ausdrücklich Gesetztes oder die Vorgabe des Typs. */
  wert: string | undefined;
  /** Der angezeigte Wert kommt aus der Vorgabe (eigene Stelle). */
  ausVorgabe: boolean;
  quellen: readonly Vorschlagsquelle[];
  fehler: boolean;
  fehlerId?: string;
  gesperrt: boolean;
  feldRef: Ref<ParteiRef>;
  breite: number | string;
  onSetzen: (feld: 'von' | 'an', wert: string | undefined) => void;
  onFertig: () => void;
}

/**
 * Von oder An als Vorschlagsfeld (Spec `stammdaten-feld`). Solange nicht getippt wird, zeigt es den
 * wirksamen Wert; getippter Text gilt beim Verlassen, bei Enter oder mit einem Vorschlag. Leer
 * verlassen heißt „nicht ausdrücklich gesetzt“: dann gilt wieder die Vorgabe des Typs. Wer die
 * Vorgabe unverändert verlässt, setzt nichts — ein Typwechsel wendet die Vorgabe dann neu an.
 */
function ParteiFeld({
  feld,
  wert,
  ausVorgabe,
  quellen,
  fehler,
  fehlerId,
  gesperrt,
  feldRef,
  breite,
  onSetzen,
  onFertig,
}: ParteiFeldProps) {
  /** Getippter Text; `null` = es wird nicht getippt, das Feld zeigt den wirksamen Wert. */
  const [text, setText] = useState<string | null>(null);
  const label = feld === 'von' ? 'Von' : 'An';

  function uebernimm(roh: string) {
    setText(null);
    const neu = roh.trim();
    if (ausVorgabe && neu === wert) return;
    onSetzen(feld, neu === '' ? undefined : neu);
  }

  return (
    <span
      data-lfh={`etb-feld-${feld}`}
      data-vorgabe={ausVorgabe ? 'ja' : undefined}
      title={ausVorgabe ? 'Vorgabe: eigene Stelle' : undefined}
      style={{ display: 'inline-flex', minWidth: 0, width: breite }}
      onBlur={(e) => {
        // Nur, wenn der Fokus das Feld samt Liste verlässt (die Liste hängt im Portal).
        const ziel = e.relatedTarget as Node | null;
        if (ziel && e.currentTarget.contains(ziel)) return;
        if (text !== null) uebernimm(text);
      }}
    >
      <StammdatenFeld
        nurText
        ref={feldRef}
        aria-label={label}
        aria-invalid={fehler || undefined}
        aria-describedby={fehler ? fehlerId : undefined}
        disabled={gesperrt}
        placeholder={feld === 'von' ? 'Absender' : 'Empfänger'}
        maxLength={ETB_PARTEI_MAX}
        // Die Marke „frei“ steht in der Zeile, nicht darunter: die Feldzeile hat ein Höhenbudget.
        style={{ width: '100%', flexWrap: 'nowrap' }}
        quellen={quellen}
        value={text ?? wert ?? ''}
        onChange={setText}
        onWahl={(v) => uebernimm(v.wert)}
        onEnter={(t) => uebernimm(t)}
        // Nur Enter springt in den Inhalt; Tab gibt der Browser an das nächste Feld weiter
        // (Spec `stammdaten-feld`, „Tab nach dem Tippen“).
        onUebernahme={(u) => {
          if (u.weg === 'enter') onFertig();
        }}
        onEscape={() => setText(null)}
      />
      {/* Buchstabierhilfe (LFH-110), additiv und ohne Tab-Stopp. */}
      <BuchstabierHilfe text={text ?? wert ?? ''} zu={label} ohneTabstopp />
    </span>
  );
}

export interface EtbFeldzeileProps {
  /** `null` in der Berichtigung: der Typ ist dort fest. */
  typ: EtbTyp | null;
  onTyp: (typ: EtbTyp) => void;
  metadaten: MetadatenWerte;
  wirksam: MetadatenWerte;
  ausVorgabe: (feld: 'von' | 'an') => boolean;
  quellen: readonly Vorschlagsquelle[];
  onFeld: <F extends keyof MetadatenWerte>(feld: F, wert: MetadatenWerte[F]) => void;
  onFertig: () => void;
  /** Fehlende Pflichtseiten nach einem Sendeversuch, mit der Kennung ihres Grunds. */
  pflicht: ('von' | 'an')[];
  pflichtId: (feld: 'von' | 'an') => string;
  /** Grund am Feld Zeit (Zukunft, unlesbares `/zeit`) und seine Kennung. */
  zeitGrund: string | null;
  zeitGrundId: string;
  /** Die Ereigniszeit weicht ab (Nachtrag): Feld in der Achtungsrolle. */
  nachtrag: boolean;
  veranlassungOffen: boolean;
  onVeranlassungSchliessen: () => void;
  gesperrt: boolean;
  schmal: boolean;
  refs: FeldRefs;
}

export default function EtbFeldzeile({
  typ,
  onTyp,
  metadaten,
  wirksam,
  ausVorgabe,
  quellen,
  onFeld,
  onFertig,
  pflicht,
  pflichtId,
  zeitGrund,
  zeitGrundId,
  nachtrag,
  veranlassungOffen,
  onVeranlassungSchliessen,
  gesperrt,
  schmal,
  refs,
}: EtbFeldzeileProps) {
  const { token } = useRollen();
  const { zone } = useZeitEingabe();
  // Der Platzhalter nennt die Uhrzeit von „jetzt“ und läuft mit der Minute (`useMinutenTakt`).
  useMinutenTakt();
  const jetztText = zuWanduhr(serverJetzt(), zone).format('HHmm');

  const zeit = (
    <Beschriftet label="Zeit" schmal={schmal}>
      <ZeitpunktEingabe
        art="ereignis"
        kurzAnzeige
        kalenderOhneTabstopp
        ref={refs.zeit}
        aria-label="Zeit"
        aria-describedby={zeitGrund ? zeitGrundId : undefined}
        aria-invalid={zeitGrund ? true : undefined}
        data-lfh="etb-feld-zeit"
        data-nachtrag={nachtrag ? 'ja' : undefined}
        disabled={gesperrt}
        placeholder={`jetzt · ${jetztText}`}
        status={zeitGrund ? 'error' : nachtrag ? 'warning' : undefined}
        style={{ width: schmal ? '100%' : 190 }}
        value={metadaten.ereigniszeit ?? null}
        onChange={(v: Dayjs | null) => onFeld('ereigniszeit', v ?? undefined)}
        onOk={() => onFertig()}
      />
    </Beschriftet>
  );

  const partei = (feld: 'von' | 'an') => (
    <Beschriftet label={feld === 'von' ? 'Von' : 'An'} schmal={schmal}>
      <ParteiFeld
        feld={feld}
        wert={wirksam[feld]}
        ausVorgabe={ausVorgabe(feld)}
        quellen={quellen}
        fehler={pflicht.includes(feld)}
        fehlerId={pflichtId(feld)}
        gesperrt={gesperrt}
        feldRef={refs[feld]}
        breite={schmal ? '100%' : feld === 'von' ? 250 : 220}
        onSetzen={(f, w) => onFeld(f, w)}
        onFertig={onFertig}
      />
    </Beschriftet>
  );

  const meldeweg = (
    <Beschriftet label="Weg" schmal={schmal}>
      <Select<MeldeWeg>
        ref={refs.meldeweg}
        aria-label="Meldeweg"
        disabled={gesperrt}
        allowClear
        placeholder="–"
        style={{ width: schmal ? '100%' : 120 }}
        options={MELDEWEG_OPTIONEN}
        value={metadaten.meldeweg ?? null}
        onChange={(v) => onFeld('meldeweg', v ?? undefined)}
        onSelect={() => onFertig()}
      />
    </Beschriftet>
  );

  const veranlassung = (veranlassungOffen || metadaten.veranlassung) && (
    <Beschriftet label="Veranlassung" schmal={schmal}>
      <Input
        ref={refs.veranlassung}
        aria-label="Veranlassung"
        disabled={gesperrt}
        maxLength={ETB_PARTEI_MAX}
        style={{ width: schmal ? '100%' : 220 }}
        value={metadaten.veranlassung ?? ''}
        onChange={(e) => onFeld('veranlassung', e.target.value || undefined)}
        onPressEnter={() => onFertig()}
        onBlur={(e) => {
          if (!e.target.value.trim()) {
            onFeld('veranlassung', undefined);
            onVeranlassungSchliessen();
          }
        }}
      />
    </Beschriftet>
  );

  if (schmal) {
    // Handschirm (Zeichenfläche „Handy schreiben“): Zeit und Weg nebeneinander, Von und An auf
    // voller Breite. Den Typ trägt der Knopf vor dem Inhalt; er steht auch eingeklappt.
    return (
      <div
        data-lfh="etb-feldzeile"
        style={{ display: 'flex', flexDirection: 'column', gap: token.marginXS }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            gap: token.marginXS,
          }}
        >
          {zeit}
          {meldeweg}
        </div>
        {partei('von')}
        {partei('an')}
        {veranlassung}
      </div>
    );
  }

  return (
    <div
      data-lfh="etb-feldzeile"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        columnGap: token.marginSM,
        rowGap: token.marginXS,
      }}
    >
      {typ != null && (
        <Segmentleiste<EtbTyp>
          beschriftung={TYP_GRUPPE}
          wert={typ}
          onWechsel={(t) => {
            if (!gesperrt) onTyp(t);
          }}
          optionen={TYPEN.map((t) => {
            const farbe = etbTypFarbe(t, token);
            return {
              wert: t,
              label: etbTyp[t].label,
              punkt: farbe.kante,
              kante: farbe.kante,
              // Beim Senden steht der Typ fest; das Segment nennt den Grund (Segmentleiste).
              gesperrt: gesperrt ? 'Eintrag wird gesendet' : undefined,
            };
          })}
        />
      )}
      {zeit}
      {partei('von')}
      {partei('an')}
      {meldeweg}
      {veranlassung}
    </div>
  );
}
