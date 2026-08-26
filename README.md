# Logos Bible Software MCP Server + Socratic Bible Study Agent

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that connects [Claude Code](https://docs.anthropic.com/en/docs/claude-code) to [Logos Bible Software](https://www.logos.com/), plus a custom Socratic Bible study agent that uses these tools for guided theological dialogue.

## What This Does

- **24 MCP tools** that let Claude read Bible text, search Scripture, navigate Logos, access your notes/highlights/favorites/clippings, check reading plans, explore word studies and factbook entries, search your library catalog, open commentaries and lexicons, run cross-resource searches, capture Logos panels for vision reading, check what Logos is showing, and diagnose environment issues
- **A Socratic Bible Study agent** that guides you through Scripture using questions (not lectures), welcoming any denominational background, with four questioning layers: Observation, Interpretation, Correlation, and Application
- **A QA Tool Tester agent** that systematically exercises all tools and produces a pass/fail/skip report

## Prerequisites

| Requirement | Details |
|-------------|---------|
| **macOS or Windows** | macOS uses the `open` command and AppleScript; Windows uses the registered `logos4:` protocol handler and `tasklist` |
| **Logos Bible Software** | macOS: `/Applications/Logos.app` (tested with v48); Windows: standard install under `%LOCALAPPDATA%\Logos` |
| **Node.js** | v18+ (v23+ recommended for native `fetch` support) |
| **Claude Code** | Anthropic's CLI tool ([install guide](https://docs.anthropic.com/en/docs/claude-code)) |
| **Biblia API Key** | Free key from [bibliaapi.com](https://bibliaapi.com/) |
| **Xcode Command Line Tools** | `clang` is required to compile the window-capture helper used by `capture_panel_screenshot` (install: `xcode-select --install`) |
| **macOS permissions** | Screen Recording permission for your terminal app (System Settings → Privacy & Security → Screen Recording) is required for screenshots; Automation/Accessibility permission is prompted on first AppleScript use (detecting whether Logos is running) |

## Setup

### 1. Clone the repo

```bash
git clone https://github.com/robrawks/LogosBibleSoftwareMCP.git
cd LogosBibleSoftwareMCP
```

### 2. Install dependencies and build

```bash
cd logos-mcp-server
npm install
npm run build
cd ..
```

### 3. Get a Biblia API key

1. Go to [bibliaapi.com](https://bibliaapi.com/)
2. Sign up for a free account
3. Copy your API key

### 4. Create `.mcp.json` in the project root

```json
{
  "mcpServers": {
    "logos": {
      "command": "node",
      "args": ["logos-mcp-server/dist/index.js"],
      "env": {
        "BIBLIA_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

### 5. Create `.env` in the project root (optional, for development)

```
BIBLIA_API_KEY=your_api_key_here
```

### 6. Verify it works

```bash
claude
```

Once Claude Code starts, type `/mcp` to check that the "logos" server appears with 24 tools.

## Using with Claude Desktop or Cowork

The same server can be used with Claude Desktop or other MCP clients. Edit `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "logos": {
      "command": "node",
      "args": ["/Users/you/LogosBibleSoftwareMCP/logos-mcp-server/dist/index.js"],
      "env": {
        "BIBLIA_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

Use an **absolute path** in `args` — relative paths only resolve when the client is launched from the repo root, which is not guaranteed for desktop apps. The same absolute-path rule applies to any MCP client (Claude Code's `.mcp.json` works with relative paths only because it is loaded from the project root).

## Available Tools

### Bible Text & Reading
Tools for retrieving, reading, and comparing Bible text

| Tool | What it does |
|------|-------------|
| `get_bible_text` | Retrieves passage text (LEB default; also KJV, ASV, DARBY, YLT, WEB) |
| `get_passage_context` | Gets a passage with surrounding verses for context |
| `compare_passages` | Compares two Bible references for overlap, subset, or ordering |
| `get_available_bibles` | Lists all Bible versions available for text retrieval |

### Navigation & UI
Tools that open things in the Logos desktop app

| Tool | What it does |
|------|-------------|
| `navigate_passage` | Opens a passage in the Logos UI |
| `open_word_study` | Opens a word study in Logos (Greek/Hebrew/English) |
| `open_factbook` | Opens a Factbook entry for a person, place, event, or topic |
| `open_resource` | Opens a specific commentary, lexicon, or other resource in Logos at a passage |
| `open_guide` | Opens an Exegetical Guide or Passage Guide for a Bible passage |
| `get_logos_state` | Checks whether Logos is running and lists its open window titles |
| `capture_panel_screenshot` | Navigates Logos and captures the visible panel as an image for AI vision |

### Search & Discovery
Tools for searching Bible text and library resources

| Tool | What it does |
|------|-------------|
| `search_bible` | Searches Bible text for words, phrases, or topics |
| `get_cross_references` | Finds related passages by extracting key terms |
| `scan_references` | Finds Bible references embedded in arbitrary text |
| `search_all` | Searches across ALL resources in your library (not just Bible text) |

### Library & Resources
Tools for browsing your owned library catalog

| Tool | What it does |
|------|-------------|
| `get_library_catalog` | Searches your owned resources (commentaries, lexicons, etc.) by type, author, or keyword |
| `get_resource_types` | Shows a summary of resource types and counts in your library |

### Personal Study Data
Tools for accessing your notes, highlights, favorites, and reading progress

| Tool | What it does |
|------|-------------|
| `get_user_notes` | Reads your study notes from Logos |
| `get_user_highlights` | Reads your highlights and visual markup |
| `get_clippings` | Reads your saved clippings (excerpt text you clipped from resources) |
| `get_favorites` | Lists your saved favorites/bookmarks |
| `get_reading_progress` | Shows your reading plan status |

### Study Workflows
Tools for structured study paths

| Tool | What it does |
|------|-------------|
| `get_study_workflows` | Lists available study workflow templates and active instances |

### System & Diagnostics
Tools for troubleshooting and verifying your setup

| Tool | What it does |
|------|-------------|
| `diagnose` | Checks Logos data paths, database availability, and API configuration |

## Using the Socratic Bible Study Agent

Start Claude Code in the project directory, then:

```
/agent socratic-bible-study
```

The agent will ask what you want to study and guide you through Scripture using the Socratic method. It's tradition-neutral -- it works with any denominational background and presents multiple perspectives where Christians disagree. It guides you through four layers:

1. **Observation** - "What does the text say?"
2. **Interpretation** - "What does the text mean?"
3. **Correlation** - "How does this relate to the rest of Scripture?"
4. **Application** - "What does this mean for us?"

### Example session starters

- "Let's study Romans 8:28-30"
- "I want to do a word study on 'justification'"
- "What does the Bible teach about grace?"
- "Walk me through Psalm 23"

## Project Structure

```
LogosBibleSoftwareMCP/
├── .claude/
│   └── agents/
│       ├── socratic-bible-study.md    # Socratic agent definition
│       └── tool-tester.md            # QA agent for testing all 24 tools
├── .mcp.json                          # MCP server config (you create this)
├── .env                               # API key (you create this)
├── logos-mcp-server/
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts                   # MCP server entry point (24 tools)
│   │   ├── cli.ts                     # Diagnose CLI entry point
│   │   ├── config.ts                  # Paths, API config, constants
│   │   ├── types.ts                   # Shared TypeScript types
│   │   └── services/
│   │       ├── reference-parser.ts    # Bible reference normalization
│   │       ├── biblia-api.ts          # Biblia.com REST API client
│   │       ├── logos-app.ts           # macOS URL scheme / AppleScript
│   │       ├── sqlite-reader.ts       # Read-only Logos SQLite access
│   │       └── catalog-reader.ts     # Library catalog search (catalog.db)
│   └── dist/                          # Built output (after npm run build)
```

## How It Works

The MCP server integrates with Logos through four channels:

- **Biblia API** - Retrieves Bible text and search results via the free REST API from Faithlife (same company as Logos)
- **URL schemes** - Opens passages, word studies, and factbook entries directly in the Logos app using `logos4:///` URLs (via `open` on macOS, the registered protocol handler on Windows)
- **SQLite databases** - Reads your personal data (notes, highlights, favorites, workflows, reading plans) and library catalog directly from the Logos local database files (read-only access, never modifies your data)
- **Screen capture + vision** - Captures Logos windows so AI can read content displayed in the app UI when direct DB text access is unavailable

## Logos Data Path

The server auto-detects your Logos data by scanning for the per-install instance directory:

```
macOS:    ~/Library/Application Support/Logos4/Documents/<instance-id>/
Windows:  %LOCALAPPDATA%\Logos\Documents\<instance-id>\
```

Each Logos install uses a randomly named instance directory (e.g. `a3wo155q.w14`); detection prefers the directory containing `LibraryCatalog/catalog.db`, so there is no fixed path to configure. If your Logos data lives at a non-standard path, the `LOGOS_DATA_DIR` and `LOGOS_CATALOG_DIR` environment variables remain available as manual overrides (set them in `.mcp.json`). The library catalog lives under `Data/` (not `Documents/`) — set `LOGOS_CATALOG_DIR` if your catalog path differs:

```json
{
  "mcpServers": {
    "logos": {
      "command": "node",
      "args": ["logos-mcp-server/dist/index.js"],
      "env": {
        "BIBLIA_API_KEY": "your_key",
        "LOGOS_DATA_DIR": "/path/to/your/Logos4/Documents/xxxx.w14",
        "LOGOS_CATALOG_DIR": "/path/to/your/Logos4/Data/xxxx.w14"
      }
    }
  }
}
```

### Focus behavior on Windows

On Windows, Logos/Verbum brings itself to the foreground every time a navigation command is dispatched. By default the server hands focus back to the window you were working in about a second later, so navigation and screenshot tools can run while you keep working (the Logos window still flashes briefly — that activation can't be suppressed). If you prefer the stock behavior where Logos comes to the foreground and stays there, set:

```json
"env": {
  "LOGOS_RESTORE_FOCUS": "false"
}
```

The `diagnose` tool reports which mode is active. This setting has no effect on macOS.

### Windows requirements & limitations

The Windows navigation, screenshot, and window-title support works out of the box for a normal desktop user — Windows 10/11 (which current Logos/Verbum requires anyway), no admin rights, and no permission prompts (Windows has no equivalent of macOS's Screen Recording consent). The helpers target Windows PowerShell 5.1, which ships with every Windows 10/11 install. Known limitations:

- **Managed/corporate machines**: a Group Policy–enforced PowerShell execution policy, or WDAC/AppLocker constrained language mode, blocks the helper scripts (they compile small C# shims via `Add-Type`). Navigation still works — dispatch falls back to `rundll32` without focus restore — but `capture_panel_screenshot` and window titles will fail.
- **Elevation mismatch**: if Logos/Verbum runs "as administrator" while the MCP server does not, Windows UIPI blocks both window capture and focus restore toward the elevated window. Run both at the same elevation (normally, neither elevated).
- **Interactive session required**: running the server from a service, scheduled task, or SSH session that has no access to the interactive desktop cannot see or manipulate windows.
- **Minimized window**: a minimized Logos window cannot be captured; the tool returns an explicit error asking for the window to be restored (un-minimized) first.

## Troubleshooting

**Quick diagnostic check** - Run `cd logos-mcp-server && npm run diagnose` to verify all data paths, databases, and API configuration before launching Claude Code.

**"BIBLIA_API_KEY is not set"** - Get a free key at [bibliaapi.com](https://bibliaapi.com/) and add it to the `env` block in `.mcp.json`. Bible-text tools need it, but Logos-local tools (notes, highlights, clippings, library catalog) work without it.

**"Database not found"** - Logos isn't installed, or your data is at a non-standard path. Run `find ~/Library/Application\ Support/Logos4 -name "*.db" -maxdepth 5` to locate your databases and set `LOGOS_DATA_DIR`.

**Screenshot tool fails** - Check that your terminal app has Screen Recording permission (System Settings → Privacy & Security → Screen Recording) and that Xcode Command Line Tools are installed (`xcode-select --install`).

**Tools don't appear in `/mcp`** - Restart Claude Code. The MCP server is loaded at startup from `.mcp.json`.

**Logos doesn't open passages** - Make sure Logos Bible Software is running before using `navigate_passage`, `open_word_study`, or `open_factbook`.

**Book content is encrypted in local resource files** - Use `capture_panel_screenshot` to let AI read what is visible in Logos, and use `get_clippings` for text you've explicitly clipped/highlighted.

## License

MIT
