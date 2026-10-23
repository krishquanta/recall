# Gemini Key Pool & API Optimization (Phase 2 Extension)
> **Multi-Key Pooling, Rate Limiting, Request Batching, and Persistent Caching**

---

## 🎯 Goal Description

Optimize Recall's Google Gemini API usage by eliminating redundant calls, dramatically reducing token consumption, preventing 429 rate limit errors, and multiplying available quota through a multi-key pool with automatic failover and local persistent caching.

---

## 🏗️ Architecture of Key & Cache Optimization

```mermaid
flowchart TD
    subgraph Client["Client Request Layer"]
        Upload["Document Ingestion"]
        Chat["Conversational Q&A"]
        Graph["Graph Extraction"]
    end

    subgraph CacheLayer["Persistent Two-Tier Cache (CacheService)"]
        MemCache["In-Memory LRU Cache"]
        DiskCache["data/gemini_cache.json"]
        MemCache <--> DiskCache
    end

    subgraph PoolLayer["Key Management & Throttling (KeyManager)"]
        KeyPool["Key Pool (Key 1, Key 2, Key 3...)"]
        RateLimiter["Adaptive Token Bucket (15 RPM / key)"]
        CooldownTracker["Cooldown Tracker (60s on 429)"]
        Rotator["Round-Robin / Health Selector"]
    end

    subgraph GeminiAPI["Google Gemini Endpoints"]
        EmbeddingAPI["text-embedding-004 (Batch)"]
        GenerateAPI["gemini-3.8-flash (JSON Schema / Chat)"]
        VisionAPI["gemini-2.0-flash (OCR)"]
    end

    Client -->|Check cache first| CacheLayer
    CacheLayer -->|Cache Hit (0 API calls)| Client
    CacheLayer -->|Cache Miss| PoolLayer
    PoolLayer --> RateLimiter
    RateLimiter --> Rotator
    Rotator --> KeyPool
    KeyPool --> GeminiAPI
    GeminiAPI -.->|429 Rate Limit| CooldownTracker
    CooldownTracker -.->|Switch to next key & retry| Rotator
```

---

## 📦 Core Components & Specifications

### 1. Multi-Key Pooling & Failover (`KeyManager.ts`)
- **Key Configuration**: Reads `GEMINI_API_KEYS=key1,key2,key3` (comma-separated) or backwards-compatible `GEMINI_API_KEY=key1`.
- **Round-Robin Load Balancing**: Balances requests evenly across active, healthy keys.
- **Automatic 429 Failover**:
  - Catches `429 Too Many Requests` or `ResourceExhausted`.
  - Places that specific key in a 60-second cooldown period.
  - Immediately retries the request using the next available key in the pool with zero disruption.
- **Adaptive Rate Limiting**: Proactively respects the 15 RPM free tier limit per key (or higher for paid keys), scaling total request capacity proportionally with the number of keys.
- **Runtime Key Updates**: Allows querying and adding keys dynamically without restarting the server.

### 2. Persistent Local Caching (`CacheService.ts`)
- **Two-Tier Storage**: High-speed in-memory map + atomic local JSON file (`backend/data/gemini_cache.json`).
- **Embedding Cache**: Hash-keyed by `sha256(text)`. Completely skips Gemini API calls for already-seen chunks, duplicate entities during deduplication, and repeated search queries.
- **Q&A Response Cache**: Keyed by `sha256(normalizedQuestion + sortedDocIds)` to return instant answers for repeated questions under identical document scopes.
- **Metrics**: Tracks cache hits, misses, and calculates total API calls and tokens saved.

### 3. Windowed Extraction & Batch Deduplication
- **Windowed Extraction (`GraphExtractionService.ts`)**:
  - Instead of invoking Gemini chunk-by-chunk (512 words each), merges 2–4 adjacent chunks into ~2,000-token multi-chunk windows.
  - **Result**: Cuts LLM graph extraction API calls by **60% to 75%** while maintaining precise page/slide/line metadata.
- **Batch Deduplication (`DeduplicationService.ts`)**:
  - Aggregates all unique candidate entity names across an extraction batch.
  - Filters out cached entities, and embeds all remaining unseen names in a single `batchEmbedContents` call (up to 100 per call).
  - **Result**: Reduces deduplication embedding calls by **90%**.

### 4. Subtle, Quiet Settings Interface
- **Backend Endpoint**: `GET /api/settings/keys` and `POST /api/settings/keys`.
- **Frontend Dialog (`SettingsModal.tsx`)**:
  - Discreetly accessible via the existing header gear icon (⚙️).
  - Shows masked keys (`AIza...3F2b`), current health (Active / Cooldown), and total calls saved by the cache.
  - Non-intrusive: does not display loud badges or interrupt the study workflow.

---

## 🧪 Verification Plan

1. **Unit Tests**:
   - `test/unit/KeyManager.test.ts`: Round-robin rotation, 429 cooldown trigger, automatic key failover retry.
   - `test/unit/CacheService.test.ts`: Cache hits return identical vectors without provider calls; disk persistence to `data/gemini_cache.json`.
2. **Integration Verification**:
   - Verify multi-chunk windowing cuts extraction calls by $\ge 60\%$.
   - Verify batch deduplication embeds up to 100 entities in a single call.
3. **Build & DoD Tests**:
   - `pnpm --prefix backend test` (all tests passing).
   - `pnpm build` (clean monorepo build with 0 TypeScript/Vite errors).
