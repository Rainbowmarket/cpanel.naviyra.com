<?php

declare(strict_types=1);

namespace Naviyra\Security\Services;

use Naviyra\Security\Config;
use PDO;

final class VisitorService
{
    private GeoService $geo;
    private ThreatDetector $detector;
    private FirewallService $firewall;

    public function __construct(
        private PDO $db,
        ?GeoService $geo = null,
        ?ThreatDetector $detector = null,
        ?FirewallService $firewall = null,
    ) {
        $this->geo = $geo ?? new GeoService();
        $this->detector = $detector ?? new ThreatDetector();
        $this->firewall = $firewall ?? new FirewallService();
    }

    public function resolveDomainId(string $host): ?int
    {
        $host = strtolower(trim($host));
        $host = preg_replace('/^www\./', '', $host) ?? $host;
        $stmt = $this->db->prepare('SELECT id FROM domains WHERE name = ? AND is_active = 1 LIMIT 1');
        $stmt->execute([$host]);
        $id = $stmt->fetchColumn();
        return $id !== false ? (int) $id : null;
    }

    public function ensureDomain(string $host): int
    {
        $existing = $this->resolveDomainId($host);
        if ($existing !== null) {
            return $existing;
        }
        $host = strtolower(preg_replace('/^www\./', '', trim($host)) ?? $host);
        $stmt = $this->db->prepare('INSERT INTO domains (name) VALUES (?)');
        $stmt->execute([$host]);
        return (int) $this->db->lastInsertId();
    }

    /**
     * @param array{host:string,url:string,method?:string,ip?:string,user_agent?:string,referrer?:string,status_code?:int} $data
     */
    public function logVisit(array $data): array
    {
        $ip = $data['ip'] ?? ($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0');
        if (filter_var($ip, FILTER_VALIDATE_IP) === false) {
            return ['skipped' => true, 'reason' => 'invalid_ip'];
        }
        if ($this->firewall->isWhitelisted($this->db, $ip)) {
            return ['skipped' => true, 'reason' => 'whitelisted'];
        }
        if ($this->firewall->isBlocked($this->db, $ip)) {
            return ['skipped' => true, 'reason' => 'blocked'];
        }

        $domainId = $this->ensureDomain($data['host']);
        $ua = $data['user_agent'] ?? null;
        $parsed = $this->geo->parseUserAgent($ua);
        $geo = $this->geo->lookup($ip);
        $findings = $this->detector->analyze($data['url'], $ua);
        $isBot = false;
        foreach ($findings as $f) {
            if ($f['type'] === 'bot') {
                $isBot = true;
            }
        }

        $stmt = $this->db->prepare(
            'INSERT INTO visitors
             (domain_id, ip_address, url, method, user_agent, browser, os, country_code, country_name, referrer, status_code, is_bot)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $stmt->execute([
            $domainId,
            $ip,
            $data['url'],
            $data['method'] ?? 'GET',
            $ua,
            $parsed['browser'],
            $parsed['os'],
            $geo['country_code'],
            $geo['country_name'],
            $data['referrer'] ?? null,
            $data['status_code'] ?? 200,
            $isBot ? 1 : 0,
        ]);

        $this->upsertLive($domainId, $ip, $data['url'], $parsed['browser'], $geo['country_code']);
        $this->incrementStats($domainId, count($findings) > 0);

        $blocked = false;
        foreach ($findings as $finding) {
            $eventId = $this->recordThreat($domainId, $ip, $data['url'], $ua, $finding);
            if (in_array($finding['severity'], ['high', 'critical'], true)) {
                $blocked = $this->maybeAutoBlock($ip, $finding, $eventId) || $blocked;
            }
        }

        return [
            'visitor_id' => (int) $this->db->lastInsertId(),
            'threats' => count($findings),
            'blocked' => $blocked,
        ];
    }

    private function upsertLive(int $domainId, string $ip, string $url, string $browser, ?string $country): void
    {
        $stmt = $this->db->prepare(
            'INSERT INTO live_visitors (domain_id, ip_address, url, browser, country_code, last_seen)
             VALUES (?, ?, ?, ?, ?, NOW())
             ON DUPLICATE KEY UPDATE url = VALUES(url), browser = VALUES(browser),
             country_code = VALUES(country_code), last_seen = NOW()'
        );
        $stmt->execute([$domainId, $ip, $url, $browser, $country]);
    }

    private function incrementStats(int $domainId, bool $hadThreat): void
    {
        $hour = (int) date('G');
        $sql = 'INSERT INTO traffic_stats (domain_id, stat_date, stat_hour, page_views, unique_visitors, threats_detected)
                VALUES (?, CURDATE(), ?, 1, 1, ?)
                ON DUPLICATE KEY UPDATE page_views = page_views + 1,
                threats_detected = threats_detected + VALUES(threats_detected)';
        $stmt = $this->db->prepare($sql);
        $stmt->execute([$domainId, $hour, $hadThreat ? 1 : 0]);
    }

    /** @param array{type:string,severity:string,payload:string} $finding */
    private function recordThreat(int $domainId, string $ip, string $url, ?string $ua, array $finding): int
    {
        $stmt = $this->db->prepare(
            'INSERT INTO security_events
             (domain_id, ip_address, threat_type, severity, url, payload, user_agent, action_taken)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $action = in_array($finding['severity'], ['high', 'critical'], true) ? 'blocked_auto' : 'logged';
        $stmt->execute([
            $domainId,
            $ip,
            $finding['type'],
            $finding['severity'],
            $url,
            $finding['payload'],
            $ua,
            $action,
        ]);
        return (int) $this->db->lastInsertId();
    }

    private function maybeAutoBlock(string $ip, array $finding, int $eventId): bool
    {
        $threshold = Config::int('AUTO_BLOCK_THRESHOLD', 5);
        $window = Config::int('AUTO_BLOCK_WINDOW_MINUTES', 15);

        $stmt = $this->db->prepare(
            'SELECT COUNT(*) FROM security_events
             WHERE ip_address = ? AND severity IN (\'high\', \'critical\')
             AND detected_at >= DATE_SUB(NOW(), INTERVAL ? MINUTE)'
        );
        $stmt->execute([$ip, $window]);
        if ((int) $stmt->fetchColumn() < $threshold) {
            return false;
        }

        try {
            $this->firewall->block(
                $this->db,
                $ip,
                "Auto-block: {$finding['type']} ({$finding['severity']})",
                'auto',
                $eventId,
                Config::get('FIREWALL_METHOD', 'ufw') ?? 'ufw'
            );
            return true;
        } catch (\Throwable) {
            return false;
        }
    }

    public function purgeStaleLive(): int
    {
        $ttl = Config::int('LIVE_VISITOR_TTL', 300);
        $stmt = $this->db->prepare(
            'DELETE FROM live_visitors WHERE last_seen < DATE_SUB(NOW(), INTERVAL ? SECOND)'
        );
        $stmt->execute([$ttl]);
        return $stmt->rowCount();
    }
}
