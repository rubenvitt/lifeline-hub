import { IconPfeilRunter } from '../../icons';
import { Button } from 'antd';
import type { CSSProperties, ReactNode } from 'react';
import { monoStil, useRollen } from './rollenwerte';

/**
 * Sammelbanner — „12 neue Meldungen" statt eingeschobener Zeilen (Neuentwurf S4;
 * Bedien-Leitlinie Festlegung 6: Live-Updates springen nicht unter dem Cursor, CLS ≤ 0,1,
 * WCAG 3.2.5).
 *
 * Grund `bannerGrund`, Kante `bannerLinie`, Pfeilicon in `bedien`, Text 12 in
 * `bedienText` (Kontrast Tag 7,19 · Nacht 9,71), rechts die Aktion Mono in `bedien`.
 * Blau, nicht Rot: ein neuer Eintrag ist eine Bedienaufforderung, keine Gefahr.
 *
 * `role="status"` — höflich angesagt, nie unterbrechend. Das Banner ist die EINE Meldung
 * je Liste; eine zweite Aktualisierung ändert seinen Text, sie stapelt kein zweites.
 *
 * Die Aktion ist ein antd-`Button type="link"`: er erbt `controlHeight` vom
 * `ConfigProvider` und schuldet damit nicht die zwei Angaben eines handgebauten
 * Bedienziels (LFH-365). Das Icon steht in einer `aria-hidden`-Hülle — antds Icons
 * bringen ein eigenes englisches `aria-label` mit.
 *
 * KURZFORM für den Handschirm (LFH-694,
 * `openspec/changes/archive/2026-10-01-lfh-694-sammelbanner-schmal/`): steht das Banner in einer
 * Werkzeugzeile neben einer Segmentleiste, bleibt ihm bei 390 px zu wenig Breite für Satz UND
 * Knopf (gemessen: Text 0 px, bis 59 px Überlauf). Mit `kurz` (und einer
 * `aktion`) wird das GANZE Banner ein Knopf: Icon plus „1 neu" ({@link sammelbannerKurz}),
 * eine Polsterung statt zwei, die ganze Fläche Trefffläche. Der Name lautet „1 neu anzeigen"
 * (sichtbarer Text im Namen, WCAG 2.5.3); der volle Satz bleibt visuell verborgen im
 * Statusbereich und wird wie bisher angesagt. Ob die Kurzform gilt, entscheidet der Aufrufer
 * (`useViewport().istSchmal`), nicht dieser Baustein.
 */

/** Visuell verborgen, für Vorleser da — die übliche Clip-Bauform (wie `Status.tsx`). */
const NUR_VORLESER: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

/**
 * Wortlaut der Kurzform: „1 neu" / „12 neu", wenn Einträge warten, sonst „umgeordnet". Gilt
 * beides, gewinnt die Zahl — die Umordnung steht im vollen Satz.
 */
export function sammelbannerKurz(anzahl: number, umgeordnet: boolean): string {
  return anzahl > 0 || !umgeordnet ? `${anzahl} neu` : 'umgeordnet';
}

interface SammelbannerProps {
  /** Die Mitteilung („14 neue Einträge seit 13:04"). */
  children: ReactNode;
  /** Die eine Aktion rechts („anzeigen", „alle als gesichtet markieren"). */
  aktion?: { label: string; onKlick: () => void };
  /**
   * Kurzform für den Handschirm („1 neu"). Nur zusammen mit `aktion` wirksam: dann ist das ganze
   * Banner ein Knopf, und `children` bleibt für Hilfstechnik im Statusbereich.
   */
  kurz?: string;
  style?: CSSProperties;
}

export default function Sammelbanner({ children, aktion, kurz, style }: SammelbannerProps) {
  const { token, rollen } = useRollen();
  if (kurz != null && aktion != null) {
    return (
      <div role="status" data-lfh="sammelbanner" style={{ display: 'flex', ...style }}>
        <span style={NUR_VORLESER}>{children}</span>
        <Button
          onClick={aktion.onKlick}
          aria-label={`${kurz} ${aktion.label}`}
          style={{
            flex: '1 1 auto',
            justifyContent: 'flex-start',
            gap: token.paddingXS,
            paddingInline: token.paddingSM,
            background: rollen.bannerGrund,
            border: `1px solid ${rollen.bannerLinie}`,
            color: rollen.bedienText,
          }}
        >
          <span aria-hidden="true" style={{ display: 'inline-flex', color: rollen.bedien }}>
            <IconPfeilRunter />
          </span>
          <span data-lfh="sammelbanner-kurz" style={{ ...monoStil(12), whiteSpace: 'nowrap' }}>
            {kurz}
          </span>
        </Button>
      </div>
    );
  }
  return (
    <div
      role="status"
      data-lfh="sammelbanner"
      style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: token.paddingSM,
        paddingBlock: token.paddingXS,
        paddingInline: token.padding,
        background: rollen.bannerGrund,
        border: `1px solid ${rollen.bannerLinie}`,
        ...style,
      }}
    >
      <span aria-hidden="true" style={{ display: 'inline-flex', color: rollen.bedien }}>
        <IconPfeilRunter />
      </span>
      <span style={{ flex: '1 1 auto', minWidth: 0, fontSize: 12, color: rollen.bedienText }}>
        {children}
      </span>
      {aktion != null && (
        <Button
          type="link"
          onClick={aktion.onKlick}
          style={{ ...monoStil(11), paddingInline: token.paddingXS }}
        >
          {aktion.label}
        </Button>
      )}
    </div>
  );
}
