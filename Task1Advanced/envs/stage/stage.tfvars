name              = "future-stage"
zone              = "ru-central1-a"
platform_id       = "standard-v3"
cores             = 4
memory_gb         = 8
boot_disk_size_gb = 20
boot_disk_type    = "network-hdd"
data_disk_size_gb = 50
data_disk_type    = "network-hdd"
subnet_cidr       = "10.12.0.0/24"
ssh_user          = "ubuntu"
public_ip         = false
labels = {
  environment = "stage"
  project     = "future"
}
