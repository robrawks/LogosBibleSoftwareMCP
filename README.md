# Logos Bible Software MCP Server + Socratic Bible Study Agent

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that connects [Claude Code](https://docs.anthropic.com/en/docs/claude-code) to [Logos Bible Software](https://www.logos.com/), plus a custom Socratic Bible study agent that uses these tools for guided theological dialogue.

## What This Does

- **20 MCP tools** that let Claude read Bible text, search Scripture, navigate Logos, access your notes/highlights/favorites, check reading plans, explore word studies and factbook entries, search your library catalog, open commentaries and lexicons, and run cross-resource searches
- **A Socratic Bible Study agent** that guides you through Scripture using questions (not lectures), welcoming any denominational background, with four questioning layers: Observation, Interpretation, Correlation, and Application

## Prerequisites

| Requirement | Details |
|-------------|---------|
| **macOS** | Required (uses macOS `open` command and AppleScript for Logos integration) |
| **Logos Bible Software** | Installed at `/Applications/Logos.app` (tested with v48) |
| **Node.js** | v18+ (v23+ recommended for native `fetch` support) |
| **Claude Code** | Anthropic's CLI tool ([install guide](https://docs.anthropic.com/en/docs/claude-code)) |
| **Biblia API Key** | Free key from [bibliaapi.com](https://bibliaapi.com/) |

## Setup

### 1. Clone the repo

```bash
git clone https://github.com/robrawks/LogosInteraction.git
cd LogosInteraction
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

Once Claude Code starts, type `/mcp` to check that the "logos" server appears with 20 tools.

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
| `get_favorites` | Lists your saved favorites/bookmarks |
| `get_reading_progress` | Shows your reading plan status |

### Study Workflows
Tools for structured study paths

| Tool | What it does |
|------|-------------|
| `get_study_workflows` | Lists available study workflow templates and active instances |

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
LogosInteraction/
├── .claude/
│   └── agents/
│       └── socratic-bible-study.md    # Socratic agent definition
├── .mcp.json                          # MCP server config (you create this)
├── .env                               # API key (you create this)
├── logos-mcp-server/
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts                   # MCP server entry point (20 tools)
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

The MCP server integrates with Logos through three channels:

- **Biblia API** - Retrieves Bible text and search results via the free REST API from Faithlife (same company as Logos)
- **macOS URL schemes** - Opens passages, word studies, and factbook entries directly in the Logos app using `logos4:///` URLs
- **SQLite databases** - Reads your personal data (notes, highlights, favorites, workflows, reading plans) and library catalog directly from the Logos local database files (read-only access, never modifies your data)

## Logos Data Path

The server expects Logos data at:

```
~/Library/Application Support/Logos4/Documents/a3wo155q.w14/
```

If your Logos data is at a different path, set the `LOGOS_DATA_DIR` environment variable in `.mcp.json`. The library catalog lives under `Data/` (not `Documents/`) — set `LOGOS_CATALOG_DIR` if your catalog path differs:

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

## Troubleshooting

**"BIBLIA_API_KEY is not set"** - Make sure your `.mcp.json` has the `env` block with your API key.

**"Database not found"** - Your Logos data path may differ. Run `find ~/Library/Application\ Support/Logos4 -name "*.db" -maxdepth 5` to find your databases and update `LOGOS_DATA_DIR`.

**Tools don't appear in `/mcp`** - Restart Claude Code. The MCP server is loaded at startup from `.mcp.json`.

**Logos doesn't open passages** - Make sure Logos Bible Software is running before using `navigate_passage`, `open_word_study`, or `open_factbook`.

## License

MIT
