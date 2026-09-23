package httpapi

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/openclaw/clickclack/apps/api/internal/realtime"
	"github.com/openclaw/clickclack/apps/api/internal/store"
)

func TestBotRuntimeStatusAPI(t *testing.T) {
	for _, backend := range []string{"sqlite", "postgres"} {
		t.Run(backend, func(t *testing.T) {
			st := workflowAPIStore(t, backend)
			ctx := context.Background()
			owner, err := st.EnsureBootstrap(ctx, "Owner", "runtime-status@example.com")
			if err != nil {
				t.Fatal(err)
			}
			workspaces, err := st.ListWorkspaces(ctx, owner.ID)
			if err != nil {
				t.Fatal(err)
			}
			ws := workspaces[0]
			channels, err := st.ListChannels(ctx, ws.ID, owner.ID)
			if err != nil {
				t.Fatal(err)
			}
			channel := channels[0]
			makeBot := func(scopes []string) (store.User, store.BotToken) {
				bot, token, err := st.CreateBot(ctx, store.CreateBotInput{
					WorkspaceID: ws.ID,
					OwnerUserID: owner.ID,
					CreatedBy:   owner.ID,
					DisplayName: "Runtime Bot",
					Scopes:      scopes,
				})
				if err != nil {
					t.Fatal(err)
				}
				if err := st.AddWorkspaceMember(ctx, ws.ID, bot.ID, store.WorkspaceRoleBot); err != nil {
					t.Fatal(err)
				}
				return bot, token
			}
			bot, token := makeBot([]string{"bot:read", store.AgentActivityWriteScope})
			_, unscoped := makeBot([]string{"bot:read"})
			_, noDM := makeBot([]string{"messages:read", store.AgentActivityWriteScope})

			server := httptest.NewServer(New(st, realtime.NewHub(), Options{UploadDir: t.TempDir()}).Handler())
			defer server.Close()
			channelEndpoint := server.URL + "/api/channels/" + channel.ID + "/bot-runtime-status"
			fast := true
			validBody := map[string]any{
				"workspace_id": ws.ID,
				"status": store.BotRuntimeStatusSnapshot{
					Runtime:       "pi",
					ModelProvider: "openai-codex",
					ModelID:       "gpt-5.6-codex",
					Reasoning:     "high",
					FastMode:      &fast,
				},
			}
			encode := func(body any) string {
				raw, err := json.Marshal(body)
				if err != nil {
					t.Fatal(err)
				}
				return string(raw)
			}

			expectStatusAsUser(t, owner.ID, http.MethodPut, channelEndpoint, strings.NewReader(encode(validBody)), http.StatusForbidden)
			expectStatusWithBearer(t, unscoped.Token, http.MethodPut, channelEndpoint, strings.NewReader(encode(validBody)), http.StatusForbidden)
			expectStatusWithBearer(t, token.Token, http.MethodPut, channelEndpoint, strings.NewReader("{"), http.StatusBadRequest)
			invalid := map[string]any{"workspace_id": ws.ID, "status": store.BotRuntimeStatusSnapshot{Runtime: "unknown"}}
			expectStatusWithBearer(t, token.Token, http.MethodPut, channelEndpoint, strings.NewReader(encode(invalid)), http.StatusBadRequest)
			tooLongWorkspace := map[string]any{"workspace_id": strings.Repeat("w", 257), "status": validBody["status"]}
			expectStatusWithBearer(t, token.Token, http.MethodPut, channelEndpoint, strings.NewReader(encode(tooLongWorkspace)), http.StatusBadRequest)
			wrongWorkspace := map[string]any{"workspace_id": "other", "status": validBody["status"]}
			expectStatusWithBearer(t, token.Token, http.MethodPut, channelEndpoint, strings.NewReader(encode(wrongWorkspace)), http.StatusForbidden)

			published := putRuntimeStatus(t, token.Token, channelEndpoint, encode(validBody))
			if published.Status.BotUserID != bot.ID || published.Status.ChannelID != channel.ID || published.Status.FastMode == nil || !*published.Status.FastMode {
				t.Fatalf("published channel status: %#v", published.Status)
			}
			listed := getRuntimeStatuses(t, owner.ID, channelEndpoint)
			if len(listed.Statuses) != 1 || listed.Statuses[0].BotUserID != bot.ID {
				t.Fatalf("listed channel statuses: %#v", listed.Statuses)
			}
			expectStatusAsUser(t, owner.ID, http.MethodGet, server.URL+"/api/channels/missing/bot-runtime-status", nil, http.StatusBadRequest)

			dm, err := st.CreateDirectConversation(ctx, store.CreateDirectConversationInput{
				WorkspaceID: ws.ID,
				UserID:      owner.ID,
				MemberIDs:   []string{bot.ID},
			})
			if err != nil {
				t.Fatal(err)
			}
			dmEndpoint := server.URL + "/api/dms/" + dm.ID + "/bot-runtime-status"
			expectStatusWithBearer(t, noDM.Token, http.MethodPut, dmEndpoint, strings.NewReader(encode(validBody)), http.StatusForbidden)
			expectStatusWithBearer(t, noDM.Token, http.MethodGet, dmEndpoint, nil, http.StatusForbidden)
			expectStatusWithBearer(t, token.Token, http.MethodPut, server.URL+"/api/dms/missing/bot-runtime-status", strings.NewReader(encode(validBody)), http.StatusForbidden)
			expectStatusAsUser(t, owner.ID, http.MethodGet, server.URL+"/api/dms/missing/bot-runtime-status", nil, http.StatusBadRequest)
			direct := putRuntimeStatus(t, token.Token, dmEndpoint, encode(validBody))
			if direct.Status.DirectConversationID != dm.ID || direct.Status.ChannelID != "" {
				t.Fatalf("published DM status: %#v", direct.Status)
			}
			directList := getRuntimeStatuses(t, owner.ID, dmEndpoint)
			if len(directList.Statuses) != 1 || directList.Statuses[0].DirectConversationID != dm.ID {
				t.Fatalf("listed DM statuses: %#v", directList.Statuses)
			}
		})
	}
}

type runtimeStatusResponse struct {
	Status store.BotRuntimeStatus `json:"status"`
}

type runtimeStatusListResponse struct {
	Statuses []store.BotRuntimeStatus `json:"statuses"`
}

func putRuntimeStatus(t *testing.T, token, endpoint, body string) runtimeStatusResponse {
	t.Helper()
	req, err := http.NewRequest(http.MethodPut, endpoint, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		payload, _ := io.ReadAll(res.Body)
		t.Fatalf("PUT %s: got %s %s", endpoint, res.Status, payload)
	}
	var result runtimeStatusResponse
	if err := json.NewDecoder(res.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	return result
}

func getRuntimeStatuses(t *testing.T, userID, endpoint string) runtimeStatusListResponse {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, endpoint, nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("X-ClickClack-User", userID)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		payload, _ := io.ReadAll(res.Body)
		t.Fatalf("GET %s: got %s %s", endpoint, res.Status, payload)
	}
	var result runtimeStatusListResponse
	if err := json.NewDecoder(res.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	return result
}
