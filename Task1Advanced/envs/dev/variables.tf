variable "name" {
  type = string
}

variable "folder_id" {
  type = string
}

variable "zone" {
  type = string
}

variable "platform_id" {
  type = string
}

variable "cores" {
  type = number
}

variable "memory_gb" {
  type = number
}

variable "boot_image_id" {
  type = string
}

variable "boot_disk_size_gb" {
  type = number
}

variable "boot_disk_type" {
  type = string
}

variable "data_disk_size_gb" {
  type = number
}

variable "data_disk_type" {
  type = string
}

variable "ssh_user" {
  type = string
}

variable "ssh_public_key" {
  type = string
}

variable "labels" {
  type    = map(string)
  default = {}
}

variable "public_ip" {
  type    = bool
  default = false
}

variable "allow_stopping_for_update" {
  type    = bool
  default = false
}

variable "subnet_cidr" {
  type = string
}

variable "ssh_source_cidrs" {
  type    = list(string)
  default = []
}
