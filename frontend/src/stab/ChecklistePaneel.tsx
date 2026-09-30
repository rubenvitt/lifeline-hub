import { Checkbox, Flex, Skeleton } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, type CSSProperties } from 'react';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { einsatzKeys } from '../api/queryKeys';
import { ladeCheckliste, setzeChecklistenPunkt } from '../api/stab';
import type { ChecklistenPunkt, ChecklistenPunktBody } from '../api/types';
import { BemerkungZelle } from '../components/BemerkungZelle';
import { Liste, ListenEintrag } from '../components/Liste';
import { SeitenFehler, SeitenStandVeraltet } from '../components/SeitenZustand';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import { Paneel, monoStil, useRollen } from '../components/instrument';
import type { ChecklistenVorlage } from './checkliste';
import { CHECKLISTE, checklistenZeileStil, eintragFuer, erledigtAnzahl } from './checkliste';

interface Auftrag {
  punkt: ChecklistenPunkt;
  daten: ChecklistenPunktBody;
}

/**
 * Checkliste Arbeitsaufnahme der Führungseinheit (LFH-551) als drittes Paneel der Stabseite.
 *
 * Gelesen, nicht verglichen — also `Liste` mit sieben festen Zeilen aus der Vorlage
 * (`stab/checkliste.ts`); der Server liefert nur gespeicherte Punkte, fehlend heißt offen.
 *
 * - **Haken:** die antd-`Checkbox` MIT ihrem Text — antd rendert daraus EIN `<label>`, das die ganze
 *   Zeilenbreite trifft. Die Box selbst erbt keine Steuerhöhe, deshalb trägt das Label die zwei
 *   Angaben eines handgebauten Bedienziels (`checklistenZeileStil`, LFH-365). Umkehrbar, ohne
 *   Rückfrage (LFH-363); ins ETB schreibt allein der Meldungspunkt, und das entscheidet der Server.
 * - **Nicht optimistisch:** der Haken zeigt den Serverstand. Während der Anfrage ist die Box
 *   gesperrt; die Quittung ist der Haken selbst, kein Toast.
 * - **Fehler an die Zeile** (`data-fehler`), nicht als Toast; der nächste Aufruf räumt ihn.
 * - **Bemerkung** über `BemerkungZelle`; jedes Bedienziel schickt genau SEIN Feld (Design D3).
 * - **Ohne Schreibrecht** sind die Boxen gesperrt; den Grund nennt der `RechteHinweis` im Kopf der
 *   Stabseite, ein zweiter Hinweis entfiele hier.
 */
export default function ChecklistePaneel({
  einsatzId,
  darfSchreiben,
  style,
}: {
  einsatzId: number;
  darfSchreiben: boolean;
  /** Außenabstand liefert der Einbauort. */
  style?: CSSProperties;
}) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: einsatzKeys.stabCheckliste(einsatzId),
    queryFn: () => ladeCheckliste(einsatzId),
  });
  const mutation = useMutation({
    mutationFn: ({ punkt, daten }: Auftrag) => setzeChecklistenPunkt(einsatzId, punkt, daten),
    // Die Antwort ist die ganze Checkliste nach dem Commit — sie IST der neue Stand. Andere
    // Schirme zieht das `stab`-Ereignis nach.
    onSuccess: (liste) => queryClient.setQueryData(einsatzKeys.stabCheckliste(einsatzId), liste),
  });

  const daten = query.data;
  const gescheitert = query.isError && !daten;
  const standVeraltet = query.isError && daten != null;
  const laufend = mutation.isPending ? mutation.variables : undefined;
  const gescheiterterPunkt = mutation.isError ? mutation.variables?.punkt : undefined;

  return (
    <Paneel
      titel="Arbeitsaufnahme"
      // Erst mit Daten: vor dem Laden wird nichts über die Menge behauptet.
      meta={daten ? `${erledigtAnzahl(daten)}/${CHECKLISTE.length} erledigt` : undefined}
      koerperPolster
      style={style}
    >
      {gescheitert ? (
        <SeitenFehler
          text="Checkliste konnte nicht geladen werden"
          ursache={query.error}
          onWiederholen={() => void query.refetch()}
        />
      ) : !daten ? (
        <Skeleton title={false} paragraph={{ rows: 4 }} />
      ) : (
        <>
          {standVeraltet && <SeitenStandVeraltet onWiederholen={() => void query.refetch()} />}
          <Liste
            dataSource={CHECKLISTE}
            rowKey={(v) => v.punkt}
            renderItem={(v) => (
              <ChecklistenZeile
                vorlage={v}
                eintrag={eintragFuer(daten, v.punkt)}
                darfSchreiben={darfSchreiben}
                laufend={laufend?.punkt === v.punkt ? laufend.daten : undefined}
                fehler={gescheiterterPunkt === v.punkt ? mutation.error : undefined}
                onSetzen={(daten) => mutation.mutate({ punkt: v.punkt, daten })}
              />
            )}
          />
        </>
      )}
    </Paneel>
  );
}

function ChecklistenZeile({
  vorlage,
  eintrag,
  darfSchreiben,
  laufend,
  fehler,
  onSetzen,
}: {
  vorlage: ChecklistenVorlage;
  eintrag: ReturnType<typeof eintragFuer>;
  darfSchreiben: boolean;
  /** Der Body einer laufenden Anfrage für DIESEN Punkt. */
  laufend: ChecklistenPunktBody | undefined;
  fehler: unknown;
  onSetzen: (daten: ChecklistenPunktBody) => void;
}) {
  const { token } = useRollen();
  const beschreibungId = useId();
  const erledigt = eintrag?.erledigt ?? false;
  const hakenLaeuft = laufend != null && 'erledigt' in laufend;
  const bemerkungLaeuft = laufend != null && 'bemerkung' in laufend;
  // Einrücken bis unter den Text: Box + Abstand, damit Quelle und Bemerkung zur Zeile gehören.
  const einzug = token.paddingSM + token.controlInteractiveSize + token.paddingSM;

  return (
    <ListenEintrag>
      <Flex vertical gap={token.marginXXS}>
        <Checkbox
          checked={erledigt}
          disabled={!darfSchreiben || hakenLaeuft}
          aria-describedby={beschreibungId}
          onChange={(e) => onSetzen({ erledigt: e.target.checked })}
          style={{
            ...checklistenZeileStil(token),
            // Gesperrt verspricht die Hand keinen Klick.
            cursor: darfSchreiben ? 'pointer' : 'default',
          }}
        >
          {vorlage.text}
        </Checkbox>
        <div
          id={beschreibungId}
          style={{ paddingInlineStart: einzug, color: token.colorTextDescription }}
        >
          {vorlage.quelle}
          {erledigt && eintrag?.erledigt_at && (
            <>
              {' · '}
              <span style={monoStil(token.fontSize)}>
                erledigt <ZeitAnzeige wert={eintrag.erledigt_at} format="kurz" />
              </span>
            </>
          )}
        </div>
        <div style={{ paddingInlineStart: einzug }}>
          <BemerkungZelle
            wert={
              bemerkungLaeuft && 'bemerkung' in laufend ? laufend.bemerkung : eintrag?.bemerkung
            }
            kennung={vorlage.text}
            darfSchreiben={darfSchreiben}
            laeuft={bemerkungLaeuft}
            onSpeichern={(wert) => onSetzen({ bemerkung: wert })}
          />
        </div>
        {fehler != null && (
          <div data-fehler style={{ paddingInlineStart: einzug }}>
            <SpeicherFehler fehler={fehler} />
          </div>
        )}
      </Flex>
    </ListenEintrag>
  );
}
