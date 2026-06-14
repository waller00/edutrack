<?php
/**
 * Ajusta SSO OAuth2 y correo de Moodle para alinearlo con EduTrack.
 *
 * - Desactiva confirmación por correo en login OAuth (Keycloak ya verifica identidad).
 * - Confirma usuarios oauth2 existentes que quedaron pendientes.
 * - Configura SMTP de Moodle con las mismas variables que usa EduTrack (SMTP_*).
 *
 * Ejecutar vía scripts/moodle-config-auth-email.sh
 */
define('CLI_SCRIPT', true);

require('/bitnami/moodle/config.php');
require_once($CFG->libdir . '/clilib.php');

global $DB;

function moodle_cfg_set(string $name, ?string $value): void {
    if ($value === null || $value === '') {
        unset_config($name);
        echo "unset $name\n";
        return;
    }
    set_config($name, $value);
    echo "set $name\n";
}

function moodle_smtp_secure(string $port): string {
    if ($port === '465') {
        return 'ssl';
    }
    if ($port === '587' || $port === '2525') {
        return 'tls';
    }
    return '';
}

echo "== OAuth2: confiar en verificación del IdP (sin re-confirmar correo) ==\n";
$issuers = $DB->get_records('oauth2_issuer');
foreach ($issuers as $issuer) {
    if ((int) $issuer->enabled !== 1) {
        continue;
    }
    if ((int) $issuer->requireconfirmation === 1) {
        $DB->set_field('oauth2_issuer', 'requireconfirmation', 0, ['id' => $issuer->id]);
        echo "issuer {$issuer->name} (#{$issuer->id}): requireconfirmation=0\n";
    } else {
        echo "issuer {$issuer->name} (#{$issuer->id}): ya sin confirmación extra\n";
    }
}

echo "== Usuarios oauth2 pendientes: marcar como confirmados ==\n";
$pending = $DB->get_records_select(
    'user',
    'deleted = 0 AND auth = :auth AND confirmed = 0',
    ['auth' => 'oauth2']
);
foreach ($pending as $user) {
    $DB->set_field('user', 'confirmed', 1, ['id' => $user->id]);
    echo "confirmed user #{$user->id} {$user->email}\n";
}
if (!$pending) {
    echo "ningún usuario oauth2 pendiente\n";
}

echo "== SMTP (mismo backend que EduTrack) ==\n";
$smtpHost = trim((string) (getenv('SMTP_HOST') ?: ''));
$smtpPort = trim((string) (getenv('SMTP_PORT') ?: '587'));
$smtpUser = trim((string) (getenv('SMTP_USER') ?: ''));
$smtpPass = (string) (getenv('SMTP_PASS') ?: '');
$smtpFrom = trim((string) (getenv('SMTP_FROM') ?: ''));

if ($smtpHost === '') {
    echo "AVISO: SMTP_HOST vacío; Moodle seguirá sin poder enviar correos de auth/email.\n";
} else {
    moodle_cfg_set('smtphosts', $smtpHost . ':' . $smtpPort);
    moodle_cfg_set('smtpuser', $smtpUser);
    moodle_cfg_set('smtppass', $smtpPass);
    moodle_cfg_set('smtpsecure', moodle_smtp_secure($smtpPort));
    moodle_cfg_set('smtpauthtype', 'LOGIN');
    moodle_cfg_set('smtpmaxbulk', '1');

    if ($smtpFrom !== '') {
        if (preg_match('/<([^>]+)>/', $smtpFrom, $matches)) {
            $fromEmail = trim($matches[1]);
            $fromName = trim(preg_replace('/<[^>]+>/', '', $smtpFrom), " \t'\"");
        } else {
            $fromEmail = $smtpFrom;
            $fromName = format_string(get_site()->fullname, true);
        }
        moodle_cfg_set('noreplyaddress', $fromEmail);
        moodle_cfg_set('supportemail', $fromEmail);
        if ($fromName !== '') {
            moodle_cfg_set('supportname', $fromName);
        }
    }
}

echo "ok\n";
