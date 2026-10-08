# Удалённое состояние и CI/CD

Подготовила конфигурацию backend и pipeline. Настоящие S3, блокировка, Jenkins input и облачный apply ещё не проверены. Бакет, CI, identities и secrets не создавались.

## Backend

[Генератор](backend.mjs) формирует HCL без секретов для отдельных корневых конфигураций Task1Advanced.

| Среда | Ключ состояния | Ключ блокировки |
|---|---|---|
| dev | `sprint11/dev/terraform.tfstate` | `sprint11/dev/terraform.tfstate.tflock` |
| stage | `sprint11/stage/terraform.tfstate` | `sprint11/stage/terraform.tfstate.tflock` |
| prod | `sprint11/prod/terraform.tfstate` | `sprint11/prod/terraform.tfstate.tflock` |

Среды используют разные identities и только workspace `default`. Префикс служебного перечисления workspaces тоже разделён по средам. Подставлять prod.tfvars в каталог dev нельзя.

`use_lockfile=true` включает нативную блокировку S3, `-lock-timeout=60s` ограничивает ожидание. Автоматического force-unlock и `-lock=false` нет. Jenkins `disableConcurrentBuilds()` сериализует один job, но не заменяет backend lock для других процессов Terraform.

Выбран S3 API с поддержкой conditional writes. Для собственного MinIO необходимо проверить эти операции на выбранной версии: наличие S3 API не доказывает корректность блокировки. Руководство Yandex Cloud описывает другой вариант — Object Storage и YDB. Его не разворачивала и поддержку нативной S3-блокировки в Object Storage не подтверждаю.

Обязательные настройки backend: HTTPS с проверяемым сертификатом, private bucket, versioning, запрет незашифрованного транспорта. `encrypt=true` требует серверного шифрования; для соответствующей конфигурации MinIO нужен подготовленный KMS. Бакет, identities и KMS создаются отдельно от VM-state: удаление ВМ не должно удалять историю состояния. Состояние и его версии считаются конфиденциальными.

В [шаблоне policy](state-policy.example.json) заменяются `REPLACE_BUCKET` и `REPLACE_ENVIRONMENT`. Разрешены ListBucket только своего префикса, Get/Put точного state и Get/Put/Delete точного lock-файла. Delete state не требуется. Для plan-identity Put state можно убрать после проверки bootstrap-поведения backend; запись/удаление lock-файла нужны и для plan. При необходимости KMS-права ограничиваются конкретным ключом. Политика не была применена к реальной учётной записи.

Пример локального init после отдельного разрешения и подготовки backend:

```sh
umask 077
export TF_STATE_ENDPOINT=https://state.example.invalid
export TF_STATE_BUCKET=replace-with-private-state-bucket
export TF_STATE_REGION=us-east-1
node Task2Advanced/backend.mjs dev > /absolute/private/path/dev.local.hcl
terraform -chdir=Task1Advanced/envs/dev init -input=false -backend-config=/absolute/private/path/dev.local.hcl
```

Адрес — неработающий пример. `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` передаются окружением, не аргументами, tfvars или backend-файлом. Отдельный `YC_TOKEN` аутентифицирует провайдер, а не S3. IAM-токен должен оставаться действительным после ожидания ручного подтверждения.

## Pipeline

[GitHub workflow](../.github/workflows/terraform.yml) выполняет только проверки без облака и секретов: fmt, init без backend, validate и mock-планы. Deployment jobs и публикации plan/state в нём нет.

Для настоящего CI/CD подготовлен [Jenkinsfile](Jenkinsfile):

1. Prepare: checkout доверенного SCM, сравнение полного SHA с `APPROVED_COMMIT`, локальные проверки.
2. Init and plan: remote init → validate → сохранённый бинарный plan под plan-identity.
3. Approve saved plan: обязательный `input`, список разрешённых пользователей/групп `TF_APPROVERS`, ожидание до 12 часов. Отказ завершает pipeline до выдачи apply-credentials.
4. Apply: отдельная apply-identity и именно сохранённый plan на том же агенте, без повторного планирования.

На среду нужен один Jenkins job с фиксированным `TF_ENVIRONMENT`. SCM URL фиксируется на этом репозитории, ветка — проверенная main/codex/sprint-11. Automatic PR discovery и произвольные форки не подключаются. Полный SHA задаётся в `APPROVED_COMMIT` перед запуском и проверяется до выдачи credentials. Изменять SCM/Jenkinsfile/job могут только доверенные администраторы. До `TF_DEPLOYMENT_ENABLED=true` выполнение прекращается.

Перед подтверждением человек открывает `plan.private.txt` на приватном агенте, проверяет ресурсы, диски, сеть, каталог, удаления, стоимость и SHA256; затем нажимает Apply reviewed plan в Jenkins. Сводка количества действий не заменяет полный план. Администратор Jenkins может подтвердить input независимо от списка: это доверенная роль. Для prod нужен отдельный подтверждающий человек. Restart from Stage отключён, чтобы не перескакивать через согласование. План старше 24 часов отклоняется.

Бинарный plan, state, полный вывод Terraform и аварийный state не загружаются в GitHub artifacts, в том числе зашифрованными. В консоль CI выводятся только среда, commit, хеш и количества действий. Полные данные остаются на приватном Jenkins-агенте. Такой gate не зависит от платных возможностей GitHub; вычислительные ресурсы CI всё равно должны укладываться в отдельно согласованный бюджет.

Требования к приватному CI:

- Jenkins с Pipeline, Git, Credentials Binding и Pipeline Input Step; без анонимного доступа, с ограниченными правами запуска, изменения job и подтверждения.
- Постоянный Linux-агент `future-terraform`: Node.js 22, Terraform ровно 1.12.2, Git, tar, непривилегированный пользователь; без соседних недоверенных задач. Все стадии одного запуска остаются на одном агенте.
- `TF_PLAN_DIRECTORY` вне workspace, например `/srv/future-terraform/plans`; владелец — пользователь агента, режим 0700, зашифрованный диск. Файлы создаются с 0600. Каталог не включается в публичные backups/артефакты.
- Приватный доступ к полному плану только у подтверждающего человека. Агент не получает доступ к рабочим облакам и личным данным и не подключается как GitHub self-hosted runner публичного репозитория.

[Скрипт](pipeline.mjs) сохраняет снимок Task1Advanced из точного commit в `<run_id>-<attempt>-<среда>`. `TF_RUN_ID` — Jenkins build number, `TF_RUN_ATTEMPT=1`; повторение требует нового build. Один job на среду и постоянная нумерация обязательны; существующий каталог не перезаписывается. Перед apply сверяются commit, run/attempt, среда, версия Terraform, хеш backend/параметров, хеш plan и срок. Повторный apply отклоняется. SHA256 обнаруживает порчу, но не защищает от администратора, способного изменить и plan, и manifest. Приватный CI — доверенная граница.

## Настройки вне репозитория

Несекретные параметры фиксируются в конфигурации job. Secrets хранятся в Jenkins Credentials, не в build parameters. Для сред identities разделяются.

| Тип | Имя | Назначение |
|---|---|---|
| Job variables | `TF_DEPLOYMENT_ENABLED`, `TF_ENVIRONMENT`, `TF_APPROVERS` | Флаг, фиксированная среда, IDs подтверждающих пользователей/групп |
| Job variables | `TF_STATE_ENDPOINT`, `TF_STATE_BUCKET`, `TF_STATE_REGION` | Подготовленный приватный backend |
| Job variable | `TF_PLAN_DIRECTORY` | Приватное постоянное место для планов |
| Job variables | `TF_VAR_folder_id`, `TF_VAR_boot_image_id`, `TF_VAR_ssh_public_key` | Учебный каталог, образ, открытый SSH-ключ |
| Username/password credentials | `tf-<среда>-state-plan`, `tf-<среда>-state-apply` | Access key / secret key своего state; подстановка в AWS-переменные |
| Secret text credentials | `tf-<среда>-yc-plan`, `tf-<среда>-yc-apply` | YC_TOKEN: чтение для plan, ограниченное изменение для apply |

Роли владельца организации не нужны. Точные cloud-роли и квоты согласуются для учебного каталога. Secrets, Jenkins jobs, агенты и облачные права автоматически не настраивались.

## Восстановление

При ошибке stdout/stderr сохраняются только в приватном каталоге запуска. Снимок конфигурации и возможный `errored.tfstate` не удаляются. Перед apply создаётся `<среда>.recovery-required.json`; при успехе удаляется, при ошибке/остановке остаётся и блокирует новые plan/apply среды.

Сначала остановить повторы и проверить, не работает ли ещё Terraform. Затем сопоставить ресурсы облака, serial/lineage remote state и аварийного state. Восстановление из версии бакета или `terraform state push` требует отдельного решения человека; автоматического push, удаления маркера или force-unlock нет. После согласованного восстановления удалить только маркер конкретной среды и построить новый план.

После подтверждения remote state владелица может удалить приватный каталог именно завершённого запуска. Автоочистка не включена, чтобы не потерять аварийное состояние. Нужно контролировать диск и не хранить планы бессрочно; токены и диагностические данные не публиковать.

## Проверки и оставшиеся шаги

```sh
node Task2Advanced/checks.mjs
node Task2Advanced/pipeline-checks.mjs
node --check Task2Advanced/pipeline.mjs
terraform fmt -check -recursive Task1Advanced
```

Проверки контролируют разные ключи состояния, HTTPS, привязку plan к контексту, контрольную сумму, срок и безопасную сводку. Отдельный сценарий подменяет Terraform заглушкой и проверяет сохранённый план, запрет повторного apply, приватную аварийную диагностику и блокировку повторов. Он не доказывает работу настоящего Terraform и не обращается к S3/облаку.

До сдачи на отдельно разрешённой учебной среде нужно:

1. Проверить HTTPS, шифрование, versioning и отказ dev-identity при доступе к stage/prod.
2. На отдельном пробном state проверить конкуренцию двух процессов: второй ждёт/отклоняется, после освобождения lock проходит. Простого чтения S3 недостаточно.
3. Проверить Jenkinsfile на живом Jenkins, ожидание/отклонение input, apply того же plan и отказ для устаревшего/повторного плана.
4. После проверки стоимости разрешить настоящее применение Task1; проверить ВМ, диски и outputs, сохранить несекретные подтверждения.
5. Проверить восстановление из версии в пробном контуре. Удаление учебных ресурсов согласовать отдельно; диски не считать автоматически сохранёнными при destroy.

Проект к сдаче не готов. Ещё нужны разрешённая учебная среда, предел расходов, backend и приватный CI с ручным подтверждением; решения о расходах и выдаче доступа оставила пользовательнице.

Источники: [S3 backend и права](https://developer.hashicorp.com/terraform/language/backend/s3), [частичная конфигурация](https://developer.hashicorp.com/terraform/language/backend), [блокировка Yandex Cloud](https://yandex.cloud/ru/docs/terraform/tutorials/terraform-state-lock), [аутентификация YC](https://yandex.cloud/ru/docs/terraform/authentication), [Jenkins Pipeline](https://www.jenkins.io/doc/book/pipeline/syntax/), [ручной input](https://www.jenkins.io/doc/pipeline/steps/pipeline-input-step/), [Jenkins credentials](https://www.jenkins.io/doc/book/pipeline/jenkinsfile/).
