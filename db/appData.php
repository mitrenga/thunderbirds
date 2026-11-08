<?php

class DataCommand {

  // Co se posílá při startu aplikace.
  //
  // - `screen`   – první snímek titulky složený z programu (M1)
  // - `maze`     – tabulky bludiště, panelu a znaků z programu (M2)
  // - `loading`  – loading screen pro LOAD TAPE (M1, pokud ho kazeta má)
  // - `tape`     – scénář pro LOAD TAPE (M1, z rozboru kazety v M0)
  // - `global`   – stav mise na prvním vstupu do místnosti (M2)
  //
  // Chybějící soubor dorazí jako null a aplikace to musí přežít.
  var $files = ['screen', 'loading', 'tape', 'maze', 'global'];

  public function execute($postData) {
    $result = [];
    foreach ($this->files as $file) {
      $fileName = 'data/'.$file.'.json';
      if (!is_file($fileName)) {
        // optional data files (those a later milestone adds) arrive as null
        $result[$file] = null;
        continue;
      }
      $dataJSON = file_get_contents($fileName);
      try {
        $result[$file] = json_decode($dataJSON, false, 512, JSON_THROW_ON_ERROR);
      }
      catch (\JsonException $exception) {
        $result[$file] = ['error' => ['message' => $exception->getMessage()]];
      }
    }

    $mysqli = new mysqli($GLOBALS['dbHostname'], $GLOBALS['dbUser'], $GLOBALS['dbPassword'], $GLOBALS['dbName']);
    $data = $mysqli->query('SELECT `score` FROM `rg_tb_hallOfFame` ORDER BY `score` DESC LIMIT 1');
    $mysqli->close();
    $result['hiScore'] = 0;
    if ($row = $data->fetch_object()) {
      $result['hiScore'] = $row->score;
    }

    return $result;
  } // execute

} // class DataCommand
