<?php
  $appName = 'THUNDERBIRDS';
  $appDescription = 'Play THUNDERBIRDS online for free in your browser. Faithful remake of the 1985 Firebird ZX Spectrum game, no download required.';
  $appPrefix = 'tb';
  $appNoscript =
    '<h1>THUNDERBIRDS</h1>'.
    '<p>Thunderbirds is the 1985 ZX Spectrum game published by Firebird, based on the television '.
    'series. International Rescue is called out, and its craft have to work their way through '.
    'the maze by turns, each clearing the way for the other.</p>'.
    '<p>This is a faithful remake that runs directly in your web browser. '.
    'There is nothing to install and nothing to download — just open the page and play. '.
    'Please enable JavaScript to start the game.</p>'.
    '<p><a href="about">More about Thunderbirds and this remake</a></p>';
  $appOpenGraph = [
    'image' => 'images/poster.png',
  ];
  $appJsonLd = [
    'genre' => 'Action',
    'isBasedOn' => [
      '@type' => 'VideoGame',
      'name' => 'Thunderbirds',
      'publisher' => [
        ['@type' => 'Organization', 'name' => 'Firebird Software'],
      ],
      'datePublished' => '1985',
      'gamePlatform' => 'ZX Spectrum',
    ],
  ];
  require_once 'config/config.php';
  require_once 'app/svision/php/main.php';
