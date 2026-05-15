<?php
/**
 * Parche para Bitnami Moodle en Docker: $CFG->wwwroot debe seguir el HTTP_HOST de cada petición.
 * Así el navegador puede usar http://localhost:8080 y EduTrack (auth) puede usar http://moodle:8080
 * en la red Docker sin redirecciones a localhost dentro del contenedor auth.
 *
 * Copiar al contenedor y ejecutar: docker cp scripts/patch-moodle-wwwroot-dynamic.php edutrack-moodle-1:/tmp/p.php && docker exec edutrack-moodle-1 php /tmp/p.php
 * Luego: docker exec edutrack-moodle-1 php /opt/bitnami/moodle/admin/cli/purge_caches.php
 */
$configFile = '/bitnami/moodle/config.php';
$t = file_get_contents($configFile);
$t = str_replace(
    '$_SERVER[\'HTTP_HOST\'] = \'127.0.0.1:8080\';',
    '$_SERVER[\'HTTP_HOST\'] = \'localhost:8080\';',
    $t,
    $c1
);
$t = str_replace(
    '$CFG->wwwroot   = \'https://\' . \'localhost:8080\';',
    '$CFG->wwwroot   = \'https://\' . $_SERVER[\'HTTP_HOST\'];',
    $t,
    $c2
);
$t = str_replace(
    '$CFG->wwwroot   = \'http://\' . \'localhost:8080\';',
    '$CFG->wwwroot   = \'http://\' . $_SERVER[\'HTTP_HOST\'];',
    $t,
    $c3
);
if ($c1 !== 1 || $c2 !== 1 || $c3 !== 1) {
    fwrite(STDERR, "reemplazos: $c1 $c2 $c3 (esperado 1 1 1)\n");
    exit(1);
}
file_put_contents($configFile, $t);
echo "ok\n";
