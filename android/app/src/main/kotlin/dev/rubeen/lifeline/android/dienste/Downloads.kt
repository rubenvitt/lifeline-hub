package dev.rubeen.lifeline.android.dienste

import android.app.Activity
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.util.Log
import android.webkit.MimeTypeMap
import android.webkit.URLUtil
import android.webkit.WebView
import android.widget.Toast
import androidx.core.content.FileProvider
import dev.rubeen.lifeline.android.web.uri
import dev.rubeen.lifeline.kern.Downloadablage
import dev.rubeen.lifeline.kern.Linkregeln
import dev.rubeen.lifeline.kern.ServerAdresse
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.URI
import java.util.UUID
import kotlin.coroutines.CoroutineContext
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Ein Download, wie ihn der WebView meldet.
 *
 * @param server Adresse des aktiven Servers; nur an seine Origin geht [cookie]
 * @param cookie die Cookies des Profils für [ziel], `null` für eine fremde Origin
 */
data class Downloadanfrage(
    val ziel: URI,
    val server: URI,
    val cookie: String?,
    val contentDisposition: String?,
    val mimetype: String?,
)

/** Legt eine Datei unter einem Vorschlag ab: (Vorschlag, Schreiber) → Datei. */
typealias Ablegen = (String, (OutputStream) -> Unit) -> File

/**
 * Downloads (Entwurf D8; wie `Downloads` in `ios/App/Webview.swift`): Dateirouten des Servers und
 * Antworten ohne Darstellung lädt die App mit der Sitzung des Profils, `blob:`-Downloads bringt
 * die Brücke als Bytes ([saveDownload]). Jede Datei liegt in einem eigenen Verzeichnis unter
 * `cacheDir/downloads/` und wird über das Teilen-Blatt angeboten. Den Namen bereinigt
 * `Downloadablage` im Kern.
 *
 * @param cookie Cookies des Profils eines WebViews für eine Adresse (`WebviewFabrik.cookie`)
 */
class Downloads internal constructor(
    private val context: Context,
    private val scope: CoroutineScope,
    private val aktiverServer: () -> ServerAdresse?,
    private val cookie: (WebView, String) -> String?,
    private val io: CoroutineContext,
    private val laden: suspend (Downloadanfrage, Ablegen) -> Pair<File, String?>,
) {
    constructor(
        context: Context,
        scope: CoroutineScope,
        aktiverServer: () -> ServerAdresse?,
        cookie: (WebView, String) -> String?,
    ) : this(context, scope, aktiverServer, cookie, Dispatchers.IO, ::abrufen)

    /**
     * Ein Download aus dem WebView (`DownloadListener` oder eine Dateiroute der Linkweiche). Nur,
     * solange der WebView eine Seite des aktiven Servers zeigt, und nur über `http(s)`; die
     * Sitzung bekommt nur die Origin des Servers. Im Hauptfaden aufrufen.
     */
    fun herunterladen(view: WebView, url: String, contentDisposition: String?, mimetype: String?) {
        val server = aktiverServer()?.let { uri(it.text) } ?: return
        val seite = view.url?.let(::uri)
        if (seite == null || !Linkregeln.belongsToServer(server, seite)) {
            Log.w(TAG, "Download verworfen: der WebView zeigt keine Seite des Servers")
            return
        }
        val ziel = uri(url) ?: return
        if (ziel.scheme?.lowercase() !in setOf("http", "https")) return
        // Das Profil des WebViews kennt nur der Hauptfaden.
        val sitzung = if (Linkregeln.belongsToServer(server, ziel)) cookie(view, url) else null
        val anfrage = Downloadanfrage(ziel, server, sitzung, contentDisposition, mimetype)
        scope.launch {
            try {
                val (datei, typ) = withContext(io) { laden(anfrage, ::ablegen) }
                teilen(datei, typ)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.e(TAG, "Download gescheitert: ${e.message}", e)
                Toast.makeText(context, FEHLGESCHLAGEN, Toast.LENGTH_LONG).show()
            }
        }
    }

    /** Ein `blob:`-Download der Seite (Brücke `download_blob`): ablegen und teilen. */
    suspend fun saveDownload(name: String, bytes: ByteArray) {
        val datei = withContext(io) { ablegen(name) { it.write(bytes) } }
        teilen(datei, null)
    }

    /**
     * Neue Datei in einem eigenen Verzeichnis `cacheDir/downloads/<uuid>/` mit dem bereinigten
     * Namen; was älter als [AUFBEWAHRUNG_MS] ist, räumt sie vorher weg.
     */
    internal fun ablegen(vorschlag: String, schreiben: (OutputStream) -> Unit): File {
        val basis = File(context.cacheDir, VERZEICHNIS)
        aufraeumen(basis)
        val ordner = File(basis, UUID.randomUUID().toString())
        if (!ordner.mkdirs()) throw IOException("Das Download-Verzeichnis ließ sich nicht anlegen.")
        val datei = File(ordner, Downloadablage.dateiname(vorschlag))
        try {
            datei.outputStream().use(schreiben)
        } catch (e: IOException) {
            ordner.deleteRecursively()
            throw e
        }
        return datei
    }

    /** Geteilte Dateien liest die Ziel-App erst später; weg kommen sie nach einem Tag. */
    private fun aufraeumen(basis: File) {
        val grenze = System.currentTimeMillis() - AUFBEWAHRUNG_MS
        basis.listFiles()?.filter { it.lastModified() < grenze }?.forEach { it.deleteRecursively() }
    }

    /** Teilen-Blatt des Systems mit Leserecht auf genau diese Datei (`FileProvider`). */
    private fun teilen(datei: File, mimetype: String?) {
        val adresse = FileProvider.getUriForFile(context, "${context.packageName}$AUTORITAET", datei)
        val typ = mimetype?.substringBefore(';')?.trim()?.takeIf { it.isNotEmpty() }
            ?: MimeTypeMap.getSingleton().getMimeTypeFromExtension(datei.extension.lowercase())
            ?: "application/octet-stream"
        val senden = Intent(Intent.ACTION_SEND)
            .setType(typ)
            .putExtra(Intent.EXTRA_STREAM, adresse)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        senden.clipData = ClipData.newRawUri(datei.name, adresse)
        val auswahl = Intent.createChooser(senden, datei.name)
        if (context !is Activity) auswahl.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(auswahl)
    }

    companion object {
        private const val TAG = "Lifeline"
        private const val VERZEICHNIS = "downloads"

        /** Suffix der Autorität des `FileProvider` (Manifest: `${applicationId}.dateien`). */
        private const val AUTORITAET = ".dateien"
        private const val FEHLGESCHLAGEN = "Der Download ist fehlgeschlagen."
        private const val MAX_UMLEITUNGEN = 5

        /** Wie lange abgelegte Downloads bleiben (ein Tag). */
        const val AUFBEWAHRUNG_MS = 24 * 60 * 60 * 1000L

        /**
         * Lädt [anfrage] und legt die Antwort ab; (Datei, Typ der Antwort). Umleitungen folgt es
         * selbst, damit die Sitzung nur an die Origin des Servers geht. Wirft bei einer
         * Fehlerantwort oder einer Antwort über [grenze] Bytes, ohne etwas abzulegen.
         */
        internal suspend fun abrufen(
            anfrage: Downloadanfrage,
            ablegen: Ablegen,
            grenze: Long = Downloadablage.MAX_BYTES,
        ): Pair<File, String?> {
            var adresse = anfrage.ziel
            repeat(MAX_UMLEITUNGEN + 1) {
                val verbindung = adresse.toURL().openConnection() as HttpURLConnection
                try {
                    verbindung.instanceFollowRedirects = false
                    verbindung.useCaches = false
                    verbindung.connectTimeout = 15_000
                    verbindung.readTimeout = 30_000
                    if (anfrage.cookie != null && Linkregeln.belongsToServer(anfrage.server, adresse)) {
                        verbindung.setRequestProperty("Cookie", anfrage.cookie)
                    }
                    val status = verbindung.responseCode
                    val umleitung = verbindung.getHeaderField("Location")
                    if (status in 300..399 && umleitung != null) {
                        adresse = adresse.resolve(umleitung)
                        if (adresse.scheme?.lowercase() !in setOf("http", "https")) throw IOException("Umleitung auf $adresse")
                        return@repeat
                    }
                    if (status !in 200..299) throw IOException("HTTP $status")
                    val typ = verbindung.contentType ?: anfrage.mimetype
                    val disposition = verbindung.getHeaderField("Content-Disposition") ?: anfrage.contentDisposition
                    // Ohne Parameter (`; charset=…`), sonst verwirft `guessFileName` die Endung.
                    val name = URLUtil.guessFileName(adresse.toString(), disposition, typ?.substringBefore(';')?.trim())
                    val datei = verbindung.inputStream.use { eingang -> ablegen(name) { kopiere(eingang, it, grenze) } }
                    return datei to typ
                } finally {
                    verbindung.disconnect()
                }
            }
            throw IOException("Zu viele Umleitungen")
        }

        /** Kopiert höchstens [grenze] Bytes; eine Antwort ohne Ende füllt nicht den Speicher (Review K5). */
        private fun kopiere(ein: InputStream, aus: OutputStream, grenze: Long) {
            val block = ByteArray(64 * 1024)
            var gesamt = 0L
            while (true) {
                val gelesen = ein.read(block)
                if (gelesen < 0) return
                gesamt += gelesen
                if (gesamt > grenze) throw IOException("Download größer als $grenze Bytes")
                aus.write(block, 0, gelesen)
            }
        }
    }
}
