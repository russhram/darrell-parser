# Состояние первой итерации

5 октября 2026. Область уточнена пользователем: реализовать доступную основу;
настоящий login и scraping Noordhoff выполнить следующей итерацией.
Существующий `.env` не открывался, не загружался для проверок и не изменялся.

## Реализовано

- Node 24 / TypeScript, закреплённые зависимости и build с viewer assets.
- USERNAME, PASSWORD, BOOK_ID, SCHOOL_NAME, SCHOOL_GROUP; фиксированный URL книги.
- Локальный Fastify UI, отдельная авторизация, CSRF/Origin, rate limit входа.
- Отдельный worker-процесс, SQLite state/lock, SSE, выбор inventory, cancel/resume.
- Предварительный Entree/ZAAM adapter, pause для SSO, ebook/IP-block stop.
- Семантические учебные blocks, вопросы/подпункты/options, tables/spans,
  provenance/hash, видимые ответы и feedback, native языковые пары NL/EN.
- Ограниченные raster media, manifests, JSON schemas, атомарные checkpoints,
  отчёт с unknown coverage, missing languages и visual inspection pending.
- Canonical JSON, MD по главам, пассивные source snapshots, ZIP allowlist,
  HTML viewer: язык/оглавление/поиск/ответы/mobile/print/offline.
- Команды view/build:viewer без scraping; тесты и CI на fixtures.

## Подтверждено на внешнем сайте без credentials

Noordhoff перенаправляет на login с кнопкой «via Entree». Entree фильтрует
`ZAAM` и предлагает «Inloggen met Zaam Amsterdam - Inloggen met Magister».
Переход ведёт к `saml.magister.net`. В текущей проверке Magister вернул 403 с
сообщением об IP-блокировке. Этот экран не означает неверные credentials.

## Следующая итерация и отличия от полного плана

- Реальный login/SCHOOL_GROUP, доступ к указанной книге, все SSO/media origins.
- Независимый inventory, динамические chapter/section tabs, pagination и
  platform IDs/языковое соответствие на одной полной главе.
- Прототип селекторов main/menu/question пока не подтверждён для защищённой книги.
  Неизвестное оглавление остаётся adapter_required/partial, не 100%.
- SVG/canvas/blob/data/CSS background, media redirects и streaming download.
  Сейчас поддержаны только прямые raster assets с известным Content-Length.
- Closed shadow DOM, сложные формулы и осмотр карт/графиков/OCR.
- Иерархический glossary, учебные заметки, предложенные ответы и однократная
  отправка ответов не реализованы. Пользователь выбрал exact text/images и
  native языки, поэтому сторонний переводчик не нужен в этой итерации.
- Отдельные expected-счётчики questions/subparts/sources требуют реального
  inventory; сейчас полнота рассчитывается по выбранным учебным элементам.
- Persistent school session и восстановление auth потребуют проверенного SSO.
  Сейчас cookie state существует только в памяти, resume выполняет новый вход.

Локальные и fixture-проверки не заменяют приёмку настоящего источника,
упомянутую в пунктах 21–22 исходного плана.
