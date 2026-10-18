# Модуль ВМ для трёх сред

Модуль `modules/vm` создаёт ВМ Yandex Compute Cloud, загрузочный и отдельный диск данных. Сетевой интерфейс подключается к переданному subnet ID. Модуль не создаёт облако, каталог или учётные записи.

Корневые конфигурации `envs/dev`, `envs/stage`, `envs/prod` создают отдельные VPC, подсети и security groups и передают их идентификаторы в один и тот же модуль. Имена и параметры окружений находятся в tfvars, а не внутри модуля.

Prod также поддерживает `existing_network_id`: по отдельному разрешению использует VPC stage через data source, не управляя её жизненным циклом. При этом подсети и security groups разные, входящий трафик и публичные IP закрыты. Принадлежность сети учебному каталогу проверяется postcondition. Владелец общей VPC — state stage; на его сети установлен prevent_destroy. Удалять весь stage-стек, пока сеть используется prod, нельзя. Очистка только учебной stage-ВМ и её двух дисков выполняется отдельным ограниченным планом.

| Среда | Зона | vCPU | RAM, ГБ | Загрузочный HDD, ГБ | HDD данных, ГБ | Подсеть |
|---|---|---:|---:|---:|---:|---|
| dev | ru-central1-a | 2 | 2 | 10 | 2 | 10.11.0.0/24 |
| stage | ru-central1-d | 2 | 4 | 10 | 4 | 10.12.0.0/24 |
| prod | ru-central1-e | 2 | 8 | 10 | 8 | 10.13.0.0/24 |

Это примеры конфигураций модуля, не весь production-ландшафт из Task3Advanced. Одна ВМ не обеспечивает отказоустойчивость.

Параметры уменьшены под проверенные квоты учебного облака: по 2 vCPU и 20 ГБ HDD на зону a/d/e. У всех сред разные RAM, диски, имена, подсети и состояние; CPU остаётся параметром модуля, а не константой внутри него. Образ должен помещаться на загрузочный диск 10 ГБ. Суммарно конфигурации требуют 6 vCPU и 44 ГБ HDD; работа CI может потребовать дополнительные ресурсы, которые сюда не включены. Наличие квоты не гарантирует физическую доступность ВМ в зоне.

Повторный plan/apply выполняется с тем же backend и state, чтобы обновлять созданные ресурсы, а не создавать копии. Общие backend и CI можно переиспользовать между проверками, но одна ВМ не должна одновременно управляться несколькими state. Учебные ресурсы не требуется держать постоянно запущенными; остановленная ВМ сохраняет оплачиваемые диски.

## Параметры модуля

Обязательные: `name`, `folder_id`, `zone`, `platform_id`, `cores`, `memory_gb`, `boot_image_id`, `boot_disk_size_gb`, `boot_disk_type`, `data_disk_size_gb`, `data_disk_type`, `subnet_id`, `security_group_ids`, `ssh_user`, `ssh_public_key`.

Необязательные: `labels` (пустая карта), `public_ip` (false), `allow_stopping_for_update` (false). subnet и диски должны быть в одной зоне с ВМ. SSH-ключ передаётся открытый; закрытый ключ модулю не нужен.

Выходы: `id`, `name`, `private_ip`, `public_ip` (null без публичного адреса), `data_disk_id`, `boot_disk_id`.

## Перед реальным запуском

Нужны отдельный учебный каталог Yandex Cloud, образ Linux с cloud-init, существующий открытый SSH-ключ и подтверждённый бюджет. Не используйте рабочие облака и ключи. На время выполнения не выдавайте сервисному аккаунту роли владельца организации.

Передайте ID каталога и образа через `TF_VAR_folder_id`, `TF_VAR_boot_image_id`, открытый ключ — `TF_VAR_ssh_public_key`. Аутентификация провайдера — через поддерживаемые переменные окружения Yandex Cloud, не через tfvars. Значения не сохраняются в репозитории.

Входящий трафик по умолчанию запрещён. Для SSH укажите узкий список адресов VPN/бастиона в `ssh_source_cidrs`; публичный IP по умолчанию не выделяется. Маршрут до приватной сети должен уже существовать. Диск данных только подключается, не форматируется и не монтируется автоматически.

## Команды

Из корня репозитория, после настройки backend из Task2Advanced:

```sh
terraform -chdir=Task1Advanced/envs/dev init -backend-config=/absolute/path/dev.local.hcl
terraform -chdir=Task1Advanced/envs/dev plan -var-file=dev.tfvars -out=dev.tfplan
terraform -chdir=Task1Advanced/envs/dev apply dev.tfplan
```

Для stage и prod замените каталог, имя tfvars, plan и файл backend на соответствующую среду. В backend у каждой среды должен быть отдельный ключ; менять среду только подстановкой tfvars в том же каталоге нельзя.

Если нужен интерактивный запуск вместо сохранённого плана: `terraform -chdir=Task1Advanced/envs/dev apply -var-file=dev.tfvars`. Сначала внимательно проверьте показанный план. Для stage и prod выполнен настоящий apply через сохранённые планы Jenkins; ВМ, диски, закрытые SG и outputs сверены с API и зашифрованным state. Prod переиспользует VPC stage и ранее созданный data-диск. Dev требует восстановления после отказа диска.

Backend S3 объявлен во всех средах: обычный `init` требует его настройки и не переходит молча на локальное хранение. Файлы backend содержат только endpoint/bucket/key и параметры протокола; ключи доступа передаются окружением. Генератор, CI/CD и порядок ручного разрешения подготовлены в [Task2Advanced](../Task2Advanced/README.md); настоящий S3 backend с KMS/versioning/lock и stage plan → input → apply проверены.

## Проверка без облака

```sh
terraform fmt -check -recursive Task1Advanced
terraform -chdir=Task1Advanced/envs/dev init -backend=false
terraform -chdir=Task1Advanced/envs/dev validate
```

Повторите init/validate для stage и prod. `-backend=false` используется только для проверки конфигурации и не означает проверку удалённого состояния. При проблемах доступа к реестру можно использовать [официальное зеркало](https://yandex.cloud/en/docs/terraform/quickstart), задав отдельный `TF_CLI_CONFIG_FILE`, без изменения глобальной конфигурации.

Выполнение `destroy` удалит также диск данных, управляемый модулем. `secondary_disk.auto_delete=false` защищает его при отдельном удалении ВМ, но не при удалении всего Terraform-стека. В учебных средах используйте только тестовые данные.

Источники: [ресурс ВМ](https://yandex.cloud/en/docs/terraform/resources/compute_instance), [диск](https://yandex.cloud/en/docs/terraform/resources/compute_disk), [S3 backend](https://developer.hashicorp.com/terraform/language/backend/s3).
