#!/bin/bash
# Setup script: Copy GUI files from desktop version

set -e

echo "🎬 VidLet Web - Setup Script"
echo "============================="
echo ""

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
  echo "❌ Error: Run this script from vidlet-web/ directory"
  exit 1
fi

# Check if parent directory has the desktop version
if [ ! -d "../src/gui" ]; then
  echo "❌ Error: Desktop version not found at ../src/gui"
  echo "   Make sure vidlet-web/ is inside the VidLet/ directory"
  exit 1
fi

echo "🔗 Creating symlinks to desktop files (single source of truth)..."
echo ""

# Create symlinks instead of copying
echo "  ✓ Linking GUI files..."
ln -sf ../src/gui/css public/css
ln -sf ../src/gui/js public/js
ln -sf ../src/icons public/icons
ln -sf ../src/gui/vidlet.html public/vidlet.html

echo "  ✓ Linking shared libraries..."
mkdir -p lib
ln -sf ../src/lib/ffmpeg.ts lib/ffmpeg.ts
ln -sf ../src/lib/paths.ts lib/paths.ts
ln -sf ../src/lib/logger.ts lib/logger.ts

echo "  ✓ Linking video tools..."
ln -sf ../src/tools lib/tools

echo ""
echo "✅ Setup complete!"
echo ""
echo "🔗 Symlinks created (pointing to desktop version):"
echo "   • public/css       -> ../src/gui/css"
echo "   • public/js        -> ../src/gui/js"
echo "   • public/icons     -> ../src/icons"
echo "   • lib/ffmpeg.ts    -> ../src/lib/ffmpeg.ts"
echo "   • lib/tools        -> ../src/tools"
echo ""
echo "💡 Benefits: Edit desktop files, changes appear in web automatically!"
echo ""
echo "🚀 Next steps:"
echo "   1. npm install"
echo "   2. npm run dev      (local development)"
echo "   3. npm run deploy   (deploy to Vercel)"
echo ""
echo "📖 See README.md for detailed instructions"
