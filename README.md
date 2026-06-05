# Achievement Companion

Achievement Companion is a Millennium plugin for the Steam client. It adds an achievements panel to non-Steam game pages, with support for RetroAchievements and local Steam emulator achievement saves.

## Features

- RetroAchievements linking and progress display for non-Steam shortcuts.
- Local achievements from Steam emulator saves, including Goldberg, RUNE, and OnlineFix.
- Manual Steam AppID mapping for non-Steam shortcuts.
- Export and import local Goldberg/RUNE/OnlineFix achievement backups.
- Portuguese (Brazil) and English UI, with automatic language detection.
- Restore ignored games from the plugin settings page.
- Steam-like achievement hover cards.

## Requirements

- Steam with Millennium installed.
- Node.js and npm for building from source.
- RetroAchievements credentials for RetroAchievements features.
- Steam Web API key for local achievement schema lookup.

## Development

```powershell
npm install
npm run build
```

The production bundle is generated at `.millennium/Dist/index.js`.

## Install From Source

Copy this folder to your Steam plugins directory:

```text
C:\Program Files (x86)\Steam\plugins\achievement-companion
```

Restart Steam/Millennium after copying or rebuilding.

## Notes

The plugin currently keeps its saved settings under the original `ra-achievements` localStorage namespace to preserve existing user mappings.

## License

MIT
