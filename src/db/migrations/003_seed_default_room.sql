-- Every new install needs somewhere to land before any user exists.

INSERT INTO rooms (slug, name, topic, kind, visibility)
VALUES ('general', 'General', 'Everyone starts here.', 'room', 'public');
