# Rendering & Export

Export .mmark animations to MP4 video.

## Installation

```bash
npm install motionmark
```

## Basic Usage

```bash
# Render to MP4
npx mmark render animation.mmark -o output.mp4

# Specify output directory
npx mmark render animation.mmark -o videos/my-animation.mp4
```

## CLI Options

| Option | Description | Default |
|--------|-------------|---------|
| `-o, --output` | Output file path | `output.mp4` |
| `--encoder` | Encoder: `ffmpeg`, `wasm`, `auto` | `auto` |
| `--fps` | Override FPS | From .mmark header |
| `--width` | Override width | From .mmark header |
| `--height` | Override height | From .mmark header |
| `--fonts` | Path to fonts directory | None |

## Encoders

### ffmpeg (recommended)

Best quality output. Requires ffmpeg installed on your system.

```bash
npx mmark render animation.mmark -o output.mp4 --encoder ffmpeg
```

Install ffmpeg:
- **macOS**: `brew install ffmpeg`
- **Ubuntu/Debian**: `sudo apt install ffmpeg`
- **Windows**: Download from https://ffmpeg.org/download.html

### wasm (fallback)

No external dependencies. Built-in WebAssembly encoder.

```bash
npx mmark render animation.mmark -o output.mp4 --encoder wasm
```

- Works everywhere without setup
- Slightly lower quality than ffmpeg
- Good for quick previews

### auto (default)

Tries ffmpeg first, falls back to wasm if unavailable.

```bash
npx mmark render animation.mmark -o output.mp4 --encoder auto
```

## Fonts

Custom fonts must be registered before rendering.

```bash
npx mmark render animation.mmark -o output.mp4 --fonts ./fonts
```

Font directory should contain .ttf or .otf files. Family names are derived from filenames:

| Filename | Font Family |
|----------|-------------|
| `Roboto-Regular.ttf` | `Roboto` |
| `OpenSans-Bold.ttf` | `OpenSans` |
| `Inter.otf` | `Inter` |

If a font in your .mmark file isn't found, rendering will use a fallback system font.

## Batch Export

Export multiple .mmark files at once.

**Bash/macOS/Linux:**
```bash
for f in *.mmark; do
  npx mmark render "$f" -o "output/$(basename "$f" .mmark).mp4"
done
```

**PowerShell/Windows:**
```powershell
Get-ChildItem *.mmark | ForEach-Object {
  npx mmark render $_.FullName -o "output/$($_.BaseName).mp4"
}
```

## Troubleshooting

### Fonts not rendering correctly

1. Check font file exists in `--fonts` directory
2. Verify filename matches font family in .mmark (case-sensitive)
3. Use common fonts like `Roboto`, `Inter`, `Open Sans` for compatibility

### Video looks pixelated

1. Use `--encoder ffmpeg` for better quality
2. Check canvas size in .mmark header isn't too small
3. Ensure fps is at least 24

### ffmpeg not found

Install ffmpeg or use `--encoder wasm` as fallback.

### Missing elements in export

1. Check element lifetime covers the full animation
2. Verify all referenced images exist
3. Check for syntax errors in .mmark file

## Examples

```bash
# Basic render
npx mmark render intro.mmark -o intro.mp4

# High quality with ffmpeg
npx mmark render intro.mmark -o intro.mp4 --encoder ffmpeg

# Custom resolution
npx mmark render intro.mmark -o intro.mp4 --width 1920 --height 1080

# With fonts
npx mmark render intro.mmark -o intro.mp4 --fonts ./my-fonts

# Override FPS
npx mmark render intro.mmark -o intro.mp4 --fps 60
```
