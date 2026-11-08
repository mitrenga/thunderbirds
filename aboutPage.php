<?php

require_once 'app/svision/php/abstractAboutPage.php';

/**
 * The /about page: the story of the original Thunderbirds and of this remake.
 * Skeleton text; the final content comes with M7.
 */
class AboutPage extends AbstractAboutPage {

  protected function aboutData() {
    return [
      'image' => 'images/cover.png',
      'sections' => [
        [
          'heading' => 'The original game (1985)',
          'html' =>
            '<p>Thunderbirds was released by Firebird Software in 1985 for the ZX Spectrum, a licensed '.
            'game of the Gerry Anderson television series. International Rescue is called out, and two '.
            'of its craft have to work their way through a maze by turns, each clearing the obstacles '.
            'that block the way of the other.</p>',
        ],
        [
          'heading' => 'This remake',
          'html' =>
            '<p>This is a faithful remake, rewritten for the web browser rather than emulated. The graphics '.
            'and the rules are taken out of the original program, not redrawn and not copied from a wiki — '.
            'where a rule cannot be shown, it is left as an open question rather than guessed. Even the '.
            'frame rate is the Spectrum\'s own 50.08 Hz, and the attribute clash of the hardware is '.
            'reproduced instead of cleaned up.</p>'.
            '<p>It is being built in milestones: the tape has been taken apart — a loader in four layers, '.
            'encrypted twice — the loading screen is the real one loaded byte by byte off it, the title is '.
            'the original\'s own picture composed out of the program, and the original\'s character engine '.
            'has been ported routine by routine, so the panel and all 97 rooms of the tomb, the spiders\' '.
            'threads included, are drawn exactly as the original draws them. Nothing moves yet, because how '.
            'the two Thunderbirds move has not been read out of the program so far. That is the method, not '.
            'an oversight.</p>'.
            '<p>It runs directly in your browser — nothing to install, nothing to download. Keyboard, '.
            'touch controls and gamepads are supported.</p>'.$this->installNote(),
        ],
        [
          'heading' => 'Other games',
          'html' =>
            '<p>This remake is one of a growing collection of classic games from the 8-bit and 16-bit era '.
            '— ZX Spectrum, Commodore 64, arcade and more — rebuilt faithfully on the same library and '.
            'playable in your browser, free of charge. Browse the whole collection at '.
            '<a href="https://retrogames.free/" target="_blank" rel="noopener">retrogames.free</a>.</p>',
        ],
      ],
      'links' => [
        ['label' => 'Thunderbirds at Spectrum Computing', 'url' => 'https://spectrumcomputing.co.uk/entry/5253/'],
        ['label' => 'Thunderbirds at World of Spectrum', 'url' => 'https://worldofspectrum.org/software?id=0005253'],
      ],
      'footer' =>
        '<p>An unofficial fan remake. The original game and its artwork belong to their authors '.
        '(Firebird Software). Thunderbirds is a trademark of its respective owners. '.
        'The remake\'s source code is licensed under <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/" target="_blank" rel="noopener">CC BY-NC-SA 4.0</a>.</p>',
    ];
  } // aboutData

} // AboutPage
