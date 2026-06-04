<?php
/**
 * Corrige $CFG->wwwroot, sslproxy y reverseproxy en Moodle Bitnami ya instalado.
 *
 * Ejecutar dentro del contenedor moodle (o vía scripts/moodle-fix-production.sh).
 * Variable: MOODLE_PUBLIC_URL=https://moodle.edutrack-uy.com
 * Argumento opcional: php fix-moodle-config-production.php https://moodle.edutrack-uy.com
 */
$publicUrl = rtrim(getenv('MOODLE_PUBLIC_URL') ?: ($argv[1] ?? ''), '/');
if ($publicUrl === '' || !preg_match('#^https?://#i', $publicUrl)) {
    fwrite(STDERR, "Definí MOODLE_PUBLIC_URL o pasá la URL (ej. https://moodle.edutrack-uy.com)\n");
    exit(1);
}

$configFile = '/bitnami/moodle/config.php';
if (!is_readable($configFile)) {
    fwrite(STDERR, "No se encontró $configFile (¿dentro del contenedor moodle?)\n");
    exit(1);
}

$content = file_get_contents($configFile);
$original = $content;

// Overrides de desarrollo Bitnami (redirigen a localhost:8080).
$content = preg_replace(
    "/\s*\\\$_SERVER\\['HTTP_HOST'\\]\\s*=\\s*'[^']*';\\s*\\n/",
    "\n",
    $content
) ?? $content;

// Quitar TODAS las asignaciones wwwroot (Bitnami suele dejar localhost después del parche).
$content = preg_replace('/\$CFG->wwwroot\s*=\s*[^;]+;\s*\n?/', '', $content) ?? $content;

$wwwrootLine = '$CFG->wwwroot = ' . var_export($publicUrl, true) . ';';
$inserted = false;
foreach (
    [
        "require_once(dirname(__FILE__) . '/lib/setup.php');",
        "require_once(__DIR__ . '/lib/setup.php');",
    ] as $marker
) {
    if (str_contains($content, $marker)) {
        $content = str_replace($marker, $wwwrootLine . "\n\n" . $marker, $content);
        $inserted = true;
        break;
    }
}
if (!$inserted) {
    $content = rtrim($content) . "\n" . $wwwrootLine . "\n";
}

$content = setCfgBool($content, 'sslproxy', true);
$content = setCfgBool($content, 'reverseproxy', true);

if ($content === $original) {
    fwrite(STDERR, "config.php sin cambios (¿ya estaba correcto?)\n");
    exit(1);
}

file_put_contents($configFile, $content);

$check = file_get_contents($configFile);
$wwwrootCount = preg_match_all('/\$CFG->wwwroot\s*=/', $check);
if ($wwwrootCount !== 1) {
    fwrite(STDERR, "config.php tiene $wwwrootCount asignaciones wwwroot (esperado 1). Revisá el archivo.\n");
    exit(1);
}
if (preg_match('/\$CFG->wwwroot\s*=[^;]*localhost/i', $check)) {
    fwrite(STDERR, "config.php sigue referenciando localhost en wwwroot.\n");
    exit(1);
}

echo "ok wwwroot=$publicUrl sslproxy=1 reverseproxy=1\n";

function setCfgBool(string $content, string $key, bool $value): string
{
    $line = '$CFG->' . $key . ' = ' . ($value ? 'true' : 'false') . ';';
    if (preg_match('/\$CFG->' . preg_quote($key, '/') . '\s*=\s*[^;]+;/', $content)) {
        return preg_replace('/\$CFG->' . preg_quote($key, '/') . '\s*=\s*[^;]+;/', $line, $content, 1) ?? $content;
    }
    $insertBefore = "require_once(dirname(__FILE__) . '/lib/setup.php');";
    if (str_contains($content, $insertBefore)) {
        return str_replace($insertBefore, $line . "\n\n" . $insertBefore, $content);
    }
    return rtrim($content) . "\n" . $line . "\n";
}
