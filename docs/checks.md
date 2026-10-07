# Проверки

## Task1Advanced

Terraform 1.12.2, провайдер yandex-cloud/yandex 0.237.0.

- `terraform fmt -check -recursive Task1Advanced` — пройдено.
- `terraform init -backend=false` и `terraform validate` — пройдено для dev, stage и prod.
- Проверка плана с mock-провайдером — по одному успешному сценарию для каждой среды. Проверены имя из tfvars, CIDR подсети, отсутствие публичного IP и запрет входящего трафика без явного списка адресов.
- Файлы фиксации провайдера содержат контрольные суммы для darwin_amd64, darwin_arm64 и linux_amd64, полученные через официальное зеркало Yandex Cloud.

Повторить проверки плана из корня репозитория после init:

```sh
for env_name in dev stage prod; do
  mkdir -p "Task1Advanced/envs/$env_name/.terraform/checks"
  cp Task1Advanced/checks/environment.tftest.hcl "Task1Advanced/envs/$env_name/.terraform/checks/"
  terraform -chdir="Task1Advanced/envs/$env_name" test \
    -test-directory=.terraform/checks -var-file="$env_name.tfvars" || exit 1
done
```

Значения folder/image и открытый SSH-ключ внутри проверки синтетические. Они используются только mock-провайдером.

Реальный `apply`, удалённый backend и CI/CD ещё не проверены. Mock-сценарий не подтверждает права в облаке, доступность образа, квоты, создание ВМ или доступ по SSH.

## Task4Advanced

- Синтаксис двух схем проверен PlantUML, SVG — XML-парсером.
- Обе схемы просмотрела после рендеринга: подписи читаются, предупреждений рендерера нет.
- Проверка документации прошла: 12 Markdown-файлов, 9 локальных ссылок, 28 контрактов событий, 2 схемы. События агрегатов и Event Storming сопоставлены с каталогом.

Повторить из корня репозитория; нужны Node.js, PlantUML и xmllint:

```sh
node scripts/validate-docs.mjs
git diff --check
```

Это проверки проектных документов, а не работающих интеграций. Доставку событий, компенсации и нагрузку на реальной системе не проверяла. Task2Advanced, Task3Advanced, Task5Advanced, теория и облачное развёртывание ещё не завершены; проект не готов к сдаче.
