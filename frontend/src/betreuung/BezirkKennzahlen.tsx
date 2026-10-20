import type { Evakuierungsbezirk } from '../api/types';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { Balken, Kennzahl, Kennzahlenband, useRollen } from '../components/instrument';
import { ERHEBUNG_LABEL, mengeText, personenZahl } from './betreuungText';

/**
 * Anteil evakuiert an der Plangröße in ganzen Prozent, NICHT gedeckelt (mehr Evakuierte als
 * geplant ist eine Aussage). `null` ohne Meldung. Rein.
 */
export function bezirkAnteil(
  b: Pick<Evakuierungsbezirk, 'stand' | 'plan_personen'>,
): number | null {
  if (!b.stand || b.plan_personen <= 0) return null;
  return Math.round((b.stand.evakuiert / b.plan_personen) * 100);
}

/**
 * Kennzahlen EINES Evakuierungsbezirks (LLH-1076, design.md D4): Evakuiert, Geplant, Anteil,
 * letzte Meldung.
 *
 * „≈" ist der zweite Kanal einer Schätzung, das Wort in der Notiz der dritte. Ohne Meldung steht
 * „—" statt 0 (nichts gemeldet ist nicht niemand evakuiert, `frontend/AGENTS.md`, „Keine erfundenen
 * Daten"). Der Balken unter dem Anteil ist der zweite Kanal neben der Zahl, nie ihr Ersatz; er trägt
 * denselben Wortlaut als Namen. Kein Ton: keine Zahl hat eine Schwelle.
 */
export default function BezirkKennzahlen({ bezirk }: { bezirk: Evakuierungsbezirk }) {
  const { token, rollen } = useRollen();
  const stand = bezirk.stand ?? null;
  const anteil = bezirkAnteil(bezirk);
  const anteilText = anteil == null ? null : `${personenZahl(anteil)} %`;

  return (
    <div data-lfh="bezirk-kennzahlen" style={{ marginBottom: token.marginLG }}>
      <Kennzahlenband beschriftung="Bezirk in Zahlen" notizZeilen={1}>
        <Kennzahl
          titel="Evakuiert"
          groesse="klein"
          wert={stand ? mengeText(stand.evakuiert, stand.erhebung) : '—'}
          notiz={stand ? ERHEBUNG_LABEL[stand.erhebung] : 'keine Meldung'}
        />
        <Kennzahl
          titel="Geplant"
          groesse="klein"
          wert={mengeText(bezirk.plan_personen, bezirk.plan_erhebung)}
          notiz={ERHEBUNG_LABEL[bezirk.plan_erhebung]}
        />
        <Kennzahl
          titel="Anteil"
          groesse="klein"
          wert={anteilText ?? '—'}
          notiz={
            anteil == null ? (
              'keine Meldung'
            ) : (
              <Balken
                wert={stand!.evakuiert}
                max={bezirk.plan_personen}
                farbe={rollen.gedaempft}
                beschriftung={`Bezirk ${bezirk.bezeichnung}: ${anteilText} der Planung evakuiert`}
                style={{ minWidth: 96, marginBlock: token.marginXXS }}
              />
            )
          }
        />
        <Kennzahl
          titel="Letzte Meldung"
          groesse="klein"
          wert={stand ? <ZeitAnzeige wert={stand.zeitpunkt_at} format="kurz" /> : '—'}
          notiz={stand ? undefined : 'keine Meldung'}
        />
      </Kennzahlenband>
    </div>
  );
}
