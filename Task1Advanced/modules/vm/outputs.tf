output "id" {
  value = yandex_compute_instance.vm.id
}

output "name" {
  value = yandex_compute_instance.vm.name
}

output "private_ip" {
  value = yandex_compute_instance.vm.network_interface[0].ip_address
}

output "public_ip" {
  value = var.public_ip ? yandex_compute_instance.vm.network_interface[0].nat_ip_address : null
}

output "data_disk_id" {
  value = yandex_compute_disk.data.id
}

output "boot_disk_id" {
  value = yandex_compute_instance.vm.boot_disk[0].disk_id
}
