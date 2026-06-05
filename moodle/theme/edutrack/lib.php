<?php
defined('MOODLE_INTERNAL') || die();

function theme_edutrack_get_main_scss_content($theme) {
    global $CFG;

    $scss = '';
    $boostpath = $CFG->dirroot . '/theme/boost/scss';
    $edutrackpath = $CFG->dirroot . '/theme/edutrack/scss';

    $scss .= file_get_contents($boostpath . '/preset/default.scss');
    $scss .= "\n" . file_get_contents($edutrackpath . '/post.scss');

    return $scss;
}

function theme_edutrack_get_pre_scss($theme) {
    global $CFG;
    return file_get_contents($CFG->dirroot . '/theme/edutrack/scss/pre.scss');
}

function theme_edutrack_get_extra_scss($theme) {
    return '';
}

function theme_edutrack_get_precompiled_css() {
    global $CFG;
    return file_get_contents($CFG->dirroot . '/theme/boost/style/moodle.css');
}
