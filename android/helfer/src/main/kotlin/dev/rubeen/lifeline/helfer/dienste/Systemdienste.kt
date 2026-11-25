package dev.rubeen.lifeline.helfer.dienste

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import dev.rubeen.lifeline.helferkern.HelperTask
import dev.rubeen.lifeline.kern.ServerAdresse

/**
 * Was das Modell vom System braucht: Server, Ablage, Ortung und Empfang (Helfer-Dienst),
 * Mitteilungen. Im Testzustand und in den Tests gibt es keine (`HelferModell` ohne Dienste: kein
 * Netz, keine Ablage, keine Ortung, kein Empfang).
 */
interface Dienste {
    fun verbindung(server: ServerAdresse, cookie: String?): Serververbindung

    fun lesen(): Sitzung?

    fun speichern(sitzung: Sitzung)

    fun loeschen()

    /** Zuletzt genutzter Anzeigename (kein Geheimnis, unverschlüsselt). */
    var anzeigename: String

    /** Ob die Ortung fein oder grob erlaubt ist (nur im Vordergrund, ADR-0101). */
    val isOrtungErlaubt: Boolean

    /** Ob Mitteilungen ankommen (ab Android 13 `POST_NOTIFICATIONS`, dazu der Schalter der App). */
    val isMitteilungErlaubt: Boolean

    /**
     * Startet den Helfer-Dienst ([OrtungsDienst]) oder gibt ihm eine neue Vorgabe; `false`, wenn
     * das System ihn nicht zulässt.
     */
    fun starteDienst(vorgabe: Dienstvorgabe): Boolean

    /** Beendet Ortung und Empfang. */
    fun stoppeDienst()

    /** Eine frisch geladene Auftragsliste übernehmen ([Auftragsstand.uebernimm], mit Mitteilungen). */
    fun uebernimmAuftraege(liste: List<HelperTask>)

    /** Ein quittierter Auftrag vom Server ersetzt den alten. */
    fun ersetzeAuftrag(auftrag: HelperTask)

    /** Mitteilung zu einem Auftrag weg (geöffnet oder erledigt). */
    fun entferneMitteilung(auftragId: Long)
}

/** Die Dienste des Systems; hält nur den Context der Anwendung. */
class Systemdienste(context: Context) : Dienste {
    private val app = context.applicationContext
    private val ablage = Sitzungsablage(app)
    private val einstellungen = app.getSharedPreferences("helfer", Context.MODE_PRIVATE)
    private val kennung = OrtungsDienst.kennung(app)

    override fun verbindung(server: ServerAdresse, cookie: String?) = Serververbindung(server, cookie, kennung)

    override fun lesen(): Sitzung? = ablage.lesen()

    override fun speichern(sitzung: Sitzung) = ablage.speichern(sitzung)

    override fun loeschen() = ablage.loeschen()

    override var anzeigename: String
        get() = einstellungen.getString("anzeigename", null).orEmpty()
        set(wert) {
            einstellungen.edit().putString("anzeigename", wert).apply()
        }

    override val isOrtungErlaubt: Boolean
        get() = listOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
            .any { app.checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED }

    override val isMitteilungErlaubt: Boolean
        get() = Mitteilungen.isErlaubt(app)

    override fun starteDienst(vorgabe: Dienstvorgabe): Boolean = OrtungsDienst.starte(app, vorgabe)

    override fun stoppeDienst() {
        OrtungsDienst.stoppe(app)
        Mitteilungen.entferneAlle(app, Auftragsstand.liste.value)
    }

    override fun uebernimmAuftraege(liste: List<HelperTask>) = Auftragsstand.uebernimm(app, liste)

    override fun ersetzeAuftrag(auftrag: HelperTask) = Auftragsstand.ersetze(app, auftrag)

    override fun entferneMitteilung(auftragId: Long) = Mitteilungen.entferne(app, auftragId)
}
