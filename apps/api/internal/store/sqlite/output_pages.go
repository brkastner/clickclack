package sqlite

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/openclaw/clickclack/apps/api/internal/store"
	"github.com/openclaw/clickclack/apps/api/internal/store/sqlite/storedb"
)

// ListOutputPage returns ordinary messages from one workspace bot. It deliberately
// does not use FTS: outputs may be attachment-only and are ordered chronologically.
func (s *Store) ListOutputPage(ctx context.Context, page store.OutputPageRequest) (store.OutputPage, error) {
	req, err := store.NormalizeOutputPageRequest(page)
	if err != nil {
		return store.OutputPage{}, err
	}
	createdAt, messageID, err := store.DecodeOutputCursor(req.Cursor, req)
	if err != nil {
		return store.OutputPage{}, err
	}
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return store.OutputPage{}, err
	}
	defer tx.Rollback()
	role, err := memberRoleTx(ctx, tx, req.WorkspaceID, req.UserID)
	if err != nil {
		return store.OutputPage{}, err
	}
	q := storedb.New(tx)
	if _, err := q.GetOutputBot(ctx, storedb.GetOutputBotParams{AuthorID: req.AuthorID, WorkspaceID: req.WorkspaceID}); err != nil {
		if err == sql.ErrNoRows {
			return store.OutputPage{}, fmt.Errorf("%w: author is not an active workspace bot", store.ErrInvalidOutputPage)
		}
		return store.OutputPage{}, err
	}
	guest := int64(0)
	if role == store.WorkspaceRoleGuest {
		guest = 1
	}
	rows, err := q.ListOutputMessages(ctx, storedb.ListOutputMessagesParams{
		WorkspaceID: req.WorkspaceID, AuthorID: req.AuthorID, UserID: req.UserID,
		Guest: guest, CursorTime: createdAt, CursorID: messageID, PageLimit: int64(req.Limit + 1),
	})
	if err != nil {
		return store.OutputPage{}, err
	}
	messages := make([]store.Message, 0, len(rows))
	for _, row := range rows {
		timestamp, err := store.NormalizeOutputTimestamp(row.CreatedAt)
		if err != nil {
			return store.OutputPage{}, err
		}
		author := store.User{
			ID:             row.AuthorID,
			Kind:           "bot",
			OwnerUserID:    row.AuthorOwnerID.String,
			DisplayName:    row.AuthorDisplayName,
			Handle:         row.AuthorHandle,
			AvatarURL:      row.AuthorAvatarUrl,
			AvatarURLLight: row.AuthorAvatarUrlLight,
			CreatedAt:      row.AuthorCreatedAt,
		}
		message := store.Message{
			ID:                   row.ID,
			RouteID:              row.RouteID.String,
			WorkspaceID:          row.WorkspaceID,
			ChannelID:            row.ChannelID.String,
			DirectConversationID: row.DirectConversationID.String,
			AuthorID:             row.AuthorID,
			Author:               &author,
			ParentMessageID:      ptrFromNull(row.ParentMessageID),
			ThreadRootID:         row.ThreadRootID,
			TopicID:              row.TopicID.String,
			Body:                 row.Body,
			BodyFormat:           row.BodyFormat,
			CreatedAt:            timestamp,
			EditedAt:             ptrFromNull(row.EditedAt),
			Kind:                 "message",
			TurnID:               row.TurnID.String,
			QuotedMessageID:      ptrFromNull(row.QuotedMessageID),
			QuotedBodySnapshot:   row.QuotedBodySnapshot,
			QuotedAuthorID:       ptrFromNull(row.QuotedAuthorID),
		}
		if row.ChannelSeq.Valid {
			value := row.ChannelSeq.Int64
			message.ChannelSeq = &value
		}
		if row.ThreadSeq.Valid {
			value := row.ThreadSeq.Int64
			message.ThreadSeq = &value
		}
		messages = append(messages, message)
	}
	hasMore := len(messages) > req.Limit
	if hasMore {
		messages = messages[:req.Limit]
	}
	messages, err = hydrateAttachments(ctx, tx, messages)
	if err != nil {
		return store.OutputPage{}, err
	}
	messages, err = hydrateThreadStates(ctx, tx, messages)
	if err != nil {
		return store.OutputPage{}, err
	}
	messages, err = hydrateReactions(ctx, tx, req.UserID, messages)
	if err != nil {
		return store.OutputPage{}, err
	}
	result := store.OutputPage{Outputs: messages}
	if hasMore && len(messages) > 0 {
		last := messages[len(messages)-1]
		cursor, err := store.EncodeOutputCursor(req, last.CreatedAt, last.ID)
		if err != nil {
			return store.OutputPage{}, err
		}
		result.NextCursor = &cursor
	}
	return result, tx.Commit()
}
