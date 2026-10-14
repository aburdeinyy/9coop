# Layercoop — Product Core

## Суть

**Персональная LLM-станция с визуализацией процессов в реальном времени.**

Пользователь видит граф. В центре — оркестратор (GOD-node). Вокруг — capability-ноды: skill, MCP, agent, rule, pawn. Свяжешь ноды (в т.ч. цепочками), пишешь в чат — контекст собирается из всей reachability от GOD. На canvas видно, как идёт ран: активные ноды, flow по edges, tool-calls, стрим токенов.

Артефакты экспортируются в git-friendly `.layercoop/` и переносятся между проектами.

---

## Три главные цели

1. **Простота** — один чат, контекст из графа, без ручной сборки промптов.
2. **Гибкость** — нода = capability; описал промптом → stub/артефакт; стек собирается графом.
3. **Визуализация** — живой процесс на canvas, не только «запрос → ответ».

---

## Runner (канон исполнения)

**Runner** — единица исполнения LLM: один `RunnerId`, один контракт событий (`token` / `tool` / `done` / `error`), два места запуска.

Capability-ноды (skill / mcp / agent / rule / pawn) — это **не** runners: они собирают контекст и tools. Runner выбирается на GOD (поле `runner`) и исполняет промпт.

| RunnerId | Где крутится | Транспорт |
|----------|--------------|-----------|
| `cursor`, `opencode` | bridge/`runners/` | SSE `POST /v1/run` `{ runner }` |
| `openai`, `openai-compatible` | Angular client runner | `fetch` chat/completions → те же события |
<!-- | `claude-code` | bridge | скрыт из UI (ToS Anthropic); код сохранён | -->
<!-- | `anthropic` | stub | скрыт из UI | -->

```
Промпт (Global Chat / чат ноды)
        │
        ▼
⚡ GOD-node  (god.runner: RunnerId)
        │  composeChatContext(reachability от GOD)
        ▼
Runner registry
  ├─ local  → layercoop-bridge → AgentRunner (cursor | opencode)
  └─ client → OpenAI-compatible HTTP runner
  <!-- claude-code runner в bridge сохранён, в UI не предлагаем -->
        │
        │  node:active · edge:flow · tool:call · token
        ▼
Canvas + Chat
```

**Расширение:** новый бэкенд = новый runner (bridge `AgentRunner` или client generator) + запись в registry + UI preset. Без особых веток в `runtime-engine`.

Legacy: в сохранённых графах читается `runner ?? provider`; в bridge body — `runner ?? runtime`.

Cursor: `Angular → /layercoop-bridge → bridge/ (@cursor/sdk, local cwd) → .layercoop/ + MCP + .env`.

---

## Экспорт

| Тип | Путь |
|-----|------|
| Skill | `.layercoop/skills/{slug}/SKILL.md` |
| MCP | `.layercoop/mcp.d/{slug}.json` + merged `mcp.json` |
| Agent / Pawn | `.layercoop/agents/{slug}.md` |
| Rule | `.layercoop/rules/{slug}.mdc` |
| Граф | `.layercoop/graph.json` |

API keys в ZIP не попадают.

---

## MVP (актуально)

- ✅ Angular 22 canvas (свой, без xyflow)
- ✅ GOD + skill/mcp/agent/rule/pawn; цепочки связей; порты
- ✅ Resize + view-плитки (`layercoop-view`)
- ✅ Runtime + realtime events на canvas
- ✅ Runner registry: Cursor local / opencode / OpenAI / OpenAI-compatible
  <!-- Claude Code скрыт из UI (ToS Anthropic); код раннера сохранён -->
- ✅ Secrets → `.env`
- ✅ Export ZIP → `.layercoop/`
- ✅ Markdown в чате (ссылки)

## Roadmap

- [ ] LLM-генерация артефактов (не только stub)
- [ ] Import `graph.json`
- [ ] Live sync workspace ↔ `.layercoop/`
<!-- - [ ] Anthropic напрямую по API-ключу (`/v1/messages`) — скрыто: Pro/Max нельзя в сторонних приложениях -->
- [ ] Более богатый markdown в чате (таблицы и т.п.)

---

## Стек

| Слой | Что |
|------|-----|
| UI | Angular 22 (standalone, signals) |
| Canvas | HTML/SVG + signals |
| Bridge | Node (`bridge/`), proxy `/layercoop-bridge`, local runners |
| Runners | cursor · opencode (bridge) + openai / openai-compatible (client) |
<!-- | Runners | … · claude-code … — скрыт из UI, код в bridge/ сохранён | -->
| Тесты | Vitest |
| Экспорт | JSZip |
