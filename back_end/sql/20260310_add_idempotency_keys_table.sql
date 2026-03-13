CREATE TABLE IF NOT EXISTS `idempotency_keys` (
  `id` CHAR(36) NOT NULL,
  `idempotency_key` VARCHAR(255) NOT NULL,
  `scope` VARCHAR(191) NOT NULL,
  `status` ENUM('in_progress', 'done') NOT NULL DEFAULT 'in_progress',
  `status_code` INT NULL,
  `response_payload` JSON NULL,
  `expires_at` DATETIME NOT NULL,
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_idempotency_keys_key` (`idempotency_key`),
  KEY `idx_idempotency_keys_expires_at` (`expires_at`),
  KEY `idx_idempotency_keys_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

