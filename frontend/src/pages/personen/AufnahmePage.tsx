import { Alert, App, Breadcrumb, Form, Space } from 'antd';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { ladeEinsatz } from '../../api/einsaetze';
import { darfImEinsatzSchreiben } from '../../einsatz/schreibrecht';
import { useAuth } from '../../auth/AuthContext';
import { registrierAnzeige } from '../../api/einsatzPerson';
import { fehlerText } from '../../api/client';
import { einsatzKeys } from '../../api/queryKeys';
import { ErfassungsFormular } from '../../components/Erfassung';
import {
  liesErfassungsSitzungswert,
  schreibeErfassungsSitzungswert,
} from '../../components/erfassungsSitzung';
import EinsatzSeite from '../../components/EinsatzSeite';
import { SeitenFehler, SeitenSkeleton } from '../../components/SeitenZustand';
import { SK_META } from '../../personen/personMeta';
import AufnahmeFelder, {
  aufnahmeZuEingabe,
  type AufnahmeEingabe,
  type AufnahmeWerte,
} from '../../personen/AufnahmeFelder';
import { erfassePersonOfflineFaehig } from '../../offline/schreiben';
import { parseRouteId } from '../../routing/deeplinks';
import { useEinsatzPfade } from '../../routing/EinsatzPfade';
import { useGeraetDarf } from '../../geraet/geraetSicht';
import StatusTag from '../../components/StatusTag';
import { einsatzStatus } from '../../theme/statusFarben';

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
export default function AufnahmePage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  const navigate = useNavigate();
  // Am gekoppelten Gerät führt der Rückweg in die Gerätehülle, ohne Brotkrumen in fremde Module
  // (LFH-892).
  const pfade = useEinsatzPfade();
  const darf = useGeraetDarf();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [form] = Form.useForm<AufnahmeWerte>();
  const [quittung, setQuittung] = useState<string | null>(null);
  const sitzungsortGeladen = useRef<number | null>(null);
  const [searchParams] = useSearchParams();
  /**
   * UHS-Auftrag. Unbrauchbares wird ganz verworfen, nicht halb übernommen (wie
   * `parsePlatzierenAuftrag`): ein halb gelesener Auftrag buchte auf eine UHS, die es nicht gibt.
   */
  const uhsAuftrag = parseRouteId(searchParams.get('uhs') ?? undefined);

  /**
   * Der sitzungsweite Antreffort gilt wie im Modal auch hier; `uebernahme={['antreff_ort']}` deckt
   * nur einen Lauf ab. Gesetzt als Formularwert, NICHT als `initialValues` — sonst füllte jeder
   * Serien-Reset den Ort auch bei ausgeschaltetem „Werte behalten" wieder auf. Der Merker
   * verhindert, dass ein späterer Render einen getippten Ort überschreibt.
   */
  useEffect(() => {
    if (sitzungsortGeladen.current === einsatzId) return;
    sitzungsortGeladen.current = einsatzId;
    const ort = liesErfassungsSitzungswert(einsatzId, 'person', 'antreff_ort');
    if (ort !== undefined) form.setFieldValue('antreff_ort', ort);
  }, [einsatzId, form]);

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });

  const anlegenMutation = useMutation({
    // Die Funktion merkt ohne Netz selbst vor; TanStacks Vorgabe hielte die Mutation an
    // (LFH-705, design.md D6).
    networkMode: 'always',
    mutationFn: async (daten: AufnahmeEingabe) => {
      if (!benutzer) throw new Error('Nicht angemeldet');
      return erfassePersonOfflineFaehig(benutzer.id, einsatzId, {
        ...daten,
        ...(uhsAuftrag !== null ? { uhs_id: uhsAuftrag } : {}),
      });
    },
    onSuccess: (ergebnis) => {
      if (ergebnis.zustand === 'vorgemerkt') {
        setQuittung('Offline vorgemerkt — Registriernummer folgt nach der Übertragung.');
      } else {
        const person = ergebnis.daten;
        const zusatz =
          uhsAuftrag && person.aktuelle_uhs_id === uhsAuftrag && person.aktueller_platz_id === null
            ? ' · im Wartebereich'
            : '';
        if (uhsAuftrag) {
          void qc.invalidateQueries({ queryKey: einsatzKeys.uhsDetail(einsatzId, uhsAuftrag) });
          void qc.invalidateQueries({ queryKey: einsatzKeys.uhs(einsatzId) });
        }
        // Aus der ANTWORT gelesen, nicht aus den gesendeten Werten: das Backend schreibt
        // die Sichtung in derselben Transaktion und kann sie verwerfen.
        setQuittung(
          (person.aktuelle_sichtung
            ? `Erfasst als ${registrierAnzeige(person.registrier_nr)} · ${SK_META[person.aktuelle_sichtung].label}`
            : `Erfasst als ${registrierAnzeige(person.registrier_nr)}`) + zusatz,
        );
      }
      void qc.invalidateQueries({ queryKey: einsatzKeys.personen(einsatzId) });
      void qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
    },
    onError: (e) => message.error(fehlerText(e)),
  });

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
  const darfSchreiben = darfImEinsatzSchreiben(einsatz, benutzer);

  return (
    <EinsatzSeite
      breite="schmal"
      titel={
        <Space>
          Aufnahme
          <StatusTag darstellung={einsatzStatus[einsatz.status]} />
        </Space>
      }
      beschreibung={
        uhsAuftrag
          ? 'Sichtungskategorie zuerst — die Person landet danach im Wartebereich der Unfallhilfsstelle.'
          : 'Sichtungskategorie zuerst — die übrigen Angaben sind optional.'
      }
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
                  <Link to={pfade.uhsDetail(einsatzId, uhsAuftrag)}>Unfallhilfsstelle</Link>
                ) : (
                  <Link to={pfade.personenListe(einsatzId)}>Personen</Link>
                ),
              },
              { title: 'Aufnahme' },
            ]}
          />
        )
      }
      hinweis={
        !darfSchreiben && (
          <Alert
            type="info"
            showIcon
            title={
              einsatz.status === 'aktiv'
                ? 'Keine Schreibberechtigung in diesem Einsatz.'
                : 'Einsatz ist abgeschlossen — nur Ansicht.'
            }
          />
        )
      }
    >
      {quittung && (
        // Stehende Quittung statt Toast: an ihr wird die Registriernummer abgelesen.
        <Alert style={{ marginBottom: 16 }} type="success" showIcon title={quittung} />
      )}

      {darfSchreiben && (
        <ErfassungsFormular<AufnahmeWerte>
          form={form}
          serie
          uebernahme={['antreff_ort']}
          laeuft={anlegenMutation.isPending}
          // `mutateAsync`, nicht `mutate`: nur eine abgelehnte Zusage hält die Felder stehen.
          onErfassen={(werte) => anlegenMutation.mutateAsync(aufnahmeZuEingabe(werte))}
          // Erst die Post-Acceptance-Stufe darf den Sitzungswert ändern: ein Abbruch während des
          // POST besteht die Generation davor nicht.
          onErfasst={(daten) => {
            if (typeof daten.antreff_ort === 'string') {
              schreibeErfassungsSitzungswert(einsatzId, 'person', 'antreff_ort', daten.antreff_ort);
            }
          }}
          /**
           * „Speichern und nächste" hält die Seite; der Primär-Knopf speichert die letzte Person
           * und geht zurück in die Liste — er heißt nicht „Fertig", weil er speichert.
           */
          onFertig={() =>
            navigate(
              uhsAuftrag ? pfade.uhsDetail(einsatzId, uhsAuftrag) : pfade.personenListe(einsatzId),
            )
          }
        >
          <AufnahmeFelder modus="schnell" />
        </ErfassungsFormular>
      )}
    </EinsatzSeite>
  );
}
