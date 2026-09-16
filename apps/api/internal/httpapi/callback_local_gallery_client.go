package httpapi

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
)

// newLocalGalleryCallbackHTTPClient is only selected after postEventCallback
// has matched an installed bot and its exact operator-configured endpoint.
func newLocalGalleryCallbackHTTPClient(callbacks map[string]string) *http.Client {
	allowed := make(map[string]struct{}, len(callbacks))
	for _, callbackURL := range callbacks {
		allowed[callbackURL] = struct{}{}
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		if network != "tcp" && network != "tcp4" && network != "tcp6" {
			return nil, fmt.Errorf("local gallery callback network %q is not allowed", network)
		}
		host, port, err := net.SplitHostPort(address)
		if err != nil || host != "127.0.0.1" {
			return nil, errors.New("local gallery callback must dial loopback")
		}
		if _, ok := allowed["http://127.0.0.1:"+port+"/gallery-actions"]; !ok {
			return nil, errors.New("local gallery callback port is not configured")
		}
		return (&net.Dialer{Timeout: callbackTimeout}).DialContext(ctx, network, address)
	}
	return &http.Client{
		Transport:     transport,
		Timeout:       callbackTimeout,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
}
