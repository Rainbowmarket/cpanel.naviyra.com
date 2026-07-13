<?php

declare(strict_types=1);

namespace Naviyra\Security\Controllers;

use Naviyra\Security\Database;
use Naviyra\Security\Response;
use PDO;

final class DomainsController
{
    private PDO $db;

    public function __construct()
    {
        $this->db = Database::connect();
    }

    public function index(): void
    {
        $rows = $this->db->query(
            'SELECT d.*,
                (SELECT COUNT(*) FROM visitors v WHERE v.domain_id = d.id AND v.visited_at >= CURDATE()) AS visitors_today,
                (SELECT COUNT(*) FROM security_events e WHERE e.domain_id = d.id AND e.detected_at >= CURDATE()) AS threats_today
             FROM domains d ORDER BY d.name ASC'
        )->fetchAll();
        Response::json(['domains' => $rows]);
    }

    public function store(): void
    {
        $input = json_decode(file_get_contents('php://input') ?: '{}', true) ?? [];
        $name = strtolower(trim((string) ($input['name'] ?? '')));
        if ($name === '') {
            Response::error('Domain name required', 422);
            return;
        }
        $stmt = $this->db->prepare(
            'INSERT INTO domains (name, document_root, naviyra_domain_id) VALUES (?, ?, ?)'
        );
        $stmt->execute([
            $name,
            $input['document_root'] ?? null,
            $input['naviyra_domain_id'] ?? null,
        ]);
        Response::json(['domain' => ['id' => (int) $this->db->lastInsertId(), 'name' => $name]], 201);
    }

    public function destroy(int $id): void
    {
        $stmt = $this->db->prepare('DELETE FROM domains WHERE id = ?');
        $stmt->execute([$id]);
        Response::json(['ok' => true]);
    }
}
