ALTER TABLE users
ADD COLUMN avatar_url_light TEXT NOT NULL DEFAULT '';

ALTER TABLE users
ADD CONSTRAINT users_light_avatar_requires_primary
CHECK (avatar_url_light = '' OR avatar_url <> '');

ALTER TABLE bot_setup_requests
ADD COLUMN avatar_url_light TEXT NOT NULL DEFAULT '';

ALTER TABLE bot_setup_requests
ADD CONSTRAINT bot_setup_requests_light_avatar_requires_primary
CHECK (avatar_url_light = '' OR avatar_url <> '');
