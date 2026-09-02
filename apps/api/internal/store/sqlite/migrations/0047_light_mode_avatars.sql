ALTER TABLE users
ADD COLUMN avatar_url_light TEXT NOT NULL DEFAULT ''
CHECK (avatar_url_light = '' OR avatar_url <> '');

ALTER TABLE bot_setup_requests
ADD COLUMN avatar_url_light TEXT NOT NULL DEFAULT ''
CHECK (avatar_url_light = '' OR avatar_url <> '');
