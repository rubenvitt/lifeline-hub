import { Typography, theme } from 'antd';
import type { BefehlAbschnitt } from '../api/types';
import type { VorlageDef } from '../befehle/vorlagen';
import Markdown from '../components/Markdown';

/**
 * Die Abschnitte eines Befehls als Lesefassung: Vollseite (freigegeben oder ohne Schreibrecht) und
 * Detailpaneel der Liste nutzen dieselbe (Change `oxgob5gk-auftraege-befehle-angleichen`, D5).
 * Leere Abschnitte stehen mit „—“, damit das Schema vollständig bleibt.
 *
 * `ebene` ist die Überschriftenebene der Abschnittsköpfe: unter dem Paneel der Vollseite (h2) h3,
 * im Detail unter dem Paneel (h4) h5.
 */
export default function BefehlLesefassung({
  vorlage: v,
  abschnitte,
  ebene = 3,
  className,
}: {
  vorlage: VorlageDef | undefined;
  abschnitte: readonly BefehlAbschnitt[];
  ebene?: 3 | 5;
  className?: string;
}) {
  const { token } = theme.useToken();
  return (
    <div className={className}>
      {v?.abschnitte.map((a) => {
        const text = abschnitte.find((x) => x.schluessel === a.schluessel)?.text ?? '';
        // Satz bleibt der von h5. Im Titelblock mit dem ersten Absatz, damit er im Druck nicht
        // allein am Seitenende steht (LFH-1008).
        const titel = (
          <Typography.Title level={ebene} style={{ fontSize: token.fontSizeHeading5 }}>
            {a.label}
          </Typography.Title>
        );
        return (
          <section key={a.schluessel} style={{ marginBottom: 16 }}>
            {text.trim() ? (
              <Markdown variante="dokument" unterEbene={ebene} titel={titel}>
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
    </div>
  );
}
