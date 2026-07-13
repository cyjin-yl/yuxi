#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, basename } from 'node:path';

const srcDir = 'public/graphs/src';
const outDir = 'public/graphs';

function renderDot(dotSrc) {
  return new Promise((resolve, reject) => {
    const proc = spawn('dot', ['-Tsvg']);
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => stdout += d.toString());
    proc.stderr.on('data', d => stderr += d.toString());
    proc.on('close', code => {
      if (code === 0) resolve(stdout);
      else reject(stderr);
    });
    proc.stdin.write(dotSrc);
    proc.stdin.end();
  });
}

try {
  await mkdir(srcDir, { recursive: true });
  await mkdir(outDir, { recursive: true });

  const files = await readdir(srcDir);
  const dotFiles = files.filter(f => f.endsWith('.dot'));

  if (dotFiles.length === 0) {
    console.log('No .dot files found in', srcDir);
    process.exit(0);
  }

  for (const file of dotFiles) {
    const srcPath = join(srcDir, file);
    const dotSrc = await readFile(srcPath, 'utf8');
    const svgName = basename(file, '.dot') + '.svg';
    const outPath = join(outDir, svgName);

    try {
      const svg = await renderDot(dotSrc);
      await writeFile(outPath, svg);
      console.log(`✓ ${file} → ${svgName}`);
    } catch (err) {
      console.error(`✗ ${file}:`, err);
    }
  }

  console.log(`\nDone. ${dotFiles.length} graph(s) rendered.`);
} catch (err) {
  console.error('Error:', err.message);
  process.exit(1);
}
