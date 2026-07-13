<?php

declare(strict_types=1);

namespace Naviyra\Security\Controllers;

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

        $service = new VisitorService(Database::connect());
        $result = $service->logVisit([
            'host' => (string) $input['host'],
            'url' => (string) $input['url'],
            'method' => $input['method'] ?? 'GET',
            'ip' => $input['ip'] ?? null,
            'user_agent' => $input['user_agent'] ?? ($_SERVER['HTTP_USER_AGENT'] ?? null),
            'referrer' => $input['referrer'] ?? null,
            'status_code' => isset($input['status_code']) ? (int) $input['status_code'] : 200,
        ]);

        Response::json(['ok' => true, 'result' => $result]);
    }

    /** Batch ingest from log parser */
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
        foreach ($entries as $entry) {
            if (empty($entry['host']) || empty($entry['url'])) {
                continue;
            }
            $service->logVisit($entry);
            $processed++;
        }

        Response::json(['ok' => true, 'processed' => $processed]);
    }
}
