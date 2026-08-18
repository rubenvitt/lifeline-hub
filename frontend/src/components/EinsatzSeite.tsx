import { Flex, Typography, theme } from 'antd';
import { useEffect, useRef, type ReactNode } from 'react';
import { flaeche } from '../theme/tokens';
// Der Akzentstrich lebt als Klasse in der Gestaltungssprache. Der Import ist
// bewusst hier und nicht global: bis A2 hatte `sprache.css` genau einen
// Konsumenten (das Lage-Dashboard). Alle Selektoren der Datei sind klassen-
// gebunden (`.lfh-*`) — sie färbt also nichts ein, was sie nicht anfasst.
import '../theme/sprache.css';
import Datenstand from './Datenstand';

interface EinsatzSeiteProps {
  titel: ReactNode;
  /** Einzeilige, gedämpfte Beschreibung unter dem Titel. */
  beschreibung?: ReactNode;
  /** Ortsangabe über dem Titel (z. B. eine `Breadcrumb` aus `routing/deeplinks`). */
  breadcrumb?: ReactNode;
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
  /** Optionaler Hinweis unter dem Header (z. B. ein read-only-Alert). */
  hinweis?: ReactNode;
  /** Letzter erfolgreicher Listenabruf (`query.dataUpdatedAt`). */
  dataUpdatedAt?: number;
  /** Container-Breite in px — `flaeche.seiteSchmal` (Default) oder `flaeche.seiteBreit`. */
  breite?: number;
  children: ReactNode;
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
 * **Signatur:** der Akzentstrich (36 × 3 px, `--lfh-marke` mit Glühen) steht über
 * dem Titel. Er ist Signatur-Element 1 der Gestaltungssprache (LFH-352/A0) und der
 * Grund, warum die rohen `Typography.Title` der Modulseiten hierher wandern.
 *
 * **Abweichung von der A0-Referenzseite (Spec §3.1):** A0 hat auf dem
 * Lage-Dashboard die Seitenüberschrift entfernt, weil dort das Instrumentenband die
 * Identität trägt. Modul-Arbeitsseiten haben kein Instrumentenband und brauchen die
 * Ortsangabe — `EinsatzSeite` behält deshalb den `titel`-Slot und wird **nicht** auf
 * das Lage-Dashboard angewandt.
 *
 * **Sektionen INNERHALB einer Seite** bekommen weiterhin `SektionHeader` (level 5);
 * dieses Primitiv ersetzt ihn nicht, sondern steht eine Ebene darüber.
 */
export default function EinsatzSeite({
  titel,
  beschreibung,
  breadcrumb,
  aktionen,
  hinweis,
  dataUpdatedAt,
  breite = flaeche.seiteSchmal,
  children,
}: EinsatzSeiteProps) {
  const { token } = theme.useToken();
  const aktionenRef = useRef<HTMLDivElement>(null);

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

  return (
    <div style={{ maxWidth: breite, margin: '0 auto' }}>
      {breadcrumb && <div style={{ marginBottom: token.marginXS }}>{breadcrumb}</div>}
      {/**
        * `wrap` ist keine Kosmetik (LFH-339 · C4, gemessen). Ohne es steht der
        * Aktionsblock unbedingt neben dem Titel, und ein einziger Knopf mit langer
        * Beschriftung sprengt den Schirm: auf `/fahrzeuge` bei 390 px lief die Seite bis
        * 505 px, der innerste sprengende Knoten war „Ad-hoc-Fahrzeug".
        *
        * `minWidth: 0` an beiden Kindern, weil ein Flex-Kind per Vorgabe `min-width: auto`
        * hat und damit NICHT unter seine Inhaltsbreite schrumpft — ohne das bringt `wrap`
        * allein nichts, sobald ein Kind für sich schon zu breit ist.
        */}
      <Flex
        wrap
        justify="space-between"
        align="flex-start"
        gap={token.margin}
        style={{ marginBottom: token.marginLG }}
      >
        <div style={{ minWidth: 0 }}>
          <span
            className="lfh-marke__strich"
            style={{ marginBottom: token.marginXS }}
            aria-hidden="true"
          />
          <Typography.Title level={4} style={{ margin: 0 }}>
            {titel}
          </Typography.Title>
          {beschreibung && <div><Typography.Text type="secondary">{beschreibung}</Typography.Text></div>}
          <Datenstand dataUpdatedAt={dataUpdatedAt} />
        </div>
        {/* Die Marke macht die Zusicherung von außen prüfbar (LFH-340 · C5): „genau eine
            Primäraktion IM KOPF" ist ohne sie nur global zählbar, und eine Seite mit einem
            Formular im Inhalt (dessen Absende-Knopf zu Recht primär ist) fiele durch, ohne
            im Kopf etwas falsch zu machen. Die Dev-Warnung oben zählt bereits genau diesen
            Teilbaum — das Attribut gibt dem Test denselben Zuschnitt. */}
        {aktionen && (
          <div ref={aktionenRef} data-lfh="seitenkopf-aktionen" style={{ minWidth: 0 }}>
            {aktionen}
          </div>
        )}
      </Flex>
      {hinweis && <div style={{ marginBottom: token.marginLG }}>{hinweis}</div>}
      {children}
    </div>
  );
}
