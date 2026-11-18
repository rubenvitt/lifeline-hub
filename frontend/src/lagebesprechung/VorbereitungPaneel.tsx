import { wireAlsEpoche } from '../pages/lage-dashboard/lagebild';
import { datenstandText } from '../components/Datenstand';
import { useOhneVerbindung } from '../offline/verbindung';
import { useNavigate } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { Button } from 'antd';
import type { AbrufZustand } from '../api/abrufZustand';
import { legeLageberichtAn } from '../api/lageberichte';
import type { EinsatzAnzeige, LagebesprechungStand, ModulFreigaben } from '../api/types';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { Paneel, PaneelZeile, monoStil, useRollen } from '../components/instrument';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import { istKeyFreigegeben } from '../einsatz/modulRegistry';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { lageberichtDetailPfad } from '../routing/deeplinks';
import { useVorbereitung } from './useVorbereitung';
import { vorbereitungMarkdown } from './vorbereitung';
import { zeitpunkt } from '../anzeige/zeitDarstellung';

interface Props {
  einsatzId: number;
  einsatz: EinsatzAnzeige;
  freigaben: ModulFreigaben | undefined;
  besprechung: LagebesprechungStand | undefined;
  besprechungZustand: AbrufZustand;
  besprechungStand: number;
}

/**
 * Paneel „Vorbereitung" der Seite Lagebesprechung (LFH-550, seit LLH-1111 nicht mehr am Stab): der Lagestand zur nächsten Lagebesprechung.
 *
 * Die Zahlen kommen aus DERSELBEN Zusammenstellung wie das Lage-Dashboard (`useLagebild` +
 * `baueLagebild`) und aus dem Modulzähler — das Paneel rechnet nichts selbst
 * (`lagebesprechung/vorbereitung.ts`). Jede Zeile nennt ihre Quelle; eine gesperrte Quelle steht als „—" mit
 * Grund da. Nichts wird gespeichert: einen festen Stand gibt es nur über „In Lagebericht
 * übernehmen" (EIN Aufruf mit Startinhalt, Spec `dokument-uebernahme`).
 */
export default function VorbereitungPaneel({
  einsatzId,
  einsatz,
  freigaben,
  besprechung,
  besprechungZustand,
  besprechungStand,
}: Props) {
  const { token, rollen } = useRollen();
  const { konventionen: konv } = useAnzeigeKonventionen();
  const ohneNetz = useOhneVerbindung();
  const navigate = useNavigate();
  const { zeilen, standWire, laedt } = useVorbereitung({
    einsatzId,
    besprechung,
    besprechungZustand,
    besprechungStand,
  });

  // Die Übernahme legt einen Lagebericht an: Schreibrecht im Einsatz UND Modul Lageberichte frei
  // (Freigabe vom Server; solange sie fehlt, gilt das Modul als nicht frei).
  // Solange eine Quelle lädt, stünde „lädt" im Bericht — der Knopf ist dann gesperrt.
  const darfUebernehmen =
    darfImEinsatzSchreiben(einsatz) && istKeyFreigegeben('lageberichte', freigaben);

  const uebernehmen = useMutation({
    mutationFn: async () => {
      const titelDtg = zeitpunkt(new Date().toISOString(), konv);
      const standDtg = standWire ? zeitpunkt(standWire, konv) : titelDtg;
      const lb = await legeLageberichtAn(einsatzId, {
        vorlage: 'freitext',
        titel: `Vorbereitung Lagebesprechung ${titelDtg}`,
        abschnitte: [{ schluessel: 'text', text: vorbereitungMarkdown(zeilen, standDtg) }],
      });
      return lb.id;
    },
    onSuccess: (lbId) => navigate(lageberichtDetailPfad(einsatzId, lbId)),
  });

  return (
    <Paneel
      titel="Vorbereitung"
      // Eine Form für den Datenstand (LLH-1750, Spec `zeitdarstellung`).
      meta={
        standWire
          ? datenstandText(wireAlsEpoche(standWire), Date.now(), { offline: ohneNetz, konv })
          : undefined
      }
      style={{ marginBottom: token.margin }}
      fuss={
        darfUebernehmen || uebernehmen.error != null ? (
          <div style={{ padding: `${token.paddingSM}px ${token.padding}px` }}>
            {darfUebernehmen && (
              <Button
                loading={uebernehmen.isPending || laedt}
                disabled={laedt}
                onClick={() => uebernehmen.mutate()}
              >
                In Lagebericht übernehmen
              </Button>
            )}
            {uebernehmen.error != null && (
              <div style={{ marginBlockStart: token.marginSM }}>
                <SpeicherFehler
                  fehler={uebernehmen.error}
                  titel="Nicht in den Lagebericht übernommen"
                  fallback="Übernahme fehlgeschlagen"
                />
              </div>
            )}
          </div>
        ) : undefined
      }
    >
      {zeilen.map((z) => (
        <PaneelZeile key={z.schluessel}>
          <div
            data-lfh="vorbereitung-zeile"
            data-schluessel={z.schluessel}
            data-zustand={z.zustand}
            style={{
              display: 'grid',
              // Wert direkt neben der Bezeichnung (LLH-1747, Spec `lagebesprechung-vorbereitung`,
              // „Wert neben der Bezeichnung“): die Bezeichnungsspalte ist gedeckelt, 16 em am
              // Fükw, 40 % auf schmalen Schirmen; vorher stand der Wert rechtsbündig am Rand
              // der vollen Breite, bei 1920 px rund 1500 px von seiner Bezeichnung.
              // Beide Spalten dürfen schrumpfen: die Sichtung ist lang und bricht um, statt auf
              // 390 px über den Rand zu laufen. Nur hinter „ · “: im Teil und vor dem Punkt stehen
              // geschützte Leerzeichen (`sichtungText`, LFH-978); `overflowWrap` an der
              // Wertspalte bleibt Notbremse für einen Teil, der allein nicht passt.
              gridTemplateColumns: 'minmax(0, min(16em, 40%)) minmax(0, 1fr)',
              columnGap: token.marginSM,
              rowGap: token.marginXXS,
              width: '100%',
            }}
          >
            <span>{z.titel}</span>
            <span
              data-teil="wert"
              style={{
                ...monoStil(token.fontSize, 500),
                overflowWrap: 'anywhere',
              }}
            >
              {z.wert}
            </span>
            {/* Quelle unter der Bezeichnung, Notiz unter dem Wert. */}
            <span style={{ color: rollen.gedaempft, fontSize: token.fontSizeSM }}>
              Quelle: {z.quelle}
            </span>
            <span style={{ color: rollen.gedaempft, fontSize: token.fontSizeSM }}>
              {z.notiz ?? ''}
            </span>
          </div>
        </PaneelZeile>
      ))}
    </Paneel>
  );
}
