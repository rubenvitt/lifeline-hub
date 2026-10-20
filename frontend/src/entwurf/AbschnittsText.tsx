import { Typography, theme } from 'antd';
import Markdown from '../components/Markdown';
import type { DokumentAbschnitt } from './dokumentEntwurfKern';

/** Ebene der Überschrift über dem Text; Abschnittstitel und `#` im Text rücken eine darunter. */
export type AbschnittsTextUnterEbene = 1 | 2 | 3 | 4;

/**
 * Der Lesetext eines gegliederten Dokuments aus Gliederung und gefüllten Abschnitten: je Abschnitt
 * Titel und Markdown, ein leerer Abschnitt als „—“, damit das Schema vollständig bleibt. Geteilt
 * von Lagebericht, Befehl (`auftraege/BefehlLesefassung.tsx`), Pressemitteilung und der
 * Lesefassung des Entwurfs (`entwurf/DokumentEntwurf.tsx`) — so, wie es vorgetragen und gedruckt
 * wird.
 *
 * `unterEbene` wie an `components/Markdown.tsx`: die Ebene der nächsten Überschrift ÜBER dem
 * Bauteil. Der Rahmen bleibt beim Aufrufer. `anker` gibt jedem Abschnitt eine Kennung, auf die
 * die Gliederung des Entwurfs springt.
 */
export default function AbschnittsText({
  gliederung,
  abschnitte,
  unterEbene,
  anker,
}: {
  gliederung: readonly DokumentAbschnitt[];
  abschnitte: readonly { schluessel: string; text: string }[];
  unterEbene: AbschnittsTextUnterEbene;
  anker?: (schluessel: string) => string;
}) {
  const { token } = theme.useToken();
  const abschnittEbene = (unterEbene + 1) as 2 | 3 | 4 | 5;
  return (
    <>
      {gliederung.map((a) => {
        const text = abschnitte.find((x) => x.schluessel === a.schluessel)?.text ?? '';
        // Eine Ebene unter dem Rahmen; Satz bleibt der von h5. Im Titelblock mit dem ersten
        // Absatz, damit er im Druck nicht allein am Seitenende steht (LFH-1008).
        const titel = (
          <Typography.Title level={abschnittEbene} style={{ fontSize: token.fontSizeHeading5 }}>
            {a.label}
          </Typography.Title>
        );
        return (
          <section key={a.schluessel} id={anker?.(a.schluessel)} style={{ marginBottom: 16 }}>
            {text.trim() ? (
              <Markdown variante="dokument" unterEbene={abschnittEbene} titel={titel}>
                {text}
              </Markdown>
            ) : (
              <div data-lfh="titelblock">
                {titel}
                <Typography.Paragraph>—</Typography.Paragraph>
              </div>
            )}
          </section>
        );
      })}
    </>
  );
}
