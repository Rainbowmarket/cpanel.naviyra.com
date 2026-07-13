<?php

declare(strict_types=1);

namespace Naviyra\Security\Controllers;

use Naviyra\Security\Database;
use Naviyra\Security\Jwt;
use Naviyra\Security\Response;
use PDO;

final class AuthController
{
    private PDO $db;

    public function __construct()
    {
        $this->db = Database::connect();
    }

    public function login(): void
    {
        $input = json_decode(file_get_contents('php://input') ?: '{}', true) ?? [];
        $email = trim((string) ($input['email'] ?? ''));
        $password = (string) ($input['password'] ?? '');

        if ($email === '' || $password === '') {
            Response::error('Email and password required', 422);
            return;
        }

        $stmt = $this->db->prepare('SELECT * FROM admins WHERE email = ? LIMIT 1');
        $stmt->execute([$email]);
        $admin = $stmt->fetch();
        if (!$admin || !password_verify($password, $admin['password_hash'])) {
            Response::error('Invalid credentials', 401);
            return;
        }

        $token = Jwt::encode([
            'sub' => (int) $admin['id'],
            'email' => $admin['email'],
            'name' => $admin['name'],
        ]);

        Response::json([
            'token' => $token,
            'user' => [
                'id' => (int) $admin['id'],
                'email' => $admin['email'],
                'name' => $admin['name'],
            ],
        ]);
    }

    public function me(array $auth): void
    {
        Response::json([
            'user' => [
                'id' => (int) $auth['sub'],
                'email' => $auth['email'],
                'name' => $auth['name'],
            ],
        ]);
    }
}
