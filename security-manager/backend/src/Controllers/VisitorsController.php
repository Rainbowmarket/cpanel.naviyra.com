<?php

declare(strict_types=1);

namespace Naviyra\Security\Controllers;

use Naviyra\Security\Database;
use Naviyra\Security\Response;
use Naviyra\Security\Services\VisitorService;
use PDO;

final class VisitorsController
{
    private PDO $db;
    private VisitorService $visitors;

    public function __construct()
    {
        $this->db = Database::connect();
        $this->visitors = new VisitorService($this->db);
    }

    public function index(): void
    {
        $domainId = isset($_GET['domain_id']) ? (int) $_GET['domain_id'] : null;
        $limit = min(500, max(1, (int) ($_GET['limit'] ?? 100)));
        $offset = max(0, (int) ($_GET['offset'] ?? 0));
        $search = trim((string) ($_GET['search'] ?? ''));

        $sql = 'SELECT v.*, d.name AS domain_name FROM visitors v
                JOIN domains d ON d.id = v.domain_id WHERE 1=1';
        $params = [];
        if ($domainId) {
            $sql .= ' AND v.domain_id = ?';
            $params[] = $domainId;
        }
        if ($search !== '') {
            $sql .= ' AND (v.ip_address LIKE ? OR v.url LIKE ? OR v.browser LIKE ?)';
            $like = '%' . $search . '%';
            $params[] = $like;
            $params[] = $like;
            $params[] = $like;
        }
        $sql .= ' ORDER BY v.visited_at DESC LIMIT ? OFFSET ?';
        $params[] = $limit;
        $params[] = $offset;

        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        Response::json(['visitors' => $stmt->fetchAll()]);
    }

    public function live(): void
    {
        $this->visitors->purgeStaleLive();
        $domainId = isset($_GET['domain_id']) ? (int) $_GET['domain_id'] : null;
        $sql = 'SELECT lv.*, d.name AS domain_name FROM live_visitors lv
                JOIN domains d ON d.id = lv.domain_id WHERE 1=1';
        $params = [];
        if ($domainId) {
            $sql .= ' AND lv.domain_id = ?';
            $params[] = $domainId;
        }
        $sql .= ' ORDER BY lv.last_seen DESC LIMIT 100';
        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        Response::json(['live' => $stmt->fetchAll()]);
    }
}
