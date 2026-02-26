# Thompson Chain Study Mode Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Thompson Chain Reference study mode to rob-agent so the student navigates chains in their physical Bible while the agent enriches each link with lexicons, grammars, balanced commentaries, and Socratic dialogue.

**Architecture:** Single-file change to `.claude/agents/rob-agent.md`. Five insertions into existing sections, one new section. No server code changes.

**Tech Stack:** Markdown agent instructions only.

---

### Task 1: Add Chain Study as 5th Study Session Type

**Files:**
- Modify: `.claude/agents/rob-agent.md:84-97` (Study Session Types section)

**Step 1: Add the Chain Study session type after the existing four**

Insert the following after line 96 (`Follow a Logos workflow template...workflow steps.`) and before the `---` separator:

```markdown

### 5. Chain Study (Thompson Chain Reference)
Trace a topic across the entire Bible using the Thompson Chain Reference system. The student navigates chains in their physical Thompson Chain Reference Bible, providing the topic name, pilot number, and each verse link. The agent enriches each chain link with lexical analysis, grammatical investigation, and Socratic dialogue -- then brings in balanced commentary sources after the student has engaged the text. Use `get_bible_text`, `open_word_study`, `open_guide`, and `get_library_catalog` extensively. The agent maintains a chain study journal file for persistent memory across context compaction.
```

**Step 2: Verify the edit**

Read `.claude/agents/rob-agent.md` and confirm the new section 5 appears after section 4 and before the `---` separator.

**Step 3: Commit**

```bash
git add .claude/agents/rob-agent.md
git commit -m "feat(rob-agent): add Chain Study as 5th session type"
```

---

### Task 2: Add Chain-Specific Correlation Questions to Methodology

**Files:**
- Modify: `.claude/agents/rob-agent.md:33-38` (Correlation layer in Methodology section)

**Step 1: Add chain-specific question variants to the Correlation layer**

After line 38 (`- Ask: "Where else in Scripture do we see this pattern?"...`), insert:

```markdown
- **In Chain Study mode**, focus correlation questions on the chain's development: "How does this link connect to what we saw at [previous chain link]?", "What's developing in this chain's theme?", "How does the author's use of [term] here build on or shift from the earlier links?"
```

**Step 2: Verify the edit**

Read the Correlation section and confirm the chain-specific bullet appears at the end of the list.

**Step 3: Commit**

```bash
git add .claude/agents/rob-agent.md
git commit -m "feat(rob-agent): add chain-specific correlation questions"
```

---

### Task 3: Add Chain Study Tool Usage Patterns

**Files:**
- Modify: `.claude/agents/rob-agent.md:76-80` (Tool Usage Principles subsection)

**Step 1: Add chain study tool strategy after the existing Tool Usage Principles**

After line 80 (`- When a tool returns data, weave it naturally into the Socratic dialogue...`), insert:

```markdown

### Chain Study Tool Sequence
In Chain Study mode, tools follow a strict sequence at each chain link:

1. **Lexical foundation first** -- Use `open_word_study` on key Greek/Hebrew terms related to the chain topic. Use `open_guide` (Exegetical Guide) for grammatical analysis: sentence structure, verb tenses, syntactical relationships. This gives the student raw linguistic data BEFORE interpretation.
2. **Socratic dialogue second** -- Use the lexical and grammatical findings to fuel questions. Let the student wrestle with the text through the four questioning layers. Do NOT bring in commentaries yet.
3. **Balanced commentaries third** -- Only after the student has engaged the text, use `get_library_catalog` (type: "commentary") to find commentaries in the student's library. Select from different theological traditions when available (e.g., one Reformed, one historical/Catholic, one recent evangelical). Always name the commentator and tradition: "Calvin notes that..." or "Wright argues..." Commentaries confirm, challenge, or expand the student's discoveries -- they do not replace the student's work.
```

**Step 2: Verify the edit**

Read the Tool Usage Strategy section and confirm the new "Chain Study Tool Sequence" subsection appears after "Tool Usage Principles."

**Step 3: Commit**

```bash
git add .claude/agents/rob-agent.md
git commit -m "feat(rob-agent): add chain study tool sequence (lexicons first, commentaries last)"
```

---

### Task 4: Add Chain Study Flow to Session Flow Section

**Files:**
- Modify: `.claude/agents/rob-agent.md:148-171` (Session Flow section)

**Step 1: Add Chain Study session flow after the existing "6. Next Steps" subsection**

After line 170 (`Suggest next passages, related topics, or continued study paths...`) and before the `---` separator on line 172, insert:

```markdown

### Chain Study Session Flow

When the student requests a chain study (mentions Thompson Chain Reference, a chain topic, or a pilot number):

**Opening:**
- Ask for the chain topic name (e.g., "Redeemer"), the pilot number if they have it (e.g., #2977), and the first verse in the chain
- Retrieve the verse text via `get_bible_text` and open it in Logos via `navigate_passage`
- Retrieve surrounding context via `get_passage_context`
- Create the chain study journal file (see Chain Study Journal section)
- Begin with observation questions focused on the chain topic

**Per-Link Loop:**
At each chain link, follow this cycle:
1. Retrieve the verse text and open it in Logos
2. Run lexical and grammatical analysis (Phase A from Chain Study Tool Sequence)
3. Conduct Socratic dialogue using findings from step 2 (Phase B)
4. After the student has engaged, bring in balanced commentaries (Phase C)
5. Update the chain study journal with the link's findings
6. Offer a brief chain thread synthesis connecting this link to previous links
7. Ask: "What's the next link in the chain?" and wait for the student to provide the next verse from their physical Thompson Bible

**Accumulation:**
- After every 2-3 links, offer a running synthesis from the journal's Thread section
- Draw explicit connections: "Notice how [author]'s language here echoes what we saw in [earlier link]..."
- When you notice related topics emerging at a verse, ask: "Your Thompson might show another chain here -- do you see anything related to [topic] in the margin?"

**Closing:**
At chain completion or natural stopping points, ask which output the student wants:
- Personal study: the chain journal is the permanent record
- Devotional: generate a daily reading plan from chain links with a reflective question per day
- Teaching: generate a lesson outline selecting 3-5 strongest links with discussion questions and background context
- Preaching: generate a sermon outline using the canonical progression (OT foundation, prophetic development, Gospel fulfillment, apostolic explanation) with key quotes and word study highlights
```

**Step 2: Verify the edit**

Read the Session Flow section and confirm the Chain Study subsections appear after "6. Next Steps."

**Step 3: Commit**

```bash
git add .claude/agents/rob-agent.md
git commit -m "feat(rob-agent): add chain study session flow (opening, loop, accumulation, closing)"
```

---

### Task 5: Add Chain Study Journal Section

**Files:**
- Modify: `.claude/agents/rob-agent.md` (insert new section before Guardrails)

**Step 1: Add the Chain Study Journal section before the Guardrails section**

Before the `## Guardrails` heading, insert:

```markdown
## Chain Study Journal

The agent maintains a persistent chain study journal file for each chain study session. This file survives context window compaction and enables session resumption across conversations.

### File Location
`docs/chain-studies/YYYY-MM-DD-topic-name.md` (e.g., `docs/chain-studies/2026-02-25-redeemer.md`)

Create the `docs/chain-studies/` directory if it does not exist.

### File Format
Use token-efficient plain text. No bold markers or decorative formatting:

```
# Chain Study: [Topic Name] (#[Pilot Number])
Started: [Date]

## Link 1: [Reference]
Text: [verse text]
Hebrew/Greek: [key term] — [gloss and semantic note]
Grammar: [tense, voice, mood, syntactical note]
Student: [summary of student's observations and answers]
Insight: [key discovery from this link]
Connection: [how this link relates to previous links]
Commentary: [brief notes from commentators consulted]

## Thread
- [Reference]: [one-line summary of contribution to chain topic]
- [Reference]: [one-line summary]
```

### Usage Rules
- Create the file when a chain study session begins
- Update it after each chain link discussion completes
- Read the file at the start of each turn to recover chain context after compaction
- When resuming a previous chain study, read the existing journal and continue from where it left off
- The Thread section is a running summary that grows with each link -- use it for synthesis and connection-building

---

```

**Step 2: Verify the edit**

Read the file and confirm the Chain Study Journal section appears between Session Flow (or Conversation Style) and Guardrails.

**Step 3: Commit**

```bash
git add .claude/agents/rob-agent.md
git commit -m "feat(rob-agent): add chain study journal section for persistent memory"
```

---

### Task 6: Create chain-studies directory with .gitkeep

**Files:**
- Create: `docs/chain-studies/.gitkeep`

**Step 1: Create the directory**

```bash
mkdir -p docs/chain-studies && touch docs/chain-studies/.gitkeep
```

**Step 2: Commit**

```bash
git add docs/chain-studies/.gitkeep
git commit -m "chore: create chain-studies directory for Thompson Chain study journals"
```

---

### Task 7: Final verification

**Step 1: Read the complete rob-agent.md**

Read `.claude/agents/rob-agent.md` from top to bottom. Verify:
- [ ] Section numbering flows correctly (Study Session Types now has 5 entries)
- [ ] Correlation layer includes chain-specific questions
- [ ] Tool Usage has "Chain Study Tool Sequence" subsection
- [ ] Session Flow has "Chain Study Session Flow" subsection
- [ ] Chain Study Journal section exists between Session Flow area and Guardrails
- [ ] No broken markdown (unclosed sections, stray formatting)
- [ ] All `---` separators are in the right places

**Step 2: Commit any fixes**

If anything needs correcting, fix it and commit:

```bash
git add .claude/agents/rob-agent.md
git commit -m "fix(rob-agent): correct formatting in chain study sections"
```

**Step 3: Run code review**

Use the code-reviewer agent to review all changes to `.claude/agents/rob-agent.md` for:
- Consistency with existing agent tone and patterns
- No contradictions with existing instructions
- Completeness of the chain study workflow
