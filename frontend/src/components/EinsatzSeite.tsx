import { ConfigProvider, Typography, theme } from 'antd';
import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { TbChevronRight } from 'react-icons/tb';
import { useTastaturEbene } from '../command-palette/CommandPaletteProvider';
import { flaeche, schrift, schriftskala, type Farbrollen } from '../theme/tokens';
// `sprache.css` bleibt importiert: Seiten unter diesem Primitiv benutzen ihre `.lfh-*`-
// Klassen. Alle Selektoren der Datei sind klassengebunden — sie färbt also nichts ein, was
// sie nicht anfasst. Der Akzentstrich über dem Titel ist mit dem Neuentwurf entfallen.
import '../theme/sprache.css';
import './EinsatzSeite.css';
import Datenstand from './Datenstand';
import FensterRahmen from './FensterRahmen';
import { useModusFarben } from './rahmenStil';

/** Höhe der Seitenkopfleiste (Neuentwurf: 44 px). Layoutmaß und Boden — Aktionen in
 *  `komfortabel`/`handschuh` (48/72) lassen sie wachsen. */
export const SEITENKOPF_HOEHE = 44;

/**
 * Stil der Seitenkopfleiste — rein und exportiert.
 *
 * `vollbreit`: die Leiste zieht über die Seitenrinne bis an die Ränder des Inhaltsbereichs
 * (negativer Rand um genau `--lfh-seiten-polsterung`, Innenrand wieder dieselbe Rinne) —
 * dieselbe Bauform wie die ETB-Erfassungsleiste (`index.css`, `.etb-erfassung-sticky`). Nur
 * `EinsatzSeite` setzt das: sie sitzt direkt im `<Content>` der Layouts. `AdminPage` steht
 * neben der Verwaltungs-Seitenleiste und bleibt in ihrer Spalte.
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
 * `ReactNode` der Seite (14 Aufrufer bauen ihn selbst) — Trenner und Farben lassen sich nur so
 * einheitlich setzen, ohne jede Seite anzufassen. Der letzte Eintrag des Pfads nennt die
 * Seite selbst; er wird ausgeblendet (`EinsatzSeite.css`), weil der Titel ihn direkt danach
 * als Überschrift trägt — sonst stünde „Schäden › Schäden" da.
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
   * Optionales Mono-Meta neben dem Titel (Neuentwurf: „Titel 14/600 + Mono-Meta"), z. B.
   * eine Nummer oder ein Zählerstand. Zahlen und Zeiten laufen in Mono.
   */
  meta?: ReactNode;
  /**
   * Rechter Header-Slot — **genau eine Primäraktion**, der Rest sekundär.
   *
   * WICHTIG (wörtlich von `AdminPage` übernommen, inkl. der Falle): der Slot wird
   * AUSSERHALB jedes `<Form>` gerendert. Ein Speichern-Button hier darf KEIN
   * `htmlType="submit"` tragen — als DOM-Geschwister außerhalb des `<form>`
   * submittet er nichts. Verdrahtung: Seite hält `Form.useForm()`, gibt
   * `<Button type="primary" onClick={() => form.submit()}>` hier hinein und legt
   * `<Form form={form}>` in `children`.
   */
  aktionen?: ReactNode;
  /**
   * Anlegen-Aktion der Seite für die Kommandopalette („Neue Zeile", LFH-391 · B5).
   *
   * Bewusst ein CALLBACK und nicht aus `aktionen` abgeleitet: der Slot ist ein `ReactNode`,
   * und aus einem ReactNode lässt sich kein Aufruf ziehen. Die Seite gibt hier **denselben**
   * Callback hinein, den ihr Anlegen-Knopf trägt — **samt seinem Rechte-Riegel**
   * (`darfSchreiben ? cb : undefined`). Das Vorhandensein der Prop ist kein Rechtebeleg
   * (CLAUDE.md, LFH-372): die Palette ist ein zweiter Bedienweg auf dieselbe Aktion und darf
   * keinen anderen Riegel haben als der erste.
   *
   * Fehlt sie, wird **gar keine** Ebene registriert (siehe `aktiv` unten).
   */
  neueZeile?: () => void;
  /** Optionaler Hinweis unter dem Header (z. B. ein read-only-Alert). */
  hinweis?: ReactNode;
  /** Letzter erfolgreicher Listenabruf (`query.dataUpdatedAt`). */
  dataUpdatedAt?: number;
  /**
   * Breite des Inhalts unter der Kopfleiste. Vorgabe `'voll'`: der Neuentwurf ist eine
   * Instrumententafel über die ganze Inhaltsbreite (22.09.2026) — Listen, Übersichten,
   * Tabellen, Zeitachsen, Kartenraster und Detailseiten mit Datenraster. `'schmal'` begrenzt
   * auf die Lesebreite einer reinen Formular-/Editor-/Leseseite (`flaeche.seiteSchmal`:
   * Befehl- und Lagebericht-Editor, Einstellungen, Einsatzdaten, Aufnahme) — das ist die
   * begründete Ausnahme und wird deshalb AUSDRÜCKLICH gesetzt, nie geerbt.
   *
   * Eine freie Pixelzahl gibt es nicht mehr: zwei Achsenwerte sind eine Entscheidung, eine
   * Zahl je Seite waren zwanzig.
   */
  breite?: SeitenBreite;
  /** Arbeitsfläche bis zum Fensterende; children folgen darunter im Dokumentfluss. */
  fensterInhalt?: { inhalt: ReactNode; mindestHoehe?: number };
  /**
   * Angepinnter Seitenfuß (LFH-373). Steht als LETZTES Kind der Seitenwurzel, hinter dem
   * Inhalt und nicht darin: ein `position: sticky; bottom: 0` kann nie über die Oberkante
   * seines Elternblocks steigen. Im Inhalt hing die ETB-Erfassung bei 390 px im
   * Handschuh-Betrieb unter einem 489 px hohen Kopf fest und ragte ganz oben auf der Seite
   * 61 px unter das Fenster; als Kind der Wurzel beginnt ihr Elternblock mit dem Seitenkopf.
   * Die Polsterung trägt der Fuß selbst (die Wurzel hat keine).
   */
  fuss?: ReactNode;
  children: ReactNode;
}

/** Breite des Seiteninhalts — siehe `EinsatzSeiteProps.breite`. */
export type SeitenBreite = 'voll' | 'schmal';

/**
 * Löst `breite` in ein `maxWidth` auf — rein und exportiert. `'voll'` ergibt KEINE Grenze
 * (`undefined`, nicht `'100%'`): ein `maxWidth` von 100 % ist wirkungslos und stünde nur im
 * Weg, wenn ein Aufrufer per `style` nachsteuert.
 */
export function seitenBreiteMax(breite: SeitenBreite): number | undefined {
  return breite === 'schmal' ? flaeche.seiteSchmal : undefined;
}

/**
 * Zählt die Primär-Buttons im Aktionen-Slot. Die Klasse wird über ihr Suffix
 * erkannt, nicht über das Literal `ant-btn-primary` — der antd-Prefix ist am
 * `ConfigProvider` konfigurierbar.
 */
function primaeraktionen(wurzel: HTMLElement): number {
  return Array.from(wurzel.querySelectorAll('button')).filter((knopf) =>
    Array.from(knopf.classList).some((klasse) => klasse.endsWith('-btn-primary')),
  ).length;
}

/**
 * Geteilter Seiten-Rahmen + Kopf für die Einsatz-Modulseiten (LFH-328/A2), nach
 * dem Muster von `AdminPage`. Abstände und Farben kommen aus `theme.useToken()`
 * bzw. `theme/tokens.ts` — keine Pixel von Hand.
 *
 * **Neuentwurf (21./22.09.2026):** der Seitenkopf ist eine 44-px-Leiste mit Titel 14/600,
 * Mono-Meta und Aktionen; der frühere A0-Akzentstrich über dem Titel ist entfallen. Der
 * Inhalt füllt per Vorgabe die ganze Breite (`breite`), eine Lesebreite ist Ausnahme.
 *
 * **Überschriftenebene (22.09.2026):** der Titel ist das `h1` der Seite (Satz bleibt 14/600),
 * Paneele und Abschnitte darunter sind `h2` (Vorgabe von `Paneel`, `SektionHeader`),
 * Unterabschnitte `h3`. Genau EIN `h1` je Seite: die Lagekarte baut ihren Kopf selbst und
 * setzt dort ebenfalls `level={1}`; die Anmeldeseite ist eine eigene Route ohne diesen Rahmen.
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
   * Die erste SEITENWEITE Tastatur-Ebene des Repos (LFH-391 · B5). Die vier bisherigen
   * Registrierungen (Datensicht, Erfassung, EtbPage, KatalogTabelle) haben alle schmale
   * Wurzeln — genau dafür ist die Ebenen-KETTE aus B1 gebaut: diese flache Ebene liegt
   * ÜBER den tiefen Werkzeugleisten, statt sie zu verdrängen.
   *
   * `name` ist eine KONSTANTE und ausdrücklich nicht aus `titel` abgeleitet: er steht in den
   * Effekt-Deps von `useTastaturEbene`, und `titel` ist ein `ReactNode` — eine neue Identität
   * bei jedem Render meldete die Ebene bei jedem Titelwechsel ab und neu an.
   *
   * `aktiv` hängt an der Prop, nicht am Rendern: eine Detailseite ohne Anlegen-Aktion stellte
   * sonst eine LEERE Ebene in Kette und Anzeige-Fallback — und weil der Fallback die
   * FLACHSTE Ebene greift, verdrängte ausgerechnet die leere Seitenebene die nützliche
   * Werkzeugleiste darunter.
   */
  useTastaturEbene({
    name: 'Seitenaktionen',
    wurzel: seitenWurzel,
    aktionen: { 'neue-zeile': neueZeile },
    aktiv: neueZeile != null,
  });

  // „Genau eine Primäraktion, rechts" — als Dev-Warnung, nicht als Typsignatur.
  // Das ist die ehrlichere Variante: der Slot ist `ReactNode`, und TypeScript sieht
  // durch einen `ReactNode` nicht hindurch. Ein Typ wie `primaeraktion?: ReactElement`
  // würde die Regel nur BEHAUPTEN — er kann weder ein `<Tooltip><Button type="primary">`
  // noch ein Fragment mit zwei Knöpfen noch eine bedingt gerenderte zweite Primäraktion
  // erkennen. Geprüft wird deshalb, was wirklich im DOM steht. Kein Dep-Array: die
  // Aktionen ändern sich mit jedem Render, und die Prüfung ist eine reine Abfrage.
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
       * DIE SEITENKOPFLEISTE (Neuentwurf „Instrumententafel", `neuentwurf.dc.html` S2):
       * 44 px, Haarlinie unten, bis an die Ränder des Inhaltsbereichs. Links Ortspfad und
       * Titel 14/600 mit Mono-Meta, rechts der Aktionen-Slot. Der Akzentstrich über dem
       * Titel (A0-Signatur) ist entfallen — die Leiste trägt die Seite, kein Titelblock.
       *
       * `wrap` ist keine Kosmetik (LFH-339 · C4, gemessen): ohne es steht der Aktionsblock
       * unbedingt neben dem Titel, und ein einziger Knopf mit langer Beschriftung sprengt
       * den Schirm (`/fahrzeuge` bei 390 px lief bis 505 px). `minWidth: 0` an beiden
       * Kindern, weil ein Flex-Kind sonst nicht unter seine Inhaltsbreite schrumpft.
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
          {meta && <span style={seitenMetaStil(farben)}>{meta}</span>}
          <span style={{ color: farben.gedaempft }}>
            <Datenstand dataUpdatedAt={dataUpdatedAt} />
          </span>
        </div>
        {/* Die Marke macht die Zusicherung von außen prüfbar (LFH-340 · C5): „genau eine
            Primäraktion IM KOPF" ist ohne sie nur global zählbar, und eine Seite mit einem
            Formular im Inhalt (dessen Absende-Knopf zu Recht primär ist) fiele durch, ohne
            im Kopf etwas falsch zu machen. Die Dev-Warnung oben zählt bereits genau diesen
            Teilbaum — das Attribut gibt dem Test denselben Zuschnitt. */}
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
  // eine ausdrücklich gesetzte Lesebreite `breite` gilt nur dem Inhalt darunter. Linksbündig
  // statt zentriert: der Entwurf verankert Seiten an der Navigation, nicht in der
  // Fenstermitte — ein zentrierter Inhalt unter einem linksbündigen Titel stünde versetzt.
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
