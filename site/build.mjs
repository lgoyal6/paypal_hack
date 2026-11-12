import { cpSync, mkdirSync } from 'node:fs';
mkdirSync('dist', { recursive: true });
cpSync('public', 'dist', { recursive: true });
cpSync('node_modules/ag-grid-community/dist/ag-grid-community.min.js', 'dist/ag-grid.js');
