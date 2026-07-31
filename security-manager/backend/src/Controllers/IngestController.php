<?php

declare(strict_types=1);

namespace Naviyra\Security\Controllers;

use Naviyra\Security\ClientIp;
use Naviyra\Security\Database;
use Naviyra\Security\Response;
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
}
