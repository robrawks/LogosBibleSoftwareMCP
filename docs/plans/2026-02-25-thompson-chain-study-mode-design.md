# Thompson Chain Reference Integration: Chain Study Mode

## Problem
Rob uses the NIV Thompson Chain Reference Bible (physical) for personal study, devotionals, teaching prep, and sermon prep. The rob-agent (Socratic Bible Study Partner) currently has no awareness of the Thompson Chain Reference system or how to support chain-following study sessions.

## Solution
Add a 5th study session type called "Chain Study" to the rob-agent. Rob navigates the chain in his physical Thompson Bible; the agent enriches each chain link with Logos resources (lexicons, grammars, commentaries) and Socratic dialogue.

## Data Source
Physical NIV Thompson Chain Reference Bible only (not in Logos library). Rob provides chain topic, pilot number, and verse links. The agent uses Logos MCP tools for scholarly enrichment at each link.

## Design

### 1. Session Entry Point

Student provides:
- Topic name (e.g., "Redeemer")
- Pilot number (optional, e.g., #2977)
- First verse in the chain (looked up in physical Bible)

Agent responds:
- Retrieves verse text via get_bible_text
- Opens in Logos via navigate_passage
- Provides brief book/passage context
- Begins Socratic observation for that verse
- Creates chain study journal file

### 2. Per-Link Deep Dive (Core Loop)

At each chain link, the agent follows this sequence:

Phase A — Lexical and Grammatical Foundation (upfront)
- Identify key Greek/Hebrew terms related to the chain topic
- Open word studies via open_word_study for semantic range and contextual usage
- Open Exegetical Guide via open_guide for grammatical analysis (sentence structure, verb tenses, syntax)
- This gives the student raw linguistic data BEFORE interpretation

Phase B — Student Discovery (Socratic dialogue)
- Use lexical/grammatical findings to fuel Socratic questions
- Student engages through the four questioning layers
- Student does the interpretive work

Phase C — Commentary Engagement (after student discussion only)
- Bring in commentaries only after the student has wrestled with the text
- Balance sources across theological traditions
- Use get_library_catalog to find commentaries, selecting from different traditions
- Name the commentator and tradition: "Calvin notes..." or "Wright argues..."
- Commentaries confirm, challenge, or expand student's discoveries

Chain-specific Socratic questions:
- Observation: "What does this verse say about [chain topic]? What specific language does the author use?"
- Interpretation: "Why does [author] frame [chain topic] this way? What does [Greek/Hebrew term] reveal?"
- Correlation: "How does this link connect to what we saw at [previous link]? What's developing?"
- Application: "What does this facet of [chain topic] mean for us?"

### 3. Chain Study Journal (Persistent Memory)

File: docs/chain-studies/YYYY-MM-DD-topic-name.md

Token-efficient format:
```
# Chain Study: Redeemer (#2977)
Started: 2026-02-25

## Link 1: Job 19:25
Text: For I know that my redeemer lives...
Hebrew: go'el — kinsman-redeemer, one who reclaims
Grammar: Qal participle, ongoing living reality
Student: [what student said]
Insight: Job's certainty of a living redeemer despite suffering
Commentary: Calvin noted..., Wright argued...

## Link 2: Psalm 130:8
Text: And he will redeem Israel from all its iniquities
Hebrew: padah — to ransom, deliver by payment
Grammar: Yiqtol imperfect, future/ongoing action
Student: [student's response]
Insight: Shifts from personal redeemer to national redemption
Connection: Redeemer in Job was personal; here expands to all Israel
Commentary: ...

## Thread
- Job: personal, living redeemer in suffering
- Psalms: expansion to national redemption from sin
```

Purpose:
- Survives context window compaction
- Agent reads it at start of each turn for context recovery
- Enables session resumption across conversations
- Grows with each link visited

### 4. Chain Accumulation and Cross-Link Connections

After every 2-3 links:
- Agent offers brief synthesis from the journal thread
- Draws explicit connections between current and earlier links
- Highlights theological development shifts

Related chain suggestions:
- When the agent notices related topics emerging at a verse, it asks: "Your Thompson might show another chain here — do you see anything related to [topic] in the margin?"
- Helps student discover lateral connections in physical Bible

### 5. Use-Case Outputs

At chain completion or natural stopping points, the agent asks which output the student wants:

Personal study: The chain journal itself is the permanent record.

Devotional: Daily reading plan from chain links with a reflective question per day.

Teaching: Lesson outline selecting 3-5 strongest links, discussion questions, background context for each.

Preaching: Sermon outline using canonical progression (OT foundation, prophetic development, Gospel fulfillment, apostolic explanation) with key quotes and word study highlights.

### 6. Changes to rob-agent.md

1. Add "5. Chain Study" to Study Session Types section
2. Add chain-specific tool usage patterns to Tool Usage Strategy (lexicons first, commentaries after discussion, balanced sources)
3. Add Chain Study flow to Session Flow section (opening, core loop, closing with output options)
4. Add new "Chain Study Journal" section (file creation, naming, format, context recovery, session resumption)
5. Add chain-specific question variants to the Correlation layer in Methodology

No MCP server code changes required. Agent instructions only.
