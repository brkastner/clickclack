package sqlite

import (
	"context"
	"database/sql"
	"errors"

	"github.com/openclaw/clickclack/apps/api/internal/store"
	"github.com/openclaw/clickclack/apps/api/internal/store/sqlite/storedb"
)

func channelBotAssignmentFromDB(channelID, botUserID string) store.ChannelBotAssignment {
	return store.ChannelBotAssignment{ChannelID: channelID, BotUserID: botUserID}
}

func (s *Store) hydrateChannelBotAssignments(ctx context.Context, channels []store.Channel, workspaceID string) ([]store.Channel, error) {
	if len(channels) == 0 {
		return channels, nil
	}
	rows, err := s.q.ListChannelBotAssignmentsByWorkspace(ctx, workspaceID)
	if err != nil {
		return nil, err
	}
	byChannel := make(map[string][]store.ChannelBotAssignment)
	for _, row := range rows {
		assignment := channelBotAssignmentFromDB(row.ChannelID, row.BotUserID)
		byChannel[assignment.ChannelID] = append(byChannel[assignment.ChannelID], assignment)
	}
	for i := range channels {
		channels[i].BotAssignments = byChannel[channels[i].ID]
	}
	return channels, nil
}

func (s *Store) hydrateChannelBotAssignmentsForChannel(ctx context.Context, channel store.Channel) (store.Channel, error) {
	rows, err := s.q.ListChannelBotAssignmentsByChannel(ctx, channel.ID)
	if err != nil {
		return store.Channel{}, err
	}
	channel.BotAssignments = make([]store.ChannelBotAssignment, 0, len(rows))
	for _, row := range rows {
		channel.BotAssignments = append(channel.BotAssignments, channelBotAssignmentFromDB(row.ChannelID, row.BotUserID))
	}
	return channel, nil
}

func (s *Store) UpsertChannelBotAssignment(ctx context.Context, input store.UpsertChannelBotAssignmentInput) (store.ChannelBotAssignment, store.Event, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return store.ChannelBotAssignment{}, store.Event{}, err
	}
	defer tx.Rollback()
	qtx := s.q.WithTx(tx)
	target, err := qtx.GetChannelBotAssignmentTarget(ctx, storedb.GetChannelBotAssignmentTargetParams{BotUserID: input.BotUserID, ChannelID: input.ChannelID})
	if err != nil {
		return store.ChannelBotAssignment{}, store.Event{}, err
	}
	if err := requireWorkspaceManagerTx(ctx, tx, target.WorkspaceID, input.ActorUserID); err != nil {
		return store.ChannelBotAssignment{}, store.Event{}, err
	}
	if target.Kind != "bot" || target.IsWorkspaceMember == 0 {
		return store.ChannelBotAssignment{}, store.Event{}, errors.New("bot_user_id must be a bot member of the channel workspace")
	}
	assignment := store.ChannelBotAssignment{}
	err = tx.QueryRowContext(ctx, `
		INSERT INTO channel_bot_assignments (channel_id, bot_user_id, updated_by, updated_at)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(channel_id) DO UPDATE SET
		  bot_user_id = excluded.bot_user_id,
		  updated_by = excluded.updated_by,
		  updated_at = excluded.updated_at
		RETURNING channel_id, bot_user_id`, input.ChannelID, input.BotUserID, input.ActorUserID, now()).Scan(&assignment.ChannelID, &assignment.BotUserID)
	if err != nil {
		return store.ChannelBotAssignment{}, store.Event{}, err
	}
	event, err := insertEvent(ctx, tx, target.WorkspaceID, input.ChannelID, "channel.bot_assignment_updated", nil, map[string]string{"channel_id": input.ChannelID, "bot_user_id": input.BotUserID})
	if err != nil {
		return store.ChannelBotAssignment{}, store.Event{}, err
	}
	return assignment, event, tx.Commit()
}

func (s *Store) DeleteChannelBotAssignment(ctx context.Context, input store.DeleteChannelBotAssignmentInput) (store.Event, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return store.Event{}, err
	}
	defer tx.Rollback()
	qtx := s.q.WithTx(tx)
	target, err := qtx.GetChannelBotAssignmentTarget(ctx, storedb.GetChannelBotAssignmentTargetParams{BotUserID: input.BotUserID, ChannelID: input.ChannelID})
	if err != nil {
		return store.Event{}, err
	}
	if err := requireWorkspaceManagerTx(ctx, tx, target.WorkspaceID, input.ActorUserID); err != nil {
		return store.Event{}, err
	}
	removed, err := qtx.DeleteChannelBotAssignment(ctx, storedb.DeleteChannelBotAssignmentParams{ChannelID: input.ChannelID, BotUserID: input.BotUserID})
	if err != nil {
		return store.Event{}, err
	}
	if removed == 0 {
		return store.Event{}, sql.ErrNoRows
	}
	event, err := insertEvent(ctx, tx, target.WorkspaceID, input.ChannelID, "channel.bot_assignment_updated", nil, map[string]string{"channel_id": input.ChannelID, "bot_user_id": input.BotUserID})
	if err != nil {
		return store.Event{}, err
	}
	return event, tx.Commit()
}
