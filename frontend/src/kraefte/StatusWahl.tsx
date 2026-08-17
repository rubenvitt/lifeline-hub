import { Button, Dropdown, theme } from 'antd';
import type { ReactElement } from 'react';
import StatusTag from '../components/StatusTag';
import { rollenFarbe, type StatusDarstellung } from '../theme/statusFarben';

/**
 * Statuswechsel am Ort — die Statusanzeige IST der Auslöser (LFH-339 · C4).
 *
 * Umsetzung der Festlegungen Z1–Z3 aus
 * `docs/superpowers/specs/2026-07-30-kraefte-listen-statuswechsel-zielform.md`. Wo das
 * Elternticket dieser Spec widerspricht, gilt die Spec — so ausdrücklich in ihrem Kopf.
 *
 * ── WARUM SENKRECHT UND NICHT `Segmented` (Z1, gerechnet) ──────────────────────────────
 *
 * Gegen die Quick-View-Obergrenze 480 px trägt eine waagerechte Reihe höchstens ZWEI
 * beschriftete Werte — dichteunabhängig, weil die Zielbreite 150 px die im Bestand als
 * nötig befundene `minWidth` der Statusfelder ist, nicht eine geschätzte Zeichenbreite.
 * Die Kataloge haben 10 (Fahrzeug, FMS 0–9), 6 (Personal) und 5 (Material) Werte; jeder
 * liegt über jeder Schwelle, in jeder Dichtestufe. Der Fahrzeugkatalog ist zudem
 * mandantengepflegt — zehn ist der Seed, nicht die Obergrenze.
 *
 * Senkrecht trägt, weil ein Menü SCROLLEN darf und im Portal liegt: außerhalb der Zelle
 * und außerhalb der 390-px-Karte. Damit entfällt zugleich die feste Mindestbreite, die
 * das frühere `<Select>` aus der schmalen Karte drängte (`Datensicht.tsx:234-236`) — das
 * ist der eigentliche Grund, warum der Statuswechsel dort bisher fehlte.
 *
 * ── WARUM KEIN DRAWER (Z2/Z3) ──────────────────────────────────────────────────────────
 *
 * Das Elternticket verlangte einen „read-only Quick-View mit Statuswahl". Das ist ein
 * Eigenwiderspruch gegen LFH-19 („read-only Vorschau ODER Schnellerfassung") und hätte
 * eine dritte Drawer-Art erfunden. Er entfällt hier, statt umbenannt zu werden: bedient
 * wird an der Stelle, an der der Status schon steht. Die Zahl der Inhalts-Drawer steigt
 * durch dieses Primitiv NICHT.
 *
 * Es entsteht auch kein zweiter Primäraktions-Slot: `Datensicht.tsx` sichert genau EINE
 * Primäraktion zu, und die ist auf allen drei Seiten mit „Entfernen" belegt.
 *
 * ── WARUM EIN `Button` UND KEIN GESTYLTES `<span onClick>` ─────────────────────────────
 *
 * Ein handgebautes Bedienziel schuldet nach LFH-365 ZWEI Angaben (`minHeight:
 * token.controlHeight` PLUS Polsterung) und eine eigene Zusicherung über zwei
 * Dichtestufen, weil kein Guard eine Pixelangabe sieht. Ein antd-`Button` erbt seine Höhe
 * vom `ConfigProvider` und schuldet nichts davon. `type="text"` hält die Fläche
 * unaufdringlich — die Farbe der Statusrolle soll die einzige im Etikett bleiben.
 *
 * ── DIE FARBE STEHT NEBEN DEM TEXT, NIE DAHINTER (Z2b) ─────────────────────────────────
 *
 * Zwei belegte Gründe, warum „Statusfarbe als Fläche" aus dem Elternticket eine
 * begründete Entscheidung zurückdrehen würde:
 *
 *  1. `components/StatusTag.tsx` verwirft antds Vollflächen-`color` ausdrücklich: ein
 *     Nicht-Preset-Wert rendert als Fläche mit erzwungen weißem Text, und im Dunkelmodus
 *     sind die Rollenfarben aufgehellt — Weiß darauf ist unlesbar.
 *  2. Für Fahrzeug und Personal liegt die Statusfarbe gar nicht im Rollenvertrag, sondern
 *     als ungeprüfter Freitext `status_farbe` in der DB (`theme/statusFarben.ts`). Eine
 *     Flächenvorschrift schriebe unvalidierte Mandantenfarben auf große Flächen; Kontrast
 *     (WCAG 1.4.11) ist dort nicht zugesichert. Auf einem Punkt trägt die Farbe keine
 *     Textlesbarkeit — genau deshalb ist das die zulässige Form.
 *
 * Das Textlabel ist Pflicht (zweiter Kanal, WCAG 1.4.1) — der Typ {@link StatusOption}
 * erzwingt es, nicht die Disziplin.
 *
 * ── ZWEI FALLEN, DIE HIER SCHON GEMESSEN WURDEN ────────────────────────────────────────
 *
 * · **Die Zuordnung gehört ans MENÜ, nicht an jedes Item** (LFH-365/LFH-366). Liegt das
 *   Menü in einem klickbaren Elternteil — eine Tabellenzeile, eine Karte —, steigt sein
 *   Synthetic Event aus dem Portal in den KOMPONENTENbaum auf und feuert dessen `onClick`
 *   mit. Mit `onClick` am `menu` hat der Riegel dagegen genau einen Ort.
 * · **`fms_anker` wird NICHT tragende Bedienform.** Die Spalte ist nullable, ein Mandant
 *   darf sie frei lassen (`stammdaten/StatusKatalogTab.test.tsx:181`); ein 0–9-Tastenfeld
 *   darauf hätte Löcher. Der Ziffernraum steht ohnehin schon im Label („1 – Frei auf
 *   Funk"). Der Anker bleibt Sortierachse und optionales Tastenkürzel.
 */
export interface StatusOption<W> {
  wert: W;
  /** Sichtbare Beschriftung. Pflicht — sie IST der zweite Kanal. */
  label: string;
  /**
   * Rollenachse für den Farbpunkt im Menüeintrag. Fehlt sie, bleibt der Eintrag
   * ungefärbt — zulässig für Kataloge außerhalb des A2-Vertrags.
   */
  darstellung?: StatusDarstellung;
}

/**
 * Deskriptor für den Bedienweg am Statusslot der `Datensicht`.
 *
 * Über `string | number` gefasst, weil das Primitiv den Wert nur durchreicht: die drei
 * Module tragen Katalog-IDs (`number`) bzw. ein lokales Enum (`string`). Ein generischer
 * Slot am Kartenplan zwänge jeden Konsumenten, seinen eigenen Werttyp zu verbreitern.
 */
export interface StatusBedienung {
  optionen: readonly StatusOption<string | number>[];
  /** Aktueller Wert für die Menü-Markierung — siehe {@link StatusWahlProps.aktuell}. */
  aktuell?: string | number | null;
  onWaehlen: (wert: string | number) => void;
  laeuft?: boolean;
  kennung: string;
}

export interface StatusWahlProps<W> {
  /** Aktueller Stand als Etikett. `null` = kein Status gesetzt. */
  darstellung: StatusDarstellung | null;
  /**
   * Aktueller Wert für die Markierung im Menü. Bewusst EIGENSTÄNDIG und nicht aus
   * {@link StatusWahlProps.darstellung} erschlossen: ein Label-Vergleich koppelte die
   * Markierung an eine Zeichenkette, die bei Fahrzeug und Personal aus dem
   * Mandantenkatalog kommt und dort frei umbenannt werden darf.
   */
  aktuell?: W | null;
  optionen: readonly StatusOption<W>[];
  /**
   * Menschenlesbare Zeilenkennung (Funkrufname, Name, Bezeichnung) für den zugänglichen
   * Namen. Ohne sie liefern n Zeilen n gleichnamige Knöpfe — dieselbe Regel wie bei der
   * Aktionsbündelung aus LFH-365 und bei `components/BemerkungZelle.tsx`.
   */
  kennung: string;
  onWaehlen: (wert: W) => void;
  /** Schreibt gerade — Auslöser gesperrt, Ladeanzeige. */
  laeuft?: boolean;
  /** Ohne Schreibrecht wird ein reines Etikett gerendert, KEIN Auslöser. */
  darfSchreiben: boolean;
}

/** Kein Status gesetzt: derselbe Gedankenstrich wie im Lesezweig von `BemerkungZelle`. */
const OHNE_STATUS = '—';

export default function StatusWahl<W extends string | number>({
  darstellung,
  aktuell = null,
  optionen,
  kennung,
  onWaehlen,
  laeuft = false,
  darfSchreiben,
}: StatusWahlProps<W>): ReactElement {
  const { token } = theme.useToken();

  const etikett = darstellung ? <StatusTag darstellung={darstellung} /> : <span>{OHNE_STATUS}</span>;

  // Ohne Schreibrecht KEIN Auslöser — nicht ein gesperrter. Ein deaktivierter Knopf
  // verspricht eine Fähigkeit, die es hier nicht gibt (Muster: LFH-365, „bleibt keine
  // Aktion übrig, wird gar kein Auslöser gerendert").
  if (!darfSchreiben) return <>{etikett}</>;

  const eintraege = optionen.map((o) => ({
    key: String(o.wert),
    label: (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: token.marginXXS }}>
        {o.darstellung && (
          // Punkt statt Fläche, und für Screenreader unsichtbar: die Bedeutung trägt
          // bereits das Label, sonst läse er sie doppelt (Muster `StatusTag`).
          <span aria-hidden="true" style={{ color: rollenFarbe(o.darstellung.rolle, token) }}>
            ●
          </span>
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
          // Hält den Klick aus einer klickbaren Zeile heraus. Reicht allein NICHT gegen
          // das Aufsteigen im Komponentenbaum (gemessen in LFH-367) — wer dieses Primitiv
          // in einen klickbaren Container hängt, setzt den Riegel zusätzlich dort.
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
        disabled={laeuft}
        style={{ paddingInline: token.paddingXXS }}
      >
        {etikett}
      </Button>
    </Dropdown>
  );
}
