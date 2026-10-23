import { Button, Checkbox, Flex, Skeleton } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useId, useRef, useState, type CSSProperties } from 'react';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { einsatzKeys } from '../api/queryKeys';
import { ladeCheckliste, setzeChecklistenPunkt } from '../api/stab';
import { ladeFuehrungsstelle } from '../api/einsaetze';
import { abrufZustand } from '../api/abrufZustand';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { einsatzdatenPfad } from '../routing/deeplinks';
import { Link } from 'react-router';
import { ZUSTAND_GRUND } from './funkplan';
import { stabZeilenzielStil } from './zeilenziel';
import type { ChecklistenEintrag, ChecklistenPunkt, ChecklistenPunktBody } from '../api/types';
import { BemerkungZelle } from '../components/BemerkungZelle';
import { Liste, ListenEintrag } from '../components/Liste';
import { SeitenFehler, SeitenStandVeraltet } from '../components/SeitenZustand';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import { Paneel, monoStil, useRollen } from '../components/instrument';
import type { ChecklistenVorlage } from './checkliste';
import { CHECKLISTE, checklistenZeileStil, eintragFuer, erledigtAnzahl } from './checkliste';

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
 * - **Mutationen je Zeile und je Bedienziel** (Haken, Bemerkung): eine gemeinsame `useMutation`
 *   zeigte nur den LETZTEN Aufruf — wer zwei Zeilen kurz nacheinander abhakte, verlor an der
 *   ersten Sperre und Fehler. Die Antworten gleicht {@link useChecklistenAbgleich} ab.
 * - **Fehler an die Zeile** (`data-fehler`), nicht als Toast; der nächste Aufruf räumt ihn.
 * - **Bemerkung** über `BemerkungZelle`; jedes Bedienziel schickt genau SEIN Feld (Design D3).
 * - **Ohne Schreibrecht** sind die Boxen gesperrt; den Grund nennt der `RechteHinweis` im Kopf der
 *   Stabseite, ein zweiter Hinweis entfiele hier.
 * - **Einklappen** (LLH-1124, `openspec/changes/archive/2026-10-13-o5nxgqbl-stab-uebersicht/design.md`, D6): ist beim
 *   ersten Eintreffen der Daten alles erledigt, steht das Paneel eingeklappt (Kopf mit „7/7
 *   erledigt“ und „Aufklappen“). Danach klappt nur die Person; der letzte Haken klappt nicht unter
 *   der Hand ein, eine Rücknahme im eingeklappten Zustand klappt auf.
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
  const query = useQuery({
    queryKey: einsatzKeys.stabCheckliste(einsatzId),
    queryFn: () => ladeCheckliste(einsatzId),
  });
  const abgleich = useChecklistenAbgleich(einsatzId);

  const daten = query.data;
  const gescheitert = query.isError && !daten;
  const standVeraltet = query.isError && daten != null;
  const isVollstaendig = daten != null && erledigtAnzahl(daten) === CHECKLISTE.length;
  const bodyId = useId();
  // Zustand aus dem vorigen Render statt Effekt: der Startwert fällt einmal mit den ersten Daten,
  // eine Rücknahme öffnet im selben Render, ohne Blitzen.
  const [klappe, setKlappe] = useState({ isInitialized: false, isEingeklappt: false });
  if (daten && !klappe.isInitialized)
    setKlappe({ isInitialized: true, isEingeklappt: isVollstaendig });
  if (daten && klappe.isEingeklappt && !isVollstaendig) {
    setKlappe({ isInitialized: true, isEingeklappt: false });
  }
  const isEingeklappt = klappe.isInitialized && klappe.isEingeklappt;

  return (
    <Paneel
      titel="Arbeitsaufnahme"
      // Erst mit Daten: vor dem Laden wird nichts über die Menge behauptet.
      meta={daten ? `${erledigtAnzahl(daten)}/${CHECKLISTE.length} erledigt` : undefined}
      aktion={
        isVollstaendig || isEingeklappt ? (
          <Button
            aria-expanded={!isEingeklappt}
            aria-controls={bodyId}
            onClick={() => setKlappe({ isInitialized: true, isEingeklappt: !isEingeklappt })}
          >
            {isEingeklappt ? 'Aufklappen' : 'Einklappen'}
          </Button>
        ) : undefined
      }
      koerperPolster={!isEingeklappt}
      style={style}
    >
      <div id={bodyId} hidden={isEingeklappt}>
        {isEingeklappt ? null : gescheitert ? (
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
                  einsatzId={einsatzId}
                  vorlage={v}
                  eintrag={eintragFuer(daten, v.punkt)}
                  darfSchreiben={darfSchreiben}
                  abgleich={abgleich}
                />
              )}
            />
          </>
        )}
      </div>
    </Paneel>
  );
}

/**
 * Gleicht die Antworten mehrerer gleichzeitiger Aufrufe mit dem Cache ab. Jede Antwort ist die
 * ganze Checkliste nach IHREM Commit — kommen zwei Antworten vertauscht an, überschriebe die
 * ältere die neuere. Deshalb:
 * - Läuft sonst nichts, IST die Antwort der neue Stand.
 * - Überlappen Aufrufe, übernimmt jede Antwort sofort nur den Eintrag IHRES Punkts (die Zeile
 *   quittiert ohne Warten auf die anderen), und der letzte Abschluss lädt die Liste neu.
 * - Ein Fehler lädt neu, sobald nichts mehr läuft: der Haken zeigt danach sicher den Serverstand.
 * Zähler im Ref statt `isMutating`, damit kein zweiter Key-Raum neben der Registry entsteht.
 */
function useChecklistenAbgleich(einsatzId: number) {
  const queryClient = useQueryClient();
  const laufend = useRef(0);
  const ueberlappt = useRef(false);
  const beginn = useCallback(() => {
    laufend.current += 1;
    if (laufend.current > 1) ueberlappt.current = true;
  }, []);
  const ende = useCallback(
    (punkt: ChecklistenPunkt, liste: ChecklistenEintrag[] | undefined) => {
      laufend.current -= 1;
      const key = einsatzKeys.stabCheckliste(einsatzId);
      if (laufend.current > 0) {
        if (liste) {
          const eigener = liste.find((e) => e.punkt === punkt);
          queryClient.setQueryData<ChecklistenEintrag[]>(key, (alt) => [
            ...(alt ?? []).filter((e) => e.punkt !== punkt),
            ...(eigener ? [eigener] : []),
          ]);
        }
        return;
      }
      if (liste && !ueberlappt.current) {
        queryClient.setQueryData(key, liste);
        return;
      }
      ueberlappt.current = false;
      void queryClient.invalidateQueries({ queryKey: key });
    },
    [einsatzId, queryClient],
  );
  return { beginn, ende };
}

type Abgleich = ReturnType<typeof useChecklistenAbgleich>;

function ChecklistenZeile({
  einsatzId,
  vorlage,
  eintrag,
  darfSchreiben,
  abgleich,
}: {
  einsatzId: number;
  vorlage: ChecklistenVorlage;
  eintrag: ReturnType<typeof eintragFuer>;
  darfSchreiben: boolean;
  abgleich: Abgleich;
}) {
  const { token } = useRollen();
  const beschreibungId = useId();
  const erledigt = eintrag?.erledigt ?? false;
  // Je Bedienziel eine eigene Mutation: Haken und Bemerkung laufen unabhängig, und Sperre,
  // Ladeanzeige und Fehler gehören genau dem Ziel, das sie ausgelöst hat.
  const mutationOptionen = {
    mutationFn: (daten: ChecklistenPunktBody) =>
      setzeChecklistenPunkt(einsatzId, vorlage.punkt, daten),
    onMutate: abgleich.beginn,
    onSettled: (liste: ChecklistenEintrag[] | undefined) => abgleich.ende(vorlage.punkt, liste),
  };
  const haken = useMutation(mutationOptionen);
  const bemerkung = useMutation(mutationOptionen);
  const bemerkungNeu =
    bemerkung.isPending && bemerkung.variables && 'bemerkung' in bemerkung.variables
      ? bemerkung.variables.bemerkung
      : undefined;
  // Einrücken bis unter den Text: Box + Abstand, damit Quelle und Bemerkung zur Zeile gehören.
  const einzug = token.paddingSM + token.controlInteractiveSize + token.paddingSM;

  return (
    <ListenEintrag>
      <Flex vertical gap={token.marginXXS}>
        <Checkbox
          checked={erledigt}
          disabled={!darfSchreiben || haken.isPending}
          aria-describedby={beschreibungId}
          onChange={(e) => haken.mutate({ erledigt: e.target.checked })}
          style={{
            ...checklistenZeileStil(token),
            // Gesperrt verspricht die Hand keinen Klick.
            cursor: darfSchreiben && !haken.isPending ? 'pointer' : 'default',
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
                erledigt <ZeitAnzeige wert={eintrag.erledigt_at} rolle="kurz" />
              </span>
            </>
          )}
        </div>
        {vorlage.punkt === 'aufstellort' && (
          <div style={{ paddingInlineStart: einzug }}>
            <FuehrungsstellenStandort einsatzId={einsatzId} />
          </div>
        )}
        <div style={{ paddingInlineStart: einzug }}>
          <BemerkungZelle
            // Während des Speicherns den NEUEN Wert zeigen (Vertrag von `laeuft`).
            wert={bemerkung.isPending ? bemerkungNeu : eintrag?.bemerkung}
            kennung={vorlage.text}
            darfSchreiben={darfSchreiben}
            laeuft={bemerkung.isPending}
            onSpeichern={(wert) => bemerkung.mutate({ bemerkung: wert })}
          />
        </div>
        {(haken.isError || bemerkung.isError) && (
          <div data-fehler style={{ paddingInlineStart: einzug }}>
            <Flex vertical gap={token.marginXXS}>
              {haken.isError && <SpeicherFehler fehler={haken.error} />}
              {bemerkung.isError && (
                <SpeicherFehler fehler={bemerkung.error} titel="Bemerkung nicht gespeichert" />
              )}
            </Flex>
          </div>
        )}
      </Flex>
    </ListenEintrag>
  );
}

/**
 * Wert am Punkt „Standort der Führungsstelle festgelegt“ (LFH-1181, design.md D8): Bezeichnung und
 * Standort der eigenen Führungsstelle mit Verweis auf ihr Paneel in den Einsatzdaten. Nur Anzeige:
 * der Haken bleibt Handarbeit, kein Punkt wird aus einem anderen Modul abgeleitet.
 */
function FuehrungsstellenStandort({ einsatzId }: { einsatzId: number }) {
  const { token } = useRollen();
  const { formatKoordinate } = useAnzeigeKonventionen();
  const query = useQuery({
    queryKey: einsatzKeys.fuehrungsstelle(einsatzId),
    queryFn: () => ladeFuehrungsstelle(einsatzId),
  });
  const zustand = abrufZustand(query);
  const fs = query.data;
  let wert: string;
  if (zustand !== 'daten' || !fs) {
    wert = ZUSTAND_GRUND[zustand === 'daten' ? 'laden' : zustand];
  } else {
    const ort =
      fs.standort_adresse?.trim() ||
      (fs.standort_lat != null && fs.standort_lon != null
        ? formatKoordinate(fs.standort_lat, fs.standort_lon)
        : null);
    wert = [fs.bezeichnung?.trim() || null, ort ?? 'Standort nicht erfasst']
      .filter((t): t is string => t != null)
      .join(' · ');
  }
  return (
    <Flex gap={token.marginXS} wrap align="baseline">
      <span>{wert}</span>
      <Link
        to={einsatzdatenPfad(einsatzId)}
        aria-label="Standort der Führungsstelle in Einsatzdaten"
        style={stabZeilenzielStil(token)}
      >
        Einsatzdaten
      </Link>
    </Flex>
  );
}
