import { Button, Slider, Space, Switch, Tooltip, Typography, Upload } from 'antd';
import { IconFadenkreuz, IconHochladen, IconMuelleimer, IconVollbildEcken } from '../../icons';
import { useRollen } from '../../components/instrument';
import { MenueAusloeser } from '../../components/MenueAusloeser';
import { SpeicherFehler } from '../../components/SpeicherHinweis';
import UploadFortschrittAnzeige from '../../components/UploadFortschritt';
import { ablageFehlerKopf } from '../../components/useUploadFortschritt';
import type { Hintergrundbild } from '../../api/kartenbilder';
import AnsichtZuordnung from './AnsichtZuordnung';
import { FehlerSlot, leistenZeileStil, namensteilStil } from './leistenTeile';
import type { SidebarProps } from './Sidebar';

/**
 * Das Bild, dessen Entfernen bestätigt werden soll — oder `null`, wenn es keins (mehr) gibt. Nicht
 * bloß `loeschBildId != null`: die Bildliste kommt live, und entfernt ein zweiter Bediener das Bild
 * während der Rückfrage, stünde der Dialog mit leerem Titel und einem DELETE ins Leere da.
 *
 * Rein und exportiert, weil die Aussage am DOM nicht prüfbar ist: antd schließt ein `<Modal>` über
 * `transitionend`, das in jsdom nie feuert.
 */
export function loeschDialogBild<T extends { id: number; name: string }>(
  bilder: readonly T[],
  id: number | null,
): T | null {
  if (id == null) return null;
  return bilder.find((b) => b.id === id) ?? null;
}

/**
 * Untergruppe „Bild-Hintergründe“ im Ebenenbaum: je Bild Schalter, Name (umbenennbar), Aktionen,
 * Deckkraft und Ansichtszuordnung, darunter der Upload. Eigene Zeilenform (D4): ein Bild braucht
 * Deckkraft und Menü, die Ebenenzeile trägt das nicht.
 *
 * Beim Einpassen zeigt die Zeile nur den Zustand; Griffwahl, Mittelpunkt und „Fertig“ stehen im
 * Modus-Band (ab `lg`) bzw. im Fuß-Band (unter `lg`) — je Breite genau ein Knopf je Handlung.
 */
export default function BildHintergruende(
  props: SidebarProps & {
    /** Die Bilder, die die Suche stehen lässt (ohne Suche alle). */
    angezeigt: readonly Hintergrundbild[];
    /** Rückfrage zum Entfernen öffnen — der Dialog steht außerhalb der Gruppen. */
    onLoeschenFragen: (id: number) => void;
  },
) {
  const { token, rollen } = useRollen();
  const { darfSchreiben } = props;
  return (
    <Space orientation="vertical" style={{ width: '100%' }}>
      {/* Der Slot ist ein Banner über der Liste, kein Ersatz: die Overlays liegen weiter auf der
          Karte, ohne Bedienelemente ließe sich keins mehr abschalten. Der Upload hängt an einer
          eigenen Route und bleibt bedienbar. */}
      <FehlerSlot fehler={props.sektionFehler?.bilder} />
      {props.angezeigt.map((b) => {
        const imPlatzieren = props.bildPlatzierenId === b.id;
        return (
          <div
            key={b.id}
            style={{
              borderBottom: `1px solid ${rollen.flaeche3}`,
              paddingBottom: token.paddingSM,
            }}
          >
            <div style={{ ...leistenZeileStil(token), alignItems: 'center' }}>
              <Switch
                checked={b.sichtbar}
                aria-label={b.name}
                onChange={(v) => props.onBildToggle(b.id, v)}
                style={{ flexShrink: 0 }}
              />
              <span style={{ ...namensteilStil(token), alignItems: 'center' }}>
                <Typography.Text
                  ellipsis={{ tooltip: b.name }}
                  editable={
                    darfSchreiben
                      ? {
                          tooltip: 'Umbenennen',
                          onChange: (val) => {
                            const t = val.trim();
                            if (t && t !== b.name) props.onBildUmbenennen(b.id, t);
                          },
                        }
                      : false
                  }
                  style={{ flex: 1, minWidth: 0 }}
                >
                  {b.name}
                </Typography.Text>
                {/* Drei Aktionen an einer Zeile werden gebündelt; ohne Schreibrecht bleibt eine,
                    dann steht der Zentrieren-Knopf direkt da. */}
                <div style={{ flexShrink: 0 }}>
                  {darfSchreiben ? (
                    <MenueAusloeser
                      eintraege={[
                        {
                          key: 'zentrieren',
                          icon: <IconVollbildEcken />,
                          label: 'Auf Bild zentrieren',
                        },
                        {
                          key: 'platzieren',
                          icon: <IconFadenkreuz />,
                          label: imPlatzieren ? 'Platzieren beenden' : 'Auf der Karte platzieren',
                        },
                        {
                          key: 'loeschen',
                          icon: <IconMuelleimer />,
                          label: 'Bild entfernen …',
                          gefahr: true,
                        },
                      ]}
                      // Der Name trägt die Bild-Kennung.
                      zugaenglicherName={`Aktionen zu ${b.name}`}
                      onWahl={(key) => {
                        if (key === 'zentrieren') props.onBildZentrieren(b.id);
                        else if (key === 'platzieren') {
                          if (imPlatzieren) props.onBildPlatzierenFertig();
                          else props.onBildPlatzieren(b.id);
                        } else if (key === 'loeschen') props.onLoeschenFragen(b.id);
                      }}
                    />
                  ) : (
                    <Tooltip title="Auf Bild zentrieren">
                      <Button
                        icon={<IconVollbildEcken />}
                        onClick={() => props.onBildZentrieren(b.id)}
                        aria-label={`${b.name} zentrieren`}
                      />
                    </Tooltip>
                  )}
                </div>
              </span>
            </div>
            {imPlatzieren && darfSchreiben && (
              <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
                wird eingepasst
              </Typography.Text>
            )}
            <Slider
              min={0}
              max={100}
              value={b.opazitaet}
              disabled={!darfSchreiben}
              onChange={(v) => props.onBildOpazitaet(b.id, v as number)}
              tooltip={{ formatter: (v) => `${v}%` }}
            />
            <AnsichtZuordnung
              ansichten={props.ansichten}
              wert={b.ansicht_id}
              disabled={!darfSchreiben}
              onChange={(ansichtId) => props.onBildVerschieben(b.id, ansichtId)}
            />
          </div>
        );
      })}
      {darfSchreiben && (
        <>
          <SpeicherFehler
            fehler={props.bildUpload?.fehler}
            {...ablageFehlerKopf(props.bildUpload?.fehler)}
          />
          <UploadFortschrittAnzeige stand={props.bildUpload?.stand ?? null} />
          <Upload
            accept="image/png,image/jpeg"
            showUploadList={false}
            disabled={props.bildUpload?.laeuft}
            beforeUpload={(datei) => {
              props.onBildUpload(datei as File);
              return false;
            }}
          >
            <Button icon={<IconHochladen />} loading={props.bildUpload?.laeuft}>
              Bild hochladen
            </Button>
          </Upload>
        </>
      )}
    </Space>
  );
}
