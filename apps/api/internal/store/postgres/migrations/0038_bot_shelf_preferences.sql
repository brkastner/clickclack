ALTER TABLE user_appearance_preferences ADD COLUMN bot_shelf_order TEXT NOT NULL DEFAULT '';
ALTER TABLE user_appearance_preferences ADD COLUMN bot_shelf_limit INTEGER NOT NULL DEFAULT 0;
