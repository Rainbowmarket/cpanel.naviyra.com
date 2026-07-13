<?php

declare(strict_types=1);

namespace Naviyra\Security\Controllers;

use Naviyra\Security\Database;
use Naviyra\Security\Response;
use Naviyra\Security\Services\FirewallService;
use PDO;

final class SecurityController
{
    private PDO $db;

    public function __construct()
    {
        $this->db = Database::connect();
    }

    public function index(): void
    {
        $domainId = isset($_GET['domain_id']) ? (int) $_GET['domain_id'] : null;
        $limit = min(200, max(1, (int) ($_GET['limit'] ?? 50)));
        $sql = 'SELECT e.*, d.name AS domain_name FROM security_events e
                LEFT JOIN domains d ON d.id = e.domain_id WHERE 1=1';
        $params = [];
        if ($domainId) {
            $sql .= ' AND e.domain_id = ?';
            $params[] = $domainId;
        }
        $sql .= ' ORDER BY e.detected_at DESC LIMIT ?';
        $params[] = $limit;
        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        Response::json(['events' => $stmt->fetchAll()]);
    }

    public function blockFromEvent(int $eventId): void
    {
        $stmt = $this->db->prepare('SELECT * FROM security_events WHERE id = ?');
        $stmt->execute([$eventId]);
        $event = $stmt->fetch();
        if (!$event) {
            Response::error('Event not found', 404);
            return;
        }

        $firewall = new FirewallService();
        try {
            $result = $firewall->block(
                $this->db,
                $event['ip_address'],
                "Manual block from event #{$eventId}: {$event['threat_type']}",
                'security_event',
                $eventId
            );
            Response::json(['ok' => true, 'result' => $result]);
        } catch (\Throwable $e) {
            Response::error($e->getMessage(), 400);
        }
    }
}
