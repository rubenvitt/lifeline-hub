import { Typography, theme } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import type { CSSProperties } from 'react';
import { useParams } from 'react-router';
import {
  ladeBenachrichtigungVorgaben,
  setzeBenachrichtigungVorgabe,
} from '../../api/benachrichtigungen';
import { einsatzKeys } from '../../api/queryKeys';
import type {
  BenachrichtigungArt,
  BenachrichtigungVorgaben,
  VorgabeFunktion,
} from '../../api/types';
import { BENACHRICHTIGUNG_ARTEN } from '../../alarm/benachrichtigungKatalog';
import { Formularpaneel } from '../../components/instrument';
import { EINSATZ_ABGESCHLOSSEN } from '../../components/nurAnsicht';
import { Select } from '../../components/Select';
import { SeitenFehler, SeitenSkeleton } from '../../components/SeitenZustand';
import { SeitenHinweise } from '../../components/SpeicherHinweis';
import { useViewport } from '../../components/useViewport';
import { RECHTE_TEXT, useEinstellungenDaten } from '../EinsatzEinstellungenPage';

/** Eine Änderung: die Art und ihre Funktionen „still“ danach und davor (für den Rücksprung). */
type Aenderung = { art: BenachrichtigungArt; still: VorgabeFunktion[]; vorher: VorgabeFunktion[] };

/** Setzt `still` einer Art im Cache; die übrigen Arten bleiben. */
function mitStill(
  alt: BenachrichtigungVorgaben | undefined,
  art: BenachrichtigungArt,
  still: VorgabeFunktion[],
): BenachrichtigungVorgaben | undefined {
  if (!alt) return alt;
  return { ...alt, arten: alt.arten.map((a) => (a.art === art ? { ...a, still } : a)) };
}

/**
 * Sektion `…/einstellungen/benachrichtigungen` — Vorgabe je Funktion am Einsatz (LLH-1421,
 * Entwurf `/mnt/project-files/llh-1421/design.md` D5; Spec `benachrichtigungen`, „Vorgabe je
 * Funktion am Einsatz“): je Eingangsart, für welche Funktionen sie still ist. Was „still“ heißt
 * und dass lauter gewinnt, steht in der Anwenderdoku (`einsatz-einstellungen.md`), nicht hier.
 *
 * Speichert je Zeile sofort wie die Sektion „Module“, keine Speicher-Leiste: optimistisch, der
 * Wert steht sofort; scheitert der Server, springt nur diese Zeile zurück und trägt die Marke.
 * Nur die Antwort der jüngsten Änderung einer Zeile schreibt zurück, sonst setzte eine späte
 * ältere Antwort eine schnellere zweite Änderung zurück.
 *
 * Rechte wie die Formular-Sektionen (`darfEinsatzVerwalten`, Server `EinsatzVerwaltungszugriff`);
 * ohne sie nur lesend mit `RechteHinweis`.
 */
export default function EinsatzBenachrichtigungen() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const qc = useQueryClient();
  const { token } = theme.useToken();
  const { istSchmal } = useViewport();
  const daten = useEinstellungenDaten(einsatzId);
  const key = einsatzKeys.benachrichtigungVorgaben(einsatzId);
  const vorgabenQuery = useQuery({
    queryKey: key,
    queryFn: () => ladeBenachrichtigungVorgaben(einsatzId),
  });
  // Je Art die Nummer der jüngsten Änderung.
  const juengste = useRef(new Map<BenachrichtigungArt, number>());

  // Kein `onError`-Toast: der Fehler steht über dem Paneel, die Zeile trägt die Marke.
  const setzen = useMutation({
    mutationFn: (a: Aenderung) => setzeBenachrichtigungVorgabe(einsatzId, a.art, a.still),
    onMutate: (a) => {
      const nummer = (juengste.current.get(a.art) ?? 0) + 1;
      juengste.current.set(a.art, nummer);
      qc.setQueryData<BenachrichtigungVorgaben>(key, (alt) => mitStill(alt, a.art, a.still));
      return { nummer };
    },
    onSuccess: (stand, a, kontext) => {
      if (juengste.current.get(a.art) !== kontext.nummer) return;
      qc.setQueryData<BenachrichtigungVorgaben>(key, (alt) =>
        mitStill(alt, stand.art, stand.still),
      );
    },
    onError: (_fehler, a, kontext) => {
      if (kontext && juengste.current.get(a.art) !== kontext.nummer) return;
      qc.setQueryData<BenachrichtigungVorgaben>(key, (alt) => mitStill(alt, a.art, a.vorher));
    },
  });

  if (daten.laedt || vorgabenQuery.isLoading) return <SeitenSkeleton />;
  if (!daten.einsatz || !vorgabenQuery.data) {
    return (
      <SeitenFehler
        text="Benachrichtigungen nicht ladbar oder kein Zugriff"
        onWiederholen={() => {
          daten.neuLaden();
          void vorgabenQuery.refetch();
        }}
      />
    );
  }

  const { funktionen, arten } = vorgabenQuery.data;
  const darf = daten.darfBearbeiten;
  const optionen = funktionen.map((f) => ({ value: f.funktion, label: f.name }));
  const fehlerArt = setzen.isError ? setzen.variables.art : null;
  const raster: CSSProperties = istSchmal
    ? { display: 'grid', gridTemplateColumns: '1fr', gap: token.marginXXS }
    : {
        display: 'grid',
        // Die Auswahl nimmt die breitere Spur: mehrere Funktionen stehen als Marken nebeneinander.
        gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 3fr)',
        alignItems: 'center',
        gap: token.margin,
      };

  return (
    <>
      <SeitenHinweise
        fehler={setzen.error}
        rechteFehlt={daten.istAktiv && !darf}
        rechteText={RECHTE_TEXT}
      />
      <Formularpaneel titel="Still je Funktion">
        <div style={{ display: 'flex', flexDirection: 'column', gap: token.marginXS }}>
          {!istSchmal && (
            <div style={{ ...raster, fontSize: token.fontSizeSM, opacity: 0.6 }}>
              <span>Eingang</span>
              <span>Still für</span>
            </div>
          )}
          {arten.map(({ art, still }) => {
            const name = BENACHRICHTIGUNG_ARTEN[art]?.name ?? art;
            const feldId = `vorgabe-still-${art}`;
            const hatFehler = fehlerArt === art;
            return (
              <div
                key={art}
                data-vorgabe-zeile={art}
                data-fehler={hatFehler ? 'true' : undefined}
                style={{
                  ...raster,
                  borderInlineStart: hatFehler ? `3px solid ${token.colorError}` : undefined,
                  paddingInlineStart: token.paddingXS,
                }}
              >
                <label htmlFor={feldId} style={{ minWidth: 0 }}>
                  {name}
                  {!darf && (
                    <Typography.Text
                      type="secondary"
                      style={{ fontSize: token.fontSizeSM, marginInlineStart: token.marginXS }}
                    >
                      {daten.istAktiv ? 'nur lesen' : EINSATZ_ABGESCHLOSSEN}
                    </Typography.Text>
                  )}
                </label>
                <Select<VorgabeFunktion[]>
                  id={feldId}
                  mode="multiple"
                  aria-label={`Still für: ${name}`}
                  style={{ width: '100%' }}
                  value={still}
                  options={optionen}
                  disabled={!darf}
                  placeholder="niemand"
                  onChange={(neu) => setzen.mutate({ art, still: neu, vorher: still })}
                />
              </div>
            );
          })}
        </div>
      </Formularpaneel>
    </>
  );
}
