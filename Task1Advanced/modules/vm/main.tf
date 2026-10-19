resource "yandex_compute_disk" "data" {
  name      = "${var.name}-data"
  folder_id = var.folder_id
  zone      = var.zone
  type      = var.data_disk_type
  size      = var.data_disk_size_gb
  labels    = var.labels
}

resource "yandex_compute_instance" "vm" {
  name                      = var.name
  folder_id                 = var.folder_id
  zone                      = var.zone
  platform_id               = var.platform_id
  labels                    = var.labels
  allow_stopping_for_update = var.allow_stopping_for_update

  resources {
    cores  = var.cores
    memory = var.memory_gb
  }

  boot_disk {
    initialize_params {
      image_id = var.boot_image_id
      size     = var.boot_disk_size_gb
      type     = var.boot_disk_type
    }
  }

  secondary_disk {
    disk_id     = yandex_compute_disk.data.id
    device_name = "data"
    auto_delete = false
  }

  network_interface {
    subnet_id          = var.subnet_id
    security_group_ids = var.security_group_ids
    nat                = var.public_ip
  }

  metadata = {
    ssh-keys = "${var.ssh_user}:${trimspace(var.ssh_public_key)}"
  }
}
