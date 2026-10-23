import { Button, Flex, Space, Typography } from 'antd';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { monoStil, useRollen } from '../components/instrument';
import type { OhneSchicht } from './ohneSchicht';

const { Text } = Typography;

interface OhneSchichtKarteProps {
  eintrag: OhneSchicht;
  darfSchreiben: boolean;
  onBeginnen: (eintrag: OhneSchicht) => void;
}

/**
 * Eine Einheit im Einsatz ohne Schicht (LLH-1128), im Raster der Schichtkarte
 * (`AbloesungKarte`): links die Zeitspalte in Mono, so breit wie das breiteste `kurz`-Format
 * (LFH-708), rechts Name, Abschnitt und die eine Handlung. Der Rand bleibt in der Linienfarbe:
 * ohne Schicht gibt es keine Fälligkeit und also keine Einstufung.
 *
 * Die Zeitspalte nennt das Eintreffen, ohne es die Alarmierung, mit der die Periode begann.
 *
 * „Schicht beginnen“ öffnet den Dialog mit der Einheit vorbelegt. Kein `type="primary"`: die
 * eine Primäraktion der Seite steht im Kopf. Ein geplanter Ablöser bekommt den Knopf nicht, seine
 * Schicht entsteht mit dem Vollzug (`abloesung/ohneSchicht.ts`); ohne Schreibrecht fällt die
 * Aktionszeile weg, den Grund nennt der Seitenkopf.
 */
export default function OhneSchichtKarte({
  eintrag: e,
  darfSchreiben,
  onBeginnen,
}: OhneSchichtKarteProps) {
  const { token, rollen } = useRollen();
  const eingetroffen = e.eintreffen_at != null;
  return (
    <article
      data-lfh="abloesung-ohne-schicht"
      aria-label={`${e.einheit_name} ohne Schicht`}
      style={{
        display: 'flex',
        alignItems: 'stretch',
        minWidth: 0,
        marginBottom: token.marginXS,
        background: rollen.paneel,
        border: `1px solid ${rollen.linie}`,
        borderInlineStart: `3px solid ${rollen.linie}`,
        color: rollen.text,
      }}
    >
      <div
        style={{
          flex: '0 0 auto',
          minWidth: 64,
          paddingBlock: token.paddingSM,
          paddingInline: token.padding,
          borderInlineEnd: `1px solid ${rollen.flaeche3}`,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}
      >
        <span style={{ ...monoStil(13, 500), minWidth: '6ch' }} data-lfh="abloesung-zeit">
          <ZeitAnzeige wert={e.eintreffen_at ?? e.beginn_at} rolle="kurz" />
        </span>
        {/* So breit wie „eingetroffen“: sonst stünde die Spalte je nach Wort verschieden breit,
            und die Namen der Zeilen fluchteten nicht. */}
        <span style={{ ...monoStil(10), color: rollen.schwach, minWidth: '12ch' }}>
          {eingetroffen ? 'eingetroffen' : 'alarmiert'}
        </span>
      </div>
      <div style={{ flex: 1, minWidth: 0, padding: token.paddingSM }}>
        <Text strong style={{ fontSize: 15 }}>
          {e.einheit_name}
        </Text>
        {(e.abschnitt_name || e.abloeser_fuer) && (
          <Space orientation="vertical" size={2} style={{ width: '100%', marginTop: 4 }}>
            {e.abschnitt_name && <Text type="secondary">{e.abschnitt_name}</Text>}
            {e.abloeser_fuer && (
              <Text type="secondary" data-lfh="abloesung-abloeser-fuer">
                als Ablöser geplant für {e.abloeser_fuer}
              </Text>
            )}
          </Space>
        )}
        {darfSchreiben && !e.abloeser_fuer && (
          <Flex justify="flex-end" style={{ marginTop: token.marginXS }}>
            {/* Der Name beginnt mit dem sichtbaren Wortlaut (WCAG 2.5.3) und nennt die Einheit:
                in der Liste stehen viele gleiche Knöpfe, der im Kopf heißt nur „Schicht beginnen“. */}
            <Button
              aria-label={`Schicht beginnen für ${e.einheit_name}`}
              onClick={() => onBeginnen(e)}
            >
              Schicht beginnen
            </Button>
          </Flex>
        )}
      </div>
    </article>
  );
}
