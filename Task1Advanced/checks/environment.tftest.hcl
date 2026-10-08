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
}
