package dev.rubeen.lifeline.helferkern

import java.time.Duration
import java.time.Instant
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Was der Ortungsdienst wann sendet (Spec „Senden, Takt, ohne Netz“): [Takt], [Puffer] und
 * [Wiederholung] zusammen; Gegenstück `Sendeplan` in `ios/HelferKern`, beide gegen den Abschnitt
 * `sendeplan` von `src-tauri/faelle/helfer.json`. Der Dienst meldet Messungen, Antworten und die
 * Uhr; jede Methode gibt die Position zurück, die jetzt rausgeht, oder `null`. Es läuft höchstens
 * eine Sendung zur Zeit; eine neuere Messung wartet im Puffer (nur die letzte, nur im Speicher).
 *
 * Eine Position geht immer mit der Zeit **ihrer** Messung raus, nie eine alte mit neuer Zeit: das
 * Lebenszeichen fordert eine frische Messung an ([lebenszeichen]); kommt keine, geht nichts raus
 * und die Karte zeigt die Position ehrlich als veraltet.
 */
class Sendeplan(private val takt: Takt = Takt()) {
    private val puffer = Puffer()
    private val wiederholung = Wiederholung()

    /** Zuletzt angenommene Sendung und wann sie ankam. */
    private var gesendet: Position? = null
    private var gesendetUm: Instant? = null

    /** Wann das Lebenszeichen eine frische Messung angefordert hat; `null` ohne Anforderung. */
    private var angefordertUm: Instant? = null

    /** Die Position, deren Antwort aussteht. */
    private var unterwegs: Position? = null

    /** Zeitpunkt des nächsten Versuchs nach einem Fehler; `null` ohne Fehler. */
    var naechsterVersuch: Instant? = null
        private set

    /**
     * Eine neue Messung des Systems. Eine, die nicht neuer ist als die zuletzt angenommene, geht
     * nicht noch einmal raus (das System liefert auf eine Anforderung auch eine zwischengespeicherte).
     */
    fun messung(p: Position, jetzt: Instant): Position? {
        val bisher = gesendet
        if (bisher != null && !p.recordedAt.isAfter(bisher.recordedAt)) return null
        angefordertUm = null
        val seit = gesendetUm?.let { sekunden(it, jetzt) } ?: Double.POSITIVE_INFINITY
        val bewegt = gesendet?.let { abstandM(it, p) } ?: Double.POSITIVE_INFINITY
        if (!takt.soll(seit, bewegt)) return null
        puffer.merke(p)
        return faellige(jetzt)
    }

    /**
     * Die halbminütliche Prüfung des Dienstes: `true` heißt „fordere jetzt **eine** frische Messung
     * an“ (ohne Bewegung liefert das System sonst keine). [Takt.lebenszeichenS] nach der letzten
     * angenommenen Sendung; eine Anforderung gilt [LEBENSZEICHEN_FRIST_S] Sekunden, erst danach
     * kommt die nächste. Die Messung geht über [messung] mit ihrer eigenen Zeit raus.
     */
    fun lebenszeichen(jetzt: Instant): Boolean {
        val um = gesendetUm ?: return false
        if (unterwegs != null || sekunden(um, jetzt) < takt.lebenszeichenS) return false
        angefordertUm?.let { if (sekunden(it, jetzt) < LEBENSZEICHEN_FRIST_S) return false }
        angefordertUm = jetzt
        return true
    }

    /** Der geplante Versuch nach einem Fehler ist dran (oder noch nicht: dann `null`). */
    fun versuch(jetzt: Instant): Position? {
        val geplant = naechsterVersuch ?: return faellige(jetzt)
        if (geplant.isAfter(jetzt)) return null
        naechsterVersuch = null
        return faellige(jetzt)
    }

    /**
     * Antwort des Servers ([entscheide]) auf die laufende Sendung. Kam währenddessen eine neuere
     * Position, geht sie jetzt raus; nach [Antwort.WIEDERHOLEN] erst zum [naechsterVersuch].
     */
    fun antwort(antwort: Antwort, jetzt: Instant): Position? {
        val p = unterwegs ?: return null
        unterwegs = null
        when (antwort) {
            Antwort.WEITER, Antwort.WARTEN -> {
                if (antwort == Antwort.WEITER) wiederholung.zuruecksetzen()
                gesendet = p
                gesendetUm = jetzt
                if (puffer.letzte == p) puffer.leere()
            }
            Antwort.VERWERFEN -> if (puffer.letzte == p) puffer.leere()
            Antwort.WIEDERHOLEN -> {
                naechsterVersuch = jetzt.plusSeconds(wiederholung.naechsterAbstandS().toLong())
                return null
            }
            Antwort.STOPPEN, Antwort.RUHEN -> {
                stoppe()
                return null
            }
        }
        return if (puffer.letzte != null) faellige(jetzt) else null
    }

    /** Vergisst alles: Puffer, Sendung, Fehler. */
    fun stoppe() {
        puffer.leere()
        wiederholung.zuruecksetzen()
        gesendet = null
        gesendetUm = null
        angefordertUm = null
        unterwegs = null
        naechsterVersuch = null
    }

    /** Die gepufferte Position, wenn keine Sendung läuft und kein Versuch geplant ist; eine zu alte verfällt. */
    private fun faellige(jetzt: Instant): Position? {
        if (unterwegs != null || naechsterVersuch != null) return null
        val p = puffer.faellig(jetzt)
        if (p == null) {
            puffer.leere()
            return null
        }
        unterwegs = p
        return p
    }

    private fun sekunden(von: Instant, bis: Instant): Double = Duration.between(von, bis).toMillis() / 1000.0

    companion object {
        /** So lange wartet das Lebenszeichen auf die angeforderte Messung. */
        const val LEBENSZEICHEN_FRIST_S = 30.0
    }
}

/** Mittlerer Erdradius in Metern (IUGG). */
private const val ERDRADIUS_M = 6_371_008.8

/** Abstand zweier Positionen in Metern auf der Kugel (Haversine). */
fun abstandM(a: Position, b: Position): Double {
    val phi1 = Math.toRadians(a.latitude)
    val phi2 = Math.toRadians(b.latitude)
    val dPhi = phi2 - phi1
    val dLambda = Math.toRadians(b.longitude - a.longitude)
    val h = sin(dPhi / 2) * sin(dPhi / 2) + cos(phi1) * cos(phi2) * sin(dLambda / 2) * sin(dLambda / 2)
    return 2 * ERDRADIUS_M * asin(min(1.0, sqrt(h)))
}
