import { Typography, theme } from 'antd';
import Markdown from '../components/Markdown';
import type { LageberichtAnzeige } from '../api/types';
import { vorlage } from './vorlagen';

/** Ebene der Überschrift über dem Berichtstext; Titel und `#` im Text rücken eine darunter. */
export type BerichtUnterEbene = 1 | 2 | 3 | 4;

/**
 * Der Berichtstext eines Lageberichts zum Lesen: je Vorlagen-Abschnitt Titel und Markdown,
 * ein leerer Abschnitt als „—". EIN Bauteil für den Lesezweig der Detailseite und die
 * Vorschau der Sprungpalette (LFH-664) — zwei Kopien wären zwei Stellen, an denen ein
 * Abschnitt fehlen kann.
 *
 * `unterEbene` hat dieselbe Bedeutung wie an `components/Markdown.tsx` (LFH-621): die Ebene
 * der nächsten Überschrift ÜBER dem Bauteil. Die Abschnittstitel stehen eine Ebene darunter,
 * und `#` im Abschnittstext ebenfalls — so wie vorher auf der Seite: unter dem Paneel (`h2`)
 * Titel `h3`, Markdown mit `unterEbene` 3. Der Rahmen (Paneel, Druck-Hülle) bleibt beim
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
