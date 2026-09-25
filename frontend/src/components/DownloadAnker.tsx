import type { ReactNode } from 'react';
import { theme } from 'antd';
import { formatGroesse } from '../karten/formatGroesse';

/**
 * Stil des Download-Ankers (LFH-21). Ein `<a>` ist ein handgebautes Bedienziel und erbt keine
 * Steuerhöhe — deshalb die ZWEI Angaben aus LFH-365: `minHeight` aus `controlHeight` plus
 * Polsterung aus einem Token. Die Polsterung ist bewusst `paddingXS` statt `paddingSM`: der
 * Anker steht in Tabellenzellen und Listenzeilen, die selbst polstern; mit `paddingSM` wüchse
 * jede Zeile im Fükw über die Staffel hinaus. Rein und exportiert, damit der Boden ohne Render
 * über die Dichtestufen prüfbar ist.
 */
export function downloadAnkerStil(token: {
  controlHeight: number;
  paddingXS: number;
  fontWeightStrong: number;
}) {
  return {
    display: 'inline-flex',
    flexDirection: 'column',
    justifyContent: 'center',
    boxSizing: 'border-box',
    minHeight: token.controlHeight,
    paddingBlock: token.paddingXS,
    fontWeight: token.fontWeightStrong,
  } as const;
}

interface Props {
  /** Download-Adresse — immer die modul-gegatete Route, nie `/anhaenge/{aid}` des Einsatzes. */
  href: string;
  /** Name für das `download`-Attribut und sichtbarer Text, wenn `text` fehlt. */
  dateiname: string;
  /** Sichtbarer Text statt des Dateinamens (Dokumentenablage: der Titel). */
  text?: ReactNode;
  /** Größe in Byte; steht hinter dem Text. */
  groesse?: number;
  /** Zweite Zeile, z. B. „abgelegt von · Zeit“. */
  zusatz?: ReactNode;
  /**
   * Zugänglicher Name mit Zeilenkennung („dach.jpg, 2.0 MB, Datei von Schaden S-003
   * herunterladen“) — n Zeilen liefern sonst n gleich klingende Verweise.
   */
  zugaenglicherName?: string;
}

/**
 * Nativer Download-Verweis (`<a href download>`), geteilt von Dokumentenablage und
 * Schaden-Anhängen (LFH-21; vorher lokal in `DokumentePage`). Kein Knopf mit `fetch`: der
 * Browser lädt selbst, mit Sitzungs-Cookie, ETag und eigenem Fortschritt.
 */
export default function DownloadAnker({
  href,
  dateiname,
  text,
  groesse,
  zusatz,
  zugaenglicherName,
}: Props) {
  const { token } = theme.useToken();
  return (
    <a
      href={href}
      download={dateiname}
      aria-label={zugaenglicherName}
      style={downloadAnkerStil(token)}
    >
      <span>
        {text ?? dateiname}
        {groesse != null && (
          <span style={{ fontWeight: 'normal', color: token.colorTextSecondary }}>
            {' · '}
            {formatGroesse(groesse)}
          </span>
        )}
      </span>
      {zusatz != null && (
        <span
          style={{
            fontWeight: 'normal',
            fontSize: token.fontSizeSM,
            color: token.colorTextSecondary,
          }}
        >
          {zusatz}
        </span>
      )}
    </a>
  );
}
