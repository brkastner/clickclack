package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/openclaw/clickclack/apps/api/internal/realtime"
	"github.com/openclaw/clickclack/apps/api/internal/store"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestOutputsHTTP(t *testing.T) {
	ctx := context.Background()
	st := newEmptyHTTPStore(t)
	owner, err := st.EnsureBootstrap(ctx, "Output owner", "http-outputs@example.com")
	if err != nil {
		t.Fatal(err)
	}
	workspaces, err := st.ListWorkspaces(ctx, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	ws := workspaces[0].ID
	channels, err := st.ListChannels(ctx, ws, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	bot, _, err := st.CreateBot(ctx, store.CreateBotInput{WorkspaceID: ws, DisplayName: "VAI", CreatedBy: owner.ID})
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 3; i++ {
		if _, _, err := st.CreateMessage(ctx, store.CreateMessageInput{ChannelID: channels[0].ID, AuthorID: bot.ID, Body: "response"}); err != nil {
			t.Fatal(err)
		}
	}
	if _, _, err := st.CreateMessage(ctx, store.CreateMessageInput{ChannelID: channels[0].ID, AuthorID: owner.ID, Body: "my output"}); err != nil {
		t.Fatal(err)
	}
	outsider, err := st.CreateUser(ctx, store.CreateUserInput{DisplayName: "Outside", Email: "output-outsider@example.com"})
	if err != nil {
		t.Fatal(err)
	}
	handler := New(st, realtime.NewHub(), Options{}).Handler()
	request := func(user, query string) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(http.MethodGet, "/api/workspaces/"+ws+"/outputs"+query, nil)
		r.RemoteAddr = "127.0.0.1:1234"
		if user != "" {
			r.Host = "localhost"
		}
		if user != "" {
			r.Header.Set("X-ClickClack-User", user)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	base := "?author_id=" + bot.ID + "&limit=2"
	for _, tc := range []struct {
		name, user, query string
		status            int
	}{
		{"anonymous", "", base, 401}, {"nonmember", outsider.ID, base, 404}, {"missing author", owner.ID, "", 400}, {"human source", owner.ID, "?author_id=" + owner.ID, 400},
		{"zero limit", owner.ID, "?author_id=" + bot.ID + "&limit=0", 400}, {"negative limit", owner.ID, "?author_id=" + bot.ID + "&limit=-1", 400},
		{"bad cursor", owner.ID, base + "&cursor=not-a-cursor", 400},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w := request(tc.user, tc.query)
			if w.Code != tc.status {
				t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
			}
		})
	}
	w := request(owner.ID, base)
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	var page store.OutputPage
	if err := json.Unmarshal(w.Body.Bytes(), &page); err != nil {
		t.Fatal(err)
	}
	if len(page.Outputs) != 2 || page.NextCursor == nil {
		t.Fatalf("bad page: %#v", page)
	}
	if w.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("outputs must not be cached")
	}
	own := request(owner.ID, "?author_id="+bot.ID+"&limit=10&include_own=true")
	if own.Code != 200 {
		t.Fatal(own.Body.String())
	}
	var ownPage store.OutputPage
	if err := json.Unmarshal(own.Body.Bytes(), &ownPage); err != nil || len(ownPage.Outputs) != 4 {
		t.Fatalf("include-own query did not add requester output: %#v %v", ownPage, err)
	}
	w = request(owner.ID, base+"&cursor="+url.QueryEscape(*page.NextCursor))
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	if err := json.Unmarshal(w.Body.Bytes(), &page); err != nil {
		t.Fatal(err)
	}
	if len(page.Outputs) != 1 || page.NextCursor != nil {
		t.Fatalf("bad final page: %#v", page)
	}
	handler = New(outputFailureStore{Store: st}, realtime.NewHub(), Options{}).Handler()
	w = request(owner.ID, base)
	if w.Code != 500 || strings.Contains(w.Body.String(), "sensitive database detail") {
		t.Fatalf("unsafe server error: %d %s", w.Code, w.Body.String())
	}

}

type outputFailureStore struct{ store.Store }

func (outputFailureStore) ListOutputPage(context.Context, store.OutputPageRequest) (store.OutputPage, error) {
	return store.OutputPage{}, errors.New("sensitive database detail")
}
