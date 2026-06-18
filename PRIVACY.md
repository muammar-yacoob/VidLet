# Privacy Policy for VidLet

**Last updated: June 2026**

## Core Principle

VidLet processes everything locally. Your videos never leave your machine.

## Data Collection

- We do not collect, transmit, or store any personal data
- No analytics, tracking, or telemetry
- No user accounts or registration
- No cookies

## Video Processing

- All video processing runs locally via FFmpeg on your machine
- Processed files are saved to a `VidLet` subdirectory next to the input file
- No temporary files are retained after processing completes

## Auto-Captions (whisper.cpp)

- Speech-to-text transcription runs entirely on your machine using whisper.cpp
- The whisper.cpp binary and language model are downloaded once from GitHub/HuggingFace and cached locally at `~/.config/vidlet/`
- Audio is extracted locally, transcribed locally, and subtitles are burned in locally
- No audio or transcript data is sent to any server

## Voice Cleanup (DeepFilterNet)

- Neural denoising runs locally via the DeepFilterNet binary
- The binary is downloaded once from GitHub releases and cached at `~/.config/vidlet/bin/`
- No audio data leaves your device

## Spark AI Features (Optional)

- If you configure a Spark AI API key, rename suggestions and caption generation use the Spark AI API
- Only video metadata (filename, duration, resolution) is sent — never video/audio content
- This feature is entirely optional and disabled by default

## Configuration

- Settings are stored locally at `~/.config/vidlet/config.json`
- The API key (if configured) is stored in this local file only

## Network Connections

VidLet only makes network requests for:
1. One-time binary downloads (whisper.cpp, DeepFilterNet) on first use
2. One-time model downloads (whisper language models) on first use
3. Spark AI API calls (only if you configure a key)

Core video processing requires no internet connection.

## Contact

For privacy questions, open an issue at https://github.com/muammar-yacoob/VidLet
