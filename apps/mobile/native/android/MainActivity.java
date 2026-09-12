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
// is a different origin and possibly a different service. This activity adds
// the missing port comparison for main-frame navigations and hands anything
// outside the configured origin to the system browser.
package __PACKAGE__;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {

    /** The single origin this app may render, as scheme://host[:port]. */
    private static final String ALLOWED_ORIGIN = "__ALLOWED_ORIGIN__";

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

    /** True when the URL matches the configured origin including its port. */
    private static boolean isAllowedOrigin(Uri url) {
        Uri allowed = Uri.parse(ALLOWED_ORIGIN);
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
