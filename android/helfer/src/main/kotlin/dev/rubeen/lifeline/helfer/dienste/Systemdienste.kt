package dev.rubeen.lifeline.helfer.dienste

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import dev.rubeen.lifeline.kern.ServerAdresse

/**
 * Was das Modell vom System braucht: Server, Ablage, Ortung. Im Testzustand und in den Tests gibt
 * es keine (`HelferModell` ohne Dienste: kein Netz, keine Ablage, keine Ortung).
 */
interface Dienste {
    fun verbindung(server: ServerAdresse, cookie: String?): Serververbindung

    fun lesen(): Sitzung?

    fun speichern(sitzung: Sitzung)

    fun loeschen()

    /** Zuletzt genutzter Anzeigename (kein Geheimnis, unverschlüsselt). */
    var anzeigename: String

    /** Ob die Ortung fein oder grob erlaubt ist (nur im Vordergrund, ADR-0098). */
    val isOrtungErlaubt: Boolean

    /** Startet den [OrtungsDienst]; `false`, wenn das System ihn nicht zulässt. */
    fun starteOrtung(einsatz: String, ziel: String): Boolean

    fun stoppeOrtung()
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

    override fun starteOrtung(einsatz: String, ziel: String): Boolean = OrtungsDienst.starte(app, einsatz, ziel)

    override fun stoppeOrtung() = OrtungsDienst.stoppe(app)
}
