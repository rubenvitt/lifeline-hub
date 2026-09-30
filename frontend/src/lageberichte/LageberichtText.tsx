import { Typography, theme } from 'antd';
import Markdown from '../components/Markdown';
import type { LageberichtAnzeige } from '../api/types';
import { vorlage, type AbschnittDef } from './vorlagen';

/** Ebene der Überschrift über dem Berichtstext; Titel und `#` im Text rücken eine darunter. */
type BerichtUnterEbene = 1 | 2 | 3 | 4;

/**
 * Der Berichtstext eines Lageberichts zum Lesen: je Vorlagen-Abschnitt Titel und Markdown,
 * ein leerer Abschnitt als „—". Ein Bauteil für Detailseite und Sprungpalette.
 *
 * `unterEbene` wie an `components/Markdown.tsx`: die Ebene der nächsten Überschrift ÜBER dem
 * Bauteil. Abschnittstitel und `#` im Text stehen eine Ebene darunter. Der Rahmen bleibt beim
 * Aufrufer.
 */
export default function LageberichtText({
  bericht,
  unterEbene,
}: {
  bericht: LageberichtAnzeige;
  unterEbene: BerichtUnterEbene;
}) {
  return (
    <AbschnittsText
      gliederung={vorlage(bericht.vorlage)?.abschnitte ?? []}
      abschnitte={bericht.abschnitte}
      unterEbene={unterEbene}
    />
  );
}

/**
 * Der Lesetext eines Vorlagendokuments aus Gliederung und gefüllten Abschnitten. Geteilt von
 * Lagebericht und Pressemitteilung (LFH-554); die Gliederung liefert die Vorlage der Art.
 */
export function AbschnittsText({
  gliederung,
  abschnitte,
  unterEbene,
}: {
  gliederung: readonly AbschnittDef[];
  abschnitte: readonly { schluessel: string; text: string }[];
  unterEbene: BerichtUnterEbene;
}) {
  const { token } = theme.useToken();
  const abschnittEbene = (unterEbene + 1) as 2 | 3 | 4 | 5;
  return (
    <>
      {gliederung.map((a) => {
        const text = abschnitte.find((x) => x.schluessel === a.schluessel)?.text ?? '';
        return (
          <section key={a.schluessel} style={{ marginBottom: 16 }}>
            {/* Eine Ebene unter dem Rahmen; Satz bleibt der von h5. */}
            <Typography.Title level={abschnittEbene} style={{ fontSize: token.fontSizeHeading5 }}>
              {a.label}
            </Typography.Title>
            {text.trim() ? (
              <Markdown variante="dokument" unterEbene={abschnittEbene}>
                {text}
              </Markdown>
            ) : (
              <Typography.Paragraph>—</Typography.Paragraph>
            )}
          </section>
        );
      })}
    </>
  );
}
