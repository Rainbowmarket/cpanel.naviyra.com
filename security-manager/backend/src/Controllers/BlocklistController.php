<?php

declare(strict_types=1);

namespace Naviyra\Security\Controllers;

use Naviyra\Security\Database;
use Naviyra\Security\Response;
use Naviyra\Security\Services\FirewallService;
use PDO;

final class BlocklistController
{
    private PDO $db;
    private FirewallService $firewall;

    public function __construct()
    {
        $this->db = Database::connect();
        $this->firewall = new FirewallService();
    }

    public function index(): void
    {
        $rows = $this->db->query(
            'SELECT * FROM blocked_ips WHERE is_active = 1 ORDER BY blocked_at DESC'
        )->fetchAll();
        Response::json(['blocked' => $rows]);
    }

    public function store(): void
    {
        $input = json_decode(file_get_contents('php://input') ?: '{}', true) ?? [];
        $ip = trim((string) ($input['ip'] ?? ''));
        $reason = trim((string) ($input['reason'] ?? 'Manual block'));
        if ($ip === '') {
            Response::error('IP required', 422);
            return;
        }
        try {
            $result = $this->firewall->block($this->db, $ip, $reason, 'manual');
            Response::json(['ok' => true, 'result' => $result], 201);
        } catch (\Throwable $e) {
            Response::error($e->getMessage(), 400);
        }
    }

    public function destroy(string $ip): void
    {
        try {
            $result = $this->firewall->unblock($this->db, $ip);
            Response::json(['ok' => true, 'result' => $result]);
        } catch (\Throwable $e) {
            Response::error($e->getMessage(), 400);
        }
    }
}
