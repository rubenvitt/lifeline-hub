import { Dropdown, theme } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { useTastaturEbene } from '../command-palette/CommandPaletteProvider';
import { Status } from './instrument/Status';
import { StatusBlock, StatusKnopf, type StatusVariante } from './instrument/StatusKnopf';
import { monoStil } from './instrument/rollenwerte';
import { useDichte } from '../theme/ThemeModeProvider';
import { rollenFarbe, type StatusDarstellung } from '../theme/statusFarben';

/**
 * Statuswechsel am Ort — die Statusanzeige IST der Auslöser (LFH-339 · C4). Zielform:
 * `docs/superpowers/specs/2026-07-30-kraefte-listen-statuswechsel-zielform.md` (Z1–Z3).
 *
 * ── WARUM SENKRECHT UND NICHT `Segmented` (Z1) ─────────────────────────────────────────
 *
 * Gegen die Quick-View-Obergrenze 480 px trägt eine waagerechte Reihe höchstens ZWEI
 * beschriftete Werte (Zielbreite 150 px je Statusfeld). Die Kataloge haben 10 (Fahrzeug),
 * 6 (Personal) und 5 (Material) Werte, der Fahrzeugkatalog ist mandantengepflegt.
 *
 * Senkrecht trägt, weil ein Menü SCROLLEN darf und im Portal liegt — außerhalb der Zelle und der
 * 390-px-Karte. Damit entfällt auch die feste Mindestbreite eines `<Select>`.
 *
 * ── KEIN DRAWER, KEIN ZWEITER PRIMÄRAKTIONS-SLOT (Z2/Z3) ────────────────────────────────
 *
 * Bedient wird dort, wo der Status schon steht; ein „read-only Quick-View mit Statuswahl"
 * widerspräche LFH-19. `Datensicht.tsx` sichert genau EINE Primäraktion zu, auf den Kräfteseiten
 * „Entfernen".
 *
 * ── RAHMEN HEISST BEDIENBAR (LLH-1780) ─────────────────────────────────────────────────
 *
 * Mit Schreibrecht ist der Auslöser ein `StatusKnopf`: getönte Fläche, Rahmen in der Kante der
 * Rolle, Pfeil ▾, 14 px, ein antd-`Button` mit der Dichtehöhe (LFH-365), also sichtbar so hoch
 * wie antippbar. Ohne Schreibrecht steht der randlose `Status` (Spec `status-darstellung`).
 *
 * ── MENÜ: KOPF UND LAGE (LLH-1781, Change `eon26eat-status-und-bedienung`, D7) ─────────
 *
 * `titel` setzt einen Kopf über die Einträge (Fahrzeuge: der Rufname). Beim Öffnen misst das
 * Primitiv den Platz über und unter dem Auslöser, öffnet zur größeren Seite und begrenzt die
 * Höhe auf diesen Platz; was nicht passt, rollt im Menü. Im Handschuh-Betrieb stehen die
 * Einträge zweispaltig, sobald eine Spalte nicht ins Fenster passt.
 *
 * ── FARBE ──────────────────────────────────────────────────────────────────────────────
 *
 * Der Status trägt für ROLLENfarben die getönte Fläche (Werte und Kontrast in
 * `instrument/statusFlaeche.ts`). Eine MANDANTENFARBE bleibt Punkt, nie Fläche:
 * `status_farbe` ist bei Fahrzeug und Personal ungeprüfter Freitext (`theme/statusFarben.ts`),
 * Kontrast auf großer Fläche wäre nicht zugesichert. Die Menüzeilen bleiben ungefärbt, der Punkt
 * ist quadratisch (Radius 0). antds Vollflächen-`color` scheidet aus (erzwungen weißer Text).
 *
 * Das Textlabel ist Pflicht (zweiter Kanal, WCAG 1.4.1) — der Typ {@link StatusOption}
 * erzwingt es.
 *
 * ── ZWEI FALLEN ────────────────────────────────────────────────────────────────────────
 *
 * · **Die Zuordnung gehört ans MENÜ, nicht an jedes Item** (LFH-365/LFH-366): das Synthetic
 *   Event des Portals steigt im KOMPONENTENbaum in einen klickbaren Elternteil auf; mit
 *   `onClick` am `menu` hat der Riegel genau einen Ort.
 * · **`fms_anker` ist KEINE tragende Bedienform.** Die Spalte ist nullable, ein 0–9-Tastenfeld
 *   darauf hätte Löcher. Der Anker bleibt Sortierachse und optionales Tastenkürzel.
 *
 * ── PALETTENWEG „STATUS SETZEN“ (LFH-507) ─────────────────────────────────────────────
 *
 * Das Primitiv meldet eine Tastatur-Ebene an, deren Wurzel die UMGEBENDE ZEILE ist
 * ({@link ZEILE}). Liegt der Fokus irgendwo in der Zeile, bietet die Palette „Status setzen“ an
 * und öffnet DIESES Menü; gewählt wird dort, es gibt keinen zweiten Weg zum Wert. Die Fokuszeile
 * ist damit kein eigener Zustand, sondern die Fokus-Kette des Providers. `nurMitFokus` hält die
 * Aktion aus dem Anzeige-Fallback (sonst wirkte sie auf eine beliebige Zeile). Außerhalb einer
 * Zeile (FMS-Tableau: eine Kachel ist keine Zeile) bleibt die Wurzel leer und die Ebene wirkungslos.
 * Herleitung: `openspec/changes/archive/2026-09-30-lfh-507-palette-status-setzen/design.md`.
 */

/**
 * Was als Zeile gilt: eine Tabellenzeile (antd setzt `data-row-key` am `tr`) oder eine Karte der
 * `Datensicht`. Die Seiten rendern im Tabellenzweig dasselbe Primitiv, deshalb braucht keiner der
 * beiden Zweige eigenen Code.
 */
const ZEILE = '[data-row-key], [data-lfh="datensicht-karte"]';

export interface StatusOption<W> {
  wert: W;
  /** Sichtbare Beschriftung. Pflicht — sie IST der zweite Kanal. */
  label: string;
  /**
   * Rollenachse für den Farbpunkt im Menüeintrag. Fehlt sie, bleibt der Eintrag ungefärbt —
   * zulässig für Kataloge außerhalb des A2-Vertrags.
   */
  darstellung?: StatusDarstellung;
  /** Mandantenfarbe für den Punkt — überschreibt die Rollenfarbe (siehe `Status`). */
  farbe?: string | null;
}

/**
 * Deskriptor für den Bedienweg am Statusslot der `Datensicht`.
 *
 * Über `string | number` gefasst, weil das Primitiv den Wert nur durchreicht (Katalog-IDs bzw.
 * lokales Enum); ein generischer Slot zwänge jeden Konsumenten, seinen Werttyp zu verbreitern.
 */
export interface StatusBedienung {
  optionen: readonly StatusOption<string | number>[];
  /** Aktueller Wert für die Menü-Markierung — siehe {@link StatusWahlProps.aktuell}. */
  aktuell?: string | number | null;
  /** Mandantenfarbe des aktuellen Status — siehe {@link StatusWahlProps.farbe}. */
  farbe?: string | null;
  onWaehlen: (wert: string | number) => void;
  laeuft?: boolean;
  gesperrt?: boolean;
  kennung: string;
  /** Kopf des Menüs, bei Fahrzeugen der Rufname (LLH-1781). */
  titel?: string;
}

interface StatusWahlProps<W> {
  /** Aktueller Stand als Etikett. `null` = kein Status gesetzt. */
  darstellung: StatusDarstellung | null;
  /**
   * Mandantengepflegte Zusatzfarbe des aktuellen Status: ein dekorativer Punkt neben dem Wortlaut
   * (siehe `Status`).
   */
  farbe?: string | null;
  /**
   * Aktueller Wert für die Markierung im Menü. EIGENSTÄNDIG und nicht aus
   * {@link StatusWahlProps.darstellung} erschlossen: das Label kommt bei Fahrzeug und Personal aus
   * dem Mandantenkatalog und darf umbenannt werden.
   */
  aktuell?: W | null;
  optionen: readonly StatusOption<W>[];
  /**
   * Menschenlesbare Zeilenkennung (Funkrufname, Name, Bezeichnung) für den zugänglichen Namen —
   * sonst liefern n Zeilen n gleichnamige Knöpfe.
   */
  kennung: string;
  onWaehlen: (wert: W) => void;
  /**
   * DIESE Zeile schreibt gerade — Ladeanzeige am Auslöser. Getrennt von
   * {@link StatusWahlProps.gesperrt}: „hier passiert gerade etwas" gegen „hier ist gerade nichts
   * anzunehmen".
   */
  laeuft?: boolean;
  /**
   * Nimmt keine Eingabe an — etwa weil irgendwo in der Liste eine Mutation läuft. Der Riegel
   * sitzt im `onWaehlen` der Seite; diese Prop macht ihn SICHTBAR.
   */
  gesperrt?: boolean;
  /** Ohne Schreibrecht wird ein reines Etikett gerendert, KEIN Auslöser. */
  darfSchreiben: boolean;
  /** Code vor dem Wort (FMS „S2“); in der Variante `gross` die große Ziffer. */
  code?: ReactNode;
  /** `gross`: der Statusblock einer Kachel im FMS-Tableau (LLH-1782). */
  variante?: StatusVariante;
  /** Kopf über den Menüeinträgen, nicht wählbar — bei Fahrzeugen der Rufname (LLH-1781). */
  titel?: string;
  /** Tasten, die am Auslöser direkt einen Status setzen (`aria-keyshortcuts`), etwa „0 1 2“. */
  tastenkuerzel?: string;
}

/** Kein Status gesetzt: derselbe Gedankenstrich wie im Lesezweig von `BemerkungZelle`. */
const OHNE_STATUS = '—';

export default function StatusWahl<W extends string | number>({
  darstellung,
  farbe,
  aktuell = null,
  optionen,
  kennung,
  onWaehlen,
  laeuft = false,
  gesperrt = false,
  darfSchreiben,
  code,
  variante = 'normal',
  titel,
  tastenkuerzel,
}: StatusWahlProps<W>): ReactElement {
  const { token } = theme.useToken();
  const { dichte } = useDichte();

  // Kontrolliert geöffnet, damit die Palette das Menü öffnen kann (Muster: „Spalten“, LFH-391).
  const [offen, setOffen] = useState(false);
  const bedienbar = darfSchreiben && !gesperrt && !laeuft;

  /*
   * Wird der Auslöser gesperrt oder fällt er weg, meldet antd KEIN `onOpenChange(false)`; der
   * Zustand bliebe `true`, und das Menü klappte beim Wiederfreigeben unaufgefordert auf.
   */
  useEffect(() => {
    if (!bedienbar) setOffen(false);
  }, [bedienbar]);

  // Die Zeile einmal nach dem Einhängen aus dem Auslöser auflösen. Die Callback-Ref läuft im
  // Commit, VOR dem Effekt, der die Ebene anmeldet.
  const zeile = useRef<HTMLElement | null>(null);
  const merkeZeile = useCallback((knopf: HTMLElement | null) => {
    zeile.current = knopf?.closest<HTMLElement>(ZEILE) ?? null;
  }, []);
  const oeffne = useCallback(() => setOffen(true), []);

  useTastaturEbene({
    name: `Statuswahl: ${kennung}`,
    wurzel: zeile,
    aktionen: { 'status-setzen': oeffne },
    // Ein gesperrter Knopf nimmt keine Eingabe an; eine Aktion darauf wäre wirkungslos.
    aktiv: bedienbar,
    nurMitFokus: true,
  });

  // Lage des Menüs: beim Öffnen gemessen, damit es ganz im Fenster liegt (D7).
  const knopf = useRef<HTMLButtonElement | null>(null);
  const [lage, setLage] = useState<{ unten: boolean; maxHoehe: number; zweispaltig: boolean }>({
    unten: true,
    maxHoehe: 0,
    zweispaltig: false,
  });
  const setzeOffen = useCallback(
    (neu: boolean) => {
      if (neu)
        setLage(menueLage(knopf.current, optionen.length, token.controlHeight, dichte, titel));
      setOffen(neu);
    },
    [optionen.length, token.controlHeight, dichte, titel],
  );
  const verbindeKnopf = useCallback(
    (el: HTMLButtonElement | null) => {
      knopf.current = el;
      merkeZeile(el);
    },
    [merkeZeile],
  );
  // Öffnet die Palette das Menü, misst es dieselbe Lage.
  useEffect(() => {
    if (offen)
      setLage(menueLage(knopf.current, optionen.length, token.controlHeight, dichte, titel));
  }, [offen, optionen.length, token.controlHeight, dichte, titel]);

  // Ohne Schreibrecht KEIN Auslöser, auch kein gesperrter: ein deaktivierter Knopf verspräche
  // eine Fähigkeit, die es hier nicht gibt.
  if (!darfSchreiben) {
    if (variante === 'gross')
      return <StatusBlock darstellung={darstellung} code={code} farbe={farbe} />;
    return darstellung ? (
      <Status darstellung={darstellung} farbe={farbe} code={code} trenner={code != null} />
    ) : (
      <span>{OHNE_STATUS}</span>
    );
  }

  const eintraege = optionen.map((o) => ({
    key: String(o.wert),
    label: (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: token.marginXXS }}>
        {o.darstellung && (
          // Punkt statt Fläche, für Screenreader unsichtbar: die Bedeutung trägt das Label.
          <span
            aria-hidden="true"
            style={{
              display: 'inline-block',
              width: '0.5em',
              height: '0.5em',
              borderRadius: 0,
              backgroundColor: o.farbe?.trim()
                ? o.farbe.trim()
                : rollenFarbe(o.darstellung.rolle, token),
            }}
          />
        )}
        {o.label}
      </span>
    ),
  }));

  return (
    <Dropdown
      trigger={['click']}
      open={offen}
      // Die Menüwahl schließt über denselben Weg (antd meldet `false` mit `source: 'menu'`).
      onOpenChange={setzeOffen}
      placement={lage.unten ? 'bottomLeft' : 'topLeft'}
      popupRender={(menue) => (
        <div
          data-lfh="status-menue"
          data-zweispaltig={lage.zweispaltig || undefined}
          className={lage.zweispaltig ? 'lfh-statusmenue--zweispaltig' : undefined}
          style={{
            display: 'flex',
            flexDirection: 'column',
            maxHeight: lage.maxHoehe > 0 ? lage.maxHoehe : undefined,
            background: token.colorBgElevated,
            boxShadow: token.boxShadowSecondary,
          }}
        >
          {titel && (
            <div
              data-lfh="status-menue-kopf"
              style={{
                ...monoStil(dichte === 'handschuh' ? 18 : 14, 500),
                paddingBlock: token.paddingXS,
                paddingInline: token.paddingSM,
                borderBottom: `1px solid ${token.colorBorderSecondary}`,
                color: token.colorText,
              }}
            >
              {titel}
            </div>
          )}
          <div style={{ overflowY: 'auto', minHeight: 0 }}>{menue}</div>
        </div>
      )}
      menu={{
        items: eintraege,
        selectable: true,
        selectedKeys: aktuell != null ? [String(aktuell)] : [],
        // Die Zuordnung liegt am MENÜ, nicht je Eintrag — siehe Dateikopf.
        onClick: ({ key, domEvent }) => {
          // Hält den Klick aus einer klickbaren Zeile heraus, reicht aber allein NICHT gegen das
          // Aufsteigen im Komponentenbaum — ein klickbarer Container braucht zusätzlich seinen Riegel.
          domEvent.stopPropagation();
          const treffer = optionen.find((o) => String(o.wert) === key);
          if (treffer) onWaehlen(treffer.wert);
        },
      }}
      autoFocus
    >
      <StatusKnopf
        ref={verbindeKnopf}
        darstellung={darstellung}
        farbe={farbe}
        code={code}
        variante={variante}
        aria-label={`Status von ${kennung} ändern`}
        aria-keyshortcuts={tastenkuerzel || undefined}
        loading={laeuft}
        disabled={laeuft || gesperrt}
      />
    </Dropdown>
  );
}

/** Abstand des Menüs zum Fensterrand und zum Auslöser. */
const RAND = 8;

/**
 * Lage des Menüs (D7), rein: nach unten, wenn es dort passt oder unten mehr Platz ist, sonst
 * nach oben; Höhe auf den Platz der gewählten Seite begrenzt. Im Handschuh-Betrieb zweispaltig,
 * sobald eine Spalte nicht ins Fenster passt.
 */
export function menueLage(
  ausloeser: HTMLElement | null,
  eintraege: number,
  zeilenhoehe: number,
  dichte: string,
  titel: string | undefined,
  fensterhoehe: number = typeof window === 'undefined' ? 0 : window.innerHeight,
): { unten: boolean; maxHoehe: number; zweispaltig: boolean } {
  const kopf = titel ? zeilenhoehe : 0;
  const einspaltig = eintraege * zeilenhoehe + kopf + RAND;
  const zweispaltig = dichte === 'handschuh' && einspaltig > fensterhoehe - 2 * RAND;
  const benoetigt = zweispaltig ? Math.ceil(eintraege / 2) * zeilenhoehe + kopf + RAND : einspaltig;
  if (!ausloeser || fensterhoehe <= 0) return { unten: true, maxHoehe: 0, zweispaltig };
  const r = ausloeser.getBoundingClientRect();
  const unten = Math.max(0, fensterhoehe - r.bottom - 2 * RAND);
  const oben = Math.max(0, r.top - 2 * RAND);
  const nachUnten = unten >= benoetigt || unten >= oben;
  return { unten: nachUnten, maxHoehe: Math.floor(nachUnten ? unten : oben), zweispaltig };
}
