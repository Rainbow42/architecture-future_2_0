resource "yandex_vpc_network" "environment" {
  name      = "${var.name}-network"
  folder_id = var.folder_id
  labels    = var.labels
}

resource "yandex_vpc_subnet" "environment" {
  name           = "${var.name}-subnet"
  folder_id      = var.folder_id
  zone           = var.zone
  network_id     = yandex_vpc_network.environment.id
  v4_cidr_blocks = [var.subnet_cidr]
  labels         = var.labels
}

resource "yandex_vpc_security_group" "vm" {
  name       = "${var.name}-sg"
  folder_id  = var.folder_id
  network_id = yandex_vpc_network.environment.id
  labels     = var.labels

  dynamic "ingress" {
    for_each = length(var.ssh_source_cidrs) > 0 ? [var.ssh_source_cidrs] : []
    content {
      protocol       = "TCP"
      port           = 22
      v4_cidr_blocks = ingress.value
    }
  }
}

module "vm_module" {
  source = "../../modules/vm"

  name                      = var.name
  folder_id                 = var.folder_id
  zone                      = var.zone
  platform_id               = var.platform_id
  cores                     = var.cores
  memory_gb                 = var.memory_gb
  boot_image_id             = var.boot_image_id
  boot_disk_size_gb         = var.boot_disk_size_gb
  boot_disk_type            = var.boot_disk_type
  data_disk_size_gb         = var.data_disk_size_gb
  data_disk_type            = var.data_disk_type
  ssh_user                  = var.ssh_user
  ssh_public_key            = var.ssh_public_key
  labels                    = var.labels
  public_ip                 = var.public_ip
  allow_stopping_for_update = var.allow_stopping_for_update
  subnet_id                 = yandex_vpc_subnet.environment.id
  security_group_ids        = [yandex_vpc_security_group.vm.id]
}
