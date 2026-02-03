const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function copyFile(src, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(
    path.join(root, src),
    path.join(root, destDir, path.basename(src))
  );
}

function copyDir(src, dest) {
  fs.cpSync(path.join(root, src), path.join(root, dest), { recursive: true });
}

// src/renderer/index.html, styles.css → dist/renderer/
copyFile('src/renderer/index.html', 'dist/renderer');
copyFile('src/renderer/styles.css', 'dist/renderer');

// src/renderer/assets/ → dist/renderer/assets/
copyDir('src/renderer/assets', 'dist/renderer/assets');

// vendor libs → dist/renderer/lib/
const libDir = 'dist/renderer/lib';
copyFile('node_modules/xterm/css/xterm.css', libDir);
copyFile('node_modules/xterm/lib/xterm.js', libDir);
copyFile('node_modules/xterm-addon-fit/lib/xterm-addon-fit.js', libDir);
copyFile('node_modules/marked/lib/marked.umd.js', libDir);
