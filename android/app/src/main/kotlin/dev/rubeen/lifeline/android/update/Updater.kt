package dev.rubeen.lifeline.android.update

import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageInstaller
import android.util.Log
import androidx.core.content.edit
import dev.rubeen.lifeline.android.BuildConfig
import dev.rubeen.lifeline.android.LifelineApp
import dev.rubeen.lifeline.kern.Installzeitpunkt
import dev.rubeen.lifeline.kern.Kanal
import dev.rubeen.lifeline.kern.Updateentscheidung
import dev.rubeen.lifeline.kern.Updatemanifest
import dev.rubeen.lifeline.kern.Updatestand
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URI
import java.security.MessageDigest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.withContext

/**
 * Updater der Hülle (Entwurf D9): prüft das Manifest `android.json` seines Kanals höchstens alle
 * vier Stunden, lädt eine neuere APK nur von GitHub, prüft ihre `sha256` und übergibt sie dem
 * System, aber nie mitten in der Arbeit. Was neuer ist, woher geladen wird und wann installiert
 * wird, entscheidet der Kern (`Updateentscheidung`, `Installzeitpunkt`); hier stehen Netz, Ablage
 * und `PackageInstaller`. Fehler bleiben im [stand] und stören die Oberfläche nie.
 *
 * Der Kanal steht in `SharedPreferences("lifeline")` unter [KANAL]: beim ersten Start aus der
 * eigenen Version gesetzt und danach nie überschrieben, auch nicht von einem Update auf eine
 * stabile Fassung. Eine geladene APK liegt unter `noBackupFilesDir/update/<version_code>.apk`;
 * Version, Code und Prüfsumme stehen in den Einstellungen, damit ein bereites Update einen
 * Neustart übersteht.
 *
 * @param http lädt Manifest und APK und prüft dabei jede Weiterleitung
 * @param uhr Zeit in Millisekunden seit 1970
 * @param imVordergrund steht die Oberfläche vorn? Eine Installation im Hintergrund fragt es vor `commit`
 */
class Updater internal constructor(
    context: Context,
    private val http: Updateabruf,
    private val uhr: () -> Long,
    private val version: String,
    private val versionCode: Int,
    private val installation: Installation,
    private val imVordergrund: () -> Boolean = { (context.applicationContext as? LifelineApp)?.imVordergrund == true },
) {
    constructor(context: Context, http: Updateabruf = Updateabruf(), uhr: () -> Long = System::currentTimeMillis) : this(
        context.applicationContext,
        http,
        uhr,
        BuildConfig.VERSION_NAME,
        BuildConfig.VERSION_CODE,
        Installation(context.applicationContext),
    )

    private val context: Context = context.applicationContext
    private val einstellungen: SharedPreferences = this.context.getSharedPreferences(EINSTELLUNGEN, Context.MODE_PRIVATE)
    private val ordner = File(this.context.noBackupFilesDir, "update")
    private val pruefung = Mutex()

    /** Kanal dieser Installation; `null`: keine Updates. */
    val kanal: Kanal?

    private val aktuellerStand: MutableStateFlow<Updatestand>
    val stand: StateFlow<Updatestand>

    init {
        if (!einstellungen.contains(KANAL)) {
            Kanal.fromVersion(version)?.let { einstellungen.edit { putString(KANAL, it.kennwort) } }
        }
        kanal = Kanal.fromKennwort(einstellungen.getString(KANAL, null))
        // Nach einem Update ist das bereite Update installiert (oder älter als die laufende Fassung).
        val bereit = bereit()
        if (bereit != null && bereit.code <= versionCode) verwirf()
        aktuellerStand = MutableStateFlow(if (kanal != null && bereit() != null) bereitStand() else Updatestand.KEINS)
        stand = aktuellerStand.asStateFlow()
    }

    /** Ein geprüftes Update liegt bereit (auch wenn Erlaubnis oder Gerät die Installation noch sperren). */
    val isBereit: Boolean
        get() = kanal != null && bereit() != null

    /**
     * Prüft das Manifest des Kanals und lädt ein neueres Update. Ohne [erzwingen] nur, wenn die
     * letzte Prüfung vier Stunden zurückliegt (`Updateentscheidung.isFaellig`). „Jetzt prüfen“
     * erzwingt und hebt auch eine gemerkte Sperre des Geräts auf, damit die Person es erneut
     * versuchen kann. Läuft schon eine Prüfung oder eine Installation, bleibt alles, wie es ist.
     */
    suspend fun pruefen(erzwingen: Boolean = false): Updatestand {
        val kanal = kanal ?: return Updatestand.KEINS.also { aktuellerStand.value = it }
        if (!pruefung.tryLock()) return stand.value
        try {
            if (stand.value == Updatestand.INSTALLIERT_GLEICH) return stand.value
            val jetzt = uhr()
            val letzte = einstellungen.getLong(LETZTE_PRUEFUNG, -1).takeIf { it >= 0 }
            if (!erzwingen && !Updateentscheidung.isFaellig(letzte, jetzt)) return stand.value
            einstellungen.edit {
                putLong(LETZTE_PRUEFUNG, jetzt)
                if (erzwingen) remove(BLOCKIERT)
            }
            aktuellerStand.value = try {
                withContext(Dispatchers.IO) { suche(kanal) }
            } catch (e: Exception) {
                Log.w(TAG, "Updateprüfung fehlgeschlagen", e)
                // Ein schon geprüftes Update bleibt bereit, auch wenn das Netz gerade fehlt.
                if (bereit() != null) bereitStand() else Updatestand.FEHLER
            }
            return stand.value
        } finally {
            pruefung.unlock()
        }
    }

    private fun suche(kanal: Kanal): Updatestand {
        // Ein leerer Kanal (`Updateentscheidung.isKanalLeer`) ist kein Fehler; ein schon geprüftes
        // Update bleibt bereit.
        val text = http.text(kanal.manifestUrl) ?: return if (bereit() != null) bereitStand() else Updatestand.KEINS
        val manifest = Updatemanifest.parse(text) ?: throw IOException("android.json ist kein Manifest")
        if (!Updateentscheidung.isNeuer(version, versionCode, manifest)) {
            verwirf()
            return Updatestand.KEINS
        }
        if (!Updateentscheidung.isSha256(manifest.sha256)) throw IOException("Manifest ohne gültige sha256")
        if (!Updateentscheidung.isErlaubterDownload(manifest.url)) throw IOException("APK nicht von GitHub: ${manifest.url}")
        val sha = manifest.sha256.lowercase()
        val vorhanden = bereit()
        if (vorhanden != null && vorhanden.code == manifest.versionCode && vorhanden.sha == sha) return bereitStand()

        aktuellerStand.value = Updatestand.LAEDT
        ordner.mkdirs()
        val teil = File(ordner, "${manifest.versionCode}.apk.teil")
        try {
            val geladen = http.laden(manifest.url, teil)
            if (geladen != sha) throw IOException("sha256 der APK passt nicht zum Manifest")
            val apk = File(ordner, "${manifest.versionCode}.apk")
            ordner.listFiles()?.filter { it != teil }?.forEach { it.delete() }
            if (!teil.renameTo(apk)) throw IOException("APK ließ sich nicht ablegen")
        } catch (e: Exception) {
            teil.delete()
            throw e
        }
        einstellungen.edit {
            putString(BEREIT_VERSION, manifest.version)
            putInt(BEREIT_CODE, manifest.versionCode)
            putString(BEREIT_SHA, sha)
            remove(BLOCKIERT)
        }
        return bereitStand()
    }

    /**
     * Installiert ein bereites Update, wenn `Installzeitpunkt` es in der [lage] erlaubt; sonst
     * bleibt es beim Hinweis. [imHintergrundSeit]: seit wann die App im Hintergrund liegt.
     * Fehlt die Erlaubnis oder sperrt das Gerät, versucht der Updater es nicht still.
     */
    suspend fun installieren(lage: Installzeitpunkt.Lage, imHintergrundSeit: Long? = null): Installzeitpunkt.Weg {
        if (!isBereit) return Installzeitpunkt.Weg.WARTEN
        if (stand.value == Updatestand.INSTALLIERT_GLEICH) return Installzeitpunkt.Weg.WARTEN
        val sperre = bereitStand()
        if (sperre != Updatestand.BEREIT) {
            aktuellerStand.value = sperre
            return Installzeitpunkt.Weg.HINWEIS
        }
        val weg = Installzeitpunkt.decide(lage, imHintergrundSeit, uhr(), installation.brauchtRueckfrage())
        when (weg) {
            Installzeitpunkt.Weg.INSTALLIEREN -> starte(vordergrund = lage != Installzeitpunkt.Lage.HINTERGRUND)
            Installzeitpunkt.Weg.HINWEIS -> aktuellerStand.value = Updatestand.BEREIT
            Installzeitpunkt.Weg.WARTEN -> Unit
        }
        return weg
    }

    /** Die Person hat „Jetzt installieren“ gewählt (der Hinweis aus `Installzeitpunkt`). */
    suspend fun installierenAufWunsch() {
        if (!isBereit || stand.value == Updatestand.INSTALLIERT_GLEICH) return
        val sperre = bereitStand()
        if (sperre != Updatestand.BEREIT) {
            aktuellerStand.value = sperre
            return
        }
        starte(vordergrund = true)
    }

    private suspend fun starte(vordergrund: Boolean) {
        val bereit = bereit() ?: return
        aktuellerStand.value = Updatestand.INSTALLIERT_GLEICH
        try {
            // Im Hintergrund nur, solange die Oberfläche nicht wieder vorn steht (Review K1).
            val uebergeben = withContext(Dispatchers.IO) {
                installation.start(bereit.datei, vordergrund) { vordergrund || !imVordergrund() }
            }
            if (!uebergeben) aktuellerStand.value = bereitStand()
        } catch (e: Exception) {
            Log.w(TAG, "Installation ließ sich nicht starten", e)
            aktuellerStand.value = Updatestand.FEHLER
        }
    }

    /**
     * Die App gibt eine Installation auf, auf die kein Ergebnis kam (`Startinstallation` im Kern):
     * die übergebene Sitzung wird verworfen, damit das System nicht später unter der laufenden
     * Oberfläche installiert (Review W7); das Update bleibt bereit, der Hinweis bleibt. Kommt das
     * Ergebnis doch noch (das System installierte schon), gilt es.
     */
    fun abandonInstallation() {
        if (stand.value != Updatestand.INSTALLIERT_GLEICH) return
        installation.abandon()
        aktuellerStand.value = bereitStand()
    }

    /** Nach der Rückkehr aus der Systemeinstellung: hat die Person die Erlaubnis erteilt? */
    fun aktualisiereStand() {
        if (!isBereit) return
        when (stand.value) {
            Updatestand.BEREIT, Updatestand.ERLAUBNIS_FEHLT -> aktuellerStand.value = bereitStand()
            else -> Unit
        }
    }

    /**
     * Antwort des Systems auf eine Installation ([Installationsstatus]). Braucht das System eine
     * Bestätigung, zeigt die App sie nur, wenn sie im Vordergrund installiert hat; im Hintergrund
     * bleibt es beim Hinweis.
     */
    internal fun installationsstatus(status: Int, vordergrund: Boolean, bestaetigung: Intent?, meldung: String?) {
        when (status) {
            PackageInstaller.STATUS_PENDING_USER_ACTION ->
                if (vordergrund && bestaetigung != null) {
                    try {
                        context.startActivity(bestaetigung.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    } catch (e: Exception) {
                        Log.w(TAG, "Bestätigung der Installation ließ sich nicht zeigen", e)
                        aktuellerStand.value = Updatestand.BEREIT
                    }
                } else {
                    aktuellerStand.value = Updatestand.BEREIT
                }
            PackageInstaller.STATUS_SUCCESS -> {
                verwirf()
                aktuellerStand.value = Updatestand.KEINS
            }
            PackageInstaller.STATUS_FAILURE_BLOCKED -> {
                bereit()?.let { einstellungen.edit { putInt(BLOCKIERT, it.code) } }
                aktuellerStand.value = Updatestand.BLOCKIERT
            }
            // Die Person hat die Bestätigung abgelehnt: das Update bleibt bereit.
            PackageInstaller.STATUS_FAILURE_ABORTED -> aktuellerStand.value = bereitStand()
            else -> {
                // Kaputte, unpassende oder nicht ablegbare APK: neu laden bei der nächsten Prüfung.
                Log.w(TAG, "Installation fehlgeschlagen ($status): $meldung")
                verwirf()
                aktuellerStand.value = Updatestand.FEHLER
            }
        }
    }

    /** Stand eines bereiten Updates: Sperre des Geräts und fehlende Erlaubnis gehen vor. */
    private fun bereitStand(): Updatestand {
        val bereit = bereit() ?: return Updatestand.KEINS
        return when {
            einstellungen.getInt(BLOCKIERT, -1) == bereit.code -> Updatestand.BLOCKIERT
            !installation.isErlaubt -> Updatestand.ERLAUBNIS_FEHLT
            else -> Updatestand.BEREIT
        }
    }

    private data class Bereit(val code: Int, val sha: String, val datei: File)

    private fun bereit(): Bereit? {
        val code = einstellungen.getInt(BEREIT_CODE, -1).takeIf { it >= 0 } ?: return null
        val sha = einstellungen.getString(BEREIT_SHA, null) ?: return null
        val datei = File(ordner, "$code.apk")
        return if (datei.isFile) Bereit(code, sha, datei) else null
    }

    /** Vergisst das bereite Update und räumt die Ablage. */
    private fun verwirf() {
        einstellungen.edit {
            remove(BEREIT_VERSION)
            remove(BEREIT_CODE)
            remove(BEREIT_SHA)
            remove(BLOCKIERT)
        }
        ordner.listFiles()?.forEach { it.delete() }
    }

    companion object {
        private const val TAG = "Lifeline"
        const val EINSTELLUNGEN = "lifeline"

        /** Kennwort des Kanals (`alpha`, `beta`, `stabil`). */
        const val KANAL = "kanal"
        const val LETZTE_PRUEFUNG = "update_letzte_pruefung"
        const val BEREIT_VERSION = "update_version"
        const val BEREIT_CODE = "update_code"
        const val BEREIT_SHA = "update_sha256"

        /** `version_code` eines Updates, dessen Installation das Gerät gesperrt hat. */
        const val BLOCKIERT = "update_blockiert"
    }
}

/**
 * Lädt Manifest und APK über `HttpURLConnection` (wie [dev.rubeen.lifeline.android.web.Vertragsabruf]).
 * Weiterleitungen folgt der Abruf selbst, höchstens [MAX_WEITERLEITUNGEN], und jede Stufe muss
 * `Updateentscheidung.isErlaubterDownload` bestehen: GitHub leitet Release-Dateien auf seine
 * Download-Hosts weiter, alles andere wird nicht angefragt.
 *
 * @param verbinden Adresse, unter der die Verbindung tatsächlich aufgebaut wird; die App nimmt die
 *   geprüfte Adresse selbst, nur die Tests leiten auf ihren `http`-Testserver um
 */
class Updateabruf internal constructor(private val verbinden: (URI) -> URI) {
    constructor() : this({ it })

    /** Text des Manifests, höchstens [MAX_MANIFEST] Bytes; `null`, wenn der Kanal keins trägt. */
    fun text(url: String): String? = oeffne(url)?.let { verbindung ->
        try {
            val puffer = ByteArrayOutputStream()
            verbindung.inputStream.use { ein -> kopiere(ein, puffer::write, MAX_MANIFEST.toLong(), pruefsumme = null) }
            puffer.toString(Charsets.UTF_8.name())
        } finally {
            verbindung.disconnect()
        }
    }

    /** Lädt nach [ziel] und gibt die `sha256` des Geladenen (klein, hex) zurück. */
    fun laden(url: String, ziel: File): String = (oeffne(url) ?: throw IOException("APK fehlt: $url")).let { verbindung ->
        try {
            val pruefsumme = MessageDigest.getInstance("SHA-256")
            verbindung.inputStream.use { ein -> ziel.outputStream().use { aus -> kopiere(ein, aus::write, MAX_APK, pruefsumme) } }
            pruefsumme.digest().joinToString("") { "%02x".format(it) }
        } finally {
            verbindung.disconnect()
        }
    }

    /** Kopiert höchstens [grenze] Bytes; mehr ist kein Manifest und keine APK der Hülle. */
    private fun kopiere(ein: InputStream, schreibe: (ByteArray, Int, Int) -> Unit, grenze: Long, pruefsumme: MessageDigest?) {
        val block = ByteArray(64 * 1024)
        var gesamt = 0L
        while (true) {
            val gelesen = ein.read(block)
            if (gelesen < 0) return
            gesamt += gelesen
            if (gesamt > grenze) throw IOException("Antwort größer als $grenze Bytes")
            pruefsumme?.update(block, 0, gelesen)
            schreibe(block, 0, gelesen)
        }
    }

    /** `null`: die Adresse antwortet mit `Updateentscheidung.isKanalLeer`. */
    private fun oeffne(url: String): HttpURLConnection? {
        var ziel = url
        repeat(MAX_WEITERLEITUNGEN + 1) {
            if (!Updateentscheidung.isErlaubterDownload(ziel)) throw IOException("Adresse nicht erlaubt: $ziel")
            val verbindung = verbinden(URI(ziel)).toURL().openConnection() as HttpURLConnection
            verbindung.instanceFollowRedirects = false
            verbindung.connectTimeout = ZEITLIMIT_MS
            verbindung.readTimeout = ZEITLIMIT_MS
            verbindung.useCaches = false
            val status = try {
                verbindung.responseCode
            } catch (e: IOException) {
                verbindung.disconnect()
                throw e
            }
            when (status) {
                in 200..299 -> return verbindung
                in 300..399 -> {
                    val ort = verbindung.getHeaderField("Location")
                    verbindung.disconnect()
                    ziel = URI(ziel).resolve(ort ?: throw IOException("Weiterleitung ohne Ziel")).toString()
                }
                else -> {
                    verbindung.disconnect()
                    if (Updateentscheidung.isKanalLeer(status)) return null
                    throw IOException("HTTP $status für $ziel")
                }
            }
        }
        throw IOException("Zu viele Weiterleitungen")
    }

    private companion object {
        const val ZEITLIMIT_MS = 30_000
        const val MAX_WEITERLEITUNGEN = 5
        const val MAX_MANIFEST = 64 * 1024
        const val MAX_APK = 512L * 1024 * 1024
    }
}
