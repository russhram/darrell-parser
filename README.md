# Darrell parser

Локальный Node.js/TypeScript-сервис для подготовки и чтения учебного материала.
Основан на [плане реализации](documentation/implementation-plan.md).

**Эта итерация — основа сервиса. Настоящий вход и сбор Noordhoff отложены на
следующую итерацию по запросу пользователя.** Тесты используют вымышленную
локальную платформу; они не доказывают полноту настоящей книги. Noordhoff-адаптер
предварительный: селекторы закрытого курса и native переключение языка ещё
предстоит проверить. Generic-оглавление не считается полной инвентаризацией.

## Установка

Нужен Node **24**, версия закреплена в `.nvmrc`.

```bash
nvm install
nvm use
npm ci
npx playwright install chromium
npm run build
npm start
```

На Linux: `npx playwright install --with-deps chromium` также устанавливает
системные зависимости. UI: `http://127.0.0.1:3000`.

Существующий `.env` **не перезаписывать**. Для нового checkout используйте пустой
`.env.example`. Node загружает настройки при запуске; внешнее окружение имеет
приоритет. `.env` не читается прикладным кодом, не раздаётся и не экспортируется.

Уже выбранные поля:

```dotenv
USERNAME=
PASSWORD=
BOOK_ID=
SCHOOL_NAME=ZAAM
SCHOOL_GROUP=SECONDARY
```

`BOOK_ID` — UUID; URL вычисляется как
`https://apps.noordhoff.nl/se/content/book/<BOOK_ID>`. API не принимает произвольные
сайты. `SITE_USERNAME`/`SITE_PASSWORD` поддерживаются как алиасы.

Локальный UI использует **отдельные** `APP_USERNAME`/`APP_PASSWORD`.
Если пароль не задан, сервис генерирует его в приватном файле
`data/local-access.txt` (`0600`), username — `local`. Посмотрите файл локально;
он исключён из Git и ZIP. Пароли не логируются. При другом `DATA_DIR` файл лежит
там. Автоматический пароль меняется при перезапуске.

## Сценарий

1. Войти в локальный UI и нажать **Sign in and discover contents**.
2. Worker создаст отдельный Chromium (`HEADLESS=false` по умолчанию).
   Предварительный путь: **via Entree → SCHOOL_NAME → клик в поле → единственный
   результат ZAAM → Magister**. `SCHOOL_GROUP=SECONDARY` — среднее образование;
   при наличии select группы значение применяется к нему. `PRIMARY` принимается,
   но реальный сценарий не проверен. Credentials вводятся только на доверенных
   школьных origins. Дополнительный `SCHOOL_LOGIN_ORIGIN` задаётся точным HTTPS
   origin после проверки адреса, иначе вход завершается вручную.
3. Завершить SSO/MFA в окне. CAPTCHA не решается. IP-блокировка возвращает
   `access_blocked_403`; ebook — `unsupported_ebook`. Защиты не обходятся.
4. Выбрать обнаруженные учебные элементы, подтвердить права на точный текст и
   изображения. В этой итерации поддерживается `authorized_verbatim`; учебные
   заметки не реализованы. Без разрешения images сохраняются только метаданные.
5. Запустить сбор; следить за прогрессом, отменить или возобновить. Частичный
   результат доступен в viewer/ZIP и явно помечен.

NL/EN берутся из переключателя самого сайта, без сторонних переводчиков.
Неизменившийся текст и неподтверждённый язык отмечаются как отсутствующие.
ID/options/подпункты сопоставляются по стабильным ключам. Сбор не заполняет и
не отправляет упражнения, не раскрывает скрытые ответы и не сохраняет прошлые
ответы ученика. Видимый эталон, feedback и отсутствие ответа различаются.
Отправка ответов, suggested answers, OCR/vision в эту итерацию не входят.
Сохранённая карта остаётся `inspection_pending`; скачивание не равно её осмотру.

## Повторное чтение

```bash
npm run view
npm run view -- --job <job-id>
npm run build:viewer -- --job <job-id>
```

`view` слушает `http://127.0.0.1:3001` и показывает библиотеку без worker,
Playwright и обязательных school credentials. `--job` печатает прямой URL viewer.
`build:viewer` перечитывает проверенный JSON без запросов в школу.
Можно перенести пакет и открыть `viewer/index.html`: нет CDN/hotlinks, внешних
шрифтов и runtime-запросов за материалом; без JS оба языка остаются видимыми.
Есть переключатель NL/EN/оба, оглавление, поиск по обоим языкам и ID, сохранённые
ответы, таблицы, источники и печать. Текст экранируется; raw app HTML не исполняется.

## Файлы и надёжность

SQLite в `data/state.sqlite` хранит задания, чекпоинты и lock worker. Материал:

```text
output/<job-id>/
  manifest.json
  scope-inventory.json
  extraction-report.json / extraction-report.md
  checkpoints/<item-id>.json
  data/book.json
  data/chapters/chapter-<hash>.json
  content/chapters/chapter-<hash>_content_EN-NL.md
  source/<item-language-frame>.html
  viewer/index.html / viewer.css / viewer.js
  viewer/media/<sha256>.<extension>
  viewer/media/media-manifest.json
```

JSON — единый источник MD/HTML. После каждого элемента публикуется чекпоинт и
частичный viewer. Resume пропускает успешные элементы, перечитывает неполные.
Cookie/auth state только в памяти, поэтому после перезапуска нужен новый вход.
Запускайте один экземпляр API на DATA_DIR; второй worker блокируется SQLite.
Source snapshots — пассивная реконструкция учебных блоков, без DOM аккаунта.
ZIP включает только allowlist viewer/content/canonical data/отчётов; cookies,
SQLite, `.env`, checkpoints и source snapshots исключены. HTTP раздаёт только
viewer, а не корень output. Переносимый HTML сам по себе не защищён паролем.

## Ограничения

Все настройки — `.env.example`. Лимиты по умолчанию: 500 элементов, 120 минут,
1000 мс между элементами, 25 MiB на asset, 1000 MiB на JSON/media. Экспортные
копии, snapshots и ZIP требуют дополнительного места. Растровые images
проверяются по Content-Type и сигнатуре. SVG/canvas/blob/data/CSS-background,
redirect-assets и файлы без Content-Length пока дают явный пропуск. Origins
assets расширяются в доверенном профиле после проверки реального курса.

UI защищён HttpOnly/SameSite сессией, Origin/CSRF, rate limit входа; поддерживается
только loopback HOST. Проверяются пути/symlinks, allowlist origins и DNS/IP при
каждом browser request; service workers блокируются. DNS-проверка не заменяет
изоляцию сети от rebinding. Для публикации нужны отдельно HTTPS, ограничения
исходящей сети и пересмотр доступа. Секреты в state/экспорте не сохраняются.

## API и тесты

`/auth/login`, `/auth/logout`, `/api/session`, `/api/profiles`, `/api/discover`,
`/api/discover/:id`, `/api/jobs`, `/api/jobs/:id`, `/api/jobs/:id/events` (SSE),
`/api/jobs/:id/cancel`, `/api/jobs/:id/resume`, `/api/jobs/:id/report`,
`/api/jobs/:id/export`, `/view/:id/`. Изменяющим запросам нужны Origin и
`X-CSRF-Token` из `/api/session`; credentials в body API не принимаются.

```bash
npm run check
npm run build
npm test
npm run test:e2e
```

Тесты не загружают `.env`. Проверяются schema/XSS/SSRF/path confinement,
auth/CSRF/ZIP, SQLite lock, браузерный fixture login, JS-контент, native языки,
таблицы, подпункты, authenticated media, ebook-stop, отсутствие отправок,
cancel/resume, offline viewer, mobile/print и отключённый JS. GitHub Actions
повторяет build и тесты на Node 24/Linux.

Следующая итерация: проверить SSO ZAAM, origins/селекторы и языки учебного
содержимого; инвентаризировать реальные главы/вкладки/упражнения; сравнить одну
полную главу с живой книгой, затем расширить адаптер и expected coverage.
