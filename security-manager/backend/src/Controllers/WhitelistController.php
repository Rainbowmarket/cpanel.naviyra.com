<?php

declare(strict_types=1);

namespace Naviyra\Security\Controllers;

use Naviyra\Security\Database;
use Naviyra\Security\Response;
use PDO;

final class WhitelistController
{
    private PDO $db;

    public function __construct()
    {
        $this->db = Database::connect();
    }

    public function index(): void
    {
        $rows = $this->db->query(
            'SELECT * FROM whitelisted_ips ORDER BY created_at DESC'
        )->fetchAll();
        Response::json(['whitelist' => $rows]);
    }

    public function store(): void
    {
        $input = json_decode(file_get_contents('php://input') ?: '{}', true) ?? [];
        $ip = trim((string) ($input['ip'] ?? ''));
        $label = trim((string) ($input['label'] ?? ''));
        if (!filter_var($ip, FILTER_VALIDATE_IP)) {
            Response::error('Invalid IP', 422);
            return;
        }
        $stmt = $this->db->prepare('INSERT INTO whitelisted_ips (ip_address, label) VALUES (?, ?)');
        $stmt->execute([$ip, $label ?: null]);
        Response::json(['ok' => true, 'id' => (int) $this->db->lastInsertId()], 201);
    }

    public function destroy(int $id): void
    {
        $stmt = $this->db->prepare('DELETE FROM whitelisted_ips WHERE id = ?');
        $stmt->execute([$id]);
        Response::json(['ok' => true]);
    }
}
