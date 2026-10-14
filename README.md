# Layercoop

Визуальный GOD-граф: оркестратор в центре, capability-ноды (skill / MCP / agent / rule / pawn) вокруг. Связи — цепочки; контекст чата собирается из всей reachability от GOD. Export в `.layercoop/` ZIP.

Бренд: `public/brand/layercoop-mark.svg` (∞), wordmark `public/brand/layercoop-wordmark.svg`.

## Стек

- **Angular 22** (standalone, signals)
- **SCSS** + CSS variables
- **Vitest** — unit-тесты
- **Bridge** (`bridge/`) — local-раннеры (Cursor SDK / Claude Code / opencode) + MCP + `.env`
- **JSZip** — export

## Быстрый старт

```bash
# из npm (после релиза)
npx layercoop

# из исходников
nvm use 24   # Angular 22: Node ^22.22.3 || ^24.15.0 || >=26
npm install
npm run dev  # UI :4200 + bridge :7843
```

CLI: `layercoop [--port 4200] [--host 127.0.0.1] [--no-open]` — UI + bridge на одном порту (прокси `/layercoop-bridge`).

Секреты — через UI **Secrets** → корневой `.env`. Что нужно на машине под каждый runner:

| Runner | Требование | Авторизация |
|--------|-----------|-------------|
| `cursor` | Cursor CLI / SDK | Cursor API key на GOD-ноде |
| `claude-code` | Claude Code CLI (`claude`) | **подписка Pro/Max** через свой `claude login`, либо Anthropic API key |
| `opencode` | `opencode serve` (по умолчанию :4096) | конфиг самого opencode; пароль сервера — опционально |
| `openai` / `openai-compatible` | — | ключ + Base URL на GOD-ноде |

Layercoop не хранит и не проксирует учётные данные Claude: для `claude-code` он запускает
немодифицированный бинарь `claude`, который сам берёт креды пользователя. Собственный
OAuth к claude.ai сторонним приложениям [запрещён](https://code.claude.com/docs/en/legal-and-compliance).

**Тумблер «Изолированный ран»** на GOD-ноде (только `claude-code`) переключает `--bare`:
включён — в контексте только граф (не читаются `CLAUDE.md`, хуки, `.mcp.json`, плагины),
но подписочный вход недоступен и нужен API key; выключен — работает подписка, но
в контекст попадает ambient-окружение проекта.

## Скрипты

| Команда | Описание |
|---------|----------|
| `npm run dev` | UI (`ng serve`) + bridge; proxy `/layercoop-bridge`, `/cursor-api` |
| `npm start` | Только UI |
| `npm run bridge` | Только sidecar (`tsx bridge/src/server.ts`) |
| `npm run build` | Production build |
| `npm test` | Vitest |
| `npm run test:watch` | Vitest watch |
| `npm run semantic-release` | Релиз (обычно из GitHub Actions) |

## Релиз

Публикация идёт через [semantic-release](https://semantic-release.org/) только на push в `release` (workflow `.github/workflows/release.yml`).

Релиз только с ветки `release`. Публикация — **Trusted Publishing (OIDC)**, без `NPM_TOKEN`.
Нужны `semantic-release` ≥ 25 и `@semantic-release/npm` ≥ 13.1 (OIDC), плюс `id-token: write` в workflow.

1. **Один раз** создай пакет на npm (OIDC не умеет первую публикацию):
   ```bash
   npm login
   git checkout release && git pull
   npm publish --access public --otp=КОД_ИЗ_2FA
   ```
2. На npm → пакет `layercoop` → **Settings** → **Trusted Publisher** → GitHub Actions:
   - Organization or user: `aburdeinyy`
   - Repository: `9coop`
   - Workflow filename: `release.yml` (только имя файла)
   - Environment: пусто
3. В GitHub **удали** secret `NPM_TOKEN` / `NODE_AUTH_TOKEN`, если есть (мешают OIDC).
4. Запушь workflow на `release` — дальше версии публикует CI.
5. Коммиты: `feat(…)`, `fix(…)` — от них считается версия.

## Что умеет сейчас

- GOD + artifact-ноды; тип ноды инферится из промпта
- Связи **порт → порт** (и клик по ребру / ✕ в bubble — отвязка); цепочки учитываются в контексте GOD
- Resize плиток; compact view растёт с высотой
- View-виджеты на ноде (` ```layercoop-view ` → list / kv / markdown)
- Чаты на GOD и на каждой ноде; markdown-ссылки в ответах
- Runtime: plan rule→skill→mcp→agent/pawn, подсветка нод/edges, стрим токенов
- Runners: Cursor local SDK (default), Claude Code (подписка Pro/Max или ключ), opencode, OpenAI / OpenAI-compatible
- Secrets → `.env`; MCP с нод → `Agent.create({ mcpServers })`
- Export ZIP → `.layercoop/{skills,mcp.d,agents,rules,graph.json,mcp.json}`

## Структура

```
src/app/
  core/
    models/     — граф, view-spec
    runtime/    — plan, engine, runners, MCP mapping
    services/   — Graph, Runtime, Secrets
    utils/      — compose-context, graph-links, export, chat-markdown, …
  features/
    toolbar/          — ноды, export, secrets
    graph-canvas/     — canvas, порты, resize, edges
    node-chat-bubble/ — настройки + чат ноды
    node-view/        — рендер плиток
    global-chat/      — сайдбар-чат
    secrets-panel/    — .env UI
bridge/               — sidecar с local-раннерами
  runners/            — cursor · claude-code · opencode
.layercoop/           — workspace-артефакты (не .cursor/)
tests/                — Vitest
```

## Product vision

См. [PRODUCT-CORE.md](./PRODUCT-CORE.md)

## Лицензия

MIT
