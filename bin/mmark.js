#!/usr/bin/env node

const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
const command = args[0];

function printHelp() {
  console.log(`
motionmark - Markdown for Motion Graphics

Usage:
  mmark render <input.mmark> <output.mp4> [options]
  mmark preview <input.mmark> [--port <number>]
  mmark parse <input.mmark>
  mmark validate <input.mmark>
  mmark help

Commands:
  render     Render .mmark file to MP4 video
  preview    Open live preview in browser
  parse      Parse .mmark file and output JSON IR
  validate   Validate .mmark file syntax
  help       Show this help message

Render Options:
  --fps <number>       Frames per second (default: 30)
  --duration <time>    Duration (e.g., 5s, 10s)
  --size <preset>      Output size: 720p, 1080p, 4k (default: from file)
  --width <pixels>     Custom width
  --height <pixels>    Custom height
  --encoder <type>     Encoder: ffmpeg, wasm, auto (default: auto)

Preview Options:
  --port <number>      Port number (default: 5175)

Examples:
  mmark render intro.mmark out/intro.mp4 --fps 30 --duration 5s
  mmark render intro.mmark out/intro.mp4 --encoder ffmpeg
  mmark preview animation.mmark
  mmark preview animation.mmark --port 3000
  mmark parse animation.mmark > output.json
  mmark validate myfile.mmark
`);
}

function parseArgs(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const value = args[i + 1];
      options[key] = value;
      i++;
    } else if (!options.input) {
      options.input = args[i];
    } else if (!options.output) {
      options.output = args[i];
    }
  }
  return options;
}

async function main() {
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    process.exit(0);
  }

  if (command === 'render') {
    const options = parseArgs(args.slice(1));

    if (!options.input || !options.output) {
      console.error('Error: render requires input and output files');
      console.error('Usage: mmark render <input.mmark> <output.mp4> [options]');
      process.exit(1);
    }

    try {
      const { compileMotionMark } = require('../dist/packages/parser/src');
      const { exportToMp4, loadFontsFromDirectory } = require('../dist/packages/exporter/src');

      // Load fonts from fonts/ folder relative to input file
      const inputDir = path.dirname(path.resolve(options.input));
      const fontsDir = path.join(inputDir, 'fonts');
      if (fs.existsSync(fontsDir)) {
        const registered = loadFontsFromDirectory(fontsDir);
        if (registered.length > 0) {
          console.log(`Loaded ${registered.length} font(s) from fonts/`);
        }
      }
      // Also try project root fonts/
      const rootFontsDir = path.join(process.cwd(), 'fonts');
      if (rootFontsDir !== fontsDir && fs.existsSync(rootFontsDir)) {
        const registered = loadFontsFromDirectory(rootFontsDir);
        if (registered.length > 0) {
          console.log(`Loaded ${registered.length} font(s) from ./fonts/`);
        }
      }

      const input = fs.readFileSync(options.input, 'utf-8');

      // Resolve imports relative to the input file
      const resolveImport = (importPath) => {
        const fullPath = path.resolve(inputDir, importPath);
        if (fs.existsSync(fullPath)) {
          return fs.readFileSync(fullPath, 'utf-8');
        }
        return undefined;
      };

      const scene = compileMotionMark(input, { resolveImport });

      const exportOptions = { basePath: inputDir };
      if (options.fps) exportOptions.fps = parseInt(options.fps, 10);
      if (options.duration) {
        const match = options.duration.match(/^(\d+(?:\.\d+)?)(s|ms)?$/);
        if (match) {
          const value = parseFloat(match[1]);
          const unit = match[2] || 's';
          exportOptions.duration = unit === 'ms' ? value : value * 1000;
        }
      }
      if (options.width) exportOptions.width = parseInt(options.width, 10);
      if (options.height) exportOptions.height = parseInt(options.height, 10);
      if (options.size) {
        const sizes = {
          '720p': { width: 1280, height: 720 },
          '1080p': { width: 1920, height: 1080 },
          '4k': { width: 3840, height: 2160 }
        };
        if (sizes[options.size]) {
          Object.assign(exportOptions, sizes[options.size]);
        }
      }
      if (options.encoder) {
        if (['ffmpeg', 'wasm', 'auto'].includes(options.encoder)) {
          exportOptions.encoder = options.encoder;
        } else {
          console.error('Invalid encoder. Use: ffmpeg, wasm, or auto');
          process.exit(1);
        }
      }

      await exportToMp4(scene, options.output, exportOptions);
      console.log(`Rendered: ${options.output}`);
    } catch (err) {
      console.error('Render error:', err.message);
      process.exit(1);
    }
  }

  else if (command === 'parse') {
    const inputFile = args[1];

    if (!inputFile) {
      console.error('Error: parse requires an input file');
      console.error('Usage: mmark parse <input.mmark>');
      process.exit(1);
    }

    try {
      const { compileMotionMark } = require('../dist/packages/parser/src');

      const input = fs.readFileSync(inputFile, 'utf-8');
      const inputDir = path.dirname(path.resolve(inputFile));

      // Resolve imports relative to the input file
      const resolveImport = (importPath) => {
        const fullPath = path.resolve(inputDir, importPath);
        if (fs.existsSync(fullPath)) {
          return fs.readFileSync(fullPath, 'utf-8');
        }
        return undefined;
      };

      const scene = compileMotionMark(input, { resolveImport });

      console.log(JSON.stringify(scene, null, 2));
    } catch (err) {
      console.error('Parse error:', err.message);
      process.exit(1);
    }
  }

  else if (command === 'preview') {
    const options = parseArgs(args.slice(1));

    if (!options.input) {
      console.error('Error: preview requires an input file');
      console.error('Usage: mmark preview <input.mmark> [--port <number>]');
      process.exit(1);
    }

    const port = options.port ? parseInt(options.port, 10) : 5175;
    const previewScript = path.join(__dirname, '..', 'scripts', 'preview-server.js');
    const { spawn } = require('child_process');

    const child = spawn(process.execPath, [previewScript, options.input, '--port', String(port)], {
      stdio: 'inherit',
      cwd: process.cwd()
    });

    // Open browser after a short delay to let server start
    setTimeout(() => {
      const url = `http://127.0.0.1:${port}/`;
      const platform = process.platform;
      const openCmd = platform === 'win32' ? 'start' : platform === 'darwin' ? 'open' : 'xdg-open';
      const openArgs = platform === 'win32' ? ['', url] : [url];
      spawn(openCmd, openArgs, { shell: true, stdio: 'ignore' });
    }, 500);

    child.on('close', (code) => process.exit(code || 0));
  }

  else if (command === 'validate') {
    const inputFile = args[1];

    if (!inputFile) {
      console.error('Error: validate requires an input file');
      console.error('Usage: mmark validate <input.mmark>');
      process.exit(1);
    }

    try {
      const { compileMotionMark } = require('../dist/packages/parser/src');
      const { validateMmark } = require('../dist/packages/validator/src');

      const input = fs.readFileSync(inputFile, 'utf-8');
      const result = validateMmark(input);

      if (result.ok) {
        console.log('Valid!');
        process.exit(0);
      } else {
        console.log('Validation errors:');
        for (const issue of result.issues) {
          console.log(`  - ${issue.path}: ${issue.message}`);
        }
        process.exit(1);
      }
    } catch (err) {
      console.error('Validation error:', err.message);
      process.exit(1);
    }
  }

  else {
    console.error(`Unknown command: ${command}`);
    printHelp();
    process.exit(1);
  }
}

main();
