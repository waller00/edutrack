<?php
defined('MOODLE_INTERNAL') || die();

$THEME->name = 'edutrack';
$THEME->parents = ['boost'];
$THEME->sheets = [];
$THEME->editor_sheets = [];
$THEME->usefallback = true;
$THEME->scss = function($theme) {
    return theme_edutrack_get_main_scss_content($theme);
};
$THEME->prescsscallback = 'theme_edutrack_get_pre_scss';
$THEME->extrascsscallback = 'theme_edutrack_get_extra_scss';
$THEME->layouts = [
    'base' => ['file' => 'drawers.php', 'regions' => []],
    'standard' => ['file' => 'drawers.php', 'regions' => ['side-pre'], 'defaultregion' => 'side-pre'],
    'course' => ['file' => 'drawers.php', 'regions' => ['side-pre'], 'defaultregion' => 'side-pre'],
    'coursecategory' => ['file' => 'drawers.php', 'regions' => ['side-pre'], 'defaultregion' => 'side-pre'],
    'incourse' => ['file' => 'drawers.php', 'regions' => ['side-pre'], 'defaultregion' => 'side-pre'],
    'frontpage' => ['file' => 'drawers.php', 'regions' => ['side-pre'], 'defaultregion' => 'side-pre'],
    'admin' => ['file' => 'drawers.php', 'regions' => ['side-pre'], 'defaultregion' => 'side-pre'],
    'mydashboard' => ['file' => 'drawers.php', 'regions' => ['side-pre'], 'defaultregion' => 'side-pre'],
    'mypublic' => ['file' => 'drawers.php', 'regions' => ['side-pre'], 'defaultregion' => 'side-pre'],
    'login' => ['file' => 'login.php', 'regions' => []],
    'popup' => ['file' => 'columns1.php', 'regions' => []],
    'frametop' => ['file' => 'columns1.php', 'regions' => []],
    'embedded' => ['file' => 'embedded.php', 'regions' => []],
    'maintenance' => ['file' => 'maintenance.php', 'regions' => []],
    'print' => ['file' => 'columns1.php', 'regions' => []],
    'redirect' => ['file' => 'embedded.php', 'regions' => []],
    'report' => ['file' => 'drawers.php', 'regions' => ['side-pre'], 'defaultregion' => 'side-pre'],
    'secure' => ['file' => 'secure.php', 'regions' => ['side-pre'], 'defaultregion' => 'side-pre'],
];
