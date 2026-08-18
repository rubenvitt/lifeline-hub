import { Alert, App, Breadcrumb, Form, Space, Tag } from 'antd';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ladeEinsatz } from '../../api/einsaetze';
import { darfImEinsatzSchreiben } from '../../einsatz/schreibrecht';
import { useAuth } from '../../auth/AuthContext';
import { registrierAnzeige } from '../../api/einsatzPerson';
import { fehlerText } from '../../api/client';
import { einsatzKeys } from '../../api/queryKeys';
import { ErfassungsFormular } from '../../components/Erfassung';
import EinsatzSeite from '../../components/EinsatzSeite';
import { SeitenFehler, SeitenSkeleton } from '../../components/SeitenZustand';
import { SK_META } from '../../personen/personMeta';
import AufnahmeFelder, { type AufnahmeEingabe } from '../../personen/AufnahmeFelder';
import { erfassePersonOfflineFaehig } from '../../offline/schreiben';
import { personenPfad } from '../../routing/deeplinks';
import { flaeche } from '../../theme/tokens';

/**
 * Vollseiten-Aufnahme für Personen (LFH-340 · C5).
 *
 * ── WARUM ES DIESE SEITE GIBT, obwohl die Schnellerfassung dasselbe kann ────
 *
 * Nicht wegen des Feldumfangs — die Maske ist Zeichen für Zeichen dieselbe
 * (`personen/AufnahmeFelder`, ein Bauteil, zwei Mounts). Sondern wegen der ADRESSE: andere
 * Module springen die Aufnahme an (die UHS-Kopfzeile aus C6), und ein Dialog hat keine.
 *
 * Das AK des Tickets verlangt „≤ 4 Interaktionen UND ohne Seitenwechsel" und gleichzeitig
 * eine eigene Route. Beides wörtlich zugleich geht nicht — eine angesprungene Route IST ein
 * Seitenwechsel. Aufgelöst ist der Widerspruch so: den Zählweg erfüllt das Modal auf der
 * Personenliste (offen → Kategorie → speichern), diese Route ist der Weg von außen. Sie
 * konkurriert nicht mit ihm, sie ergänzt ihn.
 *
 * ── SERIE IST HIER DER NORMALFALL, NICHT DIE AUSNAHME ───────────────────────
 *
 * Wer diese Seite ansteuert, steht an der Aufnahme und erfasst der Reihe nach:
 * „Speichern und nächste" hält die Seite, der Primär-Knopf speichert die letzte Person und
 * geht in die Liste zurück. Die Quittung bleibt bis zur nächsten Erfassung stehen — an ihr
 * wird die Registriernummer abgelesen und auf das Band geschrieben, ein Toast wäre weg,
 * bevor jemand ihn abschreiben kann.
 */
export default function AufnahmePage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [form] = Form.useForm<AufnahmeEingabe>();
  const [quittung, setQuittung] = useState<string | null>(null);

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });

  const anlegenMutation = useMutation({
    mutationFn: async (daten: AufnahmeEingabe) => {
      if (!benutzer) throw new Error('Nicht angemeldet');
      return erfassePersonOfflineFaehig(benutzer.id, einsatzId, daten);
    },
    onSuccess: (ergebnis) => {
      if (ergebnis.zustand === 'vorgemerkt') {
        setQuittung('Offline vorgemerkt — Registriernummer folgt nach der Übertragung.');
      } else {
        const person = ergebnis.daten;
        // Aus der ANTWORT gelesen, nicht aus den gesendeten Werten: das Backend schreibt
        // die Sichtung in derselben Transaktion und kann sie verwerfen.
        setQuittung(
          person.aktuelle_sichtung
            ? `Erfasst als ${registrierAnzeige(person.registrier_nr)} · ${SK_META[person.aktuelle_sichtung].label}`
            : `Erfasst als ${registrierAnzeige(person.registrier_nr)}`,
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
      breite={flaeche.seiteSchmal}
      titel={
        <Space>
          Aufnahme
          <Tag color={einsatz.status === 'aktiv' ? 'green' : 'default'}>{einsatz.status}</Tag>
        </Space>
      }
      beschreibung="Sichtungskategorie zuerst — die übrigen Angaben sind optional."
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz.bezeichnung },
            { title: <Link to={personenPfad(einsatzId)}>Personen</Link> },
            { title: 'Aufnahme' },
          ]}
        />
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
        // STEHENDE Quittung, kein Toast (Befund H30): an ihr wird die Registriernummer
        // abgelesen und auf das Band geschrieben. Sie bleibt bis zur nächsten Erfassung.
        <Alert style={{ marginBottom: 16 }} type="success" showIcon title={quittung} />
      )}

      {darfSchreiben && (
        <ErfassungsFormular<AufnahmeEingabe>
          form={form}
          serie
          uebernahme={['antreff_ort']}
          laeuft={anlegenMutation.isPending}
          // `mutateAsync`, nicht `mutate`: nur eine abgelehnte Zusage hält die Felder stehen.
          onErfassen={(daten) => anlegenMutation.mutateAsync(daten)}
          /**
           * Die beiden Knöpfe der Hülle bekommen hier ihre Bedeutung aus der Serie:
           * „Speichern und nächste" hält die Seite, der Primär-Knopf „Erfassen" speichert
           * die LETZTE Person und geht zurück in die Liste. Der Primär-Knopf behält seine
           * Vorgabebeschriftung — ihn „Fertig" zu nennen wäre eine Lüge: er speichert.
           */
          onFertig={() => navigate(personenPfad(einsatzId))}
        >
          <AufnahmeFelder modus="schnell" />
        </ErfassungsFormular>
      )}
    </EinsatzSeite>
  );
}
