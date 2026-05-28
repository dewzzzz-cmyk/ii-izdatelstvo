# Vector Bible (TF-IDF) — Design Spec
_2026-05-27_

## Goal
Replace keyword-only Bible lookup with TF-IDF + cosine similarity for better semantic matching in Russian text, with zero external dependencies.

## Why TF-IDF (not transformers.js)
- Zero CDN dependencies (project principle)
- Instant (no model load time)
- Works well for short Bible entries
- Reuses existing Russian stemmer for normalization

## Algorithm
```
tokenize(text) → stem each word → filter stopwords → array of stems
tfidf(doc, corpus) → {stem: score} for each token
cosine(vecA, vecB) → float [0..1]
```

### On Bible Entry Save/Edit
Compute and store `entry._vec = tfidf(tokenize(entry.keys + ' ' + entry.text), allEntries)`.
Recompute all vectors when any entry changes (corpus changes → IDF changes).

### In `bibleFor(context)`
1. Tokenize + stem context
2. Compute context TF-IDF vector
3. For each Bible entry with `_vec`, compute cosine similarity
4. Return top-3 entries with `similarity > 0.15` threshold
5. Fallback: if all similarities < 0.05, use existing keyword matcher (ensures nothing breaks)

## New Functions in app.js
```js
function tokenizeRu(text)           // stem + filter stop words
function tfidf(tokens, corpus)      // returns {token: score} map
function cosine(a, b)               // cosine similarity
function rebuildBibleVecs()         // recomputes all _vec fields
function bibleForVec(context)       // new vector-based lookup
```

## Data Model Change
Bible entries get a transient `_vec` field (not serialized to JSON export):
```js
state.bible[i] = { keys, text, _vec: {stem: score, ...} }
```
`_vec` is rebuilt on `load()` and after any Bible edit. Not saved to localStorage.

## Files to Change
- `app.js`:
  - Add `STOP_WORDS_RU` constant (common Russian stopwords)
  - Add `tokenizeRu`, `tfidf`, `cosine`, `rebuildBibleVecs`, `bibleForVec`
  - Replace `bibleFor()` implementation with vector version + keyword fallback
  - Call `rebuildBibleVecs()` in `load()` and after Bible save

## Backward Compatibility
- Existing keyword matcher kept as `bibleForKeyword()` fallback
- If Bible has < 3 entries, fall back to keyword (not enough corpus for IDF)
- `_vec` fields excluded from JSON export/import (no state bloat)

## Testing
- "Иван" entry matches "Иванова" in context ✅ (via stemmer, same as before)
- "главный герой" entry matches "протагониста" context ✅ (TF-IDF overlap)
- Unrelated context returns empty ✅
- 0-entry Bible returns empty ✅
