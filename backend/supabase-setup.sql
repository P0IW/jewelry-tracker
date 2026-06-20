-- ══════════════════════════════════════════════════════════════
-- SUPABASE SETUP — Run this in Supabase SQL Editor
-- ══════════════════════════════════════════════════════════════

-- 1. Sessions table
CREATE TABLE IF NOT EXISTS sessions (
  id            SERIAL PRIMARY KEY,
  session_code  TEXT    NOT NULL UNIQUE,
  iso_date      TEXT    NOT NULL UNIQUE,
  sequence_num  INTEGER NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Orders table
CREATE TABLE IF NOT EXISTS orders (
  id           SERIAL PRIMARY KEY,
  client_name  TEXT    NOT NULL,
  design       TEXT    NOT NULL DEFAULT '',
  code         TEXT    NOT NULL DEFAULT '',
  weight       REAL    NOT NULL DEFAULT 0,
  creator      TEXT    NOT NULL DEFAULT 'مارو',
  is_drawn     INTEGER DEFAULT 0,
  is_laser     INTEGER DEFAULT 0,
  order_date   TEXT    DEFAULT TO_CHAR(NOW() AT TIME ZONE 'Africa/Algiers', 'YYYY-MM-DD'),
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Users table (for app login — separate from Supabase Auth)
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  is_admin      BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Function: sessions with aggregated order stats (used by GET /api/sessions)
CREATE OR REPLACE FUNCTION get_sessions_with_stats()
RETURNS TABLE (
  id           INT,
  session_code TEXT,
  iso_date     TEXT,
  sequence_num INT,
  created_at   TIMESTAMPTZ,
  order_count  BIGINT,
  total_weight FLOAT
) AS $$
  SELECT
    s.id, s.session_code, s.iso_date, s.sequence_num, s.created_at,
    COUNT(o.id)                AS order_count,
    COALESCE(SUM(o.weight), 0) AS total_weight
  FROM sessions s
  LEFT JOIN orders o ON o.order_date = s.iso_date
  GROUP BY s.id
  ORDER BY s.id DESC
  LIMIT 30;
$$ LANGUAGE sql STABLE;

-- 5. Disable Row Level Security (we handle auth ourselves in Express)
ALTER TABLE sessions DISABLE ROW LEVEL SECURITY;
ALTER TABLE orders   DISABLE ROW LEVEL SECURITY;
ALTER TABLE users    DISABLE ROW LEVEL SECURITY;

-- ══════════════════════════════════════════════════════════════
-- After running the SQL above, create your admin user:
-- Run this once with YOUR password (bcrypt hash it via the
-- /api/auth/users endpoint after deploying, or use the
-- create-admin.js script below)
-- ══════════════════════════════════════════════════════════════
