<?php

declare(strict_types=1);

namespace Naviyra\Security\Services;

use PDO;

final class StatsService
{
    public function __construct(private PDO $db) {}

    public function overview(?int $domainId = null): array
    {
        $domainFilter = $domainId ? ' AND domain_id = ?' : '';
        $params = $domainId ? [$domainId] : [];

        $visitorsToday = $this->scalar(
            "SELECT COUNT(*) FROM visitors WHERE visited_at >= CURDATE(){$domainFilter}",
            $params
        );
        $uniqueToday = $this->scalar(
            "SELECT COUNT(DISTINCT ip_address) FROM visitors WHERE visited_at >= CURDATE(){$domainFilter}",
            $params
        );
        $threatsToday = $this->scalar(
            'SELECT COUNT(*) FROM security_events WHERE detected_at >= CURDATE()'
            . ($domainId ? ' AND domain_id = ?' : ''),
            $params
        );
        $blockedCount = (int) $this->db->query(
            'SELECT COUNT(*) FROM blocked_ips WHERE is_active = 1'
        )->fetchColumn();
        $liveCount = $this->scalar(
            "SELECT COUNT(*) FROM live_visitors WHERE last_seen >= DATE_SUB(NOW(), INTERVAL 5 MINUTE){$domainFilter}",
            $params
        );
        $domainCount = (int) $this->db->query(
            'SELECT COUNT(*) FROM domains WHERE is_active = 1'
        )->fetchColumn();

        return [
            'visitors_today' => $visitorsToday,
            'unique_today' => $uniqueToday,
            'threats_today' => $threatsToday,
            'blocked_ips' => $blockedCount,
            'live_now' => $liveCount,
            'domains' => $domainCount,
        ];
    }

    /** @return list<array<string,mixed>> */
    public function trafficChart(int $days = 7, ?int $domainId = null): array
    {
        $sql = 'SELECT stat_date, SUM(page_views) AS views, SUM(unique_visitors) AS uniques,
                       SUM(threats_detected) AS threats
                FROM traffic_stats
                WHERE stat_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
                AND stat_hour IS NULL';
        $params = [$days];
        if ($domainId) {
            $sql .= ' AND domain_id = ?';
            $params[] = $domainId;
        }
        $sql .= ' GROUP BY stat_date ORDER BY stat_date ASC';
        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll();
    }

    /** @return list<array<string,mixed>> */
    public function topCountries(?int $domainId = null, int $limit = 10): array
    {
        $sql = 'SELECT country_code, country_name, COUNT(*) AS hits
                FROM visitors WHERE visited_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)';
        $params = [];
        if ($domainId) {
            $sql .= ' AND domain_id = ?';
            $params[] = $domainId;
        }
        $sql .= ' GROUP BY country_code, country_name ORDER BY hits DESC LIMIT ?';
        $params[] = $limit;
        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll();
    }

    private function scalar(string $sql, array $params): int
    {
        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        return (int) $stmt->fetchColumn();
    }
}
