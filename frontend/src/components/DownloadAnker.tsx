import { useId, type ReactNode } from 'react';
import { useRollen } from './instrument/rollenwerte';
import { formatGroesse } from '../karten/formatGroesse';
import { originalDateiname, originalZugaenglicherName } from '../api/anhangFassung';

/**
 * Stil des Download-Ankers (LFH-21). Ein `<a>` ist ein handgebautes Bedienziel und erbt keine
 * Steuerhöhe — deshalb die ZWEI Angaben aus LFH-365: `minHeight` aus `controlHeight` plus
 * Polsterung aus einem Token. Die Polsterung ist bewusst `paddingXS` statt `paddingSM`: der
 * Anker steht in Tabellenzellen und Listenzeilen, die selbst polstern; mit `paddingSM` wüchse
 * jede Zeile im Fükw über die Staffel hinaus. Rein und exportiert, damit der Boden ohne Render
 * über die Dichtestufen prüfbar ist.
 *
 * Farben aus den Rollen, nicht aus antds Linkfarbe: blauer Bedien-TEXT nimmt `bedienText`
 * (LFH-650, der Linkton hielt den Boden nicht überall), die Nebenangaben `text2`.
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
  /**
   * Download-Adresse — immer die modul-gegatete Route, nie `/anhaenge/{aid}` des Einsatzes.
   * Einzige Ausnahme ist der Chat (n:m, kein Eintrag in `MODUL_LINKER`): seine Anhänge laden
   * über die generische Route, die sie an lebenden Nachrichten freigibt (`routes/anhang.rs`).
   */
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
  /**
   * Adresse des Originals (`originalPfad(href)`, LFH-747). Gesetzt nur, wenn der Benutzer
   * Originale laden darf (`darfOriginalLaden`) UND die Datei ein Bild ist: dann steht neben dem
   * Hauptverweis (bereinigte Fassung) ein zweiter Verweis „Original (mit Standort)“.
   */
  originalHref?: string;
  /**
   * Zeilenkennung für den zugänglichen Namen des Original-Verweises („dach.jpg, Schaden S-003“),
   * wie beim Hauptverweis: n Zeilen mit `IMG_0001.jpg` klängen sonst gleich. Fehlt sie, steht
   * der Dateiname da.
   */
  originalKennung?: string;
}

/** Sichtbarer Text des Original-Verweises (Spec `anhang-metadaten`). */
export const ORIGINAL_TEXT = 'Original (mit Standort)';

/**
 * Nativer Download-Verweis (`<a href download>`), geteilt von Dokumentenablage, Chat und
 * Schaden-Anhängen (LFH-21). Kein Knopf mit `fetch`: der Browser lädt selbst, mit
 * Sitzungs-Cookie, ETag und eigenem Fortschritt.
 */
export default function DownloadAnker({
  href,
  dateiname,
  text,
  groesse,
  zusatz,
  zugaenglicherName,
  originalHref,
  originalKennung,
}: Props) {
  const { token, rollen } = useRollen();
  // Das `aria-label` ersetzt den Inhalt im zugänglichen Namen; die Zusatzzeile (wer, wann) bleibt
  // über `aria-describedby` erreichbar. Ohne `aria-label` steht sie ohnehin im Namen.
  const zusatzId = useId();
  const beschrieben = zugaenglicherName != null && zusatz != null;
  const anker = (
    <a
      href={href}
      download={dateiname}
      aria-label={zugaenglicherName}
      aria-describedby={beschrieben ? zusatzId : undefined}
      style={{ ...downloadAnkerStil(token), color: rollen.bedienText }}
    >
      <span>
        <span data-lfh="download-anker-name">{text ?? dateiname}</span>
        {groesse != null && (
          <span style={{ fontWeight: 'normal', color: rollen.text2 }}>
            {' · '}
            {formatGroesse(groesse)}
          </span>
        )}
      </span>
      {zusatz != null && (
        <span
          id={zusatzId}
          style={{
            fontWeight: 'normal',
            fontSize: token.fontSizeSM,
            color: rollen.text2,
          }}
        >
          {zusatz}
        </span>
      )}
    </a>
  );
  if (originalHref == null) return anker;
  return (
    <span
      data-lfh="download-anker-mit-original"
      style={{
        display: 'inline-flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        columnGap: token.marginSM,
      }}
    >
      {anker}
      <a
        href={originalHref}
        download={originalDateiname(dateiname)}
        aria-label={originalZugaenglicherName(originalKennung ?? dateiname)}
        data-lfh="download-anker-original"
        style={{
          ...downloadAnkerStil(token),
          fontWeight: 'normal',
          color: rollen.bedienText,
        }}
      >
        {ORIGINAL_TEXT}
      </a>
    </span>
  );
}
