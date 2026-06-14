<?php
/**
 * Configura SSO OAuth2 (Keycloak) en Moodle: emisor OIDC + auth oauth2 habilitado.
 *
 * Variables de entorno (leídas por moodle-config-keycloak-sso.sh):
 * - KEYCLOAK_ISSUER_URL / MOODLE_KEYCLOAK_ISSUER: issuer público (browser)
 * - MOODLE_KEYCLOAK_DISCOVERY_INTERNAL: URL de discovery desde el contenedor Moodle
 * - MOODLE_KEYCLOAK_CLIENT_ID / MOODLE_KEYCLOAK_CLIENT_SECRET
 */
define('CLI_SCRIPT', true);

require('/bitnami/moodle/config.php');
require_once($CFG->libdir . '/clilib.php');

global $DB;

function moodle_sso_env(string $name, ?string $fallback = null): ?string {
    $value = getenv($name);
    if ($value === false || trim($value) === '') {
        return $fallback;
    }
    return trim($value);
}

function moodle_sso_origin(string $url): string {
    $parts = parse_url($url);
    if (!$parts || empty($parts['scheme']) || empty($parts['host'])) {
        throw new RuntimeException("URL inválida: $url");
    }
    $port = isset($parts['port']) ? ':' . $parts['port'] : '';
    return $parts['scheme'] . '://' . $parts['host'] . $port;
}

function moodle_sso_replace_origin(string $url, string $fromOrigin, string $toOrigin): string {
    return str_replace(rtrim($fromOrigin, '/'), rtrim($toOrigin, '/'), $url);
}

function moodle_sso_fetch_discovery(string $discoveryUrl): stdClass {
    $ctx = stream_context_create([
        'http' => [
            'timeout' => 15,
            'ignore_errors' => true,
        ],
    ]);
    $raw = @file_get_contents($discoveryUrl, false, $ctx);
    if ($raw === false || trim($raw) === '') {
        throw new RuntimeException("No se pudo leer discovery: $discoveryUrl");
    }
    $data = json_decode($raw, false);
    if (!$data instanceof stdClass) {
        throw new RuntimeException("Discovery inválido en $discoveryUrl");
    }
    return $data;
}

function moodle_sso_upsert_issuer(
    string $name,
    string $baseurl,
    string $clientId,
    string $clientSecret,
    string $loginPageName
): int {
    global $DB;

    $now = time();
    $record = $DB->get_record('oauth2_issuer', ['name' => $name]);
    $fields = [
        'name' => $name,
        'image' => '',
        'baseurl' => rtrim($baseurl, '/'),
        'clientid' => $clientId,
        'clientsecret' => $clientSecret,
        'loginscopes' => 'openid profile email',
        'loginscopesoffline' => 'openid profile email',
        'loginparams' => '',
        'loginparamsoffline' => '',
        'alloweddomains' => '',
        'scopessupported' => 'openid profile email',
        'enabled' => 1,
        'showonloginpage' => 1,
        'basicauth' => 0,
        'sortorder' => 0,
        'requireconfirmation' => 0,
        'servicetype' => 'custom',
        'loginpagename' => $loginPageName,
        'systememail' => '',
        'timemodified' => $now,
        'usermodified' => 2,
    ];

    if ($record) {
        $fields['id'] = $record->id;
        $DB->update_record('oauth2_issuer', (object) $fields);
        echo "Emisor actualizado (#{$record->id})\n";
        return (int) $record->id;
    }

    $fields['timecreated'] = $now;
    $id = (int) $DB->insert_record('oauth2_issuer', (object) $fields);
    echo "Emisor creado (#$id)\n";
    return $id;
}

function moodle_sso_replace_endpoints(int $issuerId, stdClass $discovery, string $publicOrigin, string $internalOrigin): void {
    global $DB;

    $DB->delete_records('oauth2_endpoint', ['issuerid' => $issuerId]);
    $now = time();

    foreach ($discovery as $key => $value) {
        if (!is_string($value)) {
            continue;
        }
        if (!str_ends_with($key, '_endpoint') && $key !== 'jwks_uri') {
            continue;
        }

        $url = $value;
        if ($key === 'authorization_endpoint') {
            $url = moodle_sso_replace_origin($url, $internalOrigin, $publicOrigin);
        } elseif (in_array($key, [
            'token_endpoint',
            'userinfo_endpoint',
            'introspection_endpoint',
            'jwks_uri',
            'end_session_endpoint',
        ], true)) {
            $url = moodle_sso_replace_origin($url, $publicOrigin, $internalOrigin);
        }

        $DB->insert_record('oauth2_endpoint', (object) [
            'timecreated' => $now,
            'timemodified' => $now,
            'usermodified' => 2,
            'name' => $key,
            'url' => $url,
            'issuerid' => $issuerId,
        ]);
        echo "endpoint $key: $url\n";
    }
}

function moodle_sso_replace_field_mappings(int $issuerId): void {
    global $DB;

    $DB->delete_records('oauth2_user_field_mapping', ['issuerid' => $issuerId]);
    $now = time();
    $mapping = [
        'given_name' => 'firstname',
        'family_name' => 'lastname',
        'email' => 'email',
        'preferred_username' => 'username',
    ];

    foreach ($mapping as $external => $internal) {
        $DB->insert_record('oauth2_user_field_mapping', (object) [
            'timemodified' => $now,
            'timecreated' => $now,
            'usermodified' => 2,
            'issuerid' => $issuerId,
            'externalfield' => $external,
            'internalfield' => $internal,
        ]);
    }
}

$publicIssuer = moodle_sso_env('MOODLE_KEYCLOAK_ISSUER')
    ?? moodle_sso_env('KEYCLOAK_ISSUER_URL')
    ?? 'http://localhost:8089/realms/edutrack';
$discoveryBase = moodle_sso_env('MOODLE_KEYCLOAK_DISCOVERY_INTERNAL')
    ?? moodle_sso_env('KEYCLOAK_INTERNAL_URL', 'http://keycloak:8080') . '/realms/edutrack';
$clientId = moodle_sso_env('MOODLE_KEYCLOAK_CLIENT_ID', 'moodle');
$clientSecret = moodle_sso_env('MOODLE_KEYCLOAK_CLIENT_SECRET', 'moodle-sso-secret-change-me');
$issuerName = moodle_sso_env('MOODLE_KEYCLOAK_ISSUER_NAME', 'EduTrack Keycloak');
$loginPageName = moodle_sso_env('MOODLE_KEYCLOAK_LOGIN_LABEL', 'Iniciar sesión con EduTrack');

$publicOrigin = moodle_sso_origin($publicIssuer);
$internalOrigin = moodle_sso_origin($discoveryBase);
$discoveryUrl = rtrim($discoveryBase, '/') . '/.well-known/openid-configuration';

echo "== SSO Keycloak en Moodle ==\n";
echo "issuer público: $publicIssuer\n";
echo "discovery: $discoveryUrl\n";
echo "client id: $clientId\n";

$discovery = moodle_sso_fetch_discovery($discoveryUrl);
$issuerId = moodle_sso_upsert_issuer($issuerName, $publicIssuer, $clientId, $clientSecret, $loginPageName);
moodle_sso_replace_endpoints($issuerId, $discovery, $publicOrigin, $internalOrigin);
moodle_sso_replace_field_mappings($issuerId);

$authMethods = array_values(array_filter(array_map('trim', explode(',', (string) get_config('core', 'auth')))));
if (!in_array('oauth2', $authMethods, true)) {
    array_unshift($authMethods, 'oauth2');
}
$authMethods = array_values(array_unique($authMethods));
set_config('auth', implode(',', $authMethods));
echo 'auth=' . get_config('core', 'auth') . "\n";

set_config('guestloginbutton', 0);
set_config('registerauth', '');
set_config('auth_instructions', '');

foreach ($DB->get_records('oauth2_issuer') as $row) {
    if ((int) $row->enabled !== 1) {
        continue;
    }
    if ((int) $row->requireconfirmation === 1) {
        $DB->set_field('oauth2_issuer', 'requireconfirmation', 0, ['id' => $row->id]);
        echo "issuer {$row->name} (#{$row->id}): requireconfirmation=0\n";
    }
}

echo "ok\n";
