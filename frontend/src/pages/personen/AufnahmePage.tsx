import { Alert, App, Breadcrumb, Form, theme } from 'antd';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { ladeEinsatz } from '../../api/einsaetze';
import { darfBeantragen } from '../../einsatz/schreibrecht';
import { useAuth } from '../../auth/AuthContext';
import { registrierAnzeige } from '../../api/einsatzPerson';
import { einsatzKeys } from '../../api/queryKeys';
import { ErfassungsFormular, type Speicherung } from '../../components/Erfassung';
import {
  liesErfassungsSitzungswert,
  schreibeErfassungsSitzungswert,
} from '../../components/erfassungsSitzung';
import EinsatzSeite from '../../components/EinsatzSeite';
import { SeitenFehler, SeitenSkeleton } from '../../components/SeitenZustand';
import { RechteHinweis } from '../../components/SpeicherHinweis';
import { einsatzRechteGrund } from '../../components/nurAnsicht';
import { SK_META } from '../../personen/personMeta';
import AufnahmeFelder, {
  aufnahmeZuEingabe,
  fundortAusText,
  type AufnahmeEingabe,
  type AufnahmeWerte,
} from '../../personen/AufnahmeFelder';
import { erfassePersonOfflineFaehig } from '../../offline/schreiben';
import { parseRouteId } from '../../routing/deeplinks';
import { useEinsatzPfade } from '../../routing/EinsatzPfade';
import { useGeraetDarf } from '../../geraet/geraetSicht';
import { modulName } from '../../einsatz/modulRegistry';
import { ListenRueckweg } from '../../components/ListenRueckweg';

/**
 * Vollseiten-Aufnahme für Personen. Die Maske ist dieselbe wie in der Schnellerfassung
 * (`personen/AufnahmeFelder`); die Route existiert, weil andere Module die Aufnahme anspringen und
 * ein Dialog keine Adresse hat. Den Zählweg „≤ 4 Interaktionen ohne Seitenwechsel" erfüllt das
 * Modal der Personenliste.
 *
 * Serie ist hier der Normalfall: „Speichern und nächste" hält die Seite, der Primär-Knopf speichert
 * die letzte Person und geht in die Liste. Die Quittung bleibt bis zur nächsten Erfassung stehen,
 * weil an ihr die Registriernummer abgeschrieben wird.
 *
 * Mit `?uhs=<id>` (aus der UHS-Kopfzeile) wird ein Patient dieser UHS erfasst: `uhs_id` geht im
 * Anlegen mit, der Server bucht Person und Wartebereich-Eintritt atomar (auch über die
 * Offline-Queue), und der Rückweg führt zur UHS.
 */
/** Quittung einer Aufnahme, am Einsatz festgemacht (LFH-1138). */
interface Quittung {
  einsatzId: number;
  art: 'erfasst' | 'vorgemerkt' | 'beantragt';
  text: string;
}

/**
 * Wie lange der Toast nach „Erfassen“ steht, in Sekunden: lang genug, die Registriernummer am Ziel
 * abzuschreiben (LLH-1760); antds Vorgabe von 3 s reicht dafür nicht.
 */
const QUITTUNG_TOAST_SEKUNDEN = 8;

/**
 * Die Quittung nach „Erfassen“, wenn die Seite wechselt (LLH-1760): Erfolg an den Toast
 * (`frontend/AGENTS.md`, „Speicherfehler an die Seite, Erfolg an den Toast“). Vorgemerkt ist kein
 * Erfolg (`warning` wie beim Melden am Gerät), ein Antrag am Spiegel nur `info`. Fester Schlüssel:
 * eine zweite Aufnahme ersetzt den Toast der ersten.
 */
function zeigeQuittungNachWechsel(
  message: ReturnType<typeof App.useApp>['message'],
  quittung: Quittung | null,
) {
  if (!quittung) return;
  const art =
    quittung.art === 'erfasst' ? 'success' : quittung.art === 'vorgemerkt' ? 'warning' : 'info';
  void message.open({
    key: 'aufnahme-quittung',
    type: art,
    content: quittung.text,
    duration: QUITTUNG_TOAST_SEKUNDEN,
  });
}

export default function AufnahmePage() {
  const { id } = useParams();
  const { token } = theme.useToken();
  const einsatzId = Number(id);
  const { benutzer, geraet } = useAuth();
  const { message } = App.useApp();
  const navigate = useNavigate();
  // Am gekoppelten Gerät führt der Rückweg in die Gerätehülle, ohne Brotkrumen in fremde Module
  // (LFH-892).
  const pfade = useEinsatzPfade();
  const darf = useGeraetDarf();
  const qc = useQueryClient();
  const [form] = Form.useForm<AufnahmeWerte>();
  // Am Einsatz festgemacht: eine Antwort, die erst nach dem Wechsel eintrifft, quittiert nicht im
  // neuen (LFH-1138); dort abgeschrieben, wäre ihre Registriernummer falsch.
  const [quittung, setQuittung] = useState<Quittung | null>(null);
  // Dieselbe Quittung für den Toast nach „Erfassen“ (LLH-1760): `onFertig` läuft im selben Zug wie
  // `onSuccess`, der State wäre dort noch der alte.
  const letzteQuittungRef = useRef<Quittung | null>(null);
  const sitzungsortGeladen = useRef<number | null>(null);
  const einsatzRef = useRef(einsatzId);
  einsatzRef.current = einsatzId;
  const [searchParams] = useSearchParams();
  /**
   * UHS-Auftrag. Unbrauchbares wird ganz verworfen, nicht halb übernommen (wie
   * `parsePlatzierenAuftrag`): ein halb gelesener Auftrag buchte auf eine UHS, die es nicht gibt.
   */
  const uhsAuftrag = parseRouteId(searchParams.get('uhs') ?? undefined);

  /**
   * Der sitzungsweite Fundort gilt wie im Modal auch hier; `uebernahme={['antreff_ort']}` deckt
   * nur einen Lauf ab. Gesetzt als Formularwert, NICHT als `initialValues` — sonst füllte jeder
   * Serien-Reset den Ort auch bei ausgeschaltetem „Werte behalten" wieder auf. Der Merker
   * verhindert, dass ein späterer Render einen getippten Ort überschreibt.
   */
  useEffect(() => {
    if (sitzungsortGeladen.current === einsatzId) return;
    sitzungsortGeladen.current = einsatzId;
    const ort = liesErfassungsSitzungswert(einsatzId, 'person', 'antreff_ort');
    if (ort !== undefined) form.setFieldValue('antreff_ort', fundortAusText(ort));
  }, [einsatzId, form]);

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });

  const anlegenMutation = useMutation({
    // Die Funktion merkt ohne Netz selbst vor; TanStacks Vorgabe hielte die Mutation an
    // (LFH-705, design.md D6).
    networkMode: 'always',
    mutationFn: async ({ einsatzId, daten }: { einsatzId: number; daten: AufnahmeEingabe }) => {
      if (!benutzer) throw new Error('Nicht angemeldet');
      return erfassePersonOfflineFaehig(benutzer.id, einsatzId, {
        ...daten,
        ...(uhsAuftrag !== null ? { uhs_id: uhsAuftrag } : {}),
      });
    },
    // Die Quittung der vorigen Person geht mit dem nächsten Absenden: neben einer Ablehnung
    // behauptete sie sonst Erfolg.
    onMutate: () => {
      letzteQuittungRef.current = null;
      setQuittung(null);
    },
    onSuccess: (ergebnis, { einsatzId }) => {
      const quittiere = (q: Quittung) => {
        letzteQuittungRef.current = q;
        setQuittung(q);
      };
      if (ergebnis.zustand === 'vorgemerkt') {
        quittiere({ einsatzId, art: 'vorgemerkt', text: 'Offline vorgemerkt · R-…' });
      } else if (ergebnis.zustand === 'beantragt') {
        // Am Spiegel (LLH-1492): ein Antrag an die führende Instanz, noch ohne Nummer.
        quittiere({ einsatzId, art: 'beantragt', text: 'Beantragt · R-…' });
      } else {
        const person = ergebnis.daten;
        const zusatz =
          uhsAuftrag && person.aktuelle_uhs_id === uhsAuftrag && person.aktueller_platz_id === null
            ? ' · im Wartebereich'
            : person.aktuelle_verbleib_betreuungsstelle_id != null
              ? ' · untergebracht'
              : '';
        // Die Aufnahme an der Betreuungsstelle zählt dort namentlich (LFH-1041).
        if (person.aktuelle_verbleib_betreuungsstelle_id != null) {
          void qc.invalidateQueries({ queryKey: einsatzKeys.betreuung(einsatzId) });
        }
        if (uhsAuftrag) {
          void qc.invalidateQueries({ queryKey: einsatzKeys.uhsDetail(einsatzId, uhsAuftrag) });
          void qc.invalidateQueries({ queryKey: einsatzKeys.uhs(einsatzId) });
        }
        // Aus der ANTWORT gelesen, nicht aus den gesendeten Werten: das Backend schreibt
        // die Sichtung in derselben Transaktion und kann sie verwerfen.
        quittiere({
          einsatzId,
          art: 'erfasst',
          text:
            (person.aktuelle_sichtung
              ? `Erfasst als ${registrierAnzeige(person.registrier_nr)} · ${SK_META[person.aktuelle_sichtung].label}`
              : `Erfasst als ${registrierAnzeige(person.registrier_nr)}`) + zusatz,
        });
      }
      void qc.invalidateQueries({ queryKey: einsatzKeys.personen(einsatzId) });
      void qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
    },
  });

  /*
   * Das Layout keyt sein `Outlet` nicht, die Seite bleibt über einen Einsatzwechsel dieselbe: nur
   * das Anlegen DIESES Einsatzes gehört ans Formular (wie `pages/TierePage.tsx`). Ein laufendes aus
   * dem vorigen dreht hier nicht, seine Ablehnung steht hier nicht.
   */
  const diesesAnlegen = anlegenMutation.variables?.einsatzId === einsatzId;
  const anlegenSpeicherung: Speicherung = {
    error: diesesAnlegen ? anlegenMutation.error : null,
    isPending: diesesAnlegen && anlegenMutation.isPending,
    reset: anlegenMutation.reset,
  };

  if (einsatzQuery.isLoading) {
    return <SeitenSkeleton />;
  }
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return (
      <SeitenFehler
        text="Einsatz nicht gefunden oder kein Zugriff"
        ursache={einsatzQuery.error}
        onWiederholen={() => void einsatzQuery.refetch()}
      />
    );
  }
  const einsatz = einsatzQuery.data;
  // Die Aufnahme ist eine Erfassung: am Spiegel ein Antrag (LLH-1492, D13).
  const darfSchreiben = darfBeantragen(einsatz);

  return (
    <EinsatzSeite
      breite="schmal"
      titel="Aufnahme"
      breadcrumb={
        darf('fremde-module') && (
          <Breadcrumb
            items={[
              { title: <Link to="/einsaetze">Einsätze</Link> },
              { title: einsatz.bezeichnung },
              {
                // Zeigt den Auftrag: mit Auftrag führt der Rückweg zur UHS, nicht in die
                // Personenliste. Den UHS-Namen lädt die Seite bewusst nicht.
                title: uhsAuftrag ? (
                  <ListenRueckweg to={pfade.uhsDetail(einsatzId, uhsAuftrag)}>
                    Unfallhilfsstelle
                  </ListenRueckweg>
                ) : (
                  <ListenRueckweg to={pfade.personenListe(einsatzId)}>
                    {modulName('personen')}
                  </ListenRueckweg>
                ),
              },
              { title: 'Aufnahme' },
            ]}
          />
        )
      }
      hinweis={!darfSchreiben && <RechteHinweis sichtbar text={einsatzRechteGrund(einsatz)} />}
    >
      {quittung?.einsatzId === einsatzId && (
        // Stehende Quittung statt Toast: an ihr wird die Registriernummer abgelesen. Nur „Erfassen“,
        // das die Seite verlässt, nimmt den Toast (`zeigeQuittungNachWechsel`).
        <Alert
          style={{ marginBottom: token.marginLG }}
          type="success"
          showIcon
          title={quittung.text}
        />
      )}

      {darfSchreiben && (
        <ErfassungsFormular<AufnahmeWerte>
          // Je Einsatz eine eigene Hülle (LLH-1154): ihr Absende-Riegel `sendetRef` hielte sonst bis
          // zur Antwort aus A jedes Absenden in B still zurück, obwohl der Knopf dort nicht lädt.
          key={einsatzId}
          form={form}
          serie
          uebernahme={['antreff_ort']}
          // In der Gerätehülle rollt nur der Inhalt, darunter steht die Navigation: der Fuß klebt
          // über ihr (LLH-1760, `geraet/AGENTS.md`, „Kopfzeile und Navigation“).
          fussKlebt={geraet ? 'seite' : undefined}
          laeuft={anlegenSpeicherung.isPending}
          // Eine Ablehnung steht am Formular, bis zum nächsten Absenden, kein Toast (LFH-1077).
          // Ohne Netz merkt `erfassePersonOfflineFaehig` vor; hier landen nur Ablehnungen.
          speicherung={anlegenSpeicherung}
          speicherFehlerTitel="Person nicht erfasst"
          // `mutateAsync`, nicht `mutate`: nur eine abgelehnte Zusage hält die Felder stehen.
          // Kommt die Antwort erst nach dem Einsatzwechsel, gilt sie hier als abgelehnt: sonst
          // leerte die Serie die Felder des neuen Einsatzes, und der Rückweg führte in den alten
          // (LFH-1138). Ihre Quittung bleibt am alten Einsatz. Das Ergebnis geht zurück: an ihm
          // erkennt die Hülle „nur vorgemerkt“ und gibt `tap` statt `success` (Spec `huellen-vertrag`).
          onErfassen={async (werte) => {
            const ziel = einsatzId;
            const ergebnis = await anlegenMutation.mutateAsync({
              einsatzId: ziel,
              daten: aufnahmeZuEingabe(werte),
            });
            if (einsatzRef.current !== ziel) throw new Error('Einsatz gewechselt');
            return ergebnis;
          }}
          // Erst die Post-Acceptance-Stufe darf den Sitzungswert ändern: ein Abbruch während des
          // POST besteht die Generation davor nicht.
          onErfasst={(daten) => {
            if (typeof daten.antreff_ort?.text === 'string') {
              schreibeErfassungsSitzungswert(
                einsatzId,
                'person',
                'antreff_ort',
                daten.antreff_ort.text,
              );
            }
          }}
          /**
           * „Speichern und nächste" hält die Seite; der Primär-Knopf speichert die letzte Person
           * und geht zurück in die Liste — er heißt nicht „Fertig", weil er speichert. Die stehende
           * Quittung geht mit der Seite, deshalb nennt ein Toast sie am Ziel (LLH-1760).
           */
          onFertig={() => {
            zeigeQuittungNachWechsel(message, letzteQuittungRef.current);
            navigate(
              uhsAuftrag ? pfade.uhsDetail(einsatzId, uhsAuftrag) : pfade.personenListe(einsatzId),
            );
          }}
        >
          <AufnahmeFelder
            modus="erfassen"
            einsatzId={einsatzId}
            ohneSichtung={!darf('person-sichtung')}
          />
        </ErfassungsFormular>
      )}
    </EinsatzSeite>
  );
}
