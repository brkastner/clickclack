package sqlite

import (
	"context"
	"database/sql"
	"errors"

	"github.com/openclaw/clickclack/apps/api/internal/store"
	"github.com/openclaw/clickclack/apps/api/internal/store/sqlite/storedb"
)

func (s *Store) GetAppearancePreferences(ctx context.Context, userID string) (*store.AppearancePreferences, error) {
	row, err := s.q.GetAppearancePreferences(ctx, userID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	preferences := store.AppearancePreferences{
		ColorMode:            row.ColorMode,
		BoardTheme:           row.BoardTheme,
		MessageLayout:        row.MessageLayout,
		Density:              row.Density,
		BotShelfOrder:        store.DecodeBotShelfOrder(row.BotShelfOrder),
		BotShelfLimit:        int(row.BotShelfLimit),
		PersonaHeroPositions: store.DecodePersonaHeroPositions(row.PersonaHeroPositions),
	}
	return &preferences, nil
}

func (s *Store) UpdateAppearancePreferences(ctx context.Context, input store.UpdateAppearancePreferencesInput) (*store.AppearancePreferences, error) {
	patch, err := store.NormalizeAppearancePreferencesPatch(input.Patch)
	if err != nil {
		return nil, err
	}
	if store.AppearancePreferencesPatchEmpty(patch) {
		return s.GetAppearancePreferences(ctx, input.UserID)
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if err := updateAppearancePreferences(ctx, s.q.WithTx(tx), input.UserID, patch); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return s.GetAppearancePreferences(ctx, input.UserID)
}

func updateAppearancePreferences(ctx context.Context, q *storedb.Queries, userID string, patch store.AppearancePreferencesPatch) error {
	if err := q.EnsureAppearancePreferences(ctx, userID); err != nil {
		return err
	}
	if patch.ColorMode != nil {
		if err := q.UpdateAppearanceColorMode(ctx, storedb.UpdateAppearanceColorModeParams{
			ColorMode: *patch.ColorMode,
			UserID:    userID,
		}); err != nil {
			return err
		}
	}
	if patch.BoardTheme != nil {
		if err := q.UpdateAppearanceBoardTheme(ctx, storedb.UpdateAppearanceBoardThemeParams{
			BoardTheme: *patch.BoardTheme,
			UserID:     userID,
		}); err != nil {
			return err
		}
	}
	if patch.MessageLayout != nil {
		if err := q.UpdateAppearanceMessageLayout(ctx, storedb.UpdateAppearanceMessageLayoutParams{
			MessageLayout: *patch.MessageLayout,
			UserID:        userID,
		}); err != nil {
			return err
		}
	}
	if patch.Density != nil {
		if err := q.UpdateAppearanceDensity(ctx, storedb.UpdateAppearanceDensityParams{
			Density: *patch.Density,
			UserID:  userID,
		}); err != nil {
			return err
		}
	}
	if patch.BotShelfOrder != nil {
		if err := q.UpdateAppearanceBotShelfOrder(ctx, storedb.UpdateAppearanceBotShelfOrderParams{
			BotShelfOrder: store.EncodeBotShelfOrder(*patch.BotShelfOrder),
			UserID:        userID,
		}); err != nil {
			return err
		}
	}
	if patch.BotShelfLimit != nil {
		if err := q.UpdateAppearanceBotShelfLimit(ctx, storedb.UpdateAppearanceBotShelfLimitParams{
			BotShelfLimit: int64(*patch.BotShelfLimit),
			UserID:        userID,
		}); err != nil {
			return err
		}
	}
	if patch.PersonaHeroPositions != nil {
		encoded, err := store.EncodePersonaHeroPositions(*patch.PersonaHeroPositions)
		if err != nil {
			return err
		}
		if err := q.UpdateAppearancePersonaHeroPositions(ctx, storedb.UpdateAppearancePersonaHeroPositionsParams{
			PersonaHeroPositions: encoded,
			UserID:               userID,
		}); err != nil {
			return err
		}
	}
	return nil
}
