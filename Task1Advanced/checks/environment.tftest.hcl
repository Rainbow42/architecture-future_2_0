mock_provider "yandex" {}

variables {
  folder_id      = "mock-folder"
  boot_image_id  = "mock-image"
  ssh_public_key = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA mock-only"
}

run "environment_wiring" {
  command = plan

  assert {
    condition     = module.vm_module.name == var.name
    error_message = "VM name must be passed through from environment tfvars."
  }

  assert {
    condition     = yandex_vpc_subnet.environment.v4_cidr_blocks == tolist([var.subnet_cidr])
    error_message = "Each environment must use its configured network."
  }

  assert {
    condition     = module.vm_module.public_ip == null
    error_message = "The example must not expose a public IP."
  }

  assert {
    condition     = length(yandex_vpc_security_group.vm.ingress) == 0
    error_message = "Inbound access must stay closed without an explicit allowlist."
  }

  assert {
    condition     = var.cores == 2 && var.memory_gb <= 16
    error_message = "Training examples must fit the observed zonal CPU and RAM quotas."
  }

  assert {
    condition     = var.boot_disk_type == "network-hdd" && var.data_disk_type == "network-hdd" && var.boot_disk_size_gb + var.data_disk_size_gb <= 20
    error_message = "Training disks must fit the observed 20 GB HDD quota per zone."
  }
}
