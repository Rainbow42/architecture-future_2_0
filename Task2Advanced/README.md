# Удалённое состояние и CI/CD

Подготовила backend и pipeline. Созданы приватный бакет с versioning и шифрованием KMS, отдельный ключ, state-аккаунты, локальный Jenkins и изолированный Linux-агент без монтирования домашнего каталога. Реальные S3-проверки трёх сред и блокировка двумя процессами Terraform на синтетическом state прошли. Dev build 3 после ручного подтверждения завершился FAILURE на создании диска в ru-central1-a: три сетевых ресурса сохранены в state, ВМ и дисков нет, recovery-required не снят. Stage build 1 после ручного подтверждения завершился SUCCESS: ВМ RUNNING, оба HDD READY, пять ресурсов и outputs сверены с API и зашифрованным state. Prod build 1 после ручного input частично отказал на квоте третьей VPC; data-диск сохранён в state. Согласовано переиспользование VPC stage и подготовка точной очистки stage compute; полная проверка трёх сред не закончена.

## Backend

[Генератор](backend.mjs) формирует HCL без секретов для отдельных корневых конфигураций Task1Advanced.

| Среда | Ключ состояния | Ключ блокировки |
|---|---|---|
| dev | `sprint11/dev/terraform.tfstate` | `sprint11/dev/terraform.tfstate.tflock` |
| stage | `sprint11/stage/terraform.tfstate` | `sprint11/stage/terraform.tfstate.tflock` |
| prod | `sprint11/prod/terraform.tfstate` | `sprint11/prod/terraform.tfstate.tflock` |

Среды используют разные identities и только workspace `default`. Префикс служебного перечисления workspaces тоже разделён по средам. Подставлять prod.tfvars в каталог dev нельзя.

`use_lockfile=true` включает нативную блокировку S3, `-lock-timeout=60s` ограничивает ожидание. Автоматического force-unlock и `-lock=false` нет. Jenkins `disableConcurrentBuilds()` сериализует один job, но не заменяет backend lock для других процессов Terraform.

Выбран S3 API с поддержкой conditional writes. Для собственного MinIO необходимо проверить эти операции на выбранной версии: наличие S3 API не доказывает корректность блокировки. На выбранном Object Storage настоящая проверка Terraform 1.12.2 с use_lockfile=true подтвердила отказ конкурента, ожидание и успешный plan после освобождения lock. Вариант с YDB не разворачивала. Результат относится к проверенному backend и версии Terraform, а не ко всем S3-реализациям.

Обязательные настройки backend: HTTPS с проверяемым сертификатом, private bucket, versioning, запрет незашифрованного транспорта. Режим `TF_STATE_ENCRYPTION=sse-s3` по умолчанию задаёт `encrypt=true` и требует AES256. Для соответствующей конфигурации MinIO нужен подготовленный KMS. Бакет, identities и KMS создаются отдельно от VM-state: удаление ВМ не должно удалять историю состояния. Состояние и его версии считаются конфиденциальными.

Для Yandex Object Storage предусмотрен `TF_STATE_ENCRYPTION=bucket-kms` с обязательным `TF_STATE_KMS_KEY_ID`. Terraform 1.12.2 при `encrypt=true` посылает AES256, а Object Storage поддерживает aws:kms; проверка `kms_key_id` этой версии Terraform не принимает собственный ID ключа YC. Поэтому в этом режиме клиент не задаёт SSE-заголовок (`encrypt=false` в HCL), а шифрование выполняется обязательной настройкой бакета. Это не отключение шифрования бакета. [Проверка backend](backend-preflight.mjs) до запуска Terraform должна прочитать настройки и подтвердить aws:kms с точным ID ключа, versioning, отсутствие групповых ACL и публичных Allow, запрет HTTP в policy. При любой ошибке Terraform не запускается; режим и ID ключа входят в хеш контекста сохранённого плана. Совместимость текущего генератора проверена настоящими S3/lock-пробами и stage deployment; результат относится к зафиксированным версиям и конфигурации.

Для preflight требуются GetBucketAcl, GetBucketVersioning, GetEncryptionConfiguration и GetBucketPolicy. В YC последнее требует отдельной роли `storage.configViewer` на бакет: она не даёт содержимое объектов, но раскрывает их имена и настройки. Такой доступ к метаданным всех сред отдельно согласован и применён вместе с явными S3-read разрешениями. Роль изменения настроек бакета для state-аккаунтов не нужна.

На реальном backend применены точные state/lock/verification-пути трёх identities, удаление только lock/проверочных объектов и запрет HTTP. Сначала GetBucketEncryption вернул ServerSideEncryptionConfigurationNotFoundError, и preflight корректно остановился. Затем шифрование включено существующим KMS-ключом. Все три identities подтвердили aws:kms, точный ключ, versioning=Enabled, ACL и policy; настоящий preflight завершился с exit=0 для каждой среды.

Для включения KMS по отдельным разрешениям использован временный настройщик: роль storage.configurer только на бакет и правило только Get/PutEncryptionConfiguration. По отдельности эти механизмы вернули 403, вместе настройка и чтение результата прошли. После проверки временная роль и правило сняты, S3-ключ отозван; исходные девять правил сохранены. Прямого доступа к объектам настройщику не выдавалось. Служебное wildcard-правило консоли не добавлялось.

В YC [IAM/ACL проверяется до bucket policy](https://yandex.cloud/ru/docs/storage/security/overview). Policy с нужным префиксом сама по себе не заменяет базовое разрешение на операцию. Первая PutObject вернула 403. После отдельного разрешения state-аккаунтам назначена storage.editor только на этот бакет, без ролей на каталог/облако. Эта IAM-роль сама по себе широкая; действующая policy дополнительно ограничивает каждого своими объектами и разрешёнными операциями. Сначала проверена dev-identity, затем все три: реальные попытки чтения, чтения версий, записи и удаления чужих существующих проб отклонены. Снятие policy изменит границу доступа, поэтому её наличие и запрет HTTP обязательны. Успешный preflight не заменяет проверки изоляции данных.

В [шаблоне identity policy](state-policy.example.json) заменяются `REPLACE_BUCKET` и `REPLACE_ENVIRONMENT`. Это шаблон разрешений для привязки к identity в MinIO/AWS, а не готовая bucket policy YC: последней нужны явные `Principal.CanonicalUser`, отдельный запрет HTTP и настройки доступа к метаданным. Разрешены ListBucket только своего префикса, Get/Put точного state и Get/Put/Delete точного lock-файла. Delete state не требуется. Для plan-identity Put state можно убрать после проверки bootstrap-поведения backend; запись/удаление lock-файла нужны и для plan. При необходимости KMS-права ограничиваются конкретным ключом. Политика не была применена к реальной учётной записи.

Пример локального init после отдельного разрешения и подготовки backend:

```sh
umask 077
export TF_STATE_ENDPOINT=https://state.example.invalid
export TF_STATE_BUCKET=replace-with-private-state-bucket
export TF_STATE_REGION=us-east-1
node Task2Advanced/backend.mjs dev > /absolute/private/path/dev.local.hcl
terraform -chdir=Task1Advanced/envs/dev init -input=false -backend-config=/absolute/private/path/dev.local.hcl
```

Адрес — неработающий пример. `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` передаются окружением, не аргументами, tfvars или backend-файлом. Отдельный `YC_TOKEN` аутентифицирует провайдер, а не S3. В CI [обёртка](with-iam.mjs) получает свежий IAM-токен непосредственно перед plan и повторно перед apply из соответствующего Secret file. [Обмен ключа](iam-token.mjs) использует PS256, проверяет ожидаемую identity, права файла и срок токена; JWT и токен остаются в памяти. Ожидание input не требует заранее сохранённого долгоживущего IAM-токена.

## Pipeline

[GitHub workflow](../.github/workflows/terraform.yml) выполняет только проверки без облака и секретов: fmt, init без backend, validate и mock-планы. Deployment jobs и публикации plan/state в нём нет.

Для настоящего CI/CD подготовлен [Jenkinsfile](Jenkinsfile):

1. Prepare: checkout доверенного SCM, сравнение полного SHA с `APPROVED_COMMIT`, локальные проверки.
2. Init and plan: remote init → validate → сохранённый бинарный plan под plan-identity.
3. Approve saved plan: обязательный `input`, список разрешённых пользователей/групп `TF_APPROVERS`, ожидание до 12 часов. Отказ завершает pipeline до выдачи apply-credentials.
4. Apply: отдельная apply-identity и именно сохранённый plan на том же агенте, без повторного планирования.

Созданы jobs future-deploy-dev, future-deploy-stage, future-deploy-prod. SCM URL фиксируется на этом репозитории, ветка — проверенная main/codex/sprint-11. Automatic PR discovery и произвольные форки не подключаются. Полный SHA задаётся в `APPROVED_COMMIT` перед запуском и проверяется до выдачи credentials. [Загрузчик настроек](job-settings.mjs) читает приватный JSON на агенте: путь TF_JOB_CONFIG_FILE задан администратором, раздел выбирается по полному JOB_NAME, имя job должно совпасть с фиксированной средой. Разрешён только явный список параметров и однострочные значения; произвольное окружение из JSON не принимается. JSON разбирается Node.js через обычный sh, без отключения Groovy sandbox или новых глобальных script approvals. Изменять SCM/Jenkinsfile/job и настройки могут только доверенные администраторы. До TF_DEPLOYMENT_ENABLED=true выполнение прекращается.

Перед подтверждением человек или явно уполномоченный исполнитель открывает `plan.private.txt` на приватном агенте, проверяет ресурсы, диски, сеть, каталог, удаления, стоимость и SHA256; затем нажимает Apply reviewed plan в Jenkins. Сводка количества действий не заменяет полный план. Stage и первая попытка prod подтверждены владелицей вручную; последующие обычные create/update она делегировала после проверки плана. Удаление требует отдельного согласия. Input не отключается и не подтверждается административным API. Администратор Jenkins технически может подтвердить input независимо от списка: это доверенная роль. Restart from Stage отключён, чтобы не перескакивать через согласование. План старше 24 часов отклоняется.

Бинарный plan, state, полный вывод Terraform и аварийный state не загружаются в GitHub artifacts, в том числе зашифрованными. В консоль CI выводятся только среда, commit, хеш и количества действий. Полные данные остаются на приватном Jenkins-агенте. Такой gate не зависит от платных возможностей GitHub; вычислительные ресурсы CI всё равно должны укладываться в отдельно согласованный бюджет.

Требования к приватному CI:

- Jenkins с Pipeline, Git, Credentials Binding и Pipeline Input Step; без анонимного доступа, с ограниченными правами запуска, изменения job и подтверждения.
- Постоянный Linux-агент `future-terraform`: Node.js 22, Terraform ровно 1.12.2, Git, tar, непривилегированный пользователь; без соседних недоверенных задач. Все стадии одного запуска остаются на одном агенте.
- `TF_PLAN_DIRECTORY` вне workspace, например `/srv/future-terraform/plans`; владелец — пользователь агента, режим 0700, зашифрованный диск. Файлы создаются с 0600. Каталог не включается в публичные backups/артефакты.
- Приватный доступ к полному плану только у подтверждающего человека. Агент не получает доступ к рабочим облакам и личным данным и не подключается как GitHub self-hosted runner публичного репозитория.

[Скрипт](pipeline.mjs) сохраняет снимок Task1Advanced из точного commit в `<run_id>-<attempt>-<среда>`. `TF_RUN_ID` — Jenkins build number, `TF_RUN_ATTEMPT=1`; повторение требует нового build. Один job на среду и постоянная нумерация обязательны; существующий каталог не перезаписывается. Перед apply сверяются commit, run/attempt, среда, версия Terraform, хеш backend/параметров, хеш plan и срок. Повторный apply отклоняется. SHA256 обнаруживает порчу, но не защищает от администратора, способного изменить и plan, и manifest. Приватный CI — доверенная граница.

## Настройки вне репозитория

Несекретные параметры фиксируются в приватном JSON конфигурации jobs на агенте. Secrets хранятся в Jenkins Credentials, не в build parameters. S3-identities разделены по средам; plan/apply одной среды используют одну её S3-identity, поскольку Terraform должен создавать и удалять lock при обеих операциях. Для Compute plan и apply используются разные аккаунты.

| Тип | Имя | Назначение |
|---|---|---|
| Job variables | `TF_DEPLOYMENT_ENABLED`, `TF_ENVIRONMENT`, `TF_APPROVERS` | Флаг, фиксированная среда, IDs подтверждающих пользователей/групп |
| Job variables | `TF_STATE_ENDPOINT`, `TF_STATE_BUCKET`, `TF_STATE_REGION` | Подготовленный приватный backend |
| Job variable | `TF_PLAN_DIRECTORY` | Приватное постоянное место для планов |
| Job variables | `TF_VAR_folder_id`, `TF_VAR_boot_image_id`, `TF_VAR_ssh_public_key` | Учебный каталог, образ, открытый SSH-ключ |
| Agent variable | `TF_JOB_CONFIG_FILE` | Абсолютный путь к приватному JSON с фиксированными настройками jobs |
| Job variables | `TF_YC_PLAN_SERVICE_ACCOUNT_ID`, `TF_YC_APPLY_SERVICE_ACCOUNT_ID` | Ожидаемые разные Compute-identities для проверки привязанного ключа |
| Username/password credentials | `tf-<среда>-state-plan`, `tf-<среда>-state-apply` | Access key / secret key своего state; подстановка в AWS-переменные |
| Secret file credentials | `tf-<среда>-yc-plan`, `tf-<среда>-yc-apply` | Авторизованные ключи: свежий IAM-токен перед каждой стадией, не заранее сохранённый YC_TOKEN |

Роли владельца организации не нужны. Точные cloud-роли и квоты ограничиваются учебным каталогом. Созданы три state-аккаунта без ролей на каталог; их статические ключи сохранены вне репозитория в приватных файлах. На один бакет назначены storage.configViewer и storage.editor; policy разрешает только свои state/lock/verification и чтение метаданных. На один KMS-ключ назначена encrypt/decrypt. Политика не разрешает изменение настроек бакета, ACL, удаление state или его версий; широкая IAM-роль не должна использоваться без этой policy. По отдельному разрешению создан read-only Compute/VPC-аккаунт plan с RSA4096-ключом; настоящий JWT-обмен и GET Compute/VPC прошли. Ключи установлены в приватный Jenkins Credentials, три deployment jobs созданы. Первый dev-запуск остановился до выдачи ключей: sandbox запретил Groovy JSON-парсер; его заменила Node.js-загрузчиком, защиту не отключала. Отдельная SSH-пара подготовлена: закрытый ключ остаётся локально, в настройки jobs передан только открытый. [Локальный CI](local-jenkins/README.md) не использует платную облачную ВМ.

## Восстановление

Подготовка ограниченного удаления stage вынесена в отдельный [ReleaseJenkinsfile](ReleaseJenkinsfile). Приватные настройки содержат три согласованных ID: ВМ, boot-диска и data-диска. Режим release входит в привязку сохранённого плана; его каталог имеет отдельный префикс, но аварийный guard общий со средой. Проверка JSON плана разрешает только delete двух Terraform-ресурсов модуля: ВМ с согласованным auto-delete boot-диском и отдельного data-диска. Любая другая модификация, сеть, иной ID или дополнительный диск отклоняются до input и повторно до apply. Полный план остаётся приватным. Физически удаляются три согласованных облачных ресурса; сеть, подсети, SG и backend сохраняются. Применение — только после отдельного согласия на удаление. Это целевая очистка учебных ресурсов, не утверждение, что обычный deployment-plan после неё не покажет повторного создания ВМ.

Последующие обычные create/update пользовательница явно делегировала после проверки полного плана, цены, квот и state. Сам input не отключён; делегированное подтверждение нельзя описывать как её ручной клик. Это разрешение не распространяется на удаления, новые права или публичный доступ. Stage build 1 и первая попытка prod были подтверждены самой владелицей.

При ошибке stdout/stderr сохраняются только в приватном каталоге запуска. Снимок конфигурации и возможный `errored.tfstate` не удаляются. Перед apply создаётся `<среда>.recovery-required.json`; при успехе удаляется, при ошибке/остановке остаётся и блокирует новые plan/apply среды.

Сначала остановить повторы и проверить, не работает ли ещё Terraform. Затем сопоставить ресурсы облака, serial/lineage remote state и аварийного state. Восстановление из версии бакета или `terraform state push` требует отдельного решения человека; автоматического push, удаления маркера или force-unlock нет. После согласованного восстановления удалить только маркер конкретной среды и построить новый план.

После подтверждения remote state владелица может удалить приватный каталог именно завершённого запуска. Автоочистка не включена, чтобы не потерять аварийное состояние. Нужно контролировать диск и не хранить планы бессрочно; токены и диагностические данные не публиковать.

## Проверки и оставшиеся шаги

```sh
node Task2Advanced/checks.mjs
node Task2Advanced/pipeline-checks.mjs
node Task2Advanced/iam-checks.mjs
node --check Task2Advanced/pipeline.mjs
npm ci --prefix Task2Advanced --ignore-scripts --no-audit --no-fund
terraform fmt -check -recursive Task1Advanced
```

Проверки контролируют разные ключи состояния, HTTPS, привязку plan к контексту, контрольную сумму, срок и безопасную сводку. Отдельный сценарий подменяет Terraform заглушкой и проверяет сохранённый план, запрет повторного apply, приватную аварийную диагностику и блокировку повторов. Он не доказывает работу настоящего Terraform и не обращается к S3/облаку.

[Проверка S3](storage-checks.mjs) требует явного `--write-probes` и приватного `TF_STATE_CREDENTIALS_DIRECTORY` с файлами `state-dev.json`, `state-stage.json`, `state-prod.json`. Сначала проверяет metadata всех сред, только затем пишет синтетические объекты под новым `sprint11/<среда>/verification/<uuid>/`: шифрование объекта, две версии и чтение прежней версии, гонка conditional writes, 24 запрета чужих чтений/чтений версий/записей/удалений и три отказа анонимного чтения. После настройки IAM все проверки реально прошли. Очистка добавила delete-маркеры, не удаляла версии навсегда. Настоящий VM-state не используется. S3 conditional-write test не заменяет конкуренцию двух процессов Terraform.

[Отдельная проверка Terraform lock](remote-lock-checks.mjs) использует встроенный terraform_data, без провайдера и облачных ресурсов. Нужны явные --write-probes, TF_BINARY, приватный каталог TF_LOCK_PROBE_DIRECTORY (0700), те же настройки backend и каталог credentials. Preflight выполняется до Terraform. Под новым dev/verification-префиксом один apply держит настоящий S3 lock; другой plan с таймаутом 1s получает отказ, ожидающий plan проходит после освобождения, следующий plan не находит изменений. Все этапы реально прошли на Terraform 1.12.2. Синтетический state подтвердил aws:kms, lock освобождён самим Terraform. Текущая проба удалена delete-маркером, версии сохранены. Полные логи находятся только в приватном каталоге, не в репозитории. Это не применение Task1 и не deployment CI.

До сдачи на отдельно разрешённой учебной среде нужно:

1. Проверить HTTPS, шифрование, versioning и отказ dev-identity при доступе к stage/prod.
2. На отдельном пробном state проверить конкуренцию двух процессов: второй ждёт/отклоняется, после освобождения lock проходит. Простого чтения S3 недостаточно.
3. Проверить Jenkinsfile на живом Jenkins, ожидание/отклонение input, apply того же plan и отказ для устаревшего/повторного плана.
4. После проверки стоимости разрешить настоящее применение Task1; проверить ВМ, диски и outputs, сохранить несекретные подтверждения.
5. Проверить восстановление из версии в пробном контуре. Удаление учебных ресурсов согласовать отдельно; диски не считать автоматически сохранёнными при destroy.

Проект к сдаче не готов. Учебная среда и расходы в пределах гранта согласованы. Шифрование, версии, изоляция объектов и реальный Terraform lock проверены. Dev apply после ручного input завершился частичным отказом на создании диска; state сверён, повторы заблокированы. Stage build 1 прошёл plan, ручной input и apply: SUCCESS, ресурсы и outputs проверены. Остались успешное применение Task1 во всех средах и проверка результатов. Проверка backend и компиляция Jenkinsfile не заменяют эти этапы.

Источники: [S3 backend и права](https://developer.hashicorp.com/terraform/language/backend/s3), [частичная конфигурация](https://developer.hashicorp.com/terraform/language/backend), [блокировка Yandex Cloud](https://yandex.cloud/ru/docs/terraform/tutorials/terraform-state-lock), [аутентификация YC](https://yandex.cloud/ru/docs/terraform/authentication), [Jenkins Pipeline](https://www.jenkins.io/doc/book/pipeline/syntax/), [ручной input](https://www.jenkins.io/doc/pipeline/steps/pipeline-input-step/), [Jenkins credentials](https://www.jenkins.io/doc/book/pipeline/jenkinsfile/).

Совместимость шифрования: [PutObject YC](https://yandex.cloud/ru/docs/storage/s3/api-ref/object/upload), [шифрование по умолчанию](https://yandex.cloud/ru/docs/storage/operations/buckets/encrypt), [проверка kms_key_id в Terraform 1.12.2](https://github.com/hashicorp/terraform/blob/v1.12.2/internal/backend/remote-state/s3/validate.go), [чтение политики бакета YC](https://yandex.cloud/ru/docs/storage/operations/buckets/policy).
