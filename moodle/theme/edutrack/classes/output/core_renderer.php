<?php
namespace theme_edutrack\output;

defined('MOODLE_INTERNAL') || die();

class core_renderer extends \theme_boost\output\core_renderer {
    public function favicon() {
        return $this->image_url('logo', 'theme');
    }
}
