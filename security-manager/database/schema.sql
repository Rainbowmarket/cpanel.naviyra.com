-- Naviyra Visitor & Security Manager — MySQL schema
-- MySQL 8.0+

CREATE DATABASE IF NOT EXISTS naviyra_security
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE naviyra_security;

CREATE TABLE IF NOT EXISTS admins (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email         VARCHAR(255) NOT NULL UNIQUE,
  name          VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS domains (
  id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name              VARCHAR(255) NOT NULL UNIQUE,
  naviyra_domain_id VARCHAR(64) NULL,
  document_root     VARCHAR(1024) NULL,
  is_active         TINYINT(1) NOT NULL DEFAULT 1,
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_active (is_active)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS visitors (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  domain_id     INT UNSIGNED NOT NULL,
  ip_address    VARCHAR(45) NOT NULL,
  url           TEXT NOT NULL,
  method        VARCHAR(10) NOT NULL DEFAULT 'GET',
  user_agent    TEXT NULL,
  browser       VARCHAR(64) NULL,
  os            VARCHAR(64) NULL,
  country_code  CHAR(2) NULL,
  country_name  VARCHAR(128) NULL,
  referrer      TEXT NULL,
  status_code   SMALLINT UNSIGNED NULL,
  is_bot        TINYINT(1) NOT NULL DEFAULT 0,
  visited_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_domain_time (domain_id, visited_at),
  INDEX idx_ip (ip_address),
  INDEX idx_visited (visited_at),
  CONSTRAINT fk_visitors_domain FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS live_visitors (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  domain_id    INT UNSIGNED NOT NULL,
  ip_address   VARCHAR(45) NOT NULL,
  url          TEXT NULL,
  browser      VARCHAR(64) NULL,
  country_code CHAR(2) NULL,
  last_seen    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_live (domain_id, ip_address),
  INDEX idx_last_seen (last_seen),
  CONSTRAINT fk_live_domain FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS security_events (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  domain_id    INT UNSIGNED NULL,
  ip_address   VARCHAR(45) NOT NULL,
  threat_type  ENUM('sql_injection','xss','brute_force','scanner','bot','path_traversal','other') NOT NULL,
  severity     ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
  url          TEXT NULL,
  payload      TEXT NULL,
  user_agent   TEXT NULL,
  action_taken ENUM('logged','blocked','blocked_auto') NOT NULL DEFAULT 'logged',
  detected_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ip_time (ip_address, detected_at),
  INDEX idx_type (threat_type),
  INDEX idx_detected (detected_at),
  CONSTRAINT fk_events_domain FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS blocked_ips (
  id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ip_address        VARCHAR(45) NOT NULL UNIQUE,
  reason            TEXT NOT NULL,
  source            ENUM('manual','auto','security_event') NOT NULL DEFAULT 'manual',
  security_event_id BIGINT UNSIGNED NULL,
  blocked_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  blocked_via       ENUM('ufw','iptables','nginx','all') NOT NULL DEFAULT 'ufw',
  is_active         TINYINT(1) NOT NULL DEFAULT 1,
  INDEX idx_active (is_active),
  CONSTRAINT fk_blocked_event FOREIGN KEY (security_event_id) REFERENCES security_events(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS whitelisted_ips (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ip_address VARCHAR(45) NOT NULL UNIQUE,
  label      VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS traffic_stats (
  id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  domain_id        INT UNSIGNED NOT NULL,
  stat_date        DATE NOT NULL,
  stat_hour        TINYINT UNSIGNED NULL COMMENT 'NULL = daily aggregate',
  page_views       INT UNSIGNED NOT NULL DEFAULT 0,
  unique_visitors  INT UNSIGNED NOT NULL DEFAULT 0,
  blocked_requests INT UNSIGNED NOT NULL DEFAULT 0,
  threats_detected INT UNSIGNED NOT NULL DEFAULT 0,
  UNIQUE KEY uq_stat (domain_id, stat_date, stat_hour),
  INDEX idx_date (stat_date),
  CONSTRAINT fk_stats_domain FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Default admin: admin@naviyra.local / password (CHANGE via install-linux.sh)
INSERT INTO admins (email, name, password_hash)
VALUES (
  'admin@naviyra.local',
  'Administrator',
  '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi'
)
ON DUPLICATE KEY UPDATE email = email;
