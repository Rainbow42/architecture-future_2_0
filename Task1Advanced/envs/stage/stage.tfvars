name              = "future-stage"
zone              = "ru-central1-d"
platform_id       = "standard-v3"
cores             = 2
memory_gb         = 4
boot_disk_size_gb = 10
boot_disk_type    = "network-hdd"
data_disk_size_gb = 4
data_disk_type    = "network-hdd"
subnet_cidr       = "10.12.0.0/24"
ssh_user          = "ubuntu"
public_ip         = false
labels = {
  environment = "stage"
  project     = "future"
}
