# Obsidian LEGO Plugin

An Obsidian plugin that integrates with the Brickset API to fetch LEGO set information and formatted notes with set details and images.

## Features

- **Fetch LEGO Sets by Number** - Simply enter a set number to retrieve complete set information
- **Automatic Note Creation** - Creates formatted markdown notes with all set details
- **Image Integration** - Downloads and embeds set images directly in your notes
- **Easy Configuration** - Simple settings interface for API key management
- **Rich Set Data** - Includes pieces, minifigs, pricing, ratings, and more
- **Metadata Support** - Adds frontmatter tags for easy organization

## Installation

### From Obsidian Community Plugins (Coming Soon)

1. Open Obsidian Settings
2. Navigate to Community Plugins
3. Search for "LEGO"
4. Click Install
5. Enable the plugin

### Manual Installation

1. Download the latest release from GitHub
2. Extract the files to your vault's `.obsidian/plugins/obsidian-lego/` folder
3. Reload Obsidian
4. Enable the plugin in Settings → Community Plugins

## Setup

### 1. Get a Brickset API Key

1. Visit [Brickset API Key Request](https://brickset.com/tools/webservices/requestkey)
2. Fill out the form with your details:
   - Name
   - Email address
   - Website/Application name (e.g., "Obsidian Personal Vault")
   - Brief description of intended use
3. Submit the form
4. Check your email for the API key (usually arrives within minutes)

### 2. Configure the Plugin

1. Open Obsidian Settings
2. Navigate to Plugin Options → Brickset
3. Enter your API key in the "Brickset API Key" field
4. (Optional) Configure the folder where LEGO set notes will be created
5. (Optional) Enter your Brickset username and password for personalized features
6. Click "Save Settings"

The plugin will automatically validate your API key when you save.

## Usage

### Fetch a LEGO Set

1. Open the Command Palette (`Cmd/Ctrl + P`)
2. Type "Fetch LEGO Set" and select the command
3. Enter the LEGO set number
4. Press Enter

The plugin will:
- Fetch the set data from Brickset
- Download set images
- Create a new note with all information
- Open the note for you to view

### Example Set Numbers to Try

- `75192` - Millennium Falcon (UCS)
- `10497` - Galaxy Explorer
- `42143` - Ferrari Daytona SP3
- `10316` - Rivendell

## Note Format

Each LEGO set note includes:

```markdown
---
tags: lego, set
setNumber: 75192
theme: Star Wars
year: 2017
pieces: 7541
---

# 75192: Millennium Falcon

![Set Image](image-url)

## Details
- **Set Number:** 75192
- **Name:** Millennium Falcon
- **Theme:** Star Wars
- **Subtheme:** Ultimate Collector Series
- **Year Released:** 2017
- **Pieces:** 7541
- **Minifigs:** 8
- **RRP:** $799.99
- **Rating:** 4.8/5

## Description
[Set description from Brickset]

## Additional Images
[Additional set images]

## Links
- [Brickset Page](https://brickset.com/sets/75192-1)

## Notes
<!-- Add your personal notes here -->
```

## Settings

### Required Settings

- **Brickset API Key** - Your API key from Brickset (required)

### Optional Settings

- **LEGO Sets Folder** - Folder where notes will be created (default: "LEGO Sets")
- **Brickset Username** - Your Brickset username (for personalized features)
- **Brickset Password** - Your Brickset password (for personalized features)

## Troubleshooting

### "Invalid API Key" Error

- Verify your API key is correct in settings
- Check that you copied the entire key without extra spaces
- Request a new API key if needed

### "Set Not Found" Error

- Verify the set number is correct
- Try searching on [Brickset.com](https://brickset.com) first
- Some very new or unreleased sets may not be available

### Images Not Loading

- Check your internet connection
- Verify the vault has write permissions
- Try fetching the set again

## Privacy & Security

- No data is sent to any server except Brickset's official API
- Optional username/password are stored in plaintext as the assumption is that the Obsidian app will remain on the users machine. It cojld be changed so that the password is not stored, only the user hash and the user has to reenter the password everytime the userHash expires. I chose the former option for convenience but am open to changing it.
- All API calls use HTTPS encryption

## Development

### Building from Source

```bash
# Clone the repository
git clone https://github.com/yourusername/obsidian-lego.git
cd obsidian-lego

# Install dependencies
npm install

# Build the plugin
npm run build

# Development mode (auto-rebuild on changes)
npm run dev
```

### Project Structure

```
obsidian-lego/
├── src/
│   ├── main.ts              # Main plugin class
│   ├── settings.ts          # Settings management
│   ├── stateCache.ts        # Settings management
│   ├── syncBackService.ts   # Settings management
│   ├── syncService.ts       # Settings management
│   ├── bricksetApi.ts       # API service
│   ├── types.ts             # Type definitions
│   ├── noteCreator.ts       # Note generation
│   └── modal.ts             # User input modal
├── manifest.json            # Plugin manifest
├── package.json             # Dependencies
├── styles.css               # Styling
└── README.md                # This file
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

### Development Guidelines

1. Follow TypeScript best practices
2. Add tests for new features
3. Update documentation
4. Follow the existing code style

## Support

- 📖 [Documentation](https://github.com/mirkostanic/obsidian-lego/wiki)
- 🐛 [Report Issues](https://github.com/mirkostanic/obsidian-lego/issues)
- 💬 [Discussions](https://github.com/mirkostanic/obsidian-lego/discussions)

## Credits

- Built for [Obsidian](https://obsidian.md)
- Data provided by [Brickset](https://brickset.com)
- LEGO® is a trademark of the LEGO Group

## Tests

```bash
npm test              # Run all tests once
npm run test:watch    # Watch mode for development
npm run test:coverage # Generate coverage report
```

## License

MIT License - see LICENSE file for details

## Disclaimer

This plugin is not affiliated with, endorsed by, or sponsored by the LEGO Group or Brickset. LEGO® is a trademark of the LEGO Group of companies which does not sponsor, authorize or endorse this plugin.
