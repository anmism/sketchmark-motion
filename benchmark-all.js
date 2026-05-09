const { compileMotionMark } = require('./dist/packages/parser/src');
const { exportToMp4 } = require('./dist/packages/exporter/src');
const fs = require('fs');
const path = require('path');

// Force garbage collection if available
const gc = global.gc || (() => {});

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Create import resolver for a given directory
function createImportResolver(dir) {
  return (importPath) => {
    const fullPath = path.resolve(dir, importPath);
    if (fs.existsSync(fullPath)) {
      return fs.readFileSync(fullPath, 'utf-8');
    }
    return undefined;
  };
}

async function benchmark() {
  console.log('=== MOTIONMARK BENCHMARK ===\n');

  // Skip system fonts file (requires fonts to be installed)
  const skipFiles = ['14-@system.mmark'];

  const exampleFiles = fs.readdirSync('examples/syntax')
    .filter(f => f.endsWith('.mmark') && !f.includes('shared') && !skipFiles.includes(f))
    .sort();

  console.log(`Found ${exampleFiles.length} example files\n`);

  const results = [];

  for (let i = 0; i < exampleFiles.length; i++) {
    const file = exampleFiles[i];
    const filePath = path.join('examples/syntax', file);
    const source = fs.readFileSync(filePath, 'utf-8');
    const inputDir = path.dirname(path.resolve(filePath));

    process.stdout.write(`[${i + 1}/${exampleFiles.length}] ${file}... `);

    try {
      const scene = compileMotionMark(source, { resolveImport: createImportResolver(inputDir) });
      const elementCount = scene.elements.length;

      const startRender = Date.now();
      let frameCount = 0;

      await exportToMp4(scene, `output/bench-${file.replace('.mmark', '.mp4')}`, {
        encoder: 'ffmpeg',
        durationMs: 4000,
        onProgress: (p) => { frameCount = p.frame; }
      });

      const elapsed = Date.now() - startRender;
      const fps = frameCount / (elapsed / 1000);

      results.push({
        file,
        elements: elementCount,
        time: elapsed,
        frames: frameCount,
        fps,
        status: 'ok'
      });

      console.log(`✓ ${elementCount} elements, ${(elapsed/1000).toFixed(1)}s, ${fps.toFixed(1)} FPS`);

    } catch (err) {
      results.push({ file, error: err.message, status: 'error' });
      console.log(`✗ ${err.message.split('\n')[0]}`);
    }

    // Allow GPU memory to recover between renders
    gc();
    await sleep(100);
  }

  // Summary
  console.log('\n' + '═'.repeat(75));
  console.log('SUMMARY');
  console.log('═'.repeat(75) + '\n');

  const successful = results.filter(r => r.status === 'ok');
  const failed = results.filter(r => r.status === 'error');

  // Results table
  console.log('File                              Elements    Time     FPS');
  console.log('─'.repeat(60));

  for (const r of successful.sort((a, b) => b.fps - a.fps)) {
    console.log(
      `${r.file.padEnd(34)} ${String(r.elements).padStart(6)}    ${(r.time/1000).toFixed(1).padStart(5)}s   ${r.fps.toFixed(1).padStart(5)}`
    );
  }

  console.log('─'.repeat(60));

  if (successful.length > 0) {
    const totalTime = successful.reduce((sum, r) => sum + r.time, 0);
    const totalFrames = successful.reduce((sum, r) => sum + r.frames, 0);
    const avgFps = totalFrames / (totalTime / 1000);

    console.log(`\nSuccessful: ${successful.length}/${results.length} files`);
    console.log(`Total frames: ${totalFrames}`);
    console.log(`Total time: ${(totalTime/1000).toFixed(1)}s`);
    console.log(`Average FPS: ${avgFps.toFixed(1)}`);
  }

  if (failed.length > 0) {
    console.log(`\nFailed (${failed.length}):`);
    for (const r of failed) {
      console.log(`  ${r.file}: ${r.error.split('\n')[0]}`);
    }
  }
}

benchmark().catch(console.error);
