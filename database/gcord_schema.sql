-- =============================================================================
-- G-Cord / G-Cash Cash Out System
-- Full database schema + seed data
-- Compatible with: PostgreSQL 13+
-- =============================================================================
-- NOTE:
-- On hosted Postgres (Supabase, Neon, etc.) you usually cannot CREATE DATABASE.
-- Connect to your existing database, then run this file.
-- =============================================================================

BEGIN;

-- Enums
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('staff', 'super_admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE user_status AS ENUM ('active', 'inactive');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE txn_status AS ENUM ('verified', 'duplicate');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE txn_source AS ENUM ('scan', 'manual', 'upload', 'seed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE scan_mode AS ENUM ('camera', 'manual', 'upload');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE scan_status AS ENUM ('pending', 'parsed', 'saved', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE dup_resolved AS ENUM ('blocked', 'reviewed', 'ignored');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE notif_category AS ENUM ('transactions', 'alerts', 'system');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE notif_severity AS ENUM ('success', 'warning', 'info', 'danger');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE log_status AS ENUM ('success', 'warning', 'error');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE log_icon AS ENUM ('login', 'create', 'warn', 'update', 'logout', 'info');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE verification_status AS ENUM ('pending', 'verified', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE usage_channel AS ENUM ('gcash', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Drop views first
DROP VIEW IF EXISTS v_gcash_usage_today CASCADE;
DROP VIEW IF EXISTS v_admin_account_stats CASCADE;
DROP VIEW IF EXISTS v_top_users_by_transactions CASCADE;
DROP VIEW IF EXISTS v_daily_transaction_trends CASCADE;
DROP VIEW IF EXISTS v_transaction_stats CASCADE;

-- Drop tables (child -> parent)
DROP TABLE IF EXISTS scan_sessions CASCADE;
DROP TABLE IF EXISTS duplicate_events CASCADE;
DROP TABLE IF EXISTS notifications CASCADE;
DROP TABLE IF EXISTS system_logs CASCADE;
DROP TABLE IF EXISTS user_sessions CASCADE;
DROP TABLE IF EXISTS user_security_settings CASCADE;
DROP TABLE IF EXISTS daily_usage_stats CASCADE;
DROP TABLE IF EXISTS transactions CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- Drop functions
DROP FUNCTION IF EXISTS sp_save_transaction(text, text, text, numeric, date, time, txn_source, bigint);
DROP FUNCTION IF EXISTS app_login(text, text);
DROP FUNCTION IF EXISTS app_logout();
DROP FUNCTION IF EXISTS app_find_transaction_by_ref(text);
DROP FUNCTION IF EXISTS app_current_user_id();
DROP FUNCTION IF EXISTS app_current_user_role();
DROP FUNCTION IF EXISTS app_is_admin();
DROP FUNCTION IF EXISTS app_session_token();
DROP FUNCTION IF EXISTS app_verify_password(text, text);

-- =============================================================================
-- 1) USERS
-- =============================================================================
CREATE TABLE users (
  id                BIGSERIAL PRIMARY KEY,
  username          VARCHAR(80)  NOT NULL UNIQUE,
  email             VARCHAR(190) NOT NULL UNIQUE,
  password_hash     VARCHAR(255) NOT NULL,
  first_name        VARCHAR(80)  NOT NULL,
  last_name         VARCHAR(80)  NOT NULL,
  middle_initial    VARCHAR(5),
  full_name         VARCHAR(160) GENERATED ALWAYS AS (
                      TRIM(BOTH FROM (
                        first_name || ' ' ||
                        CASE WHEN middle_initial IS NULL OR middle_initial = '' THEN ''
                             ELSE middle_initial || '. ' END ||
                        last_name
                      ))
                    ) STORED,
  phone             VARCHAR(20),
  role              user_role NOT NULL DEFAULT 'staff',
  status            user_status NOT NULL DEFAULT 'active',
  age               SMALLINT,
  birthday          DATE,
  valid_id_url      TEXT,
  face_capture_url  TEXT,
  verification_status verification_status NOT NULL DEFAULT 'pending',
  verified_at       TIMESTAMP,
  verified_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  google_subject    VARCHAR(191) UNIQUE,
  last_login_at     TIMESTAMP,
  created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_role_status ON users (role, status);
CREATE INDEX idx_users_phone ON users (phone);

-- =============================================================================
-- 2) TRANSACTIONS
-- =============================================================================
CREATE TABLE transactions (
  id                      BIGSERIAL PRIMARY KEY,
  ref_no                  VARCHAR(32)  NOT NULL,
  recipient_name          VARCHAR(160) NOT NULL,
  recipient_number        VARCHAR(20)  NOT NULL,
  amount                  NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  txn_date                DATE NOT NULL,
  txn_time                TIME NOT NULL,
  status                  txn_status NOT NULL DEFAULT 'verified',
  source                  txn_source NOT NULL DEFAULT 'scan',
  created_by_user_id      BIGINT REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
  matched_transaction_id  BIGINT REFERENCES transactions(id) ON DELETE SET NULL ON UPDATE CASCADE,
  ocr_confidence          NUMERIC(5,2),
  notes                   VARCHAR(500),
  created_at              TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_txn_ref ON transactions (ref_no);
CREATE INDEX idx_txn_status ON transactions (status);
CREATE INDEX idx_txn_date ON transactions (txn_date);
CREATE INDEX idx_txn_created_by ON transactions (created_by_user_id);
CREATE INDEX idx_txn_created_at ON transactions (created_at);
CREATE INDEX idx_txn_recipient_number ON transactions (recipient_number);

-- =============================================================================
-- 3) SCAN SESSIONS
-- =============================================================================
CREATE TABLE scan_sessions (
  id                       BIGSERIAL PRIMARY KEY,
  user_id                  BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
  mode                     scan_mode NOT NULL DEFAULT 'camera',
  receipt_image_url        VARCHAR(500),
  ocr_raw_text             TEXT,
  parsed_recipient_name    VARCHAR(160),
  parsed_recipient_number  VARCHAR(20),
  parsed_amount            NUMERIC(12,2),
  parsed_ref_no            VARCHAR(32),
  parsed_txn_date          DATE,
  parsed_txn_time          TIME,
  resulting_transaction_id BIGINT REFERENCES transactions(id) ON DELETE SET NULL ON UPDATE CASCADE,
  status                   scan_status NOT NULL DEFAULT 'pending',
  error_message            VARCHAR(500),
  created_at               TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_scan_user ON scan_sessions (user_id);
CREATE INDEX idx_scan_status ON scan_sessions (status);

-- =============================================================================
-- 4) DUPLICATE EVENTS
-- =============================================================================
CREATE TABLE duplicate_events (
  id                        BIGSERIAL PRIMARY KEY,
  ref_no                    VARCHAR(32) NOT NULL,
  original_transaction_id   BIGINT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE ON UPDATE CASCADE,
  duplicate_transaction_id  BIGINT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE ON UPDATE CASCADE,
  amount                    NUMERIC(12,2) NOT NULL,
  detected_at               TIMESTAMP NOT NULL DEFAULT NOW(),
  resolved_status           dup_resolved NOT NULL DEFAULT 'blocked',
  notes                     VARCHAR(500),
  UNIQUE (original_transaction_id, duplicate_transaction_id)
);

CREATE INDEX idx_dup_ref ON duplicate_events (ref_no);
CREATE INDEX idx_dup_detected ON duplicate_events (detected_at);

-- =============================================================================
-- 5) NOTIFICATIONS
-- =============================================================================
CREATE TABLE notifications (
  id               BIGSERIAL PRIMARY KEY,
  user_id          BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
  category         notif_category NOT NULL DEFAULT 'system',
  title            VARCHAR(180) NOT NULL,
  body             VARCHAR(500) NOT NULL,
  ref_no           VARCHAR(32),
  transaction_id   BIGINT REFERENCES transactions(id) ON DELETE SET NULL ON UPDATE CASCADE,
  severity         notif_severity NOT NULL DEFAULT 'info',
  is_read          BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notif_user_read ON notifications (user_id, is_read);
CREATE INDEX idx_notif_category ON notifications (category);
CREATE INDEX idx_notif_created ON notifications (created_at);

-- =============================================================================
-- 6) SYSTEM LOGS
-- =============================================================================
CREATE TABLE system_logs (
  id               BIGSERIAL PRIMARY KEY,
  actor_user_id    BIGINT REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
  actor_name       VARCHAR(160),
  actor_role       user_role,
  action_code      VARCHAR(60) NOT NULL,
  message          VARCHAR(500) NOT NULL,
  status           log_status NOT NULL DEFAULT 'success',
  icon             log_icon NOT NULL DEFAULT 'info',
  transaction_id   BIGINT REFERENCES transactions(id) ON DELETE SET NULL ON UPDATE CASCADE,
  meta_json        JSONB,
  created_at       TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_logs_created ON system_logs (created_at);
CREATE INDEX idx_logs_action ON system_logs (action_code);
CREATE INDEX idx_logs_status ON system_logs (status);
CREATE INDEX idx_logs_actor ON system_logs (actor_user_id);

-- =============================================================================
-- 7) USER SECURITY SETTINGS
-- =============================================================================
CREATE TABLE user_security_settings (
  user_id              BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
  login_alerts         BOOLEAN NOT NULL DEFAULT TRUE,
  duplicate_alerts     BOOLEAN NOT NULL DEFAULT TRUE,
  require_reauth       BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at           TIMESTAMP NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- 8) USER SESSIONS
-- =============================================================================
CREATE TABLE user_sessions (
  id             BIGSERIAL PRIMARY KEY,
  user_id        BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
  session_token  VARCHAR(64) UNIQUE,
  started_at     TIMESTAMP NOT NULL DEFAULT NOW(),
  ended_at       TIMESTAMP,
  ip_address     VARCHAR(45),
  user_agent     VARCHAR(255),
  is_active      BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX idx_sess_user_active ON user_sessions (user_id, is_active);
CREATE INDEX idx_sess_token_active ON user_sessions (session_token) WHERE is_active = TRUE;

-- =============================================================================
-- 9) DAILY USAGE STATS
-- =============================================================================
CREATE TABLE daily_usage_stats (
  id         BIGSERIAL PRIMARY KEY,
  stat_date  DATE NOT NULL,
  channel    usage_channel NOT NULL,
  txn_count  INTEGER NOT NULL DEFAULT 0,
  UNIQUE (stat_date, channel)
);

-- =============================================================================
-- updated_at helper trigger
-- =============================================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

DROP TRIGGER IF EXISTS trg_transactions_updated_at ON transactions;
CREATE TRIGGER trg_transactions_updated_at
BEFORE UPDATE ON transactions
FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

DROP TRIGGER IF EXISTS trg_security_updated_at ON user_security_settings;
CREATE TRIGGER trg_security_updated_at
BEFORE UPDATE ON user_security_settings
FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- =============================================================================
-- VIEWS
-- =============================================================================
CREATE VIEW v_transaction_stats AS
SELECT
  COUNT(*)::BIGINT AS total_transactions,
  COALESCE(SUM(CASE WHEN status = 'verified' THEN 1 ELSE 0 END), 0)::BIGINT AS verified_count,
  COALESCE(SUM(CASE WHEN status = 'duplicate' THEN 1 ELSE 0 END), 0)::BIGINT AS duplicate_blocked,
  COALESCE(SUM(CASE WHEN status = 'verified' THEN amount ELSE 0 END), 0) AS total_cash_out
FROM transactions;

CREATE VIEW v_daily_transaction_trends AS
SELECT
  txn_date,
  COUNT(*)::BIGINT AS total_count,
  COALESCE(SUM(CASE WHEN status = 'verified' THEN 1 ELSE 0 END), 0)::BIGINT AS verified_count,
  COALESCE(SUM(CASE WHEN status = 'duplicate' THEN 1 ELSE 0 END), 0)::BIGINT AS duplicate_count,
  COALESCE(SUM(CASE WHEN status = 'verified' THEN amount ELSE 0 END), 0) AS verified_amount
FROM transactions
GROUP BY txn_date
ORDER BY txn_date DESC;

CREATE VIEW v_top_users_by_transactions AS
SELECT
  u.id AS user_id,
  u.full_name,
  u.role,
  COUNT(t.id)::BIGINT AS transaction_count,
  COALESCE(SUM(CASE WHEN t.status = 'verified' THEN t.amount ELSE 0 END), 0) AS total_cash_out
FROM users u
LEFT JOIN transactions t ON t.created_by_user_id = u.id
WHERE u.role = 'staff'
GROUP BY u.id, u.full_name, u.role
ORDER BY transaction_count DESC, total_cash_out DESC;

CREATE VIEW v_admin_account_stats AS
SELECT
  COALESCE(SUM(CASE WHEN role = 'super_admin' THEN 1 ELSE 0 END), 0)::BIGINT AS total_admins,
  COALESCE(SUM(CASE WHEN role = 'staff' THEN 1 ELSE 0 END), 0)::BIGINT AS total_staff,
  COALESCE(SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END), 0)::BIGINT AS active_accounts,
  COALESCE(SUM(CASE WHEN status = 'inactive' THEN 1 ELSE 0 END), 0)::BIGINT AS inactive_accounts,
  COALESCE(SUM(CASE WHEN role = 'super_admin' THEN 1 ELSE 0 END), 0)::BIGINT AS super_admin_count
FROM users;

CREATE VIEW v_gcash_usage_today AS
SELECT
  channel,
  txn_count,
  ROUND(
    100.0 * txn_count / NULLIF((SELECT SUM(txn_count) FROM daily_usage_stats WHERE stat_date = CURRENT_DATE), 0),
    2
  ) AS pct
FROM daily_usage_stats
WHERE stat_date = CURRENT_DATE;

-- =============================================================================
-- FUNCTION: save scanned / manual transaction with duplicate check
-- =============================================================================
CREATE OR REPLACE FUNCTION sp_save_transaction(
  p_ref_no TEXT,
  p_recipient_name TEXT,
  p_recipient_number TEXT,
  p_amount NUMERIC,
  p_txn_date DATE,
  p_txn_time TIME,
  p_source txn_source,
  p_created_by_user_id BIGINT
)
RETURNS TABLE (
  transaction_id BIGINT,
  is_duplicate BOOLEAN,
  status txn_status
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_original_id BIGINT;
  v_digits_ref TEXT;
  v_digits_num TEXT;
  v_status txn_status;
  v_is_duplicate BOOLEAN;
  v_new_id BIGINT;
  v_actor_name TEXT;
  v_actor_role user_role;
BEGIN
  v_digits_ref := regexp_replace(COALESCE(p_ref_no, ''), '[^0-9]', '', 'g');
  v_digits_num := regexp_replace(COALESCE(p_recipient_number, ''), '[^0-9]', '', 'g');

  IF left(v_digits_num, 2) = '63' AND length(v_digits_num) >= 12 THEN
    v_digits_num := '0' || substring(v_digits_num FROM 3);
  END IF;

  SELECT t.id INTO v_original_id
  FROM transactions t
  WHERE t.ref_no = v_digits_ref
  ORDER BY t.id ASC
  LIMIT 1;

  IF v_original_id IS NULL THEN
    v_status := 'verified';
    v_is_duplicate := FALSE;
  ELSE
    v_status := 'duplicate';
    v_is_duplicate := TRUE;
  END IF;

  INSERT INTO transactions (
    ref_no, recipient_name, recipient_number, amount,
    txn_date, txn_time, status, source,
    created_by_user_id, matched_transaction_id
  ) VALUES (
    v_digits_ref,
    upper(trim(p_recipient_name)),
    v_digits_num,
    p_amount,
    p_txn_date,
    p_txn_time,
    v_status,
    p_source,
    p_created_by_user_id,
    v_original_id
  )
  RETURNING id INTO v_new_id;

  SELECT u.full_name, u.role INTO v_actor_name, v_actor_role
  FROM users u
  WHERE u.id = p_created_by_user_id;

  IF v_is_duplicate THEN
    INSERT INTO duplicate_events (
      ref_no, original_transaction_id, duplicate_transaction_id, amount
    ) VALUES (
      v_digits_ref, v_original_id, v_new_id, p_amount
    );

    INSERT INTO system_logs (
      actor_user_id, actor_name, actor_role, action_code, message, status, icon, transaction_id
    ) VALUES (
      p_created_by_user_id, v_actor_name, v_actor_role,
      'duplicate_detected',
      'Duplicate transaction detected for Ref #' || v_digits_ref,
      'warning', 'warn', v_new_id
    );
  ELSE
    INSERT INTO system_logs (
      actor_user_id, actor_name, actor_role, action_code, message, status, icon, transaction_id
    ) VALUES (
      p_created_by_user_id, v_actor_name, v_actor_role,
      'create_transaction',
      COALESCE(v_actor_name, 'User') || ' created a transaction',
      'success', 'create', v_new_id
    );
  END IF;

  transaction_id := v_new_id;
  is_duplicate := v_is_duplicate;
  status := v_status;
  RETURN NEXT;
END;
$$;

-- =============================================================================
-- SEED DATA
-- =============================================================================
INSERT INTO users
  (id, username, email, password_hash, first_name, last_name, middle_initial, phone, role, status, verification_status, verified_at, last_login_at)
VALUES
  (1, 'superadmin', 'superadmin@gcash.local', '$2y$10$placeholder_superadmin_hash________', 'Super', 'Admin', NULL, '09170000000', 'super_admin', 'active', 'verified', '2026-07-15 09:45:00', '2026-07-15 09:45:00'),
  (2, 'juan.admin', 'juan.delacruz@gcash.local', '$2y$10$placeholder_juan_admin_hash___________', 'Juan', 'Dela Cruz', 'S', '09171112233', 'super_admin', 'active', 'verified', '2026-02-16 07:15:00', '2026-02-16 07:15:00'),
  (3, 'maria.santos', 'm_lim@gmail.com', '$2y$10$placeholder_maria_staff_hash__________', 'Maria', 'Santos', 'L', '09171234567', 'staff', 'active', 'verified', '2026-03-01 08:33:00', '2026-03-01 08:33:00'),
  (4, 'kye.vergara', 'ky_ver@gmail.com', '$2y$10$placeholder_kye_staff_hash____________', 'Kye', 'Vergara', NULL, '09172223344', 'staff', 'active', 'verified', NOW(), NULL),
  (5, 'mace.zhang', 'mAce_ang@gmail.com', '$2y$10$placeholder_mace_staff_hash___________', 'Mace', 'Zhang', 'V', '09173334455', 'staff', 'active', 'verified', NOW(), NULL),
  (6, 'kaze.menz', 'Kz_Men@gmail.com', '$2y$10$placeholder_kaze_admin_hash___________', 'Kaze', 'Menz', NULL, '09174445566', 'staff', 'active', 'verified', NOW(), NULL);

SELECT setval(pg_get_serial_sequence('users', 'id'), (SELECT MAX(id) FROM users));

INSERT INTO user_security_settings (user_id, login_alerts, duplicate_alerts, require_reauth)
VALUES
  (1, TRUE, TRUE, FALSE),
  (2, TRUE, TRUE, FALSE),
  (3, TRUE, TRUE, FALSE),
  (4, TRUE, TRUE, FALSE),
  (5, TRUE, TRUE, FALSE),
  (6, TRUE, TRUE, FALSE);

INSERT INTO transactions
  (id, ref_no, recipient_name, recipient_number, amount, txn_date, txn_time, status, source, created_by_user_id, matched_transaction_id, created_at)
VALUES
  (1, '8042137193203', 'RENZO VELARDE', '09171234567', 300.00, '2026-06-30', '10:42:00', 'verified', 'seed', 3, NULL, '2026-06-30 10:42:00'),
  (2, '6037862766270', 'JEAN GATIL', '09179876543', 1000.00, '2026-03-30', '08:00:00', 'verified', 'seed', 3, NULL, '2026-03-30 08:00:00'),
  (3, '6037862766270', 'JEAN GATIL', '09179876543', 1000.00, '2026-03-30', '08:05:00', 'duplicate', 'seed', 4, 2, '2026-03-30 08:05:00'),
  (4, '2560176293012', 'MIA SANTOS', '09170001122', 750.00, '2026-06-29', '11:10:00', 'verified', 'seed', 5, NULL, '2026-06-29 11:10:00'),
  (5, '1004273901234', 'JOHN DOE', '09175554433', 200.00, '2026-06-28', '16:30:00', 'verified', 'seed', 3, NULL, '2026-06-28 16:30:00'),
  (6, '1004273901234', 'JOHN DOE', '09175554433', 200.00, '2026-06-28', '16:45:00', 'duplicate', 'seed', 4, 5, '2026-06-28 16:45:00'),
  (7, '5364727819203', 'ANNE REYES', '09176667788', 300.00, '2026-06-28', '13:20:00', 'verified', 'seed', 5, NULL, '2026-06-28 13:20:00');

SELECT setval(pg_get_serial_sequence('transactions', 'id'), (SELECT MAX(id) FROM transactions));

INSERT INTO duplicate_events
  (ref_no, original_transaction_id, duplicate_transaction_id, amount, detected_at, resolved_status)
VALUES
  ('6037862766270', 2, 3, 1000.00, '2026-03-30 08:05:00', 'blocked'),
  ('1004273901234', 5, 6, 200.00, '2026-06-28 16:45:00', 'blocked');

INSERT INTO notifications
  (user_id, category, title, body, ref_no, transaction_id, severity, is_read, created_at)
VALUES
  (3, 'transactions', 'Transaction recorded successfully', 'Recorded No. 8042137193203', '8042137193203', 1, 'success', FALSE, '2026-06-30 10:42:00'),
  (3, 'alerts', 'Duplicate transaction detected', 'Recorded No. 6037862766270', '6037862766270', 3, 'warning', FALSE, '2026-03-30 08:05:00'),
  (3, 'system', 'New login detected', 'A new login was detected', NULL, NULL, 'info', FALSE, '2026-07-15 09:28:00'),
  (1, 'system', 'Admin Juan Dela Cruz logged in', 'New admin session detected', NULL, NULL, 'info', FALSE, '2026-02-16 07:15:00'),
  (1, 'transactions', 'New transaction created', 'Staff Maria Santos recorded a cash-out', '8042137193203', 1, 'success', FALSE, '2026-06-30 10:42:00'),
  (1, 'alerts', 'Duplicate transaction detected', 'Blocked suspicious duplicate entry', '6037862766270', 3, 'warning', FALSE, '2026-03-05 07:15:00');

INSERT INTO system_logs
  (actor_user_id, actor_name, actor_role, action_code, message, status, icon, transaction_id, created_at)
VALUES
  (2, 'Juan Dela Cruz', 'super_admin', 'login', 'Super Admin Juan Dela Cruz logged in', 'success', 'login', NULL, '2026-02-16 07:15:00'),
  (3, 'Maria Santos', 'staff', 'create_transaction', 'Staff Maria Santos created a transaction', 'success', 'create', 1, '2026-03-01 08:33:00'),
  (NULL, NULL, NULL, 'duplicate_detected', 'Duplicate transaction detected', 'warning', 'warn', 3, '2026-03-05 07:15:00'),
  (1, 'Super Admin', 'super_admin', 'update_admin', 'Account updated', 'success', 'update', NULL, '2026-02-20 08:15:00'),
  (2, 'Juan Dela Cruz', 'super_admin', 'logout', 'Super Admin Juan Dela Cruz logged out', 'success', 'logout', NULL, '2026-02-17 07:15:00');

INSERT INTO daily_usage_stats (stat_date, channel, txn_count)
VALUES
  (CURRENT_DATE, 'gcash', 50),
  (CURRENT_DATE, 'other', 10);

INSERT INTO user_sessions (user_id, session_token, started_at, ended_at, ip_address, is_active)
VALUES
  (2, 'seed_ended_session_juan_admin____________', '2026-02-16 07:15:00', '2026-02-17 07:15:00', '127.0.0.1', FALSE),
  (1, 'seed_active_session_superadmin____________', '2026-07-15 09:45:00', NULL, '127.0.0.1', TRUE);

-- =============================================================================
-- ROW LEVEL SECURITY — per-user transaction privacy
-- Staff: only own transactions | Admin/Super Admin: all
-- Duplicate ref lookup uses SECURITY DEFINER RPC (global fraud check)
-- App must send header: x-gcord-session = session_token from app_login()
-- =============================================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION app_session_token()
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(TRIM(BOTH FROM COALESCE(
    current_setting('request.headers', true)::json->>'x-gcord-session',
    current_setting('request.headers', true)::json->>'X-Gcord-Session',
    ''
  )), '');
$$;

CREATE OR REPLACE FUNCTION app_current_user_id()
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.user_id
  FROM user_sessions s
  JOIN users u ON u.id = s.user_id
  WHERE s.session_token = app_session_token()
    AND s.is_active = TRUE
    AND u.status = 'active'
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION app_current_user_role()
RETURNS user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.role
  FROM user_sessions s
  JOIN users u ON u.id = s.user_id
  WHERE s.session_token = app_session_token()
    AND s.is_active = TRUE
    AND u.status = 'active'
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION app_is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(app_current_user_role() = 'super_admin', FALSE);
$$;

CREATE OR REPLACE FUNCTION app_verify_password(p_password TEXT, p_hash TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  h TEXT := COALESCE(p_hash, '');
  pwd TEXT := COALESCE(p_password, '');
  bcrypt_hash TEXT;
BEGIN
  IF h = '' OR pwd = '' THEN
    RETURN FALSE;
  END IF;

  -- Seed demo hashes
  IF strpos(h, 'placeholder') > 0 THEN
    RETURN pwd IN ('admin1234', 'staff1234');
  END IF;

  -- App-created sha256$ hashes
  IF left(h, 7) = 'sha256$' THEN
    BEGIN
      RETURN h = 'sha256$' || encode(extensions.digest('gcord:' || pwd, 'sha256'), 'hex');
    EXCEPTION WHEN OTHERS THEN
      BEGIN
        RETURN h = 'sha256$' || encode(digest('gcord:' || pwd, 'sha256'), 'hex');
      EXCEPTION WHEN OTHERS THEN
        RETURN FALSE;
      END;
    END;
  END IF;

  -- bcrypt ($2a$ / $2b$ / $2y$)
  IF left(h, 4) IN ('$2a$', '$2b$', '$2y$') THEN
    bcrypt_hash := regexp_replace(h, '^\$2y\$', '$2a$');
    BEGIN
      RETURN extensions.crypt(pwd, bcrypt_hash) = bcrypt_hash;
    EXCEPTION WHEN OTHERS THEN
      BEGIN
        RETURN crypt(pwd, bcrypt_hash) = bcrypt_hash;
      EXCEPTION WHEN OTHERS THEN
        RETURN FALSE;
      END;
    END;
  END IF;

  RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION app_login(p_identifier TEXT, p_password TEXT)
RETURNS TABLE (
  ok BOOLEAN,
  message TEXT,
  session_token TEXT,
  user_id BIGINT,
  username VARCHAR,
  email VARCHAR,
  first_name VARCHAR,
  last_name VARCHAR,
  full_name VARCHAR,
  phone VARCHAR,
  role user_role
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  u users%ROWTYPE;
  v_token TEXT;
  v_id TEXT := lower(trim(BOTH FROM COALESCE(p_identifier, '')));
BEGIN
  IF v_id = '' OR COALESCE(p_password, '') = '' THEN
    RETURN QUERY SELECT FALSE, 'Enter username/email and password.'::TEXT,
      NULL::TEXT, NULL::BIGINT, NULL::VARCHAR, NULL::VARCHAR, NULL::VARCHAR,
      NULL::VARCHAR, NULL::VARCHAR, NULL::VARCHAR, NULL::user_role;
    RETURN;
  END IF;

  SELECT * INTO u
  FROM users
  WHERE lower(users.email) = v_id OR lower(users.username) = v_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Account not found.'::TEXT,
      NULL::TEXT, NULL::BIGINT, NULL::VARCHAR, NULL::VARCHAR, NULL::VARCHAR,
      NULL::VARCHAR, NULL::VARCHAR, NULL::VARCHAR, NULL::user_role;
    RETURN;
  END IF;

  IF u.status <> 'active' THEN
    RETURN QUERY SELECT FALSE, 'This account is inactive.'::TEXT,
      NULL::TEXT, NULL::BIGINT, NULL::VARCHAR, NULL::VARCHAR, NULL::VARCHAR,
      NULL::VARCHAR, NULL::VARCHAR, NULL::VARCHAR, NULL::user_role;
    RETURN;
  END IF;

  IF NOT app_verify_password(p_password, u.password_hash) THEN
    RETURN QUERY SELECT FALSE, 'Incorrect password.'::TEXT,
      NULL::TEXT, NULL::BIGINT, NULL::VARCHAR, NULL::VARCHAR, NULL::VARCHAR,
      NULL::VARCHAR, NULL::VARCHAR, NULL::VARCHAR, NULL::user_role;
    RETURN;
  END IF;

  -- End older active sessions for this user (one active session)
  UPDATE user_sessions
  SET is_active = FALSE, ended_at = NOW()
  WHERE user_sessions.user_id = u.id AND is_active = TRUE;

  v_token := replace(gen_random_uuid()::text, '-', '') || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);

  INSERT INTO user_sessions (user_id, session_token, is_active)
  VALUES (u.id, v_token, TRUE);

  UPDATE users SET last_login_at = NOW() WHERE users.id = u.id;

  INSERT INTO system_logs (actor_user_id, actor_name, actor_role, action_code, message, status, icon)
  VALUES (
    u.id,
    u.full_name,
    u.role,
    'login',
    CASE WHEN u.role = 'staff' THEN 'Staff ' ELSE 'Admin ' END || u.full_name || ' logged in',
    'success',
    'login'
  );

  RETURN QUERY SELECT TRUE, 'OK'::TEXT, v_token, u.id, u.username, u.email,
    u.first_name, u.last_name, u.full_name, u.phone, u.role;
END;
$$;

CREATE OR REPLACE FUNCTION app_logout()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid BIGINT := app_current_user_id();
  v_name TEXT;
  v_role user_role;
BEGIN
  IF v_uid IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT full_name, role INTO v_name, v_role FROM users WHERE id = v_uid;

  UPDATE user_sessions
  SET is_active = FALSE, ended_at = NOW()
  WHERE session_token = app_session_token() AND is_active = TRUE;

  INSERT INTO system_logs (actor_user_id, actor_name, actor_role, action_code, message, status, icon)
  VALUES (v_uid, v_name, v_role, 'logout', COALESCE(v_name, 'User') || ' logged out', 'success', 'logout');

  RETURN TRUE;
END;
$$;

-- Global duplicate check (does NOT leak full recipient details to other staff)
CREATE OR REPLACE FUNCTION app_find_transaction_by_ref(p_ref TEXT)
RETURNS TABLE (
  id BIGINT,
  ref_no VARCHAR,
  status txn_status,
  created_by_user_id BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ref TEXT := regexp_replace(COALESCE(p_ref, ''), '[^0-9]', '', 'g');
BEGIN
  IF app_current_user_id() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  RETURN QUERY
  SELECT t.id, t.ref_no, t.status, t.created_by_user_id
  FROM transactions t
  WHERE t.ref_no = v_ref
  ORDER BY t.id ASC
  LIMIT 1;
END;
$$;

-- Grants (Supabase anon / authenticated roles)
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
GRANT EXECUTE ON FUNCTION app_login(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION app_logout() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION app_find_transaction_by_ref(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION app_current_user_id() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION app_current_user_role() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION app_is_admin() TO anon, authenticated;

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE scan_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE duplicate_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_security_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_usage_stats ENABLE ROW LEVEL SECURITY;

-- USERS
DROP POLICY IF EXISTS users_select ON users;
DROP POLICY IF EXISTS users_insert ON users;
DROP POLICY IF EXISTS users_update ON users;
DROP POLICY IF EXISTS users_delete ON users;

CREATE POLICY users_select ON users
  FOR SELECT TO anon, authenticated
  USING (app_is_admin() OR id = app_current_user_id());

CREATE POLICY users_insert ON users
  FOR INSERT TO anon, authenticated
  WITH CHECK (app_is_admin());

CREATE POLICY users_update ON users
  FOR UPDATE TO anon, authenticated
  USING (app_is_admin() OR id = app_current_user_id())
  WITH CHECK (app_is_admin() OR id = app_current_user_id());

CREATE POLICY users_delete ON users
  FOR DELETE TO anon, authenticated
  USING (app_is_admin());

-- TRANSACTIONS (core privacy rule)
DROP POLICY IF EXISTS txn_select ON transactions;
DROP POLICY IF EXISTS txn_insert ON transactions;
DROP POLICY IF EXISTS txn_update ON transactions;
DROP POLICY IF EXISTS txn_delete ON transactions;

CREATE POLICY txn_select ON transactions
  FOR SELECT TO anon, authenticated
  USING (
    app_is_admin()
    OR created_by_user_id = app_current_user_id()
  );

CREATE POLICY txn_insert ON transactions
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    app_current_user_id() IS NOT NULL
    AND (
      app_is_admin()
      OR created_by_user_id = app_current_user_id()
    )
  );

CREATE POLICY txn_update ON transactions
  FOR UPDATE TO anon, authenticated
  USING (app_is_admin() OR created_by_user_id = app_current_user_id())
  WITH CHECK (app_is_admin() OR created_by_user_id = app_current_user_id());

CREATE POLICY txn_delete ON transactions
  FOR DELETE TO anon, authenticated
  USING (app_is_admin());

-- SCAN SESSIONS
DROP POLICY IF EXISTS scan_select ON scan_sessions;
DROP POLICY IF EXISTS scan_write ON scan_sessions;

CREATE POLICY scan_select ON scan_sessions
  FOR SELECT TO anon, authenticated
  USING (app_is_admin() OR user_id = app_current_user_id());

CREATE POLICY scan_write ON scan_sessions
  FOR ALL TO anon, authenticated
  USING (app_is_admin() OR user_id = app_current_user_id())
  WITH CHECK (app_is_admin() OR user_id = app_current_user_id());

-- DUPLICATE EVENTS: staff only if linked to their txn; admin all
DROP POLICY IF EXISTS dup_select ON duplicate_events;
DROP POLICY IF EXISTS dup_write ON duplicate_events;

CREATE POLICY dup_select ON duplicate_events
  FOR SELECT TO anon, authenticated
  USING (
    app_is_admin()
    OR EXISTS (
      SELECT 1 FROM transactions t
      WHERE t.id IN (original_transaction_id, duplicate_transaction_id)
        AND t.created_by_user_id = app_current_user_id()
    )
  );

CREATE POLICY dup_write ON duplicate_events
  FOR ALL TO anon, authenticated
  USING (app_current_user_id() IS NOT NULL)
  WITH CHECK (app_current_user_id() IS NOT NULL);

-- NOTIFICATIONS: own only (admins still only their notif rows unless admin flag)
DROP POLICY IF EXISTS notif_select ON notifications;
DROP POLICY IF EXISTS notif_write ON notifications;

CREATE POLICY notif_select ON notifications
  FOR SELECT TO anon, authenticated
  USING (app_is_admin() OR user_id = app_current_user_id());

CREATE POLICY notif_write ON notifications
  FOR ALL TO anon, authenticated
  USING (app_is_admin() OR user_id = app_current_user_id())
  WITH CHECK (app_is_admin() OR user_id = app_current_user_id());

-- SYSTEM LOGS: admin read all; anyone logged-in can insert own actor rows
DROP POLICY IF EXISTS logs_select ON system_logs;
DROP POLICY IF EXISTS logs_insert ON system_logs;

CREATE POLICY logs_select ON system_logs
  FOR SELECT TO anon, authenticated
  USING (app_is_admin() OR actor_user_id = app_current_user_id());

CREATE POLICY logs_insert ON system_logs
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    app_current_user_id() IS NOT NULL
    AND (actor_user_id IS NULL OR actor_user_id = app_current_user_id() OR app_is_admin())
  );

-- SECURITY SETTINGS
DROP POLICY IF EXISTS sec_all ON user_security_settings;
CREATE POLICY sec_all ON user_security_settings
  FOR ALL TO anon, authenticated
  USING (app_is_admin() OR user_id = app_current_user_id())
  WITH CHECK (app_is_admin() OR user_id = app_current_user_id());

-- SESSIONS: users see/end own sessions; create via app_login (SECURITY DEFINER)
DROP POLICY IF EXISTS sess_select ON user_sessions;
DROP POLICY IF EXISTS sess_update ON user_sessions;

CREATE POLICY sess_select ON user_sessions
  FOR SELECT TO anon, authenticated
  USING (app_is_admin() OR user_id = app_current_user_id());

CREATE POLICY sess_update ON user_sessions
  FOR UPDATE TO anon, authenticated
  USING (app_is_admin() OR user_id = app_current_user_id());

-- DAILY STATS: admins only
DROP POLICY IF EXISTS stats_admin ON daily_usage_stats;
CREATE POLICY stats_admin ON daily_usage_stats
  FOR ALL TO anon, authenticated
  USING (app_is_admin())
  WITH CHECK (app_is_admin());

COMMIT;
