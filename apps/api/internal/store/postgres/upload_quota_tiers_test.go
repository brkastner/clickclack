package postgres

import (
	"context"
	"fmt"
	"testing"

	"github.com/openclaw/clickclack/apps/api/internal/store"
	"github.com/openclaw/clickclack/apps/api/internal/store/storetest"
)

// TestUploadQuotaReleasesAttachedUploads mirrors the SQLite coverage: uploads
// referenced by a live message must leave the orphan tier so a busy poster is
// not permanently blocked once it has sent MaxCount attachments.
func TestUploadQuotaReleasesAttachedUploads(t *testing.T) {
	ctx := context.Background()
	st := newIsolatedPostgresTestStore(t)
	if err := st.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	owner, err := st.EnsureBootstrap(ctx, "Owner", "postgres-attached-quota@example.com")
	if err != nil {
		t.Fatal(err)
	}
	workspaces, err := st.ListWorkspaces(ctx, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	workspace := workspaces[0]
	channels, err := st.ListChannels(ctx, workspace.ID, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	channel := channels[0]

	var lastMessageID string
	for i := range int(store.UploadQuotaCountPerUserWorkspace) + 1 {
		upload, err := storetest.CreateUpload(ctx, st, store.CreateUploadInput{
			WorkspaceID: workspace.ID,
			OwnerID:     owner.ID,
			Filename:    fmt.Sprintf("chart-%d.png", i),
			ContentType: "image/png",
			ByteSize:    1024,
			StoragePath: fmt.Sprintf("/tmp/chart-%d.png", i),
		})
		if err != nil {
			t.Fatalf("upload %d: %v", i, err)
		}
		message, _, err := st.CreateMessage(ctx, store.CreateMessageInput{
			ChannelID:               channel.ID,
			AuthorID:                owner.ID,
			Body:                    "here you go",
			ExpectedAttachmentCount: 1,
		})
		if err != nil {
			t.Fatalf("message %d: %v", i, err)
		}
		if _, err := st.AttachUpload(ctx, store.AttachUploadInput{
			MessageID: message.ID,
			UploadID:  upload.ID,
			UserID:    owner.ID,
		}); err != nil {
			t.Fatalf("attach %d: %v", i, err)
		}
		lastMessageID = message.ID
	}

	quota, err := st.UploadQuota(ctx, workspace.ID, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	if quota.UsedCount != 0 {
		t.Fatalf("expected attached uploads to leave the orphan tier, used %d", quota.UsedCount)
	}
	if want := store.UploadQuotaCountPerUserWorkspace + 1; quota.UsedTotalCount != want {
		t.Fatalf("expected total tier to count every upload, got %d want %d", quota.UsedTotalCount, want)
	}
	if err := quota.CanFit(1024); err != nil {
		t.Fatalf("expected further uploads to be allowed, got %v", err)
	}

	if _, _, err := st.DeleteMessage(ctx, store.DeleteMessageInput{MessageID: lastMessageID, UserID: owner.ID}); err != nil {
		t.Fatal(err)
	}
	quota, err = st.UploadQuota(ctx, workspace.ID, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	if quota.UsedCount != 1 {
		t.Fatalf("expected deleted message to return its upload to the orphan tier, used %d", quota.UsedCount)
	}
}

// TestUploadQuotaExcludesLiveAvatarFromOrphanTier mirrors the SQLite coverage:
// avatars reference their upload by URL, not through message_attachments.
func TestUploadQuotaExcludesLiveAvatarFromOrphanTier(t *testing.T) {
	ctx := context.Background()
	st := newIsolatedPostgresTestStore(t)
	if err := st.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	owner, err := st.EnsureBootstrap(ctx, "Owner", "postgres-avatar-quota@example.com")
	if err != nil {
		t.Fatal(err)
	}
	workspaces, err := st.ListWorkspaces(ctx, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	workspace := workspaces[0]

	avatar, err := storetest.CreateUpload(ctx, st, store.CreateUploadInput{
		WorkspaceID: workspace.ID,
		OwnerID:     owner.ID,
		Filename:    "face.png",
		ContentType: "image/png",
		ByteSize:    2048,
		StoragePath: "/tmp/face.png",
	})
	if err != nil {
		t.Fatal(err)
	}
	quota, err := st.UploadQuota(ctx, workspace.ID, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	if quota.UsedCount != 1 {
		t.Fatalf("expected unreferenced upload to sit in the orphan tier, used %d", quota.UsedCount)
	}

	avatarURL := "/api/uploads/" + avatar.ID
	if _, err := st.UpdateCurrentUser(ctx, store.UpdateCurrentUserInput{
		UserID:    owner.ID,
		AvatarURL: &avatarURL,
	}); err != nil {
		t.Fatal(err)
	}
	quota, err = st.UploadQuota(ctx, workspace.ID, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	if quota.UsedCount != 0 {
		t.Fatalf("expected live avatar to leave the orphan tier, used %d", quota.UsedCount)
	}
	if quota.UsedTotalCount != 1 {
		t.Fatalf("expected total tier to still count the avatar, used %d", quota.UsedTotalCount)
	}
}
