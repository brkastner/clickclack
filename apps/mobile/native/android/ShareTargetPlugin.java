// Installed into the generated Android project by
// apps/mobile/scripts/configure-native.mjs, which substitutes __PACKAGE__.
// Edit this file, not the copy under apps/mobile/android: that one is
// generated and is overwritten on the next sync.
//
// Why this exists: the web app is loaded from a real server origin, not from
// the app bundle, so it cannot read a content:// URI the share sheet hands us
// and it cannot fetch Capacitor's own _capacitor_file_ route either —
// WebViewLocalServer sends no Access-Control-Allow-Origin header, so that
// route is cross-origin and blocked. Shared bytes therefore have to travel
// across the JS bridge.
//
// They travel in chunks. The server accepts uploads up to 64 MiB, and
// base64-ing a file that size into a single bridge message would be an ~85 MB
// string; reading it in bounded pieces keeps memory flat and imposes no limit
// the browser upload path does not already have.
//
// The shared payload is copied into cache first. The URI permission the share
// sheet grants is scoped to the receiving activity and can be revoked as soon
// as the sender goes away, so reading it lazily while someone picks a channel
// would be reading a handle that may already be dead.
package __PACKAGE__;

import android.content.ClipData;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.OpenableColumns;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicLong;

@CapacitorPlugin(name = "ShareTarget")
public class ShareTargetPlugin extends Plugin {

    /** The event the web app listens for. */
    private static final String SHARE_EVENT = "shareReceived";

    /**
     * Bounds one share, matching the composer's own ceiling in
     * apps/web/src/lib/attachments.ts. The web layer enforces it too; this stops
     * a hostile or broken sender making the app copy an unbounded list first.
     */
    private static final int MAX_ITEMS = 50;

    /**
     * The largest chunk a single bridge message will carry, before base64
     * inflates it by a third. Large enough that a photo takes few round trips,
     * small enough that no single message is a memory spike.
     */
    private static final int MAX_CHUNK_BYTES = 1024 * 1024;

    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final AtomicLong shareCounter = new AtomicLong();

    /** The share waiting to be claimed, or null. Only ever touched on the main thread. */
    private volatile PendingShare pending;

    @Override
    public void load() {
        // BridgeActivity.load() replays the launch intent through onNewIntent
        // once the bridge exists, so a cold start and a warm share arrive by the
        // same path and there is no second place to keep in step.
        cleanCache();
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (intent == null) return;
        String action = intent.getAction();
        if (!Intent.ACTION_SEND.equals(action) && !Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            return;
        }
        String text = intent.getStringExtra(Intent.EXTRA_TEXT);
        String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
        List<Uri> uris = streamsOf(intent);
        // Consuming the intent stops a configuration change from replaying the
        // same share: onNewIntent is called again with the activity's intent.
        intent.setAction(Intent.ACTION_MAIN);
        intent.removeExtra(Intent.EXTRA_TEXT);
        intent.removeExtra(Intent.EXTRA_STREAM);
        worker.execute(() -> ingest(text, subject, uris));
    }

    /** Collect the shared streams, single or multiple, in the order they were sent. */
    private static List<Uri> streamsOf(Intent intent) {
        List<Uri> uris = new ArrayList<>();
        if (Intent.ACTION_SEND_MULTIPLE.equals(intent.getAction())) {
            List<Uri> extras = parcelableStreams(intent);
            if (extras != null) {
                for (Uri uri : extras) {
                    if (uri != null) uris.add(uri);
                }
            }
        } else {
            Uri single = parcelableStream(intent);
            if (single != null) uris.add(single);
        }
        if (uris.isEmpty()) {
            // Some senders describe the payload only through ClipData.
            ClipData clip = intent.getClipData();
            for (int i = 0; clip != null && i < clip.getItemCount(); i++) {
                Uri uri = clip.getItemAt(i).getUri();
                if (uri != null) uris.add(uri);
            }
        }
        return uris.size() > MAX_ITEMS ? uris.subList(0, MAX_ITEMS) : uris;
    }

    @SuppressWarnings("deprecation")
    private static Uri parcelableStream(Intent intent) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class);
        }
        return intent.getParcelableExtra(Intent.EXTRA_STREAM);
    }

    @SuppressWarnings("deprecation")
    private static List<Uri> parcelableStreams(Intent intent) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri.class);
        }
        return intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
    }

    /** Copy every shared stream into cache, then announce the result. */
    private void ingest(String text, String subject, List<Uri> uris) {
        String shareID = "share-" + shareCounter.incrementAndGet();
        File directory = new File(shareCache(), shareID);
        List<SharedItem> items = new ArrayList<>();
        for (int index = 0; index < uris.size(); index++) {
            SharedItem item = copy(uris.get(index), directory, index);
            if (item != null) items.add(item);
        }
        PendingShare share = new PendingShare(shareID, text, subject, items);
        pending = share;
        // Retained, because a cold start delivers the share before the web app
        // has loaded far enough to add a listener.
        getBridge()
            .getActivity()
            .runOnUiThread(() -> notifyListeners(SHARE_EVENT, share.describe(), true));
    }

    private SharedItem copy(Uri uri, File directory, int index) {
        ContentResolver resolver = getContext().getContentResolver();
        String name = displayName(resolver, uri);
        String mimeType = resolver.getType(uri);
        if (!directory.exists() && !directory.mkdirs()) return null;
        File target = new File(directory, index + "-" + safeName(name));
        try (InputStream in = resolver.openInputStream(uri)) {
            if (in == null) return null;
            try (OutputStream out = Files.newOutputStream(target.toPath())) {
                byte[] buffer = new byte[MAX_CHUNK_BYTES];
                int read;
                while ((read = in.read(buffer)) != -1) {
                    out.write(buffer, 0, read);
                }
            }
        } catch (IOException | SecurityException error) {
            // A revoked grant or a sender that lied about the stream. Skipping
            // the item is better than failing the whole share.
            target.delete();
            return null;
        }
        return new SharedItem(String.valueOf(index), name, mimeType, target);
    }

    private static String displayName(ContentResolver resolver, Uri uri) {
        if (ContentResolver.SCHEME_CONTENT.equals(uri.getScheme())) {
            try (Cursor cursor = resolver.query(uri, null, null, null, null)) {
                if (cursor != null && cursor.moveToFirst()) {
                    int column = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                    if (column >= 0 && !cursor.isNull(column)) {
                        String name = cursor.getString(column);
                        if (name != null && !name.isEmpty()) return name;
                    }
                }
            } catch (RuntimeException error) {
                // Providers are free to refuse the query; fall through to the path.
            }
        }
        String path = uri.getLastPathSegment();
        return path == null || path.isEmpty() ? "shared" : path;
    }

    /**
     * Reduce a sender-supplied name to something that cannot escape the share
     * directory or surprise the file system. The original name still reaches the
     * composer through the payload; this only governs the copy on disk.
     */
    private static String safeName(String name) {
        String cleaned = name.replaceAll("[^A-Za-z0-9._-]", "_");
        if (cleaned.isEmpty() || cleaned.equals(".") || cleaned.equals("..")) return "shared";
        return cleaned.length() > 96 ? cleaned.substring(cleaned.length() - 96) : cleaned;
    }

    @PluginMethod
    public void getPendingShare(PluginCall call) {
        PendingShare share = pending;
        JSObject result = new JSObject();
        result.put("share", share == null ? null : share.describe());
        call.resolve(result);
    }

    /**
     * Read one bounded window of a shared file as base64. The web app walks a
     * file to its end rather than asking for it whole, so neither side ever
     * holds more than a chunk.
     */
    @PluginMethod
    public void readChunk(PluginCall call) {
        PendingShare share = pending;
        String shareID = call.getString("shareId");
        String itemID = call.getString("itemId");
        if (share == null || shareID == null || !share.id.equals(shareID)) {
            call.reject("That share is no longer available");
            return;
        }
        SharedItem item = share.item(itemID);
        if (item == null) {
            call.reject("That shared file is no longer available");
            return;
        }
        long offset = call.getInt("offset", 0).longValue();
        int length = Math.min(call.getInt("length", MAX_CHUNK_BYTES), MAX_CHUNK_BYTES);
        if (offset < 0 || length <= 0) {
            call.reject("Read window is out of range");
            return;
        }
        try (InputStream in = new FileInputStream(item.file)) {
            long skipped = in.skip(offset);
            if (skipped < offset) {
                call.resolve(chunk("", 0, true));
                return;
            }
            byte[] buffer = new byte[length];
            int read = 0;
            while (read < length) {
                int step = in.read(buffer, read, length - read);
                if (step == -1) break;
                read += step;
            }
            byte[] window = read == length ? buffer : java.util.Arrays.copyOf(buffer, Math.max(read, 0));
            String encoded = Base64.encodeToString(window, Base64.NO_WRAP);
            call.resolve(chunk(encoded, window.length, offset + window.length >= item.file.length()));
        } catch (IOException error) {
            call.reject("Could not read the shared file", error);
        }
    }

    private static JSObject chunk(String data, int bytes, boolean done) {
        JSObject result = new JSObject();
        result.put("data", data);
        result.put("bytes", bytes);
        result.put("done", done);
        return result;
    }

    /** Drop a share once the composer holds it, so cache does not accumulate. */
    @PluginMethod
    public void releaseShare(PluginCall call) {
        String shareID = call.getString("shareId");
        PendingShare share = pending;
        if (share != null && share.id.equals(shareID)) {
            pending = null;
            worker.execute(() -> deleteTree(new File(shareCache(), share.id)));
        }
        call.resolve();
    }

    private File shareCache() {
        return new File(getContext().getCacheDir(), "shares");
    }

    /**
     * Clear anything a previous process left behind. A share that was copied but
     * never claimed — the app was killed while someone chose a channel — has no
     * one left to claim it, and its bytes are somebody's photo.
     */
    private void cleanCache() {
        worker.execute(() -> deleteTree(shareCache()));
    }

    private static void deleteTree(File file) {
        if (file == null || !file.exists()) return;
        File[] children = file.listFiles();
        if (children != null) {
            for (File child : children) deleteTree(child);
        }
        file.delete();
    }

    private static final class SharedItem {

        final String id;
        final String name;
        final String mimeType;
        final File file;

        SharedItem(String id, String name, String mimeType, File file) {
            this.id = id;
            this.name = name;
            this.mimeType = mimeType;
            this.file = file;
        }

        JSObject describe() {
            JSObject item = new JSObject();
            item.put("id", id);
            item.put("name", name);
            item.put("mimeType", mimeType == null ? "application/octet-stream" : mimeType.toLowerCase(Locale.ROOT));
            item.put("size", file.length());
            return item;
        }
    }

    private static final class PendingShare {

        final String id;
        final String text;
        final String subject;
        final List<SharedItem> items;

        PendingShare(String id, String text, String subject, List<SharedItem> items) {
            this.id = id;
            this.text = text;
            this.subject = subject;
            this.items = items;
        }

        SharedItem item(String itemID) {
            for (SharedItem item : items) {
                if (item.id.equals(itemID)) return item;
            }
            return null;
        }

        JSObject describe() {
            JSArray described = new JSArray();
            for (SharedItem item : items) described.put(item.describe());
            JSObject share = new JSObject();
            share.put("id", id);
            share.put("text", text == null ? "" : text);
            share.put("subject", subject == null ? "" : subject);
            share.put("items", described);
            return share;
        }
    }
}
