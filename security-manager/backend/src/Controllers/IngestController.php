<?php

declare(strict_types=1);

namespace Naviyra\Security\Controllers;

use Naviyra\Security\ClientIp;
use Naviyra\Security\Database;
use Naviyra\Security\Response;
use Naviyra\Security\Services\FirewallService;
use Naviyra\Security\Services\VisitorService;

final class IngestController
{
    public function log(): void
    {
        $input = json_decode(file_get_contents('php://input') ?: '{}', true) ?? [];
        if (empty($input['host']) || empty($input['url'])) {
            Response::error('host and url required', 422);
            return;
        }

        // Never trust body "ip" for live ingest — use the TCP peer (or trusted proxy headers).
        $service = new VisitorService(Database::connect());
        $result = $service->logVisit([
            'host' => (string) $input['host'],
            'url' => (string) $input['url'],
            'method' => $input['method'] ?? 'GET',
            'ip' => ClientIp::fromRequest(),
            'user_agent' => $input['user_agent'] ?? ($_SERVER['HTTP_USER_AGENT'] ?? null),
            'referrer' => $input['referrer'] ?? null,
            'status_code' => isset($input['status_code']) ? (int) $input['status_code'] : 200,
        ]);

        Response::json(['ok' => true, 'result' => $result]);
    }

    /**
     * Batch ingest from a trusted log parser (API key required).
     * IPs come from access-log lines, not the HTTP client — still validate format.
     */
    public function batch(): void
    {
        $input = json_decode(file_get_contents('php://input') ?: '{}', true) ?? [];
        $entries = $input['entries'] ?? [];
        if (!is_array($entries)) {
            Response::error('entries must be array', 422);
            return;
        }

        $service = new VisitorService(Database::connect());
        $processed = 0;
        $skipped = 0;
        foreach ($entries as $entry) {
            if (!is_array($entry) || empty($entry['host']) || empty($entry['url'])) {
                $skipped++;
                continue;
            }
            $ip = isset($entry['ip']) ? trim((string) $entry['ip']) : '';
            if ($ip === '' || !ClientIp::isValid($ip)) {
                $skipped++;
                continue;
            }
            $service->logVisit([
                'host' => (string) $entry['host'],
                'url' => (string) $entry['url'],
                'method' => $entry['method'] ?? 'GET',
                'ip' => $ip,
                'user_agent' => $entry['user_agent'] ?? null,
                'referrer' => $entry['referrer'] ?? null,
                'status_code' => isset($entry['status_code']) ? (int) $entry['status_code'] : 200,
            ]);
            $processed++;
        }

        Response::json(['ok' => true, 'processed' => $processed, 'skipped' => $skipped]);
    }

    /** Panel is source of truth; this mirrors blocklist/whitelist into SM. */
    public function blocklist(): void
    {
        $input = json_decode(file_get_contents('php://input') ?: '{}', true) ?? [];
        $op = (string) ($input['op'] ?? '');
        $ip = trim((string) ($input['ip'] ?? ''));
        if (!filter_var($ip, FILTER_VALIDATE_IP)) {
            Response::error('Invalid IP', 422);
            return;
        }
        $db = Database::connect();
        $firewall = new FirewallService();
        try {
            if ($op === 'block') {
                $reason = trim((string) ($input['reason'] ?? 'Panel block'));
                $firewall->block($db, $ip, $reason, 'panel');
            } elseif ($op === 'unblock') {
                $firewall->unblock($db, $ip);
            } elseif ($op === 'whitelist') {
                $label = trim((string) ($input['label'] ?? 'panel'));
                $stmt = $db->prepare('INSERT IGNORE INTO whitelisted_ips (ip_address, label) VALUES (?, ?)');
                $stmt->execute([$ip, $label !== '' ? $label : 'panel']);
            } elseif ($op === 'unwhitelist') {
                $stmt = $db->prepare('DELETE FROM whitelisted_ips WHERE ip_address = ?');
                $stmt->execute([$ip]);
            } else {
                Response::error('Unknown op', 422);
                return;
            }
            Response::json(['ok' => true]);
        } catch (\Throwable $e) {
            Response::error($e->getMessage(), 400);
        }
    }
}
