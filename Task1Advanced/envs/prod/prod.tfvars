name              = "future-prod"
zone              = "ru-central1-a"
platform_id       = "standard-v3"
cores             = 8
memory_gb         = 16
boot_disk_size_gb = 20
boot_disk_type    = "network-hdd"
data_disk_size_gb = 100
data_disk_type    = "network-hdd"
subnet_cidr       = "10.13.0.0/24"
ssh_user          = "ubuntu"
public_ip         = false
labels = {
  environment = "prod"
  project     = "future"
}
