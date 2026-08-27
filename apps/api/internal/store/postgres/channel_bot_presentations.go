package postgres

import (
	"context"
	"database/sql"
	"errors"

	"github.com/openclaw/clickclack/apps/api/internal/store"
	"github.com/openclaw/clickclack/apps/api/internal/store/postgres/storedb"
)

func channelBotPresentationFromDB(row storedb.ChannelBotPresentation) store.ChannelBotPresentation {
	return store.ChannelBotPresentation{
		ChannelID:   row.ChannelID,
		BotUserID:   row.BotUserID,
		DisplayName: row.DisplayName,
		AvatarURL:   row.AvatarUrl,
		UpdatedBy:   row.UpdatedBy,
		UpdatedAt:   row.UpdatedAt,
	}
}

func (s *Store) hydrateChannelBotPresentations(ctx context.Context, channels []store.Channel, workspaceID string) ([]store.Channel, error) {
	if len(channels) == 0 {
		return channels, nil
	}
	rows, err := s.q.ListChannelBotPresentationsByWorkspace(ctx, workspaceID)
	if err != nil {
		return nil, err
	}
	byChannel := make(map[string][]store.ChannelBotPresentation)
	for _, row := range rows {
		presentation := channelBotPresentationFromDB(row)
		byChannel[presentation.ChannelID] = append(byChannel[presentation.ChannelID], presentation)
	}
	for i := range channels {
		channels[i].BotPresentations = byChannel[channels[i].ID]
	}
	return channels, nil
}

func (s *Store) hydrateChannelBotPresentationsForChannel(ctx context.Context, channel store.Channel) (store.Channel, error) {
	rows, err := s.q.ListChannelBotPresentationsByChannel(ctx, channel.ID)
	if err != nil {
		return store.Channel{}, err
	}
	channel.BotPresentations = make([]store.ChannelBotPresentation, 0, len(rows))
	for _, row := range rows {
		channel.BotPresentations = append(channel.BotPresentations, channelBotPresentationFromDB(row))
	}
	return channel, nil
}

func (s *Store) UpsertChannelBotPresentation(ctx context.Context, input store.UpsertChannelBotPresentationInput) (store.ChannelBotPresentation, store.Event, error) {
	displayName, avatarURL, err := store.NormalizeChannelBotPresentation(input.DisplayName, input.AvatarURL)
	if err != nil {
		return store.ChannelBotPresentation{}, store.Event{}, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return store.ChannelBotPresentation{}, store.Event{}, err
	}
	defer tx.Rollback()
	qtx := s.q.WithTx(tx)
	target, err := qtx.GetChannelBotPresentationTarget(ctx, storedb.GetChannelBotPresentationTargetParams{
		BotUserID: input.BotUserID,
		ChannelID: input.ChannelID,
	})
	if err != nil {
		return store.ChannelBotPresentation{}, store.Event{}, err
	}
	if err := requireWorkspaceManagerTx(ctx, tx, target.WorkspaceID, input.ActorUserID); err != nil {
		return store.ChannelBotPresentation{}, store.Event{}, err
	}
	if target.Kind != "bot" || !target.IsWorkspaceMember {
		return store.ChannelBotPresentation{}, store.Event{}, errors.New("bot_user_id must be a bot member of the channel workspace")
	}
	row, err := qtx.UpsertChannelBotPresentation(ctx, storedb.UpsertChannelBotPresentationParams{
		ChannelID:   input.ChannelID,
		BotUserID:   input.BotUserID,
		DisplayName: displayName,
		AvatarUrl:   avatarURL,
		UpdatedBy:   input.ActorUserID,
		UpdatedAt:   now(),
	})
	if err != nil {
		return store.ChannelBotPresentation{}, store.Event{}, err
	}
	event, err := insertEvent(ctx, tx, target.WorkspaceID, input.ChannelID, "channel.updated", nil, map[string]string{
		"channel_id":  input.ChannelID,
		"bot_user_id": input.BotUserID,
	})
	if err != nil {
		return store.ChannelBotPresentation{}, store.Event{}, err
	}
	return channelBotPresentationFromDB(row), event, tx.Commit()
}

func (s *Store) DeleteChannelBotPresentation(ctx context.Context, input store.DeleteChannelBotPresentationInput) (store.Event, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return store.Event{}, err
	}
	defer tx.Rollback()
	qtx := s.q.WithTx(tx)
	target, err := qtx.GetChannelBotPresentationTarget(ctx, storedb.GetChannelBotPresentationTargetParams{
		BotUserID: input.BotUserID,
		ChannelID: input.ChannelID,
	})
	if err != nil {
		return store.Event{}, err
	}
	if err := requireWorkspaceManagerTx(ctx, tx, target.WorkspaceID, input.ActorUserID); err != nil {
		return store.Event{}, err
	}
	removed, err := qtx.DeleteChannelBotPresentation(ctx, storedb.DeleteChannelBotPresentationParams{
		ChannelID: input.ChannelID,
		BotUserID: input.BotUserID,
	})
	if err != nil {
		return store.Event{}, err
	}
	if removed == 0 {
		return store.Event{}, sql.ErrNoRows
	}
	event, err := insertEvent(ctx, tx, target.WorkspaceID, input.ChannelID, "channel.updated", nil, map[string]string{
		"channel_id":  input.ChannelID,
		"bot_user_id": input.BotUserID,
	})
	if err != nil {
		return store.Event{}, err
	}
	return event, tx.Commit()
}
