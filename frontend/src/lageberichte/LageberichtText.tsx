import { Typography, theme } from 'antd';
import Markdown from '../components/Markdown';
import type { LageberichtAnzeige } from '../api/types';
import { vorlage } from './vorlagen';

/** Ebene der Überschrift über dem Berichtstext; Titel und `#` im Text rücken eine darunter. */
export type BerichtUnterEbene = 1 | 2 | 3 | 4;

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
  const { token } = theme.useToken();
  const abschnittEbene = (unterEbene + 1) as 2 | 3 | 4 | 5;
  const v = vorlage(bericht.vorlage);
  return (
    <>
      {v?.abschnitte.map((a) => {
        const text = bericht.abschnitte.find((x) => x.schluessel === a.schluessel)?.text ?? '';
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
