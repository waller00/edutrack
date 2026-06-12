<?php
/**
 * Habilita REST y autoriza el usuario del token del servicio EduTrack.
 *
 * Sin REST activo, /webservice/rest/server.php responde 403 vacío.
 * Con restrictedusers=1, el usuario del token debe estar en external_services_users.
 */
define('CLI_SCRIPT', true);

require('/bitnami/moodle/config.php');
require_once($CFG->libdir . '/externallib.php');

global $DB;

echo "== Servicios web base ==\n";
set_config('enablewebservices', 1);
$protocols = (string) (get_config('core', 'webserviceprotocols') ?: '');
if (!str_contains($protocols, 'rest')) {
    $protocols = trim($protocols === '' ? 'rest' : "$protocols,rest", ',');
    set_config('webserviceprotocols', $protocols);
}
echo 'enablewebservices=1 webserviceprotocols=' . get_config('core', 'webserviceprotocols') . "\n";

$requiredFunctions = [
    'core_user_get_users_by_field',
    'core_user_create_users',
    'core_user_update_users',
    'core_course_get_categories',
    'core_course_create_categories',
    'core_course_get_courses_by_field',
    'core_course_create_courses',
    'enrol_manual_enrol_users',
    'enrol_manual_unenrol_users',
    'core_enrol_get_enrolled_users',
    'core_webservice_get_site_info',
];

echo "== Servicio externo EduTrack ==\n";
$service = $DB->get_record('external_services', ['shortname' => 'edutrack']);
if (!$service) {
    $service = $DB->get_record('external_services', ['name' => 'EduTrack']);
}
if (!$service) {
    fwrite(STDERR, "No se encontró el servicio externo EduTrack.\n");
    exit(1);
}

if ((int) $service->enabled !== 1) {
    $DB->set_field('external_services', 'enabled', 1, ['id' => $service->id]);
    echo "servicio #{$service->id} habilitado\n";
}

$existing = $DB->get_records('external_services_functions', ['externalserviceid' => $service->id]);
$have = [];
foreach ($existing as $row) {
    $have[$row->functionname] = true;
}
foreach ($requiredFunctions as $function) {
    if (isset($have[$function])) {
        continue;
    }
    $DB->insert_record('external_services_functions', (object) [
        'externalserviceid' => $service->id,
        'functionname' => $function,
    ]);
    echo "función agregada: $function\n";
}

echo "== Token / usuario autorizado ==\n";
$token = $DB->get_record('external_tokens', ['externalserviceid' => $service->id], '*', IGNORE_MULTIPLE);
if (!$token) {
    fwrite(STDERR, "No hay token para el servicio EduTrack. Creá uno en Moodle y ponelo en MOODLE_WS_TOKEN.\n");
    exit(1);
}

$user = $DB->get_record('user', ['id' => $token->userid], '*', MUST_EXIST);
if ((int) $user->deleted === 1 || (int) $user->suspended === 1 || (int) $user->confirmed !== 1) {
    fwrite(STDERR, "El usuario del token (#{$user->id} {$user->username}) no está activo.\n");
    exit(1);
}

if ((int) $service->restrictedusers === 1) {
    if (!$DB->record_exists('external_services_users', [
        'externalserviceid' => $service->id,
        'userid' => $user->id,
    ])) {
        $DB->insert_record('external_services_users', (object) [
            'externalserviceid' => $service->id,
            'userid' => $user->id,
            'timecreated' => time(),
        ]);
        echo "usuario autorizado para el servicio: #{$user->id} {$user->username}\n";
    } else {
        echo "usuario ya autorizado: #{$user->id} {$user->username}\n";
    }
} else {
    echo "servicio sin restricción de usuarios\n";
}

echo "token activo para servicio #{$service->id}, usuario #{$user->id}\n";

set_config('sendcoursewelcomemessage', 0, 'enrol_manual');
$manualInstances = $DB->get_records('enrol', ['enrol' => 'manual']);
foreach ($manualInstances as $instance) {
    if ((int) ($instance->customint1 ?? 0) !== 0) {
        $DB->set_field('enrol', 'customint1', 0, ['id' => $instance->id]);
        echo "manual enrol #{$instance->id}: welcome email desactivado\n";
    }
}

echo "ok\n";
