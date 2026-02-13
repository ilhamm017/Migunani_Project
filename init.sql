-- Initialize database with UTF8MB4 charset
CREATE DATABASE IF NOT EXISTS migunani_motor_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE migunani_motor_db;

-- Grant privileges (if using non-root user)
GRANT ALL PRIVILEGES ON migunani_motor_db.* TO 'migunani'@'%';
FLUSH PRIVILEGES;
