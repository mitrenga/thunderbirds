SELECT `ndx`, `name`, `score`, `created`
FROM `rg_tb_hallOfFame`
ORDER BY `ndx` DESC
LIMIT :limit
