output "vm" {
  value = module.vm_module
}

output "subnet_id" {
  value = yandex_vpc_subnet.environment.id
}
