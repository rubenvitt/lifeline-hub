import { ConfigProvider, Typography, theme } from 'antd';
import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { TbChevronRight } from 'react-icons/tb';
import { useTastaturEbene } from '../command-palette/CommandPaletteProvider';
import { flaeche, schrift, schriftskala, type Farbrollen } from '../theme/tokens';
// Seiten unter diesem Primitiv benutzen die `.lfh-*`-Klassen aus `sprache.css`. Alle Selektoren
// dort sind klassengebunden, sie färben nichts ein, was sie nicht anfassen.
import '../theme/sprache.css';
import './EinsatzSeite.css';
import Datenstand from './Datenstand';
import FensterRahmen from './FensterRahmen';
import { useModusFarben } from './rahmenStil';

/** Höhe der Seitenkopfleiste (Neuentwurf: 44 px). Layoutmaß und Boden — Aktionen in
 *  `komfortabel`/`handschuh` (48/72) lassen sie wachsen. */
const SEITENKOPF_HOEHE = 44;

/**
 * Stil der Seitenkopfleiste — rein und exportiert.
 *
 * `vollbreit`: die Leiste zieht über die Seitenrinne bis an die Ränder des Inhaltsbereichs
 * (negativer Rand um `--lfh-seiten-polsterung`, Innenrand wieder dieselbe Rinne), wie die
 * ETB-Erfassungsleiste. Nur `EinsatzSeite` setzt das, weil sie direkt im `<Content>` sitzt;
 * `AdminPage` steht neben der Verwaltungs-Seitenleiste und bleibt in ihrer Spalte.
 */
export function seitenkopfStil(
  token: { margin: number; marginLG: number; paddingXS: number },
  farben: Pick<Farbrollen, 'linie'>,
  vollbreit: boolean,
): CSSProperties {
  return {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: token.margin,
    rowGap: token.paddingXS,
    minHeight: SEITENKOPF_HOEHE,
    paddingBlock: token.paddingXS,
    borderBottom: `1px solid ${farben.linie}`,
    marginBottom: token.marginLG,
    boxSizing: 'border-box',
    ...(vollbreit
      ? {
          marginInline: 'calc(-1 * var(--lfh-seiten-polsterung))',
          marginTop: 'calc(-1 * var(--lfh-seiten-polsterung))',
          paddingInline: 'var(--lfh-seiten-polsterung)',
        }
      : {}),
  };
}

/** Titel im Seitenkopf: 14/600 (`schriftskala.seitentitel`). SEMANTISCH ist er das `h1` der
 *  Seite, optisch bleibt er klein — die Ebene folgt der Gliederung, der Satz dem Entwurf. */
export function seitentitelStil(farben: Pick<Farbrollen, 'text'>): CSSProperties {
  return {
    margin: 0,
    fontFamily: schrift[schriftskala.seitentitel.familie],
    fontSize: schriftskala.seitentitel.groesse,
    fontWeight: schriftskala.seitentitel.gewicht,
    lineHeight: 1.4,
    color: farben.text,
  };
}

/** Mono-Meta neben dem Titel (`schriftskala.meta`). */
export function seitenMetaStil(farben: Pick<Farbrollen, 'gedaempft'>): CSSProperties {
  return {
    fontFamily: schrift[schriftskala.meta.familie],
    fontSize: schriftskala.meta.groesse,
    fontVariantNumeric: 'tabular-nums',
    color: farben.gedaempft,
    whiteSpace: 'nowrap',
  };
}

/**
 * Der Ortspfad im Seitenkopf: 12 px, `schwach`, Chevron als Trenner, letzter Teil `text2`.
 *
 * Über einen verschachtelten `ConfigProvider`, nicht über Props: der Breadcrumb ist ein
 * `ReactNode` der Seite, Trenner und Farben lassen sich nur so einheitlich setzen. Der letzte
 * Eintrag nennt die Seite selbst und wird ausgeblendet (`EinsatzSeite.css`), sonst stünde
 * „Schäden › Schäden" da.
 */
function Ortspfad({ children, farben }: { children: ReactNode; farben: Farbrollen }) {
  return (
    <ConfigProvider
      breadcrumb={{
        separator: (
          <span aria-hidden="true" style={{ display: 'inline-flex', verticalAlign: 'middle' }}>
            <TbChevronRight size={13} />
          </span>
        ),
      }}
      theme={{
        token: { fontSize: 12 },
        components: {
          Breadcrumb: {
            itemColor: farben.schwach,
            linkColor: farben.schwach,
            separatorColor: farben.schwach,
            lastItemColor: farben.text2,
          },
        },
      }}
    >
      <div className="lfh-seitenkopf__pfad">{children}</div>
    </ConfigProvider>
  );
}

interface EinsatzSeiteProps {
  titel: ReactNode;
  /** Einzeilige, gedämpfte Beschreibung unter dem Titel. */
  beschreibung?: ReactNode;
  /** Ortsangabe vor dem Titel (z. B. eine `Breadcrumb` aus `routing/deeplinks`). */
  breadcrumb?: ReactNode;
  /**
   * Optionales Mono-Meta neben dem Titel, z. B. eine Nummer oder ein Zählerstand. Zahlen und
   * Zeiten laufen in Mono.
   */
  meta?: ReactNode;
  /**
   * Rechter Header-Slot — **genau eine Primäraktion**, der Rest sekundär.
   *
   * Der Slot wird AUSSERHALB jedes `<Form>` gerendert. Ein Speichern-Button hier darf KEIN
   * `htmlType="submit"` tragen, er submittete nichts. Verdrahtung: Seite hält `Form.useForm()`,
   * gibt `<Button type="primary" onClick={() => form.submit()}>` hier hinein und legt
   * `<Form form={form}>` in `children`.
   */
  aktionen?: ReactNode;
  /**
   * Anlegen-Aktion der Seite für die Kommandopalette („Neue Zeile", LFH-391 · B5).
   *
   * Ein CALLBACK, weil sich aus dem `ReactNode` in `aktionen` kein Aufruf ziehen lässt. Die Seite
   * gibt **denselben** Callback hinein wie ihrem Anlegen-Knopf, **samt Rechte-Riegel**
   * (`darfSchreiben ? cb : undefined`): die Palette ist ein zweiter Bedienweg und darf keinen
   * anderen Riegel haben.
   *
   * Fehlt sie, wird **gar keine** Ebene registriert (siehe `aktiv` unten).
   */
  neueZeile?: () => void;
  /** Optionaler Hinweis unter dem Header (z. B. ein read-only-Alert). */
  hinweis?: ReactNode;
  /** Letzter erfolgreicher Listenabruf (`query.dataUpdatedAt`). */
  dataUpdatedAt?: number;
  /**
   * Breite des Inhalts unter der Kopfleiste. Vorgabe `'voll'`: die Instrumententafel füllt die
   * Inhaltsbreite. `'schmal'` (`flaeche.seiteSchmal`) ist die Lesebreite reiner
   * Formular-/Editor-/Leseseiten — die begründete Ausnahme, AUSDRÜCKLICH gesetzt, nie geerbt.
   * Eine freie Pixelzahl gibt es nicht.
   */
  breite?: SeitenBreite;
  /** Arbeitsfläche bis zum Fensterende; children folgen darunter im Dokumentfluss. */
  fensterInhalt?: { inhalt: ReactNode; mindestHoehe?: number };
  /**
   * Angepinnter Seitenfuß (LFH-373). Steht als LETZTES Kind der Seitenwurzel, nicht im Inhalt:
   * ein `position: sticky; bottom: 0` steigt nie über die Oberkante seines Elternblocks, im
   * Inhalt hinge er unter einem hohen Kopf fest und ragte unter das Fenster. Die Polsterung trägt
   * der Fuß selbst.
   */
  fuss?: ReactNode;
  children: ReactNode;
}

/** Breite des Seiteninhalts — siehe `EinsatzSeiteProps.breite`. */
export type SeitenBreite = 'voll' | 'schmal';

/**
 * Löst `breite` in ein `maxWidth` auf — rein und exportiert. `'voll'` ergibt KEINE Grenze
 * (`undefined`, nicht `'100%'`), die sonst einem Aufrufer im Weg stünde, der per `style`
 * nachsteuert.
 */
export function seitenBreiteMax(breite: SeitenBreite): number | undefined {
  return breite === 'schmal' ? flaeche.seiteSchmal : undefined;
}

/**
 * Zählt die Primär-Buttons im Aktionen-Slot. Erkannt über das Klassen-Suffix, weil der
 * antd-Prefix am `ConfigProvider` konfigurierbar ist.
 */
function primaeraktionen(wurzel: HTMLElement): number {
  return Array.from(wurzel.querySelectorAll('button')).filter((knopf) =>
    Array.from(knopf.classList).some((klasse) => klasse.endsWith('-btn-primary')),
  ).length;
}

/**
 * Geteilter Seiten-Rahmen + Kopf für die Einsatz-Modulseiten (LFH-328/A2), nach dem Muster von
 * `AdminPage`. Abstände und Farben kommen aus `theme.useToken()` bzw. `theme/tokens.ts`.
 *
 * Der Seitenkopf ist eine 44-px-Leiste mit Titel 14/600, Mono-Meta und Aktionen; der Inhalt
 * füllt per Vorgabe die ganze Breite (`breite`).
 *
 * **Überschriftenebene:** der Titel ist das `h1` der Seite (Satz bleibt 14/600), Paneele und
 * Abschnitte darunter `h2`, Unterabschnitte `h3`. Genau EIN `h1` je Seite: die Lagekarte baut
 * ihren Kopf selbst mit `level={1}`, die Anmeldeseite ist eine eigene Route ohne diesen Rahmen.
 */
export default function EinsatzSeite({
  titel,
  beschreibung,
  breadcrumb,
  meta,
  aktionen,
  neueZeile,
  hinweis,
  dataUpdatedAt,
  breite = 'voll',
  fensterInhalt,
  fuss,
  children,
}: EinsatzSeiteProps) {
  const { token } = theme.useToken();
  const farben = useModusFarben();
  const aktionenRef = useRef<HTMLDivElement>(null);
  const seitenWurzel = useRef<HTMLDivElement>(null);

  /*
   * Seitenweite Tastatur-Ebene (LFH-391 · B5): sie liegt in der Ebenen-KETTE ÜBER den tiefen
   * Werkzeugleisten, statt sie zu verdrängen.
   *
   * `name` ist eine KONSTANTE, nicht aus `titel` abgeleitet: er steht in den Effekt-Deps, und ein
   * `ReactNode` hätte bei jedem Render eine neue Identität.
   *
   * `aktiv` hängt an der Prop: eine LEERE Ebene verdrängte im Anzeige-Fallback (der die flachste
   * Ebene greift) die nützliche Werkzeugleiste darunter.
   */
  useTastaturEbene({
    name: 'Seitenaktionen',
    wurzel: seitenWurzel,
    aktionen: { 'neue-zeile': neueZeile },
    aktiv: neueZeile != null,
  });

  // „Genau eine Primäraktion, rechts" — als Dev-Warnung, nicht als Typsignatur: TypeScript sieht
  // durch einen `ReactNode` nicht hindurch (Tooltip-Hülle, Fragment mit zwei Knöpfen, bedingte
  // zweite Primäraktion). Geprüft wird, was im DOM steht. Kein Dep-Array: die Prüfung ist eine
  // reine Abfrage.
  useEffect(() => {
    if (!import.meta.env.DEV || !aktionenRef.current) return;
    const anzahl = primaeraktionen(aktionenRef.current);
    if (anzahl > 1) {
      console.warn(
        `EinsatzSeite („${typeof titel === 'string' ? titel : 'ohne Titel'}"): ${anzahl} Primäraktionen ` +
          'im Kopf. Erlaubt ist genau eine — die weiteren als sekundäre Buttons ' +
          'führen (LFH-328/A2).',
      );
    }
  });

  const koerperStil: CSSProperties = { maxWidth: seitenBreiteMax(breite) };

  const kopf = (
    <>
      {/**
       * DIE SEITENKOPFLEISTE: 44 px, Haarlinie unten, bis an die Ränder des Inhaltsbereichs. Links
       * Ortspfad und Titel 14/600 mit Mono-Meta, rechts der Aktionen-Slot.
       *
       * `wrap` ist keine Kosmetik (LFH-339 · C4): ohne es sprengte ein Knopf mit langer Beschriftung
       * den schmalen Schirm. `minWidth: 0` an beiden Kindern, weil ein Flex-Kind sonst nicht unter
       * seine Inhaltsbreite schrumpft.
       */}
      <div data-lfh="seitenkopf" style={seitenkopfStil(token, farben, true)}>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            columnGap: token.marginXS * 3,
            rowGap: 2,
            minWidth: 0,
          }}
        >
          {breadcrumb && <Ortspfad farben={farben}>{breadcrumb}</Ortspfad>}
          <Typography.Title level={1} style={seitentitelStil(farben)}>
            {titel}
          </Typography.Title>
          {/* Meta und Datenstand sind EINE Gruppe mit eigener Zeile unter `md` (`EinsatzSeite.css`,
              LFH-373): in der Titelzeile schöbe eine spät eintreffende Meta alles darunter nach unten.
              Per CSS, nicht per `useViewport`, dessen erstes Bild bewusst breit ist. */}
          {(meta || dataUpdatedAt !== undefined) && (
            <span
              className="lfh-seitenkopf__meta"
              style={{
                display: 'inline-flex',
                flexWrap: 'wrap',
                alignItems: 'baseline',
                columnGap: token.marginXS * 3,
                rowGap: 2,
                minWidth: 0,
              }}
            >
              {/* Die Gruppe bricht um, ihre Teile nicht — eine lange Meta liefe bei 390 px sonst quer
                  über die Seite. */}
              {meta && <span style={seitenMetaStil(farben)}>{meta}</span>}
              <span style={{ color: farben.gedaempft, whiteSpace: 'nowrap' }}>
                {/* Führt die Seite einen Datenstand (auch `0` vor dem ersten Abruf), hält der Kopf seinen
                    Platz frei — sonst bräche er beim Eintreffen um. */}
                <Datenstand
                  dataUpdatedAt={dataUpdatedAt}
                  platzHalten={dataUpdatedAt !== undefined}
                />
              </span>
            </span>
          )}
        </div>
        {/* Die Marke macht „genau eine Primäraktion IM KOPF" von außen prüfbar (LFH-340 · C5);
            global gezählt fiele eine Seite mit Formular im Inhalt zu Unrecht durch. Die
            Dev-Warnung oben zählt denselben Teilbaum. */}
        {aktionen && (
          <div
            ref={aktionenRef}
            data-lfh="seitenkopf-aktionen"
            style={{ minWidth: 0, display: 'flex', flexWrap: 'wrap', gap: token.marginXS * 2 }}
          >
            {aktionen}
          </div>
        )}
      </div>
      {(beschreibung || hinweis) && (
        <div style={koerperStil}>
          {beschreibung && (
            <div style={{ marginBottom: token.margin }}>
              <Typography.Text type="secondary">{beschreibung}</Typography.Text>
            </div>
          )}
          {hinweis && <div style={{ marginBottom: token.marginLG }}>{hinweis}</div>}
        </div>
      )}
    </>
  );

  // Die WURZEL ist vollbreit (sonst reichte die Kopfleiste nur so weit wie die Lesebreite);
  // `breite` gilt nur dem Inhalt darunter. Linksbündig: Seiten sind an der Navigation verankert.
  return (
    <div ref={seitenWurzel}>
      {fensterInhalt != null ? (
        <FensterRahmen kopf={kopf} mindestHoehe={fensterInhalt.mindestHoehe}>
          <div style={{ ...koerperStil, height: '100%' }}>{fensterInhalt.inhalt}</div>
        </FensterRahmen>
      ) : (
        kopf
      )}
      <div data-lfh="seiten-inhalt" style={koerperStil}>
        {children}
      </div>
      {fuss}
    </div>
  );
}
