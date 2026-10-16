# Logos Bible Software MCP Server + Socratic Bible Study Agent

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that connects [Claude Code](https://docs.anthropic.com/en/docs/claude-code) to [Logos Bible Software](https://www.logos.com/), plus a custom Socratic Bible study agent that uses these tools for guided theological dialogue.

## What This Does

- **28 MCP tools** that let Claude read Bible text, search Scripture, navigate Logos, access your notes/highlights/favorites/clippings, check reading plans and per-book progress, browse your reading history and passage lists, explore word studies and factbook entries, search your library catalog, find which of your books cover a passage, open commentaries and lexicons, run cross-resource searches, capture Logos panels for vision reading, check what Logos is showing, and diagnose environment issues
- **A Socratic Bible Study agent** that guides you through Scripture using questions (not lectures), welcoming any denominational background, with four questioning layers: Observation, Interpretation, Correlation, and Application
- **A QA Tool Tester agent** that systematically exercises all tools and produces a pass/fail/skip report

## Prerequisites

| Requirement | Details |
|-------------|---------|
| **macOS or Windows** | macOS uses the `open` command and AppleScript; Windows uses the registered `logos4:` protocol handler and `tasklist`. Window titles (`get_logos_state`) and `capture_panel_screenshot` are macOS-only |
| **Logos Bible Software** | macOS: `/Applications/Logos.app` (tested with v48); Windows: standard install under `%LOCALAPPDATA%\Logos` (tested with v54) |
| **Node.js** | v18+ (v23+ recommended for native `fetch` support) |
| **Claude Code** | Anthropic's CLI tool ([install guide](https://docs.anthropic.com/en/docs/claude-code)) |
| **Biblia API Key** | Free key from [bibliaapi.com](https://bibliaapi.com/) |
| **Xcode Command Line Tools** | macOS only: `clang` is required to compile the window-capture helper used by `capture_panel_screenshot` (install: `xcode-select --install`) |
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

Once Claude Code starts, type `/mcp` to check that the "logos" server appears with 28 tools.

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
| `navigate_passage` | Opens a passage in the Logos UI (in your most-used Bible, or one you name), and confirms it opened |
| `open_word_study` | Opens Bible Word Study (current Logos opens it empty — type the word in; see [Limitations](#limitations)) |
| `open_factbook` | Opens a Factbook entry for a person, place, event, or topic; confirms it opened; lists the choices when a name matches several entries |
| `open_resource` | Opens a specific commentary, lexicon, or other resource in Logos at a passage, and confirms it opened |
| `open_guide` | Opens a Passage Guide or Exegetical Guide for a passage, or a Topic Guide for a topic, and confirms it opened |
| `get_logos_state` | Checks whether Logos is running and, on macOS, lists its open window titles |
| `capture_panel_screenshot` | macOS only: navigates Logos and captures the visible panel as an image for AI vision |

### Search & Discovery
Tools for searching Bible text and library resources

| Tool | What it does |
|------|-------------|
| `search_bible` | Searches Bible text for words, phrases, or topics |
| `get_cross_references` | Finds related passages by extracting key terms |
| `scan_references` | Finds Bible references embedded in arbitrary text |
| `search_all` | Runs a search across ALL resources in your library (not just Bible text) in Logos's Search panel, and confirms it opened |

### Library & Resources
Tools for browsing your owned library catalog

| Tool | What it does |
|------|-------------|
| `get_library_catalog` | Searches your owned resources (commentaries, lexicons, etc.) by type, author, or keyword |
| `get_resource_types` | Shows a summary of resource types and counts in your library |
| `find_passage_resources` | Lists the commentaries, study Bibles and other books you own that cover a passage (filter by kind and commentary purpose) |

**Opening your commentaries on a passage.** Ask "open my exegetical commentaries on John 5:14": the assistant calls `find_passage_resources` (`passage: "John 5:14"`, `kind: "commentary"`, `purpose: "exegetical"`) and then `open_resource` for each book you choose. Results are ordered commentaries first, then by how often you open each book — not by your Passage Guide prioritization list, which Logos keeps on Faithlife's servers rather than on disk.

### Personal Study Data
Tools for accessing your notes, highlights, favorites, reading plans and history

| Tool | What it does |
|------|-------------|
| `get_user_notes` | Reads your study notes from Logos |
| `get_user_highlights` | Reads your highlights: style, resource, the passage covered, and date |
| `get_clippings` | Reads your saved clippings (excerpt text you clipped from resources) |
| `get_favorites` | Lists your saved favorites/bookmarks |
| `get_reading_progress` | Shows your reading plans: sessions read, next reading, days behind schedule |
| `get_resource_reading_progress` | Shows how far you've read in each book (percent, last read) |
| `get_reading_history` | Lists what you've opened in Logos recently, newest first |
| `get_passage_lists` | Lists your saved passage lists and their passages |

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

### Structured output

Every tool that reads your Logos data (notes, highlights, clippings, favorites, reading plans and progress, history, passage lists, workflows, library catalog, resource types) accepts `format: "json"`. JSON mode returns the underlying records — readable *and* raw Logos references, ISO dates, resource IDs and titles — for building reading plans or feeding other tools, and allows a `limit` of up to 1,000. A store your Logos version doesn't have comes back as `null`.

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
│       └── tool-tester.md            # QA agent for testing all 28 tools
├── .mcp.json                          # MCP server config (you create this)
├── .env                               # API key (you create this)
├── logos-mcp-server/
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts                   # MCP server entry point (28 tools)
│   │   ├── cli.ts                     # Diagnose CLI entry point
│   │   ├── config.ts                  # Paths, link style, API config, constants
│   │   ├── types.ts                   # Shared TypeScript types
│   │   ├── services/
│   │   │   ├── reference-parser.ts    # Bible reference normalization
│   │   │   ├── logos-books.ts         # Logos book numbers and raw references
│   │   │   ├── biblia-api.ts          # Biblia.com REST API client
│   │   │   ├── logos-urls.ts          # Links the UI tools send to Logos
│   │   │   ├── logos-app.ts           # Launching links; is Logos running
│   │   │   ├── knowledge-lookup.ts    # Factbook names -> knowledge-base IDs
│   │   │   ├── db.ts                  # Shared read-only SQLite helpers
│   │   │   ├── sqlite-reader.ts       # Read-only Logos SQLite access
│   │   │   ├── study-data.ts          # Reading plans, progress, history, passage lists
│   │   │   ├── catalog-reader.ts      # Library catalog search and passage coverage (catalog.db)
│   │   │   └── screenshot-capture.ts  # macOS window capture
│   │   └── utils/                     # clippings.ts (blob decoding), strip-markup.ts, tool-text.ts
│   └── dist/                          # Built output (after npm run build)
```

## How It Works

The MCP server integrates with Logos through four channels:

- **Biblia API** - Retrieves Bible text and search results via the free REST API from Faithlife (same company as Logos)
- **URL schemes** - Opens passages, resources, guides and Factbook entries in the Logos app using `logosres:` and `logos4:` links (via `open` on macOS, the registered protocol handler on Windows); see [Logos Link Style](#logos-link-style)
- **SQLite databases** - Reads your personal data (notes, highlights, favorites, workflows, reading plans and progress, history, passage lists) and library catalog directly from the Logos local database files (read-only access, never modifies your data)
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

## Logos Link Style

Logos 54 ignores the `logos4:///…?…` query-string links older versions accepted, so by default the server sends the link formats verified on Logos 54. Set `LOGOS_LINK_STYLE` in the `env` block of `.mcp.json` to choose:

| Value | Links sent | Use when |
|---|---|---|
| `current` (default) | `logosres:<resource>;ref=…` for passages and resources; `logos4:Guide;t=<title>;ref=…`, `logos4:Factbook;ref=<id>` and `logos4:Search;kind=AllSearch;q=…;syntax=v2` | Current Logos (verified on Logos 54, Windows) |
| `legacy` | The `logos4:///Bible/…`, `logos4:///Guide?t=…&ref=…`, `logos4:///Factbook?ref=…`, `logos4:///WordStudy?word=…` and `logos4:///Search?kind=AllSearch&syntax=v2&q=…` URLs used before | Older Logos versions where the current formats open nothing (reported to work on macOS Logos 48) |

```json
"env": {
  "BIBLIA_API_KEY": "your_key",
  "LOGOS_LINK_STYLE": "legacy"
}
```

Factbook entries and Topic Guides are opened by knowledge-base ID (e.g. `bk.#Moses`). With `current`, the server looks names up in Logos's own index, `Data/<instance-id>/AutoComplete/AutoComplete.db`, which Logos builds the first time it runs. With `legacy`, Factbook links take the topic name as before, so `open_factbook` refuses a `kb_id`.

### Logos book numbers

Logos numbers Bible books its own way in stored references: Genesis–Malachi are 1–39, the deuterocanon 40–60, and Matthew–Revelation 61–87 (so `bible.66.8.28` is Romans 8:28). Notes and highlights are labeled with that numbering; references in the 40–60 range are shown as the raw Logos string.

## Troubleshooting

**Quick diagnostic check** - Run `cd logos-mcp-server && npm run diagnose` to verify all data paths, databases, and API configuration before launching Claude Code.

**"BIBLIA_API_KEY is not set"** - Get a free key at [bibliaapi.com](https://bibliaapi.com/) and add it to the `env` block in `.mcp.json`. Bible-text tools need it, but Logos-local tools (notes, highlights, clippings, library catalog) work without it.

**"Database not found"** - Logos isn't installed, or your data is at a non-standard path. Locate your databases (macOS: `find ~/Library/Application\ Support/Logos4 -name "*.db" -maxdepth 5`; Windows PowerShell: `Get-ChildItem $env:LOCALAPPDATA\Logos -Recurse -Filter *.db`) and set `LOGOS_DATA_DIR`.

**Screenshot tool fails** - Check that your terminal app has Screen Recording permission (System Settings → Privacy & Security → Screen Recording) and that Xcode Command Line Tools are installed (`xcode-select --install`).

**Tools don't appear in `/mcp`** - Restart Claude Code. The MCP server is loaded at startup from `.mcp.json`.

**Logos doesn't open passages** - Make sure Logos Bible Software is running before using the navigation tools. On an older Logos version, try `LOGOS_LINK_STYLE=legacy` (see [Logos Link Style](#logos-link-style)). If Logos is busy (still starting or indexing), a link can start a second `Logos.exe` that opens nothing — wait until Logos responds, end the extra process, and try again.

**"Logos's lookup table was not found"** - `open_factbook` and Topic Guides find entries in `AutoComplete.db`, which Logos builds when it first runs. Open Logos once and let it finish starting, or pass a knowledge-base ID such as `bk.#Moses` directly.

**Book content is encrypted in local resource files** - Use `capture_panel_screenshot` to let AI read what is visible in Logos, and use `get_clippings` for text you've explicitly clipped/highlighted.

## Limitations

- **Word study links** - Logos 54 opens Bible Word Study but ignores the word in the link. Tried: `logos4:Guide;t=Bible%20Word%20Study;ref=…` with `g:agape`, `q=g:agape`, `lemma.lbs/grc/ἀγάπη` and `en:healing`. `open_word_study` therefore opens it empty and asks the user to type the word (`g:`/`h:` prefixes for Greek/Hebrew).
- **Sermon Starter Guide** - opens via link, but without the requested theme: Logos ignores the subject in the link.
- **Windows** - `get_logos_state` reports only whether Logos is running, and `capture_panel_screenshot` is unavailable (it relies on a macOS helper).

## License

MIT
