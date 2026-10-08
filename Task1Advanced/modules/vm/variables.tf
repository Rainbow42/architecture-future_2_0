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

  validation {
    condition     = var.cores >= 2 && floor(var.cores) == var.cores
    error_message = "cores must be an integer of at least 2."
  }
}

variable "memory_gb" {
  type = number

  validation {
    condition     = var.memory_gb >= 1
    error_message = "memory_gb must be at least 1."
  }
}

variable "boot_image_id" {
  type = string
}

variable "boot_disk_size_gb" {
  type = number

  validation {
    condition     = var.boot_disk_size_gb >= 10 && floor(var.boot_disk_size_gb) == var.boot_disk_size_gb
    error_message = "boot_disk_size_gb must be an integer of at least 10."
  }
}

variable "boot_disk_type" {
  type = string
}

variable "data_disk_size_gb" {
  type = number

  validation {
    condition     = var.data_disk_size_gb >= 1 && floor(var.data_disk_size_gb) == var.data_disk_size_gb
    error_message = "data_disk_size_gb must be a positive integer."
  }
}

variable "data_disk_type" {
  type = string
}

variable "subnet_id" {
  type = string
}

variable "security_group_ids" {
  type = list(string)

  validation {
    condition     = length(var.security_group_ids) > 0
    error_message = "At least one explicit security group is required."
  }
}

variable "ssh_user" {
  type = string
}

variable "ssh_public_key" {
  type = string

  validation {
    condition     = can(regex("^ssh-(ed25519|rsa) [A-Za-z0-9+/=]+( .*)?$", trimspace(var.ssh_public_key)))
    error_message = "Provide an OpenSSH ed25519 or RSA public key, never a private key."
  }
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
