-- POS Sales: journaling status fields
-- Date: 2026-03-26

ALTER TABLE `pos_sales`
  ADD COLUMN `journal_status` ENUM('posted','failed') NULL AFTER `void_reason`,
  ADD COLUMN `journal_posted_at` DATETIME NULL AFTER `journal_status`,
  ADD COLUMN `journal_error` TEXT NULL AFTER `journal_posted_at`;

