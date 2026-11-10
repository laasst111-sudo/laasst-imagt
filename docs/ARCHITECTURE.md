# ARCHITECTURE.md

# ST Image Plugin Gen2 — Architecture Constraints v1.0

> Status: Frozen
>
> Last Updated: 2026-07-24

---

## 1. Allowed Architecture

### Layer Structure

```
Silly Tavern
      │
      ▼
 Plugin UI
      │
      ▼
   Core
      │
 ┌────┴────┐
 ▼         ▼
Prompt   Image
 │          │
 ▼          ▼
LLM (configurable)    ComfyUI
```

Maximum layers: **3** (`UI → Core → External`).

No layer may contain sub-layers.

---

### Dependency Direction

```
UI  →  Core  →  External
```

Allowed:

- `UI` depends on `Core`
- `Core` depends on `External`
- `UI` depends on `External` directly (for ST API calls only)

Forbidden:

- `External` depends on `Core`
- `Core` depends on `UI`
- Any circular dependency
- Any bidirectional dependency

---

## 2. Core Flow

The project has exactly **one** core flow:

```
Generate Image
```

All code must exist to serve this single flow.

Any feature that does not directly belong to this flow must be deferred to a future version.

---

## 3. Allowed Components

| Layer | Allowed |
|-------|---------|
| UI | Button, Settings panel, Image display |
| Core | Prompt builder, Flow controller, State |
| External | ST adapter, ComfyUI client, LLM client (configurable) |

---

## 4. Forbidden

The following concepts are **permanently forbidden** in this project:

- Provider / Provider Framework
- Manager / Manager Tree
- Runtime / Runtime Engine
- Pipeline / Pipeline Framework
- Engine / Dispatcher
- Registry / Service Locator
- Event Bus / Event System
- Plugin Loader / Plugin Framework
- Factory / Factory Framework
- IOC / DI Container
- Middleware / Middleware Chain
- Executor / Executor Framework
- Context / Context Manager
- Adapter Framework
- Workflow Engine

Any AI suggestion to introduce these must be rejected with:

> Violates ARCHITECTURE.md.

---

## 5. File & Directory Constraints

- Default layout: **flat** (`src/` directory, no subdirectories)
- A subdirectory may only be created when a single responsibility has **≥3 files**
- A file must have exactly one responsibility
- No empty files, no placeholder files

---

## 6. Version Constraints

- Each version has exactly one goal
- Each version has a Definition of Done
- When Done is satisfied, the version is frozen immediately
- No version may introduce architecture beyond these constraints
