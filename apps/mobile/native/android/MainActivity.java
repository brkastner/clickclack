// Installed into the generated Android project by
// apps/mobile/scripts/configure-native.mjs, which substitutes __PACKAGE__ and
// __ALLOWED_ORIGIN__. Edit this file, not the copy under apps/mobile/android:
// that one is generated and is overwritten on the next sync.
//
// Why this exists: Capacitor decides whether a navigation stays inside the
// privileged web view by comparing the app URL's scheme and host only —
// Bridge.launchIntent does not compare the port. A main-frame navigation from
// https://chat.example.com:8443 to https://chat.example.com:9443 would
// therefore stay in the web view, where the bridge is injected, even though it
// is a different origin and possibly a different service.
//
// Two callbacks are needed to cover that, not one. shouldOverrideUrlLoading is
// documented not to fire for POST requests, and Capacitor's local server only
// proxies GET (WebViewLocalServer.handleProxyRequest returns null for anything
// else, leaving the request to WebView). So a main-frame form POST to another
// port would load its HTML response inside the web view without ever reaching
// the URL-override callback. shouldInterceptRequest is therefore the
// fail-closed boundary, and shouldOverrideUrlLoading additionally hands
// ordinary off-origin link navigations to the system browser.
package __PACKAGE__;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import java.io.ByteArrayInputStream;
import java.util.Collections;

public class MainActivity extends BridgeActivity {

    /** The single origin this app may render, as scheme://host[:port]. */
    private static final String ALLOWED_ORIGIN = "__ALLOWED_ORIGIN__";

    /** Parsed once: shouldInterceptRequest runs for every request. */
    private static final Uri ALLOWED = Uri.parse(ALLOWED_ORIGIN);

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Bridge bridge = getBridge();
        // BridgeActivity.onCreate returns early without a bridge when the
        // device has no usable web view, and then there is nothing to guard.
        if (bridge != null) {
            bridge.setWebViewClient(new OriginBoundWebViewClient(bridge));
        }
    }

    private final class OriginBoundWebViewClient extends BridgeWebViewClient {

        private OriginBoundWebViewClient(Bridge bridge) {
            super(bridge);
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            if (request.isForMainFrame() && !isAllowedOrigin(url)) {
                openExternally(url);
                return true;
            }
            // Same-origin main frames and every subframe keep Capacitor's own
            // policy, which plugins take part in.
            return super.shouldOverrideUrlLoading(view, request);
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            // Fail closed. This catches the document loads that never reach
            // shouldOverrideUrlLoading — a main-frame POST above all — so an
            // off-origin response cannot become the page. The body is refused
            // rather than replayed elsewhere: re-sending it as a browser GET
            // would change a submission's meaning.
            if (request.isForMainFrame() && !isAllowedOrigin(request.getUrl())) {
                return refuse();
            }
            return super.shouldInterceptRequest(view, request);
        }
    }

    private static WebResourceResponse refuse() {
        return new WebResourceResponse(
            "text/plain",
            "utf-8",
            403,
            "Forbidden",
            Collections.emptyMap(),
            new ByteArrayInputStream(new byte[0]));
    }

    private void openExternally(Uri url) {
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, url);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
        } catch (ActivityNotFoundException error) {
            // Nothing on the device can open it; refusing the navigation is
            // still the correct outcome.
        }
    }

    /**
     * True when the URL matches the configured origin including its port. Only
     * that origin is allowed: `errorPath` is not configured, so Capacitor has
     * no error page of its own to load in the main frame, and with a remote
     * server.url its local URL is this same origin.
     */
    private static boolean isAllowedOrigin(Uri url) {
        Uri allowed = ALLOWED;
        String scheme = url.getScheme();
        String host = url.getHost();
        if (scheme == null || host == null) {
            return false;
        }
        return scheme.equalsIgnoreCase(allowed.getScheme())
            && host.equalsIgnoreCase(allowed.getHost())
            && effectivePort(url) == effectivePort(allowed);
    }

    private static int effectivePort(Uri url) {
        int port = url.getPort();
        if (port != -1) {
            return port;
        }
        return "http".equalsIgnoreCase(url.getScheme()) ? 80 : 443;
    }
}
