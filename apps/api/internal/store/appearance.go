package store

import (
	"encoding/json"
	"errors"
	"strings"
)

const MaxBotShelfOrderEntries = 64
const MaxPersonaHeroPositions = 64

func AppearancePreferencesPatchEmpty(patch AppearancePreferencesPatch) bool {
	return patch.ColorMode == nil &&
		patch.BoardTheme == nil &&
		patch.MessageLayout == nil &&
		patch.Density == nil &&
		patch.BotShelfOrder == nil &&
		patch.BotShelfLimit == nil &&
		patch.PersonaHeroPositions == nil
}

func NormalizeAppearancePreferencesPatch(input AppearancePreferencesPatch) (AppearancePreferencesPatch, error) {
	colorMode, err := normalizeAppearancePreference(input.ColorMode, map[string]string{
		"":       "",
		"system": "",
		"light":  "light",
		"dark":   "dark",
	}, "color_mode")
	if err != nil {
		return AppearancePreferencesPatch{}, err
	}
	boardTheme, err := normalizeAppearancePreference(input.BoardTheme, map[string]string{
		"":       "",
		"signal": "",
		"ember":  "ember",
		"moss":   "moss",
		"iris":   "iris",
	}, "board_theme")
	if err != nil {
		return AppearancePreferencesPatch{}, err
	}
	messageLayout, err := normalizeAppearancePreference(input.MessageLayout, map[string]string{
		"":         "",
		"standard": "",
		"outlined": "outlined",
	}, "message_layout")
	if err != nil {
		return AppearancePreferencesPatch{}, err
	}
	density, err := normalizeAppearancePreference(input.Density, map[string]string{
		"":            "",
		"comfortable": "",
		"compact":     "compact",
	}, "density")
	if err != nil {
		return AppearancePreferencesPatch{}, err
	}
	var shelfOrder *[]string
	if input.BotShelfOrder != nil {
		seen := map[string]bool{}
		order := make([]string, 0, len(*input.BotShelfOrder))
		for _, id := range *input.BotShelfOrder {
			id = strings.TrimSpace(id)
			if id == "" || seen[id] {
				continue
			}
			seen[id] = true
			order = append(order, id)
		}
		if len(order) > MaxBotShelfOrderEntries {
			return AppearancePreferencesPatch{}, errors.New("bot_shelf_order is too long")
		}
		shelfOrder = &order
	}
	var shelfLimit *int
	if input.BotShelfLimit != nil {
		if *input.BotShelfLimit < 0 || *input.BotShelfLimit > MaxBotShelfOrderEntries {
			return AppearancePreferencesPatch{}, errors.New("bot_shelf_limit is invalid")
		}
		limit := *input.BotShelfLimit
		shelfLimit = &limit
	}
	var heroPositions *map[string]PersonaHeroPosition
	if input.PersonaHeroPositions != nil {
		if len(*input.PersonaHeroPositions) > MaxPersonaHeroPositions {
			return AppearancePreferencesPatch{}, errors.New("persona_hero_positions is too long")
		}
		positions := make(map[string]PersonaHeroPosition, len(*input.PersonaHeroPositions))
		for rawID, position := range *input.PersonaHeroPositions {
			id := strings.TrimSpace(rawID)
			if id == "" {
				return AppearancePreferencesPatch{}, errors.New("persona_hero_positions has an empty id")
			}
			if position.X < -100 || position.X > 200 || position.Y < 0 || position.Y > 100 {
				return AppearancePreferencesPatch{}, errors.New("persona_hero_positions is invalid")
			}
			if position.Zoom == 0 {
				position.Zoom = 100
			}
			if position.Zoom < 25 || position.Zoom > 250 {
				return AppearancePreferencesPatch{}, errors.New("persona_hero_positions zoom is invalid")
			}
			positions[id] = position
		}
		heroPositions = &positions
	}
	return AppearancePreferencesPatch{
		ColorMode:            colorMode,
		BoardTheme:           boardTheme,
		MessageLayout:        messageLayout,
		Density:              density,
		BotShelfOrder:        shelfOrder,
		BotShelfLimit:        shelfLimit,
		PersonaHeroPositions: heroPositions,
	}, nil
}

// EncodeBotShelfOrder and DecodeBotShelfOrder keep the shelf order as a
// comma-separated column so both adapters share one representation.
func EncodeBotShelfOrder(order []string) string { return strings.Join(order, ",") }

func DecodeBotShelfOrder(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	return strings.Split(raw, ",")
}

func EncodePersonaHeroPositions(positions map[string]PersonaHeroPosition) (string, error) {
	if len(positions) == 0 {
		return "", nil
	}
	encoded, err := json.Marshal(positions)
	if err != nil {
		return "", err
	}
	return string(encoded), nil
}

func DecodePersonaHeroPositions(raw string) map[string]PersonaHeroPosition {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	positions := map[string]PersonaHeroPosition{}
	if err := json.Unmarshal([]byte(raw), &positions); err != nil {
		return nil
	}
	return positions
}

func normalizeAppearancePreference(value *string, allowed map[string]string, field string) (*string, error) {
	if value == nil {
		return nil, nil
	}
	normalized, ok := allowed[*value]
	if !ok {
		return nil, errors.New(field + " is invalid")
	}
	return &normalized, nil
}
