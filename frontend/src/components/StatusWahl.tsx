import { Button, Dropdown, theme } from 'antd';
import type { ReactElement, ReactNode } from 'react';
import StatusTag from './StatusTag';
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
 * ── WARUM EIN `Button` ─────────────────────────────────────────────────────────────────
 *
 * Ein antd-`Button` erbt seine Höhe vom `ConfigProvider`; ein handgebautes Ziel schuldete die
 * zwei Angaben aus LFH-365. `type="text"` hält die Fläche unaufdringlich.
 *
 * ── FARBE ──────────────────────────────────────────────────────────────────────────────
 *
 * Das AUSLÖSER-Etikett ist ein `StatusTag` und trägt für ROLLENfarben die getönte Fläche (Werte
 * und Kontrast in `instrument/statusFlaeche.ts`). Eine MANDANTENFARBE bleibt Punkt, nie Fläche:
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
 */
export interface StatusOption<W> {
  wert: W;
  /** Sichtbare Beschriftung. Pflicht — sie IST der zweite Kanal. */
  label: string;
  /**
   * Rollenachse für den Farbpunkt im Menüeintrag. Fehlt sie, bleibt der Eintrag ungefärbt —
   * zulässig für Kataloge außerhalb des A2-Vertrags.
   */
  darstellung?: StatusDarstellung;
  /** Mandantenfarbe für den Punkt — überschreibt die Rollenfarbe (siehe `StatusTag`). */
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
}

interface StatusWahlProps<W> {
  /** Aktueller Stand als Etikett. `null` = kein Status gesetzt. */
  darstellung: StatusDarstellung | null;
  /**
   * Mandantengepflegte Zusatzfarbe des aktuellen Status: ein dekorativer Punkt neben dem Wortlaut
   * (siehe `StatusTag`).
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
  /**
   * Eigene Anzeige des aktuellen Stands statt des `StatusTag` — im FMS-Tableau (LFH-642) der
   * `StatusChip` mit S-Code und Wort. Gilt für Auslöser UND Lesezweig. Das Wort als zweiter Kanal
   * (WCAG 1.4.1) liegt dann beim Aufrufer.
   */
  etikett?: ReactNode;
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
  etikett: eigenesEtikett,
}: StatusWahlProps<W>): ReactElement {
  const { token } = theme.useToken();

  const etikett =
    eigenesEtikett != null ? (
      eigenesEtikett
    ) : darstellung ? (
      <StatusTag darstellung={darstellung} farbe={farbe} />
    ) : (
      <span>{OHNE_STATUS}</span>
    );

  // Ohne Schreibrecht KEIN Auslöser, auch kein gesperrter: ein deaktivierter Knopf verspräche
  // eine Fähigkeit, die es hier nicht gibt.
  if (!darfSchreiben) return <>{etikett}</>;

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
      <Button
        type="text"
        aria-label={`Status von ${kennung} ändern`}
        loading={laeuft}
        disabled={laeuft || gesperrt}
        style={{ paddingInline: token.paddingXXS }}
      >
        {etikett}
      </Button>
    </Dropdown>
  );
}
