package httpapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/openclaw/clickclack/apps/api/internal/realtime"
	"github.com/openclaw/clickclack/apps/api/internal/store"
	"github.com/openclaw/clickclack/apps/api/internal/store/storetest"
)

type galleryTransport func(*http.Request) (*http.Response, error)

func (f galleryTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestGallerySubmitPayloadPreservesEmptyValues(t *testing.T) {
	payload, err := galleryRequestPayload("submit", galleryInput{RequestID: "request", SchemaRevision: 1, Values: map[string]any{}})
	if err != nil {
		t.Fatal(err)
	}
	var decoded map[string]any
	if err = json.Unmarshal(payload, &decoded); err != nil {
		t.Fatal(err)
	}
	values, ok := decoded["values"].(map[string]any)
	if !ok || len(values) != 0 {
		t.Fatalf("empty submit values were not preserved: %s", payload)
	}
}

func TestGalleryHostSyntheticFlow(t *testing.T) {
	for _, backend := range []string{"sqlite", "postgres"} {
		t.Run(backend, func(t *testing.T) {
			ctx := context.Background()
			sessionID := fmt.Sprintf("%d.test-session-unique", time.Now().Unix())
			expiresID := fmt.Sprintf("%d.expires-session-unique", time.Now().Unix())
			st := workflowAPIStore(t, backend)
			owner, e := st.EnsureBootstrap(ctx, "Owner", "gallery@example.com")
			if e != nil {
				t.Fatal(e)
			}
			ws, e := st.ListWorkspaces(ctx, owner.ID)
			if e != nil {
				t.Fatal(e)
			}
			workspace := ws[0].ID
			channels, e := st.ListChannels(ctx, workspace, owner.ID)
			if e != nil {
				t.Fatal(e)
			}
			destination := channels[0].ID
			bot, token, e := st.CreateBot(ctx, store.CreateBotInput{WorkspaceID: workspace, OwnerUserID: owner.ID, CreatedBy: owner.ID, DisplayName: "Synthetic photo lab", Scopes: []string{"bot:read", "bot:write", store.GalleryActionsWriteScope}})
			if e != nil {
				t.Fatal(e)
			}
			if e = st.AddWorkspaceMember(ctx, workspace, bot.ID, "bot"); e != nil {
				t.Fatal(e)
			}
			app, e := st.CreateAppInstallation(ctx, store.CreateAppInstallationInput{WorkspaceID: workspace, BotUserID: bot.ID, AppSlug: "synthetic-lab", CreatedBy: owner.ID})
			if e != nil {
				t.Fatal(e)
			}
			sub, e := st.CreateEventSubscription(ctx, store.CreateEventSubscriptionInput{WorkspaceID: workspace, AppInstallationID: app.ID, CallbackURL: "https://synthetic.example/callback", EventTypes: []string{"gallery_action.open", "gallery_action.choices", "gallery_action.submit"}, CreatedBy: owner.ID})
			if e != nil {
				t.Fatal(e)
			}
			upload, e := storetest.CreateUpload(ctx, st, store.CreateUploadInput{WorkspaceID: workspace, OwnerID: owner.ID, Filename: "fixture.png", ContentType: "image/png", ByteSize: 1, StoragePath: "synthetic"})
			if e != nil {
				t.Fatal(e)
			}
			if _, _, e = st.CreateMessage(ctx, store.CreateMessageInput{ChannelID: destination, AuthorID: owner.ID, Body: "fixture", UploadID: upload.ID}); e != nil {
				t.Fatal(e)
			}
			server := New(st, realtime.NewHub(), Options{})
			handler := server.Handler()
			call := func(method, path, credential string, body any) *httptest.ResponseRecorder {
				var raw []byte
				if text, ok := body.(string); ok {
					raw = []byte(text)
				} else if body != nil {
					raw, _ = json.Marshal(body)
				}
				r := httptest.NewRequest(method, path, strings.NewReader(string(raw)))
				r.RemoteAddr = "127.0.0.1:1234"
				r.Host = "localhost"
				r.Header.Set("Content-Type", "application/json")
				if credential == owner.ID {
					r.Header.Set("X-ClickClack-User", credential)
				} else if credential != "" {
					r.Header.Set("Authorization", "Bearer "+credential)
				}
				w := httptest.NewRecorder()
				handler.ServeHTTP(w, r)
				return w
			}
			require := func(w *httptest.ResponseRecorder, codes ...int) {
				t.Helper()
				for _, code := range codes {
					if w.Code == code {
						return
					}
				}
				t.Fatalf("status %d: %s; expected %v", w.Code, w.Body.String(), codes)
			}
			descriptor := map[string]any{"version": 1, "id": "synthetic.adjust", "label": "Adjust image", "accepted_media_types": []string{"image/png"}, "schema_revision": 1, "fields": []any{map[string]any{"id": "amount", "kind": "number", "label": "Amount", "min": 0, "max": 10, "step": 0.5, "default": 1}, map[string]any{"id": "confirm", "kind": "boolean", "label": "Confirm"}, map[string]any{"id": "format", "kind": "select", "label": "Format", "choices": []any{map[string]any{"id": "png", "label": "PNG"}}}, map[string]any{"id": "images", "kind": "images", "label": "Reference images", "min": 0, "max": 2, "dynamic": true, "choices": []any{}}}}
			registration := map[string]any{"installation_id": app.ID, "gallery_actions": []any{descriptor}}
			require(call("PUT", "/api/bots/self/gallery-actions", owner.ID, registration), 403)
			require(call("PUT", "/api/bots/self/gallery-actions", token.Token, registration), 200)
			require(call("PUT", "/api/bots/self/gallery-actions", token.Token, `{"installation_id":"x","gallery_actions":null}`), 400)
			descriptor["callback_url"] = "https://evil.example"
			require(call("PUT", "/api/bots/self/gallery-actions", token.Token, registration), 400)
			delete(descriptor, "callback_url")
			list := call("GET", "/api/workspaces/"+workspace+"/gallery-actions?source_upload_id="+upload.ID+"&destination_id="+destination, owner.ID, nil)
			require(list, 200)
			if !strings.Contains(list.Body.String(), "synthetic.adjust") || strings.Contains(list.Body.String(), sub.SigningSecret) {
				t.Fatal("bad discovery", list.Body.String())
			}
			open := map[string]any{"session_id": sessionID, "installation_id": app.ID, "action_id": "synthetic.adjust", "source_upload_id": upload.ID, "destination_id": destination}
			path := "/api/workspaces/" + workspace + "/gallery-actions/open"
			open["destination_id"] = "unavailable"
			require(call("POST", path, owner.ID, open), 403)
			open["destination_id"] = destination
			privateUpload, err := storetest.CreateUpload(ctx, st, store.CreateUploadInput{WorkspaceID: workspace, OwnerID: owner.ID, Filename: "private.png", ContentType: "image/png", ByteSize: 1, StoragePath: "private-synthetic"})
			if err != nil {
				t.Fatal(err)
			}
			open["source_upload_id"] = privateUpload.ID
			require(call("POST", path, owner.ID, open), 403)
			open["source_upload_id"] = upload.ID
			require(call("POST", path, owner.ID, open), 202)
			require(call("POST", path, owner.ID, open), 200)
			require(call("POST", "/api/bots/self/gallery-actions/requests/"+sessionID+".open/response", token.Token, map[string]any{"session_id": sessionID, "schema_revision": 1, "state": "accepted", "preview_upload_id": privateUpload.ID}), 403)
			executions := map[string]bool{}
			deliveries := 0
			lost := true
			server.callbackClient = &http.Client{Transport: galleryTransport(func(r *http.Request) (*http.Response, error) {
				payload, e := io.ReadAll(r.Body)
				if e != nil {
					return nil, e
				}
				if r.Header.Get("X-ClickClack-Signature") != signSlashCallback(sub.SigningSecret, r.Header.Get("X-ClickClack-Timestamp"), payload) {
					t.Error("signature mismatch")
				}
				var event map[string]any
				if e = json.Unmarshal(payload, &event); e != nil {
					return nil, e
				}
				deliveries++
				id := event["request_id"].(string)
				reply := map[string]any{"session_id": sessionID, "schema_revision": 1, "state": "accepted"}
				if event["type"] == "gallery_action.choices" {
					reply["choices"] = []any{map[string]any{"id": "reference", "label": "Reference", "upload_id": upload.ID}}
				}
				if event["type"] == "gallery_action.submit" {
					executions[id] = true
					if lost {
						lost = false
						return nil, errors.New("simulated lost acknowledgement after effect")
					}
				}
				require(call("POST", "/api/bots/self/gallery-actions/requests/"+id+"/response", token.Token, reply), 200)
				return &http.Response{StatusCode: 204, Body: io.NopCloser(strings.NewReader("")), Header: http.Header{}}, nil
			})}
			if e = server.DispatchGallery(ctx); e != nil {
				t.Fatal(e)
			}
			require(call("POST", "/api/gallery-actions/sessions/"+sessionID+"/choices", owner.ID, map[string]any{"request_id": "choices-1", "schema_revision": 1, "field_id": "images", "offset": 0, "limit": 25}), 202)
			if e = server.DispatchGallery(ctx); e != nil {
				t.Fatal(e)
			}
			values := map[string]any{"amount": 1.5, "confirm": true, "format": "png", "images": []string{"reference"}}
			input := map[string]any{"request_id": "submission-1", "schema_revision": 1, "values": values}
			values["amount"] = 1.25
			require(call("POST", "/api/gallery-actions/sessions/"+sessionID+"/submit", owner.ID, input), 400)
			values["amount"] = 1.5
			var wg sync.WaitGroup
			results := make(chan *httptest.ResponseRecorder, 8)
			for i := 0; i < 8; i++ {
				wg.Add(1)
				go func() {
					defer wg.Done()
					results <- call("POST", "/api/gallery-actions/sessions/"+sessionID+"/submit", owner.ID, input)
				}()
			}
			wg.Wait()
			close(results)
			for w := range results {
				require(w, 200, 202)
			}
			values["amount"] = 2.0
			require(call("POST", "/api/gallery-actions/sessions/"+sessionID+"/submit", owner.ID, input), 409)
			values["amount"] = 1.5
			input["request_id"] = "submission-2"
			require(call("POST", "/api/gallery-actions/sessions/"+sessionID+"/submit", owner.ID, input), 409)
			input["request_id"] = "submission-1"
			if e = server.DispatchGallery(ctx); e != nil {
				t.Fatal(e)
			}
			status := call("GET", "/api/gallery-actions/sessions/"+sessionID+"", owner.ID, nil)
			require(status, 200)
			if !strings.Contains(status.Body.String(), `"state":"uncertain"`) {
				t.Fatal(status.Body.String())
			}
			// Recreate the server to prove dispatch state is not process-owned. Expire
			// the test lease without a wall-clock sleep, then deliver the same identity.
			next := New(st, realtime.NewHub(), Options{callbackClient: server.callbackClient})
			handler = next.Handler()
			if _, e = st.ClaimGalleryRequest(ctx, "submission-1", time.Now().Add(time.Hour).Unix(), 0); e != nil {
				t.Fatal(e)
			}
			if e = next.DispatchGallery(ctx); e != nil {
				t.Fatal(e)
			}
			if len(executions) != 1 || deliveries != 4 {
				t.Fatalf("effects %d deliveries %d", len(executions), deliveries)
			}
			status = call("GET", "/api/gallery-actions/sessions/"+sessionID+"", owner.ID, nil)
			require(status, 200)
			if !strings.Contains(status.Body.String(), `"state":"accepted"`) {
				t.Fatal(status.Body.String())
			}
			reply := map[string]any{"session_id": "wrong-session", "schema_revision": 1, "state": "accepted"}
			require(call("POST", "/api/bots/self/gallery-actions/requests/submission-1/response", token.Token, reply), 409)
			reply["session_id"] = sessionID
			reply["preview_upload_id"] = "missing"
			require(call("POST", "/api/bots/self/gallery-actions/requests/submission-1/response", token.Token, reply), 409)
			// Producer token isolation and media authorization apply at reply time.
			other, otherToken, err := st.CreateBot(ctx, store.CreateBotInput{WorkspaceID: workspace, OwnerUserID: owner.ID, CreatedBy: owner.ID, DisplayName: "Other synthetic", Scopes: []string{"bot:read", store.GalleryActionsWriteScope}})
			if err != nil {
				t.Fatal(err)
			}
			if err = st.AddWorkspaceMember(ctx, workspace, other.ID, "bot"); err != nil {
				t.Fatal(err)
			}
			require(call("PUT", "/api/bots/self/gallery-actions", otherToken.Token, registration), 403)
			require(call("POST", "/api/bots/self/gallery-actions/requests/submission-1/response", otherToken.Token, map[string]any{"session_id": sessionID, "schema_revision": 1, "state": "accepted"}), 403)
			open["session_id"] = expiresID
			require(call("POST", path, owner.ID, open), 202)
			expired, err := st.GetGallerySession(ctx, expiresID)
			if err != nil {
				t.Fatal(err)
			}
			expired.ExpiresAt = time.Now().Unix() - 1
			if err = st.SaveGallery(ctx, expired, nil, false); err != nil {
				t.Fatal(err)
			}
			require(call("GET", "/api/gallery-actions/sessions/"+expiresID+"", owner.ID, nil), 410)
			require(call("POST", "/api/bots/self/gallery-actions/requests/"+expiresID+".open/response", token.Token, map[string]any{"session_id": expiresID, "schema_revision": 1, "state": "accepted"}), 410)

			// Simulate an aged submitted session, then clean through the real
			// dispatcher. An identical old open must never recreate execution.
			retired := expired
			retired.ID = fmt.Sprintf("%d.retired-session-unique", time.Now().Unix()-90000)
			retired.ExpiresAt = time.Now().Unix() - store.GalleryRetentionSeconds - 1
			retired.SubmissionID = "retired-submission"
			retired.Version = 0
			oldRequest := store.GalleryRequest{ID: retired.ID + ".open", SessionID: retired.ID, Kind: "open", State: "accepted", Payload: []byte(`{}`)}
			if err = st.SaveGallery(ctx, retired, &oldRequest, true); err != nil {
				t.Fatal(err)
			}
			if err = next.DispatchGallery(ctx); err != nil {
				t.Fatal(err)
			}
			if _, err = st.GetGallerySession(ctx, retired.ID); !errors.Is(err, sql.ErrNoRows) {
				t.Fatalf("retired session survived cleanup: %v", err)
			}
			for _, identity := range []string{retired.ID, "legacy-opaque-session", fmt.Sprintf("%d.future-session-unique", time.Now().Unix()+120)} {
				open["session_id"] = identity
				require(call("POST", path, owner.ID, open), 410)
				if _, err = st.GetGallerySession(ctx, identity); !errors.Is(err, sql.ErrNoRows) {
					t.Fatalf("invalid identity reopened: %v", err)
				}
			}
			if deliveries != 4 {
				t.Fatalf("cleanup replay delivered callbacks: %d", deliveries)
			}
			// Capability replacement invalidates all prior sessions, even with the same
			// schema number; delayed replies cannot revive them.
			require(call("PUT", "/api/bots/self/gallery-actions", token.Token, registration), 200)
			require(call("GET", "/api/gallery-actions/sessions/"+sessionID+"", owner.ID, nil), 410)
			require(call("POST", "/api/bots/self/gallery-actions/requests/submission-1/response", token.Token, map[string]any{"session_id": sessionID, "schema_revision": 1, "state": "accepted"}), 410)
		})
	}
}

func TestGalleryLifecycleRevocation(t *testing.T) {
	for _, backend := range []string{"sqlite", "postgres"} {
		for _, lifecycle := range []string{"token", "installation", "subscription", "membership", "actor-block", "source", "destination"} {
			t.Run(backend+"/"+lifecycle, func(t *testing.T) {
				ctx := context.Background()
				sessionID := fmt.Sprintf("%d.test-session-unique", time.Now().Unix())

				st := workflowAPIStore(t, backend)
				owner, e := st.EnsureBootstrap(ctx, "Owner", "gallery@example.com")
				if e != nil {
					t.Fatal(e)
				}
				ws, e := st.ListWorkspaces(ctx, owner.ID)
				if e != nil {
					t.Fatal(e)
				}
				workspace := ws[0].ID
				channels, e := st.ListChannels(ctx, workspace, owner.ID)
				if e != nil {
					t.Fatal(e)
				}
				destination := channels[0].ID
				bot, token, e := st.CreateBot(ctx, store.CreateBotInput{WorkspaceID: workspace, OwnerUserID: owner.ID, CreatedBy: owner.ID, DisplayName: "Synthetic photo lab", Scopes: []string{"bot:read", "bot:write", store.GalleryActionsWriteScope}})
				if e != nil {
					t.Fatal(e)
				}
				if e = st.AddWorkspaceMember(ctx, workspace, bot.ID, "bot"); e != nil {
					t.Fatal(e)
				}
				app, e := st.CreateAppInstallation(ctx, store.CreateAppInstallationInput{WorkspaceID: workspace, BotUserID: bot.ID, AppSlug: "synthetic-lab", CreatedBy: owner.ID})
				if e != nil {
					t.Fatal(e)
				}
				sub, e := st.CreateEventSubscription(ctx, store.CreateEventSubscriptionInput{WorkspaceID: workspace, AppInstallationID: app.ID, CallbackURL: "https://synthetic.example/callback", EventTypes: []string{"gallery_action.open", "gallery_action.choices", "gallery_action.submit"}, CreatedBy: owner.ID})
				if e != nil {
					t.Fatal(e)
				}
				upload, e := storetest.CreateUpload(ctx, st, store.CreateUploadInput{WorkspaceID: workspace, OwnerID: owner.ID, Filename: "fixture.png", ContentType: "image/png", ByteSize: 1, StoragePath: "synthetic"})
				if e != nil {
					t.Fatal(e)
				}
				sourceMessage, _, e := st.CreateMessage(ctx, store.CreateMessageInput{ChannelID: destination, AuthorID: owner.ID, Body: "fixture", UploadID: upload.ID})
				if e != nil {
					t.Fatal(e)
				}
				server := New(st, realtime.NewHub(), Options{})
				handler := server.Handler()
				call := func(method, path, credential string, body any) *httptest.ResponseRecorder {
					var raw []byte
					if text, ok := body.(string); ok {
						raw = []byte(text)
					} else if body != nil {
						raw, _ = json.Marshal(body)
					}
					r := httptest.NewRequest(method, path, strings.NewReader(string(raw)))
					r.RemoteAddr = "127.0.0.1:1234"
					r.Host = "localhost"
					r.Header.Set("Content-Type", "application/json")
					if credential == owner.ID {
						r.Header.Set("X-ClickClack-User", credential)
					} else if credential != "" {
						r.Header.Set("Authorization", "Bearer "+credential)
					}
					w := httptest.NewRecorder()
					handler.ServeHTTP(w, r)
					return w
				}
				require := func(w *httptest.ResponseRecorder, codes ...int) {
					t.Helper()
					for _, code := range codes {
						if w.Code == code {
							return
						}
					}
					t.Fatalf("status %d: %s; expected %v", w.Code, w.Body.String(), codes)
				}

				descriptor := map[string]any{"version": 1, "id": "synthetic.adjust", "label": "Adjust", "accepted_media_types": []string{"image/png"}, "schema_revision": 1, "fields": []any{}}
				require(call("PUT", "/api/bots/self/gallery-actions", token.Token, map[string]any{"installation_id": app.ID, "gallery_actions": []any{descriptor}}), 200)
				actor, err := st.CreateUser(ctx, store.CreateUserInput{DisplayName: "Actor", Email: "actor@example.com"})
				if err != nil {
					t.Fatal(err)
				}
				if err = st.AddWorkspaceMember(ctx, workspace, actor.ID, "member"); err != nil {
					t.Fatal(err)
				}
				// Switch the dev-auth actor while retaining the original owner for lifecycle mutations.
				admin := owner
				owner = actor
				discovery := "/api/workspaces/" + workspace + "/gallery-actions?source_upload_id=" + upload.ID + "&destination_id=" + destination
				require(call("GET", discovery, actor.ID, nil), 200)
				open := map[string]any{"session_id": sessionID, "installation_id": app.ID, "action_id": "synthetic.adjust", "source_upload_id": upload.ID, "destination_id": destination}
				require(call("POST", "/api/workspaces/"+workspace+"/gallery-actions/open", actor.ID, open), 202)
				deliveries := 0
				server.callbackClient = &http.Client{Transport: galleryTransport(func(r *http.Request) (*http.Response, error) {
					deliveries++
					return nil, errors.New("unexpected delivery")
				})}
				yes := true
				switch lifecycle {
				case "token":
					_, err = st.RevokeBotToken(ctx, token.ID, admin.ID)
				case "installation":
					_, err = st.RevokeAppInstallation(ctx, app.ID, admin.ID, store.RevokeAppInstallationOptions{})
				case "subscription":
					_, err = st.RevokeEventSubscription(ctx, sub.ID, admin.ID)
				case "membership":
					err = st.RemoveBotFromWorkspace(ctx, workspace, bot.ID, admin.ID)
				case "actor-block":
					_, _, err = st.UpdateMemberModeration(ctx, store.UpdateMemberModerationInput{WorkspaceID: workspace, TargetUserID: actor.ID, ActorUserID: admin.ID, Blocked: &yes})
				case "source":
					_, _, err = st.DeleteMessage(ctx, store.DeleteMessageInput{MessageID: sourceMessage.ID, UserID: admin.ID})
				case "destination":
					_, _, err = st.UpdateChannel(ctx, store.UpdateChannelInput{ChannelID: destination, UserID: admin.ID, Archived: &yes})
				}
				if err != nil {
					t.Fatal(err)
				}
				listed := call("GET", discovery, actor.ID, nil)
				if listed.Code < 400 && strings.Contains(listed.Body.String(), "synthetic.adjust") {
					t.Fatal("revoked action still discoverable")
				}
				require(call("GET", "/api/gallery-actions/sessions/"+sessionID, actor.ID, nil), 401, 403, 404, 410)
				require(call("POST", "/api/bots/self/gallery-actions/requests/"+sessionID+".open/response", token.Token, map[string]any{"session_id": sessionID, "schema_revision": 1, "state": "accepted"}), 401, 403, 404, 410)
				if err = server.DispatchGallery(ctx); err != nil {
					t.Fatal(err)
				}
				if deliveries != 0 {
					t.Fatalf("delivered %d revoked callbacks", deliveries)
				}
			})
		}
	}
}
