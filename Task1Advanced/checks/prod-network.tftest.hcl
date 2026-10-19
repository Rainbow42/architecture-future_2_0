mock_provider "yandex" {
  mock_data "yandex_vpc_network" {
    defaults = {
      id        = "nnnnnnnnnnnnnnnnnnnn"
      folder_id = "mock-folder"
    }
  }
}

variables {
  folder_id           = "mock-folder"
  boot_image_id       = "mock-image"
  ssh_public_key      = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA mock-only"
  existing_network_id = "nnnnnnnnnnnnnnnnnnnn"
}

run "reuse_training_network" {
  command = plan

  assert {
    condition     = length(yandex_vpc_network.environment) == 0 && yandex_vpc_subnet.environment.network_id == var.existing_network_id && yandex_vpc_security_group.vm.network_id == var.existing_network_id
    error_message = "Prod must reuse the selected network without creating a third VPC."
  }

  assert {
    condition     = length(yandex_vpc_security_group.vm.ingress) == 0 && module.vm_module.public_ip == null
    error_message = "Network reuse must not open ingress or a public IP."
  }
}

run "reject_foreign_network" {
  command = plan

  override_data {
    target = data.yandex_vpc_network.existing[0]
    values = {
      id        = "nnnnnnnnnnnnnnnnnnnn"
      folder_id = "foreign-folder"
    }
  }

  expect_failures = [data.yandex_vpc_network.existing[0]]
}
