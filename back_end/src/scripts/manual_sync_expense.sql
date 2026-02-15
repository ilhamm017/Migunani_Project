-- Add new columns to expenses table
ALTER TABLE expenses
ADD COLUMN status ENUM('requested', 'approved', 'paid', 'rejected') NOT NULL DEFAULT 'requested' AFTER note,
ADD COLUMN attachment_url VARCHAR(255) NULL AFTER status,
ADD COLUMN account_id INT NULL AFTER attachment_url,
ADD COLUMN approved_by CHAR(36) NULL AFTER account_id,
ADD COLUMN approved_at DATETIME NULL AFTER approved_by,
ADD COLUMN paid_at DATETIME NULL AFTER approved_at;

-- Add foreign keys
ALTER TABLE expenses
ADD CONSTRAINT fk_expenses_account_id FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL,
ADD CONSTRAINT fk_expenses_approved_by FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL;
