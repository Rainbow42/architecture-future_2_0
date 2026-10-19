# Результаты учебного развёртывания

Это настоящие запуски локального приватного Jenkins, не GitHub workflow и не mock-планы. В каждом случае использован сохранённый бинарный plan с параметрами соответствующего tfvars. После apply параметры ВМ, присоединённых дисков, подсети, закрытой security group и outputs сверены чтением облачного API и KMS-зашифрованного remote state.

| Среда | Jenkins job / build | Исходная версия | Результат apply | Проверенные параметры |
|---|---|---|---|---|
| dev | future-deploy-dev / 4 | `3685eae08d63370979b26b3f6e2136acb3f6f63a` | SUCCESS | ru-central1-d, 2 vCPU 100%, RAM 2 ГБ, HDD 10+2 ГБ, private IP, закрытая SG |
| stage | future-deploy-stage / 1 | `69e0f10db6392dc957eff80e1c360c44e2bc8ec1` | SUCCESS | ru-central1-d, 2 vCPU 100%, RAM 4 ГБ, HDD 10+4 ГБ, private IP, закрытая SG |
| prod | future-deploy-prod / 2 | `a97b1fc9ac7b4b5a5c5044ced01bc7b90fc68e26` | SUCCESS | ru-central1-e, 2 vCPU 100%, RAM 8 ГБ, HDD 10+8 ГБ, private IP, закрытая SG |

Stage input владелица подтвердила самостоятельно. Prod input подтверждён делегированно после прямого разрешения обычных create/update. Для dev отдельно согласована замена пустой подсети из зоны a на d; затем input подтверждён делегированно. Запись Jenkins `approved by tonya` обозначает учётную запись, а не доказывает самостоятельный физический клик владелицы во всех запусках. Независимого второго проверяющего в учебном CI нет.

## Сохранённые планы

| Среда | SHA256 применённого бинарного плана |
|---|---|
| dev | `3914d289c1e6269db7ed12a43461eeae2bf4feb20bfc7a824cae9c0ab57744d8` |
| stage | `74c7fcdc004059de6b72a89792428d3cdeb57761292e713e845472797c6118e2` |
| prod | `45edec3c875fa4339ce7c736975c26cb564af9c4efbe11569efd32db7e7572e4` |

План привязан к исходному commit, run/attempt, среде, версии Terraform, backend, входным параметрам, checksum и сроку. Во время ожидания input исходная конфигурация не перепланировалась. Полные планы, manifest, apply-started/apply-completed и диагностика хранятся приватно на изолированном агенте, не в GitHub artifacts.

## Outputs и текущее состояние

| Среда | Проверенная ВМ | Проверенные диски boot / data | Remote state после успешного deployment |
|---|---|---|---|
| dev | `fv4k5ngd4bcb2paf4ml5` | `fv40hvij1tij2upa1u40` / `fv4jid30a24mbhl79k63` | serial 3, пять managed resources, aws:kms, lock освобождён |
| stage | `fv4m8uhokqa35l47o6db` | `fv424gmmsho5tlc9b1gi` / `fv4aia2a74i3mco3rrpv` | serial 2 на момент deployment, пять managed resources, aws:kms, lock освобождён |
| prod | `bg0eq878c7fj8tikiuhk` | `bg0pc324ti1u9udfh5ol` / `bg0ceih8bkvusu21uo7c` | serial 3, четыре managed resources и VPC data source, aws:kms, lock освобождён |

После успешной проверки stage отдельный future-release-stage / 1 завершился SUCCESS и удалил только её ВМ и HDD 10+4 ГБ по явному согласию владелицы. Сеть, подсеть, SG, KMS, backend, версии состояния и история успешного запуска сохранены. SHA256 release-плана: `60d1bb556cce199c4022aab37b1983d012029967dc3f052c798660347ad81645`.

API подтвердил отсутствие этих трёх compute-ресурсов и сохранность сети и prod. Stage state стал serial 3 с тремя сетевыми managed resources. Старый output `vm` после targeted destroy остался в state: это исторический output удалённой ВМ, а не действующий ресурс. При повторном создании stage нужен новый обычный план; старый release-план повторно не применяется.

Prod использует отдельные закрытые подсеть и SG в согласованной VPC stage. Её жизненным циклом управляет только stage state, с prevent_destroy; prod читает VPC как data source. Dev использует собственную VPC. Публичных IP и правил входящего/исходящего трафика у пользовательских SG нет.

## Подтверждения интерфейса

- [Dev: успешный build 4](evidence/dev-success.png).
- [Stage: успешный build 1 до очистки](evidence/stage-success.png).
- [Prod: успешный build 2](evidence/prod-success.png).
- [Stage: отдельная согласованная очистка](evidence/stage-release-success.png).

Скриншоты сохранены из настоящего интерфейса без изменения содержимого. Они показывают статус Jenkins; параметры облачных ресурсов дополнительно сверены API/state, как описано выше. Закрытый Jenkins не публиковался в интернет и не предоставлялся ревьюеру вместе с credentials.

## Ограничения результата

SSH-пара передана в metadata только открытой частью. Вход в гостевую ОС, нагрузка и отказоустойчивость не испытывались; сетевая изоляция ради SSH-проверки не расширялась. Эти учебные ВМ не реализуют всю C4-платформу из Task3. Цена Compute — расчёт по тарифам, не окончательный счёт. Проверки S3/изоляции/конкуренции Terraform и история восстановления после частичных отказов описаны в [журнале проверок](checks.md).
