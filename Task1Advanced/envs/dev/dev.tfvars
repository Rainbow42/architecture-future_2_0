name              = "future-dev"
zone              = "ru-central1-d"
platform_id       = "standard-v3"
cores             = 2
memory_gb         = 2
boot_disk_size_gb = 10
boot_disk_type    = "network-hdd"
data_disk_size_gb = 2
data_disk_type    = "network-hdd"
subnet_cidr       = "10.11.0.0/24"
ssh_user          = "ubuntu"
public_ip         = false
labels = {
  environment = "dev"
  project     = "future"
}
