const fs = require('fs');

// Un JSON roto se aparta antes de cargar valores por defecto: el primer guardado lo pisaría y no quedaría nada que rescatar.
// Solo SyntaxError: un archivo bloqueado o sin permisos no está dañado.
module.exports = function apartarDanado(file, err) {
  if (err.name !== 'SyntaxError') return;
  const destino = `${file}.danado-${Date.now()}`;
  try { fs.renameSync(file, destino); console.error('[datos] Archivo dañado guardado como', destino); }
  catch (e) { console.error('[datos] No se pudo apartar', file, '-', e.message); }
};
